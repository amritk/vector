/**
 * `verify/solve/replay` — re-evaluates, without z3, each input z3 says breaks
 * a program: a counterexample to an ensures clause, an input that reaches a
 * hazard, a witness of `vector diff`. The evaluator is exact: an Int is an
 * integer and a Real a rational, each part an i64, and every step is the one
 * `verify/smt/script` emits, callee guards and short-circuit paths included.
 *
 * A replay ends one of three ways. `confirmed`: the input does what z3 said.
 * `mismatch`: it does not, so the encoding and the program disagree, which is
 * a bug in vector. `not-replayed`: the replay could not decide, because a
 * value is not one it reads, a step leaves i64, or a value depends on a
 * division by zero, which z3 leaves unspecified. Only a mismatch changes a
 * verdict.
 */

import { trim } from "nish/text"
import { Sexp, parseSexp } from "../../core/smt"
import { VOCAB_JSON_SAFE_MAX } from "../../spec/contract/vocab"
import {
  EXPR_BINOP,
  EXPR_BOOL,
  EXPR_CALL,
  EXPR_ITE,
  EXPR_NUM,
  EXPR_UNOP,
  EXPR_VAR,
  FnUnit,
  LangClause,
  LangExpr,
  Program,
  programFunctionIndex,
} from "../lang/ast"
import { RESULT_NAME } from "../lang/check"
import { prettyMath } from "../lang/pretty"
import { QUERY_DIV, QUERY_PRE, QUERY_RANGE } from "../smt/script"
import { Counterexample, VerifyReport } from "./report"

/** The input does what z3 said it does. */
export const REPLAY_CONFIRMED: string = "confirmed"
/** The replay could not decide; the verdict stands as z3 gave it. */
export const REPLAY_NOT_REPLAYED: string = "not-replayed"
/** The input does not do what z3 said: a bug in vector. */
export const REPLAY_MISMATCH: string = "mismatch"

/** A diff witness of an input the old version accepts and the new rejects. */
export const REPLAY_NARROWED: i32 = 1
/** A diff witness of an input the new version accepts and the old rejects. */
export const REPLAY_WIDENED: i32 = 2
/** A diff witness of an input both accept where the bodies differ. */
export const REPLAY_VALUE: i32 = 3

// 2^31, squared to 2^62: a literal past 2^53 cannot be written exactly.
const REPLAY_2_31: i64 = 2147483648
const REPLAY_HALF: i64 = REPLAY_2_31 * REPLAY_2_31
// Every part stays within ±(2^63−1); the one i64 outside, MIN, marks an overflow.
const REPLAY_MAX: i64 = REPLAY_HALF - 1 + REPLAY_HALF
const REPLAY_OVER: i64 = -REPLAY_MAX - 1
const REPLAY_WHY_OVERFLOW: string = "a step leaves the i64 range the replay computes in"
const REPLAY_WHY_DIV_ZERO: string = "a value depends on a division by zero, which z3 leaves unspecified"

/** What a replay found, and why. */
export class ReplayResult {
  /** `REPLAY_CONFIRMED`, `REPLAY_NOT_REPLAYED` or `REPLAY_MISMATCH`. */
  outcome: string
  /** For a mismatch, the first check that differed; for not-replayed, why; "" when confirmed. */
  detail: string

  /**
   * Makes a result.
   *
   * @param outcome the outcome
   * @param detail the detail
   */
  constructor(outcome: string, detail: string) {
    this.outcome = outcome
    this.detail = detail
  }
}

/**
 * One exact value: a boolean, a rational `num/den` in lowest terms with
 * `den > 0`, or unknown, with why.
 */
export class ReplayValue {
  /** Whether the value is known. */
  known: boolean
  /** Whether it is a boolean. */
  isBool: boolean
  /** A boolean's value. */
  truth: boolean
  /** A rational's numerator. */
  num: i64
  /** A rational's denominator, positive. */
  den: i64
  /** Why it is unknown; "" when known. */
  why: string

  /**
   * Makes an unknown value.
   *
   * @param why why it is unknown
   */
  constructor(why: string) {
    this.known = false
    this.isBool = false
    this.truth = false
    this.num = toI64(0)
    this.den = toI64(1)
    this.why = why
  }
}

