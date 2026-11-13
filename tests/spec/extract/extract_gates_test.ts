import { Suite } from "nish/testing"
import { replaceAll } from "nish/text"
import { joinPath, makeTempDir, mkdirAll } from "../../../src/core/fs"
import {
  CheckContext,
  CheckFinding,
  CheckNote,
  CheckReport,
  SampleTable,
  checkAddReader,
  checkContractWith,
  checkGates,
} from "../../../src/spec/check"
import { contractLoad } from "../../../src/spec/contract/contract"
import {
  ExtractOutcome,
  extractContract,
  extractGateRefusals,
  extractReaders,
  extractUnifiedDiff,
} from "../../../src/spec/extract"
import { ProfileLocator } from "../../../src/spec/profile/profile"
import { SourceReaders } from "../../../src/spec/source/load"
import { xmlRead } from "../../../src/spec/xml/doc"

/** A gate's note, and the finding the report carries for it. */
const extractGatesTestIssue = (
  report: CheckReport,
  notes: CheckNote[],
  gate: string,
  at: string,
  message: string,
): void => {
  notes.push(new CheckNote(gate, at, message, false))
  report.findings.push(new CheckFinding(gate, at.length > 0 ? `${at}: ${message}` : message))
}

/** Each refusal once, sorted by line; a main-source section at the line naming it; the sidecar's last. */
const extractGatesTestRows = (t: Suite): void => {
  const locator = new ProfileLocator("s.xml", 1)
  locator.at.set("V1", 7)
  locator.at.set("V2", 9)
  locator.at.set("source.main", 5)
  const report = new CheckReport(new SampleTable())
  const notes: CheckNote[] = []
  const fid = "1-byte value is not printed in §6"
  extractGatesTestIssue(report, notes, "shape", "", 'allowSurvivors[0]: missing "file"')
  extractGatesTestIssue(report, notes, "fidelity", "V2.expect", fid)
  extractGatesTestIssue(report, notes, "fidelity", "V1.call", fid)
  extractGatesTestIssue(report, notes, "fidelity", "V1.expect", fid)
  extractGatesTestIssue(report, notes, "shape", "", "the root")
  // A section of the main source is at the line naming it, and says which.
  extractGatesTestIssue(report, notes, "completeness", "\u00a72", "MUST sentence is neither")
  // Notes the locator cannot place land at the root and keep their `at`, so two stay two.
  extractGatesTestIssue(report, notes, "fidelity", "X9.call", "lost")
  extractGatesTestIssue(report, notes, "fidelity", "X9.expect", "lost")
  // A finding no note placed lands at the root, once.
  report.findings.push(new CheckFinding("typing", "unplaced"))
  // A warning is never a refusal.
  notes.push(new CheckNote("domain", "V1", "only a warning", true))
  const got = extractGateRefusals(report, notes, locator, "c.survivors.json", 4648).map((r): string =>
    r.line > 0 ? `${r.file}:${r.line}: ${r.message}` : `${r.file}: ${r.message}`,
  )
  t.eqStr(
    "each at its line, once; the sidecar's last",
    got.join("\n"),
    [
      "s.xml:1: shape: the root",
      "s.xml:1: fidelity: X9.call: lost",
      "s.xml:1: fidelity: X9.expect: lost",
      "s.xml:1: typing: unplaced",
      "s.xml:5: completeness: Section 2 of RFC4648: MUST sentence is neither",
      `s.xml:7: fidelity: ${fid}`,
      `s.xml:9: fidelity: ${fid}`,
      'c.survivors.json: shape: allowSurvivors[0]: missing "file"',
    ].join("\n"),
  )
}

