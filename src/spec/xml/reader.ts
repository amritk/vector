/**
 * `spec/xml/reader` — a narrow XML reader for RFC XML v3 (RFC 7991), as
 * xml2rfc and kramdown-rfc write it. No dependency and no network: this
 * tokenizer is the whole reader.
 *
 * The document is untrusted input, so the reader is narrow on purpose:
 *
 *   - A DOCTYPE may carry no SYSTEM or PUBLIC identifier, and its internal
 *     subset may hold nothing but general entities whose value is one numeric
 *     character reference (`<!ENTITY nbsp "&#160;">`), the set xml2rfc's
 *     templates and kramdown-rfc declare. External and parameter entities,
 *     any other declaration, and a reference to an entity nobody declared are
 *     refused.
 *   - An `include` element (`xi:include`) with a non-empty href is refused:
 *     nothing is fetched.
 *   - Input over XML_MAX_INPUT_BYTES, elements nested deeper than
 *     XML_MAX_DEPTH and an element with more than XML_MAX_ATTRS attributes
 *     are refused before they can cost anything.
 *   - The input must be UTF-8, and a character XML does not allow (U+0000 to
 *     U+0008, U+000B, U+000C, U+000E to U+001F, U+FFFE, U+FFFF) is refused
 *     wherever it stands, raw or as a character reference.
 *
 * Every refusal is an XmlError with its XML line and column and, after a
 * `<?line N?>`, its markdown line. Nothing here panics.
 *
 * Lines. After a `<?line N?>` processing instruction (kramdown-rfc writes one
 * at the start of each `--- middle` / `--- back` part, N being the markdown
 * line of that marker), a node's markdown line is N plus the XML lines since
 * that instruction. A signed `<?line -N?>` or `<?line +N?>` is, as in
 * kramdown-rfc, a correction to every later unsigned N; it moves no line by
 * itself. N has at most 9 digits.
 */

import { replaceAll, trim } from "nish/text"
import { charsCodePointAt, charsName, charsSequenceLength } from "../contract/chars"

/** Larger input is refused before it is read. */
export const XML_MAX_INPUT_BYTES: i32 = 8 * 1024 * 1024
/** Elements may nest this deep; one more is refused. */
export const XML_MAX_DEPTH: i32 = 256
/** An element may carry this many attributes; one more is refused. */
export const XML_MAX_ATTRS: i32 = 64

/** An element, or a run of character data (its `name` is ""). */
export class XmlNode {
  /** The element's name; "" for character data. */
  name: string
  /** Character data's text, references resolved; "" for an element. */
  text: string
  attrNames: string[]
  attrValues: string[]
  parent: XmlNode | null = null
  first: XmlNode | null = null
  last: XmlNode | null = null
  next: XmlNode | null = null
  /** The 1-based XML line it starts on. */
  line: i32
  /** The markdown line, from the nearest `<?line N?>` before it; -1 when none. */
  mdLine: i32
  /** A number unique in its document, for keying a node in a Map. */
  id: i32
  /**
   * Makes a node.
   *
   * @param name the element's name, or "" for character data
   * @param line its XML line
   * @param mdLine its markdown line, or -1
   * @param id its number in the document
   */
  constructor(name: string, line: i32, mdLine: i32, id: i32) {
    this.name = name
    this.text = ""
    this.attrNames = []
    this.attrValues = []
    this.line = line
    this.mdLine = mdLine
    this.id = id
  }
}

/** Why the reader refused its input, and where. */
export class XmlError {
  /** The 1-based XML line. */
  line: i32
  /** The 1-based byte column in that line. */
  col: i32
  /** The markdown line, after a `<?line N?>`; -1 when none. */
  mdLine: i32
  message: string
  /**
   * Makes an error.
   *
   * @param line the XML line
   * @param col the byte column
   * @param mdLine the markdown line, or -1
   * @param message what is wrong
   */
  constructor(line: i32, col: i32, mdLine: i32, message: string) {
    this.line = line
    this.col = col
    this.mdLine = mdLine
    this.message = message
  }
}

