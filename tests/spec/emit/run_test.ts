import { Suite } from "nish/testing"
import { replaceAll } from "nish/text"
import { Sample, SampleTable, checkAddSample } from "../../../src/spec/check"
import { contractLoadFile } from "../../../src/spec/contract/contract"
import { Contract, LitKind, Literal } from "../../../src/spec/contract/types"
import { EmitOptions, emitProgram } from "../../../src/spec/emit/emit"
import {
  RunClause,
  RunOutcome,
  runDisposeScratch,
  runEscape,
  runFormatJson,
  runFormatMarkdown,
  runFormatText,
  runIsStdPath,
  runJudge,
  runMakeScratch,
  runNonce,
  runOutcomeName,
  runParse,
  runSeedOf,
  runTest,
  runTranscript,
} from "../../../src/spec/run/run"

const bytesLit = (hex: string): Literal => new Literal(LitKind.Hex, hex)
const strLit = (s: string): Literal => new Literal(LitKind.Str, s)

/** One sample per property of contracts/example-hex.json, each meeting its `where`. */
const hexSamples = (): SampleTable => {
  const t = new SampleTable()
  for (const id of ["P-ENC-LEN", "P-ENC-LOWER", "P-ROUND-TRIP"]) {
    checkAddSample(t, new Sample(id, [bytesLit("00ff10ab")], "by hand"))
    checkAddSample(t, new Sample(id, [bytesLit("")], "empty"))
  }
  checkAddSample(t, new Sample("P-CANONICAL", [strLit("00ff1a")], "by hand"))
  checkAddSample(t, new Sample("P-ANY-CASE", [strLit("aB0F")], "by hand"))
  checkAddSample(t, new Sample("P-ODD", [strLit("abc")], "by hand"))
  checkAddSample(t, new Sample("P-OTHER", [strLit("ab"), strLit("g"), strLit("0")], "by hand"))
  checkAddSample(t, new Sample("P-OTHER-EDGE", [strLit("ab"), strLit(":"), strLit("0")], "by hand"))
  checkAddSample(t, new Sample("P-PREFIX", [strLit("ab")], "by hand"))
  return t
}

/** A transcript in which every clause passed, ending with `nonce`'s end line. */
const allPass = (c: Contract, nonce: string): string => {
  const lines: string[] = []
  let bits = ""
  for (const k of c.clauses) {
    lines.push(`PASS  [${k.id}] ${k.title}`)
    bits = `${bits}1`
  }
  lines.push(`example-hex: ${c.clauses.length} passed, 0 failed, 0 skipped`)
  lines.push(`vector-done ${nonce} ${bits}`)
  return `${lines.join("\n")}\n`
}

const statusOf = (c: Contract, out: string, nonce: string, exit: i32): string => {
  const clauses = runParse(c, out)
  return runJudge(c, clauses, exit, runTranscript(c, out, nonce, clauses)).status
}

