import { Suite } from "nish/testing"
import { replaceAll, split } from "nish/text"
import { Contract } from "../../../src/spec/contract/types"
import { ProfileRefusal, ProfileRfcs, profileRead } from "../../../src/spec/profile/profile"
import { rfcParse } from "../../../src/spec/source/rfc"
import { xmlDocParse } from "../../../src/spec/xml/doc"

// A truncated vector in the profile: `Truncate: V1 to 128 bits` after the
// vector table, read into the row's clause, and each malformed form refused at
// the paragraph's line with its own message.

const PROFILE_TRUNC_FIXTURE: string = "tests/fixtures/profile/profile-truncate.xml"
const PROFILE_TRUNC_RFC: string = "tests/fixtures/profile/rfc4231.txt"
const PROFILE_TRUNC_P: string = "<t>Truncate: 4.6-256 to 128 bits</t>"
const PROFILE_TRUNC_FORM: string = "Truncate: V1 to 128 bits (or to 16 bytes)"
const PROFILE_TRUNC_STRAY: string =
  "this Truncate: paragraph follows no vector table; it must directly follow the vector table or a Tolerance:, Iterate: or Truncate: paragraph, like Truncate: V1 to 128 bits (or to 16 bytes)"
const PROFILE_TRUNC_EXPECT: string = "a3b6167473100ee06e0c796c2955552b"

/** RFC 4231's excerpt, the one RFC the fixture cites. */
const profileTruncTestRfcs = (): ProfileRfcs => {
  const r = new ProfileRfcs()
  r.docs.set(4231, rfcParse(readFileSyncOrNull(PROFILE_TRUNC_RFC) ?? ""))
  return r
}

/** The profile's refusals of `xml`, each `line message`; "ok" when it reads. */
const profileTruncTestRead = (xml: string): string => {
  const doc = xmlDocParse(xml)
  if (doc.isErr()) {
    return `xml ${doc.error.line} ${doc.error.message}`
  }
  const r = profileRead(doc.value, "specs/profile-truncate.xml", null, profileTruncTestRfcs())
  if (r.isErr()) {
    return r.error.map((f: ProfileRefusal): string => `${f.line} ${f.message}`).join("\n")
  }
  return "ok"
}

/** The refusals of the fixture with the paragraph's body `body`. */
const profileTruncTestP = (xml: string, body: string): string =>
  profileTruncTestRead(replaceAll(xml, PROFILE_TRUNC_P, `<t>Truncate: ${body}</t>`))

/** The contract `xml` reads to; null, with a failure, when it is refused. */
const profileTruncTestContract = (t: Suite, name: string, xml: string): Contract | null => {
  const doc = xmlDocParse(xml)
  if (doc.isErr()) {
    t.fail(name, doc.error.message)
    return null
  }
  const r = profileRead(doc.value, "specs/profile-truncate.xml", null, profileTruncTestRfcs())
  if (r.isErr()) {
    t.fail(name, r.error.map((f: ProfileRefusal): string => `${f.line} ${f.message}`).join("; "))
    return null
  }
  return r.value.contract
}

/** A vector's truncation as `<bytes> bytes, written in <unit>`, or "none". */
const profileTruncTestOf = (c: Contract, id: string): string => {
  for (const k of c.clauses) {
    if (k.id === id) {
      const tr = k.truncate
      return tr === null ? "none" : `${tr.bytes} bytes, written in ${tr.unit}`
    }
  }
  return "no such vector"
}

/** The 1-based line of `xml` that holds `marker`, or 0 when none does. */
const profileTruncTestLine = (xml: string, marker: string): i32 => {
  const at = xml.indexOf(marker)
  return at < 0 ? 0 : split(xml.substring(0, at), "\n").length
}

/** The refusal at `line` of 4.6-256's 16-byte Expected truncated to `b` bytes (`bits` bits). */
const profileTruncTestMismatch = (line: i32, b: string, bits: string): string =>
  `${line} 4.6-256's Expected is 16 bytes (128 bits), but Truncate: keeps ${b} bytes (${bits} bits); the Expected is the whole truncated result`

