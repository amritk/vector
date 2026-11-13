/**
 * `cli/verify` — `vector verify`: prove a program meets its spec plan.
 *
 * Only the command's shape is declared so far; its handler is a stub that
 * exits 2.
 */

import { Cli, ParseResult } from "nish/cli-args"
import { report, usageError } from "../core/diag"

/** The id `vector verify` is parsed to. */
export const VERIFY_ID: i32 = 1

/** `vector verify`, declared on a `Cli`: its handles and its handler. */
export class VerifyCommand {
  /** The `--json` flag. */
  jsonFlag: i32
  /** The `--emit <file>` flag. */
  emitFlag: i32
  /** The `<spec.json>` argument. */
  specJsonArg: i32
  /** The `<program.json>` argument. */
  programJsonArg: i32

  /**
   * Declares `vector verify` and its flags under `parent`.
   *
   * @param cli the command tree
   * @param parent the handle to declare it under (`ROOT` or the `spec` group)
   */
  constructor(cli: Cli, parent: i32) {
    const handle = cli.command(parent, "verify", VERIFY_ID, "Prove a program meets its spec plan")
    this.jsonFlag = cli.flag(handle, "--json", "print the result as JSON")
    this.emitFlag = cli.flag(handle, "--emit <file>", "write the verified program's TypeScript to <file>")
    this.specJsonArg = cli.argument(handle, "<spec.json>", "the spec plan")
    this.programJsonArg = cli.argument(handle, "<program.json>", "the program to verify")
  }

  /**
   * Runs the command.
   *
   * @param _r the parsed arguments (unread until the handler lands)
   * @returns the exit code
   */
  run(_r: ParseResult): i32 {
    return report(usageError("verify: not implemented yet"))
  }
}

/**
 * Declares `vector verify` on the command tree.
 *
 * @param cli the command tree
 * @param parent the handle to declare it under
 * @returns the declared command, whose `run` handles it
 */
export const registerVerify = (cli: Cli, parent: i32): VerifyCommand => new VerifyCommand(cli, parent)
