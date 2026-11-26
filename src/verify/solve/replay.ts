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
import { OutJson, outJsonString } from "../emit/outjson"
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
  LangParam,
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

/**
 * Puts a counterexample's or witness's replay on its `--json` object:
 * `replay` when it was replayed, and beside a `not-replayed` or `mismatch`
 * one `replayDetail`, why. A `confirmed` one has no detail.
 *
 * @param obj the counterexample or witness object
 * @param outcome the replay's outcome, "" when it was not replayed
 * @param detail the replay's detail
 * @returns `obj`
 */
export const replayJsonPut = (obj: OutJson, outcome: string, detail: string): OutJson => {
  if (outcome !== "") {
    obj.put("replay", outJsonString(outcome))
  }
  if (outcome === REPLAY_NOT_REPLAYED || outcome === REPLAY_MISMATCH) {
    obj.put("replayDetail", outJsonString(detail))
  }
  return obj
}

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

// The magnitude of an i64, exact for every one: |REPLAY_OVER| is 2^63.
const replayMag = (a: i64): u64 => (a < 0 ? toU64(0) - toU64(a) : toU64(a))

// -a, wrapping: REPLAY_OVER, the one i64 with no negation, stays itself.
const replayNeg = (a: i64): i64 => toI64(toU64(0) - toU64(a))

// |a|, wrapping like replayNeg.
const replayAbs = (a: i64): i64 => toI64(replayMag(a))

// a / g for a gcd g. A gcd is never negative, and 0 only when both of its
// operands are, where replayMulR has always kept a undivided.
const replayQuot = (a: i64, g: i64): i64 => (g > 0 ? a / g : a)

const replayGcd = (x: i64, y: i64): i64 => {
  let a = replayMag(x)
  let b = replayMag(y)
  while (b !== toU64(0)) {
    const t = a % b
    a = b
    b = t
  }
  return toI64(a)
}

const replayAdd64 = (a: i64, b: i64): i64 => {
  if (a === REPLAY_OVER || b === REPLAY_OVER) {
    return REPLAY_OVER
  }
  // The wrapped sum is the sum unless the signs agree and it does not; a
  // sum of REPLAY_OVER (below -REPLAY_MAX) is the mark itself.
  const s = toI64(toU64(a) + toU64(b))
  if (a < 0 === b < 0 && s < 0 !== a < 0) {
    return REPLAY_OVER
  }
  return s
}

const replayMul64 = (a: i64, b: i64): i64 => {
  if (a === REPLAY_OVER || b === REPLAY_OVER) {
    return REPLAY_OVER
  }
  const ma = replayMag(a)
  const mb = replayMag(b)
  if (ma === toU64(0) || mb === toU64(0)) {
    return toI64(0)
  }
  // |a|·|b| > REPLAY_MAX, as |b| > REPLAY_MAX / |a|.
  if (mb > toU64(REPLAY_MAX) / ma) {
    return REPLAY_OVER
  }
  const p = ma * mb
  return a < 0 === b < 0 ? toI64(p) : toI64(toU64(0) - p)
}

// num/den in lowest terms, den > 0; unknown on an overflow. den must not be 0.
const replayRational = (num: i64, den: i64): ReplayValue => {
  if (num === REPLAY_OVER || den === REPLAY_OVER) {
    return new ReplayValue(REPLAY_WHY_OVERFLOW)
  }
  const g = replayGcd(num, den)
  // Unreachable: every caller passes a nonzero den, so g divides |den| ≥ 1.
  if (g < 1) {
    return new ReplayValue(REPLAY_WHY_DIV_ZERO)
  }
  const v = new ReplayValue("")
  v.known = true
  const n = num / g
  v.num = den < 0 ? replayNeg(n) : n
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
  const num = replayAdd64(replayMul64(a.num, replayQuot(b.den, g)), replayMul64(b.num, replayQuot(a.den, g)))
  return replayRational(num, replayMul64(replayQuot(a.den, g), b.den))
}

const replayNegR = (a: ReplayValue): ReplayValue => (a.known ? replayRational(replayNeg(a.num), a.den) : a)

