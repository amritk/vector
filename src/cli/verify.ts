/**
 * `cli/verify` — `vector verify`: prove a program meets its spec plan.
 *
 * The handler reads both files and runs the whole gate (`verify/verify`).
 * PROVEN exits 0. REFUTED, UNKNOWN, INVALID and ERROR (z3 failed or rejected
 * the script) exit 1: none of them proved anything, so each refuses the
 * program. Exit 2 is kept for bad usage, a file that cannot be read, an
 * `--emit` file that cannot be written, and a counterexample that does not
 * replay (`MISMATCH`, a bug in vector). `--emit` writes the TypeScript only
 * when the program is proven; on any other outcome it writes nothing and
 * leaves an existing file as it was. The write goes to a temporary file
 * beside the target, renamed over it, so a failed or interrupted write never
 * leaves a truncated file behind.
 */

import { Cli, CliArgument, CliFlag, ParseResult } from "nish/cli-args"
import { EXIT_PASS, EXIT_REFUSED, EXIT_USAGE, report, usageError } from "../core/diag"
import { toHex } from "../core/hex"
import { newJsonDocument, readJsonFile } from "../core/json"
import { outJsonRender } from "../verify/emit/outjson"
import {
  OUTCOME_ERROR,
  OUTCOME_INVALID,
  OUTCOME_MISMATCH,
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
  jsonFlag: CliFlag
  /** The `--emit <file>` flag. */
  emitFlag: CliFlag
  /** The `<spec.json>` argument. */
  specJsonArg: CliArgument
  /** The `<program.json>` argument. */
  programJsonArg: CliArgument

  /**
   * Holds what `registerVerify` declared for `vector verify`.
   *
   * @param jsonFlag the `--json` flag
   * @param emitFlag the `--emit <file>` flag
   * @param specJsonArg the `<spec.json>` argument
   * @param programJsonArg the `<program.json>` argument
   */
  constructor(jsonFlag: CliFlag, emitFlag: CliFlag, specJsonArg: CliArgument, programJsonArg: CliArgument) {
    this.jsonFlag = jsonFlag
    this.emitFlag = emitFlag
    this.specJsonArg = specJsonArg
    this.programJsonArg = programJsonArg
  }

  /**
   * Runs the command.
   *
   * @param r the parsed arguments
   * @returns the exit code
   */
  run(r: ParseResult): i32 {
    const specPath = r.readPositional(this.specJsonArg) ?? ""
    const programPath = r.readPositional(this.programJsonArg) ?? ""
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
    const emitPath = r.readValue(this.emitFlag) ?? ""
    let emitError = ""
    if (outcome.status === OUTCOME_PROVEN && emitPath !== "") {
      emitError = verifyWriteAtomic(emitPath, outcome.emittedCode)
    }
    // The outcome prints even when --emit failed, so a --json reader still
    // gets the verdict; the write failure follows it on stderr, and exits 2.
    if (r.readFlag(this.jsonFlag)) {
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
 * The exit code for a verify outcome: 0 for PROVEN, 2 for MISMATCH, 1 for
 * everything else. ERROR is 1, not 2: z3 failing proved nothing, so the
 * program is refused, the same as an UNKNOWN. MISMATCH is 2 because the fault
 * is vector's: a counterexample z3 gave did not replay.
 *
 * @param status the outcome's status
 * @returns `EXIT_PASS`, `EXIT_USAGE` or `EXIT_REFUSED`
 */
export const verifyExitCode = (status: string): i32 =>
  status === OUTCOME_PROVEN ? EXIT_PASS : status === OUTCOME_MISMATCH ? EXIT_USAGE : EXIT_REFUSED

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

// Writes `data` to `path` atomically: a new temporary file beside it, made
// exclusively under a random name (so a planted file or link there, or a
// second run on the same path, is never written through), then a rename.
// Returns the error to report, or "" when the file was written.
const verifyWriteAtomic = (path: string, data: string): string => {
  const bytes: u8[] = new Array<u8>(8)
  for (let attempt = 0; attempt < 16; attempt++) {
    crypto.getRandomValues(bytes)
    const temp = `${path}.vector-${toHex(bytes)}.tmp`
    const written = createFileExclusiveSync(temp, data, 0o644)
    if (written === -17) {
      continue
    }
    if (written < 0) {
      // No space, an I/O error or a too-large file fail after the file was
      // made, so only those leave a temporary of ours to remove.
      if (written === -28 || written === -5 || written === -27) {
        unlinkSync(temp)
      }
      return `verify: ${path}: cannot write file (errno ${-toI64(written)})`
    }
    const renamed = renameSync(temp, path)
    if (renamed < 0) {
      unlinkSync(temp)
      return `verify: ${path}: cannot write file (errno ${-toI64(renamed)})`
    }
    return ""
  }
  return `verify: ${path}: cannot find a free temporary file name beside it`
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
 * @returns the declared command, whose `run` handles it, or `Err` when the
 *   declaration is refused (a vector bug)
 */
export const registerVerify = (cli: Cli, parent: i32): Result<VerifyCommand, string> => {
  const handle = cli.tryCommand(parent, "verify", VERIFY_ID, "Prove a program meets its spec plan").orReturn()
  const jsonFlag = cli.tryFlag(handle, "--json", "print the result as JSON").orReturn()
  const emitFlag = cli.tryFlag(handle, "--emit <file>", "write the verified program's TypeScript to <file>").orReturn()
  const specJsonArg = cli.tryArgument(handle, "<spec.json>", "the spec plan").orReturn()
  const programJsonArg = cli.tryArgument(handle, "<program.json>", "the program to verify").orReturn()
  return Ok(new VerifyCommand(jsonFlag, emitFlag, specJsonArg, programJsonArg))
}
