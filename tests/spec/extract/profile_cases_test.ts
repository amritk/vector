import { JSON_VALUE_OBJECT } from "nish/json-value"
import { Suite } from "nish/testing"
import { replaceAll } from "nish/text"
import { jsonMember, newJsonDocument, parseJson } from "../../../src/core/json"
import { LITERALS_BYTES } from "../../../src/spec/contract/literals"
import { contractFromJson } from "../../../src/spec/contract/read"
import {
  Clause,
  Contract,
  LitKind,
  Literal,
  Requirement,
  VectorSource,
  VectorSourceKind,
} from "../../../src/spec/contract/types"
import { contractWrite } from "../../../src/spec/contract/write"
import { ProfileRefusal, ProfileRfcs, profileLocate, profileRead } from "../../../src/spec/profile/profile"
import { RfcDocument, rfcParse } from "../../../src/spec/source/rfc"
import { xmlDocParse, xmlRead } from "../../../src/spec/xml/doc"

// The pinned cases of the profile, each a spec snippet and what it reads to:
// the contract, or every refusal at its line (and column, when it has one).

const PROFILE_CASES_PATH: string = "specs/t.xml"

const PROFILE_CASES_REFS: string = `<references>
<reference anchor="RFC4648"><front><title>B</title></front><seriesInfo name="RFC" value="4648"/></reference>
<reference anchor="RFC8707"><front><title>R</title></front><seriesInfo name="RFC" value="8707"/></reference>
<reference anchor="RFC9999"><front><title>M</title></front><seriesInfo name="RFC" value="9999"/></reference>
<reference anchor="RFC5869"><front><title>H</title></front><seriesInfo name="RFC" value="5869"/></reference>
<reference anchor="BOOK"><front><title>N</title></front></reference>
</references>`

const PROFILE_CASES_IFACE_CODE: string = `
// module: nish/hex
export function hexDecode(text: string): u8[] | null
export function hexEncode(bytes: u8[]): string
export function isHex(text: string): boolean
`

const PROFILE_CASES_REQ: string = `<t anchor="R-A">hexDecode <bcp14>MUST</bcp14> work.</t>`
const PROFILE_CASES_RFC10: string = `<xref target="RFC4648" section="10"/>`
const PROFILE_CASES_BYTES_HINT: string = LITERALS_BYTES
const PROFILE_CASES_LABELLED: string =
  "a labelled value is `Label = hex` (lowercase hex pairs with no spaces), `Label = 42` or `Label = 22 × 0b`"
const PROFILE_CASES_ID_RULE: string = `is not letters, digits, ".", "_" and "-", starting with a letter or digit`
const PROFILE_CASES_EXCLUDES_NOTHING: string =
  "this Untested: paragraph excludes nothing; it must directly follow the requirement or BCP 14 paragraph it excludes"
const PROFILE_CASES_HEADER_IS: string =
  "a vector table's header is Id | Call | Expected | Covers | Source | Title, not "

/** The RFCs in `rfcs/`, read once and handed to every case. */
class ProfileCasesTestRfcs {
  docs: Map<i32, RfcDocument>

  constructor() {
    this.docs = new Map<i32, RfcDocument>()
  }
}

/** The repository's RFCs: 4648 and 5869 as text, 8707 as XML. */
const profileCasesTestLoad = (t: Suite): ProfileCasesTestRfcs => {
  const out = new ProfileCasesTestRfcs()
  out.docs.set(4648, rfcParse(readFileSyncOrNull("rfcs/rfc4648.txt") ?? ""))
  out.docs.set(5869, rfcParse(readFileSyncOrNull("rfcs/rfc5869.txt") ?? ""))
  const x = xmlRead(readFileSyncOrNull("rfcs/rfc8707.xml") ?? "", "rfc8707.xml")
  if (x.isErr()) {
    t.fail("rfc8707.xml reads", x.error)
  } else {
    out.docs.set(8707, x.value)
  }
  return out
}

/** A fresh set of RFCs to hand over: every one in `rfcs/`, none recorded missing. */
const profileCasesTestRfcs = (all: ProfileCasesTestRfcs): ProfileRfcs => {
  const r = new ProfileRfcs()
  for (const n of [4648, 5869, 8707]) {
    const d = all.docs.get(n)
    if (d !== undefined) {
      r.docs.set(n, d)
    }
  }
  return r
}

// ── Spec builders ───────────────────────────────────────────────────────────

const profileCasesTestIface = (code: string): string =>
  `<sourcecode type="ts-interface"><![CDATA[${code}]]></sourcecode>`

const profileCasesTestIfaceSection = (): string =>
  `<section><name>Interface</name>${profileCasesTestIface(PROFILE_CASES_IFACE_CODE)}</section>`

/** A one-file spec named `docName`: `head`, then `middle`; its middle starts on line 2. */
const profileCasesTestSpecWith = (middle: string, docName: string, head: string): string =>
  `<rfc docName="${docName}" version="3"><front><title>T</title></front><middle>
${head}${middle}</middle><back>${PROFILE_CASES_REFS}</back></rfc>`

/** A spec `draft-t-00` with the interface section, then `middle`, from line 7. */
const profileCasesTestSpec = (middle: string): string =>
  profileCasesTestSpecWith(middle, "draft-t-00", profileCasesTestIfaceSection())

/** A spec whose main source is named by `keyword`, with every reference normative. */
const profileCasesTestSpecMain = (middle: string, keywords: string): string =>
  `<rfc docName="draft-t-00" version="3"><front><title>T</title>${keywords}</front><middle>
${profileCasesTestIfaceSection()}${middle}</middle><back>${replaceAll(
    PROFILE_CASES_REFS,
    "<references>",
    "<references><name>Normative References</name>",
  )}</back></rfc>`

const profileCasesTestSec = (body: string, attrs: string): string => `<section${attrs}><name>S</name>${body}</section>`

const profileCasesTestTt = (s: string): string => `<tt>${s}</tt>`

const profileCasesTestRow = (cells: string[]): string =>
  `<tr>${cells.map((c: string): string => `<td>${c}</td>`).join("")}</tr>`

const profileCasesTestHeader = (): string[] => ["Id", "Call", "Expected", "Covers", "Source", "Title"]

/** A table headed `header`, one row a line from the line after the table's. */
const profileCasesTestTableWith = (rows: string[], header: string[]): string =>
  `<table><thead><tr>${header.map((h: string): string => `<th>${h}</th>`).join("")}</tr></thead><tbody>\n${rows.join("\n")}</tbody></table>`

const profileCasesTestTable = (rows: string[]): string => profileCasesTestTableWith(rows, profileCasesTestHeader())

/** A vector row from its six raw cells. */
const profileCasesTestCells = (
  id: string,
  call: string,
  expected: string,
  covers: string,
  source: string,
  title: string,
): string => profileCasesTestRow([id, call, expected, covers, source, title])

/** A vector row `id`: `call` gives `expected`, covers R-A, from Section 10 of RFC4648. */
const profileCasesTestVectorId = (id: string, call: string, expected: string): string =>
  profileCasesTestCells(
    id,
    profileCasesTestTt(call),
    profileCasesTestTt(expected),
    "R-A",
    PROFILE_CASES_RFC10,
    "a title",
  )

const profileCasesTestVector = (call: string, expected: string): string =>
  profileCasesTestVectorId("V1", call, expected)

/** A vector `id` of `hexDecode("66")` with `source` as its Source cell. */
const profileCasesTestSrc = (source: string, expected: string, id: string): string =>
  profileCasesTestCells(
    id,
    profileCasesTestTt('hexDecode("66")'),
    profileCasesTestTt(expected),
    "R-A",
    source,
    "a title",
  )

/** A section holding R-A and one vector covering it, sourced from the section itself. */
const profileCasesTestMin = (): string =>
  profileCasesTestSec(
    PROFILE_CASES_REQ + profileCasesTestTable([profileCasesTestSrc(`<xref target="min"/>`, '"f"', "V1")]),
    ' anchor="min"',
  )

const profileCasesTestProperty = (code: string): string =>
  `<sourcecode type="ts-property"><![CDATA[\n${code}\n]]></sourcecode>`

/** A property covering R-D and R-N. */
const profileCasesTestCoverDn = (): string =>
  profileCasesTestProperty("// P-DN covers R-D, R-N — t\nforall (b: u8[] /* 0..4 */) => hexEncode(b) === hexEncode(b)")

