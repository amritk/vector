import { Suite } from "nish/testing"
import { replaceAll } from "nish/text"
import { CheckContext } from "../../../src/spec/check"
import { contractParse } from "../../../src/spec/contract/read"
import { contractShapeErrors } from "../../../src/spec/contract/shape"
import { contractWrite } from "../../../src/spec/contract/write"
import { gateCompleteness } from "../../../src/spec/gates/completeness"
import { gateFidelity } from "../../../src/spec/gates/fidelity"
import { LoadedSource, SourceSet } from "../../../src/spec/source/load"
import { rfcParse } from "../../../src/spec/source/rfc"

// A vector's `sectionSource`: the args of a command vector in a main-RFC
// contract are looked up in the section of the source it names (the spec's
// own), and in the main source when it names none; a cited vector's in the
// RFC it cites. The spec's own BCP 14 text is never a completeness
// obligation, and only a command vector may name a section's source.

/** The main RFC: §5 does not print the input, §10 does. */
const SST_RFC: string = `Request for Comments: 9995

1.  Intro

   Hello there.

5.  Base 64 Encoding with URL and Filename Safe Alphabet

   The alphabet differs.

10.  Test Vectors

   Input = 666f6f
   BASE32("foo") = "MZXW6==="
`

/** The spec's own text, as a source: §5 prints the input, §6 and §10 do not, and §2 holds an unquoted MUST. */
const SST_OWN: string = `Request for Comments: 9994

2.  Rules

   An encoder MUST pad its output.

5.  Test Vectors

   Input = 666f6f

6.  Other Vectors

   None here.

10.  Test Vectors Again

   BASE32("foo") = "MZXW6==="
`

/** A contract with one vector, of `source` (a JSON object), at `section` in `sectionSource`. */
const sstContract = (source: string, section: string, sectionSource: string): string => `{
  "contract": "own",
  "source": {"title": "T", "rfc": 9995},
  "sources": [{"id": "own", "path": "../specs/own.xml"}, {"id": "rfc9995", "rfc": 9995}],
  "target": {"module": "nish/x"},
  "requirements": [{"id": "R1", "section": "1", "level": "DEFINITION", "quote": "Hello there."}],
  "functions": [{"name": "enc", "params": [{"name": "a", "type": "bytes"}], "returns": "string"}],
  "clauses": [
    {"kind": "vector", "id": "V1", "title": "t", "covers": ["R1"], "source": ${source}${section}${sectionSource},
     "call": "enc", "args": [{"hex": "666f6f", "label": "Input"}], "expect": {"str": "MZXW6==="}}
  ]
}`

const SST_COMMAND: string = `{"command": "printf MZXW6==="}`

/** A context for `json`, its main source the RFC and the spec's own text loaded as "own". */
const sstCtx = (json: string): CheckContext => {
  const ctx = new CheckContext("contracts/own.json", ".")
  ctx.contract = contractParse(json, "own").expect("parse")
  const set = new SourceSet()
  set.main = "rfc9995"
  set.sources.push(new LoadedSource("own", "own.xml", "own.xml", rfcParse(SST_OWN)))
  set.sources.push(new LoadedSource("rfc9995", "r.txt", "r.txt", rfcParse(SST_RFC)))
  ctx.sources = set
  return ctx
}

/** One fidelity row: the vector's source, section and sectionSource, and the finding wanted ("" for none). */
class SstRow {
  name: string
  source: string
  section: string
  sectionSource: string
  want: string
  constructor(name: string, source: string, section: string, sectionSource: string, want: string) {
    this.name = name
    this.source = source
    this.section = section
    this.sectionSource = sectionSource
    this.want = want
  }
}

