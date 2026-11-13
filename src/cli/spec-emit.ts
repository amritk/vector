/**
 * `cli/spec-emit` — `vector spec emit`: emit the test a contract implies.
 *
 * The command itself is `emitCommand` in `spec/emit/file`; this file declares its
 * flags and hands them over.
 */

import { Cli, ParseResult } from "nish/cli-args"
import { emitCommand } from "../spec/emit/file"

/** The id `vector spec emit` is parsed to. */
export const SPEC_EMIT_ID: i32 = 5

/** `vector spec emit`, declared on a `Cli`: its handles and its handler. */
export class SpecEmitCommand {
  /** The `-o, --out <main.ts>` flag. */
  outFlag: i32
  /** The `--spec <file>` flag. */
  specFlag: i32
  /** The `--nish-root <dir>` flag. */
  nishRootFlag: i32
  /** The `--nish <bin>` flag. */
  nishFlag: i32
  /** The `--format <f>` flag. */
  formatFlag: i32
  /** The repeatable `--package <name>=<dir>` flag. */
  packageFlag: i32
  /** The `--lang <id>` flag. */
  langFlag: i32
  /** The `--harness <h>` flag. */
  harnessFlag: i32
  /** The `<contract.json>` argument. */
  contractJsonArg: i32

  /**
   * Declares `vector spec emit` and its flags under `parent`.
   *
   * @param cli the command tree
   * @param parent the handle to declare it under (`ROOT` or the `spec` group)
   */
  constructor(cli: Cli, parent: i32) {
    const handle = cli.command(parent, "emit", SPEC_EMIT_ID, "Emit the test a contract implies")
    this.outFlag = cli.flag(handle, "-o, --out <main.ts>", "where to write the test")
    this.specFlag = cli.flag(
      handle,
      "--spec <file>",
      "the source the contract quotes, RFC XML v3 or plain text (default: found next to the contract)",
    )
    this.nishRootFlag = cli.flag(handle, "--nish-root <dir>", "a nish checkout: finds the module and the compiler")
    this.nishFlag = cli.flag(handle, "--nish <bin>", "the nish compiler (default: nish)")
    this.formatFlag = cli.flag(handle, "--format <f>", "text (default), markdown (a PR comment) or json")
    this.packageFlag = cli.flag(
      handle,
      "--package <pkg>",
      "a package of your own, <name>=<dir>: modules <name>/<path> are <dir>/<path>.ts, .py in python (repeatable)",
    )
    cli.repeatable(this.packageFlag)
    this.langFlag = cli.flag(handle, "--lang <id>", "the test's language: nish (default) or python")
    this.harnessFlag = cli.flag(
      handle,
      "--harness <h>",
      "standalone (default), or the test framework the test plugs into: pytest for python",
    )
    this.contractJsonArg = cli.argument(handle, "<contract.json>", "the contract")
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
      r.positional(this.contractJsonArg) ?? "",
      r.value(this.outFlag),
      r.values(this.packageFlag),
      r.value(this.langFlag),
      r.value(this.harnessFlag),
    )
  }
}

/**
 * Declares `vector spec emit` on the command tree.
 *
 * @param cli the command tree
 * @param parent the handle to declare it under
 * @returns the declared command, whose `run` handles it
 */
export const registerSpecEmit = (cli: Cli, parent: i32): SpecEmitCommand => new SpecEmitCommand(cli, parent)
