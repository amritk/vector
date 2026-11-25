import { Suite } from "nish/testing"
import { replaceAll, split } from "nish/text"
import { dirname, joinPath, makeTempDir, mkdirAll } from "../../../src/core/fs"
import { sha256Hex } from "../../../src/core/hex"
import { newJsonDocument, parseJson } from "../../../src/core/json"
import { ProcessResult, runProcess } from "../../../src/core/process"
import { CheckContext, checkAddReader, checkContractWith, checkGates, checkPassed } from "../../../src/spec/check"
import { contractFromJson } from "../../../src/spec/contract/read"
import { ExtractOutcome, extractContract, extractReaders, extractUnifiedDiff } from "../../../src/spec/extract"
import { SourceReaderKind, SourceReaders } from "../../../src/spec/source/load"

const EXTRACT_CASES_TEST_MINI: string = "tests/fixtures/extract/extract-mini.xml"
const EXTRACT_CASES_TEST_MAIN: string = "tests/fixtures/rfc-main"
const EXTRACT_CASES_TEST_MINI_MD: string = "tests/fixtures/extract/extract-mini.md"

/** specs/<name>.xml, contracts/ and (optionally) rfcs/rfc4648.txt, as vector lays them out. */
class ExtractCasesTestTree {
  dir: string
  xml: string
  out: string
  side: string
  /**
   * A tree's paths.
   *
   * @param dir its root
   * @param name the spec's name
   */
  constructor(dir: string, name: string) {
    this.dir = dir
    this.xml = joinPath(dir, `specs/${name}.xml`)
    this.out = joinPath(dir, `contracts/${name}.json`)
    this.side = joinPath(dir, `contracts/${name}.survivors.json`)
  }
}

/** The CLI, the fixture, and the readers every case uses. */
class ExtractCasesTestCtx {
  t: Suite
  vector: string
  mini: string
  readers: SourceReaders
  /**
   * The context.
   *
   * @param t the suite
   * @param vector the built binary's absolute path
   * @param mini the fixture extract-mini.xml
   * @param readers the readers extract uses
   */
  constructor(t: Suite, vector: string, mini: string, readers: SourceReaders) {
    this.t = t
    this.vector = vector
    this.mini = mini
    this.readers = readers
  }
}

/**
 * extract-mini.xml with its two binding sentences that begin a paragraph with
 * a lowercase identifier reworded, so main's completeness gate (which does not
 * split a sentence before a lowercase word) finds every one accounted for.
 */
const extractCasesTestClean = (xml: string): string =>
  replaceAll(
    replaceAll(xml, '<t anchor="R-ENC-ONLY">hexEncode', '<t anchor="R-ENC-ONLY">The encoder'),
    "<t>hexDecode <bcp14>MUST NOT",
    "<t>The decoder <bcp14>MUST NOT",
  )

/** A fresh tree holding `xml` as specs/<name>.xml; rfcs/rfc4648.txt when `rfcs`. Null after failing the test. */
const extractCasesTestTree = (
  x: ExtractCasesTestCtx,
  xml: string,
  name: string,
  rfcs: boolean,
): ExtractCasesTestTree | null => {
  const made = makeTempDir("vector-extract-cases-")
  if (made.isErr()) {
    x.t.fail("a temp dir", made.error)
    return null
  }
  const d = made.value
  mkdirAll(joinPath(d, "specs"), 0o755).expect("specs/")
  mkdirAll(joinPath(d, "contracts"), 0o755).expect("contracts/")
  if (rfcs) {
    mkdirAll(joinPath(d, "rfcs"), 0o755).expect("rfcs/")
    writeFileSync(joinPath(d, "rfcs/rfc4648.txt"), readFileSyncOrNull("rfcs/rfc4648.txt") ?? "")
  }
  const tr = new ExtractCasesTestTree(d, name)
  writeFileSync(tr.xml, xml)
  return tr
}

