import { Suite } from "nish/testing"
import { splitLines } from "nish/text"
import {
  CheckContext,
  CheckFinding,
  CheckNote,
  CheckReport,
  CheckSampleStat,
  CheckSourceRun,
  Sample,
  SampleTable,
  checkAddSample,
  checkContract,
} from "../../../src/spec/check"
import { contractLoadFile } from "../../../src/spec/contract/contract"
import { contractParse } from "../../../src/spec/contract/read"
import { Contract, Literal } from "../../../src/spec/contract/types"
import {
  ReportIssue,
  reportCite,
  reportCovered,
  reportCovering,
  reportEvidence,
  reportIssues,
  reportOneLine,
  reportSafe,
  reportSampleCount,
  reportShapeOk,
  reportShort,
  reportSourceRuns,
  reportSourceTitle,
  reportStat,
  reportStatus,
  reportWarnings,
} from "../../../src/spec/report/common"
import { reportJson } from "../../../src/spec/report/json"
import { reportCell, reportCode, reportCodeCell, reportMarkdown, reportMdMark } from "../../../src/spec/report/markdown"
import { reportMark, reportText } from "../../../src/spec/report/text"

/** A contract with one of each kind of evidence, a second source and an exclusion. */
const REPORT_TEST_C: string = `{
  "contract": "c1",
  "source": {"title": "T", "rfc": 9999},
  "sources": [{"id": "rfc9999", "rfc": 9999}, {"id": "rfc2104", "rfc": 2104}],
  "target": {"module": "nish/x"},
  "requirements": [
    {"id": "R1", "section": "2", "level": "MUST", "quote": "It MUST\\n   return | the key."},
    {"id": "R2", "source": "rfc2104", "section": "3", "level": "SHOULD", "quote": "Q2"}
  ],
  "functions": [{"name": "f", "params": [{"name": "a", "type": "string"}], "returns": "string"}],
  "clauses": [
    {"kind": "vector", "id": "V-CMD", "title": "a | b", "covers": ["R1"], "section": "2",
     "source": {"command": "printf 'a|b'"}, "call": "f", "args": [{"str": "a"}], "expect": {"str": "a|b"}},
    {"kind": "vector", "id": "V-CITE", "title": "t", "covers": ["R1"],
     "source": {"cite": {"source": "rfc2104", "section": "5"}}, "call": "f", "args": [{"str": "b"}], "expect": {"str": "b"}},
    {"kind": "vector", "id": "V-SPEC", "title": "t", "covers": ["R1"], "section": "2",
     "source": {"spec": "4"}, "call": "f", "args": [{"str": "c"}], "expect": {"str": "c"}}
  ],
  "exclusions": [{"section": "6", "quote": "It MAY  wave.", "reason": "untestable"}]
}`

/** A checked context for the test contract, as the gates would leave it. */
const reportTestCtx = (): CheckContext => {
  const ctx = new CheckContext("c1.json", ".")
  ctx.contract = contractParse(REPORT_TEST_C, "c1").expect("parse")
  ctx.coverage.set("R1", ["V-CMD", "V-CITE"])
  ctx.notes.push(new CheckNote("fidelity", "R1", "quote not found", false))
  ctx.notes.push(new CheckNote("coverage", "R2", "no clause covers it", false))
  ctx.notes.push(new CheckNote("signatures", "f", "not checked", true))
  ctx.notes.push(new CheckNote("coverage", "§6", "excluded: untestable", true))
  ctx.sourceRuns.push(new CheckSourceRun("V-CMD", "printf 'a|b'", "fail", 'printed "a|b"'))
  return ctx
}

/** The findings the notes above stand beside, plus one with no note. */
const reportTestFound = (): CheckReport => {
  const found = new CheckReport(new SampleTable())
  found.findings.push(new CheckFinding("fidelity", "R1: quote not found"))
  found.findings.push(new CheckFinding("coverage", "R2: no clause covers it"))
  found.findings.push(new CheckFinding("ids", "duplicate id X"))
  return found
}

