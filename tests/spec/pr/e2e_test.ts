/**
 * The gates end to end: `dist/vector spec frozen|exports|mutate` run in a
 * throwaway repository per case, so the result never depends on the state of
 * vector's own working tree. Build `dist/vector` first.
 */

import { Suite } from "nish/testing"
import { replaceAll } from "nish/text"
import { sha256Hex } from "../../../src/core/hex"
import { runProcess } from "../../../src/core/process"
import { gitdiffTop } from "../../../src/spec/pr/gitdiff"
import { prTestCommit, prTestGit, prTestRemove, prTestRepo, prTestWrite } from "./repo"

/** The plain text of a one-section RFC 4648. */
const E2E_TEST_RFC: string = "Request for Comments: 4648\n\f\n1.  Introduction\n\n   It MUST work.\n"

/** A contract on nish/hex testing `enc`, whose source pins `sha`. */
const e2eTestContract = (sha: string): string => `{
  "contract": "c1",
  "source": {"title": "T", "rfc": 4648, "sha256": "${sha}"},
  "target": {"module": "nish/hex"},
  "requirements": [{"id": "R1", "section": "1", "level": "MUST", "quote": "It MUST work."}],
  "functions": [{"name": "enc", "params": [{"name": "b", "type": "bytes"}], "returns": "string"}],
  "clauses": [
    {"kind": "vector", "id": "V1", "title": "t", "covers": ["R1"],
     "source": {"cite": {"section": "1"}}, "call": "enc", "args": [{"hex": "00"}], "expect": {"str": "00"}}
  ]
}
`

/** The module at the base. */
const E2E_TEST_HEX: string = "/** Encodes. */\nexport const enc = (b: string): string => b\n"

/**
 * Runs vector's own `dist/vector`, found from the top of the checkout the
 * test runs in, with `args`, clearing the variables that would point git at
 * another repository: its exit status and standard output, with `dir` shown
 * as `<repo>`.
 */
const e2eTestRun = (dir: string, args: string[]): string => {
  const self = gitdiffTop(".")
  if (self.isErr()) {
    return `cannot find vector's checkout: ${self.error}`
  }
  const argv: string[] = [
    "env",
    "-u",
    "GIT_DIR",
    "-u",
    "GIT_WORK_TREE",
    "-u",
    "GIT_INDEX_FILE",
    `${self.value}/dist/vector`,
  ]
  for (const a of args) {
    argv.push(a)
  }
  const r = runProcess(argv, "", 120000)
  if (r.isErr()) {
    return `cannot run dist/vector (build it first): ${r.error}`
  }
  const top = gitdiffTop(dir)
  const out = top.isOk() ? replaceAll(r.value.stdout, top.value, "<repo>") : r.value.stdout
  return `exit ${r.value.status}\n${replaceAll(out, dir, "<repo>")}${r.value.stderr}`
}

/** A repository whose main branch pins a contract on the RFC; the work branch changes it. */
const e2eTestFrozen = (t: Suite, dir: string): Result<boolean, string> => {
  prTestWrite(dir, "rfcs/rfc4648.txt", E2E_TEST_RFC).orReturn()
  prTestWrite(dir, "contracts/c.json", e2eTestContract(sha256Hex(E2E_TEST_RFC))).orReturn()
  prTestWrite(dir, "contracts/bad.json", e2eTestContract(sha256Hex("not the RFC"))).orReturn()
  prTestWrite(dir, "src/x.ts", "x\n").orReturn()
  prTestCommit(dir, "base").orReturn()
  prTestGit(dir, ["checkout", "-q", "-b", "work"]).orReturn()
  prTestWrite(dir, "src/x.ts", "y\n").orReturn()
  t.eqStr(
    "frozen passes an implementation change",
    e2eTestRun(dir, ["spec", "frozen", "--base", "main", "--repo", dir, "contracts/c.json"]),
    "exit 0\nspec frozen against main: OK\n\n  ✓ contract contracts/c.json\n  implementation src/x.ts\n",
  )
  t.eqStr(
    "frozen refuses a contract outside the repository",
    e2eTestRun(dir, ["spec", "frozen", "--base", "main", "--repo", dir, "../c.json"]),
    "exit 1\nspec frozen against main: FAILED\n\n  ✗ contract ../c.json\n  implementation src/x.ts\n\nproblems:\n  ✗ ../c.json: a contract path may not climb with ..: give it from the repository's top\n",
  )
  t.eqStr(
    "frozen refuses a contract whose source does not match its hash",
    e2eTestRun(dir, ["spec", "frozen", "--base", "main", "--repo", dir, "contracts/bad.json"]),
    "exit 1\nspec frozen against main: FAILED\n\n  ✗ contract contracts/bad.json\n  implementation src/x.ts\n\nproblems:\n  ✗ contracts/bad.json: source rfc4648 (rfcs/rfc4648.txt) has SHA-256 20be475fef2752375647b5ee6dcbefdc61110ae85127921ced8b7a27f89f1178, but the contract pins 00cf257b010dc944bc7d9a6fa1d4380aed315e8a4b32d646e8b4c94773be2318: the source changed\n",
  )
  prTestWrite(dir, "specs/s.md", "s\n").orReturn()
  t.eqStr(
    "frozen refuses a change to both sides",
    e2eTestRun(dir, ["spec", "frozen", "--base", "main", "--repo", dir, "contracts/c.json"]),
    "exit 1\nspec frozen against main: FAILED\n\n  ✓ contract contracts/c.json\n  spec specs/s.md\n  implementation src/x.ts\n\nproblems:\n  ✗ the change touches the spec side (specs/s.md) and the implementation (src/x.ts): change them in separate PRs\n",
  )
  return Ok(true)
}

