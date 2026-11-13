/**
 * `spec/gates/text` — how the fidelity and completeness gates read a
 * section's text, without lookaround (nish/regex has none): word lists
 * matched at word edges, the binding BCP 14 keywords, a labelled integer or
 * f64, and the lines a value is printed on as a whole value.
 *
 * A word edge is a letter or a digit, not `\b`, so `_not_` and `**never**`
 * hold the word. A word list entry is a lowercase phrase (its spaces match one
 * space of normalized text), matched in any case; a trailing `*` lets letters
 * follow it, and the entry `*n't` is any word ending in n't (with ' or ’).
 */

import { asciiLower, split, splitWhitespace } from "nish/text"
import { rfcNormalize } from "../source/rfc"

/** Words that, before a stated result in its sentence, deny or condition it. */
export const GATE_DENY: string =
  "not|never|no|none|nor|neither|nothing|nobody|nowhere|cannot|*n't|avoid*|forb*|prohibit*|prevent*|refus*|reject*|disallow*|instead|rather|except*|without|unless|fail*|error*|invalid*|illegal*|unlike|other|but|if|when|whenever|while|whether|assum*|suppos*|example*|e.g|i.e|instance|some|earlier|previous*|former*|draft*|said|says|historic*|legacy"

/** Words that, after a stated result, take it back. */
export const GATE_RETRACT: string =
  "not|never|no|none|nor|neither|cannot|*n't|avoid*|forb*|prohibit*|prevent*|disallow*|instead|rather|wrong*|incorrect*|bug*|an error|but|remov*|deprecat*|obsolete*|retract*|withdr*|supersed*|replaced"

/** Words that, after a stated result, say it does not hold each time. */
export const GATE_HEDGE: string =
  "at most|at least|sometimes|some|occasional*|usual*|often|typical*|general*|most*|possib*|probab*|random*|perhaps|maybe|once|twice|times|elsewhere|said|claim*"

/** Words that, right after a stated result, still belong to its clause. */
export const GATE_CLAUSE_GOES_ON: string =
  "when|whenever|if|unless|for|on|upon|in|at|from|after|before|otherwise|because|since|as|until|while|with|without|then|here|there|immediately"

/** The binding BCP 14 keywords, the longer first. */
const GATE_KEYWORDS: string = "MUST NOT|MUST|SHALL NOT|SHALL|REQUIRED"

const gateIsDigit = (c: i32): boolean => c >= 48 && c <= 57

const gateIsLetter = (c: i32): boolean => (c >= 65 && c <= 90) || (c >= 97 && c <= 122)

const gateIsAlnum = (c: i32): boolean => gateIsDigit(c) || gateIsLetter(c)

/** Whether `c` is = or :. */
const gateIsSep = (c: i32): boolean => c === 0x3d || c === 0x3a

/** Whether `c` is a space or a tab. */
const gateIsBlank = (c: i32): boolean => c === 32 || c === 9

/** The byte at `i`, or -1 outside `s`. */
const gateByte = (s: string, i: i32): i32 => (i >= 0 && i < s.length ? s.charCodeAt(i) : -1)

/** Whether a letter or digit is at `i` of `s`; false outside it. */
const gateAlnumAt = (s: string, i: i32): boolean => gateIsAlnum(gateByte(s, i))

/** Whether `i` is a word start: no letter or digit just before it. */
const gateWordStart = (s: string, i: i32): boolean => !gateAlnumAt(s, i - 1)

/** Where an apostrophe (' or ’) at `i` ends, or -1 when there is none. */
const gateApostropheEnd = (s: string, i: i32): i32 => {
  if (gateByte(s, i) === 0x27) {
    return i + 1
  }
  if (s.substring(i, i + 3) === "’") {
    return i + 3
  }
  return -1
}

/** Where entry `w` matches `lower` from `i` (a word start), or -1. */
const gateEntryEnd = (lower: string, i: i32, w: string): i32 => {
  if (w === "*n't") {
    let j = i
    while (gateIsLetter(gateByte(lower, j))) {
      j = j + 1
    }
    if (j - i < 2 || gateByte(lower, j - 1) !== 0x6e) {
      return -1
    }
    const a = gateApostropheEnd(lower, j)
    if (a < 0 || gateByte(lower, a) !== 0x74 || gateAlnumAt(lower, a + 1)) {
      return -1
    }
    return a + 1
  }
  const star = w.endsWith("*")
  const lit = star ? w.substring(0, w.length - 1) : w
  if (lower.substring(i, i + lit.length) !== lit) {
    return -1
  }
  let j = i + lit.length
  if (star) {
    while (gateIsLetter(gateByte(lower, j))) {
      j = j + 1
    }
  }
  return gateAlnumAt(lower, j) ? -1 : j
}

