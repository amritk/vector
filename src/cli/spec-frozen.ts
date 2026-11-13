/**
 * `cli/spec-frozen` — `vector spec frozen`: refuse a change that edits a frozen contract.
 *
 * A PR changes the spec side or the implementation, never both, and every
 * contract checked still holds to the sources it pins (`spec/pr/frozen`).
 */

import { Cli, ParseResult } from "nish/cli-args"
import { report, usageError } from "../core/diag"
import { prCliBase, prCliFinish, prCliFormat } from "../spec/pr/cli"
import { frozenCheck } from "../spec/pr/frozen"

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
   * Runs the command: exit 0 when the change keeps to one side and every
   * contract holds, 1 when not, 2 for bad usage or a git failure.
   *
   * @param r the parsed arguments
   * @returns the exit code
   */
  run(r: ParseResult): i32 {
    const format = prCliFormat(r, this.formatFlag)
    if (format.isErr()) {
      return report(usageError(`spec frozen: ${format.error}`))
    }
    const base = prCliBase(r, this.baseFlag)
    if (base.isErr()) {
      return report(usageError(`spec frozen: ${base.error}`))
    }
    const repo = r.value(this.repoFlag) ?? "."
    return prCliFinish("spec frozen", frozenCheck(repo, base.value, r.positionals(this.contractsArg)), format.value)
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
