/**
 * `cli/spec-frozen` — `vector spec frozen`: refuse a change that edits a frozen contract.
 *
 * Only the command's shape is declared so far; its handler is a stub that
 * exits 2.
 */

import { Cli, ParseResult } from "nish/cli-args"
import { notImplemented } from "./common"

/** The id `vector spec frozen` is parsed to. */
export const SPEC_FROZEN_ID: i32 = 7

/** `vector spec frozen`, declared on a `Cli`: its handles and its handler. */
export class SpecFrozenCommand {
  /** The handle of the command in the tree. */
  handle: i32
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
    this.handle = cli.command(parent, "frozen", SPEC_FROZEN_ID, "Refuse a change that edits a frozen contract")
    this.baseFlag = cli.flag(this.handle, "--base <ref>", "the commit the change is against")
    this.repoFlag = cli.flag(this.handle, "--repo <dir>", "the repository (default: the current directory)")
    this.formatFlag = cli.flag(this.handle, "--format <f>", "text (default), markdown (a PR comment) or json")
    this.contractsArg = cli.argument(
      this.handle,
      "[contracts...]",
      "the contracts to check (default: every changed one)",
    )
  }

  /**
   * Runs the command.
   *
   * @param _r the parsed arguments (unread until the handler lands)
   * @returns the exit code
   */
  run(_r: ParseResult): i32 {
    return notImplemented("spec frozen")
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
