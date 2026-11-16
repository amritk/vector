/**
 * `spec/run` — running an emitted test against a nish install, and reading
 * its transcript back in the contract's terms: which requirement each
 * `PASS` / `FAIL` line speaks to, and whether the transcript is the one the
 * test's own `main` wrote.
 */

import { splitLines } from "nish/text"
import { basename, joinPath, makeTempDir, mkdirAll } from "../../core/fs"
import { toHex } from "../../core/hex"
import { runProcess } from "../../core/process"
import { Contract } from "../contract/types"
import { EMIT_SLOW_SKIP, emitQuote } from "../emit/lit"

/** A clause's outcome, ordered from best to worst: a requirement takes its clauses' worst. */
export enum RunOutcome {
  /** The clause ran and held. */
  Pass = 0,
  /** A property with no samples, which the emitted test skips. */
  Skip = 1,
  /** The clause could not be run. */
  NotRun = 2,
  /** The clause ran and did not hold. */
  Fail = 3,
}

/**
 * An outcome's name, as reports show it.
 *
 * @param o the outcome
 * @returns `pass`, `skip`, `not-run` or `fail`
 */
export const runOutcomeName = (o: RunOutcome): string => {
  if (o === RunOutcome.Pass) {
    return "pass"
  }
  if (o === RunOutcome.Skip) {
    return "skip"
  }
  if (o === RunOutcome.Fail) {
    return "fail"
  }
  return "not-run"
}

/** What the transcript says of one clause. */
export class RunClause {
  /** The clause's id. */
  id: string
  /** Its outcome; `NotRun` when no line reported it. */
  outcome: RunOutcome
  /** The line that reported it, or "" when none did. */
  line: string
  /** Why it failed: the indented line after a `FAIL`, or "". */
  detail: string
  /** Whether it is a slow iterated vector the test skipped because `--slow` was not passed. */
  slow: boolean

  /**
   * Makes a clause that no line has reported yet.
   *
   * @param id the clause's id
   */
  constructor(id: string) {
    this.id = id
    this.outcome = RunOutcome.NotRun
    this.line = ""
    this.detail = ""
    this.slow = false
  }
}

/** A run's verdict: the status and each requirement's outcome. */
export class RunVerdict {
  /** SATISFIED: every clause passed. VIOLATED: one failed. ERROR: anything else. */
  status: string
  /** The requirements' ids, in contract order. */
  requirements: string[]
  /** Each requirement's outcome: the worst of the clauses that cover it. */
  outcomes: RunOutcome[]

  /** Makes an empty verdict. */
  constructor() {
    this.status = "ERROR"
    this.requirements = []
    this.outcomes = []
  }
}

/** Everything a run did: its verdict, its clauses and its transcript. */
export class RunResult {
  /** The verdict. */
  verdict: RunVerdict
  /** The contract's id. */
  contract: string
  /** The test's exit status, -1 when it timed out. */
  exitCode: i32
  /** Each clause, in contract order. */
  clauses: RunClause[]
  /** Why the transcript cannot be trusted; any entry makes the run an ERROR. */
  integrity: string[]
  /** The test's standard output. */
  stdout: string
  /** The test's standard error. */
  stderr: string

  /**
   * Makes a result.
   *
   * @param contract the contract's id
   * @param exitCode the test's exit status
   * @param stdout its standard output
   * @param stderr its standard error
   */
  constructor(contract: string, exitCode: i32, stdout: string, stderr: string) {
    this.verdict = new RunVerdict()
    this.contract = contract
    this.exitCode = exitCode
    this.clauses = []
    this.integrity = []
    this.stdout = stdout
    this.stderr = stderr
  }
}

/** A clause line's outcome and id: `PASS  [V1] …` → Pass, "V1"; null for any other line. */
class RunLine {
  outcome: RunOutcome
  id: string
  constructor(outcome: RunOutcome, id: string) {
    this.outcome = outcome
    this.id = id
  }
}