/**
 * The first place a word of a list is used in a text: the leftmost word
 * start where an entry matches, the earlier entry winning at one place.
 *
 * @param text the text, whitespace normalized
 * @param list the list, its words separated by "|" (GATE_DENY, ...)
 * @returns its start and end offsets, or an empty array when no word is used
 */
export const gateWordFind = (text: string, list: string): i32[] => {
  const words = split(list, "|")
  const lower = asciiLower(text)
  for (let i = 0; i < lower.length; i++) {
    if (!gateWordStart(lower, i) || !gateAlnumAt(lower, i)) {
      continue
    }
    for (const w of words) {
      const end = gateEntryEnd(lower, i, w)
      if (end >= 0) {
        return [i, end]
      }
    }
  }
  return []
}

/**
 * Whether a word of a list starts a text, after any spaces: one of the
 * words a clause goes on with, say.
 *
 * @param text the text
 * @param list the list, its words separated by "|"
 * @returns the word's end offset, or -1 when the text does not start with one
 */
export const gateWordLeads = (text: string, list: string): i32 => {
  const words = split(list, "|")
  const lower = asciiLower(text)
  let i = 0
  while (gateByte(lower, i) === 32) {
    i = i + 1
  }
  if (!gateAlnumAt(lower, i)) {
    return -1
  }
  for (const w of words) {
    const end = gateEntryEnd(lower, i, w)
    if (end >= 0) {
      return end
    }
  }
  return -1
}

/**
 * The binding BCP 14 keywords used in a text: MUST NOT, MUST, SHALL NOT,
 * SHALL and REQUIRED, in capitals, at word edges, and not in double quotes
 * (the RFC 2119 boilerplate that names them).
 *
 * @param text the text, whitespace normalized
 * @returns for each use, its offset and then the index of its keyword in
 *   gateKeywordName's order; two numbers a use
 */
export const gateKeywordUses = (text: string): i32[] => {
  const out: i32[] = []
  let i = 0
  while (i < text.length) {
    const prev = gateByte(text, i - 1)
    let end = -1
    if (prev !== 0x22 && !gateIsAlnum(prev)) {
      const kws = split(GATE_KEYWORDS, "|")
      for (let k = 0; k < kws.length && end < 0; k++) {
        const kw = kws[k]
        const next = gateByte(text, i + kw.length)
        if (text.substring(i, i + kw.length) === kw && next !== 0x22 && !gateIsAlnum(next)) {
          out.push(i)
          out.push(k)
          end = i + kw.length
        }
      }
    }
    i = end >= 0 ? end : i + 1
  }
  return out
}

/**
 * A keyword's text by the index gateKeywordUses gives.
 *
 * @param k the index
 * @returns the keyword, such as "MUST NOT"
 */
export const gateKeywordName = (k: i32): string => split(GATE_KEYWORDS, "|")[k]

/**
 * A section's lines as the value checks read them: each whitespace
 * collapsed, the empty ones dropped, joined by newlines, so a label and its
 * value are on one line.
 *
 * @param lines the section's lines
 * @returns the lines, one per line
 */
export const gateLines = (lines: string[]): string => {
  const out: string[] = []
  for (const l of lines) {
    const n = rfcNormalize(l)
    if (n.length > 0) {
      out.push(n)
    }
  }
  return out.join("\n")
}

/** The quotes a printed string may stand in, opening and closing. */
const GATE_QUOTES: string = "\"|\"|'|'|\u201c|\u201d|\u2018|\u2019|`|`"

/** Whether `value` at `p..e` of `lines` is printed whole there. */
const gateWhole = (lines: string, p: i32, e: i32): boolean => {
  const quotes = split(GATE_QUOTES, "|")
  for (let q = 0; q < quotes.length; q += 2) {
    const open = quotes[q]
    const close = quotes[q + 1]
    if (lines.substring(p - open.length, p) === open && lines.substring(e, e + close.length) === close) {
      return true
    }
  }
  const endsLine = e === lines.length || gateByte(lines, e) === 10
  if (!endsLine) {
    return false
  }
  if (p === 0 || gateByte(lines, p - 1) === 10) {
    return true
  }
  const b = gateByte(lines, p - 1)
  return gateIsSep(b) || (b === 32 && gateIsSep(gateByte(lines, p - 2)))
}

