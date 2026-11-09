// Turning a property's domain into concrete samples the generated test runs.
//
// A test cannot quantify over every input, so where the samples come from is
// the whole question. Two sources, both deterministic:
//
//   boundaries  Z3 solves for inputs that sit exactly on, and one either side
//               of, every integer comparison in the property (`n <= 8160`
//               yields n = 8159, 8160, 8161), and for each variable's extremes
//               — always inside the domain and `where`. These are the inputs an
//               RFC's limits are about, found by the solver rather than guessed.
//   random      a seeded PRNG, biased toward both ends of each range.
//
// Z3 also decides non-vacuity: a property whose domain is empty passes on every
// implementation, so it is refused (a concrete witness also counts).

import { runZ3Script } from "../solve/runner.ts";
import { SMT_PREAMBLE } from "../solve/smt.ts";
import {
  type Expr,
  type PropertyClause,
  type RfcContract,
  type Var,
  alphabetChars,
} from "./contract.ts";

export type Value = Uint8Array | string | number | boolean | null;
export type Sample = Record<string, Uint8Array | string | number>;

export interface PropertySamples {
  clauseId: string;
  samples: Sample[];
  boundary: number;
  random: number;
  /** How non-vacuity was established, or "failed". */
  inhabited: "z3" | "witness" | "failed";
  notes: string[];
}

export interface SamplingResult {
  ok: boolean;
  issues: { at: string; message: string }[];
  properties: Map<string, PropertySamples>;
  solver?: string;
}

const DEFAULT_RANDOM = 24;
const MAX_SAMPLES = 96;

