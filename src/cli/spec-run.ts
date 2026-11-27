/**
 * `cli/spec-run` — `vector spec run`: emit a contract's test and run it.
 *
 * The command itself is `runCommand` in `spec/run/command`; this file declares its
 * flags and hands them over.
 */

import { Cli, CliArgument, CliFlag, ParseResult } from "nish/cli-args"
import { RunRequest, runCommand } from "../spec/run/command"

/** The id `vector spec run` is parsed to. */
export const SPEC_RUN_ID: i32 = 6

/** `vector spec run`, declared on a `Cli`: its handles and its handler. */
export class SpecRunCommand {
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
   * Holds what `registerSpecRun` declared for `vector spec run`.
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
   * Runs the command. `--spec` is accepted and not read: the contract's
   * quotes are `spec check`'s to verify.
   *
   * @param r the parsed arguments
   * @returns the exit code
   */
  run(r: ParseResult): i32 {
    const req = new RunRequest(r.readPositional(this.contractJsonArg) ?? "")
    req.out = r.readValue(this.outFlag)
    req.nishRoot = r.readValue(this.nishRootFlag)
    req.nish = r.readValue(this.nishFlag)
    req.format = r.readValue(this.formatFlag) ?? "text"
    req.packages = r.readValues(this.packageFlag)
    req.lang = r.readValue(this.langFlag)
    req.harness = r.readValue(this.harnessFlag)
    req.slow = r.readFlag(this.slowFlag)
    return runCommand(req)
  }
}

/**
 * Declares `vector spec run` on the command tree.
 *
 * @param cli the command tree
 * @param parent the handle to declare it under
 * @returns the declared command, whose `run` handles it, or `Err` when the
 *   declaration is refused (a vector bug)
 */
export const registerSpecRun = (cli: Cli, parent: i32): Result<SpecRunCommand, string> => {
  const handle = cli.tryCommand(parent, "run", SPEC_RUN_ID, "Emit a contract's test and run it").orReturn()
  const outFlag = cli
    .tryFlag(handle, "-o, --out <file>", "where to keep the test (default: a temporary file)")
    .orReturn()
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
  const slowFlag = cli.tryFlag(handle, "--slow", "run slow iterated vectors too, rather than skip them").orReturn()
  const contractJsonArg = cli.tryArgument(handle, "<contract.json>", "the contract").orReturn()
  return Ok(
    new SpecRunCommand(
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
