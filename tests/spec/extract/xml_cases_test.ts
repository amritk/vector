import { Suite } from "nish/testing"
import { split } from "nish/text"
import { RfcSection } from "../../../src/spec/source/rfc"
import { XmlDocument, xmlDocParse } from "../../../src/spec/xml/doc"
import { XML_MAX_DEPTH, XmlNode, xmlAttr, xmlElements, xmlParse } from "../../../src/spec/xml/reader"
import { XmlNormative } from "../../../src/spec/xml/text"

// The pinned cases of the TypeScript reader's test/xmlv3.test.ts, ported to
// the Nish reader: the refusals xml_reader_test.ts and xml_doc_test.ts do not
// already hold, numbering, xref formats, BCP 14 sentences, line numbers, and
// inputs a quadratic step would make slow.

/** `s` `n` times. */
const xmlCasesTestRepeat = (s: string, n: i32): string => {
  const parts: string[] = []
  for (let k = 0; k < n; k++) {
    parts.push(s)
  }
  return parts.join("")
}

/** An RFC with `middle` and `back`, and a front with a title. */
const xmlCasesTestDoc = (middle: string, back: string): string =>
  `<rfc number="1"><front><title>T</title></front><middle>${middle}</middle><back>${back}</back></rfc>`

/** A refusal as `line:col md=N[@M] message[ see L]` (M the mark's XML line when there is one, L the second place's), or `ok` when the document reads. */
const xmlCasesTestErr = (text: string): string => {
  const r = xmlDocParse(text)
  if (r.isOk()) {
    return "ok"
  }
  const see = r.error.see
  return `${r.error.line}:${r.error.col} md=${r.error.mdLine}${r.error.mdLine >= 0 ? `@${r.error.markLine}` : ""} ${r.error.message}${see !== null ? ` see ${see.line}` : ""}`
}

/** The document, or null after failing the test. */
const xmlCasesTestParse = (t: Suite, name: string, text: string): XmlDocument | null => {
  const r = xmlDocParse(text)
  if (r.isErr()) {
    t.fail(name, `${r.error.line}: ${r.error.message}`)
    return null
  }
  return r.value
}

/** A section as `id title: own lines | all lines`. */
const xmlCasesTestSection = (s: RfcSection): string =>
  `${s.id} ${s.title}: ${s.ownLines.join(" / ")} | ${s.lines.join(" / ")}`

/** A BCP 14 sentence as `section level sentence @anchor`. */
const xmlCasesTestNormative = (n: XmlNormative): string =>
  `${n.section.length > 0 ? n.section : "-"} ${n.level} ${n.sentence} @${n.anchor ?? "-"}`

/** The BCP 14 sentences of a middle, or the refusal. */
const xmlCasesTestNorm = (middle: string): string[] => {
  const r = xmlDocParse(xmlCasesTestDoc(middle, ""))
  if (r.isErr()) {
    return [`${r.error.line}: ${r.error.message}`]
  }
  return r.value.normative.map(xmlCasesTestNormative)
}

/** The lines of the section numbered `id`, or a note that there is none. */
const xmlCasesTestRawLines = (d: XmlDocument, id: string): string[] => {
  for (const s of d.sections) {
    if (s.id === id) {
      return s.lines
    }
  }
  return [`<no section ${id}>`]
}

/** The lines of text of the section numbered `id`: the blank line between two blocks left out. */
const xmlCasesTestLines = (d: XmlDocument, id: string): string[] =>
  xmlCasesTestRawLines(d, id).filter((l: string): boolean => l.length > 0)

/** The first element named `name`, depth first. */
const xmlCasesTestFind = (n: XmlNode, name: string): XmlNode | null => {
  if (n.name === name) {
    return n
  }
  for (const k of xmlElements(n)) {
    const hit = xmlCasesTestFind(k, name)
    if (hit !== null) {
      return hit
    }
  }
  return null
}

/** Where the element named `name` sits, as `xmlLine/mdLine`, and `@markLine` when there is a mark. */
const xmlCasesTestAt = (root: XmlNode, name: string): string => {
  const n = xmlCasesTestFind(root, name)
  return n === null ? `<no ${name}>` : `${n.line}/${n.mdLine}${n.mdLine >= 0 ? `@${n.markLine}` : ""}`
}