/** The reader's state over one input. */
class XmlReader {
  src: string
  pos: i32
  lineStarts: i32[]
  /** Whether an unsigned `<?line N?>` has been met. */
  piSeen: boolean
  /** The N of the last unsigned `<?line N?>`, corrections applied; a correction can take it below 1. */
  piN: i32
  /** The XML line that instruction stands on. */
  piLine: i32
  /** The sum of the signed `<?line ±N?>` met so far. */
  correction: i32
  entityNames: string[]
  entityValues: string[]
  ids: i32
  /** @param src the input, line ends already LF */
  constructor(src: string) {
    this.src = src
    this.pos = 0
    this.lineStarts = [0]
    this.piSeen = false
    this.piN = -1
    this.piLine = 0
    this.correction = 0
    this.entityNames = ["amp", "lt", "gt", "quot", "apos"]
    this.entityValues = ["&", "<", ">", '"', "'"]
    this.ids = 0
  }
}

/** The 1-based line of byte `at`. */
const xmlLineOf = (r: XmlReader, at: i32): i32 => {
  let lo = 0
  let hi = r.lineStarts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (r.lineStarts[mid] <= at) {
      lo = mid
    } else {
      hi = mid - 1
    }
  }
  return lo + 1
}

/** The markdown line of XML line `line`, or -1 before any `<?line N?>`. */
const xmlMdLineOf = (r: XmlReader, line: i32): i32 => {
  if (!r.piSeen) {
    return -1
  }
  // A signed <?line -N?> can correct the count below the first line.
  return Math.max(1, r.piN + line - r.piLine)
}

/** A refusal at byte `at`. */
const xmlErrAt = (r: XmlReader, message: string, at: i32): XmlError => {
  const line = xmlLineOf(r, at)
  return new XmlError(line, at - r.lineStarts[line - 1] + 1, xmlMdLineOf(r, line), message)
}

/** A new node starting at byte `at`. */
const xmlNodeAt = (r: XmlReader, name: string, at: i32): XmlNode => {
  const line = xmlLineOf(r, at)
  r.ids = r.ids + 1
  return new XmlNode(name, line, xmlMdLineOf(r, line), r.ids)
}

/** Appends `kid` to `parent`'s children. */
const xmlAppend = (parent: XmlNode, kid: XmlNode): void => {
  kid.parent = parent
  const last = parent.last
  if (last === null) {
    parent.first = kid
  } else {
    last.next = kid
  }
  parent.last = kid
}

/**
 * Whether a code point is XML 1.0's Char: what text may hold and what a
 * character reference may name.
 *
 * @param c the code point
 * @returns true when XML allows it
 */
const xmlIsChar = (c: i32): boolean =>
  c === 0x9 ||
  c === 0xa ||
  c === 0xd ||
  (c >= 0x20 && c <= 0xd7ff) ||
  (c >= 0xe000 && c <= 0xfffd) ||
  (c >= 0x10000 && c <= 0x10ffff)

/** Where the input is not UTF-8 or holds a character XML does not allow; -1 when nowhere. Sets `why`. */
const xmlCheckChars = (r: XmlReader, why: string[]): i32 => {
  const s = r.src
  let i = 0
  while (i < s.length) {
    const b = s.charCodeAt(i)
    if (b >= 0x20 && b < 0x80) {
      i = i + 1
      continue
    }
    const n = charsSequenceLength(s, i)
    if (b >= 0x80 && n === 1) {
      why.push(`the input is not UTF-8: byte ${b} starts no well-formed sequence`)
      return i
    }
    const c = charsCodePointAt(s, i)
    // U+FFFD also stands for an overlong form or a surrogate; only EF BF BD is the real one.
    if (c === 0xfffd && !(n === 3 && s.charCodeAt(i + 1) === 0xbf && s.charCodeAt(i + 2) === 0xbd && b === 0xef)) {
      why.push("the input is not UTF-8: an overlong form or a surrogate")
      return i
    }
    if (!xmlIsChar(c)) {
      why.push(`${charsName(c)} is not an XML character`)
      return i
    }
    i = i + n
  }
  return -1
}

/** Whether the input continues with `s` at the reader's position. */
const xmlAt = (r: XmlReader, s: string): boolean => {
  if (r.pos + s.length > r.src.length) {
    return false
  }
  for (let k = 0; k < s.length; k++) {
    if (r.src.charCodeAt(r.pos + k) !== s.charCodeAt(k)) {
      return false
    }
  }
  return true
}

