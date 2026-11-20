import { Suite } from "nish/testing"
import { replaceAll } from "nish/text"
import { charsFromCodePoint } from "../../../src/spec/contract/chars"
import {
  HexValue,
  RfcDocument,
  RfcSection,
  rfcCaseSection,
  rfcHasCases,
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
  rfcUnvaluedLabels,
  rfcUnvaluedLines,
  rfcWithHeading,
  rfcWithHeadings,
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

/** The values of a one-section RFC whose body is `body`, three-space indented. */
const rfcTestBody = (body: string): string => {
  const text = `Request for Comments: 1\n\f\n1.  Intro\n\n   ${body}\n`
  return rfcTestValues(rfcTestSection(rfcParse(text), "1"))
}

/**
 * The lines each value of a one-section RFC whose body is `body` is named on:
 * `label@line-end`, where `end` is the line its name closes on, space-separated.
 */
const rfcTestEnds = (body: string): string => {
  const text = `Request for Comments: 1\n\f\n1.  Intro\n\n   ${body}\n`
  return rfcHexValues(rfcTestSection(rfcParse(text), "1"))
    .map((v: HexValue): string => `${v.label ?? "-"}@${v.line}-${v.end}`)
    .join(" ")
}

/** The labels printed with no value below them in a one-section RFC whose body is `body`, joined by `|`. */
const rfcTestUnvalued = (body: string): string => {
  const text = `Request for Comments: 1\n\f\n1.  Intro\n\n   ${body}\n`
  return rfcUnvaluedLabels(rfcTestSection(rfcParse(text), "1")).join("|")
}

/** An RFC whose sections split into test cases: in both heading shapes, across a page break, duplicated, and under a subsection. */
const rfcTestCasesText = (): string =>
  [
    "Request for Comments: 8888",
    "",
    "1.  Cases",
    "",
    "   The test vector #2 below has a longer key.",
    "   Key:",
    "   0101",
    "",
    "   Test Vector #1:",
    "   ==============",
    "",
    "   Key:",
    "   0a0a",
    "",
    "  Test Vector #2: a longer key",
    "",
    "   Key:",
    "   0b0b",
    "",
    "Author                        Informational                     [Page 1]",
    "\f",
    "RFC 8888                      Example Spec                     May 2020",
    "",
    "   Tag:",
    "   0c0c",
    "",
    "   Test Vector #10:",
    "   Key:",
    "   0d0d",
    "",
    "   Test Vector #02:",
    "   Key:",
    "   0e0e",
    "",
    "   Test Vector #9:",
    "   Key:",
    "   0f0f",
    "",
    "   Test Vector #1234567:",
    "   Key:",
    "   1010",
    "",
    "2.  Twice",
    "",
    "   Test Vector #1:",
    "   Key:",
    "   1111",
    "   Test Vector #1:",
    "   Key:",
    "   2222",
    "",
    "3.  Parent",
    "",
    "   Test Vector #1:",
    "   Key:",
    "   3333",
    "",
    "3.1.  Child",
    "",
    "   Test Vector #1:",
    "   Key:",
    "   4444",
    "",
    "4.  Plain",
    "",
    "   Test Vector: none of these heads a case.",
    "   Test Vector #: nor this,",
    "   Test Vector #",
    "   Test Vector #3 nor this.",
    "   See Test Vector #1: inside prose.",
    "",
  ].join("\n")

/** The values of case `n` of section `id` in rfcTestCasesText, or the reason it has none. */
const rfcTestCase = (id: string, n: i32): string => {
  const r = rfcCaseSection(rfcTestSection(rfcParse(rfcTestCasesText()), id), n)
  return r.isErr() ? `error: ${r.error}` : rfcTestValues(r.value)
}

/** Where page furniture was removed from case `n` of section 1 in rfcTestCasesText, as `at:line|`. */
const rfcTestCaseBreaks = (n: i32): string => {
  const r = rfcCaseSection(rfcTestSection(rfcParse(rfcTestCasesText()), "1"), n)
  if (r.isErr()) {
    return r.error
  }
  const sec = r.value
  return sec.pageBreaks.map((b: i32): string => `${b}:${sec.lines[b]}|`).join("")
}

/**
 * Where each value and each unvalued label of a one-section RFC whose body is
 * `body` is printed: `label@line` for values, then `!label@line` for the
 * unvalued, space-separated.
 */
const rfcTestLines = (body: string): string => {
  const text = `Request for Comments: 1\n\f\n1.  Intro\n\n   ${body}\n`
  const sec = rfcTestSection(rfcParse(text), "1")
  const out: string[] = []
  for (const v of rfcHexValues(sec)) {
    out.push(`${v.label ?? "-"}@${v.line}`)
  }
  const names = rfcUnvaluedLabels(sec)
  const lines = rfcUnvaluedLines(sec)
  for (let i = 0; i < names.length; i++) {
    out.push(`!${names[i]}@${lines[i]}`)
  }
  return out.join(" ")
}

/** A footer, form feed and header: the page furniture `rfcParse` drops. */
const rfcTestBreak = (page: i32): string =>
  [
    "",
    `Thomson & Turner             Standards Track                  [Page ${page}]`,
    "\f",
    "RFC 9001                Using TLS to Secure QUIC                May 2021",
    "",
  ].join("\n")

/**
 * RFC 9001 Appendix A.1 as printed: values on `= hex` lines under a
 * statement, one split across a page break, and a break between the client
 * and server blocks. Then two made-up statements, cut by a page break before
 * their `= hex` and `= f(...)` lines, one with that call wrapped.
 */
const rfcTestQuicText = (): string =>
  [
    "Request for Comments: 9001",
    "\f",
    "A.1.  Keys",
    "",
    "   quic key:  00100e746c7331332071756963206b657900",
    "",
    "   initial_secret = HKDF-Extract(initial_salt, cid)",
    "       = 7db5df06e7a69e432496adedb0085192",
    "         3595221596ae2ae9fb8115c1e9ed0a44",
    "",
    "   client_initial_secret",
    '       = HKDF-Expand-Label(initial_secret, "client in", "", 32)',
    "       = c00cf151ca5be075ed0ebfb5c80323c4",
    rfcTestBreak(47),
    "         2d6b7db67881289af4008f1f6c357aea",
    "",
    '   key = HKDF-Expand-Label(client_initial_secret, "quic key", "", 16)',
    "       = 1f369613dd76d5467730efcbe3b1a22d",
    "",
    '   iv  = HKDF-Expand-Label(client_initial_secret, "quic iv", "", 12)',
    "       = fa044b2f42a3fd3b46fb255c",
    rfcTestBreak(48),
    "   The secrets for protecting server packets are:",
    "",
    "   server_initial_secret",
    '       = HKDF-Expand-Label(initial_secret, "server in", "", 32)',
    "       = 3c199828fd139efd216c155ad844cc81",
    "         fb82fa8d7446fa7d78be803acdda951b",
    "",
    '   key = HKDF-Expand-Label(server_initial_secret, "quic key", "", 16)',
    "       = cf3a5331653c364c88f0f379b6067e37",
    "",
    '   iv  = HKDF-Expand-Label(server_initial_secret, "quic iv", "", 12)',
    "       = 0ac1493ca1905853b0bba03e",
    "",
    '   hp  = HKDF-Expand-Label(server_initial_secret, "quic hp", "", 16)',
    rfcTestBreak(49),
    "       = c206b8d9b9f0f37644430b490eeaa314",
    "",
    "   client_hp",
    rfcTestBreak(50),
    "       = HKDF-Expand-Label(initial_secret,",
    '                           "quic hp", "", 16)',
    "       = 9f50449e04a0e810283a1e9933adedd2",
    "",
  ].join("\n")

/**
 * RFC 7914 sections 11 and 12 as printed: call labels wrapped over two lines,
 * one split by a page break, and two blocks split only by one.
 */
const rfcTestScryptText = (): string =>
  [
    "Request for Comments: 7914",
    "\f",
    "11.  Test Vectors for PBKDF2 with HMAC-SHA-256",
    "",
    '   PBKDF2-HMAC-SHA-256 (P="passwd", S="salt",',
    "                       c=1, dkLen=64) =",
    "   55 ac 04 6e 56 e3 08 9f ec 16 91 c2 25 44 b6 05",
    rfcTestBreak(11),
    '   PBKDF2-HMAC-SHA-256 (P="Password", S="NaCl",',
    rfcTestBreak(12),
    "                        c=80000, dkLen=64) =",
    "   4d dc d8 f6 0b 98 be 21 83 0c ee 5e f2 27 01 f9",
    "",
    "12.  Test Vectors for scrypt",
    "",
    '   scrypt (P="", S="",',
    "           N=16, r=1, p=1, dklen=64) =",
    "   77 d6 57 62 38 65 7b 20 3b 19 ca 42 c1 8a 04 97",
    "",
    '   scrypt (P="password", S="NaCl",',
    "           N=1024, r=8, p=16, dkLen=64) =",
    "   fd ba be 1c 9d 34 72 00 78 56 e7 19 0d 01 e9 fe",
    "",
  ].join("\n")

/** The values of section `id` of `text`, each as `label@line=hex`. */
const rfcTestWrapped = (text: string, id: string): string[] =>
  rfcHexValues(rfcTestSection(rfcParse(text), id)).map((v: HexValue): string => `${v.label ?? "-"}@${v.line}=${v.hex}`)

/** Lines of an RFC as xml2rfc v3 writes its plain text (rfc9000.txt): a byte-order mark, no form feed, no page furniture. */
const rfcTestV3Lines = (): string[] => [
  `${charsFromCodePoint(0xfeff)}`,
  "",
  "",
  "",
  "Internet Engineering Task Force (IETF)                   J. Iyengar, Ed.",
  "Request for Comments: 9000                                        Fastly",
  "Category: Standards Track                                M. Thomson, Ed.",
  "ISSN: 2070-1721                                                  Mozilla",
  "                                                                May 2021",
  "",
  "",
  "           QUIC: A UDP-Based Multiplexed and Secure Transport",
  "",
  "Table of Contents",
  "",
  "   1.  Overview",
  "     1.1.  Document Structure",
  "",
  "1.  Overview",
  "",
  "   Endpoints MUST be able to deliver stream data to an application as",
  "   an ordered byte stream.",
  "",
  "1.1.  Document Structure",
  "",
  "   This document describes the core QUIC protocol.",
  "",
]

/** RFC 9000's shape as xml2rfc v3 writes it. */
const rfcTestV3Text = (): string => rfcTestV3Lines().join("\n")

/** rfcTestV3Text with `line` inserted before line index `at`. */
const rfcTestV3With = (at: i32, line: string): string => {
  const lines = rfcTestV3Lines()
  const out = lines.slice(0, at)
  out.push(line)
  for (const l of lines.slice(at, lines.length)) {
    out.push(l)
  }
  return out.join("\n")
}

/** A paginated RFC with a value split by a page break, and two blocks split only by one. */
const rfcTestPagedText = (): string =>
  [
    "Request for Comments: 7777                                    Example Inc.",
    "",
    "1.  Split",
    "",
    "   Key:",
    "   0a0b",
    "Author                        Informational                     [Page 1]",
    "\f",
    "RFC 7777                      Example Spec                     May 2020",
    "   0c0d",
    "",
    "2.  Blocks",
    "",
    "   Key:",
    "   1111",
    "Author                        Informational                     [Page 2]",
    "\f",
    "RFC 7777                      Example Spec                     May 2020",
    "   Tag:",
    "   2222",
    "",
  ].join("\n")

/** rfcRead's refusal of unpaginated text whose line `n` is page furniture. */
const rfcTestFurniture = (n: i32): string =>
  `r.txt: not an RFC's plain text: line ${n} is page furniture (a "[Page N]" footer or a running "RFC N" header), but the text has no form feeds, so its page breaks cannot be placed`

/** What rfcRead makes of `text`: "RFC N, S sections", or its refusal. */
const rfcTestRead = (text: string): string => {
  const r = rfcRead(text, "r.txt")
  return r.isOk() ? `RFC ${r.value.number}, ${r.value.sections.length} sections` : r.error
}

/** rfcRead's cases, paginated and unpaginated: a name, a text, and what rfcTestRead makes of it. */
const rfcTestReadCases = (): string[][] => {
  const refused = "r.txt: not an RFC's plain text: "
  const footer = "Iyengar & Thomson            Standards Track                    [Page 1]"
  const running = "RFC 9000                 QUIC Transport Protocol                May 2021"
  return [
    ["paginated, with footers and running headers", rfcTestText(), "RFC 9999, 5 sections"],
    ["paginated, no header", "1.  Intro\n\f\n", `${refused}it has no "Request for Comments: N" header`],
    ["unpaginated, shaped like rfc9000.txt", rfcTestV3Text(), "RFC 9000, 2 sections"],
    ["unpaginated, CRLF line ends", replaceAll(rfcTestV3Text(), "\n", "\r\n"), "RFC 9000, 2 sections"],
    ["unpaginated, header first", "Request for Comments: 1\n1.  Intro\n", "RFC 1, 1 sections"],
    ["unpaginated, no header", "1.  Intro\n\n   Text.\n", `${refused}it has no "Request for Comments: N" header`],
    [
      "unpaginated, the header only mid-line",
      "   See Request for Comments: 1\n1.  Intro\n",
      `${refused}it has no "Request for Comments: N" header`,
    ],
    [
      "unpaginated, a mid-line mention before the header",
      "   See Request for Comments: 1234\nRequest for Comments: 9000\n1.  Intro\n",
      "RFC 9000, 1 sections",
    ],
    [
      "unpaginated, a header without a number",
      "Request for Comments: none\n1.  Intro\n",
      `${refused}it has no "Request for Comments: N" header`,
    ],
    [
      "unpaginated, the header after the first heading",
      "1.  Intro\n\nRequest for Comments: 1\n",
      `${refused}its "Request for Comments: N" header is on line 3, after its first section heading on line 1: text without form feeds must give it in its front matter`,
    ],
    ["unpaginated, a [Page N] footer", rfcTestV3With(22, footer), rfcTestFurniture(23)],
    ["unpaginated, a running header", rfcTestV3With(23, running), rfcTestFurniture(24)],
    ["unpaginated, a footer before the header", rfcTestV3With(0, footer), rfcTestFurniture(1)],
  ]
}

/** The case headings rfcWithHeading reads, and the lines it does not. Each row is a line and the words wanted. */
const rfcTestWithRows = (t: Suite): void => {
  const rows: string[][] = [
    ['   With SHA-256, message = "sample":', "SHA-256"],
    ['With SHA-1, message = "test":', "SHA-1"],
    ['   With SHA-256, message = "sample"', ""],
    ['   With SHA-256, message = "sam"ple":', ""],
    ['   With SHA-256, the message = "sample":', ""],
    ['   With SHA-256 message = "sample":', ""],
    ['   With, message = "sample":', ""],
    ['   With SHA-256, message "sample":', ""],
    ['   with SHA-256, message = "sample":', ""],
    ["   With this key, the signer computes:", ""],
  ]
  for (const r of rows) {
    t.eqStr(`rfcWithHeading ${r[0]}`, rfcWithHeading(r[0]), r[1])
  }
}

/** Case headings in RFC 6979's layout, one on each side of a page break, then a section without. */
const rfcTestHeadingsText = (): string =>
  [
    "Request for Comments: 6979",
    "\f",
    "A.1.  Cases",
    "",
    '   With SHA-1, message = "sample":',
    "   k = 01",
    '   With SHA-256, message = "sample":',
    "   k = 02",
    rfcTestBreak(41),
    '   With SHA-1, message = "test":',
    "   k = 03",
    "",
    "A.2.  None",
    "",
    "   k = 04",
    "",
  ].join("\n")

/** rfcWithHeadings: the heading lines of a section, across a page break, and none where there are none. */
const rfcTestHeadings = (t: Suite): void => {
  rfcTestWithRows(t)
  const doc = rfcParse(rfcTestHeadingsText())
  const sec = rfcTestSection(doc, "A.1")
  t.eqStr(
    "rfcWithHeadings: each heading, on each side of the page break",
    rfcWithHeadings(sec)
      .map((h: i32): string => rfcWithHeading(sec.lines[h]))
      .join(" "),
    "SHA-1 SHA-256 SHA-1",
  )
  t.eqStr("rfcWithHeadings: none in a section without", `${rfcWithHeadings(rfcTestSection(doc, "A.2")).length}`, "0")
}

/** Reading an RFC's text: sections, page furniture, quotes and printed hex. */
export const main = (): i32 => {
  const t = new Suite("spec/source rfc")
  rfcTestHeadings(t)
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
  t.eqStr("test_number is not decimal", rfcTestLabelled("test_number"), "test_number=1234")
  t.eqStr("number_ is not decimal", rfcTestLabelled("Some number_"), "Some number_=1234")

  // Labelled values whose label starts with a digit (#71).
  t.eqStr(
    "a label that starts with a digit names the value below it",
    rfcTestBody("32-bit fixed-common part:\n   07 00 00 00"),
    "32-bit fixed-common part=07000000",
  )
  t.eqStr("ending in =, too", rfcTestBody("32-bit =\n   07000000"), "32-bit=07000000")
  t.eqStr("a label of digits alone names it as well", rfcTestBody("32:\n   07 00 00 00"), "32=07000000")
  t.eqStr("inline, a digit-led label is not a labelled value", rfcTestBody("32-bit fixed-common part = 07000000"), "")
  t.eqStr("nor is a label of digits alone", rfcTestBody("32 = 07000000"), "")
  // RFC 8032 prints an empty message as a label with nothing below it.
  const ed = "SECRET KEY:\n   9d61\n\n   MESSAGE (length 0 bytes):\n\n   SIGNATURE:\n   e556"
  t.eqStr("a label with nothing below it is unvalued", rfcTestUnvalued(ed), "MESSAGE (length 0 bytes)")
  t.eqStr("and holds no value", rfcTestBody(ed), "SECRET KEY=9d61 SIGNATURE=e556")
  t.eqStr(
    "a last label with nothing below it",
    rfcTestUnvalued("K:\n   9d61\n\n   MESSAGE (length 0 bytes):"),
    "MESSAGE (length 0 bytes)",
  )
  t.eqStr(
    "a group label keeps its one-byte value",
    rfcTestBody("MESSAGE (length 1 byte):\n   72"),
    "MESSAGE (length 1 byte)=72",
  )
  t.eqStr("a valued label is not unvalued", rfcTestUnvalued("MESSAGE (length 1 byte):\n   72"), "")
  t.eqStr(
    "a label before an inline labelled value is unvalued",
    rfcTestUnvalued("MESSAGE (length 0 bytes):\n   SIGNATURE: e556"),
    "MESSAGE (length 0 bytes)",
  )
  t.eqStr(
    "and the inline value keeps its own label",
    rfcTestBody("MESSAGE (length 0 bytes):\n   SIGNATURE: e556"),
    "SIGNATURE=e556",
  )
  t.eqStr(
    "a label before a prefixed value is unvalued",
    rfcTestUnvalued("MESSAGE (length 0 bytes):\n   SIGNATURE = 0xe556"),
    "MESSAGE (length 0 bytes)",
  )
  // Where a value is printed: the line of the label that names it, else its first line.
  const where: string[][] = [
    ["a label above its value", "K:\n   9d61", "K@2"],
    ["a label on the value's line", "K = 0x9d61", "K@2"],
    ["an unnamed value", "9d61 9d61", "-@2"],
    ["a value over several lines", "K:\n   9d61\n   9d61\n   L:\n   e556", "K@2 L@5"],
    [
      "an unvalued label between two values",
      "SECRET KEY:\n   9d61\n\n   MESSAGE (length 0 bytes):\n\n   SIGNATURE:\n   e556",
      "SECRET KEY@2 SIGNATURE@7 !MESSAGE (length 0 bytes)@5",
    ],
    ["a last unvalued label", "K:\n   9d61\n   M:", "K@2 !M@4"],
  ]
  for (const w of where) {
    t.eqStr(`printed at: ${w[0]}`, rfcTestLines(w[1]), w[2])
  }
  t.eqStr("a letter-led inline label is", rfcTestBody("IV = 4041424344454647"), "IV=4041424344454647")

  // Test cases: a section split by `Test Vector #N:` headings.
  const cases = rfcParse(rfcTestCasesText())
  t.ok("a section with headings has cases", rfcHasCases(rfcTestSection(cases, "1")))
  t.ok("prose, a bare #, no colon and a heading mid-line head none", !rfcHasCases(rfcTestSection(cases, "4")))
  t.ok("a subsection has cases of its own", rfcHasCases(rfcTestSection(cases, "3.1")))
  t.eqStr("a heading alone, above a rule", rfcTestCase("1", 1), "Key=0a0a")
  t.eqStr("a heading with text, across a page break", rfcTestCase("1", 2), "Key=0b0b Tag=0c0c")
  t.eqStr("a heading with a leading zero heads no case, but ends the one above", rfcTestCase("1", 10), "Key=0d0d")
  t.eqStr("so does a heading with too many digits", rfcTestCase("1", 9), "Key=0f0f")
  t.eqStr("nor is either one part of another case", rfcTestCase("1", 2).indexOf("0e0e") < 0 ? "ok" : "in #2", "ok")
  t.eqStr(
    "no such case",
    rfcTestCase("1", 12),
    'error: has no "Test Vector #12:" heading, so it holds no Test Vector #12',
  )
  t.eqStr("case 0 is none", rfcTestCase("1", 0), "error: Test Vector #0 is not a test case: they are numbered from 1")
  t.eqStr(
    "a prose mention heads no case",
    rfcTestCase("4", 3),
    'error: has no "Test Vector #3:" heading, so it holds no Test Vector #3',
  )
  t.eqStr(
    "a duplicate heading",
    rfcTestCase("2", 1),
    'error: heads 2 test cases "Test Vector #1:", so which one is meant is unclear',
  )
  t.eqStr(
    "a section with subsections",
    rfcTestCase("3", 1),
    "error: has subsections, so Test Vector #1 is not one test case of it: cite the subsection that holds it",
  )
  t.eqStr("its subsection's case", rfcTestCase("3.1", 1), "Key=4444")
  const one = rfcCaseSection(rfcTestSection(cases, "1"), 1)
  t.ok("a case keeps the section's id and title", one.isOk() && one.value.id === "1" && one.value.title === "Cases")
  t.eqStr("a case keeps a page break inside it, counted from its heading", rfcTestCaseBreaks(2), "5:|6:|")
  t.eqStr("and none from outside it", rfcTestCaseBreaks(1), "")

  // Reading refuses what is not an RFC, and what hides text.
  t.ok("an RFC reads", rfcRead(rfcTestText(), "r.txt").isOk())
  for (const c of rfcTestReadCases()) {
    t.eqStr(c[0], rfcTestRead(c[1]), c[2])
  }
  // A paginated RFC still reads across its page breaks: a value on each side
  // of one is one value, and two blocks split only by one stay two.
  const paged = rfcRead(rfcTestPagedText(), "r.txt")
  t.eqStr(
    "a value split by a page break reads as one",
    paged.isOk() ? rfcTestValues(rfcTestSection(paged.value, "1")) : paged.error,
    "Key=0a0b0c0d",
  )
  t.eqStr(
    "two blocks split only by a page break stay two",
    paged.isOk() ? rfcTestValues(rfcTestSection(paged.value, "2")) : paged.error,
    "Key=1111 Tag=2222",
  )
  t.ok("the unpaginated text has no page break", rfcTestSection(rfcParse(rfcTestV3Text()), "1").pageBreaks.length === 0)
  const hidden = rfcRead(`${rfcTestText()}\nIt MU${charsFromCodePoint(0x200d)}ST.\n`, "r.txt")
  t.eqStr(
    "hidden text",
    hidden.isErr() ? hidden.error : "",
    "r.txt: text a reader cannot see as the gates read it: line 48: invisible character U+200D: remove it",
  )
  const quic = rfcTestWrapped(rfcTestQuicText(), "A.1")
  const quicCases: string[][] = [
    ["an inline label still reads", "quic key@2=00100e746c7331332071756963206b657900"],
    [
      "a statement names the = line below it",
      "initial_secret@4=7db5df06e7a69e432496adedb00851923595221596ae2ae9fb8115c1e9ed0a44",
    ],
    [
      "a name alone names it past an = f(...) line, and across a page break",
      "client_initial_secret@8=c00cf151ca5be075ed0ebfb5c80323c42d6b7db67881289af4008f1f6c357aea",
    ],
    ["key, before the break", "key@16=1f369613dd76d5467730efcbe3b1a22d"],
    ["iv, before the break", "iv@19=fa044b2f42a3fd3b46fb255c"],
    [
      "a block after the break",
      "server_initial_secret@26=3c199828fd139efd216c155ad844cc81fb82fa8d7446fa7d78be803acdda951b",
    ],
    ["key, printed again", "key@31=cf3a5331653c364c88f0f379b6067e37"],
    ["iv, printed again", "iv@34=0ac1493ca1905853b0bba03e"],
    ["a statement named across a page break from its value", "hp@37=c206b8d9b9f0f37644430b490eeaa314"],
    ["a name alone above a break, past a wrapped = f(...) line", "client_hp@43=9f50449e04a0e810283a1e9933adedd2"],
  ]
  t.eqStr("RFC 9001 A.1 prints ten values", `${quic.length}`, `${quicCases.length}`)
  for (let i = 0; i < quicCases.length; i++) {
    t.eqStr(quicCases[i][0], i < quic.length ? quic[i] : "", quicCases[i][1])
  }
  // A page break inside the wrapped `= f(` line: the call's second line is
  // on the next page, and the name above still holds.
  const broken = [
    "Request for Comments: 9001",
    "\f",
    "A.1.  Keys",
    "",
    "   client_initial_secret",
    '       = HKDF-Expand-Label(initial_secret, "client in",',
    rfcTestBreak(47),
    '                           "", 32)',
    "       = c00cf151ca5be075ed0ebfb5c80323c4",
    "",
    "   other = HKDF-Expand-Label(initial_secret,",
    rfcTestBreak(48),
    '                             "server in", "", 32)',
    "       = 3c199828fd139efd216c155ad844cc81",
    "",
  ].join("\n")
  t.eqStr(
    "a page break inside a wrapped = f( line keeps the name",
    rfcTestWrapped(broken, "A.1").join(" "),
    "client_initial_secret@2=c00cf151ca5be075ed0ebfb5c80323c4 other@10=3c199828fd139efd216c155ad844cc81",
  )
  const scrypt = rfcTestWrapped(rfcTestScryptText(), "11")
  const scryptCases: string[][] = [
    [
      "a call label wrapped over two lines is one",
      'PBKDF2-HMAC-SHA-256 (P="passwd", S="salt", c=1, dkLen=64)@2=55ac046e56e3089fec1691c22544b605',
    ],
    [
      "and so is one wrapped across a page break",
      'PBKDF2-HMAC-SHA-256 (P="Password", S="NaCl", c=80000, dkLen=64)@8=4ddcd8f60b98be21830cee5ef22701f9',
    ],
  ]
  t.eqStr("RFC 7914 section 11 prints two values", `${scrypt.length}`, `${scryptCases.length}`)
  for (let i = 0; i < scryptCases.length; i++) {
    t.eqStr(scryptCases[i][0], i < scrypt.length ? scrypt[i] : "", scryptCases[i][1])
  }
  t.eqStr(
    "scrypt's labels read the same way",
    rfcTestWrapped(rfcTestScryptText(), "12").join("|"),
    'scrypt (P="", S="", N=16, r=1, p=1, dklen=64)@2=77d6576238657b203b19ca42c18a0497|scrypt (P="password", S="NaCl", N=1024, r=8, p=16, dkLen=64)@6=fdbabe1c9d347200785' +
      "6e7190d01e9fe",
  )
  const neighbours: string[][] = [
    ["an = line under a sentence is unnamed", "the value below is the key\n   = 0a0b0c0d", "-=0a0b0c0d"],
    ["an = line under a sentence with = is unnamed", "so a = b mod p, giving\n   = 0a0b0c0d", "-=0a0b0c0d"],
    ["nor is one under a line of prose with no =", "the key\n   = 0a0b0c0d", "-=0a0b0c0d"],
    ["a name with a space is no name", "the key = f(x)\n   = 0a0b0c0d", "-=0a0b0c0d"],
    ["a dotted name is one", "ctx.key = f(x)\n   = 0a0b0c0d", "ctx.key=0a0b0c0d"],
    ["so is a hyphenated one", "client-key = f(x)\n   = 0a0b0c0d", "client-key=0a0b0c0d"],
    ["but not one with other punctuation", "client+key = f(x)\n   = 0a0b0c0d", "-=0a0b0c0d"],
    ["a blank line, as a page break leaves, does not end it", "key = f(x)\n\n   = 0a0b0c0d", "key=0a0b0c0d"],
    ["a labelled value ends the statement", "key = f(x)\niv:  0e0f\n   = 0a0b0c0d", "iv=0e0f -=0a0b0c0d"],
    ["so does a bare hex value", "key = f(x)\n   aabbccdd\n   = 2233ff", "-=aabbccdd -=2233ff"],
    ["and a dump", "key = f(x)\n   0000  aa bb cc dd\n   = 2233ff", "-=aabbccdd -=2233ff"],
    [
      "and its own = line: a statement names one value",
      "key = f(x)\n   = 0a0b0c0d\n   = 2233ff",
      "key=0a0b0c0d -=2233ff",
    ],
    ["a line led by a letter, not =, is no = line", "key = f(x)\nk 0a0b0c0d\n   = 2233ff", "-=2233ff"],
    ["a call closed with no = names nothing below it", "name = f(a,\n   b)\n   0a0b0c0d", "-=0a0b0c0d"],
    ["an = line ends a call left open above it", "T (a,\n   = f(x)\nKey) =\n   0a0b0c0d", "Key)=0a0b0c0d"],
    [
      "a line ending in : inside an open parenthesis is a label of its own",
      "The tag (computed over\nKey:\n   0a0b0c0d\nmore) =\n   2233ff",
      "Key=0a0b0c0d more)=2233ff",
    ],
    [
      "so is one ending in =, and it starts a statement",
      "The tag (computed over\nkey =\n   = 0a0b0c0d",
      "key=0a0b0c0d",
    ],
    [
      "a call closed by = ends the statement it opened",
      "key = f(a,\n   b) =\n   0a0b0c0d\n   = 2233ff",
      "key = f(a, b)=0a0b0c0d -=2233ff",
    ],
    ["with nothing printed between", "key = f(a,\n   b) =\n   = 2233ff", "-=2233ff"],
    [
      "a call closed with no = drops the name a line inside it gave",
      "name = f(a,\n   Data\n   b)\n   0a0b0c0d",
      "-=0a0b0c0d",
    ],
    [
      "a line ending in : past a closed call is a label of its own",
      "name = f(a,\n   b)\nKey:\n   0a0b0c0d",
      "Key=0a0b0c0d",
    ],
    ["a : line inside an open parenthesis ends it", "The tag (computed over\nKey:\nmore) =\n   2233ff", "more)=2233ff"],
    [
      "a call wrapped past four lines is no call label",
      "f (a,\n   b,\n   c,\n   d,\n   e) =\n   0a0b0c0d",
      "e)=0a0b0c0d",
    ],
    ["a parenthesis closed on its line is an ordinary label", "f (a, b) =\n   0a0b0c0d", "f (a, b)=0a0b0c0d"],
    [
      "a parenthesis left open in prose leaves the next line a label",
      "The tag (computed over\nCiphertext\n   0a0b0c0d",
      "Ciphertext=0a0b0c0d",
    ],
    ["a wrapped call that ends in prose labels nothing", "see f (a,\n   b) for more\n   0a0b0c0d", "-=0a0b0c0d"],
    [
      "a call wrapped over exactly four lines is one",
      "f (a,\n   b,\n   c,\n   d) =\n   0a0b0c0d",
      "f (a, b, c, d)=0a0b0c0d",
    ],
    ["a wrapped call closed by : is one label", "f (a,\n   b) :\n   0a0b0c0d", "f (a, b)=0a0b0c0d"],
    ["one closed by neither = nor : labels nothing", "f (a,\n   b) ;\n   0a0b0c0d", "-=0a0b0c0d"],
    ["a digit-led name is no name", "1x = f(a)\n   = 0a0b0c0d", "-=0a0b0c0d"],
    ["nor is an underscore-led one", "_x = f(a)\n   = 0a0b0c0d", "-=0a0b0c0d"],
    ["a digit later in a name is fine", "x1 = f(a)\n   = 0a0b0c0d", "x1=0a0b0c0d"],
    ["an unnamed = line of bare digits is a number, not hex", "5 * 8\n   = 1000", ""],
    ["a named one is kept, as n = 1000 on one line is", "n = 25 * 40\n   = 1000", "n=1000"],
    ["and so is an unnamed one with a hex letter", "5 * 8\n   = 100a", "-=100a"],
    ["a statement whose call wraps keeps its name", "x = f(a,\n   b)\n   = 0a0b0c0d", "x=0a0b0c0d"],
    ["so does one whose = f(...) line wraps", "x\n   = f(a,\n   b)\n   = 0a0b0c0d", "x=0a0b0c0d"],
    [
      "a statement whose call wraps into a label names only that label's value",
      "x = f(a,\n   b) =\n   0a0b\n   = 0c0d",
      "x = f(a, b)=0a0b -=0c0d",
    ],
    [
      "a statement names one value, not the next = line",
      "x = f(a)\n   = aaaa\n   bbbb\n\n   = cccc",
      "x=aaaabbbb -=cccc",
    ],
    [
      "a parenthesis open in prose does not swallow a label",
      "Test vector (informative\n   Key:\n   0a0b0c0d",
      "Key=0a0b0c0d",
    ],
    ["nor one ending in =", "Test vector (informative\n   Key =\n   0a0b0c0d", "Key=0a0b0c0d"],
    [
      "a value ends a call left open in prose, so a later line does not join it",
      "The tag (computed over\nCiphertext\n   0a0b0c0d\nmore) =\n   2233ff",
      "Ciphertext=0a0b0c0d more)=2233ff",
    ],
    ["an = line in upper case reads as its bytes", "x = f(a)\n   = 0A0B0C0D", "x=0a0b0c0d"],
    ["an = line in several groups is one value", "x = f(a)\n   = 0a0b 0c0d", "x=0a0b0c0d"],
  ]
  for (const n of neighbours) {
    t.eqStr(n[0], rfcTestBody(n[1]), n[2])
  }
  // Where each value's name closes: the last line of a call label
  // rfcHexRead joined (four at most, across a page break too), the name's
  // own line otherwise.
  const brk = rfcTestBreak(2)
  const ends: string[][] = [
    ["a one-line label closes on its line", "Key:\n   0a0b0c0d", "Key@2-2"],
    ["a call label wrapped over two lines closes on the second", "f (a,\n   b) =\n   0a0b0c0d", "f (a, b)@2-3"],
    ["one wrapped across a page break closes past it", `f (a,${brk}\n   b) =\n   0a0b0c0d`, "f (a, b)@2-5"],
    [
      "one wrapped over four lines closes on the fourth",
      "f (a,\n   b,\n   c,\n   d) =\n   0a0b0c0d",
      "f (a, b, c, d)@2-5",
    ],
    [
      "one wrapped over five is named by its last line alone",
      "f (a,\n   b,\n   c,\n   d,\n   e) =\n   0a0b0c0d",
      "e)@6-6",
    ],
    [
      "a line inside a call open in prose names a value on its own line",
      "The tag (computed over\nCiphertext\n   0a0b0c0d",
      "Ciphertext@3-3",
    ],
    ["a statement names its = line from its own line", "x = f(a)\n\n   = 0a0b0c0d", "x@2-2"],
    [
      "a call closed by = names from its first line to its last",
      "key = f(a,\n   b) =\n   0a0b0c0d",
      "key = f(a, b)@2-3",
    ],
    ["an inline label is its value's line", "Key = 0a0b0c0d", "Key@2-2"],
  ]
  for (const e of ends) {
    t.eqStr(e[0], rfcTestEnds(e[1]), e[2])
  }
  const many: string[] = []
  for (let i = 0; i < 7; i++) {
    many.push(charsFromCodePoint(0x200b))
  }
  const lots = rfcRead(`${rfcTestText()}${many.join("")}`, "r.txt")
  t.ok("at most five, then a count", lots.isErr() && lots.error.endsWith("remove it (and 2 more)"))
  return t.done()
}
