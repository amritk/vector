import { Suite } from "nish/testing"
import {
  XML_MAX_ATTRS,
  XML_MAX_DEPTH,
  XML_MAX_INPUT_BYTES,
  XmlNode,
  xmlAttr,
  xmlChild,
  xmlElements,
  xmlParse,
} from "../../../src/spec/xml/reader"

/** `s` `n` times. */
const xmlReaderTestRepeat = (s: string, n: i32): string => {
  const parts: string[] = []
  for (let k = 0; k < n; k++) {
    parts.push(s)
  }
  return parts.join("")
}

/** A refusal as `line:col md=N message`, or `ok <root>` when the text parses. */
const xmlReaderTestErr = (text: string): string => {
  const r = xmlParse(text)
  if (r.isOk()) {
    return `ok <${r.value.name}>`
  }
  return `${r.error.line}:${r.error.col} md=${r.error.mdLine} ${r.error.message}`
}

/** The root, which the test expects to parse. */
const xmlReaderTestRoot = (t: Suite, text: string): XmlNode | null => {
  const r = xmlParse(text)
  if (r.isErr()) {
    t.fail("parses", r.error.message)
    return null
  }
  return r.value
}

/** Elements, attributes, character data and their lines. */
const xmlReaderTestTree = (t: Suite): void => {
  const root = xmlReaderTestRoot(
    t,
    '<?xml version="1.0"?>\n<rfc a="1" b=\'x &amp; y\'>\n  <front><title>T &#65;&#x42;</title></front>\n  <middle/>\n</rfc>\n',
  )
  if (root === null) {
    return
  }
  t.eqStr("root name", root.name, "rfc")
  t.eqStr("attribute", xmlAttr(root, "a") ?? "<none>", "1")
  t.eqStr("attribute, an entity resolved", xmlAttr(root, "b") ?? "<none>", "x & y")
  t.eqStr("no such attribute", xmlAttr(root, "c") ?? "<none>", "<none>")
  t.eqStr(
    "elements skip character data",
    xmlElements(root)
      .map((n: XmlNode): string => n.name)
      .join(" "),
    "front middle",
  )
  const front = xmlChild(root, "front")
  t.ok("a child by name", front !== null && front.line === 3)
  t.ok("no such child", xmlChild(root, "back") === null)
  const title: XmlNode | null = front === null ? null : xmlChild(front, "title")
  const text: XmlNode | null = title === null ? null : title.first
  t.eqStr("character references resolve", text === null ? "<none>" : text.text, "T AB")
}

/** kramdown-rfc's `<?line N?>` names the markdown line of what follows. */
const xmlReaderTestLines = (t: Suite): void => {
  t.eqStr(
    "no <?line?>: md=-1",
    xmlReaderTestErr("<rfc>\n<a>\n</rfc>"),
    "3:6 md=-1 malformed XML: </rfc> closes <a> from line 2",
  )
  t.eqStr(
    "after <?line 40?>, two lines on",
    xmlReaderTestErr("<rfc>\n<?line 40?>\n<a>\n</rfc>"),
    "4:6 md=42 malformed XML: </rfc> closes <a> from line 3",
  )
  t.eqStr(
    "a signed <?line -N?> corrects later lines",
    xmlReaderTestErr("<rfc>\n<?line 40?>\n<?line -10?>\n<?line 40?>\n<a>\n</rfc>"),
    "6:6 md=32 malformed XML: </rfc> closes <a> from line 5",
  )
}

