/**
 * `cli/spec-stale` — `vector spec stale`: refuse a generated test that no longer matches its contract.
 *
 * Only the command's shape is declared so far; its handler is a stub that
 * exits 2.
 */

import { Cli, ParseResult } from "nish/cli-args"
import { report, usageError } from "../core/diag"

/** The id `vector spec stale` is parsed to. */
export const SPEC_STALE_ID: i32 = 8

/** `vector spec stale`, declared on a `Cli`: its handles and its handler. */
export class SpecStaleCommand {
  /** The `--format <f>` flag. */
  formatFlag: i32
  /** The `<test.ts>` argument. */
  testTsArg: i32
  /** The `<contract.json>` argument. */
  contractJsonArg: i32

  /**
   * Declares `vector spec stale` and its flags under `parent`.
   *
   * @param cli the command tree
   * @param parent the handle to declare it under (`ROOT` or the `spec` group)
   */
  constructor(cli: Cli, parent: i32) {
    const handle = cli.command(
      parent,
      "stale",
      SPEC_STALE_ID,
      "Refuse a generated test that no longer matches its contract",
    )
    this.formatFlag = cli.flag(handle, "--format <f>", "text (default), markdown (a PR comment) or json")
    this.testTsArg = cli.argument(handle, "<test.ts>", "the generated test")
    this.contractJsonArg = cli.argument(handle, "<contract.json>", "the contract it came from")
  }

  /**
   * Runs the command.
   *
   * @param _r the parsed arguments (unread until the handler lands)
   * @returns the exit code
   */
  run(_r: ParseResult): i32 {
    return report(usageError("spec stale: not implemented yet"))
  }
}

/**
 * Declares `vector spec stale` on the command tree.
 *
 * @param cli the command tree
 * @param parent the handle to declare it under
 * @returns the declared command, whose `run` handles it
 */
export const registerSpecStale = (cli: Cli, parent: i32): SpecStaleCommand => new SpecStaleCommand(cli, parent)
