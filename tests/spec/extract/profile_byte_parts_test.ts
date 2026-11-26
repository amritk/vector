import { Suite } from "nish/testing"
import { replaceAll, split } from "nish/text"
import { Contract, LitKind } from "../../../src/spec/contract/types"
import { ProfileRefusal, ProfileRfcs, profileRead } from "../../../src/spec/profile/profile"
import { rfcParse } from "../../../src/spec/source/rfc"
import { xmlDocParse } from "../../../src/spec/xml/doc"

// A vector's byte parts in the profile: `Format: V1 expect.concat[0] is 04,
// <reason>` marks a concat part the RFC does not print, and `Tail: V1 expect
// is the last 16 bytes of the value args[0] is printed in, <reason>` joins an
// argument and the expected value into one printed value. Each is read into
// the row's clause, and each malformed form is refused at its line.

const PROFILE_BP_FORMAT_XML: string = "tests/fixtures/byte-parts/byte-parts-format.xml"
const PROFILE_BP_TAIL_XML: string = "tests/fixtures/byte-parts/byte-parts-tail.xml"
const PROFILE_BP_FORMAT_P: string =
  "<t>Format: P256-PUB expect.concat[0] is 04, SEC1 prefixes an uncompressed point with 04</t>"
const PROFILE_BP_TAIL_P: string =
  "<t>Tail: A.4-RETRY expect is the last 16 bytes of the value args[0] is printed in, the Retry Integrity Tag ends the Retry packet</t>"
const PROFILE_BP_FORMAT_FORM: string = "Format: V1 expect.concat[0] is 04, <why the RFC does not print it>"
const PROFILE_BP_TAIL_FORM: string =
  "Tail: V1 expect is the last 16 bytes of the value args[0] is printed in, <why the RFC prints them as one>"
const PROFILE_BP_TAIL_WORDS: string = "expect is the last 16 bytes of the value args[0] is printed in"

/** RFC 6979's and RFC 9001's excerpts, the RFCs the fixtures cite. */
const profileBpTestRfcs = (): ProfileRfcs => {
  const r = new ProfileRfcs()
  r.docs.set(6979, rfcParse(readFileSyncOrNull("tests/fixtures/byte-parts/rfc6979.txt") ?? ""))
  r.docs.set(9001, rfcParse(readFileSyncOrNull("tests/fixtures/byte-parts/rfc9001.txt") ?? ""))
  return r
}

/** The path `xml` is read at, the one its docName names. */
const profileBpTestPath = (xml: string): string =>
  xml.indexOf("draft-byte-parts-tail") >= 0 ? "specs/byte-parts-tail.xml" : "specs/byte-parts-format.xml"

/** The profile's refusals of `xml`, each `line message`; "ok" when it reads. */
const profileBpTestRead = (xml: string): string => {
  const doc = xmlDocParse(xml)
  if (doc.isErr()) {
    return `xml ${doc.error.line} ${doc.error.message}`
  }
  const r = profileRead(doc.value, profileBpTestPath(xml), null, profileBpTestRfcs())
  if (r.isErr()) {
    return r.error.map((f: ProfileRefusal): string => `${f.line} ${f.message}`).join("\n")
  }
  return "ok"
}

/** The contract `xml` reads to; null, with a failure, when it is refused. */
const profileBpTestContract = (t: Suite, name: string, xml: string): Contract | null => {
  const doc = xmlDocParse(xml)
  if (doc.isErr()) {
    t.fail(name, doc.error.message)
    return null
  }
  const r = profileRead(doc.value, profileBpTestPath(xml), null, profileBpTestRfcs())
  if (r.isErr()) {
    t.fail(name, r.error.map((f: ProfileRefusal): string => `${f.line} ${f.message}`).join("; "))
    return null
  }
  return r.value.contract
}

/** The 1-based line of `xml` that holds `marker`, or 0 when none does. */
const profileBpTestLine = (xml: string, marker: string): i32 => {
  const at = xml.indexOf(marker)
  return at < 0 ? 0 : split(xml.substring(0, at), "\n").length
}

/** The refusals of the format fixture with its paragraph's body `body`. */
const profileBpTestFormatP = (xml: string, body: string): string =>
  profileBpTestRead(replaceAll(xml, PROFILE_BP_FORMAT_P, `<t>Format: ${body}</t>`))

