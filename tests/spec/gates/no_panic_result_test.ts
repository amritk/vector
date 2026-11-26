import { Suite } from "nish/testing"
import { contractParse } from "../../../src/spec/contract/read"
import { gateArgsAt, gateQuoteWhole } from "../../../src/spec/gates/cite"
import { gateStatesResult } from "../../../src/spec/gates/result"
import { LoadedSource, SourceSet } from "../../../src/spec/source/load"
import { RfcDocument, rfcParse, rfcSection } from "../../../src/spec/source/rfc"

// The bounds-checked readers of src/spec/gates/result.ts and cite.ts, on the
// inputs where each guard rewritten to prove it cannot panic decides.

/** An RFC's text whose section 1 is `body`, through rfcParse. */
const noPanicResultDoc = (body: string): RfcDocument => {
  const head = [
    "Internet Engineering Task Force (IETF)                           A. Author",
    "Request for Comments: 9999                                    Example Inc.",
    "Category: Informational                                         May 2020",
    "",
    "1.  Introduction",
    "",
  ]
  return rfcParse(`${head.join("\n")}\n${body}`)
}

/** Whether section 1, printing `body`, states "true" as R1's result, R1 quoting `quote`: "PASS", or why not. */
const noPanicResult = (body: string, quote: string): string => {
  const doc = noPanicResultDoc(body)
  const json = `{
  "contract": "c1",
  "source": {"title": "T", "rfc": 9999},
  "target": {"module": "nish/x"},
  "requirements": [{"id": "R1", "section": "1", "level": "MUST", "quote": "${quote}"}],
  "functions": [{"name": "f", "params": [{"name": "b", "type": "bytes"}], "returns": "bool"}],
  "clauses": [
    {"kind": "vector", "id": "V1", "title": "t", "covers": ["R1"],
     "source": {"cite": {"section": "1"}}, "call": "f", "args": [{"hex": ""}], "expect": {"bool": true}}
  ]
}`
  const c = contractParse(json, "c1").expect("parse")
  const set = new SourceSet()
  set.main = "rfc9999"
  set.sources.push(new LoadedSource("rfc9999", "r.txt", "r.txt", doc))
  const sec = rfcSection(doc, "1")
  if (sec === null) {
    return "<no section 1>"
  }
  const why = gateStatesResult(c, set, c.clauses[0], gateArgsAt(c.clauses[0]), sec, "true")
  return why !== null ? why : "PASS"
}

/** The same, R1 quoting the whole of a one-line `body`. */
const noPanicResultLine = (body: string): string => noPanicResult(`   ${body}`, body)

/** The reason an alternative `alt` right after "true" gives. */
const noPanicResultAlt = (alt: string): string =>
  `R1 offers an alternative right after "true" ("${alt}"), so "true" is not the whole result`

/** The guards of src/spec/gates/result.ts and cite.ts, where each one decides. */
export const main = (): i32 => {
  const t = new Suite("spec/gates/no-panic-result")
  t.eqStr("a plain result", noPanicResultLine("The check MUST return true."), "PASS")
  // A hyphen of any width right after the value is an alternative.
  t.eqStr("a hyphen", noPanicResultLine("The check MUST return true-ish."), noPanicResultAlt("-"))
  t.eqStr("a slash", noPanicResultLine("The check MUST return true/1."), noPanicResultAlt("/"))
  t.eqStr("an en dash", noPanicResultLine("The check MUST return true–ish."), noPanicResultAlt("–"))
  t.eqStr("a minus sign", noPanicResultLine("The check MUST return true−ish."), noPanicResultAlt("−"))
  t.eqStr("an en dash ending the text", noPanicResultLine("The check MUST return true–"), noPanicResultAlt("–"))
  t.eqStr(
    "another three-byte character",
    noPanicResultLine("The check MUST return true…"),
    `R1 continues past "true" ("true …"), so "true" is a word in a longer phrase, not the stated result (end the clause after it, or follow it with a condition such as "when …")`,
  )
  // Another result after the value, found word by word.
  t.eqStr(
    "another result",
    noPanicResultLine("The check MUST return true; then false."),
    `R1 states another result after "true" ("false"), so "true" is not the whole result`,
  )
  // A denial before the quote qualifies it; one inside the quote is the quote's own.
  t.eqStr(
    "a denial before the quote",
    noPanicResult("   Unless told, the check MUST return true.", "the check MUST return true."),
    `R1 is cut from a sentence that qualifies it before the quote ("Unless"), so the sentence does not require "true"`,
  )
  t.eqStr(
    "a denial inside the quote",
    noPanicResult("   Unless told, the check MUST return true.", "Unless told, the check MUST return true."),
    `R1 does not require "true" as the result (an affirmative MUST, SHALL or REQUIRED to, a result verb, then "true")`,
  )
  // A one-byte quote at the text's start is cut when a word goes on after it.
  t.eqBool("a one-byte quote cut after it", gateQuoteWhole("ab", "a"), false)
  t.eqBool("a one-byte quote ending a word", gateQuoteWhole("a b", "a"), true)
  return t.done()
}
