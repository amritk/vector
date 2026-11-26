/**
 * `spec/xml/text` — RFC XML v3 as the plain text xml2rfc's text writer
 * prints, and the blocks of a section read as lines.
 *
 * An element's text is its character data and its children's, in order:
 * `<iref>` and `<cref>` print nothing, `<br>` a space, an `<xref>` or
 * `<eref>` what xml2rfc prints for it, and a block element (a paragraph, a
 * list item, a table cell) is kept apart from its neighbours by a space.
 * Whitespace is collapsed once, at the end, as JavaScript's `\s` collapses
 * it (a no-break space included), with the non-breaking hyphen read as "-"
 * and zero-width spaces and word joiners dropped (xmlClean).
 *
 * A section's lines are its blocks: each paragraph one line, each table cell
 * one line, each line of a code block one line, and a blank line between two
 * blocks (two cells that each hold only a printed word are one block), so a
 * reader that ends a paragraph at a blank line (as RFC text is read) never
 * runs one block's sentence into the next. A sentence holding a
 * `<bcp14>` is recorded as normative at the level its markup names.
 */

import { trimEnd } from "nish/text"
import { vocabLevels } from "../contract/vocab"
import { gateWordBlocks } from "../gates/words"
import { XmlError, XmlNode, xmlAttr, xmlElements, xmlErrorAt } from "./reader"

/** What an `<xref>` without derivedContent prints, as the document works it out. */
export class XmlXrefInfo {
  /** The reference text: a section number, a figure's, a reference's anchor. */
  reftext: string
  /** Whether it points at a `<reference>` (printed in brackets). */
  reference: boolean
  /**
   * Makes an entry.
   *
   * @param reftext the reference text
   * @param reference whether the target is a reference
   */
  constructor(reftext: string, reference: boolean) {
    this.reftext = reftext
    this.reference = reference
  }
}

/** What rendering needs of the document: each xref's worked-out text. */
export class XmlText {
  /** The worked-out text of each `<xref>`, keyed by its node. */
  xrefs: Map<XmlNode, XmlXrefInfo>
  /** Makes an empty context. */
  constructor() {
    this.xrefs = new Map<XmlNode, XmlXrefInfo>()
  }
}

/** A sentence holding a `<bcp14>`, at the level its markup names. */
export class XmlNormative {
  /** The section's number; "" for an unnumbered section. */
  section: string
  /** The BCP 14 keyword the markup names; NOT RECOMMENDED is stored as SHOULD NOT. */
  level: string
  /** The sentence's text. */
  sentence: string
  /** The sentence's first `<bcp14>`. */
  node: XmlNode
  /** The index, in its section's own lines, of the line holding it. */
  line: i32
  /** Where in that line's text the sentence starts. */
  start: i32
  /** The anchor of the nearest anchored element around it; null when none. */
  anchor: string | null
  /**
   * Makes an entry.
   *
   * @param section the section's number, or ""
   * @param level the BCP 14 level
   * @param sentence the sentence
   * @param node its first `<bcp14>`
   */
  constructor(section: string, level: string, sentence: string, node: XmlNode) {
    this.section = section
    this.level = level
    this.sentence = sentence
    this.node = node
    this.line = 0
    this.start = 0
    this.anchor = null
  }
}

/**
 * The bytes at `i` a collapse reads specially, whose first is `c`: 4 * kind +
 * length, 0 for none.
 */
const xmlSpecialAt = (s: string, i: u32, c: i32): i32 => {
  if (c === 0x20 || (c >= 0x09 && c <= 0x0d)) {
    return 4 + 1
  }
  // In u32: `i` is below the length, so neither sum wraps.
  const at1 = i + 1
  const at2 = i + 2
  if (c < 0xc2 || at1 >= toU32(s.length)) {
    return 0
  }
  const c1 = s.charCodeAt(at1)
  if (c === 0xc2) {
    return c1 === 0xa0 ? 4 + 2 : 0
  }
  if (at2 >= toU32(s.length)) {
    return 0
  }
  const c2 = s.charCodeAt(at2)
  if (c === 0xe1) {
    return c1 === 0x9a && c2 === 0x80 ? 4 + 3 : 0
  }
  if (c === 0xe3) {
    return c1 === 0x80 && c2 === 0x80 ? 4 + 3 : 0
  }
  if (c === 0xef) {
    return c1 === 0xbb && c2 === 0xbf ? 4 + 3 : 0
  }
  if (c !== 0xe2) {
    return 0
  }
  if (c1 === 0x80) {
    // U+2000..U+200A, U+2028, U+2029 and U+202F are spaces; U+200B is
    // dropped; U+2011 is a hyphen.
    if (c2 <= 0x8a || c2 === 0xa8 || c2 === 0xa9 || c2 === 0xaf) {
      return 4 + 3
    }
    if (c2 === 0x8b) {
      return 8 + 3
    }
    return c2 === 0x91 ? 12 + 3 : 0
  }
  if (c1 === 0x81) {
    if (c2 === 0x9f) {
      return 4 + 3
    }
    return c2 === 0xa0 ? 8 + 3 : 0
  }
  return 0
}

