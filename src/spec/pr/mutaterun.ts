/**
 * `spec/pr/mutaterun` — runs a test against each mutant of a module, several
 * at once. The nish checkout is copied once per job into a scratch directory
 * of its own (its .git left behind), so each copy's compiler builds against
 * its own std/ holding its own mutant. A mutant runs in two steps, both
 * timed: `<nish> <test> --link <bin>` builds the test against it, and a build
 * the compiler refuses with an error located in the module or the test makes
 * it stillborn, while any other failed build (a crash, a kill, a full disk,
 * no binary) stops the run, as the tool's failure, not the mutant's; one
 * that runs past its time is counted apart (MUTATE_BUILD_TIMED_OUT); then `<bin>` runs, and
 * a nonzero exit kills it, while running past its time is counted apart
 * (MUTATE_TIMED_OUT), as neither a kill nor a survival. Every copy runs the
 * unmutated baseline first, so a broken copy cannot pass off as a kill. The test is given, not made here: generating it is `verify/emit`'s.
 */

import { splitLines, trim } from "nish/text"
import { EXIT_USAGE } from "../../core/diag"
import { joinPath, makeTempDir, mkdirAll } from "../../core/fs"
import { runProcess } from "../../core/process"
import { contractLoadFile } from "../contract/contract"
import { shapeNishModuleFile } from "../contract/shape"
import { emitContractFile } from "../emit/file"
import { EmitPackages } from "../emit/packages"
import { EmitTarget } from "../emit/target"
import { gitdiffChanged, gitdiffPrefix } from "./gitdiff"
import {
  MUTATE_BUILD_TIMED_OUT,
  MUTATE_KILLED,
  MUTATE_STILLBORN,
  MUTATE_SURVIVED,
  MUTATE_TIMED_OUT,
  MutateMutant,
  mutateApply,
  mutateJudge,
  mutatePick,
  mutateSites,
} from "./mutate"
import { PrReport } from "./report"

/** The longest copying a nish checkout may take, in milliseconds. */
export const MUTATERUN_COPY_MS: i32 = 120000
/** The least time a mutant's build or run is given, in milliseconds. */
export const MUTATERUN_MIN_TIMEOUT_MS: i32 = 10000

/** How to run the test against the mutants. */
export class MutateRun {
  /** The nish checkout: bin/, std/ and the compiler's own files. */
  nishRoot: string
  /** The module mutated, from the nish root, such as std/hex.ts. */
  file: string
  /** The compiler, from the nish root, such as bin/nish. */
  nish: string
  /** The test program, an absolute path; "" to emit it from the contract, as `spec emit` does. */
  test: string
  /** The emitted test's source, written beside the scratch copies when `test` is ""; null until emitted. */
  program: string | null = null
  /** How many mutants run at once. */
  jobs: i32
  /** The most milliseconds a build or run may take; 0 or less for three times the baseline's, at least MUTATERUN_MIN_TIMEOUT_MS. */
  timeoutMs: i32

  /**
   * Makes the settings for a run.
   *
   * @param nishRoot the nish checkout
   * @param file the module, from the nish root ("" until the contract names it)
   * @param nish the compiler, from the nish root
   * @param test the test program, an absolute path; "" to emit it from the contract
   * @param jobs how many mutants run at once; below 1 is 1, above the machine's CPUs is their count
   * @param timeoutMs the time limit per step; 0 or less to derive it from the baseline
   */
  constructor(nishRoot: string, file: string, nish: string, test: string, jobs: i32, timeoutMs: i32) {
    this.nishRoot = nishRoot
    this.file = file
    this.nish = nish
    this.test = test
    const cpus = availableParallelism()
    this.jobs = jobs < 1 ? 1 : jobs > cpus ? cpus : jobs
    this.timeoutMs = timeoutMs
  }
}

/** One copy of the nish checkout, and what runs in it. */
class MutaterunSlot {
  /** The copy's directory. */
  dir: string
  /** The running child's pid, or 0 when the slot is idle. */
  pid: i32 = 0
  /** Whether the child is the build (true) or the test binary (false). */
  building: boolean
  /** The index of the mutant in the slot, or -1. */
  mutant: i32 = -1
  /** When the child must have exited, from monotonicNanos. */
  deadline: i64 = 0

