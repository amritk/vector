import { Suite } from "nish/testing"
import { CheckContext } from "../../../src/spec/check"
import { contractParse } from "../../../src/spec/contract/read"
import { gateQuoteWhole } from "../../../src/spec/gates/cite"
import { gateFidelity } from "../../../src/spec/gates/fidelity"
import { gateWarnings } from "../../../src/spec/gates/note"
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
     "iterate": {"count": 1000000, "names": ["k", "u"], "next": [{"call": "x25519", "args": [{"var": "k"}, {"var": "u"}]}, {"var": "k"}]}},
    {"kind": "vector", "id": "I17", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "7"}}, "call": "x25519",
     "args": [{"hex": "0909", "label": "For X25519"}, {"hex": "0909", "label": "For X25519"}], "expect": {"hex": "5555", "label": "X448 after 1,000 iterations"},
     "iterate": {"count": 1000, "names": ["k", "u"], "next": [{"call": "x25519", "args": [{"var": "k"}, {"var": "u"}]}, {"var": "k"}]}},
    {"kind": "vector", "id": "I18", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "7"}}, "call": "x25519",
     "args": [{"hex": "0909", "label": "For X25519"}, {"hex": "0909", "label": "For X25519"}], "expect": {"hex": "2222", "label": "X25519 after 1,000 iterations"},
     "iterate": {"count": 1000, "names": ["k", "u"], "next": [{"call": "x25519", "args": [{"var": "k"}, {"var": "u"}]}, {"var": "k"}]}},
    {"kind": "vector", "id": "I19", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "7"}}, "call": "x25519",
     "args": [{"hex": "0909", "label": "For X25519"}, {"hex": "0909", "label": "For X25519"}], "expect": {"hex": "6666", "label": "X448 applied 1,000 times"},
     "iterate": {"count": 1000, "names": ["k", "u"], "next": [{"call": "x25519", "args": [{"var": "k"}, {"var": "u"}]}, {"var": "k"}]}},
    {"kind": "vector", "id": "I20", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "7"}}, "call": "x25519",
     "args": [{"hex": "0909", "label": "For X25519"}, {"hex": "0909", "label": "For X25519"}], "expect": {"hex": "2222", "label": "X25519 applied 1,000 times"},
     "iterate": {"count": 5, "names": ["k", "u"], "next": [{"call": "x25519", "args": [{"var": "k"}, {"var": "u"}]}, {"var": "k"}]}},
    {"kind": "vector", "id": "I21", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "8"}}, "call": "x25519",
     "args": [{"hex": "0909", "label": "For X25519"}, {"hex": "0909", "label": "For X25519"}], "expect": {"hex": "2222", "label": "Result"},
     "iterate": {"count": 1000, "names": ["k", "u"], "next": [{"call": "x25519", "args": [{"var": "k"}, {"var": "u"}]}, {"var": "k"}]}},
    {"kind": "vector", "id": "I22", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "8"}}, "call": "x25519",
     "args": [{"hex": "0909", "label": "For X25519"}, {"hex": "0909", "label": "For X25519"}], "expect": {"hex": "2222", "label": "Result"},
     "iterate": {"count": 6000, "names": ["k", "u"], "next": [{"call": "x25519", "args": [{"var": "k"}, {"var": "u"}]}, {"var": "k"}]}},
    {"kind": "vector", "id": "I23", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "8"}}, "call": "x25519",
     "args": [{"hex": "0909", "label": "For X25519"}, {"hex": "0909", "label": "For X25519"}], "expect": {"hex": "2222", "label": "Result"},
     "iterate": {"count": 2, "names": ["k", "u"], "next": [{"call": "x25519", "args": [{"var": "k"}, {"var": "u"}]}, {"var": "k"}]}},
    {"kind": "vector", "id": "I24", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "8"}}, "call": "x25519",
     "args": [{"hex": "0909", "label": "For X25519"}, {"hex": "0909", "label": "For X25519"}], "expect": {"hex": "7777", "label": "Round 7"},
     "iterate": {"count": 9, "names": ["k", "u"], "next": [{"call": "x25519", "args": [{"var": "k"}, {"var": "u"}]}, {"var": "k"}]}},
    {"kind": "vector", "id": "I25", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "8"}}, "call": "x25519",
     "args": [{"hex": "0909", "label": "For X25519"}, {"hex": "0909", "label": "For X25519"}], "expect": {"hex": "7979", "label": "7 of 9"},
     "iterate": {"count": 9, "names": ["k", "u"], "next": [{"call": "x25519", "args": [{"var": "k"}, {"var": "u"}]}, {"var": "k"}]}}
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

7.  Rounds

   For X25519 = 0x0909
   X25519 after 1,000 iterations = 0x2222
   X448 after 1,000 iterations = 0x5555
   X25519 applied 1,000 times = 0x2222
   X448 applied 1,000 times = 0x6666

8.  Ranges

2 rounds are run at the margin.
   Run the 1,000-iteration test, then 5,000–6,000 rounds.

   For X25519 = 0x0909
   Result = 0x2222
   Round 7 = 0x7777
   7 of 9 = 0x7979
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

/**
 * The check of one iterated vector of x25519, citing section `id` of an
 * RFC whose section opens with `heading` and prints `body`, its expected
 * value `hex` under `label`, iterated `count` times.
 */
const fidelityTestRowCtx = (
  id: string,
  heading: string,
  body: string,
  hex: string,
  label: string,
  count: i32,
): CheckContext => {
  const contract = `{
  "contract": "c3",
  "source": {"title": "T", "rfc": 9997},
  "target": {"module": "nish/x"},
  "requirements": [{"id": "R1", "section": "${id}", "level": "MUST", "quote": "It MUST iterate."}],
  "functions": [
    {"name": "x25519", "params": [{"name": "k", "type": "bytes"}, {"name": "u", "type": "bytes"}], "returns": "bytes"}
  ],
  "clauses": [
    {"kind": "vector", "id": "T1", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "${id}"}}, "call": "x25519",
     "args": [{"hex": "0909", "label": "For X25519"}, {"hex": "0909", "label": "For X25519"}], "expect": {"hex": "${hex}", "label": "${label}"},
     "iterate": {"count": ${count}, "names": ["k", "u"], "next": [{"call": "x25519", "args": [{"var": "k"}, {"var": "u"}]}, {"var": "k"}]}}
  ]
}`
  const rfc = `Request for Comments: 9997

${heading}

   It MUST iterate.

   For X25519 = 0x0909
${body}
`
  const ctx = new CheckContext("contracts/c3.json", ".")
  ctx.contract = contractParse(contract, "c3").expect("parse")
  const set = new SourceSet()
  set.main = "rfc9997"
  set.sources.push(new LoadedSource("rfc9997", "r.txt", "r.txt", rfcParse(rfc)))
  ctx.sources = set
  return ctx
}

/** The findings for one iterated vector of x25519 (see `fidelityTestRowCtx`). */
const fidelityTestRow = (id: string, heading: string, body: string, hex: string, label: string, count: i32): string[] =>
  gateFidelity(fidelityTestRowCtx(id, heading, body, hex, label, count))

