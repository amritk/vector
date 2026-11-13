import { Cli, ParseResult, ROOT } from "nish/cli-args"
import { Suite } from "nish/testing"
import { prCliBase, prCliFinish, prCliFormat } from "../../../src/spec/pr/cli"
import { PrReport } from "../../../src/spec/pr/report"

/** The handles of a gate's flags in a test's own Cli. */
class PrCliTestFlags {
  /** The Cli. */
  cli: Cli
  /** `--base`. */
  base: i32
  /** `--format`. */
  format: i32

  constructor() {
    this.cli = new Cli("vector", "0.0.0", "test")
    const cmd = this.cli.command(ROOT, "gate", 1, "a gate")
    this.base = this.cli.flag(cmd, "--base <ref>", "the base")
    this.format = this.cli.flag(cmd, "--format <f>", "the format")
  }

  /** Parses `vector gate` and `args`. */
  parse(args: string[]): ParseResult {
    const argv: string[] = ["vector", "gate"]
    for (const a of args) {
      argv.push(a)
    }
    return this.cli.parse(argv, 1)
  }
}

/** What the gates' commands share: --format, --base and the exit code. */
export const main = (): i32 => {
  const t = new Suite("spec/pr cli")
  const f = new PrCliTestFlags()
  const noArgs: string[] = []
  const none = f.parse(noArgs)
  const fmt = prCliFormat(none, f.format)
  t.eqStr("the format defaults to text", fmt.isOk() ? fmt.value : "<err>", "text")
  const md = prCliFormat(f.parse(["--format", "markdown"]), f.format)
  t.eqStr("a format is read", md.isOk() ? md.value : "<err>", "markdown")
  t.ok("an unknown format is refused", prCliFormat(f.parse(["--format", "html"]), f.format).isErr())
  const missing = prCliBase(none, f.base)
  t.ok("--base is required", missing.isErr() && missing.error.startsWith("--base <ref> is required"))
  const base = prCliBase(f.parse(["--base", "origin/main"]), f.base)
  t.eqStr("a base is read", base.isOk() ? base.value : "<err>", "origin/main")
  t.ok("a range is refused", prCliBase(f.parse(["--base", "a..b"]), f.base).isErr())
  t.ok("an option is refused", prCliBase(f.parse(["--base=-x"]), f.base).isErr())
  const pass = new PrReport("t", "a gate")
  t.ok("a clean report passes", prCliFinish("gate", Ok(pass), "text") === 0)
  const fail = new PrReport("t", "a gate")
  fail.problems.push("a problem")
  t.ok("a problem refuses", prCliFinish("gate", Ok(fail), "json") === 1)
  t.ok("a gate that cannot run is exit 2", prCliFinish("gate", Err("git failed"), "text") === 2)
  return t.done()
}
