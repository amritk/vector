import { Suite } from "nish/testing"
import { resolveZ3, runZ3, z3Timeout } from "../../src/core/z3"

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
  return t.done()
}
