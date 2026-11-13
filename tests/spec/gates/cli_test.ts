import { Suite } from "nish/testing"
import { specCheckForeignWarning, specCheckRender, specCheckRepoTop, specCheckRoot } from "../../../src/cli/spec-check"
import { joinPath, makeTempDir } from "../../../src/core/fs"
import { runProcess } from "../../../src/core/process"
import { CheckContext, CheckReport, checkContract, checkGates, checkRefused } from "../../../src/spec/check"
import { contractLoadFile } from "../../../src/spec/contract/contract"
import { Contract } from "../../../src/spec/contract/types"
import { gateSources } from "../../../src/spec/gates/cite"

/** A contract with one command source. */
const CLI_TEST_C: string = `{
  "contract": "c1",
  "source": {"title": "T", "rfc": 9999},
  "target": {"module": "nish/x"},
  "requirements": [{"id": "R1", "section": "2", "level": "MUST", "quote": "Q"}],
  "functions": [{"name": "f", "params": [{"name": "a", "type": "string"}], "returns": "string"}],
  "clauses": [
    {"kind": "vector", "id": "V1", "title": "t", "covers": ["R1"], "section": "2",
     "source": {"command": "echo hi"}, "call": "f", "args": [{"str": "a"}], "expect": {"str": "hi"}}
  ]
}`

const CLI_TEST_RFC: string = "contracts/rfc5869-hkdf-sha256.json"

/** The rfc5869 contract. */
const cliTestRfc = (): Contract => contractLoadFile(CLI_TEST_RFC).expect("load")

/** What gateSources says with `--spec` naming `spec`. */
const cliTestSpec = (spec: string): string => {
  const ctx = new CheckContext(CLI_TEST_RFC, ".")
  ctx.contract = cliTestRfc()
  ctx.specPath = spec
  const out: string[] = []
  gateSources(ctx, out, "fidelity")
  return out.join("|")
}

/** `vector spec check`'s helpers, and the `--spec` assertion it passes on. */
export const main = (): i32 => {
  const t = new Suite("spec/gates/cli")

  t.ok("the root holds the binary's directory", specCheckRoot() !== "")
  const top = specCheckRepoTop()
  const here = realpathSync(".") ?? "."
  t.eqStr("inside the repository", top === null ? "" : realpathSync(top) ?? "", here)

  t.ok("no commands, no warning", specCheckForeignWarning(CLI_TEST_RFC, cliTestRfc(), top) === null)
  const dir = makeTempDir("vector-cli-test-").expect("tmp")
  const path = joinPath(dir, "c1.json")
  writeFileSync(path, CLI_TEST_C)
  const c = contractLoadFile(path).expect("load")
  const warning = specCheckForeignWarning(path, c, top)
  t.ok("a foreign contract warns", warning !== null)
  if (warning !== null) {
    t.ok("naming where it is", warning.startsWith(`warning: --run-sources runs 1 shell command(s) from ${path}`))
    t.ok("and each command", warning.endsWith("  [V1] $ echo hi"))
  }
  t.ok("outside a repository it warns too", specCheckForeignWarning(path, c, null) !== null)
  runProcess(["mkdir", joinPath(dir, "contracts")], "", 5000).expect("mkdir")
  const home = joinPath(joinPath(dir, "contracts"), "c1.json")
  writeFileSync(home, CLI_TEST_C)
  t.ok("a contract in the repository's contracts/ does not", specCheckForeignWarning(home, c, dir) === null)
  runProcess(["rm", "-rf", dir], "", 5000).expect("rm")

  t.eqStr("--spec naming the main source", cliTestSpec("rfcs/rfc5869.txt"), "")
  t.ok(
    "--spec naming another file is refused",
    cliTestSpec("rfcs/rfc4648.txt").startsWith("sources: --spec rfcs/rfc4648.txt is not"),
  )
  t.ok(
    "--spec naming nothing is refused",
    cliTestSpec("rfcs/none.txt").startsWith("sources: --spec rfcs/none.txt is not"),
  )

  const ctx = new CheckContext(CLI_TEST_RFC, ".")
  const found: CheckReport = checkContract(ctx, cliTestRfc())
  t.ok("text by default", specCheckRender(ctx, found).startsWith("── VECTOR RFC CONTRACT"))
  ctx.format = "markdown"
  t.ok("markdown", specCheckRender(ctx, found).startsWith("## ✅ rfc5869-hkdf-sha256: CONTRACT_VALID"))
  ctx.format = "json"
  t.ok("json", specCheckRender(ctx, found).startsWith('{"status":"CONTRACT_VALID"'))
  // A contract the schema refuses is reported, not a usage error: its errors
  // are the shape gate's, every later gate skipped, in every format.
  const refusedCtx = new CheckContext("bad.json", ".")
  const refused = checkRefused(refusedCtx, "shape", ['contract: unknown field "x"'], checkGates())
  t.eqStr("refused: ran", refused.ran.join(","), "shape")
  t.eqI32("refused: skipped every later gate", toI32(refused.skipped.length), toI32(checkGates().length) - 1)
  t.eqStr("refused: the finding", refused.findings[0].message, 'contract: unknown field "x"')
  for (const f of ["text", "markdown", "json"]) {
    refusedCtx.format = f
    t.ok(`refused renders as ${f}`, specCheckRender(refusedCtx, refused).indexOf("unknown field") >= 0)
  }
  return t.done()
}
