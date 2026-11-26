/**
 * `spec/emit/file` — from a contract file to its test's text, and the test
 * written to disk: what `vector spec emit` and `vector spec run` share.
 */

import { Diagnostic, EXIT_PASS, EXIT_USAGE, refusal, report, usageError } from "../../core/diag"
import { dirname } from "../../core/fs"
import { sha256Hex, toHex } from "../../core/hex"
import { CheckContext, checkContract, checkLines, checkPassed } from "../check"
import { contractLoad } from "../contract/contract"
import { Contract } from "../contract/types"
import { sourceInstallRoot } from "../source/path"
import { EmitOptions, emitProgram } from "./emit"
import { emitGoProgram } from "./go"
import { EmitPackages, emitPackageFlags, emitParsePackages, emitResolveModules } from "./packages"
import { emitPyProgram } from "./python"
import { emitRsProgram } from "./rust"
import { EmitTarget, emitTargetExt, emitTargetFlags, emitTargetParse } from "./target"
import { emitTsProgram } from "./typescript"

/** A contract and the test emitted for it. */
export class EmitFile {
  /** The contract, loaded and checked. */
  contract: Contract
  /** The test's source, in the target's language. */
  program: string

  /**
   * Pairs a contract with its test.
   *
   * @param contract the contract
   * @param program the test's source
   */
  constructor(contract: Contract, program: string) {
    this.contract = contract
    this.program = program
  }
}

/** Each message as a refusal of `path`. */
const emitRefuseAll = (path: string, messages: string[]): Diagnostic[] =>
  messages.map((m: string): Diagnostic => refusal(path, 0, m))

/**
 * Reads a contract file, checks it, and emits its test. An unreadable file,
 * or a tool the check needs (z3) that failed, is a usage error (exit 2), alone
 * and with no refusals; a contract that does not load, fails its check, or
 * that the target's language cannot express is refused (exit 1), one
 * diagnostic per reason.
 * A module `--package` maps to a file that does not exist is a usage error.
 *
 * @param path the contract file
 * @param regenerate the command shown in the test's header, or null for none
 * @param packages where the modules of your own project live
 * @param fromDir the directory the test will be written in, which its imports
 *   of those modules are relative to
 * @param target the language and harness to emit the test for
 * @returns the contract and its test, or every diagnostic
 */
export const emitContractFile = (
  path: string,
  regenerate: string | null,
  packages: EmitPackages,
  fromDir: string,
  target: EmitTarget,
): Result<EmitFile, Diagnostic[]> => {
  const text = readFileSyncOrNull(path)
  if (text === null) {
    return Err([usageError(`${path}: cannot be read`)])
  }
  const loaded = contractLoad(text, path)
  if (loaded.isErr()) {
    return Err(emitRefuseAll(path, loaded.error))
  }
  const c = loaded.value
  const ctx = new CheckContext(path, sourceInstallRoot())
  const checked = checkContract(ctx, c)
  const failure = ctx.toolFailure
  if (failure !== null) {
    return Err([usageError(`${path}: cannot be checked: ${failure}`)])
  }
  if (!checkPassed(checked)) {
    return Err(emitRefuseAll(path, checkLines(checked)))
  }
  const opts = new EmitOptions(sha256Hex(text))
  opts.regenerate = regenerate
  opts.slow = target.slow
  const placed = emitResolveModules(packages, c, fromDir, opts, emitTargetExt(target.lang))
  if (placed.isErr()) {
    return Err([usageError(placed.error)])
  }
  const program =
    target.lang === "python"
      ? emitPyProgram(c, checked.samples, opts, target.harness)
      : target.lang === "rust"
        ? emitRsProgram(c, checked.samples, opts, target.harness)
        : target.lang === "go"
          ? emitGoProgram(c, checked.samples, opts, target.harness)
          : target.lang === "typescript"
            ? emitTsProgram(c, checked.samples, opts, target.harness)
            : emitProgram(c, checked.samples, opts)
  if (program.isErr()) {
    return Err(emitRefuseAll(path, program.error))
  }
  return Ok(new EmitFile(c, program.value))
}

/**
 * Writes a file whole or not at all: to a fresh temporary beside it, then
 * renamed over it.
 *
 * @param path where to write
 * @param data the text
 * @returns true, or why it could not be written
 */
export const emitWriteFile = (path: string, data: string): Result<boolean, string> => {
  const bytes: u8[] = new Array<u8>(8)
  for (let attempt = 0; attempt < 16; attempt++) {
    crypto.getRandomValues(bytes)
    const temp = `${path}.vector-${toHex(bytes)}.tmp`
    const written = createFileExclusiveSync(temp, data, 0o644)
    if (written === -17) {
      continue
    }
    if (written < 0) {
      // A failed write may leave the temporary behind; its name is random
      // and ours, so removing it whether or not it was made is safe.
      unlinkSync(temp)
      return Err(`${path}: cannot write file (errno ${-toI64(written)})`)
    }
    const renamed = renameSync(temp, path)
    if (renamed < 0) {
      unlinkSync(temp)
      return Err(`${path}: cannot write file (errno ${-toI64(renamed)})`)
    }
    return Ok(true)
  }
  return Err(`${path}: cannot find a free temporary file name beside it`)
}

/**
 * Reports every diagnostic, and answers the worst exit code among them.
 *
 * @param ds the diagnostics
 * @returns the highest of their codes; 2 when there are none
 */
export const emitReportAll = (ds: Diagnostic[]): i32 => {
  let code = EXIT_PASS
  for (const d of ds) {
    const c = report(d)
    code = c > code ? c : code
  }
  return code === EXIT_PASS ? EXIT_USAGE : code
}

/**
 * `vector spec emit <contract.json> -o <test>`: emits the contract's test,
 * in the language `--lang` names, and writes it. Exits 0 when written, 1 when the contract is refused, and 2
 * for bad usage, a file that cannot be read or written, or a tool (z3) that
 * failed.
 *
 * @param path the contract file
 * @param out where to write the test; null is a usage error
 * @param packageFlags the `--package <name>=<dir>` flags' values
 * @param lang the `--lang` flag, or null for nish
 * @param harness the `--harness` flag, or null for the language's default
 * @param slow the `--slow` flag: whether a slow iterated vector runs rather than skips
 * @returns the exit code
 */
export const emitCommand = (
  path: string,
  out: string | null,
  packageFlags: string[],
  lang: string | null,
  harness: string | null,
  slow: boolean,
): i32 => {
  if (out === null) {
    return report(usageError("spec emit: -o <file> is required"))
  }
  const target = emitTargetParse(lang, harness)
  if (target.isErr()) {
    return report(usageError(`spec emit: ${target.error}`))
  }
  const t = target.value
  t.slow = slow
  const packages = emitParsePackages(packageFlags, t.lang)
  if (packages.isErr()) {
    return report(usageError(`spec emit: ${packages.error}`))
  }
  const m = packages.value
  const regenerate = `vector spec emit ${path}${emitTargetFlags(t)}${emitPackageFlags(m)} -o ${out}`
  const emitted = emitContractFile(path, regenerate, m, dirname(out), t)
  if (emitted.isErr()) {
    return emitReportAll(emitted.error)
  }
  const written = emitWriteFile(out, emitted.value.program)
  if (written.isErr()) {
    return report(usageError(`spec emit: ${written.error}`))
  }
  console.log(`wrote ${out}`)
  return EXIT_PASS
}
