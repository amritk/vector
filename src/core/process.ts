/**
 * `core/process` — running a child process with its input given and its
 * output collected. Every child vector starts goes through `runProcess`.
 */

import { utf8Bytes } from "./hex"

/** What a child process did: its exit status and everything it wrote. */
export class ProcessResult {
  /** The exit status, 128 plus the signal that ended it, or -1 when `timedOut`. */
  status: i32
  /** Everything the child wrote to standard output. */
  stdout: string
  /** Everything the child wrote to standard error. */
  stderr: string
  /** Whether the time limit passed and the child was killed; the output is what it wrote until then. */
  timedOut: boolean

  /**
   * Makes a result.
   *
   * @param status the exit status, or -1 when the child timed out
   * @param stdout the child's standard output
   * @param stderr the child's standard error
   * @param timedOut whether the time limit killed the child
   */
  constructor(status: i32, stdout: string, stderr: string, timedOut: boolean) {
    this.status = status
    this.stdout = stdout
    this.stderr = stderr
    this.timedOut = timedOut
  }
}

/**
 * Runs `argv` with `stdin` as its input and waits for it to exit, killing it
 * with SIGKILL once `timeoutMs` has passed. A child that runs out of time is
 * still `Ok`, with `timedOut` set and the output it wrote before the kill.
 *
 * @param argv the program and its arguments; `argv[0]` is looked up on PATH
 * @param stdin the text written to the child's standard input
 * @param timeoutMs the most milliseconds the child may run
 * @returns `Ok` with what the child did (`timedOut` when the limit killed it),
 *   or `Err` when it could not be run or wrote more than 16 MiB
 */
export const runProcess = (argv: string[], stdin: string, timeoutMs: i32): Result<ProcessResult, string> => {
  if (argv.length <= 0) {
    return Err("runProcess: no program given")
  }
  const program = argv[0]
  if (timeoutMs <= 0) {
    return Err(`runProcess: the time limit must be positive, not ${timeoutMs}`)
  }
  const out: u8[] = []
  const err: u8[] = []
  const status = spawnPipedWithin(argv, utf8Bytes(stdin), out, err, timeoutMs)
  const timedOut = status === -3
  if (status === -2) {
    return Err(`${program} wrote more than 16 MiB`)
  }
  if (status < 0 && !timedOut) {
    return Err(`cannot run ${program} (errno ${-toI64(status)})`)
  }
  return Ok(
    new ProcessResult(
      timedOut ? -1 : status,
      String.fromBytes(out, 0, toI32(out.length)),
      String.fromBytes(err, 0, toI32(err.length)),
      timedOut,
    ),
  )
}
