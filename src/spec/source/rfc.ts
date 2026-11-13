/**
 * `spec/source/rfc` — an RFC's plain-text rendering (rfc-editor.org's
 * rfcNNNN.txt), read well enough to answer two questions deterministically:
 *
 *   1. does this quote appear in section S?      (requirement fidelity)
 *   2. are these bytes printed in section S?     (test-vector fidelity)
 *
 * Neither needs a model. Together they stop a contract from citing a
 * requirement the RFC does not state, or a test vector it does not print: the
 * extractor proposes, the RFC text disposes.
 *
 * A heading starts in column 0 ("2.3.  Step 2", "A.1.  Test Case 1",
 * "Appendix A.  Test Vectors"); the table of contents is indented, so it never
 * reads as one. Page furniture (the "[Page N]" footer, the running "RFC NNNN"
 * header, form feeds) is dropped before anything is read.
 */

import { replaceAll, splitLines, splitWhitespace, trim, trimEnd } from "nish/text"
import { hiddenProblem, hiddenText } from "./hidden"

/** One numbered section of an RFC. */
export class RfcSection {
  /** "2.3", "A.1", or "A" for an appendix. */
  id: string
  title: string
  /** The section's lines and its subsections', page furniture removed. */
  lines: string[]
  /** Only the section's own lines, up to its first subsection. */
  ownLines: string[]
  /**
   * Makes a section.
   *
   * @param id the section number
   * @param title the heading's text
   * @param lines the section's lines, its subsections' included
   * @param ownLines its lines up to its first subsection
   */
  constructor(id: string, title: string, lines: string[], ownLines: string[]) {
    this.id = id
    this.title = title
    this.lines = lines
    this.ownLines = ownLines
  }
}

/** An RFC read into its sections. */
export class RfcDocument {
  /** The number its "Request for Comments:" header gives; -1 when none. */
  number: i32 = -1
  /** Every section, in the order its heading appears. */
  sections: RfcSection[]
  /** Makes an empty document. */
  constructor() {
    this.sections = []
  }
}

/** One value printed in hex, and the name it is printed under, if any. */
export class HexValue {
  /** Lowercase hex, two digits a byte. */
  hex: string
  /** "Key" for "Key = 00:01:…", "IKM" for "IKM = 0x0b…"; null when nothing names it. */
  label: string | null
  /**
   * Makes a value.
   *
   * @param hex the value's lowercase hex
   * @param label the name it is printed under, or null
   */
  constructor(hex: string, label: string | null) {
    this.hex = hex
    this.label = label
  }
}

const rfcIsDigit = (c: i32): boolean => c >= 48 && c <= 57

const rfcIsHexDigit = (c: i32): boolean => rfcIsDigit(c) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70)

const rfcIsAlnum = (c: i32): boolean => rfcIsDigit(c) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)

const rfcIsBlank = (c: i32): boolean => c === 32 || c === 9

/** The last place `needle` starts in `s`, or -1. */
const rfcLastIndexOf = (s: string, needle: string): i32 => {
  for (let i = s.length - needle.length; i >= 0; i--) {
    if (s.substring(i, i + needle.length) === needle) {
      return i
    }
  }
  return -1
}

/** Whether all of `s` is hex digits, `even` asking for whole bytes too. */
const rfcAllHex = (s: string, even: boolean): boolean => {
  if (s.length === 0 || (even && s.length % 2 !== 0)) {
    return false
  }
  for (let i = 0; i < s.length; i++) {
    if (!rfcIsHexDigit(s.charCodeAt(i))) {
      return false
    }
  }
  return true
}

/** Whether all of `s` is decimal digits. */
const rfcAllDigits = (s: string): boolean => {
  for (let i = 0; i < s.length; i++) {
    if (!rfcIsDigit(s.charCodeAt(i))) {
      return false
    }
  }
  return s.length > 0
}

/** `s` with ASCII capitals lowered. */
const rfcLower = (s: string): string => {
  const out: string[] = []
  let from = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 65 && c <= 90) {
      out.push(s.substring(from, i))
      out.push(String.fromCharCode(c + 32))
      from = i + 1
    }
  }
  out.push(s.substring(from, s.length))
  return out.join("")
}

/**
 * `s` with every run of whitespace one space and none at the ends, so a quote
 * matches across the RFC's line wrapping.
 *
 * @param s the text
 * @returns its words joined by single spaces
 */
export const rfcNormalize = (s: string): string => splitWhitespace(s).join(" ")

