/**
 * `spec/report/text` — the check's report for a terminal: the status, every
 * finding, each requirement with the clauses that cover it, the source
 * commands, the exclusions and the warnings.
 */

import { CheckContext, CheckReport } from "../check"
import {
  reportCite,
  reportCovered,
  reportCovering,
  reportIssues,
  reportSampleCount,
  reportShapeOk,
  reportShort,
  reportSourceRuns,
  reportSourceTitle,
  reportStat,
  reportStatus,
  reportWarnings,
} from "./common"

/** The rule under the report's title. */
const REPORT_RULE: string = "── VECTOR RFC CONTRACT ─────────────────────────────────────────"

/** Appends each line to the report. */
const reportTextAdd = (out: string[], lines: string[]): void => {
  for (const l of lines) {
    out.push(l)
  }
}
/**
 * The mark of a source command's outcome.
 *
 * @param outcome "pass", "fail" or "not run"
 * @returns ✓, ✘ or ·
 */
export const reportMark = (outcome: string): string => {
  if (outcome === "pass") {
    return "✓"
  }
  return outcome === "fail" ? "✘" : "·"
}

/**
 * The report as text, one line per element, ending without a newline.
 *
 * @param ctx the check's context, after the gates ran
 * @param report what the gates found
 * @returns the report
 */
export const reportText = (ctx: CheckContext, report: CheckReport): string => {
  const c = ctx.contract
  const out: string[] = [REPORT_RULE]
  out.push(` ${c.contract} · ${reportSourceTitle(c)} · ${c.target.module}`)
  out.push(` Status: ${reportStatus(report)}`)
  const issues = reportIssues(ctx, report)
  if (issues.length > 0) {
    reportTextAdd(out, ["", " Gate failures"])
    for (const i of issues) {
      out.push(i.at === "" ? `  ✘ ${i.gate}: ${i.message}` : `  ✘ ${i.gate} ${i.at}: ${i.message}`)
    }
  }
  if (reportShapeOk(report)) {
    reportTextAdd(out, ["", " Requirements"])
    for (const req of c.requirements) {
      const mark = reportCovered(ctx, req.id) ? "○" : "✘"
      const cite = reportCite(c, req.source, req.section)
      out.push(`  ${mark} ${req.id}  ${cite} ${req.level}  "${reportShort(req.quote, 64)}"`)
      const ev: string[] = []
      for (const k of reportCovering(c, req.id)) {
        const stat = reportStat(ctx, k.id)
        ev.push(
          stat === null
            ? `○ ${k.id}`
            : `○ ${k.id} (${reportSampleCount(ctx, k.id)} samples: ${stat.boundary} boundary)`,
        )
      }
      if (ev.length > 0) {
        out.push(`      ${ev.join("  ")}`)
      }
    }
    const runs = reportSourceRuns(ctx)
    if (runs.length > 0) {
      reportTextAdd(out, ["", " Vector sources run"])
      for (const r of runs) {
        out.push(`  ${reportMark(r.outcome)} ${r.clause}: $ ${r.command}${r.detail === "" ? "" : ` — ${r.detail}`}`)
      }
    }
    const ex = c.exclusions
    if (ex !== null && ex.length > 0) {
      reportTextAdd(out, ["", " Not tested, by decision"])
      for (const x of ex) {
        out.push(`  ${reportCite(c, x.source, x.section)} "${reportShort(x.quote, 56)}" — ${x.reason}`)
      }
    }
  }
  const warnings = reportWarnings(ctx)
  if (warnings.length > 0) {
    reportTextAdd(out, ["", " Warnings"])
    for (const w of warnings) {
      out.push(`  ! ${w.at}: ${w.message}`)
    }
  }
  reportTextAdd(out, ["", " ○ = checked by the contract, not yet run · ✓ pass · ✘ fail · · not run"])
  return out.join("\n")
}
