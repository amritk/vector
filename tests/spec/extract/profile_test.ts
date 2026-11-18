import { Suite } from "nish/testing"
import { joinPath, makeTempDir } from "../../../src/core/fs"
import {
  ProfileLocator,
  ProfileMd,
  ProfileRefusal,
  ProfileRfcs,
  ProfileWhere,
  profileLocate,
  profileMdRead,
  profileRead,
  profileRefusalAt,
  profileRefusalOrder,
  profileRefusalPlace,
  profileWhere,
  profileWhereText,
} from "../../../src/spec/profile/profile"
import { xmlDocParse, xmlRead } from "../../../src/spec/xml/doc"

const PROFILE_TEST_MINI: string = "tests/fixtures/rfc-main/specs/mini-frame.xml"

/** The RFCs handed to the profile: `rfcPath` as RFC `rfc`, or none when `rfc` is 0. */
const profileTestRfcs = (t: Suite, rfc: i32, rfcPath: string): ProfileRfcs => {
  const rfcs = new ProfileRfcs()
  if (rfc > 0) {
    const d = xmlRead(readFileSyncOrNull(rfcPath) ?? "", rfcPath)
    if (d.isErr()) {
      t.fail("the RFC reads", d.error)
    } else {
      rfcs.docs.set(rfc, d.value)
    }
  }
  return rfcs
}

/** Reads a spec under the profile: `ok <contract>`, or each refusal as `file:line message`. */
const profileTestRead = (xmlPath: string, mdPath: string | null, rfcs: ProfileRfcs): string => {
  const doc = xmlDocParse(readFileSyncOrNull(xmlPath) ?? "")
  if (doc.isErr()) {
    return `xml ${doc.error.message}`
  }
  const r = profileRead(doc.value, xmlPath, profileMdRead(mdPath), rfcs)
  if (r.isErr()) {
    return r.error
      .map((f: ProfileRefusal): string => `${profileWhereText(profileWhereOfRefusal(f))} ${f.message}`)
      .join("\n")
  }
  return `ok ${r.value.contract.contract}`
}

/** A refusal's place, back as a ProfileWhere. */
const profileWhereOfRefusal = (f: ProfileRefusal): ProfileWhere => {
  const w = new ProfileWhere(f.file, f.line)
  w.exactFile = f.exactFile
  w.exactLine = f.exactLine
  return w
}

/** One place: its XML line, the mark's markdown and XML lines, its text, and where it is printed. */
class ProfileTestPlace {
  name: string
  line: i32
  mdLine: i32
  markLine: i32
  text: string
  want: string
  constructor(name: string, line: i32, mdLine: i32, markLine: i32, text: string, want: string) {
    this.name = name
    this.line = line
    this.mdLine = mdLine
    this.markLine = markLine
    this.text = text
    this.want = want
  }
}

/**
 * A refusal's place is the markdown line alone only on a mark's own XML line;
 * below a mark it is the one markdown line, after the mark and before the
 * next part, that holds the place's text, with the XML line; it is the XML
 * line alone when no line or several hold the text, or there is no markdown,
 * no mark, or a mark past the .md's end.
 */