  /**
   * Makes a slot.
   *
   * @param dir the copy's directory
   */
  constructor(dir: string) {
    this.dir = dir
    this.building = false
  }
}

/**
 * The argv that runs `argv` with its output, both streams, in `log`, with
 * colour off (`NO_COLOR`, and no `FORCE_COLOR` or `CLICOLOR_FORCE`) so a
 * diagnostic reads as plain text. Where
 * `setsid` exists the step leads a process group of its own, so a timeout
 * kills what it started too; setsid execs in place, keeping the pid.
 */
const mutaterunLogged = (log: string, argv: string[]): string[] => {
  const out: string[] = [
    "sh",
    "-c",
    'out=$1; shift; unset FORCE_COLOR CLICOLOR_FORCE; NO_COLOR=1; export NO_COLOR; if command -v setsid >/dev/null 2>&1; then exec setsid "$@" >"$out" 2>&1; fi; exec "$@" >"$out" 2>&1',
    "sh",
    log,
  ]
  for (const a of argv) {
    out.push(a)
  }
  return out
}

/** The build's argv in a slot. */
const mutaterunBuildArgv = (run: MutateRun, dir: string): string[] =>
  mutaterunLogged(joinPath(dir, "mutant.log"), [
    joinPath(dir, run.nish),
    run.test,
    "--link",
    joinPath(dir, "mutant.bin"),
  ])

/** The test binary's argv in a slot. */
const mutaterunTestArgv = (dir: string): string[] =>
  mutaterunLogged(joinPath(dir, "mutant.log"), [joinPath(dir, "mutant.bin")])

/** Copies the nish checkout but its .git into `dest`. */
const mutaterunCopy = (root: string, dest: string): Result<boolean, string> => {
  mkdirAll(dest, 0o700).orReturn()
  const r = runProcess(
    ["sh", "-c", 'tar -C "$1" --exclude=./.git -cf - . | tar -C "$2" -xf -', "sh", root, dest],
    "",
    MUTATERUN_COPY_MS,
  ).orReturn()
  if (r.status !== 0 || r.timedOut) {
    return Err(`cannot copy ${root} to ${dest}: ${r.stderr}`)
  }
  return Ok(true)
}

/** The last lines of a step's log, for a message. */
const mutaterunLogTail = (dir: string): string => {
  const text = readFileSyncOrNull(joinPath(dir, "mutant.log")) ?? ""
  const t = text.length > 400 ? text.substring(text.length - 400) : text
  return t.length > 0 ? t : "(no output)"
}

/** What the unmutated module did: how long it took, or why the test refuses it. */
class MutaterunBaseline {
  /** How long the build and the run took, in milliseconds. */
  ms: i64
  /** Why the test fails on the unmutated module, or "" when it passes. */
  refusal: string

  /**
   * Makes a baseline's result.
   *
   * @param ms how long both steps took
   * @param refusal why the test fails there, or ""
   */
  constructor(ms: i64, refusal: string) {
    this.ms = ms
    this.refusal = refusal
  }
}

/**
 * Builds and runs the test against the unmutated module, in `dir`. The
 * compiler refusing the module or the test, or the test failing, refuses
 * the change; a build that runs past its time, fails with no located error
 * or writes no binary is the tool's failure.
 *
 * @returns how long both steps took or why the test refuses, or `Err` when the tool fails
 */
const mutaterunBaseline = (run: MutateRun, dir: string, limitMs: i32): Result<MutaterunBaseline, string> => {
  const start = monotonicNanos()
  unlinkSync(joinPath(dir, "mutant.bin"))
  const build = runProcess(mutaterunBuildArgv(run, dir), "", limitMs).orReturn()
  if (build.timedOut) {
    return Err(`the unmutated module's build ran past ${limitMs} ms: ${mutaterunLogTail(dir)}`)
  }
  if (build.status !== 0) {
    const log = readFileSyncOrNull(joinPath(dir, "mutant.log")) ?? ""
    if (!mutaterunRefused(run, dir, log)) {
      return Err(
        `the unmutated module's build exits ${build.status} with no error located in ${run.file}: ${mutaterunLogTail(dir)}`,
      )
    }
    return Ok(new MutaterunBaseline(0, `it does not build: ${mutaterunLogTail(dir)}`))
  }
  if (realpathSync(joinPath(dir, "mutant.bin")) === null) {
    return Err(`the unmutated module's build exits 0 but writes no binary: ${mutaterunLogTail(dir)}`)
  }
  const test = runProcess(mutaterunTestArgv(dir), "", limitMs).orReturn()
  if (test.timedOut) {
    return Ok(new MutaterunBaseline(0, `it ran past ${limitMs} ms`))
  }
  if (test.status !== 0) {
    return Ok(new MutaterunBaseline(0, `it exits ${test.status}: ${mutaterunLogTail(dir)}`))
  }
  return Ok(new MutaterunBaseline((monotonicNanos() - start) / toI64(1000000), ""))
}

