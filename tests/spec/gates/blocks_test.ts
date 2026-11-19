import { Suite } from "nish/testing"
import { contractParse } from "../../../src/spec/contract/read"
import { gateArgsAt } from "../../../src/spec/gates/cite"
import { gateStatesResult } from "../../../src/spec/gates/result"
import { gateParagraphStarts, gateSentenceAt } from "../../../src/spec/gates/text"
import { gateWordBlocks } from "../../../src/spec/gates/words"
import { LoadedSource, SourceSet } from "../../../src/spec/source/load"
import { RfcDocument, RfcSection, rfcNormalize, rfcParse, rfcSection } from "../../../src/spec/source/rfc"
import { xmlRead } from "../../../src/spec/xml/doc"

/** The sentence around the first `needle` in a section's own text, as completeness reads it. */
const blocksTestSentence = (sec: RfcSection, needle: string): string => {
  const text = rfcNormalize(sec.ownLines.join("\n"))
  const at = text.indexOf(needle)
  if (at < 0) {
    return `<no ${needle}>`
  }
  return gateSentenceAt(text, gateParagraphStarts(sec.ownLines), at)
}

/** A one-section XML document whose body is `body`, or null when it is refused. */
const blocksTestXmlDoc = (body: string): RfcDocument | null => {
  const r = xmlRead(`<rfc><middle><section><name>S</name>${body}</section></middle></rfc>`, "s.xml")
  if (r.isErr()) {
    return null
  }
  return r.value
}

/** The sentence around `needle` in a one-section XML document whose body is `body`. */
const blocksTestXml = (body: string, needle: string): string => {
  const doc = blocksTestXmlDoc(body)
  if (doc === null) {
    return "<refused>"
  }
  if (doc.sections.length !== 1) {
    return `<${doc.sections.length} sections>`
  }
  return blocksTestSentence(doc.sections[0], needle)
}

/** An RFC's text whose section 1 is `body`, through rfcParse. */
const blocksTestRfcDoc = (body: string): RfcDocument => {
  const head = [
    "Internet Engineering Task Force (IETF)                           A. Author",
    "Request for Comments: 9999                                    Example Inc.",
    "Category: Informational                                         May 2020",
    "",
    "1.  Introduction",
    "",
  ]
  return rfcParse(`${head.join("\n")}\n${body}`)
}

/** The sentence around `needle` in section 1 of an RFC's text, through rfcParse. */
const blocksTestRfc = (body: string, needle: string): string => {
  const sec = rfcSection(blocksTestRfcDoc(body), "1")
  return sec === null ? "<no section 1>" : blocksTestSentence(sec, needle)
}

/** The word blocks section 1 of `doc` prints, each its word count: "4", "1,1"; "" for none. */
const blocksTestWords = (doc: RfcDocument | null): string => {
  if (doc === null) {
    return "<refused>"
  }
  const sec = rfcSection(doc, "1")
  if (sec === null) {
    return "<no section 1>"
  }
  return gateWordBlocks(sec.lines, sec.pageBreaks)
    .map((b): string => `${b.words.length}`)
    .join(",")
}

/**
 * Whether section 1 of `doc` states `word` as R1's result, R1 quoting
 * `quote` there: "PASS", or why not.
 */
const blocksTestResult = (doc: RfcDocument | null, quote: string, word: string): string => {
  if (doc === null) {
    return "<refused>"
  }
  const json = `{
  "contract": "c1",
  "source": {"title": "T", "rfc": 9999},
  "target": {"module": "nish/x"},
  "requirements": [{"id": "R1", "section": "1", "level": "MUST", "quote": "${quote}"}],
  "functions": [{"name": "f", "params": [{"name": "b", "type": "bytes"}], "returns": "bool"}],
  "clauses": [
    {"kind": "vector", "id": "V1", "title": "t", "covers": ["R1"],
     "source": {"cite": {"section": "1"}}, "call": "f", "args": [{"hex": ""}], "expect": {"bool": ${word}}}
  ]
}`
  const c = contractParse(json, "c1").expect("parse")
  const set = new SourceSet()
  set.main = "rfc9999"
  set.sources.push(new LoadedSource("rfc9999", "r.txt", "r.txt", doc))
  const sec = rfcSection(doc, "1")
  if (sec === null) {
    return "<no section 1>"
  }
  const why = gateStatesResult(c, set, c.clauses[0], gateArgsAt(c.clauses[0]), sec, word)
  return why !== null ? why : "PASS"
}

/** A page break as an RFC's text holds it: a `[Page N]` footer, `\f`, the next page's header. */
const blocksTestBreak = (): string =>
  [
    "",
    "Author                        Informational                     [Page 1]",
    "\f",
    "RFC 9999                      Example Spec                     May 2020",
    "",
  ].join("\n")

