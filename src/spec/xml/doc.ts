/**
 * `spec/xml/doc` — an RFC XML v3 document read into what extract needs: its
 * sections numbered as xml2rfc numbers them, each read as lines, the
 * sentences its `<bcp14>` markup makes normative, its references, and the
 * text each `<xref>` prints when the preptool has not worked it out.
 *
 * Refused, beyond what the reader refuses: a root that is not `<rfc>`, an
 * anchor used twice, a table inside a table cell, more than 26 appendices,
 * xref text worked out past the input's length and XML_MAX_XREF_TEXT, and
 * numbered sections holding over XML_MAX_SECTION_LINES lines between them.
 */

import { hiddenProblem } from "../source/hidden"
import { RfcDocument, RfcSection } from "../source/rfc"
import { XmlError, XmlNode, xmlAttr, xmlChild, xmlElements, xmlParse } from "./reader"
import { XmlLines, XmlNormative, XmlText, XmlXrefInfo, xmlPlainText, xmlSectionLines } from "./text"

/** The xref text worked out may run this many characters past the input's length. */
const XML_MAX_XREF_TEXT: i32 = 64 * 1024

/** Numbered sections may hold this many lines, each subsection's counted in its parents'. */
const XML_MAX_SECTION_LINES: i32 = 2000000

/** A `<reference>`, and the RFC its seriesInfo names. */
export class XmlRef {
  anchor: string
  /** The RFC number; -1 when it names none. */
  rfc: i32
  node: XmlNode
  /**
   * Makes a reference.
   *
   * @param anchor its anchor
   * @param node its element
   */
  constructor(anchor: string, node: XmlNode) {
    this.anchor = anchor
    this.rfc = -1
    this.node = node
  }
}

/** An RFC XML v3 document, read. */
export class XmlDocument {
  root: XmlNode
  /** The front matter's title as plain text; "" without one. */
  title: string
  /** The root's docName; null without one. */
  docName: string | null
  /** The root's number attribute; -1 without a numeric one. */
  number: i32
  /** The numbered sections, in document order. */
  sections: RfcSection[]
  references: XmlRef[]
  /** The number of each anchored numbered section. */
  sectionByAnchor: Map<string, string>
  /** The sentences `<bcp14>` makes normative, in document order. */
  normative: XmlNormative[]
  /** Each xref's worked-out text, for rendering. */
  text: XmlText
  /**
   * Makes an empty document.
   *
   * @param root its root element
   */
  constructor(root: XmlNode) {
    this.root = root
    this.title = ""
    this.docName = null
    this.number = -1
    this.sections = []
    this.references = []
    this.sectionByAnchor = new Map<string, string>()
    this.normative = []
    this.text = new XmlText()
  }
}

/** A section as xml2rfc numbers it. */
class XmlSectionInfo {
  id: string
  node: XmlNode
  numbered: boolean
  back: boolean
  own: string[]
  subs: XmlSectionInfo[]
  constructor(id: string, node: XmlNode, numbered: boolean, back: boolean) {
    this.id = id
    this.node = node
    this.numbered = numbered
    this.back = back
    this.own = []
    this.subs = []
  }
}

/** What reading a document collects on the way. */
class XmlDocContext {
  doc: XmlDocument
  infos: XmlSectionInfo[]
  infoOf: Map<XmlNode, XmlSectionInfo>
  byAnchor: Map<string, XmlNode>
  xrefs: XmlNode[]
  figures: Map<XmlNode, i32>
  tables: Map<XmlNode, i32>
  display: Map<string, string>
  /** Each parent's first child element of each name, indexed once. */
  firsts: Map<XmlNode, Map<string, XmlNode>>
  /** Names and titles as derived text reads them, each rendered once. */
  named: Map<XmlNode, string>
  constructor(doc: XmlDocument) {
    this.doc = doc
    this.infos = []
    this.infoOf = new Map<XmlNode, XmlSectionInfo>()
    this.byAnchor = new Map<string, XmlNode>()
    this.xrefs = []
    this.figures = new Map<XmlNode, i32>()
    this.tables = new Map<XmlNode, i32>()
    this.display = new Map<string, string>()
    this.firsts = new Map<XmlNode, Map<string, XmlNode>>()
    this.named = new Map<XmlNode, string>()
  }
}

