/**
 * `spec/report/common` — what every format of the check's report shares: the
 * status, the findings placed where they are, the warnings shown, and how a
 * citation, a requirement's evidence and a long text are written.
 */

import { splitWhitespace } from "nish/text"
import { CheckContext, CheckNote, CheckReport, CheckSampleStat, CheckSourceRun, checkSamplesOf } from "../check"
import { Clause, ClauseKind, Contract, VectorSourceKind } from "../contract/types"
import { gateRunCommands } from "../gates/run"
import { sourceDecls, sourceMainId } from "../source/load"

/** One finding, placed: the gate, what it is about ("" when unknown), and the message. */
export class ReportIssue {
  gate: string
  at: string
  message: string
  /**
   * Makes an issue.
   *
   * @param gate the gate's name
   * @param at the id or field it is about, or ""
   * @param message what was found
   */
  constructor(gate: string, at: string, message: string) {
    this.gate = gate
    this.at = at
    this.message = message
  }
}

/**
 * The check's status: CONTRACT_VALID when no gate found anything, else
 * INVALID.
 *
 * @param report what the gates found
 * @returns the status
 */
export const reportStatus = (report: CheckReport): string =>
  report.findings.length === 0 ? "CONTRACT_VALID" : "INVALID"

/**
 * Every finding, each placed by the note its gate wrote beside it; a finding
 * with no note (the shape gate's) keeps its whole message.
 *
 * @param ctx the check's context, holding the notes
 * @param report what the gates found
 * @returns one issue per finding, in order
 */
export const reportIssues = (ctx: CheckContext, report: CheckReport): ReportIssue[] => {
  const used: boolean[] = ctx.notes.map((_n: CheckNote): boolean => false)
  const out: ReportIssue[] = []
  for (const f of report.findings) {
    let placed = false
    for (let i = 0; i < ctx.notes.length && !placed; i++) {
      const n = ctx.notes[i]
      if (!used[i] && !n.warning && n.gate === f.gate && `${n.at}: ${n.message}` === f.message) {
        used[i] = true
        placed = true
        out.push(new ReportIssue(f.gate, n.at, n.message))
      }
    }
    if (!placed) {
      out.push(new ReportIssue(f.gate, "", f.message))
    }
  }
  return out
}

/**
 * The warnings the report shows: every one but an exclusion's, which the
 * exclusions list already shows.
 *
 * @param ctx the check's context, holding the notes
 * @returns the warning notes, in order
 */
export const reportWarnings = (ctx: CheckContext): CheckNote[] =>
  ctx.notes.filter((n: CheckNote): boolean => n.warning && !n.message.startsWith("excluded:"))

/**
 * Whether the requirements can be listed: the shape gate found nothing, so
 * the contract's fields can be trusted.
 *
 * @param report what the gates found
 * @returns true when they can
 */
export const reportShapeOk = (report: CheckReport): boolean => report.findings.every((f): boolean => f.gate !== "shape")

/**
 * A text on one line: each whitespace run one space, none at either end.
 *
 * @param s the text
 * @returns the line
 */
export const reportOneLine = (s: string): string => splitWhitespace(s).join(" ")

/**
 * A text safe to print to a terminal: each control character (below 0x20,
 * and 0x7f) written as `\xNN`, so contract text or a command's output can
 * neither move the cursor nor hide what follows; cut to at most `n` bytes
 * with an ellipsis, never inside a UTF-8 sequence.
 *
 * @param s the text
 * @param n the most bytes kept
 * @returns the escaped text, cut when longer
 */
export const reportSafe = (s: string, n: i32): string => {
  const digits = "0123456789abcdef"
  let out = ""
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 32 || c === 127) {
      out = `${out}\\x${digits.substring(c >> 4, (c >> 4) + 1)}${digits.substring(c & 15, (c & 15) + 1)}`
    } else {
      out = out + s.substring(i, i + 1)
    }
  }
  if (out.length <= n) {
    return out
  }
  let cut = n
  while (cut > 0 && (out.charCodeAt(cut) & 0xc0) === 0x80) {
    cut--
  }
  return `${out.substring(0, cut)}…`
}

/**
 * A text on one line, cut to at most `n` characters with an ellipsis, never
 * inside a UTF-8 sequence.
 *
 * @param s the text
 * @param n the most characters
 * @returns the text, cut when longer
 */
