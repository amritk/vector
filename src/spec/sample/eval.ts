/**
 * `spec/sample/eval` — evaluates a property's call-free expressions, its
 * `where` above all, as the generated test does: + - * % wrap to their
 * operands' integer type, `and` and `or` stop at the first deciding operand,
 * and `unwrap(null)` is undefined, which makes `where` false.
 */

import { fromHex, toHex, utf8Bytes } from "../../core/hex"
import { Expr, ExprKind, LitKind, Literal } from "../contract/types"
import { sampleIntLess, sampleIntWrap, sampleParseInt } from "./ints"

/** The error an `unwrap(null)` evaluates to. */
export const SAMPLE_UNDEFINED: string = "unwrap of null"

/** Which kind of value. */
export enum SampleKind {
  Int = 0,
  Bytes = 1,
  Str = 2,
  Bool = 3,
  Null = 4,
}

/** A value as the evaluator holds it. */
export class SampleValue {
  kind: SampleKind
  /** An integer's value (see `spec/sample/ints`). */
  n: i64
  /** An integer's type; "" for a bare literal, which takes the other operand's. */
  ty: string
  bytes: u8[]
  text: string
  flag: boolean
  /**
   * Makes a value of a kind, zero until set.
   *
   * @param kind its kind
   */
  constructor(kind: SampleKind) {
    this.kind = kind
    this.n = 0
    this.ty = ""
    this.bytes = []
    this.text = ""
    this.flag = false
  }
}

/**
 * An integer value.
 *
 * @param n the value, already wrapped to `ty`
 * @param ty its type, or "" for a bare literal
 * @returns the value
 */
export const sampleInt = (n: i64, ty: string): SampleValue => {
  const v = new SampleValue(SampleKind.Int)
  v.n = n
  v.ty = ty
  return v
}

/**
 * A bytes value.
 *
 * @param b the bytes
 * @returns the value
 */
export const sampleBytes = (b: u8[]): SampleValue => {
  const v = new SampleValue(SampleKind.Bytes)
  v.bytes = b
  return v
}

/**
 * A string value.
 *
 * @param s the text
 * @returns the value
 */
export const sampleStr = (s: string): SampleValue => {
  const v = new SampleValue(SampleKind.Str)
  v.text = s
  return v
}

/**
 * A boolean value.
 *
 * @param b the boolean
 * @returns the value
 */
export const sampleBool = (b: boolean): SampleValue => {
  const v = new SampleValue(SampleKind.Bool)
  v.flag = b
  return v
}

/** The null value. */
const sampleNull = (): SampleValue => new SampleValue(SampleKind.Null)

/**
 * A literal's value.
 *
 * @param lit the literal
 * @returns `Ok` with its value, or `Err` for an f64 or a malformed literal
 */
export const sampleLiteral = (lit: Literal): Result<SampleValue, string> => {
  if (lit.kind === LitKind.Int) {
    return Ok(sampleInt(sampleParseInt(lit.text).orReturn(), ""))
  }
  if (lit.kind === LitKind.Hex) {
    const one = fromHex(lit.text).orReturn()
    const out: u8[] = []
    for (let i = 0; i < Math.max(lit.repeat, 1); i++) {
      for (const b of one) {
        out.push(b)
      }
    }
    return Ok(sampleBytes(out))
  }
  if (lit.kind === LitKind.Ascii) {
    return Ok(sampleBytes(utf8Bytes(lit.text)))
  }
  if (lit.kind === LitKind.Str) {
    return Ok(sampleStr(lit.text))
  }
  if (lit.kind === LitKind.Bool) {
    return Ok(sampleBool(lit.flag))
  }
  if (lit.kind === LitKind.Null) {
    return Ok(sampleNull())
  }
  if (lit.kind === LitKind.Concat) {
    const out: u8[] = []
    for (const p of lit.parts) {
      const v = sampleLiteral(p).orReturn()
      for (const b of v.bytes) {
        out.push(b)
      }
    }
    return Ok(sampleBytes(out))
  }
  return Err("f64 values are not evaluated")
}

/**
 * A value as a literal, as a sample's argument: an int as decimal text, bytes
 * as hex, a string as itself.
 *
 * @param v the value
 * @returns the literal
 */
