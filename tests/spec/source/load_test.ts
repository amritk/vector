import { Suite } from "nish/testing"
import { joinPath, makeTempDir, mkdirAll } from "../../../src/core/fs"
import { sha256Hex } from "../../../src/core/hex"
import { runProcess } from "../../../src/core/process"
import { charsFromCodePoint } from "../../../src/spec/contract/chars"
import { Contract, SourceDecl } from "../../../src/spec/contract/types"
import { sourceDecls, sourceFind, sourceLoad, sourceMainId } from "../../../src/spec/source/load"
import { sourceFetchHint } from "../../../src/spec/source/path"

/** The plain text of a one-section RFC numbered `n`. */
const loadTestRfc = (n: i32, body: string): string => `Request for Comments: ${n}\n\f\n1.  Introduction\n\n   ${body}\n`

/** A contract on RFC `rfc`, with no `sources`. */
const loadTestContract = (rfc: i32): Contract => {
  const c = new Contract()
  c.source.title = "T"
  c.source.rfc = rfc
  return c
}

/** A source declaration. */
const loadTestDecl = (id: string, rfc: i32, file: string | null, path: string | null): SourceDecl => {
  const d = new SourceDecl()
  d.id = id
  d.rfc = rfc
  d.file = file
  d.path = path
  return d
}

/** The problems of a load, joined by " | ". */
const loadTestProblems = (c: Contract, contractPath: string, root: string): string =>
  sourceLoad(c, contractPath, root).problems.join(" | ")

/** Loading a contract's sources: found, confined, pinned and read. */
export const main = (): i32 => {
  const t = new Suite("spec/source load")
  const tmp = makeTempDir("vector-load-").expect("temp dir")
  const root = joinPath(tmp, "repo")
  mkdirAll(joinPath(root, "rfcs"), 0o755).expect("mkdir")
  mkdirAll(joinPath(root, "contracts"), 0o755).expect("mkdir")
  const rfc = loadTestRfc(9999, "It MUST work.")
  writeFileSync(joinPath(root, "rfcs/rfc9999.txt"), rfc)
  writeFileSync(joinPath(root, "contracts/notes.txt"), loadTestRfc(8888, "Notes."))
  writeFileSync(joinPath(root, "rfcs/rfc7777.txt"), loadTestRfc(7777, `It MU${charsFromCodePoint(0x200b)}ST work.`))
  writeFileSync(joinPath(tmp, "outside.txt"), loadTestRfc(6666, "Secret."))
  const contractPath = joinPath(root, "contracts/c.json")

  // The implicit source.
  const c = loadTestContract(9999)
  t.eqStr(
    "implicit decl",
    sourceDecls(c)
      .map((d: SourceDecl): string => `${d.id}:${d.rfc}`)
      .join(" "),
    "rfc9999:9999",
  )
  t.eqStr("main id from rfc", sourceMainId(c), "rfc9999")
  const set = sourceLoad(c, contractPath, root)
  t.eqStr("implicit source loads", set.problems.join(" | "), "")
  const main = sourceFind(set, null)
  t.ok("the main source is found", main !== null && main.doc.number === 9999 && main.doc.sections.length === 1)
  t.ok("by id", sourceFind(set, "rfc9999") !== null && sourceFind(set, "rfc1") === null)
  t.ok("no sources", sourceDecls(loadTestContract(-1)).length === 0 && sourceMainId(loadTestContract(-1)) === "")

  // Pins.
  c.source.sha256 = sha256Hex(rfc)
  t.eqStr("the main pin matches", loadTestProblems(c, contractPath, root), "")
  c.source.sha256 = sha256Hex("other")
  t.eqStr(
    "the main pin differs",
    loadTestProblems(c, contractPath, root),
    `source rfc9999: ${root}/rfcs/rfc9999.txt has SHA-256 ${sha256Hex(rfc)}, but the contract pins ${sha256Hex("other")}: the source changed`,
  )

  // Missing, wrong and hidden.
  t.eqStr(
    "a missing RFC says how to fetch it",
    loadTestProblems(loadTestContract(1234), contractPath, root),
    `rfc1234 not found; fetch it: ${sourceFetchHint(1234)}`,
  )
  const many = loadTestContract(-1)
  many.source.main = "notes"
  many.sources = [
    loadTestDecl("notes", -1, null, "notes.txt"),
    loadTestDecl("wrong", 1111, "contracts/notes.txt", null),
    loadTestDecl("hidden", 7777, null, null),
    loadTestDecl("escape", -1, null, "../../outside.txt"),
    loadTestDecl("abs", -1, `${tmp}/outside.txt`, null),
    loadTestDecl("gone", -1, "rfcs/none.txt", null),
  ]
  t.eqStr("main id from source.main", sourceMainId(many), "notes")
  const got = sourceLoad(many, contractPath, root)
  const notes = sourceFind(got, null)
  t.ok("a path beside the contract loads", notes !== null && notes.doc.number === 8888)
  t.eqStr(
    "each problem",
    got.problems.join("\n"),
    [
      `source wrong: ${root}/contracts/notes.txt is RFC 8888, not RFC 1111`,
      `source hidden: ${root}/rfcs/rfc7777.txt: text a reader cannot see as the gates read it: line 5: invisible character U+200B: remove it`,
      `source escape: ${root}/contracts/../../outside.txt: resolves to ${realpathSync(tmp) ?? tmp}/outside.txt, outside the repository ${realpathSync(root) ?? root}; a source is read only from inside it`,
      `source abs: file: an absolute path, ${tmp}/outside.txt: give it relative to the contract`,
      `source gone: ${root}/rfcs/none.txt: no such file`,
    ].join("\n"),
  )
  runProcess(["rm", "-rf", tmp], "", 5000).expect("rm")
  return t.done()
}