const runReadLine = (line: string): RunLine | null => {
  if (line.length < 8 || line.substring(4, 7) !== "  [") {
    return null
  }
  const word = line.substring(0, 4)
  let o = RunOutcome.NotRun
  if (word === "PASS") {
    o = RunOutcome.Pass
  } else if (word === "FAIL") {
    o = RunOutcome.Fail
  } else if (word === "SKIP") {
    o = RunOutcome.Skip
  } else {
    return null
  }
  const close = toI32(line.indexOf("]", 7))
  if (close <= 7) {
    return null
  }
  return new RunLine(o, line.substring(7, close))
}

const runClauseIndex = (c: Contract, id: string): i32 => {
  for (let i = 0; i < c.clauses.length; i++) {
    if (c.clauses[i].id === id) {
      return i
    }
  }
  return -1
}

/**
 * Reads a test's output: each clause's outcome from the line that reports
 * it (`PASS  [id] …`, `FAIL  [id] …` with its reason indented on the next
 * line, `SKIP  [id] …`). A line naming no clause of the contract is ignored;
 * a clause no line names is not-run. A skip of a vector the contract marks
 * slow, with the slow reason, is marked slow: left out on purpose.
 *
 * @param c the contract
 * @param stdout the test's standard output
 * @returns one entry per clause, in contract order
 */
export const runParse = (c: Contract, stdout: string): RunClause[] => {
  const out: RunClause[] = []
  for (const k of c.clauses) {
    out.push(new RunClause(k.id))
  }
  const lines = splitLines(stdout)
  for (let i = 0; i < lines.length; i++) {
    const m = runReadLine(lines[i])
    if (m === null) {
      continue
    }
    const at = runClauseIndex(c, m.id)
    if (at < 0) {
      continue
    }
    const r = out[at]
    r.outcome = m.outcome
    r.line = lines[i]
    r.detail = ""
    const it = c.clauses[at].iterate
    r.slow =
      m.outcome === RunOutcome.Skip && it !== null && it.slow && lines[i].endsWith(` (${EMIT_SLOW_SKIP})`)
    if (m.outcome === RunOutcome.Fail && i + 1 < lines.length && lines[i + 1].startsWith("      ")) {
      r.detail = lines[i + 1].substring(6, lines[i + 1].length)
    }
  }
  return out
}

/** An end line's nonce and bits: `vector-done <nonce> <bits>`; null for any other line. */
class RunEnd {
  nonce: string
  bits: string
  constructor(nonce: string, bits: string) {
    this.nonce = nonce
    this.bits = bits
  }
}

const runReadEnd = (line: string): RunEnd | null => {
  const head = "vector-done "
  if (!line.startsWith(head)) {
    return null
  }
  const rest = line.substring(head.length, line.length)
  const sp = toI32(rest.indexOf(" "))
  if (sp <= 0) {
    return null
  }
  const nonce = rest.substring(0, sp)
  const bits = rest.substring(sp + 1, rest.length)
  for (let i = 0; i < bits.length; i++) {
    const b = bits.substring(i, i + 1)
    if (b !== "0" && b !== "1") {
      return null
    }
  }
  for (let i = 0; i < nonce.length; i++) {
    const ch = toI32(nonce.charCodeAt(i))
    if (ch <= 32 || ch === 127) {
      return null
    }
  }
  return new RunEnd(nonce, bits)
}

/**
 * Checks that a transcript is the one the emitted test wrote. The module
 * under test runs in the same process and can print anything, so a clause
 * line alone proves nothing: the run must reach the end of `main` (its
 * `vector-done <nonce> <bits>` line, with the nonce this run passed in), every
 * clause must be reported once and before that line, and each printed outcome
 * must match what the clause returned to `main` (pass and skip return true).
 *
 * @param c the contract
 * @param stdout the test's standard output
 * @param nonce the nonce the run passed the test
 * @param clauses the clauses as runParse read them
 * @returns each reason the transcript cannot be trusted; empty when it can
 */