export const sampleToLiteral = (v: SampleValue): Literal => {
  if (v.kind === SampleKind.Bytes) {
    return new Literal(LitKind.Hex, toHex(v.bytes))
  }
  if (v.kind === SampleKind.Str) {
    return new Literal(LitKind.Str, v.text)
  }
  if (v.kind === SampleKind.Bool) {
    const lit = new Literal(LitKind.Bool, "")
    lit.flag = v.flag
    return lit
  }
  if (v.kind === SampleKind.Null) {
    return new Literal(LitKind.Null, "")
  }
  return new Literal(LitKind.Int, v.ty === "u64" ? `${toU64(v.n)}` : `${v.n}`)
}

/** Whether two values are equal: bytes by content, integers by value. */
const sampleEqual = (x: SampleValue, y: SampleValue): boolean => {
  if (x.kind !== y.kind) {
    return false
  }
  if (x.kind === SampleKind.Int) {
    return x.n === y.n
  }
  if (x.kind === SampleKind.Bytes) {
    if (x.bytes.length !== y.bytes.length) {
      return false
    }
    for (let i = 0; i < x.bytes.length; i++) {
      if (x.bytes[i] !== y.bytes[i]) {
        return false
      }
    }
    return true
  }
  if (x.kind === SampleKind.Str) {
    return x.text === y.text
  }
  if (x.kind === SampleKind.Bool) {
    return x.flag === y.flag
  }
  return true
}

/** The integer type two operands compute in: the typed one's, else i32. */
const sampleOpType = (x: SampleValue, y: SampleValue): string => (x.ty !== "" ? x.ty : y.ty !== "" ? y.ty : "i32")

/** `x` clamped into [lo, hi]. */
const sampleClamp = (x: i64, lo: i64, hi: i64): i64 => (x < lo ? lo : x > hi ? hi : x)

/** An operand that must be of one kind. */
const sampleArg = (args: SampleValue[], i: i32, kind: SampleKind, op: string): Result<SampleValue, string> => {
  if (i >= args.length || args[i].kind !== kind) {
    return Err(`${op}: operand ${i} has the wrong kind`)
  }
  return Ok(args[i])
}

/** The truncating remainder, 0 for a zero divisor, as the generated test's helper. */
const sampleRem = (x: i64, y: i64, ty: string): i64 => {
  if (y === toI64(0) || y === toI64(-1)) {
    return 0
  }
  return ty === "u64" ? toI64(toU64(x) % toU64(y)) : x % y
}

/** + - * % over two integers of one type. */
const sampleArith = (op: string, x: SampleValue, y: SampleValue): SampleValue => {
  const ty = sampleOpType(x, y)
  let r: i64 = 0
  if (op === "+") {
    r = toI64(toU64(x.n) + toU64(y.n))
  } else if (op === "-") {
    r = toI64(toU64(x.n) - toU64(y.n))
  } else if (op === "*") {
    r = toI64(toU64(x.n) * toU64(y.n))
  } else {
    r = sampleRem(x.n, y.n, ty)
  }
  return sampleInt(sampleIntWrap(r, ty), ty)
}

/** < <= > >= over two integers of one type. */
const sampleCompare = (op: string, x: SampleValue, y: SampleValue): boolean => {
  const ty = sampleOpType(x, y)
  if (op === "<") {
    return sampleIntLess(x.n, y.n, ty)
  }
  if (op === "<=") {
    return !sampleIntLess(y.n, x.n, ty)
  }
  if (op === ">") {
    return sampleIntLess(y.n, x.n, ty)
  }
  return !sampleIntLess(x.n, y.n, ty)
}

/** xor, bitAnd or bitOr: the shorter operand reads as zeros past its end. */
const sampleBitwise = (op: string, x: u8[], y: u8[]): u8[] => {
  const n = Math.max(x.length, y.length)
  const out: u8[] = []
  for (let i = 0; i < n; i++) {
    const p: u8 = i < x.length ? x[i] : 0
    const q: u8 = i < y.length ? y[i] : 0
    out.push(op === "xor" ? p ^ q : op === "bitAnd" ? p & q : p | q)
  }
  return out
}

/** ASCII case mapping: bytes from `lo` to `hi` move by `delta`; others are kept. */
const sampleMapCase = (s: string, lo: i32, hi: i32, delta: i32): string => {
  let out = ""
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    out = out + String.fromCharCode(c >= lo && c <= hi ? c + delta : c)
  }
  return out
}