/** The line the canary build appends to the module: no module can hold it. */
const MUTATERUN_CANARY: string = "\n)vector mutate canary(\n"

/**
 * Checks that the compiler builds from the copy in `dir`: the module, made
 * unparseable there, must be refused with an error located in it. A compiler
 * that reads another install's std (an installed wrapper that execs by
 * absolute path, say) builds it anyway, and would let every mutant pass
 * unseen, so that is a tool failure. The module is restored after.
 */
const mutaterunCanary = (run: MutateRun, dir: string, text: string, limitMs: i32): Result<boolean, string> => {
  const module = joinPath(dir, run.file)
  writeFileSync(module, `${text}${MUTATERUN_CANARY}`)
  unlinkSync(joinPath(dir, "mutant.bin"))
  const build = runProcess(mutaterunBuildArgv(run, dir), "", limitMs)
  writeFileSync(module, text)
  const b = build.orReturn()
  if (b.timedOut) {
    return Err(`the canary build (the module made unparseable) ran past ${limitMs} ms: ${mutaterunLogTail(dir)}`)
  }
  if (b.status === 0) {
    return Err(
      `the compiler ${run.nish} builds the test even with ${run.file} made unparseable in the copy, so it does not read the copy (an installed wrapper that execs another install by absolute path?): give a --nish that builds from the checkout it sits in`,
    )
  }
  const log = readFileSyncOrNull(joinPath(dir, "mutant.log")) ?? ""
  if (!mutaterunRefused(run, dir, log)) {
    return Err(
      `the canary build (the module made unparseable) exits ${b.status} with no error located in ${run.file}: ${mutaterunLogTail(dir)}`,
    )
  }
  return Ok(true)
}

/** Starts the next step in a slot: `argv`, ending by `limitMs` from now. */
const mutaterunStart = (
  slot: MutaterunSlot,
  argv: string[],
  building: boolean,
  limitMs: i32,
): Result<boolean, string> => {
  if (building) {
    unlinkSync(joinPath(slot.dir, "mutant.bin"))
  }
  const pid = spawn(argv)
  if (pid < 0) {
    return Err(`cannot start ${argv[0]} (errno ${-pid})`)
  }
  slot.pid = pid
  slot.building = building
  slot.deadline = monotonicNanos() + toI64(limitMs) * toI64(1000000)
  return Ok(true)
}

/** Kills a step and its process group, then reaps it. */
const mutaterunKill = (pid: i32): void => {
  const group = runProcess(["kill", "-9", "--", `-${pid}`], "", MUTATERUN_MIN_TIMEOUT_MS)
  if (group.isErr() || group.value.status !== 0) {
    kill(pid, 9)
  }
  waitPid(pid, 0)
}

/** Settles a mutant and frees its slot. */
const mutaterunSettle = (slot: MutaterunSlot, mutants: MutateMutant[], outcome: i32): void => {
  mutants[slot.mutant].outcome = outcome
  slot.pid = 0
  slot.mutant = -1
}

/** What one step's exit did: how many mutants it settled (0 or 1), and why the run cannot go on, or "". */
class MutaterunStep {
  /** Mutants settled: 0 when the build passed and the test started. */
  settled: i32
  /** Why the run cannot go on, or "". */
  failure: string

  /**
   * Makes a step's result.
   *
   * @param settled mutants settled
   * @param failure why the run cannot go on, or ""
   */
  constructor(settled: i32, failure: string) {
    this.settled = settled
    this.failure = failure
  }
}