/** Runs `vector spec <args>`; a result with status -1 after failing the test when it cannot run. */
const extractCasesTestCli = (x: ExtractCasesTestCtx, args: string[]): ProcessResult =>
  extractCasesTestRun(x, [x.vector, "spec"], args)

/** Runs `<pre> <args>`; a result with status -1 after failing the test when it cannot run. */
const extractCasesTestRun = (x: ExtractCasesTestCtx, pre: string[], args: string[]): ProcessResult => {
  const argv: string[] = []
  for (const a of pre) {
    argv.push(a)
  }
  for (const a of args) {
    argv.push(a)
  }
  const r = runProcess(argv, "", 60000)
  if (r.isErr()) {
    x.t.fail(`vector spec ${args.join(" ")}`, r.error)
    return new ProcessResult(-1, "", "", false)
  }
  return r.value
}

/** A run as `exit N`, then its stderr's lines. */
const extractCasesTestErr = (r: ProcessResult): string[] => {
  const out = [`exit ${r.status}`]
  for (const l of split(r.stderr, "\n")) {
    if (l.length > 0) {
      out.push(l)
    }
  }
  return out
}

/** An outcome as text: `ok`, each refusal as `file:line: message`, or `error <why>`. */
const extractCasesTestOutcome = (o: ExtractOutcome): string[] => {
  if (o.errors.length > 0) {
    return o.errors.map((e: string): string => `error ${e}`)
  }
  if (o.refusals.length > 0) {
    return o.refusals.map((f): string => `${f.file}:${f.line}: ${f.message}`)
  }
  return ["ok"]
}

/** `l1`..`ln`, a line each. */
const extractCasesTestLines = (n: i32): string => {
  const out: string[] = []
  for (let i = 1; i <= n; i++) {
    out.push(`l${i}\n`)
  }
  return out.join("")
}

/** The diff's cases that extract_test.ts leaves out. */
const extractCasesTestDiff = (t: Suite): void => {
  const a = extractCasesTestLines(2000)
  t.eqStr(
    "a long shared start and end are context, not part of the match",
    extractUnifiedDiff(a, replaceAll(a, "\nl1000\n", "\nmid\n"), "x", "y"),
    "--- x\n+++ y\n@@ -997,7 +997,7 @@\n l997\n l998\n l999\n-l1000\n+mid\n l1001\n l1002\n l1003\n",
  )
  const four = extractCasesTestLines(4)
  t.eqStr(
    "an insertion and a deletion count their sides",
    extractUnifiedDiff(four, replaceAll(replaceAll(four, "l2\n", "l2\nnew\n"), "l4\n", ""), "x", "y"),
    "--- x\n+++ y\n@@ -1,4 +1,4 @@\n l1\n l2\n+new\n l3\n-l4\n",
  )
}

/** The value of `"key": ` in a contract's text, up to the end of its line; "" when absent. */
const extractCasesTestField = (text: string, key: string): string => {
  const tag = `"${key}": `
  const at = text.indexOf(tag)
  if (at < 0) {
    return ""
  }
  const from = at + tag.length
  const end = text.indexOf("\n", from)
  return text.substring(from, end < 0 ? text.length : end)
}

/** The top-level keys of a contract's text, in order: each line indented by two spaces exactly. */
const extractCasesTestKeys = (text: string): string => {
  const out: string[] = []
  for (const l of split(text, "\n")) {
    if (l.startsWith('  "')) {
      out.push(l.substring(3, l.indexOf('"', 3)))
    }
  }
  return out.join(" ")
}

/** The text of the `n`th (from 0) object in the sources list. */
const extractCasesTestSource = (text: string, n: i32): string => {
  const list = text.indexOf('"sources": [')
  if (list < 0) {
    return ""
  }
  let at = list
  for (let i = 0; i <= n; i++) {
    at = text.indexOf("    {\n", at + 1)
    if (at < 0) {
      return ""
    }
  }
  const end = text.indexOf("    }", at)
  return text.substring(at, end < 0 ? text.length : end)
}