const xmlIsSpace = (c: i32): boolean => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d

/** Skips whitespace; whether there was any. */
const xmlSkipWs = (r: XmlReader): boolean => {
  const from = r.pos
  while (r.pos < r.src.length && xmlIsSpace(r.src.charCodeAt(r.pos))) {
    r.pos = r.pos + 1
  }
  return r.pos > from
}

const xmlIsNameStart = (c: i32): boolean => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 58

const xmlIsNameChar = (c: i32): boolean => xmlIsNameStart(c) || (c >= 48 && c <= 57) || c === 46 || c === 45

/** The name at `i` of `s`, ASCII letters, digits, "_", ":", "." and "-"; "" when none starts there. */
const xmlNameIn = (s: string, i: i32): string => {
  if (i >= s.length || !xmlIsNameStart(s.charCodeAt(i))) {
    return ""
  }
  let j = i + 1
  while (j < s.length && xmlIsNameChar(s.charCodeAt(j))) {
    j = j + 1
  }
  return s.substring(i, j)
}

/** Reads a name, moving past it. */
const xmlName = (r: XmlReader, where: string): Result<string, XmlError> => {
  const name = xmlNameIn(r.src, r.pos)
  if (name.length === 0) {
    return Err(xmlErrAt(r, `malformed XML: expected a name ${where}`, r.pos))
  }
  r.pos = r.pos + name.length
  return Ok(name)
}

/** Moves past `s`, or refuses. */
const xmlExpect = (r: XmlReader, s: string, where: string): Result<boolean, XmlError> => {
  if (!xmlAt(r, s)) {
    return Err(xmlErrAt(r, `malformed XML: expected "${s}" ${where}`, r.pos))
  }
  r.pos = r.pos + s.length
  return Ok(true)
}

/** The text up to `end`, moving past it. */
const xmlUntil = (r: XmlReader, end: string, what: string): Result<string, XmlError> => {
  const stop = r.src.indexOf(end, r.pos)
  if (stop < 0) {
    return Err(xmlErrAt(r, `malformed XML: unterminated ${what}`, r.pos))
  }
  const s = r.src.substring(r.pos, stop)
  r.pos = stop + end.length
  return Ok(s)
}

/** A quoted value, moving past it. */
const xmlQuoted = (r: XmlReader, where: string): Result<string, XmlError> => {
  const q = r.pos < r.src.length ? r.src.charCodeAt(r.pos) : 0
  if (q !== 0x22 && q !== 0x27) {
    return Err(xmlErrAt(r, `malformed XML: expected a quoted value ${where}`, r.pos))
  }
  r.pos = r.pos + 1
  return xmlUntil(r, q === 0x22 ? '"' : "'", `value ${where}`)
}

const xmlIsDigit = (c: i32): boolean => c >= 48 && c <= 57

const xmlHexValue = (c: i32): i32 =>
  xmlIsDigit(c) ? c - 48 : c >= 97 && c <= 102 ? c - 87 : c >= 65 && c <= 70 ? c - 55 : -1

/**
 * The code point a character reference's digits name, from `i` of `s` up to
 * `end`; -1 when they are not all digits of the base or name a number past
 * U+10FFFF.
 */
const xmlRefValue = (s: string, i: i32, end: i32, hex: boolean): i32 => {
  if (i >= end) {
    return -1
  }
  let v = 0
  for (let k = i; k < end; k++) {
    const c = s.charCodeAt(k)
    const d = hex ? xmlHexValue(c) : xmlIsDigit(c) ? c - 48 : -1
    if (d < 0) {
      return -1
    }
    v = v * (hex ? 16 : 10) + d
    if (v > 0x10ffff) {
      return -1
    }
  }
  return v
}

/** Encodes a code point as UTF-8. */
const xmlEncode = (c: i32): string => {
  const out: u8[] = []
  if (c < 0x80) {
    out.push(toU8(c))
  } else if (c < 0x800) {
    out.push(toU8(0xc0 | (c >> 6)))
    out.push(toU8(0x80 | (c & 0x3f)))
  } else if (c < 0x10000) {
    out.push(toU8(0xe0 | (c >> 12)))
    out.push(toU8(0x80 | ((c >> 6) & 0x3f)))
    out.push(toU8(0x80 | (c & 0x3f)))
  } else {
    out.push(toU8(0xf0 | (c >> 18)))
    out.push(toU8(0x80 | ((c >> 12) & 0x3f)))
    out.push(toU8(0x80 | ((c >> 6) & 0x3f)))
    out.push(toU8(0x80 | (c & 0x3f)))
  }
  return String.fromBytes(out, 0, out.length)
}

