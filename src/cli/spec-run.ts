/**
 * `cli/spec-run` — `vector spec run`: emit a contract's Nish test and run it.
 *
 * Only the command's shape is declared here; the handler still exits 2. The
 * command itself is `runCommand` in `spec/run/command`, which the binary cannot link yet:
 * `spec/contract/types` and `verify/lang/ast` both declare `Expr`, `Param`
 * and `Clause`, and a Nish class name must be unique across the program.
 * Once one side is renamed, `run` calls `runCommand`.
 */

import { Cli, ParseResult } from "nish/cli-args"
import { report, usageError } from "../core/diag"

/** The id `vector spec run` is parsed to. */
export const SPEC_RUN_ID: i32 = 6

/** `vector spec run`, declared on a `Cli`: its handles and its handler. */
export class SpecRunCommand {
  /** The `-o, --out <main.ts>` flag. */
  outFlag: i32
  /** The `--spec <file>` flag. */
  specFlag: i32
  /** The `--nish-root <dir>` flag. */
  nishRootFlag: i32
  /** The `--nish <bin>` flag. */
  nishFlag: i32
  /** The `--format <f>` flag. */
  formatFlag: i32
  /** The `<contract.json>` argument. */
  contractJsonArg: i32

  /**
   * Declares `vector spec run` and its flags under `parent`.
   *
   * @param cli the command tree
   * @param parent the handle to declare it under (`ROOT` or the `spec` group)
   */
  constructor(cli: Cli, parent: i32) {
    const handle = cli.command(parent, "run", SPEC_RUN_ID, "Emit a contract's Nish test and run it")
    this.outFlag = cli.flag(handle, "-o, --out <main.ts>", "where to keep the test (default: a temporary file)")
    this.specFlag = cli.flag(
      handle,
      "--spec <file>",
      "the source the contract quotes, RFC XML v3 or plain text (default: found next to the contract)",
    )
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
    return report(usageError("spec run: not implemented yet"))
  }
}

/**
 * Declares `vector spec run` on the command tree.
 *
 * @param cli the command tree
 * @param parent the handle to declare it under
 * @returns the declared command, whose `run` handles it
 */
export const registerSpecRun = (cli: Cli, parent: i32): SpecRunCommand => new SpecRunCommand(cli, parent)