/** Sections numbered as xml2rfc numbers them, and what is not a section. */
const xmlCasesTestNumbering = (t: Suite): void => {
  const d = xmlCasesTestParse(
    t,
    "numbering",
    "<rfc><front><title>T</title><abstract><t>ab</t></abstract><note><t>no</t></note></front><middle>" +
      '<section anchor="a"><name>A</name><t>1</t></section>' +
      '<section anchor="b"><name>B</name><t>2</t><section anchor="b1"><name>B1</name><t>21</t></section></section>' +
      '<section anchor="u" numbered="false"><name>U</name><t>u</t><section anchor="u1"><name>U1</name><t>u1</t></section></section>' +
      '</middle><back><section anchor="x"><name>X</name><section anchor="x1"><name>X1</name></section></section>' +
      '<section anchor="y"><name>Y</name></section></back></rfc>',
  )
  if (d === null) {
    return
  }
  t.eqLines("middle 1, 2, 2.1; back A, A.1, B; numbered=false hides its subtree", d.sections.map(xmlCasesTestSection), [
    "1 A: 1 | 1",
    "2 B: 2 | 2 /  / 21",
    "2.1 B1: 21 | 21",
    "A X:  | ",
    "A.1 X1:  | ",
    "B Y:  | ",
  ])
  const anchors: string[] = []
  for (const name of ["a", "b", "b1", "u", "u1", "x", "x1", "y"]) {
    anchors.push(`${name}=${d.sectionByAnchor.get(name) ?? "-"}`)
  }
  t.eqStr("anchors of numbered sections", anchors.join(" "), "a=1 b=2 b1=2.1 u=- u1=- x=A x1=A.1 y=B")
  const empty = xmlCasesTestParse(t, "<rfc/>", "<rfc/>")
  t.ok("<rfc/> has no sections", empty !== null && empty.sections.length === 0)
}

/** `n` appendices, each on a line of its own. */
const xmlCasesTestBack = (n: i32): string => `<rfc>\n<back>${xmlCasesTestRepeat("\n<section/>", n)}</back></rfc>`

/** 26 appendices are A to Z; a 27th is refused at its line. */
const xmlCasesTestAppendices = (t: Suite): void => {
  const ok = xmlCasesTestParse(t, "26 appendices", xmlCasesTestBack(26))
  t.eqStr("the 26th appendix is Z", ok === null || ok.sections.length !== 26 ? "<not 26>" : ok.sections[25].id, "Z")
  t.eqStr(
    "a 27th appendix",
    xmlCasesTestErr(xmlCasesTestBack(27)),
    "29:0 md=-1 <back> has more than 26 sections; appendix letters run out at Z",
  )
  t.eqStr(
    "a subsection is not an appendix",
    xmlCasesTestErr(`<rfc><back><section>${xmlCasesTestRepeat("<section/>", 27)}</section></back></rfc>`),
    "ok",
  )
}

/** An anchor used twice, on any elements, is refused at its second use. */
const xmlCasesTestAnchors = (t: Suite): void => {
  t.eqStr(
    "two sections",
    xmlCasesTestErr('<rfc><middle>\n<section anchor="s"/>\n<section anchor="s"/></middle></rfc>'),
    '3:0 md=-1 anchor "s" is used again; first used at see 2',
  )
  t.eqStr(
    "a paragraph and a reference",
    xmlCasesTestErr(
      '<rfc><middle><t anchor="t"/></middle><back><references><reference anchor="t"/></references></back></rfc>',
    ),
    '1:0 md=-1 anchor "t" is used again; first used at see 1',
  )
  t.eqStr(
    "after <?line?>, the mark's markdown line and XML line",
    xmlCasesTestErr('<rfc><middle>\n<?line 30?>\n<section anchor="s"/>\n\n<section anchor="s"/></middle></rfc>'),
    '5:0 md=30@2 anchor "s" is used again; first used at see 3',
  )
  const d = xmlCasesTestParse(
    t,
    "two anchors",
    '<rfc><middle><section anchor="s"/><section anchor="u"/></middle></rfc>',
  )
  t.eqStr(
    "different anchors",
    d === null ? "" : `s=${d.sectionByAnchor.get("s") ?? "-"} u=${d.sectionByAnchor.get("u") ?? "-"}`,
    "s=1 u=2",
  )
}

/** A table in a table cell is refused; one beside a table is not. */
const xmlCasesTestTableInCell = (t: Suite): void => {
  const cases: string[][] = [
    ["in a td", "<table><tr><td><table/></td></tr></table>", "table"],
    ["in a th", "<table><thead><tr><th><table/></th></tr></thead></table>", "table"],
    ["in a list in a td", "<table><tr><td><ul><li><table/></li></ul></td></tr></table>", "table"],
    ["a texttable in a c", "<texttable><ttcol>h</ttcol><c><texttable/></c></texttable>", "texttable"],
    ["a texttable in a td", "<table><tr><td><texttable/></td></tr></table>", "texttable"],
  ]
  for (const c of cases) {
    t.eqStr(
      c[0],
      xmlCasesTestErr(xmlCasesTestDoc(`<section>${c[1]}</section>`, "")),
      `1:0 md=-1 <${c[2]}> inside a table cell is not RFC XML v3`,
    )
  }
  t.eqStr(
    "a table beside a table",
    xmlCasesTestErr(xmlCasesTestDoc("<section><table><tr><td>a</td></tr></table><table/></section>", "")),
    "ok",
  )
}

/** Sections `depth` deep around `lines` paragraphs. */
const xmlCasesTestDeep = (depth: i32, lines: i32): string =>
  `<rfc><middle>${xmlCasesTestRepeat("<section>", depth)}${xmlCasesTestRepeat("<t>a</t>", lines)}${xmlCasesTestRepeat("</section>", depth)}</middle></rfc>`