/** A spec whose one numbered section holds `ls`, one a line, the first on line 8. */
const profileCasesTestLines = (ls: string[]): string =>
  profileCasesTestSpec(profileCasesTestSec(`\n${ls.join("\n")}\n`, ' numbered="true"'))

// ── Reading ─────────────────────────────────────────────────────────────────

/** One refusal as `line[:col] message`, its file named when it is not `path`. */
const profileCasesTestOne = (f: ProfileRefusal, path: string): string => {
  const file = f.file === path ? "" : `${f.file}:`
  const col = f.col > 0 ? `:${f.col}` : ""
  return `${file}${f.line}${col} ${f.message}`
}

/** Reads `xml` at `path`: `ok`, `xml <line> <message>`, or each refusal on its own line. */
const profileCasesTestReadAt = (all: ProfileCasesTestRfcs, xml: string, path: string): string => {
  const doc = xmlDocParse(xml)
  if (doc.isErr()) {
    return `xml ${doc.error.line} ${doc.error.message}`
  }
  const r = profileRead(doc.value, path, null, profileCasesTestRfcs(all))
  if (r.isErr()) {
    return r.error.map((f: ProfileRefusal): string => profileCasesTestOne(f, path)).join("\n")
  }
  return "ok"
}

const profileCasesTestRead = (all: ProfileCasesTestRfcs, xml: string): string =>
  profileCasesTestReadAt(all, xml, PROFILE_CASES_PATH)

/** Only the messages of the refusals, one a line. */
const profileCasesTestMessages = (all: ProfileCasesTestRfcs, xml: string): string => {
  const doc = xmlDocParse(xml)
  if (doc.isErr()) {
    return `xml ${doc.error.message}`
  }
  const r = profileRead(doc.value, PROFILE_CASES_PATH, null, profileCasesTestRfcs(all))
  if (r.isErr()) {
    return r.error.map((f: ProfileRefusal): string => f.message).join("\n")
  }
  return "ok"
}

/** The contract `xml` reads to; null, with a failure, when it is refused. */
const profileCasesTestContract = (t: Suite, all: ProfileCasesTestRfcs, name: string, xml: string): Contract | null => {
  const doc = xmlDocParse(xml)
  if (doc.isErr()) {
    t.fail(name, `xml ${doc.error.message}`)
    return null
  }
  const r = profileRead(doc.value, PROFILE_CASES_PATH, null, profileCasesTestRfcs(all))
  if (r.isErr()) {
    t.fail(name, r.error.map((f: ProfileRefusal): string => profileCasesTestOne(f, PROFILE_CASES_PATH)).join("; "))
    return null
  }
  return r.value.contract
}

/** A requirement as `id source section level quote`, `-` for no source. */
const profileCasesTestReq = (q: Requirement): string => `${q.id} ${q.source ?? "-"} ${q.section} ${q.level} ${q.quote}`

const profileCasesTestReqs = (c: Contract): string =>
  c.requirements.map((q: Requirement): string => profileCasesTestReq(q)).join("\n")

/** A vector's source as `cite <source> <section>`, `spec <section>` or `command <text>`. */
const profileCasesTestSource = (s: VectorSource | null): string => {
  if (s === null) {
    return "none"
  }
  if (s.kind === VectorSourceKind.Cite) {
    const cite = s.cite
    if (cite === null) {
      return "cite ?"
    }
    return `cite ${cite.source ?? "-"} ${cite.section}`
  }
  if (s.kind === VectorSourceKind.Spec) {
    return `spec ${s.text}`
  }
  return `command ${s.text}`
}

/** A literal as its kind and text. */
const profileCasesTestLit = (l: Literal): string => {
  if (l.kind === LitKind.Bool) {
    return `bool ${l.flag ? "true" : "false"}`
  }
  if (l.kind === LitKind.Null) {
    return "null"
  }
  if (l.kind === LitKind.Concat) {
    return `concat(${l.parts.map((p: Literal): string => profileCasesTestLit(p)).join(", ")})`
  }
  if (l.kind === LitKind.Hex) {
    return `hex ${l.text}`
  }
  if (l.kind === LitKind.Ascii) {
    return `ascii ${l.text}`
  }
  if (l.kind === LitKind.Str) {
    return `str ${l.text}`
  }
  return `num ${l.text}`
}

// ── Contracts ───────────────────────────────────────────────────────────────

/** A minimal spec reads to its name, sources, target, requirement and vector. */
const profileCasesTestMinimal = (t: Suite, all: ProfileCasesTestRfcs): void => {
  const c = profileCasesTestContract(
    t,
    all,
    "a minimal spec",
    profileCasesTestSpec(
      profileCasesTestSec(
        PROFILE_CASES_REQ + profileCasesTestTable([profileCasesTestVector('hexDecode("66")', '"f"')]),
        "",
      ),
    ),
  )
  if (c === null) {
    return
  }
  t.eqStr("minimal: the contract's name", c.contract, "t")
  const sources = c.sources ?? []
  t.eqStr(
    "minimal: its sources",
    sources.map((s): string => `${s.id} ${s.path ?? "-"} ${s.rfc}`).join(", "),
    "t ../specs/t.xml -1, rfc4648 - 4648",
  )
  t.eqStr("minimal: its target", c.target.module, "nish/hex")
  t.eqStr("minimal: its requirement", profileCasesTestReqs(c), "R-A - 2 MUST hexDecode MUST work.")
  t.ok("minimal: no exclusion", (c.exclusions ?? []).length === 0)
  t.eqStr("minimal: one clause", `${c.clauses.length}`, "1")
  const v = c.clauses[0]
  t.eqStr(
    "minimal: the vector",
    `${v.id} ${v.title} ${v.covers.join(",")} ${profileCasesTestSource(v.source)} ${v.call}`,
    "V1 a title R-A cite rfc4648 10 hexDecode",
  )
  t.eqStr("minimal: its argument", v.args.map((a: Literal): string => profileCasesTestLit(a)).join(", "), "str 66")
  const e = v.expect
  t.eqStr("minimal: its expected value", e === null ? "none" : profileCasesTestLit(e), "ascii f")
}

/** A blockquote quoting an XML RFC takes its keyword as its level, or DEFINITION with none. */
const profileCasesTestBlockquote = (t: Suite, all: ProfileCasesTestRfcs): void => {
  const c = profileCasesTestContract(
    t,
    all,
    "a blockquote quoting an XML RFC",
    profileCasesTestSpec(
      profileCasesTestMin() +
        profileCasesTestSec(
          `<blockquote anchor="R-Q"><t>a client MAY indicate</t>
<t>the protected resource <xref target="RFC8707" section="2"/></t></blockquote>
<blockquote anchor="R-D"><t>(a.k.a. resource server, application, API, etc.)
<xref target="RFC8707" section="2"/></t></blockquote>
<blockquote anchor="R-N"><t>The URI MUST NOT include a fragment component.
<xref target="RFC8707" section="2"/></t></blockquote>${profileCasesTestCoverDn()}`,
          "",
        ),
    ),
  )
  if (c === null) {
    return
  }
  t.eqStr(
    "blockquote: requirements",
    profileCasesTestReqs(c),
    [
      "R-A - 2 MUST hexDecode MUST work.",
      "R-Q rfc8707 2 MAY a client MAY indicate the protected resource",
      "R-D rfc8707 2 DEFINITION (a.k.a. resource server, application, API, etc.)",
      "R-N rfc8707 2 MUST NOT The URI MUST NOT include a fragment component.",
    ].join("\n"),
  )
  t.eqStr("blockquote: sources", (c.sources ?? []).map((s): string => s.id).join(","), "t,rfc8707")
}

/** A section anchor in Source cites the spec, or is the spec for null and booleans. */
const profileCasesTestSectionSource = (t: Suite, all: ProfileCasesTestRfcs): void => {
  const c = profileCasesTestContract(
    t,
    all,
    "a section anchor in Source",
    profileCasesTestSpec(
      profileCasesTestSec(
        PROFILE_CASES_REQ +
          profileCasesTestTable([
            profileCasesTestSrc(`<xref target="here"/>`, '"f"', "V1"),
            profileCasesTestCells(
              "V2",
              profileCasesTestTt('isHex("z")'),
              profileCasesTestTt("false"),
              "R-A",
              `<xref target="here"/>`,
              "a title",
            ),
          ]),
        ' anchor="here"',
      ),
    ),
  )
  if (c === null) {
    return
  }
  t.eqStr(
    "section source: cite, then spec",
    c.clauses.map((k: Clause): string => profileCasesTestSource(k.source)).join(", "),
    "cite - 2, spec 2",
  )
  const e = c.clauses[1].expect
  t.eqStr("section source: the bool expected", e === null ? "none" : profileCasesTestLit(e), "bool false")
  t.eqStr("section source: the spec vector's section", c.clauses[1].section ?? "none", "2")
}

