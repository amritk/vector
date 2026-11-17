import { Suite } from "nish/testing"
import { replaceAll } from "nish/text"
import { CheckContext } from "../../../src/spec/check"
import { literalsByteLength } from "../../../src/spec/contract/literals"
import { contractParse } from "../../../src/spec/contract/read"
import { contractShapeErrors } from "../../../src/spec/contract/shape"
import { Contract } from "../../../src/spec/contract/types"
import { contractWrite } from "../../../src/spec/contract/write"
import { gateFidelity } from "../../../src/spec/gates/fidelity"
import { gateTyping } from "../../../src/spec/gates/typing"
import { LoadedSource, SourceSet } from "../../../src/spec/source/load"
import { rfcParse } from "../../../src/spec/source/rfc"

// A vector's `truncate`: read and written in the unit the spec prints, shaped
// against its expect, typed against its call, and its length held to the
// cited section by the fidelity gate.

const TRUNC_TEST_KEY: string = "0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c"
const TRUNC_TEST_DATA: string = "546573742057697468205472756e636174696f6e"
const TRUNC_TEST_MAC: string = "a3b6167473100ee06e0c796c2955552b"

/** One vector of RFC 4231 §4.6, its `truncate` replaced by TRUNC and its cited section by SECTION. */
const truncTestTemplate = (): string => `{
  "contract": "c1",
  "source": {"title": "T", "rfc": 4231},
  "target": {"module": "nish/crypto/hmac"},
  "requirements": [{"id": "R1", "section": "4.6", "level": "MUST", "quote": "Test with a truncation of output to 128 bits."}],
  "functions": [
    {"name": "hmacSha256", "params": [{"name": "key", "type": "secret-bytes"}, {"name": "data", "type": "bytes"}], "returns": "bytes"},
    {"name": "hmacHex", "params": [{"name": "key", "type": "bytes"}, {"name": "data", "type": "bytes"}], "returns": "string"}
  ],
  "clauses": [
    {"kind": "vector", "id": "T1", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "SECTION"}}, "call": "CALL",
     "args": [{"hex": "${TRUNC_TEST_KEY}", "label": "Key"}, {"hex": "${TRUNC_TEST_DATA}", "label": "Data"}],
     "expect": EXPECT, "truncate": TRUNC}
  ]
}`

/** TRUNC_TEST_C with each placeholder filled. */
const truncTestText = (section: string, call: string, expect: string, trunc: string): string =>
  replaceAll(
    replaceAll(replaceAll(replaceAll(truncTestTemplate(), "SECTION", section), "CALL", call), "EXPECT", expect),
    "TRUNC",
    trunc,
  )

/** The §4.6 HMAC-SHA-256 expect, its first `n` hex digits. */
const truncTestExpect = (n: i32): string => `{"hex": "${TRUNC_TEST_MAC.substring(0, n)}", "label": "HMAC-SHA-256"}`

/** The read errors of `trunc` on the §4.6 vector, prefixed "read: ", then its shape errors; "" when none. */
const truncTestShape = (expect: string, trunc: string): string => {
  const c = contractParse(truncTestText("4.6", "hmacSha256", expect, trunc), "c1")
  if (c.isErr()) {
    return c.error.map((e: string): string => `read: ${e}`).join("\n")
  }
  return contractShapeErrors(c.value).join("\n")
}

/** The contract of `text`, which must read. */
const truncTestContract = (text: string): Contract => contractParse(text, "c1").expect("parse")

/** The fidelity findings of the vector, citing `section`, expecting `expect`, truncated by `trunc`. */
const truncTestFidelity = (section: string, expect: string, trunc: string): string => {
  const ctx = new CheckContext("contracts/c1.json", ".")
  ctx.contract = truncTestContract(truncTestText(section, "hmacSha256", expect, trunc))
  const set = new SourceSet()
  set.main = "rfc4231"
  const file = "tests/fixtures/profile/rfc4231.txt"
  set.sources.push(new LoadedSource("rfc4231", file, file, rfcParse(readFileSyncOrNull(file) ?? "")))
  ctx.sources = set
  return gateFidelity(ctx).join("\n")
}

