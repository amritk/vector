import { Suite } from "nish/testing"
import { replaceAll, splitLines } from "nish/text"
import { makeTempDir } from "../../../src/core/fs"
import { runProcess } from "../../../src/core/process"
import { Sample, SampleTable, checkAddSample } from "../../../src/spec/check"
import { contractLoadFile } from "../../../src/spec/contract/contract"
import { Contract, LitKind, Literal } from "../../../src/spec/contract/types"
import { EmitOptions, emitProgram } from "../../../src/spec/emit/emit"
import {
  RunClause,
  RunOutcome,
  RunResult,
  runDisposeScratch,
  runEscape,
  runFormatJson,
  runFormatMarkdown,
  runFormatText,
  runIsStdPath,
  runJudge,
  runMakeScratch,
  runNishArgv,
  runNonce,
  runOutcomeName,
  runParse,
  runRemove,
  runSeedOf,
  runTest,
  runTestFile,
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
  runTestTail(t, c)
  runTestInPlace(t, c)
  runTestLinks(t)
  runTestMarkdown(t)
  runTestSlow(t, nonce)

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

/** Runs a shell line, failing loudly: test setup only. */
const runTestSh = (line: string): void => {
  const r = runProcess(["sh", "-c", line], "", 10000).expect("run sh")
  if (r.status !== 0) {
    console.log(`sh -c ${line}: ${r.stderr}`)
  }
}

/** runTestFile runs the test where it is, passing the file and a fresh nonce. */
const runTestInPlace = (t: Suite, c: Contract): void => {
  const dir = makeTempDir("vector-in-place-").expect("a temp dir")
  const fake = `${dir}/nish`
  runTestSh(`printf '#!/bin/sh\\necho "$1 $2"\\necho "$3"\\n' > ${fake} && chmod 755 ${fake}`)
  const file = `${dir}/sub/main_test.ts`
  const ran = runTestFile(c, file, fake, 10000, false)
  t.ok("a test in place runs", ran.isOk())
  if (ran.isOk()) {
    const lines = splitLines(ran.value.stdout)
    t.eqStr("it is run where it is", lines[0], `run ${file}`)
    t.eqStr("with a nonce of 32 hex digits", `${lines[1].length}`, "32")
    t.ok("and judged: it never printed the nonce back as its end", ran.value.verdict.status !== "SATISFIED")
  }
  const fast = runTestFile(c, file, fake, 10000, true)
  t.ok("a slow run runs", fast.isOk())
  if (fast.isOk()) {
    t.eqStr("built optimized", splitLines(fast.value.stdout)[0], "run --profile")
  }
  t.eqStr("runNishArgv builds a plain run by default", runNishArgv("nish", "a.ts", false).join(" "), "nish run a.ts")
  t.eqStr(
    "and an optimized one with --slow",
    runNishArgv("nish", "a.ts", true).join(" "),
    "nish run --profile speed a.ts",
  )
  t.ok("the test's directory is left alone", isDirectorySync(dir))
  t.ok("runRemove removes it", runRemove(dir).isOk() && !isDirectorySync(dir))
}

/** A run that prints past 64 KiB keeps its last 64 KiB, cut at a line's start. */
const runTestTail = (t: Suite, c: Contract): void => {
  const dir = makeTempDir("vector-tail-").expect("a temp dir")
  const fake = `${dir}/nish`
  runTestSh(`printf '#!/bin/sh\\nseq 1 20000\\n' > ${fake} && chmod 755 ${fake}`)
  const lines: string[] = []
  for (let i = 1; i <= 20000; i++) {
    lines.push(`${i}`)
  }
  const full = `${lines.join("\n")}\n`
  const ran = runTest(c, "", fake, 10000)
  t.ok("a fake compiler runs", ran.isOk())
  if (ran.isOk()) {
    const kept = ran.value.stdout
    t.ok("the output was longer than what is kept", full.length > 65536)
    t.ok("at most 64 KiB is kept", kept.length <= 65536)
    t.ok("no more than a line short of it", kept.length > 65536 - 6)
    t.ok("its end", kept.endsWith("\n19999\n20000\n"))
    t.eqStr("whole lines from a line's start", full.substring(full.length - kept.length - 1, full.length), `\n${kept}`)
  }
  runTestSh(`rm -rf ${dir}`)
}

/**
 * A scratch keeps a nish std's symlinks, replaces a link an override names,
 * and refuses an override reached through a linked directory.
 */
const runTestLinks = (t: Suite): void => {
  const dir = makeTempDir("vector-links-").expect("a temp dir")
  runTestSh(
    `mkdir -p ${dir}/root/libexec ${dir}/root/std ${dir}/out ${dir}/other && printf '#!/bin/sh\\n' > ${dir}/root/libexec/nish && chmod 755 ${dir}/root/libexec/nish && printf real > ${dir}/out/a.ts && ln -s ${dir}/out/a.ts ${dir}/root/std/link.ts && ln -s ${dir}/out ${dir}/root/std/sub && mkdir -p ${dir}/other/libexec && cp ${dir}/root/libexec/nish ${dir}/other/libexec/nish && ln -s ${dir}/root/std ${dir}/other/std`,
  )
  const plain = runMakeScratch(`${dir}/root`, [], [])
  t.ok("a std holding symlinks no override uses is accepted", plain.isOk())
  if (plain.isOk()) {
    runDisposeScratch(plain.value).expect("dispose")
  }
  const over = runMakeScratch(`${dir}/root`, ["std/link.ts"], ["new"])
  t.ok("an override of a linked file is accepted", over.isOk())
  if (over.isOk()) {
    t.eqStr("the scratch holds the override", readFileSyncOrNull(`${over.value.dir}/std/link.ts`) ?? "", "new")
    runDisposeScratch(over.value).expect("dispose")
  }
  t.eqStr("and the link's target is untouched", readFileSyncOrNull(`${dir}/out/a.ts`) ?? "", "real")
  const through = runMakeScratch(`${dir}/root`, ["std/sub/x.ts"], ["x"])
  t.ok("an override under a linked directory is refused", through.isErr())
  if (through.isErr()) {
    t.contains(
      "naming the link",
      through.error,
      "std/sub is a symlink, which override std/sub/x.ts would write through",
    )
  }
  t.ok("and writes nothing through it", readFileSyncOrNull(`${dir}/out/x.ts`) === null)
  const linkedStd = runMakeScratch(`${dir}/other`, ["std/y.ts"], ["y"])
  t.ok("an override when std/ itself is a link is refused", linkedStd.isErr())
  t.ok("and writes nothing through it either", readFileSyncOrNull(`${dir}/root/std/y.ts`) === null)
  runTestSh(`rm -rf ${dir}`)
}

/** What the module printed reaches markdown only inside code spans. */
const runTestMarkdown = (t: Suite): void => {
  const r = new RunResult("example-hex", 1, "", "")
  r.integrity.push("a line [x](https://e.example) <b>|# `q`")
  const k = new RunClause("P-X")
  k.outcome = RunOutcome.Fail
  k.line = "FAIL [P-X] <i>"
  k.detail = "[y](https://e.example) | `z`"
  r.clauses.push(k)
  const md = runFormatMarkdown(r)
  t.contains("an integrity message is a code span", md, "- `a line [x](https://e.example) <b>|# 'q'`\n")
  t.contains("so is a failure's detail", md, "- `FAIL [P-X] <i>`: `[y](https://e.example) | 'z'`\n")
}

/** A transcript of contract sha256-chain: CHAIN-1, CHAIN-1000, then the slow CHAIN-100000 as `last`. */
const runSlowTranscript = (nonce: string, last: string): string =>
  `PASS  [CHAIN-1] once\nPASS  [CHAIN-1000] 1,000 times\n${last}\nsha256-chain: 2 passed, 0 failed, 1 skipped\nvector-done ${nonce} 111\n`

/** A slow vector skipped for want of `--slow` is listed, never passed, and its requirement is a skip. */
const runTestSlow = (t: Suite, nonce: string): void => {
  const c = contractLoadFile("tests/fixtures/iterate-emit/contracts/sha256-chain.json").expect("load")
  const out = runSlowTranscript(nonce, "SKIP  [CHAIN-100000] 100,000 times (slow: pass --slow to run)")
  const clauses = runParse(c, out)
  t.ok("a slow vector skipped as slow is marked slow", clauses[2].slow && !clauses[0].slow)
  const other = runParse(c, runSlowTranscript(nonce, "SKIP  [CHAIN-100000] 100,000 times (no reason)"))
  t.ok("a skip with another reason is not", !other[2].slow)
  t.eqStr("so it is an ERROR", runJudge(c, other, 0, []).status, "ERROR")
  const v = runJudge(c, clauses, 0, runTranscript(c, out, nonce, clauses))
  t.eqStr("a slow skip leaves the run SATISFIED over what ran", v.status, "SATISFIED")
  t.eqStr(
    "a requirement covered only by it is a skip",
    runOutcomeName(v.outcomes[v.requirements.indexOf("R-LOWER")]),
    "skip",
  )
  t.eqStr("the others pass", runOutcomeName(v.outcomes[v.requirements.indexOf("R-CHAIN")]), "pass")
  const r = new RunResult("sha256-chain", 0, out, "")
  r.verdict = v
  for (const k of clauses) {
    r.clauses.push(k)
  }
  const text = runFormatText(r).join("\n")
  t.contains("the text lists the slow vector", text, "\n  skip  CHAIN-100000 (slow; pass --slow)")
  t.ok("and passes nothing it did not run", text.indexOf("pass  CHAIN-100000") < 0 && text.indexOf("pass  R-LOWER") < 0)
  t.contains("the markdown lists it", runFormatMarkdown(r), "Skipped as slow (pass `--slow` to run): `CHAIN-100000`")
  const allSlow: RunClause[] = []
  for (const id of ["CHAIN-1", "CHAIN-1000", "CHAIN-100000"]) {
    const k = new RunClause(id)
    k.outcome = RunOutcome.Skip
    k.slow = true
    allSlow.push(k)
  }
  t.ok("the json marks the slow skip", runFormatJson(r).indexOf(`"detail": "", "slow": true}`) > 0)
  const json = runFormatJson(r)
  t.ok("and only it", json.indexOf(`"slow": true`, json.indexOf(`"slow": true`) + 1) < 0)
  t.ok("a run with passes states no all-slow reason", text.indexOf("every vector was skipped as slow") < 0)
  const all = new RunResult("sha256-chain", 0, "", "")
  all.verdict = runJudge(c, allSlow, 0, [])
  t.eqStr("a run whose every clause was a slow skip is an ERROR", all.verdict.status, "ERROR")
  for (const k of allSlow) {
    all.clauses.push(k)
  }
  t.contains(
    "and the text says why",
    runFormatText(all).join("\n"),
    "\nevery vector was skipped as slow, so nothing ran: pass --slow",
  )
}
