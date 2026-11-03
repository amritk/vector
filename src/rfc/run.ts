// Running a generated test against the implementation, and reading the result
// back in the contract's terms: which requirement each PASS/FAIL line speaks to.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RfcContract } from "./contract.ts";

export type ClauseOutcome = "pass" | "fail" | "skip" | "not-run";

export interface ClauseResult {
  id: string;
  outcome: ClauseOutcome;
  line?: string;
  detail?: string;
}

export interface RunResult {
  /** SATISFIED: every clause passed. VIOLATED: one failed. ERROR: it did not build or finished early. */
  status: "SATISFIED" | "VIOLATED" | "ERROR";
  exitCode: number | null;
  clauses: Map<string, ClauseResult>;
  /** Requirement id → outcome of the clauses that cite it. */
  requirements: Map<string, ClauseOutcome>;
  stdout: string;
  stderr: string;
  /** The compiler that ran it; `nish/…` imports resolve to the std beside it. */
  nish: string;
}

const LINE_RE = /^(PASS|FAIL|SKIP) {2}\[([^\]]+)\]/;

export function parseTestOutput(
  c: RfcContract,
  stdout: string,
): Map<string, ClauseResult> {
  const out = new Map<string, ClauseResult>(
    c.clauses.map((k) => [k.id, { id: k.id, outcome: "not-run" }]),
  );
  const lines = stdout.split("\n");
  lines.forEach((line, i) => {
    const m = line.match(LINE_RE);
    if (!m || !out.has(m[2])) return;
    const outcome =
      m[1] === "PASS" ? "pass" : m[1] === "FAIL" ? "fail" : "skip";
    const next = lines[i + 1] ?? "";
    out.set(m[2], {
      id: m[2],
      outcome,
      line,
      detail:
        outcome === "fail" && next.startsWith("      ")
          ? next.trim()
          : undefined,
    });
  });
  return out;
}

export function judge(
  c: RfcContract,
  clauses: Map<string, ClauseResult>,
  exitCode: number | null,
): Pick<RunResult, "status" | "requirements"> {
  const requirements = new Map<string, ClauseOutcome>();
  const rank: Record<ClauseOutcome, number> = {
    pass: 0,
    skip: 1,
    "not-run": 2,
    fail: 3,
  };
  for (const r of c.requirements) {
    let worst: ClauseOutcome = "pass";
    let any = false;
    for (const k of c.clauses) {
      if (!k.covers.includes(r.id)) continue;
      any = true;
      const o = clauses.get(k.id)?.outcome ?? "not-run";
      if (rank[o] > rank[worst]) worst = o;
    }
    requirements.set(r.id, any ? worst : "not-run");
  }
  const outcomes = [...clauses.values()].map((x) => x.outcome);
  let status: RunResult["status"] = "SATISFIED";
  if (outcomes.includes("fail")) status = "VIOLATED";
  else if (outcomes.some((o) => o !== "pass") || exitCode !== 0)
    status = "ERROR";
  return { status, requirements };
}

/** Compile and run `source` with `nish run`, from a scratch directory. */
export async function runNishTest(
  c: RfcContract,
  source: string,
  nishBin: string,
  timeoutMs = 600_000,
): Promise<RunResult> {
  const dir = mkdtempSync(join(tmpdir(), "vector-rfc-"));
  const file = join(dir, "main.ts");
  writeFileSync(file, source);
  try {
    const { code, stdout, stderr } = await new Promise<{
      code: number | null;
      stdout: string;
      stderr: string;
    }>((resolve) => {
      const child = spawn(nishBin, ["run", file], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
      child.stdout.on("data", (d) => {
        stdout += d;
      });
      child.stderr.on("data", (d) => {
        stderr += d;
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({
          code: null,
          stdout,
          stderr: `${stderr}failed to start ${nishBin}: ${err.message}`,
        });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    });
    const clauses = parseTestOutput(c, stdout);
    return {
      ...judge(c, clauses, code),
      exitCode: code,
      nish: nishBin,
      clauses,
      stdout,
      stderr,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
