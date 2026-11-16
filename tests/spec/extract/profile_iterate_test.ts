import { Suite } from "nish/testing"
import { replaceAll, split } from "nish/text"
import { Contract, Expr, ExprKind } from "../../../src/spec/contract/types"
import { ProfileRefusal, ProfileRfcs, profileRead } from "../../../src/spec/profile/profile"
import { rfcParse } from "../../../src/spec/source/rfc"
import { xmlDocParse } from "../../../src/spec/xml/doc"

// An iterated vector in the profile: `Iterate: V1 1,000 times, (k, u) <- (f(k, u), k)`
// after the vector table, read into the row's clause, and each malformed form
// refused at the paragraph's line with its own message.

const PROFILE_ITER_FIXTURE: string = "tests/fixtures/profile/profile-iterate.xml"
const PROFILE_ITER_RFC: string = "tests/fixtures/profile/rfc7748.txt"
const PROFILE_ITER_P1: string = "<t>Iterate: 5.2-ITER-1000 1,000 times, (k, u) &lt;- (x25519(k, u), k)</t>"
const PROFILE_ITER_P2: string = "<t>Iterate: 5.2-ITER-1M 1000000 times, slow, (k, u) ← (x25519(k, u), k)</t>"
const PROFILE_ITER_FORM: string = "Iterate: V1 1,000 times, (k, u) <- (f(k, u), k)"
const PROFILE_ITER_STRAY: string =
  "this Iterate: paragraph follows no vector table; it must directly follow the vector table or a Tolerance: or Iterate: paragraph, like Iterate: V1 1,000 times, (k, u) <- (f(k, u), k)"
const PROFILE_ITER_TOL: string =
  '<t>Tolerance: 5.2-ITER-1000 ulps 1, <xref section="5.2" sectionFormat="of" target="ECC"/>: "For each iteration"</t>'

/** RFC 7748's excerpt, the one RFC the fixture cites. */
const profileIterTestRfcs = (): ProfileRfcs => {
  const r = new ProfileRfcs()
  r.docs.set(7748, rfcParse(readFileSyncOrNull(PROFILE_ITER_RFC) ?? ""))
  return r
}

/** The profile's refusals of `xml`, each `line message`; "ok" when it reads. */
const profileIterTestRead = (xml: string): string => {
  const doc = xmlDocParse(xml)
  if (doc.isErr()) {
    return `xml ${doc.error.line} ${doc.error.message}`
  }
  const r = profileRead(doc.value, "specs/profile-iterate.xml", null, profileIterTestRfcs())
  if (r.isErr()) {
    return r.error.map((f: ProfileRefusal): string => `${f.line} ${f.message}`).join("\n")
  }
  return "ok"
}

/** The refusals of the fixture with the first vector's paragraph body `body`. */
const profileIterTestP1 = (xml: string, body: string): string =>
  profileIterTestRead(replaceAll(xml, PROFILE_ITER_P1, `<t>Iterate: ${body}</t>`))

/** The contract `xml` reads to; null, with a failure, when it is refused. */
const profileIterTestContract = (t: Suite, name: string, xml: string): Contract | null => {
  const doc = xmlDocParse(xml)
  if (doc.isErr()) {
    t.fail(name, doc.error.message)
    return null
  }
  const r = profileRead(doc.value, "specs/profile-iterate.xml", null, profileIterTestRfcs())
  if (r.isErr()) {
    t.fail(name, r.error.map((f: ProfileRefusal): string => `${f.line} ${f.message}`).join("; "))
    return null
  }
  return r.value.contract
}

/** An expression as source text: `k`, or `f(k, u)`. */
const profileIterTestExpr = (e: Expr): string => {
  if (e.kind === ExprKind.Var) {
    return e.name
  }
  return `${e.name}(${e.args.map((a: Expr): string => profileIterTestExpr(a)).join(", ")})`
}

