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

/**
 * A contract whose quotes hold a keyword but not its whole sentence: the
 * keyword alone, half the sentence, a mid-word cut, and a sentence quoted
 * under a sibling section. Only the whole sentence, its period left out, counts.
 */
const COMPLETENESS_TEST_PROBE: string = `{
  "contract": "c2",
  "source": {"title": "T", "rfc": 9999},
  "target": {"module": "nish/x"},
  "requirements": [
    {"id": "R-HALF", "section": "1", "level": "MUST", "quote": "The server MUST reject a request"},
    {"id": "R-WORD", "section": "2", "level": "MUST", "quote": "MUST NOT"},
    {"id": "R-WHOLE", "section": "2", "level": "SHALL", "quote": "A client SHALL retry"},
    {"id": "R-ITEM", "section": "2", "level": "MUST", "quote": "A list item MUST be quoted without its bullet."}
  ],
  "exclusions": [
    {"section": "3", "quote": "It MUST keep the key", "reason": "half"},
    {"section": "4", "quote": "t MUST NOT trust the input.", "reason": "mid-word"},
    {"section": "1", "quote": "Tokens SHALL expire.", "reason": "a sibling's"}
  ],
  "functions": [{"name": "f", "params": [{"name": "a", "type": "bytes"}], "returns": "bytes"}],
  "clauses": []
}`

/** The RFC the probe contract cites. */
const COMPLETENESS_TEST_PROBE_RFC: string = `Request for Comments: 9999

1.  Server

   The server MUST reject a request unless it is signed.

2.  Client

   A client SHALL retry. The client MUST NOT block when idle.

   o  A list item MUST be quoted without its bullet.

3.  Keys

   It MUST keep the key secret when stored.

4.  Input

   It MUST NOT trust the input.

5.  Tokens

   Tokens SHALL expire.
`

/**
 * A contract that quotes sentences holding an abbreviation and list items:
 * a quote cut at "e.g" and one starting after it cover nothing, while each
 * bulleted item quoted on its own covers that item.
 */
const COMPLETENESS_TEST_BOUNDS: string = `{
  "contract": "c3",
  "source": {"title": "T", "rfc": 9999},
  "target": {"module": "nish/x"},
  "requirements": [
    {"id": "R-EG", "section": "1", "level": "MUST", "quote": "A server MUST NOT send data, e.g"},
    {"id": "R-TLS", "section": "4", "level": "MUST", "quote": "TLS MUST be on."},
    {"id": "R-A", "section": "2", "level": "MUST", "quote": "A MUST be X"},
    {"id": "R-B", "section": "2", "level": "MUST", "quote": "B MUST be Y."},
    {"id": "R-C", "section": "3", "level": "MUST", "quote": "C MUST be X"}
  ],
  "exclusions": [],
  "functions": [{"name": "f", "params": [{"name": "a", "type": "bytes"}], "returns": "bytes"}],
  "clauses": []
}`

/** The RFC the bounds contract cites. */
const COMPLETENESS_TEST_BOUNDS_RFC: string = `Request for Comments: 9999

1.  Data

   A server MUST NOT send data, e.g. before the handshake completes.

2.  List

   o  A MUST be X;

   o  B MUST be Y.

3.  Gap

   o  C MUST be X;

   o  D MUST be Y.

4.  Tags

   Use a tag, e.g. TLS MUST be on.
`

/**
 * A contract quoting a sentence an identifier starts, after a period, and a
 * sentence after a paragraph with no final period: each quote covers its
 * sentence alone, and what it leaves out is reported on its own.
 */
const COMPLETENESS_TEST_PARAS: string = `{
  "contract": "c4",
  "source": {"title": "T", "rfc": 9999},
  "target": {"module": "nish/x"},
  "requirements": [
    {"id": "R-ID", "section": "1", "level": "MUST", "quote": "hexDecode MUST NOT accept an odd length."},
    {"id": "R-PARA", "section": "2", "level": "MUST", "quote": "It MUST hold."}
  ],
  "exclusions": [],
  "functions": [{"name": "f", "params": [{"name": "a", "type": "bytes"}], "returns": "bytes"}],
  "clauses": []
}`

/** The RFC the paragraphs contract cites. */
const COMPLETENESS_TEST_PARAS_RFC: string = `Request for Comments: 9999

1.  Decode

   Keys are key material. hexDecode MUST NOT accept an odd length.

2.  Para

   The lock MUST be shut, as the table shows

   It MUST hold.
`

