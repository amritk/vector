/**
 * `cli/diff` — `vector diff`: prove two programs equivalent, or show where they differ.
 *
 * Only the command's shape is declared so far; its handler is a stub that
 * exits 2.
 */

import { Cli, ParseResult } from "nish/cli-args"
import { report, usageError } from "../core/diag"

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
   * @param _r the parsed arguments (unread until the handler lands)
   * @returns the exit code
   */
  run(_r: ParseResult): i32 {
    return report(usageError("diff: not implemented yet"))
  }
}

/**
 * Declares `vector diff` on the command tree.
 *
 * @param cli the command tree
 * @param parent the handle to declare it under
 * @returns the declared command, whose `run` handles it
 */
export const registerDiff = (cli: Cli, parent: i32): DiffCommand => new DiffCommand(cli, parent)