/** `and`, `or` and `implies`, which stop at the first operand that decides. */
const sampleLogic = (e: Expr, env: Map<string, SampleValue>): Result<SampleValue, string> => {
  const op = e.name
  for (let i = 0; i < e.args.length; i++) {
    const v = sampleEval(e.args[i], env).orReturn()
    if (v.kind !== SampleKind.Bool) {
      return Err(`${op}: operand ${i} is not a boolean`)
    }
    const last = i === e.args.length - 1
    if (op === "and" && !v.flag) {
      return Ok(sampleBool(false))
    }
    if (op === "or" && v.flag) {
      return Ok(sampleBool(true))
    }
    if (op === "implies") {
      if (i === 0 && !v.flag) {
        return Ok(sampleBool(true))
      }
      if (last) {
        return Ok(sampleBool(v.flag))
      }
    }
  }
  return Ok(sampleBool(op === "and"))
}

/** An operator over bytes. */
const sampleBytesOp = (op: string, a: SampleValue[]): Result<SampleValue, string> => {
  if (op === "len") {
    return Ok(sampleInt(toI64(sampleArg(a, 0, SampleKind.Bytes, op).orReturn().bytes.length), "i32"))
  }
  if (op === "concat") {
    const out = sampleArg(a, 0, SampleKind.Bytes, op).orReturn().bytes.slice(0)
    for (const b of sampleArg(a, 1, SampleKind.Bytes, op).orReturn().bytes) {
      out.push(b)
    }
    return Ok(sampleBytes(out))
  }
  if (op === "slice") {
    const src = sampleArg(a, 0, SampleKind.Bytes, op).orReturn().bytes
    const n = toI64(src.length)
    const lo = sampleClamp(sampleArg(a, 1, SampleKind.Int, op).orReturn().n, 0, n)
    const hi = sampleClamp(sampleArg(a, 2, SampleKind.Int, op).orReturn().n, lo, n)
    return Ok(sampleBytes(src.slice(toI32(lo), toI32(hi))))
  }
  if (op === "zeros" || op === "fill") {
    const count = sampleArg(a, op === "zeros" ? 0 : 1, SampleKind.Int, op).orReturn().n
    const byte: u8 = op === "zeros" ? 0 : toU8(sampleArg(a, 0, SampleKind.Int, op).orReturn().n & toI64(255))
    const out: u8[] = []
    for (let i: i64 = 0; i < count; i++) {
      out.push(byte)
    }
    return Ok(sampleBytes(out))
  }
  if (op === "flipBit") {
    const out = sampleArg(a, 0, SampleKind.Bytes, op).orReturn().bytes.slice(0)
    const bit = sampleArg(a, 1, SampleKind.Int, op).orReturn().n
    if (out.length > 0) {
      const bits = toI64(out.length) * toI64(8)
      const at = ((bit % bits) + bits) % bits
      const one: u8 = 1
      out[toI32(at / toI64(8))] = out[toI32(at / toI64(8))] ^ (one << toU8(at % toI64(8)))
    }
    return Ok(sampleBytes(out))
  }
  if (op === "le64") {
    const x = toU64(sampleArg(a, 0, SampleKind.Int, op).orReturn().n)
    const out: u8[] = []
    for (let i = 0; i < 8; i++) {
      out.push(toU8((x >> toU64(i * 8)) & toU64(255)))
    }
    return Ok(sampleBytes(out))
  }
  if (op === "ascii") {
    const src = sampleArg(a, 0, SampleKind.Bytes, op).orReturn().bytes
    let s = ""
    for (const b of src) {
      if (b >= 0x80) {
        return Ok(sampleNull())
      }
      s = s + String.fromCharCode(toI32(b))
    }
    return Ok(sampleStr(s))
  }
  const x = sampleArg(a, 0, SampleKind.Bytes, op).orReturn().bytes
  return Ok(sampleBytes(sampleBitwise(op, x, sampleArg(a, 1, SampleKind.Bytes, op).orReturn().bytes)))
}

/** An operator over strings. */
const sampleStrOp = (op: string, a: SampleValue[]): Result<SampleValue, string> => {
  const s = sampleArg(a, 0, SampleKind.Str, op).orReturn().text
  if (op === "strLen") {
    return Ok(sampleInt(toI64(s.length), "i32"))
  }
  if (op === "strConcat") {
    return Ok(sampleStr(s + sampleArg(a, 1, SampleKind.Str, op).orReturn().text))
  }
  if (op === "lower") {
    return Ok(sampleStr(sampleMapCase(s, 65, 90, 32)))
  }
  if (op === "upper") {
    return Ok(sampleStr(sampleMapCase(s, 97, 122, -32)))
  }
  if (op === "utf8") {
    return Ok(sampleBytes(utf8Bytes(s)))
  }
  const i = sampleArg(a, 1, SampleKind.Int, op).orReturn().n
  return Ok(sampleStr(i >= toI64(0) && i < toI64(s.length) ? s.substring(toI32(i), toI32(i) + 1) : ""))
}

