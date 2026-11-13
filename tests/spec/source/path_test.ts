import { Suite } from "nish/testing"
import { joinPath, makeTempDir, mkdirAll } from "../../../src/core/fs"
import { sha256Hex } from "../../../src/core/hex"
import { runProcess } from "../../../src/core/process"
import { charsFromCodePoint } from "../../../src/spec/contract/chars"
import { SourceDecl } from "../../../src/spec/contract/types"
import {
  SourceRead,
  sourceCandidate,
  sourceFetchHint,
  sourceLabel,
  sourceNameProblem,
  sourcePathProblem,
  sourceReadConfined,
  sourceRfcFile,
  sourceRfcPlaces,
  sourceRoots,
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

/** The error of a read, or "ok <real>" when it is Ok. */
const pathTestRead = (r: Result<SourceRead, string>): string => (r.isErr() ? r.error : `ok ${r.value.real}`)

/** Whether a command succeeded. */
const pathTestRun = (argv: string[]): boolean => {
  const r = runProcess(argv, "", 5000)
  return r.isOk() && r.value.status === 0
}

/** The refusal sourcePathProblem gives source s1 shown as `shown`. */
const pathTestNotSpec = (shown: string): string =>
  `source s1 is ${shown}, which is not spec text: a contract may read sources only beside it or under specs/ or rfcs/, and not in a hidden directory or through a symlinked specs/ or rfcs/`

/** Where a source is read from, and every refusal of a file that is not spec text. */
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
  t.eqStr(
    "the places, nearest first, XML first",
    sourceRfcPlaces(7, "/r/c/x.json", "/v").join(" "),
    "/r/c/rfc7.xml /r/c/rfc7.txt /r/c/../rfcs/rfc7.xml /r/c/../rfcs/rfc7.txt /v/rfcs/rfc7.xml /v/rfcs/rfc7.txt",
  )
  t.eqStr(
    "path is beside the contract",
    sourceCandidate(pathTestDecl(null, "a.txt", -1), "/r/c/x.json", "/r").expect("ok"),
    "/r/c/a.txt",
  )
  t.eqStr(
    "absolute file refused",
    pathTestErr(sourceCandidate(pathTestDecl("/etc/passwd", null, 1), "/r/c.json", "/r")),
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
    "a file alone locates nothing",
    pathTestErr(sourceCandidate(pathTestDecl("rfcs/a.txt", null, -1), "/r/c.json", "/r")),
    "source s1: names no rfc or path",
  )

  // A real tree: <tmp>/repo is the root, holding contracts/c.json; <tmp>/secret.txt is outside it.
  const tmp = makeTempDir("vector-source-").expect("temp dir")
  const root = joinPath(tmp, "repo")
  const contract = joinPath(root, "contracts/c.json")
  mkdirAll(joinPath(root, "rfcs/sub"), 0o755).expect("mkdir")
  mkdirAll(joinPath(root, "rfcs/.git"), 0o755).expect("mkdir")
  mkdirAll(joinPath(root, "contracts"), 0o755).expect("mkdir")
  mkdirAll(joinPath(root, "other"), 0o755).expect("mkdir")
  mkdirAll(joinPath(tmp, "elsewhere"), 0o755).expect("mkdir")
  writeFileSync(joinPath(root, "rfcs/rfc1.txt"), "inside")
  writeFileSync(joinPath(root, "rfcs/.git/config"), "hidden")
  writeFileSync(joinPath(root, "contracts/notes.txt"), "beside")
  writeFileSync(joinPath(root, "other/x.txt"), "not spec text")
  writeFileSync(joinPath(tmp, "secret.txt"), "outside")
  writeFileSync(joinPath(tmp, "elsewhere/rfc2.txt"), "elsewhere")
  const real = realpathSync(root) ?? root
  const realTmp = realpathSync(tmp) ?? tmp

  t.eqStr(
    "the roots",
    sourceRoots(contract, root).join(" "),
    `${real}/contracts ${real}/specs ${real}/rfcs ${realTmp}/specs ${realTmp}/rfcs`,
  )

  // The implicit lookup.
  t.eqStr(
    "an RFC in ../rfcs",
    sourceCandidate(pathTestDecl(null, null, 1), contract, root).expect("ok"),
    `${root}/contracts/../rfcs/rfc1.txt`,
  )
  writeFileSync(joinPath(root, "contracts/rfc1.txt"), "nearer")
  t.eqStr(
    "beside the contract comes first",
    sourceCandidate(pathTestDecl(null, null, 1), contract, root).expect("ok"),
    `${root}/contracts/rfc1.txt`,
  )
  writeFileSync(joinPath(root, "rfcs/rfc1.xml"), "<rfc/>")
  t.eqStr(
    "the recorded name picks among them",
    sourceCandidate(pathTestDecl("rfcs/rfc1.xml", null, 1), contract, root).expect("ok"),
    `${root}/contracts/../rfcs/rfc1.xml`,
  )
  writeFileSync(joinPath(root, "contracts/rfc1.xml"), "<rfc/>")
  t.eqStr(
    "XML before text",
    sourceCandidate(pathTestDecl(null, null, 1), contract, root).expect("ok"),
    `${root}/contracts/rfc1.xml`,
  )
  t.eqStr(
    "a recorded .txt is not displaced by a nearer .xml",
    sourceCandidate(pathTestDecl("contracts/rfc1.txt", null, 1), contract, root).expect("ok"),
    `${root}/contracts/rfc1.txt`,
  )
  t.eqStr(
    "an RFC on disk nowhere says how to fetch it",
    pathTestErr(sourceCandidate(pathTestDecl(null, null, 1234), contract, root)),
    `rfc1234 not found; fetch it: ${sourceFetchHint(1234)}`,
  )

  // What may be read.
  const ok = sourceReadConfined(
    pathTestDecl(null, "../rfcs/rfc1.txt", -1),
    `${root}/contracts/../rfcs/rfc1.txt`,
    contract,
    root,
  )
  t.eqStr("a file under rfcs/ is read", pathTestRead(ok), `ok ${real}/rfcs/rfc1.txt`)
  t.ok("its text and hash", ok.isOk() && ok.value.text === "inside" && ok.value.sha256 === sha256Hex("inside"))
  t.eqStr(
    "a file beside the contract is read",
    pathTestRead(
      sourceReadConfined(pathTestDecl(null, "notes.txt", -1), `${root}/contracts/notes.txt`, contract, root),
    ),
    `ok ${real}/contracts/notes.txt`,
  )
  t.ok(
    "a .. that stays under rfcs/ is read",
    sourceReadConfined(pathTestDecl(null, null, 1), `${root}/rfcs/sub/../rfc1.txt`, contract, root).isOk(),
  )

  // Each refusal, with its reason.
  t.eqStr(
    "a .. escaping the repository",
    pathTestRead(
      sourceReadConfined(
        pathTestDecl(null, "../../secret.txt", -1),
        `${root}/contracts/../../secret.txt`,
        contract,
        root,
      ),
    ),
    pathTestNotSpec("../../secret.txt"),
  )
  t.eqStr(
    "a file in the repository but under no specs/ or rfcs/",
    pathTestRead(sourceReadConfined(pathTestDecl(null, "../other/x.txt", -1), `${root}/other/x.txt`, contract, root)),
    pathTestNotSpec("../other/x.txt"),
  )
  t.eqStr(
    "a hidden directory under rfcs/",
    pathTestRead(
      sourceReadConfined(pathTestDecl(null, "../rfcs/.git/config", -1), `${root}/rfcs/.git/config`, contract, root),
    ),
    pathTestNotSpec("../rfcs/.git/config"),
  )
  t.eqStr(
    "sourcePathProblem judges a resolved path",
    sourcePathProblem(pathTestDecl(null, null, 1), "x", `${real}/rfcs/a/.ssh/k`, contract, root) ?? "",
    pathTestNotSpec("x"),
  )
  t.ok(
    "a dot inside a name is not hidden",
    sourcePathProblem(pathTestDecl(null, null, 1), "x", `${real}/rfcs/a.b/c`, contract, root) === null,
  )
  t.eqStr(
    "the root itself is not under it",
    sourcePathProblem(pathTestDecl(null, null, 1), "x", `${real}/rfcs`, contract, root) ?? "",
    pathTestNotSpec("x"),
  )

  const outLink = joinPath(root, "rfcs/link.txt")
  t.ok("ln", pathTestRun(["ln", "-s", joinPath(tmp, "secret.txt"), outLink]))
  t.eqStr(
    "a symlink out of the repository",
    pathTestRead(sourceReadConfined(pathTestDecl(null, "../rfcs/link.txt", -1), outLink, contract, root)),
    pathTestNotSpec("../rfcs/link.txt"),
  )
  const zero = joinPath(root, "contracts/rfc9.txt")
  t.ok("ln /dev/zero", pathTestRun(["ln", "-s", "/dev/zero", zero]))
  const zeroAt = sourceCandidate(pathTestDecl(null, null, 9), contract, root).expect("found")
  t.eqStr(
    "a /dev/zero symlink as an RFC",
    pathTestRead(sourceReadConfined(pathTestDecl(null, null, 9), zeroAt, contract, root)),
    pathTestNotSpec(zero),
  )
  const fifo = joinPath(root, "rfcs/fifo.txt")
  t.ok("mkfifo", pathTestRun(["mkfifo", fifo]))
  t.eqStr(
    "a FIFO is refused at once",
    pathTestRead(sourceReadConfined(pathTestDecl(null, "../rfcs/fifo.txt", -1), fifo, contract, root)),
    "source s1: ../rfcs/fifo.txt: not a regular file",
  )
  t.eqStr(
    "a directory",
    pathTestRead(sourceReadConfined(pathTestDecl(null, "../rfcs/sub", -1), `${root}/rfcs/sub`, contract, root)),
    "source s1: ../rfcs/sub: a directory, not a file",
  )
  t.eqStr(
    "a missing file",
    pathTestRead(sourceReadConfined(pathTestDecl(null, "none.txt", -1), `${root}/contracts/none.txt`, contract, root)),
    "source s1: none.txt: no such file",
  )
  // A specs/ that is a symlink is no root, wherever it leads.
  t.ok("ln specs", pathTestRun(["ln", "-s", joinPath(tmp, "elsewhere"), joinPath(root, "specs")]))
  t.ok("specs/ left out of the roots", sourceRoots(contract, root).indexOf(`${real}/specs`) < 0)
  t.eqStr(
    "a file through a symlinked specs/",
    pathTestRead(
      sourceReadConfined(pathTestDecl(null, "../specs/rfc2.txt", -1), `${root}/specs/rfc2.txt`, contract, root),
    ),
    pathTestNotSpec("../specs/rfc2.txt"),
  )

  // Labels: how a source's `file` records what was read.
  t.eqStr("under rfcs/", sourceLabel(`${real}/rfcs/rfc1.txt`, contract, root) ?? "-", "rfcs/rfc1.txt")
  t.eqStr(
    "beside the contract",
    sourceLabel(`${real}/contracts/notes.txt`, contract, root) ?? "-",
    "contracts/notes.txt",
  )
  t.eqStr(
    "a nested rfcs/ is named from the root",
    sourceLabel(`${real}/rfcs/x/rfcs/y.txt`, contract, root) ?? "-",
    "rfcs/x/rfcs/y.txt",
  )
  t.eqStr("nothing can name it", sourceLabel(`${real}/other/x.txt`, contract, root) ?? "-", "-")
  t.eqStr("nor outside", sourceLabel(`${realTmp}/secret.txt`, contract, root) ?? "-", "-")
  const deep = joinPath(root, "contracts/a/b/c.json")
  t.eqStr(
    "a deeper contract names rfcs/ alike",
    sourceLabel(`${real}/rfcs/rfc1.txt`, deep, root) ?? "-",
    "rfcs/rfc1.txt",
  )

  t.ok("rm", pathTestRun(["rm", "-rf", tmp]))
  return t.done()
}