const replayBool = (truth: boolean): ReplayValue => {
  const v = new ReplayValue("")
  v.known = true
  v.isBool = true
  v.truth = truth
  return v
}

const replayAbs = (a: i64): i64 => (a < toI64(0) ? -a : a)

const replayGcd = (x: i64, y: i64): i64 => {
  let a = replayAbs(x)
  let b = replayAbs(y)
  while (b !== toI64(0)) {
    const t = a % b
    a = b
    b = t
  }
  return a
}

const replayAdd64 = (a: i64, b: i64): i64 => {
  if (a === REPLAY_OVER || b === REPLAY_OVER) {
    return REPLAY_OVER
  }
  if ((b > toI64(0) && a > REPLAY_MAX - b) || (b < toI64(0) && a < -REPLAY_MAX - b)) {
    return REPLAY_OVER
  }
  return a + b
}

const replayMul64 = (a: i64, b: i64): i64 => {
  if (a === REPLAY_OVER || b === REPLAY_OVER) {
    return REPLAY_OVER
  }
  if (a === toI64(0) || b === toI64(0)) {
    return toI64(0)
  }
  if (replayAbs(b) > REPLAY_MAX / replayAbs(a)) {
    return REPLAY_OVER
  }
  return a * b
}

// num/den in lowest terms, den > 0; unknown on an overflow. den must not be 0.
const replayRational = (num: i64, den: i64): ReplayValue => {
  if (num === REPLAY_OVER || den === REPLAY_OVER) {
    return new ReplayValue(REPLAY_WHY_OVERFLOW)
  }
  const g = replayGcd(num, den)
  const v = new ReplayValue("")
  v.known = true
  v.num = den < toI64(0) ? -(num / g) : num / g
  v.den = replayAbs(den / g)
  return v
}

const replayInt = (n: i64): ReplayValue => replayRational(n, toI64(1))

// The first unknown of the two, for an operation that needs both.
const replayEither = (a: ReplayValue, b: ReplayValue): ReplayValue => (a.known ? b : a)

const replayAddR = (a: ReplayValue, b: ReplayValue): ReplayValue => {
  if (!a.known || !b.known) {
    return new ReplayValue(replayEither(a, b).why)
  }
  const g = replayGcd(a.den, b.den)
  const num = replayAdd64(replayMul64(a.num, b.den / g), replayMul64(b.num, a.den / g))
  return replayRational(num, replayMul64(a.den / g, b.den))
}

const replayNegR = (a: ReplayValue): ReplayValue => (a.known ? replayRational(-a.num, a.den) : a)

const replayMulR = (a: ReplayValue, b: ReplayValue): ReplayValue => {
  if (!a.known || !b.known) {
    return new ReplayValue(replayEither(a, b).why)
  }
  const g1 = replayGcd(a.num, b.den)
  const g2 = replayGcd(b.num, a.den)
  const n1 = g1 === toI64(0) ? a.num : a.num / g1
  const d2 = g1 === toI64(0) ? b.den : b.den / g1
  const n2 = g2 === toI64(0) ? b.num : b.num / g2
  const d1 = g2 === toI64(0) ? a.den : a.den / g2
  return replayRational(replayMul64(n1, n2), replayMul64(d1, d2))
}

const replayDivR = (a: ReplayValue, b: ReplayValue): ReplayValue => {
  if (!a.known || !b.known) {
    return new ReplayValue(replayEither(a, b).why)
  }
  if (b.num === toI64(0)) {
    return new ReplayValue(REPLAY_WHY_DIV_ZERO)
  }
  return replayMulR(a, replayRational(b.den, b.num))
}

// -1, 0 or 1 as a rational is below, at or above another; 2 when unknown.
const replayCompare = (a: ReplayValue, b: ReplayValue): i32 => {
  const l = replayMul64(a.num, b.den)
  const r = replayMul64(b.num, a.den)
  if (l === REPLAY_OVER || r === REPLAY_OVER) {
    return 2
  }
  return l < r ? -1 : l > r ? 1 : 0
}

const replayFloor = (a: ReplayValue): ReplayValue => {
  if (!a.known) {
    return a
  }
  let q = a.num / a.den
  if (a.num < toI64(0) && a.num % a.den !== toI64(0)) {
    q = q - toI64(1)
  }
  return replayInt(q)
}

