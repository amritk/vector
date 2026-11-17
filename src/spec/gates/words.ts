/**
 * `spec/gates/words` — the blocks of words a section prints, which a
 * u16[], u32[] or u64[] vector value binds to. A block is a maximal run of
 * non-blank lines, each either a grid row (words of one width, one of which
 * may be marked with a leading `*` that is not part of it) or one
 * `name = word` assignment, all its words of one width (4, 8 or 16
 * lowercase hex digits) and one spelling (`0x` on all or none). A run with
 * any other line is not a block. A block's words are read row by row.
 *
 * Any blank line ends a block, a page break's too. Where page furniture was
 * removed between two runs that could be one block (the line after the
 * break is a row of words of the width and spelling of the line before it),
 * the print does not say whether they are one block split by the page or
 * two blocks: the blank lines xml2rfc pads a page with look like the blank
 * line between two blocks. Each such block is marked `atBreak`, and the
 * block before a break that may continue it is marked `joinsNext`, so
 * fidelity refuses a value that meets the break rather than guess. Furniture
 * removed with no blank line around it ends a run all the same. A row of
 * another width or spelling, a `name = word` line of another width, a label
 * or any other line after a break ends the block before it, which stays
 * unmarked.
 *
 * A block's label is the name of a one-line assignment, or else the short
 * line printed above it (blank lines between), when that line is not a
 * sentence (it does not end in `.`, `:` or `,`), not a heading (it does not
 * open with a section number) and holds no words of its own. The names of
 * a block of several assignments (`a = …`, `b = …`) name its words, not the block, so such a block has no label.
 */

import { splitWhitespace } from "nish/text"
import { charsIsLowerHex } from "../contract/chars"
import { rfcNormalize } from "../source/rfc"

/** One block of words a section prints. */
export class GateWordBlock {
  /** The words, row by row, each as printed (`0x` and all, without a `*` mark). */
  words: string[]
  /** The label it is printed under; null when it has none. */
  label: string | null
  /** The hex digits of each word: 4, 8 or 16. */
  digits: i32
  /** Whether a page break before or after it may join it to more words, so where it ends is not printed. */
  atBreak: boolean
  /** Whether the next block is printed after a page break that may join the two into one. */
  joinsNext: boolean
  /**
   * Makes a block.
   *
   * @param words its words, as printed
   * @param label its label, or null
   * @param digits the hex digits of each word
   */
  constructor(words: string[], label: string | null, digits: i32) {
    this.words = words
    this.label = label
    this.digits = digits
    this.atBreak = false
    this.joinsNext = false
  }
}

/** The longest line read as a block's label. */
const GATE_WORDS_LABEL_MAX: i32 = 60

/** A word's hex digits: 4, 8 or 16, or 0 when it is not a word. */
const gateWordsDigits = (w: string): i32 => {
  const body = w.startsWith("0x") ? w.substring(2, w.length) : w
  for (const d of [4, 8, 16]) {
    if (charsIsLowerHex(body, d)) {
      return d
    }
  }
  return 0
}

/** Whether a token is a name an assignment's value is printed under. */
const gateWordsIsName = (t: string): boolean => {
  if (t.length === 0) {
    return false
  }
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i)
    const ok = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 45
    if (!ok) {
      return false
    }
  }
  return true
}

/** One line read as words: a grid row's or an assignment's. */
class GateWordsLine {
  words: string[]
  /** The assignment's name; null for a grid row. */
  name: string | null
  constructor(words: string[], name: string | null) {
    this.words = words
    this.name = name
  }
}

/** A line's words, when it is a grid row or one `name = word` assignment; null otherwise. */
const gateWordsLine = (line: string): GateWordsLine | null => {
  const ts = splitWhitespace(rfcNormalize(line))
  if (ts.length === 3 && ts[1] === "=" && gateWordsIsName(ts[0]) && gateWordsDigits(ts[2]) > 0) {
    return new GateWordsLine([ts[2]], ts[0])
  }
  if (ts.length === 0) {
    return null
  }
  const words: string[] = []
  for (const t of ts) {
    const w = t.startsWith("*") ? t.substring(1, t.length) : t
    if (gateWordsDigits(w) === 0) {
      return null
    }
    words.push(w)
  }
  return new GateWordsLine(words, null)
}

/** Whether every word has `digits` digits and the spelling (`0x` or not) of the first. */
const gateWordsOneKind = (words: string[], digits: i32): boolean => {
  const prefixed = words[0].startsWith("0x")
  return words.every((w: string): boolean => gateWordsDigits(w) === digits && w.startsWith("0x") === prefixed)
}

