import { Suite } from "nish/testing"
import { newJsonDocument, readJsonFile } from "../../src/core/json"
import { runZ3 } from "../../src/core/z3"
import {
  STATUS_PROVEN,
  STATUS_REFUTED,
  dashInputs,
  dashWrap,
  renderDashboard,
  verdictStatus,
} from "../../src/verify/emit/dashboard"
import { checkConformance } from "../../src/verify/emit/float64"
import { Program } from "../../src/verify/lang/ast"
import { typecheckProgram } from "../../src/verify/lang/check"
import { readProgram } from "../../src/verify/lang/read"
import { buildVerificationScript, smtPreamble, smtVarName } from "../../src/verify/smt/script"
import { Counterexample } from "../../src/verify/solve/report"
import {
  assembleReport,
  signatureOf,
  solveIsModelRefusal,
  solveProgram,
  solverLabel,
} from "../../src/verify/solve/report"

const solveLoad = (path: string): Program => {
  const doc = newJsonDocument()
  const root = readJsonFile(doc, path)
  const errors: string[] = []
  const program = readProgram(doc, root.isOk() ? root.value : -1, errors)
  typecheckProgram(program)
  return program
}

export const main = (): i32 => {
  const t = new Suite("verify/solve")
  t.ok("smtPreamble ends in a newline", smtPreamble().endsWith("\n"))
  t.eqStr("smtVarName", smtVarName(2, "amount"), "f2_amount")
  t.ok("solveIsModelRefusal", solveIsModelRefusal('(error "line 9 column 10: model is not available")'))
  t.ok("solveIsModelRefusal refuses other errors", !solveIsModelRefusal('(error "unknown constant x")'))
  t.ok("solverLabel names z3", solverLabel().startsWith("Z3 "))

  const program = solveLoad("tests/fixtures/currency.json")
  t.eqStr("signatureOf", signatureOf(program.functions[0]), "applyRate(amount: Real, rate: Real): Real")
  const script = buildVerificationScript(program)
  t.ok("buildVerificationScript has queries", script.queries.length > 0)
  t.contains("buildVerificationScript checks sat", script.text, "(check-sat)")
  const run = runZ3(script.text, toI32(script.queries.length))
  if (run.isErr()) {
    t.fail("runZ3", run.error)
    return t.done()
  }
  const assembled = assembleReport(program, script.queries, run.value.answers, "test z3")
  t.ok("assembleReport proves the fixture", assembled.ok())
  t.eqStr("assembleReport keeps the label", assembled.solver, "test z3")

  const proven = solveProgram(program)
  if (proven.isErr()) {
    t.fail("solveProgram", proven.error)
    return t.done()
  }
  t.eqStr("verdictStatus proven", verdictStatus(proven.value), STATUS_PROVEN)
  t.eqI32("checkConformance finds nothing", toI32(checkConformance(program, proven.value).length), 0)
  const box = renderDashboard("currency", proven.value)
  t.contains("renderDashboard verdict", box, "VERDICT: ALL POSTCONDITIONS PROVEN FOR ALL INPUTS")
  t.contains("renderDashboard prompt", box, 'Prompt:  "currency"')

  const unsat = solveLoad("tests/fixtures/unsat.json")
  const refuted = solveProgram(unsat)
  if (refuted.isErr()) {
    t.fail("solveProgram unsat", refuted.error)
    return t.done()
  }
  t.eqStr("verdictStatus refuted", verdictStatus(refuted.value), STATUS_REFUTED)
  t.contains("renderDashboard counterexample", renderDashboard("unsat", refuted.value), "counterexample: amount = 0")

  const cex = new Counterexample("0")
  cex.names.push("a")
  cex.values.push("1")
  cex.names.push("b")
  cex.values.push("-2")
  t.eqStr("dashInputs", dashInputs(cex), "a = 1, b = -2")
  const wrapped = dashWrap("one two three four", 9)
  t.eqI32("dashWrap lines", toI32(wrapped.length), 3)
  t.eqStr("dashWrap first line", wrapped[0], "one two")
  t.eqStr("dashWrap second line", wrapped[1], "three")
  return t.done()
}
