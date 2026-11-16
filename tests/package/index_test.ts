import { Suite } from "nish/testing"
import { VECTOR_VERSION, vectorDiffJson, vectorRun, vectorVerifyJson } from "../../src/index"

const indexRead = (path: string): string => readFileSyncOrNull(path) ?? ""

export const main = (): i32 => {
  const t = new Suite("package/index")
  t.eqStr("version", VECTOR_VERSION, "0.3.1") // x-release-please-version

  const spec = indexRead("tests/fixtures/currency-spec.json")
  const program = indexRead("tests/fixtures/currency.json")
  const proven = vectorVerifyJson(spec, program)
  t.ok("verify parses", proven.isOk())
  if (proven.isOk()) {
    t.contains("verify proves", proven.value, `"status": "PROVEN"`)
  }
  const refuted = vectorVerifyJson(indexRead("tests/fixtures/unsat-spec.json"), indexRead("tests/fixtures/unsat.json"))
  if (refuted.isOk()) {
    t.contains("verify refutes", refuted.value, `"status": "REFUTED"`)
  } else {
    t.fail("verify refutes", refuted.error)
  }
  t.ok("verify refuses text that is not JSON", vectorVerifyJson("{", program).isErr())

  const same = vectorDiffJson(program, program)
  if (same.isOk()) {
    t.contains("diff of a program with itself", same.value, `"status": "EQUIVALENT"`)
  } else {
    t.fail("diff of a program with itself", same.error)
  }
  t.ok("diff refuses text that is not JSON", vectorDiffJson(program, "not json").isErr())

  t.eqI32(
    "run: an unreadable file is exit 2",
    vectorRun(["diff", "tests/fixtures/missing-a.json", "tests/fixtures/missing-b.json"]),
    2,
  )
  t.eqI32(
    "run: a proof is exit 0",
    vectorRun(["diff", "tests/fixtures/currency.json", "tests/fixtures/currency.json"]),
    0,
  )
  return t.done()
}
