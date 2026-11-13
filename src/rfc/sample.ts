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
  type ValueTy,
  type Var,
  alphabetChars,
  f64Value,
  isIntTy,
  typeOf,
} from "./contract.ts";
import { INT_RANGE, INT_TYPES, type IntType } from "./vocab.ts";

/**
 * A value as the evaluator holds it: an integer of up to 32 bits is a
 * number, a 64-bit one a bigint (exact past 2^53), an f64 a number.
 */
export type Value = Uint8Array | string | number | bigint | boolean | null;
export type Sample = Record<string, Uint8Array | string | number | bigint>;

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

/** `intIn` over bigints: two 32-bit draws, reduced into the span. */
function bigIn(rnd: () => number, lo: bigint, hi: bigint): bigint {
  const draw =
    (BigInt(Math.floor(rnd() * 4294967296)) << 32n) |
    BigInt(Math.floor(rnd() * 4294967296));
  return lo + (draw % (hi - lo + 1n));
}

/** `biasedInt` for a 64-bit range. */
function biasedBig(rnd: () => number, lo: bigint, hi: bigint): bigint {
  const r = rnd();
  if (r < 0.5 || hi - lo < 32n) return bigIn(rnd, lo, hi);
  if (r < 0.75) return bigIn(rnd, lo, lo + 16n);
  return bigIn(rnd, hi - 16n, hi);
}

/** An integer type's width in bits, and whether it is two's complement. */
const widthOf = (ty: IntType) => Number(ty.slice(1));
const signedTy = (ty: IntType) => ty.startsWith("i");

/** `x` reduced to `ty`: modulo 2^N, read as two's complement for `iN`. */
export const wrapInt = (x: bigint, ty: IntType): bigint =>
  signedTy(ty) ? BigInt.asIntN(widthOf(ty), x) : BigInt.asUintN(widthOf(ty), x);

