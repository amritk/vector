import { Suite } from "nish/testing"
import { replaceAll } from "nish/text"
import {
  CheckContext,
  CheckGateEntry,
  CheckGateKind,
  CheckReport,
  checkContract,
  checkContractWith,
  checkGates,
  checkLines,
  checkPassed,
  checkSamplesOf,
  checkShapeGate,
} from "../../../src/spec/check"
import { contractParse } from "../../../src/spec/contract/read"
import { Contract } from "../../../src/spec/contract/types"
import { gateCompleteness } from "../../../src/spec/gates/completeness"
import { gateCoverage } from "../../../src/spec/gates/coverage"
import { gateDomain } from "../../../src/spec/gates/domain"
import { gateFidelity } from "../../../src/spec/gates/fidelity"
import { gateIds } from "../../../src/spec/gates/ids"
import { gateProvenance } from "../../../src/spec/gates/provenance"
import { gateRunSources } from "../../../src/spec/gates/run"
import { gateSignatures } from "../../../src/spec/gates/signatures"
import { gateTyping } from "../../../src/spec/gates/typing"

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

/**
 * A contract shape accepts and every other gate has something to say about:
 * a duplicate id (ids), an i32 where enc takes bytes (typing), an uncited
 * requirement and an unchecked one (coverage), quotes RFC 4648 does not print
 * (fidelity), its MUST sentences left out (completeness), a command source
 * (run-sources records it), a spec section the RFC lacks (provenance), an
 * empty domain and a sampled one (domain).
 */
const CHECK_TEST_GATES: string = `{
  "contract": "c1",
  "source": {"title": "T", "rfc": 4648},
  "target": {"module": "nish/hex"},
  "requirements": [{"id": "R1", "section": "3.1", "level": "MUST", "quote": "Q"},
    {"id": "R2", "section": "3.1", "level": "MUST", "quote": "Q2"}],
  "functions": [{"name": "enc", "params": [{"name": "b", "type": "bytes"}], "returns": "string"}],
  "clauses": [
    {"kind": "vector", "id": "V1", "title": "t", "covers": ["R1"],
     "source": {"cite": {"section": "10"}}, "call": "enc", "args": [{"hex": "00"}], "expect": {"str": "00"}},
    {"kind": "vector", "id": "V1", "title": "t", "covers": ["R9"],
     "source": {"cite": {"section": "10"}}, "call": "enc", "args": [{"int": 3}], "expect": {"int": 1}},
    {"kind": "vector", "id": "V2", "title": "t", "covers": ["R1"],
     "source": {"command": "echo 00"}, "section": "10", "call": "enc", "args": [{"hex": "00"}], "expect": {"str": "00"}},
    {"kind": "vector", "id": "V3", "title": "t", "covers": ["R1"],
     "source": {"spec": "99"}, "section": "10", "call": "enc", "args": [{"hex": "00"}], "expect": {"null": true}},
    {"kind": "property", "id": "P1", "title": "t", "covers": ["R1"],
     "forall": [{"name": "n", "type": "i32", "min": 0, "max": 10}],
     "where": {"op": "<", "args": [{"var": "n"}, {"int": 0}]},
     "assert": {"op": "==", "args": [{"var": "n"}, {"var": "n"}]}},
    {"kind": "property", "id": "P2", "title": "t", "covers": ["R1"],
     "forall": [{"name": "n", "type": "i32", "min": 0, "max": 10}],
     "assert": {"op": "==", "args": [{"var": "n"}, {"var": "n"}]}}
  ]
}`

/** The module file the signatures gate is pointed at, which does not exist. */
const CHECK_TEST_NO_MODULE: string = "tests/spec/contract/no-such-module.ts"

/** The contract parsed from `text`. */
const checkTestContract = (text: string): Contract => contractParse(text, "base").expect("parse")

/** A fresh context holding `text`'s contract, as checkContractWith leaves it before its first gate. */
const checkTestCtx = (text: string): CheckContext => {
  const ctx = new CheckContext("contracts/c1.json", ".")
  ctx.contract = checkTestContract(text)
  ctx.moduleFile = CHECK_TEST_NO_MODULE
  return ctx
}

/** A run of the one gate `kind` names, non-blocking, on `text`'s contract, in `ctx`. */
const checkTestOnly = (ctx: CheckContext, kind: CheckGateKind, text: string): CheckReport =>
  checkContractWith(ctx, checkTestContract(text), [new CheckGateEntry("g", kind, false)])

/** Findings as a report prints them under the gate name "g". */
const checkTestAsG = (found: string[]): string => found.map((m: string): string => `g: ${m}`).join(" | ")

