/**
 * `spec/emit/helpers` — the Nish helpers an emitted test may define. Each is
 * spelled for one type, since Nish has no generics, and a test defines only
 * the ones it uses, in the order `emitHelperNames` gives.
 */

import { emitToInt } from "./lit"

/**
 * Every helper a test can define, in the order a test defines them.
 * `unwrapStr` is not a helper of its own: it adds `str` to `Unwrap`.
 *
 * @returns the helper names
 */
export const emitHelperNames = (): string[] => [
  "hexOf",
  "hexPrefix",
  "hexOrNull",
  "unhex",
  "nibble",
  "bytesEq",
  "isNullBytes",
  "concatBytes",
  "sliceBytes",
  "fillBytes",
  "flipBit",
  "bitwiseBytes",
  "remI32",
  "remI64",
  "remU8",
  "remU16",
  "remU32",
  "remU64",
  "eqF64Bits",
  "nearUlpsF64",
  "intBytes",
  "strEq",
  "isNullStr",
  "strOrNull",
  "shiftCase",
  "utf8Bytes",
  "asciiOrNull",
  "charAtStr",
  "copyBytes",
  "wordHex",
  "wordsHex16",
  "wordsHex32",
  "wordsHex64",
  "Unwrap",
  "unwrapStr",
  "bytesInt",
  "OutFault",
]

/**
 * The helpers a helper calls, which a test using it must define too.
 *
 * @param name a helper name
 * @returns the helpers it needs
 */
export const emitHelperDeps = (name: string): string[] => {
  if (name === "hexOrNull" || name === "hexPrefix") {
    return ["hexOf"]
  }
  if (name === "unhex") {
    return ["nibble"]
  }
  if (name === "flipBit") {
    return ["sliceBytes"]
  }
  if (name === "unwrapStr" || name === "bytesInt") {
    return ["Unwrap"]
  }
  if (name === "wordsHex16" || name === "wordsHex32" || name === "wordsHex64") {
    return ["wordHex"]
  }
  return []
}

/**
 * The contract's `a % b` at an integer type other than i32: truncating, and 0
 * when `b` is 0, or -1 for a signed type, as the sampler evaluates it.
 */
const emitHelperRem = (t: string): string => {
  const to = emitToInt(t)
  // Bare literals, which the no-panic checker reads as the divisor's bounds.
  const nonzero = t === "i64" ? "b !== 0 && b !== -1" : `b !== ${to}(0)`
  return `const rem${to.substring(2, 5)} = (a: ${t}, b: ${t}): ${t} => {
  if (${nonzero}) {
    return a % b;
  }
  return ${to}(0);
};`
}

/**
 * A word array of `u<n>` words as the contract prints it, each word in its
 * full width of hex digits, or `null` spelled out.
 */
const emitHelperWordsHex = (n: string): string => {
  const widen = n === "64" ? "x" : "toU64(x)"
  const digits = n === "16" ? 4 : n === "32" ? 8 : 16
  return `/** \`w\` as bracketed hex words, or \`null\` spelled out. */
const wordsHex${n} = (w: u${n}[] | null): string => {
  if (w === null) {
    return "null";
  }
  const parts: string[] = [];
  for (const x of w) {
    parts.push(wordHex(${widen}, ${digits}));
  }
  return \`[\${parts.join(" ")}]\`;
};`
}

/**
 * A helper's definition, as the emitted test spells it.
 *
 * @param name a helper from emitHelperNames, but not `unwrapStr`
 * @param withStr for `Unwrap`, whether to add its `str` method
 * @returns the definition, or "" for an unknown name
 */