/** The keys of a source object's text, in order. */
const extractCasesTestSourceKeys = (src: string): string => {
  const out: string[] = []
  for (const l of split(src, "\n")) {
    if (l.startsWith('      "')) {
      out.push(l.substring(7, l.indexOf('"', 7)))
    }
  }
  return out.join(" ")
}

/** The gates' findings on the contract at `path`, its XML sources read as extract reads them; "pass" when none. */
const extractCasesTestChecked = (path: string, root: string): string => {
  const doc = newJsonDocument()
  const parsed = parseJson(doc, readFileSyncOrNull(path) ?? "", path)
  if (parsed.isErr()) {
    return parsed.error
  }
  const c = contractFromJson(doc, parsed.value)
  if (c.isErr()) {
    return c.error.join("\n")
  }
  const ctx = new CheckContext(path, root)
  const added = checkAddReader(ctx, ".xml", SourceReaderKind.Xml)
  if (added.isErr()) {
    return added.error
  }
  const report = checkContractWith(ctx, c.value, checkGates())
  if (checkPassed(report) && ctx.toolFailure === null) {
    return "pass"
  }
  return report.findings.map((f): string => `${f.gate}: ${f.message}`).join("\n") + (ctx.toolFailure ?? "")
}

/** No -o writes the contract to stdout, the same bytes each run, with its keys and sources. */
const extractCasesTestStdout = (x: ExtractCasesTestCtx): void => {
  const t = x.t
  const tr = extractCasesTestTree(x, extractCasesTestClean(x.mini), "extract-mini", true)
  if (tr === null) {
    return
  }
  const a = extractCasesTestCli(x, ["extract", tr.xml])
  const b = extractCasesTestCli(x, ["extract", tr.xml])
  const name = "no -o writes the contract to stdout, byte-identical across runs"
  t.eqLines(`${name}: exit 0, nothing on stderr`, extractCasesTestErr(a), ["exit 0"])
  t.ok(`${name}: byte-identical`, a.stdout.length > 0 && a.stdout === b.stdout)
  t.eqStr(
    `${name}: keys`,
    extractCasesTestKeys(a.stdout),
    "$schema contract source sources target requirements exclusions functions clauses",
  )
  // In a temp tree `$schema` climbs out to vector's own schemas/; it names exactly that file.
  // (Each committed contract pins it as "../schemas/rfc-contract.json", byte for byte.)
  const schema = extractCasesTestField(a.stdout, "$schema")
  t.ok(`${name}: $schema is a quoted relative path`, schema.startsWith('"../') && schema.endsWith('",'))
  t.eqStr(
    `${name}: $schema names vector's schemas/rfc-contract.json`,
    realpathSync(joinPath(dirname(tr.out), schema.substring(1, schema.length - 2))) ?? "<none>",
    realpathSync("schemas/rfc-contract.json") ?? "<missing>",
  )
  t.eqStr(
    `${name}: source title`,
    extractCasesTestField(a.stdout, "title"),
    '"Extract fixture: nish/hex without a byte-list vector",',
  )
  t.eqStr(`${name}: source main`, extractCasesTestField(a.stdout, "main"), '"extract-mini",')
  t.eqStr(
    `${name}: source sha256`,
    extractCasesTestField(a.stdout, "sha256"),
    `"${sha256Hex(readFileSyncOrNull(tr.xml) ?? "")}"`,
  )
  const rfc = extractCasesTestSource(a.stdout, 1)
  t.eqStr(`${name}: rfc source`, extractCasesTestSourceKeys(rfc), "id rfc path file sha256")
  t.contains(`${name}: rfc id`, rfc, '"id": "rfc4648"')
  t.contains(`${name}: rfc file`, rfc, '"file": "rfcs/rfc4648.txt"')
}