const replayNot = (a: ReplayValue): ReplayValue => (a.known ? replayBool(!a.truth) : a)

// Kleene conjunction: false wins over unknown.
const replayAnd = (a: ReplayValue, b: ReplayValue): ReplayValue => {
  if ((a.known && !a.truth) || (b.known && !b.truth)) {
    return replayBool(false)
  }
  if (!a.known || !b.known) {
    return new ReplayValue(replayEither(a, b).why)
  }
  return replayBool(true)
}

const replayOr = (a: ReplayValue, b: ReplayValue): ReplayValue => replayNot(replayAnd(replayNot(a), replayNot(b)))

const replayEq = (a: ReplayValue, b: ReplayValue): ReplayValue => {
  if (!a.known || !b.known) {
    return new ReplayValue(replayEither(a, b).why)
  }
  if (a.isBool || b.isBool) {
    return replayBool(a.isBool === b.isBool && a.truth === b.truth)
  }
  return replayBool(a.num === b.num && a.den === b.den)
}

const replayRelation = (op: string, a: ReplayValue, b: ReplayValue): ReplayValue => {
  if (!a.known || !b.known) {
    return new ReplayValue(replayEither(a, b).why)
  }
  const c = replayCompare(a, b)
  if (c === 2) {
    return new ReplayValue(REPLAY_WHY_OVERFLOW)
  }
  if (op === "<") {
    return replayBool(c < 0)
  }
  if (op === "<=") {
    return replayBool(c <= 0)
  }
  if (op === ">") {
    return replayBool(c > 0)
  }
  return replayBool(c >= 0)
}

/**
 * A value as vector shows it: `true`, `-5`, `1/3`; unknown values as `?`.
 *
 * @param v the value
 * @returns its text
 */
export const replayValueText = (v: ReplayValue): string => {
  if (!v.known) {
    return "?"
  }
  if (v.isBool) {
    return v.truth ? "true" : "false"
  }
  return v.den === toI64(1) ? `${v.num}` : `${v.num}/${v.den}`
}

const replayUnreadable = (text: string): ReplayValue =>
  new ReplayValue(`the value "${text}" is not one the replay reads`)

// Digits with at most one `.` and a digit on each side of it, as a rational.
const replayDecimal = (text: string, whole: string): ReplayValue => {
  let num = toI64(0)
  let den = toI64(1)
  let dot = -1
  const n = toI32(text.length)
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i)
    if (c === 46 && dot < 0 && i > 0 && i < n - 1) {
      dot = i
    } else if (c >= 48 && c <= 57) {
      num = replayAdd64(replayMul64(num, toI64(10)), toI64(c - 48))
      if (dot >= 0) {
        den = replayMul64(den, toI64(10))
      }
    } else {
      return replayUnreadable(whole)
    }
  }
  if (n === 0) {
    return replayUnreadable(whole)
  }
  return replayRational(num, den)
}

// The rendered forms: `5`, `-5`, `1.5`, `1/3`, `-1/3`, `1/-3`.
const replayRendered = (text: string, whole: string): ReplayValue => {
  if (text.startsWith("-")) {
    const rest = text.slice(1)
    return rest.startsWith("-") ? replayUnreadable(whole) : replayNegR(replayRendered(rest, whole))
  }
  const slash = toI32(text.indexOf("/"))
  if (slash < 0) {
    return replayDecimal(text, whole)
  }
  const d = replayRendered(text.slice(slash + 1), whole)
  if (d.known && d.num === toI64(0)) {
    return replayUnreadable(whole)
  }
  return replayDivR(replayDecimal(text.slice(0, slash), whole), d)
}

// The raw forms z3 prints: `5`, `(- 5)`, `(/ 1 3)`, `(/ (- 1) 3)`, `(- (/ 1 3))`.
const replaySexp = (e: Sexp, whole: string): ReplayValue => {
  if (!e.isList) {
    return replayDecimal(e.atom, whole)
  }
  if (e.items.length === 2 && !e.items[0].isList && e.items[0].atom === "-") {
    return replayNegR(replaySexp(e.items[1], whole))
  }
  if (e.items.length === 3 && !e.items[0].isList && e.items[0].atom === "/") {
    const d = replaySexp(e.items[2], whole)
    if (d.known && d.num === toI64(0)) {
      return replayUnreadable(whole)
    }
    return replayDivR(replaySexp(e.items[1], whole), d)
  }
  return replayUnreadable(whole)
}

