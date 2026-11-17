import { Suite } from "nish/testing"
import { CheckContext, CheckNote, CheckSourceRun } from "../../../src/spec/check"
import { contractParse } from "../../../src/spec/contract/read"
import { LitKind, Literal } from "../../../src/spec/contract/types"
import { gateWarnings } from "../../../src/spec/gates/note"
import { gateProvenance } from "../../../src/spec/gates/provenance"
import { gateResultWord } from "../../../src/spec/gates/result"
import { LoadedSource, SourceSet } from "../../../src/spec/source/load"
import { rfcParse } from "../../../src/spec/source/rfc"

/** A contract whose vectors take their expected values from the spec or a command. */
const PROVENANCE_TEST_C: string = `{
  "contract": "c1",
  "source": {"title": "T", "rfc": 9999},
  "target": {"module": "nish/x"},
  "requirements": [
    {"id": "R1", "section": "2", "level": "MUST", "quote": "It MUST return null when the input is odd."}
  ],
  "functions": [{"name": "f", "params": [{"name": "a", "type": "string"}], "returns": "bytes?"},
    {"name": "b", "params": [{"name": "a", "type": "string"}], "returns": "bool"}],
  "clauses": [
    {"kind": "vector", "id": "P1", "title": "t", "covers": ["R1"], "source": {"spec": "2"}, "call": "f",
     "args": [{"str": "abc"}], "expect": {"null": true}},
    {"kind": "vector", "id": "P2", "title": "t", "covers": ["R1"], "source": {"spec": "2"}, "call": "b",
     "args": [{"str": "abc"}], "expect": {"bool": true}},
    {"kind": "vector", "id": "P3", "title": "t", "covers": ["R1"], "source": {"command": "echo 00"}, "call": "f",
     "args": [{"str": "a"}], "expect": {"hex": "00"}},
    {"kind": "vector", "id": "P4", "title": "t", "covers": ["R1"], "source": {"command": "echo 01"}, "call": "f",
     "args": [{"str": "a"}], "expect": {"hex": "00"}},
    {"kind": "vector", "id": "P5", "title": "t", "covers": ["R1"], "source": {"command": "echo 00"}, "call": "f",
     "args": [{"str": "b"}], "expect": {"hex": "00"}},
    {"kind": "vector", "id": "P6", "title": "t", "covers": ["R1"], "source": {"spec": "9"}, "call": "f",
     "args": [{"str": "abc"}], "expect": {"null": true}}
  ]
}`

/** The RFC the contract cites. */
const PROVENANCE_TEST_RFC: string = `Request for Comments: 9999

1.  Intro

   Hello there.

2.  Rules

   It MUST return null when the input is odd.
`

/**
 * A contract whose vectors cite their inputs to one section and their result
 * to another: section 2 states "true", section 1 states nothing.
 */
const PROVENANCE_TEST_APART: string = `{
  "contract": "c2",
  "source": {"title": "T", "rfc": 9998},
  "target": {"module": "nish/x"},
  "requirements": [
    {"id": "R2", "section": "2", "level": "MUST", "quote": "It MUST return true when the tag matches."},
    {"id": "R3", "section": "3", "level": "MUST", "quote": "It MUST print the tags."}
  ],
  "functions": [{"name": "b", "params": [{"name": "a", "type": "string"}], "returns": "bool"}],
  "clauses": [
    {"kind": "vector", "id": "Q1", "title": "t", "covers": ["R2"], "source": {"spec": "2"}, "section": "3", "call": "b",
     "args": [{"str": "abc"}], "expect": {"bool": true}},
    {"kind": "vector", "id": "Q2", "title": "t", "covers": ["R2"], "source": {"spec": "1"}, "section": "3", "call": "b",
     "args": [{"str": "abc"}], "expect": {"bool": true}}
  ]
}`

/** The RFC the two-citation contract cites. */
const PROVENANCE_TEST_APART_RFC: string = `Request for Comments: 9998

1.  Intro

   Hello there.

2.  Checking

   It MUST return true when the tag matches.

3.  Tags

   It MUST print the tags.
`

