/**
 * `spec/contract/typing` — the types of a property clause's expressions. A
 * type is a value type's name (`bytes`, `u32?`, `string`, …) or `null`, the
 * type of a bare null literal. `typeOf` reports every error it finds, each at
 * its path, and gives null for an expression it cannot type.
 */

import { ExprKind, LitKind, typesIsWords, typesWordsKey } from "./types"
import { Expr, FnSig, Literal } from "./types"
import {
  VOCAB_SECRET_FORM,
  vocabBaseOf,
  vocabByteWidth,
  vocabFitsInt,
  vocabHas,
  vocabIsIntType,
  vocabIsOptional,
  vocabIsSecretOp,
  vocabReadOps,
  vocabReadType,
  vocabValueType,
  vocabWriteOps,
} from "./vocab"

/** What `typeOf` knows: the functions under test, the variables in scope, and whether calls are allowed. */
export class TypeEnv {
  /** The functions under test, which a call may name. */
  fns: FnSig[]
  /** The names in scope. */
  names: string[]
  /** The type of each name, at the same index in `names`. */
  types: string[]
  /** False inside `where`: the domain must be decidable without the implementation. */
  allowCalls: boolean
  /**
   * Makes an environment with nothing in scope.
   *
   * @param fns the functions under test
   * @param allowCalls whether expressions may call them
   */
  constructor(fns: FnSig[], allowCalls: boolean) {
    this.fns = fns
    this.names = []
    this.types = []
    this.allowCalls = allowCalls
  }
}

/**
 * Brings a variable into scope.
 *
 * @param env the environment to extend in place
 * @param name the variable
 * @param type its value type
 */
export const typeEnvBind = (env: TypeEnv, name: string, type: string): void => {
  env.names.push(name)
  env.types.push(type)
}

const typingCopy = (env: TypeEnv): TypeEnv => {
  const out = new TypeEnv(env.fns, env.allowCalls)
  // names and types are parallel: typeEnvBind pushes one of each.
  for (let i = 0; i < env.names.length && i < env.types.length; i++) {
    typeEnvBind(out, env.names[i], env.types[i])
  }
  return out
}

const typingVar = (env: TypeEnv, name: string): string | null => {
  for (let i = env.names.length - 1; i >= 0; i--) {
    if (env.names[i] === name && i < env.types.length) {
      return env.types[i]
    }
  }
  return null
}

const typingFn = (env: TypeEnv, name: string): FnSig | null => {
  for (const f of env.fns) {
    if (f.name === name) {
      return f
    }
  }
  return null
}

/**
 * Whether a value of type `from` may be passed where `to` is wanted: the same
 * type, null or the base type for an optional, or an i32 for a u32.
 *
 * @param from the value's type, or `null`
 * @param to the type wanted
 * @returns true when the value may be passed
 */
export const typeAssignable = (from: string, to: string): boolean => {
  if (from === to) {
    return true
  }
  if (vocabIsOptional(to)) {
    return from === "null" || from === vocabBaseOf(to)
  }
  return to === "u32" && from === "i32"
}

/**
 * The integer type under a value type: `u8?` is u8.
 *
 * @param t a value type, or `null`
 * @returns the integer type, or null when `t` is not an integer type
 */
export const typeIntBase = (t: string): string | null => {
  if (t === "null") {
    return null
  }
  const b = vocabBaseOf(t)
  return vocabIsIntType(b) ? b : null
}

/**
 * The type an int literal takes on its own: i32 when it fits, else i64, else
 * u64.
 *
 * @param value the int's decimal text
 * @returns the type, or null when no integer type holds it
 */
export const typeOfInt = (value: string): string | null => {
  if (vocabFitsInt(value, "i32")) {
    return "i32"
  }
  if (vocabFitsInt(value, "i64")) {
    return "i64"
  }
  return vocabFitsInt(value, "u64") ? "u64" : null
}

/**
 * The type a literal stands for: bytes for hex, ascii and concat; an int's
 * own type (i64 when none holds it, which `typeOf` reports).
 *
 * @param lit the literal
 * @returns its type, `null` for a null literal
 */
export const typeOfLiteral = (lit: Literal): string => {
  const k = lit.kind
  if (k === LitKind.Hex || k === LitKind.Ascii || k === LitKind.Concat) {
    return "bytes"
  }
  if (k === LitKind.Str) {
    return "string"
  }
  if (k === LitKind.Int) {
    const t = typeOfInt(lit.text)
    return t === null ? "i64" : t
  }
  if (k === LitKind.F64) {
    return "f64"
  }
  if (typesIsWords(k)) {
    return typesWordsKey(k)
  }
  return k === LitKind.Bool ? "bool" : "null"
}

