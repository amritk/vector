/**
 * `verify/verify` — the whole deterministic gate over a spec plan and a
 * program: shape, types, the plan's decomposition, axiom traceability, z3,
 * then the float64 gate. vector never calls a model: Claude Code (the vector
 * skill) or a person writes the two JSON files, and the structured feedback
 * this returns is what their repair loop reads.
 */

import { JsonDocument, JsonValue } from "nish/json-value"
import { STATUS_PROVEN, dashInputs, renderDashboard, verdictStatus } from "./emit/dashboard"
import { checkConformance } from "./emit/float64"
import { OutJson, outJsonArray, outJsonObject, outJsonString, outJsonStrings } from "./emit/outjson"
import { emitTypeScript } from "./emit/typescript"
import { checkAxiomTraceability, checkSpecProgramConsistency, typecheckProgram } from "./lang/check"
import { readProgram, readSpecPlan } from "./lang/read"
import { StyleWarning, collectStyleWarnings } from "./lang/style"
import { CLAUSE_PROVEN, CLAUSE_REFUTED, Counterexample, VerifyReport, solveProgram } from "./solve/report"

/** Every proven clause holds, over the reals and in float64. */
export const OUTCOME_PROVEN: string = "PROVEN"
/** The solver or the float64 gate found a defect. */
export const OUTCOME_REFUTED: string = "REFUTED"
/** Some clause is undecided and nothing is refuted. */
export const OUTCOME_UNKNOWN: string = "UNKNOWN"
/** The input failed a shape, type or traceability check. */
export const OUTCOME_INVALID: string = "INVALID"
/** z3 could not run, or rejected the script. */
export const OUTCOME_ERROR: string = "ERROR"

/** One machine-readable repair instruction: a single clause or hazard to fix. */
export class FeedbackItem {
  /** The function it concerns. */
  fn: string
  /** The axiom, or `(reachable)`, `(division)`, `(calls f)`, `(range)` or `(requires)`. */
  axiomId: string
  /** The property, in math style. */
  property: string
  /** `counterexample`, `unknown`, `division-hazard`, `precondition-hazard`, `range-hazard`, `vacuous`, `trivial` or `conformance`. */
  issue: string
  /** Whether `cex` is meaningful. */
  hasCex: boolean
  /** The input that shows the problem, when there is one. */
  cex: Counterexample
  /** What to do about it. */
  hint: string

  /**
   * Makes an item with no counterexample.
   *
   * @param fn the function
   * @param axiomId the axiom or pseudo-axiom
   * @param property the property in math style
   * @param issue the kind of issue
   * @param hint what to do about it
   */
  constructor(fn: string, axiomId: string, property: string, issue: string, hint: string) {
    this.fn = fn
    this.axiomId = axiomId
    this.property = property
    this.issue = issue
    this.hasCex = false
    this.cex = new Counterexample("")
    this.hint = hint
  }

  /**
   * Attaches a counterexample.
   *
   * @param cex the counterexample
   * @returns this item, to chain
   */
  withCex(cex: Counterexample): FeedbackItem {
    this.hasCex = true
    this.cex = cex
    return this
  }
}

/** What `vector verify` decided, with everything its output shows. */
export class VerifyOutcome {
  /** One of the `OUTCOME_*` statuses. */
  status: string
  /** The validation errors, for INVALID. */
  errors: string[]
  /** One prose block to paste back to the generator, for REFUTED, UNKNOWN and INVALID. */
  feedback: string
  /** The same, per clause, for REFUTED and UNKNOWN. */
  items: FeedbackItem[]
  /** What went wrong, for ERROR. */
  message: string
  /** The proof report box, once the solver ran. */
  dashboard: string
  /** The emitted TypeScript, for PROVEN. */
  emittedCode: string
  /** Advisory warnings that never block a proof. */
  styleWarnings: StyleWarning[]

  /**
   * Makes an outcome with nothing filled in.
   *
   * @param status one of the `OUTCOME_*` statuses
   */
  constructor(status: string) {
    this.status = status
    this.errors = []
    this.feedback = ""
    this.items = []
    this.message = ""
    this.dashboard = ""
    this.emittedCode = ""
    this.styleWarnings = []
  }
}

const verifyCexOrNone = (hasCex: boolean, cex: Counterexample): string =>
  hasCex && cex.names.length > 0 ? dashInputs(cex) : "some input"

