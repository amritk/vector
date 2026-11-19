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
  from: string
  to: string
  vector: string
  ids: string
  section: string | null
  sectionSource: string | null
  constructor(
    name: string,
    path: string,
    from: string,
    to: string,
    vector: string,
    ids: string,
    section: string | null,
    sectionSource: string | null,
  ) {
    this.name = name
    this.path = path
    this.from = from
    this.to = to
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
    "",
    "",
    "T1",
    "rfc4648-command,rfc4648",
    "5",
    "rfc4648-command",
  ),
  new PssCase(
    "a cited row in a main-RFC spec: its section is the RFC's, and the spec is not declared",
    PSS_MAIN,
    PSS_COMMAND,
    PSS_CITE,
    "T1",
    "rfc4648",
    null,
    null,
  ),
  new PssCase(
    "a command row in a spec that is its own main source: no sectionSource",
    PSS_OWN,
    "",
    "",
    "V6",
    "extract-samples,rfc4648",
    "6",
    null,
  ),
]

export const main = (): i32 => {
  const t = new Suite("spec/profile section source")
  for (const k of pssCases()) {
    const xml = readFileSyncOrNull(k.path) ?? ""
    t.ok(`${k.name}: the fixture holds the edit`, k.from === "" || xml.indexOf(k.from) >= 0)
    const c = pssRead(k.from === "" ? xml : replaceAll(xml, k.from, k.to), k.path)
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
  return t.done()
}
