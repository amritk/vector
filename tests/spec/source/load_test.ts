import { Suite } from "nish/testing"
import { joinPath, makeTempDir, mkdirAll } from "../../../src/core/fs"
import { sha256Hex } from "../../../src/core/hex"
import { runProcess } from "../../../src/core/process"
import { charsFromCodePoint } from "../../../src/spec/contract/chars"
import { Contract, SourceDecl } from "../../../src/spec/contract/types"
import {
  SourceReaderKind,
  SourceReaders,
  sourceDecls,
  sourceDecodedProblem,
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
import { RfcDocument, RfcSection } from "../../../src/spec/source/rfc"

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

/** An XML spec with one section holding `body`, as xmlRead reads it. */
const loadTestXml = (body: string): string =>
  `<rfc><middle><section anchor="intro" numbered="true"><name>Intro</name><t>${body}</t></section></middle></rfc>`

/**
 * Loads, with the default readers, a contract whose one source is `file`
 * beside it, an XML spec holding `body`: its problems joined by " | ", or,
 * when it loads, "reads: " and its section's lines as the gates read them.
 */
const loadTestXmlProblems = (root: string, file: string, body: string): string => {
  writeFileSync(joinPath(root, `contracts/${file}`), loadTestXml(body))
  const x = loadTestContract(-1)
  x.sources = [loadTestDecl("x", -1, null, file)]
  const set = sourceLoad(x, joinPath(root, "contracts/c.json"), root)
  if (set.problems.length > 0) {
    return set.problems.join(" | ")
  }
  const read = sourceFind(set, "x")
  if (read === null || read.doc.sections.length === 0) {
    return "reads: nothing"
  }
  return `reads: ${read.doc.sections[0].lines.join(" / ")}`
}

/**
 * Loads a contract whose one source, `file` beside it holding `text`, is
 * declared as RFC `rfc` (or no RFC, at -1) and pinned to `pin` when it is not
 * null: its problems joined by " | ", or, when it loads, "reads: " and its
 * first section's last line as the gates read it, from its "It".
 */
const loadTestHintProblems = (root: string, file: string, text: string, rfc: i32, pin: string | null): string => {
  writeFileSync(joinPath(root, `contracts/${file}`), text)
  const x = loadTestContract(-1)
  const d = loadTestDecl("x", rfc, null, file)
  d.sha256 = pin
  x.sources = [d]
  const set = sourceLoad(x, joinPath(root, "contracts/c.json"), root)
  if (set.problems.length > 0) {
    return set.problems.join(" | ")
  }
  const read = sourceFind(set, "x")
  if (read === null || read.doc.sections.length === 0) {
    return "reads: nothing"
  }
  const lines = read.doc.sections[0].lines
  return `reads: ${lines[lines.length - 1].substring(lines[lines.length - 1].indexOf("It"))}`
}

/** The problems of a load, joined by " | ". */
const loadTestProblems = (c: Contract, contractPath: string, root: string): string =>
  sourceLoad(c, contractPath, root).problems.join(" | ")

/**
 * What sourceDecodedProblem finds in a one-section document whose spoof (a
 * Cyrillic Т in MUST) sits only in its `title`, `lines` or `ownLines`, as
 * `where` names; "" when it finds nothing.
 */
const loadTestDecoded = (where: string): string => {
  const spoof = `It MUS${charsFromCodePoint(0x422)} work.`
  const clean = "It MUST work."
  const doc = new RfcDocument()
  doc.sections.push(
    new RfcSection(
      "1",
      where === "title" ? spoof : "Intro",
      [where === "lines" ? spoof : clean],
      [where === "ownLines" ? spoof : clean],
    ),
  )
  return sourceDecodedProblem(doc, "x.xml") ?? ""
}

/** The message of a refused registration, or "" when it was registered. */
const loadTestAddErr = (readers: SourceReaders, ext: string): string => {
  const r = sourceReadersAdd(readers, ext, SourceReaderKind.Rfc)
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
    "source s was read from /x/y.txt, which its file cannot name: it is under no specs/ or rfcs/ of the contract's repo, of the root or of the current directory, nor beside the contract",
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
  writeFileSync(joinPath(root, "contracts/spec.adoc"), loadTestRfc(5555, "Adoc."))
  writeFileSync(joinPath(root, "contracts/README"), loadTestRfc(5555, "None."))
  const xml = loadTestContract(-1)
  xml.sources = [loadTestDecl("x", -1, null, "spec.adoc"), loadTestDecl("bare", -1, null, "README")]
  t.eqStr(
    "no reader for an unregistered extension, nor for no extension",
    loadTestProblems(xml, contractPath, root),
    [
      "source x: contracts/spec.adoc is a .adoc file, and no reader is registered for it: readers are registered for .txt, .xml",
      "source bare: contracts/README is a file without an extension, and no reader is registered for it: readers are registered for .txt, .xml",
    ].join(" | "),
  )
  const readers = sourceReadersDefault()
  t.ok(
    "the default reads .txt and .xml",
    sourceReaderFor(readers, "a/b.txt") !== null &&
      sourceReaderFor(readers, "a/b.xml") !== null &&
      sourceReaderFor(readers, "a.b/c") === null &&
      sourceReaderFor(readers, "a/b.adoc") === null,
  )
  t.ok("a reader is registered", sourceReadersAdd(readers, ".adoc", SourceReaderKind.Rfc).isOk())
  t.ok("a registered reader is found", sourceReaderFor(readers, "rfc1.adoc") !== null)
  const withXml = sourceLoadWith(xml, contractPath, root, readers)
  const x = sourceFind(withXml, "x")
  t.ok(
    "a .adoc added as SourceReaderKind.Rfc is read by rfcRead",
    x !== null && x.doc.number === 5555 && x.label === "contracts/spec.adoc",
  )
  t.ok("re-registered", sourceReadersAdd(readers, ".adoc", SourceReaderKind.Xml).isOk())
  t.ok("adding again keeps one entry", readers.entries.length === 3)
  const refused = sourceLoadWith(xml, contractPath, root, readers).problems.join(" | ")
  t.eqStr(
    "adding it again as SourceReaderKind.Xml replaces the reader with xmlRead",
    refused,
    [
      "source x: contracts/spec.adoc:2: U+000C is not an XML character",
      "source bare: contracts/README is a file without an extension, and no reader is registered for it: readers are registered for .txt, .xml, .adoc",
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
  t.ok("a refused extension is not registered", readers.entries.length === 3)

  // Every text field a reader returns is scanned, each on its own.
  const look = '"MUSТ" reads as MUST but is not spelled in ASCII: write MUST'
  t.eqStr("decoded text: clean", loadTestDecoded(""), "")
  t.eqStr(
    "decoded text: a look-alike only in a title",
    loadTestDecoded("title"),
    `x.xml as its reader decoded it: text a reader cannot see as the gates read it: line 1: ${look}`,
  )
  t.eqStr(
    "decoded text: a look-alike only in a section's lines",
    loadTestDecoded("lines"),
    `x.xml as its reader decoded it: text a reader cannot see as the gates read it: line 2: ${look}`,
  )
  t.eqStr(
    "decoded text: a look-alike only in a section's own lines",
    loadTestDecoded("ownLines"),
    `x.xml as its reader decoded it: text a reader cannot see as the gates read it: line 3: ${look}`,
  )

  // A real XML source, through the default readers: an escape that decodes to
  // hidden or look-alike text is refused, as the same bytes would be raw. A
  // zero-width space is the exception: the reader drops it, as xml2rfc's text
  // writer does, so the gates read the MUST the rendered page shows.
  t.eqStr(
    "a clean .xml loads through the default readers",
    loadTestXmlProblems(root, "clean.xml", "It MUST work."),
    "reads: It MUST work.",
  )
  t.eqStr(
    "an escaped zero-width space in an .xml source is dropped, so MUST reads as MUST",
    loadTestXmlProblems(root, "zwsp.xml", "It MU&#x200B;ST work."),
    "reads: It MUST work.",
  )
  t.eqStr(
    "an escaped right-to-left override in an .xml source is refused",
    loadTestXmlProblems(root, "rlo.xml", "It MUST &#x202E;work."),
    "source x: contracts/rlo.xml as its reader decoded it: text a reader cannot see as the gates read it: line 2: invisible character U+202E: remove it",
  )
  t.eqStr(
    "an escaped Cyrillic look-alike in an .xml source is refused",
    loadTestXmlProblems(root, "cyr.xml", "It MUS&#x422; work."),
    'source x: contracts/cyr.xml as its reader decoded it: text a reader cannot see as the gates read it: line 2: "MUSТ" reads as MUST but is not spelled in ASCII: write MUST',
  )

  // A literal line-break hint is dropped from an RFC source, .txt or .xml,
  // where it cannot change a word; inside a word, or in a source that names
  // no RFC, it is refused as before.
  const zw = charsFromCodePoint(0x200b)
  const wj = charsFromCodePoint(0x2060)
  const hintTxt = loadTestRfc(7001, `It MUST be 0x0100-${zw}0x01ff.`)
  const hintXml = `<rfc number="7002">${loadTestXml(`It MUST be 0x0100-${wj}0x01ff.`).substring(5)}`
  t.eqStr(
    "a boundary hint in a linked RFC .txt is dropped",
    loadTestHintProblems(root, "rfc7001.txt", hintTxt, 7001, null),
    "reads: It MUST be 0x0100-0x01ff.",
  )
  t.eqStr(
    "a boundary hint in a linked RFC .xml is dropped",
    loadTestHintProblems(root, "rfc7002.xml", hintXml, 7002, null),
    "reads: It MUST be 0x0100-0x01ff.",
  )
  t.eqStr(
    "a hint inside a word in a linked RFC .xml is refused at its line",
    loadTestHintProblems(
      root,
      "rfc7003.xml",
      `<rfc number="7003">\n<middle><section anchor="intro" numbered="true"><name>Intro</name><t>It MU${zw}ST work.</t></section></middle></rfc>`,
      7003,
      null,
    ),
    "source x: contracts/rfc7003.xml: text a reader cannot see as the gates read it: line 2: invisible character U+200B: remove it",
  )
  t.eqStr(
    "a boundary hint in a source that names no RFC is refused",
    loadTestHintProblems(root, "hint.txt", hintTxt, -1, null),
    "source x: contracts/hint.txt: text a reader cannot see as the gates read it: line 5: invisible character U+200B: remove it",
  )
  t.eqStr(
    "an RFC source with a dropped hint is pinned by its file's bytes",
    loadTestHintProblems(root, "rfc7001.txt", hintTxt, 7001, sha256Hex(hintTxt)),
    "reads: It MUST be 0x0100-0x01ff.",
  )
  const dropped = loadTestRfc(7001, "It MUST be 0x0100-0x01ff.")
  t.eqStr(
    "an RFC source with a dropped hint is not pinned by the dropped text",
    loadTestHintProblems(root, "rfc7001.txt", hintTxt, 7001, sha256Hex(dropped)),
    `source x (contracts/rfc7001.txt) has SHA-256 ${sha256Hex(hintTxt)}, but the contract pins ${sha256Hex(dropped)}: the source changed`,
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
