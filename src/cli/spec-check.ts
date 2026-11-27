/**
 * `cli/spec-check` — `vector spec check`: check a contract's quotes and vectors against its source.
 *
 * It reads the contract, runs every gate (src/spec/check.ts) and prints the
 * report as text, markdown or JSON. Exit 0 when every gate passed, 1 when one
 * found something (a contract the schema refuses included: its structural
 * errors are the shape gate's findings, in the same report), 2 for bad usage,
 * a contract that cannot be read or is not JSON, or a tool (z3, a source
 * command's shell) that failed.
 */

import { Cli, CliArgument, CliFlag, ParseResult } from "nish/cli-args"
import { trim } from "nish/text"
import { EXIT_PASS, EXIT_REFUSED, EXIT_USAGE, report, usageError } from "../core/diag"
import { joinPath } from "../core/fs"
import { newJsonDocument, parseJson } from "../core/json"
import { runProcess } from "../core/process"
import { CheckContext, CheckReport, checkContract, checkGates, checkPassed, checkRefused } from "../spec/check"
import { contractFromJson } from "../spec/contract/read"
import { Contract } from "../spec/contract/types"
import { gateRunCommands } from "../spec/gates/run"
import { reportSafe } from "../spec/report/common"
import { reportJson } from "../spec/report/json"
import { reportMarkdown } from "../spec/report/markdown"
import { reportText } from "../spec/report/text"
import { sourceInstallRoot } from "../spec/source/path"

/** The id `vector spec check` is parsed to. */
export const SPEC_CHECK_ID: i32 = 4

/** `vector spec check`, declared on a `Cli`: its handles and its handler. */
export class SpecCheckCommand {
  /** The `--spec <file>` flag. */
  specFlag: CliFlag
  /** The `--run-sources` flag. */
  runSourcesFlag: CliFlag
  /** The `--module <file>` flag. */
  moduleFlag: CliFlag
  /** The `--nish-root <dir>` flag. */
  nishRootFlag: CliFlag
  /** The `--format <f>` flag. */
  formatFlag: CliFlag
  /** The `<contract.json>` argument. */
  contractJsonArg: CliArgument

  /**
   * Holds what `registerSpecCheck` declared for `vector spec check`.
   *
   * @param specFlag the `--spec <file>` flag
   * @param runSourcesFlag the `--run-sources` flag
   * @param moduleFlag the `--module <file>` flag
   * @param nishRootFlag the `--nish-root <dir>` flag
   * @param formatFlag the `--format <f>` flag
   * @param contractJsonArg the `<contract.json>` argument
   */
  constructor(
    specFlag: CliFlag,
    runSourcesFlag: CliFlag,
    moduleFlag: CliFlag,
    nishRootFlag: CliFlag,
    formatFlag: CliFlag,
    contractJsonArg: CliArgument,
  ) {
    this.specFlag = specFlag
    this.runSourcesFlag = runSourcesFlag
    this.moduleFlag = moduleFlag
    this.nishRootFlag = nishRootFlag
    this.formatFlag = formatFlag
    this.contractJsonArg = contractJsonArg
  }

  /**
   * Runs the command.
   *
   * @param r the parsed arguments
   * @returns the exit code
   */
  run(r: ParseResult): i32 {
    const path = r.readPositional(this.contractJsonArg) ?? ""
    const format = r.readValue(this.formatFlag) ?? "text"
    if (format !== "text" && format !== "markdown" && format !== "json") {
      return report(usageError(`spec check: --format expects text, markdown or json, not ${format}`))
    }
    const spec = r.readValue(this.specFlag)
    if (spec !== null && realpathSync(spec) === null) {
      return report(usageError(`spec check: --spec ${spec} cannot be read`))
    }
    const ctx = new CheckContext(path, sourceInstallRoot())
    ctx.format = format
    ctx.specPath = spec
    ctx.moduleFile = r.readValue(this.moduleFlag)
    ctx.nishRoot = r.readValue(this.nishRootFlag)
    ctx.runSources = r.readFlag(this.runSourcesFlag)
    const text = readFileSyncOrNull(path)
    if (text === null) {
      return report(usageError(`${path}: cannot be read`))
    }
    const doc = newJsonDocument()
    const root = parseJson(doc, text, path)
    if (root.isErr()) {
      return report(usageError(root.error))
    }
    const parsed = contractFromJson(doc, root.value)
    if (parsed.isErr()) {
      console.log(specCheckRender(ctx, checkRefused(ctx, "shape", parsed.error, checkGates())))
      return EXIT_REFUSED
    }
    const contract = parsed.value
    if (ctx.runSources) {
      const warning = specCheckForeignWarning(path, contract, specCheckRepoTop())
      if (warning !== null) {
        console.error(warning)
      }
    }
    const found = checkContract(ctx, contract)
    const failure = ctx.toolFailure
    if (failure !== null) {
      return report(usageError(`spec check: ${failure}`))
    }
    console.log(specCheckRender(ctx, found))
    return checkPassed(found) ? EXIT_PASS : EXIT_REFUSED
  }
}

