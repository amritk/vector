import { Suite } from "nish/testing"
import { replaceAll } from "nish/text"
import { CheckContext } from "../../../src/spec/check"
import { contractParse } from "../../../src/spec/contract/read"
import { contractShapeErrors } from "../../../src/spec/contract/shape"
import { Contract } from "../../../src/spec/contract/types"
import { contractWrite } from "../../../src/spec/contract/write"
import { gateFidelity } from "../../../src/spec/gates/fidelity"
import { LoadedSource, SourceSet } from "../../../src/spec/source/load"
import { rfcParse } from "../../../src/spec/source/rfc"

// Byte parts: a concat's `format` constant and a vector's `tail`, read,
// written and shaped, then held by the fidelity gate to RFC text laid out
// as `rfcParse` reads it, page footers and form feeds included.

const BPC_HEAD: string = "ff000000010008f067a5502a4262b5746f6b656e"
const BPC_TAG: string = "04a265ba2eff4d829058fb3f0f2496ba"
const BPC_X: string = "c9afa9d845ba75166b5c215767b1d6934e50c3db36e89b127b8a622b120f6721"
const BPC_UX: string = "60fed4ba255a9d31c961eb74c6356d68c049b8923b61fa6ce669622e60f29fb6"
const BPC_UY: string = "7903fe1008b8bc99a41ae9e95628bc64f2f1b20c2d7e9f5177a3c294d4462299"

/** A footer, form feed and header, as `rfcParse` reads page furniture. */
const bpcTestBreak = (rfc: string, page: i32): string =>
  `\nAuthor                        Informational                     [Page ${page}]\n\f\nRFC ${rfc}                      Example Spec                     May 2021\n`

/** A one-vector contract citing section SECTION of RFC NUM, calling `f(params)`, with ARGS, EXPECT and EXTRA. */
const bpcTestText = (
  num: string,
  section: string,
  params: string,
  args: string,
  expect: string,
  extra: string,
): string => `{
  "contract": "c1",
  "source": {"title": "T", "rfc": ${num}},
  "target": {"module": "nish/x"},
  "requirements": [{"id": "R1", "section": "1", "level": "MUST", "quote": "It MUST derive."}],
  "functions": [{"name": "f", "params": [${params}], "returns": "bytes"}],
  "clauses": [
    {"kind": "vector", "id": "V1", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "${section}"}}, "call": "f",
     "args": [${args}], "expect": ${expect}${extra}}
  ]
}`

const BPC_ONE: string = `{"name": "p", "type": "bytes"}`
const BPC_TWO: string = `{"name": "p", "type": "bytes"}, {"name": "q", "type": "bytes"}`

/** The packet, labelled as RFC 9001 A.4 prints it, as the tail's args[0]. */
const bpcTestPacket = (): string => `{"hex": "${BPC_HEAD}", "label": "value is not included in the final Retry packet"}`

/** The tail vector's text: args `args`, expect `expect`, and `tail`'s JSON. */
const bpcTestTailText = (args: string, expect: string, tail: string): string =>
  bpcTestText("9001", "A.4", BPC_ONE, args, expect, `, "tail": ${tail}`)

/** The read errors of `text`, prefixed "read: ", then its shape errors; "" when none. */
const bpcTestShapeOf = (text: string): string => {
  const c = contractParse(text, "c1")
  if (c.isErr()) {
    return c.error.map((e: string): string => `read: ${e}`).join("\n")
  }
  return contractShapeErrors(c.value).join("\n")
}

/** bpcTestShapeOf the RFC 9001 tail vector whose tail is `tail`. */
const bpcTestTailShape = (tail: string): string =>
  bpcTestShapeOf(bpcTestTailText(bpcTestPacket(), `{"hex": "${BPC_TAG}"}`, tail))

/** bpcTestShapeOf the RFC 6979 public-key vector whose expect is `expect`. */
const bpcTestFormatShape = (expect: string): string =>
  bpcTestShapeOf(bpcTestText("6979", "A.2.5", BPC_ONE, `{"hex": "${BPC_X}", "label": "x"}`, expect, ""))

/** The contract of `text`, which must read. */
const bpcTestContract = (text: string): Contract => contractParse(text, "c1").expect("parse")

