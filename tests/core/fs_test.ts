import { Suite } from "nish/testing"
import { basename, dirname, joinPath, makeTempDir, mkdirAll } from "../../src/core/fs"

export const main = (): i32 => {
  const t = new Suite("core/fs")
  t.eqStr("joinPath", joinPath("a", "b"), "a/b")
  t.eqStr("joinPath trailing slash", joinPath("a/", "b"), "a/b")
  t.eqStr("joinPath absolute", joinPath("a", "/b"), "/b")
  t.eqStr("joinPath empty left", joinPath("", "b"), "b")
  t.eqStr("joinPath empty right", joinPath("a", ""), "a")
  t.eqStr("dirname", dirname("a/b/c.txt"), "a/b")
  t.eqStr("dirname bare", dirname("c.txt"), ".")
  t.eqStr("dirname root file", dirname("/c"), "/")
  t.eqStr("dirname trailing slash", dirname("a/b/"), "a")
  t.eqStr("dirname root", dirname("/"), "/")
  t.eqStr("basename", basename("a/b/c.txt"), "c.txt")
  t.eqStr("basename trailing slash", basename("a/b/"), "b")
  t.eqStr("basename bare", basename("c"), "c")

  const tmp = makeTempDir("vector-test-")
  t.ok("makeTempDir ok", tmp.isOk())
  const dir = tmp.unwrapOr("")
  t.ok("makeTempDir is a directory", isDirectorySync(dir))
  t.ok("makeTempDir is fresh", (readdirSync(dir)?.length ?? -1) === 0)
  const other = makeTempDir("vector-test-")
  t.ok("makeTempDir names differ", other.unwrapOr(dir) !== dir)

  const deep = joinPath(dir, "x/y/z")
  t.ok("mkdirAll ok", mkdirAll(deep, 0o755).isOk())
  t.ok("mkdirAll made it", isDirectorySync(deep))
  t.ok("mkdirAll again", mkdirAll(deep, 0o755).isOk())
  const file = joinPath(dir, "file")
  writeFileSync(file, "x")
  t.ok("mkdirAll through a file", mkdirAll(joinPath(file, "sub"), 0o755).isErr())
  spawnSync(["rm", "-rf", dir, other.unwrapOr(dir)])
  return t.done()
}