/** Whether a line is a page footer, ending "[Page N]". */
const rfcIsFooter = (line: string): boolean => {
  const t = trimEnd(line)
  if (!t.endsWith("]")) {
    return false
  }
  const open = rfcLastIndexOf(t, "[Page ")
  return open >= 0 && rfcAllDigits(t.substring(open + 6, t.length - 1))
}

/** Whether a line is a running header: "RFC NNNN", a gap, a title, a gap, "Month YYYY". */
const rfcIsHeader = (line: string): boolean => {
  if (!line.startsWith("RFC ")) {
    return false
  }
  let i = 4
  while (i < line.length && rfcIsDigit(line.charCodeAt(i))) {
    i++
  }
  if (i === 4 || !line.substring(i, line.length).startsWith("  ")) {
    return false
  }
  const words = splitWhitespace(line)
  const year = words[words.length - 1]
  return words.length >= 4 && year.length === 4 && rfcAllDigits(year)
}

/** The id and title of a heading line, or null when it is not one. */
const rfcHeading = (line: string): string[] | null => {
  if (line.startsWith("Appendix ") && line.length > 11) {
    const c = line.charCodeAt(9)
    if (c >= 65 && c <= 90 && line.charCodeAt(10) === 46 && rfcIsBlank(line.charCodeAt(11))) {
      const title = trim(line.substring(12, line.length))
      return title.length > 0 ? [line.substring(9, 10), title] : null
    }
    return null
  }
  // \d+(\.\d+)* or [A-Z](\.\d+)+, then ".", whitespace and a title.
  let i = 0
  const first = line.length > 0 ? line.charCodeAt(0) : 0
  let parts = 0
  if (first >= 65 && first <= 90) {
    if (line.length < 2 || line.charCodeAt(1) !== 46) {
      return null
    }
    i = 2
    parts = 1
  }
  while (true) {
    const start = i
    while (i < line.length && rfcIsDigit(line.charCodeAt(i))) {
      i++
    }
    if (i === start) {
      if (parts === 0 || i >= line.length || line.charCodeAt(i - 1) !== 46) {
        return null
      }
      // The dot just read ends the id.
      break
    }
    parts++
    if (i >= line.length || line.charCodeAt(i) !== 46) {
      return null
    }
    i++
  }
  // `i` is just past the id's closing dot.
  const id = line.substring(0, i - 1)
  if (first >= 65 && first <= 90 && parts < 2) {
    return null
  }
  if (i >= line.length || !rfcIsBlank(line.charCodeAt(i))) {
    return null
  }
  const title = trim(line.substring(i, line.length))
  return title.length > 0 ? [id, title] : null
}

/**
 * Reads an RFC's plain text into its sections, as it is: no check that it is
 * an RFC (rfcRead makes those).
 *
 * @param text the RFC's text
 * @returns its number and its sections; a section runs to the next heading
 *   that is not one of its subsections, so "2.3" holds "2.3.1"
 */
export const rfcParse = (text: string): RfcDocument => {
  const doc = new RfcDocument()
  const lines: string[] = []
  for (const raw of splitLines(text)) {
    let l = raw.endsWith("\r") ? raw.substring(0, raw.length - 1) : raw
    if (l.indexOf("\f") >= 0) {
      l = replaceAll(l, "\f", "")
    }
    if (!rfcIsFooter(l) && !rfcIsHeader(l)) {
      lines.push(l)
    }
  }
  const marker = text.indexOf("Request for Comments:")
  if (marker >= 0) {
    let i = marker + 21
    while (i < text.length && rfcIsBlank(text.charCodeAt(i))) {
      i++
    }
    let n = 0
    let digits = 0
    while (i < text.length && rfcIsDigit(text.charCodeAt(i)) && digits < 9) {
      n = n * 10 + (text.charCodeAt(i) - 48)
      i++
      digits++
    }
    if (digits > 0) {
      doc.number = n
    }
  }
  const ids: string[] = []
  const titles: string[] = []
  const ats: i32[] = []
  for (let at = 0; at < lines.length; at++) {
    const h = rfcHeading(lines[at])
    if (h !== null) {
      ids.push(h[0])
      titles.push(h[1])
      ats.push(at)
    }
  }
  for (let k = 0; k < ids.length; k++) {
    if (rfcSection(doc, ids[k]) !== null) {
      continue
    }
    let end = lines.length
    for (let j = k + 1; j < ids.length; j++) {
      if (!ids[j].startsWith(`${ids[k]}.`)) {
        end = ats[j]
        break
      }
    }
    const ownEnd = k + 1 < ids.length ? ats[k + 1] : lines.length
    doc.sections.push(new RfcSection(ids[k], titles[k], lines.slice(ats[k], end), lines.slice(ats[k], ownEnd)))
  }
  return doc
}

