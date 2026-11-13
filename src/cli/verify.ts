/**
 * `cli/verify` — `vector verify`: prove a program meets its spec plan.
 *
 * The handler reads both files, checks their shape, and reports every error.
 */

import { Cli, ParseResult } from "nish/cli-args"
import { EXIT_PASS, EXIT_REFUSED, report, usageError } from "../core/diag"
import { newJsonDocument, readJsonFile } from "../core/json"
import { readProgram, readSpecPlan } from "../verify/lang/read"

/** The id `vector verify` is parsed to. */
export const VERIFY_ID: i32 = 1

/** `vector verify`, declared on a `Cli`: its handles and its handler. */
export class VerifyCommand {
  /** The `--json` flag. */
  jsonFlag: i32
  /** The `--emit <file>` flag. */
  emitFlag: i32
  /** The `<spec.json>` argument. */
  specJsonArg: i32
  /** The `<program.json>` argument. */
  programJsonArg: i32

  /**
   * Declares `vector verify` and its flags under `parent`.
   *
   * @param cli the command tree
   * @param parent the handle to declare it under (`ROOT` or the `spec` group)
   */
  constructor(cli: Cli, parent: i32) {
    const handle = cli.command(parent, "verify", VERIFY_ID, "Prove a program meets its spec plan")
    this.jsonFlag = cli.flag(handle, "--json", "print the result as JSON")
    this.emitFlag = cli.flag(handle, "--emit <file>", "write the verified program's TypeScript to <file>")
    this.specJsonArg = cli.argument(handle, "<spec.json>", "the spec plan")
    this.programJsonArg = cli.argument(handle, "<program.json>", "the program to verify")
  }

  /**
   * Runs the command.
   *
   * @param r the parsed arguments
   * @returns the exit code
   */
  run(r: ParseResult): i32 {
    const specPath = r.positional(this.specJsonArg) ?? ""
    const programPath = r.positional(this.programJsonArg) ?? ""
    const specDoc = newJsonDocument()
    const specRoot = readJsonFile(specDoc, specPath)
    if (specRoot.isErr()) {
      return report(usageError(`verify: ${specRoot.error}`))
    }
    const programDoc = newJsonDocument()
    const programRoot = readJsonFile(programDoc, programPath)
    if (programRoot.isErr()) {
      return report(usageError(`verify: ${programRoot.error}`))
    }
    const errors: string[] = []
    readSpecPlan(specDoc, specRoot.value, errors)
    readProgram(programDoc, programRoot.value, errors)
    if (errors.length > 0) {
      console.error("Validation failed:")
      for (const e of errors) {
        console.error(`  ✘ ${e}`)
      }
      return EXIT_REFUSED
    }
    return EXIT_PASS
  }
}

/**
 * Declares `vector verify` on the command tree.
 *
 * @param cli the command tree
 * @param parent the handle to declare it under
 * @returns the declared command, whose `run` handles it
 */
export const registerVerify = (cli: Cli, parent: i32): VerifyCommand => new VerifyCommand(cli, parent)