/** The check's report, in every format. */
export const main = (): i32 => {
  const t = new Suite("spec/gates/report")

  t.eqStr("one line", reportOneLine("  a \n\t b  "), "a b")
  t.eqStr("control characters escaped", reportSafe("a\u001b[2Jb\nc\u007f", 40), "a\\x1b[2Jb\\x0ac\\x7f")
  t.eqStr("safe text is capped", reportSafe("abcdef", 4), "abcd…")
  t.eqStr("never cut inside a character", reportSafe("aéé", 2), "a…")
  const raw = reportTestCtx()
  raw.sourceRuns = [new CheckSourceRun("V-CMD", "printf '\u001b]0;x\u0007'", "fail", "out\u001b[2J\r")]
  raw.notes.push(new CheckNote("run-sources", "V\u001bX", "said \u001b[31mred", true))
  const shown = reportText(raw, new CheckReport(new SampleTable()))
  t.ok(
    "the text report prints no escape",
    shown.indexOf("\u001b") < 0 && shown.indexOf("\r") < 0 && shown.indexOf("\u0007") < 0,
  )
  t.ok("it shows them escaped", shown.indexOf("$ printf '\\x1b]0;x\\x07' — out\\x1b[2J\\x0d") >= 0)
  t.ok("in warnings too", shown.indexOf("! V\\x1bX: said \\x1b[31mred") >= 0)
  t.eqStr("short enough", reportShort("abc", 3), "abc")
  t.eqStr("cut with an ellipsis", reportShort("abcdef", 4), "abc…")
  t.eqStr("never inside a character", reportShort("ééééé", 3), "éé…")
  t.eqStr("the mark of a pass", reportMark("pass"), "✓")
  t.eqStr("the mark of a fail", reportMark("fail"), "✘")
  t.eqStr("the mark of no run", reportMark("not run"), "·")
  t.eqStr("markdown pass", reportMdMark("pass"), "✅ pass")
  t.eqStr("markdown fail", reportMdMark("fail"), "❌ fail")
  t.eqStr("markdown not run", reportMdMark("not run"), "⚪ not run")
  t.eqStr("a cell escapes pipes and backslashes", reportCell("a|b\\c"), "a\\|b\\\\c")
  t.eqStr("an empty cell", reportCell(""), " ")
  t.eqStr("a cell escapes html, links and mentions", reportCell("<b>[x](y) @team"), "&lt;b>\\[x](y) &#64;team")
  t.eqStr("plain code", reportCode("x"), "`x`")
  t.eqStr("code around backticks", reportCode("a``b"), "``` a``b ```")
  t.eqStr("code in a cell", reportCodeCell("a\\|b"), "`a\\\\\\|b`")

  const ctx = reportTestCtx()
  const c: Contract = ctx.contract
  const found = reportTestFound()
  t.eqStr("a failing status", reportStatus(found), "INVALID")
  t.eqStr("a passing status", reportStatus(new CheckReport(new SampleTable())), "CONTRACT_VALID")
  const issues = reportIssues(ctx, found)
  t.eqLines(
    "each finding placed by its note",
    issues.map((i: ReportIssue): string => `${i.gate}|${i.at}|${i.message}`),
    ["fidelity|R1|quote not found", "coverage|R2|no clause covers it", "ids||duplicate id X"],
  )
  t.eqStr("an issue made by hand", new ReportIssue("g", "a", "m").at, "a")
  t.eqLines(
    "warnings but the exclusions'",
    reportWarnings(ctx).map((n: CheckNote): string => n.at),
    ["f"],
  )
  t.ok("the shape held", reportShapeOk(found))
  const shaped = new CheckReport(new SampleTable())
  shaped.findings.push(new CheckFinding("shape", "contract: bad"))
  t.ok("the shape failed", !reportShapeOk(shaped))
  t.eqStr("a main-source citation", reportCite(c, null, "2"), "§2")
  t.eqStr("the main source named", reportCite(c, "rfc9999", "2"), "§2")
  t.eqStr("another source's citation", reportCite(c, "rfc2104", "3"), "rfc2104 §3")
  t.eqStr("the source's title", reportSourceTitle(c), "RFC 9999 (T)")
  t.eqLines(
    "the clauses covering R1",
    reportCovering(c, "R1").map((k): string => k.id),
    ["V-CMD", "V-CITE", "V-SPEC"],
  )
  t.ok("R1 covered", reportCovered(ctx, "R1"))
  t.ok("R2 not covered", !reportCovered(ctx, "R2"))
  t.eqStr("a command's evidence", reportEvidence(ctx, c.clauses[0]), "vector, expected from printf 'a|b'")
  t.eqStr("a citation's evidence", reportEvidence(ctx, c.clauses[1]), "vector, rfc2104 §5")
  t.eqStr("a spec's evidence, its result cited apart", reportEvidence(ctx, c.clauses[2]), "vector, §2, result §4")
  const at = REPORT_TEST_C.indexOf(`"section": "2"`, REPORT_TEST_C.indexOf(`"V-SPEC"`))
  const same = contractParse(`${REPORT_TEST_C.slice(0, at)}"section": "4"${REPORT_TEST_C.slice(at + 14)}`, "c1")
  t.eqStr(
    "a spec's evidence, one section",
    same.isOk() ? reportEvidence(ctx, same.value.clauses[2]) : "unparsed",
    "vector, spec 4",
  )
  t.eqLines(
    "the command runs",
    reportSourceRuns(ctx).map((r: CheckSourceRun): string => `${r.clause} ${r.outcome}`),
    ["V-CMD fail"],
  )
  t.eqLines(
    "a command not run",
    reportSourceRuns(reportTestCtxUnrun()).map((r: CheckSourceRun): string => `${r.clause} ${r.outcome} ${r.command}`),
    ["V-CMD not run printf 'a|b'"],
  )

  // Sampling stats, on a property name the contract does not need to hold.
  const lit: Literal[] = []
  checkAddSample(ctx.samples, new Sample("P1", lit, "min"))
  checkAddSample(ctx.samples, new Sample("P1", lit, "max"))
  const stat = new CheckSampleStat("P1")
  stat.boundary = 2
  ctx.sampleStats.push(stat)
  t.eqStr("a sampled property's count", `${reportSampleCount(ctx, "P1")}`, "2")
  t.ok("its stats", reportStat(ctx, "P1") !== null)
  t.ok("no stats for a vector", reportStat(ctx, "V-CMD") === null)

  t.eqLines("the text report", splitLines(reportText(ctx, found)), [
    "── VECTOR RFC CONTRACT ─────────────────────────────────────────",
    " c1 · RFC 9999 (T) · nish/x",
    " Status: INVALID",
    "",
    " Gate failures",
    "  ✘ fidelity R1: quote not found",
    "  ✘ coverage R2: no clause covers it",
    "  ✘ ids: duplicate id X",
    "",
    " Requirements",
    '  ○ R1  §2 MUST  "It MUST return | the key."',
    "      ○ V-CMD  ○ V-CITE  ○ V-SPEC",
    '  ✘ R2  rfc2104 §3 SHOULD  "Q2"',
    "",
    " Vector sources run",
    "  ✘ V-CMD: $ printf 'a|b' — printed \"a|b\"",
    "",
    " Not tested, by decision",
    '  §6 "It MAY wave." — untestable',
    "",
    " Warnings",
    "  ! f: not checked",
    "",
    " ○ = checked by the contract, not yet run · ✓ pass · ✘ fail · · not run",
  ])

  t.eqLines("the markdown report", splitLines(reportMarkdown(ctx, found)), [
    "## ❌ c1: INVALID",
    "",
    "RFC 9999 (T) · target `nish/x`",
    "",
    "### Gate failures",
    "",
    "| Where | Problem |",
    "| --- | --- |",
    "| fidelity R1 | quote not found |",
    "| coverage R2 | no clause covers it |",
    "| ids | duplicate id X |",
    "",
    "### Requirements",
    "",
    "#### R1 · §2 MUST · ⭕ checked, not run",
    "",
    "> It MUST",
    "> return | the key.",
    "",
    "| Clause | Title | Outcome | Evidence | Detail |",
    "| --- | --- | --- | --- | --- |",
    "| `V-CMD` | a \\| b | ⭕ not run | vector, expected from printf 'a\\|b' |   |",
    "| `V-CITE` | t | ⭕ not run | vector, rfc2104 §5 |   |",
    "| `V-SPEC` | t | ⭕ not run | vector, §2, result §4 |   |",
    "",
    "#### R2 · rfc2104 §3 SHOULD · ❌ uncovered",
    "",
    "> Q2",
    "",
    "### Vector sources run",
    "",
    "| Clause | Command | Outcome | Detail |",
    "| --- | --- | --- | --- |",
    "| `V-CMD` | `printf 'a\\|b'` | ❌ fail | printed \"a\\|b\" |",
    "",
    "### Not tested, by decision",
    "",
    "| Where | Quote | Reason |",
    "| --- | --- | --- |",
    "| §6 | It MAY wave. | untestable |",
    "",
    "### Warnings",
    "",
    "- f: not checked",
  ])

  t.eqStr(
    "the json report",
    reportJson(ctx, found),
    '{"status":"INVALID","contract":"c1","issues":[{"gate":"fidelity","at":"R1","message":"quote not found"},{"gate":"coverage","at":"R2","message":"no clause covers it"},{"gate":"ids","at":"","message":"duplicate id X"}],"warnings":[{"gate":"signatures","at":"f","message":"not checked"}],"coverage":{"R1":["V-CMD","V-CITE"],"R2":[]},"samples":{"P1":{"count":2,"boundary":2,"random":0,"inhabited":false,"notes":[]}},"sources":{"V-CMD":{"command":"printf \'a|b\'","outcome":"fail","detail":"printed \\"a|b\\""}},"truncations":{}}',
  )

  // A shape failure hides the requirements, whose fields cannot be trusted.
  const bare = reportText(ctx, shaped)
  t.ok("no requirements after a shape failure", bare.indexOf("Requirements") < 0)
  t.ok("nor in markdown", reportMarkdown(ctx, shaped).indexOf("Requirements") < 0)

  // The real contract passes, and its altered copy names the requirement.
  const real = new CheckContext("contracts/rfc5869-hkdf-sha256.json", ".")
  const good = checkContract(real, contractLoadFile(real.contractPath).expect("load"))
  t.eqStr("rfc5869 passes", reportStatus(good), "CONTRACT_VALID")
  t.ok("its properties are sampled", reportSampleCount(real, "P-PREFIX") > 0)
  const bad = new CheckContext("tests/cli/check-altered-quote/contract.json", ".")
  const altered = checkContract(bad, contractLoadFile(bad.contractPath).expect("load"))
  t.eqLines(
    "one altered quote fails, naming its requirement",
    reportIssues(bad, altered).map((i: ReportIssue): string => `${i.gate} ${i.at}`),
    ["fidelity R-SALT"],
  )
  return t.done()
}

/** The test context with no command run yet. */
const reportTestCtxUnrun = (): CheckContext => {
  const ctx = reportTestCtx()
  ctx.sourceRuns = []
  return ctx
}
