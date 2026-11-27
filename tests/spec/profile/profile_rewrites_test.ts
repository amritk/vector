import { Suite } from "nish/testing"
import { replaceAll } from "nish/text"
import { Contract, Expr, ExprKind } from "../../../src/spec/contract/types"
import { ProfileRefusal, ProfileRfcs, profileRead } from "../../../src/spec/profile/profile"
import { rfcParse } from "../../../src/spec/source/rfc"
import { xmlDocParse } from "../../../src/spec/xml/doc"

// The Iterate: paragraph's reading where it was rewritten to be provably
// panic-free: the count's digits, the names and next split at commas outside
// parentheses (a depth that can go below 0), and a call's arguments, each
// read and refused as before.

const PROFILE_REW_FIXTURE: string = "tests/fixtures/profile/profile-iterate.xml"
const PROFILE_REW_RFC: string = "tests/fixtures/profile/rfc7748.txt"
const PROFILE_REW_P1: string = "<t>Iterate: 5.2-ITER-1000 1,000 times, (k, u) &lt;- (x25519(k, u), k)</t>"
const PROFILE_REW_FORM: string = "Iterate: V1 1,000 times, (k, u) <- (f(k, u), k)"

/** RFC 7748's excerpt, the one RFC the fixture cites. */
const profileRewTestRfcs = (): ProfileRfcs => {
  const r = new ProfileRfcs()
  r.docs.set(7748, rfcParse(readFileSyncOrNull(PROFILE_REW_RFC) ?? ""))
  return r
}

/** An expression as source text: `k`, or `f(k, u)`. */
const profileRewTestExpr = (e: Expr): string => {
  if (e.kind === ExprKind.Var) {
    return e.name
  }
  const args: string[] = []
  for (const a of e.args) {
    args.push(profileRewTestExpr(a))
  }
  return `${e.name}(${args.join(", ")})`
}

/** The first vector's iterate as `count (names) <- (next)`, or "none". */
const profileRewTestOf = (c: Contract): string => {
  for (const k of c.clauses) {
    if (k.id === "5.2-ITER-1000") {
      const it = k.iterate
      if (it === null) {
        return "none"
      }
      const next: string[] = []
      for (const e of it.next) {
        next.push(profileRewTestExpr(e))
      }
      return `${it.count} (${it.names.join(", ")}) <- (${next.join(", ")})`
    }
  }
  return "no such vector"
}

/**
 * The fixture with the first vector's paragraph body `body`: its iterate
 * when it reads, else its refusals, each `line message`.
 */
const profileRewTestP1 = (xml: string, body: string): string => {
  const doc = xmlDocParse(replaceAll(xml, PROFILE_REW_P1, `<t>Iterate: ${body}</t>`))
  if (doc.isErr()) {
    return `xml ${doc.error.line} ${doc.error.message}`
  }
  const r = profileRead(doc.value, "specs/profile-iterate.xml", null, profileRewTestRfcs())
  if (r.isErr()) {
    return r.error.map((f: ProfileRefusal): string => `${f.line} ${f.message}`).join("\n")
  }
  return profileRewTestOf(r.value.contract)
}

/** The rewritten Iterate: reading, read and refused as before. */
export const main = (): i32 => {
  const t = new Suite("spec/profile rewrites")
  const xml = readFileSyncOrNull(PROFILE_REW_FIXTURE) ?? ""
  t.ok("the fixture reads", xml.indexOf(PROFILE_REW_P1) >= 0)
  const tail = "times, (k, u) &lt;- (x25519(k, u), k)"
  const read = "(k, u) <- (x25519(k, u), k)"
  // The count's value, from each of its digits, grouped or not.
  const counts: string[] = ["1", "9", "10", "999", "1,234,567", "987654321", "1000000000", "1,000,000,000"]
  const values: string[] = ["1", "9", "10", "999", "1234567", "987654321", "1000000000", "1000000000"]
  for (let i = 0; i < counts.length && i < values.length; i++) {
    t.eqStr(
      `the count ${counts[i]}`,
      profileRewTestP1(xml, `5.2-ITER-1000 ${counts[i]} ${tail}`),
      `${values[i]} ${read}`,
    )
  }
  const over = "1000000001"
  t.eqStr(
    "one over the largest count",
    profileRewTestP1(xml, `5.2-ITER-1000 ${over} ${tail}`),
    `95 5.2-ITER-1000's count is a whole number from 1 to 1,000,000,000 in digits, grouped in threes by commas or not at all, not "${over}": ${PROFILE_REW_FORM}`,
  )
  // A ")" before its "(" takes the depth below 0: the comma after it is inside,
  // so the next is one part, neither a name nor a call.
  t.eqStr(
    "a close before its open",
    profileRewTestP1(xml, "5.2-ITER-1000 1,000 times, (k, u) &lt;- (x25519(k, u)), k)"),
    `95 5.2-ITER-1000's next "x25519(k, u)), k" is neither a name nor a call on the names: ${PROFILE_REW_FORM}`,
  )
  // A nested call splits at the outer comma only.
  t.eqStr(
    "a call on a call",
    profileRewTestP1(xml, "5.2-ITER-1000 1,000 times, (k, u) &lt;- (x25519(k, f(u)), k)"),
    `95 5.2-ITER-1000's next "x25519(k, f(u))" is neither a name nor a call on the names: ${PROFILE_REW_FORM}`,
  )
  // A call with no arguments is a call on none of the names.
  t.eqStr(
    "a call on nothing",
    profileRewTestP1(xml, "5.2-ITER-1000 1,000 times, (k, u) &lt;- (x25519(), k)"),
    `95 5.2-ITER-1000's next calls x25519(); a call there is the row's x25519(k, u): ${PROFILE_REW_FORM}`,
  )
  // Names with a comma and no parentheses, spaced either side.
  t.eqStr(
    "names spaced around their comma",
    profileRewTestP1(xml, "5.2-ITER-1000 1,000 times, k ,u &lt;- (x25519(k, u), k)"),
    `95 5.2-ITER-1000's names "k ,u" are more than one, so they stand in parentheses, (k ,u): ${PROFILE_REW_FORM}`,
  )
  // One of them no identifier: not the parentheses' refusal, but the word's.
  t.eqStr(
    "names with a comma, one no identifier",
    profileRewTestP1(xml, "5.2-ITER-1000 1,000 times, k, 2u &lt;- (x25519(k, u), k)"),
    `95 5.2-ITER-1000's Iterate: paragraph has "k," after "times,", where only "slow," may stand: ${PROFILE_REW_FORM}`,
  )
  return t.done()
}
