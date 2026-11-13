import { Suite } from "nish/testing"
import { replaceAll, split } from "nish/text"
import { joinPath, makeTempDir, mkdirAll } from "../../../src/core/fs"
import { SampleTable } from "../../../src/spec/check"
import { contractLoad } from "../../../src/spec/contract/contract"
import { Contract } from "../../../src/spec/contract/types"
import { EmitOptions, emitProgram } from "../../../src/spec/emit/emit"
import { extractContract, extractReaders } from "../../../src/spec/extract"
import { ProfileRefusal, ProfileRfcs, profileRead } from "../../../src/spec/profile/profile"
import { SourceReaders } from "../../../src/spec/source/load"
import { rfcParse } from "../../../src/spec/source/rfc"
import { xmlDocParse } from "../../../src/spec/xml/doc"

// A tolerance in the profile: `Tolerance: V1 ulps 1, {{accuracy}}: "…"` after
// the vector table, end to end from the spec to the emitted comparison, and
// each malformed form refused with its own message.

const PROFILE_TOL_SHA: string = "abababababababababababababababababababababababababababababababab"
const PROFILE_TOL_FIXTURE: string = "tests/fixtures/profile/profile-tolerance.xml"
const PROFILE_TOL_V1: string =
  '<t>Tolerance: V1 ulps 1, <xref target="accuracy"/>: "within one unit in the last place of the exact square root"</t>'
const PROFILE_TOL_V2: string =
  '<t>Tolerance: V2 abs 1e-9, <xref target="accuracy"/>: "within 1e-9 of half its argument"</t>'
const PROFILE_TOL_FORM: string =
  'Tolerance: <vector id> ulps <n>, {{Section N of RFCx}}: "<the sentence that allows it>" (or abs <decimal>, or {{anchor}})'
const PROFILE_TOL_STRAY: string =
  "this Tolerance: paragraph follows no vector table; it must directly follow the vector table or another Tolerance: paragraph"
const PROFILE_TOL_REF: string = `<name>Normative References</name>
<reference anchor="RFC4648"><front><title>B</title></front><seriesInfo name="RFC" value="4648"/></reference>`

/** The fixture with V2's Tolerance: paragraph replaced by `p`. */
const profileTolTestWithV2 = (xml: string, p: string): string => replaceAll(xml, PROFILE_TOL_V2, p)

/** The profile's refusals of the fixture with V2's Tolerance: paragraph `p`. */
const profileTolTestV2 = (xml: string, p: string): string => profileTolTestRead(profileTolTestWithV2(xml, p))

/** RFC 4648, the one RFC a case cites. */
const profileTolTestRfcs = (): ProfileRfcs => {
  const r = new ProfileRfcs()
  r.docs.set(4648, rfcParse(readFileSyncOrNull("rfcs/rfc4648.txt") ?? ""))
  return r
}

/** The profile's refusals of `xml`, each `line message`; "ok" when it reads. */
const profileTolTestRead = (xml: string): string => {
  const doc = xmlDocParse(xml)
  if (doc.isErr()) {
    return `xml ${doc.error.line} ${doc.error.message}`
  }
  const r = profileRead(doc.value, "specs/profile-tolerance.xml", null, profileTolTestRfcs())
  if (r.isErr()) {
    return r.error.map((f: ProfileRefusal): string => `${f.line} ${f.message}`).join("\n")
  }
  return "ok"
}

/** The contract `xml` reads to; null, with a failure, when it is refused. */
const profileTolTestContract = (t: Suite, name: string, xml: string): Contract | null => {
  const doc = xmlDocParse(xml)
  if (doc.isErr()) {
    t.fail(name, doc.error.message)
    return null
  }
  const r = profileRead(doc.value, "specs/profile-tolerance.xml", null, profileTolTestRfcs())
  if (r.isErr()) {
    t.fail(name, r.error.map((f: ProfileRefusal): string => `${f.line} ${f.message}`).join("; "))
    return null
  }
  return r.value.contract
}

/** A vector's tolerance as `ulps n|abs x source section quote`, or "none". */
const profileTolTestOf = (c: Contract, id: string): string => {
  for (const k of c.clauses) {
    if (k.id === id) {
      const tol = k.tolerance
      if (tol === null) {
        return "none"
      }
      const bound = tol.isUlps ? `ulps ${tol.ulps}` : `abs ${tol.abs}`
      return `${bound} ${tol.source ?? "-"} ${tol.section} ${tol.quote}`
    }
  }
  return "no such vector"
}

/** A tree with the spec at specs/<name>.xml. */
const profileTolTestTree = (t: Suite, name: string, xml: string): string | null => {
  const made = makeTempDir("vector-profile-tolerance-")
  if (made.isErr()) {
    t.fail("a temp dir", made.error)
    return null
  }
  const d = made.value
  for (const sub of ["specs", "contracts"]) {
    mkdirAll(joinPath(d, sub), 0o755).expect(sub)
  }
  writeFileSync(joinPath(d, `specs/${name}.xml`), xml)
  return d
}

