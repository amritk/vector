import { Suite } from "nish/testing"
import { replaceAll, split } from "nish/text"
import { diagPlace } from "../../../src/core/diag"
import { joinPath, makeTempDir, mkdirAll } from "../../../src/core/fs"
import {
  ExtractOutcome,
  extractContract,
  extractDefaultContractPath,
  extractReaders,
  extractUnifiedDiff,
} from "../../../src/spec/extract"
import { SourceReaders } from "../../../src/spec/source/load"

const EXTRACT_TEST_MAIN: string = "tests/fixtures/rfc-main"

/** An outcome as text: `ok`, each refusal as `file:line message`, or `error <why>`. */
const extractTestOutcome = (o: ExtractOutcome): string => {
  if (o.errors.length > 0) {
    return `error ${o.errors.join("; ")}`
  }
  if (o.refusals.length > 0) {
    return o.refusals
      .map((f): string => `${diagPlace(f.file, f.line, 0, f.exactFile, f.exactLine)} ${f.message}`)
      .join("\n")
  }
  return "ok"
}

/** The readers extract uses, which the test expects to register. */
const extractTestReaders = (t: Suite): SourceReaders | null => {
  const r = extractReaders()
  if (r.isErr()) {
    t.fail("the readers register", r.error)
    return null
  }
  t.ok(
    "the readers read .xml",
    r.value.entries.some((e): boolean => e.ext === ".xml"),
  )
  return r.value
}

/** Where a contract goes by default: contracts/ beside the spec's directory. */
const extractTestDefaultPath = (t: Suite): void => {
  t.eqStr("specs/x.xml", extractDefaultContractPath("specs/example-hex.xml"), "specs/../contracts/example-hex.json")
  t.eqStr("a bare name", extractDefaultContractPath("example-hex.xml"), "./../contracts/example-hex.json")
}

/** The committed fixtures extract to their committed contracts, byte for byte. */
const extractTestFixtures = (t: Suite, readers: SourceReaders): void => {
  for (const name of ["mini-frame", "mini-frame-txt", "mini-frame-excluded"]) {
    const contract = `${EXTRACT_TEST_MAIN}/contracts/${name}.json`
    const o = extractContract(`${EXTRACT_TEST_MAIN}/specs/${name}.xml`, contract, ".", readers)
    t.eqStr(`${name} extracts`, extractTestOutcome(o), "ok")
    t.ok(`${name} is its committed contract`, o.text === (readFileSyncOrNull(contract) ?? "<none>"))
  }
}

/** Refusals at the markdown line when the `.md` is beside the spec; errors for what cannot be read. */
const extractTestRefusals = (t: Suite, readers: SourceReaders): void => {
  const k = extractContract("tests/fixtures/xmlv3/kramdown.xml", "x.json", ".", readers)
  t.ok("a refused spec has no text", k.text === "" && k.errors.length === 0)
  t.contains(
    "a refusal at the markdown line",
    extractTestOutcome(k),
    "tests/fixtures/xmlv3/kramdown.md:17 (tests/fixtures/xmlv3/kramdown.xml:57) a <texttable> is v2 XML; write a v3 <table> (xml2rfc --v2v3 converts one)",
  )
  t.eqStr(
    "a spec that is not there",
    extractTestOutcome(extractContract("tests/fixtures/nope.xml", "x.json", ".", readers)),
    "error cannot read tests/fixtures/nope.xml",
  )
  t.eqStr(
    "a contract whose directory is not there",
    extractTestOutcome(
      extractContract(
        `${EXTRACT_TEST_MAIN}/specs/mini-frame.xml`,
        `${EXTRACT_TEST_MAIN}/nope/mini-frame.json`,
        EXTRACT_TEST_MAIN,
        readers,
      ),
    ),
    `error ${EXTRACT_TEST_MAIN}/nope: no such directory, to write ${EXTRACT_TEST_MAIN}/nope/mini-frame.json in`,
  )
}