/** -o writes the file, its paths from where it is written, and the written contract checks. */
const extractCasesTestOut = (x: ExtractCasesTestCtx): void => {
  const t = x.t
  const tr = extractCasesTestTree(x, extractCasesTestClean(x.mini), "extract-mini", true)
  if (tr === null) {
    return
  }
  const name = "-o writes the file; an RFC in the rfcs/ beside contracts/ gets a path"
  const r = extractCasesTestCli(x, ["extract", tr.xml, "-o", tr.out])
  t.eqLines(`${name}: exit 0`, extractCasesTestErr(r), ["exit 0"])
  const c = readFileSyncOrNull(tr.out) ?? ""
  t.eqStr(`${name}: rfc keys`, extractCasesTestSourceKeys(extractCasesTestSource(c, 1)), "id rfc path file sha256")
  t.contains(`${name}: rfc path`, extractCasesTestSource(c, 1), '"path": "../rfcs/rfc4648.txt"')
  t.contains(`${name}: spec path`, extractCasesTestSource(c, 0), '"path": "../specs/extract-mini.xml"')
  t.eqStr(`${name}: the written contract passes the gates`, extractCasesTestChecked(tr.out, tr.dir), "pass")

  const deep = joinPath(tr.dir, "deep/dir/c.json")
  mkdirAll(joinPath(tr.dir, "deep/dir"), 0o755).expect("deep/dir")
  const dn = "the spec's path is from where -o writes the contract"
  t.eqLines(`${dn}: exit 0`, extractCasesTestErr(extractCasesTestCli(x, ["extract", tr.xml, "-o", deep])), ["exit 0"])
  t.contains(
    `${dn}: spec path`,
    extractCasesTestSource(readFileSyncOrNull(deep) ?? "", 0),
    '"path": "../../specs/extract-mini.xml"',
  )
}

/** --check: 0 when up to date, else 1 with a unified diff, and it writes nothing. */
const extractCasesTestCheck = (x: ExtractCasesTestCtx): void => {
  const t = x.t
  const tr = extractCasesTestTree(x, extractCasesTestClean(x.mini), "extract-mini", true)
  if (tr === null) {
    return
  }
  const name = "--check: 0 when up to date, else 1 with a unified diff"
  let r = extractCasesTestCli(x, ["extract", tr.xml, "-o", tr.out, "--check"])
  t.eqLines(`${name}: no contract yet`, extractCasesTestErr(r), [
    "exit 1",
    `vector: ${tr.out}: is not what ${tr.xml} states; run: vector spec extract ${tr.xml} -o ${tr.out}`,
  ])
  t.ok(
    `${name}: a diff from nothing`,
    r.stdout.startsWith(`--- ${tr.out}\n+++ ${tr.out} (extracted from ${tr.xml})\n@@ -0,0 +1,`),
  )
  t.ok(`${name}: writes nothing`, readFileSyncOrNull(tr.out) === null)

  t.eqLines(`${name}: extract`, extractCasesTestErr(extractCasesTestCli(x, ["extract", tr.xml, "-o", tr.out])), [
    "exit 0",
  ])
  const written = readFileSyncOrNull(tr.out) ?? ""
  r = extractCasesTestCli(x, ["extract", tr.xml, "-o", tr.out, "--check"])
  t.eqLines(`${name}: up to date`, extractCasesTestErr(r), ["exit 0"])
  t.eqStr(`${name}: up to date prints nothing`, r.stdout, "")

  writeFileSync(tr.out, replaceAll(written, '"nish/hex"', '"nish/hex2"'))
  r = extractCasesTestCli(x, ["extract", tr.xml, "-o", tr.out, "--check"])
  t.eqStr(`${name}: stale`, extractCasesTestErr(r)[0], "exit 1")
  t.contains(`${name}: the diff`, r.stdout, '-    "module": "nish/hex2"\n+    "module": "nish/hex"')
  t.contains(`${name}: --check writes nothing`, readFileSyncOrNull(tr.out) ?? "", "nish/hex2")
}

