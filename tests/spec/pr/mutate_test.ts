import { Suite } from "nish/testing"
import { runProcess } from "../../../src/core/process"
import { contractLoad } from "../../../src/spec/contract/contract"
import { AllowedSurvivor } from "../../../src/spec/contract/types"
import { GitdiffFile, gitdiffParse } from "../../../src/spec/pr/gitdiff"
import {
  MUTATE_BUILD_TIMED_OUT,
  MUTATE_KILLED,
  MUTATE_PENDING,
  MUTATE_STILLBORN,
  MUTATE_SURVIVED,
  MUTATE_TIMED_OUT,
  MutateMutant,
  mutateApply,
  mutateJudge,
  mutateLine,
  mutateOutcomeName,
  mutatePick,
  mutateSites,
} from "../../../src/spec/pr/mutate"
import { MutateRun, mutateCheck, mutateRunAll } from "../../../src/spec/pr/mutaterun"
import { PrReport } from "../../../src/spec/pr/report"
import { prTestCommit, prTestGit, prTestRemove, prTestRepo, prTestWrite } from "./repo"

/** A mutant list as "op:after" joined by " | ". */
const mutateTestList = (ms: MutateMutant[]): string => {
  const out: string[] = []
  for (const m of ms) {
    out.push(`${m.id}=${m.after}`)
  }
  return out.join(" | ")
}

/**
 * A stub compiler: refuses a module holding "return null", and otherwise
 * links a "binary" that runs the test as a shell script from the root.
 */
const MUTATE_TEST_NISH: string = `#!/bin/sh
root=$(cd "$(dirname "$0")/.." && pwd)
if grep -q 'return null\\|canary' "$root/std/m.ts"; then
  printf '%s/std/m.ts:5:3: error: refused\\n  5 |   return null\\n1 error\\n' "$root" >&2
  exit 1
fi
printf '#!/bin/sh\\ncd "%s" && exec sh "%s"\\n' "$root" "$1" > "$3"
chmod +x "$3"
`

/**
 * The time limit for each step of a run that must cut a hang short: a stub
 * build is one printf and a test one grep, which no loaded CI machine
 * stretches to 20 s, while the hang (600 s) always outlasts it. The test file
 * runs three such runs, and must finish inside tests/run.mjs's 120 s.
 */
const MUTATE_TEST_LIMIT_MS: i32 = 20000

/** The time limit for a run with no hang in it, so it never ends by the clock. */
const MUTATE_TEST_CALM_MS: i32 = 60000

/** The module at the base. */
const MUTATE_TEST_BEFORE: string = "export const old = (): i32 => 1\n"

/** The module the change makes. */
const MUTATE_TEST_AFTER: string = `export const old = (): i32 => 1
export const lt = (a: i32, b: i32): boolean => a < b
export const k = (): i32 => 7
export const f = (x: i32): i32 => {
  return x
}
`

/** The test: pins \`a < b\`, hangs on 6, and pins nothing else. */
const MUTATE_TEST_PROGRAM: string = `grep -q 'a < b' std/m.ts || exit 1
grep -q '=> 6' std/m.ts && sleep 600
exit 0
`

/** A contract on nish/m that allows a survivor on line 3. */
const MUTATE_TEST_CONTRACT: string = `{
  "contract": "c1",
  "source": {"title": "T", "rfc": 4648},
  "target": {"module": "nish/m"},
  "requirements": [{"id": "R1", "section": "3.1", "level": "MUST", "quote": "Q"}],
  "functions": [{"name": "k", "params": [], "returns": "i32"}],
  "allowSurvivors": [
    {"file": "std/m.ts", "line": 3, "reason": "k is a constant the spec leaves open"},
    {"file": "std/m.ts", "line": 9, "reason": "stale"}
  ],
  "clauses": [
    {"kind": "vector", "id": "V1", "title": "t", "covers": ["R1"],
     "source": {"cite": {"section": "10"}}, "call": "k", "args": [], "expect": {"int": 7}}
  ]
}
`