/** A spec in a tree of its own: its RFC found under the root, a sidecar, and XML refusals. */
const extractTestTree = (t: Suite, readers: SourceReaders): void => {
  const made = makeTempDir("vector-extract-")
  if (made.isErr()) {
    t.fail("a temp dir", made.error)
    return
  }
  const tmp = made.value
  mkdirAll(joinPath(tmp, "specs"), 0o755).expect("specs/")
  mkdirAll(joinPath(tmp, "contracts"), 0o755).expect("contracts/")
  const spec = joinPath(tmp, "specs/mini-frame.xml")
  const out = extractDefaultContractPath(spec)
  writeFileSync(spec, readFileSyncOrNull(`${EXTRACT_TEST_MAIN}/specs/mini-frame.xml`) ?? "")

  t.eqStr(
    "an RFC that is nowhere",
    extractTestOutcome(extractContract(spec, out, tmp, readers)),
    "error rfc9990 not found; fetch it: curl -sSfL -o rfcs/rfc9990.txt https://www.rfc-editor.org/rfc/rfc9990.txt",
  )
  mkdirAll(joinPath(tmp, "rfcs"), 0o755).expect("rfcs/")
  const rfc = joinPath(tmp, "rfcs/rfc9990.xml")
  writeFileSync(rfc, readFileSyncOrNull(`${EXTRACT_TEST_MAIN}/rfcs/rfc9990.xml`) ?? "")
  const got = extractContract(spec, out, tmp, readers)
  t.eqStr("the RFC under the root", extractTestOutcome(got), "ok")
  t.ok("a contract is written", got.text.startsWith("{") && got.text.endsWith("}\n"))

  writeFileSync(joinPath(tmp, "contracts/mini-frame.survivors.json"), "{")
  t.contains(
    "a sidecar that is not JSON",
    extractTestOutcome(extractContract(spec, out, tmp, readers)),
    "mini-frame.survivors.json: invalid JSON",
  )
  writeFileSync(rfc, "<doc/>")
  t.contains(
    "an RFC that is not RFC XML",
    extractTestOutcome(extractContract(spec, out, tmp, readers)),
    "error source rfc9990: rfcs/rfc9990.xml:1: not RFC XML",
  )
  writeFileSync(spec, "<rfc>\n<a></rfc>")
  t.eqStr(
    "malformed XML, at its line",
    extractTestOutcome(extractContract(spec, out, tmp, readers)),
    `${spec}:2 malformed XML: </rfc> closes <a>, opened at ${spec}:2`,
  )
  const md = joinPath(tmp, "specs/mini-frame.md")
  writeFileSync(md, extractTestLines(10))
  writeFileSync(spec, "<rfc>\n<?line 5?>\n<a>\n</rfc>")
  t.eqStr(
    "with its markdown beside it, both places in the markdown's numbering",
    extractTestOutcome(extractContract(spec, out, tmp, readers)),
    `${md}:5 (${spec}:4) malformed XML: </rfc> closes <a>, opened at ${md}:5 (${spec}:3)`,
  )
}

/** `l1`..`ln`, a line each. */
const extractTestLines = (n: i32): string => {
  const out: string[] = []
  for (let i = 1; i <= n; i++) {
    out.push(`l${i}\n`)
  }
  return out.join("")
}

/** The hunk headers of a diff. */
const extractTestHunks = (diff: string): string =>
  split(diff, "\n")
    .filter((l: string): boolean => l.startsWith("@@"))
    .join(" ")

/** A unified diff: "" when equal, else hunks with three lines of context, as diff -u writes them. */
const extractTestDiff = (t: Suite): void => {
  t.eqStr("equal texts", extractUnifiedDiff("a\n", "a\n", "x", "y"), "")
  t.eqStr("from nothing", extractUnifiedDiff("", "a\nb\n", "x", "y"), "--- x\n+++ y\n@@ -0,0 +1,2 @@\n+a\n+b\n")
  t.eqStr("to nothing", extractUnifiedDiff("a\n", "", "x", "y"), "--- x\n+++ y\n@@ -1,1 +0,0 @@\n-a\n")
  const ten = extractTestLines(10)
  t.eqStr(
    "one change, three lines of context either side",
    extractUnifiedDiff(ten, replaceAll(ten, "l5\n", "five\n"), "x", "y"),
    "--- x\n+++ y\n@@ -2,7 +2,7 @@\n l2\n l3\n l4\n-l5\n+five\n l6\n l7\n l8\n",
  )
  const twenty = extractTestLines(20)
  const near = replaceAll(replaceAll(twenty, "l3\n", "c\n"), "l10\n", "d\n")
  t.eqStr(
    "changes six lines apart share a hunk",
    extractTestHunks(extractUnifiedDiff(twenty, near, "x", "y")),
    "@@ -1,13 +1,13 @@",
  )
  const far = replaceAll(replaceAll(twenty, "l3\n", "c\n"), "l11\n", "d\n")
  t.eqStr(
    "changes seven lines apart do not",
    extractTestHunks(extractUnifiedDiff(twenty, far, "x", "y")),
    "@@ -1,6 +1,6 @@ @@ -8,7 +8,7 @@",
  )
  t.eqStr(
    "a missing last newline is a change",
    extractUnifiedDiff("a\nb", "a\nb\n", "x", "y"),
    "--- x\n+++ y\n@@ -1,2 +1,2 @@\n a\n-b\n\\ No newline at end of file\n+b\n",
  )
  t.eqStr(
    "an added last line with no newline",
    extractUnifiedDiff("a\n", "a\nb", "x", "y"),
    "--- x\n+++ y\n@@ -1,1 +1,2 @@\n a\n+b\n\\ No newline at end of file\n",
  )
}

/** Extract: the committed contracts, refusals at markdown lines, and the diff `--check` prints. */
export const main = (): i32 => {
  const t = new Suite("spec/extract extract")
  extractTestDefaultPath(t)
  extractTestDiff(t)
  const readers = extractTestReaders(t)
  if (readers !== null) {
    extractTestFixtures(t, readers)
    extractTestRefusals(t, readers)
    extractTestTree(t, readers)
  }
  return t.done()
}
