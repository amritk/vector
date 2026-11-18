/**
 * verify's and diff's MISMATCH through the binary: a z3 whose counterexample
 * or witness is forged, so the replay disagrees with it. Exit 2, the bug
 * named, and nothing emitted. Nish has no setenv, so vectorRun cannot be
 * handed a fake z3 in-process; this spawns dist/vector with VECTOR_Z3 naming
 * tests/fixtures/mismatch-z3/z3, which runs the real z3 and rewrites a model
 * value with sed.
 */

import { Suite } from "nish/testing"
import { joinPath, makeTempDir } from "../../src/core/fs"
import { runProcess } from "../../src/core/process"

/** The z3 that lies: the real one, its output passed through $VECTOR_FORGE. */
const MISMATCH_FAKE_Z3: string = "tests/fixtures/mismatch-z3/z3"

/**
 * Runs dist/vector with the fake z3, which forges what the real one prints
 * with the sed script `forge`.
 */
const mismatchRun = (vector: string, fake: string, real: string, forge: string, args: string[]): string => {
  const argv = ["env", `VECTOR_Z3=${fake}`, `VECTOR_REAL_Z3=${real}`, `VECTOR_FORGE=${forge}`, vector]
  for (const a of args) argv.push(a)
  const run = runProcess(argv, "", 120000)
  if (run.isErr()) return `spawn failed: ${run.error}`
  return `exit ${run.value.status}\n${run.value.stdout}${run.value.stderr}`
}

/** MISMATCH from verify and from diff exits 2, names the bug, and emits nothing. */
export const main = (): i32 => {
  const t = new Suite("verify/mismatch")
  const vector = realpathSync("dist/vector")
  const fake = realpathSync(MISMATCH_FAKE_Z3)
  const fromEnv = getenv("VECTOR_Z3")
  const real = realpathSync(fromEnv !== null && fromEnv !== "" ? fromEnv : ".z3/z3")
  if (vector === null || fake === null || real === null) {
    t.fail("dist/vector, the fake z3 and z3", "missing: run npm run build and scripts/fetch-z3.sh")
    return t.done()
  }
  const dir = makeTempDir("vector-mismatch-")
  if (dir.isErr()) {
    t.fail("a temporary directory", dir.error)
    return t.done()
  }

  // unsat.json's AX-BAD is refuted at amount = 0; forged to amount = -5, the
  // counterexample breaks the requires amount >= 0 and does not replay.
  const out = joinPath(dir.value, "out.ts")
  const verify = mismatchRun(vector, fake, real, "s/(f0_amount 0.0)/(f0_amount (- 5.0))/", [
    "verify",
    "--emit",
    out,
    "tests/fixtures/unsat-spec.json",
    "tests/fixtures/unsat.json",
  ])
  t.ok("verify's MISMATCH exits 2", verify.startsWith("exit 2\n"))
  t.contains("verify names the status", verify, "Status: MISMATCH")
  t.contains("verify names the bug", verify, "MISMATCH  z3's counterexample does not refute usdToEur AX-BAD")
  t.contains("and why it does not replay", verify, "(amount = -5: requires amount >= 0 is false")
  // Nothing is emitted on REFUTED either: what this shows is that MISMATCH
  // is not a PROVEN that emits.
  t.ok("verify emits nothing", readFileSyncOrNull(out) === null)

  // Unforged, the same run is a refutation: exit 1, so the forgery is what
  // makes the MISMATCH.
  const honest = mismatchRun(vector, fake, real, "", [
    "verify",
    "tests/fixtures/unsat-spec.json",
    "tests/fixtures/unsat.json",
  ])
  t.ok("unforged, verify refutes: exit 1", honest.startsWith("exit 1\n"))
  t.ok("and reports no MISMATCH", honest.indexOf("MISMATCH") < 0)

  // The domain witness amount = 0 is accepted by old and refused by new;
  // forged to amount = 5, the new version accepts it too.
  const diff = mismatchRun(vector, fake, real, "s/(d1x0_amount 0.0))/(d1x0_amount 5.0))/", [
    "diff",
    "tests/fixtures/currency.json",
    "tests/cli/diff-different/new.json",
  ])
  t.ok("diff's MISMATCH exits 2", diff.startsWith("exit 2\n"))
  t.contains("diff names the status", diff, "Status: MISMATCH")
  t.contains("diff names the witness", diff, "MISMATCH  z3's witness amount = 5 does not do what z3 said")
  t.contains("diff says it cannot be trusted", diff, "this diff cannot be\n trusted")
  const honestDiff = mismatchRun(vector, fake, real, "", [
    "diff",
    "tests/fixtures/currency.json",
    "tests/cli/diff-different/new.json",
  ])
  t.ok("unforged, diff reports no MISMATCH", honestDiff.indexOf("MISMATCH") < 0)
  t.ok("unforged, diff differs: exit 1", honestDiff.startsWith("exit 1\n"))
  t.contains("at z3's own witness", honestDiff, "domain: amount = 0 was accepted, now REJECTED")

  t.ok("the temporary directory is removed", runProcess(["rm", "-rf", "--", dir.value], "", 10000).isOk())
  return t.done()
}