/** Cited RFCs are listed in ascending order. */
const profileCasesTestAscending = (t: Suite, all: ProfileCasesTestRfcs): void => {
  const c = profileCasesTestContract(
    t,
    all,
    "cited RFCs",
    profileCasesTestSpec(
      profileCasesTestSec(
        `${PROFILE_CASES_REQ}<blockquote anchor="R-Q"><t>a client MAY indicate <xref target="RFC8707" section="2"/></t></blockquote>${profileCasesTestTable(
          [profileCasesTestVector('hexDecode("66")', '"f"')],
        )}`,
        "",
      ),
    ),
  )
  if (c !== null) {
    t.eqStr("cited RFCs ascend", (c.sources ?? []).map((s): string => s.id).join(","), "t,rfc4648,rfc8707")
  }
}

/** A prose table has at most two vector header names, and is no vector table. */
const profileCasesTestProseTable = (t: Suite, all: ProfileCasesTestRfcs): void => {
  const prose: string[][] = [
    ["Name"],
    ["ID", "Algorithm", "Notes"],
    ["Case", "Input", "Expected"],
    ["Name", "Call", "Effect"],
    ["Id", "Title"],
  ]
  let tables = ""
  for (const h of prose) {
    tables = tables + profileCasesTestTableWith([profileCasesTestRow(["x"])], h)
  }
  const c = profileCasesTestContract(
    t,
    all,
    "prose tables",
    profileCasesTestSpec(profileCasesTestMin() + profileCasesTestSec(tables, "")),
  )
  if (c !== null) {
    t.eqStr("prose tables: only V1", c.clauses.map((k: Clause): string => k.id).join(","), "V1")
  }
}

/** An anchored paragraph without BCP 14 is no requirement; <back> sections are lettered; no <back> reads. */
const profileCasesTestShapes = (t: Suite, all: ProfileCasesTestRfcs): void => {
  const note = profileCasesTestContract(
    t,
    all,
    "an anchored paragraph without BCP 14",
    profileCasesTestSpec(profileCasesTestMin() + profileCasesTestSec(`<t anchor="note">Just prose.</t>`, "")),
  )
  if (note !== null) {
    t.eqStr(
      "an anchored paragraph without BCP 14 is no requirement",
      note.requirements.map((q: Requirement): string => q.id).join(","),
      "R-A",
    )
  }
  const minNoReq = replaceAll(profileCasesTestMin(), PROFILE_CASES_REQ, "")
  const back = profileCasesTestContract(
    t,
    all,
    "sections in <back>",
    `<rfc docName="draft-t-00" version="3"><front><title>T</title></front><middle>${profileCasesTestIfaceSection()}${minNoReq}</middle><back>${PROFILE_CASES_REFS}<section><name>A</name>${profileCasesTestSec(PROFILE_CASES_REQ, "")}</section></back></rfc>`,
  )
  if (back !== null) {
    t.eqStr("a nested section in <back> is A.1", back.requirements[0].section, "A.1")
  }
  const noBack = profileCasesTestContract(
    t,
    all,
    "a document with no <back>",
    `<rfc docName="draft-t-00" version="3"><front><title>T</title></front><middle>${profileCasesTestIfaceSection()}${profileCasesTestMin()}</middle></rfc>`,
  )
  if (noBack !== null) {
    t.eqStr(
      "a document with no <back> still reads",
      noBack.requirements.map((q: Requirement): string => q.id).join(","),
      "R-A",
    )
  }
}

/** A blockquote's level is the reader's (NOT RECOMMENDED is SHOULD NOT); a Definition may quote a keyword. */
const profileCasesTestLevels = (t: Suite, all: ProfileCasesTestRfcs): void => {
  const nr = profileCasesTestContract(
    t,
    all,
    "NOT RECOMMENDED",
    replaceAll(
      profileCasesTestLines([
        `<blockquote anchor="R-NR"><t>This, however, is NOT RECOMMENDED <xref target="RFC5869" section="3.3"/></t></blockquote>`,
      ]),
      "</middle>",
      `${profileCasesTestMin()}</middle>`,
    ),
  )
  if (nr !== null) {
    t.eqStr("NOT RECOMMENDED is SHOULD NOT", `${nr.requirements[0].id} ${nr.requirements[0].level}`, "R-NR SHOULD NOT")
  }
  const defs = profileCasesTestContract(
    t,
    all,
    "a Definition quoting a keyword",
    profileCasesTestLines([
      `<t anchor="R-D">Definition: "<bcp14>MUST</bcp14>" is a keyword.</t>`,
      `<t anchor="R-N">hexDecode <bcp14>MUST NOT</bcp14> fail.</t>`,
      `<t anchor="R-S">hexDecode <bcp14>SHOULD NOT</bcp14> fail.</t>`,
      PROFILE_CASES_REQ,
      profileCasesTestTable([profileCasesTestSrc(PROFILE_CASES_RFC10, '"f"', "V1")]),
      profileCasesTestCoverDn(),
    ]),
  )
  if (defs !== null) {
    t.eqStr(
      "a Definition may quote a keyword; MUST NOT and SHOULD NOT from an anchored <t>",
      defs.requirements.map((q: Requirement): string => `${q.id} ${q.level}`).join(", "),
      "R-D DEFINITION, R-N MUST NOT, R-S SHOULD NOT, R-A MUST",
    )
  }
  const spaces = profileCasesTestContract(
    t,
    all,
    "a cell's raw text",
    profileCasesTestLines([
      PROFILE_CASES_REQ,
      profileCasesTestTable([profileCasesTestVector('hexDecode("a  b")', "null")]),
    ]),
  )
  if (spaces !== null) {
    t.eqStr(
      "a cell is read as its raw text, spaces and all",
      `${spaces.clauses[0].call} ${spaces.clauses[0].args.map((a: Literal): string => profileCasesTestLit(a)).join(",")}`,
      "hexDecode str a  b",
    )
  }
}

// ── Fixtures ────────────────────────────────────────────────────────────────

/** The kramdown fixture is refused for its quote, its `.repeat` and a return type, exactly. */
const profileCasesTestKramdown = (t: Suite, all: ProfileCasesTestRfcs): void => {
  const path = "tests/fixtures/kramdown/profile.xml"
  t.eqStr(
    "the kramdown fixture's refusals",
    profileCasesTestReadAt(all, readFileSyncOrNull(path) ?? "", path),
    [
      `76 R-RFC-VECTORS is not in Section 10 of RFC4648: "The base 16 encoding of "f" is "66"."`,
      "87:98 `.repeat` is not in the ts-property subset",
      "188 Expected: hexEncode returns string, not bytes",
    ].join("\n"),
  )
}

/** profile-hex reads into the contract pinned beside it, the same each time. */
const profileCasesTestProfileHex = (t: Suite, all: ProfileCasesTestRfcs): void => {
  const path = "tests/fixtures/profile/profile-hex.xml"
  const doc = xmlDocParse(readFileSyncOrNull(path) ?? "")
  if (doc.isErr()) {
    t.fail("profile-hex parses", doc.error.message)
    return
  }
  const first = profileRead(doc.value, path, null, profileCasesTestRfcs(all))
  const again = profileRead(doc.value, path, null, profileCasesTestRfcs(all))
  if (first.isErr() || again.isErr()) {
    t.fail("profile-hex reads", "refused")
    return
  }
  const got = contractWrite(first.value.contract)
  t.eqStr("the same input gives the same output", contractWrite(again.value.contract), got)
  const jd = newJsonDocument()
  const root = parseJson(jd, readFileSyncOrNull("tests/fixtures/profile/profile-hex.json") ?? "", "profile-hex.json")
  if (root.isErr()) {
    t.fail("the pinned contract parses", root.error)
    return
  }
  const inner = jsonMember(jd, root.value, "contract", JSON_VALUE_OBJECT)
  if (inner.isErr()) {
    t.fail("the pinned contract has a contract", inner.error)
    return
  }
  const pinned = contractFromJson(jd, inner.value)
  if (pinned.isErr()) {
    t.fail("the pinned contract reads", pinned.error.join("; "))
    return
  }
  t.eqStr("profile-hex reads into the pinned contract", got, contractWrite(pinned.value))
}

