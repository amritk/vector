import { Suite } from "nish/testing"
import { EXIT_PASS, EXIT_REFUSED, EXIT_USAGE, formatDiagnostic, refusal, report, usageError } from "../../src/core/diag"

export const main = (): i32 => {
  const t = new Suite("core/diag")
  t.eqI32("EXIT_PASS", EXIT_PASS, 0)
  t.eqI32("EXIT_REFUSED", EXIT_REFUSED, 1)
  t.eqI32("EXIT_USAGE", EXIT_USAGE, 2)
  const u = usageError("missing <file>")
  t.eqI32("usageError code", u.code, 2)
  t.eqStr("usageError text", formatDiagnostic(u), "vector: missing <file>")
  t.eqStr("refusal with line", formatDiagnostic(refusal("a.ts", 3, "x < 0")), "vector: a.ts:3: x < 0")
  t.eqStr("refusal without line", formatDiagnostic(refusal("a.ts", 0, "stale")), "vector: a.ts: stale")
  t.eqI32("refusal code", refusal("", 0, "no").code, 1)
  t.eqI32("report returns the code", report(refusal("t.ts", 1, "test diagnostic on stderr")), 1)
  return t.done()
}