/** read: each malformed truncate refused; write: the unit kept. */
const truncTestReadWrite = (t: Suite): void => {
  const e = truncTestExpect(32)
  t.eqStr("128 bits reads", truncTestShape(e, `{"bits": 128}`), "")
  t.eqStr("16 bytes reads", truncTestShape(e, `{"bytes": 16}`), "")
  const bad: string[] = [
    "{}",
    `{"bits": 128, "bytes": 16}`,
    `{"bits": 0}`,
    `{"bits": -8}`,
    `{"bits": 127}`,
    `{"bits": 524296}`,
    `{"bytes": 0}`,
    `{"bytes": -1}`,
    `{"bytes": 65537}`,
    `{"bits": "128"}`,
    `{"bits": 128, "unit": "bits"}`,
    "128",
  ]
  const want: string[] = [
    "read: clauses[0].truncate: exactly one of bits or bytes",
    "read: clauses[0].truncate: exactly one of bits or bytes",
    "read: clauses[0].truncate.bits: an integer in 8..524288",
    "read: clauses[0].truncate.bits: an integer in 8..524288",
    "read: clauses[0].truncate.bits: a whole number of bytes: a multiple of 8",
    "read: clauses[0].truncate.bits: an integer in 8..524288",
    "read: clauses[0].truncate.bytes: an integer in 1..65536",
    "read: clauses[0].truncate.bytes: an integer in 1..65536",
    "read: clauses[0].truncate.bytes: an integer in 1..65536",
    "read: clauses[0].truncate.bits: an integer in 8..524288",
    'read: clauses[0].truncate: unknown field "unit"',
    "read: clauses[0].truncate: an object",
  ]
  for (let i = 0; i < bad.length; i++) {
    t.eqStr(`read refuses ${bad[i]}`, truncTestShape(e, bad[i]), want[i])
  }
  for (const tr of [`{"bits": 128}`, `{"bytes": 16}`]) {
    const c = truncTestContract(truncTestText("4.6", "hmacSha256", e, tr))
    const w = contractWrite(c)
    const unit = tr.indexOf("bits") >= 0 ? `"bits": 128` : `"bytes": 16`
    t.ok(`${tr} is written as it reads`, w.indexOf(unit) >= 0)
    t.eqStr(`${tr} round-trips`, contractWrite(truncTestContract(w)), w)
  }
  const none = contractWrite(
    truncTestContract(replaceAll(truncTestText("4.6", "hmacSha256", e, "X"), `, "truncate": X`, "")),
  )
  t.ok("an untruncated vector writes no truncate", none.indexOf("truncate") < 0)
}

/** shape: the expect is bytes of the length, and no tolerance or iterate beside it. */
const truncTestShapes = (t: Suite): void => {
  const at = "clauses[0].truncate"
  const cases: string[] = [
    truncTestExpect(24),
    truncTestExpect(30),
    `{"hex": "${TRUNC_TEST_MAC}00", "label": "HMAC-SHA-256"}`,
    `{"str": "${TRUNC_TEST_MAC}"}`,
    `{"int": 1}`,
  ]
  const want: string[] = [
    `${at}: the expect is 12 bytes, so the truncation is 12 bytes (96 bits), not 16 bytes (128 bits)`,
    `${at}: the expect is 15 bytes, so the truncation is 15 bytes (120 bits), not 16 bytes (128 bits)`,
    `${at}: the expect is 17 bytes, so the truncation is 17 bytes (136 bits), not 16 bytes (128 bits)`,
    `${at}: a truncated vector's expect is bytes, not string`,
    `${at}: a truncated vector's expect is bytes, not i32`,
  ]
  for (let i = 0; i < cases.length; i++) {
    t.eqStr(`shape: ${want[i]}`, truncTestShape(cases[i], `{"bits": 128}`), want[i])
  }
  t.eqStr(
    "a null expect",
    truncTestShape(`{"null": true}`, `{"bits": 128}`),
    `${at}: a truncated vector's expect is bytes, not null`,
  )
  t.eqStr("a repeated run's length", truncTestShape(`{"hex": "a3", "repeat": 16}`, `{"bytes": 16}`), "")
  t.eqStr(
    "beside a tolerance",
    truncTestShape(truncTestExpect(32), `{"bits": 128}, "tolerance": {"ulps": 1, "section": "4.6", "quote": "q"}`),
    `${at}: a truncated vector compares bytes exactly; drop the tolerance`,
  )
  const iter = `{"bits": 128}, "iterate": {"count": 2, "names": ["key", "data"], "next": [{"var": "key"}, {"call": "hmacSha256", "args": [{"var": "key"}, {"var": "data"}]}]}`
  t.eqStr(
    "beside an iterate",
    truncTestShape(truncTestExpect(32), iter),
    `${at}: a vector is truncated or iterated, not both`,
  )
}

