/**
 * `cli/spec-mutate` — `vector spec mutate`: mutate the changed lines of the contract's module and refuse mutants the test misses.
 *
 * The change's lines in the contract's target module are mutated, and the
 * test must kill every mutant that builds (`spec/pr/mutate`, run by
 * `spec/pr/mutaterun`).
 */

import { Cli, CliArgument, CliFlag, ParseResult } from "nish/cli-args"
import { report, usageError } from "../core/diag"
import { prCliBase, prCliFinish, prCliFormat } from "../spec/pr/cli"
import { MutateRun, mutateCheck } from "../spec/pr/mutaterun"

/** The id `vector spec mutate` is parsed to. */
export const SPEC_MUTATE_ID: i32 = 10

/** `vector spec mutate`, declared on a `Cli`: its handles and its handler. */
export class SpecMutateCommand {
  /** The `--base <ref>` flag. */
  baseFlag: CliFlag
  /** The `--nish-root <dir>` flag. */
  nishRootFlag: CliFlag
  /** The `--nish <bin>` flag. */
  nishFlag: CliFlag
  /** The `--test <file>` flag. */
  testFlag: CliFlag
  /** The `--jobs <n>` flag. */
  jobsFlag: CliFlag
  /** The `--max <n>` flag. */
  maxFlag: CliFlag
  /** The `--format <f>` flag. */
  formatFlag: CliFlag
  /** The `<contract.json>` argument. */
  contractJsonArg: CliArgument

  /**
   * Holds what `registerSpecMutate` declared for `vector spec mutate`.
   *
   * @param baseFlag the `--base <ref>` flag
   * @param nishRootFlag the `--nish-root <dir>` flag
   * @param nishFlag the `--nish <bin>` flag
   * @param testFlag the `--test <file>` flag
   * @param jobsFlag the `--jobs <n>` flag
   * @param maxFlag the `--max <n>` flag
   * @param formatFlag the `--format <f>` flag
   * @param contractJsonArg the `<contract.json>` argument
   */
  constructor(
    baseFlag: CliFlag,
    nishRootFlag: CliFlag,
    nishFlag: CliFlag,
    testFlag: CliFlag,
    jobsFlag: CliFlag,
    maxFlag: CliFlag,
    formatFlag: CliFlag,
    contractJsonArg: CliArgument,
  ) {
    this.baseFlag = baseFlag
    this.nishRootFlag = nishRootFlag
    this.nishFlag = nishFlag
    this.testFlag = testFlag
    this.jobsFlag = jobsFlag
    this.maxFlag = maxFlag
    this.formatFlag = formatFlag
    this.contractJsonArg = contractJsonArg
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
    const root = r.readValue(this.nishRootFlag)
    if (root === null) {
      return report(
        usageError("spec mutate: --nish-root <dir> is required: the nish install or checkout holding the module"),
      )
    }
    const given = r.readValue(this.testFlag)
    if (given !== null && given.length === 0) {
      return report(usageError("spec mutate: --test takes a file; leave the flag out to emit the contract's test"))
    }
    const test = given ?? ""
    const jobs = specMutateCount(r.readValue(this.jobsFlag), 1)
    if (jobs < 1) {
      return report(usageError("spec mutate: --jobs takes a whole number of at least 1"))
    }
    const max = specMutateCount(r.readValue(this.maxFlag), 0)
    if (max < 0) {
      return report(usageError("spec mutate: --max takes a whole number"))
    }
    const nish = r.readValue(this.nishFlag)
    if (nish !== null && nish.length === 0) {
      return report(usageError("spec mutate: --nish takes a file; leave the flag out to build with the root's seed"))
    }
    const run = new MutateRun(root, "", nish ?? "", test, jobs, 0)
    const contract = r.readPositional(this.contractJsonArg) ?? ""
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
  // A plain string local, so the prover keeps the loop's bound on it.
  const s: string = v
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
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
 * @returns the declared command, whose `run` handles it, or `Err` when the
 *   declaration is refused (a vector bug)
 */
export const registerSpecMutate = (cli: Cli, parent: i32): Result<SpecMutateCommand, string> => {
  const handle = cli
    .tryCommand(
      parent,
      "mutate",
      SPEC_MUTATE_ID,
      "Mutate the changed lines the contract's functions reach and refuse mutants the test misses",
    )
    .orReturn()
  const baseFlag = cli.tryFlag(handle, "--base <ref>", "the commit the change is against").orReturn()
  const nishRootFlag = cli
    .tryFlag(handle, "--nish-root <dir>", "a nish install, or a checkout: holds the module and builds the mutants")
    .orReturn()
  const nishFlag = cli
    .tryFlag(
      handle,
      "--nish <bin>",
      "a compiler built in the checkout, from --nish-root, to copy the checkout (default: the root's seed with its std/ laid over it)",
    )
    .orReturn()
  const testFlag = cli
    .tryFlag(
      handle,
      "--test <file>",
      "the test program to run against each mutant (default: the contract's test, emitted as spec emit does)",
    )
    .orReturn()
  const jobsFlag = cli.tryFlag(handle, "--jobs <n>", "mutants run at once (default 1)").orReturn()
  const maxFlag = cli
    .tryFlag(handle, "--max <n>", "at most this many mutants, spread over the changed lines")
    .orReturn()
  const formatFlag = cli.tryFlag(handle, "--format <f>", "text (default), markdown (a PR comment) or json").orReturn()
  const contractJsonArg = cli.tryArgument(handle, "<contract.json>", "the contract").orReturn()
  return Ok(
    new SpecMutateCommand(baseFlag, nishRootFlag, nishFlag, testFlag, jobsFlag, maxFlag, formatFlag, contractJsonArg),
  )
}