const sstRows = (): SstRow[] => [
  new SstRow(
    "a command vector, args printed in the spec's own section",
    SST_COMMAND,
    `, "section": "5"`,
    `, "sectionSource": "own"`,
    "",
  ),
  new SstRow(
    "a command vector, args not printed in the spec's own section",
    SST_COMMAND,
    `, "section": "6"`,
    `, "sectionSource": "own"`,
    `V1.args[0]: the 3-byte args[0] is not printed in own §6 ("Other Vectors")`,
  ),
  new SstRow(
    "a command vector naming no source: the main one, which does not print them",
    SST_COMMAND,
    `, "section": "5"`,
    "",
    "V1.args[0]: the 3-byte args[0] is not printed in RFC §5",
  ),
  new SstRow(
    "a command vector naming no source: the main one, which prints them",
    SST_COMMAND,
    `, "section": "10"`,
    "",
    "",
  ),
  new SstRow(
    "a command vector in the spec's own section, which does not print them though the RFC's does",
    SST_COMMAND,
    `, "section": "10"`,
    `, "sectionSource": "own"`,
    `V1.args[0]: the 3-byte args[0] is not printed in own §10 ("Test Vectors Again")`,
  ),
  new SstRow(
    "a command vector at a section the spec does not have",
    SST_COMMAND,
    `, "section": "9"`,
    `, "sectionSource": "own"`,
    "RFC 9994 has no section 9",
  ),
  new SstRow("a cited vector, args printed in the RFC", `{"cite": {"section": "10"}}`, "", "", ""),
  new SstRow(
    "a cited vector, args not printed in the RFC",
    `{"cite": {"section": "5"}}`,
    "",
    "",
    "V1.args[0]: the 3-byte args[0] is not printed in RFC §5",
  ),
]

/** Whether some finding holds `want`. */
const sstHas = (all: string[], want: string): boolean => all.some((f: string): boolean => f.indexOf(want) >= 0)

/** The shape errors of a command vector's contract with its sectionSource as given. */
const sstShape = (source: string, section: string, sectionSource: string): string[] => {
  const c = contractParse(sstContract(source, section, sectionSource), "own")
  if (c.isErr()) {
    return c.error.map((e: string): string => `read: ${e}`)
  }
  return contractShapeErrors(c.value)
}

/** The fidelity rows, completeness, shape and the written form. */
export const main = (): i32 => {
  const t = new Suite("spec/gates section source")
  for (const r of sstRows()) {
    const all = gateFidelity(sstCtx(sstContract(r.source, r.section, r.sectionSource)))
    const ok = r.want === "" ? all.length === 0 : sstHas(all, r.want)
    t.ok(r.name, ok)
    if (!ok) {
      console.log(all.join("\n"))
    }
  }

  // Completeness reads only the main source: the spec's own MUST is no obligation.
  const done = gateCompleteness(sstCtx(sstContract(SST_COMMAND, `, "section": "5"`, `, "sectionSource": "own"`)))
  t.ok("the spec's own MUST is not a completeness obligation", !sstHas(done, "pad its output"))
  t.ok("completeness finds nothing", done.length === 0)
  if (done.length !== 0) {
    console.log(done.join("\n"))
  }

  // Shape: a command vector may name a declared source; nothing else may name one.
  const own = `, "sectionSource": "own"`
  t.eqStr("a command vector naming a declared source", sstShape(SST_COMMAND, `, "section": "5"`, own).join("\n"), "")
  t.ok(
    "a command vector naming an undeclared source",
    sstHas(
      sstShape(SST_COMMAND, `, "section": "5"`, `, "sectionSource": "spec"`),
      `clauses[0].sectionSource: "spec" is not an id from contract.sources (own, rfc9995)`,
    ),
  )
  t.ok(
    "a command vector naming the main source",
    sstHas(
      sstShape(SST_COMMAND, `, "section": "10"`, `, "sectionSource": "rfc9995"`),
      `clauses[0].sectionSource: "rfc9995" is the main source; drop "sectionSource"`,
    ),
  )
  t.ok(
    "a cited vector naming a section's source",
    sstHas(
      sstShape(`{"cite": {"section": "10"}}`, "", own),
      `clauses[0].sectionSource: only a command source's section is in another source; drop "sectionSource"`,
    ),
  )
  t.ok(
    "a spec vector naming a section's source",
    sstHas(
      sstShape(`{"spec": "5"}`, `, "section": "5"`, own),
      `clauses[0].sectionSource: only a command source's section is in another source; drop "sectionSource"`,
    ),
  )

  // Written back as read, and left out when null.
  const named = contractParse(sstContract(SST_COMMAND, `, "section": "5"`, own), "own").expect("parse")
  const text = contractWrite(named)
  t.ok("written when set", text.indexOf(`"sectionSource": "own"`) >= 0)
  t.eqStr("read back", contractParse(text, "own").expect("reparse").clauses[0].sectionSource ?? "null", "own")
  const bare = contractWrite(contractParse(sstContract(SST_COMMAND, `, "section": "5"`, ""), "own").expect("parse"))
  t.ok("left out when null", bare.indexOf("sectionSource") < 0)
  t.ok("an unknown key is still refused", contractParse(replaceAll(text, "sectionSource", "sectionSrc"), "own").isErr())
  return t.done()
}