/** The sidecar's allowSurvivors are merged verbatim, last; one that cannot be read is an error. */
const extractCasesTestSidecar = (x: ExtractCasesTestCtx): void => {
  const t = x.t
  const tr = extractCasesTestTree(x, extractCasesTestClean(x.mini), "extract-mini", true)
  if (tr === null) {
    return
  }
  const two =
    '{"allowSurvivors": [{"file": "std/hex.ts", "line": 31, "reason": "one"}, {"file": "std/hex.ts", "line": 38, "reason": "two"}]}'
  writeFileSync(tr.side, two)
  const name = "the sidecar's allowSurvivors are merged verbatim, last"
  const r = extractCasesTestCli(x, ["extract", tr.xml, "-o", tr.out])
  t.eqLines(`${name}: exit 0`, extractCasesTestErr(r), ["exit 0"])
  const c = readFileSyncOrNull(tr.out) ?? ""
  const keys = split(extractCasesTestKeys(c), " ")
  t.eqStr(`${name}: last`, keys[keys.length - 1], "allowSurvivors")
  t.eqStr(
    `${name}: verbatim, in order`,
    c.substring(c.indexOf('  "allowSurvivors": ')),
    [
      '  "allowSurvivors": [',
      "    {",
      '      "file": "std/hex.ts",',
      '      "line": 31,',
      '      "reason": "one"',
      "    },",
      "    {",
      '      "file": "std/hex.ts",',
      '      "line": 38,',
      '      "reason": "two"',
      "    }",
      "  ]",
      "}",
      "",
    ].join("\n"),
  )

  writeFileSync(tr.side, '{"allowSurvivors":[{"line":3}]}')
  t.eqLines(
    "a sidecar entry the schema refuses is a refusal that names the sidecar",
    extractCasesTestErr(extractCasesTestCli(x, ["extract", tr.xml, "-o", tr.out])),
    [
      "exit 1",
      `vector: ${tr.side}: shape: allowSurvivors[0].file: a non-empty string`,
      `vector: ${tr.side}: shape: allowSurvivors[0].reason: a non-empty string`,
    ],
  )
  const bad = "a sidecar that is not JSON, or holds no list, is an error"
  writeFileSync(tr.side, "{")
  const brace = extractCasesTestErr(extractCasesTestCli(x, ["extract", tr.xml, "-o", tr.out]))
  t.eqStr(`${bad}: not JSON`, brace[0], "exit 2")
  t.contains(
    `${bad}: not JSON, named`,
    brace.length > 1 ? brace[1] : "",
    `vector: spec extract: ${tr.side}: invalid JSON`,
  )
  writeFileSync(tr.side, "null")
  t.eqLines(`${bad}: null`, extractCasesTestErr(extractCasesTestCli(x, ["extract", tr.xml, "-o", tr.out])), [
    "exit 2",
    `vector: spec extract: ${tr.side}: expected {"allowSurvivors": [...]}`,
  ])
}

