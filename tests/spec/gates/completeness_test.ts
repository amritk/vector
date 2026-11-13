import { Suite } from "nish/testing"
import { CheckContext } from "../../../src/spec/check"
import { contractParse } from "../../../src/spec/contract/read"
import { gateCompleteness } from "../../../src/spec/gates/completeness"
import { gateWarnings } from "../../../src/spec/gates/note"
import { LoadedSource, SourceSet } from "../../../src/spec/source/load"
import { rfcParse } from "../../../src/spec/source/rfc"

/** A contract that quotes one MUST, excludes one, and leaves one out. */
const COMPLETENESS_TEST_C: string = `{
  "contract": "c1",
  "source": {"title": "T", "rfc": 9999},
  "target": {"module": "nish/x"},
  "requirements": [
    {"id": "R1", "section": "2", "level": "MUST", "quote": "It MUST return the key."}
  ],
  "exclusions": [
    {"section": "2", "quote": "It SHALL NOT log the key.", "reason": "logging is the caller's"},
    {"section": "3", "quote": "It MUST NOT exist.", "reason": "made up"}
  ],
  "functions": [{"name": "f", "params": [{"name": "a", "type": "bytes"}], "returns": "bytes"}],
  "clauses": []
}`

/** The RFC the contract cites. */
const COMPLETENESS_TEST_RFC: string = `Request for Comments: 9999

1.  Intro

   Hello there. The words MUST and SHALL are in BCP 14.

2.  Rules

   It MUST return the key. It SHALL NOT log the key.

3.  More

   It is REQUIRED that the
   lock is kept. It should rest.
`

/** A context with the contract and a hand-built source set. */
const completenessTestCtx = (): CheckContext => {
  const ctx = new CheckContext("contracts/c1.json", ".")
  ctx.contract = contractParse(COMPLETENESS_TEST_C, "c1").expect("parse")
  const set = new SourceSet()
  set.main = "rfc9999"
  set.sources.push(new LoadedSource("rfc9999", "r.txt", "r.txt", rfcParse(COMPLETENESS_TEST_RFC)))
  ctx.sources = set
  return ctx
}

/** The completeness gate. */
export const main = (): i32 => {
  const t = new Suite("spec/gates/completeness")
  const ctx = completenessTestCtx()
  const all = gateCompleteness(ctx)
  t.ok(
    "an uncovered MUST",
    all.indexOf(
      `§1: MUST sentence is neither a requirement nor an exclusion: "The words MUST and SHALL are in BCP 14."`,
    ) >= 0,
  )
  t.ok(
    "an uncovered SHALL",
    all.indexOf(
      `§1: SHALL sentence is neither a requirement nor an exclusion: "The words MUST and SHALL are in BCP 14."`,
    ) >= 0,
  )
  t.ok(
    "an uncovered REQUIRED, across lines",
    all.indexOf(
      `§3: REQUIRED sentence is neither a requirement nor an exclusion: "It is REQUIRED that the lock is kept."`,
    ) >= 0,
  )
  t.ok("a quoted section", !all.some((f: string): boolean => f.indexOf("§2:") === 0))
  t.ok(
    "an exclusion's quote not there",
    all.indexOf(`exclusion §3: quote not found in RFC §3 ("More"): "It MUST NOT exist."`) >= 0,
  )
  const warns = gateWarnings(ctx)
  t.ok(
    "an exclusion shown",
    warns.length === 1 && warns[0].at === "§2" && warns[0].message === "excluded: logging is the caller's",
  )
  t.ok("findings", all.length === 4)
  if (all.length !== 4) {
    console.log(all.join("\n"))
  }
  return t.done()
}