/**
 * Reads an RFC's plain text, refusing a text that is not one (no "Request for
 * Comments: N" header, or no form feed) and a text hiding what it says from
 * the gates (hiddenText).
 *
 * @param text the file's text
 * @param file the file's name, for messages
 * @returns `Ok` with the document, or `Err` saying why it is refused
 */
export const rfcRead = (text: string, file: string): Result<RfcDocument, string> => {
  const doc = rfcParse(text)
  if (doc.number < 0 || text.indexOf("\f") < 0) {
    return Err(
      `${file}: not an RFC's plain text: it needs a "Request for Comments: N" header and the form feeds of its page breaks`,
    )
  }
  const hidden = hiddenProblem(text, file)
  if (hidden !== null) {
    return Err(hidden)
  }
  return Ok(doc)
}

/**
 * A section by its number.
 *
 * @param doc the RFC
 * @param id the section number, like "2.3" or "A.1"
 * @returns the section, or null when the RFC has none by that number
 */
export const rfcSection = (doc: RfcDocument, id: string): RfcSection | null => {
  for (const s of doc.sections) {
    if (s.id === id) {
      return s
    }
  }
  return null
}

/**
 * A section's text, whitespace collapsed (rfcNormalize).
 *
 * @param sec the section
 * @returns its lines and its subsections' as one line
 */
export const rfcSectionText = (sec: RfcSection): string => rfcNormalize(sec.lines.join("\n"))

/**
 * Whether a quote appears in a section or its subsections, compared with
 * whitespace collapsed on both sides.
 *
 * @param sec the section
 * @param quote the quoted text
 * @returns true when the quote is non-empty and printed there
 */
export const rfcQuoteIn = (sec: RfcSection, quote: string): boolean => {
  const q = rfcNormalize(quote)
  return q.length > 0 && rfcSectionText(sec).indexOf(q) >= 0
}

/**
 * Where a quote appears in a section's own text (not its subsections'), as
 * [start, end) byte offsets into its collapsed own text.
 *
 * @param sec the section
 * @param quote the quoted text
 * @returns start and end offsets, two per appearance; empty when none
 */
export const rfcOwnSpans = (sec: RfcSection, quote: string): i32[] => {
  const text = rfcNormalize(sec.ownLines.join("\n"))
  const q = rfcNormalize(quote)
  const spans: i32[] = []
  if (q.length === 0) {
    return spans
  }
  let at = toI32(text.indexOf(q))
  while (at >= 0) {
    spans.push(at)
    spans.push(at + q.length)
    at = toI32(text.indexOf(q, at + 1))
  }
  return spans
}

/** The state of reading a section's hex values, line by line. */
class RfcHexReader {
  values: HexValue[]
  cur: string
  label: string | null = null
  /** Every line of the current value was bare digit pairs. */
  bareOnly: boolean
  /** The last text line, when it names what comes below it. */
  pending: string | null = null
  /** The previous line ended inside a colon run, which this line may continue. */
  colonOpen: boolean
  constructor() {
    this.values = []
    this.cur = ""
    this.bareOnly = true
    this.colonOpen = false
  }
}

/** Whether the byte at `i` of `s` is an ASCII letter, digit or `_`; false outside `s`. */
const rfcWordByte = (s: string, i: i32): boolean => {
  if (i < 0 || i >= s.length) {
    return false
  }
  const c = s.charCodeAt(i)
  return c === 0x5f || (c >= 0x30 && c <= 0x39) || (c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a)
}

/** Whether lower-case `l` holds `word` as a whole word: no letter or digit on either side. */
const rfcHasWord = (l: string, word: string): boolean => {
  let from = 0
  while (from <= l.length) {
    const at = l.indexOf(word, from)
    if (at < 0) {
      return false
    }
    if (!rfcWordByte(l, at - 1) && !rfcWordByte(l, at + word.length)) {
      return true
    }
    from = at + 1
  }
  return false
}

/**
 * Whether a label calls its value a number printed in base 10: the whole word
 * decimal, number or integer, or base 10 (also base-10, base10). "Numbered"
 * and "integers" do not count, so a hex run they label is kept.
 */
