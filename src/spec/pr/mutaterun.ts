/**
 * `spec/pr/mutaterun` — runs a test against each mutant of a module, several
 * at once. The nish checkout is copied once per job into a scratch directory
 * of its own (its .git left behind), so each copy's compiler builds against
 * its own std/ holding its own mutant. A mutant runs in two steps, both
 * timed: `<nish> <test> --link <bin>` builds the test against it, and a build
 * that fails makes it stillborn; then `<bin>` runs, and a nonzero exit kills
 * it. The test is given, not made here: generating it is `verify/emit`'s.
 */

import { trim } from "nish/text"
import { joinPath, makeTempDir, mkdirAll } from "../../core/fs"
import { runProcess } from "../../core/process"
import { contractLoadFile } from "../contract/contract"
import { shapeNishModuleFile } from "../contract/shape"
import { gitdiffChanged, gitdiffGit } from "./gitdiff"
import {
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
  /** The test program, an absolute path: what `verify/emit` writes. */
  test: string
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
   * @param test the test program, an absolute path
   * @param jobs how many mutants run at once; below 1 is 1
   * @param timeoutMs the time limit per step; 0 or less to derive it from the baseline
   */
  constructor(nishRoot: string, file: string, nish: string, test: string, jobs: i32, timeoutMs: i32) {
    this.nishRoot = nishRoot
    this.file = file
    this.nish = nish
    this.test = test
    this.jobs = jobs < 1 ? 1 : jobs
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

/** The argv that runs `argv` with its output, both streams, in `log`. */
const mutaterunLogged = (log: string, argv: string[]): string[] => {
  const out: string[] = ["sh", "-c", 'out=$1; shift; exec "$@" >"$out" 2>&1', "sh", log]
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

/**
 * Builds and runs the test against the unmutated module, in `dir`.
 *
 * @returns how long both steps took, in milliseconds, or a reason the test fails there
 */
const mutaterunBaseline = (run: MutateRun, dir: string, limitMs: i32): Result<i64, string> => {
  const start = monotonicNanos()
  const build = runProcess(mutaterunBuildArgv(run, dir), "", limitMs).orReturn()
  if (build.timedOut || build.status !== 0) {
    return Err(`it does not build: ${mutaterunLogTail(dir)}`)
  }
  const test = runProcess(mutaterunTestArgv(dir), "", limitMs).orReturn()
  if (test.timedOut) {
    return Err(`it ran past ${limitMs} ms`)
  }
  if (test.status !== 0) {
    return Err(`it exits ${test.status}: ${mutaterunLogTail(dir)}`)
  }
  return Ok((monotonicNanos() - start) / toI64(1000000))
}

/** Starts the next step in a slot: `argv`, ending by `limitMs` from now. */
const mutaterunStart = (
  slot: MutaterunSlot,
  argv: string[],
  building: boolean,
  limitMs: i32,
): Result<boolean, string> => {
  const pid = spawn(argv)
  if (pid < 0) {
    return Err(`cannot start ${argv[0]} (errno ${-pid})`)
  }
  slot.pid = pid
  slot.building = building
  slot.deadline = monotonicNanos() + toI64(limitMs) * toI64(1000000)
  return Ok(true)
}

/** Settles a mutant and frees its slot. */
const mutaterunSettle = (slot: MutaterunSlot, mutants: MutateMutant[], outcome: i32): void => {
  mutants[slot.mutant].outcome = outcome
  slot.pid = 0
  slot.mutant = -1
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
          if (slot.building && w[1] === 0) {
            const started = mutaterunStart(slot, mutaterunTestArgv(slot.dir), false, limitMs)
            if (started.isErr()) {
              failure = started.error
              mutaterunSettle(slot, mutants, MUTATE_STILLBORN)
              busy--
            }
          } else {
            const outcome = slot.building ? MUTATE_STILLBORN : w[1] === 0 ? MUTATE_SURVIVED : MUTATE_KILLED
            mutaterunSettle(slot, mutants, outcome)
            busy--
          }
        }
      }
    }
    const now = monotonicNanos()
    for (const slot of slots) {
      if (slot.pid !== 0 && now > slot.deadline) {
        kill(slot.pid, 9)
        waitPid(slot.pid, 0)
        mutaterunSettle(slot, mutants, MUTATE_TIMED_OUT)
        busy--
      }
    }
    if (busy > 0) {
      pollWait(loop, ready, 20)
    }
  }
  for (const slot of slots) {
    if (slot.pid !== 0) {
      kill(slot.pid, 9)
      waitPid(slot.pid, 0)
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
  const baseline = mutaterunBaseline(run, slots[0].dir, first)
  if (baseline.isErr()) {
    return Ok(baseline.error)
  }
  let limitMs = run.timeoutMs
  if (limitMs <= 0) {
    const derived = baseline.value * toI64(3)
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
 *   `Err` when the scratch copies cannot be made or a step cannot start
 */
export const mutateRunAll = (run: MutateRun, text: string, mutants: MutateMutant[]): Result<string | null, string> => {
  const passed: string | null = null
  if (mutants.length === 0) {
    return Ok(passed)
  }
  const scratch = makeTempDir("vector-mutate-").orReturn()
  const result = mutaterunIn(run, scratch, text, mutants)
  const removed = runProcess(["rm", "-rf", "--", scratch], "", MUTATERUN_COPY_MS)
  if (removed.isErr() && result.isOk()) {
    return Err(`cannot remove ${scratch}: ${removed.error}`)
  }
  return result
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
 *   is outside nish, git fails or the runner cannot work
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
    r.problems.push(`${run.nishRoot}/${file} cannot be read: is ${run.nishRoot} the nish checkout?`)
    return Ok(r)
  }
  const prefix = trim(gitdiffGit(run.nishRoot, ["rev-parse", "--show-prefix"]).orReturn())
  const changed = gitdiffChanged(run.nishRoot, base, [`${prefix}${file}`]).orReturn()
  const mutants: MutateMutant[] = changed.length > 0 ? mutatePick(mutateSites(text, changed[0]), max) : []
  const allow = c.allowSurvivors ?? []
  if (mutants.length === 0) {
    mutateJudge(r, file, mutants, allow, null)
    return Ok(r)
  }
  const baseline = mutateRunAll(run, text, mutants).orReturn()
  mutateJudge(r, file, mutants, allow, baseline)
  return Ok(r)
}