// ── Refusals ────────────────────────────────────────────────────────────────

/** `xml` is refused with exactly `want`, each `line[:col] message`. */
const profileCasesTestRefused = (
  t: Suite,
  all: ProfileCasesTestRfcs,
  name: string,
  xml: string,
  want: string[],
): void => {
  t.eqStr(name, profileCasesTestRead(all, xml), want.join("\n"))
}

/** `xml` is refused with exactly the messages `want`, in order. */
const profileCasesTestRefusedWith = (
  t: Suite,
  all: ProfileCasesTestRfcs,
  name: string,
  xml: string,
  want: string[],
): void => {
  t.eqStr(name, profileCasesTestMessages(all, xml), want.join("\n"))
}

/** BCP 14 sentences, anchors and exclusions. */
const profileCasesTestSentences = (t: Suite, all: ProfileCasesTestRfcs): void => {
  t.eqStr(
    "a BCP 14 sentence with no anchor and no exclusion, in the spec's file",
    profileCasesTestReadAt(
      all,
      profileCasesTestSpec(profileCasesTestSec("<t>hexDecode <bcp14>MUST</bcp14> work.</t>", "")),
      "specs/t.xml",
    ),
    `7 BCP 14 sentence has no anchor and no Untested: paragraph after it: "hexDecode MUST work."`,
  )
  profileCasesTestRefusedWith(
    t,
    all,
    "an anchored paragraph with two BCP 14 sentences",
    profileCasesTestSpec(
      profileCasesTestSec(`<t anchor="R-T">It <bcp14>MUST</bcp14> do a. It <bcp14>MUST</bcp14> do b.</t>`, ""),
    ),
    ["R-T holds 2 BCP 14 sentences; give each its own anchor"],
  )
  profileCasesTestRefused(
    t,
    all,
    "a Definition: with BCP 14, and one with no anchor",
    profileCasesTestLines([
      `<t anchor="R-D">Definition: hex <bcp14>MUST</bcp14> be lowercase.</t>`,
      "<t>Definition: hex is base 16.</t>",
    ]),
    [
      "8 R-D is a definition but holds BCP 14 keywords; a definition holds none",
      "9 a Definition: paragraph needs an anchor",
    ],
  )
  profileCasesTestRefused(
    t,
    all,
    "two levels in one sentence",
    profileCasesTestLines([
      `<t anchor="R-T">It <bcp14>MUST</bcp14> and <bcp14>MAY</bcp14> be.</t>`,
      "<t>It <bcp14>SHOULD</bcp14> or <bcp14>SHOULD NOT</bcp14> be.</t>",
      "<t>Untested: none.</t>",
    ]),
    [
      "8 R-T holds more than one BCP 14 level (MUST, MAY); give each level its own sentence",
      "9 an excluded paragraph holds more than one BCP 14 level (SHOULD, SHOULD NOT); exclude each level apart",
    ],
  )
  profileCasesTestRefused(
    t,
    all,
    "an Untested: that excludes nothing, and a second one",
    profileCasesTestLines([
      "<t>Untested: nothing before.</t>",
      "<t>It <bcp14>SHOULD</bcp14> be.</t>",
      "<t>Untested: once.</t>",
      "<t>Untested: twice.</t>",
    ]),
    [`8 ${PROFILE_CASES_EXCLUDES_NOTHING}`, `11 ${PROFILE_CASES_EXCLUDES_NOTHING}`],
  )
  profileCasesTestRefused(
    t,
    all,
    "an excluded sentence or reason holding a control character",
    profileCasesTestLines([
      "<t>x <bcp14>MUST</bcp14> y&#127;.</t>",
      "<t>Untested: no&#127;.</t>",
      PROFILE_CASES_REQ,
      profileCasesTestTable([profileCasesTestSrc(PROFILE_CASES_RFC10, '"f"', "V1")]),
    ]),
    [
      "8 the excluded sentence holds a control character (U+007F)",
      "9 the Untested: reason holds a control character (U+007F)",
    ],
  )
  profileCasesTestRefused(
    t,
    all,
    "a requirement anchor that is not an id",
    profileCasesTestLines([
      `<t anchor="_R">hexDecode <bcp14>MUST</bcp14> work.</t>`,
      PROFILE_CASES_REQ,
      profileCasesTestTable([profileCasesTestSrc(PROFILE_CASES_RFC10, '"f"', "V1")]),
    ]),
    [`8 requirement id "_R" ${PROFILE_CASES_ID_RULE}`],
  )
  t.eqStr(
    "a requirement id given twice is refused by the parser, at the second",
    profileCasesTestRead(all, profileCasesTestLines([PROFILE_CASES_REQ, replaceAll(PROFILE_CASES_REQ, "work", "run")])),
    `xml 9 anchor "R-A" is used again; first on line 8`,
  )
}

/** Sections: unnumbered ones, and a binding requirement no clause covers. */
const profileCasesTestSections = (t: Suite, all: ProfileCasesTestRfcs): void => {
  profileCasesTestRefused(
    t,
    all,
    "a requirement, an exclusion and a vector table in an unnumbered section",
    profileCasesTestSpec(
      profileCasesTestSec(
        `${PROFILE_CASES_REQ}\n<t>It <bcp14>SHOULD</bcp14> be.</t><t>Untested: no.</t>\n${profileCasesTestTable([])}`,
        ` numbered="false"`,
      ),
    ),
    [
      "7 R-A is in an unnumbered section; a requirement needs a section number",
      "8 an excluded sentence is in an unnumbered section; it needs a section number",
      "9 a vector table is in an unnumbered section; it needs a section number",
    ],
  )
  const v = profileCasesTestTable([profileCasesTestSrc(PROFILE_CASES_RFC10, '"f"', "V1")])
  profileCasesTestRefused(
    t,
    all,
    "a binding requirement no clause covers; a non-binding one may be",
    profileCasesTestLines([
      PROFILE_CASES_REQ,
      `<t anchor="R-B">hexEncode <bcp14>SHALL</bcp14> work.</t>`,
      `<t anchor="R-M">hexEncode <bcp14>MAY</bcp14> work.</t>`,
      v,
    ]),
    [
      "9 R-B is SHALL, but no clause covers it; cover it with a vector or a property, or follow it with an Untested: paragraph",
    ],
  )
  profileCasesTestRefused(
    t,
    all,
    "refusals are collected across the document and sorted by line",
    profileCasesTestSpecWith(
      `${profileCasesTestSec("<t>a <bcp14>MUST</bcp14>.</t>", "")}\n\n${profileCasesTestSec("<t>b <bcp14>MUST</bcp14>.</t>", "")}`,
      "bad",
      profileCasesTestIfaceSection(),
    ),
    [
      `1 docName "bad" is not draft-<name>-NN`,
      `7 BCP 14 sentence has no anchor and no Untested: paragraph after it: "a MUST."`,
      `9 BCP 14 sentence has no anchor and no Untested: paragraph after it: "b MUST."`,
    ],
  )
  profileCasesTestRefused(
    t,
    all,
    "a spec with no requirement and no clause",
    profileCasesTestLines([profileCasesTestTable([])]),
    [
      "1 a spec needs at least one clause: a vector table row or a ts-property block",
      "1 a spec needs at least one requirement",
    ],
  )
  profileCasesTestRefused(t, all, "a spec with no clause", profileCasesTestLines([PROFILE_CASES_REQ]), [
    "1 a spec needs at least one clause: a vector table row or a ts-property block",
  ])
  profileCasesTestRefused(
    t,
    all,
    "a v2 <texttable>",
    profileCasesTestLines([
      PROFILE_CASES_REQ,
      "<texttable><ttcol>a</ttcol><c>b</c></texttable>",
      profileCasesTestTable([profileCasesTestSrc(PROFILE_CASES_RFC10, '"f"', "V1")]),
    ]),
    ["9 a <texttable> is v2 XML; write a v3 <table> (xml2rfc --v2v3 converts one)"],
  )
}

