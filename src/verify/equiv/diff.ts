/**
 * `verify/equiv/diff` — the regeneration gate: prove that a new version of a
 * program behaves exactly as the old one did, or show the inputs where it
 * does not.
 *
 * A function's observable behavior is its requires (the runtime guards) and
 * its body (the return value); ensures are proof-only, so rewording a
 * contract never registers as a behavioral change. Each name-matched,
 * signature-compatible pair gets three z3 queries:
 *
 *   narrowed:  ∃x. pre_old(x) ∧ ¬pre_new(x)   — inputs the new version rejects
 *   widened:   ∃x. pre_new(x) ∧ ¬pre_old(x)   — inputs the new version accepts
 *   value:     ∃x. pre_old ∧ pre_new ∧ body_old(x) ≠ body_new(x)
 *
 * unsat on all three is equivalence over exact rationals; a pair equal there
 * is then run in float64, since equal reals are not equal doubles. Both
 * versions are assumed to pass `vector verify`; only shape and types are
 * checked again here.
 */

import { JsonDocument, JsonValue } from "nish/json-value"
import { QueryAnswer } from "../../core/smt"
import { runZ3 } from "../../core/z3"
import { Float64Delta, findFloat64Delta } from "../emit/float64"
import { OutJson, outJsonArray, outJsonBool, outJsonObject, outJsonString, outJsonStrings } from "../emit/outjson"
import { FnUnit, Program } from "../lang/ast"
import { typecheckProgram } from "../lang/check"
import { prettyMath } from "../lang/pretty"
import { readProgram } from "../lang/read"
import { SmtEmitter, SmtScope, smtPreamble } from "../smt/script"
import {
  REPLAY_MISMATCH,
  REPLAY_NARROWED,
  REPLAY_VALUE,
  REPLAY_WIDENED,
  replayJsonPut,
  replayWitness,
} from "../solve/replay"
import { Counterexample, signatureOf, solveIsModelRefusal, solverLabel } from "../solve/report"

/** Every shared function provably behaves identically. */
export const DIFF_EQUIVALENT: string = "EQUIVALENT"
/** Some concrete behavioral change was found. */
export const DIFF_DIFFERENT: string = "DIFFERENT"
/** No difference was found, but some check was undecided. */
export const DIFF_UNDECIDED: string = "UNDECIDED"
/** An input failed its shape or type check. */
export const DIFF_INVALID: string = "INVALID"
/** z3 could not run, or rejected the script. */
export const DIFF_ERROR: string = "ERROR"
/** A witness z3 gave does not do what z3 said when replayed exactly: a bug in vector. */
export const DIFF_MISMATCH: string = "MISMATCH"

/** A check z3 proved impossible (unsat). */
export const CHECK_NONE: string = "none"
/** A check z3 found a concrete input for (sat). */
export const CHECK_WITNESS: string = "witness"
/** A check z3 could not decide. */
export const CHECK_UNKNOWN: string = "unknown"

const DIFF_NARROWED: i32 = 1
const DIFF_WIDENED: i32 = 2
const DIFF_VALUE: i32 = 3
const DIFF_DOMAIN: i32 = 4

/** A function in both versions whose parameter and return types agree. */
export class FunctionPair {
  /** The function before. */
  oldFn: FnUnit
  /** The function after. */
  newFn: FnUnit

  /**
   * Pairs two versions of a function.
   *
   * @param oldFn the function before
   * @param newFn the function after
   */
  constructor(oldFn: FnUnit, newFn: FnUnit) {
    this.oldFn = oldFn
    this.newFn = newFn
  }
}

/** A function in both versions whose types changed: breaking, never compared. */
export class SignatureChange {
  /** The function's name. */
  name: string
  /** Its signature before. */
  oldSignature: string
  /** Its signature after. */
  newSignature: string

  /**
   * Records a changed signature.
   *
   * @param name the function's name
   * @param oldSignature its signature before
   * @param newSignature its signature after
   */
  constructor(name: string, oldSignature: string, newSignature: string) {
    this.name = name
    this.oldSignature = oldSignature
    this.newSignature = newSignature
  }
}

/** How the two versions' functions match up by name. */
export class FunctionPairing {
  /** The pairs to compare. */
  comparable: FunctionPair[]
  /** The pairs whose types changed. */
  signatureChanged: SignatureChange[]
  /** The functions only the new version has. */
  added: FnUnit[]
  /** The functions only the old version has. */
  removed: FnUnit[]

  /** Makes an empty pairing. */
  constructor() {
    this.comparable = []
    this.signatureChanged = []
    this.added = []
    this.removed = []
  }
}

// The first function of a program with this name, or null.
const diffFind = (program: Program, name: string): FnUnit | null => {
  for (const f of program.functions) {
    if (f.name === name) {
      return f
    }
  }
  return null
}

const diffCompatible = (a: FnUnit, b: FnUnit): boolean => {
  if (a.returnType !== b.returnType || a.params.length !== b.params.length) {
    return false
  }
  // The length check above makes the two bounds equal; the second is the
  // prover's.
  for (let i = 0; i < toI32(a.params.length) && i < toI32(b.params.length); i++) {
    if (a.params[i].ty !== b.params[i].ty) {
      return false
    }
  }
  return true
}

/**
 * Matches the two versions' functions by name. A pair is comparable when its
 * parameter types, by position, and its return type agree; parameter names
 * may differ, since calls are positional.
 *
 * @param oldProgram the program before
 * @param newProgram the program after
 * @returns the pairing
 */
