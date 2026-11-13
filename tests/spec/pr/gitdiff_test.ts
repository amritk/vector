import { Suite } from "nish/testing"
import { runProcess } from "../../../src/core/process"
import {
  GitdiffExport,
  gitdiffBaseProblem,
  gitdiffChanged,
  gitdiffChangedPaths,
  gitdiffCompare,
  gitdiffExportName,
  gitdiffExports,
  gitdiffForkPoint,
  gitdiffGit,
  gitdiffHunk,
  gitdiffParse,
  gitdiffPrefix,
  gitdiffShow,
  gitdiffTop,
  gitdiffTouches,
} from "../../../src/spec/pr/gitdiff"
import { prTestCommit, prTestGit, prTestRemove, prTestRepo, prTestWrite } from "./repo"

/** What gitdiffExportName gives: the name, or "ERR" when it refuses. */
const gitdiffTestName = (line: string): string => {
  const r = gitdiffExportName(line)
  return r.isOk() ? r.value : "ERR"
}

/** Each export as `name:line:body`, or `:line:problem` when unnamed, joined by "|". */
const gitdiffTestList = (list: GitdiffExport[]): string =>
  list
    .map((e: GitdiffExport): string =>
      e.name.length > 0 ? `${e.name}:${e.line}:${e.body}` : `:${e.line}:${e.problem}`,
    )
    .join("|")

/**
 * Each export's name, or for an unnamed one why: MANY (more than one name),
 * SPLIT (cannot split into names), READ (cannot read the module) or NAME,
 * joined by ",".
 */
const gitdiffTestNames = (text: string): string => {
  const out: string[] = []
  for (const e of gitdiffExports(text)) {
    if (e.name.length > 0) {
      out.push(e.name)
    } else if (e.problem.indexOf("more than one name") >= 0 && e.problem.indexOf("cannot split") < 0) {
      out.push("MANY")
    } else if (e.problem.indexOf("cannot split") >= 0) {
      out.push("SPLIT")
    } else if (e.problem.indexOf("a module it cannot read") >= 0) {
      out.push("READ")
    } else {
      out.push("NAME")
    }
  }
  return out.join(",")
}

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
  const paths = gitdiffChangedPaths(dir, "main")
  t.eqStr(
    "every path the change touches, untracked too, sorted",
    paths.isOk() ? paths.value.join(",") : "<err>",
    "a.ts,dir name/new.ts,gone.ts,loose.ts",
  )
  t.ok("a refused base is an error", gitdiffChangedPaths(dir, "-x").isErr())
  const only = gitdiffChanged(dir, "main", ["a.ts"])
  t.ok("paths narrow it", only.isOk() && only.value.length === 1)
  const glob = gitdiffChanged(dir, "main", ["*.ts"])
  t.ok("a path is literal, not a pattern", glob.isOk() && glob.value.length === 0)
  if (fork.isOk()) {
    const old = gitdiffShow(dir, fork.value, "a.ts")
    const oldText: string | null = old.isOk() ? old.value : null
    t.eqStr("a file at the fork point", oldText ?? "<none>", "one\ntwo\nthree\n")
    const none = gitdiffShow(dir, fork.value, "dir name/new.ts")
    t.ok("a file the fork point lacks", none.isOk() && none.value === null)
  }
  t.ok("git failing is an error", gitdiffGit(dir, ["no-such-command"]).isErr())
  const atTop = gitdiffPrefix(dir)
  t.eqStr("the top's prefix is empty", atTop.isOk() ? atTop.value : "<err>", "")
  const below = gitdiffPrefix(`${dir}/dir name`)
  t.eqStr("a directory's prefix ends in a slash", below.isOk() ? below.value : "<err>", "dir name/")
  prTestRemove(dir)
  return gitdiffTestForeign(t)
}

/**
 * A repository someone else owns is still read: the caller named it, so
 * gitdiffGit trusts it (safe.directory). Only root can give it away; any
 * other runner checks the repository it owns.
 */
