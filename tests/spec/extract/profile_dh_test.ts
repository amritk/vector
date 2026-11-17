import { Suite } from "nish/testing"
import { replaceAll } from "nish/text"
import { joinPath, makeTempDir, mkdirAll } from "../../../src/core/fs"
import { runProcess } from "../../../src/core/process"
import { vectorRun } from "../../../src/index"
import { Clause, Contract, Literal } from "../../../src/spec/contract/types"
import { ExtractOutcome, extractContract, extractReaders } from "../../../src/spec/extract"
import { ProfileRefusal, ProfileRfcs, profileRead } from "../../../src/spec/profile/profile"
import { rfcParse } from "../../../src/spec/source/rfc"
import { xmlDocParse } from "../../../src/spec/xml/doc"

// RFC 7748 Section 6.1's Diffie-Hellman vector, labelled as the RFC prints it
// (`Alice's private key, a`, `Alice's public key, X25519(a, 9)`), read into
// the contract with each label verbatim; and each near miss still refused by
// fidelity, which checks a label and its value against the section.

const PROFILE_DH_FIXTURE: string = "tests/fixtures/rfc7748-dh/specs/rfc7748-dh.xml"
const PROFILE_DH_RFC: string = "rfcs/rfc7748.txt"
const PROFILE_DH_A: string = "77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a"
const PROFILE_DH_B: string = "5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb"
const PROFILE_DH_ALICE: string =
  "<tt>x25519Base(Alice's private key, a = 77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a)</tt>"
const PROFILE_DH_ALICE_PUB: string = "<tt>Alice's public key, X25519(a, 9) = "
const PROFILE_DH_SOURCE: string =
  '<xref section="6.1" sectionFormat="of" target="RFC7748"/></td>\n            <td align="left">Alice'

/** The full RFC 7748, the one RFC the fixture cites. */
const profileDhTestRfcs = (): ProfileRfcs => {
  const r = new ProfileRfcs()
  r.docs.set(7748, rfcParse(readFileSyncOrNull(PROFILE_DH_RFC) ?? ""))
  return r
}

/** The profile's refusals of `xml`, each `line message`; "ok" when it reads. */
const profileDhTestRead = (xml: string): string => {
  const doc = xmlDocParse(xml)
  if (doc.isErr()) {
    return `xml ${doc.error.line} ${doc.error.message}`
  }
  const r = profileRead(doc.value, "specs/rfc7748-dh.xml", null, profileDhTestRfcs())
  if (r.isErr()) {
    return r.error.map((f: ProfileRefusal): string => `${f.line} ${f.message}`).join("\n")
  }
  return "ok"
}

/**
 * The refusals `vector spec extract` makes of `xml`, written into the tree
 * `d`, one `line: message` a line; "" when it extracts.
 */
const profileDhTestExtract = (d: string, xml: string): string => {
  writeFileSync(joinPath(d, "specs/rfc7748-dh.xml"), xml)
  const o: ExtractOutcome = extractContract(
    joinPath(d, "specs/rfc7748-dh.xml"),
    joinPath(d, "contracts/rfc7748-dh.json"),
    d,
    extractReaders().expect("readers"),
  )
  const out: string[] = []
  for (const e of o.errors) {
    out.push(`error: ${e}`)
  }
  for (const r of o.refusals) {
    out.push(`${r.line}: ${r.message}`)
  }
  return out.join("\n")
}

/** The contract `xml` reads to; null, with a failure, when it is refused. */
const profileDhTestContract = (t: Suite, xml: string): Contract | null => {
  const doc = xmlDocParse(xml)
  if (doc.isErr()) {
    t.fail("the fixture parses", doc.error.message)
    return null
  }
  const r = profileRead(doc.value, "specs/rfc7748-dh.xml", null, profileDhTestRfcs())
  if (r.isErr()) {
    t.fail("the fixture reads", r.error.map((f: ProfileRefusal): string => `${f.line} ${f.message}`).join("; "))
    return null
  }
  return r.value.contract
}

/** A literal's label, `?` when it has none. */
const profileDhTestLabel = (l: Literal | null): string => (l === null ? "?" : l.label ?? "?")

/** A vector's labels as `call(label | label) = label`, or "no such vector". */
const profileDhTestLabels = (c: Contract, id: string): string => {
  for (const k of c.clauses) {
    if (k.id === id) {
      return profileDhTestRow(k)
    }
  }
  return "no such vector"
}

