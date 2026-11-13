import { Suite } from "nish/testing"
import { joinPath, makeTempDir, mkdirAll } from "../../../src/core/fs"
import { sha256Hex } from "../../../src/core/hex"
import { runProcess } from "../../../src/core/process"
import { charsFromCodePoint } from "../../../src/spec/contract/chars"
import { Contract, SourceDecl } from "../../../src/spec/contract/types"
import {
  SourceReaders,
  sourceDecls,
  sourceFind,
  sourceLoad,
  sourceLoadWith,
  sourceMainId,
  sourceReaderFor,
  sourceReadersAdd,
  sourceReadersDefault,
  sourceRecordedProblem,
} from "../../../src/spec/source/load"
import { SourceRead } from "../../../src/spec/source/path"
import { RfcDocument, RfcSection, rfcParse, rfcRead } from "../../../src/spec/source/rfc"

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

/** A second reader, for the test registry: the text reader under another extension, as a function of its own. */
const loadTestOtherReader = (text: string, name: string): Result<RfcDocument, string> => rfcRead(text, name)

/** A reader that refuses every text, naming it: to see that a later registration replaced an earlier one. */
const loadTestRefusingReader = (text: string, name: string): Result<RfcDocument, string> => {
  const read = rfcRead(text, name)
  return Err(`${name}: refused (${read.isOk() ? "an RFC" : "not an RFC"})`)
}

/**
 * An XML-ish reader that decodes `&#1058;` to a Cyrillic Т and parses without
 * any guard of its own, as a reader of escaped text might.
 */
const loadTestDecodingReader = (text: string, name: string): Result<RfcDocument, string> => {
  const raw = rfcRead(text, name)
  if (raw.isErr()) {
    return raw
  }
  const at = text.indexOf("&#1058;")
  const decoded = at < 0 ? text : `${text.substring(0, at)}${charsFromCodePoint(0x422)}${text.substring(at + 7)}`
  return Ok(rfcParse(decoded))
}

/**
 * A reader that adds a section whose spoof is only in its `lines`: its title
 * and own lines are clean, as a reader that keeps text only there might.
 */
const loadTestLinesReader = (text: string, name: string): Result<RfcDocument, string> => {
  const raw = rfcRead(text, name)
  if (raw.isErr()) {
    return raw
  }
  const doc = raw.value
  doc.sections.push(new RfcSection("9", "Clean", [`It MUS${charsFromCodePoint(0x422)} work.`], []))
  return Ok(doc)
}

/** The message of a refused registration, or "" when it was registered. */
const loadTestAddErr = (readers: SourceReaders, ext: string): string => {
  const r = sourceReadersAdd(readers, ext, rfcRead)
  return r.isErr() ? r.error : ""
}