/** A vector's iterate as `count [slow] (names) <- (next)`, or "none". */
const profileIterTestOf = (c: Contract, id: string): string => {
  for (const k of c.clauses) {
    if (k.id === id) {
      const it = k.iterate
      if (it === null) {
        return "none"
      }
      const next = it.next.map((e: Expr): string => profileIterTestExpr(e)).join(", ")
      return `${it.count}${it.slow ? " slow" : ""} (${it.names.join(", ")}) <- (${next})`
    }
  }
  return "no such vector"
}

/** The fixture's two paragraphs, and the forms that read the same. */
const profileIterTestReads = (t: Suite, xml: string): void => {
  const c = profileIterTestContract(t, "the fixture", xml)
  if (c !== null) {
    t.eqStr("1,000 grouped", profileIterTestOf(c, "5.2-ITER-1000"), "1000 (k, u) <- (x25519(k, u), k)")
    t.eqStr(
      "1000000 ungrouped, slow, ←",
      profileIterTestOf(c, "5.2-ITER-1M"),
      "1000000 slow (k, u) <- (x25519(k, u), k)",
    )
  }
  // A Tolerance: between two Iterate: paragraphs leaves the second after the
  // table: only the tolerance is refused (x25519 returns no f64), not the iterate.
  const mixed = profileIterTestRead(replaceAll(xml, PROFILE_ITER_P1, `${PROFILE_ITER_P1}\n${PROFILE_ITER_TOL}`))
  t.eqStr(
    "interleaved with a Tolerance:",
    mixed,
    "96 5.2-ITER-1000's x25519 returns bytes, and only an f64 result is compared within a tolerance",
  )
  const largest = profileIterTestContract(
    t,
    "1,000,000,000",
    replaceAll(
      xml,
      PROFILE_ITER_P1,
      "<t>Iterate: 5.2-ITER-1000 1,000,000,000 times, (k, u) &lt;- (x25519(k, u), k)</t>",
    ),
  )
  if (largest !== null) {
    t.eqStr("the largest count", profileIterTestOf(largest, "5.2-ITER-1000"), "1000000000 (k, u) <- (x25519(k, u), k)")
  }
  const none = profileIterTestContract(t, "no paragraph", replaceAll(xml, PROFILE_ITER_P1, ""))
  if (none !== null) {
    t.eqStr("a vector without one", profileIterTestOf(none, "5.2-ITER-1000"), "none")
  }
}