export const pairFunctions = (oldProgram: Program, newProgram: Program): FunctionPairing => {
  const out = new FunctionPairing()
  for (const f of newProgram.functions) {
    if (diffFind(oldProgram, f.name) === null) {
      out.added.push(f)
    }
  }
  for (const oldFn of oldProgram.functions) {
    const newFn = diffFind(newProgram, oldFn.name)
    if (newFn === null) {
      out.removed.push(oldFn)
      continue
    }
    if (diffCompatible(oldFn, newFn)) {
      out.comparable.push(new FunctionPair(oldFn, newFn))
    } else {
      out.signatureChanged.push(new SignatureChange(oldFn.name, signatureOf(oldFn), signatureOf(newFn)))
    }
  }
  return out
}

/** One z3 query of a diff script. */
export class DiffQuery {
  /** Which check it is: narrowed, widened, value or shared domain. */
  kind: i32
  /** The SMT constant of each parameter. */
  smtNames: string[]
  /** Each parameter's name in the new version, at the same index. */
  names: string[]
  /** The old version's result constant. */
  oldResultSmt: string
  /** The new version's result constant. */
  newResultSmt: string

  /**
   * Makes a query.
   *
   * @param kind which check it is
   * @param smtNames the parameters' SMT constants
   * @param names the parameters' names
   * @param oldResultSmt the old result's constant
   * @param newResultSmt the new result's constant
   */
  constructor(kind: i32, smtNames: string[], names: string[], oldResultSmt: string, newResultSmt: string) {
    this.kind = kind
    this.smtNames = smtNames
    this.names = names
    this.oldResultSmt = oldResultSmt
    this.newResultSmt = newResultSmt
  }
}

/** A diff script and its queries, in the order z3 answers them. */
export class DiffScript {
  /** The SMT-LIB text. */
  text: string
  /** Four queries per pair: narrowed, widened, value, shared domain. */
  queries: DiffQuery[]

  /**
   * Makes a script.
   *
   * @param text the SMT-LIB text
   * @param queries its queries
   */
  constructor(text: string, queries: DiffQuery[]) {
    this.text = text
    this.queries = queries
  }
}

const diffConj = (terms: string[]): string => {
  if (terms.length === 0) {
    return "true"
  }
  if (terms.length === 1) {
    return terms[0]
  }
  return `(and ${terms.join(" ")})`
}

const diffQuery = (lines: string[], queries: DiffQuery[], q: DiffQuery, asserts: string[], getVars: string[]): void => {
  const qid = toI32(queries.length)
  lines.push("(push 1)")
  for (const a of asserts) {
    lines.push(`(assert ${a})`)
  }
  lines.push(`(echo "@@Q${qid}")`)
  lines.push("(check-sat)")
  if (getVars.length > 0) {
    lines.push(`(get-value (${getVars.join(" ")}))`)
  }
  lines.push("(pop 1)")
  queries.push(q)
}

/**
 * Builds the diff script: per pair, one shared set of input constants that
 * both versions' parameters map onto by position, then the narrowed, widened
 * and value queries, and a model of the shared domain that seeds the float64
 * comparison. Both programs must be typechecked.
 *
 * @param pairs the pairs to compare
 * @param oldProgram the program before, whose functions old calls inline
 * @param newProgram the program after
 * @returns the script and its queries
 */
export const emitDiffScript = (pairs: FunctionPair[], oldProgram: Program, newProgram: Program): DiffScript => {
  const emitOld = new SmtEmitter(oldProgram, false)
  const emitNew = new SmtEmitter(newProgram, false)
  const lines: string[] = []
  const queries: DiffQuery[] = []
  for (let idx = 0; idx < toI32(pairs.length); idx++) {
    const oldFn = pairs[idx].oldFn
    const newFn = pairs[idx].newFn
    // pairFunctions never pairs an old version with fewer parameters than
    // the new one: such a pair gets no queries, so the query count that
    // assembleDiffs checks refuses the script rather than leave a new
    // parameter unbound in the old version.
    if (oldFn.params.length < newFn.params.length) {
      continue
    }
    // The `x` and `r` infixes keep parameters and results apart: a parameter
    // could itself be named `r_old`.
    const smtNames: string[] = []
    const names: string[] = []
    const oldScope = new SmtScope()
    const newScope = new SmtScope()
    // The check above makes the second bound never stop the loop early.
    for (let i = 0; i < toI32(newFn.params.length) && i < toI32(oldFn.params.length); i++) {
      const p = newFn.params[i]
      const oldName = oldFn.params[i].name
      const v = `d${idx}x${i}_${p.name}`
      smtNames.push(v)
      names.push(p.name)
      lines.push(`(declare-const ${v} ${p.ty})`)
      oldScope.bind(oldName, v)
      newScope.bind(p.name, v)
    }
    const oldResult = `d${idx}r_old`
    const newResult = `d${idx}r_new`
    lines.push(`(declare-const ${oldResult} ${oldFn.returnType})`)
    lines.push(`(declare-const ${newResult} ${newFn.returnType})`)
    const noPath: string[] = []
    const preOld: string[] = []
    for (const c of oldFn.requires) {
      preOld.push(emitOld.term(c.expr, oldScope, noPath))
    }
    const preNew: string[] = []
    for (const c of newFn.requires) {
      preNew.push(emitNew.term(c.expr, newScope, noPath))
    }
    const bodyOld = emitOld.term(oldFn.body, oldScope, noPath)
    const bodyNew = emitNew.term(newFn.body, newScope, noPath)

    // sat: an input the old version accepted is now rejected.
    const narrowed: string[] = preOld.slice(0)
    narrowed.push(`(not ${diffConj(preNew)})`)
    diffQuery(lines, queries, new DiffQuery(DIFF_NARROWED, smtNames, names, oldResult, newResult), narrowed, smtNames)
    // sat: an input the old version rejected is now accepted.
    const widened: string[] = preNew.slice(0)
    widened.push(`(not ${diffConj(preOld)})`)
    diffQuery(lines, queries, new DiffQuery(DIFF_WIDENED, smtNames, names, oldResult, newResult), widened, smtNames)
    // sat: on the shared domain, the bodies disagree somewhere.
    const value: string[] = preOld.slice(0)
    for (const p of preNew) {
      value.push(p)
    }
    value.push(`(= ${oldResult} ${bodyOld})`)
    value.push(`(= ${newResult} ${bodyNew})`)
    value.push(`(distinct ${oldResult} ${newResult})`)
    const valueVars: string[] = smtNames.slice(0)
    valueVars.push(oldResult)
    valueVars.push(newResult)
    diffQuery(lines, queries, new DiffQuery(DIFF_VALUE, smtNames, names, oldResult, newResult), value, valueVars)
    // sat: an input both versions accept, where float64 sampling starts.
    const shared: string[] = preOld.slice(0)
    for (const p of preNew) {
      shared.push(p)
    }
    diffQuery(lines, queries, new DiffQuery(DIFF_DOMAIN, smtNames, names, oldResult, newResult), shared, smtNames)
  }
  return new DiffScript(`${smtPreamble()}${lines.join("\n")}\n`, queries)
}

