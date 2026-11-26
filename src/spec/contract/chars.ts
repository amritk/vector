/**
 * `spec/contract/chars` — the character-level checks a contract's text needs:
 * UTF-8 decoding one code point at a time, control characters, and the
 * patterns its ids, sections and numbers are written in. Each pattern is a
 * plain scan rather than a regex, so what it admits is read off the code.
 */

/** The replacement a malformed UTF-8 sequence decodes to. */
const CHARS_BAD: i32 = 0xfffd

/**
 * The code point that starts at byte `i` of `s`, read as UTF-8. A malformed or
 * overlong sequence, a surrogate, or one past U+10FFFF reads as U+FFFD.
 *
 * @param s the text
 * @param i a byte index in `s`, below `s.length`
 * @returns the code point
 */
export const charsCodePointAt = (s: string, i: i32): i32 => {
  // A byte index past the end starts no sequence, like a truncated one.
  if (i < 0 || i >= s.length) {
    return CHARS_BAD
  }
  const b0 = s.charCodeAt(i)
  if (b0 < 0x80) {
    return b0
  }
  const n = charsSequenceLength(s, i)
  if (n === 1) {
    return CHARS_BAD
  }
  let cp: i32 = b0 & (n === 2 ? 0x1f : n === 3 ? 0x0f : 0x07)
  // charsSequenceLength answers n > 1 only when all n bytes are in `s`.
  for (let j = i + 1; j < s.length && j - i < n; j++) {
    cp = (cp << 6) | (s.charCodeAt(j) & 0x3f)
  }
  const min: i32 = n === 2 ? 0x80 : n === 3 ? 0x800 : 0x10000
  if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
    return CHARS_BAD
  }
  return cp
}

/**
 * How many bytes the UTF-8 sequence at byte `i` takes: 1 for ASCII and for a
 * byte that cannot start a well-formed sequence, so a scan always advances.
 *
 * @param s the text
 * @param i a byte index in `s`, below `s.length`
 * @returns 1 to 4
 */
export const charsSequenceLength = (s: string, i: i32): i32 => {
  // A byte index past the end starts no sequence, like a truncated one.
  if (i < 0 || i >= s.length) {
    return 1
  }
  const b0 = s.charCodeAt(i)
  const n: i32 =
    b0 < 0x80 ? 1 : b0 >= 0xc2 && b0 <= 0xdf ? 2 : b0 >= 0xe0 && b0 <= 0xef ? 3 : b0 >= 0xf0 && b0 <= 0xf4 ? 4 : 1
  if (n > s.length - i) {
    return 1
  }
  for (let j = i + 1; j < s.length && j - i < n; j++) {
    if ((s.charCodeAt(j) & 0xc0) !== 0x80) {
      return 1
    }
  }
  return n
}

/**
 * The UTF-8 text of one code point, so code can name an invisible or
 * confusable character by its number rather than spell it in the source.
 *
 * @param cp a code point, at most U+10FFFF
 * @returns its UTF-8 encoding, one to four bytes
 */
export const charsFromCodePoint = (cp: i32): string => {
  const out: u8[] = []
  if (cp < 0x80) {
    out.push(toU8(cp))
  } else if (cp < 0x800) {
    out.push(toU8(0xc0 | (cp >> 6)))
    out.push(toU8(0x80 | (cp & 0x3f)))
  } else if (cp < 0x10000) {
    out.push(toU8(0xe0 | (cp >> 12)))
    out.push(toU8(0x80 | ((cp >> 6) & 0x3f)))
    out.push(toU8(0x80 | (cp & 0x3f)))
  } else {
    out.push(toU8(0xf0 | (cp >> 18)))
    out.push(toU8(0x80 | ((cp >> 12) & 0x3f)))
    out.push(toU8(0x80 | ((cp >> 6) & 0x3f)))
    out.push(toU8(0x80 | (cp & 0x3f)))
  }
  return String.fromBytes(out, 0, out.length)
}

/**
 * A code point as `U+XXXX`: uppercase hex, at least four digits.
 *
 * @param cp the code point
 * @returns the code point's name, such as `U+000A` or `U+1D400`
 */
export const charsName = (cp: i32): string => {
  const digits = "0123456789ABCDEF"
  let out = ""
  let v = cp
  while (v > 0 || out.length < 4) {
    out = `${digits.substring(v & 15, (v & 15) + 1)}${out}`
    v = v >> 4
  }
  return `U+${out}`
}