/** One clause's labels as `call(label | label) = label`. */
const profileDhTestRow = (k: Clause): string => {
  const args = k.args.map((a: Literal): string => profileDhTestLabel(a)).join(" | ")
  return `${k.call}(${args}) = ${profileDhTestLabel(k.expect)}`
}

/** The fixture with `from` replaced by `to`, which must occur in it. */
const profileDhTestWith = (t: Suite, xml: string, from: string, to: string): string => {
  t.ok(`the fixture holds ${from}`, xml.indexOf(from) >= 0)
  return replaceAll(xml, from, to)
}

/** Section 6.1's labels, read verbatim; and each near miss, refused by fidelity. */
export const main = (): i32 => {
  const t = new Suite("spec/extract profile dh")
  const xml = readFileSyncOrNull(PROFILE_DH_FIXTURE) ?? ""
  t.eqStr("the fixture reads", profileDhTestRead(xml), "ok")
  const c = profileDhTestContract(t, xml)
  if (c !== null) {
    t.eqStr(
      "Alice's public key",
      profileDhTestLabels(c, "6.1-ALICE"),
      "x25519Base(Alice's private key, a) = Alice's public key, X25519(a, 9)",
    )
    t.eqStr(
      "the shared secret",
      profileDhTestLabels(c, "6.1-K"),
      "x25519(Alice's private key, a | Bob's public key, X25519(b, 9)) = Their shared secret, K",
    )
  }
  let base = "[09"
  for (let i = 0; i < 31; i++) {
    base = `${base} 00`
  }
  const nearMiss: string[][] = [
    [
      "a label the section does not print",
      PROFILE_DH_ALICE,
      `<tt>x25519Base(Alice's private key, b = ${PROFILE_DH_A})</tt>`,
      `the value is printed in RFC §6.1 ("Curve25519") under "Alice's private key, a", not under "Alice's private key, b"`,
    ],
    [
      "a label without its apostrophe",
      PROFILE_DH_ALICE,
      `<tt>x25519Base(Alice private key, a = ${PROFILE_DH_A})</tt>`,
      `the value is printed in RFC §6.1 ("Curve25519") under "Alice's private key, a", not under "Alice private key, a"`,
    ],
    [
      "an alias the section does not print",
      PROFILE_DH_ALICE_PUB,
      "<tt>Alice's public key, X25519(a, 5) = ",
      `the value is printed in RFC §6.1 ("Curve25519") under "Alice's public key, X25519(a, 9)", not under "Alice's public key, X25519(a, 5)"`,
    ],
    [
      "Bob's key under Alice's label",
      PROFILE_DH_ALICE,
      `<tt>x25519Base(Alice's private key, a = ${PROFILE_DH_B})</tt>`,
      `the value is printed in RFC §6.1 ("Curve25519") under "Bob's private key, b", not under "Alice's private key, a"`,
    ],
    [
      "the wrong section",
      PROFILE_DH_SOURCE,
      replaceAll(PROFILE_DH_SOURCE, '"6.1"', '"6.2"'),
      '32-byte value is not printed in RFC §6.2 ("Curve448")',
    ],
    [
      "a base point the section does not print",
      PROFILE_DH_ALICE,
      `<tt>x25519(Alice's private key, a = ${PROFILE_DH_A}, ${base}])</tt>`,
      '32-byte value is not printed in RFC §6.1 ("Curve25519")',
    ],
  ]
  const made = makeTempDir("vector-profile-dh-")
  if (made.isErr()) {
    t.fail("a temp dir", made.error)
    return t.done()
  }
  const d = made.value
  for (const sub of ["specs", "contracts", "rfcs"]) {
    mkdirAll(joinPath(d, sub), 0o755).expect(sub)
  }
  writeFileSync(joinPath(d, PROFILE_DH_RFC), readFileSyncOrNull(PROFILE_DH_RFC) ?? "")
  t.eqStr("the fixture extracts with no refusal", profileDhTestExtract(d, xml), "")
  for (const row of nearMiss) {
    const bad = profileDhTestWith(t, xml, row[1], row[2])
    t.eqStr(row[0], profileDhTestExtract(d, bad), `124: fidelity: ${row[3]}`)
    t.eqI32(
      `${row[0]}: vector spec extract exits 1`,
      vectorRun([
        "spec",
        "extract",
        joinPath(d, "specs/rfc7748-dh.xml"),
        "-o",
        joinPath(d, "contracts/rfc7748-dh.json"),
      ]),
      1,
    )
  }
  t.ok("the temp dir is removed", runProcess(["rm", "-rf", d], "", 10000).isOk())
  return t.done()
}
