/**
 * `cli/spec-mutate` — `vector spec mutate`: mutate the changed lines and refuse mutants the test misses.
 *
 * The check lives in `spec/pr/mutate`; this handler exits 2 until the
 * contract model's class names stop clashing with verify's, so main can
 * import it.
 */

import { Cli, ParseResult } from "nish/cli-args"
import { report, usageError } from "../core/diag"

/** The id `vector spec mutate` is parsed to. */
export const SPEC_MUTATE_ID: i32 = 10

/** `vector spec mutate`, declared on a `Cli`: its handles and its handler. */
export class SpecMutateCommand {
  /** The `--base <ref>` flag. */
  baseFlag: i32
  /** The `--nish-root <dir>` flag. */
  nishRootFlag: i32
  /** The `--nish <bin>` flag. */
  nishFlag: i32
  /** The `--jobs <n>` flag. */
  jobsFlag: i32
  /** The `--max <n>` flag. */
  maxFlag: i32
  /** The `--format <f>` flag. */
  formatFlag: i32
  /** The `<contract.json>` argument. */
  contractJsonArg: i32

  /**
   * Declares `vector spec mutate` and its flags under `parent`.
   *
   * @param cli the command tree
   * @param parent the handle to declare it under (`ROOT` or the `spec` group)
   */
  constructor(cli: Cli, parent: i32) {
    const handle = cli.command(
      parent,
      "mutate",
      SPEC_MUTATE_ID,
      "Mutate the changed lines and refuse mutants the test misses",
    )
    this.baseFlag = cli.flag(handle, "--base <ref>", "the commit the change is against")
    this.nishRootFlag = cli.flag(handle, "--nish-root <dir>", "a nish checkout: finds the module and the compiler")
    this.nishFlag = cli.flag(handle, "--nish <bin>", "the nish compiler (default: nish)")
    this.jobsFlag = cli.flag(handle, "--jobs <n>", "mutants run at once (default 1)")
    this.maxFlag = cli.flag(handle, "--max <n>", "at most this many mutants, spread over the changed lines")
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
    return report(usageError("spec mutate: not wired in yet: see spec/pr/mutate"))
  }
}

/**
 * Declares `vector spec mutate` on the command tree.
 *
 * @param cli the command tree
 * @param parent the handle to declare it under
 * @returns the declared command, whose `run` handles it
 */
export const registerSpecMutate = (cli: Cli, parent: i32): SpecMutateCommand => new SpecMutateCommand(cli, parent)
