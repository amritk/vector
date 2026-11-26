/**
 * `verify/emit/float64` — the float64 gate. The proof is over exact rationals,
 * the emitted code runs float64, and the two differ: `(x + 0.1) + 0.2 == x +
 * 0.3` is a theorem over the reals and false in float64 at x = 0. z3 cannot
 * see that gap, so this module interprets a program exactly as its emitted
 * TypeScript would evaluate it — f64 arithmetic, lazy connectives, each
 * callee's domain and requires guards — over boundary, dense and random
 * inputs that satisfy the preconditions, and reports every proven clause that
 * comes out false. It also compares two versions of a function bit for bit,
 * for `vector diff`.
 *
 * Sampling is deterministic: a fixed-seed xorshift generator, so a run is
 * reproducible.
 */

import { split } from "nish/text"
import {
  EXPR_BINOP,
  EXPR_BOOL,
  EXPR_CALL,
  EXPR_ITE,
  EXPR_NUM,
  EXPR_UNOP,
  EXPR_VAR,
  FnUnit,
  LangExpr,
  LangParam,
  Program,
  programFunctionIndex,
} from "../lang/ast"
import { RESULT_NAME } from "../lang/check"
import { prettyMath } from "../lang/pretty"
import { CLAUSE_PROVEN, ConformanceIssue, Counterexample, VerifyReport } from "../solve/report"

const F64_MAX_SAMPLES: i32 = 2000

/** One runtime value: a boolean, or a float64 number. */
export class F64Val {
  /** Whether this is a boolean. */
  isBool: boolean
  /** The boolean, when `isBool`. */
  b: boolean
  /** The number, when not `isBool`. */
  n: f64

  /**
   * Makes a value; `f64Num` and `f64Bool` are the usual way.
   *
   * @param isBool whether it is a boolean
   * @param b the boolean
   * @param n the number
   */
  constructor(isBool: boolean, b: boolean, n: f64) {
    this.isBool = isBool
    this.b = b
    this.n = n
  }
}

const f64Zero = (): f64 => parseFloat("0")

const f64Num = (n: f64): F64Val => new F64Val(false, false, n)

const f64Bool = (b: boolean): F64Val => new F64Val(true, b, f64Zero())

/** Bindings from names to values: one call's parameters, plus `result` in an ensures. */
export class F64Env {
  /** The bound names. */
  names: string[]
  /** Each name's value, at the same index. */
  vals: F64Val[]

  /** Makes an empty environment. */
  constructor() {
    this.names = []
    this.vals = []
  }

  /**
   * Binds a name, or rebinds it when it is already bound.
   *
   * @param name the name
   * @param v its value
   */
  set(name: string, v: F64Val): void {
    // `set` and `copy` keep `vals` as long as `names`; the second bound is for
    // the prover, and for an environment whose fields were pushed by hand.
    for (let i = 0; i < toI32(this.names.length) && i < toI32(this.vals.length); i++) {
      if (this.names[i] === name) {
        this.vals[i] = v
        return
      }
    }
    this.names.push(name)
    this.vals.push(v)
  }

  /**
   * Binds a number.
   *
   * @param name the name
   * @param n the number
   */
  setNum(name: string, n: f64): void {
    this.set(name, f64Num(n))
  }

  /**
   * Binds a boolean.
   *
   * @param name the name
   * @param b the boolean
   */
  setBool(name: string, b: boolean): void {
    this.set(name, f64Bool(b))
  }

  /**
   * Looks a name up.
   *
   * @param name the name
   * @returns its index, or -1 when unbound
   */
  find(name: string): i32 {
    for (let i = 0; i < toI32(this.names.length); i++) {
      if (this.names[i] === name) {
        return i
      }
    }
    return -1
  }

  /**
   * Copies the environment; values are shared, since none is ever mutated.
   *
   * @returns the copy
   */
  copy(): F64Env {
    const out = new F64Env()
    // As in `set`: the second bound ends the loop early only on fields pushed
    // by hand, where the copy keeps the pairs that have both halves.
    for (let i = 0; i < toI32(this.names.length) && i < toI32(this.vals.length); i++) {
      const v = this.vals[i]
      out.names.push(this.names[i])
      out.vals.push(v)
    }
    return out
  }
}

// What one evaluation did besides return a value: whether it threw, and when
// a callee's guard was what threw, which guard.
class F64Ctx {
  program: Program
  threw: boolean
  guard: boolean
  guardCallee: string
  guardPretty: string

  constructor(program: Program) {
    this.program = program
    this.threw = false
    this.guard = false
    this.guardCallee = ""
    this.guardPretty = ""
  }

  reset(): void {
    this.threw = false
    this.guard = false
    this.guardCallee = ""
    this.guardPretty = ""
  }

  fail(): F64Val {
    this.threw = true
    return f64Bool(false)
  }

  failGuard(callee: string, pretty: string): F64Val {
    this.threw = true
    this.guard = true
    this.guardCallee = callee
    this.guardPretty = pretty
    return f64Bool(false)
  }
}

// biome-ignore lint/suspicious/noSelfCompare: Nish has no Number.isFinite; x - x is NaN only for NaN and ±Infinity.
const f64IsFinite = (x: f64): boolean => x - x === x - x

// biome-ignore lint/suspicious/noSelfCompare: Nish has no Number.isNaN; NaN is the only value unequal to itself.
const f64IsNaN = (x: f64): boolean => x !== x