/**
 * The character a reference `&#NN;` or `&#xHH;` (the text between "&" and
 * ";") names, encoded; "" when it is not one or names no XML character.
 */
const xmlCharRef = (body: string): string => {
  if (body.length < 2 || body.charCodeAt(0) !== 0x23) {
    return ""
  }
  const hex = body.charCodeAt(1) === 0x78
  const c = xmlRefValue(body, hex ? 2 : 1, body.length, hex)
  if (c < 0 || !xmlIsChar(c)) {
    return ""
  }
  return xmlEncode(c)
}

/** Resolves the references in character data or an attribute value; `from` is where `raw` starts. */
const xmlDecode = (r: XmlReader, raw: string, from: i32): Result<string, XmlError> => {
  let amp = raw.indexOf("&")
  if (amp < 0) {
    return Ok(raw)
  }
  const parts: string[] = []
  let i = 0
  while (amp >= 0) {
    parts.push(raw.substring(i, amp))
    const semi = raw.indexOf(";", amp + 1)
    const body = semi < 0 ? "" : raw.substring(amp + 1, semi)
    if (body.length > 0 && body.charCodeAt(0) === 0x23) {
      const c = xmlCharRef(body)
      if (c.length === 0) {
        return Err(xmlErrAt(r, `character reference &${body}; names no XML character`, from + amp))
      }
      parts.push(c)
    } else {
      if (body.length === 0 || xmlNameIn(body, 0).length !== body.length) {
        return Err(xmlErrAt(r, 'malformed XML: "&" starts no entity or character reference', from + amp))
      }
      const k = r.entityNames.indexOf(body)
      if (k < 0) {
        return Err(xmlErrAt(r, `undefined entity &${body};`, from + amp))
      }
      parts.push(r.entityValues[k])
    }
    i = semi + 1
    amp = raw.indexOf("&", i)
  }
  parts.push(raw.substring(i, raw.length))
  return Ok(parts.join(""))
}

/** Reads a processing instruction, keeping the line numbering a `<?line N?>` sets. */
const xmlPi = (r: XmlReader): Result<boolean, XmlError> => {
  const at = r.pos
  r.pos = r.pos + 2
  const body = xmlUntil(r, "?>", "processing instruction").orReturn()
  if (!body.startsWith("line") || body.length < 5 || !xmlIsSpace(body.charCodeAt(4))) {
    return Ok(true)
  }
  let i = 5
  while (i < body.length && xmlIsSpace(body.charCodeAt(i))) {
    i = i + 1
  }
  let sign = 0
  if (i < body.length && (body.charCodeAt(i) === 0x2b || body.charCodeAt(i) === 0x2d)) {
    sign = body.charCodeAt(i) === 0x2d ? -1 : 1
    i = i + 1
  }
  const d0 = i
  while (i < body.length && xmlIsDigit(body.charCodeAt(i))) {
    i = i + 1
  }
  const digits = body.substring(d0, i)
  while (i < body.length && xmlIsSpace(body.charCodeAt(i))) {
    i = i + 1
  }
  if (digits.length === 0 || i !== body.length) {
    return Ok(true)
  }
  if (digits.length > 9) {
    return Err(xmlErrAt(r, `<?${trim(body)}?> names a line past 999999999`, at))
  }
  const n = parseInt(digits)
  if (sign === 0) {
    r.piSeen = true
    r.piN = n + r.correction
    r.piLine = xmlLineOf(r, at)
  } else {
    // Each N is at most 999999999 and so is the sum so far, so this add stays in i32; the cap keeps it there.
    const sum = r.correction + sign * n
    if (sum > 999999999 || sum < -999999999) {
      return Err(xmlErrAt(r, `<?${trim(body)}?> corrects lines by more than 999999999 in all`, at))
    }
    r.correction = sum
  }
  return Ok(true)
}