/** The line of `lines` that offset `at` is on, counting from 0. */
const gateLineOf = (lines: string, at: i32): i32 => {
  let n = 0
  for (let i = 0; i < at && i < lines.length; i++) {
    if (lines.charCodeAt(i) === 10) {
      n = n + 1
    }
  }
  return n
}

/**
 * The lines on which a value is printed whole: in quotes, as a whole line,
 * or ending a line after "=" or ":". A value wrapped across lines counts on
 * every line it spans; a value inside a longer one is not printed there
 * ("Zg" is not printed by `"Zg=="`).
 *
 * @param lines the section's lines (gateLines)
 * @param value the value, whitespace normalized
 * @returns the line numbers, counting from 0, each once, ascending
 */
export const gateTextLines = (lines: string, value: string): i32[] => {
  const out: i32[] = []
  if (value.length === 0) {
    return out
  }
  const flat: string[] = []
  for (let i = 0; i < lines.length; i++) {
    flat.push(lines.charCodeAt(i) === 10 ? " " : lines.substring(i, i + 1))
  }
  const text = flat.join("")
  let p = toI32(text.indexOf(value))
  while (p >= 0) {
    const e = p + value.length
    if (gateWhole(lines, p, e)) {
      const last = gateLineOf(lines, e - 1)
      for (let l = gateLineOf(lines, p); l <= last; l++) {
        if (out.indexOf(l) < 0) {
          out.push(l)
        }
      }
    }
    p = toI32(text.indexOf(value, p + 1))
  }
  return out.sort((a: i32, b: i32): i32 => (a > b ? 1 : a < b ? -1 : 0))
}

/** Whether `c` may come just before a label: not part of a longer name. */
const gateLabelEdge = (c: i32): boolean => !(gateIsAlnum(c) || c === 0x5f || c === 0x2e || c === 0x2d)

/** Where the separator after a label at `e` ends: blanks, or blanks, = or :, blanks; -1 when none. */
const gateAfterLabel = (lines: string, e: i32): i32 => {
  let j = e
  while (gateIsBlank(gateByte(lines, j))) {
    j = j + 1
  }
  const c = gateByte(lines, j)
  if (c === 0x3d || c === 0x3a) {
    j = j + 1
    while (gateIsBlank(gateByte(lines, j))) {
      j = j + 1
    }
    return j
  }
  return j > e ? j : -1
}

/** The offsets just past each printing of `label` and its separator. */
const gateLabelEnds = (lines: string, label: string): i32[] => {
  const l = rfcNormalize(label)
  const out: i32[] = []
  if (l.length === 0) {
    return out
  }
  let p = toI32(lines.indexOf(l))
  while (p >= 0) {
    const after = gateLabelEdge(gateByte(lines, p - 1)) ? gateAfterLabel(lines, p + l.length) : -1
    if (after >= 0) {
      out.push(after)
      p = toI32(lines.indexOf(l, after))
    } else {
      p = toI32(lines.indexOf(l, p + 1))
    }
  }
  return out
}

/** Whether a number ends at `j`: nothing that would run it on (`1,000`, `4-5`, `1 000`, `x1`). */
const gateNumberEnds = (lines: string, j: i32): boolean => {
  const c = gateByte(lines, j)
  if (gateIsAlnum(c) || c === 0x5f) {
    return false
  }
  const runOn = c === 0x2e || c === 0x2c || c === 0x3a || c === 0x2f || c === 0x2d || c === 32 || c === 9
  return !(runOn && gateIsDigit(gateByte(lines, j + 1)))
}

/** Whether an integer starts at `j`: an optional -, an optional 0x, hex digits ending in a decimal digit. */
const gateIntStarts = (lines: string, j: i32): boolean => {
  let i = j
  if (gateByte(lines, i) === 0x2d) {
    i = i + 1
  }
  if (gateByte(lines, i) === 0x30 && (gateByte(lines, i + 1) === 0x78 || gateByte(lines, i + 1) === 0x58)) {
    i = i + 2
  }
  let sawDigit = false
  while (true) {
    const c = gateByte(lines, i)
    const hexLetter = (c >= 97 && c <= 102) || (c >= 65 && c <= 70)
    if (gateIsDigit(c)) {
      sawDigit = true
    } else if (!hexLetter) {
      break
    }
    i = i + 1
  }
  return sawDigit
}