const f64IsNegZero = (x: f64): boolean => x === f64Zero() && parseFloat("1") / x < f64Zero()

// JS Math.min: NaN wins, and -0 is below +0.
const f64Min = (l: f64, r: f64): f64 => {
  if (f64IsNaN(l)) {
    return l
  }
  if (f64IsNaN(r)) {
    return r
  }
  if (l < r) {
    return l
  }
  if (r < l) {
    return r
  }
  return f64IsNegZero(l) ? l : r
}

// JS Math.max: NaN wins, and +0 is above -0.
const f64Max = (l: f64, r: f64): f64 => {
  if (f64IsNaN(l)) {
    return l
  }
  if (f64IsNaN(r)) {
    return r
  }
  if (l > r) {
    return l
  }
  if (r > l) {
    return r
  }
  return f64IsNegZero(l) ? r : l
}

// JS Math.abs, which maps -0 to +0.
const f64Abs = (x: f64): f64 => {
  if (x < f64Zero()) {
    return -x
  }
  if (x === f64Zero()) {
    return f64Zero()
  }
  return x
}

// JS Math.round: half rounds up.
const f64Round = (x: f64): f64 => {
  if (!f64IsFinite(x)) {
    return x
  }
  return Math.floor(x + parseFloat("0.5"))
}

const f64IsSafeInteger = (x: f64): boolean =>
  f64IsFinite(x) && Math.floor(x) === x && f64Abs(x) <= parseFloat("9007199254740991")

// The emitted code's domain guard: a Real is finite and an Int a safe integer.
// Returns the guard broken, or "".
const f64DomainViolation = (params: LangParam[], env: F64Env): string => {
  for (const p of params) {
    const at = env.find(p.name)
    // A name with no value at its index (fields pushed by hand) is unbound.
    if (at < 0 || at >= toI32(env.vals.length)) {
      return `${p.name} is bound`
    }
    const v = env.vals[at]
    if (p.ty === "Real" && (v.isBool || !f64IsFinite(v.n))) {
      return `${p.name} is a finite number`
    }
    if (p.ty === "Int" && (v.isBool || !f64IsSafeInteger(v.n))) {
      return `${p.name} is a safe integer`
    }
    if (p.ty === "Bool" && !v.isBool) {
      return `${p.name} is a boolean`
    }
  }
  return ""
}

// Evaluates an expression the way the emitted JS would. A throw sets
// `ctx.threw`, and the value returned with it means nothing.
const f64Eval = (ctx: F64Ctx, e: LangExpr, env: F64Env): F64Val => {
  if (e.kind === EXPR_NUM) {
    return f64Num(parseFloat(e.value))
  }
  if (e.kind === EXPR_BOOL) {
    return f64Bool(e.value === "true")
  }
  if (e.kind === EXPR_VAR) {
    const at = env.find(e.name)
    if (at < 0 || at >= toI32(env.vals.length)) {
      return ctx.fail()
    }
    return env.vals[at]
  }
  // The typechecker gives every operator its operands; an expression built
  // short of them throws here, as a missing name does.
  if (e.kind === EXPR_UNOP) {
    if (toI32(e.args.length) < 1) {
      return ctx.fail()
    }
    const a = f64Eval(ctx, e.args[0], env)
    if (ctx.threw) {
      return a
    }
    if (e.op === "not") {
      return f64Bool(!a.b)
    }
    if (e.op === "neg") {
      return f64Num(-a.n)
    }
    if (e.op === "abs") {
      return f64Num(f64Abs(a.n))
    }
    if (e.op === "floor") {
      return f64Num(Math.floor(a.n))
    }
    return f64Num(Math.ceil(a.n))
  }
  if (e.kind === EXPR_BINOP) {
    if (toI32(e.args.length) < 2) {
      return ctx.fail()
    }
    const left = e.args[0]
    const right = e.args[1]
    // The connectives are lazy, like the emitted && / || / !a || b: a callee
    // guard in the right operand must not fire where the code short-circuits.
    if (e.op === "and" || e.op === "or" || e.op === "implies") {
      const l = f64Eval(ctx, left, env)
      if (ctx.threw) {
        return l
      }
      if (e.op === "and" && !l.b) {
        return f64Bool(false)
      }
      if (e.op === "or" && l.b) {
        return f64Bool(true)
      }
      if (e.op === "implies" && !l.b) {
        return f64Bool(true)
      }
      return f64Eval(ctx, right, env)
    }
    const l = f64Eval(ctx, left, env)
    if (ctx.threw) {
      return l
    }
    const r = f64Eval(ctx, right, env)
    if (ctx.threw) {
      return r
    }
    if (e.op === "+") {
      return f64Num(l.n + r.n)
    }
    if (e.op === "-") {
      return f64Num(l.n - r.n)
    }
    if (e.op === "*") {
      return f64Num(l.n * r.n)
    }
    if (e.op === "/") {
      return f64Num(l.n / r.n)
    }
    if (e.op === "min") {
      return f64Num(f64Min(l.n, r.n))
    }
    if (e.op === "max") {
      return f64Num(f64Max(l.n, r.n))
    }
    if (e.op === "<") {
      return f64Bool(l.n < r.n)
    }
    if (e.op === "<=") {
      return f64Bool(l.n <= r.n)
    }
    if (e.op === ">") {
      return f64Bool(l.n > r.n)
    }
    if (e.op === ">=") {
      return f64Bool(l.n >= r.n)
    }
    const same = l.isBool ? l.b === r.b : l.n === r.n
    if (e.op === "==") {
      return f64Bool(same)
    }
    return f64Bool(!same)
  }
  if (e.kind === EXPR_ITE) {
    if (toI32(e.args.length) < 3) {
      return ctx.fail()
    }
    const then = e.args[1]
    const otherwise = e.args[2]
    const c = f64Eval(ctx, e.args[0], env)
    if (ctx.threw) {
      return c
    }
    return f64Eval(ctx, c.b ? then : otherwise, env)
  }
  if (e.kind === EXPR_CALL) {
    const at = programFunctionIndex(ctx.program, e.name)
    // programFunctionIndex answers -1 or an index below the length.
    if (at < 0 || at >= toI32(ctx.program.functions.length)) {
      return ctx.fail()
    }
    const callee = ctx.program.functions[at]
    const inner = new F64Env()
    for (let i = 0; i < toI32(callee.params.length) && i < toI32(e.args.length); i++) {
      const name = callee.params[i].name
      const v = f64Eval(ctx, e.args[i], env)
      if (ctx.threw) {
        return v
      }
      inner.set(name, v)
    }
    // The emitted callee runs its domain guards first, then its requires, and
    // throws on either: a float64 argument that overflowed, rounded or left
    // the safe-integer range is a throw the real-valued proof never saw.
    const fault = f64DomainViolation(callee.params, inner)
    if (fault !== "") {
      return ctx.failGuard(callee.name, fault)
    }
    for (const rc of callee.requires) {
      const ok = f64Eval(ctx, rc.expr, inner)
      if (ctx.threw) {
        return ok
      }
      if (!ok.b) {
        return ctx.failGuard(callee.name, prettyMath(rc.expr))
      }
    }
    return f64Eval(ctx, callee.body, inner)
  }
  return ctx.fail()
}