/**
 * Text with its whitespace collapsed to single spaces and trimmed, the
 * non-breaking hyphen (U+2011) read as "-", and zero-width spaces (U+200B)
 * and word joiners (U+2060) dropped. Whitespace is what JavaScript's `\s`
 * matches: ASCII blanks, the no-break space and the Unicode spaces.
 *
 * @param s the text
 * @returns it, collapsed
 */
const xmlClean = (s: string): string => {
  const out: string[] = []
  let gap = false
  let any = false
  let run = -1
  // In u32: below the length, plus at most 3, it never wraps.
  let i: u32 = 0
  while (i < toU32(s.length)) {
    const sp = xmlSpecialAt(s, i, s.charCodeAt(i))
    if (sp === 0) {
      if (run < 0) {
        if (gap && any) {
          out.push(" ")
        }
        gap = false
        run = toI32(i)
      }
      i = i + 1
      continue
    }
    if (run >= 0) {
      out.push(s.substring(run, toI32(i)))
      any = true
      run = -1
    }
    const kind = sp >> 2
    if (kind === 1) {
      gap = true
    } else if (kind === 3) {
      if (gap && any) {
        out.push(" ")
      }
      gap = false
      out.push("-")
      any = true
    }
    i = i + toU32(sp & 3)
  }
  if (run >= 0) {
    if (gap && any) {
      out.push(" ")
    }
    out.push(s.substring(run, s.length))
  }
  return out.join("")
}

/** Whether an element is a block: its text is kept apart from its neighbours'. */
const xmlIsBlock = (name: string): boolean =>
  name === "rfc" ||
  name === "front" ||
  name === "middle" ||
  name === "back" ||
  name === "section" ||
  name === "name" ||
  name === "t" ||
  name === "ul" ||
  name === "ol" ||
  name === "dl" ||
  name === "li" ||
  name === "dt" ||
  name === "dd" ||
  name === "blockquote" ||
  name === "aside" ||
  name === "figure" ||
  name === "sourcecode" ||
  name === "artwork" ||
  name === "table" ||
  name === "thead" ||
  name === "tbody" ||
  name === "tfoot" ||
  name === "tr" ||
  name === "th" ||
  name === "td" ||
  name === "texttable" ||
  name === "ttcol" ||
  name === "c" ||
  name === "preamble" ||
  name === "postamble" ||
  name === "references" ||
  name === "reference" ||
  name === "note" ||
  name === "abstract" ||
  name === "boilerplate" ||
  name === "title" ||
  name === "author" ||
  name === "address" ||
  name === "seriesInfo" ||
  name === "date"

/** Whether an element is running text inside a paragraph. */
const xmlIsInline = (name: string): boolean =>
  name === "bcp14" ||
  name === "tt" ||
  name === "em" ||
  name === "strong" ||
  name === "sub" ||
  name === "sup" ||
  name === "u" ||
  name === "xref" ||
  name === "eref" ||
  name === "iref" ||
  name === "cref" ||
  name === "br" ||
  name === "spanx" ||
  name === "vspace"

/** Whether an element holds blocks when it holds any but running text. */
const xmlIsContainer = (name: string): boolean =>
  name === "list" ||
  name === "ul" ||
  name === "ol" ||
  name === "dl" ||
  name === "li" ||
  name === "dt" ||
  name === "dd" ||
  name === "blockquote" ||
  name === "aside" ||
  name === "figure"

/** Whether `s`, after `from`, starts with an ASCII digit. */
const xmlStartsDigit = (s: string): boolean => s.length > 0 && s.charCodeAt(0) >= 48 && s.charCodeAt(0) <= 57

/** Whether a section number names an appendix: a capital letter, alone or before a dot. */
const xmlIsAppendix = (s: string): boolean => {
  if (s.length < 1) {
    return false
  }
  const c = s.charCodeAt(0)
  // `s.length > 1` always holds past `s.length === 1`; it is stated for the prover.
  return c >= 65 && c <= 90 && (s.length === 1 || (s.length > 1 && s.charCodeAt(1) === 0x2e))
}