/** A non-negative decimal string's hex digits, lowercase, without leading zeros. */
const gateDecimalHex = (dec: string): string => {
  let digits: i32[] = []
  for (let i = 0; i < dec.length; i++) {
    digits.push(dec.charCodeAt(i) - 48)
  }
  const out: string[] = []
  const hex = "0123456789abcdef"
  while (digits.length > 0) {
    const next: i32[] = []
    let rem = 0
    for (const d of digits) {
      const cur = rem * 10 + d
      const q = toI32(cur / 16)
      rem = cur - q * 16
      if (next.length > 0 || q > 0) {
        next.push(q)
      }
    }
    out.push(hex.substring(rem, rem + 1))
    digits = next
  }
  if (out.length === 0) {
    return "0"
  }
  const rev: string[] = []
  for (let i = out.length - 1; i >= 0; i--) {
    rev.push(out[i])
  }
  return rev.join("")
}

/** Whether the integer `n` (decimal text) is printed at `j`, in decimal or 0x hex, and ends there. */
const gateIntAt = (lines: string, j: i32, n: string): boolean => {
  if (lines.substring(j, j + n.length) === n && gateNumberEnds(lines, j + n.length)) {
    return true
  }
  if (n.startsWith("-")) {
    return false
  }
  const x = gateByte(lines, j + 1)
  if (gateByte(lines, j) !== 0x30 || (x !== 0x78 && x !== 0x58)) {
    return false
  }
  let i = j + 2
  while (gateByte(lines, i) === 0x30) {
    i = i + 1
  }
  const want = gateDecimalHex(n)
  if (asciiLower(lines.substring(i, i + want.length)) === want && gateNumberEnds(lines, i + want.length)) {
    return true
  }
  return want === "0" && i > j + 2 && gateNumberEnds(lines, i)
}

/**
 * At which of a label's printings with an integer after it (counting from 0)
 * the integer is `n`: `L = 42`, `Block Count: 1`, `L 42`, or 0x hex. The
 * label and its value share a line.
 *
 * @param lines the section's lines (gateLines)
 * @param label the label
 * @param n the integer, as decimal text
 * @returns the printings that carry it; empty when none
 */
export const gateIntRounds = (lines: string, label: string, n: string): i32[] => {
  const out: i32[] = []
  let round = 0
  for (const j of gateLabelEnds(lines, label)) {
    if (!gateIntStarts(lines, j)) {
      continue
    }
    if (gateIntAt(lines, j, n)) {
      out.push(round)
    }
    round = round + 1
  }
  return out
}

/**
 * How many times a label is printed with an integer after it.
 *
 * @param lines the section's lines (gateLines)
 * @param label the label
 * @returns the count
 */
export const gateIntLabelCount = (lines: string, label: string): i32 => {
  let n = 0
  for (const j of gateLabelEnds(lines, label)) {
    if (gateIntStarts(lines, j)) {
      n = n + 1
    }
  }
  return n
}

/** Where a decimal number (or Infinity or NaN) printed at `j` ends; -1 when none is. */
const gateF64End = (lines: string, j: i32): i32 => {
  let i = j
  const s = gateByte(lines, i)
  if (s === 0x2b || s === 0x2d) {
    i = i + 1
  }
  for (const word of ["Infinity", "NaN"]) {
    if (lines.substring(i, i + word.length) === word) {
      return i + word.length
    }
  }
  const start = i
  while (gateIsDigit(gateByte(lines, i))) {
    i = i + 1
  }
  const intDigits = i - start
  if (gateByte(lines, i) === 0x2e) {
    i = i + 1
    const frac = i
    while (gateIsDigit(gateByte(lines, i))) {
      i = i + 1
    }
    if (intDigits === 0 && i === frac) {
      return -1
    }
  } else if (intDigits === 0) {
    return -1
  }
  const e = gateByte(lines, i)
  if (e === 0x65 || e === 0x45) {
    let k = i + 1
    const sign = gateByte(lines, k)
    if (sign === 0x2b || sign === 0x2d) {
      k = k + 1
    }
    const from = k
    while (gateIsDigit(gateByte(lines, k))) {
      k = k + 1
    }
    if (k > from) {
      i = k
    }
  }
  return i
}