/** The fidelity findings of `text` against RFC `num`, whose text is `rfc`. */
const bpcTestFidelity = (num: string, rfc: string, text: string): string => {
  const ctx = new CheckContext("contracts/c1.json", ".")
  ctx.contract = bpcTestContract(text)
  const set = new SourceSet()
  set.main = `rfc${num}`
  set.sources.push(new LoadedSource(`rfc${num}`, "r.txt", "r.txt", rfcParse(rfc)))
  ctx.sources = set
  return gateFidelity(ctx).join("\n")
}

/** An RFC 9001 with Appendix A.4's packet laid out as `lines`. */
const bpcTestQuicRfc = (lines: string[]): string => {
  const out: string[] = [
    "Request for Comments: 9001",
    "",
    "1.  Rules",
    "",
    "   It MUST derive.",
    "",
    "A.4.  Retry",
    "",
    "   This shows a Retry packet.  The integrity check includes the",
    "   client-chosen connection ID value of 0x8394c8f03e515708, but that",
    "   value is not included in the final Retry packet:",
    "",
  ]
  for (const line of lines) {
    out.push(line)
  }
  out.push("")
  out.push("A.5.  ChaCha20-Poly1305 Short Header Packet")
  out.push("")
  return out.join("\n")
}

/** The tail vector's fidelity findings against `rfc`, with `args`, `expect` and `tail`. */
const bpcTestTailGate = (rfc: string, args: string, expect: string, tail: string): string =>
  bpcTestFidelity("9001", rfc, bpcTestTailText(args, expect, tail))

/** An RFC 6979 with A.2.5's key pair, a page break `at` 0 (none), 1 (before Ux) or 2 (before Uy). */
const bpcTestEcRfc = (at: i32): string => {
  const out: string[] = [
    "Request for Comments: 6979",
    "",
    "1.  Rules",
    "",
    "   It MUST derive.",
    "",
    "A.2.5.  ECDSA, 256 Bits (Prime Field)",
    "",
    "   private key:",
    "",
    `   x = ${BPC_X}`,
    "",
    "   public key: U = xG",
    "",
  ]
  if (at === 1) {
    out.push(bpcTestBreak("6979", 33))
  }
  out.push(`   Ux = ${BPC_UX}`)
  out.push("")
  if (at === 2) {
    out.push(bpcTestBreak("6979", 33))
  }
  out.push(`   Uy = ${BPC_UY}`)
  out.push("")
  return out.join("\n")
}

/** The public-key vector's fidelity findings against `rfc`, expecting `expect`. */
const bpcTestFormatGate = (rfc: string, expect: string): string =>
  bpcTestFidelity("6979", rfc, bpcTestText("6979", "A.2.5", BPC_ONE, `{"hex": "${BPC_X}", "label": "x"}`, expect, ""))

/** The SEC1 point: the 04 format constant, then Ux and Uy as labelled. */
const bpcTestPoint = (ux: string, uy: string): string =>
  `{"concat": [{"hex": "04", "format": "SEC1 prefixes an uncompressed point with 04"}, ${ux}, ${uy}]}`