/** One of the three checks on a pair. */
export class DiffCheck {
  /** `CHECK_NONE`, `CHECK_WITNESS` or `CHECK_UNKNOWN`. */
  status: string
  /** The witness input, by the new version's parameter names. */
  inputs: Counterexample
  /** Whether the witness carries results (the value check). */
  hasResults: boolean
  /** The old version's result at the witness. */
  oldResult: string
  /** The new version's result at the witness. */
  newResult: string
  /** What replaying the witness found (`confirmed`, `not-replayed`, `mismatch`); "" before it ran. */
  replay: string
  /** Why the replay found it. */
  replayDetail: string

  /**
   * Makes a check with no witness.
   *
   * @param status the check's status
   */
  constructor(status: string) {
    this.status = status
    this.inputs = new Counterexample("")
    this.hasResults = false
    this.oldResult = ""
    this.newResult = ""
    this.replay = ""
    this.replayDetail = ""
  }
}

const diffCheck = (q: DiffQuery, a: QueryAnswer): DiffCheck => {
  if (a.result === "unsat") {
    return new DiffCheck(CHECK_NONE)
  }
  if (a.result !== "sat") {
    return new DiffCheck(CHECK_UNKNOWN)
  }
  const out = new DiffCheck(CHECK_WITNESS)
  // assembleDiffs refuses a model value past the names, so every constant
  // the second bound stops before has an empty value and is skipped anyway.
  for (let i = 0; i < toI32(q.smtNames.length) && i < toI32(q.names.length); i++) {
    const name = q.names[i]
    const v = a.value(q.smtNames[i]) ?? ""
    if (v !== "") {
      out.inputs.names.push(name)
      out.inputs.values.push(v)
    }
  }
  if (q.kind === DIFF_VALUE) {
    out.hasResults = true
    out.oldResult = a.value(q.oldResultSmt) ?? "?"
    out.newResult = a.value(q.newResultSmt) ?? "?"
  }
  return out
}

/** A parameter renamed between versions: no behavioral effect. */
export class ParamRename {
  /** Its name before. */
  oldName: string
  /** Its name after. */
  newName: string

  /**
   * Records a rename.
   *
   * @param oldName its name before
   * @param newName its name after
   */
  constructor(oldName: string, newName: string) {
    this.oldName = oldName
    this.newName = newName
  }
}

/** The verdict on one compared pair. */
export class MatchedFunctionDiff {
  /** The function's name. */
  name: string
  /** Its signature, by the new version's names. */
  signature: string
  /** Positional parameter renames. */
  paramRenames: ParamRename[]
  /** Inputs the new version rejects that the old accepted. */
  domainNarrowed: DiffCheck
  /** Inputs the new version accepts that the old rejected. */
  domainWidened: DiffCheck
  /** Inputs where the two bodies disagree. */
  valueDiff: DiffCheck
  /** An input both versions accept, or none when their shared domain is empty. */
  sharedDomain: DiffCheck
  /** All three checks came back unsat. */
  equivalent: boolean
  /** Requires clauses only the new version has, in math style. */
  requiresAdded: string[]
  /** Requires clauses only the old version had. */
  requiresRemoved: string[]
  /** Ensures clauses only the new version has. */
  ensuresAdded: string[]
  /** Ensures clauses only the old version had. */
  ensuresRemoved: string[]

  /**
   * Makes a verdict from its three checks.
   *
   * @param name the function's name
   * @param signature its signature
   * @param narrowed the narrowed check
   * @param widened the widened check
   * @param value the value check
   */
  constructor(name: string, signature: string, narrowed: DiffCheck, widened: DiffCheck, value: DiffCheck) {
    this.name = name
    this.signature = signature
    this.paramRenames = []
    this.domainNarrowed = narrowed
    this.domainWidened = widened
    this.valueDiff = value
    this.sharedDomain = new DiffCheck(CHECK_UNKNOWN)
    this.equivalent = narrowed.status === CHECK_NONE && widened.status === CHECK_NONE && value.status === CHECK_NONE
    this.requiresAdded = []
    this.requiresRemoved = []
    this.ensuresAdded = []
    this.ensuresRemoved = []
  }

