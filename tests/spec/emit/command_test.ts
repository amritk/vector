import { Suite } from "nish/testing"
import { splitLines } from "nish/text"
import { Diagnostic, EXIT_REFUSED, EXIT_USAGE, refusal, usageError } from "../../../src/core/diag"
import { makeTempDir } from "../../../src/core/fs"
import { sha256Hex } from "../../../src/core/hex"
import { runProcess } from "../../../src/core/process"
import { Sample, SampleTable, checkAddSample } from "../../../src/spec/check"
import { contractLoadFile } from "../../../src/spec/contract/contract"
import { LitKind, Literal } from "../../../src/spec/contract/types"
import { EmitOptions, emitProgram } from "../../../src/spec/emit/emit"
import { EmitFile, emitCommand, emitContractFile, emitReportAll, emitWriteFile } from "../../../src/spec/emit/file"
import { RunRequest, runCommand, runFindRoot, runFormat } from "../../../src/spec/run/command"
import { RunResult, runDisposeScratch, runMakeScratch, runTest } from "../../../src/spec/run/run"

const GOLDEN: string = "tests/spec/emit/golden/example-hex.golden"
const REGENERATE: string = "vector spec emit contracts/example-hex.json -o tests/spec/emit/golden/example-hex.golden"

const hex = (h: string): Literal => new Literal(LitKind.Hex, h)
const str = (s: string): Literal => new Literal(LitKind.Str, s)

/**
 * Fixed samples for every property of contracts/example-hex.json, so the
 * golden copy shows sampled properties and does not move when the sampler
 * does.
 */
const commandHexSamples = (): SampleTable => {
  const t = new SampleTable()
  for (const id of ["P-ENC-LEN", "P-ENC-LOWER", "P-ROUND-TRIP"]) {
    checkAddSample(t, new Sample(id, [hex("00ff10ab")], "by hand"))
    checkAddSample(t, new Sample(id, [hex("")], "empty"))
  }
  checkAddSample(t, new Sample("P-CANONICAL", [str("00ff1a")], "by hand"))
  checkAddSample(t, new Sample("P-ANY-CASE", [str("aB0F")], "by hand"))
  checkAddSample(t, new Sample("P-ODD", [str("abc")], "by hand"))
  checkAddSample(t, new Sample("P-OTHER", [str("ab"), str("g"), str("0")], "by hand"))
  checkAddSample(t, new Sample("P-OTHER-EDGE", [str("ab"), str(":"), str("0")], "by hand"))
  checkAddSample(t, new Sample("P-PREFIX", [str("ab")], "by hand"))
  return t
}

/** contracts/example-hex.json emitted with the fixed samples, or "" when it is refused. */
const commandGolden = (): string => {
  const text = readFileSyncOrNull("contracts/example-hex.json") ?? ""
  const c = contractLoadFile("contracts/example-hex.json").expect("load example-hex")
  const opts = new EmitOptions(sha256Hex(text))
  opts.regenerate = REGENERATE
  const p = emitProgram(c, commandHexSamples(), opts)
  return p.isOk() ? p.value : ""
}

/**
 * Checks the commands behind `vector spec emit` and `vector spec run`, and
 * the program emitted for contracts/example-hex.json against its golden copy.
 * `VECTOR_UPDATE_GOLDEN=1` rewrites the golden copy instead.
 */
