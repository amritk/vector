/**
 * `cli/spec-exports` — `vector spec exports`: refuse a new export its contract does not cover.
 *
 * Every export the change adds to or changes in a contract's target module
 * is one a contract targeting that module tests or lists out of scope
 * (`spec/pr/exports`). Several contracts may be given: a module two of them
 * target is judged on what they cover together.
 */

import { Cli, ParseResult } from "nish/cli-args"
import { report, usageError } from "../core/diag"
import { prCliBase, prCliFinish, prCliFormat } from "../spec/pr/cli"
import { exportsCheckAll } from "../spec/pr/exports"

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
  /** The `<contracts.json...>` argument. */
  contractsArg: i32

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
    this.contractsArg = cli.argument(
      handle,
      "<contracts.json...>",
      "the contracts; a module several target is judged on all of them",
    )
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
    const root = r.value(this.nishRootFlag)
    if (root === null) {
      return report(usageError("spec exports: --nish-root <dir> is required: the nish checkout holding the module"))
    }
    return prCliFinish(
      "spec exports",
      exportsCheckAll(r.positionals(this.contractsArg), root, base.value),
      format.value,
    )
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
