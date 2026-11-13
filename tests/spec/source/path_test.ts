import { Suite } from "nish/testing"
import { joinPath, makeTempDir, mkdirAll } from "../../../src/core/fs"
import { runProcess } from "../../../src/core/process"
import { charsFromCodePoint } from "../../../src/spec/contract/chars"
import { SourceDecl } from "../../../src/spec/contract/types"
import {
  sourceCandidate,
  sourceConfine,
  sourceFetchHint,
  sourceNameProblem,
  sourceRfcFile,
} from "../../../src/spec/source/path"

/** A declaration with an id and the given file, path and RFC. */
const pathTestDecl = (file: string | null, path: string | null, rfc: i32): SourceDecl => {
  const d = new SourceDecl()
  d.id = "s1"
  d.file = file
  d.path = path
  d.rfc = rfc
  return d
}

/** The error of a result, or "" when it is Ok. */
const pathTestErr = (r: Result<string, string>): string => (r.isErr() ? r.error : "")

/** Whether `ln -s target link` succeeded. */
const pathTestLink = (target: string, link: string): boolean => {
  const r = runProcess(["ln", "-s", target, link], "", 5000)
  return r.isOk() && r.value.status === 0
}

/** Where a source is read from, and every refusal of a path that would leave the repository. */
export const main = (): i32 => {
  const t = new Suite("spec/source path")
  t.eqStr("rfc file", sourceRfcFile(4648), "rfcs/rfc4648.txt")
  t.eqStr(
    "fetch hint",
    sourceFetchHint(4648),
    "curl -sSfL -o rfcs/rfc4648.txt https://www.rfc-editor.org/rfc/rfc4648.txt",
  )

  // Names refused from their text alone.
  t.eqStr("empty name", sourceNameProblem("") ?? "", "an empty path")
  t.eqStr("control character", sourceNameProblem("a\nb") ?? "", "U+000A in the path")
  t.eqStr("NUL", sourceNameProblem(`a${charsFromCodePoint(0)}b`) ?? "", "U+0000 in the path")
  t.eqStr("backslash", sourceNameProblem("..\\x") ?? "", "a backslash in the path: separate with /")
  t.eqStr(
    "absolute",
    sourceNameProblem("/etc/passwd") ?? "",
    "an absolute path, /etc/passwd: give it relative to the contract",
  )
  t.ok("a plain name passes", sourceNameProblem("rfcs/rfc1.txt") === null)

  // Candidates.
  t.eqStr(
    "file is under the root",
    sourceCandidate(pathTestDecl("rfcs/a.txt", null, -1), "c/x.json", "/r").expect("ok"),
    "/r/rfcs/a.txt",
  )
  t.eqStr(
    "path is beside the contract",
    sourceCandidate(pathTestDecl(null, "a.txt", -1), "/r/c/x.json", "/r").expect("ok"),
    "/r/c/a.txt",
  )
  t.eqStr(
    "rfc is under rfcs/",
    sourceCandidate(pathTestDecl(null, null, 7), "/r/c/x.json", "/r").expect("ok"),
    "/r/rfcs/rfc7.txt",
  )
  t.eqStr(
    "absolute file refused",
    pathTestErr(sourceCandidate(pathTestDecl("/etc/passwd", null, -1), "/r/c.json", "/r")),
    "source s1: file: an absolute path, /etc/passwd: give it relative to the contract",
  )
  t.eqStr(
    "absolute path refused",
    pathTestErr(sourceCandidate(pathTestDecl(null, "/etc/passwd", -1), "/r/c.json", "/r")),
    "source s1: path: an absolute path, /etc/passwd: give it relative to the contract",
  )
  t.eqStr(
    "backslash path refused",
    pathTestErr(sourceCandidate(pathTestDecl(null, "..\\..\\x", -1), "/r/c.json", "/r")),
    "source s1: path: a backslash in the path: separate with /",
  )
  t.eqStr(
    "names nothing",
    pathTestErr(sourceCandidate(pathTestDecl(null, null, -1), "/r/c.json", "/r")),
    "source s1: names no rfc, path or file",
  )

  // Confinement, on a real tree: <tmp>/repo is the root, <tmp>/secret.txt is outside it.
  const tmp = makeTempDir("vector-source-").expect("temp dir")
  const root = joinPath(tmp, "repo")
  mkdirAll(joinPath(root, "rfcs/sub"), 0o755).expect("mkdir")
  writeFileSync(joinPath(root, "rfcs/rfc1.txt"), "inside")
  writeFileSync(joinPath(tmp, "secret.txt"), "outside")
  const realRoot = realpathSync(root) ?? root
  const realTmp = realpathSync(tmp) ?? tmp

  const inside = sourceConfine(root, joinPath(root, "rfcs/rfc1.txt"))
  t.eqStr("a file inside is read", inside.isOk() ? inside.value : inside.error, `${realRoot}/rfcs/rfc1.txt`)
  t.ok("a .. that stays inside is read", sourceConfine(root, joinPath(root, "rfcs/sub/../rfc1.txt")).isOk())

  const dotdot = joinPath(root, "rfcs/../../secret.txt")
  t.eqStr(
    "a .. escaping the root is refused",
    pathTestErr(sourceConfine(root, dotdot)),
    `${dotdot}: resolves to ${realTmp}/secret.txt, outside the repository ${realRoot}; a source is read only from inside it`,
  )
  // The same escape through a contract-relative path.
  const viaPath = sourceCandidate(pathTestDecl(null, "../../secret.txt", -1), joinPath(root, "rfcs/c.json"), root)
  t.ok("a .. path escaping the root is refused", sourceConfine(root, viaPath.expect("candidate")).isErr())

  const outLink = joinPath(root, "rfcs/link.txt")
  if (pathTestLink(joinPath(tmp, "secret.txt"), outLink)) {
    t.eqStr(
      "a symlink out of the root is refused",
      pathTestErr(sourceConfine(root, outLink)),
      `${outLink}: resolves to ${realTmp}/secret.txt, outside the repository ${realRoot}; a source is read only from inside it`,
    )
  } else {
    t.fail("a symlink out of the root is refused", "ln -s failed")
  }
  const dirLink = joinPath(root, "up")
  if (pathTestLink(tmp, dirLink)) {
    t.ok(
      "a symlinked directory out of the root is refused",
      sourceConfine(root, joinPath(dirLink, "secret.txt")).isErr(),
    )
  } else {
    t.fail("a symlinked directory out of the root is refused", "ln -s failed")
  }
  const inLink = joinPath(root, "rfcs/alias.txt")
  if (pathTestLink("rfc1.txt", inLink)) {
    const r = sourceConfine(root, inLink)
    t.eqStr(
      "a symlink inside the root is read as its target",
      r.isOk() ? r.value : r.error,
      `${realRoot}/rfcs/rfc1.txt`,
    )
  } else {
    t.fail("a symlink inside the root is read as its target", "ln -s failed")
  }
  const missing = joinPath(root, "rfcs/none.txt")
  t.eqStr("a missing file is refused", pathTestErr(sourceConfine(root, missing)), `${missing}: no such file`)
  const dir = joinPath(root, "rfcs/sub")
  t.eqStr("a directory is refused", pathTestErr(sourceConfine(root, dir)), `${dir}: a directory, not a file`)
  t.eqStr(
    "an unresolvable root is refused",
    pathTestErr(sourceConfine(joinPath(tmp, "nope"), missing)),
    `cannot resolve the repository root ${tmp}/nope`,
  )
  // A sibling whose name starts with the root's is still outside it.
  mkdirAll(`${root}2`, 0o755).expect("mkdir")
  writeFileSync(`${root}2/x.txt`, "sibling")
  t.ok("a sibling sharing the root's prefix is refused", sourceConfine(root, `${root}2/x.txt`).isErr())

  runProcess(["rm", "-rf", tmp], "", 5000).expect("rm")
  return t.done()
}
