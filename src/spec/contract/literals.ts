/**
 * `spec/contract/literals` — the vector table's Call and Expected cells:
 * `hexDecode("66")`, `"f"`, `[00 0f]`, `Key = 00ff`, `L = 42`, `22 x 0b`,
 * `concat([00], [ff])`. A cell is read in two steps. First its text is
 * parsed into raw literals, which do not yet know whether a quoted string is
 * bytes or text. Then the callee's signature settles each one: a quoted
 * string where bytes go becomes `{ascii}`, and where a string goes `{str}`;
 * `L = 42` is the int 42 where an int goes and the byte 0x42 anywhere else.
 * Reading `"f"` the same way in both places would make the contract say
 * something the table does not.
 *
 * Numbers keep their text: an int is its decimal digits (written as a JSON
 * string once it passes 2^53 - 1), and an f64 carries its text and the
 * binary64 encoding that text reads as.
 */

import { charsCodePointAt, charsFromCodePoint, charsIsStringText, charsSequenceLength } from "./chars"
import { contractF64Bits, contractF64Overflows, contractF64Parse } from "./f64"
import { FnSig, LitKind, Literal } from "./types"
import { typeIntBase, typeLiteralFits, typeOfLiteral } from "./typing"
import { vocabIsJsonSafe, vocabValueType } from "./vocab"

/** The form a cell writes a literal in, before a type settles it. */
export enum RawKind {
  /** `"text"`: bytes or a string, as the type says. */
  Str = 0,
  /** `[00 0f]`. */
  Bytes = 1,
  /** `(empty)`: no bytes. */
  Empty = 2,
  /** `null`. */
  Null = 3,
  /** `true` or `false`. */
  Bool = 4,
  /** A decimal integer. */
  Int = 5,
  /** `1.5`, `-2e-3`, `NaN`, `Infinity`. */
  F64 = 6,
  /** `Key = 00ff`. */
  Labelled = 7,
  /** `L = 42`: an int where an int goes, else hex pairs when the digits are some. */
  LabelledInt = 8,
  /** `22 x 0b`: a run of bytes written `count` times. */
  Repeat = 9,
  /** `concat(a, b)`. */
  Concat = 10,
}

/** A literal as the cell writes it, before a type says what a string is. */
export class RawLiteral {
  /** The form the cell wrote. */
  kind: RawKind
  /**
   * A string's value, the hex digits of bytes, a labelled value and a run,
   * an int's decimal text, or an f64's text; "" otherwise.
   */
  text: string
  /** The label a labelled value or run is printed under. */
  label: string | null
  /** A labelled int's digits, when they are also whole hex pairs. */
  hex: string | null
  /** A run's repeat count. */
  count: i32
  /** A bool's value. */
  flag: boolean
  /** A concat's parts. */
  parts: RawLiteral[]
  /**
   * Makes a raw literal.
   *
   * @param kind its form
   * @param text its text, as `text` describes
   */
  constructor(kind: RawKind, text: string) {
    this.kind = kind
    this.text = text
    this.label = null
    this.hex = null
    this.count = 0
    this.flag = false
    this.parts = []
  }
}

/** Why a cell's text was refused, and where. */
export class LiteralError {
  /** Why the text was refused. */
  message: string
  /** The 1-based column, counted in characters, the refusal points at. */
  col: i32
  /**
   * Makes an error.
   *
   * @param message why
   * @param col the 1-based column
   */
  constructor(message: string, col: i32) {
    this.message = message
    this.col = col
  }
}

/** A Call cell, parsed: the callee and its raw arguments. */
export class RawCall {
  /** The callee's name. */
  call: string
  /** The arguments, in the order written. */
  args: RawLiteral[]
  /**
   * Makes a parsed call.
   *
   * @param call the callee's name
   * @param args its arguments
   */
  constructor(call: string, args: RawLiteral[]) {
    this.call = call
    this.args = args
  }
}

/** A refusal of one of a vector's cells. */
export class CellError {
  /** "Call" or "Expected". */
  cell: string
  /** Why the cell was refused. */
  message: string
  /**
   * Makes a cell error.
   *
   * @param cell "Call" or "Expected"
   * @param message why it was refused
   */
  constructor(cell: string, message: string) {
    this.cell = cell
    this.message = message
  }
}

/** A vector's cells, settled: the arguments and the expected value. */
export class SettledVector {
  /** The call's arguments, in order, each settled by its parameter's type. */
  args: Literal[]
  /** The expected value, settled by the function's return type. */
  expect: Literal
  /**
   * Makes a settled vector.
   *
   * @param args the arguments, in order
   * @param expect the expected value
   */
  constructor(args: Literal[], expect: Literal) {
    this.args = args
    this.expect = expect
  }
}