/** An integer of type `ty` as the evaluator holds it (see Value). */
const intOut = (x: bigint, ty: IntType): number | bigint =>
  widthOf(ty) > 32 ? x : Number(x);

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
export function evalPure(
  e: Expr,
  env: Record<string, Value>,
  types: ReadonlyMap<string, ValueTy> = new Map(),
): Value {
  if ("let" in e) {
    // No prototype, so a binding named __proto__ is an ordinary key.
    const scope: Record<string, Value> = Object.assign(
      Object.create(null),
      env,
    );
    const inner = new Map(types);
    for (const b of e.let) {
      scope[b.name] = evalPure(b.value, scope, inner);
      const t = typeIn(b.value, inner);
      if (t !== null) inner.set(b.name, t);
    }
    return evalPure(e.in, scope, inner);
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
  if ("int" in e) return typeof e.int === "string" ? BigInt(e.int) : e.int;
  if ("f64" in e) return f64Value(e);
  if ("bool" in e) return e.bool;
  if ("null" in e) return null;
  if ("concat" in e) {
    const parts = e.concat.map((p) => evalPure(p, env, types) as Uint8Array);
    return Uint8Array.from(parts.flatMap((p) => [...p]));
  }
  if ("var" in e) return env[e.var] ?? null;
  if ("call" in e) throw new Error("evalPure: calls are not pure");
  const a = e.args.map((x) => () => evalPure(x, env, types));
  const n = (i: number) => Number(a[i]());
  const big = (i: number) => BigInt(a[i]() as number | bigint);
  // + - * % wrap to the operands' type (contract typing makes them one).
  const arith = (f: (x: bigint, y: bigint) => bigint) => {
    const ty = intTyIn(e, types);
    return intOut(wrapInt(f(big(0), big(1)), ty), ty);
  };
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
      return arith((x, y) => x + y);
    case "-":
      return arith((x, y) => x - y);
    case "*":
      return arith((x, y) => x * y);
    case "%":
      // As the emitted remainder helper: 0 for a zero divisor, truncating
      // otherwise (bigint % truncates, and has no -0).
      return arith((x, y) => (y === 0n ? 0n : x % y));
    case "le64": {
      const out = new Uint8Array(8);
      new DataView(out.buffer).setBigInt64(0, BigInt(n(0)), true);
      return out;
    }
    case "<":
      return big(0) < big(1);
    case "<=":
      return big(0) <= big(1);
    case ">":
      return big(0) > big(1);
    case ">=":
      return big(0) >= big(1);
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

const isBig = (v: Value): v is bigint => typeof v === "bigint";

function valuesEqual(x: Value, y: Value): boolean {
  if (x instanceof Uint8Array && y instanceof Uint8Array) {
    return x.length === y.length && x.every((v, i) => v === y[i]);
  }
  // A 64-bit value is a bigint and a small literal beside it a number.
  if ((isBig(x) || isBig(y)) && (isBig(x) || Number.isInteger(x)))
    return (
      (isBig(y) || Number.isInteger(y)) &&
      BigInt(x as number) === BigInt(y as number)
    );
  return x === y;
}

/** The type of `e` among `types`, or null when it has none there. */
function typeIn(e: Expr, types: ReadonlyMap<string, ValueTy>): ValueTy | null {
  const env = { fns: new Map(), vars: new Map(types), allowCalls: true };
  const t = typeOf(e, env, "", []);
  return t === null || t === "null" ? null : (t as ValueTy);
}

/** The integer type `e` computes in; i32 where the types do not say. */
function intTyIn(e: Expr, types: ReadonlyMap<string, ValueTy>): IntType {
  const t = typeIn(e, types);
  return isIntTy(t) ? t : "i32";
}

/** The types of a property's variables, for evalPure and the skeleton. */
const varTypes = (vars: readonly Var[]) =>
  new Map<string, ValueTy>(vars.map((v) => [v.name, v.type]));

function holds(
  where: Expr | undefined,
  s: Sample,
  types: ReadonlyMap<string, ValueTy>,
): boolean {
  if (!where) return true;
  try {
    return evalPure(where, s, types) === true;
  } catch (err) {
    if (err instanceof Undefined) return false;
    throw err;
  }
}

// ── SMT: the integer skeleton of a property ───────────────────────────────
//
// An integer of a new width is a bit-vector of that width (SMT-LIB 2.6
// FixedSizeBitVectors), so + - * wrap in the solver as evalPure and the
// implementation wrap them, and a comparison is signed (bvslt…) for iN and
// unsigned (bvult…) for uN. An i32, and a length (an i32, as len and strLen
// return), stay the mathematical Int they have always been: Z3 picks other
// models for a bit-vector, and the committed contracts' samples must not move.
// That encoding does not wrap; a boundary it finds past a wrap is only a
// sample, and evalPure, which does wrap, decides whether it is in the domain.

/** The SMT spelling of one integer type's terms. */
interface Encoding {
  sort: string;
  lit(x: bigint): string;
  /** + - * by contract op. */
  arith: Record<"+" | "-" | "*", string>;
  /** < <= > >= by contract op. */
  order: Record<string, string>;
  /** Truncating remainder (C11 §6.5.5), or null when not encoded. */
  rem(l: string, d: Expr, dt: string): string | null;
  /** `l - r` exactly (it never wraps), and the literal of an offset to it. */
  diff(l: string, r: string): string;
  offset(x: bigint): string;
  /** A model's value, or null. */
  read(raw: string): bigint | null;
}

const smtInt = (x: bigint) => (x < 0n ? `(- ${-x})` : String(x));

const INT_ENCODING: Encoding = {
  sort: "Int",
  lit: smtInt,
  arith: { "+": "+", "-": "-", "*": "*" },
  order: { "<": "<", "<=": "<=", ">": ">", ">=": ">=" },
  rem(l, d) {
    // Z3's mod is Euclidean and % truncates; they agree for a positive
    // literal divisor once the dividend's sign is pinned by an ite. A
    // computed divisor, which may be 0, stays outside the encoding.
    if (!("int" in d) || BigInt(d.int) <= 0n) return null;
    return `(ite (>= ${l} 0) (mod ${l} ${d.int}) (- (mod (- ${l}) ${d.int})))`;
  },
  diff: (l, r) => `(- ${l} ${r})`,
  offset: smtInt,
  read: (raw) => (/^-?\d+$/.test(raw) ? BigInt(raw) : null),
};

function bvEncoding(ty: IntType): Encoding {
  const w = widthOf(ty);
  const signed = signedTy(ty);
  const u = signed ? "s" : "u";
  const ext = signed ? "sign_extend" : "zero_extend";
  return {
    sort: `(_ BitVec ${w})`,
    lit: (x) => bvLit(x, w),
    arith: { "+": "bvadd", "-": "bvsub", "*": "bvmul" },
    order: {
      "<": `bv${u}lt`,
      "<=": `bv${u}le`,
      ">": `bv${u}gt`,
      ">=": `bv${u}ge`,
    },
    rem(l, d, dt) {
      // bv[su]rem truncates; SMT-LIB leaves x rem 0 as x where evalPure and
      // the emitted helper give 0, so a divisor that may be 0 is guarded.
      const rem = `(bv${u}rem ${l} ${dt})`;
      if ("int" in d && BigInt(d.int) !== 0n) return rem;
      const zero = bvLit(0n, w);
      return `(ite (= ${dt} ${zero}) ${zero} ${rem})`;
    },
    // Two bits wider, so the difference of any two values is exact.
    diff: (l, r) => `(bvsub ((_ ${ext} 2) ${l}) ((_ ${ext} 2) ${r}))`,
    offset: (x) => bvLit(x, w + 2),
    read(raw) {
      const m = raw.match(/^#(x[0-9a-fA-F]+|b[01]+)$/);
      return m ? wrapInt(BigInt(`0${m[1]}`), ty) : null;
    },
  };
}

const ENCODINGS = new Map(
  INT_TYPES.map((ty) => [ty, ty === "i32" ? INT_ENCODING : bvEncoding(ty)]),
);
const enc = (ty: IntType) => ENCODINGS.get(ty) as Encoding;

const smtName = (v: Var) => (isIntTy(v.type) ? `v_${v.name}` : `len_${v.name}`);

/** The variables of a property, with their types for typeOf. */
interface Skeleton {
  vars: Map<string, Var>;
  types: Map<string, ValueTy>;
}

const skeletonOf = (vars: readonly Var[]): Skeleton => ({
  vars: new Map(vars.map((v) => [v.name, v])),
  types: varTypes(vars),
});

/** The bit-vector literal of `x` at width `w` (two's complement for a negative). */
const bvLit = (x: bigint, w: number) => `(_ bv${BigInt.asUintN(w, x)} ${w})`;

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
 * The SMT term for an integer expression of type `ty`, or null when it is
 * not in the skeleton (a call, a bytes comparison, a slice's length…).
 */
function intTerm(e: Expr, sk: Skeleton, ty: IntType): string | null {
  if ("int" in e) return enc(ty).lit(BigInt(e.int));
  if ("var" in e) {
    const v = sk.vars.get(e.var);
    return v && v.type === ty ? smtName(v) : null;
  }
  if (!("op" in e)) return null;
  if (e.op === "len" || e.op === "strLen")
    return ty === "i32" ? lenTerm(e.args[0], sk) : null;
  if (e.op === "+" || e.op === "-" || e.op === "*") {
    const l = intTerm(e.args[0], sk, ty);
    const r = intTerm(e.args[1], sk, ty);
    return l && r ? `(${enc(ty).arith[e.op]} ${l} ${r})` : null;
  }
  if (e.op === "%") {
    const l = intTerm(e.args[0], sk, ty);
    const d = intTerm(e.args[1], sk, ty);
    return l && d ? enc(ty).rem(l, e.args[1], d) : null;
  }
  return null;
}

/** The length term of a bytes or string expression (one byte per character). */
function lenTerm(e: Expr, sk: Skeleton): string | null {
  if ("var" in e) {
    const v = sk.vars.get(e.var);
    return v && !isIntTy(v.type) ? smtName(v) : null;
  }
  if ("hex" in e) return String((e.hex.length / 2) * (e.repeat ?? 1));
  if ("str" in e) return String(e.str.length);
  if (!("op" in e)) return null;
  if (e.op === "concat" || e.op === "strConcat") {
    const l = lenTerm(e.args[0], sk);
    const r = lenTerm(e.args[1], sk);
    return l && r ? `(+ ${l} ${r})` : null;
  }
  if (e.op === "xor" || e.op === "bitAnd" || e.op === "bitOr") {
    const l = lenTerm(e.args[0], sk);
    const r = lenTerm(e.args[1], sk);
    return l && r ? `(ite (>= ${l} ${r}) ${l} ${r})` : null;
  }
  if (e.op === "zeros") return nonNeg(intTerm(e.args[0], sk, "i32"));
  if (e.op === "fill") return nonNeg(intTerm(e.args[1], sk, "i32"));
  if (["flipBit", "lower", "upper", "utf8"].includes(e.op))
    return lenTerm(e.args[0], sk);
  if (e.op === "le64") return String(8);
  if (e.op === "charAt") {
    const l = lenTerm(e.args[0], sk);
    const i = intTerm(e.args[1], sk, "i32");
    return l && i ? `(ite (and (>= ${i} 0) (< ${i} ${l})) 1 0)` : null;
  }
  return null;
}

const nonNeg = (t: string | null) => (t ? `(ite (< ${t} 0) 0 ${t})` : null);

const COMPARISONS = ["<", "<=", ">", ">=", "==", "!="];

/**
 * The integer type two compared operands share: the first that is not a
 * bare literal (a literal takes its type from the other side), else i32.
 * Null when they are not integers.
 */
function comparedTy(args: Expr[], sk: Skeleton): IntType | null {
  const typed = args.find((a) => !("int" in a));
  if (!typed) return "i32";
  const t = typeIn(typed, sk.types);
  return isIntTy(t) ? t : null;
}

/** Both sides of an integer comparison in the skeleton, at their type. */
function comparedTerms(
  e: Expr & { op: string; args: Expr[] },
  sk: Skeleton,
): { l: string; r: string; ty: IntType } | null {
  const ty = comparedTy(e.args, sk);
  if (!ty) return null;
  const l = intTerm(e.args[0], sk, ty);
  const r = intTerm(e.args[1], sk, ty);
  return l && r ? { l, r, ty } : null;
}

function boolTerm(e: Expr, sk: Skeleton): string | null {
  if ("bool" in e) return String(e.bool);
  if (!("op" in e)) return null;
  if (COMPARISONS.includes(e.op)) {
    const c = comparedTerms(e, sk);
    if (!c) return null;
    if (e.op === "==") return `(= ${c.l} ${c.r})`;
    if (e.op === "!=") return `(not (= ${c.l} ${c.r}))`;
    return `(${enc(c.ty).order[e.op]} ${c.l} ${c.r})`;
  }
  switch (e.op) {
    case "and":
    case "or": {
      const ts = e.args.map((x) => boolTerm(x, sk));
      return ts.every((t) => t) ? `(${e.op} ${ts.join(" ")})` : null;
    }
    case "not": {
      const t = boolTerm(e.args[0], sk);
      return t ? `(not ${t})` : null;
    }
    case "implies": {
      const l = boolTerm(e.args[0], sk);
      const r = boolTerm(e.args[1], sk);
      return l && r ? `(=> ${l} ${r})` : null;
    }
    default:
      return null;
  }
}

/**
 * Every integer comparison in `e` whose two sides are in the skeleton, as
 * the exact term `left - right`, mapped to its type.
 */
function comparisonEdges(
  e: Expr,
  sk: Skeleton,
  out: Map<string, IntType>,
): void {
  if ("op" in e) {
    if (COMPARISONS.includes(e.op)) {
      const c = comparedTerms(e, sk);
      if (c) out.set(enc(c.ty).diff(c.l, c.r), c.ty);
    }
    for (const x of e.args) comparisonEdges(x, sk, out);
  } else if ("call" in e) {
    for (const x of e.args) comparisonEdges(x, sk, out);
  }
}

interface Query {
  extra: string;
  /** The SMT names this query is about; the rest of its model is incidental. */
  pins: string[];
}

/** A variable's type in the skeleton: its own, or i32 for a length. */
const skeletonTy = (v: Var): IntType => (isIntTy(v.type) ? v.type : "i32");

/** A variable's range in the skeleton, inclusive. */
function rangeOf(v: Var): [bigint, bigint] {
  if (v.type === "bytes" || v.type === "string")
    return [BigInt(v.minLen), BigInt(v.maxLen)];
  if (isIntTy(v.type) && "min" in v)
    return [BigInt(v.min as number | string), BigInt(v.max as number | string)];
  throw new Error(`${v.name}: not an integer or length variable`);
}

function propertyScript(k: PropertyClause, queries: Query[]): string {
  const vars = k.forall;
  const sk = skeletonOf(vars);
  const lines = [...SMT_PREAMBLE];
  for (const v of vars) {
    const n = smtName(v);
    const ty = skeletonTy(v);
    const { sort, order, lit } = enc(ty);
    const [lo, hi] = rangeOf(v);
    lines.push(`(declare-const ${n} ${sort})`);
    lines.push(
      `(assert (and (${order[">="]} ${n} ${lit(lo)}) (${order["<="]} ${n} ${lit(hi)})))`,
    );
  }
  if (k.where) {
    const w = boolTerm(k.where, sk);
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

// ── Sampling ──────────────────────────────────────────────────────────────

const F64_VARS = "f64 variables are not sampled yet; give f64 cases as vectors";

async function sampleProperty(
  c: RfcContract,
  k: PropertyClause,
): Promise<{ result: PropertySamples; solver?: string; error?: string }> {
  const notes: string[] = [];
  const failed = (error: string, solver?: string) => ({
    result: {
      clauseId: k.id,
      samples: [],
      boundary: 0,
      random: 0,
      inhabited: "failed" as const,
      notes,
    },
    solver,
    error,
  });
  if (k.forall.some((v) => v.type === "f64")) return failed(F64_VARS);
  const sk = skeletonOf(k.forall);
  const rnd = prng(`${c.contract}/${k.id}`);
  const whereSmt = k.where ? boolTerm(k.where, sk) : "true";
  if (k.where && !whereSmt) {
    notes.push(
      "where is outside the integer skeleton: Z3 saw only the variable ranges; samples are filtered by evaluation",
    );
  }

  // Q0: is the domain inhabited? Then the boundary queries.
  const queries: Query[] = [{ extra: "", pins: [] }];
  const edges = new Map<string, IntType>();
  if (k.where) comparisonEdges(k.where, sk, edges);
  comparisonEdges(inlineLets(k.assert), sk, edges);
  for (const [d, ty] of edges) {
    const pins = k.forall
      .map(smtName)
      .filter((n) => new RegExp(`\\b${n}\\b`).test(d));
    for (const off of [-1n, 0n, 1n])
      queries.push({ extra: `(= ${d} ${enc(ty).offset(off)})`, pins });
  }
  for (const v of k.forall) {
    const n = smtName(v);
    const ty = skeletonTy(v);
    const [lo, hi] = rangeOf(v);
    // The variable's own extremes, then its type's (C11 §7.20.2 intN_t
    // limits), where the range reaches them.
    const { min, max } = INT_RANGE[ty];
    for (const at of new Set([lo, lo + 1n, hi - 1n, hi, min, max])) {
      if (at >= lo && at <= hi)
        queries.push({
          extra: `(= ${n} ${enc(ty).lit(at)})`,
          pins: [n],
        });
    }
  }

  const types = sk.types;
  const samples: Sample[] = [];
  const seen = new Set<string>();
  const add = (s: Sample) => {
    const key = JSON.stringify(
      Object.entries(s).map(([n, v]) => [
        n,
        v instanceof Uint8Array
          ? Buffer.from(v).toString("hex")
          : typeof v === "bigint"
            ? `${v}n`
            : v,
      ]),
    );
    if (seen.has(key) || !holds(k.where, s, types)) return false;
    seen.add(key);
    samples.push(s);
    return true;
  };
  const fill = (ints: Record<string, bigint>): Sample => {
    const s: Sample = {};
    for (const v of k.forall) {
      const [lo, hi] = rangeOf(v);
      const at = ints[v.name];
      if (isIntTy(v.type)) {
        // Up to 32 bits a sample is a number, drawn as it always was; a
        // 64-bit one a bigint.
        s[v.name] =
          widthOf(v.type) > 32
            ? (at ?? biasedBig(rnd, lo, hi))
            : at !== undefined
              ? Number(at)
              : biasedInt(rnd, Number(lo), Number(hi));
        continue;
      }
      const n =
        at !== undefined ? Number(at) : biasedInt(rnd, Number(lo), Number(hi));
      s[v.name] =
        v.type === "string"
          ? randomString(rnd, alphabetChars(v.alphabet) as string[], n)
          : randomBytes(rnd, n);
    }
    return s;
  };

  let inhabited: PropertySamples["inhabited"] = "failed";
  const z3 = await runZ3Script(propertyScript(k, queries), queries.length);
  if (z3.kind === "error") return failed(z3.message);
  const solver = z3.label;
  if (z3.answers[0]?.result === "sat") inhabited = "z3";
  else if (z3.answers[0]?.result === "unsat" && whereSmt) {
    return failed(
      "the domain is empty (Z3: unsat) — the property would hold vacuously",
      solver,
    );
  }
  let boundary = 0;
  z3.answers.forEach((ans, i) => {
    if (i === 0 || ans.result !== "sat") return;
    const model: Record<string, bigint> = {};
    const pinned: Record<string, bigint> = {};
    for (const v of k.forall) {
      const raw = ans.model[smtName(v)];
      const x = raw === undefined ? null : enc(skeletonTy(v)).read(raw);
      if (x === null) continue;
      model[v.name] = x;
      if (queries[i].pins.includes(smtName(v))) pinned[v.name] = x;
    }
    // Keep only what the query pinned and draw the rest, so ten boundary
    // samples are not ten copies of Z3's favourite zero; fall back to the
    // whole model when the draw leaves the domain.
    const drawn = fill(pinned);
    if (holds(k.where, drawn, types)) {
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
  if (edges.size === 0 && k.forall.some((v) => isIntTy(v.type))) {
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
