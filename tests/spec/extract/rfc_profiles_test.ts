import { Suite } from "nish/testing"
import { Contract } from "../../../src/spec/contract/types"
import { ProfileRefusal, ProfileRfcs, profileRead } from "../../../src/spec/profile/profile"
import { xmlDocParse, xmlRead } from "../../../src/spec/xml/doc"

// The main-source profile: a spec whose keyword vector-main-RFC<N> makes an
// RFC its main source, read from variants of the rfc-main mini-frame fixture.

const RFC_PROFILES_TEST_FILE: string = "specs/mini-frame.xml"
const RFC_PROFILES_TEST_KEY: string = "<keyword>vector-main-RFC9990</keyword>"
const RFC_PROFILES_TEST_XREF: string = `<xref section="2" sectionFormat="of" target="RFC9990"/>`
const RFC_PROFILES_TEST_END: string = "</section>\n  </middle>"
const RFC_PROFILES_TEST_IFACE: string = "// module: nish/mini/frame\nexport function frame(data: u8[]): u8[] | null"
const RFC_PROFILES_TEST_ASSERT: string = "unwrap(frame(data)).length === data.length + 1"
const RFC_PROFILES_TEST_OWN: string =
  "is the spec's own text, but the main source is RFC9990; quote the RFC in a blockquote ending {{Section N of RFC9990}}"

