import { Suite } from "nish/testing"
import { replaceAll, split } from "nish/text"
import { diagPlace } from "../../../src/core/diag"
import { joinPath, makeTempDir, mkdirAll } from "../../../src/core/fs"
import { ExtractOutcome, extractContract, extractReaders } from "../../../src/spec/extract"
import { SourceReaders } from "../../../src/spec/source/load"

const MD_PATH_TEST_FIXTURE: string = "tests/fixtures/extract/extract-mini"

/** specs/<name>.xml (and its .md), contracts/ and rfcs/, as vector lays them out. */
class MdPathTestTree {
  dir: string
  xml: string
  md: string
  contract: string
  /**
   * A tree's paths.
   *
   * @param dir its root
   * @param name the spec's name
   */
  constructor(dir: string, name: string) {
    this.dir = dir
    this.xml = joinPath(dir, `specs/${name}.xml`)
    this.md = joinPath(dir, `specs/${name}.md`)
    this.contract = joinPath(dir, `contracts/${name}.json`)
  }
}

/** A fresh tree holding `xml` and, when not null, `md`; null after failing the test. */
const mdPathTestTree = (t: Suite, xml: string, md: string | null, name: string): MdPathTestTree | null => {
  const made = makeTempDir("vector-md-path-")
  if (made.isErr()) {
    t.fail("a temp dir", made.error)
    return null
  }
  const d = made.value
  for (const sub of ["specs", "contracts", "rfcs"]) {
    mkdirAll(joinPath(d, sub), 0o755).expect(sub)
  }
  writeFileSync(joinPath(d, "rfcs/rfc4648.txt"), readFileSyncOrNull("rfcs/rfc4648.txt") ?? "")
  const tr = new MdPathTestTree(d, name)
  writeFileSync(tr.xml, xml)
  if (md !== null) {
    writeFileSync(tr.md, md)
  }
  return tr
}

/** Each refusal as it prints, `file:line: message` or `md:line (xml:line): message`, or `error <why>`, or `ok`. */
const mdPathTestLines = (o: ExtractOutcome): string[] => {
  if (o.errors.length > 0) {
    return o.errors.map((e: string): string => `error ${e}`)
  }
  if (o.refusals.length === 0) {
    return ["ok"]
  }
  return o.refusals.map((f): string => `${diagPlace(f.file, f.line, f.col, f.exactFile, f.exactLine)}: ${f.message}`)
}

/** Extract a tree's spec. */
const mdPathTestRun = (tr: MdPathTestTree, readers: SourceReaders): ExtractOutcome =>
  extractContract(tr.xml, tr.contract, tr.dir, readers)

const MD_PATH_TEST_FOO: string = '<?xml version="1.0"?>\n<?line 10?>\n<foo/>\n'
const MD_PATH_TEST_ROOT: string = "not RFC XML: the root element is <foo>, not <rfc>"
const MD_PATH_TEST_TWELVE: string = "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n"

/** An XML reader refusal names the markdown only when the markdown line and the file are both there. */
const mdPathTestReader = (t: Suite, readers: SourceReaders): void => {
  const a = mdPathTestTree(t, MD_PATH_TEST_FOO, MD_PATH_TEST_TWELVE, "bad")
  if (a !== null) {
    t.eqLines(
      "an XML reader refusal below a mark names the mark's markdown line and the XML line",
      mdPathTestLines(mdPathTestRun(a, readers)),
      [`${a.md}:10 (${a.xml}:3): ${MD_PATH_TEST_ROOT}`],
    )
  }
  const x = mdPathTestTree(t, '<?xml version="1.0"?>\n<?line 10?><foo/>\n', MD_PATH_TEST_TWELVE, "bad")
  if (x !== null) {
    t.eqLines(
      "an XML reader refusal on a mark's own line names the markdown at the mark's line alone",
      mdPathTestLines(mdPathTestRun(x, readers)),
      [`${x.md}:10: ${MD_PATH_TEST_ROOT}`],
    )
  }
  const p = mdPathTestTree(t, MD_PATH_TEST_FOO, "1\n2\n3\n4\n5\n6\n7\n8\n9\n", "bad")
  if (p !== null) {
    t.eqLines(
      "an XML reader refusal names the XML when the mark's markdown line is past the .md's end",
      mdPathTestLines(mdPathTestRun(p, readers)),
      [`${p.xml}:3: ${MD_PATH_TEST_ROOT}`],
    )
  }
  const b = mdPathTestTree(t, '<?xml version="1.0"?>\n\n<foo/>\n', "", "bad")
  if (b !== null) {
    t.eqLines(
      "an XML reader refusal names the XML at its XML line when the XML has no markdown line",
      mdPathTestLines(mdPathTestRun(b, readers)),
      [`${b.xml}:3: ${MD_PATH_TEST_ROOT}`],
    )
  }
  const c = mdPathTestTree(t, MD_PATH_TEST_FOO, null, "extract-mini")
  if (c !== null) {
    t.eqLines(
      "an XML reader refusal names the XML at its XML line when there is no .md beside it",
      mdPathTestLines(mdPathTestRun(c, readers)),
      [`${c.xml}:3: ${MD_PATH_TEST_ROOT}`],
    )
  }
  const e = mdPathTestTree(t, MD_PATH_TEST_FOO, null, "extract-mini")
  if (e !== null) {
    mkdirAll(e.md, 0o755).expect("the .md as a directory")
    t.eqLines(
      "an XML reader refusal names the XML when the .md beside it is a directory",
      mdPathTestLines(mdPathTestRun(e, readers)),
      [`${e.xml}:3: ${MD_PATH_TEST_ROOT}`],
    )
  }
}

