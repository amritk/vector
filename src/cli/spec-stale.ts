/**
 * `cli/spec-stale` — `vector spec stale`: refuse a generated test that no longer matches its contract.
 *
 * The test's one `// vector-contract-sha256:` line must name the SHA-256 of
 * the contract file's bytes (`spec/pr/stale`).
 */

import { Cli, ParseResult } from "nish/cli-args"
import { report, usageError } from "../core/diag"
import { prCliFinish, prCliFormat } from "../spec/pr/cli"
import { PrReport } from "../spec/pr/report"
import { staleReason } from "../spec/pr/stale"

/** The id `vector spec stale` is parsed to. */
export const SPEC_STALE_ID: i32 = 8

/** `vector spec stale`, declared on a `Cli`: its handles and its handler. */
export class SpecStaleCommand {
  /** The `--format <f>` flag. */
  formatFlag: i32
  /** The `<test.ts>` argument. */
  testTsArg: i32
  /** The `<contract.json>` argument. */
  contractJsonArg: i32

  /**
   * Declares `vector spec stale` and its flags under `parent`.
   *
   * @param cli the command tree
   * @param parent the handle to declare it under (`ROOT` or the `spec` group)
   */
  constructor(cli: Cli, parent: i32) {
    const handle = cli.command(
      parent,
      "stale",
      SPEC_STALE_ID,
      "Refuse a generated test that no longer matches its contract",
    )
    this.formatFlag = cli.flag(handle, "--format <f>", "text (default), markdown (a PR comment) or json")
    this.testTsArg = cli.argument(handle, "<test.ts>", "the generated test")
    this.contractJsonArg = cli.argument(handle, "<contract.json>", "the contract it came from")
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
    const testPath = r.positional(this.testTsArg) ?? ""
    const contractPath = r.positional(this.contractJsonArg) ?? ""
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
 * @returns the declared command, whose `run` handles it
 */
export const registerSpecStale = (cli: Cli, parent: i32): SpecStaleCommand => new SpecStaleCommand(cli, parent)