/**
 * Renders a value the way JS `String(v)` does.
 *
 * @param v the value
 * @returns its text
 */
export const f64Render = (v: F64Val): string => {
  if (v.isBool) {
    return v.b ? "true" : "false"
  }
  return `${v.n}`
}

/**
 * What a function's emitted TypeScript does on an input, per the interpreter:
 * `throws` when a domain guard, a requires or a callee's guard rejects it,
 * else the value it returns, rendered as JS `String` would.
 *
 * @param program the program the function belongs to
 * @param fn the function
 * @param env its arguments, by parameter name
 * @returns `throws`, or the rendered result
 */
export const float64Outcome = (program: Program, fn: FnUnit, env: F64Env): string => {
  if (f64DomainViolation(fn.params, env) !== "") {
    return "throws"
  }
  const ctx = new F64Ctx(program)
  for (const c of fn.requires) {
    const ok = f64Eval(ctx, c.expr, env)
    if (ctx.threw || !ok.b) {
      return "throws"
    }
  }
  const v = f64Eval(ctx, fn.body, env)
  if (ctx.threw) {
    return "throws"
  }
  return f64Render(v)
}

// A deterministic xorshift32 generator, so the samples, and so the gate's
// verdict, are the same on every run.
class F64Rng {
  state: i32

  constructor(seed: i32) {
    this.state = seed === 0 ? 1 : seed
  }

  next(): f64 {
    let x = this.state
    x = x ^ (x << 13)
    x = x ^ (x >>> 17)
    x = x ^ (x << 5)
    this.state = x
    return toF64(x >>> 8) / parseFloat("16777216")
  }

  // An index below `n`. `next()` is below 1, so the product reaches `n` only
  // by rounding, and then the last index is taken; the subtraction is in f64,
  // where it cannot overflow.
  pick(n: i32): i32 {
    const top = toF64(n)
    const at = Math.floor(this.next() * top)
    return toI32(at >= top ? top - parseFloat("1") : at)
  }
}

const f64List = (texts: string): f64[] => {
  const out: f64[] = []
  for (const text of split(texts, " ")) {
    if (text.length > 0) {
      out.push(parseFloat(text))
    }
  }
  return out
}

// Boundary reals across the whole float64 range: a proof over unbounded reals
// breaks on overflow near 1e308 and on precision loss past 2^53.
const f64RealPool = (): f64[] =>
  f64List(
    "0 1 -1 2 -2 0.5 -0.5 0.1 0.2 0.3 0.7 3 -3 10 -10 100 -100 0.25 1.5 0.01 1e6 -1e6 1e15 " +
      "9007199254740992 -9007199254740992 1e300 -1e300 1e308 -1e308 5e-324 1e-300 1.7976931348623157e308",
  )

// Both sides of the safe-integer edge: ±(2^53 - 1) passes the Int guard, ±2^53 does not.
const f64IntPool = (): f64[] =>
  f64List(
    "0 1 -1 2 -2 3 -3 5 -5 7 10 -10 100 42 9007199254740991 -9007199254740991 9007199254740992 -9007199254740992 1e15",
  )

// A random magnitude from about 1e-320 to 1e308 with a random sign: the
// exponent is uniform, so every order of magnitude is reachable.
const f64RandomMagnitude = (rand: F64Rng): f64 => {
  const exp = f64Round((rand.next() * parseFloat("2") - parseFloat("1")) * parseFloat("320"))
  const mantissa = parseFloat("1") + rand.next() * parseFloat("9")
  const sign = rand.next() < parseFloat("0.5") ? parseFloat("-1") : parseFloat("1")
  // biome-ignore lint/style/useExponentiationOperator: Nish has no `**`.
  return sign * mantissa * Math.pow(parseFloat("10"), exp)
}

