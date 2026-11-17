/**
 * `verify/solve/report` — runs a program's verification script through z3 and
 * reads the answers into a report. It fails closed: a function is vacuous
 * unless its requires are shown satisfiable, a clause is trivial unless it is
 * shown to depend on the body, a clause is proven only on `unsat`, and a
 * division, call site or Int operation is a hazard unless it is shown safe.
 */

import { runProcess } from "../../core/process"
import { QueryAnswer } from "../../core/smt"
import { resolveZ3, runZ3 } from "../../core/z3"
import { FnUnit, Program } from "../lang/ast"
import { RESULT_NAME } from "../lang/check"
import { prettyMath } from "../lang/pretty"
import {
  QUERY_DIV,
  QUERY_ENSURES,
  QUERY_PRE,
  QUERY_RANGE,
  QUERY_REACHABLE,
  QUERY_TRIVIAL,
  SmtQuery,
  buildVerificationScript,
  smtVarName,
} from "../smt/script"

/** An ensures clause holds for every input. */
export const CLAUSE_PROVEN: string = "proven"
/** The solver found an input where an ensures clause fails. */
export const CLAUSE_REFUTED: string = "counterexample"
/** The solver could not decide an ensures clause. */
export const CLAUSE_UNKNOWN: string = "unknown"

/** A concrete input, as parameter names and values, and what the body returns there. */
export class Counterexample {
  /** The parameters' names. */
  names: string[]
  /** Each parameter's value, at the same index. */
  values: string[]
  /** The result, or `?` when the model does not give it. */
  result: string

  /**
   * Makes an empty counterexample.
   *
   * @param result the result
   */
  constructor(result: string) {
    this.names = []
    this.values = []
    this.result = result
  }
}

/** The verdict on one ensures clause. */
export class ClauseVerdict {
  /** The axiom the clause formalizes. */
  axiomId: string
  /** The clause in math style. */
  pretty: string
  /** `CLAUSE_PROVEN`, `CLAUSE_REFUTED` or `CLAUSE_UNKNOWN`. */
  status: string
  /** Whether the clause was proven but not shown to depend on the body. */
  trivial: boolean
  /** Whether `cex` holds a counterexample. */
  hasCex: boolean
  /** The counterexample of a refuted clause. */
  cex: Counterexample
  /** The clause's index in the function's ensures; -1 when unset. */
  clauseIndex: i32
  /** What replaying `cex` found (`verify/solve/replay`); "" before it runs. */
  replay: string
  /** The replay's detail: the check that differed, or why it was not replayed. */
  replayDetail: string

  /**
   * Makes a verdict.
   *
   * @param axiomId the axiom
   * @param pretty the clause in math style
   * @param status the status
   */
  constructor(axiomId: string, pretty: string, status: string) {
    this.axiomId = axiomId
    this.pretty = pretty
    this.status = status
    this.trivial = false
    this.hasCex = false
    this.cex = new Counterexample("?")
    this.clauseIndex = -1
    this.replay = ""
    this.replayDetail = ""
  }
}

/**
 * A division that may be by zero, a call that may break its callee's
 * requires, or an Int value that may leave ±(2^53−1).
 */
export class Hazard {
  /** The callee; "" for a division or an Int value. */
  callee: string
  /** The division, the callee's requires or the Int expression, in math style. */
  pretty: string
  /** Whether `cex` holds an example input. */
  hasCex: boolean
  /** An input that reaches the hazard. */
  cex: Counterexample
  /** `QUERY_DIV`, `QUERY_PRE` or `QUERY_RANGE`. */
  kind: i32
  /** Which hazard of its kind in its function, counting every query of that kind. */
  index: i32
  /** What replaying `cex` found (`verify/solve/replay`); "" before it runs. */
  replay: string
  /** The replay's detail: the check that differed, or why it was not replayed. */
  replayDetail: string

