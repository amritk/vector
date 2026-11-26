import { Suite } from "nish/testing"
import { verifyExitCode } from "../../src/cli/verify"
import { STATUS_MISMATCH, STATUS_PROVEN, STATUS_REFUTED, verdictStatus } from "../../src/verify/emit/dashboard"
import { ConformanceIssue, Counterexample, VerifyReport } from "../../src/verify/solve/report"
import { collectFeedbackItems, formatReportFeedback, verifyMismatchLines } from "../../src/verify/verify"

/** A report whose float64 gate found one issue of `kind`. */
const vectorBugReport = (kind: string, pretty: string): VerifyReport => {
  const report = new VerifyReport("Z3 test")
  const input = new Counterexample(kind === "vector-bug" ? `(a bug in vector: ${pretty})` : "1")
  if (kind !== "vector-bug") {
    input.names.push("x")
    input.values.push("0.5")
  }
  const axiom = kind === "vector-bug" ? "(a bug in vector)" : kind === "unsampled" ? "(requires)" : "A1"
  report.conformance.push(new ConformanceIssue("f", kind, axiom, pretty, input))
  return report
}

/** How many times `part` occurs in `text`. */
const vectorBugCount = (text: string, part: string): i32 => {
  let n = 0
  let at = text.indexOf(part)
  while (at >= 0) {
    n++
    at = text.indexOf(part, at + 1)
  }
  return n
}

/**
 * A float64 check that could not run (a `vector-bug` issue) is reported as
 * vector's fault and exits 2, never as the program's float rounding; the
 * other conformance kinds keep their verdict and text.
 */
export const main = (): i32 => {
  const t = new Suite("verify/vector_bug")

  const bug = vectorBugReport("vector-bug", "x is unbound")
  t.eqStr("a vector bug is a MISMATCH", verdictStatus(bug), STATUS_MISMATCH)
  t.eqI32("a vector bug exits 2", verifyExitCode(verdictStatus(bug)), 2)
  const line =
    "MISMATCH  vector could not run the float64 check of f (x is unbound): this is a bug in vector, not in your program — please report it"
  t.eqStr("its MISMATCH line", verifyMismatchLines(bug).join("|"), line)
  const prose = formatReportFeedback(bug)
  t.eqI32("the prose names it once", vectorBugCount(prose, "this is a bug in vector"), 1)
  t.ok("the prose does not call it float rounding", prose.indexOf("FALSE in float64") < 0)
  const items = collectFeedbackItems(bug)
  t.eqI32("one feedback item", items.length, 1)
  if (items.length === 1) {
    t.eqStr("the item is a conformance issue", items[0].issue, "conformance")
    t.eqStr(
      "the item's hint",
      items[0].hint,
      "vector could not run the float64 check of this function (x is unbound): this is a bug in vector, not in your program — please report it.",
    )
  }

  const post = vectorBugReport("postcondition", "result ≥ 0")
  t.eqStr("a float64 counterexample is REFUTED", verdictStatus(post), STATUS_REFUTED)
  t.eqI32("a float64 counterexample exits 1", verifyExitCode(verdictStatus(post)), 1)
  t.eqI32("it has no MISMATCH line", verifyMismatchLines(post).length, 0)
  t.contains(
    "its prose is the float64 one",
    formatReportFeedback(post),
    "proven over reals but FALSE in float64 at x = 0.5",
  )

  const unsampled = vectorBugReport("unsampled", "x > 0")
  t.eqStr("an unsampled function is REFUTED", verdictStatus(unsampled), STATUS_REFUTED)
  t.eqI32("it has no MISMATCH line", verifyMismatchLines(unsampled).length, 0)
  t.contains("its prose", formatReportFeedback(unsampled), "no float64 input satisfies its requires (x > 0)")

  t.eqStr("no issue is PROVEN", verdictStatus(new VerifyReport("Z3 test")), STATUS_PROVEN)
  return t.done()
}
