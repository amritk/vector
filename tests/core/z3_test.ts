import { Suite } from "nish/testing"
import { ProcessResult } from "../../src/core/process"
import { resolveZ3, runZ3, z3Timeout, z3Verdicts } from "../../src/core/z3"

export const main = (): i32 => {
  const t = new Suite("core/z3")
  t.eqI32("z3Timeout none", z3Timeout(0), 60000)
  t.eqI32("z3Timeout some", z3Timeout(10), 90000)
  t.eqI32("z3Timeout capped", z3Timeout(1000000), 300000)
  t.eqI32("z3Timeout at the cap", z3Timeout(80), 300000)
  t.ok("resolveZ3", resolveZ3().isOk())

  const script =
    '(declare-const x Real)\n(push 1)\n(assert (> x 2.5))\n(echo "@@Q0")\n(check-sat)\n(get-value (x))\n(pop 1)\n(push 1)\n(assert (and (> x 1) (< x 0)))\n(echo "@@Q1")\n(check-sat)\n(get-value (x))\n(pop 1)\n'
  const run = runZ3(script, 2)
  if (run.isErr()) {
    t.fail("runZ3", run.error)
    return t.done()
  }
  t.eqStr("q0 sat", run.value.answers[0].result, "sat")
  t.ok("q0 has x", run.value.answers[0].value("x") !== null)
  t.eqStr("q1 unsat", run.value.answers[1].result, "unsat")
  t.ok("millis", run.value.millis >= 0)
  const silent = runZ3("(check-sat)\n", 1)
  t.ok("no markers is an error", silent.isErr())

  // A run the time limit cut short after answering some queries is an error,
  // not those answers plus `unknown` for the rest.
  const cut = new ProcessResult(-1, "@@Q0\nsat\n((x 3.0))\n@@Q1\n", "", true)
  const killed = z3Verdicts(cut, "z3", 3, 60000)
  t.ok("a timed-out run is an error", killed.isErr())
  if (killed.isErr()) {
    t.eqStr("timed-out message", killed.error, "z3 (z3) did not finish 3 queries within 60000 ms")
  }
  const done = z3Verdicts(new ProcessResult(0, "@@Q0\nunsat\n", "", false), "z3", 1, 60000)
  t.ok("a finished run is read", done.isOk() && done.value[0].result === "unsat")
  const none = z3Verdicts(new ProcessResult(0, "", "boom\n", false), "z3", 1, 60000)
  t.ok("no markers names stderr", none.isErr() && none.error.indexOf("boom") >= 0)
  return t.done()
}