  /**
   * Makes a hazard with no example.
   *
   * @param callee the callee, or ""
   * @param pretty the expression in math style
   */
  constructor(callee: string, pretty: string) {
    this.callee = callee
    this.pretty = pretty
    this.hasCex = false
    this.cex = new Counterexample("?")
    this.kind = 0
    this.index = -1
    this.replay = ""
    this.replayDetail = ""
  }
}

/** Everything the solver said about one function. */
export class FnReport {
  /** The function's name. */
  name: string
  /** Its layer. */
  layer: i32
  /** `name(p: Ty, ...): Ty`. */
  signature: string
  /** Each requires clause in math style. */
  requiresPretty: string[]
  /** The body in math style. */
  bodyPretty: string
  /** One verdict per ensures clause, in order. */
  ensures: ClauseVerdict[]
  /** The division hazards. */
  divs: Hazard[]
  /** The call-site precondition hazards. */
  pres: Hazard[]
  /** The Int values that may leave ±(2^53−1). */
  ranges: Hazard[]
  /** Whether the requires were not shown satisfiable. */
  vacuous: boolean
  /** An input inside the requires, from the reachability model; empty when there is none. */
  witness: Counterexample

  /**
   * Makes an empty report for a function.
   *
   * @param fn the function
   */
  constructor(fn: FnUnit) {
    this.name = fn.name
    this.layer = fn.layer
    this.signature = signatureOf(fn)
    this.requiresPretty = []
    for (const c of fn.requires) {
      this.requiresPretty.push(prettyMath(c.expr))
    }
    this.bodyPretty = prettyMath(fn.body)
    this.ensures = []
    this.divs = []
    this.pres = []
    this.ranges = []
    this.vacuous = false
    this.witness = new Counterexample("?")
  }
}

/** A proven guarantee that float64 execution breaks. */
export class ConformanceIssue {
  /** The function. */
  fn: string
  /** `postcondition`, `callee-guard` or `unsampled`. */
  kind: string
  /** The clause's axiom, `(calls F)`, or `(requires)`. */
  axiomId: string
  /** The clause or guard in math style. */
  pretty: string
  /** The input, as names and values; empty for `unsampled`. */
  input: Counterexample

  /**
   * Makes an issue.
   *
   * @param fn the function
   * @param kind the kind
   * @param axiomId the axiom or pseudo-axiom
   * @param pretty the clause or guard in math style
   * @param input the input and result
   */
  constructor(fn: string, kind: string, axiomId: string, pretty: string, input: Counterexample) {
    this.fn = fn
    this.kind = kind
    this.axiomId = axiomId
    this.pretty = pretty
    this.input = input
  }
}

/** A whole program's verification report. */
export class VerifyReport {
  /** The solver, such as `Z3 4.16.0 (native)`. */
  solver: string
  /** One report per function, in program order. */
  functions: FnReport[]
  /** How many ensures clauses were checked. */
  totalVcs: i32
  /** How many were proven. */
  unsatCount: i32
  /** How many were refuted. */
  satCount: i32
  /** How many were undecided. */
  unknownCount: i32
  /** How many division hazards there are. */
  divCount: i32
  /** How many call-site precondition hazards there are. */
  preCount: i32
  /** How many Int range hazards there are. */
  rangeCount: i32
  /** How many proven clauses are trivial. */
  trivialCount: i32
  /** How many functions are vacuous. */
  vacuousCount: i32
  /** What the float64 gate found; empty until it runs. */
  conformance: ConformanceIssue[]
  /** How long z3 took, in milliseconds. */
  millis: i32
  /** How many counterexamples did not replay as z3 said (`verify/solve/replay`). */
  mismatchCount: i32

