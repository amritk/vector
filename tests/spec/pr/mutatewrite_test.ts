/**
 * A mutant that cannot be written to its slot ends `dist/vector spec mutate`
 * as writeFileSync's abort did: `nish: cannot write <path>` and exit 1. Build
 * `dist/vector` first.
 */

import { Suite } from "nish/testing"
import { replaceAll } from "nish/text"
import { sha256Hex } from "../../../src/core/hex"
import { runProcess } from "../../../src/core/process"
import { gitdiffTop } from "../../../src/spec/pr/gitdiff"
import { prTestCommit, prTestGit, prTestRemove, prTestRepo, prTestWrite } from "./repo"

/** The plain text of a one-section RFC 4648. */
const MUTATEWRITE_RFC: string = "Request for Comments: 4648\n\f\n1.  Introduction\n\n   It MUST work.\n"

/** A contract on nish/m testing `k`, whose source pins `sha`. */
const mutatewriteContract = (sha: string): string => `{
  "contract": "c1",
  "source": {"title": "T", "rfc": 4648, "sha256": "${sha}"},
  "target": {"module": "nish/m"},
  "requirements": [{"id": "R1", "section": "1", "level": "MUST", "quote": "It MUST work."}],
  "functions": [{"name": "k", "params": [], "returns": "i32"}],
  "clauses": [
    {"kind": "vector", "id": "V1", "title": "t", "covers": ["R1"],
     "source": {"cite": {"section": "1"}}, "call": "k", "args": [], "expect": {"int": 7}}
  ]
}
`

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
 * A test that passes, and that in the slot leaves a directory where the
 * module is, so the first mutant written there cannot be.
 */
const MUTATEWRITE_TEST: string = `rm -f std/m.ts && mkdir std/m.ts
exit 0
`

/** The module at `value`. */
const mutatewriteModule = (value: i32): string => `/** Seven. */\nexport const k = (): i32 => ${value}\n`

/** `dist/vector spec mutate` on a repository whose slot is unwritable: its exit, stdout and stderr, `dir` as `<repo>`. */
const mutatewriteRun = (dir: string): Result<string, string> => {
  const self = gitdiffTop(".").orReturn()
  prTestWrite(dir, "c.json", mutatewriteContract(sha256Hex(MUTATEWRITE_RFC))).orReturn()
  prTestWrite(dir, "t.ts", MUTATEWRITE_TEST).orReturn()
  prTestWrite(dir, "root/std/m.ts", mutatewriteModule(6)).orReturn()
  prTestWrite(dir, "root/bin/nish", MUTATEWRITE_NISH).orReturn()
  const chmod = runProcess(["chmod", "+x", "--", `${dir}/root/bin/nish`], "", 10000).orReturn()
  if (chmod.status !== 0) {
    return Err(`chmod exits ${chmod.status}: ${chmod.stderr}`)
  }
  prTestCommit(dir, "base").orReturn()
  prTestGit(dir, ["checkout", "-q", "-b", "work"]).orReturn()
  prTestWrite(dir, "root/std/m.ts", mutatewriteModule(7)).orReturn()
  const argv: string[] = ["env", "-u", "GIT_DIR", "-u", "GIT_WORK_TREE", "-u", "GIT_INDEX_FILE"]
  for (const a of [`${self}/dist/vector`, "spec", "mutate", "--base", "main", "--nish-root", `${dir}/root`]) {
    argv.push(a)
  }
  for (const a of ["--nish", "bin/nish", "--test", `${dir}/t.ts`, `${dir}/c.json`]) {
    argv.push(a)
  }
  const r = runProcess(argv, "", 120000).orReturn()
  return Ok(`exit ${r.status}\n${replaceAll(r.stdout, dir, "<repo>")}${replaceAll(r.stderr, dir, "<repo>")}`)
}

/**
 * The write failure exits 1 with the runtime's line naming the slot's module,
 * and prints no report.
 *
 * @returns the suite's exit status
 */
export const main = (): i32 => {
  const t = new Suite("spec/pr mutate write failure")
  const dir = prTestRepo("vector-mutatewrite-")
  if (dir.isErr()) {
    t.fail("the repository is made", dir.error)
    return t.done()
  }
  const r = mutatewriteRun(dir.value)
  prTestRemove(dir.value)
  if (r.isErr()) {
    t.fail("the repository is set up", r.error)
    return t.done()
  }
  const out = r.value
  t.ok(`it exits 1 with nothing on stdout (${out})`, out.startsWith("exit 1\nnish: cannot write "))
  t.ok(`the one stderr line names the slot's module (${out})`, out.endsWith("/std/m.ts\n"))
  t.ok(`and the line is all it prints (${out})`, out.indexOf("\n", 7) === out.length - 1)
  return t.done()
}
