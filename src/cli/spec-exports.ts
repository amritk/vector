/**
 * `cli/spec-exports` — `vector spec exports`: refuse a new export its contract does not cover.
 *
 * Every export the change adds to or changes in the contract's target module
 * is one the contract tests or lists out of scope (`spec/pr/exports`).
 */

import { Cli, CliArgument, CliFlag, ParseResult } from "nish/cli-args"
import { report, usageError } from "../core/diag"
import { prCliBase, prCliFinish, prCliFormat } from "../spec/pr/cli"
import { exportsCheck } from "../spec/pr/exports"

/** The id `vector spec exports` is parsed to. */
export const SPEC_EXPORTS_ID: i32 = 9

/** `vector spec exports`, declared on a `Cli`: its handles and its handler. */
export class SpecExportsCommand {
  /** The `--base <ref>` flag. */
  baseFlag: CliFlag
  /** The `--nish-root <dir>` flag. */
  nishRootFlag: CliFlag
  /** The `--format <f>` flag. */
  formatFlag: CliFlag
  /** The `<contract.json>` argument. */
  contractJsonArg: CliArgument

  /**
   * Holds what `registerSpecExports` declared for `vector spec exports`.
   *
   * @param baseFlag the `--base <ref>` flag
   * @param nishRootFlag the `--nish-root <dir>` flag
   * @param formatFlag the `--format <f>` flag
   * @param contractJsonArg the `<contract.json>` argument
   */
  constructor(baseFlag: CliFlag, nishRootFlag: CliFlag, formatFlag: CliFlag, contractJsonArg: CliArgument) {
    this.baseFlag = baseFlag
    this.nishRootFlag = nishRootFlag
    this.formatFlag = formatFlag
    this.contractJsonArg = contractJsonArg
  }

  /**
   * Runs the command: exit 0 when every changed export is tested or out of
   * scope, 1 when not, 2 for bad usage, an unreadable contract or a git failure.
   *
   * @param r the parsed arguments
   * @returns the exit code
   */
  run(r: ParseResult): i32 {
    const format = prCliFormat(r, this.formatFlag)
    if (format.isErr()) {
      return report(usageError(`spec exports: ${format.error}`))
    }
    const base = prCliBase(r, this.baseFlag)
    if (base.isErr()) {
      return report(usageError(`spec exports: ${base.error}`))
    }
    const root = r.readValue(this.nishRootFlag)
    if (root === null) {
      return report(usageError("spec exports: --nish-root <dir> is required: the nish checkout holding the module"))
    }
    const contract = r.readPositional(this.contractJsonArg) ?? ""
    return prCliFinish("spec exports", exportsCheck(contract, root, base.value), format.value)
  }
}

/**
 * Declares `vector spec exports` on the command tree.
 *
 * @param cli the command tree
 * @param parent the handle to declare it under
 * @returns the declared command, whose `run` handles it, or `Err` when the
 *   declaration is refused (a vector bug)
 */
export const registerSpecExports = (cli: Cli, parent: i32): Result<SpecExportsCommand, string> => {
  const handle = cli
    .tryCommand(parent, "exports", SPEC_EXPORTS_ID, "Refuse a new export its contract does not cover")
    .orReturn()
  const baseFlag = cli.tryFlag(handle, "--base <ref>", "the commit the change is against").orReturn()
  const nishRootFlag = cli
    .tryFlag(handle, "--nish-root <dir>", "a nish checkout: finds the module and the compiler")
    .orReturn()
  const formatFlag = cli.tryFlag(handle, "--format <f>", "text (default), markdown (a PR comment) or json").orReturn()
  const contractJsonArg = cli.tryArgument(handle, "<contract.json>", "the contract").orReturn()
  return Ok(new SpecExportsCommand(baseFlag, nishRootFlag, formatFlag, contractJsonArg))
}