/** Skips a comment. */
const xmlComment = (r: XmlReader): Result<boolean, XmlError> => {
  r.pos = r.pos + 4
  xmlUntil(r, "-->", "comment").orReturn()
  return Ok(true)
}

/** Reads the DOCTYPE's internal subset, after its "[": numeric general entities only. */
const xmlInternalSubset = (r: XmlReader): Result<boolean, XmlError> => {
  while (true) {
    xmlSkipWs(r)
    if (r.pos >= r.src.length) {
      return Err(xmlErrAt(r, "malformed XML: unterminated DOCTYPE", r.pos))
    }
    if (xmlAt(r, "]")) {
      r.pos = r.pos + 1
      return Ok(true)
    }
    const at = r.pos
    if (!xmlAt(r, "<!ENTITY")) {
      return Err(
        xmlErrAt(
          r,
          'the DOCTYPE may declare only general entities with a numeric value, such as <!ENTITY nbsp "&#160;">; other markup is refused',
          at,
        ),
      )
    }
    r.pos = r.pos + 8
    xmlSkipWs(r)
    if (xmlAt(r, "%")) {
      return Err(xmlErrAt(r, "a parameter entity (<!ENTITY %) is refused", at))
    }
    const name = xmlName(r, "in <!ENTITY").orReturn()
    xmlSkipWs(r)
    if (xmlAt(r, "SYSTEM") || xmlAt(r, "PUBLIC")) {
      return Err(xmlErrAt(r, `external entity &${name}; is refused: vector never fetches`, at))
    }
    const value = xmlQuoted(r, "in <!ENTITY").orReturn()
    xmlSkipWs(r)
    xmlExpect(r, ">", "to end <!ENTITY").orReturn()
    const ok = value.length > 3 && value.charCodeAt(0) === 0x26 && value.charCodeAt(value.length - 1) === 0x3b
    const c = ok ? xmlCharRef(value.substring(1, value.length - 1)) : ""
    if (!ok || value.charCodeAt(1) !== 0x23) {
      return Err(xmlErrAt(r, `entity &${name}; must be a single numeric character reference such as "&#160;"`, at))
    }
    if (c.length === 0) {
      return Err(xmlErrAt(r, `character reference ${value} names no XML character`, at))
    }
    // XML binds the first declaration; the predefined five stay as they are.
    if (r.entityNames.indexOf(name) < 0) {
      r.entityNames.push(name)
      r.entityValues.push(c)
    }
  }
}

/** Reads a DOCTYPE. */
const xmlDoctype = (r: XmlReader): Result<boolean, XmlError> => {
  const at = r.pos
  r.pos = r.pos + 9
  xmlSkipWs(r)
  xmlName(r, "in the DOCTYPE").orReturn()
  xmlSkipWs(r)
  if (xmlAt(r, "SYSTEM") || xmlAt(r, "PUBLIC")) {
    return Err(xmlErrAt(r, "a DOCTYPE with a SYSTEM or PUBLIC identifier is refused: vector never fetches", at))
  }
  if (xmlAt(r, "[")) {
    r.pos = r.pos + 1
    xmlInternalSubset(r).orReturn()
  }
  xmlSkipWs(r)
  xmlExpect(r, ">", "to end the DOCTYPE").orReturn()
  return Ok(true)
}

/**
 * An attribute's value.
 *
 * @param n an element
 * @param name the attribute's name
 * @returns its value, or null when the element does not carry it
 */
export const xmlAttr = (n: XmlNode, name: string): string | null => {
  const k = n.attrNames.indexOf(name)
  return k < 0 ? null : n.attrValues[k]
}

/** Whether an element name is `include` in any namespace. */
const xmlIsInclude = (name: string): boolean => name === "include" || name.endsWith(":include")

/** Refuses an include that would fetch. */
const xmlChecked = (r: XmlReader, node: XmlNode, at: i32): Result<boolean, XmlError> => {
  const href = xmlAttr(node, "href") ?? ""
  if (xmlIsInclude(node.name) && href.length > 0) {
    return Err(
      xmlErrAt(
        r,
        `<${node.name} href="${href}"> is refused: vector never fetches; expand it first (xml2rfc --expand)`,
        at,
      ),
    )
  }
  return Ok(true)
}