/** The most bytes a run may expand to: enough for any RFC-printed run. */
export const LITERALS_MAX_REPEAT: i32 = 65536
/** The refusal of a run's count. */
export const LITERALS_REPEAT_COUNT: string = "a repeat count is a whole number of at least 1"
/** The refusal of a run that expands too far. */
export const LITERALS_REPEAT_SIZE: string = "a repeated run expands to at most 65536 bytes"
/** The refusal of a run that is not whole bytes. */
export const LITERALS_REPEAT_RUN: string = "a repeated run is whole bytes: lowercase hex pairs with no spaces"
/** The refusal of a bracketed byte string. */
export const LITERALS_BYTES: string =
  "bytes are lowercase hex pairs in brackets, at most one space apart: [00 0f], or [] for none"

/** `×`, the multiplication sign RFCs print a run with. */
const literalsTimes = (): string => charsFromCodePoint(0xd7)

/**
 * The refusal of a labelled value.
 *
 * @returns the message
 */
export const literalsLabelledMessage = (): string =>
  `a labelled value is \`Label = hex\` (lowercase hex pairs with no spaces), \`Label = 42\` or \`Label = 22 ${literalsTimes()} 0b\``

/** A cell's text being read, and the first refusal. */
class LiteralsReader {
  text: string
  i: i32
  /** The refusal, "" while there is none. */
  message: string
  /** The byte offset the refusal points at. */
  at: i32
  constructor(text: string) {
    this.text = text
    this.i = 0
    this.message = ""
    this.at = 0
  }
}

/** Records the first refusal; always null, for `return literalsFail(...)`. */
const literalsFail = (r: LiteralsReader, message: string, at: i32): RawLiteral | null => {
  if (r.message === "") {
    r.message = message
    r.at = at
  }
  return null
}

/** The byte at `j`, or -1 past the end. */
const literalsByte = (r: LiteralsReader, j: i32): i32 => (j >= 0 && j < r.text.length ? r.text.charCodeAt(j) : -1)

/** Whether the text at `j` starts with `s`. */
const literalsHas = (r: LiteralsReader, j: i32, s: string): boolean => r.text.substring(j, j + s.length) === s

const literalsIsDigit = (c: i32): boolean => c >= 0x30 && c <= 0x39

const literalsIsLetter = (c: i32): boolean => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)

/** `[0-9A-Za-z_]`: what may not follow a word or a number. */
const literalsIsWordChar = (c: i32): boolean => literalsIsDigit(c) || literalsIsLetter(c) || c === 0x5f

/** `[A-Za-z0-9_-]`: a character of a label's words. */
const literalsIsLabelChar = (c: i32): boolean => literalsIsWordChar(c) || c === 0x2d

const literalsIsLowerHexDigit = (c: i32): boolean => literalsIsDigit(c) || (c >= 0x61 && c <= 0x66)

/** Whitespace, `,` or `)`: where a labelled value or a run ends. */
const literalsEndsValue = (c: i32): boolean =>
  c === -1 ||
  c === 0x20 ||
  c === 0x09 ||
  c === 0x0a ||
  c === 0x0b ||
  c === 0x0c ||
  c === 0x0d ||
  c === 0x2c ||
  c === 0x29

/** Whether `s` is one or more lowercase hex pairs. */
const literalsIsHexPairs = (s: string): boolean => {
  if (s.length === 0 || s.length % 2 !== 0) {
    return false
  }
  for (let j = 0; j < s.length; j++) {
    if (!literalsIsLowerHexDigit(s.charCodeAt(j))) {
      return false
    }
  }
  return true
}

/** Whether `s` is a decimal integer with no leading zero: `0`, `42`, `-7`. */
const literalsIsIntText = (s: string): boolean => {
  const from = s.startsWith("-") ? 1 : 0
  if (s.length === from) {
    return false
  }
  if (s.charCodeAt(from) === 0x30) {
    return s.length === 1
  }
  for (let j = from; j < s.length; j++) {
    if (!literalsIsDigit(s.charCodeAt(j))) {
      return false
    }
  }
  return true
}

/** Whether every byte of `s` is a decimal digit. */
const literalsAllDigits = (s: string): boolean => {
  for (let j = 0; j < s.length; j++) {
    if (!literalsIsDigit(s.charCodeAt(j))) {
      return false
    }
  }
  return s.length > 0
}

const literalsSkip = (r: LiteralsReader): void => {
  while (literalsByte(r, r.i) === 0x20) {
    r.i = r.i + 1
  }
}

/** The end of a value starting at `j`: the first whitespace, `,` or `)`. */
const literalsValueEnd = (r: LiteralsReader, j: i32): i32 => {
  let k = j
  while (!literalsEndsValue(literalsByte(r, k))) {
    k++
  }
  return k
}

/** The value of hex digit `c` in any case, or -1. */
const literalsHexValue = (c: i32): i32 => {
  if (literalsIsDigit(c)) {
    return c - 0x30
  }
  if (c >= 0x61 && c <= 0x66) {
    return c - 0x61 + 10
  }
  return c >= 0x41 && c <= 0x46 ? c - 0x41 + 10 : -1
}