/** Whether a token is a section number (`3`, `2.1.1`, `2.1.`), as a heading opens with. */
const gateWordsIsSectionNumber = (t: string): boolean => {
  let digits = false
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i)
    if (c >= 48 && c <= 57) {
      digits = true
    } else if (c !== 46 || !digits) {
      return false
    }
  }
  return digits
}

/** The label printed above the block starting at line `start`, or null. */
const gateWordsLabelAbove = (lines: string[], start: i32): string | null => {
  let i = start - 1
  while (i >= 0 && rfcNormalize(lines[i]).length === 0) {
    i = i - 1
  }
  if (i < 0) {
    return null
  }
  const above = rfcNormalize(lines[i])
  if (above.length > GATE_WORDS_LABEL_MAX || above.endsWith(".") || above.endsWith(":") || above.endsWith(",")) {
    return null
  }
  const ts = splitWhitespace(above)
  if (gateWordsIsSectionNumber(ts[0])) {
    return null
  }
  for (const t of ts) {
    const w = t.startsWith("*") ? t.substring(1, t.length) : t
    if (gateWordsDigits(w) > 0) {
      return null
    }
  }
  return above
}

/** Whether a page break was removed in the lines from `from` to `to`, both included. */
const gateWordsBreakIn = (pageBreaks: i32[], from: i32, to: i32): boolean => {
  for (const p of pageBreaks) {
    if (p >= from && p <= to) {
      return true
    }
  }
  return false
}

/** Whether two lines of words could be rows of one block: the same width and spelling. */
const gateWordsSameKind = (a: GateWordsLine, b: GateWordsLine): boolean => {
  const x = a.words[0]
  const y = b.words[0]
  return gateWordsDigits(x) === gateWordsDigits(y) && x.startsWith("0x") === y.startsWith("0x")
}

/**
 * The blocks of words a section's lines print, in order (see the module
 * comment).
 *
 * @param lines the section's lines
 * @param pageBreaks where page furniture was removed from them (RfcSection.pageBreaks)
 * @returns each block
 */
export const gateWordBlocks = (lines: string[], pageBreaks: i32[]): GateWordBlock[] => {
  const out: GateWordBlock[] = []
  // Each run of non-blank lines, which a page break ends as a blank line does: its first line, the line after its last, and the block it is (-1 when none).
  const starts: i32[] = []
  const ends: i32[] = []
  const of: i32[] = []
  let i = 0
  while (i < lines.length) {
    if (rfcNormalize(lines[i]).length === 0) {
      i = i + 1
      continue
    }
    const start = i
    let block = true
    const read: GateWordsLine[] = []
    while (
      i < lines.length &&
      rfcNormalize(lines[i]).length > 0 &&
      (i === start || !gateWordsBreakIn(pageBreaks, i, i))
    ) {
      const w = gateWordsLine(lines[i])
      if (w === null) {
        block = false
      } else {
        read.push(w)
      }
      i = i + 1
    }
    starts.push(start)
    ends.push(i)
    of.push(-1)
    if (!block) {
      continue
    }
    const words: string[] = []
    const names: string[] = []
    for (const r of read) {
      for (const w of r.words) {
        words.push(w)
      }
      const n = r.name
      if (n !== null) {
        names.push(n)
      }
    }
    const digits = gateWordsDigits(words[0])
    if (!gateWordsOneKind(words, digits)) {
      continue
    }
    let label: string | null = null
    if (names.length === 0) {
      label = gateWordsLabelAbove(lines, start)
    } else if (read.length === 1) {
      label = names[0]
    }
    of[of.length - 1] = out.length
    const one = new GateWordBlock(words, label, digits)
    out.push(one)
  }
  for (let r = 0; r + 1 < starts.length; r++) {
    if (!gateWordsBreakIn(pageBreaks, ends[r], starts[r + 1])) {
      continue
    }
    const before = gateWordsLine(lines[ends[r] - 1])
    const after = gateWordsLine(lines[starts[r + 1]])
    if (before === null || after === null || !gateWordsSameKind(before, after)) {
      continue
    }
    const a = of[r]
    const b = of[r + 1]
    if (a >= 0) {
      out[a].atBreak = true
    }
    if (b >= 0) {
      out[b].atBreak = true
    }
    if (a >= 0 && b >= 0) {
      out[a].joinsNext = true
    }
  }
  return out
}