/** Character data from the position up to the next "<", decoded. */
const xmlText = (r: XmlReader): Result<string, XmlError> => {
  const stop = r.src.indexOf("<", r.pos)
  const end = stop < 0 ? r.src.length : stop
  const from = r.pos
  r.pos = end
  return xmlDecode(r, r.src.substring(from, end), from)
}

/** Reads an element's start tag and attributes; whether it was empty (`/>`). */
const xmlStartTag = (r: XmlReader, node: XmlNode, at: i32): Result<boolean, XmlError> => {
  const name = node.name
  while (true) {
    const ws = xmlSkipWs(r)
    if (xmlAt(r, "/>")) {
      r.pos = r.pos + 2
      xmlChecked(r, node, at).orReturn()
      return Ok(true)
    }
    if (xmlAt(r, ">")) {
      r.pos = r.pos + 1
      xmlChecked(r, node, at).orReturn()
      return Ok(false)
    }
    if (r.pos >= r.src.length) {
      return Err(xmlErrAt(r, `malformed XML: <${name}> is never closed`, at))
    }
    if (!ws) {
      return Err(xmlErrAt(r, `malformed XML: expected whitespace, ">" or "/>" in <${name}>`, r.pos))
    }
    const attrAt = r.pos
    const attr = xmlName(r, `in <${name}>`).orReturn()
    xmlSkipWs(r)
    xmlExpect(r, "=", `after ${attr}`).orReturn()
    xmlSkipWs(r)
    const from = r.pos + 1
    const raw = xmlQuoted(r, `of ${attr}`).orReturn()
    if (raw.indexOf("<") >= 0) {
      return Err(xmlErrAt(r, `malformed XML: "<" in the value of ${attr}`, from))
    }
    if (node.attrNames.indexOf(attr) >= 0) {
      return Err(xmlErrAt(r, `malformed XML: duplicate attribute ${attr} on <${name}>`, attrAt))
    }
    if (node.attrNames.length >= XML_MAX_ATTRS) {
      return Err(xmlErrAt(r, `<${name}> has more than ${XML_MAX_ATTRS} attributes (XML_MAX_ATTRS)`, attrAt))
    }
    // XML's attribute-value normalization: a literal tab or newline is a
    // space (one written as a character reference stays as written).
    const value = xmlDecode(r, replaceAll(replaceAll(raw, "\t", " "), "\n", " "), from).orReturn()
    node.attrNames.push(attr)
    node.attrValues.push(value)
  }
}

/** Appends `text` to the text node `open` (making it at `at` when null); the node now open. */
const xmlAddText = (r: XmlReader, parent: XmlNode, open: XmlNode | null, text: string, at: i32): XmlNode => {
  if (open !== null) {
    open.text = `${open.text}${text}`
    return open
  }
  const t = xmlNodeAt(r, "", at)
  t.text = text
  xmlAppend(parent, t)
  return t
}

/**
 * Reads an element and everything in it. Elements are read with an explicit
 * stack rather than recursion, so depth costs no native stack.
 */
const xmlElement = (r: XmlReader): Result<XmlNode, XmlError> => {
  const rootAt = r.pos
  r.pos = r.pos + 1
  const root = xmlNodeAt(r, xmlName(r, "after <").orReturn(), rootAt)
  if (xmlStartTag(r, root, rootAt).orReturn()) {
    return Ok(root)
  }
  let node = root
  let depth = 1
  let open: XmlNode | null = null
  while (true) {
    if (r.pos >= r.src.length) {
      return Err(xmlErrAt(r, `malformed XML: <${node.name}> is never closed`, r.lineStarts[node.line - 1]))
    }
    if (xmlAt(r, "</")) {
      open = null
      r.pos = r.pos + 2
      const end = xmlName(r, "after </").orReturn()
      xmlSkipWs(r)
      xmlExpect(r, ">", `to end </${end}>`).orReturn()
      if (end !== node.name) {
        return Err(xmlErrAt(r, `malformed XML: </${end}> closes <${node.name}> from line ${node.line}`, r.pos - 1))
      }
      const up = node.parent
      if (up === null) {
        return Ok(root)
      }
      node = up
      depth = depth - 1
    } else if (xmlAt(r, "<![CDATA[")) {
      const at = r.pos
      r.pos = r.pos + 9
      const data = xmlUntil(r, "]]>", "CDATA section").orReturn()
      open = xmlAddText(r, node, open, data, at)
    } else if (xmlAt(r, "<!--")) {
      open = null
      xmlComment(r).orReturn()
    } else if (xmlAt(r, "<?")) {
      open = null
      xmlPi(r).orReturn()
    } else if (xmlAt(r, "<!")) {
      return Err(xmlErrAt(r, "malformed XML: a declaration inside an element", r.pos))
    } else if (xmlAt(r, "<")) {
      open = null
      const at = r.pos
      if (depth >= XML_MAX_DEPTH) {
        return Err(xmlErrAt(r, `elements nest deeper than ${XML_MAX_DEPTH} (XML_MAX_DEPTH)`, at))
      }
      r.pos = r.pos + 1
      const kid = xmlNodeAt(r, xmlName(r, "after <").orReturn(), at)
      xmlAppend(node, kid)
      const empty = xmlStartTag(r, kid, at).orReturn()
      if (!empty) {
        node = kid
        depth = depth + 1
      }
    } else {
      const at = r.pos
      const text = xmlText(r).orReturn()
      open = xmlAddText(r, node, open, text, at)
    }
  }
}