/** Two sections, one inside the other, around a table row of `n` empty cells. */
const xmlCasesTestEmptyCells = (n: i32): string =>
  `<rfc><middle><section><section><table><tr>${xmlCasesTestRepeat("<td/>", n)}</tr></table></section></section></middle></rfc>`

/** XML_MAX_SECTION_LINES, counting each subsection's lines in its parents'. */
const xmlCasesTestSectionBudget = (t: Suite): void => {
  t.eqStr(
    "200 deep holding 20000 lines: 4000000 held",
    xmlCasesTestErr(xmlCasesTestDeep(200, 20000)),
    "1:0 md=-1 numbered sections hold over 2000000 lines, counting each subsection's in its parents' (XML_MAX_SECTION_LINES)",
  )
  const d = xmlCasesTestParse(t, "100 deep holding 20000 lines", xmlCasesTestDeep(100, 20000))
  if (d !== null) {
    t.ok("100 sections", d.sections.length === 100)
    t.ok(
      "the outermost holds all 20000 lines of text, a blank line between each two",
      d.sections[0].lines.filter((l: string): boolean => l.length > 0).length === 20000 &&
        d.sections[0].lines.length === 39999,
    )
    t.ok("and none of its own", d.sections[0].ownLines.length === 0)
  }
  t.eqStr(
    "an unnumbered section holds one copy of its lines",
    xmlCasesTestErr(
      `<rfc><middle><section numbered="false">${xmlCasesTestRepeat("<t>a</t>", 900000)}</section></middle></rfc>`,
    ),
    "ok",
  )
  t.eqStr(
    "empty cells are lines too: 2 deep holding 1000001 of them is over",
    xmlCasesTestErr(xmlCasesTestEmptyCells(1000001)),
    "1:0 md=-1 numbered sections hold over 2000000 lines, counting each subsection's in its parents' (XML_MAX_SECTION_LINES)",
  )
  t.eqStr("and 1000000 of them is not", xmlCasesTestErr(xmlCasesTestEmptyCells(1000000)), "ok")
}

/**
 * Sections each named by two xrefs, by title, to the one before: the
 * worked-out text doubles each time.
 */
const xmlCasesTestChain = (n: i32): string => {
  const parts: string[] = ['<section anchor="s0"><name>xxxxxxxxxxxxxxxx</name></section>']
  for (let i = 1; i <= n; i++) {
    const x = `<xref target="s${i - 1}" format="title"/>`
    parts.push(`<section anchor="s${i}"><name>${x}${x}</name></section>`)
  }
  return xmlCasesTestDoc(parts.join(""), "")
}

/** XML_MAX_XREF_TEXT: xref text worked out past the input's length and it. */
const xmlCasesTestXrefBudget = (t: Suite): void => {
  const ok = xmlCasesTestParse(t, "a chain of 8", xmlCasesTestChain(8))
  t.ok(
    "the 9th title is 16 * 2^8 long",
    ok !== null && ok.sections.length === 9 && ok.sections[8].title.length === 4096,
  )
  const long = xmlCasesTestChain(40)
  t.eqStr(
    "a chain of 40",
    xmlCasesTestErr(long),
    `1:0 md=-1 the xref text worked out runs past ${long.length + 64 * 1024} characters, the input's length and XML_MAX_XREF_TEXT`,
  )
  // derivedContent, the preptool's own, is input and is not counted.
  const prepped = xmlCasesTestParse(
    t,
    "derivedContent",
    xmlCasesTestDoc(
      `<section anchor="s"><name>${xmlCasesTestRepeat("n", 60000)}</name><t>${xmlCasesTestRepeat('<xref target="s" format="title" derivedContent="d"/>', 2000)}</t></section>`,
      "",
    ),
  )
  t.eqStr(
    "derivedContent is not counted",
    prepped === null ? "" : xmlCasesTestLines(prepped, "1")[0],
    xmlCasesTestRepeat("d", 2000),
  )
}

/** `<rfc>` and elements inside it, `n` deep in all. */
const xmlCasesTestNest = (n: i32): string =>
  `<rfc>\n${xmlCasesTestRepeat("<x>", n - 1)}${xmlCasesTestRepeat("</x>", n - 1)}</rfc>`

/** Elements nested past XML_MAX_DEPTH, through the document reader. */
const xmlCasesTestDepth = (t: Suite): void => {
  t.eqStr("XML_MAX_DEPTH deep", xmlCasesTestErr(xmlCasesTestNest(XML_MAX_DEPTH)), "ok")
  t.eqStr(
    "one deeper",
    xmlCasesTestErr(xmlCasesTestNest(XML_MAX_DEPTH + 1)),
    `2:${3 * XML_MAX_DEPTH - 2} md=-1 elements nest deeper than ${XML_MAX_DEPTH} (XML_MAX_DEPTH)`,
  )
}

