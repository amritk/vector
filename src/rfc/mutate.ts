// Diff-scoped mutation testing: small, one-at-a-time changes to the lines a
// diff touches, each run against the contract's emitted test in its own
// scratch install. A mutant the test still passes on is behaviour no clause
// pins down.
//
// The operators work on source text, not an AST: a scan marks which characters
// are code (not a string or a comment), and every operator looks only at code.
// A mutant that does not compile is "stillborn" and is not counted.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RfcContract } from "./contract.ts";
import type { LineRange } from "./gitdiff.ts";
import { type RunResult, runNishTest } from "./run.ts";
import { makeScratch } from "./scratch.ts";

export type Operator =
  | "relational"
  | "int-literal"
  | "logical"
  | "drop-not"
  | "delete-statement"
  | "return-null";

export interface Mutant {
  /** `<line>:<column>:<operator>[:<variant>]`, stable for one source. */
  id: string;
  operator: Operator;
  /** 1-based line and column of the change. */
  line: number;
  column: number;
  /** The line before and after the change. */
  original: string;
  mutated: string;
}

// ---------------------------------------------------------------------------
// Which characters are code

/** What each character of a source is: code, string or template text, or a comment. */
export const COMMENT = 0;
export const CODE = 1;
export const STRING = 2;

/**
 * The kind of each index of `src`: CODE, STRING (a string or a template
 * literal's text, quotes included) or COMMENT. Template `${…}` expressions are
 * code. Whitespace between tokens is CODE.
 */
export function sourceKinds(src: string): Uint8Array {
  return scanSource(src).kinds;
}

/**
 * sourceKinds, plus `nested`: 1 at each index the scan reached while a
 * template literal was open (in its text or in one of its `${…}`).
 */
function scanSource(src: string): { kinds: Uint8Array; nested: Uint8Array } {
  const kinds = new Uint8Array(src.length);
  const nested = new Uint8Array(src.length);
  const mark = (from: number, to: number, k: number) =>
    kinds.fill(k, from, Math.min(to, src.length));
  // A stack of open template literals; each entry is the brace depth its
  // current `${` started at, or -1 while in the template's text.
  const templates: number[] = [];
  let depth = 0;
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (templates.length > 0) nested[i] = 1;
    const inText = templates.at(-1) === -1;
    if (inText) {
      if (c === "\\") {
        mark(i, i + 2, STRING);
        i += 2;
      } else if (c === "`") {
        templates.pop();
        mark(i, i + 1, STRING);
        i++;
      } else if (c === "$" && src[i + 1] === "{") {
        templates[templates.length - 1] = depth;
        depth++;
        mark(i, i + 2, STRING);
        i += 2;
      } else {
        mark(i, i + 1, STRING);
        i++;
      }
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      const from = i;
      while (i < src.length && src[i] !== "\n") i++;
      mark(from, i, COMMENT);
    } else if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const to = end === -1 ? src.length : end + 2;
      mark(i, to, COMMENT);
      i = to;
    } else if (c === '"' || c === "'") {
      const from = i;
      i++;
      while (i < src.length && src[i] !== c && src[i] !== "\n") {
        i += src[i] === "\\" ? 2 : 1;
      }
      i++;
      mark(from, i, STRING);
    } else if (c === "`") {
      templates.push(-1);
      mark(i, i + 1, STRING);
      i++;
    } else {
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (templates.at(-1) === depth) {
          templates[templates.length - 1] = -1;
          mark(i, i + 1, STRING);
          i++;
          continue;
        }
      }
      kinds[i] = CODE;
      i++;
    }
  }
  return { kinds, nested };
}

/**
 * `true` at each index of `src` that is code: not inside a string, a template
 * literal's text, or a comment. Template `${…}` expressions are code.
 */
export function codeMask(src: string): boolean[] {
  return Array.from(sourceKinds(src), (k) => k === CODE);
}

/**
 * Each line of `src` twice over: `code` with every non-code character a space,
 * and `expr` with comments spaces but each string or template character `_`,
 * so a line that ends in a string ends in an operand, not in the `=` or `(`
 * before it. `plain`: the line starts and ends outside every string, template
 * (text or `${…}`) and block comment, so it can be deleted or replaced whole.
 */
