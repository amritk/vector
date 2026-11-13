/**
 * `vector` — the command-line entry point. It declares every command, parses
 * the arguments, and hands the matched command its parsed arguments. `--help`
 * and `--version` are answered here; everything else belongs to a command.
 */

import { Style } from "nish/cli"
import { Cli, ROOT, finish } from "nish/cli-args"
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

/** The version `vector --version` prints; kept equal to package.json's. */
export const VECTOR_VERSION: string = "0.1.0"

/**
 * Runs vector with the process's arguments.
 *
 * @returns the exit code: 0 pass, 1 refused, 2 usage or I/O
 */
export const main = (): i32 => {
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
  const r = cli.parse(process.argv, 1)
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
