import { Suite } from "nish/testing"
import { RfcSection } from "../../../src/spec/source/rfc"
import { XmlDocument, XmlRef, xmlDocParse, xmlRead } from "../../../src/spec/xml/doc"
import { XmlNode, xmlChild, xmlElements, xmlParse } from "../../../src/spec/xml/reader"
import {
  XmlLines,
  XmlNormative,
  XmlText,
  xmlCodeOf,
  xmlPlainText,
  xmlPlainTextOfNodes,
  xmlSectionLines,
} from "../../../src/spec/xml/text"

/** A section as `id title: own lines | all lines`. */
const xmlDocTestSection = (s: RfcSection): string =>
  `${s.id} ${s.title}: ${s.ownLines.join(" / ")} | ${s.lines.join(" / ")}`

/** The parsed document, or null after failing the test. */
const xmlDocTestParse = (t: Suite, name: string, text: string): XmlDocument | null => {
  const r = xmlDocParse(text)
  if (r.isErr()) {
    t.fail(name, `${r.error.line}: ${r.error.message}`)
    return null
  }
  return r.value
}

/** The kramdown-rfc fixture: sections, references, BCP 14 sentences, xrefs. */
const xmlDocTestFixture = (t: Suite): void => {
  const text = readFileSyncOrNull("tests/fixtures/xmlv3/kramdown.xml")
  if (text === null) {
    t.fail("fixture", "cannot read tests/fixtures/xmlv3/kramdown.xml")
    return
  }
  const doc = xmlDocTestParse(t, "kramdown fixture", text)
  if (doc === null) {
    return
  }
  t.eqStr("docName", doc.docName ?? "<none>", "draft-test-00")
  t.ok("no number attribute", doc.number === -1)
  t.eqLines("sections", doc.sections.map(xmlDocTestSection), [
    '1 Intro: The client MUST do X. It SHOULD do Y. | The client MUST do X. It SHOULD do Y. / a / b / x / y / {"a":1}',
    '1.1 Sub: a / b / x / y / {"a":1} | a / b / x / y / {"a":1}',
    "2 Other: See Section 2 and Section 2 of [RFC2119]. | See Section 2 and Section 2 of [RFC2119].",
  ])
  t.eqStr("references", doc.references.map((r: XmlRef): string => `${r.anchor}=${r.rfc}`).join(" "), "RFC2119=2119")
  t.eqStr("a section by anchor", doc.sectionByAnchor.get("sub") ?? "<none>", "1.1")
  t.eqStr(
    "no <bcp14> markup, no BCP 14 sentences",
    doc.normative.map((n: XmlNormative): string => `${n.section} ${n.level} ${n.sentence}`).join(" / "),
    "",
  )
  const read = xmlRead(text, "k.xml")
  t.ok("xmlRead reads it", read.isOk() && read.value.sections.length === doc.sections.length)
}

/** What xmlRead and xmlDocParse refuse. */
const xmlDocTestRefusals = (t: Suite): void => {
  const notRfc = xmlRead("<doc/>", "x.xml")
  t.eqStr(
    "not <rfc>",
    notRfc.isErr() ? notRfc.error : "ok",
    "x.xml:1: not RFC XML: the root element is <doc>, not <rfc>",
  )
  const bad = xmlRead("<rfc>\n<a></rfc>", "y.xml")
  t.eqStr(
    "malformed, at its line",
    bad.isErr() ? bad.error : "ok",
    "y.xml:2: malformed XML: </rfc> closes <a> from line 2",
  )
  const hidden = xmlRead(
    '<rfc number="9"><middle><section><name>A</name><t>It MU\u{200b}ST.</t></section></middle></rfc>',
    "z.xml",
  )
  t.contains("hidden characters", hidden.isErr() ? hidden.error : "ok", "z.xml")
  const long = xmlDocParse(
    '<rfc number="1234567890"><back><references><reference anchor="R"><front><title>T</title></front><seriesInfo name="RFC" value="1234567890"/></reference></references></back></rfc>',
  )
  t.ok(
    "a number past nine digits reads as absent, not as an i32 overflow",
    long.isOk() &&
      long.value.number === -1 &&
      long.value.references.length === 1 &&
      long.value.references[0].rfc === -1,
  )
}

/** Plain text, code blocks and section lines of hand-written elements. */
const xmlDocTestText = (t: Suite): void => {
  const r = xmlParse('<t>A  <em>b</em>\n  c <xref target="x">here</xref>.</t>')
  if (r.isErr()) {
    t.fail("parses", r.error.message)
    return
  }
  const tx = new XmlText()
  t.eqStr("plain text collapses whitespace", xmlPlainText(tx, r.value), "A b c here (x).")
  const kids: XmlNode[] = []
  let k = r.value.first
  while (k !== null) {
    kids.push(k)
    k = k.next
  }
  t.eqStr("plain text of nodes", xmlPlainTextOfNodes(tx, kids.slice(0, 2)), "A b")
  const code = xmlParse('<sourcecode type="ts-property"><![CDATA[\nforall x\n]]></sourcecode>')
  if (code.isOk()) {
    const c = xmlCodeOf(code.value)
    t.eqStr(
      "a code block's type and text",
      `${c.type ?? "<none>"}|${c.text}|${c.line}|${c.mdLine}`,
      "ts-property|forall x|2|-1",
    )
  }
  const sec = xmlParse("<section><name>N</name><t>One <bcp14>MUST</bcp14> hold.</t><ul><li>Two.</li></ul></section>")
  if (sec.isOk()) {
    const b = new XmlLines(tx)
    const lines = xmlSectionLines(b, sec.value, "3")
    t.eqStr("a section's lines", lines.isOk() ? lines.value.join(" / ") : lines.error.message, "One MUST hold. / Two.")
    t.eqStr(
      "its BCP 14 sentence",
      b.normative.map((n: XmlNormative): string => `${n.section} ${n.level} ${n.sentence}`).join(" / "),
      "3 MUST One MUST hold.",
    )
  }
  t.ok("xmlElements", xmlElements(r.value).length === 2 && xmlChild(r.value, "em") !== null)
}

/** The RFC XML v3 document layer over the reader. */
export const main = (): i32 => {
  const t = new Suite("spec/extract xml doc")
  xmlDocTestFixture(t)
  xmlDocTestRefusals(t)
  xmlDocTestText(t)
  return t.done()
}