/** The warnings, not the findings, for one iterated vector of x25519 (see `fidelityTestRowCtx`). */
const fidelityTestRowWarned = (
  id: string,
  heading: string,
  body: string,
  hex: string,
  label: string,
  count: i32,
): string[] => {
  const ctx = fidelityTestRowCtx(id, heading, body, hex, label, count)
  const found = gateFidelity(ctx)
  const out: string[] = []
  for (const n of gateWarnings(ctx)) {
    out.push(n.message)
  }
  for (const f of found) {
    out.push(f)
  }
  return out
}

/**
 * One row of the iterated-vector table: its findings are exactly the one
 * holding `want`, or none when `want` is empty.
 */
const fidelityTestRowIs = (t: Suite, name: string, got: string[], want: string): void => {
  const ok = want.length === 0 ? got.length === 0 : got.length === 1 && got[0].indexOf(want) >= 0
  t.ok(name, ok)
  if (!ok) {
    console.log(`${name}:\n${got.join("\n")}`)
  }
}

/** The iterated-vector table: each word a label counts rounds with, against its own variant and another. */
const fidelityTestTable = (t: Suite): void => {
  const refused = "x25519 names 25519"
  const words = [" after 1,000 iterations", " applied 1,000 times", " after 1,000 rounds", " 1,000"]
  for (const w of words) {
    const body = `   X25519${w} = 0x2222\n   X448${w} = 0x5555`
    fidelityTestRowIs(
      t,
      `its own variant, "${w}"`,
      fidelityTestRow("1", "1.  Rounds", body, "2222", `X25519${w}`, 1000),
      "",
    )
    fidelityTestRowIs(
      t,
      `another variant, "${w}"`,
      fidelityTestRow("1", "1.  Rounds", body, "5555", `X448${w}`, 1000),
      `${refused}, as in "X25519${w}"`,
    )
  }
  // A bracket that is no call label's arguments still names the variant.
  const bracketed =
    "   Output (X25519) after 1,000 iterations = 0x2222\n   Output (X448) after 1,000 iterations = 0x5555"
  fidelityTestRowIs(
    t,
    "another variant, in brackets",
    fidelityTestRow("1", "1.  Rounds", bracketed, "5555", "Output (X448) after 1,000 iterations", 1000),
    `${refused}, as in "Output (X25519) after 1,000 iterations"`,
  )
  const grouped = "   After 1,000 iterations = 0x2222\n   After 1,000,000 iterations = 0x3333"
  fidelityTestRowIs(
    t,
    "rounds are not a variant",
    fidelityTestRow("1", "1.  Rounds", grouped, "2222", "After 1,000 iterations", 1000),
    "",
  )
  fidelityTestRowIs(
    t,
    "rounds are not a variant, the longer",
    fidelityTestRow("1", "1.  Rounds", grouped, "3333", "After 1,000,000 iterations", 1000000),
    "",
  )
  const twice =
    "   After 1,000 iterations (1,000 times) = 0x2222\n   After 1,000,000 iterations (1,000,000 times) = 0x3333"
  fidelityTestRowIs(
    t,
    "a count printed twice",
    fidelityTestRow("1", "1.  Rounds", twice, "2222", "After 1,000 iterations (1,000 times)", 1000),
    "",
  )
  const cases = "   Run 1,000 rounds.\n   Case 448 of 1,000 = 0x2222\n   Case 25519 of 1,000 = 0x3333"
  fidelityTestRowIs(
    t,
    "two numbers and no word: compared whole",
    fidelityTestRow("1", "1.  Rounds", cases, "2222", "Case 448 of 1,000", 1000),
    `${refused}, as in "Case 25519 of 1,000"`,
  )
  const sized = "   X25519 (32 bytes) = 0x2222\n   X448 (56 bytes) = 0x5555"
  fidelityTestRowIs(
    t,
    "a length in bytes is no variant's number",
    fidelityTestRow("1", "1.  Rounds", sized, "2222", "X25519 (32 bytes)", 32),
    "",
  )
  fidelityTestRowIs(
    t,
    "beside a length, another variant is still refused",
    fidelityTestRow("1", "1.  Rounds", sized, "5555", "X448 (56 bytes)", 56),
    `${refused}, as in "X25519 (32 bytes)"`,
  )
  // A label that counts its rounds with no word (X448 1,000) is compared
  // whole: where neither variant is the function's, it is only warned of.
  fidelityTestRowIs(
    t,
    "a count with no word, beside a variant the name does not say",
    fidelityTestRowWarned(
      "1",
      "1.  Rounds",
      "   Run it 1,000 times.\n   X7 1,000 = 0x2222\n   X9 1,000 = 0x5555",
      "2222",
      "X7 1,000",
      1000,
    ),
    `one of "X7 1,000" or "X9 1,000" in RFC §1 ("Rounds"), and nothing in the name x25519 says which variant it computes`,
  )
  fidelityTestRowIs(
    t,
    "a count with no word, beside another count",
    fidelityTestRowWarned(
      "1",
      "1.  Rounds",
      "   Run it 1,000 times.\n   After 1,000 = 0x2222\n   After 5,000 = 0x5555",
      "2222",
      "After 1,000",
      1000,
    ),
    `one of "After 1,000" or "After 5,000" in RFC §1 ("Rounds"), and nothing in the name x25519 says which variant it computes`,
  )
  // A letter-led hyphen chain is one token, so its last number is no count.
  fidelityTestRowIs(
    t,
    "not a count: a letter-led hyphen chain",
    fidelityTestRow(
      "1",
      "1.  Rounds",
      "   Vector-2-1000 iterations = 0x2222",
      "2222",
      "Vector-2-1000 iterations",
      1000,
    ),
    "the count 1,000 is not printed in RFC §1",
  )
  fidelityTestRowIs(
    t,
    "a count past a heading's line",
    fidelityTestRow("1", "1.  Run 1000 times", "   Result = 0x2222", "2222", "Result", 1000),
    "the count 1,000 is not printed in RFC §1",
  )
  const named = "   SHA-256-128 and AES-128-GCM-96 = 0x2222"
  fidelityTestRowIs(
    t,
    "not a count: a name's last number",
    fidelityTestRow("1", "1.  Rounds", named, "2222", "SHA-256-128 and AES-128-GCM-96", 128),
    "the count 128 is not printed",
  )
  fidelityTestRowIs(
    t,
    "not a count: a name's last number, after letters",
    fidelityTestRow("1", "1.  Rounds", named, "2222", "SHA-256-128 and AES-128-GCM-96", 96),
    "the count 96 is not printed",
  )
  const result = "   Result = 0x2222"
  fidelityTestRowIs(
    t,
    "not a count: a lettered heading's number",
    fidelityTestRow("A.2", "A.2.  Test Case 2", result, "2222", "Result", 2),
    "the count 2 is not printed",
  )
  fidelityTestRowIs(
    t,
    "not a count: an appendix heading's number",
    fidelityTestRow("A", "Appendix A.  Run 3 Times", result, "2222", "Result", 3),
    "the count 3 is not printed",
  )
  fidelityTestRowIs(
    t,
    "a count printed under a lettered heading",
    fidelityTestRow("A.2", "A.2.  Test Case 2", "   Run it 2 times.\n   Result = 0x2222", "2222", "Result", 2),
    "",
  )
}