/** Whether `text[from, to)` is one or more digits. */
const mutaterunDigits = (text: string, from: i32, to: i32): boolean => {
  if (to <= from) {
    return false
  }
  for (let i = from; i < to; i++) {
    const c = text.charCodeAt(i)
    if (c < 0x30 || c > 0x39) {
      return false
    }
  }
  return true
}

/** Whether `text` is one or more lowercase letters. */
const mutaterunWord = (text: string): boolean => {
  if (text.length === 0) {
    return false
  }
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c < 0x61 || c > 0x7a) {
      return false
    }
  }
  return true
}

/**
 * The path of a compiler diagnostic line, `<path>:<line>:<col>: [word ]error: …`,
 * or "" when the line is not one.
 */
const mutaterunDiagnosticPath = (line: string): string => {
  let at = line.indexOf(":")
  while (at > 0) {
    const a = line.indexOf(":", at + 1)
    const b = a < 0 ? -1 : line.indexOf(": ", a + 1)
    if (a > 0 && b > 0 && mutaterunDigits(line, at + 1, a) && mutaterunDigits(line, a + 1, b)) {
      const rest = line.substring(b + 2)
      const e = rest.indexOf("error: ")
      const before = e < 0 ? "" : rest.substring(0, e)
      const word = before.length > 1 && before.endsWith(" ") && mutaterunWord(before.substring(0, before.length - 1))
      return e === 0 || word ? line.substring(0, at) : ""
    }
    at = line.indexOf(":", at + 1)
  }
  return ""
}

/** `text` without its terminal escapes: CSI sequences (`ESC [ … final`) and two-byte `ESC x`. */
const mutaterunPlain = (text: string): string => {
  if (text.indexOf("\x1b") < 0) {
    return text
  }
  const out: string[] = []
  let from = 0
  let i = 0
  while (i < text.length) {
    if (text.charCodeAt(i) !== 0x1b) {
      i = i + 1
      continue
    }
    out.push(text.substring(from, i))
    let j = i + 1
    if (j < text.length && text.charCodeAt(j) === 0x5b) {
      j = j + 1
      while (j < text.length && (text.charCodeAt(j) < 0x40 || text.charCodeAt(j) > 0x7e)) {
        j = j + 1
      }
    }
    i = j < text.length ? j + 1 : j
    from = i
  }
  out.push(text.substring(from))
  return out.join("")
}

/** `path` without leading `./` segments. */
const mutaterunUndot = (path: string): string => {
  let p = path
  while (p.startsWith("./")) {
    p = p.substring(2)
  }
  return p
}

/**
 * Whether a log line is one of the compiler's tallies: `N error(s)`, or
 * `...and N more error(s)` when it stops listing them.
 */
const mutaterunTally = (line: string): boolean => {
  const rest = line.startsWith("...and ") ? line.substring(7) : line
  const sp = rest.indexOf(" ")
  if (sp <= 0 || !mutaterunDigits(rest, 0, sp)) {
    return false
  }
  const tail = line.startsWith("...and ") ? rest.substring(sp + 1) : `more ${rest.substring(sp + 1)}`
  return tail === "more error" || tail === "more errors"
}

/**
 * Whether a diagnostic's path names the mutated module or the test: the
 * module as the compiler prints it, from the root (`std/m.ts`) or under the
 * copy `dir`, and the test as given; both without leading `./`, compared
 * exactly.
 */
const mutaterunOwnPath = (run: MutateRun, dir: string, path: string): boolean => {
  const p = mutaterunUndot(path)
  const file = mutaterunUndot(run.file)
  return p === file || p === `${dir}/${file}` || p === mutaterunUndot(run.test)
}

/**
 * Whether a failed build's log is the compiler refusing the mutant: some
 * line is an error diagnostic, and every unindented line that mentions an
 * error is one located in the mutated module or the test, or a tally of
 * them. Colour escapes are stripped first. Anything else, a crash, a kill
 * or a full disk, is not the mutant's doing.
 */
const mutaterunRefused = (run: MutateRun, dir: string, log: string): boolean => {
  let located = false
  for (const line of splitLines(mutaterunPlain(log))) {
    const c = line.length > 0 ? line.charCodeAt(0) : 0x20
    if (c === 0x20 || c === 0x09 || line.indexOf("error") < 0 || mutaterunTally(line)) {
      continue
    }
    if (!mutaterunOwnPath(run, dir, mutaterunDiagnosticPath(line))) {
      return false
    }
    located = true
  }
  return located
}

