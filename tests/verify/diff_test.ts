import { Suite } from "nish/testing"
import { newJsonDocument, readJsonFile } from "../../src/core/json"
import { runZ3 } from "../../src/core/z3"
import { findFloat64Delta } from "../../src/verify/emit/float64"
import { outJsonRender } from "../../src/verify/emit/outjson"
import {
  DIFF_DIFFERENT,
  DIFF_EQUIVALENT,
  DIFF_INVALID,
  DiffOutcome,
  FunctionPair,
  assembleDiffs,
  diffOutcomeJson,
  diffPrograms,
  diffReportJson,
  emitDiffScript,
  pairFunctions,
  renderDiffSummary,
} from "../../src/verify/equiv/diff"
import { Program } from "../../src/verify/lang/ast"
import { typecheckProgram } from "../../src/verify/lang/check"
import { readProgram } from "../../src/verify/lang/read"

const diffLoad = (path: string): Program => {
  const doc = newJsonDocument()
  const root = readJsonFile(doc, path)
  const errors: string[] = []
  const program = readProgram(doc, root.isOk() ? root.value : -1, errors)
  typecheckProgram(program)
  return program
}

const diffRun = (oldPath: string, newPath: string): DiffOutcome => {
  const oldDoc = newJsonDocument()
  const oldRoot = readJsonFile(oldDoc, oldPath)
  const newDoc = newJsonDocument()
  const newRoot = readJsonFile(newDoc, newPath)
  return diffPrograms(oldDoc, oldRoot.isOk() ? oldRoot.value : -1, newDoc, newRoot.isOk() ? newRoot.value : -1)
}

export const main = (): i32 => {
  const t = new Suite("verify/diff")
  const oldP = diffLoad("tests/fixtures/currency.json")
  const newP = diffLoad("tests/cli/diff-different/new.json")
  const pairing = pairFunctions(oldP, newP)
  t.eqI32("pairFunctions pairs both", toI32(pairing.comparable.length), toI32(oldP.functions.length))
  t.eqI32("pairFunctions adds nothing", toI32(pairing.added.length), 0)
  const script = emitDiffScript(pairing.comparable, oldP, newP)
  t.eqI32("emitDiffScript asks three per pair", toI32(script.queries.length), toI32(pairing.comparable.length) * 3)
  const run = runZ3(script.text, toI32(script.queries.length))
  if (run.isErr()) {
    t.fail("runZ3", run.error)
    return t.done()
  }
  const diffs = assembleDiffs(pairing.comparable, script.queries, run.value.answers)
  if (diffs.isErr()) {
    t.fail("assembleDiffs", diffs.error)
    return t.done()
  }
  let differing = 0
  for (const d of diffs.value) {
    if (!d.equivalent) {
      differing++
    }
  }
  t.ok("assembleDiffs finds a difference", differing > 0)
  const noPairs: FunctionPair[] = []
  t.ok("assembleDiffs refuses misaligned answers", assembleDiffs(noPairs, script.queries, run.value.answers).isErr())

  const last = toI32(oldP.functions.length) - 1
  const delta = findFloat64Delta(oldP, oldP.functions[last], newP, newP.functions[last])
  t.ok("findFloat64Delta tells changed rates apart", delta.found)
  const same = findFloat64Delta(oldP, oldP.functions[last], oldP, oldP.functions[last])
  t.ok("findFloat64Delta finds nothing in one function", !same.found)

  const equal = diffRun("tests/fixtures/currency.json", "tests/fixtures/currency.json")
  t.eqStr("diffPrograms equivalent", equal.status, DIFF_EQUIVALENT)
  const different = diffRun("tests/fixtures/currency.json", "tests/cli/diff-different/new.json")
  t.eqStr("diffPrograms different", different.status, DIFF_DIFFERENT)
  t.contains(
    "renderDiffSummary",
    renderDiffSummary(different.status, different.report),
    "assumes both versions pass vector verify.)",
  )
  t.contains("diffReportJson", outJsonRender(diffReportJson(different.report)), '"valueDiff"')
  t.contains("diffOutcomeJson", outJsonRender(diffOutcomeJson(different)), '"status": "DIFFERENT"')
  const invalid = diffRun("tests/fixtures/currency.json", "tests/fixtures/currency-spec.json")
  t.eqStr("diffPrograms invalid", invalid.status, DIFF_INVALID)
  return t.done()
}
