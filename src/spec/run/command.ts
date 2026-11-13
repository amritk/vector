/**
 * `spec/run/command` — `vector spec run`: emit a contract's test, run it with
 * a nish install, and report the verdict per requirement.
 */

import { EXIT_PASS, EXIT_REFUSED, report, usageError } from "../../core/diag"
import { dirname, joinPath, makeTempDir } from "../../core/fs"
import { runProcess } from "../../core/process"
import { Contract } from "../contract/types"
import { emitContractFile, emitReportAll, emitWriteFile } from "../emit/file"
import { emitPackageFlags, emitParsePackages } from "../emit/packages"
import {
  RunResult,
  runDisposeScratch,
  runFormatJson,
  runFormatMarkdown,
  runFormatText,
  runMakeScratch,
  runTestFile,
} from "./run"

/** How long a test may compile and run, in milliseconds. */
const RUN_TIMEOUT_MS: i32 = 600000

/** What `vector spec run` was asked to do. */
export class RunRequest {
  /** The contract file. */
  contractPath: string
  /** Where to keep the emitted test, or null to keep none. */
  out: string | null = null
  /** The `--nish-root` flag, or null when it was not given. */
  nishRoot: string | null = null
  /** The `--nish` flag: a compiler to run as it is, or null. */
  nish: string | null = null
  /** text, markdown or json. */
  format: string
  /** The `--package <name>=<dir>` flags' values. */
  packages: string[]

  /**
   * Makes a request with every option at its default.
   *
   * @param contractPath the contract file
   */
  constructor(contractPath: string) {
    this.contractPath = contractPath
    this.format = "text"
    this.packages = []
  }
}

/**
 * The nish checkout to run against: `--nish-root`, else `VECTOR_NISH_ROOT`,
 * else `../nish` when it is a directory.
 *
 * @param flag the `--nish-root` flag, or null
 * @returns the directory, or why there is none
 */
export const runFindRoot = (flag: string | null): Result<string, string> => {
  const root = flag ?? getenv("VECTOR_NISH_ROOT") ?? "../nish"
  if (!isDirectorySync(root)) {
    return Err(`${root}: not a nish checkout (give --nish-root or set VECTOR_NISH_ROOT)`)
  }
  return Ok(root)
}

/**
 * The test at `file` run in a scratch install of `root`, removed afterwards.
 * A scratch that cannot be removed is warned about, and the verdict stands.
 */
const runInScratch = (c: Contract, file: string, root: string): Result<RunResult, string> => {
  const s = runMakeScratch(root, [], []).orReturn()
  const ran = runTestFile(c, file, s.nish, RUN_TIMEOUT_MS)
  const gone = runDisposeScratch(s)
  if (gone.isErr()) {
    console.error(`vector: warning: spec run: ${gone.error}`)
  }
  return ran
}

/** The test at `file` run by `--nish` as it is, else in a scratch copy of the nish root. */
const runWith = (req: RunRequest, c: Contract, file: string): Result<RunResult, string> => {
  const nish = req.nish
  if (nish !== null) {
    return runTestFile(c, file, nish, RUN_TIMEOUT_MS)
  }
  const root = runFindRoot(req.nishRoot).orReturn()
  return runInScratch(c, file, root)
}

/** Removes the temporary directory a test ran from, warning when it cannot. */
const runDropTemp = (dir: string | null): void => {
  if (dir === null) {
    return
  }
  const r = runProcess(["rm", "-rf", dir], "", 120000)
  if (r.isErr() || r.value.status !== 0) {
    console.error(`vector: warning: spec run: cannot remove ${dir}`)
  }
}

/**
 * Emits the contract's test, writes it to `-o` or else a fresh temporary
 * directory, and runs it from there, so its imports of your own modules
 * resolve from where it is.
 */
const runEmitAndRun = (req: RunRequest, tempDir: string | null, file: string): i32 => {
  const packages = emitParsePackages(req.packages)
  if (packages.isErr()) {
    return report(usageError(`spec run: ${packages.error}`))
  }
  // A test kept with -o names how to regenerate it, as `spec emit -o` writes it.
  const regenerate: string | null =
    tempDir === null ? `vector spec emit ${req.contractPath}${emitPackageFlags(packages.value)} -o ${file}` : null
  const emitted = emitContractFile(req.contractPath, regenerate, packages.value, dirname(file))
  if (emitted.isErr()) {
    return emitReportAll(emitted.error)
  }
  const e = emitted.value
  if (tempDir === null) {
    const written = emitWriteFile(file, e.program)
    if (written.isErr()) {
      return report(usageError(`spec run: ${written.error}`))
    }
  } else {
    const n = writeFileSyncMode(file, e.program, 0o600)
    if (n < 0) {
      return report(usageError(`spec run: cannot write ${file} (errno ${-n})`))
    }
  }
  const ran = runWith(req, e.contract, file)
  if (ran.isErr()) {
    return report(usageError(`spec run: ${ran.error}`))
  }
  console.log(runFormat(ran.value, req.format))
  return ran.value.verdict.status === "SATISFIED" ? EXIT_PASS : EXIT_REFUSED
}

/**
 * The report in the requested format.
 *
 * @param r the run's result
 * @param format text, markdown or json
 * @returns the report's text
 */
export const runFormat = (r: RunResult, format: string): string => {
  if (format === "json") {
    return runFormatJson(r)
  }
  if (format === "markdown") {
    return runFormatMarkdown(r)
  }
  return runFormatText(r).join("\n")
}

/**
 * `vector spec run`: emits the contract's test, runs it against a nish
 * install, and prints the verdict. Exits 0 when SATISFIED, 1 when VIOLATED
 * or ERROR or the contract is refused, and 2 for bad usage or an I/O failure.
 *
 * @param req what was asked
 * @returns the exit code
 */
export const runCommand = (req: RunRequest): i32 => {
  if (req.format !== "text" && req.format !== "markdown" && req.format !== "json") {
    return report(usageError(`spec run: --format must be text, markdown or json, not ${req.format}`))
  }
  const out = req.out
  if (out !== null) {
    return runEmitAndRun(req, null, out)
  }
  const temp = makeTempDir("vector-run-")
  if (temp.isErr()) {
    return report(usageError(`spec run: ${temp.error}`))
  }
  const code = runEmitAndRun(req, temp.value, joinPath(temp.value, "main.ts"))
  runDropTemp(temp.value)
  return code
}