/**
 * End to end: extract reads both tolerances into the contract, the fidelity
 * gate finds each quote in its section, and emit compares V1 within 1 ulp and
 * V2 within 1e-9. A quote the section does not hold is refused by fidelity at
 * the Tolerance: paragraph's line.
 */
const profileTolTestEndToEnd = (t: Suite, xml: string, readers: SourceReaders): void => {
  const d = profileTolTestTree(t, "profile-tolerance", xml)
  if (d === null) {
    return
  }
  const o = extractContract(
    joinPath(d, "specs/profile-tolerance.xml"),
    joinPath(d, "contracts/profile-tolerance.json"),
    d,
    readers,
  )
  t.eqStr("extract: no error", o.errors.join("; "), "")
  t.eqStr("extract: no refusal", o.refusals.map((r: ProfileRefusal): string => r.message).join("; "), "")
  const c = contractLoad(o.text, "contracts/profile-tolerance.json")
  if (c.isErr()) {
    t.fail("the contract loads", c.error.join("; "))
    return
  }
  t.eqStr(
    "V1's tolerance in the contract",
    profileTolTestOf(c.value, "V1"),
    "ulps 1 - 3 within one unit in the last place of the exact square root",
  )
  t.eqStr(
    "V2's tolerance in the contract",
    profileTolTestOf(c.value, "V2"),
    "abs 1e-9 - 3 within 1e-9 of half its argument",
  )
  t.ok("the contract text says ulps", o.text.indexOf('"ulps": 1,') > 0)
  t.ok("the contract text says abs", o.text.indexOf('"abs": "1e-9",') > 0)
  const p = emitProgram(c.value, new SampleTable(), new EmitOptions(PROFILE_TOL_SHA))
  if (p.isErr()) {
    t.fail("emit", p.error.join("; "))
    return
  }
  t.ok(
    "emit: V1 within 1 ulp",
    p.value.indexOf(
      'nearUlpsF64(t, "[V1] the square root of two (R-SQRT)", fmathSqrt(toF64(2.0)), toF64(1.4142135623730951), toI64(1))',
    ) >= 0,
  )
  t.ok(
    "emit: V2 within 1e-9",
    p.value.indexOf('t.nearF64("[V2] half of one (R-HALF)", fmathHalf(toF64(1.0)), toF64(0.5), toF64(1e-9))') >= 0,
  )

  const bad = replaceAll(
    replaceAll(xml, 'within 1e-9 of half its argument"</t>', 'within 1e-8 of half its argument"</t>'),
    "draft-profile-tolerance-00",
    "draft-profile-bad-00",
  )
  const b = profileTolTestTree(t, "profile-bad", bad)
  if (b === null) {
    return
  }
  const spec = joinPath(b, "specs/profile-bad.xml")
  const out = joinPath(b, "contracts/profile-bad.json")
  const r = extractContract(spec, out, b, readers)
  t.eqStr(
    "a quote the section lacks: refused by fidelity at its paragraph",
    r.refusals.map((f: ProfileRefusal): string => `${f.line} ${f.message}`).join("\n"),
    '94 fidelity: quote not found in §3 ("Accuracy"): "within 1e-8 of half its argument"',
  )
  t.ok("nothing written", readFileSyncOrNull(out) === null)
}

/** A tolerance citing an RFC section records the RFC as its source. */
const profileTolTestRfc = (t: Suite, xml: string): void => {
  const cited = replaceAll(
    profileTolTestWithV2(
      xml,
      '<t>Tolerance: V2 abs 0.5, <xref target="RFC4648" section="10"/>: "BASE16(\\"f\\") = \\"66\\""</t>',
    ),
    "<name>Normative References</name>",
    PROFILE_TOL_REF,
  )
  const c = profileTolTestContract(t, "an RFC-cited tolerance", cited)
  if (c !== null) {
    t.eqStr("its source is the RFC", profileTolTestOf(c, "V2"), 'abs 0.5 rfc4648 10 BASE16(\\"f\\") = \\"66\\"')
  }
  // In a spec whose main source is RFC 4648, the RFC is the main source, and
  // the spec's own section cannot be cited.
  const main = replaceAll(cited, "</front>\n  <middle>", "<keyword>vector-main-RFC4648</keyword></front>\n  <middle>")
  t.ok("main mode: the keyword is in", main !== cited)
  const m = profileTolTestRead(main)
  t.ok(
    "main mode: a spec section is refused",
    m.indexOf(
      "93 the tolerance's section accuracy is the spec's own text, but the main source is RFC4648; quote the RFC in a blockquote ending {{Section N of RFC4648}}",
    ) >= 0,
  )
  t.ok("main mode: the RFC citation is not refused", m.indexOf("\n94 ") < 0 && !m.startsWith("94 "))
}