/**
 * Whether a literal stands for a value of type `ty`; an int must lie in the
 * range of `ty`'s integer type.
 *
 * @param lit the literal
 * @param ty a value type
 * @returns true when it does
 */
export const typeLiteralFits = (lit: Literal, ty: string): boolean => {
  if (lit.kind === LitKind.Int) {
    const int = typeIntBase(ty)
    return int !== null && vocabFitsInt(lit.text, int)
  }
  return typeAssignable(typeOfLiteral(lit), ty)
}

const typingIsIntLit = (e: Expr): boolean => {
  const lit = e.lit
  return e.kind === ExprKind.Lit && lit !== null && lit.kind === LitKind.Int
}

const typingIntText = (e: Expr): string => {
  const lit = e.lit
  return lit === null ? "" : lit.text
}

/**
 * The type of an expression, pushing an error for each problem found.
 *
 * @param e the expression
 * @param env the functions and variables in scope
 * @param at the expression's path, for errors
 * @param errors where errors go, each as `<path>: <problem>`
 * @returns its type, or null when it cannot be typed
 */
export const typeOf = (e: Expr, env: TypeEnv, at: string, errors: string[]): string | null => {
  if (e.kind === ExprKind.Lit) {
    const lit = e.lit
    if (lit === null) {
      return null
    }
    if (lit.kind === LitKind.Int && typeOfInt(lit.text) === null) {
      errors.push(`${at}: int ${lit.text} is outside every integer type`)
      return null
    }
    return typeOfLiteral(lit)
  }
  if (e.kind === ExprKind.Var) {
    const t = typingVar(env, e.name)
    if (t === null) {
      errors.push(`${at}: unknown variable "${e.name}"`)
    }
    return t
  }
  if (e.kind === ExprKind.Let) {
    return typingLet(e, env, at, errors)
  }
  if (e.kind === ExprKind.Call) {
    return typingCall(e, env, at, errors)
  }
  return typingOp(e, env, at, errors)
}

const typingLet = (e: Expr, env: TypeEnv, at: string, errors: string[]): string | null => {
  const inner = typingCopy(env)
  let ok = true
  for (let i = 0; i < e.binds.length; i++) {
    const b = e.binds[i]
    const bat = `${at}.let[${i}]`
    const t = typeOf(b.value, inner, `${bat}.value`, errors)
    if (typingVar(inner, b.name) !== null || typingFn(env, b.name) !== null) {
      errors.push(`${bat}: "${b.name}" shadows a name already in scope`)
      ok = false
    } else if (t === null) {
      ok = false
    } else if (t === "null") {
      errors.push(`${bat}: a bare null has no type to bind`)
      ok = false
    } else {
      typeEnvBind(inner, b.name, t)
    }
  }
  const body = e.body
  if (body === null) {
    return null
  }
  const t = typeOf(body, inner, `${at}.in`, errors)
  return ok ? t : null
}

const typingCall = (e: Expr, env: TypeEnv, at: string, errors: string[]): string | null => {
  if (!env.allowCalls) {
    errors.push(`${at}: "where" may not call ${e.name} — the domain must not depend on the implementation`)
    return null
  }
  const sig = typingFn(env, e.name)
  if (sig === null) {
    const form = vocabIsSecretOp(e.name) ? `: ${VOCAB_SECRET_FORM}` : ""
    errors.push(`${at}: unknown function "${e.name}"${form}`)
    return null
  }
  if (e.args.length !== sig.params.length) {
    errors.push(`${at}: ${e.name} takes ${sig.params.length} argument(s), got ${e.args.length}`)
    return null
  }
  let ok = true
  const params = sig.params
  for (let i = 0; i < e.args.length && i < params.length; i++) {
    const a = e.args[i]
    const p = params[i]
    const t = typeOf(a, env, `${at}.args[${i}]`, errors)
    const want = vocabValueType(p.type)
    const wantInt = typeIntBase(want)
    if (t === null) {
      ok = false
    } else if (typingIsIntLit(a) && wantInt !== null) {
      if (!vocabFitsInt(typingIntText(a), wantInt)) {
        ok = false
        errors.push(`${at}.args[${i}]: ${e.name}(${p.name}) wants ${want}, and ${typingIntText(a)} is outside it`)
      }
    } else if (!typeAssignable(t, want)) {
      ok = false
      const hint = t === "bytes?" ? ` — wrap it in {"op":"unwrap"}` : ""
      errors.push(`${at}.args[${i}]: ${e.name}(${p.name}) wants ${want}, got ${t}${hint}`)
    }
  }
  return ok ? vocabValueType(sig.returns) : null
}

/** An operator's typed operands, and where its errors go. */
class OpTyping {
  op: string
  at: string
  ts: string[]
  errors: string[]
  constructor(op: string, at: string, errors: string[]) {
    this.op = op
    this.at = at
    this.ts = []
    this.errors = errors
  }
}