/**
 * Reads a model value: `true` or `false`, a number as vector renders it
 * (`5`, `-5`, `1.5`, `1/3`, `-1/3`), or as z3 prints it (`(- 5)`, `(/ 1 3)`,
 * `(/ (- 1) 3)`, `(- (/ 1 3))`). Anything else, such as a `root-obj`, and a
 * number whose parts leave i64, is unknown.
 *
 * @param text the value
 * @returns the value, unknown with why when it cannot be read
 */
export const replayParseValue = (text: string): ReplayValue => {
  const t = trim(text)
  if (t === "true" || t === "false") {
    return replayBool(t === "true")
  }
  if (t.startsWith("(")) {
    const e = parseSexp(t)
    return e === null ? replayUnreadable(t) : replaySexp(e, t)
  }
  return replayRendered(t, t)
}

/** One hazard the walk reached: the path to it, and whether its condition holds. */
class ReplayHit {
  /** Whether the hazard is reached. */
  path: ReplayValue
  /** Whether the hazard's condition holds there. */
  cond: ReplayValue
  /** What the condition is instead, for a mismatch. */
  detail: string

  /**
   * Makes a hit.
   *
   * @param path the path
   * @param cond the condition
   * @param detail what the condition is instead
   */
  constructor(path: ReplayValue, cond: ReplayValue, detail: string) {
    this.path = path
    this.cond = cond
    this.detail = detail
  }
}

/** Names bound to values; a later binding hides an earlier one. */
class ReplayScope {
  /** The names. */
  names: string[]
  /** Each name's value. */
  values: ReplayValue[]

  /** Makes an empty scope. */
  constructor() {
    this.names = []
    this.values = []
  }

  /**
   * Binds a name.
   *
   * @param name the name
   * @param value its value
   */
  bind(name: string, value: ReplayValue): void {
    this.names.push(name)
    this.values.push(value)
  }

  /**
   * Looks a name up.
   *
   * @param name the name
   * @returns its value, unknown when unbound
   */
  lookup(name: string): ReplayValue {
    for (let i = toI32(this.names.length) - 1; i >= 0; i--) {
      if (this.names[i] === name) {
        return this.values[i]
      }
    }
    return new ReplayValue(`${name} is unbound`)
  }
}

/** One walk over a program, and the hazards it reached, in the order the emitter records them. */
class ReplayCtx {
  /** The program, for calls. */
  program: Program
  /** Whether to record hazards. */
  record: boolean
  /** The divisions reached. */
  divs: ReplayHit[]
  /** The callee preconditions reached. */
  pres: ReplayHit[]
  /** The Int `+`, `-` and `*` reached. */
  ranges: ReplayHit[]
  /** ±(2^53−1), the range an Int must stay in. */
  safeMax: ReplayValue

  /**
   * Makes a walk.
   *
   * @param program the program
   * @param record whether to record hazards
   */
  constructor(program: Program, record: boolean) {
    this.program = program
    this.record = record
    this.divs = []
    this.pres = []
    this.ranges = []
    this.safeMax = replayParseValue(VOCAB_JSON_SAFE_MAX)
  }
}

const replayOutsideSafe = (ctx: ReplayCtx, v: ReplayValue): ReplayValue =>
  replayOr(replayRelation(">", v, ctx.safeMax), replayRelation("<", v, replayNegR(ctx.safeMax)))

const replayBinop = (op: string, l: ReplayValue, r: ReplayValue): ReplayValue => {
  if (op === "+") {
    return replayAddR(l, r)
  }
  if (op === "-") {
    return replayAddR(l, replayNegR(r))
  }
  if (op === "*") {
    return replayMulR(l, r)
  }
  if (op === "/") {
    return replayDivR(l, r)
  }
  if (op === "==") {
    return replayEq(l, r)
  }
  if (op === "!=") {
    return replayNot(replayEq(l, r))
  }
  if (op === "and") {
    return replayAnd(l, r)
  }
  if (op === "or") {
    return replayOr(l, r)
  }
  if (op === "implies") {
    return replayOr(replayNot(l), r)
  }
  if (op === "<" || op === "<=" || op === ">" || op === ">=") {
    return replayRelation(op, l, r)
  }
  return new ReplayValue(`the operator ${op} is not one the replay evaluates`)
}