/** The four hex digits at `j` of `s` as a number, or -1. */
const literalsHex4 = (s: string, j: i32): i32 => {
  if (j + 4 > s.length) {
    return -1
  }
  let v = 0
  for (let k = j; k < j + 4; k++) {
    const d = literalsHexValue(s.charCodeAt(k))
    if (d < 0) {
      return -1
    }
    v = v * 16 + d
  }
  return v
}

/** The body of a quoted string (between the quotes) as JSON reads it, or null when an escape is bad. */
const literalsUnescape = (body: string): string | null => {
  const out: string[] = []
  let j = 0
  while (j < body.length) {
    const c = body.charCodeAt(j)
    if (c < 0x20) {
      return null
    }
    if (c !== 0x5c) {
      const n = charsSequenceLength(body, j)
      out.push(body.substring(j, j + n))
      j += n
      continue
    }
    const e = j + 1 < body.length ? body.charCodeAt(j + 1) : -1
    j += 2
    if (e === 0x22 || e === 0x5c || e === 0x2f) {
      out.push(charsFromCodePoint(e))
    } else if (e === 0x62) {
      out.push(charsFromCodePoint(8))
    } else if (e === 0x66) {
      out.push(charsFromCodePoint(12))
    } else if (e === 0x6e) {
      out.push("\n")
    } else if (e === 0x72) {
      out.push("\r")
    } else if (e === 0x74) {
      out.push("\t")
    } else if (e === 0x75) {
      let cp = literalsHex4(body, j)
      if (cp < 0) {
        return null
      }
      j += 4
      if (cp >= 0xd800 && cp <= 0xdbff && body.substring(j, j + 2) === "\\u") {
        const lo = literalsHex4(body, j + 2)
        if (lo >= 0xdc00 && lo <= 0xdfff) {
          cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00)
          j += 6
        }
      }
      out.push(charsFromCodePoint(cp >= 0xd800 && cp <= 0xdfff ? 0xfffd : cp))
    } else {
      return null
    }
  }
  return out.join("")
}

/** `"..."` at the reader; null with no refusal when the text there is not a closed string. */
const literalsString = (r: LiteralsReader): RawLiteral | null => {
  const at = r.i
  let j = at + 1
  for (;;) {
    const c = literalsByte(r, j)
    if (c === -1 || c === 0x0a) {
      return null
    }
    if (c === 0x22) {
      break
    }
    if (c === 0x5c) {
      const next = literalsByte(r, j + 1)
      if (next === -1 || next === 0x0a) {
        return null
      }
      j += 2
    } else {
      j++
    }
  }
  r.i = j + 1
  const value = literalsUnescape(r.text.substring(at + 1, j))
  if (value === null) {
    return literalsFail(r, "a quoted string is a JSON string; bad escape", at)
  }
  return new RawLiteral(RawKind.Str, value)
}

/** `[00 0f]` at the reader. */
const literalsBytes = (r: LiteralsReader): RawLiteral | null => {
  const at = r.i
  const hex: string[] = []
  let j = at + 1
  let lastPair = false
  for (;;) {
    const c = literalsByte(r, j)
    if (c === 0x5d && (lastPair || j === at + 1)) {
      r.i = j + 1
      return new RawLiteral(RawKind.Bytes, hex.join(""))
    }
    if (literalsIsLowerHexDigit(c) && literalsIsLowerHexDigit(literalsByte(r, j + 1))) {
      hex.push(r.text.substring(j, j + 2))
      j += 2
      lastPair = true
    } else if (c === 0x20 && lastPair) {
      j++
      lastPair = false
    } else {
      return literalsFail(r, LITERALS_BYTES, at)
    }
  }
}

/** The end of `null`, `true` or `false` at `j`, or -1. */
const literalsWordEnd = (r: LiteralsReader, j: i32): i32 => {
  for (const w of ["null", "true", "false"]) {
    if (literalsHas(r, j, w) && !literalsIsWordChar(literalsByte(r, j + w.length))) {
      return j + w.length
    }
  }
  return -1
}

/**
 * The end of a comma-grouped number at `j` (`1,000`, `1,000,000`: one to
 * three digits, then groups of exactly three), or -1 when there is none.
 */
const literalsGroupedEnd = (r: LiteralsReader, j: i32): i32 => {
  let k = j
  while (k - j < 3 && literalsIsDigit(literalsByte(r, k))) {
    k++
  }
  if (k === j) {
    return -1
  }
  let groups = 0
  while (
    literalsByte(r, k) === 0x2c &&
    literalsIsDigit(literalsByte(r, k + 1)) &&
    literalsIsDigit(literalsByte(r, k + 2)) &&
    literalsIsDigit(literalsByte(r, k + 3))
  ) {
    k += 4
    groups++
  }
  if (groups === 0 || literalsIsLabelChar(literalsByte(r, k)) || literalsByte(r, k) === 0x2c) {
    return -1
  }
  return k
}

