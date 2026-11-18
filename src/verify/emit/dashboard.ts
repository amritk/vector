/**
 * `verify/emit/dashboard` — the proof report as a 70-column box: each
 * function's Hoare triple, one mark per postcondition, the counterexamples
 * and hazards the solver found, the float64 gate's findings, and a verdict.
 * Widths count code points, so the box lines up in a terminal.
 */

import { codePointLength, split } from "nish/text"
import { REPLAY_MISMATCH } from "../solve/replay"
import { ClauseVerdict, Counterexample, FnReport, VerifyReport } from "../solve/report"

/** Every postcondition is proven, meaningfully, with no hazard. */
export const STATUS_PROVEN: string = "PROVEN"
/** The solver or the float64 gate found a defect. */
export const STATUS_REFUTED: string = "REFUTED"
/** Some clause is undecided and nothing is refuted. */
export const STATUS_UNKNOWN: string = "UNKNOWN"
/** A counterexample z3 gave did not replay: a bug in vector. */
export const STATUS_MISMATCH: string = "MISMATCH"

const DASH_WIDTH: i32 = 68

/**
 * The report's verdict. A counterexample that did not replay comes first:
 * then the fault is vector's, not the program's. Every other failure except
 * a bare solver `unknown` is a concrete defect, so it refutes.
 *
 * @param report the report, after the replay filled in its `mismatchCount`
 * @returns `STATUS_MISMATCH`, `STATUS_PROVEN`, `STATUS_REFUTED` or `STATUS_UNKNOWN`
 */
export const verdictStatus = (report: VerifyReport): string => {
  if (report.mismatchCount > 0) {
    return STATUS_MISMATCH
  }
  if (report.ok()) {
    return STATUS_PROVEN
  }
  if (dashViolations(report) > 0) {
    return STATUS_REFUTED
  }
  return STATUS_UNKNOWN
}

const dashViolations = (report: VerifyReport): i32 =>
  report.satCount +
  report.divCount +
  report.preCount +
  report.rangeCount +
  report.trivialCount +
  report.vacuousCount +
  toI32(report.conformance.length)

const dashRepeat = (s: string, n: i32): string => {
  let out = ""
  for (let i = 0; i < n; i++) {
    out = out + s
  }
  return out
}

// The first `n` code points of `s`.
const dashTake = (s: string, n: i32): string => {
  let count = 0
  for (let i = 0; i < toI32(s.length); i++) {
    if ((s.charCodeAt(i) & 0xc0) !== 0x80) {
      if (count === n) {
        return s.slice(0, i)
      }
      count = count + 1
    }
  }
  return s
}

const dashRow = (text: string): string => {
  const clipped = codePointLength(text) > DASH_WIDTH - 1 ? `${dashTake(text, DASH_WIDTH - 2)}…` : text
  return `║ ${clipped}${dashRepeat(" ", DASH_WIDTH - 1 - codePointLength(clipped))}║`
}

const dashCenter = (text: string): string => {
  const pad = Math.max(0, (DASH_WIDTH - codePointLength(text)) >> 1)
  return dashRow(dashRepeat(" ", pad) + text)
}

const dashFrame = (left: string, fill: string, right: string): string =>
  `${left}${dashRepeat(fill, DASH_WIDTH)}${right}`

/**
 * Wraps text at spaces into lines of at most `width` code points; a word
 * longer than `width` gets a line of its own.
 *
 * @param text the text
 * @param width the widest line
 * @returns the lines
 */
export const dashWrap = (text: string, width: i32): string[] => {
  const lines: string[] = []
  let current = ""
  for (const word of split(text, " ")) {
    if (current.length > 0 && codePointLength(current) + codePointLength(word) + 1 > width) {
      lines.push(current)
      current = word
    } else if (current.length > 0) {
      current = `${current} ${word}`
    } else {
      current = word
    }
  }
  if (current.length > 0) {
    lines.push(current)
  }
  return lines
}

const dashPush = (lines: string[], text: string, indent: string): void => {
  for (const line of dashWrap(text, DASH_WIDTH - 2 - codePointLength(indent))) {
    lines.push(dashRow(indent + line))
  }
}

/**
 * A counterexample's inputs, as the dashboard and the feedback show them.
 *
 * @param cex the counterexample
 * @returns `k = v, ...`
 */
export const dashInputs = (cex: Counterexample): string => {
  const parts: string[] = []
  for (let i = 0; i < toI32(cex.names.length); i++) {
    parts.push(`${cex.names[i]} = ${cex.values[i]}`)
  }
  return parts.join(", ")
}

const dashClause = (v: ClauseVerdict): string => {
  if (v.trivial) {
    return `✘ ensures ${v.axiomId}  TRIVIAL (holds independent of the body)`
  }
  if (v.status === "proven") {
    return `✔ ensures ${v.axiomId}  proven (unsat, ∀ inputs)`
  }
  if (v.status === "counterexample") {
    return `✘ ensures ${v.axiomId}  REFUTED (sat)`
  }
  return `? ensures ${v.axiomId}  undecided (unknown)`
}

// Under a counterexample that did not replay, what differed.
const dashReplay = (lines: string[], replay: string, detail: string): void => {
  if (replay === REPLAY_MISMATCH) {
    dashPush(lines, `✘ DOES NOT REPLAY (a bug in vector): ${detail}`, "      ")
  }
}

