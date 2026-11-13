import { Suite } from "nish/testing"
import { newJsonDocument, readJsonFile } from "../../src/core/json"
import { outJsonRender } from "../../src/verify/emit/outjson"
import { typecheckProgram } from "../../src/verify/lang/check"
import { readProgram } from "../../src/verify/lang/read"
import { Counterexample } from "../../src/verify/solve/report"
import { solveProgram } from "../../src/verify/solve/report"
import {
  OUTCOME_INVALID,
  OUTCOME_PROVEN,
  OUTCOME_REFUTED,
  VerifyOutcome,
  collectFeedbackItems,
  counterexampleJson,
  formatReportFeedback,
  verifyOutcomeJson,
  verifySpecAndProgram,
} from "../../src/verify/verify"

const verifyRun = (specPath: string, programPath: string): VerifyOutcome => {
  const specDoc = newJsonDocument()
  const specRoot = readJsonFile(specDoc, specPath)
  const programDoc = newJsonDocument()
  const programRoot = readJsonFile(programDoc, programPath)
  return verifySpecAndProgram(
    specDoc,
    specRoot.isOk() ? specRoot.value : -1,
    programDoc,
    programRoot.isOk() ? programRoot.value : -1,
    "test",
  )
}

export const main = (): i32 => {
  const t = new Suite("verify/verify")
  const proven = verifyRun("tests/fixtures/currency-spec.json", "tests/fixtures/currency.json")
  t.eqStr("verifySpecAndProgram proves currency", proven.status, OUTCOME_PROVEN)
  t.contains("verifySpecAndProgram emits code", proven.emittedCode, "export function usdToEur")
  t.contains("verifyOutcomeJson status", outJsonRender(verifyOutcomeJson(proven)), '"status": "PROVEN"')

  const refuted = verifyRun("tests/fixtures/unsat-spec.json", "tests/fixtures/unsat.json")
  t.eqStr("verifySpecAndProgram refutes unsat", refuted.status, OUTCOME_REFUTED)
  t.eqStr("verifySpecAndProgram emits nothing when refuted", refuted.emittedCode, "")
  t.contains("verifyOutcomeJson counterexample", outJsonRender(verifyOutcomeJson(refuted)), '"counterexample"')

  const invalid = verifyRun("tests/fixtures/currency-spec.json", "tests/fixtures/currency-spec.json")
  t.eqStr("verifySpecAndProgram rejects a spec as a program", invalid.status, OUTCOME_INVALID)
  t.ok("verifySpecAndProgram lists errors", invalid.errors.length > 0)

  const doc = newJsonDocument()
  const root = readJsonFile(doc, "tests/fixtures/unsat.json")
  const errors: string[] = []
  const program = readProgram(doc, root.isOk() ? root.value : -1, errors)
  typecheckProgram(program)
  const report = solveProgram(program)
  if (report.isErr()) {
    t.fail("solveProgram", report.error)
    return t.done()
  }
  const items = collectFeedbackItems(report.value)
  t.ok("collectFeedbackItems finds the refutation", items.length > 0)
  t.ok("collectFeedbackItems carries a counterexample", items.length > 0 && items[0].hasCex)
  t.contains("formatReportFeedback names the function", formatReportFeedback(report.value), items[0].fn)

  const cex = new Counterexample("7")
  cex.names.push("x")
  cex.values.push("3")
  const cexText = outJsonRender(counterexampleJson(cex))
  t.containsAll("counterexampleJson", cexText, ['"inputs"', '"x"', '"3"', '"result": "7"'])
  return t.done()
}
