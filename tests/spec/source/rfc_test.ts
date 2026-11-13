import { Suite } from "nish/testing"
import { charsFromCodePoint } from "../../../src/spec/contract/chars"
import {
  HexValue,
  RfcDocument,
  RfcSection,
  rfcHexPrinted,
  rfcHexValues,
  rfcNormalize,
  rfcOwnSpans,
  rfcParse,
  rfcQuoteIn,
  rfcQuoteProblem,
  rfcRead,
  rfcSection,
  rfcSectionText,
} from "../../../src/spec/source/rfc"

/** A small RFC: a title page, page furniture, numbered sections, an appendix and hex in each shape. */
const rfcTestText = (): string =>
  [
    "Internet Engineering Task Force (IETF)                           A. Author",
    "Request for Comments: 9999                                    Example Inc.",
    "Category: Informational                                         May 2020",
    "",
    "Table of Contents",
    "",
    "   1.  Introduction  . . . . . . . . . . . . . . . . . . . . . . 2",
    "",
    "1.  Introduction",
    "",
    "   Implementations MUST reject",
    "   a short key.",
    "",
    "Author                        Informational                     [Page 1]",
    "\f",
    "RFC 9999                      Example Spec                     May 2020",
    "",
    "   Implementations SHOULD log",
    "   it.",
    "",
    "2.  Test Vectors",
    "",
    "   Key = 0b0b0b0b (4 octets)",
    "   Data:",
    "   4869 2054",
    "",
    "   6865 7265",
    "   Input scalar as a number (base 10):",
    "   31029842492115040904895560451863089656",
    "   1234",
    "   Tag is 0xdeadBEEF here.",
    "",
    "2.1.  Colons",
    "",
    "   Ciphertext:",
    "   1a:e1:0b:",
    "   ff:00",
    "",
    "   000  65 6d 65 6e  emen",
    "   004  74 73        ts",
    "",
    "Appendix A.  Extra",
    "",
    "A.1.  More",
    "",
    "   The end.",
    "",
  ].join("\n")

/** The hex values of a section, as "label=hex" joined by spaces. */
const rfcTestValues = (sec: RfcSection): string =>
  rfcHexValues(sec)
    .map((v: HexValue): string => `${v.label ?? "-"}=${v.hex}`)
    .join(" ")

/** Offsets, comma-separated. */
const rfcTestSpans = (spans: i32[]): string => spans.map((n: i32): string => `${n}`).join(",")

/** The section `id` of `doc`; fails the run when it is missing. */
const rfcTestSection = (doc: RfcDocument, id: string): RfcSection => {
  const s = rfcSection(doc, id)
  if (s === null) {
    return new RfcSection(id, "missing", [], [])
  }
  return s
}

/** The values of a one-section RFC whose only value is bare digits under `label`. */
const rfcTestLabelled = (label: string): string => {
  const text = `Request for Comments: 1\n\f\n1.  Intro\n\n   ${label}:\n   1234\n`
  return rfcTestValues(rfcTestSection(rfcParse(text), "1"))
}

