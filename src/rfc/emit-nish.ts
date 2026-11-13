// An RfcContract (plus its samples) as a Nish test program.
//
// The program imports the functions under test from the contract's target
// module and checks every clause with `nish/testing`'s Suite, one line per
// clause: `PASS  [<clause id>] <title>`. The bracketed id is how `vector rfc
// run` maps the output back to the requirements.
//
// Nish has no closures, exceptions or generics, which shapes the output:
//   - a property is a loop over baked sample tables (the solver and the PRNG
//     ran at generation time, so a failure reproduces byte for byte);
//   - `unwrap` of a null cannot throw, so it records the null on an `Unwrap`
//     and the sample fails;
//   - every helper is spelled for one type, and only the ones used are emitted.

import { createHash } from "node:crypto";
import {
  type Clause,
  type Expr,
  type ExprTy,
  type FnSig,
  type IntType,
  type Literal,
  type PropertyClause,
  type RfcContract,
  type SigTy,
  type ValueTy,
  type VectorClause,
  bytesToHex,
  callsIn,
  declaredSources,
  f64Bits,
  f64Value,
  intBase,
  intValue,
  isBytesLike,
  isIntTy,
  isLiteral,
  isStringLike,
  literalBytes,
  nishModuleFile,
  parseF64,
  sourceOf,
  typeOf,
  valueTy,
  withoutControlChars,
} from "./contract.ts";
import type { PropertySamples } from "./sample.ts";
import { baseOf, isOptional } from "./vocab.ts";

/**
 * Each contract type as Nish spells it. Nish has no i8 or i16, and `T | null`
 * only on a reference type (docs/LANGUAGE.md, "Nullable types"), so the
 * entries for those are never emitted: refusals() refuses the contract first.
 */
const NISH_TY: Record<ValueTy, string> = {
  bytes: "u8[]",
  "bytes?": "u8[] | null",
  string: "string",
  "string?": "string | null",
  i8: "i8",
  "i8?": "i8 | null",
  i16: "i16",
  "i16?": "i16 | null",
  i32: "i32",
  "i32?": "i32 | null",
  i64: "i64",
  "i64?": "i64 | null",
  u8: "u8",
  "u8?": "u8 | null",
  u16: "u16",
  "u16?": "u16 | null",
  u32: "u32",
  "u32?": "u32 | null",
  u64: "u64",
  "u64?": "u64 | null",
  f64: "f64",
  "f64?": "f64 | null",
  bool: "boolean",
  "bool?": "boolean | null",
};

/** A contract the Nish emitter cannot express, and why. */
export class NishRefusal extends Error {
  override name = "NishRefusal";
}

const NO_F64_FORALL =
  "the sampler has no f64 forall variable yet, so Nish has no samples to check";
const NO_SMALL_INT = "Nish has no i8 or i16: write the parameter as i32";

/** Nish's conversion into each integer type other than i32. */
const TO_INT: Record<Exclude<IntType, "i32" | "i8" | "i16">, string> = {
  i64: "toI64",
  u8: "toU8",
  u16: "toU16",
  u32: "toU32",
  u64: "toU64",
};

/**
 * `n` as a Nish expression of integer type `ty`. A Nish numeric literal is an
 * i32 unless its context types it, and is exact only up to 2^53 in magnitude
 * (docs/LANGUAGE.md, "Type rules"), so: an i32 is the literal; a value that
 * fits i32 is converted; a larger one is typed by a `toT(0) +` beside it; one
 * past 2^53 is built as hi * 2^32 + lo, each part exact and no step out of
 * the type's range (C11 7.20.1.1 two's complement for the signed ones).
 */
export function intLit(n: bigint, ty: IntType): string {
  const fitsI32 = n >= -2147483648n && n <= 2147483647n;
  const neg = (s: string) => (s.startsWith("-") ? `(${s})` : s);
  if (ty === "i32") return neg(String(n));
  if (ty === "i8" || ty === "i16") throw new NishRefusal(NO_SMALL_INT);
  const to = TO_INT[ty];
  if (fitsI32) return `${to}(${n})`;
  if (n >= -(2n ** 53n) && n <= 2n ** 53n)
    return `(${to}(0) + ${neg(String(n))})`;
  const hi = n >> 32n;
  const lo = n - (hi << 32n);
  return `(${intLit(hi, ty)} * 4294967296 + ${lo})`;
}

/**
 * An f64 as a Nish expression: the shortest decimal that reads back to the
 * same binary64 under roundTiesToEven (IEEE 754-2019 §5.12.2), through
 * toF64 so its context is f64; -0, the infinities and NaN, which no decimal
 * literal spells, from their bits.
 */
export function f64Lit(x: number): string {
  if (Number.isFinite(x) && !Object.is(x, -0))
    return `toF64(${String(x).replace("e+", "e")})`;
  return `bitsToF64(${intLit(BigInt.asIntN(64, BigInt(`0x${f64Bits(x)}`)), "i64")})`;
}

/** nish:unsafe's wrapping form of each i64 operator (docs/LANGUAGE.md). */
const WRAPPING = {
  "+": "wrappingAdd",
  "-": "wrappingSub",
  "*": "wrappingMul",
} as const;

const remName = (t: IntType) => `rem${t[0].toUpperCase()}${t.slice(1)}`;