/** A nish checkout whose std/m.ts gains lines, run against the stub compiler. */
const mutateTestRepo = (t: Suite): Result<boolean, string> => {
  const dir = prTestRepo("vector-mutate-test-").orReturn()
  prTestWrite(dir, "nish/std/m.ts", MUTATE_TEST_BEFORE).orReturn()
  prTestWrite(dir, "nish/bin/nish", MUTATE_TEST_NISH).orReturn()
  const chmod = runProcess(["chmod", "+x", "--", `${dir}/nish/bin/nish`], "", 10000).orReturn()
  t.ok("the stub compiler is executable", chmod.status === 0)
  prTestCommit(dir, "base").orReturn()
  prTestGit(dir, ["checkout", "-q", "-b", "work"]).orReturn()
  prTestWrite(dir, "nish/std/m.ts", MUTATE_TEST_AFTER).orReturn()
  prTestWrite(dir, "t.sh", MUTATE_TEST_PROGRAM).orReturn()
  prTestWrite(dir, "c.json", MUTATE_TEST_CONTRACT).orReturn()
  const root = `${dir}/nish`
  const run = new MutateRun(root, "", "bin/nish", `${dir}/t.sh`, 3, MUTATE_TEST_LIMIT_MS)
  const r = mutateCheck(`${dir}/c.json`, "main", run, 0)
  t.ok("the check runs", r.isOk())
  if (r.isOk()) {
    t.eqStr(
      "the change's mutants, run",
      r.value.items.join(" | "),
      [
        "killed std/m.ts:2:50 relational: export const lt = (a: i32, b: i32): boolean => a <= b",
        "survived std/m.ts:3:29 int: export const k = (): i32 => 8",
        "timed out std/m.ts:3:29 int: export const k = (): i32 => 6",
        "stillborn std/m.ts:5:3 return-null: return null",
      ].join(" | "),
    )
    t.eqStr(
      "a hung test is no kill: one in four is past the share",
      r.value.problems.join(" | "),
      "1 of 4 mutants ran their test past its time, more than 10%: a timeout is neither a kill nor a survival, so a survivor may hide among them: run with fewer --jobs",
    )
    t.eqStr(
      "the notes",
      r.value.notes.join(" | "),
      "survivor std/m.ts:3 (3:29:int:+1) is allowed: k is a constant the spec leaves open | STALE? allowSurvivors std/m.ts:9 matched no survivor this run: no mutant of that line ran, so check it still names the line it means",
    )
  }
  const one = mutateCheck(`${dir}/c.json`, "main", new MutateRun(root, "", "bin/nish", `${dir}/t.sh`, 1, 0), 2)
  t.eqStr(
    "one job, two mutants, a derived time limit",
    one.isOk() ? one.value.items.join(" | ") : "<err>",
    "killed std/m.ts:2:50 relational: export const lt = (a: i32, b: i32): boolean => a <= b | timed out std/m.ts:3:29 int: export const k = (): i32 => 6",
  )
  prTestWrite(dir, "fail.sh", "exit 3\n").orReturn()
  const failing = mutateCheck(
    `${dir}/c.json`,
    "main",
    new MutateRun(root, "", "bin/nish", `${dir}/fail.sh`, 2, MUTATE_TEST_CALM_MS),
    0,
  )
  t.eqStr(
    "a test failing on the unmutated module",
    failing.isOk() ? failing.value.problems.join(" | ") : "<err>",
    "the test fails on the unmutated module, so it proves nothing: it exits 3: (no output)",
  )
  t.ok("an unknown base is an error", mutateCheck(`${dir}/c.json`, "nope", run, 0).isErr())
  t.ok("a missing contract is an error", mutateCheck(`${dir}/none.json`, "main", run, 0).isErr())
  prTestCommit(dir, "change").orReturn()
  const none = mutateCheck(`${dir}/c.json`, "work", run, 0)
  t.eqStr(
    "nothing changed",
    none.isOk() ? none.value.problems.join(" | ") : "<err>",
    "no mutants: the change adds no line of std/m.ts that can be mutated",
  )
  const elsewhere = mutateCheck(
    `${dir}/c.json`,
    "main",
    new MutateRun(dir, "", "bin/nish", `${dir}/t.sh`, 1, MUTATE_TEST_CALM_MS),
    0,
  )
  t.ok("a root without the module is an error", elsewhere.isErr() && elsewhere.error.indexOf("cannot be read") >= 0)
  prTestRemove(dir)
  return Ok(true)
}

/**
 * A stub compiler whose builds go wrong: it hangs on \`a <= b\`, refuses
 * "return null" with an error located in the module, and otherwise links.
 */