/**
 * How many bytes of white space, as JS `String.prototype.trim` counts it
 * (ECMAScript WhiteSpace and LineTerminator), start at byte `i` of `s`; 0
 * when none does. Nish's `trim` strips only space, tab, LF and CR, and the
 * old extractor trimmed NBSP, U+3000, U+FEFF and the rest too. None starts
 * at or past the end of `s`.
 */
const xmlSpaceWidth = (s: string, i: u32): i32 => {
  if (i >= toU32(s.length)) {
    return 0
  }
  const b = s.charCodeAt(i)
  if (b === 32 || (b >= 9 && b <= 13)) {
    return 1
  }
  // In u32: `i` is below the length, so neither sum wraps.
  const at1 = i + 1
  const at2 = i + 2
  const b1 = at1 < toU32(s.length) ? s.charCodeAt(at1) : -1
  const b2 = at2 < toU32(s.length) ? s.charCodeAt(at2) : -1
  if (b === 0xc2 && b1 === 0xa0) {
    return 2
  }
  if (b === 0xe1 && b1 === 0x9a && b2 === 0x80) {
    return 3
  }
  if (b === 0xe2 && b1 === 0x80 && ((b2 >= 0x80 && b2 <= 0x8a) || b2 === 0xa8 || b2 === 0xa9 || b2 === 0xaf)) {
    return 3
  }
  if (b === 0xe2 && b1 === 0x81 && b2 === 0x9f) {
    return 3
  }
  if (b === 0xe3 && b1 === 0x80 && b2 === 0x80) {
    return 3
  }
  if (b === 0xef && b1 === 0xbb && b2 === 0xbf) {
    return 3
  }
  return 0
}

/** Where the white space ending `s` before `end` starts, but not before `start`. */
const xmlTrimEnd = (s: string, start: u32, end: u32): u32 => {
  let e = end
  let more = true
  while (more && e > start) {
    more = false
    for (let w: u32 = 1; w <= 3; w++) {
      // White space starts with a lead byte, never a continuation byte, so none can
      // start before `start` and end at `e`; the bound keeps `e - w` from wrapping.
      if (e - start >= w && xmlSpaceWidth(s, e - w) === toI32(w)) {
        e = e - w
        more = true
        break
      }
    }
  }
  return e
}

/**
 * `s` without leading and trailing white space, as JS `String.prototype.trim`
 * strips it: ASCII space, tab, LF, VT, FF and CR, and NBSP, U+1680,
 * U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000 and U+FEFF.
 *
 * @param s the text
 * @returns it trimmed
 */
export const xmlTrim = (s: string): string => {
  // In u32: below the length, plus at most 3, it never wraps.
  let start: u32 = 0
  let end = toU32(s.length)
  while (start < end) {
    const w = xmlSpaceWidth(s, start)
    if (w === 0) {
      break
    }
    start = start + toU32(w)
  }
  end = xmlTrimEnd(s, start, end)
  return s.substring(toI32(start), toI32(end))
}

/** What an `<xref>` or `<eref>` puts before and after its content. */
class XmlWrap {
  before: string
  after: string

  constructor(before: string, after: string) {
    this.before = before
    this.after = after
  }
}

/**
 * xml2rfc's text writer for an `<xref>`: what goes before and after its
 * content, which is already rendered and trimmed. With no content, the two
 * joined are the whole of it.
 */
const xmlXrefWrap = (t: XmlText, x: XmlNode, has: boolean): XmlWrap => {
  const info = t.xrefs.get(x)
  let reference = false
  let worked: string | null = null
  if (info !== undefined) {
    reference = info.reference
    worked = info.reftext
  }
  const reftext = xmlTrim(xmlAttr(x, "derivedContent") ?? worked ?? xmlAttr(x, "target") ?? "")
  const gap = has ? " " : ""
  const section = xmlAttr(x, "section")
  if (section !== null) {
    const label = xmlStartsDigit(section) ? "Section" : xmlIsAppendix(section) ? "Appendix" : "Part"
    const fmt = xmlAttr(x, "sectionFormat") ?? "of"
    if (fmt === "comma") {
      return new XmlWrap("", `${gap}[${reftext}], ${label} ${section}`)
    }
    if (fmt === "parens") {
      return new XmlWrap("", `${gap}[${reftext}] (${label} ${section})`)
    }
    if (fmt === "bare") {
      return has ? new XmlWrap(`${section} (`, ")") : new XmlWrap(section, "")
    }
    return new XmlWrap(`${label} ${section} of `, `${gap}[${reftext}]`)
  }
  const format = xmlAttr(x, "format") ?? "default"
  if (reftext.length === 0 || format === "none") {
    return new XmlWrap("", "")
  }
  const bracket = reference && format !== "title"
  if (has) {
    return new XmlWrap("", bracket ? ` [${reftext}]` : ` (${reftext})`)
  }
  return new XmlWrap("", bracket ? `[${reftext}]` : reftext)
}