/**
 * The contract's \`a % b\` at each integer type but i32 (remI32): truncating,
 * and 0 when \`b\` is 0, or -1 for a signed type, as evalPure has it.
 */
function remHelpers(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of ["i64", "u8", "u16", "u32", "u64"] as const) {
    const to = TO_INT[t];
    const name = remName(t);
    const zero =
      t === "i64" ? "b === toI64(0) || b === toI64(-1)" : `b === ${to}(0)`;
    out[name] = `const ${name} = (a: ${t}, b: ${t}): ${t} => {
  if (${zero}) {
    return ${to}(0);
  }
  return a % b;
};`;
  }
  return out;
}

const HELPERS: Record<string, string> = {
  hexOf: `/** \`bytes\` as lowercase hex, the way the RFC prints them. */
const hexOf = (bytes: u8[]): string => {
  const digits: string = "0123456789abcdef";
  const parts: string[] = [];
  for (const b of bytes) {
    const v: i32 = toI32(b);
    parts.push(digits.substring(v >> 4, (v >> 4) + 1));
    parts.push(digits.substring(v & 15, (v & 15) + 1));
  }
  return parts.join("");
};`,
  hexOrNull: `/** \`bytes\` as hex, or \`null\` spelled out. */
const hexOrNull = (bytes: u8[] | null): string => {
  if (bytes !== null) {
    return hexOf(bytes);
  }
  return "null";
};`,
  unhex: `/** The bytes a lowercase hex string spells. */
const unhex = (hex: string): u8[] => {
  const n: i32 = toI32(hex.length) >> 1;
  const out: u8[] = new Array<u8>(n);
  for (let i: i32 = 0; i < n; i += 1) {
    out[i] = toU8(nibble(hex.charCodeAt(2 * i)) * 16 + nibble(hex.charCodeAt(2 * i + 1)));
  }
  return out;
};`,
  nibble: `/** One hex digit's value. */
const nibble = (c: number): i32 => {
  const v: i32 = toI32(c);
  if (v >= 97) {
    return v - 87;
  }
  return v - 48;
};`,
  bytesEq: `/** Equal contents, or both null. */
const bytesEq = (a: u8[] | null, b: u8[] | null): boolean => {
  if (a === null || b === null) {
    return a === null && b === null;
  }
  const n: i32 = toI32(a.length);
  if (n !== toI32(b.length)) {
    return false;
  }
  for (let i: i32 = 0; i < n; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
};`,
  isNullBytes: "const isNullBytes = (b: u8[] | null): boolean => b === null;",
  concatBytes: `const concatBytes = (a: u8[], b: u8[]): u8[] => {
  const out: u8[] = [];
  for (const x of a) {
    out.push(x);
  }
  for (const x of b) {
    out.push(x);
  }
  return out;
};`,
  sliceBytes: `/** \`b[from, to)\`, both ends clamped into the array. */
const sliceBytes = (b: u8[], from: i32, to: i32): u8[] => {
  const n: i32 = toI32(b.length);
  let lo: i32 = from;
  if (lo < 0) {
    lo = 0;
  }
  if (lo > n) {
    lo = n;
  }
  let hi: i32 = to;
  if (hi < lo) {
    hi = lo;
  }
  if (hi > n) {
    hi = n;
  }
  const out: u8[] = [];
  for (let i: i32 = lo; i < hi; i += 1) {
    out.push(b[i]);
  }
  return out;
};`,
  fillBytes: `/** \`n\` copies of the byte \`v\` (none when n < 0). */
const fillBytes = (v: i32, n: i32): u8[] => {
  const out: u8[] = [];
  for (let i: i32 = 0; i < n; i += 1) {
    out.push(toU8(v & 255));
  }
  return out;
};`,
  flipBit: `/** A copy of \`b\` with bit \`bit\` (mod 8 * length) inverted. */
const flipBit = (b: u8[], bit: i32): u8[] => {
  const out: u8[] = sliceBytes(b, 0, toI32(b.length));
  const bits: i32 = toI32(b.length) * 8;
  if (bits === 0) {
    return out;
  }
  const at: i32 = ((bit % bits) + bits) % bits;
  const byte: i32 = at >> 3;
  const mask: i32 = 1 << (at & 7);
  out[byte] = toU8(toI32(out[byte]) ^ mask);
  return out;
};`,
  bitwiseBytes: `/**
 * \`a\` and \`b\` combined byte by byte (k 0: xor, 1: and, 2: or), as long as
 * the longer: the shorter reads as zeros past its end.
 */
const bitwiseBytes = (a: u8[], b: u8[], k: i32): u8[] => {
  const na: i32 = toI32(a.length);
  const nb: i32 = toI32(b.length);
  let n: i32 = na;
  if (nb > n) {
    n = nb;
  }
  const out: u8[] = [];
  for (let i: i32 = 0; i < n; i += 1) {
    let x: i32 = 0;
    if (i < na) {
      x = toI32(a[i]);
    }
    let y: i32 = 0;
    if (i < nb) {
      y = toI32(b[i]);
    }
    let z: i32 = x ^ y;
    if (k === 1) {
      z = x & y;
    }
    if (k === 2) {
      z = x | y;
    }
    out.push(toU8(z));
  }
  return out;
};`,
  remI32: `/**
 * The contract's \`a % b\`: truncating, and 0 when \`b\` is 0. A divisor of -1
 * also gives 0, which is what truncating % gives, without the overflow that
 * \`-2147483648 % -1\` can trap on.
 */
const remI32 = (a: i32, b: i32): i32 => {
  if (b === 0 || b === -1) {
    return 0;
  }
  return a % b;
};`,
  ...remHelpers(),
  eqF64Bits: `/** \`actual\` and \`expected\` the same binary64, bit for bit (IEEE 754-2019 §3.4). */
const eqF64Bits = (t: Suite, name: string, actual: f64, expected: f64): boolean => {
  if (f64ToBits(actual) === f64ToBits(expected)) {
    return t.pass(name);
  }
  return t.fail(name, \`expected \${expected}, got \${actual} (other binary64 bits)\`);
};`,
  nearUlpsF64: `/**
 * \`actual\` at most \`ulps\` binary64 units in the last place from
 * \`expected\`: their distance on the line of ordered bit patterns, where
 * consecutive doubles differ by one and -0 meets +0 (IEEE 754-2019 §3.4).
 * A NaN is never near anything.
 */
const nearUlpsF64 = (t: Suite, name: string, actual: f64, expected: f64, ulps: i64): boolean => {
  const lo: i64 = -9007199254740992;
  const min: i64 = lo << 10;
  let x: i64 = f64ToBits(actual);
  let y: i64 = f64ToBits(expected);
  if (x < 0) {
    x = toI64(0) - (x - min);
  }
  if (y < 0) {
    y = toI64(0) - (y - min);
  }
  let near: boolean = false;
  if (x >= 0 && y >= 0) {
    near = x - y <= ulps && y - x <= ulps;
  }
  if (x < 0 && y < 0) {
    near = x - y <= ulps && y - x <= ulps;
  }
  if (x >= 0 && y < 0) {
    near = x <= ulps && toI64(0) - y <= ulps - x;
  }
  if (x < 0 && y >= 0) {
    near = y <= ulps && toI64(0) - x <= ulps - y;
  }
  if (actual !== actual || expected !== expected) {
    near = false;
  }
  if (near) {
    return t.pass(name);
  }
  return t.fail(name, \`expected \${expected} within \${ulps} ulps, got \${actual}\`);
};`,
  le64: `/** \`n\` as 8 little-endian bytes. */
const le64 = (n: i32): u8[] => {
  const out: u8[] = [];
  let v: i64 = toI64(n);
  for (let i: i32 = 0; i < 8; i += 1) {
    out.push(toU8(toI32(v & toI64(255))));
    v = v >> toI64(8);
  }
  return out;
};`,
  strEq: `/** Equal characters, or both null. */
const strEq = (a: string | null, b: string | null): boolean => {
  if (a === null || b === null) {
    return a === null && b === null;
  }
  const n: i32 = toI32(a.length);
  if (n !== toI32(b.length)) {
    return false;
  }
  for (let i: i32 = 0; i < n; i += 1) {
    if (a.charCodeAt(i) !== b.charCodeAt(i)) {
      return false;
    }
  }
  return true;
};`,
  isNullStr: "const isNullStr = (s: string | null): boolean => s === null;",
  strOrNull: `/** \`s\` in double quotes, or \`null\` spelled out. */
const strOrNull = (s: string | null): string => {
  if (s !== null) {
    return \`"\${s}"\`;
  }
  return "null";
};`,
  shiftCase: `/** \`s\` with every byte in [lo, hi] moved by \`delta\` (ASCII case mapping). */
const shiftCase = (s: string, lo: i32, hi: i32, delta: i32): string => {
  const parts: string[] = [];
  const n: i32 = toI32(s.length);
  for (let i: i32 = 0; i < n; i += 1) {
    let c: i32 = toI32(s.charCodeAt(i));
    if (c >= lo && c <= hi) {
      c = c + delta;
    }
    parts.push(String.fromCharCode(c));
  }
  return parts.join("");
};`,
  utf8Bytes: `/** The bytes of \`s\`. */
const utf8Bytes = (s: string): u8[] => {
  const out: u8[] = [];
  const n: i32 = toI32(s.length);
  for (let i: i32 = 0; i < n; i += 1) {
    out.push(toU8(toI32(s.charCodeAt(i))));
  }
  return out;
};`,
  asciiOrNull: `/** \`b\` as a string, or null when any byte is not ASCII. */
const asciiOrNull = (b: u8[]): string | null => {
  for (const x of b) {
    if (toI32(x) >= 128) {
      return null;
    }
  }
  return String.fromBytes(b, 0, toI32(b.length));
};`,
  charAtStr: `/** The character at \`i\`, or "" out of range. */
const charAtStr = (s: string, i: i32): string => {
  if (i < 0 || i >= toI32(s.length)) {
    return "";
  }
  return s.slice(i, i + 1);
};`,
  copyBytes: `/** A fresh copy of \`b\`. */
const copyBytes = (b: u8[]): u8[] => {
  const out: u8[] = [];
  for (const x of b) {
    out.push(x);
  }
  return out;
};`,
  Unwrap: `/**
 * \`unwrap\` without exceptions: a null is recorded and stands in as no bytes,
 * and the sample that saw it fails.
 */
class Unwrap {
  sawNull: boolean

  constructor() {
    this.sawNull = false
  }

  get(b: u8[] | null): u8[] {
    if (b !== null) {
      return b
    }
    this.sawNull = true
    return []
  }
}`,
};