/** The refusals of the tail fixture with its paragraph's body `body`. */
const profileBpTestTailP = (xml: string, body: string): string =>
  profileBpTestRead(replaceAll(xml, PROFILE_BP_TAIL_P, `<t>Tail: ${body}</t>`))

/** `words` joined, with an `x` after the one at `at`. */
const profileBpTestChanged = (words: string[], at: i32): string => {
  const out: string[] = []
  for (let j = 0; j < words.length; j++) {
    out.push(j === at ? `${words[j]}x` : words[j])
  }
  return out.join(" ")
}

/** The format reasons of the first clause's expect parts, `-` for a part without one. */
const profileBpTestFormats = (c: Contract): string => {
  const out: string[] = []
  for (const k of c.clauses) {
    const e = k.expect
    if (e !== null && e.kind === LitKind.Concat) {
      for (const q of e.parts) {
        out.push(q.format ?? "-")
      }
    }
  }
  return out.join(" | ")
}

/** The first clause's tail as `<arg> <bytes> <reason>`, or "none". */
const profileBpTestTail = (c: Contract): string => {
  for (const k of c.clauses) {
    const tl = k.tail
    if (tl !== null) {
      return `${tl.arg} ${tl.bytes} ${tl.reason}`
    }
  }
  return "none"
}

/** The Format: paragraph, read and refused. */
const profileBpTestFormat = (t: Suite, xml: string): void => {
  const line = profileBpTestLine(xml, PROFILE_BP_FORMAT_P)
  const c = profileBpTestContract(t, "the format fixture", xml)
  if (c !== null) {
    t.eqStr("the format part", profileBpTestFormats(c), "SEC1 prefixes an uncompressed point with 04 | - | -")
  }
  const commas = profileBpTestContract(
    t,
    "a reason with a comma",
    replaceAll(xml, PROFILE_BP_FORMAT_P, "<t>Format: P256-PUB expect.concat[0] is 04, SEC1, section 2.3.3</t>"),
  )
  if (commas !== null) {
    t.eqStr("the reason after the first comma", profileBpTestFormats(commas), "SEC1, section 2.3.3 | - | -")
  }
  const form = `${line} a Format: paragraph reads "<id> <path> is <hex>, <reason>": ${PROFILE_BP_FORMAT_FORM}`
  const forms: string[] = [
    "P256-PUB expect.concat[0] is 04",
    "P256-PUB expect.concat[0] is 04,",
    "P256-PUB expect.concat[0] is 04,  ",
    "P256-PUB expect.concat[0] = 04, why",
    "P256-PUB expect.concat[0] is 04 05, why",
    "P256-PUB expect.concat[0] 04, why",
    "P256-PUB is 04, why",
  ]
  for (const f of forms) {
    t.eqStr(`the form "${f}"`, profileBpTestFormatP(xml, f), form)
  }
  const paths: string[] = [
    "expect",
    "expect.concat",
    "expect.concat[]",
    "expect.concat[01]",
    "expect.concat[1000]",
    "expect.concat[x]",
    "expect.parts[0]",
    "expect[0].concat[0]",
    "args.concat[0]",
    "args[].concat[0]",
    "args[00].concat[0]",
    "expect.concat[0].x",
  ]
  for (const q of paths) {
    t.eqStr(
      `the path "${q}"`,
      profileBpTestFormatP(xml, `P256-PUB ${q} is 04, why`),
      `${line} "${q}" is no path to a concat's part; it reads expect.concat[<j>] or args[<i>].concat[<j>]`,
    )
  }
  const refusals: string[][] = [
    ["P256-PUB args[1].concat[0] is 04, why", "P256-PUB has no args[1]: it has 1 arguments"],
    ["P256-PUB args[0].concat[0] is 04, why", "P256-PUB's args[0] is no concat; a format constant is a part of one"],
    ["P256-PUB expect.concat[3] is 04, why", "P256-PUB's expect has no part 3: it has 3"],
    [
      "P256-PUB expect.concat[1] is 04, why",
      "P256-PUB's expect.concat[1] is not a bare hex value like [04]; a format constant is one",
    ],
    ["P256-PUB expect.concat[0] is 05, why", "P256-PUB's expect.concat[0] is 04, not 05"],
    ["P256-PUB expect.concat[0] is 4, why", "P256-PUB's expect.concat[0] is 04, not 4"],
    [
      "V9 expect.concat[0] is 04, why",
      `Format: names "V9", which is no vector of the table: ${PROFILE_BP_FORMAT_FORM}`,
    ],
  ]
  for (const r of refusals) {
    t.eqStr(`"${r[0]}"`, profileBpTestFormatP(xml, r[0]), `${line} ${r[1]}`)
  }
  // The neighbours of a refused part: the expect's last part is no part 3.
  t.eqStr(
    "the last part named, a labelled value",
    profileBpTestFormatP(xml, "P256-PUB expect.concat[2] is 04, why"),
    `${line} P256-PUB's expect.concat[2] is not a bare hex value like [04]; a format constant is one`,
  )
  t.eqStr(
    "a second Format: on the same concat",
    profileBpTestRead(replaceAll(xml, PROFILE_BP_FORMAT_P, `${PROFILE_BP_FORMAT_P}\n${PROFILE_BP_FORMAT_P}`)),
    `${line + 1} P256-PUB's expect has a format part already; a concat has at most one`,
  )
  // A repeated hex is not bare.
  t.eqStr(
    "a repeated hex part",
    profileBpTestRead(replaceAll(xml, "concat([04], Ux", "concat(1 × 04, Ux")),
    `${line} P256-PUB's expect.concat[0] is not a bare hex value like [04]; a format constant is one`,
  )
  t.eqStr("a bare Format:", profileBpTestFormatP(xml, ""), "ok")
  t.eqStr(
    "one after a paragraph after the table",
    profileBpTestRead(replaceAll(xml, PROFILE_BP_FORMAT_P, `<t>A paragraph.</t>${PROFILE_BP_FORMAT_P}`)),
    `${line} this Format: paragraph follows no vector table; it must directly follow the vector table or a Tolerance:, Iterate:, Truncate:, Format: or Tail: paragraph, like ${PROFILE_BP_FORMAT_FORM}`,
  )
  // Without the paragraph, the 04 is a part the RFC does not print: no format.
  const none = profileBpTestContract(t, "no Format:", replaceAll(xml, PROFILE_BP_FORMAT_P, ""))
  if (none !== null) {
    t.eqStr("no format part", profileBpTestFormats(none), "- | - | -")
  }
}