const MUTATE_TEST_ODD_NISH: string = `#!/bin/sh
root=$(cd "$(dirname "$0")/.." && pwd)
if grep -q 'canary' "$root/std/m.ts"; then
  echo "std/m.ts:9:1: syntax error: canary" >&2
  exit 1
fi
if grep -q 'a <= b' "$root/std/m.ts"; then
  exec sleep 600
fi
if grep -q 'return null' "$root/std/m.ts"; then
  echo "std/m.ts:5:3: error: refused" >&2
  exit 1
fi
printf '#!/bin/sh\\ncd "%s" && exec sh "%s"\\n' "$root" "$1" > "$3"
chmod +x "$3"
`

/** A stub compiler that refuses the canary, fails "return null" with \`what\` (shell), and otherwise links. */
const mutateTestBadNish = (what: string): string => `#!/bin/sh
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

/** A stub compiler that exits 0 and writes nothing. */
const MUTATE_TEST_EMPTY_NISH: string = `#!/bin/sh
exit 0
`

/** A stub compiler that links every module, the canary included: it does not read the copy. */
const MUTATE_TEST_BLIND_NISH: string = `#!/bin/sh
root=$(cd "$(dirname "$0")/.." && pwd)
printf '#!/bin/sh\\ncd "%s" && exec sh "%s"\\n' "$root" "$1" > "$3"
chmod +x "$3"
`

/**
 * Runs the change's mutants against the stub compiler `nish`, in a fresh
 * repository, with the test `t.sh`, or with the contract's emitted test when
 * `emit` is set.
 */
const mutateTestWith = (nish: string, emit: boolean): Result<PrReport, string> => {
  const dir = prTestRepo("vector-mutate-odd-").orReturn()
  prTestWrite(dir, "nish/std/m.ts", MUTATE_TEST_BEFORE).orReturn()
  prTestWrite(dir, "nish/bin/nish", nish).orReturn()
  runProcess(["chmod", "+x", "--", `${dir}/nish/bin/nish`], "", 10000).orReturn()
  prTestCommit(dir, "base").orReturn()
  prTestGit(dir, ["checkout", "-q", "-b", "work"]).orReturn()
  prTestWrite(dir, "nish/std/m.ts", MUTATE_TEST_AFTER).orReturn()
  prTestWrite(dir, "t.sh", MUTATE_TEST_PROGRAM).orReturn()
  prTestWrite(dir, "c.json", MUTATE_TEST_CONTRACT).orReturn()
  const run = new MutateRun(`${dir}/nish`, "", "bin/nish", emit ? "" : `${dir}/t.sh`, 4, MUTATE_TEST_LIMIT_MS)
  const r = mutateCheck(`${dir}/c.json`, "main", run, 0)
  prTestRemove(dir)
  return r
}

/** Builds that hang, are refused, or fail for the tool, for a mutant and for the baseline. */
const mutateTestOddBuilds = (t: Suite): void => {
  const odd = mutateTestWith(MUTATE_TEST_ODD_NISH, false)
  t.eqStr(
    "a hung build and a refused one",
    odd.isOk() ? `${odd.value.items.join(" | ")} || ${odd.value.problems.join(" | ")}` : odd.error,
    [
      "build timed out std/m.ts:2:50 relational: export const lt = (a: i32, b: i32): boolean => a <= b",
      "survived std/m.ts:3:29 int: export const k = (): i32 => 8",
      "timed out std/m.ts:3:29 int: export const k = (): i32 => 6",
      "stillborn std/m.ts:5:3 return-null: return null || 1 of 4 mutant builds ran past their time, more than 10%: a survivor may hide among them, so run with fewer --jobs",
      "1 of 4 mutants ran their test past its time, more than 10%: a timeout is neither a kill nor a survival, so a survivor may hide among them: run with fewer --jobs",
    ].join(" | "),
  )
  const bad = [
    ["an unrelated failure", "echo 'out of memory' >&2; exit 1", "with no error located in std/m.ts"],
    ["a kill by a signal", "kill -9 $$", "a mutant's build exits 137"],
    ["an error in another module", "echo 'std/other.ts:1:1: error: x' >&2; exit 1", "with no error located"],
    ["no binary", "exit 0", "a mutant's build exits 0 but writes no binary"],
  ]
  for (const b of bad) {
    const r = mutateTestWith(mutateTestBadNish(b[1]), false)
    t.ok(`${b[0]} is the tool's failure, not a stillborn mutant`, r.isErr() && r.error.indexOf(b[2]) >= 0)
  }
  const blind = mutateTestWith(MUTATE_TEST_BLIND_NISH, false)
  t.ok(
    "a compiler that builds the unparseable canary does not read the copy: the tool's failure",
    blind.isErr() && blind.error.indexOf("so it does not read the copy") >= 0,
  )
  const emitted = mutateTestWith(MUTATE_TEST_NISH, true)
  t.ok(
    "without --test, a contract whose test cannot be emitted is refused, naming why",
    emitted.isOk() &&
      emitted.value.items.length === 0 &&
      emitted.value.problems.length > 0 &&
      emitted.value.problems[0].indexOf("the contract's test cannot be emitted: fidelity: R1: quote not found") === 0,
  )
  const empty = mutateTestWith(MUTATE_TEST_EMPTY_NISH, false)
  t.ok(
    "a baseline build without a binary is the tool's failure",
    empty.isErr() && empty.error.indexOf("the unmutated module's build exits 0 but writes no binary") >= 0,
  )
}

