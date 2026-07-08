import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Program } from "../lang/ast.ts";
import type { WorkerResult } from "./types.ts";

// The single integration point with Z3. The solver runs in a Node subprocess
// (see node-worker.ts for why); swapping in a different verifier backend —
// in-process z3 once Bun supports it, or a Dafny/Verus CLI — only touches
// this file.

const WORKER_TIMEOUT_MS = 60_000;

// Where the solver worker lives depends on how vector is running:
//
//   • From source (`bun run vector`, `bun test`): spawn Node directly on the
//     TypeScript worker, which Node 22 runs via type stripping.
//   • As a compiled single-file binary: the whole Node solver runtime (the
//     bundled worker + z3-solver + its 33 MB wasm) is embedded as a tarball at
//     build time. `bin.ts` hands us the tarball's in-binary path via a global;
//     we extract it once to a per-content temp cache and spawn Node on the
//     extracted `worker.mjs`. Node still runs the solver because z3-solver's
//     pthread build aborts under Bun.
const EMBEDDED_RUNTIME_GLOBAL = "__VECTOR_RUNTIME_TAR__";

let cachedWorkerScript: string | null = null;

async function resolveWorkerScript(): Promise<string> {
  if (cachedWorkerScript) return cachedWorkerScript;

  const embeddedTar = (globalThis as Record<string, unknown>)[
    EMBEDDED_RUNTIME_GLOBAL
  ];
  if (typeof embeddedTar !== "string") {
    // Source mode: the worker sits next to this file.
    cachedWorkerScript = fileURLToPath(
      new URL("./node-worker.ts", import.meta.url),
    );
    return cachedWorkerScript;
  }

  cachedWorkerScript = await extractEmbeddedRuntime(embeddedTar);
  return cachedWorkerScript;
}

// Extract the embedded solver runtime to a content-addressed temp dir and
// return the path to its worker entry. Idempotent: a `.ready` marker lets
// repeat runs (and concurrent processes) reuse an existing extraction.
async function extractEmbeddedRuntime(
  embeddedTarPath: string,
): Promise<string> {
  const bytes = Buffer.from(await Bun.file(embeddedTarPath).arrayBuffer());
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const dest = join(tmpdir(), "vector-runtime", hash);
  const workerScript = join(dest, "worker.mjs");

  if (existsSync(join(dest, ".ready"))) return workerScript;

  const staging = `${dest}.${process.pid}.tmp`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  const tarFile = join(staging, "runtime.tar");
  writeFileSync(tarFile, bytes);
  const res = spawnSync("tar", ["-xf", tarFile, "-C", staging]);
  if (res.status !== 0) {
    throw new Error(
      `failed to extract embedded solver runtime: ${res.stderr?.toString() ?? `tar exited ${res.status}`}`,
    );
  }
  rmSync(tarFile, { force: true });
  writeFileSync(join(staging, ".ready"), "");

  try {
    renameSync(staging, dest);
  } catch {
    // Another process extracted the same content first; drop our staging copy.
    rmSync(staging, { recursive: true, force: true });
  }
  return workerScript;
}

export async function verifyProgramViaSolver(
  program: Program,
): Promise<WorkerResult> {
  let workerScript: string;
  try {
    workerScript = await resolveWorkerScript();
  } catch (err) {
    return {
      kind: "error",
      message: `failed to prepare solver runtime: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return new Promise((resolve) => {
    const child = spawn("node", [workerScript], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (result: WorkerResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({
        kind: "error",
        message: `solver worker timed out after ${WORKER_TIMEOUT_MS} ms`,
      });
    }, WORKER_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      finish({
        kind: "error",
        message: `failed to spawn solver worker: ${err.message}`,
      });
    });
    child.on("close", (code) => {
      if (code !== 0) {
        finish({
          kind: "error",
          message: `solver worker exited with code ${code}: ${stderr.slice(0, 2000)}`,
        });
        return;
      }
      try {
        finish(JSON.parse(stdout) as WorkerResult);
      } catch {
        finish({
          kind: "error",
          message: `solver worker produced unparseable output: ${stdout.slice(0, 500)}`,
        });
      }
    });

    child.stdin.write(JSON.stringify(program));
    child.stdin.end();
  });
}