// ── A seeded PRNG ─────────────────────────────────────────────────────────

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function prng(seed: string): () => number {
  let a = fnv1a(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const intIn = (rnd: () => number, lo: number, hi: number) =>
  lo + Math.floor(rnd() * (hi - lo + 1));

/** Uniform half the time, otherwise within 16 of one end. */
function biasedInt(rnd: () => number, lo: number, hi: number): number {
  const r = rnd();
  if (r < 0.5 || hi - lo < 32) return intIn(rnd, lo, hi);
  if (r < 0.75) return intIn(rnd, lo, lo + 16);
  return intIn(rnd, hi - 16, hi);
}

function randomBytes(rnd: () => number, n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.floor(rnd() * 256);
  return out;
}

function randomString(rnd: () => number, chars: string[], n: number): string {
  let out = "";
  for (let i = 0; i < n; i++) out += chars[Math.floor(rnd() * chars.length)];
  return out;
}

/** ASCII case mapping; every other byte is kept (strings here are ASCII). */
const mapCase = (s: string, from: RegExp, delta: number) =>
  s.replace(from, (ch) => String.fromCharCode(ch.charCodeAt(0) + delta));

// ── A pure evaluator, for `where` ─────────────────────────────────────────

class Undefined extends Error {}

/**
 * Evaluate a call-free expression. Throws Undefined on unwrap(null). A `let`
 * evaluates every binding before its `in`, as the emitted test does.
 */
export function evalPure(e: Expr, env: Record<string, Value>): Value {
  if ("let" in e) {
    // No prototype, so a binding named __proto__ is an ordinary key.
    const scope: Record<string, Value> = Object.assign(
      Object.create(null),
      env,
    );
    for (const b of e.let) scope[b.name] = evalPure(b.value, scope);
    return evalPure(e.in, scope);
  }
  if ("hex" in e) {
    const one = Uint8Array.from(Buffer.from(e.hex, "hex"));
    const n = e.repeat ?? 1;
    const out = new Uint8Array(one.length * n);
    for (let i = 0; i < n; i++) out.set(one, i * one.length);
    return out;
  }
  if ("ascii" in e) return new TextEncoder().encode(e.ascii);
  if ("str" in e) return e.str;
  if ("int" in e) return e.int;
  if ("bool" in e) return e.bool;
  if ("null" in e) return null;
  if ("concat" in e) {
    const parts = e.concat.map((p) => evalPure(p, env) as Uint8Array);
    return Uint8Array.from(parts.flatMap((p) => [...p]));
  }
  if ("var" in e) return env[e.var] ?? null;
  if ("call" in e) throw new Error("evalPure: calls are not pure");
  const a = e.args.map((x) => () => evalPure(x, env));
  const n = (i: number) => a[i]() as number;
  const b = (i: number) => a[i]() as Uint8Array;
  const s = (i: number) => a[i]() as string;
  const t = (i: number) => a[i]() as boolean;
  switch (e.op) {
    case "len":
      return b(0).length;
    case "concat":
      return Uint8Array.from([...b(0), ...b(1)]);
    case "slice": {
      const src = b(0);
      const lo = clamp(n(1), 0, src.length);
      const hi = clamp(n(2), lo, src.length);
      return src.slice(lo, hi);
    }
    case "zeros":
      return new Uint8Array(Math.max(0, n(0)));
    case "fill":
      return new Uint8Array(Math.max(0, n(1))).fill(n(0) & 255);
    case "flipBit": {
      const src = b(0).slice();
      if (src.length === 0) return src;
      const bit =
        ((n(1) % (src.length * 8)) + src.length * 8) % (src.length * 8);
      src[bit >> 3] ^= 1 << (bit & 7);
      return src;
    }
    case "xor":
    case "bitAnd":
    case "bitOr": {
      // The shorter reads as zeros past its end, as the emitted test does.
      const x = b(0);
      const y = b(1);
      const out = new Uint8Array(Math.max(x.length, y.length));
      for (let i = 0; i < out.length; i++) {
        const p = x[i] ?? 0;
        const q = y[i] ?? 0;
        out[i] = e.op === "xor" ? p ^ q : e.op === "bitAnd" ? p & q : p | q;
      }
      return out;
    }
    case "unwrap": {
      const v = a[0]();
      if (v === null) throw new Undefined();
      return v;
    }
    case "isNull":
      return a[0]() === null;
    case "notNull":
      return a[0]() !== null;
    case "+":
      return (n(0) + n(1)) | 0;
    case "-":
      return (n(0) - n(1)) | 0;
    case "*":
      return Math.imul(n(0), n(1));
    case "%": {
      const d = n(1);
      return d === 0 ? 0 : n(0) % d;
    }
    case "le64": {
      const out = new Uint8Array(8);
      new DataView(out.buffer).setBigInt64(0, BigInt(n(0)), true);
      return out;
    }
    case "<":
      return n(0) < n(1);
    case "<=":
      return n(0) <= n(1);
    case ">":
      return n(0) > n(1);
    case ">=":
      return n(0) >= n(1);
    case "==":
    case "!=": {
      const eq = valuesEqual(a[0](), a[1]());
      return e.op === "==" ? eq : !eq;
    }
    case "and":
      return a.every((_, i) => t(i));
    case "or":
      return a.some((_, i) => t(i));
    case "not":
      return !t(0);
    case "implies":
      return !t(0) || t(1);
    case "strLen":
      return s(0).length;
    case "strConcat":
      return s(0) + s(1);
    case "lower":
      return mapCase(s(0), /[A-Z]/g, 32);
    case "upper":
      return mapCase(s(0), /[a-z]/g, -32);
    case "utf8":
      return new TextEncoder().encode(s(0));
    case "ascii": {
      const src = b(0);
      return src.every((x) => x < 0x80) ? String.fromCharCode(...src) : null;
    }
    case "charAt": {
      const str = s(0);
      const i = n(1);
      return i >= 0 && i < str.length ? str[i] : "";
    }
  }
}

const clamp = (x: number, lo: number, hi: number) =>
  Math.min(Math.max(x, lo), hi);

function valuesEqual(x: Value, y: Value): boolean {
  if (x instanceof Uint8Array && y instanceof Uint8Array) {
    return x.length === y.length && x.every((v, i) => v === y[i]);
  }
  return x === y;
}

function holds(where: Expr | undefined, s: Sample): boolean {
  if (!where) return true;
  try {
    return evalPure(where, s) === true;
  } catch (err) {
    if (err instanceof Undefined) return false;
    throw err;
  }
}

// ── SMT: the integer skeleton of a property ───────────────────────────────

const smtName = (v: Var) =>
  v.type === "i32" ? `v_${v.name}` : `len_${v.name}`;

/**
 * `e` with every let-bound name replaced by its value, for the integer
 * skeleton only (a binding is just a name for its value there).
 */
function inlineLets(e: Expr, bound: Map<string, Expr> = new Map()): Expr {
  if ("let" in e) {
    const inner = new Map(bound);
    for (const b of e.let) inner.set(b.name, inlineLets(b.value, inner));
    return inlineLets(e.in, inner);
  }
  if ("var" in e) return bound.get(e.var) ?? e;
  if ("op" in e)
    return { op: e.op, args: e.args.map((x) => inlineLets(x, bound)) };
  if ("call" in e)
    return { call: e.call, args: e.args.map((x) => inlineLets(x, bound)) };
  return e;
}

/**
 * The SMT term for an integer expression, or null when it is not in the
 * linear-integer skeleton (a call, a bytes comparison, a slice's length…).
 */
function intTerm(e: Expr, vars: Map<string, Var>): string | null {
  if ("int" in e) return e.int < 0 ? `(- ${-e.int})` : String(e.int);
  if ("var" in e) {
    const v = vars.get(e.var);
    return v && v.type === "i32" ? smtName(v) : null;
  }
  if (!("op" in e)) return null;
  if (e.op === "len" || e.op === "strLen") return lenTerm(e.args[0], vars);
  if (e.op === "+" || e.op === "-" || e.op === "*") {
    const l = intTerm(e.args[0], vars);
    const r = intTerm(e.args[1], vars);
    return l && r ? `(${e.op} ${l} ${r})` : null;
  }
  if (e.op === "%") {
    // Z3's mod is Euclidean and JS's/Nish's % truncates; they agree for a
    // non-negative dividend and a positive literal divisor, which is all this
    // encodes (the dividend's sign is pinned by an ite).
    const l = intTerm(e.args[0], vars);
    const d = e.args[1];
    if (!l || !("int" in d) || d.int <= 0) return null;
    return `(ite (>= ${l} 0) (mod ${l} ${d.int}) (- (mod (- ${l}) ${d.int})))`;
  }
  return null;
}

/** The length term of a bytes or string expression (one byte per character). */
function lenTerm(e: Expr, vars: Map<string, Var>): string | null {
  if ("var" in e) {
    const v = vars.get(e.var);
    return v && v.type !== "i32" ? smtName(v) : null;
  }
  if ("hex" in e) return String((e.hex.length / 2) * (e.repeat ?? 1));
  if ("str" in e) return String(e.str.length);
  if (!("op" in e)) return null;
  if (e.op === "concat" || e.op === "strConcat") {
    const l = lenTerm(e.args[0], vars);
    const r = lenTerm(e.args[1], vars);
    return l && r ? `(+ ${l} ${r})` : null;
  }
  if (e.op === "xor" || e.op === "bitAnd" || e.op === "bitOr") {
    const l = lenTerm(e.args[0], vars);
    const r = lenTerm(e.args[1], vars);
    return l && r ? `(ite (>= ${l} ${r}) ${l} ${r})` : null;
  }
  if (e.op === "zeros") return nonNeg(intTerm(e.args[0], vars));
  if (e.op === "fill") return nonNeg(intTerm(e.args[1], vars));
  if (["flipBit", "lower", "upper", "utf8"].includes(e.op))
    return lenTerm(e.args[0], vars);
  if (e.op === "le64") return "8";
  if (e.op === "charAt") {
    const l = lenTerm(e.args[0], vars);
    const i = intTerm(e.args[1], vars);
    return l && i ? `(ite (and (>= ${i} 0) (< ${i} ${l})) 1 0)` : null;
  }
  return null;
}

const nonNeg = (t: string | null) => (t ? `(ite (< ${t} 0) 0 ${t})` : null);

function boolTerm(e: Expr, vars: Map<string, Var>): string | null {
  if ("bool" in e) return String(e.bool);
  if (!("op" in e)) return null;
  switch (e.op) {
    case "<":
    case "<=":
    case ">":
    case ">=":
    case "==":
    case "!=": {
      const l = intTerm(e.args[0], vars);
      const r = intTerm(e.args[1], vars);
      if (!l || !r) return null;
      if (e.op === "==") return `(= ${l} ${r})`;
      if (e.op === "!=") return `(not (= ${l} ${r}))`;
      return `(${e.op} ${l} ${r})`;
    }
    case "and":
    case "or": {
      const ts = e.args.map((x) => boolTerm(x, vars));
      return ts.every((t) => t) ? `(${e.op} ${ts.join(" ")})` : null;
    }
    case "not": {
      const t = boolTerm(e.args[0], vars);
      return t ? `(not ${t})` : null;
    }
    case "implies": {
      const l = boolTerm(e.args[0], vars);
      const r = boolTerm(e.args[1], vars);
      return l && r ? `(=> ${l} ${r})` : null;
    }
    default:
      return null;
  }
}

/** Every integer comparison in `e` whose two sides are in the skeleton, as `left - right`. */
function comparisonEdges(
  e: Expr,
  vars: Map<string, Var>,
  out: Set<string>,
): void {
  if ("op" in e) {
    if (["<", "<=", ">", ">=", "==", "!="].includes(e.op)) {
      const l = intTerm(e.args[0], vars);
      const r = intTerm(e.args[1], vars);
      if (l && r) out.add(`(- ${l} ${r})`);
    }
    for (const x of e.args) comparisonEdges(x, vars, out);
  } else if ("call" in e) {
    for (const x of e.args) comparisonEdges(x, vars, out);
  }
}

interface Query {
  extra: string;
  /** The SMT names this query is about; the rest of its model is incidental. */
  pins: string[];
}

function propertyScript(k: PropertyClause, queries: Query[]): string {
  const vars = k.forall;
  const lines = [...SMT_PREAMBLE];
  for (const v of vars) {
    const n = smtName(v);
    lines.push(`(declare-const ${n} Int)`);
    if (v.type === "i32")
      lines.push(
        `(assert (and (>= ${n} ${int(v.min)}) (<= ${n} ${int(v.max)})))`,
      );
    else
      lines.push(`(assert (and (>= ${n} ${v.minLen}) (<= ${n} ${v.maxLen})))`);
  }
  const varMap = new Map(vars.map((v) => [v.name, v]));
  if (k.where) {
    const w = boolTerm(k.where, varMap);
    if (w) lines.push(`(assert ${w})`);
  }
  const names = vars.map(smtName).join(" ");
  queries.forEach((q, i) => {
    lines.push("(push 1)");
    if (q.extra) lines.push(`(assert ${q.extra})`);
    lines.push(`(echo "@@Q${i}")`, "(check-sat)");
    if (names) lines.push(`(get-value (${names}))`);
    lines.push("(pop 1)");
  });
  return `${lines.join("\n")}\n`;
}

const int = (n: number) => (n < 0 ? `(- ${-n})` : String(n));

// ── Sampling ──────────────────────────────────────────────────────────────

async function sampleProperty(
  c: RfcContract,
  k: PropertyClause,
): Promise<{ result: PropertySamples; solver?: string; error?: string }> {
  const notes: string[] = [];
  const varMap = new Map(k.forall.map((v) => [v.name, v]));
  const rnd = prng(`${c.contract}/${k.id}`);
  const whereSmt = k.where ? boolTerm(k.where, varMap) : "true";
  if (k.where && !whereSmt) {
    notes.push(
      "where is outside the integer skeleton: Z3 saw only the variable ranges; samples are filtered by evaluation",
    );
  }

  // Q0: is the domain inhabited? Then the boundary queries.
  const queries: Query[] = [{ extra: "", pins: [] }];
  const edges = new Set<string>();
  if (k.where) comparisonEdges(k.where, varMap, edges);
  comparisonEdges(inlineLets(k.assert), varMap, edges);
  for (const d of edges) {
    const pins = k.forall
      .map(smtName)
      .filter((n) => new RegExp(`\\b${n}\\b`).test(d));
    for (const off of [-1, 0, 1])
      queries.push({ extra: `(= ${d} ${int(off)})`, pins });
  }
  for (const v of k.forall) {
    const n = smtName(v);
    const [lo, hi] = v.type === "i32" ? [v.min, v.max] : [v.minLen, v.maxLen];
    for (const at of new Set([lo, lo + 1, hi - 1, hi])) {
      if (at >= lo && at <= hi)
        queries.push({ extra: `(= ${n} ${int(at)})`, pins: [n] });
    }
  }

  const samples: Sample[] = [];
  const seen = new Set<string>();
  const add = (s: Sample) => {
    const key = JSON.stringify(
      Object.entries(s).map(([n, v]) => [
        n,
        v instanceof Uint8Array ? Buffer.from(v).toString("hex") : v,
      ]),
    );
    if (seen.has(key) || !holds(k.where, s)) return false;
    seen.add(key);
    samples.push(s);
    return true;
  };
  const fill = (ints: Record<string, number>): Sample => {
    const s: Sample = {};
    for (const v of k.forall) {
      if (v.type === "i32") {
        s[v.name] = ints[v.name] ?? biasedInt(rnd, v.min, v.max);
        continue;
      }
      const n = ints[v.name] ?? biasedInt(rnd, v.minLen, v.maxLen);
      s[v.name] =
        v.type === "bytes"
          ? randomBytes(rnd, n)
          : randomString(rnd, alphabetChars(v.alphabet) as string[], n);
    }
    return s;
  };

  let inhabited: PropertySamples["inhabited"] = "failed";
  let solver: string | undefined;
  const z3 = await runZ3Script(propertyScript(k, queries), queries.length);
  if (z3.kind === "error") {
    return {
      result: {
        clauseId: k.id,
        samples: [],
        boundary: 0,
        random: 0,
        inhabited: "failed",
        notes,
      },
      error: z3.message,
    };
  }
  solver = z3.label;
  if (z3.answers[0]?.result === "sat") inhabited = "z3";
  else if (z3.answers[0]?.result === "unsat" && whereSmt) {
    return {
      result: {
        clauseId: k.id,
        samples: [],
        boundary: 0,
        random: 0,
        inhabited: "failed",
        notes,
      },
      solver,
      error:
        "the domain is empty (Z3: unsat) — the property would hold vacuously",
    };
  }
  let boundary = 0;
  z3.answers.forEach((ans, i) => {
    if (i === 0 || ans.result !== "sat") return;
    const model: Record<string, number> = {};
    const pinned: Record<string, number> = {};
    for (const v of k.forall) {
      const raw = ans.model[smtName(v)];
      if (raw === undefined || !/^-?\d+$/.test(raw)) continue;
      model[v.name] = Number(raw);
      if (queries[i].pins.includes(smtName(v))) pinned[v.name] = Number(raw);
    }
    // Keep only what the query pinned and draw the rest, so ten boundary
    // samples are not ten copies of Z3's favourite zero; fall back to the
    // whole model when the draw leaves the domain.
    const drawn = fill(pinned);
    if (holds(k.where, drawn)) {
      if (add(drawn)) boundary++;
    } else if (add(fill(model))) boundary++;
  });

  const want = k.samples ?? DEFAULT_RANDOM;
  let random = 0;
  for (
    let tries = 0;
    random < want && tries < want * 20 && samples.length < MAX_SAMPLES;
    tries++
  ) {
    if (add(fill({}))) random++;
  }
  if (inhabited === "failed" && samples.length > 0) inhabited = "witness";
  if (inhabited === "failed") {
    return {
      result: { clauseId: k.id, samples, boundary, random, inhabited, notes },
      solver,
      error:
        "no input satisfies the domain (Z3 could not decide it and no sample was found)",
    };
  }
  if (edges.size === 0 && k.forall.some((v) => v.type === "i32")) {
    notes.push(
      "no integer comparison in the skeleton: boundaries are the variables' extremes only",
    );
  }
  return {
    result: { clauseId: k.id, samples, boundary, random, inhabited, notes },
    solver,
  };
}

export async function sampleContract(c: RfcContract): Promise<SamplingResult> {
  const issues: { at: string; message: string }[] = [];
  const properties = new Map<string, PropertySamples>();
  let solver: string | undefined;
  for (const k of c.clauses) {
    if (k.kind !== "property") continue;
    const r = await sampleProperty(c, k);
    properties.set(k.id, r.result);
    solver = solver ?? r.solver;
    if (r.error) issues.push({ at: k.id, message: r.error });
  }
  return { ok: issues.length === 0, issues, properties, solver };
}