/** References, xrefs and the RFC sections they cite. */
const profileCasesTestXrefs = (t: Suite, all: ProfileCasesTestRfcs): void => {
  profileCasesTestRefusedWith(
    t,
    all,
    "an xref to an RFC with no <reference>, and a section xref to a non-RFC reference",
    profileCasesTestSpec(
      profileCasesTestSec(
        `<t>See <xref target="RFC1234"/> and <xref target="BOOK" section="3"/> and <xref target="x"/>.</t>
<blockquote anchor="R-B"><t>quote <xref target="BOOK" section="3"/></t></blockquote>`,
        "",
      ),
    ),
    ["xref to RFC1234 has no <reference> for it", `xref to "BOOK" names no RFC <reference>`],
  )
  profileCasesTestRefused(
    t,
    all,
    "a section an RFC used as a source does not have, in prose too",
    profileCasesTestSpec(
      profileCasesTestSec(
        `${PROFILE_CASES_REQ}\n<t>See <xref target="RFC4648" section="99"/>.</t>\n${profileCasesTestTable([
          profileCasesTestVector('hexDecode("66")', '"f"'),
        ])}`,
        "",
      ),
    ),
    ["8 Section 99 of RFC4648 does not exist"],
  )
  const nobody = profileCasesTestRfcs(all)
  const doc = xmlDocParse(
    profileCasesTestSpec(
      profileCasesTestMin() + profileCasesTestSec(`<t>See <xref target="RFC9999" section="99"/>.</t>`, ""),
    ),
  )
  if (doc.isErr()) {
    t.fail("a section xref to an RFC nothing cites parses", doc.error.message)
  } else {
    t.ok(
      "a section xref to an RFC nothing cites reads",
      profileRead(doc.value, PROFILE_CASES_PATH, null, nobody).isOk(),
    )
    t.eqStr(
      "a section xref to an RFC nothing cites needs no file",
      nobody.missing.map((n: i32): string => `${n}`).join(","),
      "",
    )
  }
  profileCasesTestRefusedWith(
    t,
    all,
    "a section the RFC does not have, in a blockquote",
    profileCasesTestSpec(
      profileCasesTestSec(
        `<blockquote anchor="R-B"><t>quote <xref target="RFC4648" section="99"/></t></blockquote>`,
        "",
      ),
    ),
    ["Section 99 of RFC4648 does not exist"],
  )
  profileCasesTestRefusedWith(
    t,
    all,
    "an RFC with no <reference>, in a blockquote and a Source cell, is refused once each",
    profileCasesTestSpec(
      profileCasesTestSec(
        `${PROFILE_CASES_REQ}<blockquote anchor="R-B"><t>quote <xref target="RFC1234" section="1"/></t></blockquote>${profileCasesTestTable(
          [profileCasesTestSrc(`<xref target="RFC1234" section="1"/>`, '"f"', "V1")],
        )}`,
        "",
      ),
    ),
    ["xref to RFC1234 has no <reference> for it", "xref to RFC1234 has no <reference> for it"],
  )
  const once = new ProfileRfcs()
  const twice = xmlDocParse(
    profileCasesTestSpec(
      profileCasesTestSec(
        `${PROFILE_CASES_REQ}<t><xref target="RFC4648" section="10"/> <xref target="RFC4648" section="4"/></t>${profileCasesTestTable(
          [profileCasesTestVector('hexDecode("66")', '"f"')],
        )}`,
        "",
      ),
    ),
  )
  if (twice.isErr()) {
    t.fail("each RFC is asked for once: parses", twice.error.message)
  } else {
    const r = profileRead(twice.value, PROFILE_CASES_PATH, null, once)
    t.ok("each RFC is asked for once: reads", r.isOk() || r.isErr())
    t.eqStr("each RFC is asked for once", once.missing.map((n: i32): string => `${n}`).join(","), "4648")
  }
  profileCasesTestRefused(
    t,
    all,
    "an xref section that is not a section number",
    profileCasesTestLines([
      PROFILE_CASES_REQ,
      profileCasesTestTable([profileCasesTestSrc(`<xref target="RFC4648" section="three"/>`, '"f"', "V1")]),
    ]),
    [`10 section "three" of RFC4648 is not a section number like 2.3 or A.1`],
  )
}

/** Blockquotes: their shape, their quote against the RFC, their level. */
const profileCasesTestQuotes = (t: Suite, all: ProfileCasesTestRfcs): void => {
  const bad: string[] = [
    `<blockquote anchor="R-B"><t>no xref</t></blockquote>`,
    `<blockquote anchor="R-C"><ul><li>x</li></ul></blockquote>`,
    `<blockquote anchor="R-D"><t>x <xref target="RFC4648"/></t></blockquote>`,
    `<blockquote anchor="R-E"></blockquote>`,
    `<blockquote anchor="R-F"><t><xref target="RFC4648" section="10"/> after</t></blockquote>`,
  ]
  const want: string[] = []
  const anchors = ["R-B", "R-C", "R-D", "R-E", "R-F"]
  for (let i = 0; i < anchors.length; i++) {
    want.push(`${7 + i} blockquote ${anchors[i]} must be <t> paragraphs, the last ending with {{Section N of RFCx}}`)
  }
  profileCasesTestRefused(
    t,
    all,
    "a malformed blockquote",
    profileCasesTestSpec(profileCasesTestSec(bad.join("\n"), "")),
    want,
  )
  profileCasesTestRefusedWith(
    t,
    all,
    "a quote that is not in the RFC section, anchored or excluded",
    profileCasesTestSpec(
      profileCasesTestSec(
        `<blockquote anchor="R-B"><t>not there <xref target="RFC4648" section="10"/></t></blockquote>
<blockquote><t>nor here <xref target="RFC4648" section="10"/></t></blockquote>`,
        "",
      ),
    ),
    [`R-B is not in Section 10 of RFC4648: "not there"`],
  )
  profileCasesTestRefusedWith(
    t,
    all,
    "an excluded blockquote whose quote is not in the RFC",
    profileCasesTestSpec(
      profileCasesTestSec(
        `<blockquote anchor="R-B"><t>not there <xref target="RFC4648" section="10"/></t></blockquote>
<t>Untested: because.</t>`,
        "",
      ),
    ),
    [`R-B is not in Section 10 of RFC4648: "not there"`],
  )
  profileCasesTestRefused(
    t,
    all,
    "a blockquote of two levels",
    profileCasesTestLines([
      `<blockquote anchor="R-Q"><t>The URI MUST NOT include a fragment component. It SHOULD NOT include a query component <xref target="RFC8707" section="2"/></t></blockquote>`,
    ]),
    ["8 blockquote R-Q holds more than one BCP 14 level (MUST NOT, SHOULD NOT); quote one level per requirement"],
  )
  profileCasesTestRefused(
    t,
    all,
    "a blockquote of only its citation, and one holding a control character",
    profileCasesTestLines([
      `<blockquote anchor="R-X"><t>${PROFILE_CASES_RFC10}</t></blockquote>`,
      `<blockquote anchor="R-Y"><t>a&#127; ${PROFILE_CASES_RFC10}</t></blockquote>`,
      PROFILE_CASES_REQ,
      profileCasesTestTable([profileCasesTestSrc(PROFILE_CASES_RFC10, '"f"', "V1")]),
    ]),
    ["8 R-X's quote is empty", "9 R-Y's quote holds a control character (U+007F)"],
  )
}

/** The interface block, ts-property blocks, and other sourcecode. */
const profileCasesTestCode = (t: Suite, all: ProfileCasesTestRfcs): void => {
  profileCasesTestRefused(
    t,
    all,
    "two ts-interface blocks",
    profileCasesTestSpec(profileCasesTestSec(profileCasesTestIface(PROFILE_CASES_IFACE_CODE), "")),
    ["7 a spec has exactly one ts-interface block; this one has 2"],
  )
  profileCasesTestRefusedWith(
    t,
    all,
    "no ts-interface block",
    profileCasesTestSpecWith(profileCasesTestSec(PROFILE_CASES_REQ, ""), "draft-t-00", ""),
    ["a spec has exactly one ts-interface block; this one has 0"],
  )
  profileCasesTestRefused(
    t,
    all,
    "a ts-property without a covers line, at the block's line",
    profileCasesTestSpec(
      profileCasesTestSec(profileCasesTestProperty("forall (t: string /* 0..4 */) => isHex(t)"), ""),
    ),
    ["8:1 missing `// P-ID covers R-ID — title` line"],
  )
  profileCasesTestRefused(
    t,
    all,
    "an interface the front end refuses",
    profileCasesTestSpecWith(
      "",
      "draft-t-00",
      `<section><name>I</name>${profileCasesTestIface("\nexport function f(\n")}</section>`,
    ),
    ["3:1 missing `// module: <root>/<path>` first line"],
  )
  profileCasesTestRefusedWith(
    t,
    all,
    "a sourcecode type no front end reads",
    profileCasesTestSpec(
      profileCasesTestSec(`<sourcecode type="rust-property">x</sourcecode><sourcecode type="text">y</sourcecode>`, ""),
    ),
    [`no front end reads sourcecode type "rust-property"`],
  )
  profileCasesTestRefused(
    t,
    all,
    "a function name the generated test uses itself, at its own line",
    profileCasesTestSpecWith(
      profileCasesTestMin(),
      "draft-t-00",
      `<section><name>I</name>${profileCasesTestIface(`${PROFILE_CASES_IFACE_CODE}export function plain_x(a: string): string\n`)}</section>`,
    ),
    [
      "7 function plain_x: the generated test uses this name itself (its helpers, and names starting plain_ clause_ table_ v_ a_ s_), so it cannot call such a function",
    ],
  )
  profileCasesTestRefused(
    t,
    all,
    "a property whose assertion calls no function under test, at its covers line",
    profileCasesTestLines([
      PROFILE_CASES_REQ,
      profileCasesTestTable([profileCasesTestSrc(PROFILE_CASES_RFC10, '"f"', "V1")]),
      profileCasesTestProperty("// P-X covers R-A — t\nforall (b: u8[] /* 0..4 */) => b === b"),
    ]),
    ["12 property P-X's assertion calls none of the functions under test, so it checks nothing"],
  )
}