/**
 * The end of a label at `j` (before its ` = `), or -1. A label is words of
 * letters, digits, `_` and `-`, one space apart; the first word starts with a
 * letter, or with digits then a letter (`32-bit fixed-common part`, as RFC
 * 8439 prints it), so `22 x 0b` and `42` stay a run and an int. An apostrophe
 * may join two letters inside a word (`Alice's private key`, as RFC 7748
 * prints it). A later word may be a comma-grouped number (`After 1,000
 * iterations`, as RFC 7748 prints it), and one later word may be a
 * parenthesised group of such words (`MESSAGE (length 1 byte)`, as RFC 8032
 * prints it), so the comma and paren inside it do not end the argument.
 * The words may end in one `, alias` (`Alice's private key, a` or `Alice's
 * public key, X25519(a, 9)`, as RFC 7748 prints them): the comma is the
 * label's only when its alias is followed by ` = `, so `f(K = 00, b = 11)`
 * is still two arguments.
 */
const literalsLabelEnd = (r: LiteralsReader, j: i32): i32 => {
  let k = j
  while (literalsIsDigit(literalsByte(r, k))) {
    k++
  }
  if (k > j && literalsByte(r, k) === 0x2d) {
    k++
  }
  if (!literalsIsLetter(literalsByte(r, k))) {
    return -1
  }
  k = literalsLabelCharsEnd(r, k)
  let grouped = false
  for (;;) {
    if (literalsHas(r, k, " = ")) {
      return k
    }
    if (literalsHas(r, k, ", ")) {
      return literalsAliasEnd(r, j, k, grouped)
    }
    if (literalsByte(r, k) !== 0x20) {
      return -1
    }
    k++
    if (literalsByte(r, k) === 0x28 && !grouped) {
      grouped = true
      k = literalsGroupEnd(r, k + 1, false)
      if (k < 0) {
        return -1
      }
    } else {
      k = literalsLabelWordEnd(r, k)
      if (k < 0) {
        return -1
      }
    }
  }
}

/**
 * The end of a label whose words, from `j`, end in a `, ` at `k`: past its
 * one alias, a label word (`a`) or a word joined to a parenthesised group
 * that may hold `, ` (`X25519(a, 9)`), when ` = ` follows it; -1 otherwise.
 * Words that are themselves an f64 (`NaN`, `Infinity`) take no alias, so
 * `f(NaN, a = 00)` is still two arguments. A label holds at most one group,
 * so when its words already hold one (`grouped`) the alias may not.
 */
const literalsAliasEnd = (r: LiteralsReader, j: i32, k: i32, grouped: boolean): i32 => {
  if (literalsF64End(r, j) === k) {
    return -1
  }
  let m = literalsLabelWordEnd(r, k + 2)
  if (m >= 0 && literalsByte(r, m) === 0x28) {
    if (grouped) {
      return -1
    }
    m = literalsGroupEnd(r, m + 1, true)
  }
  return m >= 0 && literalsHas(r, m, " = ") ? m : -1
}

/**
 * The end of a run of label characters at `j`, where an apostrophe counts
 * only between two letters (`Alice's`); `j` when there is none.
 */
const literalsLabelCharsEnd = (r: LiteralsReader, j: i32): i32 => {
  let k = j
  for (;;) {
    const c = literalsByte(r, k)
    if (literalsIsLabelChar(c)) {
      k++
    } else if (c === 0x27 && literalsIsLetter(literalsByte(r, k - 1)) && literalsIsLetter(literalsByte(r, k + 1))) {
      k++
    } else {
      return k
    }
  }
}

/** The end of one later label word at `j` (a comma-grouped number, or label characters), or -1. */
const literalsLabelWordEnd = (r: LiteralsReader, j: i32): i32 => {
  if (!literalsIsLabelChar(literalsByte(r, j))) {
    return -1
  }
  const grouped = literalsGroupedEnd(r, j)
  return literalsLabelCharsEnd(r, grouped >= 0 ? grouped : j)
}

/**
 * The end of a label's parenthesised group, past its `)`, from `j` just after
 * its `(`: label words one space apart, or also `, ` apart when `commas` (an
 * alias's group, `X25519(a, 9)`), at least one, with no paren inside. -1 when
 * there is none.
 */
const literalsGroupEnd = (r: LiteralsReader, j: i32, commas: boolean): i32 => {
  let k = literalsLabelWordEnd(r, j)
  for (;;) {
    if (k < 0) {
      return -1
    }
    if (literalsByte(r, k) === 0x29) {
      return k + 1
    }
    if (commas && literalsHas(r, k, ", ")) {
      k++
    }
    if (literalsByte(r, k) !== 0x20) {
      return -1
    }
    k = literalsLabelWordEnd(r, k + 1)
  }
}

/**
 * `count x run` at the reader (`x` or the multiplication sign, with spaces
 * around the sign optional); null with no refusal when the text there is not
 * a run.
 */
