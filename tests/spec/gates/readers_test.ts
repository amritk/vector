import { Suite } from "nish/testing"
import { joinPath, makeTempDir, mkdirAll } from "../../../src/core/fs"
import { CheckContext, checkAddReader } from "../../../src/spec/check"
import { Contract, SourceDecl } from "../../../src/spec/contract/types"
import { gateSources } from "../../../src/spec/gates/cite"
import { sourceFind } from "../../../src/spec/source/load"
import { RfcDocument, rfcRead } from "../../../src/spec/source/rfc"

/** A spec's text, which the test's `.adoc` reader reads as an RFC's. */
const READERS_TEST_SPEC: string = `Request for Comments: 5555
\f
1.  Intro

   It MUST work.
`

/** The same spec as RFC XML v3, which the default readers read. */
const READERS_TEST_XML: string =
  '<rfc number="5555"><middle><section anchor="intro" numbered="true"><name>Intro</name><t>It MUST work.</t></section></middle></rfc>\n'

/** A stand-in `.adoc` reader: the RFC text reader under another name. */
const readersTestAdoc = (text: string, name: string): Result<RfcDocument, string> => rfcRead(text, name)

/** A contract whose one source is `file`, beside it. */
const readersTestContract = (file: string): Contract => {
  const c = new Contract()
  c.contract = "c"
  c.source.title = "T"
  c.source.main = "x"
  const d = new SourceDecl()
  d.id = "x"
  d.rfc = -1
  d.path = file
  c.sources = [d]
  return c
}

/**
 * A check's readers: the default reads `.xml` (every command's check does),
 * refuses an extension nothing reads, and checkAddReader adds a reader the
 * gates then use.
 */
export const main = (): i32 => {
  const t = new Suite("spec/gates readers")
  const root = joinPath(makeTempDir("vector-readers-").expect("temp dir"), "repo")
  mkdirAll(joinPath(root, "contracts"), 0o755).expect("mkdir")
  writeFileSync(joinPath(root, "contracts/spec.adoc"), READERS_TEST_SPEC)
  writeFileSync(joinPath(root, "contracts/spec.xml"), READERS_TEST_XML)
  const contractPath = joinPath(root, "contracts/c.json")

  const viaXml = new CheckContext(contractPath, root)
  viaXml.contract = readersTestContract("spec.xml")
  const xmlOut: string[] = []
  const xml = sourceFind(gateSources(viaXml, xmlOut, "fidelity"), "x")
  t.eqStr("with no reader added, a .xml source is read", xmlOut.join(" | "), "")
  t.ok("by the XML reader", xml !== null && xml.doc.number === 5555 && xml.doc.sections.length === 1)

  const plain = new CheckContext(contractPath, root)
  plain.contract = readersTestContract("spec.adoc")
  const out: string[] = []
  const set = gateSources(plain, out, "fidelity")
  t.eqStr(
    "with no reader registered, an .adoc source is refused",
    out.join(" | "),
    "sources: source x: contracts/spec.adoc is a .adoc file, and no reader is registered for it: readers are registered for .txt, .xml, so nothing citing it can be checked",
  )
  t.ok("and nothing is read", sourceFind(set, "x") === null)

  const ctx = new CheckContext(contractPath, root)
  ctx.contract = readersTestContract("spec.adoc")
  t.ok("a reader is added", checkAddReader(ctx, ".adoc", readersTestAdoc).isOk())
  const found: string[] = []
  const read = sourceFind(gateSources(ctx, found, "fidelity"), "x")
  t.eqStr("the gates read with it", found.join(" | "), "")
  t.ok("and the source is read", read !== null && read.doc.number === 5555 && read.doc.sections.length === 1)
  t.ok("the other context still has only the default", plain.readers.entries.length === 2)
  const bad = checkAddReader(ctx, "adoc", readersTestAdoc)
  t.eqStr(
    "an extension without its dot is refused",
    bad.isErr() ? bad.error : "",
    'a reader\'s extension is "adoc": give it with its leading dot and nothing else, as ".xml"',
  )
  return t.done()
}
