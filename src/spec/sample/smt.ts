/**
 * `spec/sample/smt` — the integer skeleton of a property, which Z3 searches
 * for boundary inputs. Each integer variable is `v_<name>` and each bytes or
 * string variable's length `len_<name>`; `where` and the integer comparisons
 * of `assert` are written over them where every part is integer arithmetic.
 *
 * Every integer type but i32 is a bit-vector of its width, with `bvadd`,
 * `bvsub` and `bvmul`, signed or unsigned comparisons and a zero-guarded
 * remainder, so the solver wraps as the generated test does. An i32 shares
 * Int with the lengths it is compared to, and Int does not wrap: there a
 * boundary is only a candidate, and Int unsat says nothing about an i32
 * domain whose arithmetic may wrap (sampleWrapsOnInt). Either way the
 * evaluator decides whether an input is in the domain.
 */

import { replaceAll } from "nish/text"
import { Expr, ExprKind, ForallVar, LitKind } from "../contract/types"
import { vocabIntMax, vocabIntMin, vocabIsIntType } from "../contract/vocab"
import { sampleIntLess, sampleIntSigned, sampleIntWidth, sampleIntWrap, sampleParseInt } from "./ints"

/** The script's preamble: models on, a timeout below the run's own, every logic. */
const SAMPLE_PREAMBLE: string = "(set-option :produce-models true)\n(set-option :timeout 55000)\n(set-logic ALL)\n"

/** The six comparison operators. */
const SAMPLE_COMPARISONS: string = " < <= > >= == != "

/** A comparison's edge: the exact difference of its sides, and the offsets -1, 0 and 1 in its sort. */
export class SampleEdge {
  /** `(- left right)`, or the bit-vector difference widened so it cannot wrap. */
  diff: string
  /** -1, 0 and 1 as literals of the difference's sort. */
  offsets: string[]
  /**
   * Makes an edge.
   *
   * @param diff the difference
   * @param offsets -1, 0 and 1 in its sort
   */
  constructor(diff: string, offsets: string[]) {
    this.diff = diff
    this.offsets = offsets
  }
}

/** One Z3 query: an extra assertion, and the SMT names it pins. */
export class SampleQuery {
  /** The assertion added for this query; "" for none. */
  extra: string
  /** The SMT names the query is about; the rest of its model is incidental. */
  pins: string[]
  /**
   * Makes a query.
   *
   * @param extra its assertion, or ""
   * @param pins the names it pins
   */
  constructor(extra: string, pins: string[]) {
    this.extra = extra
    this.pins = pins
  }
}

/**
 * A variable's SMT name: `v_<name>` for an integer, `len_<name>` for the
 * length of bytes or a string.
 *
 * @param v the variable
 * @returns its name in the script
 */
export const sampleSmtName = (v: ForallVar): string => (vocabIsIntType(v.type) ? `v_${v.name}` : `len_${v.name}`)

/** The variable named `name`, or null. */
const sampleVar = (vars: ForallVar[], name: string): ForallVar | null => {
  const i = vars.findIndex((v: ForallVar): boolean => v.name === name)
  return i < 0 ? null : vars[i]
}

/**
 * An integer as an SMT literal: `(- 5)` for -5.
 *
 * @param x the integer
 * @returns its literal
 */
export const sampleSmtInt = (x: i64): string => (x < toI64(0) ? `(- ${`${x}`.substring(1)})` : `${x}`)

/**
 * Whether an integer type is a bit-vector in the skeleton: every one but
 * i32, which shares Int with the lengths.
 *
 * @param ty the type
 * @returns true for i8..i64 but i32, and u8..u64
 */
export const sampleIsBv = (ty: string): boolean => vocabIsIntType(ty) && ty !== "i32"

/**
 * A bit-vector literal: `x` modulo 2^w.
 *
 * @param x the value, held as an i64
 * @param w the width, at most 64
 * @returns `(_ bv<n> <w>)`
 */
export const sampleBvLit = (x: i64, w: i32): string => {
  const one: u64 = 1
  const bits = w >= 64 ? toU64(x) : toU64(x) & ((one << toU64(w)) - one)
  return `(_ bv${bits} ${w})`
}