/** A tree holding extract-mini.xml as given, and RFC 4648. */
const extractGatesTestTree = (t: Suite, xml: string): string | null => {
  const made = makeTempDir("vector-extract-gates-")
  if (made.isErr()) {
    t.fail("a temp dir", made.error)
    return null
  }
  const d = made.value
  for (const sub of ["specs", "contracts", "rfcs"]) {
    mkdirAll(joinPath(d, sub), 0o755).expect(sub)
  }
  writeFileSync(joinPath(d, "rfcs/rfc4648.txt"), readFileSyncOrNull("rfcs/rfc4648.txt") ?? "")
  writeFileSync(joinPath(d, "specs/extract-mini.xml"), xml)
  return d
}

/** The rows of an outcome a gate refused, as `file:line: message`. */
const extractGatesTestOf = (o: ExtractOutcome, gate: string): string[] => {
  const out: string[] = []
  for (const r of o.refusals) {
    if (r.message.startsWith(`${gate}: `)) {
      out.push(`${r.file}:${r.line}: ${r.message}`)
    }
  }
  return out
}

/** Whether an outcome's refusals are sorted by line, each once. */
const extractGatesTestSortedOnce = (o: ExtractOutcome): boolean => {
  const seen = new Set<string>()
  for (let i = 0; i < o.refusals.length; i++) {
    const r = o.refusals[i]
    const key = `${r.file}:${r.line}: ${r.message}`
    if (seen.has(key) || (i > 0 && r.line < o.refusals[i - 1].line)) {
      return false
    }
    seen.add(key)
  }
  return true
}

/**
 * The gates' refusals: all of them, each at its line, once; nothing written.
 * The fixture as given has no fidelity refusal; two expected values changed
 * give exactly two, each naming its value. (Its completeness refusals are the
 * gate's own: it does not split "... a-f. hexEncode MUST NOT ..." before a
 * lowercase word, so they are not pinned here.)
 */
const extractGatesTestMini = (t: Suite, readers: SourceReaders): void => {
  const mini = readFileSyncOrNull("tests/fixtures/extract/extract-mini.xml") ?? ""
  const good = extractGatesTestTree(t, mini)
  if (good !== null) {
    const o = extractContract(
      joinPath(good, "specs/extract-mini.xml"),
      joinPath(good, "contracts/extract-mini.json"),
      good,
      readers,
    )
    t.eqStr("the fixture as given: no error", o.errors.join("; "), "")
    t.eqStr("the fixture as given: no fidelity refusal", extractGatesTestOf(o, "fidelity").join("\n"), "")
  }
  const broken = replaceAll(
    replaceAll(mini, 'hexDecode("666F6F")</tt>', 'hexDecode("666F6E")</tt>'),
    'hexDecode("666F6F626172")</tt>',
    'hexDecode("666F6F626171")</tt>',
  )
  t.ok("the fixture is broken twice", broken !== mini)
  const d = extractGatesTestTree(t, broken)
  if (d === null) {
    return
  }
  const xml = joinPath(d, "specs/extract-mini.xml")
  const out = joinPath(d, "contracts/extract-mini.json")
  const o = extractContract(xml, out, d, readers)
  t.eqStr("no error", o.errors.join("; "), "")
  t.eqStr("no text", o.text, "")
  const rows = extractGatesTestOf(o, "fidelity")
  t.eqI32("two fidelity refusals", rows.length, 2)
  const prefix = `${xml}:`
  t.ok("the first at its line", rows.length === 2 && rows[0].startsWith(prefix) && rows[0].indexOf('"666F6E"') > 0)
  t.ok(
    "the second at its line",
    rows.length === 2 && rows[1].startsWith(prefix) && rows[1].indexOf('"666F6F626171"') > 0,
  )
  t.ok("at two lines past the root", rows.length === 2 && rows[0] !== rows[1] && !rows[0].startsWith(`${prefix}10:`))
  t.ok("every refusal sorted by line, once", extractGatesTestSortedOnce(o))
  t.ok("no contract written", readFileSyncOrNull(out) === null)
}

