import { Suite } from "nish/testing"
import { CheckContext } from "../../../src/spec/check"
import { contractParse } from "../../../src/spec/contract/read"
import { gateQuoteWhole } from "../../../src/spec/gates/cite"
import { gateFidelity } from "../../../src/spec/gates/fidelity"
import { LoadedSource, SourceSet } from "../../../src/spec/source/load"
import { rfcParse } from "../../../src/spec/source/rfc"

/** A contract whose quotes and vectors are each right or wrong in one way. */
const FIDELITY_TEST_C: string = `{
  "contract": "c1",
  "source": {"title": "T", "rfc": 9999},
  "target": {"module": "nish/x"},
  "requirements": [
    {"id": "R1", "section": "2", "level": "MUST", "quote": "It MUST return the key."},
    {"id": "R2", "section": "2", "level": "MUST", "quote": "It MUST return the lock."},
    {"id": "R3", "section": "2", "level": "MUST", "quote": "ST return the ke"},
    {"id": "R4", "section": "2", "level": "MUST", "quote": "Hello there."},
    {"id": "R5", "section": "2", "level": "MUST", "quote": "return the key"}
  ],
  "functions": [
    {"name": "f", "params": [{"name": "a", "type": "bytes"}, {"name": "b", "type": "bytes"}], "returns": "bytes"},
    {"name": "g", "params": [{"name": "a", "type": "bytes"}, {"name": "n", "type": "u32"}], "returns": "bytes"},
    {"name": "hmacSha256", "params": [{"name": "a", "type": "bytes"}], "returns": "bytes"},
    {"name": "s", "params": [{"name": "a", "type": "string"}], "returns": "bytes"}
  ],
  "clauses": [
    {"kind": "vector", "id": "V1", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "3"}}, "call": "f",
     "args": [{"hex": "0001", "label": "salt"}, {"hex": "0b0b0b0b", "label": "IKM"}], "expect": {"hex": "aabb", "label": "OKM"}},
    {"kind": "vector", "id": "V2", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "3"}}, "call": "f",
     "args": [{"hex": "0b0b0b0b", "label": "salt"}, {"hex": "0b0b", "label": "IKM"}], "expect": {"hex": "ccdd"}},
    {"kind": "vector", "id": "V3", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "3"}}, "call": "f",
     "args": [{"hex": "0001"}, {"hex": "0b0b0b0b", "label": "IKM"}], "expect": {"hex": "0b0b0b0b", "label": "IKM"}},
    {"kind": "vector", "id": "V4", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "3"}}, "call": "g",
     "args": [{"hex": "0001", "label": "salt"}, {"int": 43, "label": "L"}], "expect": {"hex": "aabb", "label": "OKM"}},
    {"kind": "vector", "id": "V5", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "4"}}, "call": "f",
     "args": [{"hex": "01", "label": "Key"}, {"hex": "04", "label": "Data"}], "expect": {"hex": "aabb", "unchecked": "computed"}},
    {"kind": "vector", "id": "V6", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "5"}}, "call": "hmacSha256",
     "args": [{"hex": "1111"}], "expect": {"hex": "2222", "label": "HMAC-SHA-512"}},
    {"kind": "vector", "id": "V7", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "6"}}, "call": "s",
     "args": [{"str": "ab"}], "expect": {"hex": "aabb", "label": "OKM", "unchecked": "computed"}},
    {"kind": "vector", "id": "V8", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "6"}}, "call": "s",
     "args": [{"str": "abc"}], "expect": {"hex": "aabb", "label": "OKM", "unchecked": "computed"}},
    {"kind": "vector", "id": "V9", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "6"}}, "call": "s",
     "args": [{"str": ""}], "expect": {"hex": "aabb", "label": "OKM", "unchecked": "computed"}},
    {"kind": "vector", "id": "V10", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "4"}}, "call": "f",
     "args": [{"hex": "03", "label": "Key"}, {"hex": "04", "label": "Data"}], "expect": {"hex": "aabb", "unchecked": "computed"}}
  ]
}`