/**
 * The report in the context's format.
 *
 * @param ctx the check's context, after the gates ran
 * @param found what they found
 * @returns the report's text
 */
export const specCheckRender = (ctx: CheckContext, found: CheckReport): string => {
  if (ctx.format === "json") {
    return reportJson(ctx, found)
  }
  return ctx.format === "markdown" ? reportMarkdown(ctx, found) : reportText(ctx, found)
}

/**
 * The top of the git repository the current directory is in.
 *
 * @returns its path, or null outside one or without git
 */
export const specCheckRepoTop = (): string | null => {
  const got = runProcess(["git", "rev-parse", "--show-toplevel"], "", 10000)
  if (got.isErr() || got.value.status !== 0) {
    return null
  }
  const top = trim(got.value.stdout)
  return top === "" ? null : top
}

/**
 * The warning `--run-sources` prints before it runs commands from a contract
 * outside the repository's contracts/: they run as the user, with the user's
 * files and network, so it lists each one. None when the contract is inside
 * it, or has no command.
 *
 * @param path the contract's path
 * @param c the contract
 * @param top the repository's top (specCheckRepoTop), or null outside one
 * @returns the warning, or null
 */
export const specCheckForeignWarning = (path: string, c: Contract, top: string | null): string | null => {
  const cmds = gateRunCommands(c)
  if (cmds.length === 0) {
    return null
  }
  const home: string | null = top === null ? null : realpathSync(joinPath(top, "contracts"))
  const real = realpathSync(path)
  if (home !== null && real !== null && real.startsWith(`${home}/`)) {
    return null
  }
  const where = home === null ? "a repository's contracts/" : `${home}/`
  const out: string[] = [
    `warning: --run-sources runs ${cmds.length} shell command(s) from ${path}, which is not in ${where}.`,
  ]
  out.push(
    "They run as you, with sh -c, from the contract's directory, with your environment, files and network. A timeout kills each command's process group, but not a process it detached with setsid. Read them first:",
  )
  for (const k of cmds) {
    const s = k.source
    out.push(`  [${reportSafe(k.id, 200)}] $ ${reportSafe(s === null ? "" : s.text, 2000)}`)
  }
  return out.join("\n")
}

/**
 * Declares `vector spec check` on the command tree.
 *
 * @param cli the command tree
 * @param parent the handle to declare it under
 * @returns the declared command, whose `run` handles it, or `Err` when the
 *   declaration is refused (a vector bug)
 */
export const registerSpecCheck = (cli: Cli, parent: i32): Result<SpecCheckCommand, string> => {
  const handle = cli
    .tryCommand(parent, "check", SPEC_CHECK_ID, "Check a contract's quotes and vectors against its source")
    .orReturn()
  const specFlag = cli
    .tryFlag(
      handle,
      "--spec <file>",
      "the source the contract quotes, RFC XML v3 or plain text (default: found next to the contract)",
    )
    .orReturn()
  const runSourcesFlag = cli
    .tryFlag(handle, "--run-sources", "run the vectors' command sources and check their output")
    .orReturn()
  const moduleFlag = cli
    .tryFlag(handle, "--module <file>", "the target module's source, for the signature gate")
    .orReturn()
  const nishRootFlag = cli
    .tryFlag(handle, "--nish-root <dir>", "a nish checkout: finds the module and the compiler")
    .orReturn()
  const formatFlag = cli.tryFlag(handle, "--format <f>", "text (default), markdown (a PR comment) or json").orReturn()
  const contractJsonArg = cli.tryArgument(handle, "<contract.json>", "the contract").orReturn()
  return Ok(new SpecCheckCommand(specFlag, runSourcesFlag, moduleFlag, nishRootFlag, formatFlag, contractJsonArg))
}