/** read and write: each malformed tail and format refused, each kept on a round trip. */
const bpcTestReadWrite = (t: Suite): void => {
  const ok = `{"arg": 0, "bytes": 16, "reason": "the tag ends the packet"}`
  t.eqStr("a tail reads", bpcTestTailShape(ok), "")
  const bad: string[] = [
    `{"arg": 0, "bytes": 0, "reason": "r"}`,
    `{"arg": 0, "bytes": 65537, "reason": "r"}`,
    `{"arg": -1, "bytes": 16, "reason": "r"}`,
    `{"arg": 256, "bytes": 16, "reason": "r"}`,
    `{"arg": 0, "bytes": 16}`,
    `{"bytes": 16, "reason": "r"}`,
    `{"arg": 0, "reason": "r"}`,
    `{"arg": 0, "bytes": 16, "reason": "r", "from": 1}`,
    `{"arg": "0", "bytes": 16, "reason": "r"}`,
    `{"arg": 0, "bytes": 16, "reason": 1}`,
    "16",
  ]
  const want: string[] = [
    "read: clauses[0].tail.bytes: an integer in 1..65536",
    "read: clauses[0].tail.bytes: an integer in 1..65536",
    "read: clauses[0].tail.arg: an integer in 0..255",
    "read: clauses[0].tail.arg: an integer in 0..255",
    "read: clauses[0].tail.reason: missing; a string",
    "read: clauses[0].tail.arg: missing; an integer in 0..255",
    "read: clauses[0].tail.bytes: missing; an integer in 1..65536",
    'read: clauses[0].tail: unknown field "from"',
    "read: clauses[0].tail.arg: an integer in 0..255",
    "read: clauses[0].tail.reason: a string",
    "read: clauses[0].tail: an object",
  ]
  for (let i = 0; i < bad.length && i < want.length; i++) {
    t.eqStr(`read refuses ${bad[i]}`, bpcTestTailShape(bad[i]), want[i])
  }
  t.eqStr(
    "1 byte and arg 255 read",
    bpcTestShapeOf(bpcTestTailText(bpcTestPacket(), `{"hex": "ba"}`, `{"arg": 0, "bytes": 1, "reason": "r"}`)),
    "",
  )
  t.eqStr(
    "a format reason that is not a string",
    bpcTestFormatShape(`{"concat": [{"hex": "04", "format": 4}, {"hex": "${BPC_UX}", "label": "Ux"}]}`),
    "read: clauses[0].expect.concat[0].format: a string",
  )
  const tail = bpcTestContract(bpcTestTailText(bpcTestPacket(), `{"hex": "${BPC_TAG}"}`, ok))
  const w = contractWrite(tail)
  t.ok("the tail is written", w.indexOf(`"tail": {`) >= 0 && w.indexOf(`"reason": "the tag ends the packet"`) >= 0)
  t.eqStr("a tail round-trips", contractWrite(bpcTestContract(w)), w)
  const fmt = bpcTestContract(
    bpcTestText(
      "6979",
      "A.2.5",
      BPC_ONE,
      `{"hex": "${BPC_X}", "label": "x"}`,
      bpcTestPoint(`{"hex": "${BPC_UX}", "label": "Ux"}`, `{"hex": "${BPC_UY}", "label": "Uy"}`),
      "",
    ),
  )
  const fw = contractWrite(fmt)
  t.ok("the format is written", fw.indexOf(`"format": "SEC1 prefixes an uncompressed point with 04"`) >= 0)
  t.eqStr("a format round-trips", contractWrite(bpcTestContract(fw)), fw)
  t.ok("a vector with neither writes neither", w.indexOf(`"format"`) < 0 && fw.indexOf(`"tail"`) < 0)
}