/** The RFC the contract cites. */
const FIDELITY_TEST_RFC: string = `Request for Comments: 9999

1.  Intro

   Hello there.

2.  Rules

   It MUST return the key.

3.  Test Case

   salt = 0x0001
   IKM  = 0x0b0b0b0b
   L    = 42
   OKM  = 0xaabb

4.  Rounds

   Key = 0x01
   Data = 0x02
   Key = 0x03
   Data = 0x04

5.  Variants

   HMAC-SHA-256 = 0x1111
   HMAC-SHA-512 = 0x2222

6.  Strings

   Message: "abc"
`

/** A context with the contract and a hand-built source set. */
const fidelityTestCtx = (): CheckContext => {
  const ctx = new CheckContext("contracts/c1.json", ".")
  ctx.contract = contractParse(FIDELITY_TEST_C, "c1").expect("parse")
  const set = new SourceSet()
  set.main = "rfc9999"
  set.sources.push(new LoadedSource("rfc9999", "r.txt", "r.txt", rfcParse(FIDELITY_TEST_RFC)))
  ctx.sources = set
  return ctx
}

/** Whether a finding starting with `head` holds `body`. */
const fidelityTestHas = (all: string[], head: string, body: string): boolean =>
  all.some((f: string): boolean => f.indexOf(head) === 0 && f.indexOf(body) >= 0)

/** The fidelity gate. */
export const main = (): i32 => {
  const t = new Suite("spec/gates/fidelity")
  const all = gateFidelity(fidelityTestCtx())
  t.ok("a quote that is there", !fidelityTestHas(all, "R1:", ""))
  t.ok(
    "an altered quote",
    fidelityTestHas(all, "R2:", `quote not found in RFC §2 ("Rules"): "It MUST return the lock."`),
  )
  t.ok(
    "a quote cut mid-word",
    fidelityTestHas(all, "R3:", `the quote starts or ends inside a word: "ST return the ke"`),
  )
  t.ok("a sibling section's quote", fidelityTestHas(all, "R4:", `quote not found in RFC §2 ("Rules"): "Hello there."`))
  t.ok("whole words inside a sentence", !fidelityTestHas(all, "R5:", ""))
  t.ok("a true vector", !fidelityTestHas(all, "V1:", "") && !fidelityTestHas(all, "V1.", ""))
  t.ok("under another label", fidelityTestHas(all, "V2.args[0]:", `under "IKM", not under "salt"`))
  t.ok("part of a value", fidelityTestHas(all, "V2.args[1]:", "2-byte value is only part of a value"))
  t.ok("not printed", fidelityTestHas(all, "V2.expect:", "2-byte value is not printed in RFC §3"))
  t.ok("a label it needs", fidelityTestHas(all, "V3.args[0]:", `under "salt": name it with "label"`))
  t.ok("an input as the result", fidelityTestHas(all, "V3.expect:", "an input is not the expected result"))
  t.ok("an unprinted integer", fidelityTestHas(all, "V4.args[1]:", `RFC §3 does not print "L" followed by 43`))
  t.ok("different rounds", fidelityTestHas(all, "V5:", "so they are from different test cases"))
  t.ok("one round", !fidelityTestHas(all, "V10:", "") && !fidelityTestHas(all, "V10.", ""))
  t.ok("another variant", fidelityTestHas(all, "V6.expect:", "hmacSha256 names 256"))
  t.ok("part of a string", fidelityTestHas(all, "V7.args[0]:", "only part of a longer value"))
  t.ok("a whole string", !fidelityTestHas(all, "V8:", "") && !fidelityTestHas(all, "V8.", ""))
  t.ok("an empty string", fidelityTestHas(all, "V9.args[0]:", "the empty value is not printed"))
  t.ok("findings", all.length === 14)
  if (all.length !== 14) {
    console.log(all.join("\n"))
  }
  t.ok("a whole-word quote", gateQuoteWhole("It MUST NOT fail.", "MUST NOT fail."))
  t.ok("not inside a word at its start", !gateQuoteWhole("the MUSTARD jar", "TARD jar"))
  t.ok("not inside a word at its end", !gateQuoteWhole("the MUSTARD jar", "the MUST"))
  t.ok("a later occurrence can be whole", gateQuoteWhole("MUSTARD, then MUST", "MUST"))
  t.ok("punctuation bounds itself", gateQuoteWhole("a.b", ".b"))
  return t.done()
}