/** Spliced into Unwrap when a string? is unwrapped. */
const UNWRAP_STR = `
  str(s: string | null): string {
    if (s !== null) {
      return s
    }
    this.sawNull = true
    return ""
  }`;

const HELPER_DEPS: Record<string, string[]> = {
  hexOrNull: ["hexOf"],
  unhex: ["nibble"],
  flipBit: ["sliceBytes"],
  unwrapStr: ["Unwrap"],
};
const HELPER_ORDER = Object.keys(HELPERS);
/** Every helper the test can define, for the contract's TEST_NAMES. */
export const HELPER_NAMES = [...HELPER_ORDER, "unwrapStr"];

class Emitter {
  readonly used = new Set<string>();
  readonly fns: Map<string, FnSig>;
  /** The types of the names in scope: the forall vars, then let bindings. */
  vars = new Map<string, ValueTy>();

  constructor(readonly c: RfcContract) {
    this.fns = new Map(c.functions.map((f) => [f.name, f]));
  }

  use(h: string): string {
    this.used.add(h);
    for (const d of HELPER_DEPS[h] ?? []) this.use(d);
    return h;
  }

  /** What the test imports from nish:secret. */
  readonly secretNames = new Set<string>();
  /** What the test imports from nish:unsafe: the wrapping i64 operators. */
  readonly unsafeNames = new Set<string>();
  /** Plain-bytes wrappers of the functions that take or return a Secret. */
  readonly plainWrappers = new Map<string, string>();

