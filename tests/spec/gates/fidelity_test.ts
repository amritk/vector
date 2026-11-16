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
    {"name": "s", "params": [{"name": "a", "type": "string"}], "returns": "bytes"},
    {"name": "h", "params": [{"name": "a", "type": "bytes"}], "returns": "string"}
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
     "args": [{"hex": "03", "label": "Key"}, {"hex": "04", "label": "Data"}], "expect": {"hex": "aabb", "unchecked": "computed"}},
    {"kind": "vector", "id": "V11", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "7"}}, "call": "h",
     "args": [{"hex": "000ff0ff"}], "expect": {"str": "000ff0ff"}},
    {"kind": "vector", "id": "V12", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "7"}}, "call": "h",
     "args": [{"hex": "000ff0fe"}], "expect": {"str": "000ff0ff"}},
    {"kind": "vector", "id": "V13", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "7"}}, "call": "h",
     "args": [{"hex": "10"}], "expect": {"str": "000ff0ff"}}
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

7.  Calls

   hexEncode([00 0f f0 ff]) returns "000ff0ff". See [10].
`

/** A contract of iterated vectors, each binding its count to its section rightly or in one wrong way. */
const FIDELITY_TEST_ITER: string = `{
  "contract": "c2",
  "source": {"title": "T", "rfc": 9998},
  "target": {"module": "nish/x"},
  "requirements": [{"id": "R1", "section": "1", "level": "MUST", "quote": "It MUST iterate."}],
  "functions": [
    {"name": "x25519", "params": [{"name": "k", "type": "bytes"}, {"name": "u", "type": "bytes"}], "returns": "bytes"}
  ],
  "clauses": [
    {"kind": "vector", "id": "I1", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "1"}}, "call": "x25519",
     "args": [{"hex": "0909", "label": "For X25519"}, {"hex": "0909", "label": "For X25519"}], "expect": {"hex": "2222", "label": "After 1000 iterations"},
     "iterate": {"count": 1000, "names": ["k", "u"], "next": [{"call": "x25519", "args": [{"var": "k"}, {"var": "u"}]}, {"var": "k"}]}},
    {"kind": "vector", "id": "I2", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "2"}}, "call": "x25519",
     "args": [{"hex": "0909", "label": "For X25519"}, {"hex": "0909", "label": "For X25519"}], "expect": {"hex": "2222", "label": "After 1,000 iterations"},
     "iterate": {"count": 1000, "names": ["k", "u"], "next": [{"call": "x25519", "args": [{"var": "k"}, {"var": "u"}]}, {"var": "k"}]}},
    {"kind": "vector", "id": "I3", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "2"}}, "call": "x25519",
     "args": [{"hex": "0909", "label": "For X25519"}, {"hex": "0909", "label": "For X25519"}], "expect": {"hex": "3333", "label": "After 1,000,000 iterations"},
     "iterate": {"count": 1000000, "names": ["k", "u"], "next": [{"call": "x25519", "args": [{"var": "k"}, {"var": "u"}]}, {"var": "k"}]}},
    {"kind": "vector", "id": "I4", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "2"}}, "call": "x25519",
     "args": [{"hex": "0909", "label": "For X25519"}, {"hex": "0909", "label": "For X25519"}], "expect": {"hex": "3333", "label": "After 1,000,000 iterations"},
     "iterate": {"count": 1000, "names": ["k", "u"], "next": [{"call": "x25519", "args": [{"var": "k"}, {"var": "u"}]}, {"var": "k"}]}},
    {"kind": "vector", "id": "I5", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "3"}}, "call": "x25519",
     "args": [{"hex": "0909", "label": "For X25519"}, {"hex": "0909", "label": "For X25519"}], "expect": {"hex": "2222", "label": "Result"},
     "iterate": {"count": 1000, "names": ["k", "u"], "next": [{"call": "x25519", "args": [{"var": "k"}, {"var": "u"}]}, {"var": "k"}]}},
    {"kind": "vector", "id": "I6", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "3"}}, "call": "x25519",
     "args": [{"hex": "0909", "label": "For X25519"}, {"hex": "0909", "label": "For X25519"}], "expect": {"hex": "2222", "label": "Result"},
     "iterate": {"count": 25519, "names": ["k", "u"], "next": [{"call": "x25519", "args": [{"var": "k"}, {"var": "u"}]}, {"var": "k"}]}},
    {"kind": "vector", "id": "I7", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "3"}}, "call": "x25519",
     "args": [{"hex": "0909", "label": "For X25519"}, {"hex": "0909", "label": "For X25519"}], "expect": {"hex": "2222", "label": "Result"},
     "iterate": {"count": 21000, "names": ["k", "u"], "next": [{"call": "x25519", "args": [{"var": "k"}, {"var": "u"}]}, {"var": "k"}]}},
    {"kind": "vector", "id": "I8", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "3"}}, "call": "x25519",
     "args": [{"hex": "0909", "label": "For X25519"}, {"hex": "0909", "label": "For X25519"}], "expect": {"hex": "2222", "label": "Result"},
     "iterate": {"count": 100, "names": ["k", "u"], "next": [{"call": "x25519", "args": [{"var": "k"}, {"var": "u"}]}, {"var": "k"}]}},
    {"kind": "vector", "id": "I9", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "3"}}, "call": "x25519",
     "args": [{"hex": "0909", "label": "For X25519"}, {"hex": "0909", "label": "For X25519"}], "expect": {"hex": "2222", "label": "Result"},
     "iterate": {"count": 10000, "names": ["k", "u"], "next": [{"call": "x25519", "args": [{"var": "k"}, {"var": "u"}]}, {"var": "k"}]}},
    {"kind": "vector", "id": "I10", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "3"}}, "call": "x25519",
     "args": [{"hex": "0909", "label": "For X25519"}, {"hex": "0909", "label": "For X25519"}], "expect": {"hex": "2222", "label": "Result"},
     "iterate": {"count": 3, "names": ["k", "u"], "next": [{"call": "x25519", "args": [{"var": "k"}, {"var": "u"}]}, {"var": "k"}]}},
    {"kind": "vector", "id": "I11", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "3"}}, "call": "x25519",
     "args": [{"hex": "0909", "label": "For X25519"}, {"hex": "0909", "label": "For X25519"}], "expect": {"hex": "2222", "label": "Result"},
     "iterate": {"count": 256, "names": ["k", "u"], "next": [{"call": "x25519", "args": [{"var": "k"}, {"var": "u"}]}, {"var": "k"}]}},
    {"kind": "vector", "id": "I12", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "5.2"}}, "call": "x25519",
     "args": [{"hex": "0909", "label": "For X25519"}, {"hex": "0909", "label": "For X25519"}], "expect": {"hex": "2222", "label": "After 1000 iterations"},
     "iterate": {"count": 2, "names": ["k", "u"], "next": [{"call": "x25519", "args": [{"var": "k"}, {"var": "u"}]}, {"var": "k"}]}},
    {"kind": "vector", "id": "I13", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "5.2"}}, "call": "x25519",
     "args": [{"hex": "0909", "label": "For X25519"}, {"hex": "0909", "label": "For X25519"}], "expect": {"hex": "2222", "label": "After 1000 iterations"},
     "iterate": {"count": 5, "names": ["k", "u"], "next": [{"call": "x25519", "args": [{"var": "k"}, {"var": "u"}]}, {"var": "k"}]}},
    {"kind": "vector", "id": "I14", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "5.2"}}, "call": "x25519",
     "args": [{"hex": "0808", "label": "For X448"}, {"hex": "0909", "label": "For X25519"}], "expect": {"hex": "2222", "label": "After 1000 iterations"},
     "iterate": {"count": 1000, "names": ["k", "u"], "next": [{"call": "x25519", "args": [{"var": "k"}, {"var": "u"}]}, {"var": "k"}]}},
    {"kind": "vector", "id": "I15", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "6"}}, "call": "x25519",
     "args": [{"hex": "0909", "label": "For X25519"}, {"hex": "0909", "label": "For X25519"}], "expect": {"hex": "0808", "label": "For X448"},
     "iterate": {"count": 448, "names": ["k", "u"], "next": [{"call": "x25519", "args": [{"var": "k"}, {"var": "u"}]}, {"var": "k"}]}},
    {"kind": "vector", "id": "I16", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "3"}}, "call": "x25519",
     "args": [{"hex": "0909", "label": "For X25519"}, {"hex": "0909", "label": "For X25519"}], "expect": {"hex": "2222", "label": "Result"},
     "iterate": {"count": 1000000, "names": ["k", "u"], "next": [{"call": "x25519", "args": [{"var": "k"}, {"var": "u"}]}, {"var": "k"}]}}
  ]
}`

/** The RFC the iterated vectors cite: counts printed whole, grouped, inside other words, and as headings. */
const FIDELITY_TEST_ITER_RFC: string = `Request for Comments: 9998

