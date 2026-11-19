import { Suite } from "nish/testing"
import { replaceAll } from "nish/text"
import { Clause, Contract, SourceDecl } from "../../../src/spec/contract/types"
import { ProfileRefusal, ProfileRfcs, profileRead } from "../../../src/spec/profile/profile"
import { rfcParse } from "../../../src/spec/source/rfc"
import { xmlDocParse } from "../../../src/spec/xml/doc"

// Where a vector's section is: a command row's args are printed in the spec's
// own section, so a main-RFC spec with one declares the spec as a source and
// names it in the vector's sectionSource; a cited row keeps its section in
// the RFC, and a spec that is its own main source names nothing.

const PSS_MAIN: string = "tests/fixtures/rfc4648-command/specs/rfc4648-command.xml"
const PSS_OWN: string = "tests/fixtures/extract-samples/specs/extract-samples.xml"
const PSS_COMMAND: string =
  "<tt>python3 -c 'import base64,sys;sys.stdout.write(base64.b32encode(b\"foo\").decode())'</tt>"
const PSS_CITE: string = '<xref section="10" sectionFormat="of" target="RFC4648"/>'
const PSS_DOCNAME: string = "draft-rfc4648-command-00"
const PSS_DOCNAME_RFC: string = "draft-rfc4648-00"
const PSS_MAIN_AS_RFC: string = "tests/fixtures/rfc4648-command/specs/rfc4648.xml"
const PSS_TAIL: string = "</tr>\n        </tbody>"
const PSS_CITED_ROW: string =
  '</tr><tr><td align="left">T2</td><td align="left"><tt>base32Encode(Input = 666f)</tt></td>' +
  '<td align="left"><tt>"MZXQ===="</tt></td><td align="left">R-B32</td>' +
  '<td align="left"><xref section="10" sectionFormat="of" target="RFC4648"/></td>' +
  '<td align="left">base 32 of "fo"</td></tr>\n        </tbody>'

/** RFC 4648, the one RFC both fixtures cite. */
const pssRfcs = (): ProfileRfcs => {
  const r = new ProfileRfcs()
  r.docs.set(4648, rfcParse(readFileSyncOrNull("rfcs/rfc4648.txt") ?? ""))
  return r
}

/** The contract the profile reads from `xml`, or null with its refusals printed. */
const pssRead = (xml: string, path: string): Contract | null => {
  const doc = xmlDocParse(xml)
  if (doc.isErr()) {
    console.log(`xml ${doc.error.line} ${doc.error.message}`)
    return null
  }
  const r = profileRead(doc.value, path, null, pssRfcs())
  if (r.isErr()) {
    console.log(r.error.map((f: ProfileRefusal): string => `${f.line} ${f.message}`).join("\n"))
    return null
  }
  return r.value.contract
}

/** The declared sources' ids, comma-joined. */
const pssIds = (c: Contract): string => {
  const ds: SourceDecl[] = c.sources ?? []
  return ds.map((d: SourceDecl): string => d.id).join(",")
}

/** The vector `id`, or null. */
const pssVector = (c: Contract, id: string): Clause | null => {
  for (const k of c.clauses) {
    if (k.id === id) {
      return k
    }
  }
  return null
}

/** One row: the spec, its edit, and where the vector's section must then be. */
class PssCase {
  name: string
  path: string
  edits: string[]
  vector: string
  ids: string
  section: string | null
  sectionSource: string | null
  constructor(
    name: string,
    path: string,
    edits: string[],
    vector: string,
    ids: string,
    section: string | null,
    sectionSource: string | null,
  ) {
    this.name = name
    this.path = path
    this.edits = edits
    this.vector = vector
    this.ids = ids
    this.section = section
    this.sectionSource = sectionSource
  }
}

const pssCases = (): PssCase[] => [
  new PssCase(
    "a command row in a main-RFC spec: its section is the spec's",
    PSS_MAIN,
    [],
    "T1",
    "rfc4648-command,rfc4648",
    "5",
    "rfc4648-command",
  ),
  new PssCase(
    "a cited row in a main-RFC spec: its section is the RFC's, and the spec is not declared",
    PSS_MAIN,
    [PSS_COMMAND, PSS_CITE],
    "T1",
    "rfc4648",
    null,
    null,
  ),
  new PssCase(
    "a command row in a spec that is its own main source: no sectionSource",
    PSS_OWN,
    [],
    "V6",
    "extract-samples,rfc4648",
    "6",
    null,
  ),
  new PssCase(
    "a main-RFC spec with a command row and a cited row: the command row names the spec",
    PSS_MAIN,
    [PSS_TAIL, PSS_CITED_ROW],
    "T1",
    "rfc4648-command,rfc4648",
    "5",
    "rfc4648-command",
  ),
  new PssCase(
    "a main-RFC spec with a command row and a cited row: the cited row names nothing",
    PSS_MAIN,
    [PSS_TAIL, PSS_CITED_ROW],
    "T2",
    "rfc4648-command,rfc4648",
    null,
    null,
  ),
  new PssCase(
    "a main-RFC spec named rfc4648 with only cited rows: the spec is not declared, so nothing collides",
    PSS_MAIN_AS_RFC,
    [PSS_DOCNAME, PSS_DOCNAME_RFC, PSS_COMMAND, PSS_CITE],
    "T1",
    "rfc4648",
    null,
    null,
  ),
]