/** Each malformed Iterate: paragraph, refused at its line with its own message. */
const profileIterTestRefusals = (t: Suite, xml: string): void => {
  const call = "(k, u) &lt;- (x25519(k, u), k)"
  const noCount = `95 5.2-ITER-1000's Iterate: paragraph gives no count before "times,": ${PROFILE_ITER_FORM}`
  t.eqStr("no count", profileIterTestP1(xml, `5.2-ITER-1000 times, ${call}`), noCount)
  t.eqStr("no count and nothing else", profileIterTestP1(xml, "5.2-ITER-1000"), noCount)
  t.eqStr(
    "no times,",
    profileIterTestP1(xml, `5.2-ITER-1000 1,000 rounds, ${call}`),
    `95 an Iterate: paragraph reads "<id> <count> times," first: ${PROFILE_ITER_FORM}`,
  )
  const counts: string[] = [
    "1,00",
    "01000",
    "0",
    "-1",
    "1e3",
    "1,000,000,001",
    "10000000000",
    "1,0000",
    "1000,000",
    ",000",
    "1,",
  ]
  for (const n of counts) {
    t.eqStr(
      `the count ${n}`,
      profileIterTestP1(xml, `5.2-ITER-1000 ${n} times, ${call}`),
      `95 5.2-ITER-1000's count is a whole number from 1 to 1,000,000,000 in digits, grouped in threes by commas or not at all, not "${n}": ${PROFILE_ITER_FORM}`,
    )
  }
  t.eqStr(
    "no arrow",
    profileIterTestP1(xml, "5.2-ITER-1000 1,000 times, (k, u) = (x25519(k, u), k)"),
    `95 5.2-ITER-1000's Iterate: paragraph has no "<-" between its names and its next: ${PROFILE_ITER_FORM}`,
  )
  t.eqStr(
    "fast, for slow,",
    profileIterTestP1(xml, `5.2-ITER-1000 1,000 times, fast, ${call}`),
    `95 5.2-ITER-1000's Iterate: paragraph has "fast," after "times,", where only "slow," may stand: ${PROFILE_ITER_FORM}`,
  )
  t.eqStr(
    "a word before the tuple",
    profileIterTestP1(xml, `5.2-ITER-1000 1,000 times, slow, then ${call}`),
    `95 5.2-ITER-1000's Iterate: paragraph has "then" after "times,", where only "slow," may stand: ${PROFILE_ITER_FORM}`,
  )
  t.eqStr(
    "a name that is no identifier",
    profileIterTestP1(xml, "5.2-ITER-1000 1,000 times, (k, 2u) &lt;- (x25519(k, 2u), k)"),
    `95 5.2-ITER-1000's name "2u" is not an identifier: ${PROFILE_ITER_FORM}`,
  )
  t.eqStr(
    "a next that is neither",
    profileIterTestP1(xml, "5.2-ITER-1000 1,000 times, (k, u) &lt;- (x25519(k, u), k + 1)"),
    `95 5.2-ITER-1000's next "k + 1" is neither a name nor a call on the names: ${PROFILE_ITER_FORM}`,
  )
  t.eqStr(
    "an unknown vector",
    profileIterTestP1(xml, `V9 1,000 times, ${call}`),
    `95 Iterate: names "V9", which is no vector of the table: ${PROFILE_ITER_FORM}`,
  )
  t.eqStr(
    "two on one vector",
    profileIterTestRead(replaceAll(xml, PROFILE_ITER_P2, `${PROFILE_ITER_P2}\n${PROFILE_ITER_P1}`)),
    "97 5.2-ITER-1000 is iterated already; a vector has at most one Iterate: paragraph",
  )
  t.eqStr(
    "too few names",
    profileIterTestP1(xml, "5.2-ITER-1000 1,000 times, (k) &lt;- (x25519(k, k))"),
    `95 5.2-ITER-1000 names 1, but x25519 takes 2; one name per parameter: ${PROFILE_ITER_FORM}`,
  )
  t.eqStr(
    "one name without parentheses",
    profileIterTestP1(xml, "5.2-ITER-1000 1,000 times, k &lt;- x25519(k, k)"),
    `95 5.2-ITER-1000 names 1, but x25519 takes 2; one name per parameter: ${PROFILE_ITER_FORM}`,
  )
  t.eqStr(
    "too many names",
    profileIterTestP1(xml, "5.2-ITER-1000 1,000 times, (k, u, w) &lt;- (x25519(k, u), k, u)"),
    `95 5.2-ITER-1000 names 3, but x25519 takes 2; one name per parameter: ${PROFILE_ITER_FORM}`,
  )
  t.eqStr(
    "a short next",
    profileIterTestP1(xml, "5.2-ITER-1000 1,000 times, (k, u) &lt;- (x25519(k, u))"),
    `95 5.2-ITER-1000's next has 1, but x25519 takes 2; one per parameter: ${PROFILE_ITER_FORM}`,
  )
  t.eqStr(
    "a long next",
    profileIterTestP1(xml, "5.2-ITER-1000 1,000 times, (k, u) &lt;- (x25519(k, u), k, u)"),
    `95 5.2-ITER-1000's next has 3, but x25519 takes 2; one per parameter: ${PROFILE_ITER_FORM}`,
  )
  t.eqStr(
    "an unknown name",
    profileIterTestP1(xml, "5.2-ITER-1000 1,000 times, (k, u) &lt;- (x25519(k, u), w)"),
    `95 5.2-ITER-1000's next names "w", which is not one of its names: ${PROFILE_ITER_FORM}`,
  )
  t.eqStr(
    "the names out of order",
    profileIterTestP1(xml, "5.2-ITER-1000 1,000 times, (k, u) &lt;- (x25519(u, k), k)"),
    `95 5.2-ITER-1000's next calls x25519(u, k); a call there is the row's x25519(k, u): ${PROFILE_ITER_FORM}`,
  )
  t.eqStr(
    "another function",
    profileIterTestP1(xml, "5.2-ITER-1000 1,000 times, (k, u) &lt;- (x448(k, u), k)"),
    `95 5.2-ITER-1000's next calls x448(k, u); a call there is the row's x25519(k, u): ${PROFILE_ITER_FORM}`,
  )
  // What the profile reads but the shape gate refuses, at the paragraph's line.
  const shaped = profileIterTestP1(xml, "5.2-ITER-1000 1,000 times, (k, u) &lt;- (u, k)")
  t.ok("no call: refused", shaped !== "ok")
  t.ok("no call: at the paragraph's line", shaped.startsWith("95 "))
  const repeated = profileIterTestP1(xml, "5.2-ITER-1000 1,000 times, (k, k) &lt;- (x25519(k, k), k)")
  t.ok("a repeated name: refused", repeated !== "ok")
  t.ok("a repeated name: at the paragraph's line", repeated.startsWith("95 "))
  t.eqStr(
    "a stray one in another section",
    profileIterTestRead(
      replaceAll(xml, '<blockquote anchor="R-ITER">', `${PROFILE_ITER_P1}<blockquote anchor="R-ITER">`),
    ),
    `${profileIterTestLine(xml, '<blockquote anchor="R-ITER">')} ${PROFILE_ITER_STRAY}`,
  )
  t.eqStr(
    "one after a paragraph after the table",
    profileIterTestRead(replaceAll(xml, PROFILE_ITER_P1, `<t>A paragraph.</t>${PROFILE_ITER_P1}`)),
    `95 ${PROFILE_ITER_STRAY}\n96 ${PROFILE_ITER_STRAY}`,
  )
  t.eqStr(
    "one after a prose table",
    profileIterTestRead(
      replaceAll(
        xml,
        '<blockquote anchor="R-ITER">',
        `<table><thead><tr><th>Name</th></tr></thead><tbody><tr><td>x</td></tr></tbody></table>${PROFILE_ITER_P1}<blockquote anchor="R-ITER">`,
      ),
    ),
    `${profileIterTestLine(xml, '<blockquote anchor="R-ITER">')} ${PROFILE_ITER_STRAY}`,
  )
  // An Iterate: on a row the table refused adds no refusal of its own.
  const refused = profileIterTestRead(replaceAll(xml, "x25519(For X25519 = ", "x25519(For X25519 = zz"))
  t.ok("a refused row's iterate: the row refused", refused !== "ok")
  t.ok("a refused row's iterate: not refused itself", refused.indexOf("Iterate") < 0)
}

/** The 1-based line of `xml` that holds `marker`, or 0 when none does. */
const profileIterTestLine = (xml: string, marker: string): i32 => {
  const at = xml.indexOf(marker)
  return at < 0 ? 0 : split(xml.substring(0, at), "\n").length
}

/** The profile's Iterate: spelling, read and refused. */
export const main = (): i32 => {
  const t = new Suite("spec/extract profile iterate")
  const xml = readFileSyncOrNull(PROFILE_ITER_FIXTURE) ?? ""
  t.ok("the fixture holds the first paragraph", xml.indexOf(PROFILE_ITER_P1) > 0)
  t.ok("the fixture holds the second paragraph", xml.indexOf(PROFILE_ITER_P2) > 0)
  // The refusal cases name these fixture lines: the two Iterate: paragraphs.
  t.eqStr(
    "the refusal cases' fixture lines",
    `${profileIterTestLine(xml, PROFILE_ITER_P1)} ${profileIterTestLine(xml, PROFILE_ITER_P2)}`,
    "95 96",
  )
  t.eqStr("the fixture reads", profileIterTestRead(xml), "ok")
  profileIterTestReads(t, xml)
  profileIterTestRefusals(t, xml)
  return t.done()
}
