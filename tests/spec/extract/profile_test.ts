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

/**
 * A refusal's place is the markdown line alone only on a mark's own XML line;
 * below a mark it is the mark's markdown line with the XML line; it is the
 * XML line when there is no markdown, no mark, or a mark past the .md's end.
 */
const profileTestWhere = (t: Suite): void => {
  const md = new ProfileMd("a.md", 50)
  t.eqStr("on the mark's own line", profileWhereText(profileWhere(15, 40, 15, "a.xml", md)), "a.md:40")
  t.eqStr("below the mark", profileWhereText(profileWhere(20, 40, 15, "a.xml", md)), "a.md:40 (a.xml:20)")
  t.eqStr("no mark before it", profileWhereText(profileWhere(15, -1, 0, "a.xml", md)), "a.xml:15")
  t.eqStr("no markdown file", profileWhereText(profileWhere(15, 40, 15, "a.xml", null)), "a.xml:15")
  t.eqStr("the last markdown line", profileWhereText(profileWhere(15, 50, 15, "a.xml", md)), "a.md:50")
  t.eqStr("past the markdown's end", profileWhereText(profileWhere(15, 51, 15, "a.xml", md)), "a.xml:15")
  const r = profileRefusalAt(profileWhere(20, 40, 15, "a.xml", md), 7, "why")
  t.eqStr(
    "a refusal keeps both places and the column",
    `${r.file}:${r.line} ${r.exactFile}:${r.exactLine}:${r.col} ${r.message}`,
    "a.md:40 a.xml:20:7 why",
  )
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
    "a refusal at its markdown line",
    kramdown,
    "tests/fixtures/xmlv3/kramdown.md:17 (tests/fixtures/xmlv3/kramdown.xml:57) a <texttable> is v2 XML; write a v3 <table> (xml2rfc --v2v3 converts one)",
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
  profileTestMdRead(t)
  profileTestLocate(t)
  profileTestMini(t)
  profileTestRefusals(t)
  return t.done()
}
