import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Program } from "../lang/ast.ts";
import type { WorkerResult } from "./types.ts";

// The single integration point with Z3. The solver runs in a Node subprocess
// (see node-worker.ts for why); swapping in a different verifier backend —
// in-process z3 once Bun supports it, or a Dafny/Verus CLI — only touches
// this file.

const WORKER_PATH = fileURLToPath(new URL("./node-worker.ts", import.meta.url));
const WORKER_TIMEOUT_MS = 60_000;

export async function verifyProgramViaSolver(
  program: Program,
): Promise<WorkerResult> {
  return new Promise((resolve) => {
    const child = spawn("node", [WORKER_PATH], {
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