export const reportShort = (s: string, n: i32): string => {
  const t = reportOneLine(s)
  // Count characters by their first bytes; cut before the n-th.
  let chars = 0
  for (let i = 0; i < t.length; i++) {
    if ((t.charCodeAt(i) & 0xc0) !== 0x80) {
      chars++
      if (chars === n) {
        let rest = 0
        for (let j = i; j < t.length; j++) {
          if ((t.charCodeAt(j) & 0xc0) !== 0x80) {
            rest++
          }
        }
        return rest > 1 ? `${t.substring(0, i)}…` : t
      }
    }
  }
  return t
}

/**
 * A citation in the report: `§2.2` in the main source, `rfc2104 §2` in
 * another.
 *
 * @param c the contract
 * @param source the source cited; null for the main one
 * @param section the section
 * @returns the label
 */
export const reportCite = (c: Contract, source: string | null, section: string): string => {
  const main = sourceMainId(c)
  const id = source === null ? main : source
  return id === main ? `§${section}` : `${id} §${section}`
}

/**
 * What the contract checks against: `RFC 5869 (HKDF)`, or the main source's
 * id and title for a spec that is not an RFC.
 *
 * @param c the contract
 * @returns the label
 */
export const reportSourceTitle = (c: Contract): string => {
  const main = sourceMainId(c)
  let rfc = -1
  for (const d of sourceDecls(c)) {
    if (d.id === main) {
      rfc = d.rfc
    }
  }
  return `${rfc >= 1 ? `RFC ${rfc}` : main} (${c.source.title})`
}

/**
 * The clauses that cover a requirement, in contract order.
 *
 * @param c the contract
 * @param id the requirement's id
 * @returns those clauses
 */
export const reportCovering = (c: Contract, id: string): Clause[] =>
  c.clauses.filter((k: Clause): boolean => k.covers.indexOf(id) >= 0)

/**
 * Whether the coverage gate found a clause for a requirement.
 *
 * @param ctx the check's context, holding the coverage
 * @param id the requirement's id
 * @returns true when some clause covers it
 */
export const reportCovered = (ctx: CheckContext, id: string): boolean => {
  const by = ctx.coverage.get(id)
  return by !== undefined && by.length > 0
}

/**
 * A property's sampling stats, or null when it was not sampled.
 *
 * @param ctx the check's context
 * @param id the property's id
 * @returns its stats, or null
 */
export const reportStat = (ctx: CheckContext, id: string): CheckSampleStat | null => {
  for (const s of ctx.sampleStats) {
    if (s.clause === id) {
      return s
    }
  }
  return null
}

/**
 * How many samples a property got.
 *
 * @param ctx the check's context, holding the samples
 * @param id the property's id
 * @returns the count
 */
export const reportSampleCount = (ctx: CheckContext, id: string): i32 => toI32(checkSamplesOf(ctx.samples, id).length)

/**
 * Where a clause's evidence comes from: a vector's source, or a property's
 * samples.
 *
 * @param ctx the check's context
 * @param k the clause
 * @returns the evidence, such as `vector, §2.2` or `24 samples (6 boundary)`
 */
export const reportEvidence = (ctx: CheckContext, k: Clause): string => {
  const s = k.source
  if (k.kind === ClauseKind.Vector) {
    if (s === null) {
      return "vector"
    }
    if (s.kind === VectorSourceKind.Command) {
      return `vector, expected from ${s.text}`
    }
    if (s.kind === VectorSourceKind.Spec) {
      return `vector, spec ${s.text}`
    }
    const cite = s.cite
    return cite === null ? "vector" : `vector, ${reportCite(ctx.contract, cite.source, cite.section)}`
  }
  const stat = reportStat(ctx, k.id)
  return stat === null ? "property" : `${reportSampleCount(ctx, k.id)} samples (${stat.boundary} boundary)`
}

/**
 * The vectors whose expected value a command prints, each with its run.
 *
 * @param ctx the check's context
 * @returns one run per command vector, "not run" when it has none
 */
export const reportSourceRuns = (ctx: CheckContext): CheckSourceRun[] => {
  const out: CheckSourceRun[] = []
  for (const k of gateRunCommands(ctx.contract)) {
    const s = k.source
    const command = s === null ? "" : s.text
    let run = new CheckSourceRun(k.id, command, "not run", "")
    for (const r of ctx.sourceRuns) {
      if (r.clause === k.id) {
        run = r
      }
    }
    out.push(run)
  }
  return out
}