  /**
   * Whether any of the three checks has the status.
   *
   * @param status the status to look for
   * @returns true when one has it
   */
  any(status: string): boolean {
    return (
      this.domainNarrowed.status === status || this.domainWidened.status === status || this.valueDiff.status === status
    )
  }

  /**
   * Whether replaying any of the three checks' witnesses was a mismatch.
   *
   * @returns true when one was
   */
  mismatched(): boolean {
    return (
      this.domainNarrowed.replay === REPLAY_MISMATCH ||
      this.domainWidened.replay === REPLAY_MISMATCH ||
      this.valueDiff.replay === REPLAY_MISMATCH
    )
  }
}

const diffReplayCheck = (
  oldProgram: Program,
  pair: FunctionPair,
  newProgram: Program,
  kind: i32,
  c: DiffCheck,
): void => {
  if (c.status !== CHECK_WITNESS) {
    return
  }
  const r = replayWitness(oldProgram, pair.oldFn, newProgram, pair.newFn, kind, c.inputs, c.oldResult, c.newResult)
  c.replay = r.outcome
  c.replayDetail = r.detail
}

/**
 * Replays every witness z3 gave through both versions, exactly and without
 * z3, filling in each check's `replay` and `replayDetail`.
 *
 * @param oldProgram the old program
 * @param newProgram the new program
 * @param pairs the compared pairs
 * @param matched a verdict per pair, as `assembleDiffs` made them
 * @returns how many replays were a mismatch
 */
export const diffReplayWitnesses = (
  oldProgram: Program,
  newProgram: Program,
  pairs: FunctionPair[],
  matched: MatchedFunctionDiff[],
): i32 => {
  const mismatched: DiffCheck[] = []
  for (let i = 0; i < toI32(matched.length) && i < toI32(pairs.length); i++) {
    const m = matched[i]
    const pair = pairs[i]
    diffReplayCheck(oldProgram, pair, newProgram, REPLAY_NARROWED, m.domainNarrowed)
    diffReplayCheck(oldProgram, pair, newProgram, REPLAY_WIDENED, m.domainWidened)
    diffReplayCheck(oldProgram, pair, newProgram, REPLAY_VALUE, m.valueDiff)
    for (const c of [m.domainNarrowed, m.domainWidened, m.valueDiff]) {
      if (c.replay === REPLAY_MISMATCH) {
        mismatched.push(c)
      }
    }
  }
  return toI32(mismatched.length)
}

// The clauses of `a` whose math rendering `b` lacks, each once.
const diffClausesMissing = (a: string[], b: string[]): string[] => {
  const out: string[] = []
  for (const s of a) {
    if (b.indexOf(s) < 0 && out.indexOf(s) < 0) {
      out.push(s)
    }
  }
  return out
}

const diffPrettyRequires = (fn: FnUnit): string[] => {
  const out: string[] = []
  for (const c of fn.requires) {
    out.push(prettyMath(c.expr))
  }
  return out
}

const diffPrettyEnsures = (fn: FnUnit): string[] => {
  const out: string[] = []
  for (const c of fn.ensures) {
    out.push(prettyMath(c.expr))
  }
  return out
}

/**
 * Folds z3's answers back into one verdict per pair, with the parameter
 * renames and the clause text that changed.
 *
 * @param pairs the compared pairs
 * @param queries the script's queries, four per pair
 * @param answers z3's answers, one per query
 * @returns a verdict per pair, or `Err` when the answers do not line up
 */
export const assembleDiffs = (
  pairs: FunctionPair[],
  queries: DiffQuery[],
  answers: QueryAnswer[],
): Result<MatchedFunctionDiff[], string> => {
  // `queries.length` is four per pair, computed without the product's overflow.
  const countErr = `diff: ${answers.length} answers for ${queries.length} queries over ${pairs.length} pairs`
  if (queries.length % 4 !== 0 || queries.length / 4 !== pairs.length || answers.length !== queries.length) {
    return Err(countErr)
  }
  // A model value for a constant with no name to report it under: the
  // constants past the names must all be empty, as diffCheck reads them.
  for (let i = 0; i < toI32(queries.length) && i < toI32(answers.length); i++) {
    const q = queries[i]
    const a = answers[i]
    if (a.result !== "sat") {
      continue
    }
    for (let j = toI32(q.names.length); j < toI32(q.smtNames.length); j++) {
      if ((a.value(q.smtNames[j]) ?? "") !== "") {
        return Err(`diff: a query has ${q.names.length} names for ${q.smtNames.length} constants`)
      }
    }
  }
  const out: MatchedFunctionDiff[] = []
  for (let idx = 0; idx < toI32(pairs.length); idx++) {
    const oldFn = pairs[idx].oldFn
    const newFn = pairs[idx].newFn
    // The count check above puts four queries and answers at `idx * 4` for
    // every pair, so this refusal never fires; it is the prover's, which
    // cannot carry that product through the loop.
    if (idx > 536870910) {
      return Err(countErr)
    }
    const base = idx * 4
    if (!(base >= 0 && base + 3 < toI32(queries.length) && base + 3 < toI32(answers.length))) {
      return Err(countErr)
    }
    const q0 = queries[base]
    const q1 = queries[base + 1]
    const q2 = queries[base + 2]
    const q3 = queries[base + 3]
    const a0 = answers[base]
    const a1 = answers[base + 1]
    const a2 = answers[base + 2]
    const a3 = answers[base + 3]
    const m = new MatchedFunctionDiff(
      newFn.name,
      signatureOf(newFn),
      diffCheck(q0, a0),
      diffCheck(q1, a1),
      diffCheck(q2, a2),
    )
    m.sharedDomain = diffCheck(q3, a3)
    // Renames pair parameters by position; a pair with fewer old parameters
    // has no rename past the old ones (emitDiffScript gives it no queries,
    // so the count check above has already refused it).
    for (let i = 0; i < toI32(newFn.params.length) && i < toI32(oldFn.params.length); i++) {
      const oldName = oldFn.params[i].name
      const newName = newFn.params[i].name
      if (oldName !== newName) {
        m.paramRenames.push(new ParamRename(oldName, newName))
      }
    }
    const oldReq = diffPrettyRequires(oldFn)
    const newReq = diffPrettyRequires(newFn)
    const oldEns = diffPrettyEnsures(oldFn)
    const newEns = diffPrettyEnsures(newFn)
    m.requiresAdded = diffClausesMissing(newReq, oldReq)
    m.requiresRemoved = diffClausesMissing(oldReq, newReq)
    m.ensuresAdded = diffClausesMissing(newEns, oldEns)
    m.ensuresRemoved = diffClausesMissing(oldEns, newEns)
    out.push(m)
  }
  return Ok(out)
}