/** Whether the operator has `n` operands, reporting when it has not. */
const opWant = (o: OpTyping, n: i32): boolean => {
  if (o.ts.length !== n) {
    o.errors.push(`${o.at}: ${o.op} takes ${n} argument(s), got ${o.ts.length}`)
    return false
  }
  return true
}

/** Whether operand `i`, of type `got`, has type `ty`, reporting when it has not. */
const opExpect = (o: OpTyping, i: i32, got: string, ty: string): boolean => {
  if (got !== ty) {
    o.errors.push(`${o.at}.args[${i}]: ${o.op} wants ${ty}, got ${got}`)
    return false
  }
  return true
}

/** `n` operands of the types in `want`, in order; `result` when they are. */
const opSig = (o: OpTyping, want: string[], result: string): string | null => {
  if (!opWant(o, want.length)) {
    return null
  }
  let ok = true
  // opWant made the operands as many as want.
  for (let i = 0; i < want.length && i < o.ts.length; i++) {
    ok = opExpect(o, i, o.ts[i], want[i]) && ok
  }
  return ok ? result : null
}

/**
 * Two integers of one type: the first integer operand's (i32 when neither is
 * one), with the error at the operand that differs.
 */
const opSameInt = (o: OpTyping): string | null => {
  let a = "i32"
  for (const t of o.ts) {
    if (vocabIsIntType(t)) {
      a = t
      break
    }
  }
  for (let i = 0; i < o.ts.length; i++) {
    if (o.ts[i] !== a) {
      o.errors.push(`${o.at}.args[${i}]: ${o.op} wants ${a}, got ${o.ts[i]}`)
      return null
    }
  }
  return a
}

/**
 * A write op's one integer, no wider than the op: `le32` takes an i8 to u32.
 * An int literal was checked against the op's width in `typingOp`.
 */
const opWriteInt = (o: OpTyping): string | null => {
  // opWant answers true only for one operand.
  if (!opWant(o, 1) || o.ts.length < 1) {
    return null
  }
  const t = o.ts[0]
  // A shift, not × 8: vocabByteWidth is a shift right by 3, so this is exact.
  const bits = vocabByteWidth(o.op) << 3
  if (!vocabIsIntType(t) || parseInt(t.substring(1)) > bits) {
    o.errors.push(`${o.at}.args[0]: ${o.op} wants an integer of at most ${bits} bits, got ${t}`)
    return null
  }
  return "bytes"
}

const typingBytesLike = (t: string): boolean => t === "bytes" || t === "bytes?" || t === "null"
const typingStringLike = (t: string): boolean => t === "string" || t === "string?" || t === "null"

/** Whether `==` and `!=` may compare values of types `a` and `b`. */
const typingComparable = (a: string, b: string): boolean => {
  const bothNull = a === "null" && b === "null"
  if (bothNull) {
    return false
  }
  if ((typingBytesLike(a) && typingBytesLike(b)) || (typingStringLike(a) && typingStringLike(b)) || a === b) {
    return true
  }
  if (a !== "null" && b !== "null") {
    return a === `${b}?` || b === `${a}?`
  }
  return vocabIsOptional(a === "null" ? b : a)
}

const typingOp = (e: Expr, env: TypeEnv, at: string, errors: string[]): string | null => {
  const o = new OpTyping(e.name, at, errors)
  let ok = true
  for (let i = 0; i < e.args.length; i++) {
    const t = typeOf(e.args[i], env, `${at}.args[${i}]`, errors)
    if (t === null) {
      ok = false
      o.ts.push("")
    } else {
      o.ts.push(t)
    }
  }
  if (!ok) {
    return null
  }
  // A write op's int literal must fit its width, signed or unsigned: le16
  // takes -32768 to 65535, whatever type the literal takes on its own.
  // o.ts holds one type per argument, so e.args has one too.
  if (vocabHas(vocabWriteOps(), e.name) && o.ts.length === 1 && e.args.length > 0 && typingIsIntLit(e.args[0])) {
    const v = typingIntText(e.args[0])
    // A shift, not × 8: vocabByteWidth is a shift right by 3, so this is exact.
    const bits = vocabByteWidth(e.name) << 3
    if (!vocabFitsInt(v, `i${bits}`) && !vocabFitsInt(v, `u${bits}`)) {
      errors.push(`${at}.args[0]: ${v} does not fit ${e.name}'s ${bits} bits`)
      return null
    }
    o.ts[0] = `u${bits}`
  }
  // An int literal takes the integer type of the other operand when it fits
  // there, so `x + 1` is a u8 when x is (ISO C11 §6.4.4.1 types a constant by
  // its value; here the context gives the type instead).
  const ts = o.ts
  const args = e.args
  if (ts.length === 2 && args.length === 2) {
    for (let i = 0; i < 2 && i < ts.length && i < args.length; i++) {
      const j = 1 - i
      if (j >= ts.length || j >= args.length) {
        break
      }
      const ai = args[i]
      const aj = args[j]
      const other = typeIntBase(ts[j])
      if (typingIsIntLit(ai) && other !== null && aj.kind !== ExprKind.Lit) {
        const v = typingIntText(ai)
        if (!vocabFitsInt(v, other)) {
          errors.push(`${at}.args[${i}]: ${v} is outside ${other}`)
          return null
        }
        ts[i] = other
      }
    }
  }
  return typingOpResult(o)
}

