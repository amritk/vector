import { Suite } from "nish/testing"
import { runProcess } from "../../../src/core/process"
import { contractLoad } from "../../../src/spec/contract/contract"
import { GitdiffFile, gitdiffParse } from "../../../src/spec/pr/gitdiff"
import {
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
if grep -q 'return null' "$root/std/m.ts"; then
  echo "refused" >&2
  exit 1
fi
printf '#!/bin/sh\\ncd "%s" && exec sh "%s"\\n' "$root" "$1" > "$3"
chmod +x "$3"
`

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
grep -q '=> 6' std/m.ts && sleep 5
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
  const run = new MutateRun(root, "", "bin/nish", `${dir}/t.sh`, 3, 1000)
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
    t.eqStr("an allowed survivor passes", r.value.problems.join(" | "), "")
    t.eqStr(
      "the notes",
      r.value.notes.join(" | "),
      "survivor std/m.ts:3 (3:29:int:+1) is allowed: k is a constant the spec leaves open | allowSurvivors std/m.ts:9 matched no survivor this run",
    )
  }
  const one = mutateCheck(`${dir}/c.json`, "main", new MutateRun(root, "", "bin/nish", `${dir}/t.sh`, 1, 0), 2)
  t.eqStr(
    "one job, two mutants, a derived time limit",
    one.isOk() ? one.value.items.join(" | ") : "<err>",
    "killed std/m.ts:2:50 relational: export const lt = (a: i32, b: i32): boolean => a <= b | survived std/m.ts:3:29 int: export const k = (): i32 => 6",
  )
  prTestWrite(dir, "fail.sh", "exit 3\n").orReturn()
  const failing = mutateCheck(
    `${dir}/c.json`,
    "main",
    new MutateRun(root, "", "bin/nish", `${dir}/fail.sh`, 2, 1000),
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
  const elsewhere = mutateCheck(`${dir}/c.json`, "main", new MutateRun(dir, "", "bin/nish", `${dir}/t.sh`, 1, 1000), 0)
  t.ok(
    "a root without the module says so",
    elsewhere.isOk() &&
      elsewhere.value.problems.length === 1 &&
      elsewhere.value.problems[0].indexOf("cannot be read") >= 0,
  )
  prTestRemove(dir)
  return Ok(true)
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
  mutateJudge(r, "std/m.ts", [a, b], allow, null)
  t.eqStr(
    "an unallowed survivor fails",
    r.problems.join(" | "),
    "survivor std/m.ts:4 (4:1:delete-statement): `` passes the test: behaviour no requirement pins down",
  )
  t.eqStr(
    "an item per mutant",
    r.items.join(" | "),
    "survived std/m.ts:4:1 delete-statement:  | killed std/m.ts:3:2 int: k = 8",
  )
  const s = new MutateMutant(4, 1, "delete-statement", "", "")
  s.outcome = MUTATE_STILLBORN
  const r2 = new PrReport("mutate", "m")
  mutateJudge(r2, "std/m.ts", [s], allow, null)
  t.eqStr(
    "all stillborn fails",
    r2.problems.join(" | "),
    "every mutant is stillborn: none builds, so the test met none of them",
  )
  const p = new MutateMutant(4, 1, "delete-statement", "", "")
  const r3 = new PrReport("mutate", "m")
  mutateJudge(r3, "std/m.ts", [p], allow, null)
  t.eqStr("a mutant not run fails", r3.problems.join(" | "), "mutant 4:1:delete-statement was not run")
  const r4 = new PrReport("mutate", "m")
  mutateJudge(r4, "std/m.ts", [p], allow, "it exits 1")
  t.eqStr(
    "a failing baseline fails alone",
    `${r4.problems.join(" | ")}|${r4.items.length}`,
    "the test fails on the unmutated module, so it proves nothing: it exits 1|0",
  )
  const r5 = new PrReport("mutate", "m")
  mutateJudge(r5, "std/m.ts", [], allow, null)
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
  t.eqStr("!= is not a not", mutateTestList(mutateLine("  if (a != b) {", 1)), "")
  t.eqStr(
    "an integer, both ways",
    mutateTestList(mutateLine("  return n + 10", 2)),
    "2:14:int:+1=  return n + 11 | 2:14:int:-1=  return n + 9 | 2:3:return-null=  return null",
  )
  t.eqStr("no ints inside names, hex or decimals", mutateTestList(mutateLine("const x2 = 0x1f + 1.5 + 3n", 1)), "")
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
    `${mutateOutcomeName(MUTATE_TIMED_OUT)},${mutateOutcomeName(MUTATE_PENDING)}`,
    "timed out,not run",
  )
  const empty: MutateMutant[] = []
  const nothing = mutateRunAll(new MutateRun("/nonexistent", "m.ts", "bin/nish", "/t", 1, 1), "", empty)
  t.ok("running no mutants does nothing", nothing.isOk() && nothing.value === null)
  mutateTestJudge(t)
  const r = mutateTestRepo(t)
  if (r.isErr()) {
    t.fail("the repository is built", r.error)
  }
  return t.done()
}
