/**
 * `cli/spec-emit` — `vector spec emit`: emit the test a contract implies.
 *
 * The command itself is `emitCommand` in `spec/emit/file`; this file declares its
 * flags and hands them over.
 */

import { Cli, CliArgument, CliFlag, ParseResult } from "nish/cli-args"
import { emitCommand } from "../spec/emit/file"

/** The id `vector spec emit` is parsed to. */
export const SPEC_EMIT_ID: i32 = 5

/** `vector spec emit`, declared on a `Cli`: its handles and its handler. */
export class SpecEmitCommand {
  /** The `-o, --out <file>` flag. */
  outFlag: CliFlag
  /** The `--spec <file>` flag. */
  specFlag: CliFlag
  /** The `--nish-root <dir>` flag. */
  nishRootFlag: CliFlag
  /** The `--nish <bin>` flag. */
  nishFlag: CliFlag
  /** The `--format <f>` flag. */
  formatFlag: CliFlag
  /** The repeatable `--package <name>=<dir>` flag. */
  packageFlag: CliFlag
  /** The `--lang <id>` flag. */
  langFlag: CliFlag
  /** The `--slow` flag. */
  slowFlag: CliFlag
  /** The `--harness <h>` flag. */
  harnessFlag: CliFlag
  /** The `<contract.json>` argument. */
  contractJsonArg: CliArgument

  /**
   * Holds what `registerSpecEmit` declared for `vector spec emit`.
   *
   * @param outFlag the `-o, --out <file>` flag
   * @param specFlag the `--spec <file>` flag
   * @param nishRootFlag the `--nish-root <dir>` flag
   * @param nishFlag the `--nish <bin>` flag
   * @param formatFlag the `--format <f>` flag
   * @param packageFlag the repeatable `--package <name>=<dir>` flag
   * @param langFlag the `--lang <id>` flag
   * @param slowFlag the `--slow` flag
   * @param harnessFlag the `--harness <h>` flag
   * @param contractJsonArg the `<contract.json>` argument
   */
  constructor(
    outFlag: CliFlag,
    specFlag: CliFlag,
    nishRootFlag: CliFlag,
    nishFlag: CliFlag,
    formatFlag: CliFlag,
    packageFlag: CliFlag,
    langFlag: CliFlag,
    slowFlag: CliFlag,
    harnessFlag: CliFlag,
    contractJsonArg: CliArgument,
  ) {
    this.outFlag = outFlag
    this.specFlag = specFlag
    this.nishRootFlag = nishRootFlag
    this.nishFlag = nishFlag
    this.formatFlag = formatFlag
    this.packageFlag = packageFlag
    this.langFlag = langFlag
    this.slowFlag = slowFlag
    this.harnessFlag = harnessFlag
    this.contractJsonArg = contractJsonArg
  }

  /**
   * Runs the command: writes the test to `-o`. `--spec`, `--nish-root`,
   * `--nish` and `--format` are the shape `spec run` shares; emit reads none
   * of them.
   *
   * @param r the parsed arguments
   * @returns the exit code
   */
  run(r: ParseResult): i32 {
    return emitCommand(
      r.readPositional(this.contractJsonArg) ?? "",
      r.readValue(this.outFlag),
      r.readValues(this.packageFlag),
      r.readValue(this.langFlag),
      r.readValue(this.harnessFlag),
      r.readFlag(this.slowFlag),
    )
  }
}

/**
 * Declares `vector spec emit` on the command tree.
 *
 * @param cli the command tree
 * @param parent the handle to declare it under
 * @returns the declared command, whose `run` handles it, or `Err` when the
 *   declaration is refused (a vector bug)
 */
export const registerSpecEmit = (cli: Cli, parent: i32): Result<SpecEmitCommand, string> => {
  const handle = cli.tryCommand(parent, "emit", SPEC_EMIT_ID, "Emit the test a contract implies").orReturn()
  const outFlag = cli.tryFlag(handle, "-o, --out <file>", "where to write the test").orReturn()
  const specFlag = cli
    .tryFlag(
      handle,
      "--spec <file>",
      "the source the contract quotes, RFC XML v3 or plain text (default: found next to the contract)",
    )
    .orReturn()
  const nishRootFlag = cli
    .tryFlag(handle, "--nish-root <dir>", "a nish checkout: finds the module and the compiler")
    .orReturn()
  const nishFlag = cli.tryFlag(handle, "--nish <bin>", "the nish compiler (default: nish)").orReturn()
  const formatFlag = cli.tryFlag(handle, "--format <f>", "text (default), markdown (a PR comment) or json").orReturn()
  const packageFlag = cli
    .tryFlag(
      handle,
      "--package <pkg>",
      "a package of your own, <name>=<dir>: modules <name>/<path> are <dir>/<path>.ts, .py in python, .rs in rust, .go in go (repeatable)",
    )
    .orReturn()
  cli.tryRepeatable(packageFlag.handle).orReturn()
  const langFlag = cli
    .tryFlag(handle, "--lang <id>", "the test's language: nish (default), python, rust, go or typescript")
    .orReturn()
  const harnessFlag = cli
    .tryFlag(
      handle,
      "--harness <h>",
      "standalone (default), or the test framework the test plugs into: pytest for python, cargo for rust, gotest for go, node for typescript",
    )
    .orReturn()
  const slowFlag = cli.tryFlag(handle, "--slow", "emit slow iterated vectors to run, rather than skipped").orReturn()
  const contractJsonArg = cli.tryArgument(handle, "<contract.json>", "the contract").orReturn()
  return Ok(
    new SpecEmitCommand(
      outFlag,
      specFlag,
      nishRootFlag,
      nishFlag,
      formatFlag,
      packageFlag,
      langFlag,
      slowFlag,
      harnessFlag,
      contractJsonArg,
    ),
  )
}
