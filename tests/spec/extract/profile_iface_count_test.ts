import { Suite } from "nish/testing"
import { split } from "nish/text"
import { ProfileRefusal, ProfileRfcs, profileRead } from "../../../src/spec/profile/profile"
import { xmlDocParse, xmlRead } from "../../../src/spec/xml/doc"

// A spec with no ts-interface block, or more than one: the count refusal is
// printed first, ahead of the first block's own refusals, and a call refused
// only because of the missing or duplicated block is not refused, while every
// independent refusal still is. Read through profileRead from variants of the
// rfc-main mini-frame fixture.

const PROFILE_IFACE_COUNT_TEST_FILE: string = "specs/mini-frame.xml"
const PROFILE_IFACE_COUNT_TEST_BLOCK: string = `<sourcecode type="ts-interface"><![CDATA[
// module: nish/mini/frame
export function frame(data: u8[]): u8[] | null
]]></sourcecode>`
const PROFILE_IFACE_COUNT_TEST_END: string = "    </section>\n  </middle>"
const PROFILE_IFACE_COUNT_TEST_XREF: string = `<xref section="2" sectionFormat="of" target="RFC9990"/>`
const PROFILE_IFACE_COUNT_TEST_COUNT: string = "a spec has exactly one ts-interface block; this one has"

/** A ts-interface block of `module` declaring `fn(data: u8[]): u8[] | null`. */
const profileIfaceCountTestBlock = (module: string, fn: string): string =>
  `<sourcecode type="ts-interface"><![CDATA[\n// module: ${module}\nexport function ${fn}(data: u8[]): u8[] | null\n]]></sourcecode>`

/** A vector table of one row, calling `call` and expecting `expected`. */
const profileIfaceCountTestTable = (call: string, expected: string): string =>
  `<table><thead><tr><th>Id</th><th>Call</th><th>Expected</th><th>Covers</th><th>Source</th><th>Title</th></tr></thead><tbody><tr><td>V1</td><td><tt>${call}</tt></td><td><tt>${expected}</tt></td><td>R-PREFIX</td><td>${PROFILE_IFACE_COUNT_TEST_XREF}</td><td>one octet</td></tr></tbody></table>`

/** `xml` with every `from` replaced by `to`; fails the suite when `from` is absent. */
const profileIfaceCountTestSub = (t: Suite, xml: string, from: string, to: string): string => {
  if (xml.indexOf(from) < 0) {
    t.fail("the variant's text is in the fixture", from)
    return xml
  }
  return split(xml, from).join(to)
}