/** docName, the contract's name, and the title. */
const profileCasesTestNames = (t: Suite, all: ProfileCasesTestRfcs): void => {
  profileCasesTestRefusedWith(
    t,
    all,
    "a docName that is not draft-<name>-NN",
    profileCasesTestSpecWith("", "t", profileCasesTestIfaceSection()),
    [`docName "t" is not draft-<name>-NN`],
  )
  t.eqStr(
    "a docName that disagrees with the file name",
    profileCasesTestReadAt(all, profileCasesTestSpec(""), "specs/other.xml"),
    `1 docName "draft-t-00" names contract "t", but the file is other.xml`,
  )
  profileCasesTestRefusedWith(
    t,
    all,
    "no docName",
    `<rfc version="3"><front><title>T</title></front><middle>${profileCasesTestIfaceSection()}</middle></rfc>`,
    [`docName "" is not draft-<name>-NN`],
  )
  t.eqStr(
    "a contract name that is not an id",
    profileCasesTestReadAt(
      all,
      profileCasesTestSpecWith(profileCasesTestMin(), "draft-_t-00", profileCasesTestIfaceSection()),
      "specs/_t.xml",
    ),
    `1 docName "draft-_t-00" names contract "_t", which ${PROFILE_CASES_ID_RULE}`,
  )
  profileCasesTestRefused(
    t,
    all,
    "a blank title",
    replaceAll(profileCasesTestSpec(profileCasesTestMin()), "<title>T</title>", "<title> </title>"),
    ["1 the title is empty"],
  )
  profileCasesTestRefused(
    t,
    all,
    "a title holding a control character",
    replaceAll(profileCasesTestSpec(profileCasesTestMin()), "<title>T</title>", "<title>T&#127;</title>"),
    ["1 the title holds a control character (U+007F)"],
  )
}

/** A vector of hexDecode("66") from Section 10 of RFC4648, with its id and Covers. */
const profileCasesTestRfc10Row = (id: string, covers: string): string =>
  profileCasesTestCells(
    id,
    profileCasesTestTt('hexDecode("66")'),
    profileCasesTestTt('"f"'),
    covers,
    PROFILE_CASES_RFC10,
    "a title",
  )

