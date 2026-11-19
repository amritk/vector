/**
 * `cli/spec-mutate` — `vector spec mutate`: mutate the changed lines and refuse mutants the test misses.
 *
 * The change's lines in the contract's target module are mutated, and the
 * test must kill every mutant that builds (`spec/pr/mutate`, run by
 * `spec/pr/mutaterun`).
 */

import { Cli, ParseResult } from "nish/cli-args"
import { report, usageError } from "../core/diag"
import { prCliBase, prCliFinish, prCliFormat } from "../spec/pr/cli"
import { MutateRun, mutateCheck } from "../spec/pr/mutaterun"

/** The id `vector spec mutate` is parsed to. */
export const SPEC_MUTATE_ID: i32 = 10

/** `vector spec mutate`, declared on a `Cli`: its handles and its handler. */
export class SpecMutateCommand {
  /** The `--base <ref>` flag. */
  baseFlag: i32
  /** The `--nish-root <dir>` flag. */
  nishRootFlag: i32
  /** The `--nish <bin>` flag. */
  nishFlag: i32
  /** The `--test <file>` flag. */
  testFlag: i32
  /** The `--jobs <n>` flag. */
  jobsFlag: i32
  /** The `--max <n>` flag. */
  maxFlag: i32
  /** The `--format <f>` flag. */
  formatFlag: i32
  /** The `<contract.json>` argument. */
  contractJsonArg: i32

  /**
   * Declares `vector spec mutate` and its flags under `parent`.
   *
   * @param cli the command tree
   * @param parent the handle to declare it under (`ROOT` or the `spec` group)
   */
  constructor(cli: Cli, parent: i32) {
    const handle = cli.command(
      parent,
      "mutate",
      SPEC_MUTATE_ID,
      "Mutate the changed lines the contract's functions reach and refuse mutants the test misses",
    )
    this.baseFlag = cli.flag(handle, "--base <ref>", "the commit the change is against")
    this.nishRootFlag = cli.flag(
      handle,
      "--nish-root <dir>",
      "a nish install, or a checkout: holds the module and builds the mutants",
    )
    this.nishFlag = cli.flag(
      handle,
      "--nish <bin>",
      "a compiler built in the checkout, from --nish-root, to copy the checkout (default: the root's seed with its std/ laid over it)",
    )
    this.testFlag = cli.flag(
      handle,
      "--test <file>",
      "the test program to run against each mutant (default: the contract's test, emitted as spec emit does)",
    )
    this.jobsFlag = cli.flag(handle, "--jobs <n>", "mutants run at once (default 1)")
    this.maxFlag = cli.flag(handle, "--max <n>", "at most this many mutants, spread over the changed lines")
    this.formatFlag = cli.flag(handle, "--format <f>", "text (default), markdown (a PR comment) or json")
    this.contractJsonArg = cli.argument(handle, "<contract.json>", "the contract")
  }

  /**
   * Runs the command: exit 0 when the test kills every mutant that builds or
   * the contract allows the survivor, 1 when not, 2 for bad usage, an
   * unreadable contract, module or test, a git failure, or a compiler that
   * fails for a reason the mutant did not cause.
   *
   * @param r the parsed arguments
   * @returns the exit code
   */
  run(r: ParseResult): i32 {
    const format = prCliFormat(r, this.formatFlag)
    if (format.isErr()) {
      return report(usageError(`spec mutate: ${format.error}`))
    }
    const base = prCliBase(r, this.baseFlag)
    if (base.isErr()) {
      return report(usageError(`spec mutate: ${base.error}`))
    }
    const root = r.value(this.nishRootFlag)
    if (root === null) {
      return report(
        usageError("spec mutate: --nish-root <dir> is required: the nish install or checkout holding the module"),
      )
    }
    const given = r.value(this.testFlag)
    if (given !== null && given.length === 0) {
      return report(usageError("spec mutate: --test takes a file; leave the flag out to emit the contract's test"))
    }
    const test = given ?? ""
    const jobs = specMutateCount(r.value(this.jobsFlag), 1)
    if (jobs < 1) {
      return report(usageError("spec mutate: --jobs takes a whole number of at least 1"))
    }
    const max = specMutateCount(r.value(this.maxFlag), 0)
    if (max < 0) {
      return report(usageError("spec mutate: --max takes a whole number"))
    }
    const nish = r.value(this.nishFlag)
    if (nish !== null && nish.length === 0) {
      return report(usageError("spec mutate: --nish takes a file; leave the flag out to build with the root's seed"))
    }
    const run = new MutateRun(root, "", nish ?? "", test, jobs, 0)
    const contract = r.positional(this.contractJsonArg) ?? ""
    return prCliFinish("spec mutate", mutateCheck(contract, base.value, run, max), format.value)
  }
}

/** A count flag's value: `fallback` when absent, -1 when not a whole number. */
const specMutateCount = (v: string | null, fallback: i32): i32 => {
  if (v === null) {
    return fallback
  }
  if (v.length === 0 || v.length > 6) {
    return -1
  }
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i)
    if (c < 48 || c > 57) {
      return -1
    }
  }
  return parseInt(v)
}

/**
 * Declares `vector spec mutate` on the command tree.
 *
 * @param cli the command tree
 * @param parent the handle to declare it under
 * @returns the declared command, whose `run` handles it
 */
export const registerSpecMutate = (cli: Cli, parent: i32): SpecMutateCommand => new SpecMutateCommand(cli, parent)