// A parameter's boundary pool: true then false, or the Int or Real pool.
const f64Pool = (p: LangParam, real: f64[], ints: f64[]): F64Val[] => {
  const out: F64Val[] = []
  if (p.ty === "Bool") {
    out.push(f64Bool(true))
    out.push(f64Bool(false))
    return out
  }
  for (const x of p.ty === "Int" ? ints : real) {
    out.push(f64Num(x))
  }
  return out
}

const f64Samples = (params: LangParam[], rand: F64Rng): F64Env[] => {
  const real = f64RealPool()
  const ints = f64IntPool()
  const pools: F64Val[][] = []
  // The product is counted in f64, where it is exact this far and cannot
  // overflow.
  let product = parseFloat("1")
  for (const p of params) {
    const pool = f64Pool(p, real, ints)
    pools.push(pool)
    product = product * toF64(pool.length)
  }
  // The full product of the pools when it is small enough, the first
  // parameter varying fastest; else random picks.
  let out: F64Env[] = []
  if (product <= toF64(F64_MAX_SAMPLES)) {
    out.push(new F64Env())
    // `pools` holds one pool per parameter, so the second bound never ends
    // the loop early; it is there for the prover.
    for (let k = 0; k < toI32(params.length) && k < toI32(pools.length); k++) {
      const name = params[k].name
      const grown: F64Env[] = []
      for (const v of pools[k]) {
        for (const env of out) {
          const next = env.copy()
          next.set(name, v)
          grown.push(next)
        }
      }
      out = grown
    }
  } else {
    for (let i = 0; i < F64_MAX_SAMPLES; i++) {
      const env = new F64Env()
      // As above, one pool per parameter.
      for (let k = 0; k < toI32(params.length) && k < toI32(pools.length); k++) {
        const name = params[k].name
        const pool = pools[k]
        const at = rand.pick(toI32(pool.length))
        // No pool is empty, and `pick` answers an index below its length.
        if (at >= 0 && at < toI32(pool.length)) {
          env.set(name, pool[at])
        }
      }
      out.push(env)
    }
  }
  // Random draws across the whole magnitude range, to escape the pools.
  for (let i = 0; i < 400; i++) {
    const env = new F64Env()
    for (const p of params) {
      if (p.ty === "Bool") {
        env.setBool(p.name, rand.next() < parseFloat("0.5"))
      } else {
        const v = f64RandomMagnitude(rand)
        env.setNum(p.name, p.ty === "Int" ? f64Round(v) : v)
      }
    }
    out.push(env)
  }
  return out
}

/**
 * The first sampling wave over a function's parameters: the product of the
 * boundary pools (or 2000 random picks from them when the product is larger),
 * then 400 random magnitudes. Deterministic.
 *
 * @param fn the function
 * @returns one environment per sample
 */
export const float64Samples = (fn: FnUnit): F64Env[] => f64Samples(fn.params, new F64Rng(1))

const f64Literals = (e: LangExpr, out: f64[]): void => {
  if (e.kind === EXPR_NUM) {
    out.push(parseFloat(e.value))
  }
  for (const a of e.args) {
    f64Literals(a, out)
  }
}

const f64ContainsCall = (e: LangExpr): boolean => {
  if (e.kind === EXPR_CALL) {
    return true
  }
  for (const a of e.args) {
    if (f64ContainsCall(a)) {
      return true
    }
  }
  return false
}

const f64Sort = (xs: f64[]): f64[] => {
  const n = toI32(xs.length)
  if (n <= 1) {
    return xs
  }
  const mid = n >> 1
  const firstHalf: f64[] = []
  const secondHalf: f64[] = []
  for (const x of xs) {
    if (toI32(firstHalf.length) < mid) {
      firstHalf.push(x)
    } else {
      secondHalf.push(x)
    }
  }
  const left = f64Sort(firstHalf)
  const right = f64Sort(secondHalf)
  const out: f64[] = []
  let i = 0
  let j = 0
  while (i < toI32(left.length) && j < toI32(right.length)) {
    if (right[j] < left[i]) {
      out.push(right[j])
      j = j + 1
    } else {
      out.push(left[i])
      i = i + 1
    }
  }
  while (i < toI32(left.length)) {
    out.push(left[i])
    i = i + 1
  }
  while (j < toI32(right.length)) {
    out.push(right[j])
    j = j + 1
  }
  return out
}

// Sorted, finite, without duplicates (+0 and -0 count as one).
const f64Unique = (xs: f64[]): f64[] => {
  const finite: f64[] = []
  for (const x of xs) {
    if (f64IsFinite(x)) {
      finite.push(x)
    }
  }
  const sorted = f64Sort(finite)
  const out: f64[] = []
  let has = false
  let last = f64Zero()
  for (const x of sorted) {
    if (!has || last !== x) {
      out.push(x)
      last = x
      has = true
    }
  }
  return out
}

