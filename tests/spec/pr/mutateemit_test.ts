/**
 * mutate without `--test`: the contract's test is emitted as `spec emit`
 * writes it, built against each mutant by a stub compiler, and kills them.
 * That holds for a contract whose main source is .xml (example-hex), and a
 * z3 that cannot run is a tool failure (exit 2), not a refusal.
 */

import { Suite } from "nish/testing"
import { splitLines } from "nish/text"
import { joinPath } from "../../../src/core/fs"
import { sha256Hex } from "../../../src/core/hex"
import { runProcess } from "../../../src/core/process"
import { MutateRun, mutateCheck } from "../../../src/spec/pr/mutaterun"
import { prTestCommit, prTestGit, prTestRemove, prTestRepo, prTestWrite } from "./repo"

/** The plain text of a one-section RFC 9999. */
const MUTATEEMIT_TEST_RFC: string =
  "Request for Comments: 9999\n\f\n1.  Introduction\n\n   It MUST work, iterated 3 times.\n"

/** A contract on nish/m testing that `k()` is 7, and a slow iterated `id`, whose source pins `sha`. */
const mutateemitTestContract = (sha: string): string => `{
  "contract": "c1",
  "source": {"title": "T", "rfc": 9999, "sha256": "${sha}"},
  "target": {"module": "nish/m"},
  "requirements": [{"id": "R1", "section": "1", "level": "MUST", "quote": "It MUST work, iterated 3 times."}],
  "functions": [
    {"name": "k", "params": [], "returns": "i32"},
    {"name": "id", "params": [{"name": "x", "type": "i32"}], "returns": "i32"}
  ],
  "clauses": [
    {"kind": "vector", "id": "V1", "title": "t", "covers": ["R1"],
     "source": {"cite": {"section": "1"}}, "call": "k", "args": [], "expect": {"int": 7}},
    {"kind": "vector", "id": "V2", "title": "t", "covers": ["R1"],
     "source": {"cite": {"section": "1"}}, "call": "id", "args": [{"int": 7}], "expect": {"int": 7},
     "iterate": {"count": 3, "names": ["x"], "next": [{"call": "id", "args": [{"var": "x"}]}], "slow": true}}
  ]
}
`

/**
 * A stub compiler: refuses the canary, fails with no located error unless
 * its test is the emitted one (it carries the contract's sha line), and
 * otherwise links a binary that passes only while k is 7. Each build's
 * arguments are appended to `log`.
 */
const mutateemitTestNish = (log: string): string => `#!/bin/sh
echo "$*" >> "${log}"
root=$(cd "$(dirname "$0")/.." && pwd)
if grep -q 'canary' "$root/std/m.ts"; then
  echo "std/m.ts:9:1: syntax error: canary" >&2
  exit 1
fi
if ! grep -q '^// vector-contract-sha256: [0-9a-f]' "$1" || ! grep -q 'k()' "$1"; then
  echo "not the emitted test: $1" >&2
  exit 1
fi
printf '#!/bin/sh\\ncd "%s" && grep -q "=> 7" std/m.ts\\n' "$root" > "$4"
chmod +x "$4"
`

/** Commits the module, stub compiler, RFC and contract, then changes the module on a work branch. */
const mutateemitTestReady = (d: string): Result<boolean, string> => {
  prTestWrite(d, "nish/std/m.ts", "").orReturn()
  prTestWrite(d, "nish/bin/nish", mutateemitTestNish(`${d}.argv`)).orReturn()
  runProcess(["chmod", "+x", "--", `${d}/nish/bin/nish`], "", 10000).orReturn()
  prTestWrite(d, "rfc9999.txt", MUTATEEMIT_TEST_RFC).orReturn()
  prTestWrite(d, "c.json", mutateemitTestContract(sha256Hex(MUTATEEMIT_TEST_RFC))).orReturn()
  prTestCommit(d, "base").orReturn()
  prTestGit(d, ["checkout", "-q", "-b", "work"]).orReturn()
  prTestWrite(d, "nish/std/m.ts", "export const k = (): i32 => 7\nexport const id = (x: i32): i32 => x\n").orReturn()
  return Ok(true)
}

/** The repository's example-hex contract, whose main source is specs/example-hex.xml. */
const MUTATEEMIT_TEST_HEX: string = "contracts/example-hex.json"

/**
 * A stub compiler that builds only the test emitted for the contract whose
 * SHA-256 is `sha`, linking a binary that passes only while k is 7. Each
 * build's arguments are appended to `log`.
 */