export function maskLines(
  src: string,
): { code: string; expr: string; plain: boolean }[] {
  const { kinds, nested } = scanSource(src);
  // A line boundary outside every string, template and comment: the start
  // or end of `src`, or a newline that is code with no template open.
  const free = (i: number) =>
    i < 0 || i >= src.length || (kinds[i] === CODE && nested[i] === 0);
  const out: { code: string; expr: string; plain: boolean }[] = [];
  let at = 0;
  for (const text of src.split("\n")) {
    let code = "";
    let expr = "";
    for (let j = 0; j < text.length; j++) {
      const k = kinds[at + j];
      code += k === CODE ? text[j] : " ";
      expr += k === CODE ? text[j] : k === STRING ? "_" : " ";
    }
    out.push({ code, expr, plain: free(at - 1) && free(at + text.length) });
    at += text.length + 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The operators

const FLIP: Record<string, string> = {
  "<": "<=",
  "<=": "<",
  ">": ">=",
  ">=": ">",
  "==": "!=",
  "!=": "==",
  "===": "!==",
  "!==": "===",
  "&&": "||",
  "||": "&&",
};
const OP_CHARS = "<>=!&|";
const IDENT = /[A-Za-z0-9_$]/;
/** A line that starts like this continues the previous one. */
const CONTINUES = /^[.?:|&+\-*/%,)\]}=<>^]/;
/** A line that ends like this continues on the next one. */
const OPEN_END = /(?:[.?:|&+\-*/%,([{=<>^!]|=>)$/;
const NOT_STATEMENT =
  /^(?:const|let|var|function|export|import|type|interface|class|if|else|for|while|do|switch|case|default|try|catch|finally|return)\b/;

const BRACELESS_HEAD =
  /^(?:\}\s*)?(?:else(?:\s+if\s*\(.*\))?|(?:if|for|while)\s*\(.*\)|do)$/;

interface Line {
  /** 1-based number. */
  n: number;
  text: string;
  /** The line with every non-code character replaced by a space. */
  code: string;
  /** The line with comments spaces and string characters `_` (see maskLines). */
  expr: string;
  /** Starts and ends outside every string, template and comment (see maskLines). */
  plain: boolean;
}

function splitLines(src: string): Line[] {
  const masks = maskLines(src);
  return src.split("\n").map((text, k) => ({ n: k + 1, text, ...masks[k] }));
}

const balanced = (code: string): boolean => {
  let d = 0;
  for (const c of code) {
    if ("([{".includes(c)) d++;
    else if (")]}".includes(c) && --d < 0) return false;
  }
  return d === 0;
};

const splice = (s: string, col: number, len: number, by: string): string =>
  s.slice(0, col) + by + s.slice(col + len);

function relationalAndLogical(l: Line, push: Push): void {
  const { code } = l;
  let j = 0;
  while (j < code.length) {
    if (!OP_CHARS.includes(code[j])) {
      j++;
      continue;
    }
    let k = j;
    while (k < code.length && OP_CHARS.includes(code[k])) k++;
    const tok = code.slice(j, k);
    const before = code[j - 1];
    const after = code[k];
    // Only space-surrounded binary operators are flipped, so what mutates
    // depends on the source being formatted (nish's std is).
    const spaced = before === " " && after === " ";
    if (spaced && tok in FLIP) {
      const op = tok === "&&" || tok === "||" ? "logical" : "relational";
      push(op, j, splice(l.text, j, tok.length, FLIP[tok]));
    } else if (
      tok === "!" &&
      (before === undefined || !IDENT.test(before)) &&
      before !== ")" &&
      before !== "]" &&
      after !== undefined &&
      /[A-Za-z_$(]/.test(after)
    ) {
      push("drop-not", j, splice(l.text, j, 1, ""));
    }
    j = k;
  }
}

function intLiterals(l: Line, push: Push): void {
  for (const m of l.code.matchAll(/\d+/g)) {
    const j = m.index ?? 0;
    const end = j + m[0].length;
    const before = l.code[j - 1] ?? "";
    const after = l.code[end] ?? "";
    if (IDENT.test(before) || before === ".") continue;
    if (IDENT.test(after) || after === ".") continue;
    const n = BigInt(m[0]);
    for (const [v, by] of [
      ["plus", n + 1n],
      ["minus", n - 1n],
    ] as const) {
      push("int-literal", j, splice(l.text, j, m[0].length, String(by)), v);
    }
  }
}

/** Whether the next line with code carries on line `k`'s expression. */
function nextContinues(lines: Line[], k: number): boolean {
  const next = lines
    .slice(k + 1)
    .find((p) => p.expr.trim() !== "")
    ?.expr.trim();
  return next !== undefined && CONTINUES.test(next) && !next.startsWith("}");
}

function deleteStatement(lines: Line[], k: number, push: Push): void {
  const l = lines[k];
  // A line that starts or ends inside a template, string or comment is part
  // of a literal, not a statement.
  if (!l.plain) return;
  const code = l.expr.trim();
  if (code === "" || NOT_STATEMENT.test(code) || CONTINUES.test(code)) return;
  if (OPEN_END.test(code) || !balanced(code)) return;
  const prev = lines
    .slice(0, k)
    .reverse()
    .find((p) => p.expr.trim() !== "");
  const p = prev?.expr.trim() ?? "";
  if (!p.endsWith("{") && OPEN_END.test(p)) return;
  // The body of a braceless `if (…)`/`else`/loop: deleting it would make the
  // next statement the body, which is a second change.
  if (BRACELESS_HEAD.test(p)) return;
  if (nextContinues(lines, k)) return;
  push("delete-statement", l.code.search(/\S/), "");
}

/** Lines whose `{` is still open at each line, innermost last. */
function openers(lines: Line[]): number[][] {
  const stack: number[] = [];
  return lines.map((l) => {
    const here = [...stack];
    for (const c of l.code) {
      if (c === "{") stack.push(l.n - 1);
      else if (c === "}") stack.pop();
    }
    return here;
  });
}

/** `): u8[] | null => {` or `): T | null {` → whether the declared return type admits null. */
function headerAdmitsNull(code: string): boolean | undefined {
  const m = code.trimEnd().match(/\)\s*:\s*(.+?)\s*(?:=>\s*)?\{$/);
  if (!m) return undefined;
  return /(?:^|\|)\s*null\s*(?:\||$)/.test(m[1]) || /\?$/.test(m[1].trim());
}

function returnNull(
  lines: Line[],
  k: number,
  open: number[][],
  push: Push,
): void {
  const l = lines[k];
  // `return \`…` whose template runs on: replacing it would leave the rest of
  // the template as code.
  if (!l.plain) return;
  // Matched on `expr`, where a string is part of the expression and a comment
  // is not, then spliced into the raw text at the same columns.
  const m = l.expr.match(/^(\s*return\s+)(\S.*?)\s*;?\s*$/);
  if (!m || m[2] === "null" || !balanced(m[2]) || OPEN_END.test(m[2])) return;
  // Only the expression is replaced: a `;` or a comment after it stays.
  const at = m[1].length;
  if (nextContinues(lines, k)) return;
  for (const o of [...open[k]].reverse()) {
    const head = lines[o].code.trimEnd();
    const admits = headerAdmitsNull(head);
    if (admits === undefined) {
      // An unannotated function: its return type is not written down, so
      // whether it admits null is unknown. Any other block: look further out.
      if (/=>\s*\{$|\bfunction\b/.test(head)) return;
      continue;
    }
    if (admits)
      push("return-null", at, splice(l.text, at, m[2].length, "null"));
    return;
  }
}

type Push = (
  op: Operator,
  column: number,
  mutated: string,
  variant?: string,
) => void;

const within = (n: number, ranges: LineRange[]): boolean =>
  ranges.some(([a, b]) => n >= a && n <= b);

/**
 * Every mutant of `src` on a line inside `ranges`, in line order. Each changes
 * one thing on one line; strings and comments are never touched.
 */
export function generateMutants(src: string, ranges: LineRange[]): Mutant[] {
  const lines = splitLines(src);
  const open = openers(lines);
  const out: Mutant[] = [];
  for (const [k, l] of lines.entries()) {
    if (!within(l.n, ranges)) continue;
    const push: Push = (operator, column, mutated, variant) => {
      if (mutated === l.text) return;
      out.push({
        id: `${l.n}:${column + 1}:${operator}${variant ? `:${variant}` : ""}`,
        operator,
        line: l.n,
        column: column + 1,
        original: l.text,
        mutated,
      });
    };
    relationalAndLogical(l, push);
    intLiterals(l, push);
    deleteStatement(lines, k, push);
    returnNull(lines, k, open, push);
  }
  return out.sort((a, b) => a.line - b.line || a.column - b.column);
}

/** `src` with the mutant's line replaced. */
export function applyMutant(src: string, m: Mutant): string {
  const lines = src.split("\n");
  if (lines[m.line - 1] !== m.original)
    throw new Error(
      `mutant ${m.id}: line ${m.line} is not the line it was made from`,
    );
  lines[m.line - 1] = m.mutated;
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Running them

export type MutantOutcome = "killed" | "survived" | "stillborn" | "timeout";

export interface AllowedSurvivor {
  file: string;
  line: number;
  reason: string;
}

export interface MutantResult {
  mutant: Mutant;
  outcome: MutantOutcome;
  /** The first failing clause, a runtime error, or the compile diagnostic. */
  detail?: string;
  /** For a survivor: the allowSurvivors reason that covers it. */
  allowed?: string;
}

export interface MutationReport {
  file: string;
  /** Mutants the operators generated, before `max`. */
  generated: number;
  results: MutantResult[];
  counts: Record<MutantOutcome, number>;
  /** Survivors no allowSurvivors entry covers. */
  survivors: MutantResult[];
  /** allowSurvivors entries that matched no survivor, whatever their file. */
  unusedAllowances: AllowedSurvivor[];
}

/** One run of the test against the module with `contents` in place. */
export interface ExecResult {
  run: RunResult;
  /** The test built and its binary was started: anything after is the test's doing. */
  started: boolean;
  /** The test ran past the time limit and was killed. */
  timedOut: boolean;
  /**
   * The paths, as the compiler names them, of the files this run put there:
   * the mutated module and the test. Only a diagnostic in one of them is the
   * mutant's doing.
   */
  sources: string[];
}
export type Exec = (contents: string) => Promise<ExecResult>;

export class MutationRunError extends Error {}

/** `std/x.ts:12:3: error: …` or `…: syntax error: …`: the compiler refused it. */
const DIAGNOSTIC_RE = /^(\S+):\d+:\d+: (?:[a-z]+ )?error: .*/;

/**
 * The first compile diagnostic in `stderr` when every line that reports an
 * error is a diagnostic in one of `sources`; null when there is none, or when
 * anything else reported an error too (a C toolchain's `runtime/x.c:1:10:
 * fatal error: …`, `clang: error: …`): that failure is not the mutant's.
 * Indented lines are the compiler quoting source, not reports.
 */
function mutantDiagnostic(stderr: string, sources: string[]): string | null {
  let first: string | null = null;
  for (const line of stderr.split("\n")) {
    if (/^\s/.test(line) || !/\berror\b/.test(line)) continue;
    if (/^\d+ errors?$/.test(line)) continue; // nish's closing count
    const m = line.match(DIAGNOSTIC_RE);
    if (!m || !sources.includes(m[1])) return null;
    first ??= m[0];
  }
  return first;
}

/**
 * A run that never started its test binary is stillborn when nish printed a
 * compile diagnostic in the mutated module or the test and nothing else
 * reported an error, and an error otherwise (nish or the linker failed, the
 * build hung or was killed): no mutant is counted on a run that did not run.
 * Once started: timeout past the limit; survived when every clause passed;
 * killed on a failed clause or a non-zero exit (a panic). A null exit (the
 * runner itself was killed) or exit 0 without a verdict on every clause throws.
 */
export function classify(r: ExecResult): {
  outcome: MutantOutcome;
  detail?: string;
} {
  const { run } = r;
  const stderr = run.stderr.trim();
  const clauses = [...run.clauses.values()];
  if (!r.started) {
    const diag = mutantDiagnostic(stderr, r.sources);
    const ran = clauses.some((c) => c.outcome !== "not-run");
    if (diag && !ran && run.exitCode !== null && run.exitCode !== 0)
      return { outcome: "stillborn", detail: diag };
    throw new MutationRunError(
      `the test never started (exit ${run.exitCode ?? "on a signal"}): ${stderr || "(no output)"}`,
    );
  }
  if (r.timedOut) return { outcome: "timeout" };
  if (run.exitCode === null)
    throw new MutationRunError(
      `the run was killed before it finished: ${stderr || "(no output)"}`,
    );
  if (run.status === "SATISFIED") return { outcome: "survived" };
  const failed = clauses.find((c) => c.outcome === "fail");
  if (failed) return { outcome: "killed", detail: failed.line };
  if (run.exitCode !== 0)
    return {
      outcome: "killed",
      detail: stderr.split("\n")[0] || `exit ${run.exitCode}`,
    };
  throw new MutationRunError(
    `the test exited 0 without a verdict on every clause: ${stderr || "(no output)"}`,
  );
}

/** Up to `max` of `xs`, spread evenly over them, in order. */
export function spread<T>(xs: T[], max: number | undefined): T[] {
  if (max === undefined || max >= xs.length) return xs;
  return Array.from(
    { length: max },
    (_, k) => xs[Math.floor((k * xs.length) / max)],
  );
}

async function pool<T, R>(
  xs: T[],
  jobs: number,
  f: (x: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(xs.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    // After one job throws, the others take no more.
    while (!failed && next < xs.length) {
      const k = next++;
      try {
        out[k] = await f(xs[k]);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  // Every job in flight finishes (and cleans up its scratch install) before
  // the first error is rethrown.
  const settled = await Promise.allSettled(
    Array.from({ length: Math.min(jobs, xs.length) }, worker),
  );
  const err = settled.find((x) => x.status === "rejected");
  if (err) throw (err as PromiseRejectedResult).reason;
  return out;
}

export interface RunMutantsOptions {
  contract: RfcContract;
  /** The emitted test (emitNishTest), run unchanged against every mutant. */
  test: string;
  /** The nish checkout; each run is a scratch install of it. */
  nishRoot: string;
  /** The module under test, relative to nishRoot (`std/crypto/hkdf.ts`). */
  modulePath: string;
  /** Its source as the diff leaves it. */
  source: string;
  /** Changed lines of the module (from gitdiff); mutants stay inside them. */
  ranges: LineRange[];
  /** Run these instead of every generated mutant (each must be one generateMutants made). */
  mutants?: Mutant[];
  jobs?: number;
  /** At most this many mutants, spread over the module. */
  max?: number;
  timeoutMs?: number;
  allowSurvivors?: AllowedSurvivor[];
  /** The seam for tests: runs the test with the module's contents replaced. */
  exec?: Exec;
}

const WATCHDOG_GRACE_MS = 10_000;

/**
 * A script that stands in for `nish` as run.ts calls it (`run <file>`) and does
 * it in two steps, each in its own process group and each with `ms` to finish:
 * leave `<file>`'s path in `testPath`, build the test with
 * `nish <file> --link <bin>`, then, only if that worked, run `<bin>` and leave
 * `started` behind once it has started (not when it fails to: a missing or
 * non-executable binary exits 127 and never ran). A run past its time is killed as a
 * group (a looping mutant's children would otherwise hold the output pipes
 * open) and leaves `timedOut` behind. A build that fails prints its output and
 * exits with its code; one that hangs exits 125. Neither leaves `started`, so a
 * run that never ran is never mistaken for the test failing.
 */
function watchdog(o: {
  nish: string;
  bin: string;
  ms: number;
  started: string;
  timedOut: string;
  testPath: string;
}): string {
  const j = JSON.stringify;
  return `#!${process.execPath}
const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const { signals } = require("node:os").constants;
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "run") {
  console.error("vector-watchdog: expected run <file>, got " + args.join(" "));
  process.exit(125);
}
writeFileSync(${j(o.testPath)}, args[1]);
const status = (code, signal) => code ?? 128 + (signals[signal] ?? 0);
const killGroup = (child) => {
  try {
    process.kill(-child.pid, "SIGKILL");
    return true;
  } catch {
    return false; // the group is already gone
  }
};
const start = (cmd, argv, stdio) => {
  const child = spawn(cmd, argv, { stdio, detached: true });
  child.on("error", (err) => {
    console.error("failed to start " + cmd + ": " + err.message);
    process.exit(127);
  });
  return child;
};
const build = start(${j(o.nish)}, [args[1], "--link", ${j(o.bin)}], ["ignore", "pipe", "pipe"]);
let out = "";
build.stdout.on("data", (d) => { out += d; });
build.stderr.on("data", (d) => { out += d; });
const buildTimer = setTimeout(() => {
  killGroup(build);
  console.error(out + "vector-watchdog: the build took longer than ${o.ms} ms");
  process.exit(125);
}, ${o.ms});
build.on("close", (code, signal) => {
  clearTimeout(buildTimer);
  if (code !== 0) {
    process.stderr.write(out);
    process.exit(status(code, signal) || 125);
  }
  const test = start(${j(o.bin)}, [], "inherit");
  test.on("spawn", () => writeFileSync(${j(o.started)}, ""));
  const timer = setTimeout(() => {
    if (killGroup(test)) writeFileSync(${j(o.timedOut)}, "");
  }, ${o.ms});
  test.on("exit", (code, signal) => {
    clearTimeout(timer);
    killGroup(test);
    process.exit(status(code, signal));
  });
});
`;
}

/** The default exec: a fresh scratch install per run, removed after. */
export function scratchExec(o: {
  contract: RfcContract;
  test: string;
  nishRoot: string;
  modulePath: string;
  timeoutMs: number;
}): Exec {
  return async (contents) => {
    const s = makeScratch({
      nishRoot: o.nishRoot,
      overrides: { [o.modulePath]: contents },
    });
    try {
      const started = join(s.dir, "vector-started");
      const timedOut = join(s.dir, "vector-timed-out");
      const testPath = join(s.dir, "vector-test-path");
      const bin = join(s.dir, "vector-watchdog");
      writeFileSync(
        bin,
        watchdog({
          nish: s.nish,
          bin: join(s.dir, "vector-test"),
          ms: o.timeoutMs,
          started,
          timedOut,
          testPath,
        }),
        { mode: 0o755 },
      );
      // run.ts's own kill is the backstop, past both of the watchdog's limits.
      const run = await runNishTest(
        o.contract,
        o.test,
        bin,
        2 * o.timeoutMs + WATCHDOG_GRACE_MS,
      );
      return {
        run: { ...run, nish: s.nish },
        started: existsSync(started),
        timedOut: existsSync(timedOut),
        sources: [
          o.modulePath,
          ...(existsSync(testPath) ? [readFileSync(testPath, "utf8")] : []),
        ],
      };
    } finally {
      s.dispose();
    }
  };
}

/**
 * Runs the unmutated module first and throws unless the test passes on it,
 * since a test that fails on the original kills every mutant and proves
 * nothing. Then runs each mutant, `jobs` at a time.
 */
export async function runMutants(
  o: RunMutantsOptions,
): Promise<MutationReport> {
  const positive = (name: string, v: number | undefined) => {
    if (v !== undefined && !(Number.isInteger(v) && v > 0))
      throw new MutationRunError(
        `${name} must be a positive integer, not ${v}`,
      );
  };
  positive("jobs", o.jobs);
  positive("max", o.max);
  positive("timeoutMs", o.timeoutMs);
  for (const a of o.allowSurvivors ?? [])
    if (a.reason.trim() === "")
      throw new MutationRunError(
        `the allowance for ${a.file}:${a.line} gives no reason`,
      );
  const timeoutMs = o.timeoutMs ?? 120_000;
  const exec = o.exec ?? scratchExec({ ...o, timeoutMs });
  const all = generateMutants(o.source, o.ranges);
  let chosen = all;
  if (o.mutants) {
    const key = (m: Mutant) => `${m.id}\n${m.original}\n${m.mutated}`;
    const made = new Set(all.map(key));
    const foreign = o.mutants.find((m) => !made.has(key(m)));
    if (foreign)
      throw new MutationRunError(
        `mutant ${foreign.id} is not one this source and these ranges make`,
      );
    chosen = o.mutants;
  }
  chosen = spread(chosen, o.max);
  // Nothing to mutate proves nothing: a gate that runs no mutant must not pass.
  if (chosen.length === 0)
    throw new MutationRunError(
      `no mutants in the changed lines of ${o.modulePath}`,
    );

  const base = await exec(o.source);
  if (!base.started || base.timedOut || base.run.status !== "SATISFIED")
    throw new MutationRunError(
      `the test does not pass on the unmutated ${o.modulePath} (${!base.started ? "never started" : base.timedOut ? "timeout" : base.run.status}), so no mutant can be judged: ${base.run.stderr.trim().split("\n")[0]}`,
    );

  const results = await pool(chosen, o.jobs ?? 1, async (mutant) => {
    const c = classify(await exec(applyMutant(o.source, mutant)));
    return { mutant, ...c } as MutantResult;
  });

  const allow = o.allowSurvivors ?? [];
  const used = new Set<AllowedSurvivor>();
  for (const r of results) {
    if (r.outcome !== "survived") continue;
    const a = allow.find(
      (x) => x.file === o.modulePath && x.line === r.mutant.line,
    );
    if (a) {
      r.allowed = a.reason;
      used.add(a);
    }
  }
  const counts: Record<MutantOutcome, number> = {
    killed: 0,
    survived: 0,
    stillborn: 0,
    timeout: 0,
  };
  for (const r of results) counts[r.outcome]++;
  return {
    file: o.modulePath,
    generated: all.length,
    results,
    counts,
    survivors: results.filter((r) => r.outcome === "survived" && !r.allowed),
    unusedAllowances: allow.filter((a) => !used.has(a)),
  };
}
