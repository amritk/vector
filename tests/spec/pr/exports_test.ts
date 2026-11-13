import { Suite } from "nish/testing"
import { contractLoad } from "../../../src/spec/contract/contract"
import { ExportsChange, exportsCheck, exportsDiff, exportsJudge, exportsTested } from "../../../src/spec/pr/exports"
import { PrReport } from "../../../src/spec/pr/report"
import { prTestCommit, prTestGit, prTestRemove, prTestRepo, prTestWrite } from "./repo"

/** A contract on nish/hex testing `enc`, and `dec` in another module, leaving `aux` out of scope. */
const EXPORTS_TEST_CONTRACT: string = `{
  "contract": "c1",
  "source": {"title": "T", "rfc": 4648},
  "target": {"module": "nish/hex"},
  "requirements": [{"id": "R1", "section": "3.1", "level": "MUST", "quote": "Q"}],
  "functions": [
    {"name": "enc", "params": [{"name": "b", "type": "bytes"}], "returns": "string"},
    {"name": "dec", "module": "nish/other", "params": [{"name": "b", "type": "bytes"}], "returns": "string"}
  ],
  "outOfScope": [{"name": "aux", "reason": "a helper the spec does not describe"}],
  "clauses": [
    {"kind": "vector", "id": "V1", "title": "t", "covers": ["R1"],
     "source": {"cite": {"section": "10"}}, "call": "enc", "args": [{"hex": "00"}], "expect": {"str": "00"}}
  ]
}
`

/** The module at the base. */
const EXPORTS_TEST_BEFORE: string = `/** Encodes. */
export const enc = (b: string): string => {
  return b
}

export const dec = (b: string): string => b

export const aux = (): i32 => 1

export const gone = (): i32 => 2
`

/** The changes, as "kind name" joined by ", ". */
const exportsTestChanges = (changes: ExportsChange[]): string =>
  changes.map((c: ExportsChange): string => `${c.kind} ${c.name}`).join(", ")

/** A report's problems and notes as text. */
const exportsTestReport = (r: PrReport): string => `${r.problems.join(" | ")} || ${r.notes.join(" | ")}`

/** A nish checkout whose std/hex.ts changes in each way the gate judges. */
const exportsTestRepo = (t: Suite, dir: string): Result<boolean, string> => {
  prTestWrite(dir, "nish/std/hex.ts", EXPORTS_TEST_BEFORE).orReturn()
  prTestWrite(dir, "c.json", EXPORTS_TEST_CONTRACT).orReturn()
  prTestCommit(dir, "base").orReturn()
  prTestGit(dir, ["checkout", "-q", "-b", "work"]).orReturn()
  const root = `${dir}/nish`
  const contract = `${dir}/c.json`

  const same = exportsCheck(contract, root, "main")
  t.ok("no change passes", same.isOk() && same.value.problems.length === 0 && same.value.items.length === 0)
  t.eqStr("its title", same.isOk() ? same.value.title : "", "spec exports of std/hex.ts against main")

  prTestWrite(
    dir,
    "nish/std/hex.ts",
    "/** Encodes. */\nexport const enc = (b: string): string => {\n  return b + b\n}\n\nexport const aux = (): i32 => 3\n\nexport const fresh = (): i32 => 4\n",
  ).orReturn()
  const changed = exportsCheck(contract, root, "main")
  t.eqStr(
    "added, changed and deleted",
    changed.isOk() ? exportsTestReport(changed.value) : changed.error,
    "export fresh is added, but the contract neither tests it nor lists it in outOfScope with a reason || export aux is changed, out of scope: a helper the spec does not describe | export dec is deleted; the contract does not test it | export gone is deleted; the contract does not test it",
  )
  t.eqStr(
    "its items",
    changed.isOk() ? changed.value.items.join(", ") : "",
    "changed enc (tested), changed aux, added fresh, deleted dec, deleted gone",
  )

  prTestWrite(dir, "nish/std/hex.ts", "export const other = (): i32 => 1\n").orReturn()
  const deleted = exportsCheck(contract, root, "main")
  t.ok(
    "deleting a tested export fails",
    deleted.isOk() &&
      deleted.value.problems.indexOf(
        "export enc is deleted, but the contract tests it: its test can no longer build",
      ) >= 0,
  )

  const sub = exportsCheck(contract, `${root}/`, "main")
  t.ok(
    "a root with a trailing slash reads the same",
    sub.isOk() && deleted.isOk() && sub.value.problems.join("|") === deleted.value.problems.join("|"),
  )
  t.ok("an unknown base is an error", exportsCheck(contract, root, "nope").isErr())
  t.ok("a refused base is an error", exportsCheck(contract, root, "a..b").isErr())
  t.ok("a missing contract is an error", exportsCheck(`${dir}/none.json`, root, "main").isErr())
  const missing = exportsCheck(contract, dir, "main")
  t.contains(
    "a root without the module",
    missing.isOk() ? exportsTestReport(missing.value) : missing.error,
    "std/hex.ts exists neither at the fork point nor now",
  )
  return Ok(true)
}

/** The PR gate that keeps a module's new surface tested or explicitly out of scope. */
export const main = (): i32 => {
  const t = new Suite("spec/pr exports")
  t.eqStr("no change", exportsTestChanges(exportsDiff(EXPORTS_TEST_BEFORE, EXPORTS_TEST_BEFORE)), "")
  t.eqStr(
    "a new module adds every export",
    exportsTestChanges(exportsDiff("", "export const a = 1\nexport class B {\n}\n")),
    "added a, added B",
  )
  t.eqStr(
    "a gone module deletes every export",
    exportsTestChanges(exportsDiff("export type T = i32\n", "")),
    "deleted T",
  )
  t.eqStr(
    "a changed doc comment above is not a change",
    exportsTestChanges(exportsDiff("/** a */\nexport const a = 1\n", "/** b */\nexport const a = 1\n")),
    "",
  )
  const c = contractLoad(EXPORTS_TEST_CONTRACT, "c")
  if (c.isErr()) {
    t.fail("the contract loads", c.error.join("\n"))
    return t.done()
  }
  t.eqStr("tested names", exportsTested(c.value).join(","), "enc")
  const r = new PrReport("exports", "t")
  exportsJudge(r, c.value, [new ExportsChange("enc", "added"), new ExportsChange("x", "changed")])
  t.eqStr(
    "judging",
    exportsTestReport(r),
    "export x is changed, but the contract neither tests it nor lists it in outOfScope with a reason || ",
  )

  const dir = prTestRepo("vector-exports-")
  if (dir.isErr()) {
    t.fail("a repository", dir.error)
    return t.done()
  }
  const ran = exportsTestRepo(t, dir.value)
  if (ran.isErr()) {
    t.fail("the repository steps", ran.error)
  }
  prTestRemove(dir.value)
  return t.done()
}