/** The byte length of the §4.6 vector's expect when it is `expect`. */
const truncTestLit = (expect: string): i64 => {
  const e = truncTestContract(truncTestText("4.6", "hmacSha256", expect, `{"bits": 128}`)).clauses[0].expect
  if (e === null) {
    return toI64(-2)
  }
  return literalsByteLength(e)
}

/** The bytes a literal stands for, -1 for what is no bytes. */
const truncTestByteLength = (t: Suite): void => {
  t.ok("hex", truncTestLit(truncTestExpect(32)) === toI64(16))
  t.ok("empty hex", truncTestLit(`{"hex": ""}`) === toI64(0))
  t.ok("a repeated run", truncTestLit(`{"hex": "0b0c", "repeat": 3}`) === toI64(6))
  t.ok("a string", truncTestLit(`{"str": "ab"}`) === toI64(-1))
  t.ok("an int", truncTestLit(`{"int": 16}`) === toI64(-1))
}

/** The typing findings of the §4.6 vector calling `call`. */
const truncTestTypingOf = (call: string): string => {
  const ctx = new CheckContext("contracts/c1.json", ".")
  ctx.contract = truncTestContract(truncTestText("4.6", call, truncTestExpect(32), `{"bits": 128}`))
  return gateTyping(ctx).join("\n")
}

/** typing: only a call that returns bytes is truncated. */
const truncTestTyping = (t: Suite): void => {
  t.eqStr("a bytes result", truncTestTypingOf("hmacSha256"), "")
  t.ok(
    "a string result",
    truncTestTypingOf("hmacHex").indexOf(
      "T1: truncate: hmacHex returns string, and only a bytes result is truncated",
    ) >= 0,
  )
}

/** fidelity: the length printed with its unit in the cited section, and the expect a whole printed value there. */
const truncTestFidelityCases = (t: Suite): void => {
  t.eqStr("§4.6 at 128 bits", truncTestFidelity("4.6", truncTestExpect(32), `{"bits": 128}`), "")
  const t5 = `RFC §4.6 ("Test Case 5")`
  const t1 = `RFC §4.2 ("Test Case 1")`
  const sections: string[] = ["4.6", "4.6", "4.2"]
  const expects: string[] = [truncTestExpect(32), truncTestExpect(24), truncTestExpect(32)]
  const truncs: string[] = [`{"bytes": 16}`, `{"bits": 96}`, `{"bits": 128}`]
  const want: string[] = [
    `T1.truncate: the truncation to 16 bytes is not printed in ${t5}`,
    `T1.truncate: the truncation to 96 bits is not printed in ${t5}\nT1.expect: 12-byte value is only part of a value printed in ${t5} (under "HMAC-SHA-256"): a vector uses whole printed values (concat them to join several)`,
    `T1.truncate: the truncation to 128 bits is not printed in ${t1}\nT1.args[0]: 20-byte value is not printed in ${t1}\nT1.args[1]: 20-byte value is not printed in ${t1}\nT1.expect: 16-byte value is not printed in ${t1}`,
  ]
  for (let i = 0; i < want.length; i++) {
    t.eqStr(
      `fidelity: §${sections[i]} truncated by ${truncs[i]}`,
      truncTestFidelity(sections[i], expects[i], truncs[i]),
      want[i],
    )
  }
}

/** A vector's truncate, through read, write, shape, typing and fidelity. */
export const main = (): i32 => {
  const t = new Suite("spec/contract truncate")
  truncTestReadWrite(t)
  truncTestShapes(t)
  truncTestByteLength(t)
  truncTestTyping(t)
  truncTestFidelityCases(t)
  return t.done()
}
