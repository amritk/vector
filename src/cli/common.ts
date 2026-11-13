/**
 * `cli/common` — what every command stub shares until its real handler lands.
 */

import { report, usageError } from "../core/diag"

/**
 * Reports that a command exists but has no handler yet, and answers the usage
 * exit code, so a stub's handler can end with `return notImplemented(...)`.
 *
 * @param path the command as typed, e.g. `spec check`
 * @returns `EXIT_USAGE` (2)
 */
export const notImplemented = (path: string): i32 => report(usageError(`${path}: not implemented yet`))
