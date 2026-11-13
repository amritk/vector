/**
 * One RFC lookup rule for every command: the third place a linked RFC is
 * looked for is vector's install root, whatever the current directory. This
 * spawns dist/vector from a directory with no rfcs/, since the golden runner
 * always runs from the repository.
 */

import { Suite } from "nish/testing"
import { joinPath, makeTempDir, mkdirAll } from "../../../src/core/fs"
import { runProcess } from "../../../src/core/process"
import { sourceInstallRoot } from "../../../src/spec/source/path"

/** A contract whose RFC, rfcs/rfc5869.txt, is only at the install root. */
const ROOT_TEST_CONTRACT: string = "contracts/rfc5869-hkdf-sha256.json"

/** `vector <args>` run from `dir`: its status and stderr, or why it did not run. */
const rootTestRun = (vector: string, dir: string, args: string): string => {
  const run = runProcess(["sh", "-c", `cd '${dir}' && exec '${vector}' ${args}`], "", 300000)
  return run.isOk() ? `${run.value.status} ${run.value.stderr}` : run.error
}

/** check, emit and run find the RFC at the install root from another directory. */
export const main = (): i32 => {
  const t = new Suite("spec/source root")
  t.ok("the root holds the binary's directory", sourceInstallRoot() !== "")
  const vector = realpathSync("dist/vector")
  const dir = makeTempDir("vector-root-test-")
  if (vector === null) {
    t.fail("dist/vector", "no dist/vector: run npm run build")
    return t.done()
  }
  if (dir.isErr()) {
    t.fail("a temporary directory", dir.error)
    return t.done()
  }
  const text = readFileSyncOrNull(ROOT_TEST_CONTRACT)
  t.ok("the contract is read", text !== null)
  t.ok("contracts/ is made", mkdirAll(joinPath(dir.value, "contracts"), 0o755).isOk())
  writeFileSync(joinPath(dir.value, ROOT_TEST_CONTRACT), text ?? "")
  t.ok("no rfcs/ in the directory", realpathSync(joinPath(dir.value, "rfcs")) === null)

  t.eqStr("check finds it", rootTestRun(vector, dir.value, `spec check ${ROOT_TEST_CONTRACT} --format json`), "0 ")
  t.eqStr("emit finds it", rootTestRun(vector, dir.value, `spec emit ${ROOT_TEST_CONTRACT} -o main.ts`), "0 ")
  t.ok("and writes the test", readFileSyncOrNull(joinPath(dir.value, "main.ts")) !== null)
  // run emits before it looks for a nish root, so a refused contract would
  // exit 1 or 2 with the RFC's fetch hint, not the missing root.
  t.eqStr(
    "run finds it, and stops only at the missing nish root",
    rootTestRun(vector, dir.value, `spec run ${ROOT_TEST_CONTRACT} --nish-root no-such-dir`),
    "2 vector: spec run: no-such-dir: not a nish checkout (give --nish-root or set VECTOR_NISH_ROOT)\n",
  )
  t.ok("the temporary directory is removed", runProcess(["rm", "-rf", "--", dir.value], "", 10000).isOk())
  return t.done()
}
