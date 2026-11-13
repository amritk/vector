/**
 * mutate without `--test`: the contract's test is emitted as `spec emit`
 * writes it, built against each mutant by a stub compiler, and kills them.
 */

import { Suite } from "nish/testing"
import { sha256Hex } from "../../../src/core/hex"
import { runProcess } from "../../../src/core/process"
import { MutateRun, mutateCheck } from "../../../src/spec/pr/mutaterun"
import { prTestCommit, prTestGit, prTestRemove, prTestRepo, prTestWrite } from "./repo"

/** The plain text of a one-section RFC 9999. */
const MUTATEEMIT_TEST_RFC: string = "Request for Comments: 9999\n\f\n1.  Introduction\n\n   It MUST work.\n"

/** A contract on nish/m testing that `k()` is 7, whose source pins `sha`. */
const mutateemitTestContract = (sha: string): string => `{
  "contract": "c1",
  "source": {"title": "T", "rfc": 9999, "sha256": "${sha}"},
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
 * A stub compiler: refuses the canary, fails with no located error unless
 * its test is the emitted one (it carries the contract's sha line), and
 * otherwise links a binary that passes only while k is 7.
 */
const MUTATEEMIT_TEST_NISH: string = `#!/bin/sh
root=$(cd "$(dirname "$0")/.." && pwd)
if grep -q 'canary' "$root/std/m.ts"; then
  echo "std/m.ts:9:1: syntax error: canary" >&2
  exit 1
fi
if ! grep -q '^// vector-contract-sha256: [0-9a-f]' "$1" || ! grep -q 'k()' "$1"; then
  echo "not the emitted test: $1" >&2
  exit 1
fi
printf '#!/bin/sh\\ncd "%s" && grep -q "=> 7" std/m.ts\\n' "$root" > "$3"
chmod +x "$3"
`

/** Commits the module, stub compiler, RFC and contract, then changes the module on a work branch. */
const mutateemitTestReady = (d: string): Result<boolean, string> => {
  prTestWrite(d, "nish/std/m.ts", "").orReturn()
  prTestWrite(d, "nish/bin/nish", MUTATEEMIT_TEST_NISH).orReturn()
  runProcess(["chmod", "+x", "--", `${d}/nish/bin/nish`], "", 10000).orReturn()
  prTestWrite(d, "rfc9999.txt", MUTATEEMIT_TEST_RFC).orReturn()
  prTestWrite(d, "c.json", mutateemitTestContract(sha256Hex(MUTATEEMIT_TEST_RFC))).orReturn()
  prTestCommit(d, "base").orReturn()
  prTestGit(d, ["checkout", "-q", "-b", "work"]).orReturn()
  prTestWrite(d, "nish/std/m.ts", "export const k = (): i32 => 7\n").orReturn()
  return Ok(true)
}

/** The emitted test kills both mutants of the changed line. */
export const main = (): i32 => {
  const t = new Suite("spec/pr mutateemit")
  const dir = prTestRepo("vector-mutate-emit-")
  if (dir.isErr()) {
    t.fail("a repository", dir.error)
    return t.done()
  }
  const d = dir.value
  const made = mutateemitTestReady(d)
  if (made.isErr()) {
    t.fail("the repository's files", made.error)
  } else {
    const r = mutateCheck(`${d}/c.json`, "main", new MutateRun(`${d}/nish`, "", "bin/nish", "", 2, 60000), 0)
    t.eqStr(
      "without --test, the emitted test is built against each mutant and kills it",
      r.isOk() ? `${r.value.items.join(" | ")} || ${r.value.problems.join(" | ")}` : r.error,
      "killed std/m.ts:1:29 int: export const k = (): i32 => 8 | killed std/m.ts:1:29 int: export const k = (): i32 => 6 || ",
    )
    t.ok("and the gate passes", r.isOk() && r.value.problems.length === 0)
  }
  prTestRemove(d)
  return t.done()
}
