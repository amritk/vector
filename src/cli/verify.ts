/**
 * `cli/verify` — `vector verify`: prove a program meets its spec plan.
 *
 * The handler reads both files and runs the whole gate (`verify/verify`).
 * PROVEN exits 0. REFUTED, UNKNOWN, INVALID and ERROR (z3 failed or rejected
 * the script) exit 1: none of them proved anything, so each refuses the
 * program. Exit 2 is kept for bad usage, a file that cannot be read, and an
 * `--emit` file that cannot be written. `--emit` writes the TypeScript only
 * when the program is proven; on any other outcome it writes nothing and
 * leaves an existing file as it was. The write goes to a temporary file
 * beside the target, renamed over it, so a failed or interrupted write never
 * leaves a truncated file behind.
 */

import { Cli, ParseResult } from "nish/cli-args"
import { EXIT_PASS, EXIT_REFUSED, report, usageError } from "../core/diag"
import { newJsonDocument, readJsonFile } from "../core/json"
import { outJsonRender } from "../verify/emit/outjson"
import {
  OUTCOME_ERROR,
  OUTCOME_INVALID,
  OUTCOME_PROVEN,
  VerifyOutcome,
  verifyOutcomeJson,
  verifySpecAndProgram,
} from "../verify/verify"

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
    const outcome = verifySpecAndProgram(
      specDoc,
      specRoot.value,
      programDoc,
      programRoot.value,
      `verify: ${programPath}`,
    )
    const emitPath = r.value(this.emitFlag) ?? ""
    let emitError = ""
    if (outcome.status === OUTCOME_PROVEN && emitPath !== "") {
      emitError = verifyWriteAtomic(emitPath, outcome.emittedCode)
    }
    // The outcome prints even when --emit failed, so a --json reader still
    // gets the verdict; the write failure follows it on stderr, and exits 2.
    if (r.flag(this.jsonFlag)) {
      console.log(outJsonRender(verifyOutcomeJson(outcome)))
    } else {
      verifyPrintText(outcome, emitError === "" ? emitPath : "")
    }
    if (emitError !== "") {
      return report(usageError(emitError))
    }
    return verifyExitCode(outcome.status)
  }
}

/**
 * The exit code for a verify outcome: 0 for PROVEN, 1 for everything else.
 * ERROR is 1, not 2: z3 failing proved nothing, so the program is refused,
 * the same as an UNKNOWN.
 *
 * @param status the outcome's status
 * @returns `EXIT_PASS` or `EXIT_REFUSED`
 */
export const verifyExitCode = (status: string): i32 => (status === OUTCOME_PROVEN ? EXIT_PASS : EXIT_REFUSED)

const verifyPrintStyle = (outcome: VerifyOutcome): void => {
  if (outcome.styleWarnings.length === 0) {
    return
  }
  console.log("\n── STYLE (advisory — does not affect the proof) ───────────────────\n")
  for (const w of outcome.styleWarnings) {
    console.log(`  ⚠ ${w.fn} ${w.axiomId}: ${w.property}`)
    console.log(`    ${w.hint}\n`)
  }
}

// Writes `data` to `path` atomically: a temporary beside it, then a rename.
// Returns the error to report, or "" when the file was written.
const verifyWriteAtomic = (path: string, data: string): string => {
  const temp = `${path}.vector-tmp`
  const written = writeFileSyncMode(temp, data, 0o644)
  if (written < 0) {
    unlinkSync(temp)
    return `verify: ${path}: cannot write file (errno ${-written})`
  }
  const renamed = renameSync(temp, path)
  if (renamed < 0) {
    unlinkSync(temp)
    return `verify: ${path}: cannot write file (errno ${-renamed})`
  }
  return ""
}

const verifyPrintText = (outcome: VerifyOutcome, emitPath: string): void => {
  if (outcome.status === OUTCOME_INVALID) {
    console.error("Validation failed:")
    for (const e of outcome.errors) {
      console.error(`  ✘ ${e}`)
    }
    return
  }
  if (outcome.status === OUTCOME_ERROR) {
    console.error(`Solver error: ${outcome.message}`)
    return
  }
  console.log(outcome.dashboard)
  verifyPrintStyle(outcome)
  if (outcome.status === OUTCOME_PROVEN) {
    console.log("\n── EMITTED TYPESCRIPT ─────────────────────────────────────────────\n")
    console.log(outcome.emittedCode)
    if (emitPath !== "") {
      console.log(`(written to ${emitPath})`)
    }
    return
  }
  console.log("\n── FEEDBACK (repair and re-verify) ────────────────────\n")
  console.log(outcome.feedback)
}

/**
 * Declares `vector verify` on the command tree.
 *
 * @param cli the command tree
 * @param parent the handle to declare it under
 * @returns the declared command, whose `run` handles it
 */
export const registerVerify = (cli: Cli, parent: i32): VerifyCommand => new VerifyCommand(cli, parent)
