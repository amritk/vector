import { Suite } from "nish/testing"
import { ProfileRefusal, ProfileRfcs, profileRead } from "../../../src/spec/profile/profile"
import { xmlDocParse, xmlRead } from "../../../src/spec/xml/doc"

// A refused ts-interface block: its refusal is printed first, wherever the
// block is, and the calls that are unknown only because it declares nothing
// are not refused, while every other refusal still is. Read through
// profileRead from variants of the rfc-main mini-frame fixture.

const PROFILE_IFACE_REFUSED_TEST_FILE: string = "specs/mini-frame.xml"
const PROFILE_IFACE_REFUSED_TEST_MODULE: string = "// module: nish/mini/frame"
const PROFILE_IFACE_REFUSED_TEST_FN: string = "export function frame(data: u8[]): u8[] | null"
const PROFILE_IFACE_REFUSED_TEST_END: string = "</section>\n  </middle>"
const PROFILE_IFACE_REFUSED_TEST_XREF: string = `<xref section="2" sectionFormat="of" target="RFC9990"/>`

/** A vector table of one row, calling `call` and expecting `expected`. */
const profileIfaceRefusedTestTable = (call: string, expected: string): string =>
  `<table><thead><tr><th>Id</th><th>Call</th><th>Expected</th><th>Covers</th><th>Source</th><th>Title</th></tr></thead><tbody><tr><td>V1</td><td><tt>${call}</tt></td><td><tt>${expected}</tt></td><td>R-PREFIX</td><td>${PROFILE_IFACE_REFUSED_TEST_XREF}</td><td>one octet</td></tr></tbody></table>`

/** `xml` with the first `from` replaced by `to`; fails the suite when `from` is absent. */
const profileIfaceRefusedTestSub = (t: Suite, xml: string, from: string, to: string): string => {
  const at = xml.indexOf(from)
  if (at < 0) {
    t.fail("the variant's text is in the fixture", from)
    return xml
  }
  return xml.substring(0, at) + to + xml.substring(at + from.length)
}