export const main = (): i32 => {
  const t = new Suite("spec/emit command")
  const dir = makeTempDir("vector-command-test-").expect("a scratch directory")

  t.ok(
    "example-hex emits through the command's path",
    emitContractFile("contracts/example-hex.json", REGENERATE).isOk(),
  )
  const program = commandGolden()
  t.ok("example-hex emits with fixed samples", program !== "")
  if ((getenv("VECTOR_UPDATE_GOLDEN") ?? "") === "1") {
    t.ok("the golden copy is rewritten", emitWriteFile(GOLDEN, program).isOk())
  }
  t.eqLines("example-hex emits its golden program", splitLines(program), splitLines(readFileSyncOrNull(GOLDEN) ?? ""))

  t.ok("an unreadable contract is a usage error", codeOf(emitContractFile("contracts/none.json", null)) === EXIT_USAGE)
  const bad = `${dir}/bad.json`
  t.ok("a bad contract is written", emitWriteFile(bad, `{"contract": 1}`).isOk())
  t.ok("a contract that does not load is refused", codeOf(emitContractFile(bad, null)) === EXIT_REFUSED)
  t.ok("the worst code wins", emitReportAll([refusal("x", 0, "a"), usageError("b")]) === EXIT_USAGE)
  const none: Diagnostic[] = []
  t.ok("no diagnostics is still a failure", emitReportAll(none) === EXIT_USAGE)
  t.ok("a write into a missing directory fails", emitWriteFile(`${dir}/no/such/x.ts`, "x").isErr())

  t.ok("emit without -o is a usage error", emitCommand("contracts/example-hex.json", null) === EXIT_USAGE)
  t.ok("emit of a missing contract exits 2", emitCommand("contracts/none.json", `${dir}/x.ts`) === EXIT_USAGE)
  t.ok("emit of a bad contract exits 1", emitCommand(bad, `${dir}/x.ts`) === EXIT_REFUSED)
  const out = `${dir}/main.ts`
  t.ok("emit writes the test and exits 0", emitCommand("contracts/example-hex.json", out) === 0)
  const sha = sha256Hex(readFileSyncOrNull("contracts/example-hex.json") ?? "")
  t.contains(
    "the written test is the contract's",
    readFileSyncOrNull(out) ?? "",
    `\n// vector-contract-sha256: ${sha}\n`,
  )
  t.contains(
    "and says how it was made",
    readFileSyncOrNull(out) ?? "",
    `//   vector spec emit contracts/example-hex.json -o ${out}.\n`,
  )

  t.ok("a missing nish root is an error", runFindRoot("tests/no-such-dir").isErr())
  t.ok("a given nish root is used", runFindRoot("tests").isOk())
  const badFormat = new RunRequest("contracts/example-hex.json")
  badFormat.format = "yaml"
  t.ok("an unknown format exits 2", runCommand(badFormat) === EXIT_USAGE)
  const noRoot = new RunRequest("contracts/example-hex.json")
  noRoot.nishRoot = "tests/no-such-dir"
  t.ok("no nish root exits 2", runCommand(noRoot) === EXIT_USAGE)
  const refused = new RunRequest(bad)
  t.ok("a refused contract exits 1 before anything runs", runCommand(refused) === EXIT_REFUSED)
  const empty = new RunResult("example-hex", 1, "", "")
  t.contains("json format", runFormat(empty, "json"), `"status": "ERROR"`)
  t.contains("markdown format", runFormat(empty, "markdown"), "### `example-hex`: ERROR")
  t.contains("text format", runFormat(empty, "text"), "ERROR: example-hex (exit 1)")

  if (!isExecutableSync(".nish/libexec/nish")) {
    t.skip("a run against the pinned nish", "no .nish/ install: run bash scripts/fetch-nish.sh")
    return finish(t, dir)
  }
  // The pinned nish has no nish/hex, so the test cannot compile: an ERROR,
  // which exits 1, with the emitted test kept where -o says.
  const live = new RunRequest("contracts/example-hex.json")
  live.nishRoot = ".nish"
  live.out = `${dir}/kept.ts`
  live.format = "json"
  t.ok("a test that does not compile exits 1", runCommand(live) === EXIT_REFUSED)
  t.ok("-o keeps the test", readFileSyncOrNull(`${dir}/kept.ts`) !== null)
  const report = commandLiveReport()
  t.contains("the report says ERROR", report, "ERROR: example-hex (exit 1)")
  t.contains("and why: the pinned nish has no nish/hex", report, "'nish/hex' is not part of the standard library")
  return finish(t, dir)
}

/** Removes the scratch directory, then ends the suite. */
const finish = (t: Suite, dir: string): i32 => {
  t.ok("the scratch directory is removed", runProcess(["rm", "-rf", dir], "", 10000).isOk())
  return t.done()
}

/** The text report of example-hex run in a scratch copy of the pinned nish, as `vector spec run` makes it. */
const commandLiveReport = (): string => {
  const program = commandGolden()
  const made = runMakeScratch(".nish", [], [])
  if (!made.isOk()) {
    return made.error
  }
  const c = contractLoadFile("contracts/example-hex.json").expect("load example-hex")
  const ran = runTest(c, program, made.value.nish, 110000)
  runDisposeScratch(made.value).expect("the scratch install is removed")
  return ran.isOk() ? runFormat(ran.value, "text") : ran.error
}

/** The exit code of an emit failure, or 0 when it succeeded. */
const codeOf = (r: Result<EmitFile, Diagnostic[]>): i32 => (r.isErr() ? emitReportAll(r.error) : 0)
