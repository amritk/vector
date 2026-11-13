import { JsonDocument, JsonValue } from "nish/json-value"
import { Suite } from "nish/testing"
import { newJsonDocument, readJsonFile } from "../../src/core/json"
import { Program, programFunctionIndex } from "../../src/verify/lang/ast"
import {
  checkAxiomTraceability,
  checkIsReserved,
  checkSpecProgramConsistency,
  mentionsResult,
  typecheckProgram,
} from "../../src/verify/lang/check"
import { prettyMath, prettyTs } from "../../src/verify/lang/pretty"
import { langIsIdent, langRoundTrips, readProgram, readSpecPlan } from "../../src/verify/lang/read"
import { collectStyleWarnings } from "../../src/verify/lang/style"

const langRoot = (doc: JsonDocument, path: string): JsonValue => {
  const root = readJsonFile(doc, path)
  return root.isOk() ? root.value : -1
}

const langProgram = (path: string, errors: string[]): Program => {
  const doc = newJsonDocument()
  return readProgram(doc, langRoot(doc, path), errors)
}

export const main = (): i32 => {
  const t = new Suite("verify/lang")
  t.ok("langIsIdent accepts camelCase", langIsIdent("usdToEur"))
  t.ok("langIsIdent refuses a leading digit", !langIsIdent("1x"))
  t.ok("langIsIdent refuses a dash", !langIsIdent("a-b"))
  t.ok("langRoundTrips 0.91", langRoundTrips("0.91"))
  t.ok("langRoundTrips refuses lost digits", !langRoundTrips("1.10000000000000001"))
  t.ok("langRoundTrips refuses overflow", !langRoundTrips("1e400"))
  t.ok("checkIsReserved return", checkIsReserved("return"))
  t.ok("checkIsReserved Math", checkIsReserved("Math"))
  t.ok("checkIsReserved amount", !checkIsReserved("amount"))

  const errors: string[] = []
  const program = langProgram("tests/fixtures/currency.json", errors)
  t.eqI32("readProgram reads the fixture cleanly", toI32(errors.length), 0)
  t.eqStr("readProgram name", program.programName, "usd_to_eur_converter")
  t.eqI32("typecheckProgram accepts the fixture", toI32(typecheckProgram(program).length), 0)
  t.eqI32("programFunctionIndex finds usdToEur", programFunctionIndex(program, "usdToEur"), 1)
  t.eqI32("programFunctionIndex misses", programFunctionIndex(program, "nope"), -1)

  const usd = program.functions[1]
  t.ok("mentionsResult in an ensures", mentionsResult(usd.ensures[0].expr))
  t.ok("mentionsResult not in a requires", !mentionsResult(usd.requires[0].expr))
  t.eqStr("prettyMath", prettyMath(usd.ensures[0].expr), "result == amount * 0.91")
  t.eqStr("prettyTs", prettyTs(usd.requires[0].expr), "amount >= 0")
  t.eqStr("prettyTs call", prettyTs(usd.body), "applyRate(amount, 0.91)")
  t.eqI32("collectStyleWarnings flags definitional ensures", toI32(collectStyleWarnings(program).length), 2)

  const specDoc = newJsonDocument()
  const specErrors: string[] = []
  const plan = readSpecPlan(specDoc, langRoot(specDoc, "tests/fixtures/currency-spec.json"), specErrors)
  t.eqI32("readSpecPlan reads the fixture cleanly", toI32(specErrors.length), 0)
  t.eqI32("checkSpecProgramConsistency agrees", toI32(checkSpecProgramConsistency(plan, program).length), 0)
  t.eqI32("checkAxiomTraceability agrees", toI32(checkAxiomTraceability(plan, program).length), 0)

  const unsatErrors: string[] = []
  const unsat = langProgram("tests/fixtures/unsat.json", unsatErrors)
  t.ok("checkAxiomTraceability flags axioms the plan lacks", checkAxiomTraceability(plan, unsat).length > 0)

  const bad: string[] = []
  const notProgram = langProgram("tests/fixtures/currency-spec.json", bad)
  t.ok("readProgram reports shape errors", bad.length > 0 && notProgram.functions.length === 0)
  return t.done()
}
