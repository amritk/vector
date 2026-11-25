import { Suite } from "nish/testing"
import { makeTempDir } from "../../../src/core/fs"
import { runProcess } from "../../../src/core/process"
import { MutateMutant } from "../../../src/spec/pr/mutate"
import { MutateRun, mutateRunAll } from "../../../src/spec/pr/mutaterun"
import { prTestRemove, prTestWrite } from "./repo"

/**
 * A stub compiler: refuses a module holding the canary with an error located
 * in it, and otherwise links a "binary" that runs the test as a shell script
 * from the slot.
 */
const MUTATEWRITE_NISH: string = `#!/bin/sh
root=$(cd "$(dirname "$0")/.." && pwd)
if grep -rq 'canary' "$root/std"; then
  printf '%s/std/m.ts:1:1: error: refused\\n1 error\\n' "$root" >&2
  exit 1
fi
printf '#!/bin/sh\\ncd "%s" && exec sh "%s"\\n' "$root" "$1" > "$3"
chmod +x "$3"
`

/**
 * A test that passes, and that in the second slot, which runs no canary,
 * leaves a directory where the module is, so the first mutant written there
 * cannot be.
 */
const MUTATEWRITE_TEST: string = `case "$(basename "$PWD")" in
  slot1) rm -f std/m.ts && mkdir std/m.ts ;;
esac
exit 0
`

/** The module. */
const MUTATEWRITE_MODULE: string = "export const k = (): i32 => 7\n"

/** What mutateRunAll answers for two mutants in two slots, the second unwritable. */
const mutatewriteRun = (): Result<string, string> => {
  const dir = makeTempDir("vector-mutatewrite-").orReturn()
  prTestWrite(dir, "nish/std/m.ts", MUTATEWRITE_MODULE).orReturn()
  prTestWrite(dir, "nish/bin/nish", MUTATEWRITE_NISH).orReturn()
  prTestWrite(dir, "t.sh", MUTATEWRITE_TEST).orReturn()
  const chmod = runProcess(["chmod", "+x", "--", `${dir}/nish/bin/nish`], "", 10000).orReturn()
  if (chmod.status !== 0) {
    prTestRemove(dir)
    return Err(`chmod exits ${chmod.status}: ${chmod.stderr}`)
  }
  const run = new MutateRun(`${dir}/nish`, "std/m.ts", "bin/nish", `${dir}/t.sh`, 1, 20000)
  // Past the constructor's clamp to the machine's CPUs, so one CPU still makes two slots.
  run.jobs = 2
  const mutants: MutateMutant[] = [
    new MutateMutant(1, 29, "int", "+1", "export const k = (): i32 => 8"),
    new MutateMutant(1, 29, "int", "-1", "export const k = (): i32 => 6"),
  ]
  const r = mutateRunAll(run, MUTATEWRITE_MODULE, mutants)
  prTestRemove(dir)
  if (r.isErr()) {
    return Ok(`ERR ${r.error}`)
  }
  return Ok(r.value ?? "OK")
}

/**
 * A mutant that cannot be written to its slot stops the run with the path
 * and the errno, before its build starts.
 *
 * @returns the suite's exit status
 */
export const main = (): i32 => {
  const t = new Suite("spec/pr mutate write failure")
  const r = mutatewriteRun()
  if (r.isErr()) {
    t.fail("the checkout is built", r.error)
    return t.done()
  }
  t.ok(`the write is refused (${r.value})`, r.value.startsWith("ERR cannot write "))
  t.ok(`naming the slot's module and its errno (${r.value})`, r.value.endsWith("/slot1/std/m.ts (errno 21)"))
  return t.done()
}
