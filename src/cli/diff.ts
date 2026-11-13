/**
 * `cli/diff` — `vector diff`: prove two programs equivalent, or show where they differ.
 *
 * Only the command's shape is declared so far; its handler is a stub that
 * exits 2.
 */

import { Cli, ParseResult } from "nish/cli-args"
import { notImplemented } from "./common"

/** The id `vector diff` is parsed to. */
export const DIFF_ID: i32 = 2

/** `vector diff`, declared on a `Cli`: its handles and its handler. */
export class DiffCommand {
  /** The handle of the command in the tree. */
  handle: i32
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
    this.handle = cli.command(parent, "diff", DIFF_ID, "Prove two programs equivalent, or show where they differ")
    this.jsonFlag = cli.flag(this.handle, "--json", "print the result as JSON")
    this.oldJsonArg = cli.argument(this.handle, "<old.json>", "the program before")
    this.newJsonArg = cli.argument(this.handle, "<new.json>", "the program after")
  }

  /**
   * Runs the command.
   *
   * @param _r the parsed arguments (unread until the handler lands)
   * @returns the exit code
   */
  run(_r: ParseResult): i32 {
    return notImplemented("diff")
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