const literalsRepeat = (r: LiteralsReader): RawLiteral | null => {
  const at = r.i
  let j = at
  if (literalsByte(r, j) === 0x2d) {
    j++
  }
  const digitsFrom = j
  while (literalsIsDigit(literalsByte(r, j))) {
    j++
  }
  if (j === digitsFrom) {
    return null
  }
  const countText = r.text.substring(at, j)
  const times = literalsTimes()
  let k = j
  if (literalsByte(r, k) === 0x20) {
    k++
  }
  if (literalsHas(r, k, times)) {
    k += times.length
    if (literalsByte(r, k) === 0x20) {
      k++
    }
  } else if (literalsHas(r, j, " x ")) {
    k = j + 3
  } else {
    return null
  }
  if (!literalsIsIntText(countText) || countText.startsWith("-") || countText === "0") {
    return literalsFail(r, LITERALS_REPEAT_COUNT, at)
  }
  const end = literalsValueEnd(r, k)
  const run = r.text.substring(k, end)
  if (!literalsIsHexPairs(run)) {
    return literalsFail(r, LITERALS_REPEAT_RUN, k)
  }
  if (countText.length > 6) {
    return literalsFail(r, LITERALS_REPEAT_SIZE, at)
  }
  const count = toI32(parseFloat(countText))
  if (toI64(count) * toI64(run.length / 2) > toI64(LITERALS_MAX_REPEAT)) {
    return literalsFail(r, LITERALS_REPEAT_SIZE, at)
  }
  r.i = end
  const lit = new RawLiteral(RawKind.Repeat, run)
  lit.count = count
  return lit
}

/** The end of the digits from `j`, which must be at least one; -1 when there are none. */
const literalsDigitsEnd = (r: LiteralsReader, j: i32): i32 => {
  let k = j
  while (literalsIsDigit(literalsByte(r, k))) {
    k++
  }
  return k > j ? k : -1
}

/** The end of an integer with no leading zero at `j` (`-` allowed), or -1. */
const literalsIntEnd = (r: LiteralsReader, j: i32): i32 => {
  let k = j
  if (literalsByte(r, k) === 0x2d) {
    k++
  }
  const c = literalsByte(r, k)
  if (c === 0x30) {
    return k === j ? k + 1 : -1
  }
  if (c < 0x31 || c > 0x39) {
    return -1
  }
  return literalsDigitsEnd(r, k)
}

/**
 * The end of an f64's text at `j`, or -1: an integer with a fraction or an
 * exponent (RFC 8259 §6), or NaN, Infinity, -Infinity. A plain integer is an
 * int, not an f64.
 */
const literalsF64End = (r: LiteralsReader, j: i32): i32 => {
  let k = -1
  if (literalsHas(r, j, "NaN")) {
    k = j + 3
  } else if (literalsHas(r, j, "Infinity")) {
    k = j + 8
  } else if (literalsHas(r, j, "-Infinity")) {
    k = j + 9
  } else {
    const neg = literalsByte(r, j) === 0x2d ? 1 : 0
    const c = literalsByte(r, j + neg)
    let m = c === 0x30 ? j + neg + 1 : c >= 0x31 && c <= 0x39 ? literalsDigitsEnd(r, j + neg) : -1
    if (m < 0) {
      return -1
    }
    let shaped = false
    if (literalsByte(r, m) === 0x2e) {
      m = literalsDigitsEnd(r, m + 1)
      if (m < 0) {
        return -1
      }
      shaped = true
    }
    const e = literalsByte(r, m)
    if (e === 0x65 || e === 0x45) {
      let x = m + 1
      const sign = literalsByte(r, x)
      if (sign === 0x2b || sign === 0x2d) {
        x++
      }
      const xe = literalsDigitsEnd(r, x)
      if (xe >= 0) {
        m = xe
        shaped = true
      }
    }
    if (!shaped) {
      return -1
    }
    k = m
  }
  const after = literalsByte(r, k)
  return literalsIsWordChar(after) || after === 0x2e ? -1 : k
}

/** `Label = value` at the reader, the label ending at `labelEnd`. */
const literalsLabelled = (r: LiteralsReader, labelEnd: i32): RawLiteral | null => {
  const at = r.i
  const label = r.text.substring(at, labelEnd)
  r.i = labelEnd + 3
  const run = literalsRepeat(r)
  if (run !== null) {
    run.label = label
    return run
  }
  if (r.message !== "") {
    return null
  }
  // A value printed as `LABEL (length 0 bytes):` with no lines after it.
  const none = literalsHas(r, r.i, "(empty)") ? 7 : literalsHas(r, r.i, "[]") ? 2 : 0
  if (none > 0) {
    r.i = r.i + none
    const lit = new RawLiteral(RawKind.Labelled, "")
    lit.label = label
    return lit
  }
  const end = literalsValueEnd(r, r.i)
  const text = r.text.substring(r.i, end)
  const isHex = literalsIsHexPairs(text)
  const isInt = literalsIsIntText(text)
  if (!isInt && !isHex) {
    return literalsFail(r, literalsLabelledMessage(), at)
  }
  r.i = end
  if (!isInt) {
    const lit = new RawLiteral(RawKind.Labelled, text)
    lit.label = label
    return lit
  }
  const lit = new RawLiteral(RawKind.LabelledInt, text)
  lit.label = label
  if (isHex) {
    lit.hex = text
  }
  return lit
}