/** A pair equal over the reals whose float64 code still differs. */
export class Float64Diff {
  /** The function's name. */
  name: string
  /** Where and how they differ. */
  delta: Float64Delta

  /**
   * Records a float64 difference.
   *
   * @param name the function's name
   * @param delta where and how they differ
   */
  constructor(name: string, delta: Float64Delta) {
    this.name = name
    this.delta = delta
  }
}

/** Everything `vector diff` found. */
export class ProgramDiffReport {
  /** The z3 that ran, or a note that nothing was compared. */
  solver: string
  /** The old program's name. */
  oldProgramName: string
  /** The new program's name. */
  newProgramName: string
  /** A verdict per compared pair. */
  matched: MatchedFunctionDiff[]
  /** Signatures of the functions only the new version has: informational. */
  added: string[]
  /** Signatures of the functions only the old version had: breaking. */
  removed: string[]
  /** The functions whose types changed: breaking. */
  signatureChanged: SignatureChange[]
  /** The pairs equal over the reals but not in float64. */
  float64Deltas: Float64Diff[]
  /**
   * The pairs equal over the reals with a non-empty shared domain where no
   * float64 input in that domain was compared: not proven, so UNDECIDED.
   */
  float64Unsampled: string[]

  /**
   * Makes an empty report.
   *
   * @param oldProgramName the old program's name
   * @param newProgramName the new program's name
   */
  constructor(oldProgramName: string, newProgramName: string) {
    this.solver = "(no comparable functions)"
    this.oldProgramName = oldProgramName
    this.newProgramName = newProgramName
    this.matched = []
    this.added = []
    this.removed = []
    this.signatureChanged = []
    this.float64Deltas = []
    this.float64Unsampled = []
  }
}

/** What `vector diff` decided. */
export class DiffOutcome {
  /** One of the `DIFF_*` statuses. */
  status: string
  /** The validation errors, for INVALID. */
  errors: string[]
  /** What went wrong, for ERROR. */
  message: string
  /** The findings, for EQUIVALENT, DIFFERENT, UNDECIDED and MISMATCH. */
  report: ProgramDiffReport
  /** The findings as text. */
  summary: string

  /**
   * Makes an outcome with nothing filled in.
   *
   * @param status one of the `DIFF_*` statuses
   */
  constructor(status: string) {
    this.status = status
    this.errors = []
    this.message = ""
    this.report = new ProgramDiffReport("", "")
    this.summary = ""
  }
}

const diffInvalid = (errors: string[]): DiffOutcome => {
  const out = new DiffOutcome(DIFF_INVALID)
  out.errors = errors
  return out
}

const diffError = (message: string): DiffOutcome => {
  const out = new DiffOutcome(DIFF_ERROR)
  out.message = message
  return out
}

/**
 * Compares two versions of a program: shape and types, then z3 over every
 * comparable pair, then float64 over the pairs z3 found equal.
 *
 * @param oldDoc the old program's document
 * @param oldRoot the old program's JSON value
 * @param newDoc the new program's document
 * @param newRoot the new program's JSON value
 * @returns the outcome
 */
