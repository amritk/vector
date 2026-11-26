/**
 * `vector` — the binary's entry point. It hands the process's arguments to
 * `vectorRun` (`src/index.ts`, the package's entry), which declares every
 * command, parses the arguments and runs the matched command.
 */

import { vectorRun } from "./index"

/** The process's arguments after the program's name, copied one by one so no slice can fail. */
const mainArgs = (): string[] => {
  const out: string[] = []
  let first = true
  for (const arg of process.argv) {
    if (!first) {
      out.push(arg)
    }
    first = false
  }
  return out
}

/**
 * Runs vector with the process's arguments.
 *
 * @returns the exit code: 0 pass, 1 refused, 2 usage, I/O or tool failure, or a replay `MISMATCH`
 */
export const main = (): i32 => vectorRun(mainArgs())
