import { Suite } from "nish/testing"
import { joinPath, makeTempDir, mkdirAll } from "../../../src/core/fs"
import { CheckContext, checkAddReader } from "../../../src/spec/check"
import { Contract, SourceDecl } from "../../../src/spec/contract/types"
import { gateSources } from "../../../src/spec/gates/cite"
import { sourceFind } from "../../../src/spec/source/load"
import { RfcDocument, rfcRead } from "../../../src/spec/source/rfc"

/** A spec's text, which the test's `.xml` reader reads as an RFC's. */
const READERS_TEST_SPEC: string = `Request for Comments: 5555
\f
1.  Intro

   It MUST work.
`

/** A stand-in `.xml` reader: the RFC text reader under another name. */
const readersTestXml = (text: string, name: string): Result<RfcDocument, string> => rfcRead(text, name)

/** A contract whose one source is `spec.xml`, beside it. */
const readersTestContract = (): Contract => {
  const c = new Contract()
  c.contract = "c"
  c.source.title = "T"
  c.source.main = "x"
  const d = new SourceDecl()
  d.id = "x"
  d.rfc = -1
  d.path = "spec.xml"
  c.sources = [d]
  return c
}

/** A check's readers: the default refuses `.xml`, and checkAddReader adds a reader the gates then use. */
export const main = (): i32 => {
  const t = new Suite("spec/gates readers")
  const root = joinPath(makeTempDir("vector-readers-").expect("temp dir"), "repo")
  mkdirAll(joinPath(root, "contracts"), 0o755).expect("mkdir")
  writeFileSync(joinPath(root, "contracts/spec.xml"), READERS_TEST_SPEC)
  const contractPath = joinPath(root, "contracts/c.json")

  const plain = new CheckContext(contractPath, root)
  plain.contract = readersTestContract()
  const out: string[] = []
  const set = gateSources(plain, out, "fidelity")
  t.eqStr(
    "with no reader registered, a .xml source is refused",
    out.join(" | "),
    "sources: source x: contracts/spec.xml is a .xml file, and no reader is registered for it: readers are registered for .txt, so nothing citing it can be checked",
  )
  t.ok("and nothing is read", sourceFind(set, "x") === null)

  const ctx = new CheckContext(contractPath, root)
  ctx.contract = readersTestContract()
  t.ok("a reader is added", checkAddReader(ctx, ".xml", readersTestXml).isOk())
  const found: string[] = []
  const read = sourceFind(gateSources(ctx, found, "fidelity"), "x")
  t.eqStr("the gates read with it", found.join(" | "), "")
  t.ok("and the source is read", read !== null && read.doc.number === 5555 && read.doc.sections.length === 1)
  t.ok("the other context still has only the default", plain.readers.entries.length === 1)
  const bad = checkAddReader(ctx, "xml", readersTestXml)
  t.eqStr(
    "an extension without its dot is refused",
    bad.isErr() ? bad.error : "",
    'a reader\'s extension is "xml": give it with its leading dot and nothing else, as ".xml"',
  )
  return t.done()
}