/** The level of a rendered BCP 14 sentence: its second word. */
const xmlCasesTestLevel = (s: string): string => split(s, " ")[1]

/** Sentences `<bcp14>` makes normative, and keywords it refuses. */
const xmlCasesTestBcp14 = (t: Suite): void => {
  t.eqLines(
    "several per paragraph, with the anchor",
    xmlCasesTestNorm(
      '<section><t anchor="p">A <bcp14>MUST</bcp14> b. C <bcp14>MAY</bcp14> d. No e.</t><t>F <bcp14>SHALL</bcp14>.</t></section>',
    ),
    ["1 MUST A MUST b. @p", "1 MAY C MAY d. @p", "1 SHALL F SHALL. @-"],
  )
  t.eqLines(
    "the same keyword twice in a sentence, once",
    xmlCasesTestNorm("<section><t>A <bcp14>MUST</bcp14> and <bcp14>MUST</bcp14>.</t></section>"),
    ["1 MUST A MUST and MUST. @-"],
  )
  t.eqLines(
    "NOT RECOMMENDED over a line break is SHOULD NOT",
    xmlCasesTestNorm("<section><t>It is <bcp14>NOT\n  RECOMMENDED</bcp14>.</t></section>"),
    ["1 SHOULD NOT It is NOT RECOMMENDED. @-"],
  )
  t.eqLines("spaces inside the element", xmlCasesTestNorm("<section><t>It <bcp14> MUST\n</bcp14> go.</t></section>"), [
    "1 MUST It MUST go. @-",
  ])
  t.eqLines(
    "spaces only inside the element are dropped",
    xmlCasesTestNorm("<section><t>It<bcp14> MUST </bcp14>go.</t></section>"),
    ["1 MUST ItMUSTgo. @-"],
  )
  t.eqLines(
    "nested, each element's own spaces dropped",
    xmlCasesTestNorm("<section><t>a <bcp14> <bcp14> MAY </bcp14> </bcp14> b. c <em> </em></t></section>"),
    ["1 MAY a MAY b. @-"],
  )
  t.eqLines(
    "in list items, table cells, blockquotes and unnumbered sections",
    xmlCasesTestNorm(
      '<section><name>S</name><ul><li anchor="li">x <bcp14>MUST</bcp14> y</li></ul>' +
        "<table><tr><td>z <bcp14>SHALL</bcp14></td></tr></table>" +
        '<blockquote anchor="bq"><bcp14>MAY</bcp14> q</blockquote></section>' +
        '<section numbered="false"><name>U</name><t>u <bcp14>OPTIONAL</bcp14></t></section>',
    ),
    ["1 MUST x MUST y @li", "1 SHALL z SHALL @-", "1 MAY MAY q @bq", "- OPTIONAL u OPTIONAL @-"],
  )
  t.eqLines(
    "a keyword in double quotes is named, not used",
    xmlCasesTestNorm(
      '<section><t>"<bcp14>MUST</bcp14>", "<bcp14>SHALL\n NOT</bcp14>" and "<bcp14>NOT RECOMMENDED</bcp14>" mean this. "<bcp14>MAY</bcp14> x. <bcp14>SHOULD</bcp14>" y. A <bcp14>MUST</bcp14> "z".</t></section>',
    ),
    ['1 MUST A MUST "z". @-'],
  )
  t.eqLines(
    "curly quotes, and quotes a word away, still use it",
    xmlCasesTestNorm('<section><t>“<bcp14>MAY</bcp14>” " <bcp14>MUST</bcp14> "</t></section>').map(xmlCasesTestLevel),
    ["MAY", "MUST"],
  )
  t.eqLines(
    "a bcp14 in a bcp14 keeps each keyword's ends",
    xmlCasesTestNorm('<section><t>A <bcp14><bcp14>MUST</bcp14></bcp14> b. "<bcp14>MAY</bcp14>"</t></section>'),
    ["1 MUST A MUST b. @-"],
  )
  t.eqStr(
    "MUSTN'T is not a keyword",
    xmlCasesTestErr(xmlCasesTestDoc("<section><name>S</name><t>\n<bcp14>MUSTN'T</bcp14></t></section>", "")),
    `2:0 md=-1 <bcp14> holds "MUSTN'T", which is not a BCP 14 keyword`,
  )
  t.eqStr(
    "DEFINITION is not a keyword",
    xmlCasesTestErr(xmlCasesTestDoc("<section><t><bcp14>DEFINITION</bcp14></t></section>", "")),
    '1:0 md=-1 <bcp14> holds "DEFINITION", which is not a BCP 14 keyword',
  )
}