/** xml2rfc's text writer for an `<eref>`: what goes before and after its trimmed content. */
const xmlErefWrap = (e: XmlNode, has: boolean): XmlWrap => {
  const target = xmlAttr(e, "target") ?? ""
  if ((xmlAttr(e, "brackets") ?? "") === "none") {
    return has ? new XmlWrap("", ` (${target})`) : new XmlWrap("", target)
  }
  return has ? new XmlWrap("", ` <${target}>`) : new XmlWrap("", `<${target}>`)
}

/** `s` without leading white space, as JS `trimStart` strips it; `s` itself when it has none. */
const xmlTrimLead = (s: string): string => {
  let start: u32 = 0
  while (start < toU32(s.length)) {
    const w = xmlSpaceWidth(s, start)
    if (w === 0) {
      break
    }
    start = start + toU32(w)
  }
  return start === 0 ? s : s.substring(toI32(start), s.length)
}

/** `s` without trailing white space, as JS `trimEnd` strips it; `s` itself when it has none. */
const xmlTrimTail = (s: string): string => {
  const end = xmlTrimEnd(s, 0, toU32(s.length))
  return end === toU32(s.length) ? s : s.substring(0, toI32(end))
}

/**
 * Trims, in place, the pieces of `out` after `from`, as `xmlTrim` would trim
 * them joined. Trailing pieces left empty are dropped, and the first piece
 * holding text moves up to `from`, so an enclosing `<xref>` or `<eref>`
 * finds its edges at once: each piece is trimmed at most once per edge it
 * reaches, and nesting never rescans text.
 *
 * @returns whether any text is left
 */
const xmlTrimPieces = (out: string[], from: u32): boolean => {
  // The last two tests follow from the first, since from >= 0; they are stated for the prover.
  let top = toU32(out.length) - 1
  while (toU32(out.length) > from && top < toU32(out.length) && out.length > 0) {
    const piece = out[top]
    out.pop()
    const last = xmlTrimTail(piece)
    if (last.length > 0) {
      out.push(last)
      break
    }
    top = toU32(out.length) - 1
  }
  let k = from
  while (k < toU32(out.length)) {
    const first = xmlTrimLead(out[k])
    out[k] = ""
    if (first.length > 0) {
      // `from` is at most `k`, which is below the length.
      if (from < toU32(out.length)) {
        out[from] = first
      }
      return true
    }
    k = k + 1
  }
  // `out.length > 0` follows from the first test; it is stated for the prover.
  while (toU32(out.length) > from && out.length > 0) {
    out.pop()
  }
  return false
}

/** The children of `n` rendered, in order, onto `out`. */
const xmlInner = (t: XmlText, n: XmlNode, found: XmlNode[] | null, out: string[]): void => {
  let k = n.first
  while (k !== null) {
    xmlRender(t, k, found, out)
    k = k.next
  }
}

/** An `<xref>` or `<eref>` rendered onto `out`: its content trimmed where it lies, then wrapped. */
const xmlRenderLink = (t: XmlText, n: XmlNode, found: XmlNode[] | null, out: string[]): void => {
  // In u32: an array's length is below 2^31, so the sum never wraps.
  const at = toU32(out.length)
  out.push("")
  xmlInner(t, n, found, out)
  const has = xmlTrimPieces(out, at + 1)
  const wrap = n.name === "xref" ? xmlXrefWrap(t, n, has) : xmlErefWrap(n, has)
  // The trim keeps every piece up to `at`, so the slot pushed is still there.
  if (at < toU32(out.length)) {
    out[at] = wrap.before
  }
  if (wrap.after.length > 0) {
    out.push(wrap.after)
  }
}

/**
 * A node's text before collapsing, pushed piece by piece onto `out`, so
 * nested markup costs no copy per level. Each `<bcp14>` met is pushed on
 * `found`, when it is not null, and its text is fenced by U+0001 and U+0002,
 * which no input holds (the reader refuses them).
 */
