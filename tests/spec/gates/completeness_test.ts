import { Suite } from "nish/testing"
import { CheckContext } from "../../../src/spec/check"
import { contractParse } from "../../../src/spec/contract/read"
import { gateCompleteness } from "../../../src/spec/gates/completeness"
import { gateWarnings } from "../../../src/spec/gates/note"
import { LoadedSource, SourceSet } from "../../../src/spec/source/load"
import { RfcDocument, rfcParse } from "../../../src/spec/source/rfc"
import { xmlRead } from "../../../src/spec/xml/doc"

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

/**
 * A contract on an XML main source that quotes a BCP 14 sentence once, in
 * section 1, where unmarked paragraphs repeat it before and after. An
 * unmarked paragraph is a `<t>` whose keyword has no `<bcp14>` markup: the
 * XML reader records no normative entry for it, but the gate reads the
 * section's text, markup gone, so its MUST is a keyword use like any other.
 * The one quote covers every verbatim copy (rfcOwnSpans finds each), while a
 * paraphrase in section 1 and an unmarked sentence alone in section 2 are
 * still refused.
 */
const COMPLETENESS_TEST_COPIES: string = `{
  "contract": "c5",
  "source": {"title": "T", "rfc": 9999},
  "target": {"module": "nish/x"},
  "requirements": [
    {"id": "R-PAD", "section": "1", "level": "MUST", "quote": "A sender MUST pad the block."}
  ],
  "exclusions": [],
  "functions": [{"name": "f", "params": [{"name": "a", "type": "bytes"}], "returns": "bytes"}],
  "clauses": []
}`

/** The XML RFC the copies contract cites. */
const COMPLETENESS_TEST_COPIES_XML: string = `<?xml version="1.0" encoding="UTF-8"?>
<rfc number="9999" docName="draft-copies-00" category="std" ipr="trust200902" version="3">
<front><title>Copies</title></front>
<middle>
<section anchor="pad"><name>Pad</name>
<t>A sender MUST pad the block.</t>
<t>A sender <bcp14>MUST</bcp14> pad the block.</t>
<t>As said above, a sender MUST pad the block.</t>
<t>A sender MUST pad the block.</t>
</section>
<section anchor="stop"><name>Stop</name>
<t>A reader MUST stop.</t>
</section>
</middle>
</rfc>
`

/** Where the anchored-quote fixture keeps its specs and its contract. */
const COMPLETENESS_TEST_AQ: string = "tests/fixtures/anchored-quote"

/**
 * A context on the anchored-quote fixture: the contract extracted from
 * `aq-two` (R-NO-LF quoting RFC 4648 §3.1, anchored on a blockquote in spec
 * §3, and R-PAD quoting §3.2 in spec §4), with `edit` applied to its text,
 * checked against the spec `read`, which the gate rereads from `file`.
 */
const completenessTestAq = (read: string, file: string, from: string, to: string): CheckContext => {
  const path = `${COMPLETENESS_TEST_AQ}/specs/${file}.xml`
  const xml = readFileSyncOrNull(`${COMPLETENESS_TEST_AQ}/specs/${read}.xml`) ?? ""
  const text = readFileSyncOrNull(`${COMPLETENESS_TEST_AQ}/contracts/aq-two.json`) ?? ""
  const at = from === "" ? -1 : text.indexOf(from)
  const json = at < 0 ? text : `${text.slice(0, at)}${to}${text.slice(at + from.length)}`
  const ctx = new CheckContext(`${COMPLETENESS_TEST_AQ}/contracts/aq-two.json`, ".")
  ctx.contract = contractParse(json, "aq-two").expect("parse")
  const set = new SourceSet()
  set.main = "aq-two"
  set.sources.push(new LoadedSource("aq-two", path, path, xmlRead(xml, path).expect("xml")))
  ctx.sources = set
  return ctx
}