/** RFC 8032 §7.1's first three Ed25519 tests, as printed: TEST 1 signs the empty message. */
const FIDELITY_TEST_ED_RFC: string = `Request for Comments: 8032

7.1.  Test Vectors for Ed25519

   These test vectors are taken from [ED25519-TEST-VECTORS].

   -----TEST 1

   ALGORITHM:
   Ed25519

   SECRET KEY:
   9d61b19deffd5a60ba844af492ec2cc4
   4449c5697b326919703bac031cae7f60

   MESSAGE (length 0 bytes):

   SIGNATURE:
   e5564300c360ac729086e2cc806e828a
   84877f1eb8e5d974d873e06522490155

   -----TEST 2

   ALGORITHM:
   Ed25519

   SECRET KEY:
   4ccd089b28ff96da9db6c346ec114e0f
   5b8a319f35aba624da8cf6ed4fb8a6fb

   MESSAGE (length 1 byte):
   72

   SIGNATURE:
   92a009a9f0d4cab8720e820b5f642540
   a2b27b5416503f8fb3762223ebdb69da

   -----TEST 3

   SECRET KEY:
   c5aa8df43f9f837bedb7442f31dcb7b1
   66d38535076f094b85ce3a2e0b4458f7

   MESSAGE (length 2 bytes):
   af82

   SIGNATURE:
   6291d657deec24024827e69c3abe01a3
   0ce548a284743a445e3680d7db5ac3ac

   NOTE (length 2 bytes):

   NOTE (length 0 octets):

   NOTE (length 0 byte):
`

/** TEST 1's secret key and signature, the arguments and result around an empty message. */
const FIDELITY_TEST_ED_SK1: string = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60"
const FIDELITY_TEST_ED_SIG1: string = "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155"
/** TEST 2's secret key and signature, around its one-byte message. */
const FIDELITY_TEST_ED_SK2: string = "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb"
const FIDELITY_TEST_ED_SIG2: string = "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da"
/** TEST 3's secret key and signature, which the NOTE labels follow. */
const FIDELITY_TEST_ED_SK3: string = "c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7"
const FIDELITY_TEST_ED_SIG3: string = "6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac"

/**
 * The findings for one Ed25519 vector citing RFC 8032 §7.1: a secret key,
 * then the message `msg` and the expected signature, each a contract
 * literal's JSON.
 */
const fidelityTestEd = (sk: string, msg: string, sig: string): string[] => {
  const contract = `{
  "contract": "c4",
  "source": {"title": "EdDSA", "rfc": 8032},
  "target": {"module": "nish/ed"},
  "requirements": [{"id": "R1", "section": "7.1", "level": "MUST", "quote": "These test vectors are taken from"}],
  "functions": [
    {"name": "ed25519Sign", "params": [{"name": "sk", "type": "bytes"}, {"name": "m", "type": "bytes"}], "returns": "bytes"}
  ],
  "clauses": [
    {"kind": "vector", "id": "E1", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "7.1"}}, "call": "ed25519Sign",
     "args": [{"hex": "${sk}", "label": "SECRET KEY"}, ${msg}], "expect": {"hex": "${sig}", "label": "SIGNATURE"}}
  ]
}`
  const ctx = new CheckContext("contracts/c4.json", ".")
  ctx.contract = contractParse(contract, "c4").expect("parse")
  const set = new SourceSet()
  set.main = "rfc8032"
  set.sources.push(new LoadedSource("rfc8032", "r.txt", "r.txt", rfcParse(FIDELITY_TEST_ED_RFC)))
  ctx.sources = set
  return gateFidelity(ctx)
}

/** An Ed25519 vector's findings: exactly the one holding `want`, or none when `want` is empty. */
const fidelityTestEdIs = (t: Suite, name: string, msg: string, want: string): void => {
  fidelityTestRowIs(t, name, fidelityTestEd(FIDELITY_TEST_ED_SK1, msg, FIDELITY_TEST_ED_SIG1), want)
}

/** Empty values printed as a label with nothing below it, and labels with a parenthesised group. */
const fidelityTestEmpty = (t: Suite): void => {
  fidelityTestEdIs(t, "TEST 1's empty message", `{"hex": "", "label": "MESSAGE (length 0 bytes)"}`, "")
  fidelityTestRowIs(
    t,
    "TEST 2's one-byte message",
    fidelityTestEd(FIDELITY_TEST_ED_SK2, `{"hex": "72", "label": "MESSAGE (length 1 byte)"}`, FIDELITY_TEST_ED_SIG2),
    "",
  )
  fidelityTestEdIs(
    t,
    "empty under a label printed with a value",
    `{"hex": "", "label": "MESSAGE (length 1 byte)"}`,
    `E1.args[1]: "MESSAGE (length 1 byte)" is printed with a 1-byte value in RFC §7.1 ("Test Vectors for Ed25519"), so the value is not empty`,
  )
  fidelityTestEdIs(
    t,
    "empty under a label with nothing below it and another length",
    `{"hex": "", "label": "NOTE (length 2 bytes)"}`,
    `"NOTE (length 2 bytes)" is printed with nothing below it in RFC §7.1 ("Test Vectors for Ed25519"), but does not state a length of 0 bytes`,
  )
  fidelityTestEdIs(
    t,
    "empty under a label that is not printed",
    `{"hex": "", "label": "MESSAGE (length 9 bytes)"}`,
    `the empty value is not printed in RFC §7.1 ("Test Vectors for Ed25519") under "MESSAGE (length 9 bytes)" with nothing below it`,
  )
  fidelityTestRowIs(
    t,
    "empty under a length in octets",
    fidelityTestEd(FIDELITY_TEST_ED_SK3, `{"hex": "", "label": "NOTE (length 0 octets)"}`, FIDELITY_TEST_ED_SIG3),
    "",
  )
  fidelityTestRowIs(
    t,
    "empty under the singular byte",
    fidelityTestEd(FIDELITY_TEST_ED_SK3, `{"hex": "", "label": "NOTE (length 0 byte)"}`, FIDELITY_TEST_ED_SIG3),
    "",
  )
  fidelityTestEdIs(t, "an unlabelled empty value", `{"hex": ""}`, "the empty value is not printed")
}

/** An RFC whose §2 is split into test cases, as RFC 8439 §A.3 is; §3 has a subsection, §4 no headings. */
const FIDELITY_TEST_CASES_RFC: string = `Request for Comments: 9996

1.  Rules

   It MUST tag.

2.  Poly

   The test vector #2 below is longer.

   Test Vector #1:
   ==============

   Key:
   0101

   Tag:
   0a0a

   Test Vector #2: a longer one

   Key:
   0202

Author                        Informational                     [Page 1]
\f
RFC 9996                      Example Spec                     May 2020

   Tag:
   0b0b

   Test Vector #3: a tag alone

   Tag:
   0c0c

   Test Vector #4: labels printed more than once

   Key:
   0404
   Tag:
   0e0e
   Key:
   0505
   Tag:
   0d0d
   Tag:
   0f0f

3.  Parent

   Test Vector #1:

   Key:
   0101

3.1.  Child

   Tag:
   0a0a

4.  Plain

   Key:
   0101
   Tag:
   0a0a
   Key:
   0202
   Tag:
   0b0b
   Tag:
   0c0c
`