export const diffPrograms = (
  oldDoc: JsonDocument,
  oldRoot: JsonValue,
  newDoc: JsonDocument,
  newRoot: JsonValue,
): DiffOutcome => {
  const oldErrors: string[] = []
  const oldProgram = readProgram(oldDoc, oldRoot, oldErrors)
  const newErrors: string[] = []
  const newProgram = readProgram(newDoc, newRoot, newErrors)
  const shape: string[] = []
  for (const e of oldErrors) {
    shape.push(`old program: ${e}`)
  }
  for (const e of newErrors) {
    shape.push(`new program: ${e}`)
  }
  if (shape.length > 0) {
    return diffInvalid(shape)
  }
  const types: string[] = []
  for (const e of typecheckProgram(oldProgram)) {
    types.push(`old program: ${e}`)
  }
  for (const e of typecheckProgram(newProgram)) {
    types.push(`new program: ${e}`)
  }
  if (types.length > 0) {
    return diffInvalid(types)
  }

  const pairing = pairFunctions(oldProgram, newProgram)
  const report = new ProgramDiffReport(oldProgram.programName, newProgram.programName)
  if (pairing.comparable.length > 0) {
    const script = emitDiffScript(pairing.comparable, oldProgram, newProgram)
    const run = runZ3(script.text, toI32(script.queries.length))
    if (run.isErr()) {
      return diffError(run.error)
    }
    for (const line of run.value.errors) {
      if (!solveIsModelRefusal(line)) {
        return diffError(`z3 rejected the script: ${line}`)
      }
    }
    const matched = assembleDiffs(pairing.comparable, script.queries, run.value.answers)
    if (matched.isErr()) {
      return diffError(matched.error)
    }
    report.matched = matched.value
    report.solver = solverLabel()
  }
  return diffDecide(oldProgram, newProgram, pairing, report)
}

/**
 * Decides an outcome from z3's verdicts on the comparable pairs: every
 * witness is replayed first, and one that does not replay makes it MISMATCH;
 * then the pairs equal over the reals are run in float64.
 *
 * @param oldProgram the old program, typechecked
 * @param newProgram the new program, typechecked
 * @param pairing how the two versions' functions pair up
 * @param report the findings so far: `matched` and `solver` filled in
 * @returns the outcome
 */
export const diffDecide = (
  oldProgram: Program,
  newProgram: Program,
  pairing: FunctionPairing,
  report: ProgramDiffReport,
): DiffOutcome => {
  const mismatches = diffReplayWitnesses(oldProgram, newProgram, pairing.comparable, report.matched)
  // A verdict with no pair, or a shared-domain witness with a name and no
  // value, is a vector bug that assembleDiffs and diffCheck never make: it is
  // a MISMATCH, never a float64 comparison that skips it.
  let unpaired = false
  // Equal over the rationals is not equal in the emitted code: run every
  // rational-equivalent pair in float64.
  for (let i = 0; i < toI32(report.matched.length); i++) {
    const m = report.matched[i]
    if (!m.equivalent) {
      continue
    }
    if (i >= toI32(pairing.comparable.length)) {
      unpaired = true
      continue
    }
    const pair = pairing.comparable[i]
    const domain = m.sharedDomain
    const seed: string[] = []
    for (const p of pair.newFn.params) {
      const at = toI32(domain.inputs.names.indexOf(p.name))
      if (at < 0) {
        seed.push("")
      } else if (at < toI32(domain.inputs.values.length)) {
        seed.push(domain.inputs.values[at])
      } else {
        unpaired = true
        seed.push("")
      }
    }
    const delta = findFloat64Delta(oldProgram, pair.oldFn, newProgram, pair.newFn, seed)
    if (delta.found) {
      report.float64Deltas.push(new Float64Diff(m.name, delta))
    } else if (delta.compared === 0 && domain.status !== CHECK_NONE) {
      // Fail closed: equal over the reals says nothing about float64, and
      // no input both versions accept was run. Only an empty shared domain
      // (unsat) makes zero comparisons vacuous.
      report.float64Unsampled.push(m.name)
    }
  }
  for (const f of pairing.added) {
    report.added.push(signatureOf(f))
  }
  for (const f of pairing.removed) {
    report.removed.push(signatureOf(f))
  }
  report.signatureChanged = pairing.signatureChanged

  let different = report.removed.length > 0 || report.signatureChanged.length > 0 || report.float64Deltas.length > 0
  let unknown = false
  for (const m of report.matched) {
    different = different || m.any(CHECK_WITNESS)
    unknown = unknown || m.any(CHECK_UNKNOWN)
  }
  unknown = unknown || report.float64Unsampled.length > 0
  let status = DIFF_EQUIVALENT
  if (mismatches > 0 || unpaired) {
    status = DIFF_MISMATCH
  } else if (different) {
    status = DIFF_DIFFERENT
  } else if (unknown) {
    status = DIFF_UNDECIDED
  }
  const out = new DiffOutcome(status)
  out.report = report
  out.summary = renderDiffSummary(status, report)
  return out
}

const diffInputs = (cex: Counterexample): string => {
  const parts: string[] = []
  // A counterexample holds one value per name, so the second bound never stops the loop early.
  for (let i = 0; i < toI32(cex.names.length) && i < toI32(cex.values.length); i++) {
    parts.push(`${cex.names[i]} = ${cex.values[i]}`)
  }
  return parts.join(", ")
}

// The first float64 delta of the function with this name, or null.
const diffFloat64Of = (report: ProgramDiffReport, name: string): Float64Diff | null => {
  for (const d of report.float64Deltas) {
    if (d.name === name) {
      return d
    }
  }
  return null
}

const diffDomainLines = (lines: string[], c: DiffCheck, was: string, now: string, what: string): void => {
  if (c.status === CHECK_WITNESS) {
    lines.push(`     domain: ${diffInputs(c.inputs)} was ${was}, now ${now}`)
  } else if (c.status === CHECK_UNKNOWN) {
    lines.push(`     domain: ${what} check returned unknown`)
  }
}