/** `(a, b, ...)` after an opening paren already read; `inConcat` refuses a nested concat. */
const literalsList = (r: LiteralsReader, inConcat: boolean): RawLiteral[] | null => {
  const out: RawLiteral[] = []
  literalsSkip(r)
  if (literalsByte(r, r.i) === 0x29) {
    r.i = r.i + 1
    return out
  }
  for (;;) {
    const lit = literalsOne(r, inConcat)
    if (lit === null) {
      return null
    }
    out.push(lit)
    literalsSkip(r)
    const c = literalsByte(r, r.i)
    if (c === 0x29) {
      r.i = r.i + 1
      return out
    }
    if (c !== 0x2c) {
      literalsFail(r, "expected `,` or `)`", r.i)
      return null
    }
    r.i = r.i + 1
  }
}

/** One literal at the reader. */
const literalsOne = (r: LiteralsReader, inConcat: boolean): RawLiteral | null => {
  literalsSkip(r)
  const at = r.i
  const c = literalsByte(r, at)
  if (c === 0x22) {
    const s = literalsString(r)
    if (s !== null || r.message !== "") {
      return s
    }
  }
  if (c === 0x5b) {
    return literalsBytes(r)
  }
  if (literalsHas(r, at, "(empty)")) {
    r.i = at + 7
    return new RawLiteral(RawKind.Empty, "")
  }
  if (literalsHas(r, at, "concat(")) {
    // One level only: concatenation is associative, and a nested one would
    // recurse as deep as the cell is long.
    if (inConcat) {
      return literalsFail(r, "concat does not nest; list every part", at)
    }
    r.i = at + 7
    const parts = literalsList(r, true)
    if (parts === null) {
      return null
    }
    if (parts.length === 0) {
      return literalsFail(r, "concat needs at least one part", at)
    }
    const lit = new RawLiteral(RawKind.Concat, "")
    lit.parts = parts
    return lit
  }
  const wordEnd = literalsWordEnd(r, at)
  if (wordEnd >= 0) {
    r.i = wordEnd
    const word = r.text.substring(at, wordEnd)
    if (word === "null") {
      return new RawLiteral(RawKind.Null, "")
    }
    const lit = new RawLiteral(RawKind.Bool, "")
    lit.flag = word === "true"
    return lit
  }
  const labelEnd = literalsLabelEnd(r, at)
  if (labelEnd >= 0) {
    return literalsLabelled(r, labelEnd)
  }
  const run = literalsRepeat(r)
  if (run !== null || r.message !== "") {
    return run
  }
  const f64End = literalsF64End(r, at)
  if (f64End >= 0) {
    r.i = f64End
    return new RawLiteral(RawKind.F64, r.text.substring(at, f64End))
  }
  const intEnd = literalsIntEnd(r, at)
  if (intEnd >= 0 && !literalsIsWordChar(literalsByte(r, intEnd))) {
    r.i = intEnd
    return new RawLiteral(RawKind.Int, r.text.substring(at, intEnd))
  }
  const bars = charsFromCodePoint(0x2016)
  if (literalsHas(r, at, bars)) {
    return literalsFail(r, `\`${bars}\` is not a literal; write concat(a, b)`, at)
  }
  return literalsFail(r, "not a literal", at)
}

/** Refuses text left after the value. */
const literalsEnd = (r: LiteralsReader): void => {
  literalsSkip(r)
  if (r.message === "" && r.i < r.text.length) {
    literalsFail(r, "unexpected text after the value", r.i)
  }
}

/** The reader's refusal, its column counted in characters. */
const literalsError = (r: LiteralsReader): LiteralError => {
  let col = 1
  for (let j = 0; j < r.at && j < r.text.length; j++) {
    if ((r.text.charCodeAt(j) & 0xc0) !== 0x80) {
      col++
    }
  }
  return new LiteralError(r.message, col)
}

/**
 * Parses a Call cell, `name(args...)`, into the callee and its raw arguments.
 *
 * @param text the cell's text
 * @returns the call, or why the text is not one
 */
export const literalsParseCall = (text: string): Result<RawCall, LiteralError> => {
  const r = new LiteralsReader(text)
  let j = 0
  const c0 = literalsByte(r, 0)
  if (literalsIsLetter(c0) || c0 === 0x5f) {
    j = 1
    while (literalsIsWordChar(literalsByte(r, j))) {
      j++
    }
  }
  if (j === 0 || literalsByte(r, j) !== 0x28) {
    return Err(new LiteralError("a call is `name(args...)`", 1))
  }
  r.i = j + 1
  const args = literalsList(r, false)
  literalsEnd(r)
  if (args === null || r.message !== "") {
    return Err(literalsError(r))
  }
  return Ok(new RawCall(text.substring(0, j), args))
}

/**
 * Parses one literal filling the whole of a cell's text.
 *
 * @param text the cell's text
 * @returns the raw literal, or why the text is not one
 */
export const literalsParse = (text: string): Result<RawLiteral, LiteralError> => {
  const r = new LiteralsReader(text)
  const lit = literalsOne(r, false)
  literalsEnd(r)
  if (lit === null || r.message !== "") {
    return Err(literalsError(r))
  }
  return Ok(lit)
}

