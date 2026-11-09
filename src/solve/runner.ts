import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Program } from "../lang/ast.ts";
import { validateProgramShape } from "../lang/shape.ts";
import { typecheckProgram } from "../lang/validate.ts";
import { type ConformanceSeeds, checkConformance } from "./conformance.ts";
import {
  type QueryAnswer,
  emitVerificationScript,
  parseZ3Output,
} from "./smt.ts";
import type { SolveResult } from "./types.ts";
import { assembleReport } from "./verify.ts";
import { extractZ3Tar } from "./z3cache.ts";

// The single integration point with Z3. We emit an SMT-LIB2 script and drive
// the native `z3` CLI over stdin — no Node subprocess, no wasm. Swapping in a
// different verifier backend (a Dafny/Verus CLI) only touches this file and
// smt.ts. z3 is located three ways, in order: an embedded copy extracted from
// the compiled binary; $VECTOR_Z3; a repo-local .z3/ (see `bun run fetch-z3`);
// or `z3` on PATH.

// The whole batch runs in one z3 process, so its wall-clock budget must grow
// with the number of checks — a base plus a per-query allowance, capped so a
// pathological program still can't hang CI.
const SOLVER_BASE_TIMEOUT_MS = 60_000;
const SOLVER_PER_QUERY_MS = 3_000;
const SOLVER_TIMEOUT_CAP_MS = 300_000;

function solverTimeout(queryCount: number): number {
  return Math.min(
    SOLVER_TIMEOUT_CAP_MS,
    SOLVER_BASE_TIMEOUT_MS + queryCount * SOLVER_PER_QUERY_MS,
  );
}

// Set by bin.ts in the compiled binary: the in-executable path of the embedded
// z3 tarball (the `z3` executable + its shared library), which we extract once.
const EMBEDDED_Z3_TAR_GLOBAL = "__VECTOR_Z3_TAR__";

export interface Z3Location {
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

/**
 * z3 outside the compiled binary. A $VECTOR_Z3 that names no file is an
 * error, not a reason to fall back: the user asked for that solver.
 */
export function resolveDevZ3(env: NodeJS.ProcessEnv = process.env): Z3Location {
  const envBin = env.VECTOR_Z3;
  if (envBin) {
    if (!existsSync(envBin)) {
      throw new Error(`VECTOR_Z3 is ${envBin}, which does not exist`);
    }
    return { bin: envBin, libDir: env.VECTOR_Z3_LIB ?? dirname(envBin) };
  }
  const repoZ3 = fileURLToPath(new URL("../../.z3/z3", import.meta.url));
  if (existsSync(repoZ3)) return { bin: repoZ3, libDir: dirname(repoZ3) };
  return { bin: "z3" }; // fall back to PATH; system loader finds libz3
}

// Extract the embedded z3 (executable + shared lib) into a per-user, 0700
// directory, checking every file against the tarball before it is trusted
// (see z3cache.ts).
async function extractEmbeddedZ3(embeddedTarPath: string): Promise<Z3Location> {
  const bytes = new Uint8Array(await Bun.file(embeddedTarPath).arrayBuffer());
  const dest = extractZ3Tar(bytes);
  return { bin: join(dest, "z3"), libDir: dest };
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

export type Z3RunResult =
  | { kind: "answers"; answers: QueryAnswer[]; label: string; millis: number }
  | { kind: "error"; message: string };

/**
 * Run one SMT-LIB2 script (with `@@Q<i>` echo markers, one per query) through
 * z3 and return the per-query answers. This is the whole z3 subprocess story —
 * the verifier and the equivalence differ both feed it their scripts.
 */
export async function runZ3Script(
  script: string,
  queryCount: number,
): Promise<Z3RunResult> {
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
  const timeoutMs = solverTimeout(queryCount);

  return new Promise<Z3RunResult>((resolve) => {
    const started = Date.now();
    const child = spawn(loc.bin, ["-in"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: envWithLib(loc.libDir),
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (result: Z3RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({
        kind: "error",
        message: `z3 timed out after ${timeoutMs} ms`,
      });
    }, timeoutMs);

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
      if (queryCount > 0 && !stdout.includes("@@Q")) {
        finish({
          kind: "error",
          message: `z3 produced no verdicts${stderr ? `: ${stderr.slice(0, 500)}` : ""}`,
        });
        return;
      }
      finish({
        kind: "answers",
        answers: parseZ3Output(stdout, queryCount),
        label,
        millis: Date.now() - started,
      });
    });

    // A z3 that exits without reading all of its input (a wrong binary, a
    // crash at start-up) closes the pipe under us: EPIPE is a solver error,
    // not an uncaught exception.
    child.stdin.on("error", (err: NodeJS.ErrnoException) => {
      finish({
        kind: "error",
        message: `z3 (${loc.bin}) stopped reading its input: ${err.code ?? err.message}${stderr ? `: ${stderr.slice(0, 500)}` : ""}`,
      });
    });
    child.stdin.write(script);
    child.stdin.end();
  });
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

  const { script, queries } = emitVerificationScript(program, numTypes);
  const run = await runZ3Script(script, queries.length);
  if (run.kind === "error") return { kind: "error", message: run.message };

  const report = assembleReport(
    program,
    queries,
    run.answers,
    run.label,
    run.millis,
  );
  // The float64 conformance gate only runs once the proof is otherwise
  // clean — it validates the proof→runtime bridge, not the proof, and would
  // just be noise on an already-refuted report.
  if (report.ok) {
    const seeds: ConformanceSeeds = new Map();
    queries.forEach((q, i) => {
      const answer = run.answers[i];
      if (q.kind !== "reachable" || answer?.result !== "sat") return;
      const point: Record<string, string> = {};
      for (const p of q.params) {
        const value = answer.model[p.smt];
        if (value !== undefined) point[p.orig] = value;
      }
      seeds.set(q.fn, point);
    });
    const conformanceIssues = checkConformance(program, report, seeds);
    if (conformanceIssues.length > 0) {
      report.conformanceIssues = conformanceIssues;
      report.ok = false;
    }
  }
  return { kind: "report", report };
}