/** One anchored-quote row: the spec read and reread, an edit to the contract, and the findings expected. */
class CompletenessTestAqRow {
  name: string
  read: string
  file: string
  from: string
  to: string
  want: string[]
  constructor(name: string, read: string, file: string, from: string, to: string, want: string[]) {
    this.name = name
    this.read = read
    this.file = file
    this.from = from
    this.to = to
    this.want = want
  }
}

/** RFC 4648 §3.1, as R-NO-LF quotes it. */
const COMPLETENESS_TEST_NO_LF: string =
  "Implementations MUST NOT add line feeds to base-encoded data unless the specification referring to this document explicitly directs base encoders to add line feeds after a specific number of characters."

/** RFC 4648 §3.2, as R-PAD quotes it. */
const COMPLETENESS_TEST_PAD: string =
  "Implementations MUST include appropriate pad characters at the end of encoded data unless the specification referring to this document explicitly states otherwise."

/**
 * Anchored quotes of another RFC in a spec's own sections: each counts in
 * the one section holding the blockquote anchored with its id, and nowhere
 * else, and the spec's own unquoted sentences are still reported. As for a
 * main source's quote, a verbatim copy in the same section is covered too:
 * it adds no words the quote does not hold.
 */
const completenessTestAqRows = (): CompletenessTestAqRow[] => {
  const lf = `MUST NOT sentence is neither a requirement nor an exclusion: "${COMPLETENESS_TEST_NO_LF}"`
  const pad = `MUST sentence is neither a requirement nor an exclusion: "${COMPLETENESS_TEST_PAD}"`
  return [
    new CompletenessTestAqRow("two anchored quotes in two sections", "aq-two", "aq-two", "", "", []),
    new CompletenessTestAqRow("an unanchored quote", "aq-unanchored", "aq-unanchored", "", "", [`§4: ${pad}`]),
    new CompletenessTestAqRow("the spec's own sentence beside a quote", "aq-own", "aq-own", "", "", [
      `§3: MUST NOT sentence is neither a requirement nor an exclusion: "aqEncode MUST NOT add a line feed."`,
    ]),
    new CompletenessTestAqRow("a quote repeated as prose", "aq-prose", "aq-prose", "", "", [`§5: ${lf}`]),
    new CompletenessTestAqRow("a verbatim copy beside its quote", "aq-copy", "aq-copy", "", "", []),
    new CompletenessTestAqRow("an id no blockquote holds", "aq-two", "aq-two", `"id": "R-PAD"`, `"id": "R-PADS"`, [
      `§4: ${pad}`,
    ]),
    new CompletenessTestAqRow(
      "a quote in another quote's section",
      "aq-two",
      "aq-two",
      COMPLETENESS_TEST_NO_LF,
      COMPLETENESS_TEST_PAD,
      [`§3: ${lf}`],
    ),
    new CompletenessTestAqRow("a reread that is not the spec read", "aq-two", "aq-own", "", "", [
      `§3: ${lf}`,
      `§4: ${pad}`,
    ]),
  ]
}

/** Where the main-RFC anchored-quote fixture lives: an RFC 9998 in XML, whose §2 and §3 hold anchored blockquotes. */
const COMPLETENESS_TEST_MAIN_XML: string = "tests/fixtures/anchored-quote/rfcs/rfc9998.xml"

/**
 * A main-RFC contract on RFC 9998: R-PAD cites the main RFC's §1, whose
 * sentence §2 repeats in a blockquote anchored R-PAD, and R-B64 quotes RFC
 * 4648 §3.2 from `b64` (a source, or "" to cite the main RFC's §3).
 */
const completenessTestMain = (b64: string): string => {
  const cite = b64 === "" ? `"section": "3"` : `"source": "${b64}", "section": "3.2"`
  return `{
  "contract": "c6",
  "source": {"title": "T", "rfc": 9998},
  "target": {"module": "nish/x"},
  "requirements": [
    {"id": "R-PAD", "section": "1", "level": "MUST", "quote": "A sender MUST pad the block."},
    {"id": "R-B64", ${cite}, "level": "MUST", "quote": "${COMPLETENESS_TEST_PAD}"}
  ],
  "exclusions": [],
  "functions": [{"name": "f", "params": [{"name": "a", "type": "bytes"}], "returns": "bytes"}],
  "clauses": []
}`
}