/** Each block of a spec's own XML text ends the sentence before it; a paragraph's lines do not. */
const blocksTestXmlRows = (t: Suite): void => {
  const rows: string[][] = [
    [
      "the citation in one blockquote does not run into the next",
      "<blockquote><t>As Section 3.1 of [RFC4648] puts it</t></blockquote><blockquote><t>The encoder MUST pad.</t></blockquote>",
      "MUST",
      "The encoder MUST pad.",
    ],
    [
      "a requirement after a code block",
      "<sourcecode>const x = 1</sourcecode><t>It MUST hold.</t>",
      "MUST",
      "It MUST hold.",
    ],
    [
      "a requirement before a code block, with no period",
      "<t>It MUST hold</t><sourcecode>// P-X covers R-X</sourcecode>",
      "MUST",
      "It MUST hold",
    ],
    [
      "a property between two requirements: the later one",
      "<t>A MUST be</t><sourcecode>// P-X covers R-A</sourcecode><t>B MUST NOT be.</t>",
      "B MUST",
      "B MUST NOT be.",
    ],
    [
      "a property between two requirements: the earlier one",
      "<t>A MUST be</t><sourcecode>// P-X covers R-A</sourcecode><t>B MUST NOT be.</t>",
      "A MUST",
      "A MUST be",
    ],
    [
      "a property between two requirements: the property",
      "<t>A MUST be</t><sourcecode>// P-X covers R-A</sourcecode><t>B MUST NOT be.</t>",
      "covers",
      "// P-X covers R-A",
    ],
    ["an artwork before a requirement", "<artwork>+--+ box</artwork><t>C MUST go.</t>", "MUST", "C MUST go."],
    ["an artwork after a requirement", "<t>C MUST go</t><artwork>+--+ box</artwork>", "MUST", "C MUST go"],
    [
      "a table cell before the next",
      "<table><tbody><tr><td>MUST pad</td><td>no padding</td></tr></tbody></table>",
      "MUST",
      "MUST pad",
    ],
    [
      "a table cell after the one before",
      "<table><tbody><tr><td>no padding</td><td>MUST pad</td></tr></tbody></table>",
      "MUST",
      "MUST pad",
    ],
    ["a two-line paragraph is one sentence", "<t>It MUST\n   hold here.</t>", "MUST", "It MUST hold here."],
    ["a paragraph with no period before another", "<t>It MUST hold</t><t>Then more.</t>", "MUST", "It MUST hold"],
    ["two sentences of one paragraph", "<t>One. It MUST hold.</t>", "MUST", "It MUST hold."],
  ]
  for (const row of rows) {
    t.eqStr(row[0], blocksTestXml(row[1], row[2]), row[3])
  }
}

/**
 * An RFC's text through rfcParse reads as it did before XML blocks were
 * bounded: the blank lines around a page's footer and header end a
 * paragraph, so a sentence that runs across a page break reads as two.
 */
const blocksTestRfcRows = (t: Suite): void => {
  const across = `   Implementations MUST reject\n${blocksTestBreak()}\n   a short key.\n`
  t.eqStr(
    "a sentence on each side of a page break reads as two, as before",
    blocksTestRfc(across, "MUST"),
    "Implementations MUST reject",
  )
  const split = `   Implementations MUST reject\n   a short key.\n${blocksTestBreak()}\n   Implementations SHOULD log it.\n`
  t.eqStr("its other side", blocksTestRfc(across, "short"), "a short key.")
  t.eqStr("the block before a page break", blocksTestRfc(split, "MUST"), "Implementations MUST reject a short key.")
  t.eqStr("the block after a page break", blocksTestRfc(split, "SHOULD"), "Implementations SHOULD log it.")
  const unstopped = `   Implementations MUST reject\n${blocksTestBreak()}\n   It SHOULD log.\n`
  t.eqStr("a page break ends the paragraph before it, as before", blocksTestRfc(unstopped, "SHOULD"), "It SHOULD log.")
  const blank = "   Implementations MUST reject\n\n   It SHOULD log.\n"
  t.eqStr("a blank line ends a paragraph", blocksTestRfc(blank, "MUST"), "Implementations MUST reject")
}

/**
 * An XML table's cells that each hold only a printed word stay one block of
 * words, while a cell of prose still ends the block and the sentence.
 */