/** Reading an RFC's text: sections, page furniture, quotes and printed hex. */
export const main = (): i32 => {
  const t = new Suite("spec/source rfc")
  const doc = rfcParse(rfcTestText())
  t.ok("number", doc.number === 9999)
  t.eqStr(
    "section ids, the indented contents left out",
    doc.sections.map((s: RfcSection): string => s.id).join(" "),
    "1 2 2.1 A A.1",
  )
  t.eqStr("title", rfcTestSection(doc, "2.1").title, "Colons")
  t.eqStr("appendix title", rfcTestSection(doc, "A").title, "Extra")
  t.ok("no section", rfcSection(doc, "3") === null)

  const intro = rfcTestSection(doc, "1")
  t.eqStr(
    "page furniture is dropped",
    rfcSectionText(intro),
    "1. Introduction Implementations MUST reject a short key. Implementations SHOULD log it.",
  )
  t.ok("a quote across lines", rfcQuoteIn(intro, "MUST reject a short\n  key."))
  t.ok("a quote across a page break", rfcQuoteIn(intro, "a short key. Implementations SHOULD log it."))
  t.ok("not a quote", !rfcQuoteIn(intro, "MUST accept"))
  t.ok("the empty quote is not in it", !rfcQuoteIn(intro, "  "))
  t.ok("a section holds its subsections", rfcQuoteIn(rfcTestSection(doc, "2"), "Ciphertext:"))
  t.eqStr("own spans leave subsections out", rfcTestSpans(rfcOwnSpans(rfcTestSection(doc, "2"), "Ciphertext")), "")
  t.eqStr("own spans", rfcTestSpans(rfcOwnSpans(intro, "Implementations")), "16,31,57,72")
  t.eqStr("normalize", rfcNormalize("  a \n\t b  "), "a b")

  // Quotes, with the reasons one is not confirmed.
  t.ok("a quote confirmed", rfcQuoteProblem(doc, "1", "MUST reject a short key.") === null)
  t.eqStr("no such section", rfcQuoteProblem(doc, "9", "x") ?? "", "RFC 9999 has no section 9")
  t.eqStr("not said", rfcQuoteProblem(doc, "1", "MUST  accept") ?? "", 'RFC 9999 section 1 does not say "MUST accept"')
  t.eqStr("empty", rfcQuoteProblem(doc, "1", " ") ?? "", "the quote is empty")
  t.eqStr(
    "a quote hiding a character",
    rfcQuoteProblem(doc, "1", `MU${charsFromCodePoint(0x200b)}ST reject`) ?? "",
    "the quote holds text a reader cannot see as the gates read it: line 1: invisible character U+200B: remove it",
  )
  const spoof = `MUS${charsFromCodePoint(0x422)}`
  t.eqStr(
    "a quote spoofing a keyword",
    rfcQuoteProblem(doc, "1", `${spoof} reject`) ?? "",
    `the quote holds text a reader cannot see as the gates read it: line 1: "${spoof}" reads as MUST but is not spelled in ASCII: write MUST`,
  )

  // Hex.
  t.eqStr(
    "values of 2: labelled, a run across a blank line, the decimal dropped, 0x",
    rfcTestValues(rfcTestSection(doc, "2")),
    "Key=0b0b0b0b Data=4869205468657265 Tag is=deadbeef Ciphertext=1ae10bff00 -=656d656e7473",
  )
  t.eqStr(
    "values of 2.1: a colon run across lines, a hexdump",
    rfcTestValues(rfcTestSection(doc, "2.1")),
    "Ciphertext=1ae10bff00 -=656d656e7473",
  )
  const two = rfcTestSection(doc, "2")
  t.ok("printed", rfcHexPrinted(two, "0b0b") && rfcHexPrinted(two, "6920") && rfcHexPrinted(two, "DEADbeef"))
  t.ok("not byte-aligned", !rfcHexPrinted(two, "b0b0"))
  t.ok("the decimal is not hex", !rfcHexPrinted(two, "3102984249"))
  t.ok("the empty value", rfcHexPrinted(two, ""))
  t.ok("printed in a subsection", rfcHexPrinted(two, "e10bff") && rfcHexPrinted(two, "6d656e74"))

  // Which labels call bare digits a decimal number: whole words only.
  t.eqStr("(base-10) is decimal", rfcTestLabelled("Value (base-10)"), "")
  t.eqStr("base10 is decimal", rfcTestLabelled("Value base10"), "")
  t.eqStr("Integer is decimal", rfcTestLabelled("Integer"), "")
  t.eqStr("Numbered is not decimal", rfcTestLabelled("Numbered"), "Numbered=1234")
  t.eqStr("integers is not decimal", rfcTestLabelled("Some integers"), "Some integers=1234")
  t.eqStr("base 100 is not decimal", rfcTestLabelled("In base 100"), "In base 100=1234")

  // Reading refuses what is not an RFC, and what hides text.
  t.ok("an RFC reads", rfcRead(rfcTestText(), "r.txt").isOk())
  const noHeader = rfcRead("1.  Intro\n\f\n", "r.txt")
  t.eqStr(
    "no header",
    noHeader.isErr() ? noHeader.error : "",
    'r.txt: not an RFC\'s plain text: it needs a "Request for Comments: N" header and the form feeds of its page breaks',
  )
  t.ok("no form feed", rfcRead("Request for Comments: 1\n1.  Intro\n", "r.txt").isErr())
  const hidden = rfcRead(`${rfcTestText()}\nIt MU${charsFromCodePoint(0x200d)}ST.\n`, "r.txt")
  t.eqStr(
    "hidden text",
    hidden.isErr() ? hidden.error : "",
    "r.txt: text a reader cannot see as the gates read it: line 48: invisible character U+200D: remove it",
  )
  const many: string[] = []
  for (let i = 0; i < 7; i++) {
    many.push(charsFromCodePoint(0x200b))
  }
  const lots = rfcRead(`${rfcTestText()}${many.join("")}`, "r.txt")
  t.ok("at most five, then a count", lots.isErr() && lots.error.endsWith("remove it (and 2 more)"))
  return t.done()
}