const mutateemitTestHexNish = (sha: string, log: string): string => `#!/bin/sh
echo "$*" >> "${log}"
root=$(cd "$(dirname "$0")/.." && pwd)
if grep -q 'canary' "$root/std/hex.ts"; then
  echo "std/hex.ts:9:1: syntax error: canary" >&2
  exit 1
fi
if ! grep -q '^// vector-contract-sha256: ${sha}$' "$1" || ! grep -q 'hexEncode' "$1"; then
  echo "not example-hex's emitted test: $1" >&2
  exit 1
fi
printf '#!/bin/sh\\ncd "%s" && grep -q "=> 7" std/hex.ts\\n' "$root" > "$4"
chmod +x "$4"
`

/** Commits nish/std/hex.ts and a stub compiler for example-hex's test, then changes the module on a work branch. */
const mutateemitTestHexReady = (d: string, sha: string): Result<boolean, string> => {
  prTestWrite(d, "nish/std/hex.ts", "").orReturn()
  prTestWrite(d, "nish/bin/nish", mutateemitTestHexNish(sha, `${d}.argv`)).orReturn()
  runProcess(["chmod", "+x", "--", `${d}/nish/bin/nish`], "", 10000).orReturn()
  prTestCommit(d, "base").orReturn()
  prTestGit(d, ["checkout", "-q", "-b", "work"]).orReturn()
  prTestWrite(d, "nish/std/hex.ts", "export const k = (): i32 => 7\n").orReturn()
  return Ok(true)
}

/** example-hex, whose main source is .xml: its emitted test kills the mutants, and a missing z3 exits 2. */
const mutateemitTestHex = (t: Suite): Result<boolean, string> => {
  const text = readFileSyncOrNull(MUTATEEMIT_TEST_HEX)
  const contract = realpathSync(MUTATEEMIT_TEST_HEX)
  if (text === null || contract === null) {
    return Err(`${MUTATEEMIT_TEST_HEX} cannot be read: run from the repository's top`)
  }
  const d = prTestRepo("vector-mutate-emit-hex-").orReturn()
  const made = mutateemitTestHexReady(d, sha256Hex(text))
  if (made.isErr()) {
    prTestRemove(d)
    return made
  }
  const r = mutateCheck(contract, "main", new MutateRun(`${d}/nish`, "", "bin/nish", "", 2, 60000), 0)
  t.eqStr(
    "an .xml-sourced contract's emitted test is built against each mutant and kills it",
    r.isOk() ? `${r.value.items.join(" | ")} || ${r.value.problems.join(" | ")}` : r.error,
    "killed std/hex.ts:1:29 int: export const k = (): i32 => 8 | killed std/hex.ts:1:29 int: export const k = (): i32 => 6 || ",
  )
  mutateemitTestArgv(t, `${d}.argv`)
  const vector = realpathSync("dist/vector")
  if (vector === null) {
    t.fail("a missing z3 exits 2", "no dist/vector: run npm run build")
  } else {
    const nish = joinPath(d, "nish")
    const argv = [
      "env",
      "VECTOR_Z3=/nonexistent",
      vector,
      "spec",
      "mutate",
      contract,
      "--base",
      "main",
      "--nish-root",
      nish,
      "--nish",
      "bin/nish",
    ]
    const run = runProcess(argv, "", 120000)
    t.eqStr(
      "a missing z3 is a tool failure: exit 2, z3's message, no refusals",
      run.isOk() ? `${run.value.status} | ${run.value.stdout} | ${run.value.stderr}` : run.error,
      `2 |  | vector: spec mutate: ${contract}: cannot be checked: VECTOR_Z3 is /nonexistent, which is not a file\n`,
    )
  }
  prTestRemove(d)
  return Ok(true)
}

/** Every build mutate started was of a test, with the no-panic rule relaxed once, so a mutant that panics is killed. */
const mutateemitTestArgv = (t: Suite, log: string): void => {
  const text = readFileSyncOrNull(log) ?? ""
  const builds: string[] = []
  for (const l of splitLines(text)) {
    if (l.length > 0) {
      builds.push(l)
    }
  }
  t.ok(`mutate started its builds (${builds.length})`, builds.length >= 3)
  for (const b of builds) {
    const at = b.indexOf(" --allow-panics --link ")
    t.ok(`a mutant build is linked, relaxed: ${b}`, at > 0)
    t.ok(
      `and relaxes the no-panic rule once: ${b}`,
      at > 0 && b.indexOf("--allow") === at + 1 && b.substring(at + 2).indexOf("--allow") < 0,
    )
  }
  t.ok("its log is removed", runProcess(["rm", "-f", "--", log], "", 10000).isOk())
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
    t.eqStr(
      "the slow vector the emitted test skips is noted",
      r.isOk() ? r.value.notes.join(" | ") : r.error,
      "slow vector V2 was not run against the mutants: the emitted test skips it, as spec emit does without --slow",
    )
    mutateemitTestArgv(t, `${d}.argv`)
  }
  prTestRemove(d)
  const hex = mutateemitTestHex(t)
  if (hex.isErr()) {
    t.fail("the example-hex repository", hex.error)
  }
  return t.done()
}
