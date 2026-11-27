/**
 * `cli/spec-frozen` — `vector spec frozen`: refuse a change that edits a frozen contract.
 *
 * A PR changes the spec side or the implementation, never both, and every
 * contract checked still holds to the sources it pins (`spec/pr/frozen`).
 */

import { Cli, CliArgument, CliFlag, ParseResult } from "nish/cli-args"
import { report, usageError } from "../core/diag"
import { prCliBase, prCliFinish, prCliFormat } from "../spec/pr/cli"
import { frozenCheck } from "../spec/pr/frozen"

/** The id `vector spec frozen` is parsed to. */
export const SPEC_FROZEN_ID: i32 = 7

/** `vector spec frozen`, declared on a `Cli`: its handles and its handler. */
export class SpecFrozenCommand {
  /** The `--base <ref>` flag. */
  baseFlag: CliFlag
  /** The `--repo <dir>` flag. */
  repoFlag: CliFlag
  /** The `--format <f>` flag. */
  formatFlag: CliFlag
  /** The `[contracts...]` argument. */
  contractsArg: CliArgument

  /**
   * Holds what `registerSpecFrozen` declared for `vector spec frozen`.
   *
   * @param baseFlag the `--base <ref>` flag
   * @param repoFlag the `--repo <dir>` flag
   * @param formatFlag the `--format <f>` flag
   * @param contractsArg the `[contracts...]` argument
   */
  constructor(baseFlag: CliFlag, repoFlag: CliFlag, formatFlag: CliFlag, contractsArg: CliArgument) {
    this.baseFlag = baseFlag
    this.repoFlag = repoFlag
    this.formatFlag = formatFlag
    this.contractsArg = contractsArg
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
    const repo = r.readValue(this.repoFlag) ?? "."
    return prCliFinish("spec frozen", frozenCheck(repo, base.value, r.readPositionals(this.contractsArg)), format.value)
  }
}

/**
 * Declares `vector spec frozen` on the command tree.
 *
 * @param cli the command tree
 * @param parent the handle to declare it under
 * @returns the declared command, whose `run` handles it, or `Err` when the
 *   declaration is refused (a vector bug)
 */
export const registerSpecFrozen = (cli: Cli, parent: i32): Result<SpecFrozenCommand, string> => {
  const handle = cli
    .tryCommand(parent, "frozen", SPEC_FROZEN_ID, "Refuse a change that edits a frozen contract")
    .orReturn()
  const baseFlag = cli.tryFlag(handle, "--base <ref>", "the commit the change is against").orReturn()
  const repoFlag = cli.tryFlag(handle, "--repo <dir>", "the repository (default: the current directory)").orReturn()
  const formatFlag = cli.tryFlag(handle, "--format <f>", "text (default), markdown (a PR comment) or json").orReturn()
  const contractsArg = cli
    .tryArgument(
      handle,
      "[contracts...]",
      "the contracts to check, from the repository's top (default: every contracts/*.json)",
    )
    .orReturn()
  return Ok(new SpecFrozenCommand(baseFlag, repoFlag, formatFlag, contractsArg))
}