/** The 1-based line of `xml` that first holds `needle`, or 0. */
const profileIfaceCountTestLine = (xml: string, needle: string): i32 => {
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
const profileIfaceCountTestRead = (t: Suite, name: string, xml: string, rfcs: ProfileRfcs): string[] => {
  const doc = xmlDocParse(xml)
  if (doc.isErr()) {
    t.fail(name, `xml ${doc.error.message}`)
    return []
  }
  const r = profileRead(doc.value, PROFILE_IFACE_COUNT_TEST_FILE, null, rfcs)
  if (r.isOk()) {
    return []
  }
  return r.error.map((f: ProfileRefusal): string => `${f.line} ${f.message}`)
}

/**
 * The fixture with a vector calling `vectorCall`, its properties calling
 * `propertyCall` in place of frame, `extra` (more blocks) at the end of its
 * last section, and its interface block as `iface`.
 */
const profileIfaceCountTestSpec = (
  t: Suite,
  base: string,
  iface: string,
  vectorCall: string,
  propertyCall: string,
  extra: string,
): string => {
  const table = vectorCall.length > 0 ? profileIfaceCountTestTable(`${vectorCall}(data = 00)`, "result = 0100") : ""
  const read = profileIfaceCountTestSub(t, base, PROFILE_IFACE_COUNT_TEST_BLOCK, iface)
  const props = profileIfaceCountTestSub(t, read, "frame(data)", `${propertyCall}(data)`)
  return profileIfaceCountTestSub(
    t,
    props,
    PROFILE_IFACE_COUNT_TEST_END,
    `${table}${extra}\n${PROFILE_IFACE_COUNT_TEST_END}`,
  )
}

/** The count refusal for `n` blocks. */
const profileIfaceCountTestCount = (n: i32): string => `${PROFILE_IFACE_COUNT_TEST_COUNT} ${n}`

/**
 * Asserts `xml`'s refusals are `want`, in order: each `[needle, start]` is a
 * refusal at the needle's line whose message starts with `start`.
 */
const profileIfaceCountTestRow = (t: Suite, name: string, xml: string, rfcs: ProfileRfcs, want: string[][]): void => {
  const got = profileIfaceCountTestRead(t, name, xml, rfcs)
  const wanted: string[] = []
  const seen: string[] = []
  for (let i = 0; i < want.length; i++) {
    const w = want[i]
    const line = profileIfaceCountTestLine(xml, w[0])
    t.ok(`${name}: refusal ${i + 1}'s needle is in the variant`, line > 0)
    const head = `${line} ${w[1]}`
    wanted.push(head)
    seen.push(i < got.length ? got[i].substring(0, head.length) : "")
  }
  for (let i = want.length; i < got.length; i++) {
    seen.push(got[i])
  }
  t.eqStr(name, seen.join("\n"), wanted.join("\n"))
}

/** The table: each count of blocks, with calls declared, declared only later, and declared nowhere. */
const profileIfaceCountTestRows = (t: Suite, base: string, rfcs: ProfileRfcs): void => {
  const block = PROFILE_IFACE_COUNT_TEST_BLOCK
  const blockG = profileIfaceCountTestBlock("nish/mini/other", "g")
  const refusedG = profileIfaceCountTestBlock("Std/len", "g")
  const root = `<rfc version="3"`
  const second = `<sourcecode type="ts-interface"><![CDATA[\n// module: nish/mini/other`

  // One block: nothing about the count, and an undeclared call still refused.
  profileIfaceCountTestRow(
    t,
    "one block, calls it declares",
    profileIfaceCountTestSpec(t, base, block, "frame", "frame", ""),
    rfcs,
    [],
  )
  profileIfaceCountTestRow(
    t,
    "one block, calls it does not declare",
    profileIfaceCountTestSpec(t, base, block, "h", "h", ""),
    rfcs,
    [
      ["unwrap(h(data))", "unknown function `h`"],
      ["h(data) === null", "unknown function `h`"],
      ["<tt>h(data = 00)", `"h" is not a function of the ts-interface block`],
    ],
  )

  // No block: every call to an undeclared function is the cascade.
  profileIfaceCountTestRow(
    t,
    "no block, a vector calling frame",
    profileIfaceCountTestSpec(t, base, "", "frame", "frame", ""),
    rfcs,
    [[root, profileIfaceCountTestCount(0)]],
  )
  profileIfaceCountTestRow(
    t,
    "no block, properties calling frame",
    profileIfaceCountTestSpec(t, base, "", "", "frame", ""),
    rfcs,
    [[root, profileIfaceCountTestCount(0)]],
  )
  profileIfaceCountTestRow(t, "no block, calls to h", profileIfaceCountTestSpec(t, base, "", "h", "h", ""), rfcs, [
    [root, profileIfaceCountTestCount(0)],
  ])
  const independent = profileIfaceCountTestSub(
    t,
    profileIfaceCountTestSub(
      t,
      profileIfaceCountTestSpec(t, base, "", "frame", "frame", ""),
      "/* 256..300 */",
      "/* 300..256 */",
    ),
    "<tt>result = 0100</tt>",
    "<tt>result = 01zz</tt>",
  )
  profileIfaceCountTestRow(t, "no block, beside independent refusals", independent, rfcs, [
    [root, profileIfaceCountTestCount(0)],
    ["/* 300..256 */", "the length bounds of `data` (u8[]) must satisfy 0 <= lo <= hi <= 4096"],
    [
      "01zz",
      "Expected: a labelled value is `Label = hex` (lowercase hex pairs with no spaces), `Label = 42` or `Label = 22 × 0b`",
    ],
  ])

  // Two blocks: the first is read; a call only a later block declares is the
  // cascade, and a call no block declares is not.
  profileIfaceCountTestRow(
    t,
    "two blocks, calls the first declares",
    profileIfaceCountTestSpec(t, base, block, "frame", "frame", blockG),
    rfcs,
    [[second, profileIfaceCountTestCount(2)]],
  )
  profileIfaceCountTestRow(
    t,
    "two blocks, calls only the second declares",
    profileIfaceCountTestSpec(t, base, block, "g", "g", blockG),
    rfcs,
    [[second, profileIfaceCountTestCount(2)]],
  )
  profileIfaceCountTestRow(
    t,
    "two blocks, calls no block declares",
    profileIfaceCountTestSpec(t, base, block, "h", "h", blockG),
    rfcs,
    [
      [second, profileIfaceCountTestCount(2)],
      ["unwrap(h(data))", "unknown function `h`"],
      ["h(data) === null", "unknown function `h`"],
      ["<tt>h(data = 00)", `"h" is not a function of the ts-interface block`],
    ],
  )
  profileIfaceCountTestRow(
    t,
    "two blocks, the second refused, calls it would declare",
    profileIfaceCountTestSpec(t, base, block, "g", "frame", refusedG),
    rfcs,
    [
      ["<![CDATA[\n// module: Std/len", profileIfaceCountTestCount(2)],
      ["<tt>g(data = 00)", `"g" is not a function of the ts-interface block`],
    ],
  )
  profileIfaceCountTestRow(
    t,
    "two blocks, the first refused, calls no block declares",
    profileIfaceCountTestSpec(t, base, refusedG, "h", "h", block),
    rfcs,
    [
      [PROFILE_IFACE_COUNT_TEST_BLOCK, profileIfaceCountTestCount(2)],
      ["// module: Std/len", "`Std/len` is not a module path"],
    ],
  )

  // Three blocks: the count says so, and is still first.
  const blockT = profileIfaceCountTestBlock("nish/mini/third", "k")
  profileIfaceCountTestRow(
    t,
    "three blocks, calls the second and third declare",
    profileIfaceCountTestSpec(t, base, block, "k", "g", `${blockG}\n${blockT}`),
    rfcs,
    [[second, profileIfaceCountTestCount(3)]],
  )
}

export const main = (): i32 => {
  const t = new Suite("profile: a missing or duplicated ts-interface block")
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
  profileIfaceCountTestRows(t, base, rfcs)
  return t.done()
}