// `(calls f)` → `f`.
const verifyCallee = (axiomId: string): string => {
  if (axiomId.startsWith("(calls ") && axiomId.endsWith(")")) {
    return axiomId.slice(7, toI32(axiomId.length) - 1)
  }
  return axiomId
}

/**
 * The report's problems as structured repair instructions, one per unproven
 * clause, hazard and float64 finding.
 *
 * @param report the report, after the float64 gate
 * @returns the items, in function order, float64 findings last
 */
export const collectFeedbackItems = (report: VerifyReport): FeedbackItem[] => {
  const items: FeedbackItem[] = []
  for (const fn of report.functions) {
    if (fn.vacuous) {
      items.push(
        new FeedbackItem(
          fn.name,
          "(reachable)",
          "requires are satisfiable",
          "vacuous",
          "No input provably satisfies this function's requires clauses (they are contradictory, or too nonlinear for the solver to decide), so every postcondition would hold vacuously and prove nothing. Remove or simplify the precondition(s); do NOT tighten requires to force a proof through.",
        ),
      )
    }
    for (const v of fn.ensures) {
      if (v.trivial) {
        items.push(
          new FeedbackItem(
            fn.name,
            v.axiomId,
            v.pretty,
            "trivial",
            "This ensures clause could not be shown to depend on the implementation — it is a tautology (holds regardless of the body), or too nonlinear for the solver to decide. Restate it as a real constraint on `result` that the body determines.",
          ),
        )
      } else if (v.status === CLAUSE_REFUTED && v.hasCex) {
        items.push(
          new FeedbackItem(
            fn.name,
            v.axiomId,
            v.pretty,
            "counterexample",
            "The postcondition is false for the input shown. Fix the body or tighten a requires clause so it holds for all remaining inputs.",
          ).withCex(v.cex),
        )
      } else if (v.status !== CLAUSE_PROVEN) {
        items.push(
          new FeedbackItem(
            fn.name,
            v.axiomId,
            v.pretty,
            "unknown",
            "The solver returned UNKNOWN. Restate the property and body in linear arithmetic (variables multiplied only by literal constants).",
          ),
        )
      }
    }
    for (const h of fn.divs) {
      const item = new FeedbackItem(
        fn.name,
        "(division)",
        h.pretty,
        "division-hazard",
        "The denominator may be zero on some reachable path. Add a requires clause (denominator != 0) or guard the division with an ite.",
      )
      items.push(h.hasCex ? item.withCex(h.cex) : item)
    }
    for (const h of fn.pres) {
      const item = new FeedbackItem(
        fn.name,
        `(calls ${h.callee})`,
        h.pretty,
        "precondition-hazard",
        `The call to ${h.callee} can violate its precondition (${h.pretty}) for the arguments shown. Strengthen this function's requires, or guard the call with an ite, so the callee is only reached where its precondition holds.`,
      )
      items.push(h.hasCex ? item.withCex(h.cex) : item)
    }
    for (const h of fn.ranges) {
      const item = new FeedbackItem(
        fn.name,
        "(range)",
        h.pretty,
        "range-hazard",
        "An Int is a float64 in the emitted code, exact only within ±(2^53−1), and this value can leave that range for the input shown. Rewrite it so no intermediate grows past its operands (low + (high - low) * k, not (low + high) * k), or bound the parameters with requires clauses.",
      )
      items.push(h.hasCex ? item.withCex(h.cex) : item)
    }
  }
  for (const c of report.conformance) {
    let hint =
      "Proven over exact reals but FALSE when the emitted float64 code runs on the input shown. Avoid exact `==`/`!=` over Real results (float rounding); use an inequality/tolerance, or move to Int where the value is genuinely discrete."
    if (c.kind === "unsampled") {
      hint =
        "No float64 input satisfied this function's preconditions, so the emitted code could not be checked against its contract. Widen the requires (or use bounds a double can represent) so real inputs exist."
    } else if (c.kind === "callee-guard") {
      hint =
        "The callee's precondition holds at this call site over exact reals, but float64 rounding of the computed argument violates its guard — the emitted code throws on an input this function's contract accepts. Guard the call with an ite, or strengthen this function's requires with a float-safe margin."
    }
    items.push(new FeedbackItem(c.fn, c.axiomId, c.pretty, "conformance", hint).withCex(c.input))
  }
  return items
}

/**
 * The report's problems as one prose block, a line per problem, to paste back
 * to whoever wrote the program.
 *
 * @param report the report, after the float64 gate
 * @returns the lines, joined by newlines
 */