/** The first child element of a name, through an index built once per parent. */
const xmlDocChild = (c: XmlDocContext, n: XmlNode, name: string): XmlNode | null => {
  const known = c.firsts.get(n)
  if (known !== undefined) {
    const hit = known.get(name)
    if (hit !== undefined) {
      return hit
    }
    return null
  }
  const made = new Map<string, XmlNode>()
  for (const k of xmlElements(n)) {
    if (!made.has(k.name)) {
      made.set(k.name, k)
    }
  }
  c.firsts.set(n, made)
  const hit = made.get(name)
  if (hit !== undefined) {
    return hit
  }
  return null
}

/** Numbers the sections below `parent`, appendices lettered at the top of `<back>`. */
const xmlDocNumber = (
  c: XmlDocContext,
  parent: XmlNode,
  prefix: string,
  back: boolean,
  numbered: boolean,
): Result<XmlSectionInfo[], XmlError> => {
  const subs: XmlSectionInfo[] = []
  let i = 0
  for (const s of xmlElements(parent)) {
    if (s.name !== "section") {
      continue
    }
    i = i + 1
    const top = back && prefix.length === 0
    if (top && i > 26) {
      return Err(new XmlError(s.line, 0, s.mdLine, "<back> has more than 26 sections; appendix letters run out at Z"))
    }
    const n = top ? String.fromCharCode(64 + i) : `${i}`
    const id = prefix.length > 0 ? `${prefix}.${n}` : n
    const on = numbered && (xmlAttr(s, "numbered") ?? "") !== "false"
    const info = new XmlSectionInfo(id, s, on, back)
    c.infos.push(info)
    c.infoOf.set(s, info)
    subs.push(info)
    info.subs = xmlDocNumber(c, s, id, back, on).orReturn()
  }
  return Ok(subs)
}

/** Whether `s` is one or more ASCII digits. */
const xmlDocDigits = (s: string): boolean => {
  if (s.length === 0) {
    return false
  }
  for (let i = 0; i < s.length; i = i + 1) {
    const ch = s.charCodeAt(i)
    if (ch < 48 || ch > 57) {
      return false
    }
  }
  return true
}

/** Collects anchors, xrefs, figures, tables and references, in document order. */
const xmlDocWalk = (c: XmlDocContext, n: XmlNode, inCell: boolean): Result<boolean, XmlError> => {
  const anchor = xmlAttr(n, "anchor")
  if (anchor !== null) {
    const first = c.byAnchor.get(anchor)
    if (first !== undefined) {
      return Err(new XmlError(n.line, 0, n.mdLine, `anchor "${anchor}" is used again; first on line ${first.line}`))
    }
    c.byAnchor.set(anchor, n)
  }
  const isTable = n.name === "table" || n.name === "texttable"
  if (inCell && isTable) {
    return Err(new XmlError(n.line, 0, n.mdLine, `<${n.name}> inside a table cell is not RFC XML v3`))
  }
  if (n.name === "xref") {
    c.xrefs.push(n)
  }
  if (n.name === "figure") {
    c.figures.set(n, c.figures.size + 1)
  }
  if (isTable) {
    c.tables.set(n, c.tables.size + 1)
  }
  if (n.name === "displayreference") {
    const target = xmlAttr(n, "target")
    const to = xmlAttr(n, "to")
    if (target !== null && to !== null && target.length > 0 && to.length > 0) {
      c.display.set(target, to)
    }
  }
  if (n.name === "reference" && anchor !== null) {
    const ref = new XmlRef(anchor, n)
    for (const k of xmlElements(n)) {
      if (k.name === "seriesInfo" && (xmlAttr(k, "name") ?? "") === "RFC") {
        const v = xmlAttr(k, "value") ?? ""
        if (xmlDocDigits(v)) {
          ref.rfc = parseInt(v)
        }
        break
      }
    }
    c.doc.references.push(ref)
  }
  const below = inCell || n.name === "td" || n.name === "th" || n.name === "c"
  for (const k of xmlElements(n)) {
    xmlDocWalk(c, k, below).orReturn()
  }
  return Ok(true)
}