/**
 * A value of a type as a literal of its sort in the skeleton: a bit-vector
 * for every integer type but i32, an Int otherwise.
 *
 * @param x the value
 * @param ty its type
 * @returns its literal
 */
export const sampleSmtLit = (x: i64, ty: string): string =>
  sampleIsBv(ty) ? sampleBvLit(x, sampleIntWidth(ty)) : sampleSmtIntOf(x, ty)

/**
 * The SMT sort of a variable.
 *
 * @param v the variable
 * @returns `(_ BitVec <w>)` for a bit-vector type, else `Int`
 */
export const sampleSort = (v: ForallVar): string =>
  sampleIsBv(v.type) ? `(_ BitVec ${sampleIntWidth(v.type)})` : "Int"

/** The value of a run of digits in base 2 or 16, or Err past 64 bits. */
const sampleModelBits = (digits: string, base: i32): Result<u64, string> => {
  let x: u64 = 0
  const per: u64 = base === 16 ? 4 : 1
  if (toU64(digits.length) * per > toU64(64) || digits.length === 0) {
    return Err(`not a model value: ${digits}`)
  }
  for (let i = 0; i < digits.length; i++) {
    const c = digits.charCodeAt(i)
    let d = -1
    if (c >= 48 && c <= 57) {
      d = c - 48
    } else if (c >= 97 && c <= 102) {
      d = c - 87
    } else if (c >= 65 && c <= 70) {
      d = c - 55
    }
    if (d < 0 || d >= base) {
      return Err(`not a model value: ${digits}`)
    }
    x = (x << per) | toU64(d)
  }
  return Ok(x)
}

/**
 * A model's value of a variable as the i64 that holds it: `#x..` and `#b..`
 * bit-vectors read back into their type (two's complement for `iN`), Ints as
 * decimal, `(- 5)` included.
 *
 * @param raw the value z3 printed
 * @param ty the variable's type; a length's is any non-integer type
 * @returns `Ok` with the value, or `Err` when it cannot be read
 */
export const sampleModelInt = (raw: string, ty: string): Result<i64, string> => {
  if (raw.startsWith("#x") || raw.startsWith("#b")) {
    const bits = sampleModelBits(raw.substring(2), raw.startsWith("#x") ? 16 : 2).orReturn()
    return Ok(vocabIsIntType(ty) ? sampleIntWrap(toI64(bits), ty) : toI64(bits))
  }
  if (raw.startsWith("(- ") && raw.endsWith(")")) {
    return sampleParseInt(`-${raw.substring(3, raw.length - 1)}`)
  }
  return sampleParseInt(raw)
}

/**
 * A value of a type as an SMT literal: a u64, held by its bits, unsigned.
 *
 * @param x the value
 * @param ty its type; any but u64 is read as signed
 * @returns its literal
 */
export const sampleSmtIntOf = (x: i64, ty: string): string => (ty === "u64" ? `${toU64(x)}` : sampleSmtInt(x))

/**
 * A variable's inclusive range in the skeleton: its bounds (its type's when
 * it has none) for an integer, minLen..maxLen for bytes or a string.
 *
 * @param v the variable
 * @returns `Ok` with [lo, hi], or `Err` when it is not sampled (an f64, a
 *   u64 bound past the largest i64)
 */
export const sampleRange = (v: ForallVar): Result<i64[], string> => {
  if (v.type === "bytes" || v.type === "string") {
    if (v.minLen < 0 || v.maxLen < v.minLen) {
      return Err(`${v.name}: a ${v.type} variable needs 0 <= minLen <= maxLen`)
    }
    return Ok([toI64(v.minLen), toI64(v.maxLen)])
  }
  if (v.type === "f64") {
    return Err("f64 variables are not sampled yet; give f64 cases as vectors")
  }
  if (!vocabIsIntType(v.type)) {
    return Err(`${v.name}: ${v.type} variables are not sampled`)
  }
  const lo = v.hasBounds ? v.min : vocabIntMin(v.type)
  const hi = v.hasBounds ? v.max : vocabIntMax(v.type)
  const l = sampleParseInt(lo).orReturn()
  const h = sampleParseInt(hi).orReturn()
  if (sampleIntLess(h, l, v.type)) {
    return Err(`${v.name}: min is above max`)
  }
  return Ok([l, h])
}