export const formatReportFeedback = (report: VerifyReport): string => {
  const lines: string[] = []
  for (const fn of report.functions) {
    if (fn.vacuous) {
      lines.push(
        `Function ${fn.name}: VACUOUS — no input provably satisfies its requires clauses (contradictory, or undecidable for the solver), so the postconditions are proven only vacuously. Remove or simplify the precondition(s).`,
      )
    }
    for (const v of fn.ensures) {
      if (v.trivial) {
        lines.push(
          `Function ${fn.name}, ensures ${v.axiomId} (${v.pretty}): TRIVIAL — the clause was not shown to depend on the body (a tautology, or undecidable), so it formalizes nothing. Restate it as a real constraint on result.`,
        )
      } else if (v.status === CLAUSE_REFUTED && v.hasCex) {
        lines.push(
          `Function ${fn.name}, ensures ${v.axiomId} (${v.pretty}): REFUTED — counterexample ${dashInputs(v.cex)} gives result = ${v.cex.result}.`,
        )
      } else if (v.status !== CLAUSE_PROVEN) {
        lines.push(
          `Function ${fn.name}, ensures ${v.axiomId} (${v.pretty}): the solver returned UNKNOWN — restate the property and body using linear arithmetic (variables multiplied only by literal constants).`,
        )
      }
    }
    for (const h of fn.divs) {
      lines.push(
        `Function ${fn.name}: possible division by zero in ${h.pretty} (e.g. ${verifyCexOrNone(h.hasCex, h.cex)}) — add a requires clause or an ite guard.`,
      )
    }
    for (const h of fn.pres) {
      lines.push(
        `Function ${fn.name}: the call to ${h.callee} can violate its precondition ${h.pretty} (e.g. ${verifyCexOrNone(h.hasCex, h.cex)}) — strengthen this function's requires or guard the call with an ite.`,
      )
    }
    for (const h of fn.ranges) {
      lines.push(
        `Function ${fn.name}: Int overflow — ${h.pretty} can leave ±(2^53−1), where float64 rounds (e.g. ${verifyCexOrNone(h.hasCex, h.cex)}) — rewrite it so no intermediate grows past its operands, or bound the parameters with requires clauses.`,
      )
    }
  }
  for (const c of report.conformance) {
    const inputs = dashInputs(c.input)
    if (c.kind === "unsampled") {
      lines.push(
        `Function ${c.fn}: no float64 input satisfies its requires (${c.pretty}), so the emitted code could not be checked — widen the requires or use float-representable bounds.`,
      )
    } else if (c.kind === "callee-guard") {
      lines.push(
        `Function ${c.fn}: the call into ${verifyCallee(c.axiomId)} throws in float64 at ${inputs} — its guard ${c.pretty} was proven over reals but is violated by the rounded argument. Guard the call with an ite or add a float-safe margin to the requires.`,
      )
    } else {
      lines.push(
        `Function ${c.fn}, ensures ${c.axiomId} (${c.pretty}): proven over reals but FALSE in float64 at ${inputs} → result = ${c.input.result}. Avoid exact == over Real; use an inequality/tolerance.`,
      )
    }
  }
  return lines.join("\n")
}

const verifyInvalid = (errors: string[], lead: string): VerifyOutcome => {
  const out = new VerifyOutcome(OUTCOME_INVALID)
  out.errors = errors
  out.feedback = `${lead}:\n- ${errors.join("\n- ")}`
  return out
}

/**
 * Runs the whole gate over a parsed spec plan and program: shape, types, the
 * plan's decomposition and axiom traceability, then z3, then, once z3 proved
 * everything, the float64 gate. Reports every problem found at the first
 * stage that finds any, so a repair loop never fixes them one at a time.
 *
 * @param specDoc the spec plan's document
 * @param specRoot the spec plan's JSON value
 * @param programDoc the program's document
 * @param programRoot the program's JSON value
 * @param label what was verified, for the dashboard's prompt line
 * @returns the outcome
 */