/** The Tail: paragraph, read and refused. */
const profileBpTestTails = (t: Suite, xml: string): void => {
  const line = profileBpTestLine(xml, PROFILE_BP_TAIL_P)
  const c = profileBpTestContract(t, "the tail fixture", xml)
  if (c !== null) {
    t.eqStr("the tail", profileBpTestTail(c), "0 16 the Retry Integrity Tag ends the Retry packet")
  }
  const form = `${line} a Tail: paragraph reads "<id> expect is the last <N> bytes of the value args[<i>] is printed in, <reason>": ${PROFILE_BP_TAIL_FORM}`
  // Each word of the form, changed in turn, is refused.
  const words = split(PROFILE_BP_TAIL_WORDS, " ")
  for (let i = 0; i < words.length; i++) {
    if (words[i] !== "16" && words[i] !== "args[0]") {
      const changed = profileBpTestChanged(words, i)
      t.eqStr(`the word "${words[i]}" changed`, profileBpTestTailP(xml, `A.4-RETRY ${changed}, why`), form)
    }
  }
  const forms: string[] = [
    `A.4-RETRY ${PROFILE_BP_TAIL_WORDS}`,
    `A.4-RETRY ${PROFILE_BP_TAIL_WORDS},`,
    `A.4-RETRY ${PROFILE_BP_TAIL_WORDS} too, why`,
    "A.4-RETRY expect is the last 16 bytes of the value args[0], why",
    `${PROFILE_BP_TAIL_WORDS}, why`,
  ]
  for (const f of forms) {
    t.eqStr(`the form "${f}"`, profileBpTestTailP(xml, f), form)
  }
  const lengths: string[] = ["0", "016", "x", "1.5", "-1", "12345678"]
  for (const n of lengths) {
    t.eqStr(
      `the length "${n}"`,
      profileBpTestTailP(xml, `A.4-RETRY expect is the last ${n} bytes of the value args[0] is printed in, why`),
      `${line} A.4-RETRY's tail is a whole number of at least 1 bytes in digits, with no leading zero, not "${n}": ${PROFILE_BP_TAIL_FORM}`,
    )
  }
  t.eqStr(
    "65537 bytes",
    profileBpTestTailP(xml, "A.4-RETRY expect is the last 65537 bytes of the value args[0] is printed in, why"),
    `${line} A.4-RETRY's tail is 65537 bytes, more than 65536`,
  )
  for (const a of ["args", "args[]", "args[01]", "arg[0]", "expect"]) {
    t.eqStr(
      `the argument "${a}"`,
      profileBpTestTailP(xml, `A.4-RETRY expect is the last 16 bytes of the value ${a} is printed in, why`),
      `${line} "${a}" is no argument; it reads args[<i>]: ${PROFILE_BP_TAIL_FORM}`,
    )
  }
  t.eqStr(
    "no such vector",
    profileBpTestTailP(xml, `V9 ${PROFILE_BP_TAIL_WORDS}, why`),
    `${line} Tail: names "V9", which is no vector of the table: ${PROFILE_BP_TAIL_FORM}`,
  )
  t.eqStr(
    "a second Tail: on the vector",
    profileBpTestRead(replaceAll(xml, PROFILE_BP_TAIL_P, `${PROFILE_BP_TAIL_P}\n${PROFILE_BP_TAIL_P}`)),
    `${line + 1} A.4-RETRY has a tail already; a vector has at most one Tail: paragraph`,
  )
  // What only the shape gate refuses lands on the Tail: line.
  t.eqStr(
    "an argument the vector does not have",
    profileBpTestTailP(xml, "A.4-RETRY expect is the last 16 bytes of the value args[1] is printed in, why"),
    `${line} the contract read here is not valid: clauses[0].tail.arg: args[1] is no argument: the vector has 1`,
  )
  // 65536 and 1 are read; whether they are the RFC's bytes is the fidelity gate's.
  for (const n of ["1", "65536"]) {
    const w = profileBpTestContract(
      t,
      `${n} bytes`,
      replaceAll(
        xml,
        PROFILE_BP_TAIL_P,
        `<t>Tail: A.4-RETRY expect is the last ${n} bytes of the value args[0] is printed in, why</t>`,
      ),
    )
    if (w !== null) {
      t.eqStr(`${n} bytes read`, profileBpTestTail(w), `0 ${n} why`)
    }
  }
  t.eqStr("a bare Tail:", profileBpTestTailP(xml, ""), "ok")
  t.eqStr(
    "one after a paragraph after the table",
    profileBpTestRead(replaceAll(xml, PROFILE_BP_TAIL_P, `<t>A paragraph.</t>${PROFILE_BP_TAIL_P}`)),
    `${line} this Tail: paragraph follows no vector table; it must directly follow the vector table or a Tolerance:, Iterate:, Truncate:, Format: or Tail: paragraph, like ${PROFILE_BP_TAIL_FORM}`,
  )
  const none = profileBpTestContract(t, "no Tail:", replaceAll(xml, PROFILE_BP_TAIL_P, ""))
  if (none !== null) {
    t.eqStr("no tail", profileBpTestTail(none), "none")
  }
}

/** The profile's Format: and Tail: spellings, read and refused. */
export const main = (): i32 => {
  const t = new Suite("spec/extract profile byte parts")
  const fxml = readFileSyncOrNull(PROFILE_BP_FORMAT_XML) ?? ""
  const txml = readFileSyncOrNull(PROFILE_BP_TAIL_XML) ?? ""
  t.ok("the format fixture holds the paragraph", fxml.indexOf(PROFILE_BP_FORMAT_P) > 0)
  t.ok("the tail fixture holds the paragraph", txml.indexOf(PROFILE_BP_TAIL_P) > 0)
  t.eqStr("the format fixture reads", profileBpTestRead(fxml), "ok")
  t.eqStr("the tail fixture reads", profileBpTestRead(txml), "ok")
  profileBpTestFormat(t, fxml)
  profileBpTestTails(t, txml)
  return t.done()
}