/** An RFC found nowhere, one that is not a file, and one that is not RFC XML: errors, exit 2. */
const extractCasesTestRfcs = (x: ExtractCasesTestCtx): void => {
  const t = x.t
  const gone = replaceAll(extractCasesTestClean(x.mini), "4648", "9871")
  const a = extractCasesTestTree(x, gone, "extract-mini", false)
  if (a !== null) {
    const r = extractCasesTestCli(x, ["extract", a.xml])
    const name = "an RFC found nowhere: exit 2, with the command that fetches it"
    t.eqLines(name, extractCasesTestErr(r), [
      "exit 2",
      "vector: spec extract: rfc9871 not found; fetch it: curl -sSfL -o rfcs/rfc9871.txt https://www.rfc-editor.org/rfc/rfc9871.txt",
    ])
    t.eqStr(`${name}: nothing on stdout`, r.stdout, "")
  }
  const b = extractCasesTestTree(x, extractCasesTestClean(x.mini), "extract-mini", false)
  if (b !== null) {
    const dir = joinPath(b.dir, "rfcs/rfc4648.txt")
    const shown = joinPath(b.dir, "contracts/../rfcs/rfc4648.txt")
    mkdirAll(dir, 0o755).expect("rfcs/rfc4648.txt/")
    t.eqLines(
      "an RFC that cannot be read is an error, not a missing RFC",
      extractCasesTestErr(extractCasesTestCli(x, ["extract", b.xml, "-o", b.out])),
      ["exit 2", `vector: spec extract: source rfc4648: ${shown}: a directory, not a file`],
    )
  }
  const c = extractCasesTestTree(x, gone, "extract-mini", false)
  if (c !== null) {
    mkdirAll(joinPath(c.dir, "rfcs"), 0o755).expect("rfcs/")
    const rfc = joinPath(c.dir, "rfcs/rfc9871.xml")
    writeFileSync(rfc, '<?xml version="1.0"?>\n<foo/>\n')
    t.eqLines(
      "a cited RFC's malformed XML is an error naming its file, not a refusal",
      extractCasesTestErr(extractCasesTestCli(x, ["extract", c.xml])),
      [
        "exit 2",
        "vector: spec extract: source rfc9871: rfcs/rfc9871.xml:2: not RFC XML: the root element is <foo>, not <rfc>",
      ],
    )
  }
}

/** The profile's and the XML reader's refusals: exit 1, each file:line, nothing on stdout. */
const extractCasesTestRefused = (x: ExtractCasesTestCtx): void => {
  const t = x.t
  const o = extractCasesTestTree(x, x.mini, "other", true)
  if (o !== null) {
    const r = extractCasesTestCli(x, ["extract", o.xml])
    t.eqLines("the profile's refusals: exit 1, each file:line", extractCasesTestErr(r), [
      "exit 1",
      `vector: ${o.xml}:10: docName "draft-extract-mini-00" names contract "extract-mini", but the file is other.xml`,
    ])
    t.eqStr("the profile's refusals: nothing on stdout", r.stdout, "")
  }
  const name = "the XML reader's refusal, at the XML line when no markdown is beside it"
  for (const xml of ['<?xml version="1.0"?>\n<?line 10?>\n<foo/>\n', '<?xml version="1.0"?>\n\n<foo/>\n']) {
    const b = extractCasesTestTree(x, xml, "bad", true)
    if (b !== null) {
      t.eqLines(name, extractCasesTestErr(extractCasesTestCli(x, ["extract", b.xml])), [
        "exit 1",
        `vector: ${b.xml}:3: not RFC XML: the root element is <foo>, not <rfc>`,
      ])
    }
  }
}

/** A binding RFC sentence the spec neither requires nor excludes is refused, at the line naming the RFC. */
const extractCasesTestMissing = (x: ExtractCasesTestCtx): void => {
  const cases = [
    ["mini-frame-missing", "9990"],
    ["mini-frame-txt-missing", "9991"],
  ]
  for (const pair of cases) {
    const name = pair[0]
    const rfc = pair[1]
    const spec = `${EXTRACT_CASES_TEST_MAIN}/specs/${name}.xml`
    x.t.eqLines(
      `a binding RFC sentence neither required nor excluded is refused: ${name}`,
      extractCasesTestOutcome(
        extractContract(spec, `${EXTRACT_CASES_TEST_MAIN}/contracts/${name}.json`, ".", x.readers),
      ),
      [
        `${spec}:5: completeness: Section 2 of RFC${rfc}: MUST NOT sentence is neither a requirement nor an exclusion: "A sender MUST NOT frame more than 255 octets."`,
      ],
    )
  }
}

