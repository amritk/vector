/**
 * `cli/spec-check` — `vector spec check`: check a contract's quotes and vectors against its source.
 *
 * Only the command's shape is declared so far; its handler is a stub that
 * exits 2.
 */

import { Cli, ParseResult } from "nish/cli-args"
import { report, usageError } from "../core/diag"

/** The id `vector spec check` is parsed to. */
export const SPEC_CHECK_ID: i32 = 4

/** `vector spec check`, declared on a `Cli`: its handles and its handler. */
export class SpecCheckCommand {
  /** The `--spec <file>` flag. */
  specFlag: i32
  /** The `--run-sources` flag. */
  runSourcesFlag: i32
  /** The `--module <file>` flag. */
  moduleFlag: i32
  /** The `--nish-root <dir>` flag. */
  nishRootFlag: i32
  /** The `--nish <bin>` flag. */
  nishFlag: i32
  /** The `--format <f>` flag. */
  formatFlag: i32
  /** The `<contract.json>` argument. */
  contractJsonArg: i32

  /**
   * Declares `vector spec check` and its flags under `parent`.
   *
   * @param cli the command tree
   * @param parent the handle to declare it under (`ROOT` or the `spec` group)
   */
  constructor(cli: Cli, parent: i32) {
    const handle = cli.command(
      parent,
      "check",
      SPEC_CHECK_ID,
      "Check a contract's quotes and vectors against its source",
    )
    this.specFlag = cli.flag(
      handle,
      "--spec <file>",
      "the source the contract quotes, RFC XML v3 or plain text (default: found next to the contract)",
    )
    this.runSourcesFlag = cli.flag(handle, "--run-sources", "run the vectors' command sources and check their output")
    this.moduleFlag = cli.flag(handle, "--module <file>", "the target module's source, for the signature gate")
    this.nishRootFlag = cli.flag(handle, "--nish-root <dir>", "a nish checkout: finds the module and the compiler")
    this.nishFlag = cli.flag(handle, "--nish <bin>", "the nish compiler (default: nish)")
    this.formatFlag = cli.flag(handle, "--format <f>", "text (default), markdown (a PR comment) or json")
    this.contractJsonArg = cli.argument(handle, "<contract.json>", "the contract")
  }

  /**
   * Runs the command.
   *
   * @param _r the parsed arguments (unread until the handler lands)
   * @returns the exit code
   */
  run(_r: ParseResult): i32 {
    return report(usageError("spec check: not implemented yet"))
  }
}

/**
 * Declares `vector spec check` on the command tree.
 *
 * @param cli the command tree
 * @param parent the handle to declare it under
 * @returns the declared command, whose `run` handles it
 */
export const registerSpecCheck = (cli: Cli, parent: i32): SpecCheckCommand => new SpecCheckCommand(cli, parent)