/**
 * A source the gates cannot read: extract-mini's contract, as extract makes
 * it, checked in a repo that holds the spec but not RFC 4648. The sources gate says nothing citing
 * it can be checked, once, and extract places it at the spec's root, line 1.
 * (Through extract itself the profile reads every source first, from the same
 * places, so a source it cannot read is its error before any gate runs.)
 */
const extractGatesTestSources = (t: Suite, readers: SourceReaders): void => {
  const d = extractGatesTestTree(t, readFileSyncOrNull("tests/fixtures/extract/extract-mini.xml") ?? "")
  const away = makeTempDir("vector-extract-sources-")
  if (d === null) {
    t.fail("the sources gate's tree", "the temporary tree could not be made")
    return
  }
  if (away.isErr()) {
    t.fail("the sources gate's second directory", away.error)
    return
  }
  const xml = joinPath(d, "specs/extract-mini.xml")
  const o = extractContract(xml, joinPath(d, "contracts/extract-mini.json"), d, readers)
  t.eqStr("the fixture extracts", o.errors.join("; "), "")
  for (const sub of ["specs", "contracts"]) {
    mkdirAll(joinPath(away.value, sub), 0o755).expect(sub)
  }
  writeFileSync(joinPath(away.value, "specs/extract-mini.xml"), readFileSyncOrNull(xml) ?? "")
  const lone = joinPath(away.value, "contracts/extract-mini.json")
  const c = contractLoad(o.text, lone)
  if (c.isErr()) {
    t.fail("its contract loads", c.error.join("; "))
    return
  }
  const check = new CheckContext(lone, away.value)
  checkAddReader(check, ".xml", xmlRead).expect("the xml reader")
  const report = checkContractWith(check, c.value, checkGates())
  const sources = report.findings.filter((f: CheckFinding): boolean => f.message.startsWith("sources: "))
  t.eqI32("a source not there is one finding", sources.length, 1)
  t.ok(
    "it says nothing citing it can be checked",
    sources.length === 1 && sources[0].message.endsWith(", so nothing citing it can be checked"),
  )
  const locator = new ProfileLocator(xml, 1)
  locator.at.set("source.main", 5)
  const rows = extractGateRefusals(report, check.notes, locator, `${lone}.survivors.json`, c.value.source.rfc)
    .filter((r): boolean => r.message.indexOf("sources: ") >= 0)
    .map((r): string => `${r.file === xml ? "spec" : r.file}:${r.line}: ${r.message}`)
  t.eqStr(
    "it lands once, at the spec's root",
    rows.join("\n"),
    "spec:1: fidelity: sources: source rfc4648: ../rfcs/rfc4648.txt: no such file, so nothing citing it can be checked",
  )
}

/** `p<i>` for i in 1..n, a line each. */
const extractGatesTestLines = (p: string, n: i32): string => {
  const out: string[] = []
  for (let i = 1; i <= n; i++) {
    out.push(`${p}${i}\n`)
  }
  return out.join("")
}

/** Past the LCS cap, a diff is one hunk: every old line out, every new line in. */
const extractGatesTestDiff = (t: Suite): void => {
  const d = extractUnifiedDiff(extractGatesTestLines("a", 3000), extractGatesTestLines("b", 3000), "x", "y")
  t.ok("one hunk of all of it", d.indexOf("@@ -1,3000 +1,3000 @@") >= 0)
  t.ok("deletions first", d.indexOf("-a3000\n") >= 0 && d.indexOf("-a3000\n") < d.indexOf("+b1\n"))
  t.ok("insertions last", d.endsWith("+b3000\n"))
}

/** The gates' refusals as extract places them, and the diff past its cap. */
export const main = (): i32 => {
  const t = new Suite("spec/extract gates")
  extractGatesTestRows(t)
  extractGatesTestDiff(t)
  const readers = extractReaders()
  if (readers.isErr()) {
    t.fail("the readers register", readers.error)
  } else {
    extractGatesTestMini(t, readers.value)
    extractGatesTestSources(t, readers.value)
  }
  return t.done()
}