/** The RFCs handed to the profile: `rfcPath` as RFC `rfc`, or none when `rfc` is 0. */
const rfcProfilesTestRfcs = (t: Suite, rfc: i32, rfcPath: string): ProfileRfcs => {
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

/** `xml` with the first `from` replaced by `to`; fails the suite when `from` is absent. */
const rfcProfilesTestSub = (t: Suite, xml: string, from: string, to: string): string => {
  const at = xml.indexOf(from)
  if (at < 0) {
    t.fail("the variant's text is in the fixture", from)
    return xml
  }
  return xml.substring(0, at) + to + xml.substring(at + from.length)
}

/** `xml` without the text from `start` through the first `end` after it. */
const rfcProfilesTestCut = (t: Suite, xml: string, start: string, end: string): string => {
  const at = xml.indexOf(start)
  const stop = at < 0 ? -1 : xml.indexOf(end, at)
  if (stop < 0) {
    t.fail("the cut's text is in the fixture", start)
    return xml
  }
  return xml.substring(0, at) + xml.substring(stop + end.length)
}

/** The 1-based line of `xml` that first holds `needle`, or 0. */
const rfcProfilesTestLine = (xml: string, needle: string): i32 => {
  const at = xml.indexOf(needle)
  if (at < 0) {
    return 0
  }
  let line: i32 = 1
  for (let i: i32 = 0; i < at; i++) {
    if (xml.charCodeAt(i) === 10) {
      line++
    }
  }
  return line
}

/** Reads `xml` under the profile: `ok <contract>`, or each refusal as `file:line message`. */
const rfcProfilesTestRead = (xml: string, rfcs: ProfileRfcs): string => {
  const doc = xmlDocParse(xml)
  if (doc.isErr()) {
    return `xml ${doc.error.message}`
  }
  const r = profileRead(doc.value, RFC_PROFILES_TEST_FILE, null, rfcs)
  if (r.isErr()) {
    return r.error.map((f: ProfileRefusal): string => `${f.file}:${f.line} ${f.message}`).join("\n")
  }
  return `ok ${r.value.contract.contract}`
}

/** The contract `xml` reads to, or null after failing the suite with its refusals. */
const rfcProfilesTestContract = (t: Suite, name: string, xml: string, rfcs: ProfileRfcs): Contract | null => {
  const doc = xmlDocParse(xml)
  if (doc.isErr()) {
    t.fail(name, `xml ${doc.error.message}`)
    return null
  }
  const r = profileRead(doc.value, RFC_PROFILES_TEST_FILE, null, rfcs)
  if (r.isErr()) {
    t.fail(name, r.error.map((f: ProfileRefusal): string => `${f.line} ${f.message}`).join("; "))
    return null
  }
  return r.value.contract
}

/** Asserts `xml` is refused with `want`, anywhere. */
const rfcProfilesTestRefused = (t: Suite, name: string, xml: string, rfcs: ProfileRfcs, want: string): void => {
  t.contains(name, rfcProfilesTestRead(xml, rfcs), ` ${want}`)
}

/** Asserts `xml` is refused with `want` at the line holding `needle`. */
const rfcProfilesTestRefusedAt = (
  t: Suite,
  name: string,
  xml: string,
  rfcs: ProfileRfcs,
  needle: string,
  want: string,
): void => {
  const line = rfcProfilesTestLine(xml, needle)
  t.ok(`${name}: the needle is in the variant`, line > 0)
  t.contains(name, rfcProfilesTestRead(xml, rfcs), `${RFC_PROFILES_TEST_FILE}:${line} ${want}`)
}

/** Each function of `c` as `name@module`, the module `-` when it is the module under test. */
const rfcProfilesTestFunctions = (c: Contract): string => {
  const out: string[] = []
  for (const f of c.functions) {
    const m = f.module
    out.push(m === null ? `${f.name}@-` : `${f.name}@${m}`)
  }
  return out.join(" ")
}

/** The main-source keyword: a normative, cited RFC passes; anything else is refused. */
const rfcProfilesTestKeyword = (t: Suite, base: string, rfcs: ProfileRfcs): void => {
  const c = rfcProfilesTestContract(t, "the fixture reads", base, rfcs)
  if (c !== null) {
    t.eqStr("the main source's RFC", `${c.source.rfc}`, "9990")
    t.eqStr("the main source's title", c.source.title, "Mini Framing profile")
    t.eqStr("no main path", c.source.main ?? "-", "-")
    t.eqStr("the requirements", c.requirements.map((q): string => q.id).join(" "), "R-PREFIX R-LIMIT")
  }
  rfcProfilesTestRefused(
    t,
    "an RFC that is not a normative reference",
    rfcProfilesTestSub(t, base, "<name>Normative References</name>", "<name>Informative References</name>"),
    rfcs,
    "vector-main-RFC9990 names RFC9990, which is not a normative reference; list it under normative:",
  )
  const uncited = rfcProfilesTestSub(
    t,
    rfcProfilesTestSub(
      t,
      base,
      "</references>",
      `<reference anchor="RFC9991"><front><title>T</title></front><seriesInfo name="RFC" value="9991"/></reference></references>`,
    ),
    RFC_PROFILES_TEST_KEY,
    "<keyword>vector-main-RFC9991</keyword>",
  )
  rfcProfilesTestRefused(
    t,
    "an RFC that nothing cites",
    uncited,
    rfcs,
    "RFC9991 is the main source, but nothing cites it; quote it in a requirement",
  )
  rfcProfilesTestRefused(
    t,
    "two main-source keywords",
    rfcProfilesTestSub(
      t,
      base,
      RFC_PROFILES_TEST_KEY,
      `${RFC_PROFILES_TEST_KEY}<keyword>vector-main-RFC9991</keyword>`,
    ),
    rfcs,
    "a spec has one main source; keyword vector-main-RFC9991 names a second",
  )
  for (const key of ["vector-main-rfc9990", "Vector-Main-RFC9990", "vector_main_RFC9990", "vector-main RFC9990"]) {
    rfcProfilesTestRefused(
      t,
      `the misspelt keyword ${key}`,
      rfcProfilesTestSub(t, base, RFC_PROFILES_TEST_KEY, `<keyword>${key}</keyword>`),
      rfcs,
      `the main-source keyword is vector-main-RFC<N>, not ${key}`,
    )
  }
  const unanchored = rfcProfilesTestSub(
    t,
    base,
    RFC_PROFILES_TEST_END,
    `<blockquote><t>The implementation <bcp14>MUST</bcp14> zero the key after use.</t></blockquote>${RFC_PROFILES_TEST_END}`,
  )
  rfcProfilesTestRefusedAt(
    t,
    "a BCP 14 sentence in an unanchored blockquote with no Untested:",
    unanchored,
    rfcs,
    "zero the key after use",
    'this BCP 14 sentence is an RFC quote with no anchor and no Untested: paragraph; anchor the blockquote to require it, or follow it with Untested: to exclude it: "The implementation MUST zero the key after use."',
  )
  const maint = rfcProfilesTestContract(
    t,
    "a keyword that only starts like vector-main",
    rfcProfilesTestSub(t, base, RFC_PROFILES_TEST_KEY, `${RFC_PROFILES_TEST_KEY}<keyword>vector-maintenance</keyword>`),
    rfcs,
  )
  if (maint !== null) {
    t.eqStr("vector-maintenance is not a main key", `${maint.source.rfc}`, "9990")
  }
}

/** In main mode the spec's own normative text is refused, at its line. */
const rfcProfilesTestOwnText = (t: Suite, base: string, rfcs: ProfileRfcs): void => {
  const rows: string[][] = [
    [
      "an anchored BCP 14 paragraph",
      `<t anchor="R-OWN">A frame <bcp14>MUST</bcp14> be short.</t>`,
      `R-OWN, a BCP 14 paragraph, ${RFC_PROFILES_TEST_OWN}`,
    ],
    [
      "an unanchored BCP 14 paragraph with no Untested:",
      "<t>A frame <bcp14>MUST</bcp14> be short.</t>",
      `this BCP 14 sentence ${RFC_PROFILES_TEST_OWN}: "A frame MUST be short."`,
    ],
    [
      "a Definition: paragraph",
      `<t anchor="D-FRAME">Definition: a frame is a length octet and data.</t>`,
      `a Definition: paragraph ${RFC_PROFILES_TEST_OWN}`,
    ],
    [
      "an excluded paragraph",
      "<t>The implementation <bcp14>MUST</bcp14> zero the key after use.</t><t>Untested: not observable.</t>",
      `an excluded paragraph ${RFC_PROFILES_TEST_OWN}`,
    ],
    [
      "a vector whose Source is a section of the spec",
      `<table><thead><tr><th>Id</th><th>Call</th><th>Expected</th><th>Covers</th><th>Source</th><th>Title</th></tr></thead><tbody><tr><td>V1</td><td><tt>frame(data = 00)</tt></td><td><tt>result = 0100</tt></td><td>R-PREFIX</td><td><xref target="framing"/></td><td>one octet</td></tr></tbody></table>`,
      `Source framing, a section of the spec, ${RFC_PROFILES_TEST_OWN}`,
    ],
  ]
  for (const row of rows) {
    const xml = rfcProfilesTestSub(t, base, RFC_PROFILES_TEST_END, `${row[1]}${RFC_PROFILES_TEST_END}`)
    rfcProfilesTestRefusedAt(t, row[0], xml, rfcs, row[1], row[2])
  }
}

/** An unanchored RFC blockquote followed by Untested: excludes its sentence. */
const rfcProfilesTestExcluded = (t: Suite, base: string, rfcs: ProfileRfcs): void => {
  const limit = `<blockquote anchor="R-LIMIT">\n        <t>A sender MUST NOT frame more than 255 octets. ${RFC_PROFILES_TEST_XREF}</t>\n      </blockquote>`
  const excluded = rfcProfilesTestSub(
    t,
    base,
    limit,
    `<blockquote>\n        <t>A sender MUST NOT frame more than 255 octets. ${RFC_PROFILES_TEST_XREF}</t>\n      </blockquote>\n      <t>Untested: the limit is left out.</t>`,
  )
  const noLimit = rfcProfilesTestCut(
    t,
    excluded,
    `<sourcecode type="ts-property"><![CDATA[\n// P-LIMIT`,
    "</sourcecode>",
  )
  const c = rfcProfilesTestContract(t, "an excluded blockquote reads", noLimit, rfcs)
  if (c !== null) {
    t.eqStr("only R-PREFIX is required", c.requirements.map((q): string => q.id).join(" "), "R-PREFIX")
    const ex = c.exclusions
    if (ex === null) {
      t.fail("the exclusion is kept", "no exclusions")
    } else {
      t.eqStr("one exclusion", `${ex.length}`, "1")
      if (ex.length > 0) {
        t.eqStr("the exclusion's section", ex[0].section, "2")
        t.eqStr("the exclusion's reason", ex[0].reason, "the limit is left out.")
      }
    }
  }
  const moved = rfcProfilesTestSub(
    t,
    rfcProfilesTestSub(t, excluded, "<t>Untested: the limit is left out.</t>", ""),
    RFC_PROFILES_TEST_END,
    `<t>Untested: the limit is left out.</t>${RFC_PROFILES_TEST_END}`,
  )
  rfcProfilesTestRefused(
    t,
    "an Untested: that does not directly follow the blockquote",
    moved,
    rfcs,
    "this Untested: paragraph excludes nothing; it must directly follow the requirement or BCP 14 paragraph it excludes",
  )
  rfcProfilesTestRefused(
    t,
    "an excluded blockquote with no BCP 14 keyword",
    rfcProfilesTestSub(t, excluded, "A sender MUST NOT frame more than 255 octets.", "A sender frames octets."),
    rfcs,
    "an excluded blockquote holds no BCP 14 keyword, so it excludes nothing; anchor it to exclude a definition",
  )
  rfcProfilesTestRefused(
    t,
    "an excluded blockquote that does not end in its section xref",
    rfcProfilesTestSub(t, excluded, `255 octets. ${RFC_PROFILES_TEST_XREF}`, "255 octets."),
    rfcs,
    "an excluded blockquote must be <t> paragraphs, the last ending with {{Section N of RFCx}}",
  )
}

/** A Note: right after a requirement is its note; one that follows none is refused. */
const rfcProfilesTestNote = (t: Suite, base: string, rfcs: ProfileRfcs): void => {
  const noted = rfcProfilesTestSub(
    t,
    base,
    "</blockquote>\n      <sourcecode",
    "</blockquote>\n      <t>Note: one octet holds 0..255.</t>\n      <sourcecode",
  )
  const c = rfcProfilesTestContract(t, "a requirement with a note reads", noted, rfcs)
  if (c !== null && c.requirements.length > 0) {
    t.eqStr("the noted requirement", c.requirements[0].id, "R-PREFIX")
    t.eqStr("the requirement's note", c.requirements[0].note ?? "-", "one octet holds 0..255.")
  }
  rfcProfilesTestRefused(
    t,
    "a Note: that follows no requirement",
    rfcProfilesTestSub(
      t,
      base,
      `<section anchor="framing">\n      <name>Framing</name>`,
      `<section anchor="framing">\n      <name>Framing</name>\n      <t>Note: nothing here.</t>`,
    ),
    rfcs,
    "this Note: paragraph notes nothing; it must directly follow the requirement it notes",
  )
}

/** `// module:` lines in a ts-interface: reference modules, and the lines refused. */
const rfcProfilesTestModules = (t: Suite, base: string, rfcs: ProfileRfcs): void => {
  const iface = RFC_PROFILES_TEST_IFACE
  for (const end of [" /* frame */;", " // frames\n;"]) {
    const c = rfcProfilesTestContract(
      t,
      `a signature ending ${end}`,
      rfcProfilesTestSub(t, base, iface, `${iface}${end}`),
      rfcs,
    )
    if (c !== null) {
      t.eqStr(`a comment before ; is skipped: ${end}`, rfcProfilesTestFunctions(c), "frame@-")
    }
  }
  for (const comment of ["// module-level helper", "// module under test"]) {
    const after = rfcProfilesTestContract(
      t,
      `${comment} after a signature`,
      rfcProfilesTestSub(t, base, iface, `${iface}\n${comment}\n;`),
      rfcs,
    )
    if (after !== null) {
      t.eqStr(`${comment} before ; is skipped`, rfcProfilesTestFunctions(after), "frame@-")
    }
    const between = rfcProfilesTestContract(
      t,
      `${comment} between signatures`,
      rfcProfilesTestSub(t, base, iface, `${iface};\n${comment}\nexport function len(data: u8[]): i32`),
      rfcs,
    )
    if (between !== null) {
      t.eqStr(`${comment} between signatures names no module`, rfcProfilesTestFunctions(between), "frame@- len@-")
    }
  }
  const later = rfcProfilesTestContract(
    t,
    "a later module line",
    rfcProfilesTestSub(t, base, iface, `${iface}\n// module: nish/mini/len\nexport function len(data: u8[]): i32`),
    rfcs,
  )
  if (later !== null) {
    t.eqStr(
      "functions after a later module line name that module",
      rfcProfilesTestFunctions(later),
      "frame@- len@nish/mini/len",
    )
  }
  const empty = rfcProfilesTestSub(
    t,
    base,
    iface,
    "// module: nish/mini/frame\n// module: nish/mini/other\nexport function frame(data: u8[]): u8[] | null",
  )
  rfcProfilesTestRefusedAt(
    t,
    "a module under test that declares no function",
    empty,
    rfcs,
    "// module: nish/mini/other",
    "nish/mini/frame, the module under test, declares no function; declare its functions before `// module: nish/mini/other`",
  )
  const rows: string[][] = [
    [
      "a module that is not a module path",
      `${iface}\n// module: Std/len\nexport function len(data: u8[]): i32`,
      "`Std/len` is not a module path; write <root>/<path>, lowercase segments split by /",
    ],
    [
      "a module line in a block comment",
      `${iface}\n/* module: nish/mini/len */\nexport function len(data: u8[]): i32`,
      "a module line is a line comment; write `// module: nish/mini/len`",
    ],
    [
      "a module line inside a signature",
      "// module: nish/mini/frame\nexport function frame(\n// module: nish/mini/len\ndata: u8[]): u8[] | null",
      "a module line goes between signatures, on its own line; move it out of this one",
    ],
    [
      "a module line before the previous signature's ;",
      `${iface}\n// module: nish/mini/len\n;`,
      "end `frame` with its `;` before this module line",
    ],
    [
      "the same module twice in a row",
      `${iface}\n// module: nish/mini/len\n// module: nish/mini/len\nexport function len(data: u8[]): i32`,
      "the functions above are already from nish/mini/len",
    ],
    [
      "the module under test again",
      `${iface}\n// module: nish/mini/len\nexport function len(data: u8[]): i32\n// module: nish/mini/frame\nexport function unframe(data: u8[]): u8[]`,
      "nish/mini/frame is the module under test; declare its functions first, before any `// module:` line",
    ],
  ]
  const nearMisses = [
    "// Module: nish/mini/len",
    "//module nish/mini/len",
    "// module: nish/a nish/b",
    "/// module: nish/mini/len",
    "/* Module: nish/mini/len */",
    "/* module nish/mini/len */",
    "/** MODULE: nish/mini/len */",
  ]
  for (const line of nearMisses) {
    rows.push([
      `the near-miss ${line}`,
      `${iface}\n${line}\nexport function len(data: u8[]): i32`,
      `a module line is \`// module: <root>/<path>\`, one module, not \`${line}\``,
    ])
  }
  for (const row of rows) {
    rfcProfilesTestRefused(t, row[0], rfcProfilesTestSub(t, base, iface, row[1]), rfcs, row[2])
  }
}

/** A clause must test the module under test, not only a reference module. */
const rfcProfilesTestUnderTest = (t: Suite, base: string, rfcs: ProfileRfcs): void => {
  const withRef = rfcProfilesTestSub(
    t,
    base,
    RFC_PROFILES_TEST_IFACE,
    `${RFC_PROFILES_TEST_IFACE}\n// module: nish/mini/ref\nexport function g(data: u8[]): u8[] | null`,
  )
  rfcProfilesTestRefusedAt(
    t,
    "a property whose assertion calls only reference functions",
    rfcProfilesTestSub(t, withRef, RFC_PROFILES_TEST_ASSERT, "unwrap(g(data)).length === data.length + 1"),
    rfcs,
    "P-PREFIX covers",
    "property P-PREFIX's assertion calls only reference functions (g); call a function of nish/mini/frame, the module under test",
  )
  const both = rfcProfilesTestContract(
    t,
    "a property that also calls a function under test",
    rfcProfilesTestSub(t, withRef, RFC_PROFILES_TEST_ASSERT, "unwrap(frame(data)).length === unwrap(g(data)).length"),
    rfcs,
  )
  if (both !== null) {
    t.eqStr("a property that also calls frame passes", rfcProfilesTestFunctions(both), "frame@- g@nish/mini/ref")
  }
  const vectors = `<table><thead><tr><th>Id</th><th>Call</th><th>Expected</th><th>Covers</th><th>Source</th><th>Title</th></tr></thead><tbody><tr><td>V1</td><td><tt>g(data = 00)</tt></td><td><tt>result = 0100</tt></td><td>R-PREFIX</td><td>${RFC_PROFILES_TEST_XREF}</td><td>one octet</td></tr></tbody></table>`
  rfcProfilesTestRefusedAt(
    t,
    "a vector whose Call is a reference function",
    rfcProfilesTestSub(t, withRef, RFC_PROFILES_TEST_END, `${vectors}${RFC_PROFILES_TEST_END}`),
    rfcs,
    "<tt>g(data = 00)</tt>",
    "Call: g is a reference function of nish/mini/ref; a vector tests nish/mini/frame, the module under test, so call one of its functions",
  )
}

/** Runs the main-source profile cases. */
/** A no-break space between MUST and NOT is still MUST NOT: the text collapse folds it, as JavaScript's `\s` did. */
const rfcProfilesTestNbsp = (t: Suite, base: string, rfcs: ProfileRfcs): void => {
  const xml = rfcProfilesTestSub(t, base, "A sender MUST NOT frame", "A sender MUST&#160;NOT frame")
  const c = rfcProfilesTestContract(t, "MUST&#160;NOT", xml, rfcs)
  if (c !== null) {
    t.eqStr(
      "MUST&#160;NOT is MUST NOT, not MUST",
      c.requirements.map((q): string => `${q.id}=${q.level}`).join(" "),
      "R-PREFIX=MUST R-LIMIT=MUST NOT",
    )
  }
}

export const main = (): i32 => {
  const t = new Suite("rfc profiles")
  const base = readFileSyncOrNull("tests/fixtures/rfc-main/specs/mini-frame.xml") ?? ""
  t.ok("the fixture is read", base.length > 0)
  const rfcs = rfcProfilesTestRfcs(t, 9990, "tests/fixtures/rfc-main/rfcs/rfc9990.xml")
  rfcProfilesTestKeyword(t, base, rfcs)
  rfcProfilesTestOwnText(t, base, rfcs)
  rfcProfilesTestExcluded(t, base, rfcs)
  rfcProfilesTestNote(t, base, rfcs)
  rfcProfilesTestModules(t, base, rfcs)
  rfcProfilesTestUnderTest(t, base, rfcs)
  rfcProfilesTestNbsp(t, base, rfcs)
  return t.done()
}