export const runTranscript = (c: Contract, stdout: string, nonce: string, clauses: RunClause[]): string[] => {
  const problems: string[] = []
  const lines = splitLines(stdout)
  let others = 0
  let mine = 0
  let end = -1
  let bits = ""
  for (let i = 0; i < lines.length; i++) {
    const e = runReadEnd(lines[i])
    if (e === null) {
      continue
    }
    if (e.nonce !== nonce) {
      others++
    } else {
      if (mine === 0) {
        end = i
        bits = e.bits
      }
      mine++
    }
  }
  if (others > 0) {
    problems.push(
      `${others} vector-done line(s) with the wrong nonce: something other than the test's main printed them`,
    )
  }
  if (mine === 0) {
    problems.push(
      "the test never reached the end of main (no vector-done line with this run's nonce): it stopped early, or the module exited the process",
    )
    return problems
  }
  if (mine > 1) {
    problems.push(`${mine} vector-done lines carry this run's nonce`)
  }
  const seen: i32[] = []
  for (const _k of c.clauses) {
    seen.push(0)
  }
  for (let i = 0; i < lines.length; i++) {
    const m = runReadLine(lines[i])
    if (m === null) {
      continue
    }
    const at = runClauseIndex(c, m.id)
    if (at < 0) {
      continue
    }
    seen[at] = seen[at] + 1
    if (i > end) {
      problems.push(`[${m.id}] reported after the test's main had finished`)
    }
  }
  for (let i = 0; i < c.clauses.length; i++) {
    if (seen[i] > 1) {
      problems.push(`[${c.clauses[i].id}] reported ${seen[i]} times; a clause reports once`)
    }
  }
  if (bits.length !== c.clauses.length) {
    problems.push(`the end line records ${bits.length} clause result(s), but the contract has ${c.clauses.length}`)
    return problems
  }
  for (let i = 0; i < c.clauses.length; i++) {
    const o = i < clauses.length ? clauses[i].outcome : RunOutcome.NotRun
    const returned = bits.substring(i, i + 1) === "1"
    const printed = o === RunOutcome.Pass || o === RunOutcome.Skip
    if (o === RunOutcome.NotRun || returned !== printed) {
      problems.push(`[${c.clauses[i].id}] returned ${returned} to main, but its line says ${runOutcomeName(o)}`)
    }
  }
  return problems
}

const runRank = (o: RunOutcome): i32 => {
  if (o === RunOutcome.Pass) {
    return 0
  }
  if (o === RunOutcome.Skip) {
    return 1
  }
  return o === RunOutcome.NotRun ? 2 : 3
}

/**
 * Judges a run. Each requirement takes the worst outcome of the clauses that
 * cover it (not-run when none does), leaving out a slow vector skipped for
 * want of `--slow`: one covered only by those is a skip. The run is an ERROR
 * when its transcript cannot be trusted; else VIOLATED when a clause failed;
 * else an ERROR when a clause other than a slow skip did not pass, every
 * clause was a slow skip, or the test exited nonzero; else SATISFIED, over what ran.
 *
 * @param c the contract
 * @param clauses the clauses as runParse read them
 * @param exitCode the test's exit status
 * @param integrity the problems runTranscript found
 * @returns the verdict
 */
export const runJudge = (c: Contract, clauses: RunClause[], exitCode: i32, integrity: string[]): RunVerdict => {
  const v = new RunVerdict()
  for (const r of c.requirements) {
    let worst = RunOutcome.Pass
    let any = false
    let slow = false
    for (let i = 0; i < c.clauses.length; i++) {
      if (c.clauses[i].covers.indexOf(r.id) < 0) {
        continue
      }
      if (i < clauses.length && clauses[i].slow) {
        slow = true
        continue
      }
      any = true
      const o = i < clauses.length ? clauses[i].outcome : RunOutcome.NotRun
      if (runRank(o) > runRank(worst)) {
        worst = o
      }
    }
    v.requirements.push(r.id)
    v.outcomes.push(any ? worst : slow ? RunOutcome.Skip : RunOutcome.NotRun)
  }
  let failed = false
  let unpassed = false
  let passed = false
  let skippedSlow = false
  for (const k of clauses) {
    if (k.outcome === RunOutcome.Fail) {
      failed = true
    } else if (k.outcome === RunOutcome.Pass) {
      passed = true
    } else if (k.slow) {
      skippedSlow = true
    } else {
      unpassed = true
    }
  }
  if (integrity.length > 0) {
    v.status = "ERROR"
  } else if (failed) {
    v.status = "VIOLATED"
  } else if (unpassed || (skippedSlow && !passed) || exitCode !== 0 || clauses.length !== c.clauses.length) {
    v.status = "ERROR"
  } else {
    v.status = "SATISFIED"
  }
  return v
}