export const verifySpecAndProgram = (
  specDoc: JsonDocument,
  specRoot: JsonValue,
  programDoc: JsonDocument,
  programRoot: JsonValue,
  label: string,
): VerifyOutcome => {
  const specErrors: string[] = []
  const plan = readSpecPlan(specDoc, specRoot, specErrors)
  const programErrors: string[] = []
  const program = readProgram(programDoc, programRoot, programErrors)
  if (specErrors.length > 0 || programErrors.length > 0) {
    const shape: string[] = []
    for (const e of specErrors) {
      shape.push(`spec plan: ${e}`)
    }
    for (const e of programErrors) {
      shape.push(`program: ${e}`)
    }
    return verifyInvalid(shape, "The artifacts failed structural validation")
  }
  const semantic: string[] = []
  for (const e of typecheckProgram(program)) {
    semantic.push(e)
  }
  for (const e of checkSpecProgramConsistency(plan, program)) {
    semantic.push(e)
  }
  for (const e of checkAxiomTraceability(plan, program)) {
    semantic.push(e)
  }
  if (semantic.length > 0) {
    return verifyInvalid(semantic, "The program failed deterministic validation")
  }
  const styleWarnings = collectStyleWarnings(program)
  const solved = solveProgram(program)
  if (solved.isErr()) {
    const out = new VerifyOutcome(OUTCOME_ERROR)
    out.message = solved.error
    return out
  }
  const report = solved.value
  // The float64 gate checks what the solver proved, so it runs only on a
  // clean proof: a refuted clause has nothing proven to check.
  if (report.ok()) {
    report.conformance = checkConformance(program, report)
  }
  const status = verdictStatus(report)
  const out = new VerifyOutcome(status === STATUS_PROVEN ? OUTCOME_PROVEN : status)
  out.dashboard = renderDashboard(label, report)
  out.styleWarnings = styleWarnings
  if (status === STATUS_PROVEN) {
    out.emittedCode = emitTypeScript(program)
  } else {
    out.feedback = formatReportFeedback(report)
    out.items = collectFeedbackItems(report)
  }
  return out
}

/**
 * A counterexample as JSON: `{ inputs: { name: value }, result }`, `result`
 * left out when there is none.
 *
 * @param cex the counterexample
 * @returns the JSON object
 */
export const counterexampleJson = (cex: Counterexample): OutJson => {
  const inputs = outJsonObject()
  for (let i = 0; i < toI32(cex.names.length); i++) {
    inputs.put(cex.names[i], outJsonString(cex.values[i]))
  }
  const out = outJsonObject().put("inputs", inputs)
  if (cex.result !== "") {
    out.put("result", outJsonString(cex.result))
  }
  return out
}

const verifyStyleJson = (warnings: StyleWarning[]): OutJson => {
  const out = outJsonArray()
  for (const w of warnings) {
    out.add(
      outJsonObject()
        .put("function", outJsonString(w.fn))
        .put("axiomId", outJsonString(w.axiomId))
        .put("property", outJsonString(w.property))
        .put("kind", outJsonString(w.kind))
        .put("hint", outJsonString(w.hint)),
    )
  }
  return out
}

/**
 * The outcome as `vector verify --json` prints it. Which members appear
 * depends on the status: PROVEN has `dashboard`, `emittedCode` and
 * `styleWarnings`; REFUTED and UNKNOWN have `dashboard`, `feedback`, `items`
 * and `styleWarnings`; INVALID has `errors` and `feedback`; ERROR has `message`.
 *
 * @param outcome the outcome
 * @returns the JSON object
 */
export const verifyOutcomeJson = (outcome: VerifyOutcome): OutJson => {
  const out = outJsonObject().put("status", outJsonString(outcome.status))
  if (outcome.status === OUTCOME_ERROR) {
    return out.put("message", outJsonString(outcome.message))
  }
  if (outcome.status === OUTCOME_INVALID) {
    return out.put("errors", outJsonStrings(outcome.errors)).put("feedback", outJsonString(outcome.feedback))
  }
  out.put("dashboard", outJsonString(outcome.dashboard))
  if (outcome.status === OUTCOME_PROVEN) {
    out.put("emittedCode", outJsonString(outcome.emittedCode))
  } else {
    out.put("feedback", outJsonString(outcome.feedback))
    const items = outJsonArray()
    for (const it of outcome.items) {
      const item = outJsonObject()
        .put("function", outJsonString(it.fn))
        .put("axiomId", outJsonString(it.axiomId))
        .put("property", outJsonString(it.property))
        .put("issue", outJsonString(it.issue))
      if (it.hasCex) {
        item.put("counterexample", counterexampleJson(it.cex))
      }
      items.add(item.put("hint", outJsonString(it.hint)))
    }
    out.put("items", items)
  }
  return out.put("styleWarnings", verifyStyleJson(outcome.styleWarnings))
}
