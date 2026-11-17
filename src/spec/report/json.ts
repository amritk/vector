/**
 * `spec/report/json` — the check's report as one JSON object, for tools:
 * `{status, contract, issues, warnings, coverage, samples, sources,
 * truncations}`.
 */

import { jsonStringifyString } from "nish/json"
import { CheckContext, CheckNote, CheckReport, CheckSampleStat } from "../check"
import { reportIssues, reportSampleCount, reportSourceRuns, reportStatus, reportWarnings } from "./common"

/** A JSON string. */
const reportQ = (s: string): string => jsonStringifyString(s)

/** A JSON array of strings. */
const reportStrings = (xs: string[]): string => `[${xs.map(reportQ).join(",")}]`

/**
 * The report as JSON on one line: the status, every finding and warning with
 * its gate and place, which clauses cover each requirement, each property's
 * sampling, each source command's run, and each vector held to its result's
 * first bytes (`{bytes, unit}`, the unit the spec wrote).
 *
 * @param ctx the check's context, after the gates ran
 * @param report what the gates found
 * @returns the JSON text
 */
export const reportJson = (ctx: CheckContext, report: CheckReport): string => {
  const issues = reportIssues(ctx, report).map(
    (i): string => `{"gate":${reportQ(i.gate)},"at":${reportQ(i.at)},"message":${reportQ(i.message)}}`,
  )
  const warnings = reportWarnings(ctx).map(
    (w: CheckNote): string => `{"gate":${reportQ(w.gate)},"at":${reportQ(w.at)},"message":${reportQ(w.message)}}`,
  )
  const coverage: string[] = []
  for (const req of ctx.contract.requirements) {
    const by = ctx.coverage.get(req.id)
    coverage.push(`${reportQ(req.id)}:${reportStrings(by === undefined ? [] : by)}`)
  }
  const samples = ctx.sampleStats.map(
    (s: CheckSampleStat): string =>
      `${reportQ(s.clause)}:{"count":${reportSampleCount(ctx, s.clause)},"boundary":${s.boundary},"random":${s.random},"inhabited":${s.inhabited},"notes":${reportStrings(s.notes)}}`,
  )
  const sources = reportSourceRuns(ctx).map(
    (r): string =>
      `${reportQ(r.clause)}:{"command":${reportQ(r.command)},"outcome":${reportQ(r.outcome)},"detail":${reportQ(r.detail)}}`,
  )
  const truncations: string[] = []
  for (const k of ctx.contract.clauses) {
    const tr = k.truncate
    if (tr !== null) {
      truncations.push(`${reportQ(k.id)}:{"bytes":${tr.bytes},"unit":${reportQ(tr.unit)}}`)
    }
  }
  return `{"status":${reportQ(reportStatus(report))},"contract":${reportQ(ctx.contract.contract)},"issues":[${issues.join(",")}],"warnings":[${warnings.join(",")}],"coverage":{${coverage.join(",")}},"samples":{${samples.join(",")}},"sources":{${sources.join(",")}},"truncations":{${truncations.join(",")}}}`
}