/** Vector rows: their cells, their types, their header, and the table they sit in. */
const profileCasesTestVectors = (t: Suite, all: ProfileCasesTestRfcs): void => {
  profileCasesTestRefusedWith(
    t,
    all,
    "an unknown Covers id, in a vector and in a property",
    profileCasesTestSpec(
      profileCasesTestSec(
        PROFILE_CASES_REQ +
          profileCasesTestProperty(
            "// P-X covers R-NOPE — t\nforall (b: u8[] /* 0..4 */) => hexEncode(b) === hexEncode(b)",
          ) +
          profileCasesTestTable([
            profileCasesTestCells(
              "V1",
              profileCasesTestTt('hexDecode("66")'),
              profileCasesTestTt('"f"'),
              "R-A, R-GONE",
              PROFILE_CASES_RFC10,
              "a title",
            ),
          ]),
        "",
      ),
    ),
    [`Covers names "R-NOPE", which is no requirement`, `Covers names "R-GONE", which is no requirement`],
  )
  profileCasesTestRefusedWith(
    t,
    all,
    "a literal the types do not settle",
    profileCasesTestSpec(
      profileCasesTestSec(
        PROFILE_CASES_REQ +
          profileCasesTestTable([
            profileCasesTestVector('isHex("ab")', '"yes"'),
            profileCasesTestVectorId("V2", 'hexDecode("66", "x")', '"f"'),
          ]),
        "",
      ),
    ),
    [
      `Expected: the types do not settle "yes": a quoted string goes where bytes or a string does, not bool`,
      "Call: hexDecode takes 1 argument(s), not 2",
      `Call: the types do not settle "x": a quoted string goes where bytes or a string does, not past the last parameter`,
    ],
  )
  profileCasesTestRefused(
    t,
    all,
    "a cell without backticks",
    profileCasesTestSpec(
      profileCasesTestSec(
        PROFILE_CASES_REQ +
          profileCasesTestTable([
            profileCasesTestCells(
              "V1",
              'hexDecode("66")',
              profileCasesTestTt('"f"'),
              "R-A",
              PROFILE_CASES_RFC10,
              "a title",
            ),
            profileCasesTestCells(
              "V2",
              profileCasesTestTt('hexDecode("66")'),
              `${profileCasesTestTt('"f"')} or so`,
              "R-A",
              PROFILE_CASES_RFC10,
              "a title",
            ),
          ]),
        "",
      ),
    ),
    ["8 cell must be a single code span", "9 cell must be a single code span"],
  )
  profileCasesTestRefused(
    t,
    all,
    "a vector table with the wrong header",
    profileCasesTestSpec(profileCasesTestSec(profileCasesTestTableWith([], ["Id", "Call", "Expected"]), "")),
    [`7 ${PROFILE_CASES_HEADER_IS}Id | Call | Expected`],
  )
  profileCasesTestRefused(
    t,
    all,
    "a vector row with the wrong cell count, and one with no title",
    profileCasesTestSpec(
      profileCasesTestSec(
        PROFILE_CASES_REQ +
          profileCasesTestTable([
            profileCasesTestRow(["V1", "x"]),
            profileCasesTestCells(
              "V1",
              profileCasesTestTt('hexDecode("66")'),
              profileCasesTestTt('"f"'),
              "R-A",
              PROFILE_CASES_RFC10,
              "",
            ),
          ]),
        "",
      ),
    ),
    ["8 a vector row has 6 cells, not 2", "9 vector V1 has no title"],
  )
  profileCasesTestRefused(
    t,
    all,
    "Call and Expected cells that do not parse, with columns",
    profileCasesTestSpec(
      profileCasesTestSec(
        PROFILE_CASES_REQ +
          profileCasesTestTable([
            profileCasesTestVectorId("V2", 'hexDecode("66")', "‖"),
            profileCasesTestVectorId("V3", 'nope("66")', '"f"'),
          ]),
        "",
      ),
    ),
    ["8:1 Expected: `‖` is not a literal; write concat(a, b)", `9 "nope" is not a function of the ts-interface block`],
  )
  profileCasesTestRefused(
    t,
    all,
    "a Source cell that is none of the three forms",
    profileCasesTestSpec(
      profileCasesTestSec(
        PROFILE_CASES_REQ +
          profileCasesTestTable([
            profileCasesTestSrc("the RFC", '"f"', "V1"),
            profileCasesTestSrc(`<xref target="nowhere"/>`, '"f"', "V2"),
            profileCasesTestSrc(`<xref target="BOOK" section="1"/>`, '"f"', "V3"),
          ]),
        "",
      ),
    ),
    [
      "8 Source must be {{Section N of RFCx}}, a section anchor, or a single code span",
      `9 Source names "nowhere", which is no numbered section`,
      `10 xref to "BOOK" names no RFC <reference>`,
    ],
  )
  profileCasesTestRefused(
    t,
    all,
    "a vector is typed by its signature in the spec",
    profileCasesTestLines([
      PROFILE_CASES_REQ,
      profileCasesTestTable([
        profileCasesTestVector("hexDecode([00])", "null"),
        profileCasesTestVectorId("V2", "hexDecode(null)", "null"),
        profileCasesTestVectorId("V3", "hexDecode((empty))", "null"),
        profileCasesTestVectorId("V4", "hexDecode(-1)", "null"),
        profileCasesTestVectorId("V5", "hexDecode()", "null"),
        profileCasesTestVectorId("V6", "hexEncode(Key = , [00])", '"00"'),
        profileCasesTestVectorId("V7", "hexEncode(-0)", '"00"'),
        profileCasesTestVectorId("V8", "hexEncode([00])", "[00]"),
        profileCasesTestVectorId("V9", 'isHex("ab")', "-1"),
      ]),
    ]),
    [
      "10 Call: argument 1 of hexDecode (text) is string, not bytes",
      "11 Call: argument 1 of hexDecode (text) is string, not null",
      "12 Call: argument 1 of hexDecode (text) is string, not bytes",
      "13 Call: argument 1 of hexDecode (text) is string, not an int -1",
      "14 Call: hexDecode takes 1 argument(s), not 0",
      `15:11 Call: ${PROFILE_CASES_LABELLED}`,
      "16:11 Call: not a literal",
      "17 Expected: hexEncode returns string, not bytes",
      "18 Expected: isHex returns bool, not an int -1",
    ],
  )
  profileCasesTestRefused(
    t,
    all,
    "a bytes cell is read as its raw text, spaces and all",
    profileCasesTestLines([
      PROFILE_CASES_REQ,
      profileCasesTestTable([profileCasesTestVector("hexEncode([00  0f])", '"000f"')]),
    ]),
    [`10:11 Call: ${PROFILE_CASES_BYTES_HINT}`],
  )
  profileCasesTestRefused(
    t,
    all,
    "a quoted string outside printable ASCII, tab, LF and CR",
    profileCasesTestLines([
      PROFILE_CASES_REQ,
      profileCasesTestTable([profileCasesTestVectorId("V2", 'hexDecode("\\u0000")', "null")]),
    ]),
    [`10 Call: a quoted string is printable ASCII, tab, LF and CR only; "\\u0000" is not`],
  )
  const h = profileCasesTestHeader()
  const bad: string[][] = [
    ["ID", h[1], h[2], h[3], h[4], h[5]],
    ["Id", "Call", "Expected"],
    [h[1], h[0], h[2], h[3], h[4], h[5]],
    ["Name", h[1], h[2], h[3], h[4], h[5]],
    ["Id", "Input", "Output", h[3], h[4], h[5]],
    [h[0], h[2], h[1], h[3], h[4], h[5]],
  ]
  const ls: string[] = [PROFILE_CASES_REQ]
  const want: string[] = []
  for (let i = 0; i < bad.length; i++) {
    ls.push(profileCasesTestTableWith([], bad[i]))
    want.push(`${9 + 2 * i} ${PROFILE_CASES_HEADER_IS}${bad[i].join(" | ")}`)
  }
  ls.push(profileCasesTestTableWith([], ["Name", "Value"]))
  profileCasesTestRefused(
    t,
    all,
    "a table that resembles the vector header must be it",
    profileCasesTestLines(ls),
    want,
  )
  profileCasesTestRefused(
    t,
    all,
    "a second vector table",
    profileCasesTestLines([
      PROFILE_CASES_REQ,
      profileCasesTestTable([profileCasesTestVector('hexDecode("66")', '"f"')]),
      profileCasesTestTable([profileCasesTestVectorId("V2", 'hexDecode("67")', '"g"')]),
    ]),
    ["11 a spec has one vector table; this is a second"],
  )
  profileCasesTestRefused(
    t,
    all,
    "Id and Covers cells",
    profileCasesTestLines([
      PROFILE_CASES_REQ,
      profileCasesTestTable([
        profileCasesTestRfc10Row("", "R-A"),
        profileCasesTestRfc10Row("-V", "R-A"),
        profileCasesTestRfc10Row("V3", ""),
        profileCasesTestRfc10Row("V4", "R-A,, R-A"),
        profileCasesTestRfc10Row("V4", "R-A"),
      ]),
    ]),
    [
      `10 clause id "" ${PROFILE_CASES_ID_RULE}`,
      `11 clause id "-V" ${PROFILE_CASES_ID_RULE}`,
      "12 Covers names no requirement",
      "13 Covers has an empty item",
      `13 Covers names "R-A" twice`,
      "14 clause id V4 is given twice",
    ],
  )
  profileCasesTestRefused(
    t,
    all,
    "a clause id shared by a vector and a property",
    profileCasesTestLines([
      PROFILE_CASES_REQ,
      profileCasesTestTable([profileCasesTestRfc10Row("P-X", "R-A")]),
      profileCasesTestProperty("// P-X covers R-A — t\nforall (b: u8[] /* 0..4 */) => hexEncode(b) === hexEncode(b)"),
    ]),
    ["12 clause id P-X is given twice"],
  )
  profileCasesTestRefused(
    t,
    all,
    "a row refusal reports every cell",
    profileCasesTestLines([
      PROFILE_CASES_REQ,
      profileCasesTestTable([
        profileCasesTestRow(["-V", profileCasesTestTt("hexDecode(1)"), profileCasesTestTt("1"), "R-NO", "the RFC", ""]),
      ]),
    ]),
    [
      "10 Call: argument 1 of hexDecode (text) is string, not an int 1",
      `10 Covers names "R-NO", which is no requirement`,
      "10 Expected: hexDecode returns bytes?, not an int 1",
      "10 Source must be {{Section N of RFCx}}, a section anchor, or a single code span",
      `10 clause id "-V" ${PROFILE_CASES_ID_RULE}`,
      "10 vector -V has no title",
    ],
  )
  profileCasesTestRefused(
    t,
    all,
    "a blank command source, and one whose Expected is null or a bool",
    profileCasesTestLines([
      PROFILE_CASES_REQ,
      profileCasesTestTable([
        profileCasesTestSrc("<tt/>", '"f"', "V1"),
        profileCasesTestSrc("<tt>   </tt>", '"f"', "V2"),
        profileCasesTestSrc(profileCasesTestTt("echo"), "null", "V3"),
        profileCasesTestCells(
          "V4",
          profileCasesTestTt('isHex("66")'),
          profileCasesTestTt("true"),
          "R-A",
          profileCasesTestTt("echo"),
          "a title",
        ),
      ]),
    ]),
    [
      "10 Source: a command is a shell command, not blank",
      "11 Source: a command is a shell command, not blank",
      "12 Source: a command prints bytes or a string, so its Expected is one, not null",
      "13 Source: a command prints bytes or a string, so its Expected is one, not bool",
    ],
  )
  profileCasesTestRefused(
    t,
    all,
    "Id and Covers cells are read raw: a non-breaking hyphen is not a hyphen",
    profileCasesTestLines([
      PROFILE_CASES_REQ,
      profileCasesTestTable([
        profileCasesTestRfc10Row("V1", "R&#8209;A"),
        profileCasesTestRfc10Row("V&#8209;2", "R-A"),
      ]),
    ]),
    [`10 Covers names "R‑A", which is no requirement`, `11 clause id "V‑2" ${PROFILE_CASES_ID_RULE}`],
  )
  const nb = profileCasesTestHeader()
  nb[4] = "So&#8209;urce"
  profileCasesTestRefused(
    t,
    all,
    "a header cell is read raw",
    profileCasesTestLines([PROFILE_CASES_REQ, profileCasesTestTableWith([], nb)]),
    [`9 ${PROFILE_CASES_HEADER_IS}Id | Call | Expected | Covers | So‑urce | Title`],
  )
}

/** Many paragraphs read, each exclusion kept. */
const profileCasesTestMany = (t: Suite, all: ProfileCasesTestRfcs): void => {
  const n = 20000
  const ls: string[] = [PROFILE_CASES_REQ]
  for (let i = 0; i < n; i++) {
    ls.push(i % 2 === 0 ? `<t>It <bcp14>SHOULD</bcp14> be ${i}.</t>` : "<t>Untested: many.</t>")
  }
  ls.push(profileCasesTestTable([profileCasesTestVector('hexDecode("66")', '"f"')]))
  const c = profileCasesTestContract(t, all, "many paragraphs", profileCasesTestLines(ls))
  if (c !== null) {
    t.eqStr("many paragraphs: every exclusion", `${(c.exclusions ?? []).length}`, `${n / 2}`)
  }
}

