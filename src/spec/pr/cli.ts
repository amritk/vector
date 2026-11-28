/**
 * `spec/pr/cli` — what the PR gates' commands share: reading `--format` and
 * `--base`, and printing a report with the exit code it earns.
 */

import { CliFlag, ParseResult } from "nish/cli-args"
import { EXIT_PASS, EXIT_REFUSED, report, usageError } from "../../core/diag"
import { gitdiffBaseProblem } from "./gitdiff"
import { PrReport, prFormatProblem, prRender } from "./report"

/**
 * The `--format` a gate prints in.
 *
 * @param r the parsed arguments
 * @param flag the `--format` flag
 * @returns text when not given, the format given, or `Err` when it is not one a gate prints
 */
export const prCliFormat = (r: ParseResult, flag: CliFlag): Result<string, string> => {
  const format = r.readValue(flag) ?? "text"
  const problem = prFormatProblem(format)
  if (problem !== null) {
    return Err(problem)
  }
  return Ok(format)
}

/**
 * The `--base` a gate compares against.
 *
 * @param r the parsed arguments
 * @param flag the `--base` flag
 * @returns the ref, or `Err` when it is missing or refused (gitdiffBaseProblem)
 */
export const prCliBase = (r: ParseResult, flag: CliFlag): Result<string, string> => {
  const base = r.readValue(flag)
  if (base === null) {
    return Err("--base <ref> is required: the commit the change is against, such as origin/main")
  }
  const problem = gitdiffBaseProblem(base)
  if (problem !== null) {
    return Err(problem)
  }
  return Ok(base)
}

/**
 * Prints a gate's report and answers its exit code: 0 when it passed, 1 when
 * it found a problem, 2 when it could not run.
 *
 * @param command the command, for an error: "spec frozen"
 * @param result the report, or why the gate could not run
 * @param format text, markdown or json
 * @returns the exit code
 */
export const prCliFinish = (command: string, result: Result<PrReport, string>, format: string): i32 => {
  if (result.isErr()) {
    return report(usageError(`${command}: ${result.error}`))
  }
  console.log(prRender(result.value, format))
  return result.value.problems.length === 0 ? EXIT_PASS : EXIT_REFUSED
}