/** The check pipeline: gates in order, gate kinds, blocking gates, findings and samples. */
export const main = (): i32 => {
  const t = new Suite("spec/check")
  const ctx = new CheckContext("contracts/c1.json", ".")
  const good = checkTestContract(CHECK_TEST_BASE)
  const badText = replaceAll(CHECK_TEST_GATES, '"c1"', '"-c1"')

  // The registry: other stages add gates after it, so only its head is fixed.
  const gates = checkGates()
  t.ok("the shape gate runs first, and blocks", gates.length >= 1 && gates[0].name === "shape" && gates[0].blocking)
  ctx.contract = good
  t.ok("it runs the shape check", checkShapeGate(ctx).length === 0)
  const shapeOnly: CheckGateEntry[] = [new CheckGateEntry("shape", CheckGateKind.Shape, true)]

  // A passing contract.
  const ok = checkContractWith(ctx, good, shapeOnly)
  t.ok("a valid contract passes", checkPassed(ok))
  t.eqStr("the shape gate ran", ok.ran.join(","), "shape")

  // A shape error is reported under the gate's name, and stops every registered gate after it.
  const bad = checkTestContract(replaceAll(CHECK_TEST_BASE, '"c1"', '"-c1"'))
  const r = checkContractWith(ctx, bad, shapeOnly)
  t.ok("a malformed contract fails", !checkPassed(r))
  t.eqStr("its finding", checkLines(r).join("\n"), "shape: contract.contract: an id ([A-Za-z0-9._-])")
  const all = checkContract(ctx, bad)
  t.eqStr(
    "checkContract stops at shape",
    `${all.ran.join(",")} ${all.skipped.length + 1 === gates.length}`,
    "shape true",
  )

  // Each gate kind runs the gate it names: its findings are that gate's, called
  // directly on the same contract, and differ from every other gate's here.
  const shapeDirect = checkTestCtx(badText)
  const viaShape = checkTestOnly(checkTestCtx(badText), CheckGateKind.Shape, badText)
  const shapeLines = checkTestAsG(checkShapeGate(shapeDirect))
  t.ok("Shape finds something", shapeLines.length > 0)
  t.eqStr("Shape runs the shape gate", checkLines(viaShape).join(" | "), shapeLines)
  const ids = checkTestAsG(gateIds(checkTestCtx(CHECK_TEST_GATES)))
  t.ok("Ids finds something", ids.length > 0)
  t.eqStr(
    "Ids runs the ids gate",
    checkLines(checkTestOnly(checkTestCtx(CHECK_TEST_GATES), CheckGateKind.Ids, CHECK_TEST_GATES)).join(" | "),
    ids,
  )
  const typing = checkTestAsG(gateTyping(checkTestCtx(CHECK_TEST_GATES)))
  t.ok("Typing finds something", typing.length > 0)
  t.eqStr(
    "Typing runs the typing gate",
    checkLines(checkTestOnly(checkTestCtx(CHECK_TEST_GATES), CheckGateKind.Typing, CHECK_TEST_GATES)).join(" | "),
    typing,
  )
  const coverage = checkTestAsG(gateCoverage(checkTestCtx(CHECK_TEST_GATES)))
  t.ok("Coverage finds something", coverage.length > 0)
  t.eqStr(
    "Coverage runs the coverage gate",
    checkLines(checkTestOnly(checkTestCtx(CHECK_TEST_GATES), CheckGateKind.Coverage, CHECK_TEST_GATES)).join(" | "),
    coverage,
  )
  const fidelity = checkTestAsG(gateFidelity(checkTestCtx(CHECK_TEST_GATES)))
  t.ok("Fidelity finds something", fidelity.length > 0)
  t.eqStr(
    "Fidelity runs the fidelity gate",
    checkLines(checkTestOnly(checkTestCtx(CHECK_TEST_GATES), CheckGateKind.Fidelity, CHECK_TEST_GATES)).join(" | "),
    fidelity,
  )
  const completeness = checkTestAsG(gateCompleteness(checkTestCtx(CHECK_TEST_GATES)))
  t.ok("Completeness finds something", completeness.length > 0)
  t.eqStr(
    "Completeness runs the completeness gate",
    checkLines(checkTestOnly(checkTestCtx(CHECK_TEST_GATES), CheckGateKind.Completeness, CHECK_TEST_GATES)).join(" | "),
    completeness,
  )
  // The run-sources gate reports nothing itself: what shows it ran is the run it records.
  const runCtx = checkTestCtx(CHECK_TEST_GATES)
  const viaRun = checkTestOnly(runCtx, CheckGateKind.RunSources, CHECK_TEST_GATES)
  const runDirect = checkTestCtx(CHECK_TEST_GATES)
  gateRunSources(runDirect)
  t.eqStr("RunSources finds nothing", checkLines(viaRun).join(" | "), "")
  t.ok(
    "RunSources runs the run-sources gate: V2's command is recorded, not run",
    runCtx.sourceRuns.length === 1 &&
      runDirect.sourceRuns.length === 1 &&
      runCtx.sourceRuns[0].clause === "V2" &&
      runCtx.sourceRuns[0].outcome === "not run",
  )
  const provenance = checkTestAsG(gateProvenance(checkTestCtx(CHECK_TEST_GATES)))
  t.ok("Provenance finds something", provenance.length > 0)
  t.eqStr(
    "Provenance runs the provenance gate",
    checkLines(checkTestOnly(checkTestCtx(CHECK_TEST_GATES), CheckGateKind.Provenance, CHECK_TEST_GATES)).join(" | "),
    provenance,
  )
  const signatures = checkTestAsG(gateSignatures(checkTestCtx(CHECK_TEST_GATES)))
  t.ok("Signatures finds something", signatures.length > 0)
  t.eqStr(
    "Signatures runs the signatures gate",
    checkLines(checkTestOnly(checkTestCtx(CHECK_TEST_GATES), CheckGateKind.Signatures, CHECK_TEST_GATES)).join(" | "),
    signatures,
  )
  const domain = checkTestAsG(gateDomain(checkTestCtx(CHECK_TEST_GATES)))
  t.ok("Domain finds something", domain.length > 0)
  t.eqStr(
    "Domain runs the domain gate",
    checkLines(checkTestOnly(checkTestCtx(CHECK_TEST_GATES), CheckGateKind.Domain, CHECK_TEST_GATES)).join(" | "),
    domain,
  )
  const each = [shapeLines, ids, typing, coverage, fidelity, completeness, provenance, signatures, domain]
  let distinct = true
  for (let i = 0; i < each.length; i++) {
    for (let j = i + 1; j < each.length; j++) {
      distinct = distinct && each[i] !== each[j]
    }
  }
  t.ok("no two gates find the same thing here", distinct)

  // A blocking gate with a finding stops the gates after it; others do not.
  const chain: CheckGateEntry[] = [
    new CheckGateEntry("a", CheckGateKind.Ids, false),
    new CheckGateEntry("shape", CheckGateKind.Shape, true),
    new CheckGateEntry("b", CheckGateKind.Ids, false),
  ]
  const stopped = checkContractWith(ctx, checkTestContract(badText), chain)
  t.eqStr("ran", stopped.ran.join(","), "a,shape")
  t.eqStr("skipped", stopped.skipped.join(","), "b")
  t.eqStr(
    "every finding before the stop, the non-blocking one's included",
    checkLines(stopped).join(" | "),
    `a: V1: duplicate clause id "V1" | ${replaceAll(shapeLines, "g: ", "shape: ")}`,
  )
  const through = checkContractWith(ctx, checkTestContract(CHECK_TEST_GATES), chain)
  t.eqStr("a blocking gate that passes stops nothing", through.ran.join(","), "a,shape,b")
  t.eqStr(
    "findings in gate order",
    checkLines(through).join(" | "),
    'a: V1: duplicate clause id "V1" | b: V1: duplicate clause id "V1"',
  )

  // Samples a gate chooses reach the report, and each run starts a new table.
  const direct = checkTestCtx(CHECK_TEST_GATES)
  gateDomain(direct)
  const want = checkSamplesOf(direct.samples, "P2").length
  const sctx = checkTestCtx(CHECK_TEST_GATES)
  const domainOnly: CheckGateEntry[] = [new CheckGateEntry("domain", CheckGateKind.Domain, false)]
  const sampled = checkContractWith(sctx, checkTestContract(CHECK_TEST_GATES), domainOnly)
  t.ok("the samples are in the report", want > 0 && checkSamplesOf(sampled.samples, "P2").length === want)
  const ps = checkSamplesOf(sampled.samples, "P2")
  const ds = checkSamplesOf(direct.samples, "P2")
  const first = ps.length > 0 ? `${ps[0].why}=${ps[0].args[0].text}` : ""
  t.eqStr("the first sample's why and value", first, "boundary: the domain=7")
  t.eqStr("as the gate chose it", first, ds.length > 0 ? `${ds[0].why}=${ds[0].args[0].text}` : "none")
  t.ok("by clause: an empty domain has none", checkSamplesOf(sampled.samples, "P1").length === 0)
  const again = checkContractWith(sctx, checkTestContract(CHECK_TEST_GATES), domainOnly)
  t.eqStr("a second run starts a new table", `${checkSamplesOf(again.samples, "P2").length}`, `${want}`)
  t.eqStr("the first report keeps its own", `${checkSamplesOf(sampled.samples, "P2").length}`, `${want}`)
  return t.done()
}