/** The findings for one vector of f(key) = tag, citing `cite` (a contract citation's JSON). */
const fidelityTestCase = (cite: string, key: string, tag: string): string[] => {
  const contract = `{
  "contract": "c5",
  "source": {"title": "T", "rfc": 9996},
  "target": {"module": "nish/x"},
  "requirements": [{"id": "R1", "section": "1", "level": "MUST", "quote": "It MUST tag."}],
  "functions": [{"name": "f", "params": [{"name": "k", "type": "bytes"}], "returns": "bytes"}],
  "clauses": [
    {"kind": "vector", "id": "C1", "title": "t", "covers": ["R1"], "source": {"cite": ${cite}}, "call": "f",
     "args": [{"hex": "${key}", "label": "Key"}], "expect": {"hex": "${tag}", "label": "Tag"}}
  ]
}`
  const ctx = new CheckContext("contracts/c5.json", ".")
  ctx.contract = contractParse(contract, "c5").expect("parse")
  const set = new SourceSet()
  set.main = "rfc9996"
  set.sources.push(new LoadedSource("rfc9996", "r.txt", "r.txt", rfcParse(FIDELITY_TEST_CASES_RFC)))
  ctx.sources = set
  return gateFidelity(ctx)
}

/** Vectors scoped to one test case of a section, beside the same vectors citing the whole section. */
const fidelityTestCases = (t: Suite): void => {
  const rows: string[][] = [
    ["#1, its own values", `{"section": "2", "case": "Test Vector #1"}`, "0101", "0a0a", ""],
    ["#2, split by a page break", `{"section": "2", "case": "Test Vector #2"}`, "0202", "0b0b", ""],
    [
      "#2's call with #3's tag",
      `{"section": "2", "case": "Test Vector #2"}`,
      "0202",
      "0c0c",
      `C1.expect: the 2-byte expect is not printed in RFC §2, Test Vector #2 ("Poly")`,
    ],
    [
      "#2's key cited as #3",
      `{"section": "2", "case": "Test Vector #3"}`,
      "0202",
      "0c0c",
      `C1.args[0]: the 2-byte args[0] is not printed in RFC §2, Test Vector #3 ("Poly")`,
    ],
    [
      "#1's key with #2's tag, cited as #2",
      `{"section": "2", "case": "Test Vector #2"}`,
      "0101",
      "0b0b",
      `C1.args[0]: the 2-byte args[0] is not printed in RFC §2, Test Vector #2 ("Poly")`,
    ],
    [
      "labels printed more than once within one case",
      `{"section": "2", "case": "Test Vector #4"}`,
      "0404",
      "0d0d",
      `"Key" is printed 2 times, "Tag" is printed 3 times in RFC §2, Test Vector #4 ("Poly"), so which printings belong to one test case is unclear: cite the subsection that holds one test case`,
    ],
    [
      "no such case",
      `{"section": "2", "case": "Test Vector #12"}`,
      "0101",
      "0a0a",
      `C1: RFC §2 ("Poly") has no "Test Vector #12:" heading, so it holds no Test Vector #12`,
    ],
    [
      "a section with subsections",
      `{"section": "3", "case": "Test Vector #1"}`,
      "0101",
      "0a0a",
      `C1: RFC §3 ("Parent") has subsections, so Test Vector #1 is not one test case of it`,
    ],
    [
      "a section without headings",
      `{"section": "4", "case": "Test Vector #1"}`,
      "0101",
      "0a0a",
      `C1: RFC §4 ("Plain") has no "Test Vector #1:" heading`,
    ],
    [
      "the whole section, which has headings: the hint names one",
      `{"section": "2"}`,
      "0101",
      "0a0a",
      "which printings belong to one test case is unclear: cite the subsection that holds one test case, or name one: {{Section 2 of RFC9996}}, Test Vector #N",
    ],
  ]
  for (const r of rows) {
    fidelityTestRowIs(t, `test case: ${r[0]}`, fidelityTestCase(r[1], r[2], r[3]), r[4])
  }
  const plain = fidelityTestCase(`{"section": "4"}`, "0101", "0a0a")
  fidelityTestRowIs(
    t,
    "test case: a whole section without headings is refused as before",
    plain,
    "which printings belong to one test case is unclear: cite the subsection that holds one test case",
  )
  t.ok(
    "test case: and with no hint",
    plain.length === 1 && plain[0].endsWith("cite the subsection that holds one test case"),
  )
}

/**
 * A label printed once belongs to the test case its line falls in: each row
 * is a name, the secret key, the message literal, the signature, and the
 * finding wanted ("" for none).
 */
const fidelityTestOnce = (t: Suite): void => {
  const empty = `{"hex": "", "label": "MESSAGE (length 0 bytes)"}`
  const one = `{"hex": "72", "label": "MESSAGE (length 1 byte)"}`
  const two = `{"hex": "af82", "label": "MESSAGE (length 2 bytes)"}`
  const apart = "so they are from different test cases: use the values printed together"
  const rows: string[][] = [
    ["TEST 1 with its empty message", FIDELITY_TEST_ED_SK1, empty, FIDELITY_TEST_ED_SIG1, ""],
    ["TEST 2 with its message", FIDELITY_TEST_ED_SK2, one, FIDELITY_TEST_ED_SIG2, ""],
    ["TEST 3 with its message", FIDELITY_TEST_ED_SK3, two, FIDELITY_TEST_ED_SIG3, ""],
    [
      "TEST 2 with TEST 1's empty message",
      FIDELITY_TEST_ED_SK2,
      empty,
      FIDELITY_TEST_ED_SIG2,
      `E1.args[1]: "MESSAGE (length 0 bytes)" is printed once in RFC §7.1 ("Test Vectors for Ed25519"), with the 1st of 3 "SECRET KEY", but args[0] is the 2nd of 3 "SECRET KEY", expect is the 2nd of 3 "SIGNATURE", ${apart}`,
    ],
    ["TEST 1 with TEST 2's message", FIDELITY_TEST_ED_SK1, one, FIDELITY_TEST_ED_SIG1, apart],
    ["TEST 3 with TEST 2's message", FIDELITY_TEST_ED_SK3, one, FIDELITY_TEST_ED_SIG3, apart],
    [
      "TEST 1 with a NOTE after TEST 3",
      FIDELITY_TEST_ED_SK1,
      `{"hex": "", "label": "NOTE (length 0 octets)"}`,
      FIDELITY_TEST_ED_SIG1,
      apart,
    ],
  ]
  for (const r of rows) {
    fidelityTestRowIs(t, `one test case: ${r[0]}`, fidelityTestEd(r[1], r[2], r[3]), r[4])
  }
}

/** A footer, form feed and header, as `rfcParse` reads page furniture. */
const fidelityTestBreak = (rfc: string, page: i32): string =>
  `\nAuthor                        Informational                     [Page ${page}]\n\f\nRFC ${rfc}                      Example Spec                     May 2021\n`

/**
 * RFC 9001 Appendix A.1's layout: values on `= hex` lines under a statement
 * that names them, one split across a page break, and a page break between
 * the client and server blocks.
 */