// Candidate values for one numeric parameter, aimed at the region the
// function's constants and the solver's witness describe: each literal and its
// negation, points between adjacent literals (so a window like 3.1 < x < 3.2
// is entered), short decimals, where float64 bites ordinary code hardest
// (0.58 * 100 is 57.99999999999999), and short decimals around the witness.
const f64DenseValues = (literals: f64[], hasSeed: boolean, seed: f64, rand: F64Rng): f64[] => {
  const one = parseFloat("1")
  const raw: f64[] = [f64Zero()]
  for (const x of literals) {
    raw.push(x)
    raw.push(-x)
  }
  const anchors = f64Unique(raw)
  const eps = parseFloat("2.220446049250313e-16")
  const steps = f64List("0 0.01 -0.01 1 -1 0.5 -0.5")
  const out: f64[] = []
  for (const a of anchors) {
    for (const d of steps) {
      out.push(a + d)
    }
    out.push(a * (one + eps))
    out.push(a * (one - eps))
    out.push(a / parseFloat("2"))
    out.push(a * parseFloat("2"))
  }
  // Each adjacent pair of anchors, `lo` the one before `hi`.
  let hasLo = false
  let lo = f64Zero()
  for (const hi of anchors) {
    if (hasLo) {
      for (let k = 1; k < 16; k++) {
        out.push(lo + ((hi - lo) * toF64(k)) / parseFloat("16"))
      }
    }
    lo = hi
    hasLo = true
  }
  for (let k = -1000; k <= 1000; k++) {
    out.push(toF64(k) / parseFloat("100"))
  }
  for (let k = -100; k <= 100; k++) {
    out.push(toF64(k) / parseFloat("1000"))
  }
  if (hasSeed) {
    const base = f64Round(seed * parseFloat("100")) / parseFloat("100")
    for (let k = -200; k <= 200; k++) {
      out.push(base + toF64(k) / parseFloat("100"))
    }
    out.push(seed)
  }
  // Two-decimal values across a wide range, like prices and amounts.
  for (let i = 0; i < 300; i++) {
    out.push(f64Round((rand.next() * parseFloat("2") - one) * parseFloat("1e8")) / parseFloat("100"))
  }
  return f64Unique(out)
}

// The second sampling wave: each numeric parameter swept over its dense values
// while the others hold at a known-valid base, then random combinations of
// dense values. Produced one environment at a time.
class F64Dense {
  params: LangParam[]
  bases: F64Env[]
  dense: f64[][]
  rand: F64Rng
  base: i32
  param: i32
  val: i32
  combos: i32

  constructor(params: LangParam[], literals: f64[], bases: F64Env[], seed: F64Env, rand: F64Rng) {
    this.params = params
    this.bases = bases
    this.dense = []
    this.rand = rand
    for (const p of params) {
      if (p.ty === "Bool") {
        const none: f64[] = []
        this.dense.push(none)
      } else {
        const at = seed.find(p.name)
        let hasSeed = false
        let seedN = f64Zero()
        // A name with no value at its index (fields pushed by hand) is no seed.
        if (at >= 0 && at < toI32(seed.vals.length)) {
          const v = seed.vals[at]
          hasSeed = !v.isBool
          seedN = hasSeed ? v.n : f64Zero()
        }
        let vals = f64DenseValues(literals, hasSeed, seedN, rand)
        if (p.ty === "Int") {
          const rounded: f64[] = []
          for (const x of vals) {
            rounded.push(f64Round(x))
          }
          vals = f64Unique(rounded)
        }
        this.dense.push(vals)
      }
    }
    this.base = 0
    this.param = 0
    this.val = 0
    this.combos = params.length > 1 ? 2000 : 0
  }

  // `base`, `param` and `val` only count up from 0, and the constructor
  // pushes one `dense` list per parameter: the `< 0` and `dense.length`
  // bounds below never decide anything; they are there for the prover.
  next(): F64Env | null {
    const bases = this.bases
    const params = this.params
    let b = this.base
    while (b >= 0 && b < toI32(bases.length)) {
      const k = this.param
      const j = this.val
      if (k < 0 || k >= toI32(params.length) || k >= toI32(this.dense.length)) {
        b = b + 1
        this.base = b
        this.param = 0
        this.val = 0
      } else {
        const vals = this.dense[k]
        if (j < 0 || j >= toI32(vals.length)) {
          this.param = k + 1
          this.val = 0
        } else {
          const name = params[k].name
          const x = vals[j]
          const env = bases[b].copy()
          env.setNum(name, x)
          this.val = j + 1
          return env
        }
      }
    }
    const left = this.combos
    if (left > 0) {
      this.combos = left - 1
      const env = new F64Env()
      for (let i = 0; i < toI32(this.params.length) && i < toI32(this.dense.length); i++) {
        const p = this.params[i]
        const vals = this.dense[i]
        if (p.ty === "Bool") {
          env.setBool(p.name, this.rand.next() < parseFloat("0.5"))
        } else if (vals.length > 0) {
          const at = this.rand.pick(toI32(vals.length))
          // `pick` answers an index below the length it is given.
          if (at >= 0 && at < toI32(vals.length)) {
            env.setNum(p.name, vals[at])
          }
        }
      }
      return env
    }
    return null
  }
}

const f64IsDigits = (s: string, allowDot: boolean): boolean => {
  if (s.length === 0) {
    return false
  }
  // A second dot refuses the text, as a non-digit does.
  let dotted = false
  for (let i = 0; i < toI32(s.length); i++) {
    const inner = i > 0 && i + 1 < toI32(s.length)
    const c = s.charCodeAt(i)
    if (c === 46 && allowDot && inner) {
      if (dotted) {
        return false
      }
      dotted = true
    } else if (c < 48 || c > 57) {
      return false
    }
  }
  return true
}

