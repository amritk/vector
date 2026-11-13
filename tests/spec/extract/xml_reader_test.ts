import { Suite } from "nish/testing"
import {
  XML_MAX_ATTRS,
  XML_MAX_DEPTH,
  XML_MAX_ENTITIES,
  XML_MAX_INPUT_BYTES,
  XmlNode,
  xmlAttr,
  xmlChild,
  xmlElements,
  xmlErrorAt,
  xmlErrorSee,
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

/** A refusal as `line:col md=N[@M] message[ see L]` (M the mark's XML line when there is one, L the second place's), or `ok <root>` when the text parses. */
const xmlReaderTestErr = (text: string): string => {
  const r = xmlParse(text)
  if (r.isOk()) {
    return `ok <${r.value.name}>`
  }
  const see = r.error.see
  return `${r.error.line}:${r.error.col} md=${r.error.mdLine}${r.error.mdLine >= 0 ? `@${r.error.markLine}` : ""} ${r.error.message}${see !== null ? ` see ${see.line}` : ""}`
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
  t.ok("an element's column", front !== null && front.col === 3)
  t.ok("text with references is not its raw XML", text !== null && text.col === 17 && text.raw !== text.text)
}

/** Character data keeps the XML it was read from, from its column up to the next markup. */
const xmlReaderTestRaw = (t: Suite): void => {
  const root = xmlReaderTestRoot(t, "<rfc>\n  <tt>a(b)</tt><tt><![CDATA[c]]></tt><tt>d&lt;</tt>\n</rfc>")
  if (root === null) {
    return
  }
  const got = xmlElements(root).map((n: XmlNode): string => {
    const k = n.first
    return k === null ? "<none>" : `${k.text}@${k.line}:${k.col} ${k.raw}`
  })
  t.eqStr("plain, CDATA, a reference", got.join(", "), "a(b)@2:7 a(b), c@2:20 <![CDATA[c]]>, d<@2:42 d&lt;")
}

/** An error at a node takes its line and mark and no column; a second node rides along to be printed. */
const xmlReaderTestErrorAt = (t: Suite): void => {
  const a = new XmlNode("a", 7, 30, 5, 1)
  a.col = 4
  const b = new XmlNode("b", 9, 30, 5, 2)
  const e = xmlErrorAt(a, "why")
  t.eqStr("at the node", `${e.line}:${e.col} md=${e.mdLine} mark=${e.markLine} ${e.message}`, "7:0 md=30 mark=5 why")
  t.ok("no second node", e.see === null)
  const s = xmlErrorSee(a, "opened at", b)
  const see = s.see
  t.eqStr(
    "with a second node",
    see !== null ? `${s.line} ${s.message} ${see.name}:${see.line}` : "none",
    "7 opened at b:9",
  )
}

/** kramdown-rfc's `<?line N?>` names the markdown line of what follows. */
const xmlReaderTestLines = (t: Suite): void => {
  t.eqStr(
    "no <?line?>: md=-1",
    xmlReaderTestErr("<rfc>\n<a>\n</rfc>"),
    "3:6 md=-1 malformed XML: </rfc> closes <a>, opened at see 2",
  )
  t.eqStr(
    "after <?line 40?>, the mark's markdown line, not one extrapolated from it",
    xmlReaderTestErr("<rfc>\n<?line 40?>\n<a>\n</rfc>"),
    "4:6 md=40@2 malformed XML: </rfc> closes <a>, opened at see 3",
  )
  t.eqStr(
    "a signed <?line -N?> corrects later lines",
    xmlReaderTestErr("<rfc>\n<?line 40?>\n<?line -10?>\n<?line 40?>\n<a>\n</rfc>"),
    "6:6 md=30@4 malformed XML: </rfc> closes <a>, opened at see 5",
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
    '3:1 md=7@2 <xi:include href="https://example.com/r.xml"> is refused: vector never fetches; expand it first (xml2rfc --expand)',
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
  t.eqStr(
    "over XML_MAX_INPUT_BYTES",
    xmlReaderTestErr(big),
    `1:1 md=-1 input is ${big.length} bytes, over the 8388608-byte limit (XML_MAX_INPUT_BYTES)`,
  )
  t.ok("over XML_MAX_INPUT_BYTES is refused", xmlParse(big).isErr())
  const bad = String.fromBytes([0x3c, 0x72, 0x3e, 0x0a, 0x61, 0xff, 0x3c, 0x2f, 0x72, 0x3e], 0, 10)
  t.eqStr(
    "not UTF-8",
    xmlReaderTestErr(bad),
    "2:2 md=-1 the input is not UTF-8: byte 255 starts no well-formed sequence",
  )
  const overlong = String.fromBytes([0x3c, 0x72, 0x3e, 0xc0, 0xaf, 0x3c, 0x2f, 0x72, 0x3e], 0, 9)
  t.contains("an overlong form", xmlReaderTestErr(overlong), "the input is not UTF-8")
  t.eqStr("a control character", xmlReaderTestErr("<r>\u{1}</r>"), "1:4 md=-1 U+0001 is not an XML character")
  t.eqStr(
    "a duplicate attribute",
    xmlReaderTestErr('<r a="1" a="2"/>'),
    "1:10 md=-1 malformed XML: duplicate attribute a on <r>",
  )
  t.eqStr("no root element", xmlReaderTestErr("<!-- c -->"), "1:11 md=-1 malformed XML: no root element")
  t.eqStr("an unclosed element", xmlReaderTestErr("<rfc>\n<a>"), "2:1 md=-1 malformed XML: <a> is never closed")
  t.eqStr("an unterminated comment", xmlReaderTestErr("<rfc><!-- x"), "1:10 md=-1 malformed XML: unterminated comment")
  t.eqStr(
    "text after the root",
    xmlReaderTestErr("<rfc/><b/>"),
    "1:7 md=-1 malformed XML: content after the root element",
  )
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

/** A DOCTYPE declaring `n` entities e0..e(n-1), each one per line and each "A". */
const xmlReaderTestEntities = (n: i32): string => {
  const decls: string[] = []
  for (let k = 0; k < n; k++) {
    decls.push(`<!ENTITY e${k} "&#65;">`)
  }
  return `<!DOCTYPE rfc [\n${decls.join("\n")}\n]>\n`
}

/** The DOCTYPE's entities: at most XML_MAX_ENTITIES, the one past it refused at its line. */
const xmlReaderTestEntityCap = (t: Suite): void => {
  t.eqStr(
    "one entity past XML_MAX_ENTITIES",
    xmlReaderTestErr(`${xmlReaderTestEntities(XML_MAX_ENTITIES + 1)}<rfc/>`),
    `${XML_MAX_ENTITIES + 2}:1 md=-1 the DOCTYPE declares more than 256 entities (XML_MAX_ENTITIES)`,
  )
  t.eqStr(
    "XML_MAX_ENTITIES itself",
    xmlReaderTestErr(`${xmlReaderTestEntities(XML_MAX_ENTITIES)}<rfc>&e255;</rfc>`),
    "ok <rfc>",
  )
}

/** Fails `name` unless it ran in under ten seconds since `start`, a bound a quadratic step would pass. */
const xmlReaderTestFast = (t: Suite, name: string, start: f64): void => {
  const ms = Date.now() - start
  t.ok(`${name}: ${ms} ms, linear`, ms < 10000)
}

/**
 * Parses `<rfc>body</rfc>` after `prolog`, with `unit` repeated to fill
 * the input up to a little under XML_MAX_INPUT_BYTES, and checks the root
 * holds one text node `each` bytes long per unit, in under ten seconds.
 */
const xmlReaderTestFill = (t: Suite, name: string, prolog: string, unit: string, each: i32): void => {
  const n = (XML_MAX_INPUT_BYTES - prolog.length - 4096) / unit.length
  const text = `${prolog}<rfc>${xmlReaderTestRepeat(unit, n)}</rfc>`
  const start = Date.now()
  const r = xmlParse(text)
  if (r.isErr()) {
    t.fail(name, r.error.message)
    return
  }
  const first = r.value.first
  t.ok(
    `${name}: one text node of ${n * each} bytes`,
    first !== null && first.next === null && first.text.length === n * each,
  )
  xmlReaderTestFast(t, name, start)
}

/** Inputs near XML_MAX_INPUT_BYTES that cost their square when a step was quadratic. */
const xmlReaderTestLinear = (t: Suite): void => {
  xmlReaderTestFill(t, "adjacent CDATA sections", "", "<![CDATA[x]]>", 1)
  xmlReaderTestFill(t, "adjacent entity references", "", "&amp;", 1)
  xmlReaderTestFill(t, "alternating text and references", "", "x&lt;", 2)
  xmlReaderTestFill(t, "alternating text and CDATA", "", "x<![CDATA[y]]>", 2)
  xmlReaderTestFill(t, "references and CDATA", "", "&gt;<![CDATA[y]]>", 2)
  const decls = xmlReaderTestEntities(XML_MAX_ENTITIES)
  const refs: string[] = []
  for (let k = XML_MAX_ENTITIES - 8; k < XML_MAX_ENTITIES; k++) {
    refs.push(`&e${k};`)
  }
  xmlReaderTestFill(t, "references to the last of 256 entities", decls, refs.join(""), 8)
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
  xmlReaderTestRaw(t)
  xmlReaderTestErrorAt(t)
  xmlReaderTestLines(t)
  xmlReaderTestRefusals(t)
  xmlReaderTestEntityCap(t)
  xmlReaderTestLinear(t)
  xmlReaderTestPrefixes(t)
  return t.done()
}