/** shape: where a format may stand, what it may carry, and what a tail may sit beside. */
const bpcTestShapes = (t: Suite): void => {
  const ux = `{"hex": "${BPC_UX}", "label": "Ux"}`
  const f = `"format": "SEC1"`
  const rows: string[][] = [
    ["a format part beside a printed one", `{"concat": [{"hex": "04", ${f}}, ${ux}]}`, ""],
    [
      "a format on the expect itself",
      `{"hex": "04", ${f}}`,
      "clauses[0].expect.format: a format constant is a hex part of a concat",
    ],
    [
      "a format on a concat",
      `{"concat": [{"hex": "04"}, ${ux}], ${f}}`,
      'read: clauses[0].expect: unknown field "format"',
    ],
    [
      "a format on a string part",
      `{"concat": [{"str": "04", ${f}}, ${ux}]}`,
      "read: clauses[0].expect.concat[0]: a bytes literal (hex, ascii, concat)",
    ],
    [
      "an empty reason",
      `{"concat": [{"hex": "04", "format": " "}, ${ux}]}`,
      "clauses[0].expect.concat[0].format: a non-empty reason",
    ],
    [
      "a labelled format",
      `{"concat": [{"hex": "04", "label": "P", ${f}}, ${ux}]}`,
      "clauses[0].expect.concat[0].format: a format constant has no label and is not unchecked: it is taken on its reason",
    ],
    [
      "an unchecked format",
      `{"concat": [{"hex": "04", "unchecked": "r", ${f}}, ${ux}]}`,
      "clauses[0].expect.concat[0].format: a format constant has no label and is not unchecked: it is taken on its reason",
    ],
    [
      "a repeated format",
      `{"concat": [{"hex": "04", "repeat": 2, ${f}}, ${ux}]}`,
      "clauses[0].expect.concat[0].format: a format constant is its hex, not a repeated run",
    ],
    [
      "two formats",
      `{"concat": [{"hex": "04", ${f}}, {"hex": "05", ${f}}, ${ux}]}`,
      "clauses[0].expect: at most one format part: a concat's other parts are printed in the RFC",
    ],
    [
      "a format alone",
      `{"concat": [{"hex": "04", ${f}}]}`,
      "clauses[0].expect: a format part needs another part, printed in the RFC, beside it",
    ],
    ["a format in a nested concat", `{"concat": [${ux}, {"concat": [{"hex": "04", ${f}}, ${ux}]}]}`, ""],
  ]
  for (const r of rows) {
    t.eqStr(`shape: ${r[0]}`, bpcTestFormatShape(r[1]), r[2])
  }
  t.eqStr(
    "shape: a format on an argument part",
    bpcTestShapeOf(
      bpcTestText("6979", "A.2.5", BPC_ONE, `{"concat": [{"hex": "04", ${f}}, ${ux}]}`, `{"hex": "${BPC_UY}"}`, ""),
    ),
    "",
  )
  t.eqStr(
    "shape: a format on a whole argument",
    bpcTestShapeOf(bpcTestText("6979", "A.2.5", BPC_ONE, `{"hex": "04", ${f}}`, `{"hex": "${BPC_UY}"}`, "")),
    "clauses[0].args[0].format: a format constant is a hex part of a concat",
  )
  const at = "clauses[0].tail"
  const two = bpcTestText(
    "9001",
    "A.4",
    BPC_TWO,
    `${bpcTestPacket()}, {"hex": "aa"}`,
    `{"hex": "${BPC_TAG}"}`,
    `, "tail": {"arg": 1, "bytes": 16, "reason": "r"}`,
  )
  t.eqStr("shape: a tail of the last argument", bpcTestShapeOf(two), "")
  t.eqStr(
    "shape: a tail of no argument",
    bpcTestTailShape(`{"arg": 1, "bytes": 16, "reason": "r"}`),
    `${at}.arg: args[1] is no argument: the vector has 1`,
  )
  t.eqStr(
    "shape: an empty reason",
    bpcTestTailShape(`{"arg": 0, "bytes": 16, "reason": "  "}`),
    `${at}.reason: a non-empty reason`,
  )
  const beside = "a tail's expect is the printed bytes themselves: drop the truncate, iterate or tolerance"
  t.eqStr(
    "shape: beside a truncate",
    bpcTestTailShape(`{"arg": 0, "bytes": 16, "reason": "r"}, "truncate": {"bytes": 16}`),
    `${at}: ${beside}`,
  )
  const iter = `{"arg": 0, "bytes": 16, "reason": "r"}, "iterate": {"count": 2, "names": ["p"], "next": [{"call": "f", "args": [{"var": "p"}]}]}`
  t.ok("shape: beside an iterate", bpcTestTailShape(iter).indexOf(`${at}: ${beside}`) >= 0)
  for (const src of [`{"command": "echo"}`, `{"spec": "1"}`]) {
    const text = replaceAll(
      bpcTestTailText(bpcTestPacket(), `{"hex": "${BPC_TAG}"}`, `{"arg": 0, "bytes": 16, "reason": "r"}`),
      `{"cite": {"section": "A.4"}}`,
      src,
    )
    t.ok(
      `shape: a tail sourced ${src}`,
      bpcTestShapeOf(text).indexOf(`${at}: a tail ends a value a source prints: the vector's source is a cite`) >= 0,
    )
  }
  t.ok(
    "shape: beside a tolerance",
    bpcTestTailShape(
      `{"arg": 0, "bytes": 16, "reason": "r"}, "tolerance": {"ulps": 1, "section": "A.4", "quote": "q"}`,
    ).indexOf(`${at}: ${beside}`) >= 0,
  )
}