/**
 * A fresh nonce for one run: 16 random bytes as hex. It is passed to the
 * test on the command line, never written into its source, so the build
 * stays cacheable.
 *
 * @returns 32 lowercase hex digits
 */
export const runNonce = (): string => {
  const bytes: u8[] = new Array<u8>(16)
  crypto.getRandomValues(bytes)
  return toHex(bytes)
}

/** A scratch nish install: a copy of a seed whose std is a root's std plus overrides. */
export class RunScratch {
  /** The install's root: bin/, libexec/, runtime/, std/. */
  dir: string
  /** The compiler to run: `<dir>/libexec/nish`, never a wrapper. */
  nish: string

  /**
   * Makes a scratch handle.
   *
   * @param dir the install's root
   */
  constructor(dir: string) {
    this.dir = dir
    this.nish = joinPath(dir, "libexec/nish")
  }
}

/**
 * Where a nish root keeps the install to copy: an install itself (it has
 * `libexec/nish`, like `.nish/`), or a checkout's last release at
 * `build/seed`.
 *
 * @param nishRoot a nish install or checkout
 * @returns the seed's directory, or `Err` when the root has neither
 */
export const runSeedOf = (nishRoot: string): Result<string, string> => {
  if (isExecutableSync(joinPath(nishRoot, "libexec/nish"))) {
    return Ok(nishRoot)
  }
  const seed = joinPath(nishRoot, "build/seed")
  if (isExecutableSync(joinPath(seed, "libexec/nish"))) {
    return Ok(seed)
  }
  return Err(`${nishRoot} is neither a nish install (libexec/nish) nor a checkout with build/seed`)
}

/**
 * Whether a path is a relative path under `std/` with no `..` part: the only
 * places an override may write.
 *
 * @param rel the path
 * @returns true when it is under std/
 */
export const runIsStdPath = (rel: string): boolean => {
  if (!rel.startsWith("std/") || rel.length <= 4) {
    return false
  }
  const parts: string[] = []
  let start = 0
  for (let i = 0; i <= rel.length; i++) {
    if (i === rel.length || rel.substring(i, i + 1) === "/") {
      parts.push(rel.substring(start, i))
      start = i + 1
    }
  }
  for (const p of parts) {
    if (p === ".." || p === "." || p.length === 0) {
      return false
    }
  }
  return true
}

/**
 * Removes a directory and everything below it.
 *
 * @param dir the directory
 * @returns Ok once it is gone, else why it could not be removed
 */
export const runRemove = (dir: string): Result<boolean, string> => {
  const r = runProcess(["rm", "-rf", dir], "", 120000).orReturn()
  if (r.status !== 0) {
    return Err(`cannot remove ${dir}: ${r.stderr}`)
  }
  return Ok(true)
}

const runCopy = (from: string, to: string): Result<boolean, string> => {
  const r = runProcess(["cp", "-RP", from, to], "", 120000).orReturn()
  if (r.status !== 0) {
    return Err(`cannot copy ${from} to ${to}: ${r.stderr}`)
  }
  return Ok(true)
}

/**
 * Removes a scratch install and everything in it.
 *
 * @param s the scratch install
 * @returns `Ok(true)`, or `Err` when it could not be removed
 */
export const runDisposeScratch = (s: RunScratch): Result<boolean, string> => runRemove(s.dir)

/**
 * Refuses an override whose directory is reached through a symlink: each
 * part of `rel`'s directory that exists must resolve to itself under `base`,
 * so creating or writing below it stays inside the scratch.
 */
const runCheckInside = (base: string, rel: string): Result<boolean, string> => {
  let at = rel.indexOf("/")
  while (at >= 0) {
    const full = joinPath(base, rel.substring(0, at))
    if (lstatOwnerModeSync(full) < 0) {
      return Ok(true)
    }
    const real = realpathSync(full)
    if (real === null || real !== full) {
      return Err(`scratch: ${rel.substring(0, at)} is a symlink, which override ${rel} would write through`)
    }
    at = rel.indexOf("/", at + 1)
  }
  return Ok(true)
}

