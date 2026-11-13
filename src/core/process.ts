/**
 * `core/process` — running a child process with its input given and its
 * output collected. Every child vector starts goes through `runProcess`.
 */

import { utf8Bytes } from "./hex"

/** What a child process did: its exit status and everything it wrote. */
export class ProcessResult {
  /** The exit status, or 128 plus the signal that ended it. */
  status: i32
  /** Everything the child wrote to standard output. */
  stdout: string
  /** Everything the child wrote to standard error. */
  stderr: string

  /**
   * Makes a result.
   *
   * @param status the exit status
   * @param stdout the child's standard output
   * @param stderr the child's standard error
   */
  constructor(status: i32, stdout: string, stderr: string) {
    this.status = status
    this.stdout = stdout
    this.stderr = stderr
  }
}

/**
 * Runs `argv` with `stdin` as its input and waits for it to exit.
 *
 * The time limit is not enforced yet: Nish 0.38 has no way to wait on a piped
 * child with a deadline, and `spawnPipedWithin` arrives in 0.39. Callers pass
 * the limit they mean so that switching over changes only this function.
 *
 * @param argv the program and its arguments; `argv[0]` is looked up on PATH
 * @param stdin the text written to the child's standard input
 * @param timeoutMs the most milliseconds the child may run
 * @returns `Ok` with what the child did, or `Err` when it could not be run or
 *   wrote more than 16 MiB
 */
export const runProcess = (argv: string[], stdin: string, timeoutMs: i32): Result<ProcessResult, string> => {
  if (argv.length === 0) {
    return Err("runProcess: no program given")
  }
  if (timeoutMs <= 0) {
    return Err(`runProcess: the time limit must be positive, not ${timeoutMs}`)
  }
  const out: u8[] = []
  const err: u8[] = []
  const status = spawnPiped(argv, utf8Bytes(stdin), out, err)
  if (status === -2) {
    return Err(`${argv[0]} wrote more than 16 MiB`)
  }
  if (status < 0) {
    return Err(`cannot run ${argv[0]} (errno ${-status})`)
  }
  return Ok(
    new ProcessResult(status, String.fromBytes(out, 0, toI32(out.length)), String.fromBytes(err, 0, toI32(err.length))),
  )
}
