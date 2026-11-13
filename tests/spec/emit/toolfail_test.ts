/**
 * `spec emit` when z3 cannot run: a tool failure (exit 2) with z3's message
 * and no refusals, as `spec check` reports it, not a refused contract. The
 * golden runner cannot set VECTOR_Z3, so this spawns dist/vector.
 */

import { Suite } from "nish/testing"
import { joinPath, makeTempDir } from "../../../src/core/fs"
import { runProcess } from "../../../src/core/process"

/** A contract with properties, so its check needs z3 to sample them. */
const TOOLFAIL_TEST_CONTRACT: string = "contracts/example-hex.json"

/** spec emit with VECTOR_Z3 naming a missing file exits 2, writes nothing, and refuses nothing. */
export const main = (): i32 => {
  const t = new Suite("spec/emit toolfail")
  const vector = realpathSync("dist/vector")
  const dir = makeTempDir("vector-emit-toolfail-")
  if (vector === null) {
    t.fail("dist/vector", "no dist/vector: run npm run build")
    return t.done()
  }
  if (dir.isErr()) {
    t.fail("a temporary directory", dir.error)
    return t.done()
  }
  const out = joinPath(dir.value, "main.ts")
  const argv = ["env", "VECTOR_Z3=/nonexistent", vector, "spec", "emit", TOOLFAIL_TEST_CONTRACT, "-o", out]
  const run = runProcess(argv, "", 120000)
  t.eqStr(
    "a missing z3 is a tool failure: exit 2, z3's message, no refusals",
    run.isOk() ? `${run.value.status} | ${run.value.stdout} | ${run.value.stderr}` : run.error,
    `2 |  | vector: ${TOOLFAIL_TEST_CONTRACT}: cannot be checked: VECTOR_Z3 is /nonexistent, which is not a file\n`,
  )
  t.ok("and writes no test", readFileSyncOrNull(out) === null)
  t.ok("the temporary directory is removed", runProcess(["rm", "-rf", "--", dir.value], "", 10000).isOk())
  return t.done()
}
