import { Suite } from "nish/testing"
import { vectorRun } from "../../../src/index"
import { contractLoad } from "../../../src/spec/contract/contract"
import { ExportsChange, exportsCheckAll, exportsJudgeAll } from "../../../src/spec/pr/exports"
import { PrReport } from "../../../src/spec/pr/report"
import { prTestCommit, prTestGit, prTestRemove, prTestRepo, prTestWrite } from "./repo"

/** A contract named `id` on nish/`module`, testing `tested` and leaving `out` out of scope. */
const exportsallContract = (id: string, module: string, tested: string[], out: string[]): string => {
  const fns: string[] = []
  for (const f of tested) {
    fns.push(`{"name": "${f}", "params": [], "returns": "i32"}`)
  }
  const scope: string[] = []
  for (const o of out) {
    scope.push(`{"name": "${o}", "reason": "the other spec's"}`)
  }
  return `{
  "contract": "${id}",
  "source": {"title": "T", "rfc": 4648},
  "target": {"module": "nish/${module}"},
  "requirements": [{"id": "R1", "section": "3.1", "level": "MUST", "quote": "Q"}],
  "functions": [${fns.join(", ")}],
  "outOfScope": [${scope.join(", ")}],
  "clauses": [
    {"kind": "vector", "id": "V1", "title": "t", "covers": ["R1"],
     "source": {"cite": {"section": "10"}}, "call": "${tested[0]}", "args": [], "expect": {"int": 1}}
  ]
}
`
}

/** One row: the contracts given, in order, and what the gate must do. */
class ExportsallRow {
  /** What the row checks. */
  name: string
  /** The contract files given, from the repository's top. */
  contracts: string[]
  /** The exit status of `vector spec exports`. */
  code: i32
  /** Text the report's problems must hold, or "" for none. */
  problem: string

  /**
   * Makes a row.
   *
   * @param name what it checks
   * @param contracts the contracts given
   * @param code the exit status
   * @param problem text a problem must hold, or "" when there must be none
   */
  constructor(name: string, contracts: string[], code: i32, problem: string) {
    this.name = name
    this.contracts = contracts
    this.code = code
    this.problem = problem
  }
}

/**
 * A nish checkout where std/h.ts gains f1 (which a.json tests), f2 (which
 * b.json tests) and f3 (which b.json leaves out of scope), and std/g.ts
 * gains g1 (which c.json tests) and g2 (which nothing covers).
 */
const exportsallRepo = (dir: string): Result<boolean, string> => {
  prTestWrite(dir, "nish/std/h.ts", "export const f0 = (): i32 => 0\n").orReturn()
  prTestWrite(dir, "nish/std/g.ts", "export const g0 = (): i32 => 0\n").orReturn()
  prTestWrite(dir, "a.json", exportsallContract("a", "h", ["f1"], [])).orReturn()
  prTestWrite(dir, "b.json", exportsallContract("b", "h", ["f2"], ["f3"])).orReturn()
  prTestWrite(dir, "c.json", exportsallContract("c", "g", ["g1"], [])).orReturn()
  prTestCommit(dir, "base").orReturn()
  prTestGit(dir, ["checkout", "-q", "-b", "work"]).orReturn()
  prTestWrite(
    dir,
    "nish/std/h.ts",
    "export const f0 = (): i32 => 0\nexport const f1 = (): i32 => 1\nexport const f2 = (): i32 => 2\nexport const f3 = (): i32 => 3\n",
  ).orReturn()
  prTestWrite(
    dir,
    "nish/std/g.ts",
    "export const g0 = (): i32 => 0\nexport const g1 = (): i32 => 1\nexport const g2 = (): i32 => 2\n",
  ).orReturn()
  return prTestCommit(dir, "work")
}

/** The rows, over the repository exportsallRepo makes in `dir`. */
const exportsallRows = (dir: string): ExportsallRow[] => [
  new ExportsallRow(
    "a.json alone leaves f2 and f3 uncovered",
    [`${dir}/a.json`],
    1,
    "export f2 is added, but the contract",
  ),
  new ExportsallRow("b.json alone leaves f1 uncovered", [`${dir}/b.json`], 1, "export f1 is added, but the contract"),
  new ExportsallRow("a.json and b.json together cover std/h.ts", [`${dir}/a.json`, `${dir}/b.json`], 0, ""),
  new ExportsallRow("in either order", [`${dir}/b.json`, `${dir}/a.json`], 0, ""),
  new ExportsallRow(
    "a second module is judged on its own contracts, each line naming its file",
    [`${dir}/a.json`, `${dir}/c.json`, `${dir}/b.json`],
    1,
    "std/g.ts: export g2 is added, but the contract neither tests it",
  ),
]

/** exportsJudgeAll on a deleted export: refused when either contract tests it, noted when neither does. */
const exportsallDeleted = (t: Suite): void => {
  const a = contractLoad(exportsallContract("a", "h", ["f1"], []), "a")
  const b = contractLoad(exportsallContract("b", "h", ["f2"], ["f3"]), "b")
  if (a.isErr() || b.isErr()) {
    t.fail("the contracts load", "")
    return
  }
  const r = new PrReport("exports", "t")
  const gone = [new ExportsChange("f2", "deleted", ""), new ExportsChange("f3", "deleted", "")]
  exportsJudgeAll(r, [a.value, b.value], gone, "")
  t.eqStr(
    "a deleted export the second contract tests is refused",
    r.problems.join(" | "),
    "export f2 is deleted, but a contract tests it: its test can no longer build",
  )
  t.eqStr(
    "and one only listed out of scope is a note",
    r.notes.join(" | "),
    "export f3 is deleted; no contract tests it, so its outOfScope entry can go",
  )
}

/** `spec exports` given several contracts judges each module once, on all that target it. */
export const main = (): i32 => {
  const t = new Suite("spec/pr exports, several contracts")
  const made = prTestRepo("vector-exportsall-")
  if (made.isErr()) {
    t.fail("a repository", made.error)
    return t.done()
  }
  const dir = made.value
  const built = exportsallRepo(dir)
  if (built.isErr()) {
    t.fail("the repository's commits", built.error)
    prTestRemove(dir)
    return t.done()
  }
  const root = `${dir}/nish`
  for (const row of exportsallRows(dir)) {
    const argv: string[] = ["spec", "exports", "--nish-root", root, "--base", "main"]
    for (const c of row.contracts) {
      argv.push(c)
    }
    t.eqStr(`${row.name}: exit`, `${vectorRun(argv)}`, `${row.code}`)
    const r = exportsCheckAll(row.contracts, root, "main")
    t.ok(`${row.name}: a report`, r.isOk())
    if (r.isOk()) {
      const problems = r.value.problems.join(" | ")
      if (row.problem.length === 0) {
        t.eqStr(`${row.name}: no problem`, problems, "")
      } else {
        t.contains(`${row.name}: the problem`, problems, row.problem)
      }
    }
  }
  const both = exportsCheckAll([`${dir}/a.json`, `${dir}/c.json`], root, "main")
  t.eqStr(
    "the title names every module, in the order first given",
    both.isOk() ? both.value.title : "",
    "spec exports of std/h.ts, std/g.ts against main",
  )
  t.ok("no contract is an error", exportsCheckAll([], root, "main").isErr())
  t.ok(
    "an unreadable one among them is an error",
    exportsCheckAll([`${dir}/a.json`, `${dir}/none.json`], root, "main").isErr(),
  )
  exportsallDeleted(t)
  prTestRemove(dir)
  return t.done()
}