/**
 * The decimal numbers printed after a label, as printed: `x = 1.5`,
 * `y: -0`, `z NaN`. The label and its value share a line.
 *
 * @param lines the section's lines (gateLines)
 * @param label the label
 * @returns each number, in order
 */
export const gateF64Printed = (lines: string, label: string): string[] => {
  const out: string[] = []
  for (const j of gateLabelEnds(lines, label)) {
    const e = gateF64End(lines, j)
    if (e > j && gateNumberEnds(lines, e)) {
      out.push(lines.substring(j, e))
    }
  }
  return out
}

/** Abbreviations whose period does not end a sentence, each between bars. */
const GATE_ABBREVIATIONS: string = "|e.g|E.g|i.e|I.e|etc|vs|cf|Cf|Fig|Sec|"

/** The length of a list bullet (`o `, `* `, `- `) at an offset, or 0. */
const gateBulletLen = (text: string, at: i32): i32 => {
  const b = text.substring(at, at + 2)
  return b === "o " || b === "* " || b === "- " ? 2 : 0
}

/** Whether the period at an offset ends an abbreviation such as "e.g". */
const gateAbbreviationEnds = (text: string, at: i32): boolean => {
  let j = at - 1
  while (j >= 0) {
    const c = text.charCodeAt(j)
    if (!(c === 46 || (c >= 65 && c <= 90) || (c >= 97 && c <= 122))) {
      break
    }
    j = j - 1
  }
  return j + 1 < at && GATE_ABBREVIATIONS.indexOf(`|${text.substring(j + 1, at)}|`) >= 0
}

/**
 * Where each paragraph after the first starts in the normalized text of some
 * lines (rfcNormalize of the lines joined): a paragraph ends at a blank line,
 * which normalizing the text erases.
 *
 * @param lines the lines, as a section's ownLines holds them
 * @returns each later paragraph's first offset, in order
 */
export const gateParagraphStarts = (lines: string[]): i32[] => {
  const out: i32[] = []
  let off = 0
  let blank = false
  for (const line of lines) {
    const words = splitWhitespace(line)
    if (words.length === 0) {
      blank = off > 0
      continue
    }
    if (off > 0) {
      off = off + 1
      if (blank) {
        out.push(off)
      }
    }
    off = off + words.join(" ").length
    blank = false
  }
  return out
}

/** Where a sentence stops before its terminator (`.`, `?`, `"`, `”`), which a quote may leave out. */
const gateTerminatorStart = (text: string, start: i32, end: i32): i32 => {
  let stop = end
  let more = true
  while (more && stop > start) {
    const c = text.charCodeAt(stop - 1)
    // 46 is `.`, 63 `?`, 34 `"`; a closing curly quote is three bytes.
    if (c === 46 || c === 63 || c === 34) {
      stop = stop - 1
    } else if (stop - 3 >= start && text.substring(stop - 3, stop) === "\u201d") {
      stop = stop - 3
    } else {
      more = false
    }
  }
  return stop
}

/**
 * Where a section's normalized text breaks into sentences, three numbers a
 * break: where the sentence before it stops (at its terminator), where its
 * terminator and any closing quote end, and where the next sentence starts
 * (after any list bullet). A paragraph's end always breaks. Within one, a
 * sentence ends at `.`, `?`, `."` or `.”` before a space, except a period
 * that ends an abbreviation (e.g., i.e., etc., vs., cf., Fig., Sec.): an
 * identifier such as `hexDecode` may start the next sentence. A list item
 * ends before its bullet, and a `;` or `:` before a bullet ends the item
 * before it.
 *
 * @param text the normalized text
 * @param paras where each paragraph after the first starts (gateParagraphStarts)
 * @returns the breaks, in order
 */