// Mirrors `SmtEmitter.term`: the same value, the same paths, the same hazards in the same order.
const replayTerm = (ctx: ReplayCtx, e: LangExpr, scope: ReplayScope, path: ReplayValue): ReplayValue => {
  if (e.kind === EXPR_NUM) {
    return replayParseValue(e.value)
  }
  if (e.kind === EXPR_BOOL) {
    return replayBool(e.value === "true")
  }
  if (e.kind === EXPR_VAR) {
    return scope.lookup(e.name)
  }
  if (e.kind === EXPR_UNOP) {
    const a = replayTerm(ctx, e.args[0], scope, path)
    if (e.op === "not") {
      return replayNot(a)
    }
    if (e.op === "neg") {
      return replayNegR(a)
    }
    if (e.op === "abs") {
      return a.known && a.num < toI64(0) ? replayNegR(a) : a
    }
    if (e.op === "floor") {
      return replayFloor(a)
    }
    return replayNegR(replayFloor(replayNegR(a)))
  }
  if (e.kind === EXPR_BINOP) {
    const l = replayTerm(ctx, e.args[0], scope, path)
    let rightPath = path
    if (e.op === "and" || e.op === "implies") {
      rightPath = replayAnd(path, l)
    } else if (e.op === "or") {
      rightPath = replayAnd(path, replayNot(l))
    }
    const r = replayTerm(ctx, e.args[1], scope, rightPath)
    if (e.op === "/" && ctx.record) {
      ctx.divs.push(
        new ReplayHit(path, replayEq(r, replayInt(toI64(0))), `the divisor is ${replayValueText(r)}, not 0`),
      )
    }
    if (e.op === "min" || e.op === "max") {
      const c = replayRelation(e.op === "min" ? "<=" : ">=", l, r)
      return c.known ? (c.truth ? l : r) : c
    }
    const t = replayBinop(e.op, l, r)
    if (ctx.record && e.ty === "Int" && (e.op === "+" || e.op === "-" || e.op === "*")) {
      ctx.ranges.push(new ReplayHit(path, replayOutsideSafe(ctx, t), `${replayValueText(t)} is within ±(2^53−1)`))
    }
    return t
  }
  if (e.kind === EXPR_ITE) {
    const c = replayTerm(ctx, e.args[0], scope, path)
    const t = replayTerm(ctx, e.args[1], scope, replayAnd(path, c))
    const f = replayTerm(ctx, e.args[2], scope, replayAnd(path, replayNot(c)))
    return c.known ? (c.truth ? t : f) : c
  }
  if (e.kind === EXPR_CALL) {
    const at = programFunctionIndex(ctx.program, e.name)
    if (at < 0) {
      return new ReplayValue(`the function ${e.name} is unknown`)
    }
    const callee = ctx.program.functions[at]
    const inner = new ReplayScope()
    for (let i = 0; i < toI32(callee.params.length) && i < toI32(e.args.length); i++) {
      inner.bind(callee.params[i].name, replayTerm(ctx, e.args[i], scope, path))
    }
    let guarded = path
    for (const rc of callee.requires) {
      const t = replayTerm(ctx, rc.expr, inner, guarded)
      if (ctx.record) {
        ctx.pres.push(new ReplayHit(path, replayNot(t), `${callee.name}'s requires ${prettyMath(rc.expr)} holds`))
      }
      guarded = replayAnd(guarded, t)
    }
    return replayTerm(ctx, callee.body, inner, guarded)
  }
  return new ReplayValue(`the expression kind ${e.kind} is not one the replay evaluates`)
}

/** A function evaluated at one input: each requires, the body, and what stopped the binding. */
export class ReplayRun {
  /** Why the input could not be bound (a missing or unreadable value); "" when it was. */
  unbound: string
  /** A parameter outside what z3 was told about it; "" when none is. */
  outOfRange: string
  /** Each requires clause's value, in order. */
  requires: ReplayValue[]
  /** The body's value. */
  body: ReplayValue
  /** The parameters and their values, for the ensures. */
  scope: ReplayScope
  /** The walk, with the hazards it reached. */
  ctx: ReplayCtx