/** Handles a slot's step exiting with `status`: a built mutant moves on to its test, anything else settles it. */
const mutaterunExited = (
  run: MutateRun,
  slot: MutaterunSlot,
  mutants: MutateMutant[],
  status: i32,
  limitMs: i32,
): MutaterunStep => {
  if (slot.building && status === 0 && realpathSync(joinPath(slot.dir, "mutant.bin")) === null) {
    const tail = mutaterunLogTail(slot.dir)
    mutaterunSettle(slot, mutants, MUTATE_STILLBORN)
    return new MutaterunStep(1, `a mutant's build exits 0 but writes no binary: ${tail}`)
  }
  if (slot.building && status !== 0) {
    const log = readFileSyncOrNull(joinPath(slot.dir, "mutant.log")) ?? ""
    const tail = mutaterunLogTail(slot.dir)
    mutaterunSettle(slot, mutants, MUTATE_STILLBORN)
    if (mutaterunRefused(run, slot.dir, log)) {
      return new MutaterunStep(1, "")
    }
    return new MutaterunStep(
      1,
      `a mutant's build exits ${status} with no error located in ${run.file}, so the compiler failed, not the mutant: ${tail}`,
    )
  }
  if (slot.building && status === 0) {
    const started = mutaterunStart(slot, mutaterunTestArgv(slot.dir), false, limitMs)
    if (started.isErr()) {
      mutaterunSettle(slot, mutants, MUTATE_STILLBORN)
      return new MutaterunStep(1, started.error)
    }
    return new MutaterunStep(0, "")
  }
  mutaterunSettle(slot, mutants, status === 0 ? MUTATE_SURVIVED : MUTATE_KILLED)
  return new MutaterunStep(1, "")
}

/** Runs every mutant over the slots, each settled by the end. */
const mutaterunLoop = (
  run: MutateRun,
  text: string,
  mutants: MutateMutant[],
  slots: MutaterunSlot[],
  limitMs: i32,
): Result<boolean, string> => {
  const loop = pollCreate()
  if (loop < 0) {
    return Err(`cannot make a poll loop (errno ${-loop})`)
  }
  const ready: i32[] = [0, 0]
  let next = 0
  let busy = 0
  let failure = ""
  while (failure.length === 0 && (next < mutants.length || busy > 0)) {
    for (const slot of slots) {
      if (slot.pid === 0 && next < mutants.length && failure.length === 0) {
        writeFileSync(joinPath(slot.dir, run.file), mutateApply(text, mutants[next]))
        slot.mutant = toI32(next)
        next++
        const started = mutaterunStart(slot, mutaterunBuildArgv(run, slot.dir), true, limitMs)
        if (started.isErr()) {
          failure = started.error
        } else {
          busy++
        }
      }
    }
    let reaped = true
    while (reaped) {
      const w = waitPid(-1, 1)
      reaped = w[0] > 0
      for (const slot of slots) {
        if (reaped && slot.pid === w[0]) {
          const step = mutaterunExited(run, slot, mutants, w[1], limitMs)
          busy -= step.settled
          if (step.failure.length > 0) {
            failure = step.failure
          }
        }
      }
    }
    const now = monotonicNanos()
    for (const slot of slots) {
      if (slot.pid !== 0 && now > slot.deadline) {
        const late = waitPid(slot.pid, 1)
        if (late[0] === slot.pid) {
          const step = mutaterunExited(run, slot, mutants, late[1], limitMs)
          busy -= step.settled
          if (step.failure.length > 0) {
            failure = step.failure
          }
        } else {
          mutaterunKill(slot.pid)
          mutaterunSettle(slot, mutants, slot.building ? MUTATE_BUILD_TIMED_OUT : MUTATE_TIMED_OUT)
          busy--
        }
      }
    }
    if (busy > 0) {
      pollWait(loop, ready, 20)
    }
  }
  for (const slot of slots) {
    if (slot.pid !== 0) {
      mutaterunKill(slot.pid)
      slot.pid = 0
    }
  }
  fileClose(loop)
  return failure.length > 0 ? Err(failure) : Ok(true)
}

