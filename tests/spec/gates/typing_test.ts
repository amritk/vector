import { Suite } from "nish/testing"
import { CheckContext } from "../../../src/spec/check"
import { contractParse } from "../../../src/spec/contract/read"
import { gateMisfit, gateTyping } from "../../../src/spec/gates/typing"

/** A contract whose vectors and property are mistyped in every way the gate names. */
const TYPING_TEST_BAD: string = `{
  "contract": "c1",
  "source": {"title": "T", "rfc": 4648},
  "target": {"module": "nish/hex"},
  "requirements": [{"id": "R1", "section": "3.1", "level": "MUST", "quote": "Q"}],
  "functions": [
    {"name": "enc", "params": [{"name": "b", "type": "bytes"}], "returns": "string"},
    {"name": "inc", "params": [{"name": "n", "type": "u8"}, {"name": "n", "type": "u8"}], "returns": "u8"}
  ],
  "clauses": [
    {"kind": "vector", "id": "V1", "title": "t", "covers": ["R1"],
     "source": {"cite": {"section": "10"}}, "call": "nope", "args": [], "expect": {"str": ""}},
    {"kind": "vector", "id": "V2", "title": "t", "covers": ["R1"],
     "source": {"cite": {"section": "10"}}, "call": "enc", "args": [{"str": "x"}, {"hex": "00"}], "expect": {"hex": "00"}},
    {"kind": "vector", "id": "V3", "title": "t", "covers": ["R1"],
     "source": {"cite": {"section": "10"}}, "call": "inc", "args": [{"int": 300}, {"int": 1}], "expect": {"int": 2}},
    {"kind": "property", "id": "P1", "title": "t", "covers": ["R1"],
     "forall": [{"name": "x", "type": "u8", "min": 0, "max": 9}, {"name": "x", "type": "u8", "min": 0, "max": 9}],
     "where": {"var": "x"}, "assert": {"call": "inc", "args": [{"var": "x"}, {"var": "x"}]}}
  ]
}`

/** A contract whose iterated vectors feed each parameter a wrong type, and one that feeds them right. */
const TYPING_TEST_ITERATE: string = `{
  "contract": "c2",
  "source": {"title": "T", "rfc": 7748},
  "target": {"module": "nish/x"},
  "requirements": [{"id": "R1", "section": "5.2", "level": "MUST", "quote": "Q"}],
  "functions": [
    {"name": "hash", "params": [{"name": "b", "type": "bytes"}], "returns": "string"},
    {"name": "mix", "params": [{"name": "a", "type": "bytes"}, {"name": "n", "type": "u8"}], "returns": "bytes?"},
    {"name": "ladder", "params": [{"name": "k", "type": "secret-bytes"}, {"name": "u", "type": "bytes"}], "returns": "bytes"}
  ],
  "clauses": [
    {"kind": "vector", "id": "I1", "title": "t", "covers": ["R1"],
     "source": {"cite": {"section": "5.2"}}, "call": "hash", "args": [{"hex": "00"}], "expect": {"str": "x"},
     "iterate": {"count": 2, "names": ["b"], "next": [{"call": "hash", "args": [{"var": "b"}]}]}},
    {"kind": "vector", "id": "I2", "title": "t", "covers": ["R1"],
     "source": {"cite": {"section": "5.2"}}, "call": "mix", "args": [{"hex": "00"}, {"int": 1}], "expect": {"hex": "00"},
     "iterate": {"count": 2, "names": ["a", "n"], "next": [{"call": "mix", "args": [{"var": "a"}, {"var": "n"}]}, {"var": "a"}]}},
    {"kind": "vector", "id": "I3", "title": "t", "covers": ["R1"],
     "source": {"cite": {"section": "5.2"}}, "call": "ladder", "args": [{"hex": "09"}, {"hex": "09"}], "expect": {"hex": "00"},
     "iterate": {"count": 2, "names": ["k", "u"], "next": [{"call": "ladder", "args": [{"var": "k"}, {"var": "u"}]}, {"var": "k"}]}}
  ]
}`

/** The typing gate. */
export const main = (): i32 => {
  const t = new Suite("spec/gates/typing")
  const ctx = new CheckContext("contracts/c1.json", ".")
  const parsed = contractParse(TYPING_TEST_BAD, "bad")
  ctx.contract = parsed.expect("parse")
  const found = gateTyping(ctx)
  const all = found.join("\n")
  t.ok("a repeated parameter", all.indexOf(`inc: duplicate parameter "n"`) >= 0)
  t.ok("an unknown function", all.indexOf(`V1: unknown function "nope"`) >= 0)
  t.ok("the argument count", all.indexOf("V2: enc takes 1 argument(s), got 2") >= 0)
  t.ok("an argument's type", all.indexOf("V2: args[0]: enc(b) wants bytes, got string") >= 0)
  t.ok("the expected value's type", all.indexOf("V2: expect: enc returns string, got bytes") >= 0)
  t.ok("an int out of range", all.indexOf("V3: args[0]: inc(n) wants u8, got 300, outside u8's 0..255") >= 0)
  t.ok("a repeated variable", all.indexOf(`P1: duplicate variable "x"`) >= 0)
  t.ok("a non-bool where", all.indexOf("P1: where: must be bool, got u8") >= 0)
  t.ok("a non-bool assert", all.indexOf("P1: assert: must be bool, got u8") >= 0)
  t.ok("every finding is noted", ctx.notes.length === found.length)
  t.eqStr(
    "misfit names a non-int's type",
    gateMisfit(contractParse(TYPING_TEST_BAD, "b").expect("p").clauses[1].args[0], "bytes"),
    "string",
  )

  // An iterated vector: what each next element feeds must be its parameter's type.
  const ictx = new CheckContext("contracts/c2.json", ".")
  ictx.contract = contractParse(TYPING_TEST_ITERATE, "iterate").expect("parse")
  const ifound = gateTyping(ictx)
  t.eqStr(
    "an iterated vector feeds each parameter its own type",
    ifound.join("\n"),
    [
      "I1: iterate.next[0]: hash returns string, and hash(b) wants bytes",
      "I2: iterate.next[1]: a is mix(a), a bytes, and mix(n) wants u8",
    ].join("\n"),
  )
  return t.done()
}