/** An RFC as the main source, v3 XML or .txt: extract equals the committed contract, which passes the gates. */
const extractCasesTestMain = (x: ExtractCasesTestCtx): void => {
  for (const name of ["mini-frame", "mini-frame-txt", "mini-frame-excluded"]) {
    const spec = `${EXTRACT_CASES_TEST_MAIN}/specs/${name}.xml`
    const out = `${EXTRACT_CASES_TEST_MAIN}/contracts/${name}.json`
    const o = extractContract(spec, out, ".", x.readers)
    x.t.eqLines(`${name}: extracts`, extractCasesTestOutcome(o), ["ok"])
    x.t.ok(`${name}: extract equals the committed contract`, o.text === (readFileSyncOrNull(out) ?? "<none>"))
    x.t.eqStr(`${name}: passes the gates as committed`, extractCasesTestChecked(out, "."), "pass")
  }
}

/** extract-mini.xml with `hexDecode("666F6F")`'s expected value broken; `and` the second's too. */
const extractCasesTestBroken = (xml: string, and: boolean): string => {
  const one = replaceAll(xml, 'hexDecode("666F6F")</tt>', 'hexDecode("666F6E")</tt>')
  return and ? replaceAll(one, 'hexDecode("666F6F626172")</tt>', 'hexDecode("666F6F626171")</tt>') : one
}

/** A gate refusal is at the markdown's line when the .md is beside the XML, else at the XML's. */
const extractCasesTestGate = (x: ExtractCasesTestCtx): void => {
  const t = x.t
  const fid = 'fidelity: the string "666F6E" is not printed in rfc4648 \u00a710 ("Test Vectors")'
  const md = readFileSyncOrNull(EXTRACT_CASES_TEST_MINI_MD) ?? ""
  for (const beside of [true, false]) {
    const tr = extractCasesTestTree(
      x,
      extractCasesTestBroken(extractCasesTestClean(x.mini), false),
      "extract-mini",
      true,
    )
    if (tr === null) {
      return
    }
    const mdPath = joinPath(tr.dir, "specs/extract-mini.md")
    if (beside) {
      writeFileSync(mdPath, md)
    }
    const name = beside ? "a gate refusal, at the markdown's line" : "a gate refusal, at the XML's line"
    const r = extractCasesTestCli(x, ["extract", tr.xml, "-o", tr.out])
    t.eqLines(name, extractCasesTestErr(r), [
      "exit 1",
      beside ? `vector: ${mdPath}:162 (${tr.xml}:189): ${fid}` : `vector: ${tr.xml}:189: ${fid}`,
    ])
    t.eqStr(`${name}: nothing on stdout`, r.stdout, "")
    t.ok(`${name}: no contract written`, readFileSyncOrNull(tr.out) === null)
  }
  const tr = extractCasesTestTree(x, extractCasesTestBroken(extractCasesTestClean(x.mini), true), "extract-mini", true)
  if (tr === null) {
    return
  }
  const name = "the gates' refusals: exit 1, all of them, each at its line, once"
  const r = extractCasesTestCli(x, ["extract", tr.xml, "-o", tr.out])
  t.eqLines(name, extractCasesTestErr(r), [
    "exit 1",
    `vector: ${tr.xml}:189: ${fid}`,
    `vector: ${tr.xml}:200: fidelity: the string "666F6F626171" is not printed in rfc4648 \u00a710 ("Test Vectors")`,
  ])
  t.ok(`${name}: no contract written`, readFileSyncOrNull(tr.out) === null)
}