/** Copies the checkout into the slots, runs the baseline, then the mutants. */
const mutaterunIn = (
  run: MutateRun,
  scratch: string,
  text: string,
  mutants: MutateMutant[],
): Result<string | null, string> => {
  const slots: MutaterunSlot[] = []
  const n = run.jobs < mutants.length ? run.jobs : toI32(mutants.length)
  for (let i = 0; i < n; i++) {
    const dir = joinPath(scratch, `slot${i}`)
    mutaterunCopy(run.nishRoot, dir).orReturn()
    slots.push(new MutaterunSlot(dir))
  }
  const first = run.timeoutMs > 0 ? run.timeoutMs : MUTATERUN_COPY_MS
  let slowest: i64 = 0
  for (let i = 0; i < slots.length; i++) {
    const where = i > 0 ? `in copy ${i + 1} of ${slots.length}, ` : ""
    const baseline = mutaterunBaseline(run, slots[i].dir, first)
    if (baseline.isErr()) {
      return Err(`${where}${baseline.error}`)
    }
    if (baseline.value.refusal.length > 0) {
      return Ok(`${where}${baseline.value.refusal}`)
    }
    if (baseline.value.ms > slowest) {
      slowest = baseline.value.ms
    }
  }
  mutaterunCanary(run, slots[0].dir, text, first).orReturn()
  let limitMs = run.timeoutMs
  if (limitMs <= 0) {
    const derived = slowest * toI64(3)
    limitMs = derived > toI64(MUTATERUN_MIN_TIMEOUT_MS) ? toI32(derived) : MUTATERUN_MIN_TIMEOUT_MS
  }
  mutaterunLoop(run, text, mutants, slots, limitMs).orReturn()
  const passed: string | null = null
  return Ok(passed)
}

/**
 * Runs the test against the unmutated module, then against each mutant,
 * setting each mutant's outcome. The scratch copies are removed after.
 *
 * @param run where and how to run the test
 * @param text the module as it is
 * @param mutants the mutants to run, at least one
 * @returns `Ok(null)` when the test passed on the unmutated module and every
 *   mutant was run; `Ok(reason)` when it failed there, and no mutant was run;
 *   `Err` when the scratch copies cannot be made, a step cannot start, or a
 *   build fails for the tool, not the module
 */
export const mutateRunAll = (run: MutateRun, text: string, mutants: MutateMutant[]): Result<string | null, string> => {
  const passed: string | null = null
  if (mutants.length === 0) {
    return Ok(passed)
  }
  const scratch = makeTempDir("vector-mutate-").orReturn()
  const result = mutaterunWithTest(run, scratch, text, mutants)
  const removed = runProcess(["rm", "-rf", "--", scratch], "", MUTATERUN_COPY_MS)
  if (removed.isErr() && result.isOk()) {
    return Err(`cannot remove ${scratch}: ${removed.error}`)
  }
  return result
}

/**
 * Runs the mutants in `scratch`, first writing the emitted test there when
 * the run has a program but no test file.
 */
const mutaterunWithTest = (
  run: MutateRun,
  scratch: string,
  text: string,
  mutants: MutateMutant[],
): Result<string | null, string> => {
  const program = run.program
  if (run.test === "" && program !== null) {
    const test = joinPath(scratch, "spec_test.ts")
    const n = createFileExclusiveSync(test, program, 0o644)
    if (n < 0) {
      return Err(`cannot write the emitted test ${test} (errno ${-n})`)
    }
    run.test = test
  }
  return mutaterunIn(run, scratch, text, mutants)
}

/**
 * The contract's test as `spec emit` writes it, for a run given no `--test`:
 * `Ok(null)` with the refusals added to `r` when the contract is refused,
 * `Err` when it cannot be read or a tool its check needs (z3) failed, which
 * the command exits 2 on.
 */
const mutaterunEmit = (contractPath: string, r: PrReport): Result<string | null, string> => {
  const emitted = emitContractFile(contractPath, null, new EmitPackages(), ".", new EmitTarget("nish", "standalone"))
  if (emitted.isOk()) {
    return Ok(emitted.value.program)
  }
  const none: string | null = null
  for (const d of emitted.error) {
    if (d.code === EXIT_USAGE) {
      return Err(d.message)
    }
    r.problems.push(`the contract's test cannot be emitted: ${d.message}`)
  }
  return Ok(none)
}