/**
 * The expression with every let-bound name replaced by its value, for the
 * skeleton only (a binding is just a name for its value there).
 *
 * @param e the expression
 * @param bound the names bound around it
 * @returns the expression without lets
 */
export const sampleInlineLets = (e: Expr, bound: Map<string, Expr>): Expr => {
  if (e.kind === ExprKind.Let) {
    const inner = new Map<string, Expr>()
    for (const k of bound.keys()) {
      const x = bound.get(k)
      if (x !== undefined) {
        inner.set(k, x)
      }
    }
    for (const b of e.binds) {
      inner.set(b.name, sampleInlineLets(b.value, inner))
    }
    const body = e.body
    return body === null ? e : sampleInlineLets(body, inner)
  }
  if (e.kind === ExprKind.Var) {
    const x = bound.get(e.name)
    return x === undefined ? e : x
  }
  if (e.kind === ExprKind.Op || e.kind === ExprKind.Call) {
    const out = new Expr(e.kind, e.name)
    for (const a of e.args) {
      out.args.push(sampleInlineLets(a, bound))
    }
    return out
  }
  return e
}

/** Whether an expression is an integer literal. */
const sampleIsIntLit = (e: Expr): boolean => {
  const lit = e.lit
  return e.kind === ExprKind.Lit && lit !== null && lit.kind === LitKind.Int
}

/**
 * The integer type an expression computes in: a variable's own type, i32
 * for a length, an operator's first typed operand's, and "" for a bare
 * literal (which takes the other side's).
 *
 * @param e the expression
 * @param vars the property's variables
 * @returns the type, "" for an untyped literal, or null when it is not an integer
 */
export const sampleIntTypeOf = (e: Expr, vars: ForallVar[]): string | null => {
  if (sampleIsIntLit(e)) {
    return ""
  }
  if (e.kind === ExprKind.Var) {
    const v = sampleVar(vars, e.name)
    return v !== null && vocabIsIntType(v.type) ? v.type : null
  }
  if (e.kind !== ExprKind.Op) {
    return null
  }
  if (e.name === "len" || e.name === "strLen") {
    return "i32"
  }
  if (e.name === "+" || e.name === "-" || e.name === "*" || e.name === "%") {
    let ty = ""
    for (const a of e.args) {
      const t = sampleIntTypeOf(a, vars)
      if (t === null) {
        return null
      }
      if (ty === "") {
        ty = t
      }
    }
    return ty
  }
  return null
}

/**
 * The SMT term of an integer expression of type `ty`, or null when it is not
 * in the skeleton (a call, a slice's length, a variable of another type...).
 *
 * @param e the expression
 * @param vars the property's variables
 * @param ty the type it computes in
 * @returns the term, or null
 */
export const sampleIntTerm = (e: Expr, vars: ForallVar[], ty: string): string | null => {
  const lit = e.lit
  if (e.kind === ExprKind.Lit && lit !== null && lit.kind === LitKind.Int) {
    const x = sampleParseInt(lit.text)
    if (x.isErr() || (ty === "u64" && lit.text.startsWith("-"))) {
      return null
    }
    if (sampleIsBv(ty)) {
      // A literal outside the type compares as itself in the evaluator but
      // would wrap in a bit-vector, so it stays outside the skeleton.
      const lo = sampleParseInt(vocabIntMin(ty))
      const hi = sampleParseInt(vocabIntMax(ty))
      if (lo.isErr() || hi.isErr() || sampleIntLess(x.value, lo.value, ty) || sampleIntLess(hi.value, x.value, ty)) {
        return null
      }
      return sampleSmtLit(x.value, ty)
    }
    return sampleSmtIntOf(x.value, ty)
  }
  if (e.kind === ExprKind.Var) {
    const v = sampleVar(vars, e.name)
    return v !== null && v.type === ty ? sampleSmtName(v) : null
  }
  if (e.kind !== ExprKind.Op || e.args.length === 0) {
    return null
  }
  if (e.name === "len" || e.name === "strLen") {
    return ty === "i32" ? sampleLenTerm(e.args[0], vars) : null
  }
  if (e.args.length !== 2) {
    return null
  }
  const l = sampleIntTerm(e.args[0], vars, ty)
  const r = sampleIntTerm(e.args[1], vars, ty)
  if (l === null || r === null) {
    return null
  }
  if (sampleIsBv(ty)) {
    return sampleBvArith(e.name, l, r, e.args[1], ty)
  }
  if (e.name === "+" || e.name === "-" || e.name === "*") {
    return `(${e.name} ${l} ${r})`
  }
  if (e.name === "%") {
    // Z3's mod is Euclidean and % truncates; they agree for a positive
    // literal divisor once the dividend's sign is pinned. A computed divisor,
    // which may be 0, stays outside the skeleton.
    const d = e.args[1].lit
    if (!sampleIsIntLit(e.args[1]) || d === null) {
      return null
    }
    const dv = sampleParseInt(d.text)
    if (dv.isErr() || dv.value <= toI64(0)) {
      return null
    }
    return `(ite (>= ${l} 0) (mod ${l} ${r}) (- (mod (- ${l}) ${r})))`
  }
  return null
}