const rfcDecimalLabel = (label: string): boolean => {
  const l = rfcLower(label)
  return (
    rfcHasWord(l, "decimal") ||
    rfcHasWord(l, "number") ||
    rfcHasWord(l, "integer") ||
    rfcHasWord(l, "base 10") ||
    rfcHasWord(l, "base-10") ||
    rfcHasWord(l, "base10")
  )
}

/** Ends the current value: kept unless it is an unnamed (or number-named) run of bare digits. */
const rfcHexFlush = (r: RfcHexReader): void => {
  const label = r.label
  const decimal = r.bareOnly && rfcAllDigits(r.cur) && (label === null || rfcDecimalLabel(label))
  if (r.cur.length > 0 && !decimal) {
    r.values.push(new HexValue(r.cur, label))
  }
  r.cur = ""
  r.label = null
  r.bareOnly = true
  r.colonOpen = false
}

/** Starts a value, or goes on with the current one. */
const rfcHexStart = (r: RfcHexReader, name: string | null, bare: boolean): void => {
  if (r.cur.length === 0) {
    r.label = name !== null && name.length > 0 ? name : r.pending
    r.bareOnly = bare
    r.pending = null
  } else if (!bare) {
    r.bareOnly = false
  }
}

/** "o  Key = (" → "Key"; null when nothing is left. */
const rfcLabelBefore = (text: string): string | null => {
  let t = trim(text)
  if (t.startsWith("o ")) {
    t = trim(t.substring(2, t.length))
  }
  let end = t.length
  while (end > 0) {
    const c = t.charCodeAt(end - 1)
    if (c !== 40 && c !== 61 && c !== 58 && !rfcIsBlank(c)) {
      break
    }
    end--
  }
  let start = 0
  while (start < end) {
    const c = t.charCodeAt(start)
    if (c !== 58 && c !== 59 && c !== 44 && c !== 46 && c !== 41 && !rfcIsBlank(c)) {
      break
    }
    start++
  }
  const out = rfcNormalize(t.substring(start, end))
  return out.length > 0 ? out : null
}

/** The name a line gives to the value below it ("Ciphertext:", "The Key"), or null. */
const rfcLabelLine = (line: string): string | null => {
  const t = trim(line)
  if (t.endsWith(":") || t.endsWith("=")) {
    return rfcLabelBefore(t)
  }
  if (t.length === 0 || t.length > 40) {
    return null
  }
  const first = t.charCodeAt(0)
  if (!((first >= 65 && first <= 90) || (first >= 97 && first <= 122))) {
    return null
  }
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i)
    // : = ( ) [ ] " ' `
    if (c === 58 || c === 61 || c === 40 || c === 41 || c === 91 || c === 93 || c === 34 || c === 39 || c === 96) {
      return null
    }
  }
  const last = t.charCodeAt(t.length - 1)
  if (last === 46 || last === 44 || last === 59 || last === 33 || last === 63) {
    return null
  }
  return rfcNormalize(t)
}

/** A hexdump line's bytes ("016  65 6d 65 …  emen of"), or null. */
const rfcDump = (line: string): string | null => {
  let i = 0
  while (i < line.length && rfcIsBlank(line.charCodeAt(i))) {
    i++
  }
  const offStart = i
  while (i < line.length && rfcIsHexDigit(line.charCodeAt(i))) {
    i++
  }
  const offLen = i - offStart
  if (offLen < 3 || offLen > 4 || i >= line.length || !rfcIsBlank(line.charCodeAt(i))) {
    return null
  }
  while (i < line.length && rfcIsBlank(line.charCodeAt(i))) {
    i++
  }
  const out: string[] = []
  while (true) {
    if (i + 2 > line.length || !rfcIsHexDigit(line.charCodeAt(i)) || !rfcIsHexDigit(line.charCodeAt(i + 1))) {
      return null
    }
    out.push(line.substring(i, i + 2))
    i += 2
    if (i >= line.length) {
      break
    }
    if (line.charCodeAt(i) !== 32) {
      return null
    }
    if (i + 1 >= line.length || rfcIsBlank(line.charCodeAt(i + 1))) {
      // Two blanks: the ASCII column, or the end of the line.
      break
    }
    i++
  }
  return rfcLower(out.join(""))
}

/** Whether `c` may border a colon run or a 0x value without joining it. */
const rfcIsWordByte = (c: i32): boolean => rfcIsAlnum(c) || c === 95