/**
 * How many bytes a bytes literal stands for: its hex pairs times its repeat,
 * an ascii literal's characters, or the sum of a concat's parts.
 *
 * @param lit the literal
 * @returns the byte count, or -1 when the literal is not bytes
 */
export const literalsByteLength = (lit: Literal): i64 => {
  if (lit.kind === LitKind.Concat) {
    let n: i64 = 0
    for (const p of lit.parts) {
      const m = literalsByteLength(p)
      if (m < 0) {
        return -1
      }
      n += m
    }
    return n
  }
  if (lit.kind === LitKind.Ascii) {
    return toI64(lit.text.length)
  }
  if (lit.kind !== LitKind.Hex) {
    return -1
  }
  let digits: i64 = 0
  for (let i = 0; i < lit.text.length; i++) {
    const c = toI32(lit.text.charCodeAt(i))
    if ((c >= 48 && c <= 57) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70)) {
      digits += 1
    }
  }
  return (digits / 2) * toI64(lit.repeat < 0 ? 1 : lit.repeat)
}

/**
 * What a literal is, as a refusal names it: "an int", "bytes", "null", ...
 *
 * @param lit the literal
 * @returns its name
 */
export const literalsKindOf = (lit: Literal): string => (lit.kind === LitKind.Int ? "an int" : typeOfLiteral(lit))

/**
 * Text as a JSON string, every character outside printable ASCII escaped, so
 * a refusal shows what a reader cannot see.
 *
 * @param s the text
 * @returns it quoted
 */
export const literalsQuote = (s: string): string => {
  const out: string[] = ['"']
  let j = 0
  while (j < s.length) {
    const cp = charsCodePointAt(s, j)
    j += charsSequenceLength(s, j)
    if (cp === 0x22 || cp === 0x5c) {
      out.push(`\\${charsFromCodePoint(cp)}`)
    } else if (cp === 0x0a) {
      out.push("\\n")
    } else if (cp === 0x09) {
      out.push("\\t")
    } else if (cp === 0x0d) {
      out.push("\\r")
    } else if (cp >= 0x20 && cp <= 0x7e) {
      out.push(charsFromCodePoint(cp))
    } else if (cp > 0xffff) {
      const v = cp - 0x10000
      out.push(`\\u${literalsHex4Of(0xd800 + (v >> 10))}\\u${literalsHex4Of(0xdc00 + (v & 0x3ff))}`)
    } else {
      out.push(`\\u${literalsHex4Of(cp)}`)
    }
  }
  out.push('"')
  return out.join("")
}

/** `v` as four lowercase hex digits. */
const literalsHex4Of = (v: i32): string => {
  const digits = "0123456789abcdef"
  let out = ""
  for (let k = 3; k >= 0; k--) {
    const d = (v >> (k * 4)) & 15
    out = `${out}${digits.substring(d, d + 1)}`
  }
  return out
}

const literalsIsBytesLike = (ty: string | null): boolean =>
  ty !== null && (ty === "bytes" || ty === "bytes?" || ty === "null")

const literalsIsStringLike = (ty: string | null): boolean =>
  ty !== null && (ty === "string" || ty === "string?" || ty === "null")

/** An f64 literal of `text`, carrying the binary64 encoding the text reads as. */
const literalsF64 = (text: string): Result<Literal, string> => {
  if (contractF64Overflows(text)) {
    return Err(`${text} is past the largest f64; write Infinity or -Infinity`)
  }
  const lit = new Literal(LitKind.F64, text)
  lit.bits = contractF64Bits(contractF64Parse(text))
  return Ok(lit)
}

/** An int literal; past 2^53 - 1 its JSON form is a decimal string. */
const literalsInt = (text: string, label: string | null): Literal => {
  const lit = new Literal(LitKind.Int, text)
  lit.quoted = !vocabIsJsonSafe(text)
  lit.label = label
  return lit
}

/** A hex literal, labelled when `label` is not null. */
const literalsHexLit = (hex: string, label: string | null): Literal => {
  const lit = new Literal(LitKind.Hex, hex)
  lit.label = label
  return lit
}

/**
 * Settles a raw literal where a value of type `ty` goes. A quoted string is
 * `{ascii}` where bytes go and `{str}` where a string goes; an int where an
 * f64 goes is that f64's text; `L = 42` is an int where an int goes and the
 * byte 0x42 anywhere else. Every other literal is as written, for the caller
 * to judge against `ty`.
 *
 * @param raw the literal as the cell writes it
 * @param ty the value type it goes where, or null for a place no signature
 *   types (an argument past the last parameter)
 * @returns the literal, or why it cannot be settled
 */
