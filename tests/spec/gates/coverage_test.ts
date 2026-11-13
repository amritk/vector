import { Suite } from "nish/testing"
import { CheckContext } from "../../../src/spec/check"
import { contractParse } from "../../../src/spec/contract/read"
import {
  gateArgsAt,
  gateCiteLabel,
  gateCitedSection,
  gateFunction,
  gatePlace,
  gateQuoteMissing,
  gateSources,
  gateTargets,
} from "../../../src/spec/gates/cite"
import { gateCoverage } from "../../../src/spec/gates/coverage"
import { gateStatesResult } from "../../../src/spec/gates/result"
import { LoadedSource, SourceSet } from "../../../src/spec/source/load"
import { rfcParse, rfcSection } from "../../../src/spec/source/rfc"

/** A contract with an uncovered requirement, a reference vector and properties that test nothing. */
const COVERAGE_TEST_C: string = `{
  "contract": "c1",
  "source": {"title": "T", "rfc": 9999},
  "target": {"module": "nish/x"},
  "requirements": [
    {"id": "R1", "section": "2", "level": "MUST", "quote": "It MUST return true when the input is empty."},
    {"id": "R2", "section": "2", "level": "MUST", "quote": "Q"},
    {"id": "R3", "section": "2", "level": "MAY", "quote": "Q"},
    {"id": "R4", "section": "2", "level": "MUST", "quote": "It MUST return true or throw."},
    {"id": "R5", "section": "2", "level": "MUST", "quote": "it MUST return false, unless told not to."},
    {"id": "R6", "section": "2", "level": "MUST", "quote": "it MUST be true"}
  ],
  "functions": [
    {"name": "f", "params": [{"name": "b", "type": "bytes"}], "returns": "bool"},
    {"name": "h", "module": "nish/ref", "params": [{"name": "b", "type": "bytes"}], "returns": "bool"}
  ],
  "clauses": [
    {"kind": "vector", "id": "V1", "title": "t", "covers": ["R1", "R9"],
     "source": {"cite": {"section": "2"}}, "call": "f", "args": [{"hex": ""}], "expect": {"bool": true}},
    {"kind": "vector", "id": "V2", "title": "t", "covers": ["R4"],
     "source": {"cite": {"section": "2"}}, "call": "h", "args": [{"hex": ""}], "expect": {"bool": true}},
    {"kind": "vector", "id": "V3", "title": "t", "covers": ["R5", "R6"],
     "source": {"cite": {"section": "2"}}, "call": "f", "args": [{"hex": "00"}], "expect": {"bool": false}},
    {"kind": "vector", "id": "V4", "title": "t", "covers": ["R6"],
     "source": {"cite": {"section": "2"}}, "call": "f", "args": [{"hex": "01"}], "expect": {"bool": true}},
    {"kind": "property", "id": "P1", "title": "t", "covers": ["R1"],
     "forall": [{"name": "x", "type": "u8", "min": 0, "max": 9}], "assert": {"op": "==", "args": [{"var": "x"}, {"var": "x"}]}},
    {"kind": "property", "id": "P2", "title": "t", "covers": ["R1"],
     "forall": [{"name": "x", "type": "bytes", "minLen": 0, "maxLen": 9}], "assert": {"call": "h", "args": [{"var": "x"}]}}
  ]
}`

/** The RFC the contract cites. */
const COVERAGE_TEST_RFC: string = `Request for Comments: 9999

1.  Intro

   Hello there.

2.  Rules

   It MUST return true when the input is empty.  It MUST return true or
   throw.  Otherwise it MUST return false, unless told not to.

   If the flag is set, it MUST be true.
`

/** A reason, or "" for none. */
const coverageTestOr = (s: string | null): string => (s !== null ? s : "")

/** A context with the contract and a hand-built source set. */
const coverageTestCtx = (): CheckContext => {
  const ctx = new CheckContext("contracts/c1.json", ".")
  ctx.contract = contractParse(COVERAGE_TEST_C, "c1").expect("parse")
  const set = new SourceSet()
  set.main = "rfc9999"
  set.sources.push(new LoadedSource("rfc9999", "r.txt", "r.txt", rfcParse(COVERAGE_TEST_RFC)))
  ctx.sources = set
  return ctx
}