/**
 * `+ - * %` over two bit-vector terms of an integer type, wrapping as the
 * generated test does. `%` truncates (bvsrem for `iN`, bvurem for `uN`) and
 * is 0 for a zero divisor, as the test's helper is; bvsrem of the minimum by
 * -1 is 0 as well.
 *
 * @param op the operator
 * @param l the left term
 * @param r the right term
 * @param divisor the right operand, to skip the zero guard for a nonzero literal
 * @param ty the type
 * @returns the term, or null for another operator
 */
export const sampleBvArith = (op: string, l: string, r: string, divisor: Expr, ty: string): string | null => {
  if (op === "+" || op === "-" || op === "*") {
    return `(${op === "+" ? "bvadd" : op === "-" ? "bvsub" : "bvmul"} ${l} ${r})`
  }
  if (op !== "%") {
    return null
  }
  const rem = `(${sampleIntSigned(ty) ? "bvsrem" : "bvurem"} ${l} ${r})`
  const zero = sampleBvLit(0, sampleIntWidth(ty))
  const d = divisor.lit
  if (sampleIsIntLit(divisor) && d !== null) {
    const dv = sampleParseInt(d.text)
    if (dv.isOk() && dv.value !== toI64(0)) {
      return rem
    }
  }
  return `(ite (= ${r} ${zero}) ${zero} ${rem})`
}

/**
 * Whether an expression does `+`, `-` or `*` in i32 (or on bare literals,
 * which compute in i32), which the Int skeleton does not wrap: Int unsat is
 * then no proof that the domain is empty.
 *
 * @param e the expression
 * @param vars the property's variables
 * @returns true when some such operation is in it
 */
export const sampleWrapsOnInt = (e: Expr, vars: ForallVar[]): boolean => {
  if (e.kind === ExprKind.Let) {
    for (const b of e.binds) {
      if (sampleWrapsOnInt(b.value, vars)) {
        return true
      }
    }
    const body = e.body
    return body !== null && sampleWrapsOnInt(body, vars)
  }
  if (e.kind !== ExprKind.Op && e.kind !== ExprKind.Call) {
    return false
  }
  if (e.kind === ExprKind.Op && (e.name === "+" || e.name === "-" || e.name === "*")) {
    const ty = sampleIntTypeOf(e, vars)
    if (ty !== null && (ty === "i32" || ty === "")) {
      return true
    }
  }
  return e.args.some((a: Expr): boolean => sampleWrapsOnInt(a, vars))
}

/** `t` clamped below at 0, or null. */
const sampleNonNeg = (t: string | null): string | null => (t === null ? null : `(ite (< ${t} 0) 0 ${t})`)

/**
 * The length term of a bytes or string expression (one byte per character),
 * or null when it is not in the skeleton.
 *
 * @param e the expression
 * @param vars the property's variables
 * @returns the term, or null
 */
