/**
 * `spec/emit/lit` — contract values as Nish source text: integers at their
 * type, f64s, string literals, and the bytes a literal stands for.
 */

import { toHex, utf8Bytes } from "../../core/hex"
import { charsCodePointAt, charsIsControl, charsSequenceLength } from "../contract/chars"
import { contractF64Bits, contractF64Parse } from "../contract/f64"
import { LitKind, Literal } from "../contract/types"
import { vocabCompareDecimal, vocabFitsInt } from "../contract/vocab"

/**
 * Nish's conversion into an integer type other than i32: `toI64`, `toU8`, ….
 *
 * @param t an integer type
 * @returns the conversion's name
 */
export const emitToInt = (t: string): string => {
  const upper = t.startsWith("i") ? "I" : "U"
  return `to${upper}${t.substring(1, t.length)}`
}

/** `s`, in parentheses when it starts with a minus. */
const emitNeg = (s: string): string => (s.startsWith("-") ? `(${s})` : s)

/** A decimal magnitude's value; the caller keeps it within u64. */
const emitParseU64 = (digits: string): u64 => {
  let m: u64 = toU64(0)
  for (let i = 0; i < digits.length; i++) {
    m = m * toU64(10) + toU64(toI32(digits.charCodeAt(i)) - 48)
  }
  return m
}

/**
 * The integer `text` as a Nish expression of type `ty`. A Nish numeric
 * literal is an i32 unless its context types it, and exact only up to 2^53,
 * so: an i32 is the literal; a value that fits i32 is converted; a larger one
 * is typed by a `toT(0) +` beside it; one past 2^53 is built as
 * hi * 2^32 + lo, each part exact and no step out of the type's range.
 *
 * @param text the value in decimal, within `ty`'s range
 * @param ty an integer type other than i8 and i16
 * @returns the expression
 */
export const emitIntLit = (text: string, ty: string): string => {
  if (ty === "i32") {
    return emitNeg(text)
  }
  const to = emitToInt(ty)
  if (vocabFitsInt(text, "i32")) {
    return `${to}(${text})`
  }
  const negative = text.startsWith("-")
  const mag = negative ? text.substring(1, text.length) : text
  if (vocabCompareDecimal(mag, "9007199254740992") <= 0) {
    return `(${to}(0) + ${emitNeg(text)})`
  }
  const m = emitParseU64(mag)
  const q: u64 = m >> toU64(32)
  const low32: u64 = (toU64(1) << toU64(32)) - toU64(1)
  const r: u64 = m & low32
  if (!negative) {
    return `(${emitIntLit(`${q}`, ty)} * 4294967296 + ${r})`
  }
  // -m = hi * 2^32 + lo with 0 <= lo < 2^32: hi rounds -m / 2^32 down.
  if (r === toU64(0)) {
    return `(${emitIntLit(`-${q}`, ty)} * 4294967296 + 0)`
  }
  const lo: u64 = low32 - r + toU64(1)
  return `(${emitIntLit(`-${q + toU64(1)}`, ty)} * 4294967296 + ${lo})`
}

/** Whether 16 hex digits of binary64 bits are a NaN or an infinity. */
const emitBitsNonFinite = (bits: string): boolean => {
  const top = bits.substring(0, 3)
  return top === "7ff" || top === "fff"
}

/** 16 hex digits as the i64 with those bits, in decimal. */
const emitBitsDecimal = (bits: string): string => {
  let u: u64 = toU64(0)
  for (let i = 0; i < bits.length; i++) {
    const c = toI32(bits.charCodeAt(i))
    const d = c >= 97 ? c - 87 : c - 48
    u = (u << toU64(4)) | toU64(d)
  }
  if ((u >> toU64(63)) === toU64(0)) {
    return `${u}`
  }
  return `-${~u + toU64(1)}`
}

/**
 * Whether an f64 is finite, from its text or its bits.
 *
 * @param text the value's text
 * @param bits its binary64 bits as 16 hex digits, or null to read `text`
 * @returns false for a NaN or an infinity
 */
export const emitF64IsFinite = (text: string, bits: string | null): boolean =>
  !emitBitsNonFinite(bits ?? contractF64Bits(contractF64Parse(text)))

