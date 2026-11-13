/**
 * `cli/spec-extract` — `vector spec extract`: extract a contract from a kramdown-rfc spec's XML.
 *
 * Only the command's shape is declared so far; its handler is a stub that
 * exits 2.
 */

import { Cli, ParseResult } from "nish/cli-args"
import { report, usageError } from "../core/diag"

/** The id `vector spec extract` is parsed to. */
export const SPEC_EXTRACT_ID: i32 = 3

/** `vector spec extract`, declared on a `Cli`: its handles and its handler. */
export class SpecExtractCommand {
  /** The `-o, --out <contract.json>` flag. */
  outFlag: i32
  /** The `--check` flag. */
  checkFlag: i32
  /** The `<spec.xml>` argument. */
  specXmlArg: i32

  /**
   * Declares `vector spec extract` and its flags under `parent`.
   *
   * @param cli the command tree
   * @param parent the handle to declare it under (`ROOT` or the `spec` group)
   */
  constructor(cli: Cli, parent: i32) {
    const handle = cli.command(parent, "extract", SPEC_EXTRACT_ID, "Extract a contract from a kramdown-rfc spec's XML")
    this.outFlag = cli.flag(handle, "-o, --out <contract.json>", "where to write the contract")
    this.checkFlag = cli.flag(handle, "--check", "write nothing; exit 1 with a diff if --out differs")
    this.specXmlArg = cli.argument(handle, "<spec.xml>", "the spec, RFC XML v3")
  }

  /**
   * Runs the command.
   *
   * @param _r the parsed arguments (unread until the handler lands)
   * @returns the exit code
   */
  run(_r: ParseResult): i32 {
    return report(usageError("spec extract: not implemented yet"))
  }
}

/**
 * Declares `vector spec extract` on the command tree.
 *
 * @param cli the command tree
 * @param parent the handle to declare it under
 * @returns the declared command, whose `run` handles it
 */
export const registerSpecExtract = (cli: Cli, parent: i32): SpecExtractCommand => new SpecExtractCommand(cli, parent)