const fidelityTestQuicRfc = (): string =>
  [
    "Request for Comments: 9001",
    "",
    "1.  Rules",
    "",
    "   It MUST derive.",
    "",
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
    fidelityTestBreak("9001", 47),
    "         2d6b7db67881289af4008f1f6c357aea",
    "",
    '   key = HKDF-Expand-Label(client_initial_secret, "quic key", "", 16)',
    "       = 1f369613dd76d5467730efcbe3b1a22d",
    fidelityTestBreak("9001", 48),
    "   server_initial_secret",
    '       = HKDF-Expand-Label(initial_secret, "server in", "", 32)',
    "       = 3c199828fd139efd216c155ad844cc81",
    "         fb82fa8d7446fa7d78be803acdda951b",
    "",
    '   key = HKDF-Expand-Label(server_initial_secret, "quic key", "", 16)',
    "       = cf3a5331653c364c88f0f379b6067e37",
    "",
  ].join("\n")

/**
 * RFC 7914 sections 11 and 12's layout: call labels wrapped over two lines,
 * one split by a page break, and two blocks split only by one.
 */
const fidelityTestScryptRfc = (): string =>
  [
    "Request for Comments: 7914",
    "",
    "1.  Rules",
    "",
    "   It MUST derive.",
    "",
    "11.  Test Vectors for PBKDF2 with HMAC-SHA-256",
    "",
    '   PBKDF2-HMAC-SHA-256 (P="passwd", S="salt",',
    "                       c=1, dkLen=64) =",
    "   55 ac 04 6e 56 e3 08 9f ec 16 91 c2 25 44 b6 05",
    fidelityTestBreak("7914", 11),
    '   PBKDF2-HMAC-SHA-256 (P="Password", S="NaCl",',
    fidelityTestBreak("7914", 12),
    "                        c=80000, dkLen=64) =",
    "   4d dc d8 f6 0b 98 be 21 83 0c ee 5e f2 27 01 f9",
    "",
    "12.  Test Vectors for scrypt",
    "",
    '   scrypt (P="", S="",',
    "           N=16, r=1, p=1, dklen=64) =",
    "   77 d6 57 62 38 65 7b 20 3b 19 ca 42 c1 8a 04 97",
    fidelityTestBreak("7914", 13),
    '   scrypt (P="password", S="NaCl",',
    "           N=1024, r=8, p=16, dkLen=64) =",
    "   fd ba be 1c 9d 34 72 00 78 56 e7 19 0d 01 e9 fe",
    "",
    '   scrypt (P="pleaseletmein", S="SodiumChloride",',
    "           N=16384, r=8, p=1, dkLen=64) =",
    "   70 23 bd cb 3a fd 73 48 46 1c 06 cd 81 fd 38 eb",
    "",
    '   scrypt (P="pleaseletmein", S="SodiumChloride",',
    "           N=1048576, r=8, p=1, dkLen=64) =",
    "   21 01 cb 9b 6a 51 1a ae ad db be 09 cf 70 f8 81",
    "",
  ].join("\n")

/**
 * The findings and warnings for one vector of `fn` (a contract function's
 * JSON) citing section `id` of RFC `num`, whose text is `rfc`: `args` and
 * `expect` are the clause's literals' JSON.
 */
const fidelityTestWrap = (num: string, rfc: string, fn: string, id: string, args: string, expect: string): string[] =>
  fidelityTestWrapCall(num, rfc, fn, "f", id, args, expect)

/** fidelityTestWrap, the vector calling `call` (the name `fn` declares). */
const fidelityTestWrapCall = (
  num: string,
  rfc: string,
  fn: string,
  call: string,
  id: string,
  args: string,
  expect: string,
): string[] => {
  const contract = `{
  "contract": "c6",
  "source": {"title": "T", "rfc": ${num}},
  "target": {"module": "nish/x"},
  "requirements": [{"id": "R1", "section": "1", "level": "MUST", "quote": "It MUST derive."}],
  "functions": [${fn}],
  "clauses": [
    {"kind": "vector", "id": "W1", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "${id}"}}, "call": "${call}",
     "args": [${args}], "expect": ${expect}}
  ]
}`
  const ctx = new CheckContext("contracts/c6.json", ".")
  ctx.contract = contractParse(contract, "c6").expect("parse")
  const set = new SourceSet()
  set.main = `rfc${num}`
  set.sources.push(new LoadedSource(`rfc${num}`, "r.txt", "r.txt", rfcParse(rfc)))
  ctx.sources = set
  const out = gateFidelity(ctx)
  for (const n of gateWarnings(ctx)) {
    out.push(n.message)
  }
  return out
}

/**
 * Values named across wrapped lines and page breaks: RFC 9001's statements
 * and RFC 7914's call labels. Each row is a name, the section, the args'
 * JSON, the expected literal's JSON, and the finding wanted ("" for none).
 */