/** Checks reading, checking and judging transcripts, and one live run when a compiler is at hand. */
export const main = (): i32 => {
  const t = new Suite("spec/emit run")
  const c = contractLoadFile("contracts/example-hex.json").expect("load")
  const nonce = runNonce()
  t.ok("a nonce is 32 hex digits", nonce.length === 32 && nonce !== runNonce())
  t.eqStr("outcome names", runOutcomeName(RunOutcome.NotRun), "not-run")
  t.eqStr("a skip outcome", runOutcomeName(RunOutcome.Skip), "skip")

  const good = allPass(c, nonce)
  t.eqStr("every clause passed: SATISFIED", statusOf(c, good, nonce, 0), "SATISFIED")
  t.eqStr("a nonzero exit: ERROR", statusOf(c, good, nonce, 1), "ERROR")
  t.eqStr("the wrong nonce: ERROR", statusOf(c, good, "feed", 0), "ERROR")
  t.eqStr("no end line: ERROR", statusOf(c, good.substring(0, good.indexOf("vector-done")), nonce, 0), "ERROR")

  const failed = replaceAll(replaceAll(good, "PASS  [V3]", "FAIL  [V3]"), `${nonce} 111`, `${nonce} 110`)
  const failedWithWhy = replaceAll(failed, "\nPASS  [V4]", "\n      got 00, want 01\nPASS  [V4]")
  const parsed = runParse(c, failedWithWhy)
  t.eqStr("a FAIL line is read", runOutcomeName(parsed[2].outcome), "fail")
  t.eqStr("its reason is the indented line", parsed[2].detail, "got 00, want 01")
  t.eqStr("a failed clause: VIOLATED", statusOf(c, failedWithWhy, nonce, 1), "VIOLATED")
  t.eqStr(
    "a FAIL whose bit says it passed: ERROR",
    statusOf(c, replaceAll(good, "PASS  [V3]", "FAIL  [V3]"), nonce, 1),
    "ERROR",
  )
  const v = runJudge(c, parsed, 1, [])
  t.eqStr(
    "a requirement takes its worst clause",
    runOutcomeName(v.outcomes[v.requirements.indexOf("R-DEC-ACCEPT")]),
    "fail",
  )
  t.eqStr("an untouched requirement passes", runOutcomeName(v.outcomes[v.requirements.indexOf("R-DEC-EMPTY")]), "pass")

  const twice = replaceAll(good, "PASS  [V2]", "PASS  [V2] x\nPASS  [V2]")
  t.ok(
    "a clause reported twice is a problem",
    runTranscript(c, twice, nonce, runParse(c, twice)).join("\n").indexOf("[V2] reported 2 times") >= 0,
  )
  const late = `${good}PASS  [V1] again\n`
  t.ok(
    "a clause after the end line is a problem",
    runTranscript(c, late, nonce, runParse(c, late)).join("\n").indexOf("after the test's main") >= 0,
  )
  const forged = `vector-done ${nonce} 1\n${good}`
  t.ok("two end lines are a problem", runTranscript(c, forged, nonce, runParse(c, forged)).length > 0)
  const skipped = replaceAll(good, "PASS  [P-ODD]", "SKIP  [P-ODD]")
  t.eqStr("a skipped clause: ERROR", statusOf(c, skipped, nonce, 0), "ERROR")
  t.eqStr("a control character is escaped", runEscape("a\u001b[31mb\tc\u007f"), "a\\x1b[31mb\\x09c\\x7f")
  t.eqStr("a backtick cannot close a code span", runEscape("`x`"), "'x'")
  t.eqStr("a short line is kept", runEscape("PASS  [V1] é"), "PASS  [V1] é")
  let long = ""
  for (let i = 0; i < 499; i++) {
    long = `${long}x`
  }
  t.eqStr("a long line is cut", runEscape(`${long}yz`), `${long}y…`)
  t.eqStr("but not inside a character", runEscape(`${long}éz`), `${long}…`)
  const empty: RunClause[] = []
  t.eqStr("no clauses at all: ERROR", runJudge(c, empty, 0, []).status, "ERROR")

  t.ok("std/hex.ts is an override path", runIsStdPath("std/hex.ts") && runIsStdPath("std/crypto/x.ts"))
  t.ok(
    "paths outside std/ are not",
    !runIsStdPath("std/../bin/nish") && !runIsStdPath("lib/x.ts") && !runIsStdPath("std/") && !runIsStdPath("std//x"),
  )
  t.ok("an override outside std/ is refused", runMakeScratch(".nish", ["bin/nish"], ["x"]).isErr())
  t.ok("a directory with no compiler is not a seed", runSeedOf("tests").isErr())

  const program = emitProgram(c, hexSamples(), new EmitOptions("ab"))
  t.ok("example-hex emits with every property sampled", program.isOk())
  const hexText = readFileSyncOrNull("tests/fixtures/nish-hex/hex.ts")
  if (!isExecutableSync(".nish/libexec/nish") || hexText === null || !program.isOk()) {
    t.skip("the emitted test runs SATISFIED", "no .nish/ install or no fixture: run bash scripts/fetch-nish.sh")
    return t.done()
  }
  t.ok(".nish is its own seed", runSeedOf(".nish").isOk())
  const made = runMakeScratch(".nish", ["std/hex.ts"], [hexText])
  t.ok("a scratch install is made", made.isOk())
  if (!made.isOk()) {
    console.log(made.error)
    return t.done()
  }
  const s = made.value
  t.eqStr("the override is in the scratch std", readFileSyncOrNull(`${s.dir}/std/hex.ts`) ?? "", hexText)
  const ran = runTest(c, program.value, s.nish, 110000)
  t.ok("the test ran", ran.isOk())
  if (ran.isOk()) {
    const r = ran.value
    if (r.verdict.status !== "SATISFIED") {
      console.log(runFormatText(r).join("\n"))
    }
    t.eqStr("the emitted test compiles and runs SATISFIED under the pinned nish", r.verdict.status, "SATISFIED")
    t.ok("the text report names the verdict", runFormatText(r)[0].startsWith("SATISFIED: example-hex"))
    t.ok("the markdown report has a table", runFormatMarkdown(r).indexOf("| R-DEC-EMPTY | pass |") > 0)
    t.ok("the json report has the status", runFormatJson(r).indexOf(`"status": "SATISFIED"`) > 0)
  }
  t.ok("the scratch install is removed", runDisposeScratch(s).isOk() && !isDirectorySync(s.dir))
  return t.done()
}