/** The tail held to RFC 9001 A.4's packet, whole, split by page breaks, and in two blocks. */
const bpcTestTails = (t: Suite): void => {
  const whole = bpcTestQuicRfc(["   ff000000010008f067a5502a4262b574 6f6b656e04a265ba2eff4d829058fb3f", "   0f2496ba"])
  const tag = `{"hex": "${BPC_TAG}"}`
  const ok = `{"arg": 0, "bytes": 16, "reason": "the tag ends the packet"}`
  const p = bpcTestPacket()
  t.eqStr("the packet printed whole", bpcTestTailGate(whole, p, tag, ok), "")
  const split = bpcTestQuicRfc([
    "   ff000000010008f067a5502a4262b574 6f6b656e04a265ba2eff4d829058fb3f",
    bpcTestBreak("9001", 48),
    "   0f2496ba",
  ])
  t.eqStr("the tag split by a page break", bpcTestTailGate(split, p, tag, ok), "")
  const after = bpcTestQuicRfc([
    "   ff000000010008f067a5502a4262b574 6f6b656e",
    bpcTestBreak("9001", 48),
    "   04a265ba2eff4d829058fb3f0f2496ba",
  ])
  t.eqStr("the tag wholly after a page break", bpcTestTailGate(after, p, tag, ok), "")
  // Two values the section prints apart, the packet's head then the tag
  // under its own name, split only by a page break: no one value.
  const blocks = bpcTestQuicRfc([
    "   ff000000010008f067a5502a4262b5746f6b656e",
    bpcTestBreak("9001", 48),
    `   tag = ${BPC_TAG}`,
  ])
  const apart = `V1.tail: the 36-byte tail is not printed in RFC §A.4 ("Retry")`
  t.eqStr("two values split only by a page break", bpcTestTailGate(blocks, p, tag, ok), apart)
  t.eqStr(
    "the tag, bound alone, is printed there",
    bpcTestFidelity(
      "9001",
      blocks,
      bpcTestText("9001", "A.4", BPC_ONE, p, `{"hex": "${BPC_TAG}", "label": "tag"}`, ""),
    ),
    "",
  )
  // rfcHexRead joins bare hex lines across a blank line, as it does for
  // every value: the tail reads the section as the other bounds do.
  const blank = bpcTestQuicRfc([
    "   ff000000010008f067a5502a4262b5746f6b656e",
    "",
    bpcTestBreak("9001", 48),
    "",
    `   ${BPC_TAG}`,
  ])
  t.eqStr("bare hex across a blank line and a page break is one value", bpcTestTailGate(blank, p, tag, ok), "")
  t.eqStr(
    "the packet's head is no tail",
    bpcTestTailGate(
      whole,
      `{"hex": "${BPC_TAG}", "label": "value is not included in the final Retry packet"}`,
      `{"hex": "${BPC_HEAD}"}`,
      `{"arg": 0, "bytes": 20, "reason": "r"}`,
    ),
    `V1.tail: the 36-byte tail is not printed in RFC §A.4 ("Retry")`,
  )
  t.eqStr(
    "the expect is not the bytes named",
    bpcTestTailGate(whole, p, tag, `{"arg": 0, "bytes": 15, "reason": "r"}`),
    "V1.tail: the expect is 16 bytes, not the last 15 bytes the tail names",
  )
  t.eqStr(
    "a shorter tail of the same value",
    bpcTestTailGate(
      whole,
      `{"hex": "${BPC_HEAD}04a265ba2eff4d82", "label": "value is not included in the final Retry packet"}`,
      `{"hex": "9058fb3f0f2496ba"}`,
      `{"arg": 0, "bytes": 8, "reason": "r"}`,
    ),
    "",
  )
  t.eqStr(
    "an empty argument",
    bpcTestTailGate(whole, `{"hex": "", "label": "value is not included in the final Retry packet"}`, tag, ok),
    "V1.tail: args[0] is empty: a tail ends a longer value",
  )
  t.eqStr(
    "a string argument",
    bpcTestTailGate(whole, `{"str": "ff"}`, tag, ok),
    "V1.tail: args[0] is string and the expect bytes: a tail joins two hex values",
  )
  t.eqStr(
    "a string expect",
    bpcTestTailGate(whole, p, `{"str": "ff"}`, ok),
    "V1.tail: args[0] is bytes and the expect string: a tail joins two hex values",
  )
  t.eqStr(
    "a null expect, which no section prints",
    bpcTestTailGate(whole, p, `{"null": true}`, ok),
    [
      `V1.tail: a tail is the end of a value printed in RFC §A.4 ("Retry"): the Source cites it`,
      `V1.expect: RFC §A.4 ("Retry") does not state the expected result: V1 covers no requirement cited to it, so nothing there requires the result "null"`,
    ].join("\n"),
  )
  t.eqStr(
    "an unchecked argument",
    bpcTestTailGate(whole, `{"hex": "${BPC_HEAD}", "unchecked": "r"}`, tag, ok),
    `V1.tail: a tail's args[0] and expect are checked against the RFC as one value: drop "unchecked"`,
  )
  t.eqStr(
    "an unchecked expect",
    bpcTestTailGate(whole, p, `{"hex": "${BPC_TAG}", "unchecked": "r"}`, ok),
    `V1.tail: a tail's args[0] and expect are checked against the RFC as one value: drop "unchecked"`,
  )
  t.eqStr(
    "a labelled expect",
    bpcTestTailGate(whole, p, `{"hex": "${BPC_TAG}", "label": "tag"}`, ok),
    `V1.tail: the joined value is found by args[0]'s label: drop the expect's "label"`,
  )
  t.eqStr(
    "a tail one byte off",
    bpcTestTailGate(
      whole,
      `{"hex": "${BPC_HEAD}04", "label": "value is not included in the final Retry packet"}`,
      tag,
      ok,
    ),
    `V1.tail: the 37-byte tail is not printed in RFC §A.4 ("Retry")`,
  )
  t.eqStr(
    "a tail under no label",
    bpcTestTailGate(whole, `{"hex": "${BPC_HEAD}"}`, tag, ok),
    `V1.tail: the value is printed in RFC §A.4 ("Retry") under "value is not included in the final Retry packet": name it with "label", so the contract says which printed value it is`,
  )
}