/** Plain text of entities, inline markup and erefs. */
const xmlCasesTestInline = (t: Suite): void => {
  const d = xmlCasesTestParse(
    t,
    "inline",
    xmlCasesTestDoc(
      "<section><name>S</name>" +
        "<t>a&amp;b &lt;&gt;&quot;&apos; &#65;&#x42; <bcp14>MUST</bcp14>\n  <tt>tt</tt> <em>em</em> <strong>s</strong> x<sub>2</sub> y<sup>3</sup> <u>u</u></t>" +
        "<t>a<iref item='x'/>b<cref>note</cref>c<br/>d</t>" +
        "<t>non&#8209;breaking&#160;space&#8203;zero&#8288;joiner</t>" +
        "<t><![CDATA[<raw> & ]]>text</t>" +
        '<t><eref target="https://e.x"/></t>' +
        '<t><eref target="https://e.x">E</eref></t>' +
        '<t><eref target="https://e.x" brackets="none"/></t>' +
        '<t><eref target="https://e.x" brackets="none">E</eref></t>' +
        "<t><eref>E</eref></t>" +
        "</section>",
      "",
    ),
  )
  if (d === null) {
    return
  }
  t.eqLines("entities, inline markup, erefs", xmlCasesTestLines(d, "1"), [
    "a&b <>\"' AB MUST tt em s x2 y3 u",
    "abc d",
    "non-breaking spacezerojoiner",
    "<raw> & text",
    "<https://e.x>",
    "E <https://e.x>",
    "https://e.x",
    "E (https://e.x)",
    "E <>",
  ])
}

/** What each xref format prints, to references, sections, figures and tables. */
const xmlCasesTestXrefs = (t: Suite): void => {
  const refs =
    '<references><name>R</name><reference anchor="RFC1"><front><title>One Title</title></front><seriesInfo name="RFC" value="1"/></reference>' +
    '<reference anchor="R2"><front><title>Two</title></front></reference></references><displayreference target="R2" to="TWO"/>'
  const d = xmlCasesTestParse(
    t,
    "xrefs",
    xmlCasesTestDoc(
      '<section anchor="s"><name>Sec <em>Name</em></name>' +
        '<t><xref target="RFC1"/></t>' +
        '<t><xref target="RFC1">the RFC</xref></t>' +
        '<t><xref target="R2"/></t>' +
        '<t><xref target="RFC1" format="title"/></t>' +
        '<t><xref target="RFC1" format="title">x</xref></t>' +
        '<t><xref target="RFC1" format="none">x</xref></t>' +
        '<t><xref target="RFC1" derivedContent="D"/></t>' +
        '<t><xref target="RFC1" section="2.3"/></t>' +
        '<t><xref target="RFC1" section="A.1">x</xref></t>' +
        '<t><xref target="RFC1" section="II" sectionFormat="comma"/></t>' +
        '<t><xref target="RFC1" section="B" sectionFormat="parens"/></t>' +
        '<t><xref target="RFC1" section="2" sectionFormat="bare"/></t>' +
        '<t><xref target="RFC1" section="2" sectionFormat="bare">x</xref></t>' +
        '<t>[<xref target="s"/>] [<xref target="s" format="counter"/>] [<xref target="s" format="title"/>] [<xref target="s" format="none"/>] [<xref target="s">see</xref>] [<xref target="s" format="none">see</xref>]</t>' +
        '<t anchor="p">[<xref target="u"/>] [<xref target="u" format="counter"/>] [<xref target="u2"/>] [<xref target="app"/>] [<xref target="nope"/>] [<xref target="p"/>] [<xref target="p" format="title"/>] [<xref/>]</t>' +
        '<figure anchor="f"><artwork>art</artwork></figure>' +
        '<table anchor="tb"><tr><td>c</td></tr></table>' +
        '<texttable anchor="tt"><ttcol>h</ttcol><c>v</c></texttable>' +
        '<t>[<xref target="f"/>] [<xref target="f" format="counter"/>] [<xref target="tb"/>] [<xref target="tb" format="counter"/>] [<xref target="tt"/>]</t>' +
        "</section>" +
        '<section anchor="u" numbered="false"><name>Un</name></section>' +
        '<section anchor="u2" numbered="false"/>',
      `<section anchor="app"><name>App</name></section>${refs}`,
    ),
  )
  if (d === null) {
    return
  }
  const lines = xmlCasesTestLines(d, "1")
  t.eqLines("to a reference", lines.slice(0, 7), [
    "[RFC1]",
    "the RFC [RFC1]",
    "[TWO]",
    "One Title",
    "x (One Title)",
    "x",
    "[D]",
  ])
  t.eqLines("to a section of a reference", lines.slice(7, 13), [
    "Section 2.3 of [RFC1]",
    "Appendix A.1 of x [RFC1]",
    "[RFC1], Part II",
    "[RFC1] (Appendix B)",
    "2",
    "2 (x)",
  ])
  t.eqStr("to a section", lines.length > 13 ? lines[13] : "", "[Section 1] [1] [Sec Name] [] [see (Section 1)] [see]")
  t.eqStr(
    "to unnumbered sections, an appendix, nothing and a paragraph",
    lines.length > 14 ? lines[14] : "",
    '[Section "Un"] [] [Section "u2"] [Appendix A] [nope] [p] [p] []',
  )
  t.eqStr(
    "to figures and tables",
    lines.length > 0 ? lines[lines.length - 1] : "",
    "[Figure 1] [1] [Table 1] [1] [Table 2]",
  )
}