export const gateSentenceBreaks = (text: string, paras: i32[]): i32[] => {
  const out: i32[] = []
  let p = 0
  let i = 0
  while (i + 1 < text.length) {
    while (p < paras.length && paras[p] <= i) {
      p = p + 1
    }
    const c = text.charCodeAt(i)
    // 46 is `.`, 63 `?`, 59 `;`, 58 `:`; 34 is `"`.
    if (c === 46 || c === 63 || c === 59 || c === 58) {
      let k = i + 1
      if (text.charCodeAt(k) === 34) {
        k = k + 1
      } else if (text.substring(k, k + 3) === "\u201d") {
        k = k + 3
      }
      if (k + 1 < text.length && text.charCodeAt(k) === 32) {
        const bullet = gateBulletLen(text, k + 1)
        let ends = bullet > 0 || c === 63 || (p < paras.length && paras[p] === k + 1)
        if (c === 46 && !ends) {
          ends = !gateAbbreviationEnds(text, i)
        }
        if (ends) {
          out.push(i)
          out.push(k)
          out.push(k + 1 + bullet)
          i = k + 1 + bullet
          continue
        }
      }
    }
    if (c === 32 && p < paras.length && paras[p] === i + 1) {
      // A paragraph ends here, with or without a terminator.
      const bullet = gateBulletLen(text, i + 1)
      out.push(gateTerminatorStart(text, 0, i))
      out.push(i)
      out.push(i + 1 + bullet)
      i = i + 1 + bullet
      continue
    }
    if (c === 32 && text.substring(i + 1, i + 3) === "o ") {
      // A bullet with no punctuation before it still starts an item.
      out.push(i)
      out.push(i)
      out.push(i + 3)
      i = i + 3
      continue
    }
    i = i + 1
  }
  return out
}

/**
 * The sentence around an offset of a section's normalized text, as three
 * offsets: where it starts (after any list bullet), where it stops before
 * its terminator (which a quote may leave out), and where the terminator
 * and any closing quote end. Sentences are split as gateSentenceBreaks
 * splits them.
 *
 * @param text the normalized text
 * @param paras where each paragraph after the first starts (gateParagraphStarts)
 * @param at the offset
 * @returns [start, stop, end]
 */
export const gateSentenceSpan = (text: string, paras: i32[], at: i32): i32[] => {
  let start = gateBulletLen(text, 0)
  let stop = -1
  let end = text.length
  const breaks = gateSentenceBreaks(text, paras)
  for (let i = 0; i + 2 < breaks.length; i += 3) {
    if (breaks[i + 2] <= at) {
      start = breaks[i + 2]
    } else if (breaks[i] >= at) {
      stop = breaks[i]
      end = breaks[i + 1]
      break
    }
  }
  if (stop < 0) {
    stop = gateTerminatorStart(text, start, text.length)
  }
  return [start, stop, end]
}

/**
 * The sentence around an offset of a section's normalized text, with its
 * terminator, as gateSentenceSpan bounds it.
 *
 * @param text the normalized text
 * @param paras where each paragraph after the first starts (gateParagraphStarts)
 * @param at the offset
 * @returns the sentence
 */
export const gateSentenceAt = (text: string, paras: i32[], at: i32): string => {
  const b = gateSentenceSpan(text, paras, at)
  return text.substring(b[0], b[2])
}

/** The value of a hex digit, or -1. */
const gateHexDigit = (c: i32): i32 => {
  if (c >= 48 && c <= 57) {
    return c - 48
  }
  if (c >= 97 && c <= 102) {
    return c - 87
  }
  if (c >= 65 && c <= 70) {
    return c - 55
  }
  return -1
}

/** The end of the byte list whose `[` is at an offset, its bytes pushed to `out`; -1 when it is not one. */
const gateByteListAt = (line: string, open: i32, out: string[]): i32 => {
  let i = open + 1
  let hex = ""
  while (i + 1 < line.length && gateHexDigit(line.charCodeAt(i)) >= 0 && gateHexDigit(line.charCodeAt(i + 1)) >= 0) {
    hex = `${hex}${asciiLower(line.substring(i, i + 2))}`
    i = i + 2
    if (i < line.length && line.charCodeAt(i) === 93) {
      out.push(hex)
      return i + 1
    }
    // 32 is a space, 44 a comma: what may part two bytes.
    const from = i
    while (i < line.length && (line.charCodeAt(i) === 32 || line.charCodeAt(i) === 44)) {
      i = i + 1
    }
    if (i === from) {
      return -1
    }
  }
  return -1
}

/**
 * Each byte list a line prints, such as `[00 0f f0 ff]` in
 * `hexEncode([00 0f f0 ff])`: two hex digits a byte, parted by spaces or
 * commas, inside brackets. A spec prints a vector's bytes so, and each list
 * is a whole printed value.
 *
 * @param line the line
 * @returns each list's bytes as lowercase hex, in order
 */
export const gateByteLists = (line: string): string[] => {
  const out: string[] = []
  let at = line.indexOf("[")
  while (at >= 0) {
    const end = gateByteListAt(line, toI32(at), out)
    at = line.indexOf("[", end > 0 ? end : at + 1)
  }
  return out
}
