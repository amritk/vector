// Running a generated test against the implementation, and reading the result
// back in the contract's terms: which requirement each PASS/FAIL line speaks to.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type RfcContract,
  type VectorClause,
  bytesToHex,
  literalBytes,
} from "./contract.ts";
import type { SourceRun } from "./gates.ts";

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
  /**
   * Why the transcript cannot be trusted, if it cannot: no end line carrying
   * this run's nonce, a clause reported twice, a line that disagrees with
   * what the clause returned. Any entry makes the run an ERROR.
   */
  integrity: string[];
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

/**
 * The line the generated `main` prints after every clause has run and
 * `t.done()` has returned: the nonce it was started with, then one bit per
 * clause in contract order (1 = the clause returned true, 0 = false).
 */
export const END_LINE_RE = /^vector-done (\S+) ([01]*)$/;

/**
 * Check that a transcript is the one the generated test wrote. The module
 * under test runs in the same process and can print anything, so a clause
 * line alone proves nothing: the run must reach the end of `main` (an early
 * `process.exit` leaves no end line), every clause must be reported exactly
 * once and before that line, and each reported outcome must match what the
 * clause itself returned to `main`.
 *
 * The nonce is passed on the command line rather than written into the
 * source, so the build stays cacheable; a module that sets out to read it
 * from argv can still forge a run. This closes the cheap forgeries; the
 * mutation gate (`spec mutate`) is the check that a module isn't gaming it.
 */
export function checkTranscript(
  c: RfcContract,
  stdout: string,
  nonce: string,
  clauses: Map<string, ClauseResult>,
): string[] {
  const problems: string[] = [];
  const lines = stdout.split("\n");
  const ends = lines
    .map((line, i) => ({ i, m: line.match(END_LINE_RE) }))
    .filter((e) => e.m !== null);
  const mine = ends.filter((e) => e.m?.[1] === nonce);
  if (ends.length > mine.length)
    problems.push(
      `${ends.length - mine.length} vector-done line(s) with the wrong nonce: something other than the test's main printed them`,
    );
  if (mine.length === 0) {
    problems.push(
      "the test never reached the end of main (no vector-done line with this run's nonce): it stopped early, or the module exited the process",
    );
    return problems;
  }
  if (mine.length > 1)
    problems.push(`${mine.length} vector-done lines carry this run's nonce`);
  const end = mine[0].i;
  const bits = mine[0].m?.[2] ?? "";

  const ids = new Set(c.clauses.map((k) => k.id));
  const seen = new Map<string, number>();
  lines.forEach((line, i) => {
    const m = line.match(LINE_RE);
    if (!m || !ids.has(m[2])) return;
    seen.set(m[2], (seen.get(m[2]) ?? 0) + 1);
    if (i > end)
      problems.push(`[${m[2]}] reported after the test's main had finished`);
  });
  for (const [id, n] of seen)
    if (n > 1)
      problems.push(`[${id}] reported ${n} times; a clause reports once`);

  if (bits.length !== c.clauses.length) {
    problems.push(
      `the end line records ${bits.length} clause result(s), but the contract has ${c.clauses.length}`,
    );
    return problems;
  }
  c.clauses.forEach((k, i) => {
    const o = clauses.get(k.id)?.outcome ?? "not-run";
    const returned = bits[i] === "1";
    const printed = o === "pass" || o === "skip";
    if (o === "not-run" || returned !== printed)
      problems.push(
        `[${k.id}] returned ${returned} to main, but its line says ${o}`,
      );
  });
  return problems;
}

export function judge(
  c: RfcContract,
  clauses: Map<string, ClauseResult>,
  exitCode: number | null,
  integrity: string[] = [],
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
  if (integrity.length > 0) status = "ERROR";
  else if (outcomes.includes("fail")) status = "VIOLATED";
  else if (outcomes.some((o) => o !== "pass") || exitCode !== 0)
    status = "ERROR";
  return { status, requirements };
}

interface Spawned {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Run a program to completion (or until `timeoutMs`, then SIGKILL). */
function spawnCollect(
  bin: string,
  args: string[],
  timeoutMs: number,
  cwd?: string,
): Promise<Spawned> {
  return new Promise((resolve) => {
    // Its own process group, so a timeout kills what it started too: a
    // grandchild holding stdout open would otherwise outlive the deadline.
    const child = spawn(bin, args, {
      cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-(child.pid as number), "SIGKILL");
      } catch {
        // ESRCH: the whole group already exited; "close" is on its way.
      }
    }, timeoutMs);
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
        stderr: `${stderr}failed to start ${bin}: ${err.message}`,
        timedOut,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

/**
 * Run each vector's `command` source (with `sh -c`, from `cwd`) and compare its
 * trimmed stdout with the expected value: lowercase hex for bytes, the text
 * itself for a string. A timeout, a non-zero exit or a different output fails.
 */
export async function runSourceCommands(
  c: RfcContract,
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<Map<string, SourceRun>> {
  const out = new Map<string, SourceRun>();
  const timeoutMs = opts.timeoutMs ?? 30_000;
  for (const k of c.clauses) {
    if (k.kind !== "vector" || !("command" in k.source)) continue;
    const command = k.source.command;
    const r = await spawnCollect("sh", ["-c", command], timeoutMs, opts.cwd);
    out.set(k.id, { id: k.id, command, ...judgeCommand(k, r, timeoutMs) });
  }
  return out;
}

function judgeCommand(
  k: VectorClause,
  r: Spawned,
  timeoutMs: number,
): Pick<SourceRun, "outcome" | "detail"> {
  if (r.timedOut)
    return { outcome: "fail", detail: `timed out after ${timeoutMs} ms` };
  if (r.code !== 0) {
    const why = r.stderr.trim().split("\n").slice(-1)[0] ?? "";
    return {
      outcome: "fail",
      detail: `exited ${r.code ?? "abnormally"}${why ? ` (${why})` : ""}`,
    };
  }
  const got = r.stdout.trim();
  const bytes = literalBytes(k.expect);
  const want = bytes ? bytesToHex(bytes) : (k.expect as { str: string }).str;
  if ((bytes ? got.toLowerCase() : got) === want) return { outcome: "pass" };
  return {
    outcome: "fail",
    detail: `printed ${JSON.stringify(short(got))}, the vector expects ${JSON.stringify(short(want))}`,
  };
}

const short = (s: string) => (s.length > 80 ? `${s.slice(0, 77)}...` : s);

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
  // A fresh nonce per run, for the end line the test's main prints.
  const nonce = randomBytes(16).toString("hex");
  try {
    const { code, stdout, stderr } = await spawnCollect(
      nishBin,
      ["run", file, nonce],
      timeoutMs,
    );
    const clauses = parseTestOutput(c, stdout);
    const integrity = checkTranscript(c, stdout, nonce, clauses);
    return {
      ...judge(c, clauses, code, integrity),
      exitCode: code,
      nish: nishBin,
      clauses,
      stdout,
      stderr,
      integrity,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