export const sampleLenTerm = (e: Expr, vars: ForallVar[]): string | null => {
  const lit = e.lit
  if (e.kind === ExprKind.Lit && lit !== null) {
    if (lit.kind === LitKind.Hex) {
      return `${(lit.text.length / 2) * Math.max(lit.repeat, 1)}`
    }
    if (lit.kind === LitKind.Str || lit.kind === LitKind.Ascii) {
      return `${lit.text.length}`
    }
    return null
  }
  if (e.kind === ExprKind.Var) {
    const v = sampleVar(vars, e.name)
    return v !== null && (v.type === "bytes" || v.type === "string") ? sampleSmtName(v) : null
  }
  if (e.kind !== ExprKind.Op || e.args.length === 0) {
    return null
  }
  const op = e.name
  if (op === "le64") {
    return "8"
  }
  if (op === "flipBit" || op === "lower" || op === "upper" || op === "utf8") {
    return sampleLenTerm(e.args[0], vars)
  }
  if (op === "zeros") {
    return sampleNonNeg(sampleIntTerm(e.args[0], vars, "i32"))
  }
  if (e.args.length < 2) {
    return null
  }
  if (op === "fill") {
    return sampleNonNeg(sampleIntTerm(e.args[1], vars, "i32"))
  }
  const l = sampleLenTerm(e.args[0], vars)
  if (op === "charAt") {
    const i = sampleIntTerm(e.args[1], vars, "i32")
    return l === null || i === null ? null : `(ite (and (>= ${i} 0) (< ${i} ${l})) 1 0)`
  }
  const r = sampleLenTerm(e.args[1], vars)
  if (l === null || r === null) {
    return null
  }
  if (op === "concat" || op === "strConcat") {
    return `(+ ${l} ${r})`
  }
  if (op === "xor" || op === "bitAnd" || op === "bitOr") {
    return `(ite (>= ${l} ${r}) ${l} ${r})`
  }
  return null
}

/** Both sides of an integer comparison as terms, then their type; null when either is outside the skeleton. */
const sampleCompared = (e: Expr, vars: ForallVar[]): string[] | null => {
  if (e.args.length !== 2) {
    return null
  }
  const typed = e.args.findIndex((a: Expr): boolean => !sampleIsIntLit(a))
  let ty: string | null = "i32"
  if (typed >= 0) {
    ty = sampleIntTypeOf(e.args[typed], vars)
  }
  if (ty === null) {
    return null
  }
  const t = ty === "" ? "i32" : ty
  const l = sampleIntTerm(e.args[0], vars, t)
  const r = sampleIntTerm(e.args[1], vars, t)
  return l === null || r === null ? null : [l, r, t]
}

/** A comparison's SMT operator in a type: `bvslt` and the like for a signed bit-vector, `bvult` for an unsigned one. */
const sampleCompareOp = (op: string, ty: string): string => {
  if (!sampleIsBv(ty)) {
    return op
  }
  const s = sampleIntSigned(ty) ? "bvs" : "bvu"
  return op === "<" ? `${s}lt` : op === "<=" ? `${s}le` : op === ">" ? `${s}gt` : `${s}ge`
}

/** Whether an operator is a comparison. */
const sampleIsComparison = (op: string): boolean => SAMPLE_COMPARISONS.indexOf(` ${op} `) >= 0

/**
 * The SMT term of a boolean expression, or null when any part of it is
 * outside the skeleton.
 *
 * @param e the expression
 * @param vars the property's variables
 * @returns the term, or null
 */
export const sampleBoolTerm = (e: Expr, vars: ForallVar[]): string | null => {
  const lit = e.lit
  if (e.kind === ExprKind.Lit && lit !== null && lit.kind === LitKind.Bool) {
    return lit.flag ? "true" : "false"
  }
  if (e.kind !== ExprKind.Op || e.args.length === 0) {
    return null
  }
  const op = e.name
  if (sampleIsComparison(op)) {
    const c = sampleCompared(e, vars)
    if (c === null) {
      return null
    }
    if (op === "==") {
      return `(= ${c[0]} ${c[1]})`
    }
    if (op === "!=") {
      return `(not (= ${c[0]} ${c[1]}))`
    }
    return `(${sampleCompareOp(op, c[2])} ${c[0]} ${c[1]})`
  }
  if (op === "and" || op === "or" || op === "not" || op === "implies") {
    const ts: string[] = []
    for (const a of e.args) {
      const t = sampleBoolTerm(a, vars)
      if (t === null) {
        return null
      }
      ts.push(t)
    }
    if (op === "not") {
      return ts.length === 1 ? `(not ${ts[0]})` : null
    }
    if (op === "implies") {
      return ts.length === 2 ? `(=> ${ts[0]} ${ts[1]})` : null
    }
    return `(${op} ${ts.join(" ")})`
  }
  return null
}