/** A nish checkout whose std/hex.ts the work branch changes. */
const e2eTestModule = (t: Suite, dir: string): Result<boolean, string> => {
  prTestWrite(dir, "nish/std/hex.ts", E2E_TEST_HEX).orReturn()
  prTestWrite(dir, "c.json", e2eTestContract(sha256Hex(E2E_TEST_RFC))).orReturn()
  prTestCommit(dir, "base").orReturn()
  prTestGit(dir, ["checkout", "-q", "-b", "work"]).orReturn()
  const root = `${dir}/nish`
  const contract = `${dir}/c.json`
  t.eqStr(
    "exports passes an unchanged module",
    e2eTestRun(dir, ["spec", "exports", "--base", "main", "--nish-root", root, contract]),
    "exit 0\nspec exports of std/hex.ts against main: OK\n",
  )
  t.eqStr(
    "exports refuses a root without the module",
    e2eTestRun(dir, ["spec", "exports", "--base", "main", "--nish-root", dir, contract]),
    "exit 1\nspec exports of std/hex.ts against main: FAILED\n\nproblems:\n  ✗ std/hex.ts exists neither at the fork point nor now: is <repo> the nish checkout?\n",
  )
  t.eqStr(
    "mutate refuses a change with nothing to mutate",
    e2eTestRun(dir, ["spec", "mutate", "--base", "main", "--nish-root", root, "--test", `${dir}/t.ts`, contract]),
    "exit 1\nspec mutate std/hex.ts against main: FAILED\n\nproblems:\n  ✗ no mutants: the change adds no line of std/hex.ts that can be mutated\n",
  )
  t.eqStr(
    "mutate refuses a root without the module",
    e2eTestRun(dir, ["spec", "mutate", "--base", "main", "--nish-root", dir, "--test", `${dir}/t.ts`, contract]),
    "exit 1\nspec mutate std/hex.ts against main: FAILED\n\nproblems:\n  ✗ <repo>/std/hex.ts cannot be read: is <repo> the nish checkout?\n",
  )
  prTestWrite(dir, "nish/std/hex.ts", `${E2E_TEST_HEX}\n/** New. */\nexport const fresh = (): i32 => 1\n`).orReturn()
  t.eqStr(
    "exports refuses an untested export",
    e2eTestRun(dir, ["spec", "exports", "--base", "main", "--nish-root", root, contract]),
    "exit 1\nspec exports of std/hex.ts against main: FAILED\n\n  added fresh\n\nproblems:\n  ✗ export fresh is added, but the contract neither tests it nor lists it in outOfScope with a reason\n",
  )
  prTestWrite(dir, "nish/std/hex.ts", `${E2E_TEST_HEX}export const pair = f<A, B>(x)\n`).orReturn()
  t.eqStr(
    "exports refuses an export it cannot split, naming its line",
    e2eTestRun(dir, ["spec", "exports", "--base", "main", "--nish-root", root, contract]),
    "exit 1\nspec exports of std/hex.ts against main: FAILED\n\n  unnamed export const pair = f<A, B>(x)\n\nproblems:\n  ✗ line 3: an export it cannot split into names: export const pair = f<A, B>(x): a comma or an angle bracket it cannot place, so it may declare more than one name: give it a declaration of its own the contract can test, since the gate refuses what it cannot name\n",
  )
  return Ok(true)
}

/** Runs `step` in a fresh repository, then removes it. */
const e2eTestIn = (t: Suite, prefix: string, step: (t: Suite, dir: string) => Result<boolean, string>): void => {
  const dir = prTestRepo(prefix)
  if (dir.isErr()) {
    t.fail("a repository", dir.error)
    return
  }
  const ran = step(t, dir.value)
  if (ran.isErr()) {
    t.fail(`the ${prefix} steps`, ran.error)
  }
  prTestRemove(dir.value)
}

/** The gates run as a user runs them, each in a repository of its own. */
export const main = (): i32 => {
  const t = new Suite("spec/pr e2e")
  e2eTestIn(t, "vector-e2e-frozen-", e2eTestFrozen)
  e2eTestIn(t, "vector-e2e-module-", e2eTestModule)
  return t.done()
}