/** The completeness gate on a main-RFC contract over RFC 9998, read from its fixture file. */
const completenessTestMainRun = (b64: string): string[] => {
  const xml = readFileSyncOrNull(COMPLETENESS_TEST_MAIN_XML) ?? ""
  const doc = xmlRead(xml, COMPLETENESS_TEST_MAIN_XML).expect("xml")
  const ctx = new CheckContext("contracts/c6.json", ".")
  ctx.contract = contractParse(completenessTestMain(b64), "c6").expect("parse")
  const set = new SourceSet()
  set.main = "rfc9998"
  set.sources.push(new LoadedSource("rfc9998", COMPLETENESS_TEST_MAIN_XML, COMPLETENESS_TEST_MAIN_XML, doc))
  ctx.sources = set
  return gateCompleteness(ctx)
}

/** A context with a contract and a hand-built source set holding one read RFC. */
const completenessTestDoc = (contract: string, file: string, doc: RfcDocument): CheckContext => {
  const ctx = new CheckContext("contracts/c1.json", ".")
  ctx.contract = contractParse(contract, "c1").expect("parse")
  const set = new SourceSet()
  set.main = "rfc9999"
  set.sources.push(new LoadedSource("rfc9999", file, file, doc))
  ctx.sources = set
  return ctx
}

/** A context with a contract and a source set holding one text RFC. */
const completenessTestWith = (contract: string, rfc: string): CheckContext =>
  completenessTestDoc(contract, "r.txt", rfcParse(rfc))

/** A context with a contract and a source set holding one XML RFC. */
const completenessTestXml = (contract: string, xml: string): CheckContext =>
  completenessTestDoc(contract, "r.xml", xmlRead(xml, "r.xml").expect("xml"))

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
  const copies = gateCompleteness(completenessTestXml(COMPLETENESS_TEST_COPIES, COMPLETENESS_TEST_COPIES_XML))
  t.ok(
    "an unmarked copy of a quoted sentence",
    !copies.some((f: string): boolean => f.indexOf(`: "A sender MUST pad the block."`) >= 0),
  )
  t.ok(
    "an unmarked paraphrase of a quoted sentence",
    copies.indexOf(
      `§1: MUST sentence is neither a requirement nor an exclusion: "As said above, a sender MUST pad the block."`,
    ) >= 0,
  )
  t.ok(
    "an unmarked sentence nothing quotes",
    copies.indexOf(`§2: MUST sentence is neither a requirement nor an exclusion: "A reader MUST stop."`) >= 0,
  )
  t.ok("copies findings", copies.length === 2)
  if (copies.length !== 2) {
    console.log(copies.join("\n"))
  }
  const again = `§2: MUST sentence is neither a requirement nor an exclusion: "A sender MUST pad the block."`
  const mainOnly = completenessTestMainRun("")
  t.ok("a main requirement covers only the section it cites", mainOnly.length === 1 && mainOnly[0] === again)
  if (!(mainOnly.length === 1 && mainOnly[0] === again)) {
    console.log(mainOnly.join("\n"))
  }
  const mainOther = completenessTestMainRun("rfc4648")
  t.ok("another RFC's quote counts in a main RFC's section", mainOther.length === 1 && mainOther[0] === again)
  if (!(mainOther.length === 1 && mainOther[0] === again)) {
    console.log(mainOther.join("\n"))
  }
  for (const row of completenessTestAqRows()) {
    const got = gateCompleteness(completenessTestAq(row.read, row.file, row.from, row.to))
    const same = got.length === row.want.length && row.want.every((w: string): boolean => got.indexOf(w) >= 0)
    t.ok(row.name, same)
    if (!same) {
      console.log(got.join("\n"))
    }
  }
  return t.done()
}
