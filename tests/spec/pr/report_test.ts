import { Suite } from "nish/testing"
import { sha256Hex } from "../../../src/core/hex"
import { PrReport, prFormatProblem, prRender } from "../../../src/spec/pr/report"
import { STALE_PREFIX, staleReason, staleShaLines } from "../../../src/spec/pr/stale"

/** A report with one of each kind of line. */
const reportTestFull = (): PrReport => {
  const r = new PrReport("frozen", "spec frozen against main")
  r.items.push("spec contracts/x.json")
  r.notes.push("a note")
  r.problems.push("a problem")
  return r
}

/** How a gate's report prints, and when a generated test is stale. */
export const main = (): i32 => {
  const t = new Suite("spec/pr report")
  t.ok(
    "formats",
    prFormatProblem("text") === null && prFormatProblem("markdown") === null && prFormatProblem("json") === null,
  )
  t.eqStr("a bad format", prFormatProblem("html") ?? "", "--format html: give text, markdown or json")

  const empty = new PrReport("stale", "t")
  t.eqStr("an empty text report", prRender(empty, "text"), "t: OK")
  t.eqStr(
    "a full text report",
    prRender(reportTestFull(), "text"),
    "spec frozen against main: FAILED\n\n  spec contracts/x.json\n\nnotes:\n  - a note\n\nproblems:\n  ✗ a problem",
  )
  t.eqStr(
    "a full markdown report",
    prRender(reportTestFull(), "markdown"),
    "### ❌ spec frozen against main: FAILED\n\n- spec contracts/x.json\n\n**notes:**\n- a note\n\n**problems:**\n- ❌ a problem",
  )
  t.eqStr("an empty markdown report", prRender(empty, "markdown"), "### ✅ t: OK")
  t.eqStr(
    "a json report",
    prRender(reportTestFull(), "json"),
    `{\n  "gate": "frozen",\n  "title": "spec frozen against main",\n  "ok": false,\n  "items": [\n    "spec contracts/x.json"\n  ],\n  "notes": [\n    "a note"\n  ],\n  "problems": [\n    "a problem"\n  ]\n}`,
  )

  const contract = "{}\n"
  const sha = sha256Hex(contract)
  const fresh = `// header\n${STALE_PREFIX}${sha}\nconst x = 1\n`
  t.eqStr("sha lines", staleShaLines(fresh).join(","), sha)
  t.eqStr(
    "a malformed sha line is not one",
    staleShaLines(`${STALE_PREFIX}${sha.substring(0, 63)}G\n${STALE_PREFIX}abc\n`).join(","),
    "",
  )
  t.ok("a fresh test", staleReason(fresh, contract) === null)
  t.eqStr(
    "no line",
    staleReason("const x = 1\n", contract) ?? "",
    "no `// vector-contract-sha256: <hex>` line: regenerate it with vector spec emit",
  )
  t.eqStr(
    "two lines",
    staleReason(`${fresh}${STALE_PREFIX}${sha}\n`, contract) ?? "",
    "2 vector-contract-sha256 lines: a test names one contract",
  )
  t.eqStr(
    "stale",
    staleReason(fresh, "{ }\n") ?? "",
    `stale: emitted from a contract with sha256 ${sha}, but the contract's is ${sha256Hex("{ }\n")}: regenerate it with vector spec emit`,
  )
  return t.done()
}