  /**
   * A call of a contract function on emitted arguments. One that takes or
   * returns a `Secret<u8[]>` goes through a wrapper (plainWrapper), so the
   * rest of the test sees plain bytes.
   */
  call(sig: FnSig, args: string[]): string {
    const secret = (t: SigTy) => t !== valueTy(t);
    if (!secret(sig.returns) && !sig.params.some((p) => secret(p.type)))
      return `${sig.name}(${args.join(", ")})`;
    const name = `plain_${sig.name}`;
    if (!this.plainWrappers.has(name))
      this.plainWrappers.set(name, this.plainWrapper(sig, name));
    return `${name}(${args.join(", ")})`;
  }

  /**
   * `sig.name` on plain bytes, under nish's rules for a Secret: each secret
   * argument is a fresh copy wrapped with \`secret\` and wiped after the call;
   * a secret result is copied out with \`expose\`, then wiped.
   */
  plainWrapper(sig: FnSig, name: string): string {
    this.use("copyBytes");
    this.secretNames.add("Secret").add("wipe");
    const params = sig.params.map(
      (p) => `a_${p.name}: ${NISH_TY[valueTy(p.type)]}`,
    );
    const body: string[] = [];
    const wipes: string[] = [];
    const args = sig.params.map((p) => {
      if (p.type === valueTy(p.type)) return `a_${p.name}`;
      this.secretNames.add("secret");
      if (p.type === "secret-bytes") {
        body.push(
          `  const s_${p.name}: Secret<u8[]> = secret(copyBytes(a_${p.name}));`,
        );
        wipes.push(`  wipe(s_${p.name});`);
      } else {
        body.push(
          `  let s_${p.name}: Secret<u8[]> | null = null;`,
          `  if (a_${p.name} !== null) {`,
          `    s_${p.name} = secret(copyBytes(a_${p.name}));`,
          "  }",
        );
        wipes.push(
          `  if (s_${p.name} !== null) {`,
          `    wipe(s_${p.name});`,
          "  }",
        );
      }
      return `s_${p.name}`;
    });
    const call = `${sig.name}(${args.join(", ")})`;
    const ret = valueTy(sig.returns);
    if (sig.returns === "secret-bytes" || sig.returns === "secret-bytes?") {
      this.secretNames.add("expose");
      body.push(
        `  const r: Secret<u8[]>${ret === "bytes?" ? " | null" : ""} = ${call};`,
        ...wipes,
      );
      if (ret === "bytes?")
        body.push("  if (r === null) {", "    return null;", "  }");
      body.push(
        "  const out: u8[] = expose(r, copyBytes);",
        "  wipe(r);",
        "  return out;",
      );
    } else
      body.push(
        `  const r: ${NISH_TY[ret]} = ${call};`,
        ...wipes,
        "  return r;",
      );
    return [
      `/** ${sig.name} on plain bytes: secrets are copied in, wiped after. */`,
      `const ${name} = (${params.join(", ")}): ${NISH_TY[ret]} => {`,
      ...body,
      "};",
    ].join("\n");
  }

  bytesLit(b: Uint8Array): string {
    return `${this.use("unhex")}("${bytesToHex(b)}")`;
  }

  /** A literal at a known type. */
  literal(lit: Literal, ty: ValueTy | "null"): string {
    if ("null" in lit) return "null";
    if ("bool" in lit) return String(lit.bool);
    if ("int" in lit) return intLit(intValue(lit.int), intBase(ty) ?? "i32");
    if ("f64" in lit) return f64Lit(f64Value(lit));
    if ("str" in lit) return jsString(lit.str);
    return this.bytesLit(literalBytes(lit) as Uint8Array);
  }