/** The format constant beside printed parts, on each side of a page break, and beside none. */
const bpcTestFormats = (t: Suite): void => {
  const ux = `{"hex": "${BPC_UX}", "label": "Ux"}`
  const uy = `{"hex": "${BPC_UY}", "label": "Uy"}`
  for (let at = 0; at < 3; at++) {
    t.eqStr(`the point, a page break at ${at}`, bpcTestFormatGate(bpcTestEcRfc(at), bpcTestPoint(ux, uy)), "")
  }
  t.eqStr(
    "the point without its format",
    bpcTestFormatGate(bpcTestEcRfc(2), `{"concat": [{"hex": "04"}, ${ux}, ${uy}]}`),
    `V1.expect.concat[0]: the 1-byte expect.concat[0] is not printed in RFC §A.2.5 ("ECDSA, 256 Bits (Prime Field)")`,
  )
  t.eqStr(
    "the format beside unchecked parts",
    bpcTestFormatGate(
      bpcTestEcRfc(0),
      bpcTestPoint(`{"hex": "${BPC_UX}", "unchecked": "r"}`, `{"hex": "${BPC_UY}", "unchecked": "r"}`),
    ),
    'V1.expect.concat[0]: expect.concat[0] is a format constant beside no value printed in RFC §A.2.5 ("ECDSA, 256 Bits (Prime Field)"): another part of expect must be printed there and bound',
  )
  t.eqStr(
    "the format beside a value not printed",
    bpcTestFormatGate(bpcTestEcRfc(1), bpcTestPoint(`{"hex": "${BPC_UY}", "label": "Ux"}`, uy)),
    `V1.expect.concat[1]: the value is printed in RFC §A.2.5 ("ECDSA, 256 Bits (Prime Field)") under "Uy", not under "Ux"`,
  )
}

/** Byte parts: read, write, shape and fidelity. */
export const main = (): i32 => {
  const t = new Suite("spec/contract byte parts")
  bpcTestReadWrite(t)
  bpcTestShapes(t)
  bpcTestTails(t)
  bpcTestFormats(t)
  return t.done()
}