const runFillScratch = (
  s: RunScratch,
  nishRoot: string,
  seed: string,
  paths: string[],
  texts: string[],
): Result<boolean, string> => {
  const entries = readdirSync(seed)
  if (entries === null) {
    return Err(`cannot read ${seed}`)
  }
  for (const e of entries) {
    if (e !== "std") {
      runCopy(joinPath(seed, e), joinPath(s.dir, e)).orReturn()
    }
  }
  // std/ is copied with its symlinks kept as links. A link nothing writes
  // through is harmless; an override must not write through one.
  runCopy(joinPath(nishRoot, "std"), joinPath(s.dir, "std")).orReturn()
  const base = realpathSync(s.dir)
  if (base === null) {
    return Err(`cannot resolve ${s.dir}`)
  }
  for (let i = 0; i < paths.length; i++) {
    runCheckInside(base, paths[i]).orReturn()
    const target = joinPath(base, paths[i])
    const parent = target.substring(0, target.length - basename(target).length - 1)
    mkdirAll(parent, 0o755).orReturn()
    // The file itself may be a link: remove it (never what it points at),
    // then create the file afresh, refusing to follow anything in its place.
    unlinkSync(target)
    const n = createFileExclusiveSync(target, texts[i], 0o644)
    if (n < 0) {
      return Err(`cannot write ${target} (errno ${-n})`)
    }
  }
  return Ok(true)
}

/**
 * Makes a scratch nish install: a copy of the root's seed (runSeedOf)
 * without its std, the root's own `std/`, and the overrides written over it.
 * `nish run` resolves `nish/…` imports to the std beside its binary, so a
 * test run with the scratch's compiler sees the overridden library and
 * nothing else does. An override reached through a symlink in `std/` is
 * refused; a link on the overridden file itself is replaced, never written
 * through, and every other link is left as it is.
 *
 * @param nishRoot a nish install or checkout
 * @param paths where each override goes, relative and under `std/`
 * @param texts each override's contents, matching `paths`
 * @returns the install, or `Err` when it could not be made (nothing is left behind)
 */
export const runMakeScratch = (nishRoot: string, paths: string[], texts: string[]): Result<RunScratch, string> => {
  if (paths.length !== texts.length) {
    return Err("scratch: the override paths and texts differ in number")
  }
  for (const p of paths) {
    if (!runIsStdPath(p)) {
      return Err(`scratch: override ${p} is not a path under std/`)
    }
  }
  const root = realpathSync(nishRoot)
  if (root === null) {
    return Err(`scratch: ${nishRoot} does not exist`)
  }
  const seed = runSeedOf(root).orReturn()
  if (!isDirectorySync(joinPath(root, "std"))) {
    return Err(`scratch: ${joinPath(root, "std")} does not exist`)
  }
  const s = new RunScratch(makeTempDir("vector-scratch-").orReturn())
  const filled = runFillScratch(s, root, seed, paths, texts)
  if (filled.isErr()) {
    const gone = runDisposeScratch(s)
    return Err(gone.isErr() ? `${filled.error}; ${gone.error}` : filled.error)
  }
  return Ok(s)
}

/**
 * Compiles and runs an emitted test with `nish run <file> <nonce>`, from a
 * scratch directory removed afterwards, and judges what it printed.
 *
 * @param c the contract the test was emitted from
 * @param source the test's text
 * @param nishBin the compiler
 * @param timeoutMs the most milliseconds the build and run may take
 * @returns the result, or `Err` when the compiler could not be started
 */
export const runTest = (c: Contract, source: string, nishBin: string, timeoutMs: i32): Result<RunResult, string> => {
  const dir = makeTempDir("vector-run-").orReturn()
  const file = joinPath(dir, "main.ts")
  const n = writeFileSyncMode(file, source, 0o600)
  const ran: Result<RunResult, string> =
    n < 0 ? Err(`cannot write ${file} (errno ${-n})`) : runTestFile(c, file, nishBin, timeoutMs)
  const gone = runRemove(dir)
  if (gone.isErr()) {
    console.error(`vector: warning: spec run: ${gone.error}`)
  }
  return ran
}