/**
 * Whether a code point is a control character: C0, DEL, C1, or the Unicode
 * line and paragraph separators, any of which would end a line in a comment.
 *
 * @param cp the code point
 * @returns true for a control character
 */
export const charsIsControl = (cp: i32): boolean =>
  cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || cp === 0x2028 || cp === 0x2029

/**
 * The first control character in `s`, by name.
 *
 * @param s the text
 * @returns its name, such as `U+000A`, or null when `s` has none
 */
export const charsFirstControl = (s: string): string | null => {
  // In u32: a sequence is 1 to 4 bytes, so the sum stays below 2^31 + 4.
  let i: u32 = 0
  while (i < toU32(s.length)) {
    const cp = charsCodePointAt(s, toI32(i))
    if (charsIsControl(cp)) {
      return charsName(cp)
    }
    i += toU32(charsSequenceLength(s, toI32(i)))
  }
  return null
}

const charsIsDigit = (c: i32): boolean => c >= 0x30 && c <= 0x39
const charsIsLower = (c: i32): boolean => c >= 0x61 && c <= 0x7a
const charsIsUpper = (c: i32): boolean => c >= 0x41 && c <= 0x5a
const charsIsHexDigit = (c: i32): boolean => charsIsDigit(c) || (c >= 0x61 && c <= 0x66)

/**
 * Whether every byte of `s` is printable ASCII, tab, LF or CR: the characters
 * a contract's strings may be written with, each one byte.
 *
 * @param s the text
 * @returns true when `s` uses only those characters
 */
export const charsIsStringText = (s: string): boolean => {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (!((c >= 0x20 && c <= 0x7e) || c === 0x09 || c === 0x0a || c === 0x0d)) {
      return false
    }
  }
  return true
}

/**
 * Whether `s` is lowercase hex: an even number of digits, or exactly `digits`
 * of them when `digits` is not negative.
 *
 * @param s the text
 * @param digits the number of digits wanted, or -1 for any even number
 * @returns true when `s` is lowercase hex of that length
 */
export const charsIsLowerHex = (s: string, digits: i32): boolean => {
  if (digits >= 0 ? s.length !== digits : s.length % 2 !== 0) {
    return false
  }
  for (let i = 0; i < s.length; i++) {
    if (!charsIsHexDigit(s.charCodeAt(i))) {
      return false
    }
  }
  return true
}

/**
 * Whether `s` is an id: `[A-Za-z0-9][A-Za-z0-9._-]*`.
 *
 * @param s the text
 * @returns true for an id
 */
export const charsIsId = (s: string): boolean => {
  if (s.length === 0) {
    return false
  }
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    const alnum = charsIsDigit(c) || charsIsLower(c) || charsIsUpper(c)
    if (!(alnum || (i > 0 && (c === 0x2e || c === 0x5f || c === 0x2d)))) {
      return false
    }
  }
  return true
}

/**
 * Whether `s` is an identifier: `[a-zA-Z_][a-zA-Z0-9_]*`.
 *
 * @param s the text
 * @returns true for an identifier
 */
export const charsIsIdent = (s: string): boolean => {
  if (s.length === 0) {
    return false
  }
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    const ok = charsIsLower(c) || charsIsUpper(c) || c === 0x5f || (i > 0 && charsIsDigit(c))
    if (!ok) {
      return false
    }
  }
  return true
}

/**
 * The number a test case's name gives it: `Test Vector #N`, exactly, with N
 * a positive number written without a leading zero.
 *
 * @param s the name
 * @returns N, or 0 when `s` is not such a name
 */
export const charsTestVector = (s: string): i32 => {
  const head = "Test Vector #"
  if (!s.startsWith(head) || s.length === head.length || s.length - head.length > 6) {
    return 0
  }
  // In u32: six digits at most.
  let n: u32 = 0
  for (let i = head.length; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (!charsIsDigit(c) || (i === head.length && c === 0x30)) {
      return 0
    }
    n = n * 10 + toU32(c) - 0x30
  }
  return toI32(n)
}

/**
 * Whether `s` is a section number: digits in dot-separated parts (`2.3`), or
 * an appendix letter with optional parts (`A`, `A.1`).
 *
 * @param s the text
 * @returns true for a section number
 */
