/**
 * `cli/spec-stale` — `vector spec stale`: refuse a generated test that no longer matches its contract.
 *
 * The test's one `// vector-contract-sha256:` line must name the SHA-256 of
 * the contract file's bytes (`spec/pr/stale`).
 */

import { Cli, CliArgument, CliFlag, ParseResult } from "nish/cli-args"
import { report, usageError } from "../core/diag"
import { prCliFinish, prCliFormat } from "../spec/pr/cli"
import { PrReport } from "../spec/pr/report"
import { staleReason } from "../spec/pr/stale"

/** The id `vector spec stale` is parsed to. */
export const SPEC_STALE_ID: i32 = 8

/** `vector spec stale`, declared on a `Cli`: its handles and its handler. */
export class SpecStaleCommand {
  /** The `--format <f>` flag. */
  formatFlag: CliFlag
  /** The `<test.ts>` argument. */
  testTsArg: CliArgument
  /** The `<contract.json>` argument. */
  contractJsonArg: CliArgument

  /**
   * Holds what `registerSpecStale` declared for `vector spec stale`.
   *
   * @param formatFlag the `--format <f>` flag
   * @param testTsArg the `<test.ts>` argument
   * @param contractJsonArg the `<contract.json>` argument
   */
  constructor(formatFlag: CliFlag, testTsArg: CliArgument, contractJsonArg: CliArgument) {
    this.formatFlag = formatFlag
    this.testTsArg = testTsArg
    this.contractJsonArg = contractJsonArg
  }

  /**
   * Runs the command: exit 0 when the test names the contract's bytes, 1 when
   * not, 2 for bad usage or a file that cannot be read.
   *
   * @param r the parsed arguments
   * @returns the exit code
   */
  run(r: ParseResult): i32 {
    const format = prCliFormat(r, this.formatFlag)
    if (format.isErr()) {
      return report(usageError(`spec stale: ${format.error}`))
    }
    const testPath = r.readPositional(this.testTsArg) ?? ""
    const contractPath = r.readPositional(this.contractJsonArg) ?? ""
    const test = readFileSyncOrNull(testPath)
    if (test === null) {
      return report(usageError(`spec stale: ${testPath}: cannot be read`))
    }
    const contract = readFileSyncOrNull(contractPath)
    if (contract === null) {
      return report(usageError(`spec stale: ${contractPath}: cannot be read`))
    }
    const out = new PrReport("stale", `spec stale ${testPath} against ${contractPath}`)
    const reason = staleReason(test, contract)
    if (reason !== null) {
      out.problems.push(`${testPath}: ${reason}`)
    }
    return prCliFinish("spec stale", Ok(out), format.value)
  }
}

/**
 * Declares `vector spec stale` on the command tree.
 *
 * @param cli the command tree
 * @param parent the handle to declare it under
 * @returns the declared command, whose `run` handles it, or `Err` when the
 *   declaration is refused (a vector bug)
 */
export const registerSpecStale = (cli: Cli, parent: i32): Result<SpecStaleCommand, string> => {
  const handle = cli
    .tryCommand(parent, "stale", SPEC_STALE_ID, "Refuse a generated test that no longer matches its contract")
    .orReturn()
  const formatFlag = cli.tryFlag(handle, "--format <f>", "text (default), markdown (a PR comment) or json").orReturn()
  const testTsArg = cli.tryArgument(handle, "<test.ts>", "the generated test").orReturn()
  const contractJsonArg = cli.tryArgument(handle, "<contract.json>", "the contract it came from").orReturn()
  return Ok(new SpecStaleCommand(formatFlag, testTsArg, contractJsonArg))
}