/**
 * Reads a model value as vector renders it, `3`, `-1.5` or `-7/2`, to the
 * nearest double.
 *
 * @param text the rendered value
 * @returns the number, or NaN when the text is not such a numeral or is not finite
 */
export const float64ParseModel = (text: string): f64 => {
  const nan = f64Zero() / f64Zero()
  const neg = text.startsWith("-")
  let body = text
  // A text that starts with "-" has a first character to drop.
  if (neg && text.length > 0) {
    body = text.slice(1)
  }
  // `num/den`; a second slash is in no numeral.
  const parts = split(body, "/")
  let num = body
  let den = "1"
  if (toI32(parts.length) > 2) {
    return nan
  }
  if (toI32(parts.length) === 2) {
    num = parts[0]
    den = parts[1]
  }
  if (!f64IsDigits(num, true) || !f64IsDigits(den, true)) {
    return nan
  }
  let v = parseFloat(num) / parseFloat(den)
  if (neg) {
    v = -v
  }
  return f64IsFinite(v) ? v : nan
}

const f64Input = (params: LangParam[], env: F64Env, result: string): Counterexample => {
  const out = new Counterexample(result)
  for (const p of params) {
    const at = env.find(p.name)
    out.names.push(p.name)
    if (at >= 0 && at < toI32(env.vals.length)) {
      out.values.push(f64Render(env.vals[at]))
    } else {
      out.values.push("?")
    }
  }
  return out
}

// One function's conformance check: the proven clauses still pending, the
// guards already reported, and how many samples landed inside the requires.
class F64Check {
  program: Program
  fn: FnUnit
  pending: string[]
  bodyHasCalls: boolean
  seenGuards: string[]
  inRegion: boolean
  bases: F64Env[]
  issues: ConformanceIssue[]

  constructor(program: Program, fn: FnUnit, pending: string[], issues: ConformanceIssue[]) {
    this.program = program
    this.fn = fn
    this.pending = pending
    this.bodyHasCalls = f64ContainsCall(fn.body)
    this.seenGuards = []
    this.inRegion = false
    this.bases = []
    this.issues = issues
  }

  // Returns false once every proven clause has a witness and there is nothing
  // left to learn.
  check(env: F64Env): boolean {
    if (f64DomainViolation(this.fn.params, env) !== "") {
      return true
    }
    const ctx = new F64Ctx(this.program)
    for (const c of this.fn.requires) {
      const ok = f64Eval(ctx, c.expr, env)
      if (ctx.threw || !ok.b) {
        return true
      }
    }
    this.inRegion = true
    if (this.bases.length < 3) {
      this.bases.push(env)
    }
    // Inside the requires the proof promises the body completes, so a callee
    // guard firing here is a throw the contract does not allow.
    const result = f64Eval(ctx, this.fn.body, env)
    if (ctx.threw) {
      if (ctx.guard) {
        const key = `${ctx.guardCallee}|${ctx.guardPretty}`
        if (this.seenGuards.indexOf(key) < 0) {
          this.seenGuards.push(key)
          this.issues.push(
            new ConformanceIssue(
              this.fn.name,
              "callee-guard",
              `(calls ${ctx.guardCallee})`,
              ctx.guardPretty,
              f64Input(this.fn.params, env, `(throws — ${ctx.guardCallee} requires ${ctx.guardPretty})`),
            ),
          )
        }
      }
      return true
    }
    const ensuresEnv = env.copy()
    ensuresEnv.set(RESULT_NAME, result)
    for (const clause of this.fn.ensures) {
      const at = toI32(this.pending.indexOf(clause.axiomId))
      if (at >= 0) {
        ctx.reset()
        const holds = f64Eval(ctx, clause.expr, ensuresEnv)
        if (ctx.threw || !holds.b) {
          this.issues.push(
            new ConformanceIssue(
              this.fn.name,
              "postcondition",
              clause.axiomId,
              prettyMath(clause.expr),
              f64Input(this.fn.params, env, f64Render(result)),
            ),
          )
          const rest: string[] = []
          for (let k = 0; k < toI32(this.pending.length); k++) {
            if (k !== at) {
              rest.push(this.pending[k])
            }
          }
          this.pending = rest
          break
        }
      }
    }
    return !(this.pending.length === 0 && !this.bodyHasCalls)
  }
}

const f64NoEnvs = (): F64Env[] => {
  const out: F64Env[] = []
  return out
}

/**
 * Checks every proven guarantee of every function against float64 execution:
 * each proven, non-trivial ensures must still come out true, and the body must
 * finish, since a callee guard tripped by rounding is a throw the proof said
 * could not happen. Sampling starts at the solver's witness, then the pools,
 * then a dense sweep around the function's constants. A function whose
 * requires no float64 sample satisfied is reported too: the gate tested
 * nothing there, so it fails closed. Call it only on a report the solver
 * proved clean.
 *
 * @param program the typechecked program
 * @param report the solver's report on it
 * @returns the issues found, in function order
 */