const blocksTestWordRows = (t: Suite): void => {
  const one = "<td>00000001</td><td>00000002</td><td>00000003</td><td>00000004</td>"
  const rows: string[][] = [
    ["an N-word vector over one table row", `<table><tbody><tr>${one}</tr></tbody></table>`, "4"],
    [
      "an N-word vector over several table rows",
      "<table><tbody><tr><td>00000001</td><td>00000002</td></tr><tr><td>00000003</td><td>00000004</td></tr></tbody></table>",
      "4",
    ],
    [
      "0x words, one to a cell",
      "<table><tbody><tr><td>0x0001</td><td>0x0002</td><td>0x0003</td></tr></tbody></table>",
      "3",
    ],
    [
      "a cell of prose between two words",
      "<table><tbody><tr><td>00000001</td><td>MUST pad</td><td>00000002</td></tr></tbody></table>",
      "1,1",
    ],
    ["a table after a paragraph", `<t>The words:</t><table><tbody><tr>${one}</tr></tbody></table>`, "4"],
  ]
  for (const row of rows) {
    t.eqStr(row[0], blocksTestWords(blocksTestXmlDoc(row[1])), row[2])
  }
  t.eqStr(
    "a word in a cell does not join the sentence of the next",
    blocksTestXml("<table><tbody><tr><td>00000001</td><td>It MUST pad</td></tr></tbody></table>", "MUST"),
    "It MUST pad",
  )
  t.eqStr(
    "nor of the one before",
    blocksTestXml("<table><tbody><tr><td>It MUST pad</td><td>00000001</td></tr></tbody></table>", "MUST"),
    "It MUST pad",
  )
  const rfc = "   00000001 00000002\n   00000003 00000004\n"
  t.eqStr("RFC text's block of words, as before", blocksTestWords(blocksTestRfcDoc(rfc)), "4")
}

/**
 * The result read after an unterminated statement: RFC text reads on into
 * the next paragraph, across a page break too, as before; a spec's own XML
 * does not read a code block or artwork as prose.
 */
const blocksTestResultRows = (t: Suite): void => {
  const brk = blocksTestBreak()
  const alt = 'R1 offers an alternative right after "true" ("or")'
  const past = 'R1 continues past "true" ("true values")'
  const hedge = 'R1 hedges "true" after stating it ("usual'
  const rows: string[][] = [
    ["RFC text: an alternative in the next paragraph", "rfc", "   It MUST return true\n\n   or throw.\n", alt],
    ["RFC text: an alternative after a page break", "rfc", `   It MUST return true\n${brk}\n   or throw.\n`, alt],
    [
      "RFC text: a phrase that continues in the next paragraph",
      "rfc",
      "   It MUST return true\n\n   values are kept.\n",
      past,
    ],
    [
      "RFC text: a phrase that continues after a page break",
      "rfc",
      `   It MUST return true\n${brk}\n   values are kept.\n`,
      past,
    ],
    ["RFC text: a hedge", "rfc", "   It MUST return true, usually.\n", hedge],
    ["RFC text: stated", "rfc", "   It MUST return true.\n\n   or throw.\n", "PASS"],
    ["XML: an alternative in the next paragraph", "xml", "<t>It MUST return true</t><t>or throw.</t>", alt],
    [
      "XML: a phrase that continues in the next paragraph",
      "xml",
      "<t>It MUST return true</t><t>values are kept.</t>",
      past,
    ],
    ["XML: a hedge", "xml", "<t>It MUST return true, usually.</t>", hedge],
    [
      "XML: an alternative in a code block after it",
      "xml",
      "<t>It MUST return true</t><sourcecode>or throw</sourcecode>",
      "PASS",
    ],
    [
      "XML: a phrase in an artwork after it",
      "xml",
      "<t>It MUST return true</t><artwork>values are kept</artwork>",
      "PASS",
    ],
    [
      "XML: a hedge in a code block after it",
      "xml",
      "<t>It MUST return true</t><sourcecode>usually</sourcecode>",
      "PASS",
    ],
    [
      "XML: an alternative after the code block",
      "xml",
      "<t>It MUST return true</t><sourcecode>x = 1</sourcecode><t>or throw.</t>",
      alt,
    ],
  ]
  for (const row of rows) {
    const doc = row[1] === "rfc" ? blocksTestRfcDoc(row[2]) : blocksTestXmlDoc(row[2])
    const got = blocksTestResult(doc, "It MUST return true", "true")
    t.ok(`${row[0]}: ${got}`, row[3] === "PASS" ? got === "PASS" : got.indexOf(row[3]) >= 0)
  }
}

/** A sentence vector reads from a spec's text spans no block boundary of its own XML. */
export const main = (): i32 => {
  const t = new Suite("spec/gates/blocks")
  blocksTestXmlRows(t)
  blocksTestRfcRows(t)
  blocksTestWordRows(t)
  blocksTestResultRows(t)
  return t.done()
}