/** Reads the prolog, the root element and what follows it. */
const xmlDocument = (r: XmlReader): Result<XmlNode, XmlError> => {
  let root: XmlNode | null = null
  let doctype = false
  while (true) {
    xmlSkipWs(r)
    if (r.pos >= r.src.length) {
      break
    }
    if (xmlAt(r, "<?")) {
      xmlPi(r).orReturn()
    } else if (xmlAt(r, "<!--")) {
      xmlComment(r).orReturn()
    } else if (xmlAt(r, "<!DOCTYPE")) {
      if (doctype || root !== null) {
        return Err(xmlErrAt(r, "malformed XML: a DOCTYPE comes once, before the root element", r.pos))
      }
      xmlDoctype(r).orReturn()
      doctype = true
    } else if (root === null && xmlAt(r, "<") && !xmlAt(r, "<!")) {
      root = xmlElement(r).orReturn()
    } else {
      const what = root !== null ? "content after the root element" : "expected the root element"
      return Err(xmlErrAt(r, `malformed XML: ${what}`, r.pos))
    }
  }
  if (root === null) {
    return Err(xmlErrAt(r, "malformed XML: no root element", r.pos))
  }
  return Ok(root)
}

/**
 * Reads XML into a tree of elements and character data. Line ends are read
 * as LF (CRLF and a lone CR alike) and a leading byte-order mark is skipped.
 *
 * @param text the input
 * @returns the root element, or why the input is refused
 */
export const xmlParse = (text: string): Result<XmlNode, XmlError> => {
  if (text.length > XML_MAX_INPUT_BYTES) {
    return Err(
      new XmlError(
        1,
        1,
        -1,
        `input is ${text.length} bytes, over the ${XML_MAX_INPUT_BYTES}-byte limit (XML_MAX_INPUT_BYTES)`,
      ),
    )
  }
  const r = new XmlReader(replaceAll(replaceAll(text, "\r\n", "\n"), "\r", "\n"))
  let nl = r.src.indexOf("\n")
  while (nl >= 0) {
    r.lineStarts.push(nl + 1)
    nl = r.src.indexOf("\n", nl + 1)
  }
  const why: string[] = []
  const bad = xmlCheckChars(r, why)
  if (bad >= 0) {
    return Err(xmlErrAt(r, why[0], bad))
  }
  if (xmlAt(r, "\u{feff}")) {
    r.pos = 3
  }
  return xmlDocument(r)
}

/**
 * An element's first child element of a name.
 *
 * @param n the element
 * @param name the child's name
 * @returns the child, or null when it has none
 */
export const xmlChild = (n: XmlNode, name: string): XmlNode | null => {
  let k = n.first
  while (k !== null) {
    if (k.name === name) {
      return k
    }
    k = k.next
  }
  return null
}

/**
 * An element's child elements, in order.
 *
 * @param n the element
 * @returns its child elements, character data left out
 */
export const xmlElements = (n: XmlNode): XmlNode[] => {
  const out: XmlNode[] = []
  let k = n.first
  while (k !== null) {
    if (k.name.length > 0) {
      out.push(k)
    }
    k = k.next
  }
  return out
}