/** Each malformed Tolerance: paragraph, refused at its line with its own message. */
const profileTolTestRefusals = (t: Suite, xml: string): void => {
  const cases: string[][] = [
    ["an unknown kind", "V2 ulp 1,", `94 V2's tolerance is ulps or abs, not "ulp"`],
    ["ulps 0", "V2 ulps 0,", `94 V2's ulps tolerance is a whole number from 1 to 9007199254740991, not "0"`],
    ["ulps 1.5", "V2 ulps 1.5,", `94 V2's ulps tolerance is a whole number from 1 to 9007199254740991, not "1.5"`],
    ["ulps -1", "V2 ulps -1,", `94 V2's ulps tolerance is a whole number from 1 to 9007199254740991, not "-1"`],
    ["ulps 01", "V2 ulps 01,", `94 V2's ulps tolerance is a whole number from 1 to 9007199254740991, not "01"`],
    [
      "ulps past 2^53-1",
      "V2 ulps 9007199254740992,",
      `94 V2's ulps tolerance is a whole number from 1 to 9007199254740991, not "9007199254740992"`,
    ],
    ["abs 0", "V2 abs 0,", `94 V2's abs tolerance is a decimal greater than 0 as an f64, like 1e-9, not "0"`],
    [
      "abs 0.0e5",
      "V2 abs 0.0e5,",
      `94 V2's abs tolerance is a decimal greater than 0 as an f64, like 1e-9, not "0.0e5"`,
    ],
    [
      "abs -1e-9",
      "V2 abs -1e-9,",
      `94 V2's abs tolerance is a decimal greater than 0 as an f64, like 1e-9, not "-1e-9"`,
    ],
    [
      "abs a word",
      "V2 abs tiny,",
      `94 V2's abs tolerance is a decimal greater than 0 as an f64, like 1e-9, not "tiny"`,
    ],
    ["abs NaN", "V2 abs NaN,", `94 V2's abs tolerance is a decimal greater than 0 as an f64, like 1e-9, not "NaN"`],
    [
      "abs Infinity",
      "V2 abs Infinity,",
      `94 V2's abs tolerance is a decimal greater than 0 as an f64, like 1e-9, not "Infinity"`,
    ],
    [
      "abs +1e-9",
      "V2 abs +1e-9,",
      `94 V2's abs tolerance is a decimal greater than 0 as an f64, like 1e-9, not "+1e-9"`,
    ],
    ["abs 1e400", "V2 abs 1e400,", `94 V2's abs tolerance must be finite, but "1e400" rounds to Infinity`],
    [
      "abs 1e-400",
      "V2 abs 1e-400,",
      `94 V2's abs tolerance is a decimal greater than 0 as an f64, like 1e-9, not "1e-400"`,
    ],
    ["no comma", "V2 abs 1e-9", `94 a Tolerance: paragraph is ${PROFILE_TOL_FORM}`],
    ["no value", "V2 abs,", `94 a Tolerance: paragraph is ${PROFILE_TOL_FORM}`],
    ["an extra word", "V2 abs 1e-9 here,", `94 a Tolerance: paragraph is ${PROFILE_TOL_FORM}`],
    ["an unknown vector", "V9 abs 1e-9,", `94 Tolerance: names "V9", which is no vector of the table`],
  ]
  for (const k of cases) {
    t.eqStr(k[0], profileTolTestRead(replaceAll(xml, "Tolerance: V2 abs 1e-9,", `Tolerance: ${k[1]}`)), k[2])
  }
  const cite = '<xref target="accuracy"/>'
  t.eqStr(
    "no citation",
    profileTolTestV2(xml, '<t>Tolerance: V2 abs 1e-9: "within 1e-9 of half its argument"</t>'),
    `94 a tolerance cites exactly one section that allows it: ${PROFILE_TOL_FORM}`,
  )
  t.eqStr(
    "two citations",
    profileTolTestV2(xml, `<t>Tolerance: V2 abs 1e-9, ${cite}: "within 1e-9" ${cite}</t>`),
    `94 a tolerance cites exactly one section that allows it: ${PROFILE_TOL_FORM}`,
  )
  const noQuote = `94 V2's tolerance quotes the sentence that allows it after the citation: ${PROFILE_TOL_FORM}`
  t.eqStr("no quote", profileTolTestV2(xml, `<t>Tolerance: V2 abs 1e-9, ${cite}</t>`), noQuote)
  t.eqStr("an empty quote", profileTolTestV2(xml, `<t>Tolerance: V2 abs 1e-9, ${cite}: ""</t>`), noQuote)
  t.eqStr("an unquoted quote", profileTolTestV2(xml, `<t>Tolerance: V2 abs 1e-9, ${cite}: within 1e-9</t>`), noQuote)
  t.eqStr("an unclosed quote", profileTolTestV2(xml, `<t>Tolerance: V2 abs 1e-9, ${cite}: "within 1e-9</t>`), noQuote)
  t.eqStr(
    "its own section",
    profileTolTestV2(
      xml,
      '<t>Tolerance: V2 abs 1e-9, <xref target="vectors"/>: "within 1e-9 of half its argument"</t>',
    ),
    "94 the tolerance cites Section 4, which holds this Tolerance: paragraph, so its quote would be found in itself; cite the section that states the tolerance",
  )
  t.eqStr(
    "two on one vector",
    profileTolTestRead(
      replaceAll(xml, PROFILE_TOL_V2, `${PROFILE_TOL_V2}\n${replaceAll(PROFILE_TOL_V2, "abs 1e-9", "abs 1e-8")}`),
    ),
    "95 V2 has a tolerance already; a vector has at most one",
  )
  t.eqStr(
    "a non-f64 result",
    profileTolTestRead(
      replaceAll(replaceAll(xml, "fmathHalf(x: f64): f64", "fmathHalf(x: f64): i64"), "<tt>0.5</tt>", "<tt>0</tt>"),
    ),
    "94 V2's fmathHalf returns i64, and only an f64 result is compared within a tolerance",
  )
  t.eqStr(
    "a stray one in another section",
    profileTolTestRead(replaceAll(xml, '<t anchor="R-HALF">', `${PROFILE_TOL_V2}<t anchor="R-HALF">`)),
    `53 ${PROFILE_TOL_STRAY}`,
  )
  t.eqStr(
    "one after a paragraph after the table",
    profileTolTestRead(replaceAll(xml, PROFILE_TOL_V2, `<t>A paragraph.</t>${PROFILE_TOL_V2}`)),
    `94 ${PROFILE_TOL_STRAY}`,
  )
  t.eqStr(
    "one after a prose table",
    profileTolTestRead(
      replaceAll(
        xml,
        '<t anchor="R-HALF">',
        `<table><thead><tr><th>Name</th></tr></thead><tbody><tr><td>x</td></tr></tbody></table>${PROFILE_TOL_V2}<t anchor="R-HALF">`,
      ),
    ),
    `53 ${PROFILE_TOL_STRAY}`,
  )
  // A tolerance on a row the table refused adds no refusal of its own.
  const refused = profileTolTestRead(replaceAll(xml, "<tt>fmathHalf(1)</tt>", "<tt>fmathHalf()</tt>"))
  t.ok("a refused row's tolerance: the row refused", refused !== "ok")
  t.ok("a refused row's tolerance: not refused itself", refused.indexOf("olerance") < 0)
  t.eqStr(
    "a BCP 14 keyword in a quote is quoted, not a requirement",
    profileTolTestRead(
      replaceAll(xml, 'within 1e-9 of half its argument"</t>', 'within 1e-9 <bcp14>MUST</bcp14> hold"</t>'),
    ),
    "ok",
  )
}