1.  Plain

   It MUST iterate.

   For X25519 = 0x0909
   After 1000 iterations = 0x2222

2.  Grouped

   For X25519 = 0x0909
   After 1,000 iterations = 0x2222
   After 1,000,000 iterations = 0x3333

3.  Bounds

   Not counts: a1000, 1000a, X25519, 0.1000, 1,00, 1,0000, 10,00,000, SHA-256 and 1,000,0000.
   A count: 21000.

   For X25519 = 0x0909
   Result = 0x2222

5.  Variants

5.2.  Iterated

   For X25519 = 0x0909
   For X448 = 0x0808
   After 1000 iterations = 0x2222

6.  Counted

   Run it 448 times.

   For X25519 = 0x0909
   For X448 = 0x0808
`

/** The iterated vectors' findings. */
const fidelityTestIter = (): string[] => {
  const ctx = new CheckContext("contracts/c2.json", ".")
  ctx.contract = contractParse(FIDELITY_TEST_ITER, "c2").expect("parse")
  const set = new SourceSet()
  set.main = "rfc9998"
  set.sources.push(new LoadedSource("rfc9998", "r.txt", "r.txt", rfcParse(FIDELITY_TEST_ITER_RFC)))
  ctx.sources = set
  return gateFidelity(ctx)
}

/** A context with the contract and a hand-built source set, its RFC read from `file`. */
const fidelityTestCtx = (file: string): CheckContext => {
  const ctx = new CheckContext("contracts/c1.json", ".")
  ctx.contract = contractParse(FIDELITY_TEST_C, "c1").expect("parse")
  const set = new SourceSet()
  set.main = "rfc9999"
  set.sources.push(new LoadedSource("rfc9999", file, file, rfcParse(FIDELITY_TEST_RFC)))
  ctx.sources = set
  return ctx
}

/** Whether a finding starting with `head` holds `body`. */
const fidelityTestHas = (all: string[], head: string, body: string): boolean =>
  all.some((f: string): boolean => f.indexOf(head) === 0 && f.indexOf(body) >= 0)

/** The fidelity gate. */
export const main = (): i32 => {
  const t = new Suite("spec/gates/fidelity")
  const all = gateFidelity(fidelityTestCtx("r.txt"))
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
  t.ok("a byte list in plain text is not a value", fidelityTestHas(all, "V11.args[0]:", "4-byte value is not printed"))
  t.ok("a reference in plain text is not a value", fidelityTestHas(all, "V13.args[0]:", "1-byte value is not printed"))
  const xml = gateFidelity(fidelityTestCtx("r.xml"))
  t.ok("bytes printed in brackets, from XML", !fidelityTestHas(xml, "V11", ""))
  t.ok("a bracketed byte list in XML, not a reference", !fidelityTestHas(xml, "V13", ""))
  t.ok("other bytes than the brackets'", fidelityTestHas(xml, "V12.args[0]:", "4-byte value is not printed in RFC §7"))
  t.ok("another variant", fidelityTestHas(all, "V6.expect:", "hmacSha256 names 256"))
  t.ok("part of a string", fidelityTestHas(all, "V7.args[0]:", "only part of a longer value"))
  t.ok("a whole string", !fidelityTestHas(all, "V8:", "") && !fidelityTestHas(all, "V8.", ""))
  t.ok("an empty string", fidelityTestHas(all, "V9.args[0]:", "the empty value is not printed"))
  t.ok("findings", all.length === 17)
  if (all.length !== 17) {
    console.log(all.join("\n"))
  }
  const it = fidelityTestIter()
  t.ok("a count printed whole", !fidelityTestHas(it, "I1:", "") && !fidelityTestHas(it, "I1.", ""))
  t.ok("a count printed grouped", !fidelityTestHas(it, "I2", "") && !fidelityTestHas(it, "I3", ""))
  t.ok(
    "an expected label that counts other rounds",
    fidelityTestHas(
      it,
      "I4.expect:",
      `"After 1,000,000 iterations" counts 1,000,000, but the vector iterates 1,000 times`,
    ),
  )
  t.ok("not a count inside a word", fidelityTestHas(it, "I5:", "the count 1,000 is not printed in RFC §3"))
  t.ok("not a count in a name", fidelityTestHas(it, "I6:", "the count 25,519 is not printed"))
  t.ok("a count that is a whole token", !fidelityTestHas(it, "I7", ""))
  t.ok("not a count: a short group", fidelityTestHas(it, "I8:", "the count 100 is not printed"))
  t.ok("not a count: a long group", fidelityTestHas(it, "I9:", "the count 10,000 is not printed"))
  t.ok("not a count: a heading's number", fidelityTestHas(it, "I10:", "the count 3 is not printed"))
  t.ok("not a count: a hyphened name", fidelityTestHas(it, "I11:", "the count 256 is not printed"))
  t.ok("not a count: a subsection's number", fidelityTestHas(it, "I12:", "the count 2 is not printed in RFC §5.2"))
  t.ok("not a count: its parent's number", fidelityTestHas(it, "I13:", "the count 5 is not printed in RFC §5.2"))
  t.ok("an iterated vector's variant", fidelityTestHas(it, "I14.args[0]:", `under "For X448"`))
  t.ok("a count's rounds are not a variant", !fidelityTestHas(it, "I2.", "") && !fidelityTestHas(it, "I3.", ""))
  t.ok("a variant whose number is the count", fidelityTestHas(it, "I15.expect:", "x25519 names 25519"))
  t.ok("not a count: malformed groups", fidelityTestHas(it, "I16:", "the count 1,000,000 is not printed"))
  t.ok("iterated findings", it.length === 14)
  if (it.length !== 14) {
    console.log(it.join("\n"))
  }
  t.ok("a whole-word quote", gateQuoteWhole("It MUST NOT fail.", "MUST NOT fail."))
  t.ok("not inside a word at its start", !gateQuoteWhole("the MUSTARD jar", "TARD jar"))
  t.ok("not inside a word at its end", !gateQuoteWhole("the MUSTARD jar", "the MUST"))
  t.ok("a later occurrence can be whole", gateQuoteWhole("MUSTARD, then MUST", "MUST"))
  t.ok("punctuation bounds itself", gateQuoteWhole("a.b", ".b"))
  t.ok("an underscore is part of a word", !gateQuoteWhole("the K_LEN bytes", "LEN bytes"))
  t.ok("a decimal is one number", !gateQuoteWhole("version 1.5 holds", "5 holds"))
  t.ok("a decimal's head is one number", !gateQuoteWhole("version 1.5 holds", "version 1"))
  t.ok("a list's comma still bounds", gateQuoteWhole("1, 5 holds", "5 holds"))
  t.ok("a non-ASCII byte is part of a word", !gateQuoteWhole("na\u00efve MUST", "ve MUST"))
  return t.done()
}