/**
 * Compiles and runs an emitted test already written to `file`, where its
 * relative imports resolve, with `nish run <file> <nonce>`, and judges what
 * it printed. The file is left where it is.
 *
 * @param c the contract the test was emitted from
 * @param file the test
 * @param nishBin the compiler
 * @param timeoutMs the most milliseconds the build and run may take
 * @returns the result, or `Err` when the compiler could not be started
 */
export const runTestFile = (c: Contract, file: string, nishBin: string, timeoutMs: i32): Result<RunResult, string> =>
  runTestCommand(c, [nishBin, "run", file], timeoutMs)

/**
 * Runs an emitted test with the command that runs it in its language, a fresh
 * nonce appended as its last argument, and judges what it printed.
 *
 * @param c the contract the test was emitted from
 * @param argv the command: `nish run <file>`, `python3 <file>`, ...
 * @param timeoutMs the most milliseconds the build and run may take
 * @returns the result, or `Err` when the command could not be started
 */
export const runTestCommand = (c: Contract, argv: string[], timeoutMs: i32): Result<RunResult, string> => {
  const nonce = runNonce()
  const cmd: string[] = []
  for (const a of argv) {
    cmd.push(a)
  }
  cmd.push(nonce)
  const p = runProcess(cmd, "", timeoutMs).orReturn()
  const out = new RunResult(c.contract, p.status, runKeepTail(p.stdout), runKeepTail(p.stderr))
  if (p.timedOut) {
    out.integrity.push(`the test did not finish within ${timeoutMs} ms`)
  }
  out.clauses = runParse(c, p.stdout)
  for (const m of runTranscript(c, p.stdout, nonce, out.clauses)) {
    out.integrity.push(m)
  }
  out.verdict = runJudge(c, out.clauses, p.status, out.integrity)
  return Ok(out)
}

/** The most of a run's stdout or stderr a result keeps: its last 64 KiB. */
const RUN_KEEP_CHARS: i32 = 65536

/**
 * The end of a run's output, at most RUN_KEEP_CHARS bytes of it, starting
 * at a line's start so no line or character is kept in part.
 */
const runKeepTail = (text: string): string => {
  if (text.length <= RUN_KEEP_CHARS) {
    return text
  }
  const from = text.indexOf("\n", text.length - RUN_KEEP_CHARS - 1)
  return from < 0 ? "" : text.substring(from + 1, text.length)
}

/** The longest line of the module's output a report shows. */
const RUN_LINE_CHARS: i32 = 500

/**
 * A line the module printed, made safe to show in a terminal or in markdown:
 * a control character (an ANSI escape's ESC among them) becomes `\xNN`, a
 * backtick becomes `'`, and past RUN_LINE_CHARS bytes it is cut, between
 * characters, with `…`.
 *
 * @param text the line
 * @returns the line as a report shows it
 */
export const runEscape = (text: string): string => {
  const out: string[] = []
  let n = text.length > RUN_LINE_CHARS ? RUN_LINE_CHARS : text.length
  // The cut is in bytes: back off a UTF-8 continuation byte, so no character is split.
  while (n > 0 && n < text.length && (toI32(text.charCodeAt(n)) & 0xc0) === 0x80) {
    n -= 1
  }
  for (let i = 0; i < n; i++) {
    const c = toI32(text.charCodeAt(i))
    if (c < 32 || c === 127) {
      const h = toHex([toU8(c)])
      out.push(`\\x${h}`)
    } else if (c === 96) {
      out.push("'")
    } else {
      out.push(text.substring(i, i + 1))
    }
  }
  if (n < text.length) {
    out.push("…")
  }
  return out.join("")
}

const runTail = (text: string, n: i32): string[] => {
  const lines = splitLines(text)
  const from = lines.length > n ? lines.length - n : 0
  return lines.slice(from, lines.length)
}

/**
 * A run's result as text: the verdict, each requirement's outcome, each slow
 * vector skipped, each failed clause with its reason, and why the transcript
 * cannot be trusted.
 * An ERROR with no clause run shows the end of the compiler's output.
 *
 * @param r the result
 * @returns the report, one line per entry
 */