  /**
   * Makes an empty run.
   *
   * @param ctx the walk
   */
  constructor(ctx: ReplayCtx) {
    this.unbound = ""
    this.outOfRange = ""
    this.requires = []
    this.body = new ReplayValue("")
    this.scope = new ReplayScope()
    this.ctx = ctx
  }

  /**
   * Whether every requires holds: false when one is false, unknown when one is unknown.
   *
   * @returns the conjunction
   */
  pre(): ReplayValue {
    let all = replayBool(true)
    for (const v of this.requires) {
      all = replayAnd(all, v)
    }
    return all
  }
}

/**
 * Evaluates a function at an input, as the verification script does: each
 * requires on the path of the ones before it, then the body on the path of
 * them all, recording the hazards reached.
 *
 * @param program the program the function belongs to
 * @param fn the function
 * @param names the parameters' names, by position of `fn.params` (`values` at the same index)
 * @param values each parameter's value
 * @returns the run; `unbound` is set when a value is missing or unreadable
 */
export const replayEvaluate = (program: Program, fn: FnUnit, names: string[], values: string[]): ReplayRun => {
  const run = new ReplayRun(new ReplayCtx(program, true))
  for (let i = 0; i < toI32(fn.params.length); i++) {
    const p = fn.params[i]
    const at = i < toI32(names.length) && i < toI32(values.length) ? i : -1
    if (at < 0 || names[at] === "") {
      run.unbound = `no value for the parameter ${p.name}`
      return run
    }
    const v = replayParseValue(values[at])
    if (!v.known) {
      run.unbound = v.why
      return run
    }
    if (v.isBool !== (p.ty === "Bool") || (p.ty === "Int" && v.den !== toI64(1))) {
      run.unbound = `the value "${values[at]}" is not a ${p.ty}`
      return run
    }
    const out = replayOutsideSafe(run.ctx, v)
    if (p.ty === "Int" && run.outOfRange === "" && out.known && out.truth) {
      run.outOfRange = `the Int parameter ${p.name} = ${values[at]} is outside ±(2^53−1), the range z3 was given`
    }
    run.scope.bind(p.name, v)
  }
  let path = replayBool(true)
  for (const c of fn.requires) {
    const t = replayTerm(run.ctx, c.expr, run.scope, path)
    run.requires.push(t)
    path = replayAnd(path, t)
  }
  run.body = replayTerm(run.ctx, fn.body, run.scope, path)
  return run
}

// The counterexample's values, in `fn.params` order, by name.
const replayRunCex = (program: Program, fn: FnUnit, cex: Counterexample): ReplayRun => {
  const names: string[] = []
  const values: string[] = []
  for (const p of fn.params) {
    const at = toI32(cex.names.indexOf(p.name))
    names.push(at < 0 ? "" : p.name)
    values.push(at < 0 ? "" : cex.values[at])
  }
  return replayEvaluate(program, fn, names, values)
}

/**
 * Collects the checks of one replay: the first that is definitely wrong is
 * the mismatch, else the first undecided one makes it not-replayed.
 */
class ReplayChecks {
  /** The first check that failed; "" when none did. */
  mismatch: string
  /** Why the first undecided check was undecided; "" when none was. */
  undecided: string

  /** Makes an empty set of checks. */
  constructor() {
    this.mismatch = ""
    this.undecided = ""
  }

  /**
   * Records that `v` should be true.
   *
   * @param v the check's value
   * @param failure what to report when it is false
   */
  expect(v: ReplayValue, failure: string): void {
    if (this.mismatch !== "") {
      return
    }
    if (!v.known) {
      if (this.undecided === "") {
        this.undecided = v.why
      }
    } else if (!v.truth) {
      this.mismatch = failure
    }
  }

  /**
   * The outcome.
   *
   * @returns mismatch, else not-replayed, else confirmed
   */
  result(): ReplayResult {
    if (this.mismatch !== "") {
      return new ReplayResult(REPLAY_MISMATCH, this.mismatch)
    }
    if (this.undecided !== "") {
      return new ReplayResult(REPLAY_NOT_REPLAYED, this.undecided)
    }
    return new ReplayResult(REPLAY_CONFIRMED, "")
  }
}