const profileTestWhere = (t: Suite): void => {
  const md = new ProfileMd("a.md", 16)
  md.text = [
    "--- middle",
    "",
    "The decoder MUST NOT allocate twice.",
    "| TAG-1 | 00 | ff |",
    "> Iterate: X-1 1,000 times, (k, u) <- (f(k, u), k)",
    "This paragraph wraps after the sixteen",
    "characters it needs to be found.",
    "| TAG-2 | 01 |",
    "| TAG-2 | 02 |",
    "| TAG-0 | TAG-3 |",
    "--- back",
    "The decoder MUST NOT allocate twice.",
    "The encoder *MUST NOT* drop a byte.",
    "It quotes: The encoder MUST NOT drop a byte.",
    "The _framer_ **MUST** pad.",
    "",
  ]
  const cases: ProfileTestPlace[] = [
    new ProfileTestPlace("on the mark's own line", 15, 1, 15, "anything", "a.md:1"),
    new ProfileTestPlace(
      "a sentence below the mark, its copy in a later part not counted",
      20,
      1,
      15,
      "The decoder MUST NOT allocate twice.",
      "a.md:3 (a.xml:20)",
    ),
    new ProfileTestPlace("a table row by its first cell", 21, 1, 15, "| TAG-1 |", "a.md:4 (a.xml:21)"),
    new ProfileTestPlace("a blockquote's paragraph", 22, 1, 15, "Iterate: X-1 1,000 times,", "a.md:5 (a.xml:22)"),
    new ProfileTestPlace(
      "a paragraph that wraps",
      23,
      1,
      15,
      "This paragraph wraps after the sixteen characters it needs to be found.",
      "a.md:6 (a.xml:23)",
    ),
    new ProfileTestPlace("the same text twice", 24, 1, 15, "| TAG-2 |", "a.xml:24"),
    new ProfileTestPlace(
      "a first cell only where a row starts, not another row's later cell",
      28,
      1,
      15,
      "| TAG-3 |",
      "a.xml:28",
    ),
    new ProfileTestPlace("text the markdown does not hold", 25, 1, 15, "Nowhere in it.", "a.xml:25"),
    new ProfileTestPlace("no text", 26, 1, 15, "", "a.xml:26"),
    new ProfileTestPlace("a short wrapped start is not enough", 27, 1, 15, "found. And more", "a.xml:27"),
    new ProfileTestPlace(
      "a later part's mark, the line in its own part",
      40,
      11,
      38,
      "The decoder MUST NOT allocate twice.",
      "a.md:12 (a.xml:40)",
    ),
    new ProfileTestPlace(
      "an emphasised sentence quoted plainly too, on two lines",
      41,
      11,
      38,
      "The encoder MUST NOT drop a byte.",
      "a.xml:41",
    ),
    new ProfileTestPlace(
      "an emphasised sentence, by its text",
      42,
      11,
      38,
      "The framer MUST pad.",
      "a.md:15 (a.xml:42)",
    ),
    new ProfileTestPlace("no mark before it", 15, -1, 0, "The decoder MUST NOT allocate twice.", "a.xml:15"),
    new ProfileTestPlace("the last markdown line", 15, 16, 15, "", "a.md:16"),
    new ProfileTestPlace("past the markdown's end", 15, 17, 15, "", "a.xml:15"),
  ]
  for (const k of cases) {
    const w = profileWhere(k.line, k.mdLine, k.markLine, "a.xml", md, k.text)
    t.eqStr(k.name, profileWhereText(w), k.want)
    // Whichever line is printed, the place keeps the XML line it is on.
    t.eqI32(`${k.name}: its XML line`, profileRefusalAt(w, 0, "why").xmlLine, k.line)
  }
  t.eqStr(
    "no markdown file",
    profileWhereText(profileWhere(15, 1, 15, "a.xml", null, "The decoder MUST NOT allocate twice.")),
    "a.xml:15",
  )
  const r = profileRefusalAt(profileWhere(20, 1, 15, "a.xml", md, "The decoder MUST NOT allocate twice."), 7, "why")
  t.eqStr(
    "a refusal keeps both places and the column",
    `${r.file}:${r.line} ${r.exactFile}:${r.exactLine}:${r.col} ${r.message}`,
    "a.md:3 a.xml:20:7 why",
  )
  t.eqI32(
    "an XML column does not go on a markdown line alone",
    profileRefusalAt(profileWhere(15, 1, 15, "a.xml", md, ""), 7, "why").col,
    0,
  )
  t.eqI32(
    "it goes on the XML line alone",
    profileRefusalAt(profileWhere(25, 1, 15, "a.xml", md, "Nowhere in it."), 7, "why").col,
    7,
  )
}