export const runFormatText = (r: RunResult): string[] => {
  const out: string[] = [`${r.verdict.status}: ${r.contract} (exit ${r.exitCode})`]
  for (let i = 0; i < r.verdict.requirements.length; i++) {
    out.push(`  ${runOutcomeName(r.verdict.outcomes[i])}  ${r.verdict.requirements[i]}`)
  }
  for (const k of r.clauses) {
    if (k.slow) {
      out.push(`  skip  ${k.id} (slow; pass --slow)`)
    }
  }
  for (const k of r.clauses) {
    if (k.outcome === RunOutcome.Fail) {
      out.push(k.detail.length > 0 ? `${runEscape(k.line)}\n      ${runEscape(k.detail)}` : runEscape(k.line))
    }
  }
  for (const m of r.integrity) {
    out.push(`integrity: ${runEscape(m)}`)
  }
  let anyRan = false
  for (const k of r.clauses) {
    if (k.outcome !== RunOutcome.NotRun) {
      anyRan = true
    }
  }
  if (r.verdict.status === "ERROR" && !anyRan) {
    for (const l of runTail(`${r.stdout}${r.stderr}`, 20)) {
      out.push(`  | ${runEscape(l)}`)
    }
  }
  return out
}

/**
 * A run's result as a markdown section for a PR comment: the verdict, then a
 * table of the requirements and their outcomes, then each slow vector
 * skipped, then each failure. What the
 * module printed goes only inside code spans, escaped by runEscape (which
 * leaves no backtick), so it cannot add links, HTML or table cells.
 *
 * @param r the result
 * @returns the markdown
 */
export const runFormatMarkdown = (r: RunResult): string => {
  const out: string[] = [`### \`${r.contract}\`: ${r.verdict.status}`, "", "| requirement | outcome |", "| --- | --- |"]
  for (let i = 0; i < r.verdict.requirements.length; i++) {
    out.push(`| ${r.verdict.requirements[i]} | ${runOutcomeName(r.verdict.outcomes[i])} |`)
  }
  const slow: string[] = []
  for (const k of r.clauses) {
    if (k.slow) {
      slow.push(`\`${k.id}\``)
    }
  }
  if (slow.length > 0) {
    out.push("")
    out.push(`Skipped as slow (pass \`--slow\` to run): ${slow.join(", ")}`)
  }
  for (const k of r.clauses) {
    if (k.outcome === RunOutcome.Fail) {
      out.push("")
      out.push(`- \`${runEscape(k.line)}\`${k.detail.length > 0 ? `: \`${runEscape(k.detail)}\`` : ""}`)
    }
  }
  if (r.integrity.length > 0) {
    out.push("")
    out.push("The transcript cannot be trusted:")
    for (const m of r.integrity) {
      out.push(`- \`${runEscape(m)}\``)
    }
  }
  return `${out.join("\n")}\n`
}

/**
 * A run's result as JSON: `{contract, status, exit, requirements: {id:
 * outcome}, clauses: [{id, outcome, detail}], integrity: [...]}`.
 *
 * @param r the result
 * @returns the JSON text, without a trailing newline
 */
export const runFormatJson = (r: RunResult): string => {
  const reqs: string[] = []
  for (let i = 0; i < r.verdict.requirements.length; i++) {
    reqs.push(`${emitQuote(r.verdict.requirements[i])}: ${emitQuote(runOutcomeName(r.verdict.outcomes[i]))}`)
  }
  const clauses: string[] = []
  for (const k of r.clauses) {
    clauses.push(
      `{"id": ${emitQuote(k.id)}, "outcome": ${emitQuote(runOutcomeName(k.outcome))}, "detail": ${emitQuote(k.detail)}}`,
    )
  }
  const integrity: string[] = []
  for (const m of r.integrity) {
    integrity.push(emitQuote(m))
  }
  return `{"contract": ${emitQuote(r.contract)}, "status": ${emitQuote(r.verdict.status)}, "exit": ${r.exitCode}, "requirements": {${reqs.join(", ")}}, "clauses": [${clauses.join(", ")}], "integrity": [${integrity.join(", ")}]}`
}
