import { Suite } from "nish/testing"
import {
  gitdiffBaseProblem,
  gitdiffChanged,
  gitdiffExportName,
  gitdiffExports,
  gitdiffForkPoint,
  gitdiffGit,
  gitdiffHunk,
  gitdiffParse,
  gitdiffShow,
  gitdiffTop,
  gitdiffTouches,
} from "../../../src/spec/pr/gitdiff"
import { prTestCommit, prTestGit, prTestRemove, prTestRepo, prTestWrite } from "./repo"

/** The ranges of a file, as text. */
const gitdiffTestRanges = (r: i32[]): string => {
  const out: string[] = []
  for (const n of r) {
    out.push(`${n}`)
  }
  return out.join(",")
}

/** Builds a repo with a branch and checks what gitdiffChanged reads from it. */
const gitdiffTestRepo = (t: Suite): Result<boolean, string> => {
  const dir = prTestRepo("vector-gitdiff-").orReturn()
  prTestWrite(dir, "a.ts", "one\ntwo\nthree\n").orReturn()
  prTestWrite(dir, "gone.ts", "x\n").orReturn()
  prTestCommit(dir, "base").orReturn()
  prTestGit(dir, ["checkout", "-q", "-b", "work"]).orReturn()
  prTestWrite(dir, "a.ts", "one\nTWO\nthree\nfour\n").orReturn()
  prTestGit(dir, ["rm", "-q", "gone.ts"]).orReturn()
  prTestWrite(dir, "dir name/new.ts", "n1\nn2\n").orReturn()
  prTestCommit(dir, "change").orReturn()
  prTestWrite(dir, "loose.ts", "l\n").orReturn()
  const top = gitdiffTop(dir)
  t.ok("the top is found", top.isOk())
  const fork = gitdiffForkPoint(dir, "main")
  t.ok("the fork point is found", fork.isOk())
  t.ok("an unknown base fails", gitdiffForkPoint(dir, "nope").isErr())
  const files = gitdiffChanged(dir, "main", [])
  t.ok("the change is read", files.isOk())
  if (files.isOk()) {
    const seen: string[] = []
    for (const f of files.value) {
      seen.push(`${f.path}|${f.added}|${f.deleted}|${gitdiffTestRanges(f.ranges)}`)
    }
    t.eqStr(
      "every file the change touches",
      seen.join(" "),
      "a.ts|false|false|2,2,4,4 dir name/new.ts|true|false|1,2 gone.ts|false|true| loose.ts|true|false|1,1",
    )
  }
  const only = gitdiffChanged(dir, "main", ["a.ts"])
  t.ok("paths narrow it", only.isOk() && only.value.length === 1)
  if (fork.isOk()) {
    const old = gitdiffShow(dir, fork.value, "a.ts")
    const oldText: string | null = old.isOk() ? old.value : null
    t.eqStr("a file at the fork point", oldText ?? "<none>", "one\ntwo\nthree\n")
    const none = gitdiffShow(dir, fork.value, "dir name/new.ts")
    t.ok("a file the fork point lacks", none.isOk() && none.value === null)
  }
  t.ok("git failing is an error", gitdiffGit(dir, ["no-such-command"]).isErr())
  prTestRemove(dir)
  return Ok(true)
}

/** git's diff, read: files, changed lines, refused bases, and exports. */
export const main = (): i32 => {
  const t = new Suite("spec/pr gitdiff")
  t.ok("a branch is a base", gitdiffBaseProblem("origin/main") === null)
  t.ok("an option is refused", gitdiffBaseProblem("--output=x") !== null)
  t.ok("a range is refused", gitdiffBaseProblem("a..b") !== null)
  t.ok("empty is refused", gitdiffBaseProblem("") !== null)
  t.ok("a space is refused", gitdiffBaseProblem("a b") !== null)
  const h = gitdiffHunk("@@ -3,0 +4,2 @@ ctx")
  t.ok("a hunk header", h !== null && h[0] === 4 && h[1] === 2)
  const h1 = gitdiffHunk("@@ -3 +4 @@")
  t.ok("a hunk of one line", h1 !== null && h1[0] === 4 && h1[1] === 1)
  t.ok("not a hunk header", gitdiffHunk("+@@ x") === null)
  const p = gitdiffParse("diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1,3 @@\n-a\n+b\n@@ -9 +11,0 @@\n-c\n")
  t.ok("a diff is read", p.isOk() && p.value.length === 1)
  if (p.isOk()) {
    t.eqStr("only added lines count", gitdiffTestRanges(p.value[0].ranges), "1,3")
    t.ok("a changed line is touched", gitdiffTouches(p.value[0], 2))
    t.ok("a line outside is not", !gitdiffTouches(p.value[0], 4))
  }
  t.ok("a quoted path is refused", gitdiffParse('diff --git a/x b/x\n--- "a/\\tx"\n+++ b/x\n').isErr())
  t.eqStr("export const", gitdiffExportName("export const fooBar = (): i32 => 1"), "fooBar")
  t.eqStr("export async function", gitdiffExportName("export async function go() {"), "go")
  t.eqStr("export class", gitdiffExportName("export class Box {"), "Box")
  t.eqStr("a re-export names none", gitdiffExportName("export { a } from './a'"), "")
  t.eqStr("not an export", gitdiffExportName("const x = 1"), "")
  const ex = gitdiffExports(
    "import x\n\n/** a */\nexport const a = (): i32 => {\n  return 1\n}\n\n/** b */\nexport const b = 2\nconst c = 3\n",
  )
  t.eqStr("exports, in order", `${ex.length}:${ex.length === 2 ? `${ex[0].name},${ex[1].name}` : ""}`, "2:a,b")
  if (ex.length === 2) {
    t.eqStr("a body runs to its closing brace", ex[0].body, "export const a = (): i32 => {\n  return 1\n}")
    t.ok("a line is recorded", ex[0].line === 4 && ex[1].line === 9)
  }
  const r = gitdiffTestRepo(t)
  if (r.isErr()) {
    t.fail("the repository is built", r.error)
  }
  return t.done()
}
