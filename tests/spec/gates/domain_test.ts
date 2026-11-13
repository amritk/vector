import { Suite } from "nish/testing"
import { CheckContext, Sample, checkSamplesOf } from "../../../src/spec/check"
import { contractParse } from "../../../src/spec/contract/read"
import { gateDomain } from "../../../src/spec/gates/domain"
import { sampleParseInt } from "../../../src/spec/sample/ints"
import { SampleOutcome, sampleAlphabet, sampleProperty } from "../../../src/spec/sample/property"

/** One property per case the domain gate tells apart. */
const DOMAIN_TEST_C: string = `{
  "contract": "c1",
  "source": {"title": "T", "rfc": 9999},
  "target": {"module": "nish/x"},
  "requirements": [{"id": "R1", "section": "2", "level": "MUST", "quote": "Q"}],
  "functions": [{"name": "f", "params": [{"name": "a", "type": "bytes"}], "returns": "bytes"}],
  "clauses": [
    {"kind": "property", "id": "P-ORDER", "title": "t", "covers": ["R1"],
     "forall": [{"name": "n", "type": "i32", "min": 0, "max": 300}, {"name": "m", "type": "i32", "min": 0, "max": 300}],
     "where": {"op": "<=", "args": [{"var": "n"}, {"var": "m"}]},
     "assert": {"op": "==", "args": [{"var": "n"}, {"var": "n"}]}},
    {"kind": "property", "id": "P-EMPTY", "title": "t", "covers": ["R1"],
     "forall": [{"name": "n", "type": "i32", "min": 0, "max": 10}],
     "where": {"op": "<", "args": [{"var": "n"}, {"int": 0}]},
     "assert": {"op": "==", "args": [{"var": "n"}, {"var": "n"}]}},
    {"kind": "property", "id": "P-U64", "title": "t", "covers": ["R1"],
     "forall": [{"name": "x", "type": "u64", "min": 0, "max": "18446744073709551615"},
                {"name": "s", "type": "string", "minLen": 1, "maxLen": 3, "alphabet": ["a", "b", "a"]}],
     "assert": {"op": "==", "args": [{"var": "x"}, {"var": "x"}]}},
    {"kind": "property", "id": "P-CALL", "title": "t", "covers": ["R1"],
     "forall": [{"name": "a", "type": "bytes", "minLen": 0, "maxLen": 4}],
     "where": {"op": "==", "args": [{"call": "f", "args": [{"var": "a"}]}, {"var": "a"}]},
     "assert": {"op": "==", "args": [{"var": "a"}, {"var": "a"}]}}
  ]
}`

/** A context holding the test contract. */
const domainTestCtx = (): CheckContext => {
  const ctx = new CheckContext("contracts/c1.json", ".")
  ctx.contract = contractParse(DOMAIN_TEST_C, "c1").expect("parse")
  return ctx
}

/** A sample's i-th value as an integer. */
const domainTestInt = (s: Sample, i: i32): i64 => sampleParseInt(s.args[i].text).expect("int")

/** One clause sampled directly. */
const domainTestSample = (i: i32): SampleOutcome => {
  const c = contractParse(DOMAIN_TEST_C, "c1").expect("parse")
  return sampleProperty(c.contract, c.clauses[i]).expect("sample")
}

/** A sample's values joined, to compare two runs. */
const domainTestKey = (s: Sample): string => `${s.why}=${s.args.map((a): string => a.text).join(",")}`

/** The domain gate and the property sampler. */
export const main = (): i32 => {
  const t = new Suite("spec/gates/domain")
  const ctx = domainTestCtx()
  const found = gateDomain(ctx)
  t.eqLines("the findings", found, [
    "P-EMPTY: the domain is empty (Z3: unsat) — the property would hold vacuously",
    "P-CALL: where: cannot be evaluated: calls f, and a call is not evaluated here",
  ])
  t.ok("no tool failure", ctx.toolFailure === null)
  t.ok("a stat per sampled property", ctx.sampleStats.length === 4)

  const order = checkSamplesOf(ctx.samples, "P-ORDER")
  let inWhere = true
  let equal = false
  let boundary = 0
  for (const s of order) {
    const n = domainTestInt(s, 0)
    const m = domainTestInt(s, 1)
    inWhere = inWhere && n <= m && n >= toI64(0) && m <= toI64(300)
    equal = equal || n === m
    if (s.why.startsWith("boundary")) {
      boundary++
    }
  }
  t.ok("every sample satisfies where", order.length >= 20 && inWhere)
  t.ok("the edge n == m is sampled", equal)
  t.ok("boundaries come first and are counted", boundary > 0 && boundary === ctx.sampleStats[0].boundary)
  t.ok("inhabited", ctx.sampleStats[0].inhabited && !ctx.sampleStats[1].inhabited)
  t.ok("an empty domain has no samples", checkSamplesOf(ctx.samples, "P-EMPTY").length === 0)

  const u = checkSamplesOf(ctx.samples, "P-U64")
  let big = false
  let chars = true
  for (const s of u) {
    big = big || s.args[0].text === "18446744073709551615"
    const text = s.args[1].text
    for (let i = 0; i < text.length; i++) {
      chars = chars && (text.charCodeAt(i) === 97 || text.charCodeAt(i) === 98)
    }
  }
  t.ok("the u64 maximum is sampled, unsigned", big)
  t.ok("strings draw from the alphabet", u.length > 0 && chars)

  const again = domainTestSample(0).samples.map(domainTestKey).join(" ")
  t.ok("sampling is reproducible", again === order.map(domainTestKey).join(" "))
  const empty = domainTestSample(1)
  t.ok("an outcome carries its issue", empty.issue !== null && empty.samples.length === 0)
  const c = contractParse(DOMAIN_TEST_C, "c1").expect("parse")
  t.eqStr("an alphabet's characters, each once", sampleAlphabet(c.clauses[2].forall[1]).join(""), "ab")
  const printable = c.clauses[2].forall[1]
  printable.alphabet = null
  t.ok("no alphabet is printable ascii", sampleAlphabet(printable).length === 95)
  return t.done()
}