  /**
   * Makes an empty report.
   *
   * @param solver the solver's label
   */
  constructor(solver: string) {
    this.solver = solver
    this.functions = []
    this.totalVcs = 0
    this.unsatCount = 0
    this.satCount = 0
    this.unknownCount = 0
    this.divCount = 0
    this.preCount = 0
    this.rangeCount = 0
    this.trivialCount = 0
    this.vacuousCount = 0
    this.conformance = []
    this.millis = 0
    this.mismatchCount = 0
  }

  /**
   * Whether every clause is proven, meaningfully, with no hazard and no float64 issue.
   *
   * @returns true when the program is proven
   */
  ok(): boolean {
    return (
      this.satCount === 0 &&
      this.unknownCount === 0 &&
      this.divCount === 0 &&
      this.preCount === 0 &&
      this.rangeCount === 0 &&
      this.trivialCount === 0 &&
      this.vacuousCount === 0 &&
      this.conformance.length === 0
    )
  }
}

/**
 * A function's signature as the dashboard shows it.
 *
 * @param fn the function
 * @returns `name(p: Ty, ...): Ty`
 */
export const signatureOf = (fn: FnUnit): string => {
  const parts: string[] = []
  for (const p of fn.params) {
    parts.push(`${p.name}: ${p.ty}`)
  }
  return `${fn.name}(${parts.join(", ")}): ${fn.returnType}`
}

const reportCex = (program: Program, q: SmtQuery, a: QueryAnswer): Counterexample => {
  const fn = program.functions[q.fnIndex]
  const cex = new Counterexample(a.value(smtVarName(q.fnIndex, RESULT_NAME)) ?? "?")
  for (const p of fn.params) {
    const v = a.value(smtVarName(q.fnIndex, p.name))
    if (v !== null) {
      cex.names.push(p.name)
      cex.values.push(v)
    }
  }
  return cex
}

/**
 * Reads z3's answers into a report.
 *
 * @param program the program the script was built from
 * @param queries the script's queries
 * @param answers one answer per query; a query past the last reads as unknown
 * @param solver the solver's label
 * @returns the report
 */
export const assembleReport = (
  program: Program,
  queries: SmtQuery[],
  answers: QueryAnswer[],
  solver: string,
): VerifyReport => {
  const report = new VerifyReport(solver)
  const trivial: boolean[][] = []
  for (const fn of program.functions) {
    report.functions.push(new FnReport(fn))
    const flags: boolean[] = []
    for (let i = 0; i < toI32(fn.ensures.length); i++) {
      flags.push(false)
    }
    trivial.push(flags)
  }
  // A query z3 left unanswered proves nothing: it reads as unknown, never as
  // a missing obligation.
  const given: QueryAnswer[] = []
  for (let i = 0; i < toI32(queries.length); i++) {
    given.push(i < toI32(answers.length) ? answers[i] : new QueryAnswer("unknown"))
  }
  const n = toI32(queries.length)
  // The n-th hazard query of a kind in a function is the n-th hazard of that
  // kind the script recorded, which the replay counts the same way.
  const hazardSeen: i32[][] = []
  for (let f = 0; f < toI32(program.functions.length); f++) {
    hazardSeen.push([0, 0, 0])
  }
  for (let i = 0; i < n; i++) {
    const q = queries[i]
    const a = given[i]
    if (q.kind === QUERY_REACHABLE) {
      if (a.result !== "sat") {
        report.functions[q.fnIndex].vacuous = true
      } else {
        report.functions[q.fnIndex].witness = reportCex(program, q, a)
      }
    } else if (q.kind === QUERY_TRIVIAL && a.result !== "sat") {
      trivial[q.fnIndex][q.clauseIndex] = true
    }
  }
  for (let i = 0; i < n; i++) {
    const q = queries[i]
    const a = given[i]
    const fr = report.functions[q.fnIndex]
    if (q.kind === QUERY_ENSURES) {
      report.totalVcs = report.totalVcs + 1
      if (a.result === "unsat") {
        const v = new ClauseVerdict(q.axiomId, q.pretty, CLAUSE_PROVEN)
        report.unsatCount = report.unsatCount + 1
        if (trivial[q.fnIndex][q.clauseIndex]) {
          v.trivial = true
          report.trivialCount = report.trivialCount + 1
        }
        fr.ensures.push(v)
      } else if (a.result === "sat") {
        const v = new ClauseVerdict(q.axiomId, q.pretty, CLAUSE_REFUTED)
        report.satCount = report.satCount + 1
        v.hasCex = true
        v.cex = reportCex(program, q, a)
        v.clauseIndex = q.clauseIndex
        fr.ensures.push(v)
      } else {
        report.unknownCount = report.unknownCount + 1
        fr.ensures.push(new ClauseVerdict(q.axiomId, q.pretty, CLAUSE_UNKNOWN))
      }
    } else if (q.kind === QUERY_DIV || q.kind === QUERY_PRE || q.kind === QUERY_RANGE) {
      const slot = q.kind === QUERY_DIV ? 0 : q.kind === QUERY_PRE ? 1 : 2
      const index = hazardSeen[q.fnIndex][slot]
      hazardSeen[q.fnIndex][slot] = index + 1
      if (a.result === "unsat") {
        continue
      }
      const h = new Hazard(q.callee, q.pretty)
      h.kind = q.kind
      h.index = index
      if (a.result === "sat") {
        h.hasCex = true
        h.cex = reportCex(program, q, a)
      }
      if (q.kind === QUERY_DIV) {
        report.divCount = report.divCount + 1
        fr.divs.push(h)
      } else if (q.kind === QUERY_RANGE) {
        report.rangeCount = report.rangeCount + 1
        fr.ranges.push(h)
      } else {
        report.preCount = report.preCount + 1
        fr.pres.push(h)
      }
    }
  }
  for (const fr of report.functions) {
    if (fr.vacuous) {
      report.vacuousCount = report.vacuousCount + 1
    }
  }
  return report
}