/** The 1-based line of `xml` that holds `marker`, or 0 when none does. */
const profileTolTestLine = (xml: string, marker: string): i32 => {
  const at = xml.indexOf(marker)
  return at < 0 ? 0 : split(xml.substring(0, at), "\n").length
}

/** The profile's tolerance spelling, end to end and refused. */
export const main = (): i32 => {
  const t = new Suite("spec/extract profile tolerance")
  const xml = readFileSyncOrNull(PROFILE_TOL_FIXTURE) ?? ""
  t.ok("the fixture holds V1's tolerance", xml.indexOf(PROFILE_TOL_V1) > 0)
  t.ok("the fixture holds V2's tolerance", xml.indexOf(PROFILE_TOL_V2) > 0)
  t.eqStr("the fixture reads", profileTolTestRead(xml), "ok")
  // The refusal cases name these fixture lines: V1's and V2's Tolerance:
  // paragraphs, and R-HALF, where a stray one is planted.
  t.eqStr(
    "the refusal cases' fixture lines",
    `${profileTolTestLine(xml, PROFILE_TOL_V1)} ${profileTolTestLine(xml, PROFILE_TOL_V2)} ${profileTolTestLine(xml, '<t anchor="R-HALF">')}`,
    "93 94 53",
  )
  const readers = extractReaders()
  if (readers.isErr()) {
    t.fail("the readers register", readers.error)
  } else {
    profileTolTestEndToEnd(t, xml, readers.value)
  }
  profileTolTestRfc(t, xml)
  profileTolTestRefusals(t, xml)
  return t.done()
}