/** A refusal's file and line, `file:line`. */
const mdPathTestAt = (line: string): string => {
  const parts = split(line, ": ")
  return parts[0]
}

/** A refusal's message, without its file and line. */
const mdPathTestMessage = (line: string): string => {
  const at = line.indexOf(": ")
  return at < 0 ? line : line.substring(at + 2)
}

/** The offset of a `file:line`'s last colon. */
const mdPathTestColon = (at: string): i32 => {
  let i = at.length - 1
  while (i >= 0 && at.charCodeAt(i) !== 58) {
    i = i - 1
  }
  return i
}

/** A place's last line, the XML line of `md:line (xml:line)`; 0 when it has none. */
const mdPathTestLineOf = (at: string): i32 => {
  let n = 0
  for (let i = mdPathTestColon(at) + 1; i < at.length && at.charCodeAt(i) >= 48 && at.charCodeAt(i) <= 57; i++) {
    n = n * 10 + (at.charCodeAt(i) - 48)
  }
  return n
}

/** A `file:line`'s file. */
const mdPathTestFileOf = (at: string): string => at.substring(0, mdPathTestColon(at))

/** The refusals of `xml` with its .md beside it and without: the same messages, in the same order. */
class MdPathTestBoth {
  md: string[]
  xml: string[]
  withMd: MdPathTestTree
  withoutMd: MdPathTestTree
  /**
   * Both runs.
   *
   * @param md the refusals with the .md
   * @param xml the refusals without it
   * @param withMd the tree with the .md
   * @param withoutMd the tree without it
   */
  constructor(md: string[], xml: string[], withMd: MdPathTestTree, withoutMd: MdPathTestTree) {
    this.md = md
    this.xml = xml
    this.withMd = withMd
    this.withoutMd = withoutMd
  }
}

/** Extract `xml` with the fixture's .md beside it, and without; null after failing the test. */
const mdPathTestBoth = (
  t: Suite,
  name: string,
  xml: string,
  md: string,
  readers: SourceReaders,
): MdPathTestBoth | null => {
  const a = mdPathTestTree(t, xml, md, "extract-mini")
  const b = mdPathTestTree(t, xml, null, "extract-mini")
  if (a === null || b === null) {
    return null
  }
  const ra = mdPathTestRun(a, readers)
  const rb = mdPathTestRun(b, readers)
  t.ok(`${name}: refused with the .md`, ra.refusals.length > 0 && ra.errors.length === 0)
  t.ok(`${name}: refused without it`, rb.refusals.length > 0 && rb.errors.length === 0)
  const la = mdPathTestLines(ra)
  const lb = mdPathTestLines(rb)
  t.eqLines(`${name}: the same refusals either way`, la.map(mdPathTestMessage), lb.map(mdPathTestMessage))
  return new MdPathTestBoth(la.map(mdPathTestAt), lb.map(mdPathTestAt), a, b)
}

/** The line `n` (from 1) of `s`. */
const mdPathTestLineAt = (s: string, n: i32): string => {
  const lines = split(s, "\n")
  return n >= 1 && n <= lines.length ? lines[n - 1] : ""
}

/** Each place's line, minus `minus`, as text. */
const mdPathTestLinesOf = (ats: string[], minus: i32): string =>
  ats.map((a: string): string => `${mdPathTestLineOf(a) - minus}`).join(" ")

// extract-mini.xml's last unsigned `<?line N?>` is `<?line 21?>` on XML line
// 30; the XML runs ahead of the markdown after it (one XML line per table
// cell), so a refusal below it names md line 21 and its own XML line.