const typingOpResult = (o: OpTyping): string | null => {
  const op = o.op
  if (op === "len") {
    return opSig(o, ["bytes"], "i32")
  }
  if (op === "concat" || op === "xor" || op === "bitAnd" || op === "bitOr") {
    return opSig(o, ["bytes", "bytes"], "bytes")
  }
  if (op === "slice") {
    return opSig(o, ["bytes", "i32", "i32"], "bytes")
  }
  if (op === "zeros") {
    return opSig(o, ["i32"], "bytes")
  }
  if (vocabHas(vocabWriteOps(), op)) {
    return opWriteInt(o)
  }
  if (vocabHas(vocabReadOps(), op)) {
    return opSig(o, ["bytes"], vocabReadType(op))
  }
  if (op === "fill") {
    return opSig(o, ["i32", "i32"], "bytes")
  }
  if (op === "flipBit") {
    return opSig(o, ["bytes", "i32"], "bytes")
  }
  if (op === "unwrap" || op === "isNull" || op === "notNull") {
    if (!opWant(o, 1) || o.ts.length < 1) {
      return null
    }
    if (!vocabIsOptional(o.ts[0])) {
      o.errors.push(`${o.at}: ${op} wants an optional (T?), got ${o.ts[0]}`)
      return null
    }
    return op === "unwrap" ? vocabBaseOf(o.ts[0]) : "bool"
  }
  if (op === "+" || op === "-" || op === "*" || op === "%") {
    return opWant(o, 2) ? opSameInt(o) : null
  }
  if (op === "<" || op === "<=" || op === ">" || op === ">=") {
    return opWant(o, 2) && opSameInt(o) !== null ? "bool" : null
  }
  if (op === "==" || op === "!=") {
    if (!opWant(o, 2) || o.ts.length < 2) {
      return null
    }
    if (!typingComparable(o.ts[0], o.ts[1])) {
      o.errors.push(`${o.at}: cannot compare ${o.ts[0]} with ${o.ts[1]}`)
      return null
    }
    return "bool"
  }
  if (op === "and" || op === "or") {
    if (o.ts.length < 2) {
      o.errors.push(`${o.at}: ${op} takes at least 2 arguments`)
      return null
    }
    let ok = true
    for (let i = 0; i < o.ts.length; i++) {
      ok = opExpect(o, i, o.ts[i], "bool") && ok
    }
    return ok ? "bool" : null
  }
  if (op === "not") {
    return opSig(o, ["bool"], "bool")
  }
  if (op === "implies") {
    return opSig(o, ["bool", "bool"], "bool")
  }
  if (op === "strLen") {
    return opSig(o, ["string"], "i32")
  }
  if (op === "strConcat") {
    return opSig(o, ["string", "string"], "string")
  }
  if (op === "lower" || op === "upper") {
    return opSig(o, ["string"], "string")
  }
  if (op === "utf8") {
    return opSig(o, ["string"], "bytes")
  }
  if (op === "ascii") {
    return opSig(o, ["bytes"], "string?")
  }
  if (op === "charAt") {
    return opSig(o, ["string", "i32"], "string")
  }
  o.errors.push(`${o.at}: unknown operator "${op}"`)
  return null
}

const typingCallsInto = (e: Expr, out: string[]): void => {
  if (e.kind === ExprKind.Let) {
    for (const b of e.binds) {
      typingCallsInto(b.value, out)
    }
    const body = e.body
    if (body !== null) {
      typingCallsInto(body, out)
    }
    return
  }
  if (e.kind === ExprKind.Call && out.indexOf(e.name) < 0) {
    out.push(e.name)
  }
  for (const a of e.args) {
    typingCallsInto(a, out)
  }
}

/**
 * Every function an expression calls, each once, in the order first called.
 *
 * @param e the expression
 * @returns the function names
 */
export const typeCallsIn = (e: Expr): string[] => {
  const out: string[] = []
  typingCallsInto(e, out)
  return out
}
