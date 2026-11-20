import { Suite } from "nish/testing"
import { CheckContext } from "../../../src/spec/check"
import { contractParse } from "../../../src/spec/contract/read"
import { gateFidelity } from "../../../src/spec/gates/fidelity"
import { gateWarnings } from "../../../src/spec/gates/note"
import { LoadedSource, SourceSet } from "../../../src/spec/source/load"
import { RfcSection, rfcParse, rfcSection, rfcWithHeading, rfcWithHeadings } from "../../../src/spec/source/rfc"

/** A footer, form feed and header, as `rfcParse` reads page furniture. */
const casesTestBreak = (rfc: string, page: i32): string =>
  `\nPornin                        Informational                    [Page ${page}]\n\f\nRFC ${rfc}               Deterministic DSA and ECDSA           August 2013\n`

/** RFC 6979 §A.2.5's values, by name. */
const CASES_TEST_X: string = "C9AFA9D845BA75166B5C215767B1D6934E50C3DB36E89B127B8A622B120F6721"
const CASES_TEST_UX: string = "60FED4BA255A9D31C961EB74C6356D68C049B8923B61FA6CE669622E60F29FB6"
const CASES_TEST_K1: string = "882905F1227FD620FBF2ABF21244F0BA83D0DC3A9103DBBEE43A1FB858109DB4"
const CASES_TEST_R256: string = "EFD48B2AACB6A8FD1140DD9CD45E81D69D2C877B56AAF991C34D0EA84EAF3716"
const CASES_TEST_S512: string = "2362AB1ADBE2B8ADF9CB9EDAB740EA6049C028114F2460F96554F61FAE3302FE"
const CASES_TEST_R256T: string = "F1ABB023518351CD71D881567B1EA663ED3EFCF6C5132B354F28D3B0B7D38367"
const CASES_TEST_R1T: string = "0CBCC86FD6ABD1D99E703E1EC50069EE5C0B4BA4B9AC60E409E8EC5910D81A89"

/**
 * RFC 6979 §A.2.5's layout, cut to the SHA-1, SHA-256 and SHA-512 cases: the
 * key above the case headings, the "sample" cases on one page and the "test"
 * cases on the next, so the last "sample" case and the first "test" case are
 * split only by a page break. A section with no headings follows.
 */
const casesTestRfc = (): string =>
  [
    "Request for Comments: 6979",
    "",
    "1.  Rules",
    "",
    "   It MUST derive.",
    "",
    "A.2.5.  ECDSA, 256 Bits (Prime Field)",
    "",
    "   Key pair:",
    "",
    "   curve: NIST P-256",
    "",
    "   q = FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551",
    "   (qlen = 256 bits)",
    "",
    "   private key:",
    "",
    `   x = ${CASES_TEST_X}`,
    "",
    "   public key: U = xG",
    "",
    `   Ux = ${CASES_TEST_UX}`,
    "",
    "   Uy = 7903FE1008B8BC99A41AE9E95628BC64F2F1B20C2D7E9F5177A3C294D4462299",
    "",
    "   Signatures:",
    "",
    '   With SHA-1, message = "sample":',
    `   k = ${CASES_TEST_K1}`,
    "   r = 61340C88C3AAEBEB4F6D667F672CA9759A6CCAA9FA8811313039EE4A35471D32",
    "   s = 6D7F147DAC089441BB2E2FE8F7A3FA264B9C475098FDCF6E00D7C996E1B8B7EB",
    "",
    '   With SHA-256, message = "sample":',
    "   k = A6E3C57DD01ABE90086538398355DD4C3B17AA873382B0F24D6129493D8AAD60",
    `   r = ${CASES_TEST_R256}`,
    "   s = F7CB1C942D657C41D436C7A1B6E29F65F3E900DBB9AFF4064DC4AB2F843ACDA8",
    "",
    '   With SHA-512, message = "sample":',
    "   k = 5FA81C63109BADB88C1F367B47DA606DA28CAD69AA22C4FE6AD7DF73A7173AA5",
    "   r = 8496A60B5E9B47C825488827E0495B0E3FA109EC4568FD3F8D1097678EB97F00",
    `   s = ${CASES_TEST_S512}`,
    casesTestBreak("6979", 33),
    '   With SHA-1, message = "test":',
    "   k = 8C9520267C55D6B980DF741E56B4ADEE114D84FBFA2E62137954164028632A2E",
    `   r = ${CASES_TEST_R1T}`,
    "   s = 01B9D7B73DFAA60D5651EC4591A0136F87653E0FD780C3B1BC872FFDEAE479B1",
    "",
    '   With SHA-256, message = "test":',
    "   k = D16B6AE827F17175E040871A1C7EC3500192C4C92677336EC2537ACAEE0008E0",
    `   r = ${CASES_TEST_R256T}`,
    "   s = 019F4113742A2B14BD25926B49C649155F267E60D3814B4C0CC84250E46F0083",
    "",
    '   With SHA-512, message = "test":',
    "   k = 6915D11632ACA3C40D5D51C08DAF9C555933819548784480E93499000D9F0B7F",
    "   r = 461D93F31B6540894788FD206C07CFA0CC35F46FA3C91816FFF1040AD1581A04",
    "   s = 39AF9F15DE0DB8D97E72719C74820D304CE5226E32DEDAE67519E840D1194E55",
    "",
    "A.3.  Rounds",
    "",
    '   With the message "sample", each round prints:',
    `   x = ${CASES_TEST_X}`,
    `   r = ${CASES_TEST_R256}`,
    "",
    `   x = ${CASES_TEST_UX}`,
    `   r = ${CASES_TEST_R1T}`,
    "",
    "A.4.  Counted",
    "",
    '   With SHA-256, message = "sample":',
    "   n = 3",
    `   r = ${CASES_TEST_R256}`,
    "",
    '   With SHA-512, message = "sample":',
    "   n = 5",
    `   s = ${CASES_TEST_S512}`,
    "",
  ].join("\n")

