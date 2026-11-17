/**
 * `cli/diff` — `vector diff`: prove two programs equivalent, or show where they differ.
 *
 * The handler reads both files and runs the regeneration gate
 * (`verify/equiv/diff`). EQUIVALENT exits 0; DIFFERENT and UNDECIDED exit 1;
 * INVALID, an unreadable file and a z3 failure exit 2.
 */

import { Cli, ParseResult } from "nish/cli-args"
import { EXIT_PASS, EXIT_REFUSED, EXIT_USAGE, report, usageError } from "../core/diag"
import { newJsonDocument, readJsonFile } from "../core/json"
import { outJsonRender } from "../verify/emit/outjson"
import {
  DIFF_EQUIVALENT,
  DIFF_ERROR,
  DIFF_INVALID,
  DIFF_MISMATCH,
  diffOutcomeJson,
  diffPrograms,
} from "../verify/equiv/diff"

/** The id `vector diff` is parsed to. */
export const DIFF_ID: i32 = 2

/** `vector diff`, declared on a `Cli`: its handles and its handler. */
export class DiffCommand {
  /** The `--json` flag. */
  jsonFlag: i32
  /** The `<old.json>` argument. */
  oldJsonArg: i32
  /** The `<new.json>` argument. */
  newJsonArg: i32

  /**
   * Declares `vector diff` and its flags under `parent`.
   *
   * @param cli the command tree
   * @param parent the handle to declare it under (`ROOT` or the `spec` group)
   */
  constructor(cli: Cli, parent: i32) {
    const handle = cli.command(parent, "diff", DIFF_ID, "Prove two programs equivalent, or show where they differ")
    this.jsonFlag = cli.flag(handle, "--json", "print the result as JSON")
    this.oldJsonArg = cli.argument(handle, "<old.json>", "the program before")
    this.newJsonArg = cli.argument(handle, "<new.json>", "the program after")
  }

  /**
   * Runs the command.
   *
   * @param r the parsed arguments
   * @returns the exit code
   */
  run(r: ParseResult): i32 {
    const oldPath = r.positional(this.oldJsonArg) ?? ""
    const newPath = r.positional(this.newJsonArg) ?? ""
    const oldDoc = newJsonDocument()
    const oldRoot = readJsonFile(oldDoc, oldPath)
    if (oldRoot.isErr()) {
      return report(usageError(`diff: ${oldRoot.error}`))
    }
    const newDoc = newJsonDocument()
    const newRoot = readJsonFile(newDoc, newPath)
    if (newRoot.isErr()) {
      return report(usageError(`diff: ${newRoot.error}`))
    }
    const outcome = diffPrograms(oldDoc, oldRoot.value, newDoc, newRoot.value)
    if (r.flag(this.jsonFlag)) {
      console.log(outJsonRender(diffOutcomeJson(outcome)))
    } else if (outcome.status === DIFF_INVALID) {
      console.error("Validation failed:")
      for (const e of outcome.errors) {
        console.error(`  ✘ ${e}`)
      }
    } else if (outcome.status === DIFF_ERROR) {
      console.error(`Solver error: ${outcome.message}`)
    } else {
      console.log(outcome.summary)
    }
    return diffExitCode(outcome.status)
  }
}

/**
 * The exit code for a diff status: 0 for EQUIVALENT, 1 for DIFFERENT and
 * UNDECIDED, 2 for INVALID and ERROR (the inputs or the solver failed, so
 * nothing was compared) and for MISMATCH (a witness z3 gave did not replay,
 * so the fault is vector's).
 *
 * @param status one of the `DIFF_*` statuses
 * @returns the exit code
 */
export const diffExitCode = (status: string): i32 => {
  if (status === DIFF_EQUIVALENT) {
    return EXIT_PASS
  }
  if (status === DIFF_INVALID || status === DIFF_ERROR || status === DIFF_MISMATCH) {
    return EXIT_USAGE
  }
  return EXIT_REFUSED
}

/**
 * Declares `vector diff` on the command tree.
 *
 * @param cli the command tree
 * @param parent the handle to declare it under
 * @returns the declared command, whose `run` handles it
 */
export const registerDiff = (cli: Cli, parent: i32): DiffCommand => new DiffCommand(cli, parent)
