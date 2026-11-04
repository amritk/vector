// Diff-scoped mutation testing: small, one-at-a-time changes to the lines a
// diff touches, each run against the contract's emitted test in its own
// scratch install. A mutant the test still passes on is behaviour no clause
// pins down.
//
// The operators work on source text, not an AST: a scan marks which characters
// are code (not a string or a comment), and every operator looks only at code.
// A mutant that does not compile is "stillborn" and is not counted.

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

/**
 * `true` at each index of `src` that is code: not inside a string, a template
 * literal's text, or a comment. Template `${…}` expressions are code.
 */
export function codeMask(src: string): boolean[] {
  const mask = new Array<boolean>(src.length).fill(false);
  // A stack of open template literals; each entry is the brace depth its
  // current `${` started at, or -1 while in the template's text.
  const templates: number[] = [];
  let depth = 0;
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const inText = templates.length > 0 && templates.at(-1) === -1;
    if (inText) {
      if (c === "\\") i += 2;
      else if (c === "`") {
        templates.pop();
        i++;
      } else if (c === "$" && src[i + 1] === "{") {
        templates[templates.length - 1] = depth;
        depth++;
        i += 2;
      } else i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
    } else if (c === '"' || c === "'") {
      i++;
      while (i < src.length && src[i] !== c && src[i] !== "\n") {
        i += src[i] === "\\" ? 2 : 1;
      }
      i++;
    } else if (c === "`") {
      templates.push(-1);
      i++;
    } else {
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (templates.length > 0 && templates.at(-1) === depth) {
          templates[templates.length - 1] = -1;
          i++;
          continue;
        }
      }
      mask[i] = true;
      i++;
    }
  }
  return mask;
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

interface Line {
  /** 1-based number. */
  n: number;
  text: string;
  /** The line with every non-code character replaced by a space. */
  code: string;
}

function splitLines(src: string, mask: boolean[]): Line[] {
  const out: Line[] = [];
  let at = 0;
  for (const [k, text] of src.split("\n").entries()) {
    let code = "";
    for (let j = 0; j < text.length; j++) code += mask[at + j] ? text[j] : " ";
    out.push({ n: k + 1, text, code });
    at += text.length + 1;
  }
  return out;
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
    .find((p) => p.code.trim() !== "")
    ?.code.trim();
  return next !== undefined && CONTINUES.test(next) && !next.startsWith("}");
}

function deleteStatement(lines: Line[], k: number, push: Push): void {
  const l = lines[k];
  const code = l.code.trim();
  if (code === "" || NOT_STATEMENT.test(code) || CONTINUES.test(code)) return;
  if (OPEN_END.test(code) || !balanced(code)) return;
  const prev = lines
    .slice(0, k)
    .reverse()
    .find((p) => p.code.trim() !== "");
  const p = prev?.code.trim() ?? "";
  if (!p.endsWith("{") && OPEN_END.test(p)) return;
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
  const m = l.code.match(/^(\s*)return\s+(\S.*?)\s*;?\s*$/);
  if (!m || m[2] === "null" || !balanced(m[2]) || OPEN_END.test(m[2])) return;
  if (nextContinues(lines, k)) return;
  for (const o of [...open[k]].reverse()) {
    const admits = headerAdmitsNull(lines[o].code);
    if (admits === undefined) continue;
    if (admits) push("return-null", m[1].length, `${m[1]}return null`);
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
  const lines = splitLines(src, codeMask(src));
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
  /** allowSurvivors entries for this file that matched no survivor. */
  unusedAllowances: AllowedSurvivor[];
}

/** One run of the test against the module with `contents` in place. */
export interface ExecResult {
  run: RunResult;
  timedOut: boolean;
}
export type Exec = (contents: string) => Promise<ExecResult>;

export class MutationRunError extends Error {}

/** `std/x.ts:12:3: error: …` or `…: syntax error: …`: the compiler refused it. */
const DIAGNOSTIC_RE = /^\S+:\d+:\d+: (?:[a-z]+ )?error: .*/m;

/**
 * killed: the test fails, or it exits non-zero or on a signal (a panic before
 * or after the first clause). survived: it passes. stillborn: nothing ran and
 * nish printed a compile diagnostic. Anything else (the binary did not start,
 * or the test exited 0 without a verdict on every clause) throws.
 */
export function classify(r: ExecResult): {
  outcome: MutantOutcome;
  detail?: string;
} {
  if (r.timedOut) return { outcome: "timeout" };
  const { run } = r;
  if (run.status === "SATISFIED") return { outcome: "survived" };
  const clauses = [...run.clauses.values()];
  const failed = clauses.find((c) => c.outcome === "fail");
  if (failed) return { outcome: "killed", detail: failed.line };
  const stderr = run.stderr.trim();
  if (run.exitCode === null && stderr.includes(`failed to start ${run.nish}`))
    throw new MutationRunError(stderr);
  const ran = clauses.some((c) => c.outcome !== "not-run");
  const diag = ran ? null : stderr.match(DIAGNOSTIC_RE);
  if (diag && run.exitCode !== 0)
    return { outcome: "stillborn", detail: diag[0] };
  if (run.exitCode !== 0)
    return {
      outcome: "killed",
      detail: stderr.split("\n")[0] || `exit ${run.exitCode ?? "on a signal"}`,
    };
  throw new MutationRunError(
    `the test exited 0 without a verdict on every clause: ${stderr || "(no output)"}`,
  );
}

/** Up to `max` of `xs`, spread evenly over them, in order. */
export function spread<T>(xs: T[], max: number | undefined): T[] {
  if (max === undefined || max >= xs.length) return xs;
  if (max <= 0) return [];
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
  const worker = async () => {
    while (next < xs.length) {
      const k = next++;
      out[k] = await f(xs[k]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(jobs, xs.length)) }, worker),
  );
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
      const t0 = Date.now();
      const run = await runNishTest(o.contract, o.test, s.nish, o.timeoutMs);
      const timedOut = run.exitCode === null && Date.now() - t0 >= o.timeoutMs;
      return { run, timedOut };
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
  const timeoutMs = o.timeoutMs ?? 120_000;
  const exec = o.exec ?? scratchExec({ ...o, timeoutMs });
  const all = generateMutants(o.source, o.ranges);
  let chosen = all;
  if (o.mutants) {
    const made = new Set(
      all.map((m) => `${m.id}\n${m.original}\n${m.mutated}`),
    );
    const foreign = o.mutants.find(
      (m) => !made.has(`${m.id}\n${m.original}\n${m.mutated}`),
    );
    if (foreign)
      throw new MutationRunError(
        `mutant ${foreign.id} is not one this source and these ranges make`,
      );
    chosen = o.mutants;
  }
  chosen = spread(chosen, o.max);

  const base = await exec(o.source);
  if (base.timedOut || base.run.status !== "SATISFIED")
    throw new MutationRunError(
      `the test does not pass on the unmutated ${o.modulePath} (${base.timedOut ? "timeout" : base.run.status}), so no mutant can be judged: ${base.run.stderr.trim().split("\n")[0]}`,
    );

  const results = await pool(chosen, o.jobs ?? 1, async (mutant) => {
    const c = classify(await exec(applyMutant(o.source, mutant)));
    return { mutant, ...c } as MutantResult;
  });

  const allow = (o.allowSurvivors ?? []).filter((a) => a.file === o.modulePath);
  const used = new Set<AllowedSurvivor>();
  for (const r of results) {
    if (r.outcome !== "survived") continue;
    const a = allow.find((x) => x.line === r.mutant.line);
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