/** The diff that adds lines `from` to `to` of `x.ts`. */
const mutateTestChanged = (from: i32, to: i32): GitdiffFile => {
  const d = gitdiffParse(`diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -0,0 +${from},${to - from + 1} @@\n`)
  return d.isOk() && d.value.length === 1 ? d.value[0] : new GitdiffFile("x.ts")
}

/** Judging: allowed and unallowed survivors, stillborn lists, a failing baseline. */
const mutateTestJudge = (t: Suite): void => {
  const c = contractLoad(MUTATE_TEST_CONTRACT, "c.json")
  if (c.isErr()) {
    t.fail("the contract loads", c.error.join("; "))
    return
  }
  const allow = c.value.allowSurvivors ?? []
  const a = new MutateMutant(4, 1, "delete-statement", "", "")
  a.outcome = MUTATE_SURVIVED
  const b = new MutateMutant(3, 2, "int", "+1", "  k = 8")
  b.outcome = MUTATE_KILLED
  const r = new PrReport("mutate", "m")
  mutateJudge(r, "std/m.ts", [a, b], allow, null, 0)
  t.eqStr(
    "an unallowed survivor fails, and an allowance whose line was all killed is stale",
    r.problems.join(" | "),
    "survivor std/m.ts:4 (4:1:delete-statement): `` passes the test: behaviour no requirement pins down | allowSurvivors std/m.ts:3 is stale: the test killed every mutant of that line, so the allowance would only excuse whatever survives there next: remove it, or move it to the line it means",
  )
  const rd = new PrReport("mutate", "t")
  mutateJudge(rd, "std/m.ts", [b], [], null, 5)
  t.eqStr("--max reports what it left out", rd.notes.join(" | "), "5 of 6 mutants were not run: --max kept 1")
  t.eqStr(
    "an item per mutant",
    r.items.join(" | "),
    "survived std/m.ts:4:1 delete-statement:  | killed std/m.ts:3:2 int: k = 8",
  )
  const s = new MutateMutant(4, 1, "delete-statement", "", "")
  s.outcome = MUTATE_STILLBORN
  const r2 = new PrReport("mutate", "m")
  mutateJudge(r2, "std/m.ts", [s], allow, null, 0)
  t.eqStr(
    "all stillborn fails",
    r2.problems.join(" | "),
    "every mutant is stillborn or its build ran past its time: none built, so the test met none of them",
  )
  const bt = new MutateMutant(4, 1, "delete-statement", "", "")
  bt.outcome = MUTATE_BUILD_TIMED_OUT
  const k: MutateMutant[] = [bt]
  for (let i = 0; i < 9; i++) {
    const m = new MutateMutant(5, 1, "int", `${i}`, "")
    m.outcome = MUTATE_KILLED
    k.push(m)
  }
  const r6 = new PrReport("mutate", "m")
  mutateJudge(r6, "std/m.ts", k, [], null, 0)
  t.eqStr(
    "a build timeout within the share is noted",
    `${r6.problems.join(" | ")}||${r6.notes.join(" | ")}`,
    "||1 of 10 mutant builds ran past their time: they tested nothing",
  )
  const bt2 = new MutateMutant(6, 1, "delete-statement", "", "")
  bt2.outcome = MUTATE_BUILD_TIMED_OUT
  k.push(bt2)
  const r7 = new PrReport("mutate", "m")
  mutateJudge(r7, "std/m.ts", k, [], null, 0)
  t.eqStr(
    "build timeouts past the share refuse",
    r7.problems.join(" | "),
    "2 of 11 mutant builds ran past their time, more than 10%: a survivor may hide among them, so run with fewer --jobs",
  )
  const tk: MutateMutant[] = []
  const to = new MutateMutant(7, 1, "int", "x", "")
  to.outcome = MUTATE_TIMED_OUT
  tk.push(to)
  for (let i = 0; i < 9; i++) {
    const m = new MutateMutant(8, 1, "int", `${i}`, "")
    m.outcome = MUTATE_KILLED
    tk.push(m)
  }
  const onSeven = new AllowedSurvivor()
  onSeven.file = "std/m.ts"
  onSeven.line = 7
  onSeven.reason = "r"
  const r8 = new PrReport("mutate", "m")
  mutateJudge(r8, "std/m.ts", tk, [onSeven], null, 0)
  t.eqStr(
    "a test timeout within the share is noted, not killed",
    `${r8.problems.join(" | ")}||${r8.notes.join(" | ")}`,
    "||1 of 10 mutants ran their test past its time: counted neither killed nor survived | STALE? allowSurvivors std/m.ts:7 matched no survivor this run: no mutant of that line ran, so check it still names the line it means",
  )
  const to2 = new MutateMutant(9, 1, "int", "y", "")
  to2.outcome = MUTATE_TIMED_OUT
  tk.push(to2)
  const r9 = new PrReport("mutate", "m")
  mutateJudge(r9, "std/m.ts", tk, [], null, 0)
  t.eqStr(
    "test timeouts past the share refuse",
    r9.problems.join(" | "),
    "2 of 11 mutants ran their test past its time, more than 10%: a timeout is neither a kill nor a survival, so a survivor may hide among them: run with fewer --jobs",
  )
  const p = new MutateMutant(4, 1, "delete-statement", "", "")
  const r3 = new PrReport("mutate", "m")
  mutateJudge(r3, "std/m.ts", [p], allow, null, 0)
  t.eqStr("a mutant not run fails", r3.problems.join(" | "), "mutant 4:1:delete-statement was not run")
  const r4 = new PrReport("mutate", "m")
  mutateJudge(r4, "std/m.ts", [p], allow, "it exits 1", 0)
  t.eqStr(
    "a failing baseline fails alone",
    `${r4.problems.join(" | ")}|${r4.items.length}`,
    "the test fails on the unmutated module, so it proves nothing: it exits 1|0",
  )
  const r5 = new PrReport("mutate", "m")
  mutateJudge(r5, "std/m.ts", [], allow, null, 0)
  t.eqStr(
    "no mutants fails",
    r5.problems.join(" | "),
    "no mutants: the change adds no line of std/m.ts that can be mutated",
  )
}