/**
 * The solver's label for the dashboard, from `z3 --version`.
 *
 * @returns `Z3 <version> (native)`, or `Z3 (native)` when the version cannot be read
 */
export const solverLabel = (): string => {
  const bin = resolveZ3()
  if (bin.isErr()) {
    return "Z3 (native)"
  }
  const ran = runProcess([bin.value, "--version"], "", 10000)
  if (ran.isErr()) {
    return "Z3 (native)"
  }
  const out = ran.value.stdout
  const at = toI32(out.indexOf("version "))
  if (at < 0) {
    return "Z3 (native)"
  }
  let end = at + 8
  while (end < toI32(out.length) && out.charCodeAt(end) !== 32 && out.charCodeAt(end) !== 10) {
    end = end + 1
  }
  return `Z3 ${out.slice(at + 8, end)} (native)`
}

/**
 * Whether a z3 `(error …)` line is the expected refusal of a `get-value` after
 * a query that was not `sat`; every other error means an assertion was dropped.
 *
 * @param line one error line
 * @returns true when the line is that refusal
 */
export const solveIsModelRefusal = (line: string): boolean => line.endsWith(': model is not available")')

/**
 * Proves a typechecked program: builds its script, runs z3 and assembles the
 * report. Any z3 error other than a refused `get-value` fails the run, since
 * it means an assertion never reached the solver.
 *
 * @param program the typechecked program
 * @returns `Ok` with the report, or `Err` when z3 could not run or rejected part of the script
 */
export const solveProgram = (program: Program): Result<VerifyReport, string> => {
  const script = buildVerificationScript(program)
  const run = runZ3(script.text, toI32(script.queries.length)).orReturn()
  for (const line of run.errors) {
    if (!solveIsModelRefusal(line)) {
      return Err(`z3 rejected the script: ${line}`)
    }
  }
  const report = assembleReport(program, script.queries, run.answers, solverLabel())
  report.millis = run.millis
  return Ok(report)
}