/**
 * The findings and warnings for one vector citing section `id` of
 * casesTestRfc, calling `call` (a function of a key and a message, returning
 * bytes): `args` and `expect` are the clause's literals' JSON.
 */
const casesTestRun = (call: string, id: string, args: string, expect: string): string[] =>
  casesTestRunWith(`{"name": "x", "type": "bytes"}, {"name": "m", "type": "string"}`, call, id, args, expect)

/** casesTestRun, the function's params' JSON `params`. */
const casesTestRunWith = (params: string, call: string, id: string, args: string, expect: string): string[] => {
  const contract = `{
  "contract": "c7",
  "source": {"title": "T", "rfc": 6979},
  "target": {"module": "nish/x"},
  "requirements": [{"id": "R1", "section": "1", "level": "MUST", "quote": "It MUST derive."}],
  "functions": [{"name": "${call}", "params": [${params}], "returns": "bytes"}],
  "clauses": [
    {"kind": "vector", "id": "W1", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "${id}"}}, "call": "${call}",
     "args": [${args}], "expect": ${expect}}
  ]
}`
  const ctx = new CheckContext("contracts/c7.json", ".")
  ctx.contract = contractParse(contract, "c7").expect("parse")
  const set = new SourceSet()
  set.main = "rfc6979"
  set.sources.push(new LoadedSource("rfc6979", "r.txt", "r.txt", rfcParse(casesTestRfc())))
  ctx.sources = set
  const out = gateFidelity(ctx)
  for (const n of gateWarnings(ctx)) {
    out.push(n.message)
  }
  return out
}

/** A hex literal's JSON, labelled `label`. */
const casesTestHex = (hex: string, label: string): string => `{"hex": "${hex}", "label": "${label}"}`

/** Whether `got` is empty when `want` is, else one message holding `want`. */
const casesTestRowIs = (t: Suite, name: string, got: string[], want: string): void => {
  const ok = want.length === 0 ? got.length === 0 : got.length === 1 && got[0].indexOf(want) >= 0
  t.ok(name, ok)
  if (!ok) {
    console.log(`${name}:\n${got.join("\n")}`)
  }
}

/**
 * Values under RFC 6979's case headings: a value printed above the first
 * heading is every case's, a string printed on a heading is its case's, and
 * every value must be under one heading. Each row is a name, the call, the
 * section, the args' JSON, the expected value's JSON and the message wanted
 * ("" for none).
 */