/** A cited RFC that is not handed over is recorded missing, and its section refused. */
const profileCasesTestMissing = (t: Suite, all: ProfileCasesTestRfcs): void => {
  const rfcs = profileCasesTestRfcs(all)
  const doc = xmlDocParse(
    profileCasesTestSpec(
      profileCasesTestSec(`<blockquote anchor="R-B"><t>q <xref target="RFC9999" section="1"/></t></blockquote>`, ""),
    ),
  )
  if (doc.isErr()) {
    t.fail("a missing RFC: parses", doc.error.message)
    return
  }
  const r = profileRead(doc.value, PROFILE_CASES_PATH, null, rfcs)
  t.eqStr("a missing RFC is recorded", rfcs.missing.map((n: i32): string => `${n}`).join(","), "9999")
  t.eqStr(
    "a missing RFC's section is refused",
    r.isErr() ? r.error.map((f: ProfileRefusal): string => f.message).join("\n") : "ok",
    "Section 1 of RFC9999 does not exist",
  )
}

/** The locator puts a line on each requirement, clause and function. */
const profileCasesTestLocator = (t: Suite, all: ProfileCasesTestRfcs): void => {
  const doc = xmlDocParse(
    profileCasesTestLines([
      PROFILE_CASES_REQ,
      `<t anchor="R-B.2">isHex <bcp14>MUST</bcp14> work.</t>`,
      profileCasesTestTable([
        profileCasesTestCells(
          "V1",
          profileCasesTestTt('hexDecode("66")'),
          profileCasesTestTt('"f"'),
          "R-A, R-B.2",
          PROFILE_CASES_RFC10,
          "a title",
        ),
        profileCasesTestCells(
          "V.2",
          profileCasesTestTt("hexEncode([66])"),
          profileCasesTestTt('"f"'),
          "R-A",
          PROFILE_CASES_RFC10,
          "a title",
        ),
      ]),
    ]),
  )
  if (doc.isErr()) {
    t.fail("locator: parses", doc.error.message)
    return
  }
  const r = profileRead(doc.value, PROFILE_CASES_PATH, null, profileCasesTestRfcs(all))
  if (r.isErr()) {
    t.fail(
      "locator: reads",
      r.error.map((f: ProfileRefusal): string => profileCasesTestOne(f, PROFILE_CASES_PATH)).join("; "),
    )
    return
  }
  const l = r.value.locator
  const keys = ["R-A", "R-B.2", "V1", "V.2", "hexDecode", "hexEncode", "isHex"]
  t.eqStr(
    "locator: each part's line",
    keys.map((k: string): string => `${k} ${l.at.get(k) ?? -1}`).join(", "),
    "R-A 8, R-B.2 9, V1 11, V.2 12, hexDecode 4, hexEncode 5, isHex 6",
  )
  const w = profileLocate(l, "V.2.expect")
  t.eqStr("locator: a sub-path falls back to its clause", `${w.file}:${w.line}`, "specs/t.xml:12")
  t.eqStr("locator: a source is at the root", `${profileLocate(l, "sources.rfc4648").line}`, `${l.root}`)
  t.eqStr("locator: nothing is at the root", `${profileLocate(l, "").line}`, `${l.root}`)
}

// ── The main source ─────────────────────────────────────────────────────────

const PROFILE_CASES_MAIN_8707: string = "<keyword>vector-main-RFC8707</keyword>"

/** R-N quoted from Section 2 of RFC8707, and a property covering it. */
const profileCasesTestMainQuote = (): string =>
  `<blockquote anchor="R-N"><t>The URI MUST NOT include a fragment component. <xref target="RFC8707" section="2"/></t></blockquote>${profileCasesTestProperty(
    "// P-N covers R-N — t\nforall (b: u8[] /* 0..4 */) => hexEncode(b) === hexEncode(b)",
  )}`

/** The spec's own text, when the main source is an RFC. */
const profileCasesTestOwn = (what: string): string =>
  `${what} is the spec's own text, but the main source is RFC8707; quote the RFC in a blockquote ending {{Section N of RFC8707}}`

/** A spec whose main source is an RFC quotes it, and reads with that RFC as no named source. */
const profileCasesTestMain = (t: Suite, all: ProfileCasesTestRfcs): void => {
  const c = profileCasesTestContract(
    t,
    all,
    "a spec with a main source",
    profileCasesTestSpecMain(profileCasesTestSec(profileCasesTestMainQuote(), ""), PROFILE_CASES_MAIN_8707),
  )
  if (c !== null) {
    t.eqStr(
      "main: the requirement cites the main source",
      profileCasesTestReqs(c),
      "R-N - 2 MUST NOT The URI MUST NOT include a fragment component.",
    )
    t.eqStr("main: the contract's main RFC", `${c.source.rfc}`, "8707")
  }
  profileCasesTestRefused(
    t,
    all,
    "a main source nothing cites",
    profileCasesTestSpecMain(
      profileCasesTestSec(profileCasesTestMainQuote(), ""),
      "<keyword>vector-main-RFC4648</keyword>",
    ),
    ["1 RFC4648 is the main source, but nothing cites it; quote it in a requirement"],
  )
  profileCasesTestRefused(
    t,
    all,
    "the spec's own text, when the main source is an RFC",
    profileCasesTestSpecMain(
      profileCasesTestSec(
        `\n${[
          PROFILE_CASES_REQ,
          `<t anchor="R-D">Definition: hex is base 16.</t>`,
          "<t>x <bcp14>SHOULD</bcp14> y.</t>",
          "<t>Untested: no.</t>",
          "<t>z <bcp14>MAY</bcp14> w.</t>",
          profileCasesTestTable([profileCasesTestSrc(`<xref target="here"/>`, "null", "V1")]),
        ].join("\n")}\n`,
        ' anchor="here"',
      ),
      PROFILE_CASES_MAIN_8707,
    ),
    [
      `8 ${profileCasesTestOwn("R-A, a BCP 14 paragraph,")}`,
      `9 ${profileCasesTestOwn("a Definition: paragraph")}`,
      `10 ${profileCasesTestOwn("an excluded paragraph")}`,
      `12 ${profileCasesTestOwn("this BCP 14 sentence")}: "z MAY w."`,
      `14 Covers names "R-A", which is no requirement`,
      `14 ${profileCasesTestOwn("Source here, a section of the spec,")}`,
    ],
  )
  profileCasesTestRefusedWith(
    t,
    all,
    "a second main-source keyword",
    profileCasesTestSpecMain(
      profileCasesTestSec(profileCasesTestMainQuote(), ""),
      `${PROFILE_CASES_MAIN_8707}<keyword>vector-main-RFC4648</keyword>`,
    ),
    ["a spec has one main source; keyword vector-main-RFC4648 names a second"],
  )
  profileCasesTestRefusedWith(
    t,
    all,
    "a main-source keyword spelt wrong",
    profileCasesTestSpecMain(
      profileCasesTestSec(profileCasesTestMainQuote(), ""),
      "<keyword>vector-main-RFC08707</keyword>",
    ),
    ["the main-source keyword is vector-main-RFC<N>, not vector-main-RFC08707"],
  )
  profileCasesTestRefusedWith(
    t,
    all,
    "a main source that is not a normative reference",
    replaceAll(
      profileCasesTestSpecWith(
        profileCasesTestSec(profileCasesTestMainQuote(), ""),
        "draft-t-00",
        profileCasesTestIfaceSection(),
      ),
      "<title>T</title>",
      `<title>T</title>${PROFILE_CASES_MAIN_8707}`,
    ),
    ["vector-main-RFC8707 names RFC8707, which is not a normative reference; list it under normative:"],
  )
}

/** The profile's pinned cases. */
export const main = (): i32 => {
  const t = new Suite("spec/extract profile cases")
  const all = profileCasesTestLoad(t)
  profileCasesTestMinimal(t, all)
  profileCasesTestBlockquote(t, all)
  profileCasesTestSectionSource(t, all)
  profileCasesTestAscending(t, all)
  profileCasesTestProseTable(t, all)
  profileCasesTestShapes(t, all)
  profileCasesTestLevels(t, all)
  profileCasesTestKramdown(t, all)
  profileCasesTestProfileHex(t, all)
  profileCasesTestSentences(t, all)
  profileCasesTestSections(t, all)
  profileCasesTestXrefs(t, all)
  profileCasesTestQuotes(t, all)
  profileCasesTestCode(t, all)
  profileCasesTestNames(t, all)
  profileCasesTestVectors(t, all)
  profileCasesTestMany(t, all)
  profileCasesTestMissing(t, all)
  profileCasesTestLocator(t, all)
  profileCasesTestMain(t, all)
  return t.done()
}