// Every requires holds, and the body is z3's result when z3 gave one.
const replayExpectDomain = (checks: ReplayChecks, fn: FnUnit, run: ReplayRun, result: string): ReplayValue => {
  if (run.outOfRange !== "") {
    checks.expect(replayBool(false), run.outOfRange)
  }
  for (let i = 0; i < toI32(run.requires.length); i++) {
    checks.expect(run.requires[i], `requires ${prettyMath(fn.requires[i].expr)} is false at the counterexample`)
  }
  if (result === "?" || result === "") {
    return run.body
  }
  const given = replayParseValue(result)
  if (!given.known) {
    checks.expect(given, "")
    return run.body
  }
  checks.expect(
    replayEq(run.body, given),
    `the body returns ${replayValueText(run.body)} there, not z3's result ${result}`,
  )
  return given
}

/**
 * Replays a refuted ensures clause: confirmed when every requires holds at
 * the counterexample, the body returns z3's result there (when it gave one),
 * and the clause is false.
 *
 * @param program the program
 * @param fn the function the clause belongs to
 * @param clause the clause
 * @param cex z3's counterexample
 * @returns the outcome, with the first check that differed or why it was not replayed
 */
export const replayClause = (program: Program, fn: FnUnit, clause: LangClause, cex: Counterexample): ReplayResult => {
  const run = replayRunCex(program, fn, cex)
  if (run.unbound !== "") {
    return new ReplayResult(REPLAY_NOT_REPLAYED, run.unbound)
  }
  const checks = new ReplayChecks()
  const result = replayExpectDomain(checks, fn, run, cex.result)
  const scope = new ReplayScope()
  for (let i = 0; i < toI32(run.scope.names.length); i++) {
    scope.bind(run.scope.names[i], run.scope.values[i])
  }
  scope.bind(RESULT_NAME, result)
  const holds = replayTerm(new ReplayCtx(program, false), clause.expr, scope, replayBool(true))
  checks.expect(replayNot(holds), `${prettyMath(clause.expr)} holds there`)
  return checks.result()
}

/**
 * Replays a hazard: confirmed when the input reaches it and its condition
 * holds there, a divisor of 0, a callee's requires false, or an Int outside
 * ±(2^53−1).
 *
 * @param program the program
 * @param fn the function the hazard is in
 * @param kind `QUERY_DIV`, `QUERY_PRE` or `QUERY_RANGE`
 * @param index which hazard of that kind, in the order the script records them
 * @param cex the input z3 gave
 * @returns the outcome, with the first check that differed or why it was not replayed
 */
export const replayHazard = (
  program: Program,
  fn: FnUnit,
  kind: i32,
  index: i32,
  cex: Counterexample,
): ReplayResult => {
  const run = replayRunCex(program, fn, cex)
  if (run.unbound !== "") {
    return new ReplayResult(REPLAY_NOT_REPLAYED, run.unbound)
  }
  let hits = run.ctx.ranges
  if (kind === QUERY_DIV) {
    hits = run.ctx.divs
  } else if (kind === QUERY_PRE) {
    hits = run.ctx.pres
  } else if (kind !== QUERY_RANGE) {
    return new ReplayResult(REPLAY_MISMATCH, `hazard kind ${kind} is not one the script records`)
  }
  if (index < 0 || index >= toI32(hits.length)) {
    return new ReplayResult(REPLAY_MISMATCH, `the replay records ${hits.length} such hazard(s), not ${index + 1}`)
  }
  const checks = new ReplayChecks()
  if (run.outOfRange !== "") {
    checks.expect(replayBool(false), run.outOfRange)
  }
  const hit = hits[index]
  checks.expect(hit.path, "the input does not reach it")
  checks.expect(hit.cond, hit.detail)
  if (cex.result !== "?" && cex.result !== "") {
    const given = replayParseValue(cex.result)
    checks.expect(
      replayEq(run.body, given),
      `the body returns ${replayValueText(run.body)} there, not z3's result ${cex.result}`,
    )
  }
  return checks.result()
}