const dashFunction = (lines: string[], fn: FnReport, report: VerifyReport): void => {
  lines.push(dashRow(`LAYER ${fn.layer} · ${fn.signature}`))
  const pre = fn.requiresPretty.length > 0 ? fn.requiresPretty.join("  ∧  ") : "true"
  dashPush(lines, `{ ${pre} }  ${fn.bodyPretty}`, "  ")
  const posts: string[] = []
  for (const v of fn.ensures) {
    posts.push(v.pretty)
  }
  dashPush(lines, `{ ${posts.join("  ∧  ")} }`, "  ")
  if (fn.vacuous) {
    dashPush(lines, "✘ VACUOUS: no input provably satisfies the requires — postconditions hold only vacuously", "  ")
  }
  for (const v of fn.ensures) {
    lines.push(dashRow(`  ${dashClause(v)}`))
    if (v.hasCex) {
      dashPush(lines, `counterexample: ${dashInputs(v.cex)} → result = ${v.cex.result}`, "      ")
      dashReplay(lines, v.replay, v.replayDetail)
    }
  }
  for (const h of fn.divs) {
    const eg = h.hasCex && h.cex.names.length > 0 ? ` (e.g. ${dashInputs(h.cex)})` : ""
    dashPush(lines, `✘ division hazard in ${h.pretty}${eg}`, "  ")
    dashReplay(lines, h.replay, h.replayDetail)
  }
  for (const h of fn.pres) {
    const eg = h.hasCex && h.cex.names.length > 0 ? ` (e.g. ${dashInputs(h.cex)})` : ""
    dashPush(lines, `✘ call to ${h.callee} may violate its precondition ${h.pretty}${eg}`, "  ")
    dashReplay(lines, h.replay, h.replayDetail)
  }
  for (const h of fn.ranges) {
    const eg = h.hasCex && h.cex.names.length > 0 ? ` (e.g. ${dashInputs(h.cex)})` : ""
    dashPush(lines, `✘ Int overflow: ${h.pretty} may leave ±(2^53−1), where float64 rounds${eg}`, "  ")
    dashReplay(lines, h.replay, h.replayDetail)
  }
  if (fn.requiresPretty.length > 0) {
    dashPush(lines, `⚠ guard ${fn.requiresPretty.join(" ∧ ")} enforced at runtime; ${dashGuardSites(fn, report)}`, "  ")
  }
}

// What the dashboard may say of a function's guard at its internal call
// sites. Every caller's call is a precondition query; one that was not shown
// unsat stands as a hazard in that caller's `pres`, refuted or undecided. The
// guard is proven at every call site only when no caller holds one.
const dashGuardSites = (fn: FnReport, report: VerifyReport): string => {
  const callers: string[] = []
  for (const other of report.functions) {
    for (const h of other.pres) {
      if (h.callee === fn.name && callers.indexOf(other.name) < 0) {
        callers.push(other.name)
      }
    }
  }
  if (callers.length === 0) {
    return "proven to hold at every internal call site"
  }
  const calls = callers.length === 1 ? "the call" : "the calls"
  return `not proven at ${calls} from ${callers.join(", ")}`
}

const dashVerdictLine = (status: string, report: VerifyReport): string => {
  if (status === STATUS_PROVEN) {
    return "ALL POSTCONDITIONS PROVEN FOR ALL INPUTS"
  }
  if (status === STATUS_MISMATCH) {
    return `${report.mismatchCount} COUNTEREXAMPLE(S) DID NOT REPLAY — A BUG IN VECTOR`
  }
  if (status === STATUS_REFUTED) {
    return `${dashViolations(report)} CONTRACT VIOLATION(S) FOUND — SEE ABOVE`
  }
  return `${report.unknownCount} CLAUSE(S) UNDECIDED BY THE SOLVER`
}

/**
 * Renders the proof report.
 *
 * @param label what was verified, shown on the prompt line
 * @param report the report
 * @returns the box, without a final newline
 */
export const renderDashboard = (label: string, report: VerifyReport): string => {
  const status = verdictStatus(report)
  const lines: string[] = []
  lines.push(dashFrame("╔", "═", "╗"))
  lines.push(dashCenter("VECTOR — PROOF REPORT"))
  lines.push(dashFrame("╠", "═", "╣"))
  dashPush(lines, `Prompt:  "${label}"`, "")
  lines.push(dashRow(`Attempt: 1/1      Solver: ${report.solver}      Status: ${status}`))
  lines.push(dashFrame("╠", "═", "╣"))
  for (let i = 0; i < toI32(report.functions.length); i++) {
    if (i > 0) {
      lines.push(dashFrame("╟", "─", "╢"))
    }
    dashFunction(lines, report.functions[i], report)
  }
  if (report.conformance.length > 0) {
    lines.push(dashFrame("╟", "─", "╢"))
    lines.push(dashRow("FLOAT64 CONFORMANCE"))
    for (const c of report.conformance) {
      const at = dashInputs(c.input)
      let text = ""
      if (c.kind === "unsampled") {
        text = `✘ ${c.fn} no float64 input satisfies requires (${c.pretty}) — emitted code unchecked`
      } else if (c.kind === "callee-guard") {
        text = `✘ ${c.fn} ${c.axiomId} throws in float64 at ${at}: guard ${c.pretty}`
      } else {
        text = `✘ ${c.fn} ${c.axiomId} (${c.pretty}) proven over reals but FALSE at ${at} → result = ${c.input.result}`
      }
      dashPush(lines, text, "  ")
    }
  }
  lines.push(dashFrame("╠", "═", "╣"))
  lines.push(dashRow(`VERDICT: ${dashVerdictLine(status, report)}`))
  lines.push(dashRow('"Testing shows the presence of bugs, never their absence."'))
  // Only a proof has been checked against float64; a refuted or unknown
  // verdict must not claim it.
  if (status === STATUS_PROVEN) {
    lines.push(dashRow(" — proven over exact reals; float64 conformance-checked."))
  }
  lines.push(dashFrame("╚", "═", "╝"))
  return lines.join("\n")
}
