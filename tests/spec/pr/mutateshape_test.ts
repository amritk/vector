/**
 * The shapes a compiler's refusal can take, each of which must make a
 * stillborn mutant, not a failure of the tool: `syntax error:`, colour, a
 * truncated list, the test file's path, `./` and absolute paths. The stub
 * compilers refuse "return null" with the shape and link everything else.
 */

import { Suite } from "nish/testing"
import { runProcess } from "../../../src/core/process"
import { MutateRun, mutateCheck } from "../../../src/spec/pr/mutaterun"
import { PrReport } from "../../../src/spec/pr/report"
import { prTestCommit, prTestGit, prTestRemove, prTestRepo, prTestWrite } from "./repo"

/** The time limit for each step: no step here hangs. */
const MUTATESHAPE_TEST_MS: i32 = 60000

/** The module the change makes: one line whose mutant is `return null`. */
const MUTATESHAPE_TEST_AFTER: string = `export const f = (x: i32): i32 => {
  return x
}
`

/** A contract on nish/m. */
const MUTATESHAPE_TEST_CONTRACT: string = `{
  "contract": "c1",
  "source": {"title": "T", "rfc": 4648},
  "target": {"module": "nish/m"},
  "requirements": [{"id": "R1", "section": "3.1", "level": "MUST", "quote": "Q"}],
  "functions": [{"name": "f", "params": [{"name": "x", "type": "i32"}], "returns": "i32"}],
  "clauses": [
    {"kind": "vector", "id": "V1", "title": "t", "covers": ["R1"],
     "source": {"cite": {"section": "10"}}, "call": "f", "args": [{"int": 1}], "expect": {"int": 1}}
  ]
}
`

/** A stub compiler that refuses the canary, fails "return null" with `what` (shell), and otherwise links. */
const mutateshapeTestNish = (what: string): string => `#!/bin/sh
root=$(cd "$(dirname "$0")/.." && pwd)
if grep -q 'canary' "$root/std/m.ts"; then
  echo "std/m.ts:9:1: syntax error: canary" >&2
  exit 1
fi
if grep -q 'return null' "$root/std/m.ts"; then
  ${what}
fi
printf '#!/bin/sh\\ncd "%s" && exec sh "%s"\\n' "$root" "$1" > "$3"
chmod +x "$3"
`

/** Runs the change's mutants against the stub compiler `nish` in a fresh repository. */
const mutateshapeTestWith = (nish: string): Result<PrReport, string> => {
  const dir = prTestRepo("vector-mutate-shape-").orReturn()
  prTestWrite(dir, "nish/std/m.ts", "").orReturn()
  prTestWrite(dir, "nish/bin/nish", nish).orReturn()
  runProcess(["chmod", "+x", "--", `${dir}/nish/bin/nish`], "", 10000).orReturn()
  prTestCommit(dir, "base").orReturn()
  prTestGit(dir, ["checkout", "-q", "-b", "work"]).orReturn()
  prTestWrite(dir, "nish/std/m.ts", MUTATESHAPE_TEST_AFTER).orReturn()
  prTestWrite(dir, "t.sh", "exit 0\n").orReturn()
  prTestWrite(dir, "c.json", MUTATESHAPE_TEST_CONTRACT).orReturn()
  const run = new MutateRun(`${dir}/nish`, "", "bin/nish", `${dir}/t.sh`, 2, MUTATESHAPE_TEST_MS)
  const r = mutateCheck(`${dir}/c.json`, "main", run, 0)
  prTestRemove(dir)
  return r
}

/** Every shape of refusal makes the mutant stillborn; an error in a third file stays the tool's failure. */
export const main = (): i32 => {
  const t = new Suite("spec/pr mutateshape")
  const shapes = [
    ["a plain error", "echo 'std/m.ts:2:3: error: x' >&2; exit 1"],
    ["a syntax error", "echo 'std/m.ts:2:3: syntax error: x' >&2; exit 1"],
    ["a coloured error", "printf '\\033[1;31mstd/m.ts:2:3: error: x\\033[0m\\n' >&2; exit 1"],
    [
      "a truncated list",
      "echo 'std/m.ts:2:3: error: x' >&2; echo '  2 | return null' >&2; echo '...and 3 more errors' >&2; echo '4 errors' >&2; exit 1",
    ],
    ["an error in the test file", `echo "$1:1:1: error: x" >&2; exit 1`],
    ["a ./ path", "echo './std/m.ts:2:3: error: x' >&2; exit 1"],
    ["an absolute path", `echo "$root/std/m.ts:2:3: error: x" >&2; exit 1`],
  ]
  for (const sh of shapes) {
    const r = mutateshapeTestWith(mutateshapeTestNish(sh[1]))
    t.eqStr(
      `${sh[0]} makes a stillborn mutant`,
      r.isOk() ? r.value.items.join(" | ") : r.error,
      "stillborn std/m.ts:2:3 return-null: return null",
    )
  }
  const third = mutateshapeTestWith(
    mutateshapeTestNish("echo 'std/m.ts:2:3: error: x' >&2; echo \"$root/std/other.ts:1:1: error: y\" >&2; exit 1"),
  )
  t.ok(
    "an error in a third file, beside one in the module, is the tool's failure",
    third.isErr() && third.error.indexOf("with no error located") >= 0,
  )
  return t.done()
}
