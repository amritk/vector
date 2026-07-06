import { init } from "z3-solver";
import type { Program } from "../lang/ast.ts";
import { validateProgramShape } from "../lang/shape.ts";
import { typecheckProgram } from "../lang/validate.ts";
import type { WorkerResult } from "./types.ts";
import { verifyProgram } from "./verify.ts";

// Runs under Node, not Bun: z3-solver's Emscripten pthread build aborts inside
// Bun's worker_threads (verified in this repo), while Node 22 runs it fine and
// executes this file's TypeScript natively via type stripping. The runner
// feeds a Program JSON on stdin and reads a WorkerResult JSON from stdout.
//
// Validation here uses the engine's own shape validator + typechecker rather
// than the mjst-generated parsers: the generated code's extensionless relative
// imports don't resolve under Node ESM, and this worker must stay Node-loadable.

const SOLVER_LABEL = "Z3 4.16.0 (wasm)";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<WorkerResult> {
  const raw = await readStdin();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return {
      kind: "invalid",
      errors: [
        `stdin is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }
  const shapeErrors = validateProgramShape(data);
  if (shapeErrors.length > 0) {
    return { kind: "invalid", errors: shapeErrors };
  }
  const program = data as Program;
  const { errors, numTypes } = typecheckProgram(program);
  if (errors.length > 0) {
    return { kind: "invalid", errors };
  }
  const { Context, em } = await init();
  const ctx = Context("main");
  const report = await verifyProgram(ctx, program, numTypes, SOLVER_LABEL);
  em.PThread.terminateAllThreads();
  return { kind: "report", report };
}

try {
  const result = await main();
  process.stdout.write(JSON.stringify(result));
  process.exit(0);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stdout.write(
    JSON.stringify({ kind: "error", message } satisfies WorkerResult),
  );
  process.exit(0);
}