/** A name's or title's plain text, rendered once. */
const xmlDocTextOf = (c: XmlDocContext, n: XmlNode | null): string => {
  if (n === null) {
    return ""
  }
  const known = c.named.get(n)
  if (known !== undefined) {
    return known
  }
  const s = xmlPlainText(c.doc.text, n)
  c.named.set(n, s)
  return s
}

/** The text the preptool's derivedContent would give an xref. */
const xmlDocDerived = (c: XmlDocContext, x: XmlNode, t: XmlNode | null, reference: boolean): string => {
  const target = xmlAttr(x, "target") ?? ""
  const format = xmlAttr(x, "format") ?? "default"
  if (t === null) {
    return target
  }
  if (reference) {
    if (format === "title") {
      const title = xmlDocChild(c, xmlDocChild(c, t, "front") ?? t, "title")
      return title !== null ? xmlDocTextOf(c, title) : target
    }
    return c.display.get(target) ?? target
  }
  if (format === "none") {
    return ""
  }
  const named = xmlDocTextOf(c, xmlDocChild(c, t, "name"))
  if (format === "title") {
    return named.length > 0 ? named : target
  }
  const s = c.infoOf.get(t)
  if (s !== undefined) {
    if (format === "counter") {
      return s.numbered ? s.id : ""
    }
    const kind = s.back ? "Appendix" : "Section"
    return s.numbered ? `${kind} ${s.id}` : `${kind} "${named.length > 0 ? named : target}"`
  }
  const fig = c.figures.get(t)
  if (fig !== undefined) {
    return format === "counter" ? `${fig}` : `Figure ${fig}`
  }
  const tab = c.tables.get(t)
  if (tab !== undefined) {
    return format === "counter" ? `${tab}` : `Table ${tab}`
  }
  return target
}

/** Works out each xref's text, within the budget. */
const xmlDocXrefs = (c: XmlDocContext, inputLength: i32): Result<boolean, XmlError> => {
  const budget = inputLength + XML_MAX_XREF_TEXT
  let spent = 0
  for (const x of c.xrefs) {
    const target = xmlAttr(x, "target") ?? ""
    const found = c.byAnchor.get(target)
    let t: XmlNode | null = null
    if (found !== undefined) {
      t = found
    }
    const reference = t !== null && (t.name === "reference" || t.name === "referencegroup")
    const reftext = xmlAttr(x, "derivedContent") === null ? xmlDocDerived(c, x, t, reference) : ""
    spent = spent + reftext.length
    if (spent > budget) {
      return Err(
        new XmlError(
          x.line,
          0,
          x.mdLine,
          `the xref text worked out runs past ${budget} characters, the input's length and XML_MAX_XREF_TEXT`,
        ),
      )
    }
    c.doc.text.xrefs.set(x, new XmlXrefInfo(reftext, reference))
  }
  return Ok(true)
}

/** Appends a section's own lines and then its subsections', recording each one's run. */
const xmlDocLay = (
  s: XmlSectionInfo,
  all: string[],
  from: Map<XmlSectionInfo, i32>,
  to: Map<XmlSectionInfo, i32>,
): void => {
  from.set(s, all.length)
  for (const l of s.own) {
    all.push(l)
  }
  for (const k of s.subs) {
    xmlDocLay(k, all, from, to)
  }
  to.set(s, all.length)
}