  /** The type of a (contract-checked) expression in the current scope. */
  typeOf(e: Expr): ValueTy | "null" {
    const env = { fns: this.fns, vars: this.vars, allowCalls: true };
    return typeOf(e, env, "", []) as ValueTy | "null";
  }

  /**
   * `const` locals for the lets that open `e` (each evaluated once, in order),
   * pushed onto `out`; returns the expression they scope over.
   */
  bindings(assert: Expr, indent: string, out: string[]): Expr {
    let e = assert;
    while ("let" in e) {
      for (const b of e.let) {
        const ty = this.typeOf(b.value) as ValueTy;
        out.push(
          `${indent}const v_${b.name}: ${NISH_TY[ty]} = ${this.expr(b.value)};`,
        );
        this.vars.set(b.name, ty);
      }
      e = e.in;
    }
    return e;
  }

  /** An expression; contract names are emitted as `v_<name>` locals. */
  expr(e: Expr, want?: ValueTy): string {
    // An integer wanted at another integer type (only an i32 where a u32 is
    // wanted type-checks) is converted: Nish converts nothing on its own.
    const conv = (s: string, natural: ExprTy) => {
      const w = intBase(want);
      return w && w !== "i32" && natural !== w && isIntTy(natural)
        ? `${TO_INT[w as keyof typeof TO_INT]}(${s})`
        : s;
    };
    if ("var" in e) return conv(`v_${e.var}`, this.vars.get(e.var) as ValueTy);
    if ("call" in e) {
      const sig = this.fns.get(e.call) as FnSig;
      return this.call(
        sig,
        e.args.map((a, i) => this.expr(a, valueTy(sig.params[i].type))),
      );
    }
    if ("let" in e) throw new Error("a let may only open the assert");
    if (!("op" in e)) {
      const lit = e as Literal;
      return this.literal(lit, want ?? "bytes");
    }
    // The integer type of an arithmetic or comparison op's operands, which an
    // int literal among them is written at.
    const operands = () => {
      const t = e.args
        .map((x) => (isLiteral(x) ? null : this.typeOf(x)))
        .find(isIntTy);
      return t ?? (this.typeOf(e.args[0]) as ValueTy);
    };
    const a = (i: number, w?: ValueTy) => this.expr(e.args[i], w);
    const wrapU32 = (s: string) => conv(s, this.typeOf(e));
    switch (e.op) {
      case "len":
        return wrapU32(`toI32(${a(0)}.length)`);
      case "concat":
        return `${this.use("concatBytes")}(${a(0)}, ${a(1)})`;
      case "slice":
        return `${this.use("sliceBytes")}(${a(0)}, ${a(1)}, ${a(2)})`;
      case "zeros":
        return `${this.use("fillBytes")}(0, ${a(0)})`;
      case "fill":
        return `${this.use("fillBytes")}(${a(0)}, ${a(1)})`;
      case "flipBit":
        return `${this.use("flipBit")}(${a(0)}, ${a(1)})`;
      case "xor":
      case "bitAnd":
      case "bitOr":
        return `${this.use("bitwiseBytes")}(${a(0)}, ${a(1)}, ${["xor", "bitAnd", "bitOr"].indexOf(e.op)})`;
      case "unwrap":
        if (this.typeOf(e.args[0]) === "string?") {
          this.use("unwrapStr");
          return `u.str(${a(0)})`;
        }
        this.use("Unwrap");
        return `u.get(${a(0)})`;
      case "isNull":
      case "notNull": {
        const h =
          this.typeOf(e.args[0]) === "string?" ? "isNullStr" : "isNullBytes";
        return `${e.op === "notNull" ? "!" : ""}${this.use(h)}(${a(0)})`;
      }
      case "+":
      case "-":
      case "*": {
        const t = operands();
        if (t === "i64") {
          // Signed overflow panics in Nish; the contract wraps (evalPure), so
          // i64 goes through nish:unsafe's two's-complement wrap.
          const w = WRAPPING[e.op];
          this.unsafeNames.add(w);
          return `${w}(${a(0, t)}, ${a(1, t)})`;
        }
        return wrapU32(`(${a(0, t)} ${e.op} ${a(1, t)})`);
      }
      case "%": {
        // Through a helper, so a computed zero divisor gives 0 here exactly as
        // evalPure gives it when sampling `where`.
        const t = operands() as IntType;
        const h = this.use(remName(t));
        return wrapU32(`${h}(${a(0, t)}, ${a(1, t)})`);
      }
      case "le64":
        return `${this.use("le64")}(${a(0)})`;
      case "<":
      case "<=":
      case ">":
      case ">=": {
        const t = operands();
        return `(${a(0, t)} ${e.op} ${a(1, t)})`;
      }
      case "==":
      case "!=": {
        // A null literal takes its kind from the other side.
        const l = this.typeOf(e.args[0]);
        const side = l === "null" ? this.typeOf(e.args[1]) : l;
        const h = isBytesLike(side)
          ? "bytesEq"
          : isStringLike(side)
            ? "strEq"
            : null;
        if (h) {
          const eq = `${this.use(h)}(${a(0)}, ${a(1)})`;
          return e.op === "==" ? eq : `!${eq}`;
        }
        const t = isIntTy(side) ? operands() : undefined;
        return `(${a(0, t)} ${e.op === "==" ? "===" : "!=="} ${a(1, t)})`;
      }
      case "and":
        return `(${e.args.map((_, i) => a(i)).join(" && ")})`;
      case "or":
        return `(${e.args.map((_, i) => a(i)).join(" || ")})`;
      case "not":
        return `!${a(0)}`;
      case "implies":
        return `(!${a(0)} || ${a(1)})`;
      case "strLen":
        return wrapU32(`toI32(${a(0)}.length)`);
      case "strConcat":
        return `\`\${${a(0)}}\${${a(1)}}\``;
      case "lower":
        return `${this.use("shiftCase")}(${a(0)}, 65, 90, 32)`;
      case "upper":
        return `${this.use("shiftCase")}(${a(0)}, 97, 122, -32)`;
      case "utf8":
        return `${this.use("utf8Bytes")}(${a(0)})`;
      case "ascii":
        return `${this.use("asciiOrNull")}(${a(0)})`;
      case "charAt":
        return `${this.use("charAtStr")}(${a(0)}, ${a(1)})`;
    }
  }
}

