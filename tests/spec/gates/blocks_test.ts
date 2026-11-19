import { Suite } from "nish/testing"
import { gateParagraphStarts, gateSentenceAt } from "../../../src/spec/gates/text"
import { RfcSection, rfcNormalize, rfcParse, rfcSection } from "../../../src/spec/source/rfc"
import { xmlDocParse } from "../../../src/spec/xml/doc"

/** The sentence around the first `needle` in a section's own text, as completeness reads it. */
const blocksTestSentence = (sec: RfcSection, needle: string): string => {
  const text = rfcNormalize(sec.ownLines.join("\n"))
  const at = text.indexOf(needle)
  if (at < 0) {
    return `<no ${needle}>`
  }
  return gateSentenceAt(text, gateParagraphStarts(sec.ownLines), at)
}

/** The sentence around `needle` in a one-section XML document whose body is `body`. */
const blocksTestXml = (body: string, needle: string): string => {
  const r = xmlDocParse(`<rfc><middle><section><name>S</name>${body}</section></middle></rfc>`)
  if (r.isErr()) {
    return `<error ${r.error.message}>`
  }
  if (r.value.sections.length !== 1) {
    return `<${r.value.sections.length} sections>`
  }
  return blocksTestSentence(r.value.sections[0], needle)
}

/** The sentence around `needle` in section 1 of an RFC's text, through rfcParse. */
const blocksTestRfc = (body: string, needle: string): string => {
  const head = [
    "Internet Engineering Task Force (IETF)                           A. Author",
    "Request for Comments: 9999                                    Example Inc.",
    "Category: Informational                                         May 2020",
    "",
    "1.  Introduction",
    "",
  ]
  const sec = rfcSection(rfcParse(`${head.join("\n")}\n${body}`), "1")
  return sec === null ? "<no section 1>" : blocksTestSentence(sec, needle)
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

/** A sentence vector reads from a spec's text spans no block boundary of its own XML. */
export const main = (): i32 => {
  const t = new Suite("spec/gates/blocks")
  blocksTestXmlRows(t)
  blocksTestRfcRows(t)
  return t.done()
}