/** The 1-based line of `xml` that first holds `needle`, or 0. */
const profileIfaceRefusedTestLine = (xml: string, needle: string): i32 => {
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

/** Each refusal of `xml` as `line message`, in the order profileRead gives them; [] when it reads. */
const profileIfaceRefusedTestRead = (t: Suite, name: string, xml: string, rfcs: ProfileRfcs): string[] => {
  const doc = xmlDocParse(xml)
  if (doc.isErr()) {
    t.fail(name, `xml ${doc.error.message}`)
    return []
  }
  const r = profileRead(doc.value, PROFILE_IFACE_REFUSED_TEST_FILE, null, rfcs)
  if (r.isOk()) {
    return []
  }
  return r.error.map((f: ProfileRefusal): string => `${f.line} ${f.message}`)
}

/** Whether a refusal is one a call to an undeclared function gives. */
const profileIfaceRefusedTestCascade = (line: string): boolean =>
  line.indexOf("unknown function `") >= 0 || line.indexOf("is not a function of the ts-interface block") >= 0

/**
 * Asserts the variant's first refusal is at the line holding `needle` and
 * says `want`, that no refusal is a cascade, and that each of `also` is
 * still refused.
 */
const profileIfaceRefusedTestFirst = (
  t: Suite,
  name: string,
  xml: string,
  rfcs: ProfileRfcs,
  needle: string,
  want: string,
  also: string[],
): void => {
  const line = profileIfaceRefusedTestLine(xml, needle)
  t.ok(`${name}: the needle is in the variant`, line > 0)
  const got = profileIfaceRefusedTestRead(t, name, xml, rfcs)
  t.ok(`${name}: refused`, got.length > 0)
  if (got.length === 0) {
    return
  }
  t.eqStr(`${name}: the interface's refusal is first`, got[0].substring(0, `${line} `.length), `${line} `)
  t.contains(`${name}: the interface's refusal`, got[0], want)
  const cascade = got.filter((g: string): boolean => profileIfaceRefusedTestCascade(g))
  t.eqStr(`${name}: no call is refused for the interface's refusal`, cascade.join("; "), "")
  for (const a of also) {
    t.ok(
      `${name}: still refused: ${a}`,
      got.some((g: string): boolean => g.indexOf(a) >= 0),
    )
  }
}

/** The fixture with a vector calling frame, and the interface's lines as `iface`. */
const profileIfaceRefusedTestBase = (t: Suite, base: string, iface: string): string => {
  const withVector = profileIfaceRefusedTestSub(
    t,
    base,
    PROFILE_IFACE_REFUSED_TEST_END,
    `${profileIfaceRefusedTestTable("frame(data = 00)", "result = 0100")}${PROFILE_IFACE_REFUSED_TEST_END}`,
  )
  return profileIfaceRefusedTestSub(
    t,
    withVector,
    `${PROFILE_IFACE_REFUSED_TEST_MODULE}\n${PROFILE_IFACE_REFUSED_TEST_FN}`,
    iface,
  )
}

/** Each refused form of the interface's module lines: refused first, with no cascade. */
const profileIfaceRefusedTestForms = (t: Suite, base: string, rfcs: ProfileRfcs): void => {
  const fn = PROFILE_IFACE_REFUSED_TEST_FN
  // name, the interface's text, the text of the line refused, a word of its refusal
  const rows: string[][] = [
    ["a root that is not lowercase", `// module: Std/len\n${fn}`, "// module: Std/len", "`Std/len`"],
    [
      "a segment that is not lowercase",
      `// module: nish/net/Quic-packet\n${fn}`,
      "// module: nish/net/Quic-packet",
      "`nish/net/Quic-packet`",
    ],
    ["a block comment for the module line", `/* module: nish/mini/frame */\n${fn}`, "/* module:", "module"],
    [
      "a later module line refused",
      `${PROFILE_IFACE_REFUSED_TEST_MODULE}\n${fn}\n// module: Nish/ref\nexport function g(data: u8[]): u8[] | null`,
      "// module: Nish/ref",
      "`Nish/ref`",
    ],
    ["the module line missing", fn, fn, "missing `// module: <root>/<path>` first line"],
  ]
  for (const row of rows) {
    const xml = profileIfaceRefusedTestBase(t, base, row[1])
    profileIfaceRefusedTestFirst(t, row[0], xml, rfcs, row[2], row[3], [])
  }
}

/** The interface after the sections that call it, and an independent refusal before it. */
const profileIfaceRefusedTestOrder = (t: Suite, base: string, rfcs: ProfileRfcs): void => {
  const refused = profileIfaceRefusedTestBase(t, base, `// module: Std/len\n${PROFILE_IFACE_REFUSED_TEST_FN}`)
  const start = refused.indexOf(`    <section anchor="interface">`)
  const stop = refused.indexOf(`    <section anchor="framing">`)
  t.ok("the interface section is in the fixture", start >= 0 && stop > start)
  const ifaceSection = refused.substring(start, stop)
  const moved = profileIfaceRefusedTestSub(
    t,
    refused.substring(0, start) + refused.substring(stop),
    "  </middle>",
    `${ifaceSection}  </middle>`,
  )
  t.ok(
    "the interface is after the property calling frame",
    profileIfaceRefusedTestLine(moved, "// module: Std/len") > profileIfaceRefusedTestLine(moved, "unwrap(frame"),
  )
  profileIfaceRefusedTestFirst(t, "an interface after its callers", moved, rfcs, "// module: Std/len", "`Std/len`", [])
  // Independent refusals before the interface: a property's syntax, a
  // vector's Expected, and a quote that is not in its RFC.
  const syntax = profileIfaceRefusedTestSub(t, moved, "/* 256..300 */", "/* 300..256 */")
  const badExpected = profileIfaceRefusedTestSub(t, syntax, "<tt>result = 0100</tt>", "<tt>result = 01zz</tt>")
  const badQuote = profileIfaceRefusedTestSub(
    t,
    badExpected,
    "A sender MUST prefix each frame",
    "A sender MUST prefix every frame",
  )
  const got = profileIfaceRefusedTestRead(t, "the independent refusals", badQuote, rfcs)
  t.eqStr(
    "the independent refusals, after the interface's",
    got.join("\n"),
    [
      `${profileIfaceRefusedTestLine(badQuote, "// module: Std/len")} \`Std/len\` is not a module path; write <root>/<path>, lowercase segments split by /`,
      `${profileIfaceRefusedTestLine(badQuote, `<blockquote anchor="R-PREFIX">`)} R-PREFIX is not in Section 2 of RFC9990: "A sender MUST prefix every frame with its length in one octet."`,
      `${profileIfaceRefusedTestLine(badQuote, "/* 300..256 */")} the length bounds of \`data\` (u8[]) must satisfy 0 <= lo <= hi <= 4096`,
      `${profileIfaceRefusedTestLine(badQuote, "01zz")} Expected: a labelled value is \`Label = hex\` (lowercase hex pairs with no spaces), \`Label = 42\` or \`Label = 22 × 0b\``,
    ].join("\n"),
  )
  profileIfaceRefusedTestFirst(
    t,
    "independent refusals before the interface",
    badQuote,
    rfcs,
    "// module: Std/len",
    "`Std/len`",
    ["the length bounds", "Expected:", "R-PREFIX"],
  )
}

/** Each refusal independent of a refused interface: still given, with no cascade. */
const profileIfaceRefusedTestIndependent = (t: Suite, base: string, rfcs: ProfileRfcs): void => {
  const refused = profileIfaceRefusedTestBase(t, base, `// module: Std/len\n${PROFILE_IFACE_REFUSED_TEST_FN}`)
  // name, the text replaced, its replacement, a word of the refusal still given
  const rows: string[][] = [
    ["a vector's Call that does not parse", "<tt>frame(data = 00)</tt>", "<tt>frame(data = )</tt>", "Call:"],
    [
      "a vector's Source in no section of its RFC",
      `<td>${PROFILE_IFACE_REFUSED_TEST_XREF}</td><td>one octet</td>`,
      `<td><xref section="99" sectionFormat="of" target="RFC9990"/></td><td>one octet</td>`,
      "Section 99",
    ],
    [
      "a property's construct outside the subset, beside a call to the block",
      "=> frame(data) === null",
      '=> typeof data === "object" && frame(data) === null',
      "typeof",
    ],
  ]
  for (const row of rows) {
    const xml = profileIfaceRefusedTestSub(t, refused, row[1], row[2])
    profileIfaceRefusedTestFirst(t, row[0], xml, rfcs, "// module: Std/len", "`Std/len`", [row[3]])
  }
}

/** With the interface read, a call to an undeclared function is still refused. */
const profileIfaceRefusedTestUndeclared = (t: Suite, base: string, rfcs: ProfileRfcs): void => {
  const fn = PROFILE_IFACE_REFUSED_TEST_FN
  const read = profileIfaceRefusedTestBase(t, base, `${PROFILE_IFACE_REFUSED_TEST_MODULE}\n${fn}`)
  const property = profileIfaceRefusedTestSub(t, read, "=> frame(data) === null", "=> h(data) === null")
  const got = profileIfaceRefusedTestRead(t, "a property calling an undeclared function", property, rfcs)
  t.ok(
    "a property calling h is refused",
    got.some((g: string): boolean => g.indexOf("unknown function `h`") >= 0),
  )
  const vector = profileIfaceRefusedTestSub(t, read, "<tt>frame(data = 00)</tt>", "<tt>h(data = 00)</tt>")
  const got2 = profileIfaceRefusedTestRead(t, "a vector calling an undeclared function", vector, rfcs)
  t.ok(
    "a vector calling h is refused",
    got2.some((g: string): boolean => g.indexOf(`"h" is not a function of the ts-interface block`) >= 0),
  )
}

export const main = (): i32 => {
  const t = new Suite("profile: a refused ts-interface block")
  const base = readFileSyncOrNull("tests/fixtures/rfc-main/specs/mini-frame.xml") ?? ""
  t.ok("the fixture is read", base.length > 0)
  const rfcs = new ProfileRfcs()
  const rfcPath = "tests/fixtures/rfc-main/rfcs/rfc9990.xml"
  const d = xmlRead(readFileSyncOrNull(rfcPath) ?? "", rfcPath)
  if (d.isErr()) {
    t.fail("the RFC reads", d.error)
  } else {
    rfcs.docs.set(9990, d.value)
  }
  t.eqStr(
    "the fixture with a vector reads",
    profileIfaceRefusedTestRead(
      t,
      "the base",
      profileIfaceRefusedTestBase(t, base, `${PROFILE_IFACE_REFUSED_TEST_MODULE}\n${PROFILE_IFACE_REFUSED_TEST_FN}`),
      rfcs,
    ).join("; "),
    "",
  )
  profileIfaceRefusedTestForms(t, base, rfcs)
  profileIfaceRefusedTestOrder(t, base, rfcs)
  profileIfaceRefusedTestIndependent(t, base, rfcs)
  profileIfaceRefusedTestUndeclared(t, base, rfcs)
  return t.done()
}