/** The fixture's paragraph, and the forms that read the same. */
const profileTruncTestReads = (t: Suite, xml: string): void => {
  const c = profileTruncTestContract(t, "the fixture", xml)
  if (c !== null) {
    t.eqStr("128 bits", profileTruncTestOf(c, "4.6-256"), "16 bytes, written in bits")
    t.eqStr("the untruncated row", profileTruncTestOf(c, "4.2-256"), "none")
  }
  const bodies: string[] = ["4.6-256 to 16 bytes", "4.6-256\tto  128 bits", "4.6-256 to\n      128 bits"]
  const wants: string[] = ["16 bytes, written in bytes", "16 bytes, written in bits", "16 bytes, written in bits"]
  for (let i = 0; i < bodies.length; i++) {
    const w = profileTruncTestContract(
      t,
      `"${bodies[i]}"`,
      replaceAll(xml, PROFILE_TRUNC_P, `<t>Truncate: ${bodies[i]}</t>`),
    )
    if (w !== null) {
      t.eqStr(`"${bodies[i]}"`, profileTruncTestOf(w, "4.6-256"), wants[i])
    }
  }
  const none = profileTruncTestContract(t, "no paragraph", replaceAll(xml, PROFILE_TRUNC_P, ""))
  if (none !== null) {
    t.eqStr("a vector without one", profileTruncTestOf(none, "4.6-256"), "none")
  }
}