/** A spec whose own source id would be an RFC's: refused, naming the cause; or accepted. */
class PssIdCase {
  name: string
  path: string
  edits: string[]
  refusal: string
  constructor(name: string, path: string, edits: string[], refusal: string) {
    this.name = name
    this.path = path
    this.edits = edits
    this.refusal = refusal
  }
}

const PSS_COLLIDES: string =
  'contract "rfc4648" is the source id of RFC4648, which the spec cites; give the spec another docName'

const pssIdCases = (): PssIdCase[] => [
  new PssIdCase(
    "a main-RFC spec named rfc4648 with a command row",
    PSS_MAIN_AS_RFC,
    [PSS_DOCNAME, PSS_DOCNAME_RFC],
    PSS_COLLIDES,
  ),
  new PssIdCase(
    "a main-RFC spec named rfc4648 with only cited rows",
    PSS_MAIN_AS_RFC,
    [PSS_DOCNAME, PSS_DOCNAME_RFC, PSS_COMMAND, PSS_CITE],
    "",
  ),
  new PssIdCase(
    "a main-RFC spec named rfc4649 with a command row, citing only RFC 4648",
    "tests/fixtures/rfc4648-command/specs/rfc4649.xml",
    [PSS_DOCNAME, "draft-rfc4649-00"],
    "",
  ),
  new PssIdCase(
    "a spec that is its own main source, named rfc4648 and citing RFC 4648",
    "tests/fixtures/extract-samples/specs/rfc4648.xml",
    ["draft-extract-samples-00", PSS_DOCNAME_RFC],
    PSS_COLLIDES,
  ),
]

/** The refusals of reading `xml`, one message a line; "" when it reads. */
const pssRefusals = (xml: string, path: string): string => {
  const doc = xmlDocParse(xml)
  if (doc.isErr()) {
    return `xml ${doc.error.message}`
  }
  const r = profileRead(doc.value, path, null, pssRfcs())
  return r.isErr() ? r.error.map((f: ProfileRefusal): string => f.message).join("\n") : ""
}

/** `xml` with each pair of `edits` replaced; null when a `from` is not in it. */
const pssEdit = (xml: string, edits: string[]): string | null => {
  let out = xml
  for (let i = 0; i + 1 < edits.length; i += 2) {
    if (out.indexOf(edits[i]) < 0) {
      return null
    }
    out = replaceAll(out, edits[i], edits[i + 1])
  }
  return out
}

export const main = (): i32 => {
  const t = new Suite("spec/profile section source")
  for (const k of pssCases()) {
    const xml = pssEdit(readFileSyncOrNull(k.path === PSS_MAIN_AS_RFC ? PSS_MAIN : k.path) ?? "", k.edits)
    t.ok(`${k.name}: the fixture holds the edits`, xml !== null)
    const c: Contract | null = xml === null ? null : pssRead(xml, k.path)
    if (c === null) {
      t.ok(`${k.name}: reads`, false)
      continue
    }
    t.ok(`${k.name}: sources`, pssIds(c) === k.ids)
    if (pssIds(c) !== k.ids) {
      console.log(pssIds(c))
    }
    const v = pssVector(c, k.vector)
    t.eqStr(`${k.name}: section`, v === null ? "no vector" : v.section ?? "null", k.section ?? "null")
    t.eqStr(`${k.name}: sectionSource`, v === null ? "no vector" : v.sectionSource ?? "null", k.sectionSource ?? "null")
  }
  for (const k of pssIdCases()) {
    const from = k.path.startsWith("tests/fixtures/rfc4648-command/") ? PSS_MAIN : PSS_OWN
    const xml = pssEdit(readFileSyncOrNull(from) ?? "", k.edits)
    t.ok(`${k.name}: the fixture holds the edits`, xml !== null)
    t.eqStr(k.name, xml === null ? "no fixture" : pssRefusals(xml, k.path), k.refusal)
  }
  return t.done()
}
