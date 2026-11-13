/**
 * `cli/spec-exports` — `vector spec exports`: refuse a new export its contract does not cover.
 *
 * The check lives in `spec/pr/exports`; this handler exits 2 until the
 * contract model's class names stop clashing with verify's, so main can
 * import it.
 */

import { Cli, ParseResult } from "nish/cli-args"
import { report, usageError } from "../core/diag"

/** The id `vector spec exports` is parsed to. */
export const SPEC_EXPORTS_ID: i32 = 9

/** `vector spec exports`, declared on a `Cli`: its handles and its handler. */
export class SpecExportsCommand {
  /** The `--base <ref>` flag. */
  baseFlag: i32
  /** The `--nish-root <dir>` flag. */
  nishRootFlag: i32
  /** The `--format <f>` flag. */
  formatFlag: i32
  /** The `<contract.json>` argument. */
  contractJsonArg: i32

  /**
   * Declares `vector spec exports` and its flags under `parent`.
   *
   * @param cli the command tree
   * @param parent the handle to declare it under (`ROOT` or the `spec` group)
   */
  constructor(cli: Cli, parent: i32) {
    const handle = cli.command(parent, "exports", SPEC_EXPORTS_ID, "Refuse a new export its contract does not cover")
    this.baseFlag = cli.flag(handle, "--base <ref>", "the commit the change is against")
    this.nishRootFlag = cli.flag(handle, "--nish-root <dir>", "a nish checkout: finds the module and the compiler")
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
    return report(usageError("spec exports: not wired in yet: see spec/pr/exports"))
  }
}

/**
 * Declares `vector spec exports` on the command tree.
 *
 * @param cli the command tree
 * @param parent the handle to declare it under
 * @returns the declared command, whose `run` handles it
 */
export const registerSpecExports = (cli: Cli, parent: i32): SpecExportsCommand => new SpecExportsCommand(cli, parent)