/** A context over the two-citation contract. */
const provenanceTestApart = (): CheckContext => {
  const ctx = new CheckContext("contracts/c2.json", ".")
  ctx.contract = contractParse(PROVENANCE_TEST_APART, "c2").expect("parse apart")
  const set = new SourceSet()
  set.main = "rfc9998"
  set.sources.push(new LoadedSource("rfc9998", "r.txt", "r.txt", rfcParse(PROVENANCE_TEST_APART_RFC)))
  ctx.sources = set
  return ctx
}

/** A context with the contract, a hand-built source set, and two commands run. */
const provenanceTestCtx = (): CheckContext => {
  const ctx = new CheckContext("contracts/c1.json", ".")
  ctx.contract = contractParse(PROVENANCE_TEST_C, "c1").expect("parse")
  const set = new SourceSet()
  set.main = "rfc9999"
  set.sources.push(new LoadedSource("rfc9999", "r.txt", "r.txt", rfcParse(PROVENANCE_TEST_RFC)))
  ctx.sources = set
  ctx.sourceRuns.push(new CheckSourceRun("P4", "echo 01", "fail", "printed 01, not 00"))
  ctx.sourceRuns.push(new CheckSourceRun("P5", "echo 00", "pass", "00"))
  return ctx
}

/** A literal of a kind, for gateResultWord. */
const provenanceTestLit = (kind: LitKind, flag: boolean): Literal => {
  const l = new Literal(kind, "")
  l.flag = flag
  return l
}

/** Whether some finding starts with `head`. */
const provenanceTestHas = (all: string[], head: string): boolean =>
  all.some((f: string): boolean => f.indexOf(head) === 0)

/** The provenance gate. */
export const main = (): i32 => {
  const t = new Suite("spec/gates/provenance")
  t.eqStr("no value", gateResultWord(null), "")
  t.eqStr("null", gateResultWord(provenanceTestLit(LitKind.Null, false)), "null")
  t.eqStr("true", gateResultWord(provenanceTestLit(LitKind.Bool, true)), "true")
  t.eqStr("false", gateResultWord(provenanceTestLit(LitKind.Bool, false)), "false")
  t.eqStr("bytes", gateResultWord(provenanceTestLit(LitKind.Hex, false)), "")
  const ctx = provenanceTestCtx()
  const all = gateProvenance(ctx)
  t.ok("a stated result", !provenanceTestHas(all, "P1"))
  t.ok(
    "a result not stated",
    provenanceTestHas(all, `P2.source: RFC §2 ("Rules") does not state the expected result: R1`),
  )
  t.ok("a failed command", all.indexOf("P4.source: source command printed 01, not 00: $ echo 01") >= 0)
  t.ok("a passed command", !provenanceTestHas(all, "P5"))
  t.ok("a missing section", all.indexOf("P6.source: RFC 9999 has no section 9") >= 0)
  const warns = gateWarnings(ctx)
  t.ok(
    "a command not run",
    warns.some(
      (n: CheckNote): boolean =>
        n.at === "P3.source" &&
        n.message === "source command not run (pass --run-sources): the expected value is unverified: $ echo 00",
    ),
  )
  t.ok("findings", all.length === 3)
  if (all.length !== 3) {
    console.log(all.join("\n"))
  }
  const apart = gateProvenance(provenanceTestApart())
  t.ok("a result stated by another section than the inputs'", !provenanceTestHas(apart, "Q1"))
  t.eqStr(
    "a result section that states nothing, named with the inputs' section",
    apart.join("\n"),
    'Q2.source: RFC §1 ("Intro"), the result citation of Q2 (inputs §3), does not state the expected result: Q2 covers no requirement cited to it, so nothing there requires the result "true"; and no property derives it: no property covers a requirement of the result\'s section that Q2 covers',
  )
  return t.done()
}