const diffMatchedLines = (lines: string[], report: ProgramDiffReport, m: MatchedFunctionDiff): void => {
  const f = diffFloat64Of(report, m.name)
  const unsampled = report.float64Unsampled.indexOf(m.name) >= 0
  if (m.equivalent && f !== null) {
    const d = f.delta
    lines.push(` ✘ ${m.signature} — equal over the reals, but the emitted float64 code DIFFERS`)
    lines.push(`     float64: at ${diffInputs(d.inputs)} → old = ${d.oldResult}, new = ${d.newResult}`)
  } else if (m.equivalent && unsampled) {
    lines.push(` ? ${m.signature} — equal over the reals, but UNDECIDED in float64`)
    lines.push("     float64: no sampled input reached the shared domain; nothing was compared")
  } else if (diffVacuous(m)) {
    lines.push(` ✓ ${m.signature} — EQUIVALENT: no input satisfies both versions' requires`)
    lines.push("     float64: nothing to compare; this rests on both versions passing vector verify")
  } else if (m.equivalent) {
    lines.push(` ✓ ${m.signature} — EQUIVALENT for all inputs`)
  } else if (m.any(CHECK_WITNESS)) {
    lines.push(` ✘ ${m.signature} — BEHAVIOR DIFFERS`)
  } else {
    lines.push(` ? ${m.signature} — UNDECIDED (not proven equivalent)`)
  }
  const v = m.valueDiff
  if (v.status === CHECK_WITNESS) {
    lines.push(`     value:  at ${diffInputs(v.inputs)} → old = ${v.oldResult}, new = ${v.newResult}`)
  } else if (v.status === CHECK_UNKNOWN) {
    lines.push("     value:  solver returned unknown")
  }
  diffDomainLines(lines, m.domainNarrowed, "accepted", "REJECTED", "narrowing")
  diffDomainLines(lines, m.domainWidened, "rejected", "ACCEPTED", "widening")
  for (const c of [v, m.domainNarrowed, m.domainWidened]) {
    if (c.replay === REPLAY_MISMATCH) {
      lines.push(
        `     MISMATCH  z3's witness ${diffInputs(c.inputs)} does not do what z3 said when replayed (${c.replayDetail}): this is a bug in vector, not in your program — please report it`,
      )
    }
  }
  for (const r of m.paramRenames) {
    lines.push(`     note:   param renamed ${r.oldName} → ${r.newName}`)
  }
  for (const c of m.requiresAdded) {
    lines.push(`     contract: + requires ${c}`)
  }
  for (const c of m.requiresRemoved) {
    lines.push(`     contract: − requires ${c}`)
  }
  for (const c of m.ensuresAdded) {
    lines.push(`     contract: + ensures ${c}`)
  }
  for (const c of m.ensuresRemoved) {
    lines.push(`     contract: − ensures ${c}`)
  }
}

/**
 * Renders the findings as `vector diff` prints them.
 *
 * @param status the outcome's status
 * @param report the findings
 * @returns the text, without a final newline
 */
export const renderDiffSummary = (status: string, report: ProgramDiffReport): string => {
  const lines: string[] = []
  lines.push("── VECTOR DIFF ─────────────────────────────────────────")
  lines.push(` old: ${report.oldProgramName}   new: ${report.newProgramName}`)
  lines.push(` Solver: ${report.solver}`)
  lines.push(` Status: ${status}`)
  lines.push("")
  for (const m of report.matched) {
    diffMatchedLines(lines, report, m)
  }
  for (const s of report.signatureChanged) {
    lines.push(` ✘ ${s.name} — SIGNATURE CHANGED (breaking)`)
    lines.push(`     old: ${s.oldSignature}`)
    lines.push(`     new: ${s.newSignature}`)
  }
  for (const s of report.removed) {
    lines.push(` ✘ removed: ${s} (breaking for existing callers)`)
  }
  for (const s of report.added) {
    lines.push(` + added:   ${s} (cannot affect existing callers)`)
  }
  lines.push("")
  let solverUnknown = false
  let vacuous = false
  for (const m of report.matched) {
    solverUnknown = solverUnknown || m.any(CHECK_UNKNOWN)
    vacuous = vacuous || diffVacuous(m)
  }
  if (status === DIFF_MISMATCH) {
    lines.push(" A witness z3 gave does not replay exactly, so this diff cannot be")
    lines.push(" trusted: this is a bug in vector, not in your programs.")
  } else if (status === DIFF_EQUIVALENT) {
    lines.push(" Every shared function is proven equal over the reals and agreed")
    lines.push(" on every sampled float64 input; nothing to review.")
  } else if (status === DIFF_DIFFERENT) {
    lines.push(" Review each listed delta against the change you intended —")
    lines.push(" the witnesses above are the entire behavioral change.")
  } else {
    lines.push(" No difference was found, but equivalence was not proven.")
    if (report.float64Unsampled.length > 0) {
      lines.push(" - No float64 sample reached a shared domain; test inside it by hand.")
    }
    if (solverUnknown || report.float64Unsampled.length === 0) {
      lines.push(" - The solver returned unknown; restate nonlinear bodies in linear")
      lines.push("   arithmetic and re-run.")
    }
  }
  if (vacuous) {
    lines.push(" A function whose versions share no input over the reals is EQUIVALENT")
    lines.push(" with nothing run in float64: that rests on both passing vector verify.")
  }
  lines.push(" (Proven over exact rationals, then compared on sampled float64 inputs;")
  lines.push("  assumes both versions pass vector verify.)")
  return lines.join("\n")
}

const diffInputsJson = (cex: Counterexample): OutJson => {
  const out = outJsonObject()
  // A counterexample holds one value per name, so the second bound never stops the loop early.
  for (let i = 0; i < toI32(cex.names.length) && i < toI32(cex.values.length); i++) {
    out.put(cex.names[i], outJsonString(cex.values[i]))
  }
  return out
}

