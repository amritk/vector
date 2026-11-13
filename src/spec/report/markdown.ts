/**
 * `spec/report/markdown` — the check's report as GitHub markdown, for a PR
 * comment: each requirement's quote, then the clauses that cover it; then
 * the source commands, the exclusions and the warnings. Every text from the
 * contract goes into a table cell or inline code escaped, so no quote can
 * break the table it sits in.
 */

import { splitLines, trim } from "nish/text"
import { CheckContext, CheckReport } from "../check"
import {
  reportCite,
  reportCovered,
  reportCovering,
  reportEvidence,
  reportIssues,
  reportOneLine,
  reportShapeOk,
  reportSourceRuns,
  reportSourceTitle,
  reportStatus,
  reportWarnings,
} from "./common"

/** Appends each line to the report. */
const reportMdAdd = (out: string[], lines: string[]): void => {
  for (const l of lines) {
    out.push(l)
  }
}
/**
 * A table cell: one line, with `\` and `|` escaped so neither ends the cell.
 *
 * @param s the text
 * @returns the cell's text; a space when empty
 */
export const reportCell = (s: string): string => {
  const t = reportOneLine(s)
  let out = ""
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i)
    // 92 is `\`, 124 is `|`.
    out = out + (c === 92 || c === 124 ? "\\" : "") + t.substring(i, i + 1)
  }
  return out === "" ? " " : out
}

/**
 * Inline code that survives any backticks in the text: the fence is one
 * longer than its longest backtick run.
 *
 * @param s the text
 * @returns the code span
 */
export const reportCode = (s: string): string => {
  const t = reportOneLine(s)
  let longest = 0
  let run = 0
  for (let i = 0; i < t.length; i++) {
    run = t.charCodeAt(i) === 96 ? run + 1 : 0
    longest = run > longest ? run : longest
  }
  let fence = "`"
  for (let i = 0; i < longest; i++) {
    fence = `${fence}\``
  }
  const pad = longest > 0 ? " " : ""
  return `${fence}${pad}${t}${pad}${fence}`
}

/**
 * Inline code in a table cell. GFM splits a row at `|` even inside code, and
 * reads `\\` as an escaped pair first, so the backslashes before a pipe are
 * doubled and the pipe escaped: `a\|b` becomes `a\\\|b`.
 *
 * @param s the text
 * @returns the cell's code span
 */
export const reportCodeCell = (s: string): string => {
  const t = reportCode(s)
  let out = ""
  let slashes = ""
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i)
    if (c === 92) {
      slashes = `${slashes}\\`
    } else if (c === 124) {
      out = `${out}${slashes}${slashes}\\|`
      slashes = ""
    } else {
      out = out + slashes + t.substring(i, i + 1)
      slashes = ""
    }
  }
  return out + slashes
}

/**
 * The report as markdown, ending without a newline.
 *
 * @param ctx the check's context, after the gates ran
 * @param report what the gates found
 * @returns the report
 */
export const reportMarkdown = (ctx: CheckContext, report: CheckReport): string => {
  const c = ctx.contract
  const status = reportStatus(report)
  const out: string[] = [`## ${status === "CONTRACT_VALID" ? "✅" : "❌"} ${c.contract}: ${status}`, ""]
  reportMdAdd(out, [`${reportCell(reportSourceTitle(c))} · target ${reportCode(c.target.module)}`, ""])
  const issues = reportIssues(ctx, report)
  if (issues.length > 0) {
    reportMdAdd(out, ["### Gate failures", "", "| Where | Problem |", "| --- | --- |"])
    for (const i of issues) {
      out.push(`| ${reportCell(`${i.gate} ${i.at}`)} | ${reportCell(i.message)} |`)
    }
    out.push("")
  }
  if (reportShapeOk(report)) {
    reportMdAdd(out, ["### Requirements", ""])
    for (const req of c.requirements) {
      const mark = reportCovered(ctx, req.id) ? "⭕ checked, not run" : "❌ uncovered"
      reportMdAdd(out, [`#### ${req.id} · ${reportCite(c, req.source, req.section)} ${req.level} · ${mark}`, ""])
      for (const l of splitLines(trim(req.quote))) {
        out.push(`> ${trim(l)}`)
      }
      out.push("")
      const rows: string[] = []
      for (const k of reportCovering(c, req.id)) {
        rows.push(
          `| ${reportCodeCell(k.id)} | ${reportCell(k.title)} | ⭕ not run | ${reportCell(reportEvidence(ctx, k))} |   |`,
        )
      }
      if (rows.length > 0) {
        reportMdAdd(out, ["| Clause | Title | Outcome | Evidence | Detail |", "| --- | --- | --- | --- | --- |"])
        for (const r of rows) {
          out.push(r)
        }
        out.push("")
      }
    }
    const runs = reportSourceRuns(ctx)
    if (runs.length > 0) {
      reportMdAdd(out, [
        "### Vector sources run",
        "",
        "| Clause | Command | Outcome | Detail |",
        "| --- | --- | --- | --- |",
      ])
      for (const r of runs) {
        out.push(
          `| ${reportCodeCell(r.clause)} | ${reportCodeCell(r.command)} | ${reportMdMark(r.outcome)} | ${reportCell(r.detail)} |`,
        )
      }
      out.push("")
    }
    const ex = c.exclusions
    if (ex !== null && ex.length > 0) {
      reportMdAdd(out, ["### Not tested, by decision", "", "| Where | Quote | Reason |", "| --- | --- | --- |"])
      for (const x of ex) {
        out.push(
          `| ${reportCell(reportCite(c, x.source, x.section))} | ${reportCell(x.quote)} | ${reportCell(x.reason)} |`,
        )
      }
      out.push("")
    }
  }
  const warnings = reportWarnings(ctx)
  if (warnings.length > 0) {
    reportMdAdd(out, ["### Warnings", ""])
    for (const w of warnings) {
      out.push(`- ${reportCell(`${w.at}: ${w.message}`)}`)
    }
    out.push("")
  }
  while (out.length > 0 && out[out.length - 1] === "") {
    out.pop()
  }
  return out.join("\n")
}

/**
 * The markdown mark of a source command's outcome.
 *
 * @param outcome "pass", "fail" or "not run"
 * @returns the mark with its word
 */
export const reportMdMark = (outcome: string): string => {
  if (outcome === "pass") {
    return "✅ pass"
  }
  return outcome === "fail" ? "❌ fail" : "⚪ not run"
}