/** Attributes: __proto__ is a name like any other; a tab or newline reads as a space. */
const xmlCasesTestAttributes = (t: Suite): void => {
  const r = xmlParse('<rfc __proto__="x" constructor="y"/>')
  if (r.isErr()) {
    t.fail("__proto__ parses", r.error.message)
    return
  }
  t.eqStr("attributes named __proto__ and constructor", r.value.attrNames.join(" "), "__proto__ constructor")
  t.eqStr("__proto__'s value", xmlAttr(r.value, "__proto__") ?? "<none>", "x")
  t.eqStr("constructor's value", xmlAttr(r.value, "constructor") ?? "<none>", "y")
  t.eqStr("no attribute reads through to a prototype", xmlAttr(r.value, "toString") ?? "<none>", "<none>")
  t.eqStr(
    "__proto__ twice",
    xmlCasesTestErr('<rfc __proto__="x" __proto__="y"/>'),
    "1:20 md=-1 malformed XML: duplicate attribute __proto__ on <rfc>",
  )
  const ws = xmlParse('<rfc a="x\ty\r\nz" b="&#10;&#9;"/>')
  if (ws.isErr()) {
    t.fail("whitespace attributes parse", ws.error.message)
    return
  }
  t.eqStr("a literal tab or newline reads as a space", xmlAttr(ws.value, "a") ?? "<none>", "x y z")
  t.eqStr("a referenced one is kept", xmlAttr(ws.value, "b") ?? "<none>", "\n\t")
}

/** `<?line?>` and its signed corrections, a BOM and CRLF line ends. */
const xmlCasesTestLineNumbers = (t: Suite): void => {
  const signed = xmlParse(
    "<rfc>\n<?line 10?>\n<a/>\n<?line -3?>\n<b/>\n<?line 20?>\n<c/>\n<?line +5?><?line 30?>\n<d/></rfc>",
  )
  if (signed.isOk()) {
    t.eqStr("after <?line 10?>", xmlCasesTestAt(signed.value, "a"), "3/10@2")
    t.eqStr("a correction moves no line by itself", xmlCasesTestAt(signed.value, "b"), "5/10@2")
    t.eqStr("it corrects the next <?line?>", xmlCasesTestAt(signed.value, "c"), "7/17@6")
    t.eqStr("corrections add up", xmlCasesTestAt(signed.value, "d"), "9/32@8")
  } else {
    t.fail("signed <?line?>", signed.error.message)
  }
  const below = xmlParse("<rfc>\n<?line -50?><?line 1?>\n<a/>\n<b/></rfc>")
  if (below.isOk()) {
    t.eqStr("a correction below the first line reads as line 1", xmlCasesTestAt(below.value, "a"), "3/1@2")
    t.eqStr("and stays there", xmlCasesTestAt(below.value, "b"), "4/1@2")
  } else {
    t.fail("<?line?> below the first line", below.error.message)
  }
  const crlf = xmlParse(
    "\u{FEFF}<?xml version='1.0'?>\r\n<rfc>\r\n<middle><section anchor='a'>\r\n<t>x</t></section></middle></rfc>",
  )
  if (crlf.isOk()) {
    t.eqStr("line numbers survive a BOM and CRLF", xmlCasesTestAt(crlf.value, "t"), "4/-1")
  } else {
    t.fail("a BOM and CRLF", crlf.error.message)
  }
  t.eqStr(
    "a refusal after CRLF lines",
    xmlCasesTestErr("<rfc>\r\n\r\n<x>"),
    "3:1 md=-1 malformed XML: <x> is never closed",
  )
}

/** Milliseconds since `start`, under a bound a quadratic step would pass. */
const xmlCasesTestFast = (t: Suite, name: string, start: f64): void => {
  const ms = Date.now() - start
  t.ok(`${name}: ${ms} ms, linear`, ms < 10000)
}

/**
 * `open` then `level` nested `depth` deep around `fill` repeated `n` times,
 * in a paragraph, and how long reading it took: one warm-up run, then the
 * least of three, in milliseconds. -1 when the outcome is not `want` (it
 * parses when `want` is "", else it is refused with a message holding
 * `want`), so a fast failure is never mistaken for a fast read.
 */
const xmlCasesTestTime = (
  open: string,
  close: string,
  level: string,
  fill: string,
  want: string,
  depth: i32,
  n: i32,
): f64 => {
  const doc = xmlCasesTestDoc(
    `<section><t>${xmlCasesTestRepeat(`${open}${level}`, depth)}${xmlCasesTestRepeat(fill, n)}${xmlCasesTestRepeat(close, depth)}</t></section>`,
    "",
  )
  let best: f64 = 1e9
  for (let k = 0; k < 4; k++) {
    const start = Date.now()
    const read = xmlDocParse(doc)
    const ms = Date.now() - start
    const as = read.isErr() ? want.length > 0 && read.error.message.indexOf(want) >= 0 : want.length === 0
    if (!as) {
      return -1.0
    }
    if (k > 0 && ms < best) {
      best = ms
    }
  }
  return best
}