const gitdiffTestForeign = (t: Suite): Result<boolean, string> => {
  const dir = prTestRepo("vector-gitdiff-foreign-").orReturn()
  prTestWrite(dir, "a/b.ts", "x\n").orReturn()
  prTestCommit(dir, "base").orReturn()
  const id = runProcess(["id", "-u"], "", 10000).orReturn()
  const root = id.stdout === "0\n"
  if (root) {
    const chown = runProcess(["chown", "-R", "65534:65534", "--", dir], "", 10000).orReturn()
    t.ok("the repository is given away", chown.status === 0)
    t.ok("plain git refuses it", prTestGit(dir, ["status"]).isErr())
  }
  t.ok("its top is found", gitdiffTop(dir).isOk())
  t.ok("from a directory below it too", gitdiffTop(`${dir}/a`).isOk())
  const paths = gitdiffChangedPaths(dir, "main")
  t.ok("and its change is read", paths.isOk() && paths.value.length === 0)
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
  t.ok("bytes order", gitdiffCompare("B", "a") < 0 && gitdiffCompare("ab", "a") > 0 && gitdiffCompare("x", "x") === 0)
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
  const bin = gitdiffParse("diff --git a/x.bin b/x.bin\nindex 1..2 100644\nBinary files a/x.bin and b/x.bin differ\n")
  t.ok("a binary change is refused", bin.isErr() && bin.error.indexOf("binary file") >= 0)
  const mode = gitdiffParse("diff --git a/x b/x\nold mode 100644\nnew mode 100755\n")
  t.ok("a mode-only change touches no line", mode.isOk() && mode.value.length === 0)
  const crlf = gitdiffParse("diff --git a/x b/x\r\n--- a/x\r\n+++ b/x\r\n@@ -1 +1,2 @@\r\n-a\r\n+b\r\n+c\r\n")
  t.eqStr(
    "a CRLF diff reads the same",
    crlf.isOk() && crlf.value.length === 1 ? `${crlf.value[0].path}:${gitdiffTestRanges(crlf.value[0].ranges)}` : "ERR",
    "x:1,2",
  )
  t.ok("a quoted path is refused", gitdiffParse('diff --git a/x b/x\n--- "a/\\tx"\n+++ b/x\n').isErr())
  t.eqStr("export const", gitdiffTestName("export const fooBar = (): i32 => 1"), "fooBar")
  t.eqStr("export async function", gitdiffTestName("export async function go() {}"), "go")
  t.eqStr("export class", gitdiffTestName("export class Box {}"), "Box")
  t.eqStr("export function *g", gitdiffTestName("export function *gen() {}"), "gen")
  t.eqStr("export function * g", gitdiffTestName("export function * gen() {}"), "gen")
  t.eqStr("export namespace", gitdiffTestName("export namespace Space {}"), "Space")
  t.eqStr("export const enum", gitdiffTestName("export const enum E {}"), "E")
  t.eqStr("export default", gitdiffTestName("export default class Box {}"), "default")
  t.eqStr("a const named module", gitdiffTestName("export const module = 1"), "module")
  t.eqStr("a braced list is not one name", gitdiffTestName("export { a } from './a'"), "ERR")
  t.eqStr("export * is refused", gitdiffTestName("export * from './a'"), "ERR")
  t.eqStr("export import is refused", gitdiffTestName("export import X = Y.Z"), "ERR")
  t.eqStr("export = is refused", gitdiffTestName("export = x"), "ERR")
  t.eqStr("not an export", gitdiffTestName("const x = 1"), "")
  t.eqStr("a name that starts with export is not one", gitdiffTestName("exported(1)"), "")
  t.eqStr(
    "a local list resolves each name",
    gitdiffTestList(gitdiffExports("const a = 1\nfunction b() {\n}\nexport { a, b as c }\n")),
    "a:4:a\nconst a = 1|c:4:b as c\nfunction b() {\n}",
  )
  t.eqStr(
    "a multi-line list resolves each name",
    gitdiffTestList(gitdiffExports("const a = 1\nexport {\n  a,\n}\n")),
    "a:2:a\nconst a = 1",
  )
  t.eqStr(
    "a re-export from another module is refused",
    gitdiffTestList(gitdiffExports("export { a } from './a'\n")),
    ":1:a re-export from another module it cannot resolve: export { a } from './a'",
  )
  t.eqStr(
    "a list naming a missing declaration is refused",
    gitdiffTestList(gitdiffExports("export { nope }\n")),
    ":1:an export it cannot resolve to a declaration in this module (an imported name is not followed): nope",
  )
  t.eqStr(
    "export * is kept as unnamed",
    gitdiffTestList(gitdiffExports("export * from './a'\n")),
    ":1:an export it cannot name: export * from './a'",
  )
  t.eqStr(
    "an export declaring two names is refused",
    gitdiffTestList(gitdiffExports("export const fresh = 1, hidden = 2\n")),
    ":1:an export declaring more than one name: export const fresh = 1, hidden = 2: give each name its own export",
  )
  t.eqStr(
    "a second declarator on a later line is refused",
    gitdiffTestList(gitdiffExports("export let a: i32 = 1,\n  b = 2\n")),
    ":1:an export declaring more than one name: export let a: i32 = 1,: give each name its own export",
  )
  t.eqStr("a destructuring export is refused", gitdiffTestName("export const { a, b } = o"), "ERR")
  t.eqStr(
    "commas inside a value, a type or a string are one name",
    gitdiffExports(
      'export const m: Map<string, i32> = new Map<string, i32>()\nexport const g = f(a, b)\nexport const h: (a: i32, b: i32) => i32 = add\nexport const s = "x, y" // a, b\nexport const c = a > b ? [1, 2] : { p: 1, q: 2 }\nexport const id = <T, U>(x: T, y: U): T => x\n',
    )
      .map((e: GitdiffExport): string => (e.name.length > 0 ? e.name : e.problem))
      .join(","),
    "m,g,h,s,c,id",
  )
  t.eqStr(
    "overloads join into one export",
    gitdiffTestList(gitdiffExports("export function f(a: i32): i32\nexport function f(a: string): i32\n")),
    "f:1:export function f(a: i32): i32\nexport function f(a: string): i32",
  )
  t.eqStr("a less-than then a comma is a second name", gitdiffTestNames("export const a = i<3, b = 2\n"), "MANY")
  t.eqStr("a member less-than then a comma", gitdiffTestNames("export const a = x.length<2, y = 1\n"), "MANY")
  t.eqStr("a shift then a comma", gitdiffTestNames("export const a = 1<<2, y = 3\n"), "MANY")
  t.eqStr("a comma at column 0 goes on", gitdiffTestNames("export const a = 1\n,b = 2\n"), "MANY")
  t.eqStr("a value at column 0 goes on", gitdiffTestNames("export const a =\n1, b = 2\n"), "MANY")
  t.eqStr("two exports on one line", gitdiffTestNames("export const a = 1; export const b = 2\n"), "a,b")
  t.eqStr("a generic call then a comma", gitdiffTestNames("export const a = f<T>(x), b = 1\n"), "MANY")
  t.eqStr("a generic call with two types", gitdiffTestNames("export const a = f<T, U>(x)\n"), "a")
  t.eqStr(
    "a member generic call with nested types",
    gitdiffTestNames("export const a = ns.f<Map<K, V>, [A, B]>(x)\n"),
    "a",
  )
  t.eqStr(
    "a generic call with two types then a comma",
    gitdiffTestNames("export const a = f<T, U>(x), b = 1\n"),
    "MANY",
  )
  t.eqStr("a comparison then a comma is still refused", gitdiffTestNames("export const a = x < 1, y > (z)\n"), "SPLIT")
  t.eqStr(
    "a comparison with no call after is still refused",
    gitdiffTestNames("export const a = x < y, z > w\n"),
    "SPLIT",
  )
  t.eqStr("an angle that never closes", gitdiffTestNames("export const a = new Foo<x, b = 2\n"), "SPLIT")
  t.eqStr("a comma in a template's substitution", gitdiffTestNames("export const a = `${x, y}`, b = 1\n"), "MANY")
  t.eqStr("a template alone is one name", gitdiffTestNames("export const a = `${f(x, y)}`\n"), "a")
  t.eqStr("a regular expression is refused", gitdiffTestNames("export const a = /,/, b = 1\n"), "READ")
  t.eqStr("a parenthesised comma then a comma", gitdiffTestNames("export const a = (1, 2), b = 3\n"), "MANY")
  t.eqStr("an object then a comma", gitdiffTestNames("export const a = {x: 1, y: 2}, b = 3\n"), "MANY")
  t.eqStr("a comma in a line comment", gitdiffTestNames("export const a = 1 // , b = 2\n"), "a")
  t.eqStr("a comma in a block comment", gitdiffTestNames("export const a = 1 /* , b = 2 */\n"), "a")
  t.eqStr(
    "a function then an export on one line",
    gitdiffTestNames("export function f() {}; export const g = 1\n"),
    "f,g",
  )
  t.eqStr("export default mid-line", gitdiffTestNames("export const a = 1; export default a\n"), "a,default")
  t.eqStr("an arrow's return type is one name", gitdiffTestNames("export const a = (): Result<A, B> => x\n"), "a")
  t.eqStr(
    "an arrow returning a ternary",
    gitdiffTestNames("export const a = (x: i32) => x > 1 ? f(x, 2) : null\n"),
    "a",
  )
  t.eqStr("an arrow then a comma", gitdiffTestNames("export const a = (x): T => y, b = 1\n"), "MANY")
  t.eqStr("an as chain then a comma", gitdiffTestNames("export const a = x as Foo<A, B>, b = 1\n"), "MANY")
  t.eqStr("a ternary then a comma", gitdiffTestNames("export const a = c ? 1 : 2, b = 3\n"), "MANY")
  t.eqStr("an unclosed string is refused", gitdiffTestNames("export const a = 'x\n"), "READ")
  t.eqStr("an unclosed comment is refused", gitdiffTestNames("export const a = 1 /* x\n"), "READ")
  t.eqStr("an unclosed brace is refused", gitdiffTestNames("export const a = () => {\n"), "READ")
  const unsplit = gitdiffExports("const z = 0\nexport const a = x < 1, y > (z)\n")
  t.eqStr(
    "an unsplittable export names its line",
    unsplit.length === 1 ? `${unsplit[0].line}:${unsplit[0].problem}` : "ERR",
    "2:an export it cannot split into names: export const a = x < 1, y > (z): a comma or an angle bracket it cannot place, so it may declare more than one name",
  )
  const unread = gitdiffExports("export const a = 1\nexport const b = /x/\n")
  t.eqStr(
    "an unreadable module names the line",
    unread.length === 1 ? `${unread[0].line}:${unread[0].problem}` : "ERR",
    "2:a module it cannot read: line 2: a regular expression literal, which Nish does not have",
  )
  const ex = gitdiffExports(
    "import x\n\n/** a */\nexport const a = (): i32 => {\n  return 1\n}\n\n/** b */\nexport const b = 2\nconst c = 3\n",
  )
  t.eqStr("exports, in order", `${ex.length}:${ex.length === 2 ? `${ex[0].name},${ex[1].name}` : ""}`, "2:a,b")
  if (ex.length === 2) {
    t.eqStr("a body runs to its closing brace", ex[0].body, "export const a = (): i32 => {\n  return 1\n}")
    t.ok("a line is recorded", ex[0].line === 4 && ex[1].line === 9)
  }
  const probes = [
    "export type R = Result<A, B>",
    "export const m: Map<K, V> = new Map<K, V>()",
    "export const a = x as Array<T>",
    "export const a = from",
    "export const a = type",
    "export const a = of",
    "export const a = f()",
    "export const a = [1]",
    "export const a = {}",
    "export const a = 'x'",
    "export const a = 1",
    "export const a = i++",
    "export const a = i--",
  ]
  for (const p of probes) {
    const got = gitdiffExports(`${p}\nconst helper = from / 2\n`)
    t.eqStr(`a helper after "${p}" is its own`, got.length === 1 ? got[0].body : "ERR", p)
  }
  t.eqStr("a lone export type is refused", gitdiffTestNames("export type\nR = 1\n"), "NAME")
  const r = gitdiffTestRepo(t)
  if (r.isErr()) {
    t.fail("the repository is built", r.error)
  }
  return t.done()
}