/** The mutation operators, the sites, picking and applying, judging, and a run. */
export const main = (): i32 => {
  const t = new Suite("spec/pr mutate")
  t.eqStr(
    "relational and logical",
    mutateTestList(mutateLine("  if (a < b && c >= d) {", 7)),
    "7:9:relational=  if (a <= b && c >= d) { | 7:13:logical=  if (a < b || c >= d) { | 7:18:relational=  if (a < b && c > d) {",
  )
  t.eqStr("equality", mutateTestList(mutateLine("x === y", 1)), "1:3:relational=x !== y | 1:1:delete-statement=")
  t.eqStr("arrows and generics are not operators", mutateTestList(mutateLine("const f = (): Set<i32> => g", 1)), "")
  t.eqStr("drop a not", mutateTestList(mutateLine("  if (!ok) {", 1)), "1:7:drop-not=  if (ok) {")
  t.eqStr(
    "!= is not a not, but swaps to ==",
    mutateTestList(mutateLine("  if (a != b) {", 1)),
    "1:9:relational=  if (a == b) {",
  )
  t.eqStr(
    "arithmetic swaps",
    mutateTestList(mutateLine("x = a * b / c % d", 1)),
    "1:7:arithmetic=x = a / b / c % d | 1:11:arithmetic=x = a * b * c % d | 1:15:arithmetic=x = a * b / c * d | 1:1:delete-statement=",
  )
  t.eqStr(
    "bitwise swaps, shifts before relations",
    mutateTestList(mutateLine("y = a << 2 & b ^ c | d >> 1", 1)),
    "1:7:bitwise=y = a >> 2 & b ^ c | d >> 1 | 1:10:int:+1=y = a << 3 & b ^ c | d >> 1 | 1:10:int:-1=y = a << 1 & b ^ c | d >> 1 | 1:12:bitwise=y = a << 2 | b ^ c | d >> 1 | 1:16:bitwise=y = a << 2 & b & c | d >> 1 | 1:20:bitwise=y = a << 2 & b ^ c & d >> 1 | 1:24:bitwise=y = a << 2 & b ^ c | d << 1 | 1:27:int:+1=y = a << 2 & b ^ c | d >> 2 | 1:27:int:-1=y = a << 2 & b ^ c | d >> 0 | 1:1:delete-statement=",
  )
  t.eqStr("a union with null is a type, not an or", mutateTestList(mutateLine("  let p: P | null = q", 1)), "")
  t.eqStr(
    "an integer, both ways",
    mutateTestList(mutateLine("  return n + 10", 2)),
    "2:12:arithmetic=  return n - 10 | 2:14:int:+1=  return n + 11 | 2:14:int:-1=  return n + 9 | 2:3:return-null=  return null",
  )
  t.eqStr(
    "no ints inside names, hex or decimals",
    mutateTestList(mutateLine("const x2 = 0x1f + 1.5 + 3n", 1)),
    "1:17:arithmetic=const x2 = 0x1f - 1.5 + 3n | 1:23:arithmetic=const x2 = 0x1f + 1.5 - 3n",
  )
  t.eqStr(
    "strings are skipped",
    mutateTestList(mutateLine("  log(\"a < b\", `1 && 2`, '!x')", 1)),
    "1:3:delete-statement=",
  )
  t.eqStr("comments are skipped", mutateTestList(mutateLine("  x // a < b 3", 1)), "1:3:delete-statement=")
  t.eqStr("a comment line has none", mutateTestList(mutateLine("  // if (a < b)", 1)), "")
  t.eqStr("an import has none", mutateTestList(mutateLine('import { a } from "b"', 1)), "")
  t.eqStr("return null is left", mutateTestList(mutateLine("  return null", 1)), "")
  t.eqStr("an open statement is not deleted", mutateTestList(mutateLine("  foo(", 1)), "")
  t.eqStr("a closing brace has none", mutateTestList(mutateLine("  }", 1)), "")
  t.eqStr(
    "a declaration is not deleted",
    mutateTestList(mutateLine("  let i = 0", 1)),
    "1:11:int:+1=  let i = 1 | 1:11:int:-1=  let i = -1",
  )
  const text = "/**\n * a < b\n */\nconst a = 1\nconst b = 2\nconst c = 3\n"
  t.eqStr(
    "only changed lines, never a block comment",
    mutateTestList(mutateSites(text, mutateTestChanged(2, 5))),
    "4:11:int:+1=const a = 2 | 4:11:int:-1=const a = 0 | 5:11:int:+1=const b = 3 | 5:11:int:-1=const b = 1",
  )
  const all: MutateMutant[] = []
  for (let i = 1; i <= 10; i++) {
    all.push(new MutateMutant(toI32(i), 1, "x", "", ""))
  }
  const picked: string[] = []
  for (const m of mutatePick(all, 4)) {
    picked.push(`${m.line}`)
  }
  t.eqStr("picking spreads", picked.join(","), "1,3,6,8")
  t.ok("picking 0 keeps all", mutatePick(all, 0).length === 10)
  t.ok("picking more than there are keeps all", mutatePick(all, 20).length === 10)
  t.eqStr("applying replaces one line", mutateApply("a\nb\nc\n", new MutateMutant(2, 1, "x", "", "B")), "a\nB\nc\n")
  t.eqStr("applying keeps a missing final newline", mutateApply("a\nb", new MutateMutant(2, 1, "x", "", "")), "a\n")
  t.eqStr(
    "outcome names",
    `${mutateOutcomeName(MUTATE_TIMED_OUT)},${mutateOutcomeName(MUTATE_BUILD_TIMED_OUT)},${mutateOutcomeName(MUTATE_PENDING)}`,
    "timed out,build timed out,not run",
  )
  const empty: MutateMutant[] = []
  const nothing = mutateRunAll(new MutateRun("/nonexistent", "m.ts", "bin/nish", "/t", 1, 1), "", empty)
  t.ok("running no mutants does nothing", nothing.isOk() && nothing.value === null)
  mutateTestJudge(t)
  mutateTestOddBuilds(t)
  const r = mutateTestRepo(t)
  if (r.isErr()) {
    t.fail("the repository is built", r.error)
  }
  return t.done()
}