/** A context with a contract and a hand-built source set holding one RFC. */
const completenessTestWith = (contract: string, rfc: string): CheckContext => {
  const ctx = new CheckContext("contracts/c1.json", ".")
  ctx.contract = contractParse(contract, "c1").expect("parse")
  const set = new SourceSet()
  set.main = "rfc9999"
  set.sources.push(new LoadedSource("rfc9999", "r.txt", "r.txt", rfcParse(rfc)))
  ctx.sources = set
  return ctx
}

/** A context with the contract and its source. */
const completenessTestCtx = (): CheckContext => completenessTestWith(COMPLETENESS_TEST_C, COMPLETENESS_TEST_RFC)

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
  const probe = gateCompleteness(completenessTestWith(COMPLETENESS_TEST_PROBE, COMPLETENESS_TEST_PROBE_RFC))
  t.ok(
    "half a sentence as a requirement",
    probe.indexOf(
      `§1: MUST sentence is neither a requirement nor an exclusion: "The server MUST reject a request unless it is signed."`,
    ) >= 0,
  )
  t.ok(
    "the keyword alone as a requirement",
    probe.indexOf(
      `§2: MUST NOT sentence is neither a requirement nor an exclusion: "The client MUST NOT block when idle."`,
    ) >= 0,
  )
  t.ok("a list item without its bullet", !probe.some((f: string): boolean => f.indexOf("A list item") >= 0))
  t.ok(
    "a whole sentence without its period",
    !probe.some((f: string): boolean => f.indexOf("SHALL sentence") >= 0 && f.indexOf("§2") === 0),
  )
  t.ok(
    "half a sentence as an exclusion",
    probe.indexOf(
      `§3: MUST sentence is neither a requirement nor an exclusion: "It MUST keep the key secret when stored."`,
    ) >= 0,
  )
  t.ok(
    "a mid-word exclusion",
    probe.indexOf(`exclusion §4: the quote starts or ends inside a word: "t MUST NOT trust the input."`) >= 0,
  )
  t.ok(
    "a mid-word exclusion covers nothing",
    probe.indexOf(`§4: MUST NOT sentence is neither a requirement nor an exclusion: "It MUST NOT trust the input."`) >=
      0,
  )
  t.ok(
    "a sibling's sentence under the wrong section",
    probe.indexOf(`exclusion §1: quote not found in RFC §1 ("Server"): "Tokens SHALL expire."`) >= 0,
  )
  t.ok(
    "a sibling's sentence stays uncovered",
    probe.indexOf(`§5: SHALL sentence is neither a requirement nor an exclusion: "Tokens SHALL expire."`) >= 0,
  )
  t.ok("probe findings", probe.length === 7)
  if (probe.length !== 7) {
    console.log(probe.join("\n"))
  }
  const bounds = gateCompleteness(completenessTestWith(COMPLETENESS_TEST_BOUNDS, COMPLETENESS_TEST_BOUNDS_RFC))
  t.ok(
    "a quote cut at e.g covers nothing",
    bounds.indexOf(
      `§1: MUST NOT sentence is neither a requirement nor an exclusion: "A server MUST NOT send data, e.g. before the handshake completes."`,
    ) >= 0,
  )
  t.ok(
    "a quote starting after e.g covers nothing",
    bounds.indexOf(`§4: MUST sentence is neither a requirement nor an exclusion: "Use a tag, e.g. TLS MUST be on."`) >=
      0,
  )
  t.ok("each list item quoted alone", !bounds.some((f: string): boolean => f.indexOf("§2") === 0))
  t.ok(
    "an unquoted list item",
    bounds.indexOf(`§3: MUST sentence is neither a requirement nor an exclusion: "D MUST be Y."`) >= 0,
  )
  t.ok("bounds findings", bounds.length === 3)
  if (bounds.length !== 3) {
    console.log(bounds.join("\n"))
  }
  const paras = gateCompleteness(completenessTestWith(COMPLETENESS_TEST_PARAS, COMPLETENESS_TEST_PARAS_RFC))
  t.ok(
    "an identifier after a period starts the sentence quoted",
    !paras.some((f: string): boolean => f.indexOf("§1") === 0),
  )
  t.ok(
    "a paragraph without a final period is a sentence of its own",
    paras.indexOf(
      `§2: MUST sentence is neither a requirement nor an exclusion: "The lock MUST be shut, as the table shows"`,
    ) >= 0,
  )
  t.ok("paragraph findings", paras.length === 1)
  if (paras.length !== 1) {
    console.log(paras.join("\n"))
  }
  return t.done()
}
