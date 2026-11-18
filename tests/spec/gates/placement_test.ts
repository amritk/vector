import { Suite } from "nish/testing"
import { CheckContext } from "../../../src/spec/check"
import { contractParse } from "../../../src/spec/contract/read"
import { gateFidelity } from "../../../src/spec/gates/fidelity"
import { LoadedSource, SourceSet } from "../../../src/spec/source/load"
import { rfcParse } from "../../../src/spec/source/rfc"

// Where the fidelity gate places a refusal of an iterated or truncated
// vector: at the part that holds the value refused (`<id>.iterate`,
// `<id>.expect`, `<id>.truncate`), never at the vector alone, so extract
// places each at its own paragraph without reading the message.

/** Vectors of §1 that each break one rule: P1 its count, P2 its label's count, P3 its truncation; P4 none. */
const PLACEMENT_TEST_C: string = `{
  "contract": "c6",
  "source": {"title": "T", "rfc": 9995},
  "target": {"module": "nish/x"},
  "requirements": [{"id": "R1", "section": "1", "level": "MUST", "quote": "It MUST iterate."}],
  "functions": [
    {"name": "x25519", "params": [{"name": "k", "type": "bytes"}, {"name": "u", "type": "bytes"}], "returns": "bytes"},
    {"name": "hmacSha256", "params": [{"name": "key", "type": "bytes"}, {"name": "data", "type": "bytes"}], "returns": "bytes"}
  ],
  "clauses": [
    {"kind": "vector", "id": "P1", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "1"}}, "call": "x25519",
     "args": [{"hex": "0909", "label": "For X25519"}, {"hex": "0909", "label": "For X25519"}], "expect": {"hex": "2222", "label": "Result"},
     "iterate": {"count": 7, "names": ["k", "u"], "next": [{"call": "x25519", "args": [{"var": "k"}, {"var": "u"}]}, {"var": "k"}]}},
    {"kind": "vector", "id": "P2", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "1"}}, "call": "x25519",
     "args": [{"hex": "0909", "label": "For X25519"}, {"hex": "0909", "label": "For X25519"}], "expect": {"hex": "3333", "label": "After 1,000,000 iterations"},
     "iterate": {"count": 1000, "names": ["k", "u"], "next": [{"call": "x25519", "args": [{"var": "k"}, {"var": "u"}]}, {"var": "k"}]}},
    {"kind": "vector", "id": "P3", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "1"}}, "call": "hmacSha256",
     "args": [{"hex": "0909", "label": "For X25519"}, {"hex": "0909", "label": "For X25519"}], "expect": {"hex": "4444", "label": "Mac"},
     "truncate": {"bits": 16}},
    {"kind": "vector", "id": "P4", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "1"}}, "call": "x25519",
     "args": [{"hex": "0909", "label": "For X25519"}, {"hex": "0909", "label": "For X25519"}], "expect": {"hex": "5555", "label": "After 1,000 iterations"},
     "iterate": {"count": 1000, "names": ["k", "u"], "next": [{"call": "x25519", "args": [{"var": "k"}, {"var": "u"}]}, {"var": "k"}]}}
  ]
}`

const PLACEMENT_TEST_RFC: string = `Request for Comments: 9995

1.  Rounds

   It MUST iterate 1,000 times.

   For X25519 = 0x0909
   Result = 0x2222
   After 1,000,000 iterations = 0x3333
   Mac = 0x4444
   After 1,000 iterations = 0x5555
`

/** The fidelity findings on PLACEMENT_TEST_C, each `<at>: <message>`. */
const placementTestNotes = (): string[] => {
  const ctx = new CheckContext("contracts/c6.json", ".")
  ctx.contract = contractParse(PLACEMENT_TEST_C, "c6").expect("parse")
  const set = new SourceSet()
  set.main = "rfc9995"
  set.sources.push(new LoadedSource("rfc9995", "r.txt", "r.txt", rfcParse(PLACEMENT_TEST_RFC)))
  ctx.sources = set
  return gateFidelity(ctx)
}

/** The notes about vector `id`, the `at` of each. */
const placementTestAt = (notes: string[], id: string): string[] =>
  notes
    .filter((n: string): boolean => n.startsWith(`${id}:`) || n.startsWith(`${id}.`))
    .map((n: string): string => n.substring(0, n.indexOf(": ")))

/** Each vector's refusals are placed at the part holding what is refused, and nowhere else. */
export const main = (): i32 => {
  const t = new Suite("gates: placement")
  const notes = placementTestNotes()
  const rows: string[][] = [
    ["an unprinted count, at its Iterate paragraph", "P1", "P1.iterate"],
    ["a label counting other rounds, at its expect", "P2", "P2.expect"],
    ["an unprinted truncation, at its truncate", "P3", "P3.truncate"],
    ["a printed count and its own label, nowhere", "P4", ""],
  ]
  for (const row of rows) {
    const got = placementTestAt(notes, row[1]).join(",")
    t.ok(row[0], got === row[2])
    if (got !== row[2]) {
      console.log(`${row[0]}: want "${row[2]}", got "${got}"\n${notes.join("\n")}`)
    }
  }
  return t.done()
}