/** Each thing the reader refuses, at its line and column. */
const xmlReaderTestRefusals = (t: Suite): void => {
  t.eqStr(
    "a parameter entity",
    xmlReaderTestErr('<!DOCTYPE rfc [\n  <!ENTITY % p "x">\n]>\n<rfc/>'),
    "2:3 md=-1 a parameter entity (<!ENTITY %) is refused",
  )
  t.eqStr(
    "an external entity",
    xmlReaderTestErr('<!DOCTYPE rfc [\n<!ENTITY e SYSTEM "file:///etc/passwd">\n]>\n<rfc>&e;</rfc>'),
    "2:1 md=-1 external entity &e; is refused: vector never fetches",
  )
  t.eqStr(
    "a DOCTYPE with a SYSTEM identifier",
    xmlReaderTestErr('<!DOCTYPE rfc SYSTEM "rfc2629.dtd">\n<rfc/>'),
    "1:1 md=-1 a DOCTYPE with a SYSTEM or PUBLIC identifier is refused: vector never fetches",
  )
  t.eqStr(
    "a DOCTYPE with a PUBLIC identifier",
    xmlReaderTestErr('<!DOCTYPE rfc PUBLIC "-//x" "y.dtd">\n<rfc/>'),
    "1:1 md=-1 a DOCTYPE with a SYSTEM or PUBLIC identifier is refused: vector never fetches",
  )
  t.eqStr(
    "an internal entity that is text, not one character reference",
    xmlReaderTestErr('<!DOCTYPE rfc [<!ENTITY lol "lol">]>\n<rfc/>'),
    '1:16 md=-1 entity &lol; must be a single numeric character reference such as "&#160;"',
  )
  t.eqStr(
    "an internal entity that nests another",
    xmlReaderTestErr('<!DOCTYPE rfc [<!ENTITY a "&#65;"><!ENTITY b "&a;&a;">]>\n<rfc/>'),
    '1:35 md=-1 entity &b; must be a single numeric character reference such as "&#160;"',
  )
  t.eqStr(
    "a numeric internal entity is allowed",
    xmlReaderTestErr('<!DOCTYPE rfc [<!ENTITY nbsp "&#160;">]>\n<rfc>a&nbsp;b</rfc>'),
    "ok <rfc>",
  )
  t.eqStr(
    "other markup in the DOCTYPE",
    xmlReaderTestErr("<!DOCTYPE rfc [<!ELEMENT rfc ANY>]>\n<rfc/>"),
    '1:16 md=-1 the DOCTYPE may declare only general entities with a numeric value, such as <!ENTITY nbsp "&#160;">; other markup is refused',
  )
  t.eqStr("an undefined entity", xmlReaderTestErr("<rfc>\n  &nope;</rfc>"), "2:3 md=-1 undefined entity &nope;")
  t.eqStr(
    "a character reference to no XML character",
    xmlReaderTestErr("<rfc>&#0;</rfc>"),
    "1:6 md=-1 character reference &#0; names no XML character",
  )
  t.eqStr(
    "xi:include",
    xmlReaderTestErr('<rfc>\n<?line 7?>\n<xi:include href="https://example.com/r.xml"/></rfc>'),
    '3:1 md=8 <xi:include href="https://example.com/r.xml"> is refused: vector never fetches; expand it first (xml2rfc --expand)',
  )
  const deep = `${xmlReaderTestRepeat("<a>", XML_MAX_DEPTH + 1)}${xmlReaderTestRepeat("</a>", XML_MAX_DEPTH + 1)}`
  t.contains("one level past XML_MAX_DEPTH", xmlReaderTestErr(deep), `elements nest deeper than ${XML_MAX_DEPTH}`)
  const ok = `${xmlReaderTestRepeat("<a>", XML_MAX_DEPTH)}${xmlReaderTestRepeat("</a>", XML_MAX_DEPTH)}`
  t.eqStr("XML_MAX_DEPTH itself", xmlReaderTestErr(ok), "ok <a>")
  const attrs: string[] = []
  for (let k = 0; k <= XML_MAX_ATTRS; k++) {
    attrs.push(`a${k}="v"`)
  }
  t.eqStr(
    "one attribute past XML_MAX_ATTRS",
    xmlReaderTestErr(`<rfc ${attrs.join(" ")}/>`),
    `1:508 md=-1 <rfc> has more than ${XML_MAX_ATTRS} attributes (XML_MAX_ATTRS)`,
  )
  attrs.pop()
  t.eqStr("XML_MAX_ATTRS itself", xmlReaderTestErr(`<rfc ${attrs.join(" ")}/>`), "ok <rfc>")
  const big = `<rfc>${xmlReaderTestRepeat("x", XML_MAX_INPUT_BYTES)}</rfc>`
  t.contains("over XML_MAX_INPUT_BYTES", xmlReaderTestErr(big), "1:1 md=-1 ")
  t.ok("over XML_MAX_INPUT_BYTES is refused", xmlParse(big).isErr())
  const bad = String.fromBytes([0x3c, 0x72, 0x3e, 0x0a, 0x61, 0xff, 0x3c, 0x2f, 0x72, 0x3e], 0, 10)
  t.eqStr(
    "not UTF-8",
    xmlReaderTestErr(bad),
    "2:2 md=-1 the input is not UTF-8: byte 255 starts no well-formed sequence",
  )
  const overlong = String.fromBytes([0x3c, 0x72, 0x3e, 0xc0, 0xaf, 0x3c, 0x2f, 0x72, 0x3e], 0, 9)
  t.contains("an overlong form", xmlReaderTestErr(overlong), "the input is not UTF-8")
  t.contains("a control character", xmlReaderTestErr("<r>\u{1}</r>"), "1:4 md=-1 ")
  t.eqStr(
    "a duplicate attribute",
    xmlReaderTestErr('<r a="1" a="2"/>'),
    "1:10 md=-1 malformed XML: duplicate attribute a on <r>",
  )
  t.eqStr("no root element", xmlReaderTestErr("<!-- c -->"), "1:11 md=-1 malformed XML: no root element")
  t.contains("an unclosed element", xmlReaderTestErr("<rfc>\n<a>"), "is never closed")
  t.contains("an unterminated comment", xmlReaderTestErr("<rfc><!-- x"), "malformed XML: unterminated comment")
  t.contains("text after the root", xmlReaderTestErr("<rfc/><b/>"), "malformed XML")
  t.contains(
    "a <?line?> past 999999999",
    xmlReaderTestErr("<rfc><?line 1000000000?></rfc>"),
    "names a line past 999999999",
  )
  t.eqStr(
    "corrections that add up past 999999999",
    xmlReaderTestErr("<rfc><?line +999999999?>\n<?line +1?></rfc>"),
    "2:1 md=-1 <?line +1?> corrects lines by more than 999999999 in all",
  )
  t.eqStr(
    "negative corrections, the same",
    xmlReaderTestErr("<rfc><?line -999999999?><?line -999999999?></rfc>"),
    "1:25 md=-1 <?line -999999999?> corrects lines by more than 999999999 in all",
  )
}

/** Inputs no parse may panic on: every prefix of a spec-shaped document. */
const xmlReaderTestPrefixes = (t: Suite): void => {
  const doc =
    '<?xml version="1.0"?>\n<!DOCTYPE rfc [<!ENTITY nbsp "&#160;">]>\n<rfc a="1"><?line 3?><t>x&nbsp;&#65;<![CDATA[<y>]]></t><!-- c --></rfc>\n'
  let refused = 0
  for (let n = 0; n < doc.length; n++) {
    const r = xmlParse(doc.substring(0, n))
    if (r.isErr() && r.error.line >= 1 && r.error.col >= 1) {
      refused = refused + 1
    }
  }
  t.ok("every proper prefix is refused at a line and column", refused === doc.length - 1)
  t.eqStr("the whole parses", xmlReaderTestErr(doc), "ok <rfc>")
}

/** The XML reader: what it reads, and everything it refuses. */
export const main = (): i32 => {
  const t = new Suite("spec/extract xml reader")
  xmlReaderTestTree(t)
  xmlReaderTestLines(t)
  xmlReaderTestRefusals(t)
  xmlReaderTestPrefixes(t)
  return t.done()
}
