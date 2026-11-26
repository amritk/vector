import { Suite } from "nish/testing"
import { MutateMutant } from "../../../src/spec/pr/mutate"
import { MutateRun, mutateRunAll } from "../../../src/spec/pr/mutaterun"

/** What mutateRunAll answers for one mutant with `jobs` set past the constructor's clamp. */
const mutatenoslotRun = (jobs: i32): string => {
  const run = new MutateRun("/nonexistent-nish-root", "std/m.ts", "", "/nonexistent-test.ts", 1, 0)
  run.jobs = jobs
  const mutants: MutateMutant[] = [new MutateMutant(1, 1, "int", "", "export const k = (): i32 => 8")]
  const r = mutateRunAll(run, "export const k = (): i32 => 7\n", mutants)
  if (r.isErr()) {
    return `ERR ${r.error}`
  }
  return r.value ?? "OK"
}

export const main = (): i32 => {
  const t = new Suite("spec/pr mutate with no slot")
  t.eqStr("zero jobs is refused, not a panic", mutatenoslotRun(0), "ERR no slot to run the mutants in: --jobs is 0")
  t.eqStr("negative jobs is refused", mutatenoslotRun(-1), "ERR no slot to run the mutants in: --jobs is -1")
  const clamped = new MutateRun("/r", "std/m.ts", "", "/t", 0, 0)
  t.ok("the constructor clamps zero jobs to one", clamped.jobs === 1)
  return t.done()
}