/** Whether every place is the .md at `mdLine` together with the XML at some line. */
const mdPathTestNear = (ats: string[], tr: MdPathTestTree, mdLine: i32): boolean =>
  ats.every((a: string): boolean => a.startsWith(`${tr.md}:${mdLine} (${tr.xml}:`) && a.endsWith(")"))

/** A profile refusal names the .md at a markdown line, else the XML at its line. */
const mdPathTestProfile = (t: Suite, mini: string, md: string, readers: SourceReaders): void => {
  const xml = replaceAll(mini, ' anchor="R-ENC-DIGITS"', "")
  const r = mdPathTestBoth(t, "a profile refusal", xml, md, readers)
  if (r !== null) {
    const name = "a profile refusal at a markdown line names the .md; with no .md, the XML at its line"
    t.ok(`${name}: the .md at the last mark, with the XML line`, mdPathTestNear(r.md, r.withMd, 21))
    t.ok(
      `${name}: the XML`,
      r.xml.every((a: string): boolean => mdPathTestFileOf(a) === r.withoutMd.xml),
    )
    // Not md line 55, where adding the lines since the mark would put the
    // sentence: it is on md line 52, and nothing in the XML says so.
    t.eqStr(`${name}: lines`, mdPathTestLinesOf(r.md, 0), mdPathTestLinesOf(r.xml, 0))
    t.eqStr(`${name}: the sentence's XML line`, mdPathTestLinesOf([r.md[0]], 0), "64")
    t.contains(`${name}: at the sentence`, mdPathTestLineAt(xml, mdPathTestLineOf(r.xml[0])), "Each byte <bcp14>MUST")
  }

  const bad = "export const hexDecode = (text: string): u8[] | null"
  const junk = replaceAll(mini, bad, `${bad} junk`)
  const s = mdPathTestBoth(t, "a ts-interface refusal", junk, md, readers)
  if (s !== null) {
    const name = "a profile refusal in a ts-interface block is at the line in the block, in either file"
    t.eqStr(`${name}: the .md`, s.md[0], `${s.withMd.md}:21 (${s.withMd.xml}:49:54)`)
    t.eqStr(`${name}: the XML, at the column of the junk`, s.xml[0], `${s.withoutMd.xml}:49:54`)
    t.eqStr(`${name}: the XML line`, mdPathTestLineAt(junk, 49), `${bad} junk`)
    // The functions the gates name are at their XML lines in the block too.
    t.eqStr(`${name}: every line`, mdPathTestLinesOf(s.md, 0), mdPathTestLinesOf(s.xml, 0))
  }

  const o = mdPathTestTree(t, mini, md, "other")
  if (o !== null) {
    t.eqLines(
      "a profile refusal at the root, which has no markdown line, names the XML",
      mdPathTestLines(mdPathTestRun(o, readers)),
      [`${o.xml}:10: docName "draft-extract-mini-00" names contract "extract-mini", but the file is other.xml`],
    )
  }
}

/**
 * The sidecar's refusals name the sidecar. (A gate refusal at its markdown
 * line is gate placement, tested with the gates.)
 */
const mdPathTestSidecar = (t: Suite, mini: string, md: string, readers: SourceReaders): void => {
  const s = mdPathTestTree(t, mini, md, "extract-mini")
  if (s !== null) {
    const side = joinPath(s.dir, "contracts/extract-mini.survivors.json")
    writeFileSync(side, '{"allowSurvivors":[{"line":3}]}')
    t.eqLines("a gate refusal of the sidecar still names the sidecar", mdPathTestLines(mdPathTestRun(s, readers)), [
      `${side}: shape: allowSurvivors[0].file: a non-empty string`,
      `${side}: shape: allowSurvivors[0].reason: a non-empty string`,
    ])
  }
}

/**
 * A refusal at a markdown line names the markdown file the XML was built from
 * (specs/<name>.md beside specs/<name>.xml); one with no markdown line, or
 * with no such file on disk, names the XML at its XML line.
 */
export const main = (): i32 => {
  const t = new Suite("spec/extract md path")
  const readers = extractReaders()
  const mini = readFileSyncOrNull(`${MD_PATH_TEST_FIXTURE}.xml`)
  const md = readFileSyncOrNull(`${MD_PATH_TEST_FIXTURE}.md`)
  if (readers.isErr() || mini === null || md === null) {
    t.fail("the readers and the fixture", readers.isErr() ? readers.error : "cannot read the fixture")
    return t.done()
  }
  mdPathTestReader(t, readers.value)
  mdPathTestProfile(t, mini, md, readers.value)
  mdPathTestSidecar(t, mini, md, readers.value)
  return t.done()
}