const xmlRender = (t: XmlText, n: XmlNode, found: XmlNode[] | null, out: string[]): void => {
  const name = n.name
  if (name.length === 0) {
    if (n.text.length > 0) {
      out.push(n.text)
    }
    return
  }
  if (name === "iref" || name === "cref") {
    return
  }
  if (name === "br") {
    out.push(" ")
    return
  }
  if (name === "xref" || name === "eref") {
    xmlRenderLink(t, n, found, out)
    return
  }
  if (name === "contact" || name === "author") {
    out.push(` ${xmlAttr(n, "fullname") ?? ""} `)
    xmlInner(t, n, found, out)
    out.push(" ")
    return
  }
  if (name === "bcp14" && found !== null) {
    found.push(n)
    out.push("\u0001")
    xmlInner(t, n, found, out)
    out.push("\u0002")
    return
  }
  const block = xmlIsBlock(name)
  if (block) {
    out.push(" ")
  }
  xmlInner(t, n, found, out)
  if (block) {
    out.push(" ")
  }
}

/** Nodes rendered one after another, then collapsed. */
const xmlRunText = (t: XmlText, nodes: XmlNode[], found: XmlNode[] | null): string => {
  const out: string[] = []
  for (const n of nodes) {
    xmlRender(t, n, found, out)
  }
  return xmlClean(out.join(""))
}

/**
 * A node's plain text, as xml2rfc's text writer prints it, collapsed.
 *
 * @param t the document's xref texts
 * @param n the node
 * @returns its text
 */
export const xmlPlainText = (t: XmlText, n: XmlNode): string => xmlRunText(t, [n], null)

/**
 * Nodes' plain text, rendered one after another as xml2rfc's text writer
 * prints them, then collapsed once: a paragraph's text with some of its
 * children left out.
 *
 * @param t the document's xref texts
 * @param nodes the nodes, in order
 * @returns their text
 */
export const xmlPlainTextOfNodes = (t: XmlText, nodes: XmlNode[]): string => xmlRunText(t, nodes, null)

/** A `<sourcecode>` or `<artwork>`: its text as written, and where it starts. */
export class XmlCode {
  /** Its type attribute; null when it has none. */
  type: string | null
  /** The block's character data, without its opening and closing blank lines or its trailing whitespace. */
  text: string
  /** The XML line its text starts on. */
  line: i32
  /** The markdown line of the last `<?line N?>` before its text; -1 when none. */
  mdLine: i32
  /** The XML line that `<?line N?>` stands on; 0 when none. */
  markLine: i32
  /**
   * Makes a code block.
   *
   * @param type its type, or null
   * @param text its text
   * @param line its XML line
   * @param mdLine the last mark's markdown line, or -1
   * @param markLine the XML line of that mark, or 0
   */
  constructor(type: string | null, text: string, line: i32, mdLine: i32, markLine: i32) {
    this.type = type
    this.text = text
    this.line = line
    this.mdLine = mdLine
    this.markLine = markLine
  }
}

/**
 * A code block's text: its character data, without the blank line that
 * opens it or the blank line that closes it, and the line its text starts on.
 *
 * @param n a `<sourcecode>` or `<artwork>`
 * @returns its text and where it starts
 */
export const xmlCodeOf = (n: XmlNode): XmlCode => {
  const parts: string[] = []
  let first: XmlNode | null = null
  let k = n.first
  while (k !== null) {
    if (k.name.length === 0) {
      parts.push(k.text)
      if (first === null) {
        first = k
      }
    }
    k = k.next
  }
  const raw = parts.join("")
  let lead = 0
  while (lead < raw.length && (raw.charCodeAt(lead) === 0x20 || raw.charCodeAt(lead) === 0x09)) {
    lead = lead + 1
  }
  lead = lead < raw.length && raw.charCodeAt(lead) === 0x0a ? lead + 1 : 0
  let text = raw.substring(lead, raw.length)
  let end = text.length
  while (end > 0 && (text.charCodeAt(end - 1) === 0x20 || text.charCodeAt(end - 1) === 0x09)) {
    end = end - 1
  }
  if (end > 0 && text.charCodeAt(end - 1) === 0x0a) {
    text = text.substring(0, end - 1)
  }
  const base = first ?? n
  // In u32: a line number is below the input's length, so the sum never wraps.
  const line = toI32(toU32(base.line) + (lead > 0 ? 1 : 0))
  return new XmlCode(xmlAttr(n, "type"), text, line, base.mdLine, base.markLine)
}

