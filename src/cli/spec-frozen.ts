/**
 * `cli/spec-frozen` — `vector spec frozen`: refuse a change that edits a frozen contract.
 *
 * The check lives in `spec/pr/frozen`; this handler exits 2 until the
 * contract model's class names stop clashing with verify's, so main can
 * import it.
 */

import { Cli, ParseResult } from "nish/cli-args"
import { report, usageError } from "../core/diag"

/** The id `vector spec frozen` is parsed to. */
export const SPEC_FROZEN_ID: i32 = 7

/** `vector spec frozen`, declared on a `Cli`: its handles and its handler. */
export class SpecFrozenCommand {
  /** The `--base <ref>` flag. */
  baseFlag: i32
  /** The `--repo <dir>` flag. */
  repoFlag: i32
  /** The `--format <f>` flag. */
  formatFlag: i32
  /** The `[contracts...]` argument. */
  contractsArg: i32

  /**
   * Declares `vector spec frozen` and its flags under `parent`.
   *
   * @param cli the command tree
   * @param parent the handle to declare it under (`ROOT` or the `spec` group)
   */
  constructor(cli: Cli, parent: i32) {
    const handle = cli.command(parent, "frozen", SPEC_FROZEN_ID, "Refuse a change that edits a frozen contract")
    this.baseFlag = cli.flag(handle, "--base <ref>", "the commit the change is against")
    this.repoFlag = cli.flag(handle, "--repo <dir>", "the repository (default: the current directory)")
    this.formatFlag = cli.flag(handle, "--format <f>", "text (default), markdown (a PR comment) or json")
    this.contractsArg = cli.argument(
      handle,
      "[contracts...]",
      "the contracts to check (default: every contracts/*.json)",
    )
  }

  /**
   * Runs the command.
   *
   * @param _r the parsed arguments (unread until the handler lands)
   * @returns the exit code
   */
  run(_r: ParseResult): i32 {
    return report(usageError("spec frozen: not wired in yet: see spec/pr/frozen"))
  }
}

/**
 * Declares `vector spec frozen` on the command tree.
 *
 * @param cli the command tree
 * @param parent the handle to declare it under
 * @returns the declared command, whose `run` handles it
 */
export const registerSpecFrozen = (cli: Cli, parent: i32): SpecFrozenCommand => new SpecFrozenCommand(cli, parent)