export const literalsSettle = (raw: RawLiteral, ty: string | null): Result<Literal, string> => {
  const k = raw.kind
  if (k === RawKind.Str) {
    if (!charsIsStringText(raw.text)) {
      return Err(`a quoted string is printable ASCII, tab, LF and CR only; ${literalsQuote(raw.text)} is not`)
    }
    if (literalsIsBytesLike(ty)) {
      return Ok(new Literal(LitKind.Ascii, raw.text))
    }
    if (literalsIsStringLike(ty)) {
      return Ok(new Literal(LitKind.Str, raw.text))
    }
    const where = ty === null ? "past the last parameter" : ty
    return Err(
      `the types do not settle ${literalsQuote(raw.text)}: a quoted string goes where bytes or a string does, not ${where}`,
    )
  }
  if (k === RawKind.Bytes) {
    return Ok(new Literal(LitKind.Hex, raw.text))
  }
  if (k === RawKind.Empty) {
    return Ok(new Literal(LitKind.Ascii, ""))
  }
  if (k === RawKind.Null) {
    return Ok(new Literal(LitKind.Null, ""))
  }
  if (k === RawKind.Bool) {
    const lit = new Literal(LitKind.Bool, "")
    lit.flag = raw.flag
    return Ok(lit)
  }
  if (k === RawKind.Int) {
    return ty !== null && (ty === "f64" || ty === "f64?") ? literalsF64(raw.text) : Ok(literalsInt(raw.text, null))
  }
  if (k === RawKind.F64) {
    return literalsF64(raw.text)
  }
  if (k === RawKind.Labelled) {
    return Ok(literalsHexLit(raw.text, raw.label))
  }
  if (k === RawKind.LabelledInt) {
    const hex = raw.hex
    if (hex === null || (ty !== null && typeIntBase(ty) !== null)) {
      return Ok(literalsInt(raw.text, raw.label))
    }
    return Ok(literalsHexLit(hex, raw.label))
  }
  if (k === RawKind.Repeat) {
    const lit = literalsHexLit(raw.text, raw.label)
    lit.repeat = raw.count
    return Ok(lit)
  }
  const parts: Literal[] = []
  for (const p of raw.parts) {
    const lit = literalsSettle(p, "bytes").orReturn()
    if (typeOfLiteral(lit) !== "bytes") {
      return Err(`a concat part is bytes, not ${literalsKindOf(lit)}`)
    }
    parts.push(lit)
  }
  const out = new Literal(LitKind.Concat, "")
  out.parts = parts
  return Ok(out)
}

/** Why digits where an int goes were read as bytes: a leading zero. */
const literalsZeroHint = (raw: RawLiteral, ty: string): string => {
  const label = raw.label
  if (raw.kind === RawKind.Labelled && label !== null && literalsAllDigits(raw.text) && typeIntBase(ty) !== null) {
    return ` (\`${label} = ${raw.text}\` has a leading zero, so it is bytes)`
  }
  return ""
}

/** " <digits>" after an int a refusal names, "" for any other literal. */
const literalsIntSuffix = (lit: Literal): string => (lit.kind === LitKind.Int ? ` ${lit.text}` : "")

/**
 * A vector's Call arguments and Expected value, settled and typed by the
 * callee's signature: as many arguments as parameters, each of its
 * parameter's type, every int in range, and an expected value of the return
 * type. Every refusal is given, not only the first.
 *
 * @param fn the callee's signature
 * @param args the Call cell's raw arguments
 * @param expect the Expected cell's raw literal
 * @returns the settled cells, or a refusal of each cell that does not fit
 */
export const literalsSettleVector = (
  fn: FnSig,
  args: RawLiteral[],
  expect: RawLiteral,
): Result<SettledVector, CellError[]> => {
  const errors: CellError[] = []
  if (args.length !== fn.params.length) {
    errors.push(new CellError("Call", `${fn.name} takes ${fn.params.length} argument(s), not ${args.length}`))
  }
  const out: Literal[] = []
  for (let i = 0; i < args.length; i++) {
    const typed = i < fn.params.length
    const ty: string | null = typed ? vocabValueType(fn.params[i].type) : null
    const lit = literalsSettle(args[i], ty)
    if (lit.isErr()) {
      errors.push(new CellError("Call", lit.error))
    } else if (ty !== null && !typeLiteralFits(lit.value, ty)) {
      const p = fn.params[i]
      errors.push(
        new CellError(
          "Call",
          `argument ${i + 1} of ${fn.name} (${p.name}) is ${ty}, not ${literalsKindOf(lit.value)}${literalsIntSuffix(lit.value)}${literalsZeroHint(args[i], ty)}`,
        ),
      )
    } else {
      out.push(lit.value)
    }
  }
  const ret = vocabValueType(fn.returns)
  const e = literalsSettle(expect, ret)
  if (e.isErr()) {
    errors.push(new CellError("Expected", e.error))
  } else if (!typeLiteralFits(e.value, ret)) {
    errors.push(
      new CellError(
        "Expected",
        `${fn.name} returns ${ret}, not ${literalsKindOf(e.value)}${literalsIntSuffix(e.value)}${literalsZeroHint(expect, ret)}`,
      ),
    )
  }
  if (errors.length > 0 || e.isErr()) {
    return Err(errors)
  }
  return Ok(new SettledVector(out, e.value))
}