export const checkConformance = (program: Program, report: VerifyReport): ConformanceIssue[] => {
  const issues: ConformanceIssue[] = []
  const rand = new F64Rng(-1640531527)
  for (let fi = 0; fi < toI32(program.functions.length) && fi < toI32(report.functions.length); fi++) {
    const fn = program.functions[fi]
    const fr = report.functions[fi]
    const pending: string[] = []
    for (const v of fr.ensures) {
      if (v.status === CLAUSE_PROVEN && !v.trivial && pending.indexOf(v.axiomId) < 0) {
        pending.push(v.axiomId)
      }
    }
    const checker = new F64Check(program, fn, pending, issues)
    if (pending.length === 0 && !checker.bodyHasCalls) {
      continue
    }
    // The seed: the solver's in-region witness, rounded to float64. Only a
    // starting point, since a witness on an open boundary can round outside.
    const seed = new F64Env()
    let seedComplete = fr.witness.names.length > 0
    for (const p of fn.params) {
      const at = toI32(fr.witness.names.indexOf(p.name))
      let raw = ""
      // A witness short of values (a bug in vector) gives no seed, as a
      // missing name does.
      if (at >= 0 && at < toI32(fr.witness.values.length)) {
        raw = fr.witness.values[at]
      }
      if (p.ty === "Bool") {
        seed.setBool(p.name, raw === "true")
      } else {
        const x = float64ParseModel(raw)
        if (!f64IsNaN(x)) {
          seed.setNum(p.name, p.ty === "Int" ? f64Round(x) : x)
        } else {
          seedComplete = false
        }
      }
    }
    let going = true
    if (seedComplete) {
      going = checker.check(seed)
    }
    if (going) {
      const samples = f64Samples(fn.params, rand)
      for (const env of samples) {
        going = checker.check(env)
        if (!going) {
          break
        }
      }
    }
    if (going) {
      const bases = f64NoEnvs()
      if (seedComplete) {
        bases.push(seed)
      }
      for (const b of checker.bases) {
        if (!(seedComplete && b === seed)) {
          bases.push(b)
        }
      }
      const literals: f64[] = []
      for (const c of fn.requires) {
        f64Literals(c.expr, literals)
      }
      for (const c of fn.ensures) {
        f64Literals(c.expr, literals)
      }
      f64Literals(fn.body, literals)
      const dense = new F64Dense(fn.params, literals, bases, seed, rand)
      let env = dense.next()
      while (env !== null && going) {
        going = checker.check(env)
        env = dense.next()
      }
    }
    if (!checker.inRegion) {
      const parts: string[] = []
      for (const c of fn.requires) {
        parts.push(prettyMath(c.expr))
      }
      issues.push(
        new ConformanceIssue(
          fn.name,
          "unsampled",
          "(requires)",
          parts.join(" ∧ "),
          new Counterexample("(no float64 input satisfied the preconditions)"),
        ),
      )
    }
  }
  return issues
}

/** An input where two versions of a function behave differently in float64. */
export class Float64Delta {
  /** Whether a difference was found; the other fields mean nothing otherwise. */
  found: boolean
  /** The input, by the old version's parameter names. */
  inputs: Counterexample
  /** What the old version returns or throws. */
  oldResult: string
  /** What the new version returns or throws. */
  newResult: string
  /**
   * How many inputs both versions accepted and were run on. Zero with `found`
   * false means float64 equivalence was not checked at all.
   */
  compared: i32

  /** Makes an empty delta, `found` false. */
  constructor() {
    this.found = false
    this.inputs = new Counterexample("")
    this.oldResult = ""
    this.newResult = ""
    this.compared = 0
  }
}

// One side of a float64 comparison: skipped (an input outside the domain or
// an evaluation fault), a value, or a guard's throw with its reason.
class F64Side {
  skip: boolean
  ok: boolean
  value: F64Val
  why: string

  constructor(skip: boolean, ok: boolean, value: F64Val, why: string) {
    this.skip = skip
    this.ok = ok
    this.value = value
    this.why = why
  }

  render(): string {
    return this.ok ? f64Render(this.value) : this.why
  }
}

const f64Run = (program: Program, fn: FnUnit, env: F64Env): F64Side => {
  const none = f64Bool(false)
  if (f64DomainViolation(fn.params, env) !== "") {
    return new F64Side(true, false, none, "")
  }
  const ctx = new F64Ctx(program)
  // The emitted code throws a RangeError where a requires is false, so a
  // guard that differs in float64 is a difference in behaviour.
  for (const c of fn.requires) {
    const ok = f64Eval(ctx, c.expr, env)
    if (ctx.threw && ctx.guard) {
      // A callee in the requires throws, so the emitted guard throws too.
      return new F64Side(
        false,
        false,
        none,
        `(throws — guard violated: ${ctx.guardCallee} requires ${ctx.guardPretty})`,
      )
    }
    if (ctx.threw) {
      return new F64Side(true, false, none, "")
    }
    if (!ok.b) {
      return new F64Side(false, false, none, `(throws — requires violated [${c.axiomId}])`)
    }
  }
  const v = f64Eval(ctx, fn.body, env)
  if (ctx.threw) {
    if (ctx.guard) {
      return new F64Side(
        false,
        false,
        none,
        `(throws — guard violated: ${ctx.guardCallee} requires ${ctx.guardPretty})`,
      )
    }
    return new F64Side(true, false, none, "")
  }
  return new F64Side(false, true, v, "")
}

