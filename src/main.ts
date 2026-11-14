/**
 * `vector` — the binary's entry point. It hands the process's arguments to
 * `vectorRun` (`src/index.ts`, the package's entry), which declares every
 * command, parses the arguments and runs the matched command.
 */

import { vectorRun } from "./index"

/**
 * Runs vector with the process's arguments.
 *
 * @returns the exit code: 0 pass, 1 refused, 2 usage or I/O
 */
export const main = (): i32 => vectorRun(process.argv.slice(1))