/** A test name: "[id] title (covers R1, R2)". */
const testName = (k: Clause) => `[${k.id}] ${k.title} (${k.covers.join(", ")})`;

const jsString = (s: string) => JSON.stringify(s);

/**
 * Text that stays inside a `//` or `/** *\/` comment: control characters and
 * line separators become spaces and `*\/` cannot close the comment. The
 * contract gate refuses such text already; this keeps the emitter safe on
 * its own (a regenerate command holds a path, which may contain anything).
 */
export const commentText = (s: string) =>
  withoutControlChars(s).replace(/\*\//g, "* /");

const fnName = (k: Clause) => `clause_${k.id.replace(/[^A-Za-z0-9_]/g, "_")}`;

/** A source as a reader knows it: "RFC 8439", or its id for a spec that is not an RFC. */
function sourceName(c: RfcContract, id: string): string {
  const rfc = declaredSources(c).list.find((s) => s.id === id)?.rfc;
  return rfc ? `RFC ${rfc}` : id;
}

function docComment(c: RfcContract, k: Clause): string {
  const lines = ["/**", ` * ${commentText(k.title)}`];
  for (const id of k.covers) {
    const r = c.requirements.find((x) => x.id === id);
    if (!r) continue;
    lines.push(
      " *",
      ` * ${r.id} — ${sourceName(c, sourceOf(c, r.source))} §${r.section}, ${r.level}:`,
    );
    for (const l of wrap(r.quote, 72)) lines.push(` *   ${commentText(l)}`);
  }
  lines.push(" */");
  return lines.join("\n");
}

function wrap(text: string, width: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && cur.length + 1 + w.length > width) {
      out.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) out.push(cur);
  return out;
}

function emitVector(em: Emitter, k: VectorClause): string {
  const sig = em.fns.get(k.call) as FnSig;
  const call = em.call(
    sig,
    k.args.map((a, i) => em.literal(a, valueTy(sig.params[i].type))),
  );
  const name = jsString(testName(k));
  let body: string;
  switch (valueTy(sig.returns)) {
    case "bytes":
      body = `t.eqStr(${name}, ${em.use("hexOf")}(${call}), ${jsString(bytesToHex(literalBytes(k.expect) as Uint8Array))})`;
      break;
    case "bytes?": {
      const b = literalBytes(k.expect);
      body = `t.eqStr(${name}, ${em.use("hexOrNull")}(${call}), ${jsString(b ? bytesToHex(b) : "null")})`;
      break;
    }
    case "bool":
      body = `t.eqBool(${name}, ${call}, ${(k.expect as { bool: boolean }).bool})`;
      break;
    case "i32":
      body = `t.eqI32(${name}, ${call}, ${(k.expect as { int: number }).int})`;
      break;
    case "i64":
      body = `t.eqI64(${name}, ${call}, ${em.literal(k.expect, "i64")})`;
      break;
    case "u8":
    case "u16":
    case "u32":
    case "u64":
      body = `t.eqStr(${name}, \`\${${call}}\`, ${jsString(String((k.expect as { int: number | string }).int))})`;
      break;
    case "f64": {
      const want = em.literal(k.expect, "f64");
      const tol = k.tolerance;
      // nearF64 fails equal infinities and nearUlpsF64 fails every NaN, so a
      // non-finite expected value is checked bit for bit whatever the
      // tolerance (IEEE 754-2019 §5.11: a NaN is unordered with everything).
      if (!tol || !Number.isFinite(f64Value(k.expect as { f64: string })))
        body = `${em.use("eqF64Bits")}(t, ${name}, ${call}, ${want})`;
      else if (tol.abs !== undefined)
        body = `t.nearF64(${name}, ${call}, ${want}, ${f64Lit(parseF64(tol.abs))})`;
      else
        body = `${em.use("nearUlpsF64")}(t, ${name}, ${call}, ${want}, ${intLit(BigInt(tol.ulps), "i64")})`;
      break;
    }
    case "string":
      body = `t.eqStr(${name}, ${call}, ${jsString((k.expect as { str: string }).str)})`;
      break;
    case "string?": {
      const want = "str" in k.expect ? `"${k.expect.str}"` : "null";
      body = `t.eqStr(${name}, ${em.use("strOrNull")}(${call}), ${jsString(want)})`;
      break;
    }
    default:
      // refusals() has refused every other type already.
      throw new NishRefusal(`Nish cannot check a ${sig.returns} result`);
  }
  return `const ${fnName(k)} = (t: Suite): boolean => ${body};`;
}

