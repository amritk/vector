import { Suite } from "nish/testing"
import { basename, dirname, joinPath, makeTempDir, mkdirAll, relativePath } from "../../src/core/fs"

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
  t.eqStr("basename root", basename("/"), "/")
  t.eqStr("basename slashes", basename("///"), "/")
  t.eqStr("basename at root", basename("/a"), "a")
  t.eqStr("relativePath below", relativePath("/r/tests", "/r/tests/x/y"), "./x/y")
  t.eqStr("relativePath beside", relativePath("/r/tests/core", "/r/src/core/hex"), "../../src/core/hex")
  t.eqStr("relativePath from root", relativePath("/", "/a/b"), "./a/b")
  t.eqStr("relativePath to root", relativePath("/a/b", "/"), "../..")
  t.eqStr("relativePath same", relativePath("/a/b/", "/a/b"), ".")
  t.eqStr("relativePath shared prefix is not a part", relativePath("/a/bc", "/a/b/c"), "../b/c")

  // Write into and remove only directories this test made: no fallback to the
  // working directory or a shared path.
  const tmp = makeTempDir("vector-test-")
  if (tmp.isErr()) {
    t.fail("makeTempDir ok", tmp.error)
    return t.done()
  }
  t.pass("makeTempDir ok")
  const dir = tmp.value
  t.ok("makeTempDir is a directory", isDirectorySync(dir))
  t.ok("makeTempDir is fresh", (readdirSync(dir)?.length ?? -1) === 0)
  const other = makeTempDir("vector-test-")
  if (other.isOk()) {
    t.ok("makeTempDir names differ", other.value !== dir)
    spawnSync(["rm", "-rf", other.value])
  } else {
    t.fail("makeTempDir names differ", other.error)
  }

  const deep = joinPath(dir, "x/y/z")
  t.ok("mkdirAll ok", mkdirAll(deep, 0o755).isOk())
  t.ok("mkdirAll made it", isDirectorySync(deep))
  t.ok("mkdirAll again", mkdirAll(deep, 0o755).isOk())
  const file = joinPath(dir, "file")
  writeFileSync(file, "x")
  t.ok("mkdirAll through a file", mkdirAll(joinPath(file, "sub"), 0o755).isErr())
  spawnSync(["rm", "-rf", dir])
  return t.done()
}