/**
 * An f64 as a Nish expression: the shortest decimal that reads back to the
 * same binary64, through `toF64` so its context is f64; -0, the infinities
 * and NaN, which no decimal literal spells, from their bits.
 *
 * @param text the value's text
 * @param bits its binary64 bits as 16 hex digits, or null to read `text`
 * @returns the expression
 */
export const emitF64Lit = (text: string, bits: string | null): string => {
  const b = bits ?? contractF64Bits(contractF64Parse(text))
  if (emitBitsNonFinite(b) || b === "8000000000000000") {
    return `bitsToF64(${emitIntLit(emitBitsDecimal(b), "i64")})`
  }
  const shown = `${contractF64Parse(text)}`
  const out: string[] = []
  let point = false
  for (let i = 0; i < shown.length; i++) {
    const ch = shown.substring(i, i + 1)
    if (ch === "." || ch === "e") {
      point = true
    }
    if (!(ch === "+" && i > 0 && shown.substring(i - 1, i) === "e")) {
      out.push(ch)
    }
  }
  if (!point) {
    out.push(".0")
  }
  return `toF64(${out.join("")})`
}

const emitHexDigit = (v: i32): string => "0123456789abcdef".substring(v, v + 1)

/**
 * Text as a Nish string literal: quotes, backslashes and control characters
 * escaped, everything else as written.
 *
 * @param s the text
 * @returns it in double quotes
 */
export const emitQuote = (s: string): string => {
  const out: string[] = ['"']
  let j = 0
  while (j < s.length) {
    const cp = charsCodePointAt(s, j)
    const n = charsSequenceLength(s, j)
    if (cp === 0x22 || cp === 0x5c) {
      out.push(`\\${s.substring(j, j + 1)}`)
    } else if (cp === 0x0a) {
      out.push("\\n")
    } else if (cp === 0x09) {
      out.push("\\t")
    } else if (cp === 0x0d) {
      out.push("\\r")
    } else if (cp < 0x20 || cp === 0x7f) {
      out.push(`\\u00${emitHexDigit(cp >> 4)}${emitHexDigit(cp & 15)}`)
    } else {
      out.push(s.substring(j, j + n))
    }
    j += n
  }
  out.push('"')
  return out.join("")
}

/**
 * Text that stays inside a `//` or a doc comment: control characters and
 * line separators become spaces, and `*` `/` cannot close the comment.
 *
 * @param s the text
 * @returns it, safe in a comment
 */
export const emitCommentText = (s: string): string => {
  const out: string[] = []
  let j = 0
  while (j < s.length) {
    const cp = charsCodePointAt(s, j)
    const n = charsSequenceLength(s, j)
    if (charsIsControl(cp)) {
      out.push(" ")
    } else if (cp === 0x2f && j > 0 && s.charCodeAt(j - 1) === 0x2a) {
      out.push(" /")
    } else {
      out.push(s.substring(j, j + n))
    }
    j += n
  }
  return out.join("")
}

/**
 * The bytes a bytes literal stands for, as lowercase hex: a hex literal
 * repeated, an ascii literal's characters, or a concat's parts in order.
 *
 * @param lit a hex, ascii, str or concat literal
 * @returns the hex digits, two per byte
 */
export const emitLiteralHex = (lit: Literal): string => {
  if (lit.kind === LitKind.Concat) {
    const parts: string[] = []
    for (const p of lit.parts) {
      parts.push(emitLiteralHex(p))
    }
    return parts.join("")
  }
  if (lit.kind !== LitKind.Hex) {
    return toHex(utf8Bytes(lit.text))
  }
  const digits: string[] = []
  for (let i = 0; i < lit.text.length; i++) {
    const c = toI32(lit.text.charCodeAt(i))
    if ((c >= 48 && c <= 57) || (c >= 97 && c <= 102)) {
      digits.push(lit.text.substring(i, i + 1))
    } else if (c >= 65 && c <= 70) {
      digits.push(emitHexDigit(c - 55))
    }
  }
  const one = digits.join("")
  const times = lit.repeat < 0 ? 1 : lit.repeat
  const out: string[] = []
  for (let i = 0; i < times; i++) {
    out.push(one)
  }
  return out.join("")
}