// Object.is: NaN equals NaN, and -0 differs from +0. So `-x` and `0 - x` differ
// at x = 0 (-0 against +0): deliberate, since `1 / r` and `Object.is` tell the
// two apart in the emitted code.
const f64SameValue = (a: F64Val, b: F64Val): boolean => {
  if (a.isBool || b.isBool) {
    return a.isBool === b.isBool && a.b === b.b
  }
  if (f64IsNaN(a.n) || f64IsNaN(b.n)) {
    return f64IsNaN(a.n) && f64IsNaN(b.n)
  }
  return f64ToBits(a.n) === f64ToBits(b.n)
}

class F64Compare {
  oldProgram: Program
  oldFn: FnUnit
  newProgram: Program
  newFn: FnUnit
  bases: F64Env[]

  constructor(oldProgram: Program, oldFn: FnUnit, newProgram: Program, newFn: FnUnit) {
    this.oldProgram = oldProgram
    this.oldFn = oldFn
    this.newProgram = newProgram
    this.newFn = newFn
    this.bases = []
  }

  compare(env: F64Env, out: Float64Delta): boolean {
    const newEnv = new F64Env()
    for (let i = 0; i < toI32(this.oldFn.params.length) && i < toI32(this.newFn.params.length); i++) {
      const name = this.newFn.params[i].name
      const at = env.find(this.oldFn.params[i].name)
      if (at >= 0 && at < toI32(env.vals.length)) {
        newEnv.set(name, env.vals[at])
      }
    }
    const a = f64Run(this.oldProgram, this.oldFn, env)
    const b = f64Run(this.newProgram, this.newFn, newEnv)
    // Only inputs both versions take: domain changes are the solver's job.
    if (a.skip || b.skip || (!a.ok && !b.ok)) {
      return false
    }
    // A sample count stays far below the i32 range; the cap is for the
    // prover.
    const compared = out.compared
    if (compared < 0x7fffffff) {
      out.compared = compared + 1
    }
    if (this.bases.length < 3) {
      this.bases.push(env)
    }
    const same = a.ok && b.ok ? f64SameValue(a.value, b.value) : a.ok === b.ok
    if (same) {
      return false
    }
    out.found = true
    out.inputs = f64Input(this.oldFn.params, env, "")
    out.oldResult = a.render()
    out.newResult = b.render()
    return true
  }
}

/**
 * Runs two versions of a function side by side in float64, as their emitted
 * TypeScript would, and finds the first sampled input where the results are
 * not bit-identical, or where one throws and the other does not. Equivalence
 * over the rationals says nothing about this: `x * 1.1 + 0.2` and `x * 1.1 +
 * 0.1 + 0.1` are one real function and two float64 functions. Parameters pair
 * by position. The seed, a solver model of both requires, starts the dense
 * sweep inside a domain too narrow for random samples to reach.
 *
 * @param oldProgram the program before
 * @param oldFn the function before
 * @param newProgram the program after
 * @param newFn the function after
 * @param seed model values by parameter position (`3`, `-7/2`); empty for none
 * @returns the delta; `found` is false when no sample told them apart, and
 *   `compared` says how many in-domain samples were run
 */
export const findFloat64Delta = (
  oldProgram: Program,
  oldFn: FnUnit,
  newProgram: Program,
  newFn: FnUnit,
  seed: string[],
): Float64Delta => {
  const out = new Float64Delta()
  const rand = new F64Rng(-2048144789)
  const cmp = new F64Compare(oldProgram, oldFn, newProgram, newFn)
  const seedEnv = new F64Env()
  for (let i = 0; i < toI32(oldFn.params.length) && i < toI32(seed.length); i++) {
    const p = oldFn.params[i]
    if (p.ty === "Bool") {
      seedEnv.setBool(p.name, seed[i] === "true")
    } else {
      const x = float64ParseModel(seed[i])
      if (!f64IsNaN(x)) {
        seedEnv.setNum(p.name, p.ty === "Int" ? f64Round(x) : x)
      }
    }
  }
  const seeded = f64DomainViolation(oldFn.params, seedEnv) === ""
  if (seeded && cmp.compare(seedEnv, out)) {
    return out
  }
  const samples = f64Samples(oldFn.params, rand)
  for (const env of samples) {
    if (cmp.compare(env, out)) {
      return out
    }
  }
  // Dense around both versions' constants: a guard moved to 0.3 is tested at
  // 0.3 even though only the new version mentions it.
  const literals: f64[] = []
  for (const c of oldFn.requires) {
    f64Literals(c.expr, literals)
  }
  for (const c of newFn.requires) {
    f64Literals(c.expr, literals)
  }
  for (const c of oldFn.ensures) {
    f64Literals(c.expr, literals)
  }
  for (const c of newFn.ensures) {
    f64Literals(c.expr, literals)
  }
  f64Literals(oldFn.body, literals)
  f64Literals(newFn.body, literals)
  // The seed is a base even when its rounding fell outside the domain: the
  // sweep moves one parameter at a time and can step back in.
  const bases = f64NoEnvs()
  if (seeded) {
    bases.push(seedEnv)
  }
  for (const b of cmp.bases) {
    if (!(seeded && b === seedEnv)) {
      bases.push(b)
    }
  }
  const dense = new F64Dense(oldFn.params, literals, bases, seedEnv, rand)
  let env = dense.next()
  while (env !== null) {
    if (cmp.compare(env, out)) {
      return out
    }
    env = dense.next()
  }
  return out
}
