import { Suite } from "nish/testing"
import {
  ProfileLocator,
  ProfileRefusal,
  ProfileRfcs,
  profileLocate,
  profileRead,
  profileWhere,
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
  const r = profileRead(doc.value, xmlPath, mdPath, rfcs)
  if (r.isErr()) {
    return r.error.map((f: ProfileRefusal): string => `${f.file}:${f.line} ${f.message}`).join("\n")
  }
  return `ok ${r.value.contract.contract}`
}

/** A refusal's place is the markdown line when there is one, else the XML line. */
const profileTestWhere = (t: Suite): void => {
  const md = profileWhere(15, 40, "a.xml", "a.md")
  t.eqStr("with a markdown line and file", `${md.file}:${md.line}`, "a.md:40")
  const noMdLine = profileWhere(15, -1, "a.xml", "a.md")
  t.eqStr("no markdown line", `${noMdLine.file}:${noMdLine.line}`, "a.xml:15")
  const noMd = profileWhere(15, 40, "a.xml", null)
  t.eqStr("no markdown file", `${noMd.file}:${noMd.line}`, "a.xml:15")
}

/** A locator names a part's line, its nearest named parent's, or the root's. */
const profileTestLocate = (t: Suite): void => {
  const l = new ProfileLocator("s.xml", 2)
  l.at.set("R-ONE", 10)
  l.at.set("frame", 30)
  l.files.set("frame", "s.md")
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
    "tests/fixtures/xmlv3/kramdown.md:25 a <texttable> is v2 XML; write a v3 <table> (xml2rfc --v2v3 converts one)",
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
  profileTestLocate(t)
  profileTestMini(t)
  profileTestRefusals(t)
  return t.done()
}