export const charsIsSection = (s: string): boolean => {
  if (s.length < 1) {
    return false
  }
  let i = 0
  if (charsIsUpper(s.charCodeAt(0))) {
    i = 1
    if (s.length < 2) {
      return true
    }
    if (s.charCodeAt(1) !== 0x2e) {
      return false
    }
    i = 2
  }
  // Now one or more digit runs separated by single dots.
  let run: u32 = 0
  for (; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (charsIsDigit(c)) {
      run++
    } else if (c === 0x2e && run > 0) {
      run = 0
    } else {
      return false
    }
  }
  return run > 0
}

/**
 * The length of the unsigned decimal number at byte `i` of `s` in RFC 8259
 * §6 syntax (`0` or a non-zero digit first, then an optional fraction and
 * exponent), or -1 when there is none.
 */
const charsNumberEnd = (s: string, from: i32): i32 => {
  let i = from
  if (i < 0 || i >= s.length || !charsIsDigit(s.charCodeAt(i))) {
    return -1
  }
  if (s.charCodeAt(i) === 0x30) {
    i++
  } else {
    while (i < s.length && charsIsDigit(s.charCodeAt(i))) {
      i++
    }
  }
  if (i < s.length && s.charCodeAt(i) === 0x2e) {
    i++
    const start = i
    while (i < s.length && charsIsDigit(s.charCodeAt(i))) {
      i++
    }
    if (i === start) {
      return -1
    }
  }
  if (i < s.length && (s.charCodeAt(i) === 0x65 || s.charCodeAt(i) === 0x45)) {
    i++
    if (i < s.length && (s.charCodeAt(i) === 0x2b || s.charCodeAt(i) === 0x2d)) {
      i++
    }
    const start = i
    while (i < s.length && charsIsDigit(s.charCodeAt(i))) {
      i++
    }
    if (i === start) {
      return -1
    }
  }
  return i
}

/**
 * Whether `s` is a non-negative decimal in RFC 8259 §6 number syntax, as a
 * tolerance's `abs` is written.
 *
 * @param s the text
 * @returns true for text like `0`, `1.5` or `2e-10`
 */
export const charsIsAbs = (s: string): boolean => charsNumberEnd(s, 0) === s.length

/**
 * Whether `s` is an f64's text: a decimal in RFC 8259 §6 number syntax, or
 * `NaN`, `Infinity` or `-Infinity`.
 *
 * @param s the text
 * @returns true for f64 text
 */
export const charsIsF64Text = (s: string): boolean => {
  if (s === "NaN" || s === "Infinity" || s === "-Infinity") {
    return true
  }
  const from = s.startsWith("-") ? 1 : 0
  return charsNumberEnd(s, from) === s.length
}

/**
 * Whether `s` is a module path: two or more `/`-separated segments. A segment
 * is words joined by single `-`, `[a-z][a-z0-9_]*(-[a-z0-9][a-z0-9_]*)*`: the
 * first word starts with a letter, a later one with a letter or a digit.
 *
 * @param s the text
 * @returns true for a module path like `nish/crypto/hkdf` or `nish/net/quic-packet`
 */
export const charsIsModule = (s: string): boolean => {
  let segments: u32 = 0
  // The bytes of the current word, and whether it is its segment's first.
  let word: u32 = 0
  let first = true
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c === 0x2f || c === 0x2d) {
      if (word === 0) {
        return false
      }
      if (c === 0x2f) {
        segments++
      }
      word = 0
      first = c === 0x2f
    } else if (charsIsLower(c) || (charsIsDigit(c) && (word > 0 || !first)) || (c === 0x5f && word > 0)) {
      word++
    } else {
      return false
    }
  }
  return word > 0 && segments >= 1
}

/**
 * Whether `s` holds an ASCII letter.
 *
 * @param s the text
 * @returns true when some byte of `s` is A-Z or a-z
 */
export const charsHasLetter = (s: string): boolean => {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (charsIsLower(c) || charsIsUpper(c)) {
      return true
    }
  }
  return false
}

/**
 * Whether words are one word array as printed: each is `digits` lowercase hex
 * digits, and either every word opens with `0x` or none does.
 *
 * @param words the words
 * @param digits the hex digits of one word (4, 8 or 16)
 * @returns true when the words are a non-empty, consistently spelled array
 */
export const charsIsWordList = (words: string[], digits: i32): boolean => {
  if (words.length < 1) {
    return false
  }
  const prefixed = words[0].startsWith("0x")
  for (const w of words) {
    if (w.startsWith("0x") !== prefixed) {
      return false
    }
    const body = prefixed ? w.substring(2, w.length) : w
    if (!charsIsLowerHex(body, digits)) {
      return false
    }
  }
  return true
}
