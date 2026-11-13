import { Suite } from "nish/testing"
import {
  EXIT_PASS,
  EXIT_REFUSED,
  EXIT_USAGE,
  diagPlace,
  formatDiagnostic,
  refusal,
  refusalAt,
  report,
  usageError,
} from "../../src/core/diag"

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
  t.eqStr("refusalAt with a column", formatDiagnostic(refusalAt("a.xml", 3, 7, "", 0, "bad")), "vector: a.xml:3:7: bad")
  t.eqStr("refusalAt with no column", formatDiagnostic(refusalAt("a.xml", 3, 0, "", 0, "bad")), "vector: a.xml:3: bad")
  t.eqStr(
    "refusalAt near a markdown line, the column with the XML line",
    formatDiagnostic(refusalAt("a.md", 21, 7, "a.xml", 49, "bad")),
    "vector: a.md:21 (a.xml:49:7): bad",
  )
  t.eqStr(
    "refusalAt near a markdown line, no column",
    formatDiagnostic(refusalAt("a.md", 21, 0, "a.xml", 49, "bad")),
    "vector: a.md:21 (a.xml:49): bad",
  )
  t.eqStr(
    "refusalAt with no line drops the column",
    formatDiagnostic(refusalAt("a.json", 0, 7, "", 0, "bad")),
    "vector: a.json: bad",
  )
  t.eqI32("refusalAt code", refusalAt("a", 1, 1, "", 0, "no").code, 1)
  t.eqStr("diagPlace with no file", diagPlace("", 3, 7, "", 0), "")
  t.eqStr("diagPlace with a file only", diagPlace("a.ts", 0, 0, "", 0), "a.ts")
  t.eqStr("diagPlace at a line", diagPlace("a.ts", 3, 0, "", 0), "a.ts:3")
  t.eqI32("report returns the code", report(refusal("t.ts", 1, "test diagnostic on stderr")), 1)
  return t.done()
}