/** Each malformed Truncate: paragraph, refused at its line with its own message. */
const profileTruncTestRefusals = (t: Suite, xml: string): void => {
  const line = profileTruncTestLine(xml, PROFILE_TRUNC_P)
  const form = `${line} a Truncate: paragraph reads "<id> to <N> bits" or "<id> to <N> bytes": ${PROFILE_TRUNC_FORM}`
  const forms: string[] = [
    "4.6-256",
    "4.6-256 128 bits",
    "4.6-256 at 128 bits",
    "4.6-256 to 128",
    "4.6-256 to 128 bits.",
    "4.6-256 to 128 bits, please",
  ]
  for (const f of forms) {
    t.eqStr(
      `the form "${f}"`,
      profileTruncTestP(xml, f),
      f === "4.6-256 to 128 bits."
        ? `${line} 4.6-256's length is in "bits" or "bytes", not "bits.": ${PROFILE_TRUNC_FORM}`
        : form,
    )
  }
  const lens: string[] = ["0", "0128", "-128", "1e3", "12.8", "1,024", "12345678", "x"]
  for (const n of lens) {
    t.eqStr(
      `the length ${n}`,
      profileTruncTestP(xml, `4.6-256 to ${n} bits`),
      `${line} 4.6-256's length is a whole number of at least 1 in digits, with no leading zero, not "${n}": ${PROFILE_TRUNC_FORM}`,
    )
  }
  const units: string[] = ["bit", "byte", "Bits", "octets", "words"]
  for (const u of units) {
    t.eqStr(
      `the unit ${u}`,
      profileTruncTestP(xml, `4.6-256 to 16 ${u}`),
      `${line} 4.6-256's length is in "bits" or "bytes", not "${u}": ${PROFILE_TRUNC_FORM}`,
    )
  }
  const odd: string[] = ["1", "7", "127", "129"]
  for (const n of odd) {
    t.eqStr(
      `${n} bits`,
      profileTruncTestP(xml, `4.6-256 to ${n} bits`),
      `${line} 4.6-256 is truncated to ${n} bits, which is no whole number of bytes; a length in bits is a multiple of 8`,
    )
  }
  t.eqStr(
    "more than 65536 bytes",
    profileTruncTestP(xml, "4.6-256 to 65537 bytes"),
    `${line} 4.6-256 is truncated to 65537 bytes, more than 65536 bytes`,
  )
  t.eqStr(
    "more than 65536 bytes, in bits",
    profileTruncTestP(xml, "4.6-256 to 524296 bits"),
    `${line} 4.6-256 is truncated to 524296 bits, more than 65536 bytes`,
  )
  // The largest lengths pass the length rules and reach the Expected's.
  t.eqStr(
    "65536 bytes",
    profileTruncTestP(xml, "4.6-256 to 65536 bytes"),
    profileTruncTestMismatch(line, "65536", "524288"),
  )
  t.eqStr(
    "524288 bits",
    profileTruncTestP(xml, "4.6-256 to 524288 bits"),
    profileTruncTestMismatch(line, "65536", "524288"),
  )
  // The printed Expected is longer, or shorter, than the truncation.
  t.eqStr(
    "an Expected longer than 96 bits",
    profileTruncTestP(xml, "4.6-256 to 96 bits"),
    profileTruncTestMismatch(line, "12", "96"),
  )
  t.eqStr(
    "an Expected longer than 15 bytes",
    profileTruncTestP(xml, "4.6-256 to 15 bytes"),
    profileTruncTestMismatch(line, "15", "120"),
  )
  t.eqStr(
    "an Expected shorter than 136 bits",
    profileTruncTestP(xml, "4.6-256 to 136 bits"),
    profileTruncTestMismatch(line, "17", "136"),
  )
  t.eqStr(
    "the whole result's row truncated to 128 bits",
    profileTruncTestP(xml, "4.2-256 to 128 bits"),
    `${line} 4.2-256's Expected is 32 bytes (256 bits), but Truncate: keeps 16 bytes (128 bits); the Expected is the whole truncated result`,
  )
  t.eqStr(
    "an unknown vector",
    profileTruncTestP(xml, "V9 to 128 bits"),
    `${line} Truncate: names "V9", which is no vector of the table: ${PROFILE_TRUNC_FORM}`,
  )
  t.eqStr(
    "two on one vector",
    profileTruncTestRead(replaceAll(xml, PROFILE_TRUNC_P, `${PROFILE_TRUNC_P}\n<t>Truncate: 4.6-256 to 16 bytes</t>`)),
    `${line + 1} 4.6-256 is truncated already; a vector has at most one Truncate: paragraph`,
  )
  // A return that is no bytes: hmacSha256 declared to return an i64.
  const int = replaceAll(
    replaceAll(xml, "data: u8[]): u8[]", "data: u8[]): i64"),
    `HMAC-SHA-256 = ${PROFILE_TRUNC_EXPECT}`,
    "HMAC-SHA-256 = 42",
  )
  t.eqStr(
    "an i64 result",
    profileTruncTestRead(
      replaceAll(
        int,
        "HMAC-SHA-256 = b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
        "HMAC-SHA-256 = 7",
      ),
    ),
    `${line} 4.6-256's hmacSha256 returns i64, and only a bytes result is truncated`,
  )
  // A bare "Truncate:" is no Truncate: paragraph but prose, and is not refused.
  t.eqStr("a bare Truncate:", profileTruncTestP(xml, ""), "ok")
  t.eqStr(
    "a stray one in another section",
    profileTruncTestRead(
      replaceAll(xml, '<blockquote anchor="R-TRUNC"', `${PROFILE_TRUNC_P}<blockquote anchor="R-TRUNC"`),
    ),
    `${profileTruncTestLine(xml, '<blockquote anchor="R-TRUNC"')} ${PROFILE_TRUNC_STRAY}`,
  )
  t.eqStr(
    "one after a paragraph after the table",
    profileTruncTestRead(replaceAll(xml, PROFILE_TRUNC_P, `<t>A paragraph.</t>${PROFILE_TRUNC_P}`)),
    `${line} ${PROFILE_TRUNC_STRAY}`,
  )
  // A Truncate: on a row the table refused adds no refusal of its own.
  const refused = profileTruncTestRead(replaceAll(xml, `= ${PROFILE_TRUNC_EXPECT}`, `= ${PROFILE_TRUNC_EXPECT}zz`))
  t.ok("a refused row's truncate: the row refused", refused !== "ok")
  t.ok("a refused row's truncate: not refused itself", refused.indexOf("Truncate") < 0)
  // What only the shape gate refuses lands on the Truncate: line.
  t.eqStr(
    "beside an Iterate: on the same vector",
    profileTruncTestRead(
      replaceAll(
        xml,
        PROFILE_TRUNC_P,
        `<t>Iterate: 4.6-256 2 times, (k, d) &lt;- (hmacSha256(k, d), d)</t>\n${PROFILE_TRUNC_P}`,
      ),
    ),
    `${line + 1} the contract read here is not valid: clauses[1].truncate: a vector is truncated or iterated, not both`,
  )
}

/** The profile's Truncate: spelling, read and refused. */
export const main = (): i32 => {
  const t = new Suite("spec/extract profile truncate")
  const xml = readFileSyncOrNull(PROFILE_TRUNC_FIXTURE) ?? ""
  t.ok("the fixture holds the paragraph", xml.indexOf(PROFILE_TRUNC_P) > 0)
  t.eqStr("the paragraph's line", `${profileTruncTestLine(xml, PROFILE_TRUNC_P)}`, "95")
  t.eqStr("the fixture reads", profileTruncTestRead(xml), "ok")
  profileTruncTestReads(t, xml)
  profileTruncTestRefusals(t, xml)
  return t.done()
}