/** Reads each section's lines, and makes the numbered ones the document's sections. */
const xmlDocSections = (c: XmlDocContext): Result<boolean, XmlError> => {
  const b = new XmlLines(c.doc.text)
  for (const s of c.infos) {
    s.own = xmlSectionLines(b, s.node, s.numbered ? s.id : "").orReturn()
  }
  c.doc.normative = b.normative
  const all: string[] = []
  const from = new Map<XmlSectionInfo, i32>()
  const to = new Map<XmlSectionInfo, i32>()
  for (const s of c.infos) {
    if (!from.has(s)) {
      xmlDocLay(s, all, from, to)
    }
  }
  let held = 0
  for (const s of c.infos) {
    if (!s.numbered) {
      continue
    }
    const a = from.get(s) ?? 0
    const z = to.get(s) ?? 0
    held = held + (z - a)
    if (held > XML_MAX_SECTION_LINES) {
      return Err(
        new XmlError(
          s.node.line,
          0,
          s.node.mdLine,
          `numbered sections hold over ${XML_MAX_SECTION_LINES} lines, counting each subsection's in its parents' (XML_MAX_SECTION_LINES)`,
        ),
      )
    }
    const name = xmlDocChild(c, s.node, "name")
    const title = name !== null ? xmlPlainText(c.doc.text, name) : ""
    c.doc.sections.push(new RfcSection(s.id, title, all.slice(a, z), s.own))
    const anchor = xmlAttr(s.node, "anchor")
    if (anchor !== null) {
      c.doc.sectionByAnchor.set(anchor, s.id)
    }
  }
  return Ok(true)
}

/**
 * Reads RFC XML v3: its sections numbered as xml2rfc numbers them, each read
 * as lines, its normative sentences, its references, and its title, number
 * and docName.
 *
 * @param text the input
 * @returns the document, or why it is refused, with its line
 */
export const xmlDocParse = (text: string): Result<XmlDocument, XmlError> => {
  const root = xmlParse(text).orReturn()
  if (root.name !== "rfc") {
    return Err(new XmlError(root.line, 0, root.mdLine, `not RFC XML: the root element is <${root.name}>, not <rfc>`))
  }
  const doc = new XmlDocument(root)
  const c = new XmlDocContext(doc)
  const middle = xmlDocChild(c, root, "middle")
  if (middle !== null) {
    xmlDocNumber(c, middle, "", false, true).orReturn()
  }
  const back = xmlDocChild(c, root, "back")
  if (back !== null) {
    xmlDocNumber(c, back, "", true, true).orReturn()
  }
  xmlDocWalk(c, root, false).orReturn()
  xmlDocXrefs(c, text.length).orReturn()
  xmlDocSections(c).orReturn()
  const front = xmlDocChild(c, root, "front")
  const title: XmlNode | null = front !== null ? xmlChild(front, "title") : null
  doc.title = title !== null ? xmlPlainText(doc.text, title) : ""
  doc.docName = xmlAttr(root, "docName")
  const num = xmlAttr(root, "number") ?? ""
  if (xmlDocDigits(num)) {
    doc.number = parseInt(num)
  }
  return Ok(doc)
}

/**
 * The source reader for `.xml`: RFC XML v3 read into numbered sections.
 *
 * @param text the input
 * @param name names the input in messages
 * @returns the document's sections and number, or `name:line: why` it is refused
 */
export const xmlRead = (text: string, name: string): Result<RfcDocument, string> => {
  const r = xmlDocParse(text)
  if (r.isErr()) {
    return Err(`${name}:${r.error.line}: ${r.error.message}`)
  }
  const hidden = hiddenProblem(text, name)
  if (hidden !== null) {
    return Err(hidden)
  }
  const out = new RfcDocument()
  out.number = r.value.number
  out.sections = r.value.sections
  return Ok(out)
}
