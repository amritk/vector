import { Suite } from "nish/testing"
import { joinPath, makeTempDir } from "../../../src/core/fs"
import { CheckContext, CheckSourceRun } from "../../../src/spec/check"
import { contractParse } from "../../../src/spec/contract/read"
import { gateRunJudge, gateRunSources } from "../../../src/spec/gates/run"

/** A contract with one vector whose expected value comes from a command. */
const RUN_BOUNDS_C: string = `{
  "contract": "c1",
  "source": {"title": "T", "rfc": 9999},
  "target": {"module": "nish/x"},
  "requirements": [{"id": "R1", "section": "2", "level": "MUST", "quote": "Q"}],
  "functions": [{"name": "f", "params": [{"name": "a", "type": "string"}], "returns": "bytes"}],
  "clauses": [
    {"kind": "vector", "id": "V-HEX", "title": "t", "covers": ["R1"], "section": "2",
     "source": {"command": "printf 'AB\\\\n'"}, "call": "f", "args": [{"str": "a"}], "expect": {"hex": "ab"}}
  ]
}`

/** The runs of the bounds contract with command limit `ms`, as `id outcome: detail`, then the tool failure. */
const runBoundsWith = (dir: string, ms: i32): string[] => {
  const ctx = new CheckContext(joinPath(dir, "c1.json"), dir)
  ctx.contract = contractParse(RUN_BOUNDS_C, "c1").expect("parse")
  ctx.runSources = true
  ctx.runTimeoutMs = ms
  gateRunSources(ctx)
  const out = ctx.sourceRuns.map((r: CheckSourceRun): string => `${r.clause} ${r.outcome}: ${r.detail}`)
  const f = ctx.toolFailure
  out.push(f === null ? "no tool failure" : f)
  return out
}

/** How the gate judges a command that exited 3 after writing `stderr`. */
const runBoundsExit = (stderr: string): string => {
  const c = contractParse(RUN_BOUNDS_C, "c1").expect("parse")
  return gateRunJudge(c.clauses[0], 3, "", stderr, false, 5).detail
}

/** The run-sources gate at the edge of its limit, and the last line of what a failed command wrote. */
export const main = (): i32 => {
  const t = new Suite("spec/gates/run_bounds")
  const dir = makeTempDir("vector-run-bounds-test-").expect("tmp")
  t.eqLines("the largest limit whose outer limit fits an i32 runs", runBoundsWith(dir, 2147478647), [
    "V-HEX pass: ",
    "no tool failure",
  ])
  t.eqLines("one more is a tool failure, and nothing runs", runBoundsWith(dir, 2147478648), [
    "V-HEX not run: a limit of 2147478648 ms is over 2147478647 ms",
    "V-HEX: source command: a limit of 2147478648 ms is over 2147478647 ms",
  ])
  t.eqStr("no standard error names no reason", runBoundsExit(""), "exited 3")
  t.eqStr("blank standard error names no reason", runBoundsExit(" \n\n"), "exited 3")
  t.eqStr("one line is the reason", runBoundsExit("boom"), "exited 3 (boom)")
  t.eqStr("the last non-empty line is the reason", runBoundsExit("one\n  two  \n\n"), "exited 3 (two)")
  return t.done()
}
