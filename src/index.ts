/**
 * `@amritk/vector` — the package's entry point, the module a Nish program
 * reaches with `import { … } from "@amritk/vector"`. It holds the command
 * line (`vectorRun`, which `src/main.ts` calls with the process's arguments)
 * and the two proofs as functions of JSON text, which read no file and print
 * nothing.
 */

import { Style } from "nish/cli"
import { Cli, PARSE_HELP, ROOT, finish } from "nish/cli-args"
import { DIFF_ID, registerDiff } from "./cli/diff"
import { SPEC_CHECK_ID, registerSpecCheck } from "./cli/spec-check"
import { SPEC_EMIT_ID, registerSpecEmit } from "./cli/spec-emit"
import { SPEC_EXPORTS_ID, registerSpecExports } from "./cli/spec-exports"
import { SPEC_EXTRACT_ID, registerSpecExtract } from "./cli/spec-extract"
import { SPEC_FROZEN_ID, registerSpecFrozen } from "./cli/spec-frozen"
import { SPEC_MUTATE_ID, registerSpecMutate } from "./cli/spec-mutate"
import { SPEC_RUN_ID, registerSpecRun } from "./cli/spec-run"
import { SPEC_STALE_ID, registerSpecStale } from "./cli/spec-stale"
import { VERIFY_ID, registerVerify } from "./cli/verify"
import { EXIT_USAGE } from "./core/diag"
import { joinPath } from "./core/fs"
import { newJsonDocument, parseJson } from "./core/json"
import { sourceInstallRoot } from "./spec/source/path"
import { outJsonRender } from "./verify/emit/outjson"
import { diffOutcomeJson, diffPrograms } from "./verify/equiv/diff"
import { verifyOutcomeJson, verifySpecAndProgram } from "./verify/verify"

/** The version `vector --version` prints; kept equal to package.json's. */
export const VECTOR_VERSION: string = "0.6.1" // x-release-please-version

/** Where docs/AI.md is read when the binary's checkout does not hold it. */
const VECTOR_AI_DOC_URL: string = "https://github.com/amritk/vector/blob/main/docs/AI.md"

/**
 * Where an agent reads vector's rules, traps first, as the top-level help's
 * Agents section names it: `<root>/docs/AI.md` when that file exists, else
 * its URL on GitHub (a binary built from the npm library, which holds only
 * src/).
 *
 * @param root the checkout the binary was built from (sourceInstallRoot)
 * @returns the path of docs/AI.md under `root`, or its GitHub URL
 */
export const vectorAgentsDoc = (root: string): string => {
  const path = joinPath(root, "docs/AI.md")
  return realpathSync(path) !== null && !isDirectorySync(path) ? path : VECTOR_AI_DOC_URL
}

/**
 * Runs vector's command line over `args`, as `vector <args>` would: it
 * prints what the command prints, and `--help`, `--version` and a usage
 * error end the process, as they do for the binary.
 *
 * @param args the words after the program's name, such as `["verify", "spec.json", "program.json"]`
 * @returns the exit code: 0 pass, 1 refused, 2 usage, I/O or tool failure, or a replay `MISMATCH`
 */
export const vectorRun = (args: string[]): i32 => {
  const cli = new Cli("vector", VECTOR_VERSION, "Prove small programs correct, and hold implementations to their specs")
  const verify = registerVerify(cli, ROOT)
  const diff = registerDiff(cli, ROOT)
  const spec = cli.group(ROOT, "spec", "Turn a spec into a contract and a test, and gate changes on it")
  const extract = registerSpecExtract(cli, spec)
  const check = registerSpecCheck(cli, spec)
  const emit = registerSpecEmit(cli, spec)
  const run = registerSpecRun(cli, spec)
  const frozen = registerSpecFrozen(cli, spec)
  const stale = registerSpecStale(cli, spec)
  const exportsGate = registerSpecExports(cli, spec)
  const mutate = registerSpecMutate(cli, spec)

  const plain = new Style(false, false)
  const r = cli.parse(args, 0)
  if (r.kind === PARSE_HELP && r.command === ROOT) {
    // Not an epilog: the command-line reference copies epilogs, and this path is the checkout's.
    console.log(
      `${r.help(plain)}\n\nAgents\n  before using vector, read its rules, traps first:\n  ${vectorAgentsDoc(sourceInstallRoot())}`,
    )
    process.exit(0)
  }
  finish(r, plain, plain)
  if (r.id === VERIFY_ID) return verify.run(r)
  if (r.id === DIFF_ID) return diff.run(r)
  if (r.id === SPEC_EXTRACT_ID) return extract.run(r)
  if (r.id === SPEC_CHECK_ID) return check.run(r)
  if (r.id === SPEC_EMIT_ID) return emit.run(r)
  if (r.id === SPEC_RUN_ID) return run.run(r)
  if (r.id === SPEC_FROZEN_ID) return frozen.run(r)
  if (r.id === SPEC_STALE_ID) return stale.run(r)
  if (r.id === SPEC_EXPORTS_ID) return exportsGate.run(r)
  if (r.id === SPEC_MUTATE_ID) return mutate.run(r)
  console.error(r.help(plain))
  return EXIT_USAGE
}

/**
 * Proves a program meets its spec plan, as `vector verify --json` does, from
 * the two documents' text rather than their files.
 *
 * @param specText the spec plan, as JSON text
 * @param programText the program, as JSON text
 * @returns `Ok` with the outcome `vector verify --json` prints (its `status`
 *   is PROVEN, REFUTED, UNKNOWN, INVALID or ERROR), or `Err` when either text
 *   is not JSON
 */
export const vectorVerifyJson = (specText: string, programText: string): Result<string, string> => {
  const specDoc = newJsonDocument()
  const specRoot = parseJson(specDoc, specText, "spec plan").orReturn()
  const programDoc = newJsonDocument()
  const programRoot = parseJson(programDoc, programText, "program").orReturn()
  const outcome = verifySpecAndProgram(specDoc, specRoot, programDoc, programRoot, "verify")
  return Ok(outJsonRender(verifyOutcomeJson(outcome)))
}

/**
 * Proves two versions of a program equivalent, or shows where they differ,
 * as `vector diff --json` does, from the two documents' text.
 *
 * @param oldText the program before, as JSON text
 * @param newText the program after, as JSON text
 * @returns `Ok` with the outcome `vector diff --json` prints (its `status` is
 *   EQUIVALENT, DIFFERENT, UNDECIDED, INVALID or ERROR), or `Err` when
 *   either text is not JSON
 */
export const vectorDiffJson = (oldText: string, newText: string): Result<string, string> => {
  const oldDoc = newJsonDocument()
  const oldRoot = parseJson(oldDoc, oldText, "old program").orReturn()
  const newDoc = newJsonDocument()
  const newRoot = parseJson(newDoc, newText, "new program").orReturn()
  return Ok(outJsonRender(diffOutcomeJson(diffPrograms(oldDoc, oldRoot, newDoc, newRoot))))
}