const casesTestHeadingRows = (t: Suite): void => {
  const x = casesTestHex(CASES_TEST_X, "x")
  const different = "so they are from different test cases: use the values printed under one case heading"
  const rows: string[][] = [
    [
      "the key above the headings, the message and r of SHA-256 sample",
      "sign256",
      "A.2.5",
      `${x}, {"str": "sample"}`,
      casesTestHex(CASES_TEST_R256, "r"),
      "",
    ],
    [
      "the key above the headings, the message and r of SHA-256 test, past the page break",
      "sign256",
      "A.2.5",
      `${x}, {"str": "test"}`,
      casesTestHex(CASES_TEST_R256T, "r"),
      "",
    ],
    [
      "the public key above the headings, the message and r of SHA-256 sample",
      "sign256",
      "A.2.5",
      `${casesTestHex(CASES_TEST_UX, "Ux")}, {"str": "sample"}`,
      casesTestHex(CASES_TEST_R256, "r"),
      "",
    ],
    [
      'the message "sample" and r of SHA-256 test',
      "sign256",
      "A.2.5",
      `${x}, {"str": "sample"}`,
      casesTestHex(CASES_TEST_R256T, "r"),
      different,
    ],
    [
      'the message "test" and s of SHA-512 sample, split from it only by the page break',
      "sign512",
      "A.2.5",
      `${x}, {"str": "test"}`,
      casesTestHex(CASES_TEST_S512, "s"),
      different,
    ],
    [
      'the message "test" and r of SHA-1 test, just past the page break',
      "sign1",
      "A.2.5",
      `${x}, {"str": "test"}`,
      casesTestHex(CASES_TEST_R1T, "r"),
      "",
    ],
    [
      "k of SHA-1 sample as an input, r of SHA-256 sample expected",
      "sign256",
      "A.2.5",
      `${casesTestHex(CASES_TEST_K1, "k")}, {"str": "sample"}`,
      casesTestHex(CASES_TEST_R256, "r"),
      different,
    ],
    [
      "a call naming another case's variant",
      "sign1",
      "A.2.5",
      `${x}, {"str": "sample"}`,
      casesTestHex(CASES_TEST_R256, "r"),
      'the values are printed under the case heading "With SHA-256, message = "sample":" in RFC §A.2.5',
    ],
    [
      "a call naming no variant",
      "sign",
      "A.2.5",
      `${x}, {"str": "sample"}`,
      casesTestHex(CASES_TEST_R256, "r"),
      "nothing in the name sign says which variant it computes",
    ],
  ]
  for (const r of rows) {
    casesTestRowIs(t, `6979 §${r[2]}: ${r[0]}`, casesTestRun(r[1], r[2], r[3], r[4]), r[5])
  }
}

/**
 * A section with no case heading pairs as before: by rounds. A string with a
 * repeated label is refused, whatever its line.
 */
const casesTestNoHeadingRows = (t: Suite): void => {
  casesTestRowIs(
    t,
    "6979 §A.3: no heading, a string and a repeated label",
    casesTestRun("sign256", "A.3", `${casesTestHex(CASES_TEST_X, "x")}, {"str": "sample"}`, casesTestHex(CASES_TEST_R256, "r")),
    "nothing pairs a printed string with one of several labelled values",
  )
  // A labelled number is not placed by line: its rounds pair it, so a string
  // with it is refused, not placed by the other values alone.
  casesTestRowIs(
    t,
    "6979 §A.4: headings, and a number printed under each",
    casesTestRunWith(`{"name": "n", "type": "i32"}, {"name": "m", "type": "string"}`, "sign512", "A.4", `{"int": 3, "label": "n"}, {"str": "sample"}`, casesTestHex(CASES_TEST_S512, "s")),
    "nothing pairs a printed string with one of several labelled values",
  )
}

/** The case headings rfcWithHeading reads, and the lines it does not. Each row is a line and the words wanted. */
const casesTestWithRows = (t: Suite): void => {
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

/** The section `id` of casesTestRfc. */
const casesTestSection = (id: string): RfcSection => {
  const s = rfcSection(rfcParse(casesTestRfc()), id)
  return s === null ? new RfcSection(id, "missing", [], []) : s
}

export const main = (): i32 => {
  const t = new Suite("spec/gates/cases")
  casesTestWithRows(t)
  const sec = casesTestSection("A.2.5")
  const heads = rfcWithHeadings(sec)
  t.eqStr(
    "rfcWithHeadings: each heading, on each side of the page break",
    heads.map((h: i32): string => rfcWithHeading(sec.lines[h])).join(" "),
    "SHA-1 SHA-256 SHA-512 SHA-1 SHA-256 SHA-512",
  )
  t.eqStr("rfcWithHeadings: none in a section without", `${rfcWithHeadings(casesTestSection("A.3")).length}`, "0")
  casesTestHeadingRows(t)
  casesTestNoHeadingRows(t)
  return t.done()
}