const SAMPLE_BYTES_OPS: string = " len concat slice zeros fill flipBit le64 ascii xor bitAnd bitOr "
const SAMPLE_STR_OPS: string = " strLen strConcat lower upper utf8 charAt "

/** An operator application. */
const sampleOp = (e: Expr, env: Map<string, SampleValue>): Result<SampleValue, string> => {
  const op = e.name
  if (op === "and" || op === "or" || op === "implies") {
    return sampleLogic(e, env)
  }
  const a: SampleValue[] = []
  for (const x of e.args) {
    a.push(sampleEval(x, env).orReturn())
  }
  if (op === "unwrap") {
    return a.length > 0 && a[0].kind !== SampleKind.Null ? Ok(a[0]) : Err(SAMPLE_UNDEFINED)
  }
  if (op === "isNull" || op === "notNull") {
    return Ok(sampleBool(a.length > 0 && (a[0].kind === SampleKind.Null) === (op === "isNull")))
  }
  if (op === "not") {
    return Ok(sampleBool(!sampleArg(a, 0, SampleKind.Bool, op).orReturn().flag))
  }
  if (op === "==" || op === "!=") {
    if (a.length !== 2) {
      return Err(`${op}: needs two operands`)
    }
    return Ok(sampleBool(sampleEqual(a[0], a[1]) === (op === "==")))
  }
  if (op === "+" || op === "-" || op === "*" || op === "%") {
    const x = sampleArg(a, 0, SampleKind.Int, op).orReturn()
    return Ok(sampleArith(op, x, sampleArg(a, 1, SampleKind.Int, op).orReturn()))
  }
  if (op === "<" || op === "<=" || op === ">" || op === ">=") {
    const x = sampleArg(a, 0, SampleKind.Int, op).orReturn()
    return Ok(sampleBool(sampleCompare(op, x, sampleArg(a, 1, SampleKind.Int, op).orReturn())))
  }
  if (SAMPLE_BYTES_OPS.indexOf(` ${op} `) >= 0) {
    return sampleBytesOp(op, a)
  }
  if (SAMPLE_STR_OPS.indexOf(` ${op} `) >= 0) {
    return sampleStrOp(op, a)
  }
  return Err(`unknown operator "${op}"`)
}

/**
 * Evaluates a call-free expression. A `let` evaluates each binding in turn
 * before its body, as the generated test does.
 *
 * @param e the expression
 * @param env the variables' values
 * @returns `Ok` with its value, or `Err` with SAMPLE_UNDEFINED for
 *   `unwrap(null)`, or with why it cannot be evaluated (a call, an unknown
 *   name, an f64)
 */
export const sampleEval = (e: Expr, env: Map<string, SampleValue>): Result<SampleValue, string> => {
  if (e.kind === ExprKind.Lit) {
    const lit = e.lit
    return lit === null ? Err("a literal with no value") : sampleLiteral(lit)
  }
  if (e.kind === ExprKind.Var) {
    const v = env.get(e.name)
    return v === undefined ? Err(`unknown variable "${e.name}"`) : Ok(v)
  }
  if (e.kind === ExprKind.Call) {
    return Err(`calls ${e.name}, and a call is not evaluated here`)
  }
  if (e.kind === ExprKind.Let) {
    const inner = new Map<string, SampleValue>()
    for (const k of env.keys()) {
      const v = env.get(k)
      if (v !== undefined) {
        inner.set(k, v)
      }
    }
    for (const b of e.binds) {
      inner.set(b.name, sampleEval(b.value, inner).orReturn())
    }
    const body = e.body
    return body === null ? Err("a let with no body") : sampleEval(body, inner)
  }
  return sampleOp(e, env)
}

/**
 * Whether an input is in a property's domain: its `where` evaluates to true.
 * An undefined `where` (an `unwrap(null)`) is false.
 *
 * @param where the property's `where`, or null for none
 * @param env the input
 * @returns `Ok` with the verdict, or `Err` when `where` cannot be evaluated
 */
export const sampleHolds = (where: Expr | null, env: Map<string, SampleValue>): Result<boolean, string> => {
  if (where === null) {
    return Ok(true)
  }
  const v = sampleEval(where, env)
  if (v.isErr()) {
    return v.error === SAMPLE_UNDEFINED ? Ok(false) : Err(v.error)
  }
  const b = v.value
  return b.kind === SampleKind.Bool ? Ok(b.flag) : Err("where is not a boolean")
}