function emitProperty(
  em: Emitter,
  k: PropertyClause,
  ps: PropertySamples,
): string {
  const name = jsString(testName(k));
  const count = ps.samples.length;
  const out: string[] = [];
  out.push(`const ${fnName(k)} = (t: Suite): boolean => {`);
  if (count === 0) {
    out.push(`  t.skip(${name}, "no samples");`, "  return true;", "};");
    return out.join("\n");
  }
  for (const v of k.forall) {
    if (v.type === "i32") {
      const vals = ps.samples.map((s) => String(s[v.name] as number));
      out.push(`  const table_${v.name}: i32[] = [${vals.join(", ")}];`);
    } else if (isIntTy(v.type)) {
      const t = v.type;
      const vals = ps.samples.map((s) =>
        intLit(BigInt(s[v.name] as number | bigint), t),
      );
      out.push(`  const table_${v.name}: ${t}[] = [${vals.join(", ")}];`);
    } else if (v.type === "f64") {
      throw new NishRefusal(NO_F64_FORALL);
    } else {
      if (v.type === "bytes") em.use("unhex");
      const vals = ps.samples.map((s) =>
        jsString(
          v.type === "bytes"
            ? bytesToHex(s[v.name] as Uint8Array)
            : (s[v.name] as string),
        ),
      );
      out.push(`  const table_${v.name}: string[] = [`);
      for (const x of vals) out.push(`    ${x},`);
      out.push("  ];");
    }
  }
  const usesUnwrap = JSON.stringify(k.assert).includes('"op":"unwrap"');
  out.push(`  for (let i: i32 = 0; i < ${count}; i += 1) {`);
  em.vars = new Map(k.forall.map((v) => [v.name, v.type]));
  for (const v of k.forall) {
    if (v.type === "bytes")
      out.push(`    const v_${v.name}: u8[] = unhex(table_${v.name}[i]);`);
    else out.push(`    const v_${v.name}: ${v.type} = table_${v.name}[i];`);
  }
  if (usesUnwrap) out.push("    const u: Unwrap = new Unwrap();");
  const body = em.bindings(k.assert, "    ", out);
  out.push(`    const holds: boolean = ${em.expr(body)};`);
  const failCond = usesUnwrap ? "u.sawNull || !holds" : "!holds";
  const shown = k.forall
    .map((v) =>
      isIntTy(v.type)
        ? `${v.name} = \${v_${v.name}}`
        : `len(${v.name}) = \${toI32(v_${v.name}.length)}`,
    )
    .join(", ");
  out.push(`    if (${failCond}) {`);
  if (usesUnwrap) {
    out.push(`      let why: string = "the assertion is false";`);
    out.push(
      "      if (u.sawNull) {",
      `        why = "unwrap met a null";`,
      "      }",
    );
    out.push(
      `      return t.fail(${name}, \`sample \${i + 1} of ${count} (${shown}): \${why}\`);`,
    );
  } else {
    out.push(
      `      return t.fail(${name}, \`sample \${i + 1} of ${count} (${shown}): the assertion is false\`);`,
    );
  }
  out.push("    }", "  }");
  out.push(
    `  return t.pass(${jsString(`${testName(k)} — ${count} samples`)});`,
    "};",
  );
  return out.join("\n");
}

export interface EmitOptions {
  /** Shown in the header: how to regenerate the file. */
  regenerate?: string;
  /**
   * The sha256 of the contract file's bytes, written as a
   * `// vector-contract-sha256: <hex>` line that `vector spec stale` checks.
   */
  contractSha256?: string;
}

export const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

/** The hex of each `// vector-contract-sha256: <hex>` line in a test. */
export const contractShaLines = (test: string): string[] =>
  [...test.matchAll(/^\/\/ vector-contract-sha256: ([0-9a-f]{64})$/gm)].map(
    (m) => m[1],
  );

/**
 * Whether a generated test was emitted from these contract bytes: null when
 * it was, else why not. A test with no `vector-contract-sha256` line, or more
 * than one, is refused, as is one naming other bytes.
 */
export function staleReason(
  test: string,
  contractBytes: Uint8Array,
): string | null {
  const found = contractShaLines(test);
  if (found.length === 0)
    return "no `// vector-contract-sha256: <hex>` line: regenerate it with vector spec emit";
  if (found.length > 1)
    return `${found.length} vector-contract-sha256 lines: a test names one contract`;
  const want = sha256(contractBytes);
  if (found[0] !== want)
    return `stale: emitted from a contract with sha256 ${found[0]}, but the contract's is ${want}: regenerate it with vector spec emit`;
  return null;
}

/**
 * What in `c` Nish cannot express, refused before any output: a non-nish
 * module, an i8 or i16, a nullable bool, integer or f64 (Nish has `T | null`
 * only on a reference type), and an f64 forall variable.
 */