/** A solver that cannot run is a tool failure: exit 2 with its message, no refusal, nothing written and no diff. */
const extractCasesTestZ3 = (x: ExtractCasesTestCtx): void => {
  const r = extractCasesTestRun(
    x,
    ["/usr/bin/env", "VECTOR_Z3=/nonexistent", x.vector, "spec"],
    ["extract", "specs/example-hex.xml"],
  )
  x.t.eqLines("a solver that cannot run: exit 2, no refusal", extractCasesTestErr(r), [
    "exit 2",
    "vector: spec extract: VECTOR_Z3 is /nonexistent, which is not a file",
  ])
  x.t.eqStr("a solver that cannot run: nothing on stdout", r.stdout, "")
  const made = makeTempDir("vector-extract-z3-")
  if (made.isErr()) {
    x.t.fail("a temp dir", made.error)
    return
  }
  const out = joinPath(made.value, "example-hex.json")
  const o = extractCasesTestRun(
    x,
    ["/usr/bin/env", "VECTOR_Z3=/nonexistent", x.vector, "spec"],
    ["extract", "specs/example-hex.xml", "-o", out],
  )
  x.t.eqLines("a solver that cannot run, with -o: exit 2", extractCasesTestErr(o), [
    "exit 2",
    "vector: spec extract: VECTOR_Z3 is /nonexistent, which is not a file",
  ])
  x.t.ok("a solver that cannot run, with -o: nothing written", readFileSyncOrNull(out) === null)
  const c = extractCasesTestRun(
    x,
    ["/usr/bin/env", "VECTOR_Z3=/nonexistent", x.vector, "spec"],
    ["extract", "specs/example-hex.xml", "-o", "contracts/example-hex.json", "--check"],
  )
  x.t.eqLines("a solver that cannot run, with --check: exit 2", extractCasesTestErr(c), [
    "exit 2",
    "vector: spec extract: VECTOR_Z3 is /nonexistent, which is not a file",
  ])
  x.t.eqStr("a solver that cannot run, with --check: no diff", c.stdout, "")
}

/** Each committed contract is what its spec states, and two extracts are the same bytes. */
const extractCasesTestCommitted = (x: ExtractCasesTestCtx): void => {
  const t = x.t
  for (const stem of ["example-hex", "rfc5869-hkdf-sha256", "rfc8439-chacha20-poly1305"]) {
    const spec = `specs/${stem}.xml`
    const out = `contracts/${stem}.json`
    t.eqLines(
      `${out} is what ${spec} states`,
      extractCasesTestErr(extractCasesTestCli(x, ["extract", spec, "-o", out, "--check"])),
      ["exit 0"],
    )
    const a = extractCasesTestCli(x, ["extract", spec])
    const b = extractCasesTestCli(x, ["extract", spec])
    const name = `two extracts of ${spec} are byte-identical, and the committed file`
    t.eqLines(`${name}: exit 0`, extractCasesTestErr(a), ["exit 0"])
    t.ok(`${name}: byte-identical`, a.stdout === b.stdout)
    t.ok(`${name}: the committed file`, a.stdout === (readFileSyncOrNull(out) ?? "<none>"))
  }
}

/** `vector spec extract`, run as a user runs it: stdout, -o, --check, the sidecar, and each refusal. */
export const main = (): i32 => {
  const t = new Suite("spec/extract cases")
  extractCasesTestDiff(t)
  const vector = realpathSync("dist/vector")
  const mini = readFileSyncOrNull(EXTRACT_CASES_TEST_MINI)
  const readers = extractReaders()
  if (vector === null || mini === null || readers.isErr()) {
    t.fail("dist/vector, the fixture and the readers", "run npm run build first")
    return t.done()
  }
  const x = new ExtractCasesTestCtx(t, vector, mini, readers.value)
  extractCasesTestStdout(x)
  extractCasesTestOut(x)
  extractCasesTestCheck(x)
  extractCasesTestSidecar(x)
  extractCasesTestRfcs(x)
  extractCasesTestRefused(x)
  extractCasesTestMissing(x)
  extractCasesTestMain(x)
  extractCasesTestGate(x)
  extractCasesTestZ3(x)
  extractCasesTestCommitted(x)
  return t.done()
}