/**
 * Replays a `vector diff` witness through both versions: confirmed when a
 * narrowed witness passes every old requires and fails a new one (a widened
 * one the reverse), or when a value witness passes both and the bodies
 * return z3's two results, which differ.
 *
 * @param oldProgram the old program
 * @param oldFn the old version of the function
 * @param newProgram the new program
 * @param newFn the new version
 * @param kind `REPLAY_NARROWED`, `REPLAY_WIDENED` or `REPLAY_VALUE`
 * @param inputs the witness, by the new version's parameter names
 * @param oldResult the old result z3 gave, `?` or "" for none
 * @param newResult the new result z3 gave, `?` or "" for none
 * @returns the outcome
 */
export const replayWitness = (
  oldProgram: Program,
  oldFn: FnUnit,
  newProgram: Program,
  newFn: FnUnit,
  kind: i32,
  inputs: Counterexample,
  oldResult: string,
  newResult: string,
): ReplayResult => {
  // The versions' parameters match by position; their names may differ.
  const names: string[] = []
  const values: string[] = []
  for (const p of newFn.params) {
    const at = toI32(inputs.names.indexOf(p.name))
    names.push(at < 0 ? "" : p.name)
    values.push(at < 0 ? "" : inputs.values[at])
  }
  const was = replayEvaluate(oldProgram, oldFn, names, values)
  const now = replayEvaluate(newProgram, newFn, names, values)
  for (const run of [was, now]) {
    if (run.unbound !== "") {
      return new ReplayResult(REPLAY_NOT_REPLAYED, run.unbound)
    }
  }
  const checks = new ReplayChecks()
  if (kind === REPLAY_NARROWED) {
    checks.expect(was.pre(), "the old version rejects the witness")
    checks.expect(replayNot(now.pre()), "the new version accepts the witness")
    return checks.result()
  }
  if (kind === REPLAY_WIDENED) {
    checks.expect(now.pre(), "the new version rejects the witness")
    checks.expect(replayNot(was.pre()), "the old version accepts the witness")
    return checks.result()
  }
  checks.expect(was.pre(), "the old version rejects the witness")
  checks.expect(now.pre(), "the new version rejects the witness")
  let oldValue = was.body
  let newValue = now.body
  if (oldResult !== "?" && oldResult !== "") {
    oldValue = replayParseValue(oldResult)
    checks.expect(replayEq(was.body, oldValue), `the old body returns ${replayValueText(was.body)}, not ${oldResult}`)
  }
  if (newResult !== "?" && newResult !== "") {
    newValue = replayParseValue(newResult)
    checks.expect(replayEq(now.body, newValue), `the new body returns ${replayValueText(now.body)}, not ${newResult}`)
  }
  checks.expect(replayNot(replayEq(oldValue, newValue)), `both versions return ${replayValueText(was.body)} there`)
  return checks.result()
}

/**
 * Replays every counterexample in a report, filling in each clause's and
 * hazard's `replay` and `replayDetail`, and the report's `mismatchCount`.
 *
 * @param program the program the report is about
 * @param report the report, as `solveProgram` returned it
 * @returns how many replays were a mismatch
 */
export const replayReport = (program: Program, report: VerifyReport): i32 => {
  let mismatches = 0
  for (let i = 0; i < toI32(report.functions.length) && i < toI32(program.functions.length); i++) {
    const fn = program.functions[i]
    const fr = report.functions[i]
    for (const v of fr.ensures) {
      if (v.hasCex && v.clauseIndex >= 0 && v.clauseIndex < toI32(fn.ensures.length)) {
        const r = replayClause(program, fn, fn.ensures[v.clauseIndex], v.cex)
        v.replay = r.outcome
        v.replayDetail = r.detail
        mismatches = mismatches + (r.outcome === REPLAY_MISMATCH ? 1 : 0)
      }
    }
    for (const hs of [fr.divs, fr.pres, fr.ranges]) {
      for (const h of hs) {
        if (h.hasCex) {
          const r = replayHazard(program, fn, h.kind, h.index, h.cex)
          h.replay = r.outcome
          h.replayDetail = r.detail
          mismatches = mismatches + (r.outcome === REPLAY_MISMATCH ? 1 : 0)
        }
      }
    }
  }
  report.mismatchCount = mismatches
  return mismatches
}