/** The coverage gate, the citation helpers and the result statement check. */
export const main = (): i32 => {
  const t = new Suite("spec/gates/coverage")
  const ctx = coverageTestCtx()
  const all = gateCoverage(ctx).join("\n")
  t.ok("an unknown requirement", all.indexOf(`V1: cites requirement "R9", which the contract does not state`) >= 0)
  t.ok("an uncovered MUST", all.indexOf("R2: MUST requirement (RFC §2) is not checked by any clause") >= 0)
  t.ok("an uncovered MAY only warns", all.indexOf("R3") < 0)
  t.ok("a reference vector", all.indexOf("V2: calls h, a reference function, not a function of nish/x") >= 0)
  t.ok("a property calling nothing", all.indexOf("P1: the assertion calls none of the functions under test") >= 0)
  t.ok("a property calling a reference", all.indexOf("P2: the assertion calls only reference functions (h)") >= 0)
  const cov = ctx.coverage.get("R1")
  t.ok("coverage recorded", cov !== undefined && cov.join(",") === "V1,P1,P2")

  const c = ctx.contract
  const out: string[] = []
  const set = gateSources(ctx, out, "g")
  t.eqStr("a main label", gateCiteLabel(set, null, "2"), "§2")
  t.eqStr("another label", gateCiteLabel(set, "rfc2104", "2"), "rfc2104 §2")
  t.eqStr("a place in the RFC", gatePlace(set, null, "2"), "RFC §2")
  t.ok("a missing section", gateCitedSection(ctx, out, "g", null, "7", "V1") === null)
  t.eqStr("its finding", out.join("|"), "V1: RFC 9999 has no section 7")
  const sec = gateCitedSection(ctx, out, "g", null, "2", "V1")
  t.ok("a present section", sec !== null)
  t.eqStr("targets", gateTargets(c).join(","), "f")
  t.ok("a function by name", gateFunction(c, "h") !== null && gateFunction(c, "z") === null)
  t.eqStr("args at the cite", gateArgsAt(c.clauses[0]).section, "2")
  if (sec !== null) {
    t.ok("a quote that is there", gateQuoteMissing(sec, "It MUST return   true") === null)
    t.eqStr("a quote that is not", coverageTestOr(gateQuoteMissing(sec, "It MUST return null")), "quote not found")
    t.eqStr("an empty quote", coverageTestOr(gateQuoteMissing(sec, "  ")), "the quote is empty")
    t.ok("a stated result", gateStatesResult(c, set, c.clauses[0], gateArgsAt(c.clauses[0]), sec, "true") === null)
    const alt = coverageTestOr(gateStatesResult(c, set, c.clauses[1], gateArgsAt(c.clauses[1]), sec, "true"))
    t.ok("an alternative", alt.indexOf(`R4 offers an alternative right after "true" ("or")`) >= 0)
    const none = coverageTestOr(gateStatesResult(c, set, c.clauses[0], gateArgsAt(c.clauses[0]), sec, "false"))
    t.ok("another word", none.indexOf('R1 does not require "false"') >= 0)
    const back = coverageTestOr(gateStatesResult(c, set, c.clauses[2], gateArgsAt(c.clauses[2]), sec, "false"))
    t.ok("a retraction", back.indexOf(`R5 retracts "false" after stating it ("not")`) >= 0)
  }
  const s3 = rfcSection(set.sources[0].doc, "2")
  if (s3 !== null) {
    const iff = coverageTestOr(gateStatesResult(c, set, c.clauses[3], gateArgsAt(c.clauses[3]), s3, "true"))
    t.ok(
      "a condition before the quote",
      iff.indexOf(`R6 is cut from a sentence that qualifies it before the quote ("If")`) >= 0,
    )
  }
  const s1 = rfcSection(set.sources[0].doc, "1")
  if (s1 !== null) {
    t.ok(
      "covers nothing cited there",
      coverageTestOr(gateStatesResult(c, set, c.clauses[0], gateArgsAt(c.clauses[0]), s1, "true")).indexOf(
        "V1 covers no requirement cited to it",
      ) === 0,
    )
  }
  return t.done()
}