export const emitHelperText = (name: string, withStr: boolean): string => {
  for (const n of ["16", "32", "64"]) {
    if (name === `wordsHex${n}`) {
      return emitHelperWordsHex(n)
    }
  }
  if (name === "wordHex") {
    return `/** \`v\`'s low \`digits\` hex digits, in lowercase. */
const wordHex = (v: u64, digits: i32): string => {
  const hex: string = "0123456789abcdef";
  const parts: string[] = [];
  for (let i: i32 = 15; i >= 0; i -= 1) {
    if (i < digits) {
      const d: i32 = toI32((v >> toU64(i * 4)) & toU64(15));
      parts.push(hex.substring(d, d + 1));
    }
  }
  return parts.join("");
};`
  }
  for (const t of ["i64", "u8", "u16", "u32", "u64"]) {
    if (name === `rem${emitToInt(t).substring(2, 5)}`) {
      return emitHelperRem(t)
    }
  }
  if (name === "hexOf") {
    return `/** \`bytes\` as lowercase hex, the way the RFC prints them. */
const hexOf = (bytes: u8[]): string => {
  const digits: string = "0123456789abcdef";
  const parts: string[] = [];
  for (const b of bytes) {
    const v: i32 = toI32(b);
    parts.push(digits.substring(v >> 4, (v >> 4) + 1));
    parts.push(digits.substring(v & 15, (v & 15) + 1));
  }
  return parts.join("");
};`
  }
  if (name === "hexPrefix") {
    return `/** The first \`n\` bytes of \`bytes\` as hex; a shorter result says so, and never matches. */
const hexPrefix = (bytes: u8[], n: i32): string => {
  const have: i32 = toI32(bytes.length);
  if (have < n) {
    return \`a \${have}-byte result, shorter than the \${n} bytes it is truncated to\`;
  }
  const head: u8[] = [];
  for (let i: i32 = 0; i < n; i += 1) {
    if (i < bytes.length) {
      head.push(bytes[i]);
    }
  }
  return hexOf(head);
};`
  }
  if (name === "hexOrNull") {
    return `/** \`bytes\` as hex, or \`null\` spelled out. */
const hexOrNull = (bytes: u8[] | null): string => {
  if (bytes !== null) {
    return hexOf(bytes);
  }
  return "null";
};`
  }
  if (name === "unhex") {
    return `/** The bytes a lowercase hex string spells. */
const unhex = (hex: string): u8[] => {
  const out: u8[] = [];
  const n: i32 = toI32(hex.length);
  for (let i: i32 = 0; i < n - 1; i += 2) {
    if (i + 1 < hex.length) {
      out.push(toU8((nibble(hex.charCodeAt(i)) << 4) | nibble(hex.charCodeAt(i + 1))));
    }
  }
  return out;
};`
  }
  if (name === "nibble") {
    return `/** One lowercase hex digit's value (0 for any other character). */
const nibble = (c: number): i32 => {
  const v: i32 = toI32(c);
  if (v >= 97 && v <= 102) {
    return v - 87;
  }
  if (v >= 48 && v <= 57) {
    return v - 48;
  }
  return 0;
};`
  }
  if (name === "bytesEq") {
    return `/** Equal contents, or both null. */
const bytesEq = (a: u8[] | null, b: u8[] | null): boolean => {
  if (a === null || b === null) {
    return a === null && b === null;
  }
  const x: u8[] = a;
  const y: u8[] = b;
  if (x.length !== y.length) {
    return false;
  }
  for (let i: i32 = 0; i < toI32(x.length); i += 1) {
    if (i < y.length && x[i] !== y[i]) {
      return false;
    }
  }
  return true;
};`
  }
  if (name === "isNullBytes") {
    return "const isNullBytes = (b: u8[] | null): boolean => b === null;"
  }
  if (name === "concatBytes") {
    return `const concatBytes = (a: u8[], b: u8[]): u8[] => {
  const out: u8[] = [];
  for (const x of a) {
    out.push(x);
  }
  for (const x of b) {
    out.push(x);
  }
  return out;
};`
  }
  if (name === "sliceBytes") {
    return `/** \`b[from, to)\`, both ends clamped into the array. */
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
    if (i >= 0 && i < b.length) {
      out.push(b[i]);
    }
  }
  return out;
};`
  }
  if (name === "fillBytes") {
    return `/** \`n\` copies of the byte \`v\` (none when n < 0). */
const fillBytes = (v: i32, n: i32): u8[] => {
  const out: u8[] = [];
  for (let i: i32 = 0; i < n; i += 1) {
    out.push(toU8(v & 255));
  }
  return out;
};`
  }
  if (name === "flipBit") {
    return `/** A copy of \`b\` with bit \`bit\` (mod 8 * length) inverted. */
const flipBit = (b: u8[], bit: i32): u8[] => {
  const out: u8[] = sliceBytes(b, 0, toI32(b.length));
  const n: i32 = toI32(b.length);
  if (n <= 0 || n > 268435455) {
    return out;
  }
  const bits: i32 = n * 8;
  const r: i32 = bit % bits;
  const at: i32 = r < 0 ? r + bits : r;
  const byte: i32 = at >> 3;
  const mask: i32 = 1 << (at & 7);
  if (byte >= 0 && byte < out.length) {
    out[byte] = toU8(toI32(out[byte]) ^ mask);
  }
  return out;
};`
  }
  if (name === "bitwiseBytes") {
    return `/**
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
    if (i < na && i < a.length) {
      x = toI32(a[i]);
    }
    let y: i32 = 0;
    if (i < nb && i < b.length) {
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
};`
  }
  if (name === "remI32") {
    return `/**
 * The contract's \`a % b\`: truncating, and 0 when \`b\` is 0. A divisor of -1
 * also gives 0, which is what truncating % gives, without the overflow that
 * \`-2147483648 % -1\` can trap on.
 */
const remI32 = (a: i32, b: i32): i32 => {
  if (b === 0 || b === -1) {
    return 0;
  }
  return a % b;
};`
  }
  if (name === "eqF64Bits") {
    return `/** \`actual\` and \`expected\` the same binary64, bit for bit (IEEE 754-2019 §3.4). */
const eqF64Bits = (t: Suite, name: string, actual: f64, expected: f64): boolean => {
  if (f64ToBits(actual) === f64ToBits(expected)) {
    return t.pass(name);
  }
  return t.fail(name, \`expected \${expected}, got \${actual} (other binary64 bits)\`);
};`
  }
  if (name === "nearUlpsF64") {
    return `/**
 * \`actual\` at most \`ulps\` binary64 units in the last place from
 * \`expected\`: their distance on the line of ordered bit patterns, where
 * consecutive doubles differ by one and -0 meets +0 (IEEE 754-2019 §3.4).
 * A NaN is never near anything.
 */
const nearUlpsF64 = (t: Suite, name: string, actual: f64, expected: f64, ulps: i64): boolean => {
  const lo: i64 = -9007199254740992;
  const sign: i64 = lo << 10;
  const x: i64 = f64ToBits(actual);
  const y: i64 = f64ToBits(expected);
  const mx: i64 = x & ~sign;
  const my: i64 = y & ~sign;
  let near: boolean = false;
  if (ulps >= 0 && mx >= 0 && my >= 0) {
    if ((x < 0) === (y < 0)) {
      near = mx >= my ? mx - my <= ulps : my - mx <= ulps;
    } else {
      near = mx <= ulps && my <= ulps - mx;
    }
  }
  if (actual !== actual || expected !== expected) {
    near = false;
  }
  if (near) {
    return t.pass(name);
  }
  return t.fail(name, \`expected \${expected} within \${ulps} ulps, got \${actual}\`);
};`
  }
  if (name === "intBytes") {
    return `/** The low \`w\` bytes of \`n\`'s bits, little-endian, or big-endian when \`be\`. */
const intBytes = (n: u64, w: i32, be: boolean): u8[] => {
  const out: u8[] = [];
  for (let i: i32 = 0; i < w; i += 1) {
    const k: i32 = be ? w - 1 - i : i;
    if (k >= 0 && k < 8) {
      out.push(toU8(n >> toU64(k * 8)));
    }
  }
  return out;
};`
  }
  if (name === "bytesInt") {
    return `/**
 * \`b\` as a \`w\`-byte integer, little-endian, or big-endian when \`be\`. Any
 * other length is recorded on \`u\`, as a null is, and reads as 0.
 */
const bytesInt = (u: Unwrap, b: u8[], w: i32, be: boolean): u64 => {
  if (toI32(b.length) !== w) {
    u.sawNull = true;
    return toU64(0);
  }
  let v: u64 = toU64(0);
  for (let i: i32 = 0; i < w; i += 1) {
    const k: i32 = be ? i : w - 1 - i;
    if (k >= 0 && k < b.length) {
      v = (v << toU64(8)) | toU64(b[k]);
    }
  }
  return v;
};`
  }
  if (name === "strEq") {
    return `/** Equal characters, or both null. */
const strEq = (a: string | null, b: string | null): boolean => {
  if (a === null || b === null) {
    return a === null && b === null;
  }
  const x: string = a;
  const y: string = b;
  if (x.length !== y.length) {
    return false;
  }
  for (let i: i32 = 0; i < toI32(x.length); i += 1) {
    if (i < y.length && x.charCodeAt(i) !== y.charCodeAt(i)) {
      return false;
    }
  }
  return true;
};`
  }
  if (name === "isNullStr") {
    return "const isNullStr = (s: string | null): boolean => s === null;"
  }
  if (name === "strOrNull") {
    return `/** \`s\` in double quotes, or \`null\` spelled out. */
const strOrNull = (s: string | null): string => {
  if (s !== null) {
    return \`"\${s}"\`;
  }
  return "null";
};`
  }
  if (name === "shiftCase") {
    return `/** \`s\` with every ASCII letter in upper case, or in lower case when not \`upper\`. */
const shiftCase = (s: string, upper: boolean): string => {
  const parts: string[] = [];
  const n: i32 = toI32(s.length);
  for (let i: i32 = 0; i < n; i += 1) {
    let c: i32 = toI32(s.charCodeAt(i));
    if (upper && c >= 97 && c <= 122) {
      c = c - 32;
    }
    if (!upper && c >= 65 && c <= 90) {
      c = c + 32;
    }
    parts.push(String.fromCharCode(c));
  }
  return parts.join("");
};`
  }
  if (name === "utf8Bytes") {
    return `/** The bytes of \`s\`. */
const utf8Bytes = (s: string): u8[] => {
  const out: u8[] = [];
  const n: i32 = toI32(s.length);
  for (let i: i32 = 0; i < n; i += 1) {
    out.push(toU8(toI32(s.charCodeAt(i))));
  }
  return out;
};`
  }
  if (name === "asciiOrNull") {
    return `/** \`b\` as a string, or null when any byte is not ASCII. */
const asciiOrNull = (b: u8[]): string | null => {
  for (const x of b) {
    if (toI32(x) >= 128) {
      return null;
    }
  }
  return String.fromBytes(b, 0, toI32(b.length));
};`
  }
  if (name === "charAtStr") {
    return `/** The character at \`i\`, or "" out of range. */
const charAtStr = (s: string, i: i32): string => {
  if (i < 0 || i >= toI32(s.length)) {
    return "";
  }
  return s.slice(i, i + 1);
};`
  }
  if (name === "copyBytes") {
    return `/** A fresh copy of \`b\`. */
const copyBytes = (b: u8[]): u8[] => {
  const out: u8[] = [];
  for (const x of b) {
    out.push(x);
  }
  return out;
};`
  }
  if (name === "OutFault") {
    return EMIT_OUT_FAULT
  }
  if (name === "Unwrap") {
    const unwrap = `/**
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
  }`
    return withStr ? `${unwrap}\n${EMIT_UNWRAP_STR}\n}` : `${unwrap}\n}`
  }
  return ""
}

