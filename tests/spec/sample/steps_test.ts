import { Suite } from "nish/testing"
import { contractParse } from "../../../src/spec/contract/read"
import { Clause } from "../../../src/spec/contract/types"
import { sampleIntText, sampleParseInt } from "../../../src/spec/sample/ints"
import { sampleProperty } from "../../../src/spec/sample/property"

/** The i64 minimum and maximum as text. */
const STEPS_I64_MIN: string = "-9223372036854775808"
const STEPS_I64_MAX: string = "9223372036854775807"

/** A bound as the contract writes it: a number when small, else a string. */
const stepsJson = (n: string): string => (n.length < 10 ? n : `"${n}"`)

/** A contract with one property over one variable of a type and range. */
const stepsClause = (ty: string, lo: string, hi: string): Clause => {
  const json = `{
  "contract": "c1",
  "source": {"title": "T", "rfc": 9999},
  "target": {"module": "nish/x"},
  "requirements": [{"id": "R1", "section": "2", "level": "MUST", "quote": "Q"}],
  "functions": [{"name": "f", "params": [{"name": "a", "type": "bytes"}], "returns": "bytes"}],
  "clauses": [
    {"kind": "property", "id": "P1", "title": "t", "covers": ["R1"],
     "forall": [{"name": "x", "type": "${ty}", "min": ${stepsJson(lo)}, "max": ${stepsJson(hi)}}],
     "assert": {"op": "==", "args": [{"var": "x"}, {"var": "x"}]}}
  ]
}`
  return contractParse(json, "c1").expect("parse").clauses[0]
}

/** The texts of the first variable in every sample of a property over a range. */
const stepsSampled = (ty: string, lo: string, hi: string): string[] => {
  const o = sampleProperty("c1", stepsClause(ty, lo, hi)).expect("sample")
  return o.samples.map((s): string => s.args[0].text)
}

/** The int parser's negative branch and the boundary steps of the sampler. */
export const main = (): i32 => {
  const t = new Suite("spec/sample/steps")

  // int parser, negative branch
  const min = sampleParseInt(STEPS_I64_MIN).expect("i64 min")
  t.eqStr("parse i64 min", sampleIntText(min, "i64"), STEPS_I64_MIN)
  const nearMin = sampleParseInt("-9223372036854775807").expect("min + 1")
  t.eqStr("parse min + 1", sampleIntText(nearMin, "i64"), "-9223372036854775807")
  t.ok("min + 1 is one above min", nearMin - min === toI64(1))
  t.ok("parse -1", sampleParseInt("-1").expect("-1") === toI64(-1))
  t.ok("parse -0", sampleParseInt("-0").expect("-0") === toI64(0))
  const past = sampleParseInt("-9223372036854775809")
  t.ok("past i64 min is refused", past.isErr())
  t.eqStr("past i64 min message", past.isErr() ? past.error : "", "out of range: -9223372036854775809")

  // boundary steps
  const up = stepsSampled("u64", STEPS_I64_MAX, "18446744073709551615")
  t.ok("u64 lo at i64 max steps to 2^63", up.indexOf("9223372036854775808") >= 0)
  const down = stepsSampled("u64", "0", "9223372036854775808")
  t.ok("u64 hi at 2^63 steps down to i64 max", down.indexOf(STEPS_I64_MAX) >= 0)
  const full = stepsSampled("i64", STEPS_I64_MIN, STEPS_I64_MAX)
  t.ok("i64 full range steps to min + 1", full.indexOf("-9223372036854775807") >= 0)
  t.ok("i64 full range steps to max - 1", full.indexOf("9223372036854775806") >= 0)
  const same = stepsSampled("i64", "5", "5")
  t.ok("lo == hi adds no steps", same.length > 0 && same.every((s: string): boolean => s === "5"))
  const pair = stepsSampled("i64", "5", "6")
  t.ok("a range of two has just its ends", pair.every((s: string): boolean => s === "5" || s === "6"))

  return t.done()
}
