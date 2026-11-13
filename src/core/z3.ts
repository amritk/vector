/**
 * `core/z3` — finding z3 and running one SMT-LIB2 script through it.
 *
 * z3 is found in this order: `$VECTOR_Z3` (which must name a file), `.z3/z3`
 * beside the repository the binary was built in (`dist/../.z3/z3`), and
 * finally `z3` on PATH. The working directory is never searched: running
 * vector inside a checkout must not run a z3 that checkout ships. Each script runs in
 * its own `z3 -in` process, and its answers are split by the `@@Q<i>` markers
 * (see `core/smt`).
 */

import { dirname, joinPath } from "./fs"
import { ProcessResult, runProcess } from "./process"
import { QueryAnswer, parseZ3Output, smtErrors } from "./smt"

const Z3_BASE_TIMEOUT_MS: i32 = 60000
const Z3_PER_QUERY_MS: i32 = 3000
const Z3_TIMEOUT_CAP_MS: i32 = 300000

/**
 * The wall-clock budget for a script: a base plus an allowance per query,
 * capped so a pathological script cannot hang a run.
 *
 * @param queryCount how many queries the script asks
 * @returns the budget in milliseconds
 */
export const z3Timeout = (queryCount: i32): i32 => {
  if (queryCount >= (Z3_TIMEOUT_CAP_MS - Z3_BASE_TIMEOUT_MS) / Z3_PER_QUERY_MS) {
    return Z3_TIMEOUT_CAP_MS
  }
  return Z3_BASE_TIMEOUT_MS + Math.max(queryCount, 0) * Z3_PER_QUERY_MS
}

/**
 * Finds the z3 executable to run.
 *
 * @returns `Ok` with a path (or the bare `z3`, for PATH), or `Err` when
 *   `$VECTOR_Z3` is set to something that is not a file
 */
export const resolveZ3 = (): Result<string, string> => {
  const fromEnv = getenv("VECTOR_Z3")
  if (fromEnv !== null && fromEnv.length !== 0) {
    if (realpathSync(fromEnv) === null || isDirectorySync(fromEnv)) {
      return Err(`VECTOR_Z3 is ${fromEnv}, which is not a file`)
    }
    return Ok(fromEnv)
  }
  // argv[0] is the name as typed: a bare `vector` found on PATH does not
  // resolve, so ask the kernel for the running binary first (Linux).
  const self = realpathSync("/proc/self/exe") ?? realpathSync(process.argv[0])
  if (self !== null) {
    const beside = joinPath(dirname(dirname(self)), ".z3/z3")
    if (isExecutableSync(beside)) {
      return Ok(beside)
    }
  }
  return Ok("z3")
}

/**
 * What one z3 run answered: a verdict per query, every `(error …)` line z3
 * printed, and how long it took.
 */
export class Z3Run {
  /** One answer per query, in query order. */
  answers: QueryAnswer[]
  /**
   * Every `(error …)` line z3 printed (see `smtErrors`). A rejected assertion
   * appears only here, so a caller that needs every assertion to hold refuses
   * a run with any; a failing `(get-model)` after `unsat` appears here too.
   */
  errors: string[]
  /** The wall-clock time the run took, in milliseconds. */
  millis: i32

  /**
   * Makes a run.
   *
   * @param answers one answer per query
   * @param errors every `(error …)` line z3 printed
   * @param millis the wall-clock time in milliseconds
   */
  constructor(answers: QueryAnswer[], errors: string[], millis: i32) {
    this.answers = answers
    this.errors = errors
    this.millis = millis
  }
}

// What to quote when a run failed: z3's first `(error …)` line on stdout,
// else the start of its stderr, else nothing.
const z3FailureDetail = (out: ProcessResult): string => {
  const errors = smtErrors(out.stdout)
  if (errors.length > 0) {
    return `: ${errors[0].substring(0, 500)}`
  }
  return out.stderr.length === 0 ? "" : `: ${out.stderr.substring(0, 500)}`
}

/**
 * Reads the answers out of one finished `z3 -in` run.
 *
 * Each of these is an error, however many markers the run wrote, since the
 * queries it never reached were not answered and must not read as `unknown`:
 * the time limit killed it; it exited nonzero (or by a signal) before writing
 * the last query's marker; or a script with queries produced no marker at
 * all. A nonzero exit alone is not an error: z3 carries on past a failing
 * command, such as `(get-model)` after `unsat`, and then exits 1. A message
 * quotes z3's first `(error …)` line, or its stderr.
 *
 * @param out what the z3 process did
 * @param bin the z3 that ran, for messages
 * @param queryCount how many `@@Q` markers the script writes
 * @param limitMs the time limit the run had, for messages
 * @returns `Ok` with one answer per query, or `Err` when the run timed out,
 *   stopped early, or answered nothing
 */
export const z3Verdicts = (
  out: ProcessResult,
  bin: string,
  queryCount: i32,
  limitMs: i32,
): Result<QueryAnswer[], string> => {
  if (out.timedOut) {
    return Err(`z3 (${bin}) did not finish ${queryCount} queries within ${limitMs} ms`)
  }
  if (out.status !== 0 && queryCount > 0 && out.stdout.indexOf(`@@Q${queryCount - 1}\n`) < 0) {
    return Err(`z3 (${bin}) exited ${out.status} before query ${queryCount - 1}${z3FailureDetail(out)}`)
  }
  if (queryCount > 0 && out.stdout.indexOf("@@Q") < 0) {
    return Err(`z3 (${bin}) produced no verdicts${z3FailureDetail(out)}`)
  }
  return Ok(parseZ3Output(out.stdout, queryCount))
}

/**
 * Runs one SMT-LIB2 script through `z3 -in`, within `z3Timeout(queryCount)`.
 * The script writes `(echo "@@Q<i>")` before query `i`'s `(check-sat)`.
 *
 * @param script the SMT-LIB2 script
 * @param queryCount how many `@@Q` markers the script writes
 * @returns `Ok` with the answers and z3's `(error …)` lines, or `Err` when z3
 *   cannot be found or run, runs
 *   out of time, stops before its last query, or ran none of the queries
 */
export const runZ3 = (script: string, queryCount: i32): Result<Z3Run, string> => {
  const bin = resolveZ3().orReturn()
  const started = monotonicNanos()
  const limitMs = z3Timeout(queryCount)
  const ran = runProcess([bin, "-in"], script, limitMs)
  if (ran.isErr()) {
    return Err(`failed to run z3 (${bin}): ${ran.error}`)
  }
  const answers = z3Verdicts(ran.value, bin, queryCount, limitMs).orReturn()
  const millis = toI32((monotonicNanos() - started) / 1000000)
  return Ok(new Z3Run(answers, smtErrors(ran.value.stdout), millis))
}