/** Reads every `0x…` on a line as its own value; false when the line has none. */
const rfcHexPrefixed = (r: RfcHexReader, line: string): boolean => {
  let found = false
  let from = 0
  let i = 0
  while (i + 2 < line.length) {
    if (
      line.charCodeAt(i) === 48 &&
      line.charCodeAt(i + 1) === 120 &&
      rfcIsHexDigit(line.charCodeAt(i + 2)) &&
      (i === 0 || !rfcIsWordByte(line.charCodeAt(i - 1)))
    ) {
      let end = i + 2
      while (end < line.length && rfcIsHexDigit(line.charCodeAt(end))) {
        end++
      }
      rfcHexFlush(r)
      rfcHexStart(r, rfcLabelBefore(line.substring(from, i)), false)
      r.cur = rfcLower(line.substring(i + 2, end))
      found = true
      from = end
      i = end
    } else {
      i++
    }
  }
  return found
}

/** The end of a colon run starting at `i` (h{1,2}(:h{1,2})+:?), or -1. */
const rfcColonRunEnd = (line: string, i: number): i32 => {
  if (i > 0 && (rfcIsWordByte(line.charCodeAt(i - 1)) || line.charCodeAt(i - 1) === 58)) {
    return -1
  }
  let j = toI32(i)
  let groups = 0
  while (true) {
    const start = j
    while (j < line.length && j - start < 2 && rfcIsHexDigit(line.charCodeAt(j))) {
      j++
    }
    if (j === start) {
      break
    }
    groups++
    if (j < line.length && line.charCodeAt(j) === 58) {
      j++
    } else {
      break
    }
  }
  if (groups < 2 && !(groups === 1 && j > 0 && line.charCodeAt(j - 1) === 58 && j - i > 1)) {
    return -1
  }
  if (j < line.length && rfcIsWordByte(line.charCodeAt(j))) {
    return -1
  }
  return groups >= 2 ? j : -1
}

/** Reads the colon runs on a line ("1a:e1:0b:"); false when it has none. */
const rfcHexColons = (r: RfcHexReader, line: string): boolean => {
  let found = false
  let from = 0
  let i = 0
  while (i < line.length) {
    const end = rfcColonRunEnd(line, i)
    if (end < 0) {
      i++
      continue
    }
    const before = line.substring(from, i)
    const continues = !found && r.colonOpen && trim(before).length === 0
    if (!continues) {
      rfcHexFlush(r)
      rfcHexStart(r, rfcLabelBefore(before), false)
    }
    found = true
    r.cur = `${r.cur}${rfcLower(replaceAll(line.substring(i, end), ":", ""))}`
    from = end
    i = end
    // A run reaching the end of the line may go on in the next one.
    r.colonOpen = trim(line.substring(from, line.length)).length === 0
    if (!r.colonOpen) {
      rfcHexFlush(r)
    }
  }
  return found
}

/** Whether every blank-separated token of `s` is whole hex bytes. */
const rfcTokensHex = (s: string): boolean => {
  const tokens = splitWhitespace(s)
  if (tokens.length === 0) {
    return false
  }
  for (const t of tokens) {
    if (!rfcAllHex(t, true)) {
      return false
    }
  }
  return true
}

/** Reads "Key = 0b0b…", "Data: 4869…" or "Key            aaaa…"; false when the line is not one. */
const rfcHexLabelled = (r: RfcHexReader, line: string): boolean => {
  let t = trim(line)
  if (t.startsWith("o ")) {
    t = trim(t.substring(2, t.length))
  }
  if (t.length === 0) {
    return false
  }
  const first = t.charCodeAt(0)
  if (!((first >= 65 && first <= 90) || (first >= 97 && first <= 122))) {
    return false
  }
  let split = -1
  let valueAt = -1
  for (let i = 0; i < t.length && i <= 80; i++) {
    const c = t.charCodeAt(i)
    if (c === 58 || c === 61) {
      split = i
      valueAt = i + 1
      break
    }
    if (rfcIsBlank(c) && i + 1 < t.length && rfcIsBlank(t.charCodeAt(i + 1))) {
      split = i
      valueAt = i
      break
    }
  }
  if (split <= 0) {
    return false
  }
  const value = t.substring(valueAt, t.length)
  if (!rfcTokensHex(value)) {
    return false
  }
  rfcHexFlush(r)
  // Named on its own line, all-digit hex is still hex.
  rfcHexStart(r, rfcLabelBefore(t.substring(0, split)), false)
  r.cur = rfcLower(splitWhitespace(value).join(""))
  return true
}