/** A refusal printed at `file:line`, raised at XML line `xml`, column `col`. */
const profileTestRefusal = (file: string, line: i32, xml: i32, col: i32, message: string): ProfileRefusal => {
  const r = new ProfileRefusal(file, line, col, message)
  r.xmlLine = xml
  return r
}

/** One ordering case: two refusals, and which comes first. */
class ProfileTestOrder {
  name: string
  a: ProfileRefusal
  b: ProfileRefusal
  want: i32
  constructor(name: string, a: ProfileRefusal, b: ProfileRefusal, want: i32) {
    this.name = name
    this.a = a
    this.b = b
    this.want = want
  }
}

/** Refusals go in XML document order, then by column, then message (the place alone ties on message), whichever line each prints. */
const profileTestOrder = (t: Suite): void => {
  const cases: ProfileTestOrder[] = [
    new ProfileTestOrder(
      "an earlier XML line printed at a larger XML line number than a later markdown one",
      profileTestRefusal("a.xml", 253, 253, 0, "b"),
      profileTestRefusal("a.md", 146, 255, 0, "a"),
      -1,
    ),
    new ProfileTestOrder(
      "a markdown line found out of the XML's order",
      profileTestRefusal("a.md", 40, 20, 0, "b"),
      profileTestRefusal("a.md", 30, 21, 0, "a"),
      -1,
    ),
    new ProfileTestOrder(
      "a later XML line",
      profileTestRefusal("a.xml", 9, 9, 0, "a"),
      profileTestRefusal("a.xml", 8, 8, 0, "b"),
      1,
    ),
    new ProfileTestOrder(
      "one XML line: the column first",
      profileTestRefusal("a.xml", 9, 9, 3, "z"),
      profileTestRefusal("a.xml", 9, 9, 7, "a"),
      -1,
    ),
    new ProfileTestOrder(
      "one place: the message",
      profileTestRefusal("a.xml", 9, 9, 3, "b"),
      profileTestRefusal("a.xml", 9, 9, 3, "a"),
      1,
    ),
    new ProfileTestOrder(
      "one place and message",
      profileTestRefusal("a.xml", 9, 9, 3, "a"),
      profileTestRefusal("a.xml", 9, 9, 3, "a"),
      0,
    ),
  ]
  for (const k of cases) {
    t.eqI32(k.name, profileRefusalOrder(k.a, k.b), k.want)
    t.eqI32(`${k.name}, swapped`, profileRefusalOrder(k.b, k.a), -k.want)
    // The place alone ties every case at one place, message or not, so the
    // gates' stable sort keeps the order they found them in.
    const place = k.a.xmlLine === k.b.xmlLine && k.a.col === k.b.col ? 0 : k.want
    t.eqI32(`${k.name}, place only`, profileRefusalPlace(k.a, k.b), place)
    t.eqI32(`${k.name}, place only, swapped`, profileRefusalPlace(k.b, k.a), -place)
  }
}

/** A markdown file's record counts its lines, with or without a final newline. */
const profileTestMdRead = (t: Suite): void => {
  const md = profileMdRead("tests/fixtures/xmlv3/kramdown.md")
  t.ok("the .md reads", md !== null)
  if (md !== null) {
    t.eqStr("its lines, the last ending in a newline", `${md.path}:${md.lines}`, "tests/fixtures/xmlv3/kramdown.md:42")
  }
  const dir = makeTempDir("vector-profile-md-")
  if (dir.isOk()) {
    const path = joinPath(dir.value, "a.md")
    writeFileSync(path, "one\ntwo")
    const two = profileMdRead(path)
    t.eqStr("its lines, the last with no newline", two !== null ? `${two.lines}` : "none", "2")
    const empty = joinPath(dir.value, "empty.md")
    writeFileSync(empty, "")
    const none = profileMdRead(empty)
    t.eqStr("an empty .md has no lines, so no place is in it", none !== null ? `${none.lines}` : "none", "0")
  }
  t.ok("no path, no record", profileMdRead(null) === null)
  t.ok("a missing file, no record", profileMdRead("tests/fixtures/xmlv3/absent.md") === null)
}

