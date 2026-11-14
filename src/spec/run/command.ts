/**
 * `spec/run/command` — `vector spec run`: emit a contract's test, run it (with
 * a nish install, or the language's own interpreter), and report the verdict
 * per requirement.
 */

import { EXIT_PASS, EXIT_REFUSED, report, usageError } from "../../core/diag"
import { dirname, joinPath, makeTempDir } from "../../core/fs"
import { Contract } from "../contract/types"
import { emitContractFile, emitReportAll, emitWriteFile } from "../emit/file"
import { emitPackageFlags, emitParsePackages } from "../emit/packages"
import { EmitTarget, emitTargetExt, emitTargetFlags, emitTargetParse } from "../emit/target"
import {
  RunResult,
  runDisposeScratch,
  runFormatJson,
  runFormatMarkdown,
  runFormatText,
  runMakeScratch,
  runRemove,
  runTestCommand,
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
  /** The `--lang` flag, or null for nish. */
  lang: string | null = null
  /** The `--harness` flag, or null for the language's default. */
  harness: string | null = null

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

/**
 * The interpreter a Python test runs with: `VECTOR_PYTHON`, else `python3`.
 *
 * @returns the command
 */
export const runPython = (): string => getenv("VECTOR_PYTHON") ?? "python3"

/**
 * The compiler a Rust test builds with: `VECTOR_RUSTC`, else `rustc`.
 *
 * @returns the command
 */
export const runRustc = (): string => getenv("VECTOR_RUSTC") ?? "rustc"

/**
 * The runtime a TypeScript test runs with, by its built-in type stripping:
 * `VECTOR_NODE`, else `node`.
 *
 * @returns the command
 */
export const runNode = (): string => getenv("VECTOR_NODE") ?? "node"

/**
 * A Rust test compiled in a temporary directory with overflow checks on,
 * then run with the nonce. A test that does not compile prints no
 * transcript, so it is judged an error, with rustc's messages kept.
 */
const runRust = (c: Contract, file: string): Result<RunResult, string> => {
  const dir = makeTempDir("vector-rs-").orReturn()
  const bin = joinPath(dir, "test")
  const script = '"$1" --edition 2021 --crate-name vector_test -C overflow-checks=on -o "$3" "$2" && exec "$3" "$4"'
  const ran = runTestCommand(c, ["sh", "-c", script, "sh", runRustc(), file, bin], RUN_TIMEOUT_MS)
  runDropTemp(dir)
  return ran
}

/**
 * The test at `file` run in its language: Python by `runPython`, writing no
 * bytecode beside the modules it loads; Rust compiled by `runRustc`;
 * TypeScript by `runNode`, its type stripping's warning silenced; Nish by
 * `--nish` as it is, else in a scratch copy of the nish root.
 */
const runWith = (req: RunRequest, target: EmitTarget, c: Contract, file: string): Result<RunResult, string> => {
  if (target.lang === "python") {
    return runTestCommand(c, [runPython(), "-B", file], RUN_TIMEOUT_MS)
  }
  if (target.lang === "rust") {
    return runRust(c, file)
  }
  if (target.lang === "typescript") {
    return runTestCommand(c, [runNode(), "--disable-warning=ExperimentalWarning", file], RUN_TIMEOUT_MS)
  }
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
  const r = runRemove(dir)
  if (r.isErr()) {
    console.error(`vector: warning: spec run: ${r.error}`)
  }
}

/**
 * Emits the contract's test, writes it to `-o` or else a fresh temporary
 * directory, and runs it from there, so its imports of your own modules
 * resolve from where it is.
 */
const runEmitAndRun = (req: RunRequest, target: EmitTarget, tempDir: string | null, file: string): i32 => {
  const packages = emitParsePackages(req.packages, target.lang)
  if (packages.isErr()) {
    return report(usageError(`spec run: ${packages.error}`))
  }
  // A test kept with -o names how to regenerate it, as `spec emit -o` writes it.
  const flags = `${emitTargetFlags(target)}${emitPackageFlags(packages.value)}`
  const regenerate: string | null = tempDir === null ? `vector spec emit ${req.contractPath}${flags} -o ${file}` : null
  const emitted = emitContractFile(req.contractPath, regenerate, packages.value, dirname(file), target)
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
  const ran = runWith(req, target, e.contract, file)
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
 * `vector spec run`: emits the contract's test in the language `--lang`
 * names, runs it (a Nish test against a nish install), and prints the verdict. Exits 0 when SATISFIED, 1 when VIOLATED
 * or ERROR or the contract is refused, and 2 for bad usage or an I/O failure.
 *
 * @param req what was asked
 * @returns the exit code
 */
export const runCommand = (req: RunRequest): i32 => {
  if (req.format !== "text" && req.format !== "markdown" && req.format !== "json") {
    return report(usageError(`spec run: --format must be text, markdown or json, not ${req.format}`))
  }
  const target = emitTargetParse(req.lang, req.harness)
  if (target.isErr()) {
    return report(usageError(`spec run: ${target.error}`))
  }
  const out = req.out
  if (out !== null) {
    return runEmitAndRun(req, target.value, null, out)
  }
  const temp = makeTempDir("vector-run-")
  if (temp.isErr()) {
    return report(usageError(`spec run: ${temp.error}`))
  }
  const main = joinPath(temp.value, `main${emitTargetExt(target.value.lang)}`)
  const code = runEmitAndRun(req, target.value, temp.value, main)
  runDropTemp(temp.value)
  return code
}