/**
 * The curve, not a wall clock: markup nested `d` deep, with `level` inside
 * each level, around `n` bytes, then 8d deep around 8n. A linear reader takes
 * about 8 times as long; one that copies the text once per level, 64 times.
 * Pinned under 24, from a floor of 4 ms so a fast first run is not noise.
 * Both sizes must end as `want` says (xmlCasesTestTime), or it fails.
 */
const xmlCasesTestShape = (
  t: Suite,
  name: string,
  open: string,
  close: string,
  level: string,
  fill: string,
  want: string,
): void => {
  const one = xmlCasesTestTime(open, close, level, fill, want, 31, 40000)
  const eight = xmlCasesTestTime(open, close, level, fill, want, 248, 320000)
  const base: f64 = one < 4.0 ? 4.0 : one
  t.ok(`${name}: ${want.length === 0 ? "parses" : "is refused as expected"} at both sizes`, one >= 0.0 && eight >= 0.0)
  t.ok(
    `${name}: ${one} ms, then ${eight} ms at 8 times the depth and text, linear`,
    one >= 0.0 && eight >= 0.0 && eight < 24.0 * base,
  )
}

/** 4000 xrefs to `target`, by title or not. */
const xmlCasesTestXrefRun = (target: string, title: boolean): string =>
  xmlCasesTestRepeat(`<xref target="${target}"${title ? ' format="title"' : ""}/>`, 4000)

/** The first line of the last section, or "". */
const xmlCasesTestLastFirst = (d: XmlDocument | null): string => {
  if (d === null || d.sections.length === 0) {
    return ""
  }
  const lines = d.sections[d.sections.length - 1].lines
  return lines.length > 0 ? lines[0] : ""
}

/** A section's codeLines, comma-separated. */
const xmlCasesTestCodeLines = (sec: RfcSection): string => sec.codeLines.map((i: i32): string => `${i}`).join(",")