const replayMulR = (a: ReplayValue, b: ReplayValue): ReplayValue => {
  if (!a.known || !b.known) {
    return new ReplayValue(replayEither(a, b).why)
  }
  const g1 = replayGcd(a.num, b.den)
  const g2 = replayGcd(b.num, a.den)
  const n1 = replayQuot(a.num, g1)
  const d2 = replayQuot(b.den, g1)
  const n2 = replayQuot(b.num, g2)
  const d1 = replayQuot(a.den, g2)
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
  const n = a.num
  const d = a.den
  // Unreachable: a known value's den is at least 1 (replayRational, replayBool).
  if (d < 1) {
    return new ReplayValue(REPLAY_WHY_DIV_ZERO)
  }
  const q = n / d
  return replayInt(n < 0 && n % d !== 0 ? replayAdd64(q, -1) : q)
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
  // A leading `-` means a nonempty text; the length is for the prover.
  if (text.length > 0 && text.startsWith("-")) {
    const rest = text.slice(1)
    return rest.startsWith("-") ? replayUnreadable(whole) : replayNegR(replayRendered(rest, whole))
  }
  const slash = toI32(text.indexOf("/"))
  // A slash indexOf finds is before the end; the bound is for the prover.
  if (slash < 0 || slash >= toI32(text.length)) {
    return replayDecimal(text, whole)
  }
  const under = text.slice(slash + 1)
  // One fraction bar: `1/3/4` is not a rendered value.
  if (under.indexOf("/") >= 0) {
    return replayUnreadable(whole)
  }
  const d = replayRendered(under, whole)
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

/** A name bound to a value. */
class ReplayBinding {
  /** The name. */
  name: string
  /** Its value. */
  value: ReplayValue

  /**
   * Makes a binding.
   *
   * @param name the name
   * @param value its value
   */
  constructor(name: string, value: ReplayValue) {
    this.name = name
    this.value = value
  }
}

/** Names bound to values; a later binding hides an earlier one. */
class ReplayScope {
  /** The bindings, in the order they were made. */
  bindings: ReplayBinding[]

  /** Makes an empty scope. */
  constructor() {
    this.bindings = []
  }

  /**
   * Binds a name.
   *
   * @param name the name
   * @param value its value
   */
  bind(name: string, value: ReplayValue): void {
    this.bindings.push(new ReplayBinding(name, value))
  }

  /**
   * Looks a name up.
   *
   * @param name the name
   * @returns its value, unknown when unbound
   */
  lookup(name: string): ReplayValue {
    for (let i = toI32(this.bindings.length) - 1; i >= 0; i--) {
      const b = this.bindings[i]
      if (b.name === name) {
        return b.value
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
  /** The function whose body is being walked, to name a division by zero in it. */
  fn: string
  /** Which version of the program this is, `old` or `new` for `vector diff`; "" for `verify`. */
  version: string

  /**
   * Makes a walk.
   *
   * @param program the program
   * @param record whether to record hazards
   * @param fn the function the walk starts in
   * @param version `old` or `new` for `vector diff`, else ""
   */
  constructor(program: Program, record: boolean, fn: string, version: string) {
    this.program = program
    this.record = record
    this.fn = fn
    this.version = version
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

// Names the division a value depends on: z3 leaves `x / 0` unspecified, so
// the replay cannot know it, and the detail says which division to look at.
const replayWhyDivZero = (ctx: ReplayCtx, e: LangExpr): string => {
  const where = ctx.version === "" ? ctx.fn : `the ${ctx.version} version of ${ctx.fn}`
  return `a value depends on the division by zero ${prettyMath(e)} in ${where}, which z3 leaves unspecified`
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
  const args = e.args
  const arity = e.kind === EXPR_UNOP ? 1 : e.kind === EXPR_BINOP ? 2 : e.kind === EXPR_ITE ? 3 : 0
  if (toI32(args.length) < arity) {
    return new ReplayValue(`the expression has ${args.length} operand(s), not the ${arity} its kind takes`)
  }
  if (e.kind === EXPR_UNOP && toI32(args.length) >= 1) {
    const a = replayTerm(ctx, args[0], scope, path)
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
  if (e.kind === EXPR_BINOP && toI32(args.length) >= 2) {
    const right = args[1]
    const l = replayTerm(ctx, args[0], scope, path)
    let rightPath = path
    if (e.op === "and" || e.op === "implies") {
      rightPath = replayAnd(path, l)
    } else if (e.op === "or") {
      rightPath = replayAnd(path, replayNot(l))
    }
    const r = replayTerm(ctx, right, scope, rightPath)
    if (e.op === "/" && ctx.record) {
      ctx.divs.push(
        new ReplayHit(path, replayEq(r, replayInt(toI64(0))), `the divisor is ${replayValueText(r)}, not 0`),
      )
    }
    if (e.op === "/" && l.known && r.known && r.num === toI64(0)) {
      return new ReplayValue(replayWhyDivZero(ctx, e))
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
  if (e.kind === EXPR_ITE && toI32(args.length) >= 3) {
    const then = args[1]
    const other = args[2]
    const c = replayTerm(ctx, args[0], scope, path)
    const t = replayTerm(ctx, then, scope, replayAnd(path, c))
    const f = replayTerm(ctx, other, scope, replayAnd(path, replayNot(c)))
    return c.known ? (c.truth ? t : f) : c
  }
  if (e.kind === EXPR_CALL) {
    const fns = ctx.program.functions
    const at = programFunctionIndex(ctx.program, e.name)
    // programFunctionIndex is -1 or an index into fns; the bound is for the prover.
    if (at < 0 || at >= toI32(fns.length)) {
      return new ReplayValue(`the function ${e.name} is unknown`)
    }
    const callee = fns[at]
    const params = callee.params
    if (params.length !== args.length) {
      return new ReplayValue(`the call to ${e.name} has ${args.length} argument(s), not ${params.length}`)
    }
    const inner = new ReplayScope()
    // The lengths are equal; the second bound is for the prover.
    for (let i = 0; i < toI32(params.length) && i < toI32(args.length); i++) {
      inner.bind(params[i].name, replayTerm(ctx, args[i], scope, path))
    }
    const caller = ctx.fn
    ctx.fn = callee.name
    let guarded = path
    for (const rc of callee.requires) {
      const t = replayTerm(ctx, rc.expr, inner, guarded)
      if (ctx.record) {
        ctx.pres.push(new ReplayHit(path, replayNot(t), `${callee.name}'s requires ${prettyMath(rc.expr)} holds`))
      }
      guarded = replayAnd(guarded, t)
    }
    const out = replayTerm(ctx, callee.body, inner, guarded)
    ctx.fn = caller
    return out
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
export const replayEvaluate = (program: Program, fn: FnUnit, names: string[], values: string[]): ReplayRun =>
  replayEvaluateVersion(program, fn, names, values, "")

// `replayEvaluate` for one version of a `vector diff`, which a division by zero names.
const replayEvaluateVersion = (
  program: Program,
  fn: FnUnit,
  names: string[],
  values: string[],
  version: string,
): ReplayRun => {
  const run = new ReplayRun(new ReplayCtx(program, true, fn.name, version))
  for (let i = 0; i < toI32(fn.params.length); i++) {
    const p = fn.params[i]
    if (i >= toI32(names.length) || i >= toI32(values.length) || names[i] === "") {
      run.unbound = `no value for the parameter ${p.name}`
      return run
    }
    const value = values[i]
    const v = replayParseValue(value)
    if (!v.known) {
      run.unbound = v.why
      return run
    }
    if (v.isBool !== (p.ty === "Bool") || (p.ty === "Int" && v.den !== toI64(1))) {
      run.unbound = `the value "${value}" is not a ${p.ty}`
      return run
    }
    const out = replayOutsideSafe(run.ctx, v)
    if (p.ty === "Int" && run.outOfRange === "" && out.known && out.truth) {
      run.outOfRange = `the Int parameter ${p.name} = ${value} is outside ±(2^53−1), the range z3 was given`
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
  const why = replayByName(fn.params, cex, names, values)
  if (why !== "") {
    const run = new ReplayRun(new ReplayCtx(program, true, fn.name, ""))
    run.unbound = why
    return run
  }
  return replayEvaluate(program, fn, names, values)
}

// Fills names and values with an input's values in params order, by name,
// "" for a parameter it lacks; why it cannot, "" when it can.
const replayByName = (params: LangParam[], input: Counterexample, names: string[], values: string[]): string => {
  const given = input.values
  if (input.names.length !== given.length) {
    return `the input has ${input.names.length} name(s) and ${given.length} value(s)`
  }
  for (const p of params) {
    const at = toI32(input.names.indexOf(p.name))
    // With the lengths equal, an index of a name is one of a value; the bound is for the prover.
    if (at >= 0 && at < toI32(given.length)) {
      const value = given[at]
      names.push(p.name)
      values.push(value)
    } else {
      names.push("")
      values.push("")
    }
  }
  return ""
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
  const values = run.requires
  const clauses = fn.requires
  if (values.length !== clauses.length) {
    checks.expect(replayBool(false), `the replay has ${values.length} requires value(s) for ${clauses.length} clause(s)`)
  }
  // The second bound is for the prover: unequal lengths are a mismatch above.
  for (let i = 0; i < toI32(values.length) && i < toI32(clauses.length); i++) {
    checks.expect(values[i], `requires ${prettyMath(clauses[i].expr)} is false at the counterexample`)
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
  for (const b of run.scope.bindings) {
    scope.bind(b.name, b.value)
  }
  scope.bind(RESULT_NAME, result)
  const holds = replayTerm(new ReplayCtx(program, false, fn.name, ""), clause.expr, scope, replayBool(true))
  checks.expect(replayNot(holds), `${prettyMath(clause.expr)} holds there`)
  return checks.result()
}

/**
 * Replays a hazard: confirmed when the input reaches it and its condition
 * holds there, a divisor of 0, a callee's requires false, or an Int outside
 * ±(2^53−1). z3's result is compared with the body only when the body is
 * known there.
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
    return new ReplayResult(REPLAY_MISMATCH, `the replay records ${hits.length} such hazard(s), not ${toI64(index) + toI64(1)}`)
  }
  const checks = new ReplayChecks()
  if (run.outOfRange !== "") {
    checks.expect(replayBool(false), run.outOfRange)
  }
  const hit = hits[index]
  checks.expect(hit.path, "the input does not reach it")
  checks.expect(hit.cond, hit.detail)
  // A hazard is confirmed by its condition. The body is compared only when
  // the replay knows it: a division by zero leaves it unspecified, and that
  // does not undo the hazard.
  if (run.body.known && cex.result !== "?" && cex.result !== "") {
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
  const why = replayByName(newFn.params, inputs, names, values)
  if (why !== "") {
    return new ReplayResult(REPLAY_NOT_REPLAYED, why)
  }
  const was = replayEvaluateVersion(oldProgram, oldFn, names, values, "old")
  const now = replayEvaluateVersion(newProgram, newFn, names, values, "new")
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
  // Wider than the count it becomes: no report holds 2^31 replays.
  let mismatches = toU64(0)
  for (let i = 0; i < toI32(report.functions.length) && i < toI32(program.functions.length); i++) {
    const fn = program.functions[i]
    const fr = report.functions[i]
    const clauses = fn.ensures
    for (const v of fr.ensures) {
      const at = v.clauseIndex
      if (v.hasCex && at >= 0 && at < toI32(clauses.length)) {
        const r = replayClause(program, fn, clauses[at], v.cex)
        v.replay = r.outcome
        v.replayDetail = r.detail
        mismatches = mismatches + toU64(r.outcome === REPLAY_MISMATCH ? 1 : 0)
      }
    }
    for (const hs of [fr.divs, fr.pres, fr.ranges]) {
      for (const h of hs) {
        if (h.hasCex) {
          const r = replayHazard(program, fn, h.kind, h.index, h.cex)
          h.replay = r.outcome
          h.replayDetail = r.detail
          mismatches = mismatches + toU64(r.outcome === REPLAY_MISMATCH ? 1 : 0)
        }
      }
    }
  }
  report.mismatchCount = toI32(mismatches)
  return toI32(mismatches)
}
