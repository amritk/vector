import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Program } from "../lang/ast.ts";
import { validateProgramShape } from "../lang/shape.ts";
import { typecheckProgram } from "../lang/validate.ts";
import { emitVerificationScript, parseZ3Output } from "./smt.ts";
import type { SolveResult } from "./types.ts";
import { assembleReport } from "./verify.ts";

// The single integration point with Z3. We emit an SMT-LIB2 script and drive
// the native `z3` CLI over stdin — no Node subprocess, no wasm. Swapping in a
// different verifier backend (a Dafny/Verus CLI) only touches this file and
// smt.ts. z3 is located three ways, in order: an embedded copy extracted from
// the compiled binary; $VECTOR_Z3; a repo-local .z3/ (see `bun run fetch-z3`);
// or `z3` on PATH.

const SOLVER_TIMEOUT_MS = 60_000;

// Set by bin.ts in the compiled binary: the in-executable path of the embedded
// z3 tarball (the `z3` executable + its shared library), which we extract once.
const EMBEDDED_Z3_TAR_GLOBAL = "__VECTOR_Z3_TAR__";

interface Z3Location {
  bin: string;
  /** Prepended to LD_LIBRARY_PATH so a co-located libz3 is found. */
  libDir?: string;
}

let cachedZ3: Z3Location | null = null;
let cachedLabel: string | null = null;

async function resolveZ3(): Promise<Z3Location> {
  if (cachedZ3) return cachedZ3;
  const embeddedTar = (globalThis as Record<string, unknown>)[
    EMBEDDED_Z3_TAR_GLOBAL
  ];
  cachedZ3 =
    typeof embeddedTar === "string"
      ? await extractEmbeddedZ3(embeddedTar)
      : resolveDevZ3();
  return cachedZ3;
}

function resolveDevZ3(): Z3Location {
  const envBin = process.env.VECTOR_Z3;
  if (envBin && existsSync(envBin)) {
    return {
      bin: envBin,
      libDir: process.env.VECTOR_Z3_LIB ?? dirname(envBin),
    };
  }
  const repoZ3 = fileURLToPath(new URL("../../.z3/z3", import.meta.url));
  if (existsSync(repoZ3)) return { bin: repoZ3, libDir: dirname(repoZ3) };
  return { bin: "z3" }; // fall back to PATH; system loader finds libz3
}

// Extract the embedded z3 (executable + shared lib) to a content-addressed temp
// dir and return its location. Idempotent via a `.ready` marker so repeat runs
// and concurrent processes reuse one extraction.
async function extractEmbeddedZ3(embeddedTarPath: string): Promise<Z3Location> {
  const bytes = Buffer.from(await Bun.file(embeddedTarPath).arrayBuffer());
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const dest = join(tmpdir(), "vector-z3", hash);
  const bin = join(dest, "z3");

  if (!existsSync(join(dest, ".ready"))) {
    const staging = `${dest}.${process.pid}.tmp`;
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    const tarFile = join(staging, "z3.tar");
    writeFileSync(tarFile, bytes);
    const res = spawnSync("tar", ["-xf", tarFile, "-C", staging]);
    if (res.status !== 0) {
      throw new Error(
        `failed to extract embedded z3: ${res.stderr?.toString() ?? `tar exited ${res.status}`}`,
      );
    }
    rmSync(tarFile, { force: true });
    chmodSync(join(staging, "z3"), 0o755);
    writeFileSync(join(staging, ".ready"), "");
    try {
      renameSync(staging, dest);
    } catch {
      rmSync(staging, { recursive: true, force: true });
    }
  }
  return { bin, libDir: dest };
}

function envWithLib(libDir?: string): NodeJS.ProcessEnv {
  if (!libDir) return process.env;
  const existing = process.env.LD_LIBRARY_PATH;
  return {
    ...process.env,
    LD_LIBRARY_PATH: existing ? `${libDir}:${existing}` : libDir,
  };
}

function solverLabel(loc: Z3Location): string {
  if (cachedLabel) return cachedLabel;
  try {
    const res = spawnSync(loc.bin, ["--version"], {
      env: envWithLib(loc.libDir),
      encoding: "utf8",
    });
    const version = res.stdout?.match(/(\d+\.\d+\.\d+)/)?.[1];
    cachedLabel = version ? `Z3 ${version} (native)` : "Z3 (native)";
  } catch {
    cachedLabel = "Z3 (native)";
  }
  return cachedLabel;
}

export async function verifyProgramViaSolver(
  program: Program,
): Promise<SolveResult> {
  // Same defensive gate the former Node worker ran, so a malformed program is
  // reported as invalid rather than crashing the solver.
  const shapeErrors = validateProgramShape(program);
  if (shapeErrors.length > 0) return { kind: "invalid", errors: shapeErrors };
  const { errors, numTypes } = typecheckProgram(program);
  if (errors.length > 0) return { kind: "invalid", errors };

  let loc: Z3Location;
  try {
    loc = await resolveZ3();
  } catch (err) {
    return {
      kind: "error",
      message: `failed to prepare z3: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const label = solverLabel(loc);
  const { script, queries } = emitVerificationScript(program, numTypes);

  return new Promise<SolveResult>((resolve) => {
    const started = Date.now();
    const child = spawn(loc.bin, ["-in"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: envWithLib(loc.libDir),
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (result: SolveResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({
        kind: "error",
        message: `z3 timed out after ${SOLVER_TIMEOUT_MS} ms`,
      });
    }, SOLVER_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      finish({
        kind: "error",
        message: `failed to spawn z3 (${loc.bin}): ${err.message}`,
      });
    });
    child.on("close", () => {
      // z3 exits 0 even on per-command errors, so trust the markers: no markers
      // at all means it never ran our checks (bad binary, load failure, …).
      if (queries.length > 0 && !stdout.includes("@@Q")) {
        finish({
          kind: "error",
          message: `z3 produced no verdicts${stderr ? `: ${stderr.slice(0, 500)}` : ""}`,
        });
        return;
      }
      const answers = parseZ3Output(stdout, queries.length);
      finish({
        kind: "report",
        report: assembleReport(
          program,
          queries,
          answers,
          label,
          Date.now() - started,
        ),
      });
    });

    child.stdin.write(script);
    child.stdin.end();
  });
}