/** A line without a trailing aside such as "(32 octets)"; an aside of hex is kept. */
const rfcDropAside = (line: string): string => {
  const t = trimEnd(line)
  if (!t.endsWith(")")) {
    return line
  }
  const open = rfcLastIndexOf(t, "(")
  if (open <= 0 || !rfcIsBlank(t.charCodeAt(open - 1))) {
    return line
  }
  const inner = t.substring(open + 1, t.length - 1)
  if (inner.indexOf("(") >= 0) {
    return line
  }
  for (let i = 0; i < inner.length; i++) {
    const c = inner.charCodeAt(i)
    if (!rfcIsHexDigit(c) && c !== 58 && !rfcIsBlank(c)) {
      return t.substring(0, open)
    }
  }
  return line
}

/**
 * The values a section prints in hex, each with the name it is printed under.
 * Five shapes are read: a hexdump ("016  65 6d …  emen of"), `0x…`, colon
 * runs ("1a:e1:0b:", continued on the next line, even mid-byte), a labelled
 * value ("Key = 0b0b…", "Key            aaaa…") and bare byte runs. A value is
 * consecutive hex-bearing lines (blank lines do not end one, so a dump
 * survives a page break); any other text line ends it, and a labelled value
 * starts a new one. Bare digits with no name, or under a name calling them a
 * number ("Input scalar as a number (base 10):"), are a decimal number and
 * left out.
 *
 * @param sec the section
 * @returns its values, in order
 */
export const rfcHexValues = (sec: RfcSection): HexValue[] => {
  const r = new RfcHexReader()
  for (const raw of sec.lines) {
    const line = rfcDropAside(raw)
    if (trim(line).length === 0) {
      continue
    }
    const dump = rfcDump(line)
    if (dump !== null) {
      if (r.colonOpen) {
        rfcHexFlush(r)
      }
      rfcHexStart(r, null, false)
      r.cur = `${r.cur}${dump}`
      continue
    }
    if (rfcHexPrefixed(r, line) || rfcHexColons(r, line) || rfcHexLabelled(r, line)) {
      continue
    }
    if (rfcTokensHex(line)) {
      if (r.colonOpen) {
        rfcHexFlush(r)
      }
      const joined = splitWhitespace(line).join("")
      rfcHexStart(r, null, rfcAllDigits(joined))
      r.cur = `${r.cur}${rfcLower(joined)}`
      continue
    }
    rfcHexFlush(r)
    r.pending = rfcLabelLine(line)
  }
  rfcHexFlush(r)
  return r.values
}

/**
 * Whether bytes are printed in a section: `hex` appears, byte-aligned, inside
 * one of its values (rfcHexValues).
 *
 * @param sec the section
 * @param hex the bytes as lowercase hex, two digits a byte
 * @returns true when printed; the empty value is printed everywhere
 */
export const rfcHexPrinted = (sec: RfcSection, hex: string): boolean => {
  if (hex.length === 0) {
    return true
  }
  const want = rfcLower(hex)
  for (const v of rfcHexValues(sec)) {
    let at = toI32(v.hex.indexOf(want))
    while (at >= 0) {
      if (at % 2 === 0) {
        return true
      }
      at = toI32(v.hex.indexOf(want, at + 1))
    }
  }
  return false
}

/**
 * Why a quote cannot be confirmed in a section of an RFC: the quote hides
 * text from the gates (hiddenText), the RFC has no such section, or the
 * section does not print the quote.
 *
 * @param doc the RFC
 * @param id the section the quote cites
 * @param quote the quoted text
 * @returns the problem, or null when the section prints the quote
 */
export const rfcQuoteProblem = (doc: RfcDocument, id: string, quote: string): string | null => {
  const hidden = hiddenText(quote)
  if (hidden.length > 0) {
    return `the quote holds text a reader cannot see as the gates read it: ${hidden[0]}`
  }
  const sec = rfcSection(doc, id)
  if (sec === null) {
    return `RFC ${doc.number} has no section ${id}`
  }
  if (rfcNormalize(quote).length === 0) {
    return "the quote is empty"
  }
  if (!rfcQuoteIn(sec, quote)) {
    return `RFC ${doc.number} section ${id} does not say "${rfcNormalize(quote)}"`
  }
  return null
}