/** A table cell, and whether it is a header cell. */
export class XmlCell {
  /** The cell's element. */
  node: XmlNode
  /** True for a `<th>`. */
  header: boolean
  /**
   * Makes a cell.
   *
   * @param node the cell's element
   * @param header whether it is a header cell
   */
  constructor(node: XmlNode, header: boolean) {
    this.node = node
    this.header = header
  }
}

/** Appends the rows below `n` (through thead, tbody and tfoot) to `out`. */
const xmlRowsInto = (n: XmlNode, out: XmlNode[]): void => {
  for (const c of xmlElements(n)) {
    if (c.name === "tr") {
      out.push(c)
    } else if (c.name === "thead" || c.name === "tbody" || c.name === "tfoot") {
      xmlRowsInto(c, out)
    }
  }
}

/**
 * A table's rows of cells, in order. A v2 `<texttable>` reads the same: its
 * `<ttcol>`s are the header row and its `<c>`s fill rows of that width.
 *
 * @param table a `<table>` or `<texttable>`
 * @returns its rows; none is empty
 */
const xmlTableRows = (table: XmlNode): XmlCell[][] => {
  const rows: XmlCell[][] = []
  if (table.name === "texttable") {
    const head: XmlCell[] = []
    const cs: XmlNode[] = []
    for (const c of xmlElements(table)) {
      if (c.name === "ttcol") {
        head.push(new XmlCell(c, true))
      } else if (c.name === "c") {
        cs.push(c)
      }
    }
    const width = head.length > 0 ? head.length : 1
    if (head.length > 0) {
      rows.push(head)
    }
    let row: XmlCell[] = []
    for (const c of cs) {
      row.push(new XmlCell(c, false))
      if (row.length === width) {
        rows.push(row)
        row = []
      }
    }
    if (row.length > 0) {
      rows.push(row)
    }
    return rows
  }
  const trs: XmlNode[] = []
  xmlRowsInto(table, trs)
  for (const tr of trs) {
    const row: XmlCell[] = []
    for (const c of xmlElements(tr)) {
      if (c.name === "td" || c.name === "th") {
        row.push(new XmlCell(c, c.name === "th"))
      }
    }
    if (row.length > 0) {
      rows.push(row)
    }
  }
  return rows
}

/** Whether an element holds an element that is not running text. */
const xmlHoldsBlocks = (n: XmlNode): boolean => {
  let k = n.first
  while (k !== null) {
    if (k.name.length > 0 && !xmlIsInline(k.name)) {
      return true
    }
    k = k.next
  }
  return false
}

/** A section's lines being built, and the normative sentences found. */
export class XmlLines {
  /** The document's xref texts. */
  t: XmlText
  /** The normative sentences found so far, in document order. */
  normative: XmlNormative[]
  /** Where the lines of code the last xmlSectionLines read are: each an index into its lines. */
  code: i32[]
  /** Where the blank lines the last xmlSectionLines put between blocks are: each an index into its lines. */
  breaks: i32[]
  /** Makes a builder. @param t the document's xref texts */
  constructor(t: XmlText) {
    this.t = t
    this.normative = []
    this.code = []
    this.breaks = []
  }
}

/** Whether a level names a BCP 14 keyword (DEFINITION is no keyword). */
const xmlIsKeyword = (level: string): boolean => level !== "DEFINITION" && vocabLevels().indexOf(level) >= 0

/** `s` cut to at most `n` bytes, never inside a UTF-8 character. */
const xmlCut = (s: string, n: i32): string => {
  if (s.length <= n) {
    return s
  }
  let end = n
  while (end > 0 && (s.charCodeAt(end) & 0xc0) === 0x80) {
    end = end - 1
  }
  return s.substring(0, end)
}

/** The index of the first of `stops` at or after `at`. */
const xmlNextStop = (stops: i32[], at: i32): u32 => {
  // In u32: `lo` and `hi` stay at most the length, so no sum wraps.
  let lo: u32 = 0
  let hi = toU32(stops.length)
  while (lo < hi) {
    const mid = lo + ((hi - lo) >> 1)
    // `mid` is below `hi`, which is at most the length: the first test always holds.
    if (mid < toU32(stops.length) && stops[mid] < at) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }
  return lo
}

/**
 * Records the sentences of a run of nodes holding a `<bcp14>`, split at
 * ". ", each at the level its markup names. A keyword with a double quote on
 * either side is named, not used (the RFC 2119 boilerplate's `"MUST"`), and
 * makes no entry. A `<bcp14>` holding no keyword is refused.
 */