/**
 * Every integer comparison in an expression whose two sides are in the
 * skeleton, as its exact difference, each once: `(- left right)` over Int,
 * and over bit-vectors both sides sign- or zero-extended by two bits first,
 * so the difference never wraps.
 *
 * @param e the expression (lets already inlined)
 * @param vars the property's variables
 * @param out the edges found so far, added to
 */
export const sampleEdges = (e: Expr, vars: ForallVar[], out: SampleEdge[]): void => {
  if (e.kind !== ExprKind.Op && e.kind !== ExprKind.Call) {
    return
  }
  if (e.kind === ExprKind.Op && sampleIsComparison(e.name)) {
    const c = sampleCompared(e, vars)
    if (c !== null) {
      let edge = new SampleEdge(`(- ${c[0]} ${c[1]})`, ["(- 1)", "0", "1"])
      if (sampleIsBv(c[2])) {
        const ext = sampleIntSigned(c[2]) ? "sign_extend" : "zero_extend"
        const w = sampleIntWidth(c[2]) + 2
        edge = new SampleEdge(`(bvsub ((_ ${ext} 2) ${c[0]}) ((_ ${ext} 2) ${c[1]}))`, [
          `(bvneg (_ bv1 ${w}))`,
          `(_ bv0 ${w})`,
          `(_ bv1 ${w})`,
        ])
      }
      let seen = false
      for (const x of out) {
        seen = seen || x.diff === edge.diff
      }
      if (!seen) {
        out.push(edge)
      }
    }
  }
  for (const a of e.args) {
    sampleEdges(a, vars, out)
  }
}

/**
 * The SMT names a term mentions, of the property's variables.
 *
 * @param term the term
 * @param vars the property's variables
 * @returns the names, in `forall` order
 */
export const sampleNamesIn = (term: string, vars: ForallVar[]): string[] => {
  const words = ` ${replaceAll(replaceAll(term, "(", " "), ")", " ")} `
  const out: string[] = []
  for (const v of vars) {
    const n = sampleSmtName(v)
    if (words.indexOf(` ${n} `) >= 0) {
      out.push(n)
    }
  }
  return out
}

/**
 * The script for a property's queries: each variable declared in its sort
 * with its range, `where` asserted when it is wholly in the skeleton, and each query
 * in its own push/pop, echoing `@@Q<i>` before its check-sat.
 *
 * @param vars the property's variables
 * @param ranges each variable's [lo, hi], in order
 * @param whereTerm `where`'s term, or null when it is not asserted
 * @param queries the queries
 * @returns the script
 */
export const sampleScript = (
  vars: ForallVar[],
  ranges: i64[][],
  whereTerm: string | null,
  queries: SampleQuery[],
): string => {
  let s = SAMPLE_PREAMBLE
  const names: string[] = []
  for (let i = 0; i < vars.length; i++) {
    const n = sampleSmtName(vars[i])
    names.push(n)
    s = `${s}(declare-const ${n} ${sampleSort(vars[i])})\n`
    const ty = vars[i].type
    const lo = sampleSmtLit(ranges[i][0], ty)
    const hi = sampleSmtLit(ranges[i][1], ty)
    const le = sampleCompareOp("<=", ty)
    s = `${s}(assert (and (${le} ${lo} ${n}) (${le} ${n} ${hi})))\n`
  }
  if (whereTerm !== null) {
    s = `${s}(assert ${whereTerm})\n`
  }
  for (let i = 0; i < queries.length; i++) {
    s = `${s}(push 1)\n`
    if (queries[i].extra !== "") {
      s = `${s}(assert ${queries[i].extra})\n`
    }
    s = `${s}(echo "@@Q${i}")\n(check-sat)\n`
    if (names.length > 0) {
      s = `${s}(get-value (${names.join(" ")}))\n`
    }
    s = `${s}(pop 1)\n`
  }
  return s
}
