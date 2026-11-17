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
  "this Iterate: paragraph follows no vector table; it must directly follow the vector table or a Tolerance:, Iterate: or Truncate: paragraph, like Iterate: V1 1,000 times, (k, u) <- (f(k, u), k)"
const PROFILE_ITER_F64: string = "tests/fixtures/profile/profile-tolerance.xml"
const PROFILE_ITER_TOL_V1: string =
  '<t>Tolerance: V1 ulps 1, <xref target="accuracy"/>: "within one unit in the last place of the exact square root"</t>'
const PROFILE_ITER_TOL_V2: string =
  '<t>Tolerance: V2 abs 1e-9, <xref target="accuracy"/>: "within 1e-9 of half its argument"</t>'
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
  // The paragraph's text is collapsed first: a hard wrap, a tab, a double space.
  const spaced: string[] = ["5.2-ITER-1000 1,000 times,\n      (k, u)", "5.2-ITER-1000\t1,000  times, (k, u)"]
  const spacedNames: string[] = ["a hard wrap after times,", "a tab and a double space"]
  for (let i = 0; i < spaced.length; i++) {
    const w = profileIterTestContract(
      t,
      spacedNames[i],
      replaceAll(xml, PROFILE_ITER_P1, `<t>Iterate: ${spaced[i]} &lt;- (x25519(k, u), k)</t>`),
    )
    if (w !== null) {
      t.eqStr(spacedNames[i], profileIterTestOf(w, "5.2-ITER-1000"), "1000 (k, u) <- (x25519(k, u), k)")
    }
  }
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
  // The hint echoes the author's paragraph, and shows it with a count.
  const noCount = `95 5.2-ITER-1000's Iterate: paragraph gives no count before "times,": it reads `
  const said = "Iterate: 5.2-ITER-1000 times, (k, u) <- (x25519(k, u), k)"
  t.eqStr(
    "no count",
    profileIterTestP1(xml, `5.2-ITER-1000 times, ${call}`),
    `${noCount}"${said}"; put the count there, like Iterate: 5.2-ITER-1000 1,000 times, (k, u) <- (x25519(k, u), k)`,
  )
  t.eqStr(
    "no count and nothing else",
    profileIterTestP1(xml, "5.2-ITER-1000"),
    `${noCount}"Iterate: 5.2-ITER-1000"; put the count there, like Iterate: 5.2-ITER-1000 1,000 ${PROFILE_ITER_FORM.substring(PROFILE_ITER_FORM.indexOf("times,"), PROFILE_ITER_FORM.length)}`,
  )
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
  t.eqStr(
    "no call",
    profileIterTestP1(xml, "5.2-ITER-1000 1,000 times, (k, u) &lt;- (u, k)"),
    "95 the contract read here is not valid: clauses[0].iterate.next: no element is x25519 on the names, so nothing feeds the result back",
  )
  t.eqStr(
    "a repeated name",
    profileIterTestP1(xml, "5.2-ITER-1000 1,000 times, (k, k) &lt;- (x25519(k, k), k)"),
    '95 the contract read here is not valid: clauses[0].iterate.names[1]: "k" repeats names[0]',
  )
  // A bare "Iterate:" is no Iterate: paragraph but prose, so the one after it is stray.
  t.eqStr("a bare Iterate:", profileIterTestP1(xml, ""), `96 ${PROFILE_ITER_STRAY}`)
  t.eqStr(
    "a bare tuple",
    profileIterTestP1(xml, "5.2-ITER-1000 1,000 times, k, u &lt;- (x25519(k, u), k)"),
    `95 5.2-ITER-1000's names "k, u" are more than one, so they stand in parentheses, (k, u): ${PROFILE_ITER_FORM}`,
  )
  t.eqStr(
    "slow twice",
    profileIterTestP1(xml, `5.2-ITER-1000 1,000 times, slow, slow, ${call}`),
    `95 5.2-ITER-1000's Iterate: paragraph says "slow," twice; once is enough: ${PROFILE_ITER_FORM}`,
  )
  t.eqStr(
    "SLOW,",
    profileIterTestP1(xml, `5.2-ITER-1000 1,000 times, SLOW, ${call}`),
    `95 5.2-ITER-1000's Iterate: paragraph has "SLOW," after "times,", where only "slow," may stand: ${PROFILE_ITER_FORM}`,
  )
  t.eqStr(
    "slow after the tuple",
    profileIterTestP1(xml, "5.2-ITER-1000 1,000 times, (k, u), slow &lt;- (x25519(k, u), k)"),
    `95 5.2-ITER-1000's Iterate: paragraph has "(k, u), slow" before "<-"; the names end at their ")", and "slow," stands before them: ${PROFILE_ITER_FORM}`,
  )
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

/** The profile's refusals of the f64 tolerance fixture `xml`; "ok" when it reads. */
const profileIterTestF64 = (xml: string): string => {
  const doc = xmlDocParse(xml)
  if (doc.isErr()) {
    return `xml ${doc.error.line} ${doc.error.message}`
  }
  const r = new ProfileRfcs()
  r.docs.set(4648, rfcParse(readFileSyncOrNull("rfcs/rfc4648.txt") ?? ""))
  const read = profileRead(doc.value, "specs/profile-tolerance.xml", null, r)
  if (read.isErr()) {
    return read.error.map((f: ProfileRefusal): string => `${f.line} ${f.message}`).join("\n")
  }
  return "ok"
}

/**
 * Iterate: beside Tolerance: on the f64 fixture: each on its own vector reads
 * in either order, and what only the shape gate refuses lands on the Iterate: line.
 */
const profileIterTestBesideTolerance = (t: Suite): void => {
  const xml = readFileSyncOrNull(PROFILE_ITER_F64) ?? ""
  t.ok("the f64 fixture holds V2's tolerance", xml.indexOf(PROFILE_ITER_TOL_V2) > 0)
  const iterV2 = "<t>Iterate: V2 3 times, x &lt;- fmathHalf(x)</t>"
  t.eqStr("Tolerance: then Iterate:", profileIterTestF64(replaceAll(xml, PROFILE_ITER_TOL_V2, iterV2)), "ok")
  t.eqStr(
    "Iterate: then Tolerance:",
    profileIterTestF64(
      replaceAll(replaceAll(xml, PROFILE_ITER_TOL_V2, ""), PROFILE_ITER_TOL_V1, `${iterV2}${PROFILE_ITER_TOL_V1}`),
    ),
    "ok",
  )
  t.eqStr(
    "a tolerance on an iterated row",
    profileIterTestF64(
      replaceAll(xml, PROFILE_ITER_TOL_V2, `${PROFILE_ITER_TOL_V2}\n<t>Iterate: V1 3 times, x &lt;- fmathSqrt(x)</t>`),
    ),
    "95 the contract read here is not valid: clauses[0].iterate: an iterated vector compares its last result exactly; drop the tolerance",
  )
  const bool = replaceAll(
    replaceAll(
      replaceAll(xml, "fmathHalf(x: f64): f64", "fmathHalf(x: f64): boolean"),
      "<tt>0.5</tt>",
      "<tt>true</tt>",
    ),
    PROFILE_ITER_TOL_V2,
    "<t>Iterate: V2 3 times, x &lt;- fmathHalf(x)</t>",
  )
  t.eqStr(
    "a bool expected on an iterated row",
    profileIterTestF64(bool),
    "94 the contract read here is not valid: clauses[1].iterate: an iterated vector's expect is a value its call returns, not null or a bool",
  )
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
  profileIterTestBesideTolerance(t)
  return t.done()
}