/** A locator names a part's line, its nearest named parent's, or the root's. */
const profileTestLocate = (t: Suite): void => {
  const l = new ProfileLocator(new ProfileWhere("s.xml", 2))
  l.at.set("R-ONE", new ProfileWhere("s.xml", 10))
  l.at.set("frame", new ProfileWhere("s.md", 30))
  const one = profileLocate(l, "R-ONE")
  t.eqStr("a part by id", `${one.file}:${one.line}`, "s.xml:10")
  const sub = profileLocate(l, "frame.result.len")
  t.eqStr("a sub-part falls back to its parent, in the parent's file", `${sub.file}:${sub.line}`, "s.md:30")
  const none = profileLocate(l, "nothing")
  t.eqStr("an unknown part is the root", `${none.file}:${none.line}`, "s.xml:2")
  const root = profileLocate(l, "")
  t.eqStr("the root", `${root.file}:${root.line}`, "s.xml:2")
}

/** A spec that reads, and where its parts were read. */
const profileTestMini = (t: Suite): void => {
  const rfcs = profileTestRfcs(t, 9990, "tests/fixtures/rfc-main/rfcs/rfc9990.xml")
  const doc = xmlDocParse(readFileSyncOrNull(PROFILE_TEST_MINI) ?? "")
  if (doc.isErr()) {
    t.fail("mini-frame parses", doc.error.message)
    return
  }
  const r = profileRead(doc.value, PROFILE_TEST_MINI, null, rfcs)
  if (r.isErr()) {
    t.fail("mini-frame reads", r.error.map((f: ProfileRefusal): string => f.message).join("; "))
    return
  }
  t.eqStr("the contract's name", r.value.contract.contract, "mini-frame")
  t.ok("no RFC is missing", rfcs.missing.length === 0)
  const req = profileLocate(r.value.locator, "R-PREFIX")
  t.eqStr("a requirement's line", `${req.file}:${req.line}`, `${PROFILE_TEST_MINI}:17`)
  const fn = profileLocate(r.value.locator, "frame")
  t.eqStr("a function's line", `${fn.file}:${fn.line}`, `${PROFILE_TEST_MINI}:12`)
  const root = profileLocate(r.value.locator, "")
  t.eqStr("the root's line", `${root.file}:${root.line}`, `${PROFILE_TEST_MINI}:2`)
}

/** Refusals name the markdown line when the `.md` is beside the spec, else the XML line. */
const profileTestRefusals = (t: Suite): void => {
  const kramdown = profileTestRead(
    "tests/fixtures/xmlv3/kramdown.xml",
    "tests/fixtures/xmlv3/kramdown.md",
    new ProfileRfcs(),
  )
  t.contains(
    "a refusal below a mark with no text to find it by, at its XML line",
    kramdown,
    "tests/fixtures/xmlv3/kramdown.xml:57 a <texttable> is v2 XML; write a v3 <table> (xml2rfc --v2v3 converts one)",
  )
  t.contains(
    "a refusal with no markdown line is at its XML line",
    kramdown,
    "tests/fixtures/xmlv3/kramdown.xml:15 a spec has exactly one ts-interface block; this one has 0",
  )
  const missing = new ProfileRfcs()
  const mini = profileTestRead(PROFILE_TEST_MINI, null, missing)
  t.contains("without its RFC, a cited section is refused", mini, `${PROFILE_TEST_MINI}:18 Section 2 of RFC9990`)
  t.ok("the RFC is recorded as missing", missing.missing.length === 1 && missing.missing[0] === 9990)
}

/** The profile: what a spec reads to, and where each refusal is. */
export const main = (): i32 => {
  const t = new Suite("spec/extract profile")
  profileTestWhere(t)
  profileTestOrder(t)
  profileTestMdRead(t)
  profileTestLocate(t)
  profileTestMini(t)
  profileTestRefusals(t)
  return t.done()
}