/** Spliced into `Unwrap` when a `string?` is unwrapped. */
const EMIT_UNWRAP_STR: string = `
  str(s: string | null): string {
    if (s !== null) {
      return s
    }
    this.sawNull = true
    return ""
  }`

/**
 * The check of an out buffer's write: the buffer is filled with 0xa5, so a
 * byte changed before `at` or from `end` on shows.
 */
const EMIT_OUT_FAULT: string = `/**
 * An out buffer's write, checked without exceptions: the first capacity not
 * at most 2^20 (NaN included), end outside [at, at + capacity], or byte changed outside [at, end),
 * is recorded, the call stands in as no bytes, and the clause that saw it
 * fails.
 */
class OutFault {
  why: string

  constructor() {
    this.why = ""
  }

  note(why: string): void {
    if (this.why.length === 0) {
      this.why = why
    }
  }

  cap(fn: string, c: f64): i32 {
    if (!(c <= 1048576.0)) {
      this.note(\`\${fn}'s capacity is \${c} on this sample, not at most 2^20\`)
      return -1
    }
    return toI32(c)
  }

  take(fn: string, o: u8[], at: i32, end: i32, cap: i32): u8[] {
    if (end < at || end > at + cap) {
      this.note(\`\${fn} returned end \${end} outside [at, at + capacity] = [\${at}, \${at + cap}]\`)
      return []
    }
    for (let i: i32 = 0; i < toI32(o.length); i += 1) {
      if ((i < at || i >= end) && o[i] !== toU8(0xa5)) {
        this.note(\`\${fn} wrote outside [at, end) = [\${at}, \${end}), at \${i}\`)
        return []
      }
    }
    const out: u8[] = []
    for (let i: i32 = at; i < end; i += 1) {
      out.push(o[i])
    }
    return out
  }
}`