const xmlNormativeIn = (
  b: XmlLines,
  nodes: XmlNode[],
  section: string,
  anchor: string | null,
  line: i32,
): Result<boolean, XmlError> => {
  const found: XmlNode[] = []
  const marked = xmlRunText(b.t, nodes, found)
  if (found.length < 1) {
    return Ok(true)
  }
  const head = found[0]
  const parts: string[] = []
  const start: u32[] = []
  const end: u32[] = []
  const open: u32[] = []
  // In u32: every count below is at most the length of `marked`, so no sum wraps.
  let length: u32 = 0
  let from: u32 = 0
  let i: u32 = 0
  while (i < toU32(marked.length)) {
    const ch = marked.charCodeAt(i)
    if (ch === 1 || ch === 2) {
      let piece = marked.substring(toI32(from), toI32(i))
      if (ch === 2 && piece.endsWith(" ")) {
        piece = piece.substring(0, toI32(toU32(piece.length) - 1))
      }
      parts.push(piece)
      length = length + toU32(piece.length)
      from = i + 1
      if (ch === 1) {
        open.push(toU32(start.length))
        start.push(length)
        end.push(length)
        // A U+0002 follows every U+0001, so `from` is in range; stated for the prover.
        if (from < toU32(marked.length) && marked.charCodeAt(from) === 0x20) {
          from = from + 1
        }
      } else {
        // Each U+0002 closes the U+0001 before it: the render fences every `<bcp14>`.
        const top = toU32(open.length) - 1
        // An empty stack wraps `top` to 2^32 - 1, past its end.
        if (top >= toU32(open.length)) {
          return Err(xmlErrorAt(head, "internal: a <bcp14> closes before it opens"))
        }
        const o = open[top]
        // Holds after the test above; restated for the prover, which drops it at the read.
        if (open.length > 0) {
          open.pop()
        }
        if (o >= toU32(end.length)) {
          return Err(xmlErrorAt(head, "internal: a <bcp14> closes one never opened"))
        }
        end[o] = length
      }
    }
    i = i + 1
  }
  parts.push(marked.substring(toI32(from), marked.length))
  const text = parts.join("")
  const size = toU32(text.length)
  const stops: i32[] = []
  let s = text.indexOf(". ")
  while (s >= 0) {
    stops.push(s)
    s = text.indexOf(". ", toI32(toU32(s) + 1))
  }
  const seen = new Set<string>()
  let k: u32 = 0
  while (k < toU32(found.length)) {
    const bn = found[k]
    // One U+0001 is pushed per `<bcp14>` found, and each closes after it opens.
    if (k >= toU32(start.length) || k >= toU32(end.length)) {
      return Err(xmlErrorAt(bn, "internal: a <bcp14> has no span"))
    }
    const st = start[k]
    const en = end[k]
    if (en < st || en > size) {
      return Err(xmlErrorAt(bn, "internal: a <bcp14> span is out of order"))
    }
    const word: string | null = en - st > 15 ? null : text.substring(toI32(st), toI32(en))
    const level = word !== null && word === "NOT RECOMMENDED" ? "SHOULD NOT" : word
    if (level === null || !xmlIsKeyword(level)) {
      const shown = word ?? `${trimEnd(xmlCut(text.substring(toI32(st), text.length), 40))}...`
      return Err(xmlErrorAt(bn, `<bcp14> holds "${shown}", which is not a BCP 14 keyword`))
    }
    k = k + 1
    const pre = st - 1
    // Past `st > 0`, pre < st <= size, the length; the bound is for the prover.
    if (
      (st > 0 && pre < toU32(text.length) && text.charCodeAt(pre) === 0x22) ||
      (en < toU32(text.length) && text.charCodeAt(en) === 0x22)
    ) {
      continue
    }
    const j = xmlNextStop(stops, toI32(st))
    const pj = j - 1
    // Past `j > 0`, pj < j <= stops.length; the bound is for the prover.
    const after = j < toU32(stops.length) ? stops[j] : -1
    const before = after === toI32(st) ? after : j > 0 && pj < toU32(stops.length) ? stops[pj] : -1
    const key = `${level}\n${before}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    const first = before < 0 ? 0 : toI32(toU32(before) + 2)
    const last = after < 0 ? text.length : toI32(toU32(after) + 1)
    const entry = new XmlNormative(section, level, text.substring(first, last), bn)
    entry.line = line
    entry.start = first
    entry.anchor = anchor
    b.normative.push(entry)
  }
  return Ok(true)
}

/** Starts a block on `out`: a blank line after the block before it, if any, recorded on `b.breaks`. */
const xmlBlockBreak = (b: XmlLines, out: string[]): void => {
  const last = out.length - 1
  // `last < out.length` always holds; it is stated for the prover.
  if (last >= 0 && last < out.length && out[last].length > 0) {
    b.breaks.push(out.length)
    out.push("")
  }
}

/**
 * Whether a table cell is one line of printed words, as gateWordBlocks
 * reads one: a row of hex words (`0x` or not, one perhaps marked `*`) or
 * one `name = word` assignment. Two such cells side by side are not split
 * by a blank line, so a vector's words printed one to a cell stay one
 * block, as they read before blocks were split; such a line holds no
 * sentence, so none runs between them.
 */
const xmlBareCell = (text: string): boolean => gateWordBlocks([text], []).length === 1

/** A paragraph made of a run of nodes: one line, if it holds any text. */
const xmlParagraph = (
  b: XmlLines,
  nodes: XmlNode[],
  section: string,
  anchor: string | null,
  out: string[],
): Result<boolean, XmlError> => {
  const text = xmlRunText(b.t, nodes, null)
  if (text.length === 0) {
    return Ok(true)
  }
  xmlBlockBreak(b, out)
  xmlNormativeIn(b, nodes, section, anchor, out.length).orReturn()
  out.push(text)
  return Ok(true)
}

/** The lines of one block, appended to `out`. */
const xmlBlock = (
  b: XmlLines,
  n: XmlNode,
  section: string,
  anchor: string | null,
  out: string[],
): Result<boolean, XmlError> => {
  if (n.name.length === 0) {
    return xmlParagraph(b, [n], section, anchor, out)
  }
  const here = xmlAttr(n, "anchor") ?? anchor
  if (n.name === "iref" || n.name === "cref") {
    return Ok(true)
  }
  if (n.name === "sourcecode" || n.name === "artwork") {
    const code = xmlCodeOf(n)
    xmlBlockBreak(b, out)
    let at = 0
    let nl = code.text.indexOf("\n")
    while (nl >= 0) {
      b.code.push(out.length)
      out.push(code.text.substring(at, nl))
      // In u32: `nl` is below the length, so the sum never wraps.
      at = toI32(toU32(nl) + 1)
      nl = code.text.indexOf("\n", at)
    }
    b.code.push(out.length)
    out.push(code.text.substring(at, code.text.length))
    return Ok(true)
  }
  if (n.name === "table" || n.name === "texttable") {
    for (const c of xmlElements(n)) {
      if (c.name === "name") {
        xmlBlock(b, c, section, here, out).orReturn()
      }
    }
    xmlBlockBreak(b, out)
    let bare = false
    for (const row of xmlTableRows(n)) {
      for (const cell of row) {
        const text = xmlPlainText(b.t, cell.node)
        const next = xmlBareCell(text)
        if (!bare || !next) {
          xmlBlockBreak(b, out)
        }
        bare = next
        xmlNormativeIn(b, [cell.node], section, here, out.length).orReturn()
        out.push(text)
      }
    }
    return Ok(true)
  }
  if (xmlIsContainer(n.name) && xmlHoldsBlocks(n)) {
    let run: XmlNode[] = []
    let k = n.first
    while (k !== null) {
      if (k.name.length === 0 || xmlIsInline(k.name)) {
        run.push(k)
      } else {
        if (run.length > 0) {
          xmlParagraph(b, run, section, here, out).orReturn()
          run = []
        }
        xmlBlock(b, k, section, here, out).orReturn()
      }
      k = k.next
    }
    if (run.length > 0) {
      xmlParagraph(b, run, section, here, out).orReturn()
    }
    return Ok(true)
  }
  return xmlParagraph(b, [n], section, here, out)
}

/**
 * A section's own lines (its subsections left out): each paragraph, table
 * cell and line of code one line, with a blank line between two blocks (but
 * not between two bare cells, xmlBareCell). The normative sentences in them
 * are recorded on `b`, where its lines of code are on `b.code`, and where
 * those blank lines are on `b.breaks`.
 *
 * @param b the builder
 * @param sec the `<section>`
 * @param section its number, or "" when it is unnumbered
 * @returns its lines, or why a `<bcp14>` in it is refused
 */
export const xmlSectionLines = (b: XmlLines, sec: XmlNode, section: string): Result<string[], XmlError> => {
  const out: string[] = []
  b.code = []
  b.breaks = []
  let k = sec.first
  while (k !== null) {
    if (k.name !== "name" && k.name !== "section") {
      const r = xmlBlock(b, k, section, null, out)
      if (r.isErr()) {
        return Err(r.error)
      }
    }
    k = k.next
  }
  return Ok(out)
}
