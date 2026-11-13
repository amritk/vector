import { Suite } from "nish/testing"
import { replaceAll } from "nish/text"
import {
  CheckContext,
  CheckGateEntry,
  Sample,
  checkAddSample,
  checkContract,
  checkContractWith,
  checkGates,
  checkLines,
  checkPassed,
  checkSamplesOf,
  checkShapeGate,
} from "../../../src/spec/check"
import { contractParse } from "../../../src/spec/contract/read"
import { Contract, LitKind, Literal } from "../../../src/spec/contract/types"

/** A small valid contract. */
const CHECK_TEST_BASE: string = `{
  "contract": "c1",
  "source": {"title": "T", "rfc": 4648},
  "target": {"module": "nish/hex"},
  "requirements": [{"id": "R1", "section": "3.1", "level": "MUST", "quote": "Q"}],
  "functions": [{"name": "enc", "params": [{"name": "b", "type": "bytes"}], "returns": "string"}],
  "clauses": [
    {"kind": "vector", "id": "V1", "title": "t", "covers": ["R1"],
     "source": {"cite": {"section": "10"}}, "call": "enc", "args": [{"hex": "00"}], "expect": {"str": "00"}}
  ]
}`

/** A gate that always finds one thing. */
const checkTestFinds = (_ctx: CheckContext): string[] => ["found"]

/** A gate that finds nothing, and adds a sample for V1. */
const checkTestSamples = (ctx: CheckContext): string[] => {
  checkAddSample(ctx.samples, new Sample("P1", [new Literal(LitKind.Int, "0")], "min of x"))
  return []
}

/** The contract parsed from `text`. */
const checkTestContract = (text: string): Contract => contractParse(text, "base").expect("parse")

/** The check pipeline: gates in order, blocking gates, findings and samples. */
export const main = (): i32 => {
  const t = new Suite("spec/check")
  const ctx = new CheckContext("contracts/c1.json", ".")
  const good = checkTestContract(CHECK_TEST_BASE)

  // The registry.
  const gates = checkGates()
  t.ok("only the shape gate is registered", gates.length === 1 && gates[0].name === "shape" && gates[0].blocking)
  ctx.contract = good
  t.ok("it runs the shape check", checkShapeGate(ctx).length === 0)

  // A passing contract.
  const ok = checkContract(ctx, good)
  t.ok("a valid contract passes", checkPassed(ok))
  t.eqStr("the shape gate ran", ok.ran.join(","), "shape")

  // A shape error is reported under the gate's name.
  const bad = checkTestContract(replaceAll(CHECK_TEST_BASE, '"c1"', '"-c1"'))
  const r = checkContract(ctx, bad)
  t.ok("a malformed contract fails", !checkPassed(r))
  t.eqStr("its finding", checkLines(r).join("\n"), "shape: contract.contract: an id ([A-Za-z0-9._-])")

  // A blocking gate with a finding stops the gates after it; others do not.
  const chain: CheckGateEntry[] = [
    new CheckGateEntry("a", checkTestFinds, false),
    new CheckGateEntry("shape", checkShapeGate, true),
    new CheckGateEntry("b", checkTestFinds, false),
  ]
  const stopped = checkContractWith(ctx, bad, chain)
  t.eqStr("ran", stopped.ran.join(","), "a,shape")
  t.eqStr("skipped", stopped.skipped.join(","), "b")
  t.eqStr("every finding before the stop", `${stopped.findings.length}`, "2")
  const through = checkContractWith(ctx, good, chain)
  t.eqStr("a blocking gate that passes stops nothing", through.ran.join(","), "a,shape,b")
  t.eqStr("findings in gate order", checkLines(through).join(" | "), "a: found | b: found")

  // Samples a gate chooses reach the report.
  const sctx = new CheckContext("c.json", ".")
  const sampled = checkContractWith(sctx, good, [new CheckGateEntry("sample", checkTestSamples, false)])
  const ps = checkSamplesOf(sampled.samples, "P1")
  t.ok("the sample is in the report", ps.length === 1 && ps[0].why === "min of x" && ps[0].args[0].text === "0")
  t.ok("by clause", checkSamplesOf(sampled.samples, "P2").length === 0)
  return t.done()
}
