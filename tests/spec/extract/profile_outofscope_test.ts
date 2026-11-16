import { Suite } from "nish/testing"
import { replaceAll } from "nish/text"
import { Contract } from "../../../src/spec/contract/types"
import { exportsDiff, exportsJudge } from "../../../src/spec/pr/exports"
import { PrReport } from "../../../src/spec/pr/report"
import { ProfileRefusal, ProfileRfcs, profileLocate, profileRead } from "../../../src/spec/profile/profile"
import { xmlDocParse } from "../../../src/spec/xml/doc"

// An `Out of scope: <export>, <reason>` paragraph in the profile: read into the
// contract's outOfScope, each malformed or contradictory form refused with its
// own message, and the exports gate then reporting the export as a note.

const PROFILE_OOS_FIXTURE: string = "tests/fixtures/profile/profile-outofscope.xml"
const PROFILE_OOS_REASON: string = "internal to fmathHalf; the spec specifies the result, not its bit layout"
const PROFILE_OOS_P: string =
  "<t>Out of scope: fmathHalfBits, internal to fmathHalf; the spec specifies the result, not its bit layout</t>"
const PROFILE_OOS_FORM: string = "Out of scope: <export>, <the reason no clause tests it>"
const PROFILE_OOS_IFACE: string = "export function fmathHalf(x: f64): f64\n"
const PROFILE_OOS_MODULE: string = `export function fmathHalf(x: f64): f64 {
  return x / 2
}

export function fmathHalfBits(x: f64): u64 {
  return 0
}
`

/** The fixture with its Out of scope: paragraph replaced by `p`. */
const profileOosTestWith = (xml: string, p: string): string => replaceAll(xml, PROFILE_OOS_P, p)

/** The profile's refusals of `xml`, each `line message`; "ok" when it reads. */
const profileOosTestRead = (xml: string): string => {
  const doc = xmlDocParse(xml)
  if (doc.isErr()) {
    return `xml ${doc.error.line} ${doc.error.message}`
  }
  const r = profileRead(doc.value, "specs/profile-outofscope.xml", null, new ProfileRfcs())
  if (r.isErr()) {
    return r.error.map((f: ProfileRefusal): string => `${f.line} ${f.message}`).join("\n")
  }
  return "ok"
}

/** The exports report for a module that adds fmathHalf and fmathHalfBits, judged against `c`. */
const profileOosTestJudge = (c: Contract): PrReport => {
  const r = new PrReport("exports", "spec exports of std/fmath.ts against main")
  exportsJudge(r, c, exportsDiff("", PROFILE_OOS_MODULE))
  return r
}

/** Runs the suite. */
export const main = (): number => {
  const t = new Suite("spec/extract profile out of scope")
  const xml = readFileSyncOrNull(PROFILE_OOS_FIXTURE) ?? ""
  t.ok("the fixture holds the paragraph", xml.indexOf(PROFILE_OOS_P) >= 0)

  const doc = xmlDocParse(xml)
  t.ok("the fixture parses", doc.isOk())
  if (doc.isOk()) {
    const r = profileRead(doc.value, PROFILE_OOS_FIXTURE, null, new ProfileRfcs())
    t.ok("the fixture reads", r.isOk())
    if (r.isOk()) {
      const c = r.value.contract
      const list = c.outOfScope ?? []
      t.eqI32("one export is out of scope", list.length, 1)
      if (list.length === 1) {
        t.eqStr("its name", list[0].name, "fmathHalfBits")
        t.eqStr("its reason", list[0].reason, PROFILE_OOS_REASON)
      }
      t.eqI32("the locator places it", profileLocate(r.value.locator, "outOfScope[0]").line, 48)

      const yes = profileOosTestJudge(c)
      t.eqStr("out of scope, the gate passes", yes.problems.join("\n"), "")
      t.eqStr(
        "and reports it as a note",
        yes.notes.join("\n"),
        `export fmathHalfBits is added, out of scope: ${PROFILE_OOS_REASON}`,
      )
      c.outOfScope = null
      const no = profileOosTestJudge(c)
      t.eqStr(
        "without it, the gate fails",
        no.problems.join("\n"),
        "export fmathHalfBits is added, but the contract neither tests it nor lists it in outOfScope with a reason",
      )
    }
  }

  t.eqStr(
    "a BCP 14 keyword in the reason is quoted, not used",
    profileOosTestRead(
      profileOosTestWith(xml, "<t>Out of scope: fmathHalfBits, no caller <bcp14>MUST</bcp14> read its bits</t>"),
    ),
    "ok",
  )
  t.eqStr(
    "no comma",
    profileOosTestRead(profileOosTestWith(xml, "<t>Out of scope: fmathHalfBits</t>")),
    `48 an Out of scope: paragraph gives a reason after a comma: ${PROFILE_OOS_FORM}`,
  )
  t.eqStr(
    "no reason",
    profileOosTestRead(profileOosTestWith(xml, "<t>Out of scope: fmathHalfBits, </t>")),
    `48 fmathHalfBits is out of scope with no reason: ${PROFILE_OOS_FORM}`,
  )
  t.eqStr(
    "not an identifier",
    profileOosTestRead(profileOosTestWith(xml, "<t>Out of scope: half bits, two words</t>")),
    `48 out-of-scope export "half bits" is not an identifier: ${PROFILE_OOS_FORM}`,
  )
  t.eqStr(
    "named twice",
    profileOosTestRead(profileOosTestWith(xml, `${PROFILE_OOS_P}\n<t>Out of scope: fmathHalfBits, again</t>`)),
    "49 fmathHalfBits is already out of scope; give each export one Out of scope: paragraph",
  )
  t.eqStr(
    "a function under test",
    profileOosTestRead(profileOosTestWith(xml, "<t>Out of scope: fmathHalf, it is tested anyway</t>")),
    "48 fmathHalf is a function under test, so it cannot be out of scope",
  )
  const withRef = replaceAll(
    replaceAll(
      xml,
      PROFILE_OOS_IFACE,
      `${PROFILE_OOS_IFACE}export function fmathTwice(n: i32): i32\n// module: nish/fref\nexport function frefTwice(n: i32): i32\n`,
    ),
    '</section>\n    <section anchor="vectors">',
    `<sourcecode type="ts-property"><![CDATA[
// P-TWICE covers R-HALF — twice agrees with the reference
forall (n: i32 /* -8..8 */) => fmathTwice(n) === frefTwice(n)
]]></sourcecode>
    </section>
    <section anchor="vectors">`,
  )
  t.ok("the reference function case is built", withRef.indexOf("frefTwice(n)") >= 0)
  t.eqStr("a property calling a reference function reads", profileOosTestRead(withRef), "ok")
  t.eqStr(
    "a reference function a property calls",
    profileOosTestRead(profileOosTestWith(withRef, "<t>Out of scope: frefTwice, only a reference</t>")),
    "51 frefTwice is called by property P-TWICE, so it cannot be out of scope",
  )
  return t.done()
}