/**
 * Whether `root` is a nish source checkout that has not been built: it has the
 * bootstrap script and the npm launcher, and no `build/nish`. Such a checkout
 * has no compiler that reads it, which a bare "not an executable file" hides.
 */
const mutaterunUnbuilt = (root: string): Result<boolean, string> => {
  const r = runProcess(
    [
      "test",
      "-f",
      joinPath(root, "scripts/bootstrap.sh"),
      "-a",
      "-f",
      joinPath(root, "bin/launcher.js"),
      "-a",
      "!",
      "-e",
      joinPath(root, "build/nish"),
    ],
    "",
    MUTATERUN_MIN_TIMEOUT_MS,
  ).orReturn()
  return Ok(r.status === 0)
}

/**
 * Mutates the lines a change added to a contract's target module, in the
 * nish checkout at `run.nishRoot`, and runs the test against each mutant.
 *
 * @param contractPath the contract file
 * @param base the ref the change is against
 * @param run where and how to run the test: its `file` is filled in from the contract
 * @param max the most mutants to run; 0 or less runs all
 * @returns the report, or `Err` when the contract cannot be read, its target
 *   is outside nish, the root is a nish checkout with no compiler built, the
 *   module cannot be lexed, git fails or the runner cannot work
 */
export const mutateCheck = (contractPath: string, base: string, run: MutateRun, max: i32): Result<PrReport, string> => {
  const loaded = contractLoadFile(contractPath)
  if (loaded.isErr()) {
    return Err(`${contractPath}: not a contract: ${loaded.error.join("; ")}`)
  }
  const c = loaded.value
  const file = shapeNishModuleFile(c.target.module)
  if (file === null) {
    return Err(`${contractPath}: target.module ${c.target.module} is not a nish module (nish/<path>)`)
  }
  run.file = file
  const r = new PrReport("mutate", `spec mutate ${file} against ${base}`)
  const text = readFileSyncOrNull(`${run.nishRoot}/${file}`)
  if (text === null) {
    return Err(`${run.nishRoot}/${file} cannot be read: is ${run.nishRoot} the nish checkout?`)
  }
  const compiler = joinPath(run.nishRoot, run.nish)
  const status = runProcess(["test", "-f", compiler, "-a", "-x", compiler], "", MUTATERUN_MIN_TIMEOUT_MS).orReturn()
  const runnable = status.status === 0
  const launcher = run.nish === "bin/nish" || run.nish === "./bin/nish"
  if ((!runnable || launcher) && mutaterunUnbuilt(run.nishRoot).orReturn()) {
    const what = runnable ? "is the npm launcher, not a compiler" : "is not an executable file"
    return Err(
      `the compiler ${compiler} ${what}: ${run.nishRoot} is a nish checkout with no build/nish. Build one there with \`bash scripts/fetch-seed.sh && npm run build\`, or \`NISH_BOOTSTRAP=<an installed nish> npm run build\`, then give --nish build/nish`,
    )
  }
  const prefix = gitdiffPrefix(run.nishRoot).orReturn()
  const changed = gitdiffChanged(run.nishRoot, base, [`${prefix}${file}`]).orReturn()
  let all: MutateMutant[] = []
  if (changed.length > 0) {
    const sites = mutateSites(text, changed[0])
    if (sites.isErr()) {
      return Err(`${run.nishRoot}/${file} cannot be mutated: ${sites.error}`)
    }
    all = sites.value
  }
  const mutants = mutatePick(all, max)
  const dropped = toI32(all.length) - toI32(mutants.length)
  const allow = c.allowSurvivors ?? []
  if (mutants.length === 0) {
    mutateJudge(r, file, mutants, allow, null, dropped)
    return Ok(r)
  }
  if (run.test === "") {
    const program = mutaterunEmit(contractPath, r).orReturn()
    if (program === null) {
      return Ok(r)
    }
    run.program = program
  } else if (realpathSync(run.test) === null) {
    return Err(`the test ${run.test} cannot be read`)
  }
  if (!runnable) {
    return Err(`the compiler ${compiler} is not an executable file`)
  }
  const baseline = mutateRunAll(run, text, mutants).orReturn()
  mutateJudge(r, file, mutants, allow, baseline, dropped)
  return Ok(r)
}