const fidelityTestWrapped = (t: Suite): void => {
  const quic = fidelityTestQuicRfc()
  const quicFn = `{"name": "f", "params": [{"name": "s", "type": "bytes"}], "returns": "bytes"}`
  const initial = `{"hex": "7db5df06e7a69e432496adedb00851923595221596ae2ae9fb8115c1e9ed0a44", "label": "initial_secret"}`
  const client = "c00cf151ca5be075ed0ebfb5c80323c42d6b7db67881289af4008f1f6c357aea"
  const server = "3c199828fd139efd216c155ad844cc81fb82fa8d7446fa7d78be803acdda951b"
  const quicRows: string[][] = [
    ["client secret, split by a page break", initial, `{"hex": "${client}", "label": "client_initial_secret"}`, ""],
    ["server secret, after a page break", initial, `{"hex": "${server}", "label": "server_initial_secret"}`, ""],
    [
      "client secret under the server's name",
      initial,
      `{"hex": "${client}", "label": "server_initial_secret"}`,
      `under "client_initial_secret", not under "server_initial_secret"`,
    ],
    ["client secret with no name", initial, `{"hex": "${client}"}`, `under "client_initial_secret": name it`],
    [
      "the client's key, printed after the client's secret",
      `{"hex": "${client}", "label": "client_initial_secret"}`,
      `{"hex": "1f369613dd76d5467730efcbe3b1a22d", "label": "key"}`,
      "",
    ],
    [
      "the server's key with the client's secret",
      `{"hex": "${client}", "label": "client_initial_secret"}`,
      `{"hex": "cf3a5331653c364c88f0f379b6067e37", "label": "key"}`,
      `with the 1st of 2 "key", but expect is the 2nd of 2 "key"`,
    ],
  ]
  for (const r of quicRows) {
    fidelityTestRowIs(t, `9001 A.1: ${r[0]}`, fidelityTestWrap("9001", quic, quicFn, "A.1", r[1], r[2]), r[3])
  }
  // "quic key" is a whole label in A.1, not a call label: it pairs with no
  // test case, so the vector is refused only as one whose string and
  // repeated key nothing relates.
  const expandFn = `{"name": "f", "params": [{"name": "s", "type": "bytes"}, {"name": "l", "type": "string"}], "returns": "bytes"}`
  fidelityTestRowIs(
    t,
    "9001 A.1: a string printed as a whole label",
    fidelityTestWrap(
      "9001",
      quic,
      expandFn,
      "A.1",
      `{"hex": "${client}", "label": "client_initial_secret"}, {"str": "quic key"}`,
      `{"hex": "1f369613dd76d5467730efcbe3b1a22d", "label": "key"}`,
    ),
    `W1: args[1] "quic key" and expect (one of 2 "key") in RFC §A.1 ("Keys"): nothing pairs a printed string with one of several labelled values: cite the subsection that holds one test case`,
  )
  const scrypt = fidelityTestScryptRfc()
  const pbkdf2Fn = `{"name": "f", "params": [{"name": "p", "type": "string"}, {"name": "s", "type": "string"},
    {"name": "c", "type": "i32"}, {"name": "dkLen", "type": "i32"}], "returns": "bytes"}`
  const scryptFn = `{"name": "f", "params": [{"name": "p", "type": "string"}, {"name": "s", "type": "string"},
    {"name": "n", "type": "i32"}, {"name": "r", "type": "i32"}, {"name": "q", "type": "i32"}, {"name": "dkLen", "type": "i32"}],
    "returns": "bytes"}`
  const one = `{"hex": "55ac046e56e3089fec1691c22544b605", "label": "PBKDF2-HMAC-SHA-256 (P=\\"passwd\\", S=\\"salt\\", c=1, dkLen=64)"}`
  const two = `{"hex": "4ddcd8f60b98be21830cee5ef22701f9", "label": "PBKDF2-HMAC-SHA-256 (P=\\"Password\\", S=\\"NaCl\\", c=80000, dkLen=64)"}`
  const pbRows: string[][] = [
    [
      "case 1 with its own args",
      `{"str": "passwd"}, {"str": "salt"}, {"int": 1, "label": "c"}, {"int": 64, "label": "dkLen"}`,
      one,
      "",
    ],
    [
      "case 2, its label split by a page break",
      `{"str": "Password"}, {"str": "NaCl"}, {"int": 80000, "label": "c"}, {"int": 64, "label": "dkLen"}`,
      two,
      "",
    ],
    [
      "case 1 with case 2's count",
      `{"str": "passwd"}, {"str": "salt"}, {"int": 80000, "label": "c"}, {"int": 64, "label": "dkLen"}`,
      one,
      `args[2] c=80000 is printed in the call label "PBKDF2-HMAC-SHA-256 (P="Password", S="NaCl", c=80000, dkLen=64)"`,
    ],
    [
      "case 1 with case 2's salt",
      `{"str": "passwd"}, {"str": "NaCl"}, {"int": 1, "label": "c"}, {"int": 64, "label": "dkLen"}`,
      one,
      `W1.args[1]: args[1] "NaCl" is printed in the call label "PBKDF2-HMAC-SHA-256 (P="Password", S="NaCl", c=80000, dkLen=64)" in RFC §11 ("Test Vectors for PBKDF2 with HMAC-SHA-256"), not in "PBKDF2-HMAC-SHA-256 (P="passwd", S="salt", c=1, dkLen=64)" that the expected value is printed under: they are different test cases`,
    ],
    [
      "case 2 with case 1's password",
      `{"str": "passwd"}, {"str": "NaCl"}, {"int": 80000, "label": "c"}, {"int": 64, "label": "dkLen"}`,
      two,
      `W1.args[0]: args[0] "passwd" is printed in the call label "PBKDF2-HMAC-SHA-256 (P="passwd", S="salt", c=1, dkLen=64)" in RFC §11 ("Test Vectors for PBKDF2 with HMAC-SHA-256"), not in "PBKDF2-HMAC-SHA-256 (P="Password", S="NaCl", c=80000, dkLen=64)" that the expected value is printed under: they are different test cases`,
    ],
  ]
  for (const r of pbRows) {
    fidelityTestRowIs(t, `7914 §11: ${r[0]}`, fidelityTestWrap("7914", scrypt, pbkdf2Fn, "11", r[1], r[2]), r[3])
  }
  // A call label's arguments name its test case, not its variant: under
  // "PBKDF2-HMAC-SHA-256 (…)" beside "PBKDF2-HMAC-SHA-512 (…)", the function
  // must still name 256.
  const variants = [
    "Request for Comments: 7914",
    "",
    "1.  Rules",
    "",
    "   It MUST derive.",
    "",
    "11.  Test Vectors for PBKDF2",
    "",
    '   PBKDF2-HMAC-SHA-256 (P="passwd", S="salt",',
    "                       c=1, dkLen=64) =",
    "   55 ac 04 6e 56 e3 08 9f ec 16 91 c2 25 44 b6 05",
    fidelityTestBreak("7914", 11),
    '   PBKDF2-HMAC-SHA-512 (P="passwd", S="salt",',
    "                       c=1, dkLen=64) =",
    "   86 7f 70 cf 1a de 02 cf f3 75 25 99 a3 a5 3d c4",
    "",
  ].join("\n")
  const passwd = `{"str": "passwd"}, {"str": "salt"}, {"int": 1, "label": "c"}, {"int": 64, "label": "dkLen"}`
  const sha256 = `{"hex": "55ac046e56e3089fec1691c22544b605", "label": "PBKDF2-HMAC-SHA-256 (P=\\"passwd\\", S=\\"salt\\", c=1, dkLen=64)"}`
  const sha512 = `{"hex": "867f70cf1ade02cff3752599a3a53dc4", "label": "PBKDF2-HMAC-SHA-512 (P=\\"passwd\\", S=\\"salt\\", c=1, dkLen=64)"}`
  const variantRows: string[][] = [
    ["pbkdf2Sha256", sha256, ""],
    ["pbkdf2Sha512", sha512, ""],
    [
      "pbkdf2Sha512",
      sha256,
      `W1.expect: the value is printed under "PBKDF2-HMAC-SHA-256 (P="passwd", S="salt", c=1, dkLen=64)" in RFC §11 ("Test Vectors for PBKDF2"), but pbkdf2Sha512 names 512, as in "PBKDF2-HMAC-SHA-512 (P="passwd", S="salt", c=1, dkLen=64)": a vector uses the value printed for the variant its function computes`,
    ],
    [
      "pbkdf2Sha256",
      sha512,
      `W1.expect: the value is printed under "PBKDF2-HMAC-SHA-512 (P="passwd", S="salt", c=1, dkLen=64)" in RFC §11 ("Test Vectors for PBKDF2"), but pbkdf2Sha256 names 256, as in "PBKDF2-HMAC-SHA-256 (P="passwd", S="salt", c=1, dkLen=64)": a vector uses the value printed for the variant its function computes`,
    ],
  ]
  for (const r of variantRows) {
    const fn = `{"name": "${r[0]}", "params": [{"name": "p", "type": "string"}, {"name": "s", "type": "string"},
      {"name": "c", "type": "i32"}, {"name": "dkLen", "type": "i32"}], "returns": "bytes"}`
    fidelityTestRowIs(
      t,
      `7914 §11: ${r[0]} under ${r[1].indexOf("512") >= 0 ? "SHA-512" : "SHA-256"}'s call label`,
      fidelityTestWrapCall("7914", variants, fn, r[0], "11", passwd, r[1]),
      r[2],
    )
  }
  // The variant is read from the whole label, inside the `( … )` too:
  // "HMAC (SHA-256, key="Jefe")" names 256 though its head is only "HMAC".
  // The test case's inputs (the paired key, every named integer) are cut
  // out, but an unnumbered word such as hash=SHA-512 still names a variant.
  const hmac = [
    "Request for Comments: 4231",
    "",
    "1.  Rules",
    "",
    "   It MUST derive.",
    "",
    "4.  Test Vectors",
    "",
    '   HMAC (SHA-256, key="Jefe") =',
    "   5b dc c1 46 bf 60 75 4e 6a 04 24 26 08 95 75 c7",
    fidelityTestBreak("4231", 4),
    '   HMAC (SHA-512, key="Jefe") =',
    "   16 4b 7a 7b fc f8 19 e2 e3 95 fb e7 3b 56 e0 a3",
    "",
    "   KDF (hash=SHA-256, c=1) =",
    "   01 02 03 04 05 06 07 08 09 0a 0b 0c 0d 0e 0f 10",
    "",
    "   KDF (hash=SHA-512, c=1) =",
    "   11 12 13 14 15 16 17 18 19 1a 1b 1c 1d 1e 1f 20",
    "",
    '   SCRYPT (S="a", N=16) =',
    "   21 22 23 24 25 26 27 28 29 2a 2b 2c 2d 2e 2f 30",
    "",
    '   SCRYPT (S="a", N=32) =',
    "   31 32 33 34 35 36 37 38 39 3a 3b 3c 3d 3e 3f 40",
    "",
  ].join("\n")
  const h256 = `{"hex": "5bdcc146bf60754e6a042426089575c7", "label": "HMAC (SHA-256, key=\\"Jefe\\")"}`
  const h512 = `{"hex": "164b7a7bfcf819e2e395fbe73b56e0a3", "label": "HMAC (SHA-512, key=\\"Jefe\\")"}`
  const k256 = `{"hex": "0102030405060708090a0b0c0d0e0f10", "label": "KDF (hash=SHA-256, c=1)"}`
  const k512 = `{"hex": "1112131415161718191a1b1c1d1e1f20", "label": "KDF (hash=SHA-512, c=1)"}`
  const n16 = `{"hex": "2122232425262728292a2b2c2d2e2f30", "label": "SCRYPT (S=\\"a\\", N=16)"}`
  const hmacRows: string[][] = [
    ["hmacSha256", `{"str": "Jefe"}`, h256, ""],
    ["hmacSha512", `{"str": "Jefe"}`, h512, ""],
    [
      "hmacSha256",
      `{"str": "Jefe"}`,
      h512,
      `W1.expect: the value is printed under "HMAC (SHA-512, key="Jefe")" in RFC §4 ("Test Vectors"), but hmacSha256 names 256, as in "HMAC (SHA-256, key="Jefe")": a vector uses the value printed for the variant its function computes`,
    ],
    ["f", `{"str": "Jefe"}`, h256, "nothing in the name f says which variant"],
    ["kdfSha256", `{"int": 1, "label": "c"}`, k256, ""],
    [
      "kdfSha256",
      `{"int": 1, "label": "c"}`,
      k512,
      `W1.expect: the value is printed under "KDF (hash=SHA-512, c=1)" in RFC §4 ("Test Vectors"), but kdfSha256 names 256, as in "KDF (hash=SHA-256, c=1)": a vector uses the value printed for the variant its function computes`,
    ],
    ["scrypt", `{"str": "a"}, {"int": 16, "label": "N"}`, n16, ""],
  ]
  for (const r of hmacRows) {
    const params =
      r[1].indexOf("str") < 0
        ? `{"name": "c", "type": "i32"}`
        : r[1].indexOf("int") < 0
          ? `{"name": "k", "type": "string"}`
          : `{"name": "s", "type": "string"}, {"name": "n", "type": "i32"}`
    const fn = `{"name": "${r[0]}", "params": [${params}], "returns": "bytes"}`
    fidelityTestRowIs(
      t,
      `4231 §4: ${r[0]} under ${r[2]}`,
      fidelityTestWrapCall("4231", hmac, fn, r[0], "4", r[1], r[2]),
      r[3],
    )
  }
  // An argument printed in other call labels is refused once, however many
  // print it.
  const twoFn = `{"name": "hmacSha256", "params": [{"name": "k", "type": "string"}, {"name": "c", "type": "i32"}], "returns": "bytes"}`
  fidelityTestRowIs(
    t,
    "4231 §4: an argument printed in two other call labels",
    fidelityTestWrapCall("4231", hmac, twoFn, "hmacSha256", "4", `{"str": "Jefe"}, {"int": 1, "label": "c"}`, h256),
    `W1.args[1]: args[1] c=1 is printed in the call label "KDF (hash=SHA-256, c=1)" in RFC §4 ("Test Vectors"), not in "HMAC (SHA-256, key="Jefe")" that the expected value is printed under: they are different test cases`,
  )
  // An unlabelled argument (here a hex printed with no name) names nothing
  // in a call label, so it is not paired with it: the label's c=16 still
  // reads as a variant.
  const counts = [
    "Request for Comments: 4231",
    "",
    "1.  Rules",
    "",
    "   It MUST derive.",
    "",
    "4.  Test Vectors",
    "",
    "   the key",
    "   = 0a0b0c0d",
    "",
    "   KDF (c=16) =",
    "   01 02 03 04 05 06 07 08 09 0a 0b 0c 0d 0e 0f 10",
    "",
    "   KDF (c=64) =",
    "   11 12 13 14 15 16 17 18 19 1a 1b 1c 1d 1e 1f 20",
    "",
  ].join("\n")
  const bareFn = `{"name": "kdf", "params": [{"name": "k", "type": "bytes"}], "returns": "bytes"}`
  const c16 = `{"hex": "0102030405060708090a0b0c0d0e0f10", "label": "KDF (c=16)"}`
  t.eqStr(
    "4231 §4: an unlabelled argument against a call label",
    fidelityTestWrapCall("4231", counts, bareFn, "kdf", "4", `{"hex": "0a0b0c0d"}`, c16).join("|"),
    'the value is printed under "KDF (c=16)", one of "KDF (c=16)" or "KDF (c=64)" in RFC §4 ("Test Vectors"), and nothing in the name kdf says which variant it computes: not checked that this is its own',
  )
  const misnamed = fidelityTestWrap(
    "7914",
    scrypt,
    pbkdf2Fn,
    "11",
    `{"str": "passwd"}, {"str": "salt"}, {"int": 1, "label": "c"}, {"int": 64, "label": "dkLen"}`,
    `{"hex": "4ddcd8f60b98be21830cee5ef22701f9", "label": "PBKDF2-HMAC-SHA-256 (P=\\"passwd\\", S=\\"salt\\", c=1, dkLen=64)"}`,
  )
  t.ok(
    "7914 §11: case 2's value under case 1's label",
    fidelityTestHas(
      misnamed,
      "W1.expect:",
      `under "PBKDF2-HMAC-SHA-256 (P="Password", S="NaCl", c=80000, dkLen=64)", not under`,
    ),
  )
  const s1 = `{"hex": "77d6576238657b203b19ca42c18a0497", "label": "scrypt (P=\\"\\", S=\\"\\", N=16, r=1, p=1, dklen=64)"}`
  const s2 = `{"hex": "fdbabe1c9d3472007856e7190d01e9fe", "label": "scrypt (P=\\"password\\", S=\\"NaCl\\", N=1024, r=8, p=16, dkLen=64)"}`
  const scRows: string[][] = [
    [
      "case 1, a page break before case 2",
      `{"str": ""}, {"str": ""}, {"int": 16, "label": "N"}, {"int": 1, "label": "r"}, {"int": 1, "label": "p"}, {"int": 64, "label": "dklen"}`,
      s1,
      "",
    ],
    [
      "case 2, after a page break",
      `{"str": "password"}, {"str": "NaCl"}, {"int": 1024, "label": "N"}, {"int": 8, "label": "r"}, {"int": 16, "label": "p"}, {"int": 64, "label": "dkLen"}`,
      s2,
      "",
    ],
    [
      "case 2 with case 1's N, across the break",
      `{"str": "password"}, {"str": "NaCl"}, {"int": 16, "label": "N"}, {"int": 8, "label": "r"}, {"int": 16, "label": "p"}, {"int": 64, "label": "dkLen"}`,
      s2,
      `args[2] N=16 is printed in the call label "scrypt (P="", S="", N=16, r=1, p=1, dklen=64)"`,
    ],
  ]
  const please = `{"str": "pleaseletmein"}, {"str": "SodiumChloride"}`
  const s3 = `{"hex": "7023bdcb3afd7348461c06cd81fd38eb", "label": "scrypt (P=\\"pleaseletmein\\", S=\\"SodiumChloride\\", N=16384, r=8, p=1, dkLen=64)"}`
  const s4 = `{"hex": "2101cb9b6a511aaeaddbbe09cf70f881", "label": "scrypt (P=\\"pleaseletmein\\", S=\\"SodiumChloride\\", N=1048576, r=8, p=1, dkLen=64)"}`
  const rest = `{"int": 8, "label": "r"}, {"int": 1, "label": "p"}, {"int": 64, "label": "dkLen"}`
  scRows.push([
    "case 3, which differs from case 4 only in N",
    `${please}, {"int": 16384, "label": "N"}, ${rest}`,
    s3,
    "",
  ])
  scRows.push([
    "case 4, which differs from case 3 only in N",
    `${please}, {"int": 1048576, "label": "N"}, ${rest}`,
    s4,
    "",
  ])
  scRows.push([
    "case 3 with case 4's N",
    `${please}, {"int": 1048576, "label": "N"}, ${rest}`,
    s3,
    `args[2] N=1048576 is printed in the call label "scrypt (P="pleaseletmein", S="SodiumChloride", N=1048576, r=8, p=1, dkLen=64)"`,
  ])
  for (const r of scRows) {
    fidelityTestRowIs(t, `7914 §12: ${r[0]}`, fidelityTestWrap("7914", scrypt, scryptFn, "12", r[1], r[2]), r[3])
  }
}

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
  t.ok("part of a value", fidelityTestHas(all, "V2.args[1]:", "the 2-byte args[1] is only part of a value"))
  t.ok("not printed", fidelityTestHas(all, "V2.expect:", "the 2-byte expect is not printed in RFC §3"))
  t.ok("a label it needs", fidelityTestHas(all, "V3.args[0]:", `under "salt": name it with "label"`))
  t.ok("an input as the result", fidelityTestHas(all, "V3.expect:", "an input is not the expected result"))
  t.ok("an unprinted integer", fidelityTestHas(all, "V4.args[1]:", `RFC §3 does not print "L" followed by 43`))
  t.ok("different rounds", fidelityTestHas(all, "V5:", "so they are from different test cases"))
  t.ok("one round", !fidelityTestHas(all, "V10:", "") && !fidelityTestHas(all, "V10.", ""))
  t.ok(
    "a byte list in plain text is not a value",
    fidelityTestHas(all, "V11.args[0]:", "the 4-byte args[0] is not printed"),
  )
  t.ok(
    "a reference in plain text is not a value",
    fidelityTestHas(all, "V13.args[0]:", "the 1-byte args[0] is not printed"),
  )
  const xml = gateFidelity(fidelityTestCtx("r.xml"))
  t.ok("bytes printed in brackets, from XML", !fidelityTestHas(xml, "V11", ""))
  t.ok("a bracketed byte list in XML, not a reference", !fidelityTestHas(xml, "V13", ""))
  t.ok(
    "other bytes than the brackets'",
    fidelityTestHas(xml, "V12.args[0]:", "the 4-byte args[0] is not printed in RFC §7"),
  )
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
  t.ok(
    "a count printed grouped",
    !fidelityTestHas(it, "I2:", "") && !fidelityTestHas(it, "I2.", "") && !fidelityTestHas(it, "I3:", ""),
  )
  t.ok(
    "an expected label that counts other rounds",
    fidelityTestHas(
      it,
      "I4.expect:",
      `"After 1,000,000 iterations" counts 1,000,000, but the vector iterates 1,000 times`,
    ),
  )
  t.ok("not a count inside a word", fidelityTestHas(it, "I5.iterate:", "the count 1,000 is not printed in RFC §3"))
  t.ok("not a count in a name", fidelityTestHas(it, "I6.iterate:", "the count 25,519 is not printed"))
  t.ok("a count that is a whole token", !fidelityTestHas(it, "I7", ""))
  t.ok("not a count: a short group", fidelityTestHas(it, "I8.iterate:", "the count 100 is not printed"))
  t.ok("not a count: a long group", fidelityTestHas(it, "I9.iterate:", "the count 10,000 is not printed"))
  t.ok("not a count: a heading's number", fidelityTestHas(it, "I10.iterate:", "the count 3 is not printed"))
  t.ok("not a count: a hyphened name", fidelityTestHas(it, "I11.iterate:", "the count 256 is not printed"))
  t.ok(
    "not a count: a subsection's number",
    fidelityTestHas(it, "I12.iterate:", "the count 2 is not printed in RFC §5.2"),
  )
  t.ok(
    "not a count: its parent's number",
    fidelityTestHas(it, "I13.iterate:", "the count 5 is not printed in RFC §5.2"),
  )
  t.ok("an iterated vector's variant", fidelityTestHas(it, "I14.args[0]:", `under "For X448"`))
  t.ok("a count's rounds are not a variant", !fidelityTestHas(it, "I2.", "") && !fidelityTestHas(it, "I3.", ""))
  t.ok("a variant whose number is the count", fidelityTestHas(it, "I15.expect:", "x25519 names 25519"))
  t.ok("not a count: malformed groups", fidelityTestHas(it, "I16.iterate:", "the count 1,000,000 is not printed"))
  t.ok("another variant beside its rounds", fidelityTestHas(it, "I17.expect:", "x25519 names 25519"))
  t.ok("its own variant beside its rounds", !fidelityTestHas(it, "I18", ""))
  t.ok("another variant beside its times", fidelityTestHas(it, "I19.expect:", "x25519 names 25519"))
  t.ok(
    "a label that counts times",
    fidelityTestHas(it, "I20.expect:", `"X25519 applied 1,000 times" counts 1,000, but the vector iterates 5 times`),
  )
  t.ok("a count before a hyphen", !fidelityTestHas(it, "I21", ""))
  t.ok("a count after an en dash", !fidelityTestHas(it, "I22", ""))
  t.ok("a number at the margin, not a heading", !fidelityTestHas(it, "I23", ""))
  t.ok(
    "a label's only number",
    fidelityTestHas(it, "I24.expect:", `"Round 7" counts 7, but the vector iterates 9 times`),
  )
  t.ok("two numbers and no word: unchecked", !fidelityTestHas(it, "I25", ""))
  fidelityTestTable(t)
  fidelityTestEmpty(t)
  fidelityTestCases(t)
  fidelityTestOnce(t)
  fidelityTestWrapped(t)
  t.ok("iterated findings", it.length === 19)
  if (it.length !== 19) {
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