/** The ids and RFC numbers of a contract's declarations. */
const loadTestDecls = (c: Contract): string =>
  sourceDecls(c)
    .map((d: SourceDecl): string => `${d.id}:${d.rfc}`)
    .join(" ")

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
    `source rfc9999 (rfcs/rfc9999.txt) has SHA-256 ${sha256Hex(rfc)}, but the contract pins ${sha256Hex("other")}: the source changed`,
  )
  c.source.sha256 = null
  const pinned = loadTestContract(-1)
  pinned.source.main = "notes"
  const pinnedDecl = loadTestDecl("notes", 8888, null, "notes.txt")
  pinnedDecl.sha256 = sha256Hex("x")
  pinned.sources = [pinnedDecl]
  t.eqStr(
    "a declaration's own pin differs",
    loadTestProblems(pinned, contractPath, root),
    `source notes (contracts/notes.txt) has SHA-256 ${sha256Hex(loadTestRfc(8888, "Notes."))}, but the contract pins ${sha256Hex("x")}: the source changed`,
  )

  // The implicit main source sits beside the declared ones.
  const both = loadTestContract(9999)
  both.sources = [loadTestDecl("notes", -1, null, "notes.txt")]
  t.eqStr("source.rfc is declared alongside sources", loadTestDecls(both), "rfc9999:9999 notes:-1")
  t.eqStr("and loads", loadTestProblems(both, contractPath, root), "")
  t.ok("the main source is the RFC", sourceFind(sourceLoad(both, contractPath, root), null) !== null)
  both.sources = [loadTestDecl("rfc9999", 9999, "rfcs/rfc9999.txt", null), loadTestDecl("notes", -1, null, "notes.txt")]
  t.eqStr("not twice when declared by id", loadTestDecls(both), "rfc9999:9999 notes:-1")
  both.source.main = "notes"
  both.sources = [loadTestDecl("notes", -1, null, "notes.txt")]
  t.eqStr("not when source.main picks another", loadTestDecls(both), "notes:-1")

  // The file a source records.
  const elsewhere = loadTestContract(-1)
  elsewhere.sources = [loadTestDecl("other", 9999, "rfcs/other.txt", null)]
  t.eqStr(
    "file names another file",
    loadTestProblems(elsewhere, contractPath, root),
    "source other was read from rfcs/rfc9999.txt, but its file is rfcs/other.txt",
  )
  const read = new SourceRead("/x/y.txt", "t", sha256Hex("t"))
  t.eqStr(
    "a file no label can name",
    sourceRecordedProblem(loadTestDecl("s", -1, "rfcs/y.txt", null), null, read, null) ?? "",
    "source s was read from /x/y.txt, which its file cannot name: it is under no specs/ or rfcs/ of the contract's repo or of the root, nor beside the contract",
  )
  t.ok(
    "the file recorded",
    sourceRecordedProblem(loadTestDecl("s", -1, "rfcs/y.txt", null), sha256Hex("t"), read, "rfcs/y.txt") === null,
  )
  t.ok(
    "no file, no label needed",
    sourceRecordedProblem(loadTestDecl("s", -1, null, "y.txt"), null, read, null) === null,
  )

  // Readers, by extension.
  writeFileSync(joinPath(root, "contracts/spec.xml"), loadTestRfc(5555, "XML."))
  writeFileSync(joinPath(root, "contracts/README"), loadTestRfc(5555, "None."))
  const xml = loadTestContract(-1)
  xml.sources = [loadTestDecl("x", -1, null, "spec.xml"), loadTestDecl("bare", -1, null, "README")]
  t.eqStr(
    "no reader for .xml, nor for no extension",
    loadTestProblems(xml, contractPath, root),
    [
      "source x: contracts/spec.xml is a .xml file, and no reader is registered for it: readers are registered for .txt",
      "source bare: contracts/README is a file without an extension, and no reader is registered for it: readers are registered for .txt",
    ].join(" | "),
  )
  const readers = sourceReadersDefault()
  t.ok(
    "the default reads .txt",
    sourceReaderFor(readers, "a/b.txt") !== null && sourceReaderFor(readers, "a.b/c") === null,
  )
  t.ok("a reader is registered", sourceReadersAdd(readers, ".xml", loadTestOtherReader).isOk())
  t.ok("a registered reader is found", sourceReaderFor(readers, "rfc1.xml") !== null)
  const withXml = sourceLoadWith(xml, contractPath, root, readers)
  const x = sourceFind(withXml, "x")
  t.ok("a registered reader reads", x !== null && x.doc.number === 5555 && x.label === "contracts/spec.xml")
  t.ok("re-registered", sourceReadersAdd(readers, ".xml", loadTestRefusingReader).isOk())
  t.ok("adding again keeps one entry", readers.entries.length === 2)
  const refused = sourceLoadWith(xml, contractPath, root, readers).problems.join(" | ")
  t.eqStr(
    "adding again replaces the reader",
    refused,
    [
      "source x: contracts/spec.xml: refused (an RFC)",
      "source bare: contracts/README is a file without an extension, and no reader is registered for it: readers are registered for .txt, .xml",
    ].join(" | "),
  )
  t.eqStr(
    "an extension without its dot is refused",
    loadTestAddErr(readers, "xml"),
    'a reader\'s extension is "xml": give it with its leading dot and nothing else, as ".xml"',
  )
  t.eqStr(
    "nor a bare dot",
    loadTestAddErr(readers, "."),
    'a reader\'s extension is ".": give it with its leading dot and nothing else, as ".xml"',
  )
  t.eqStr(
    "nor two extensions",
    loadTestAddErr(readers, ".tar.gz"),
    'a reader\'s extension is ".tar.gz": give it with its leading dot and nothing else, as ".xml"',
  )
  t.eqStr(
    "nor a path",
    loadTestAddErr(readers, ".a/b"),
    'a reader\'s extension is ".a/b": give it with its leading dot and nothing else, as ".xml"',
  )
  t.ok("a refused extension is not registered", readers.entries.length === 2)

  // The text a reader decodes is checked as well as the bytes it was given.
  writeFileSync(joinPath(root, "contracts/esc.xml"), loadTestRfc(4444, "It MUS&#1058; work."))
  const decoding = sourceReadersDefault()
  t.ok("the decoding reader", sourceReadersAdd(decoding, ".xml", loadTestDecodingReader).isOk())
  const esc = loadTestContract(-1)
  esc.sources = [loadTestDecl("esc", -1, null, "esc.xml")]
  t.eqStr(
    "a look-alike only the reader's decoding shows",
    sourceLoadWith(esc, contractPath, root, decoding).problems.join(" | "),
    'source esc: contracts/esc.xml as its reader decoded it: text a reader cannot see as the gates read it: line 4: "MUSТ" reads as MUST but is not spelled in ASCII: write MUST',
  )

  // Every text field a reader returns is scanned: here only a section's lines.
  writeFileSync(joinPath(root, "contracts/lines.xml"), loadTestRfc(4444, "It MUST work."))
  const lining = sourceReadersDefault()
  t.ok("the lines reader", sourceReadersAdd(lining, ".xml", loadTestLinesReader).isOk())
  const lined = loadTestContract(-1)
  lined.sources = [loadTestDecl("lined", -1, null, "lines.xml")]
  const linedProblems = sourceLoadWith(lined, contractPath, root, lining).problems.join(" | ")
  t.ok(
    "a look-alike only in a section's lines",
    linedProblems.startsWith("source lined: contracts/lines.xml as its reader decoded it: ") &&
      linedProblems.indexOf('"MUSТ" reads as MUST but is not spelled in ASCII') >= 0,
  )

  // Each refusal, with its reason.
  const many = loadTestContract(-1)
  many.source.main = "notes"
  many.sources = [
    loadTestDecl("notes", -1, null, "notes.txt"),
    loadTestDecl("wrong", 1111, null, "notes.txt"),
    loadTestDecl("hidden", 7777, null, null),
    loadTestDecl("escape", -1, null, "../../outside.txt"),
    loadTestDecl("abs", -1, `${tmp}/outside.txt`, null),
    loadTestDecl("gone", -1, null, "none.txt"),
  ]
  t.eqStr("main id from source.main", sourceMainId(many), "notes")
  const got = sourceLoad(many, contractPath, root)
  const notes = sourceFind(got, null)
  t.ok("a path beside the contract loads", notes !== null && notes.doc.number === 8888)
  t.eqStr(
    "each problem",
    got.problems.join("\n"),
    [
      "source wrong: contracts/notes.txt is RFC 8888, not RFC 1111",
      "source hidden: rfcs/rfc7777.txt: text a reader cannot see as the gates read it: line 5: invisible character U+200B: remove it",
      "source escape is ../../outside.txt, which is not spec text: a contract may read sources only beside it or under specs/ or rfcs/, and not in a hidden directory or through a symlinked specs/ or rfcs/",
      `source abs: file: an absolute path, ${tmp}/outside.txt: give it relative to the contract`,
      "source gone: none.txt: no such file",
    ].join("\n"),
  )
  runProcess(["rm", "-rf", tmp], "", 5000).expect("rm")
  return t.done()
}