const diffCheckJson = (c: DiffCheck): OutJson => {
  const out = outJsonObject().put("status", outJsonString(c.status))
  if (c.status === CHECK_WITNESS) {
    const w = outJsonObject().put("inputs", diffInputsJson(c.inputs))
    if (c.hasResults) {
      w.put("oldResult", outJsonString(c.oldResult)).put("newResult", outJsonString(c.newResult))
    }
    replayJsonPut(w, c.replay, c.replayDetail)
    out.put("witness", w)
  }
  return out
}

/**
 * One matched pair's own verdict, with float64 folded in: MISMATCH for a
 * witness that did not replay, DIFFERENT for a witness or a float64 delta, UNDECIDED for an unknown check or an unsampled
 * shared domain, otherwise EQUIVALENT.
 *
 * @param report the findings the pair belongs to
 * @param m the pair
 * @returns `DIFF_MISMATCH`, `DIFF_EQUIVALENT`, `DIFF_DIFFERENT` or `DIFF_UNDECIDED`
 */
export const diffPairStatus = (report: ProgramDiffReport, m: MatchedFunctionDiff): string => {
  if (m.mismatched()) {
    return DIFF_MISMATCH
  }
  if (m.any(CHECK_WITNESS) || diffFloat64Of(report, m.name) !== null) {
    return DIFF_DIFFERENT
  }
  if (m.any(CHECK_UNKNOWN) || report.float64Unsampled.indexOf(m.name) >= 0) {
    return DIFF_UNDECIDED
  }
  return DIFF_EQUIVALENT
}

// A pair equal over the reals whose shared domain is empty: EQUIVALENT with
// no float64 input compared, which rests on both versions passing verify.
const diffVacuous = (m: MatchedFunctionDiff): boolean => m.equivalent && m.sharedDomain.status === CHECK_NONE

const diffMatchedJson = (report: ProgramDiffReport, m: MatchedFunctionDiff): OutJson => {
  const status = diffPairStatus(report, m)
  const renames = outJsonArray()
  for (const r of m.paramRenames) {
    renames.add(outJsonObject().put("oldName", outJsonString(r.oldName)).put("newName", outJsonString(r.newName)))
  }
  return outJsonObject()
    .put("name", outJsonString(m.name))
    .put("signature", outJsonString(m.signature))
    .put("paramRenames", renames)
    .put("domainNarrowed", diffCheckJson(m.domainNarrowed))
    .put("domainWidened", diffCheckJson(m.domainWidened))
    .put("valueDiff", diffCheckJson(m.valueDiff))
    .put("status", outJsonString(status))
    .put("equivalent", outJsonBool(status === DIFF_EQUIVALENT))
    .put("equivalentOverReals", outJsonBool(m.equivalent))
    .put("vacuous", outJsonBool(diffVacuous(m)))
    .put(
      "contractChanges",
      outJsonObject()
        .put("requiresAdded", outJsonStrings(m.requiresAdded))
        .put("requiresRemoved", outJsonStrings(m.requiresRemoved))
        .put("ensuresAdded", outJsonStrings(m.ensuresAdded))
        .put("ensuresRemoved", outJsonStrings(m.ensuresRemoved)),
    )
}

/**
 * The findings as JSON, in the shape `vector diff --json` prints under `report`.
 *
 * @param report the findings
 * @returns the JSON object
 */
export const diffReportJson = (report: ProgramDiffReport): OutJson => {
  const matched = outJsonArray()
  for (const m of report.matched) {
    matched.add(diffMatchedJson(report, m))
  }
  const sigs = outJsonArray()
  for (const s of report.signatureChanged) {
    sigs.add(
      outJsonObject()
        .put("name", outJsonString(s.name))
        .put("oldSignature", outJsonString(s.oldSignature))
        .put("newSignature", outJsonString(s.newSignature)),
    )
  }
  const floats = outJsonArray()
  for (const f of report.float64Deltas) {
    floats.add(
      outJsonObject()
        .put("name", outJsonString(f.name))
        .put("inputs", diffInputsJson(f.delta.inputs))
        .put("oldResult", outJsonString(f.delta.oldResult))
        .put("newResult", outJsonString(f.delta.newResult)),
    )
  }
  return outJsonObject()
    .put("solver", outJsonString(report.solver))
    .put("oldProgramName", outJsonString(report.oldProgramName))
    .put("newProgramName", outJsonString(report.newProgramName))
    .put("matched", matched)
    .put("added", outJsonStrings(report.added))
    .put("removed", outJsonStrings(report.removed))
    .put("signatureChanged", sigs)
    .put("float64Deltas", floats)
    .put("float64Unsampled", outJsonStrings(report.float64Unsampled))
}

/**
 * The outcome as `vector diff --json` prints it: `{status, report, summary}`,
 * or `{status, errors}` for INVALID, or `{status, message}` for ERROR.
 *
 * @param outcome the outcome
 * @returns the JSON object
 */
export const diffOutcomeJson = (outcome: DiffOutcome): OutJson => {
  const out = outJsonObject().put("status", outJsonString(outcome.status))
  if (outcome.status === DIFF_INVALID) {
    return out.put("errors", outJsonStrings(outcome.errors))
  }
  if (outcome.status === DIFF_ERROR) {
    return out.put("message", outJsonString(outcome.message))
  }
  return out.put("report", diffReportJson(outcome.report)).put("summary", outJsonString(outcome.summary))
}