/** Inputs that took seconds to minutes when a step was quadratic. */
const xmlCasesTestLinear = (t: Suite): void => {
  let start = Date.now()
  const siblings = xmlCasesTestParse(
    t,
    "many sibling sections",
    `<rfc><middle>${xmlCasesTestRepeat("<section/>", 40000)}</middle></rfc>`,
  )
  t.ok("40000 sections", siblings !== null && siblings.sections.length === 40000)
  xmlCasesTestFast(t, "many sibling sections", start)

  start = Date.now()
  const coded = xmlCasesTestParse(
    t,
    "many sections of code",
    `<rfc><middle>${xmlCasesTestRepeat("<section><t>p</t><sourcecode>a\nb\nc\nd\ne</sourcecode></section>", 40000)}</middle></rfc>`,
  )
  t.eqStr(
    "many sections of code: the first and last each hold only their own lines of code",
    coded !== null && coded.sections.length === 40000
      ? `${xmlCasesTestCodeLines(coded.sections[0])} / ${xmlCasesTestCodeLines(coded.sections[39999])}`
      : "",
    "2,3,4,5,6 / 2,3,4,5,6",
  )
  xmlCasesTestFast(t, "many sections of code", start)

  start = Date.now()
  t.ok(
    "many keywords in one sentence: one sentence",
    xmlCasesTestNorm(`<section><t>${xmlCasesTestRepeat("x <bcp14>MUST</bcp14> ", 100000)}</t></section>`).length === 1,
  )
  xmlCasesTestFast(t, "many keywords in one sentence", start)

  start = Date.now()
  t.eqStr(
    "many xrefs by title to one long name",
    xmlCasesTestErr(
      xmlCasesTestDoc(
        `<section anchor="s"><name>${xmlCasesTestRepeat(" ", 1000000)}n</name><t>${xmlCasesTestRepeat('<xref target="s" format="title"/>', 100000)}</t></section>`,
        "",
      ),
    ),
    "ok",
  )
  xmlCasesTestFast(t, "many xrefs by title to one long name", start)

  const opens: string[][] = [
    ["xref", '<xref target="s">', "</xref>"],
    ["eref", '<eref target="https://example.com/">', "</eref>"],
  ]
  for (const o of opens) {
    start = Date.now()
    const d = xmlCasesTestParse(
      t,
      `${o[0]} nested deep`,
      xmlCasesTestDoc(
        `<section anchor="s"><name>S</name><t>${xmlCasesTestRepeat(o[1], 250)}${xmlCasesTestRepeat("a  b. ", 200000)}${xmlCasesTestRepeat(o[2], 250)}</t></section>`,
        "",
      ),
    )
    t.contains(`${o[0]} nested deep around much text`, d === null ? "" : xmlCasesTestLines(d, "1")[0], "a b. a b.")
    xmlCasesTestFast(t, `${o[0]} nested deep`, start)
  }

  start = Date.now()
  t.eqStr(
    "bcp14 nested deep around much text",
    xmlCasesTestErr(
      xmlCasesTestDoc(
        `<section><t>${xmlCasesTestRepeat("<bcp14> ", 250)}MUST${xmlCasesTestRepeat(" x", 500000)}${xmlCasesTestRepeat(" </bcp14>", 250)}</t></section>`,
        "",
      ),
    ),
    '1:0 md=-1 <bcp14> holds "MUST x x x x x x x x x x x x x x x x x x...", which is not a BCP 14 keyword',
  )
  xmlCasesTestFast(t, "bcp14 nested deep", start)
  // A <bcp14> holding more than a keyword is always refused, so its shape is
  // the refusal's: the text is still read through every level first.
  xmlCasesTestShape(t, "bcp14 nested", "<bcp14> ", " </bcp14>", "MUST ", " MUST x", '<bcp14> holds "MUST MUST')
  xmlCasesTestShape(t, "eref nested", '<eref target="u">', "</eref>", "c ", " a b", "")
  xmlCasesTestShape(t, "xref nested", '<xref target="u" format="none">', "</xref>", "c ", ' a b <iref item="i"/>', "")

  const many = xmlCasesTestRepeat("<t/>", 200000)
  const targets: string[][] = [
    [
      "a section's name after many children",
      xmlCasesTestDoc(
        `<section anchor="s">${many}<name>N</name></section><section><t>${xmlCasesTestXrefRun("s", true)}</t></section>`,
        "",
      ),
      "N",
    ],
    [
      "an unnumbered section's name after many children",
      xmlCasesTestDoc(
        `<section><t>${xmlCasesTestXrefRun("s", false)}</t></section><section anchor="s" numbered="false">${many}<name>N</name></section>`,
        "",
      ),
      'Section "N"',
    ],
    [
      "a reference's title after many authors",
      `<rfc><middle><section><t>${xmlCasesTestXrefRun("r", true)}</t></section></middle><back><references><reference anchor="r"><front>${xmlCasesTestRepeat("<author/>", 200000)}<title>T</title></front></reference></references></back></rfc>`,
      "T",
    ],
    [
      "a reference's title after many seriesInfo",
      `<rfc><middle><section><t>${xmlCasesTestXrefRun("r", true)}</t></section></middle><back><references><reference anchor="r">${xmlCasesTestRepeat("<seriesInfo/>", 200000)}<front><title>T</title></front></reference></references></back></rfc>`,
      "T",
    ],
  ]
  for (const c of targets) {
    start = Date.now()
    const d = xmlCasesTestParse(t, c[0], c[1])
    t.eqStr(c[0], xmlCasesTestLastFirst(d), xmlCasesTestRepeat(c[2], 4000))
    xmlCasesTestFast(t, c[0], start)
  }

  start = Date.now()
  t.eqStr(
    "tables nested in cells are refused before any is rendered",
    xmlCasesTestErr(
      xmlCasesTestDoc(
        `<section>${xmlCasesTestRepeat("<table><tr><td><tt>x</tt> ", 60)}${xmlCasesTestRepeat("<tt>a</tt> b. ", 100000)}${xmlCasesTestRepeat("</td></tr></table>", 60)}</section>`,
        "",
      ),
    ),
    "1:0 md=-1 <table> inside a table cell is not RFC XML v3",
  )
  xmlCasesTestFast(t, "tables nested in cells", start)

  start = Date.now()
  const cells = xmlCasesTestParse(
    t,
    "a table with many cells",
    `<rfc><middle><section><table><tr>${xmlCasesTestRepeat("<td>g</td>", 40000)}</tr></table></section></middle></rfc>`,
  )
  t.ok("40000 cells, 40000 lines of text", cells !== null && xmlCasesTestLines(cells, "1").length === 40000)
  t.ok("and a blank line between each two", cells !== null && xmlCasesTestRawLines(cells, "1").length === 79999)
  const bare = xmlCasesTestParse(
    t,
    "a table with many word cells",
    `<rfc><middle><section><table><tr>${xmlCasesTestRepeat("<td>0001</td>", 40000)}</tr></table></section></middle></rfc>`,
  )
  t.ok(
    "40000 word cells, no blank line between them",
    bare !== null && xmlCasesTestRawLines(bare, "1").length === 40000,
  )
  xmlCasesTestFast(t, "a table with many cells", start)
}

/** The pinned cases of the TypeScript reader, on the Nish one. */
export const main = (): i32 => {
  const t = new Suite("spec/extract xml cases")
  xmlCasesTestNumbering(t)
  xmlCasesTestAppendices(t)
  xmlCasesTestAnchors(t)
  xmlCasesTestTableInCell(t)
  xmlCasesTestSectionBudget(t)
  xmlCasesTestXrefBudget(t)
  xmlCasesTestDepth(t)
  xmlCasesTestBcp14(t)
  xmlCasesTestInline(t)
  xmlCasesTestXrefs(t)
  xmlCasesTestAttributes(t)
  xmlCasesTestLineNumbers(t)
  xmlCasesTestLinear(t)
  return t.done()
}