function refusals(c: RfcContract): void {
  for (const m of [c.target.module, ...c.functions.map((f) => f.module)])
    if (m !== undefined && nishModuleFile(m) === undefined)
      throw new NishRefusal(
        `Nish is the only emitter, and ${m} is not a nish/ module`,
      );
  for (const f of c.functions)
    for (const [at, t] of [
      ...f.params.map((p) => [`${f.name}(${p.name})`, p.type] as const),
      [`${f.name}'s result`, f.returns] as const,
    ]) {
      const base = baseOf(t);
      if (base === "i8" || base === "i16")
        throw new NishRefusal(`${at} is ${t}: ${NO_SMALL_INT}`);
      if (isOptional(t) && (base === "bool" || base === "f64" || isIntTy(base)))
        throw new NishRefusal(
          `${at} is ${t}: Nish has \`T | null\` only on a reference type`,
        );
    }
  for (const k of c.clauses)
    if (k.kind === "property")
      for (const v of k.forall) {
        if (v.type === "f64")
          throw new NishRefusal(`${k.id}: ${v.name} is f64: ${NO_F64_FORALL}`);
        if (v.type === "i8" || v.type === "i16")
          throw new NishRefusal(
            `${k.id}: ${v.name} is ${v.type}: ${NO_SMALL_INT}`,
          );
      }
}

/** The whole test program; throws a NishRefusal for what Nish cannot express. */
export function emitNishTest(
  c: RfcContract,
  samples: Map<string, PropertySamples>,
  opts: EmitOptions = {},
): string {
  refusals(c);
  const em = new Emitter(c);
  const bodies: string[] = [];
  const called = new Set<string>();
  for (const k of c.clauses) {
    if (k.kind === "vector") {
      called.add(k.call);
      bodies.push(`${docComment(c, k)}\n${emitVector(em, k)}`);
    } else {
      callsIn(k.assert, called);
      const ps = samples.get(k.id) ?? {
        clauseId: k.id,
        samples: [],
        boundary: 0,
        random: 0,
        inhabited: "failed" as const,
        notes: [],
      };
      bodies.push(`${docComment(c, k)}\n${emitProperty(em, k, ps)}`);
    }
  }
  const header = [
    `// GENERATED by vector from the contract "${c.contract}" (${sourceName(c, declaredSources(c).main)},`,
    `// ${commentText(c.source.title)}). Do not edit: change the contract and regenerate${opts.regenerate ? ` with\n//   ${commentText(opts.regenerate)}` : ""}.`,
    "//",
    "// Each check names its clause in brackets and the requirements it covers in",
    "// parentheses; every requirement's RFC text is quoted above its checks.",
    "// Property samples were chosen by Z3 (boundaries) and a seeded PRNG.",
    ...(opts.contractSha256
      ? ["//", `// vector-contract-sha256: ${opts.contractSha256}`]
      : []),
  ];
  const byModule = new Map<string, string[]>();
  for (const name of [...called].sort()) {
    const mod = em.fns.get(name)?.module ?? c.target.module;
    byModule.set(mod, [...(byModule.get(mod) ?? []), name]);
  }
  const imports = [
    `import { Suite } from "nish/testing";`,
    ...[...byModule.entries()].map(
      ([mod, names]) => `import { ${names.join(", ")} } from ${jsString(mod)};`,
    ),
    ...(em.secretNames.size > 0
      ? [
          `import { ${["Secret", "expose", "secret", "wipe"].filter((n) => em.secretNames.has(n)).join(", ")} } from "nish:secret";`,
        ]
      : []),
    ...(em.unsafeNames.size > 0
      ? [
          `import { ${[...em.unsafeNames].sort().join(", ")} } from "nish:unsafe";`,
        ]
      : []),
  ];
  const helpers = [
    ...HELPER_ORDER.filter((h) => em.used.has(h)).map((h) =>
      h === "Unwrap" && em.used.has("unwrapStr")
        ? HELPERS.Unwrap.replace(/\n\}$/, `\n${UNWRAP_STR}\n}`)
        : HELPERS[h],
    ),
    ...[...em.plainWrappers.keys()]
      .sort()
      .map((k) => em.plainWrappers.get(k) as string),
  ];
  // `main` records what each clause returned and, once the suite is done,
  // prints it after the nonce `spec run` passes as the first argument. A
  // module that exits early or prints its own PASS lines can't produce a
  // matching end line (see checkTranscript in run.ts).
  const main = [
    "export const main = (): i32 => {",
    `  const t: Suite = new Suite(${jsString(c.contract)});`,
    `  let ran: string = "";`,
    ...c.clauses.map(
      (k) => `  ran = \`\${ran}\${${fnName(k)}(t) ? "1" : "0"}\`;`,
    ),
    "  const code: i32 = t.done();",
    `  const nonce: string = toI32(process.argv.length) > 1 ? process.argv[1] : "-";`,
    "  console.log(`vector-done ${nonce} ${ran}`);",
    "  return code;",
    "};",
  ];
  return `${[header.join("\n"), imports.join("\n"), ...helpers, ...bodies, main.join("\n")].join("\n\n")}\n`;
}

export { NISH_TY };
