/**
 * `spec/emit/go` — a contract and its samples as a Go test.
 *
 * The test is one `package main` file that builds with `go build` and the
 * standard library alone: run, it checks every clause and prints the
 * transcript `vector spec run` judges, line for line what the Nish test
 * prints. With the gotest harness it also defines one
 * `func Test_<clause>(*testing.T)` per clause, so `go test` runs the same
 * checks.
 *
 * The functions under test are found by the language table's rules: each
 * name in exported MixedCaps (or the contract's go override), called through
 * its module's import path, which `--package` places for `spec run`. A bytes
 * value is `[]byte`, a string `string`, an optional input `*[]byte` or
 * `*string`, nil when absent, and a refusing result `(T, error)`. The
 * contract's `+`, `-` and `*` wrap, as Go's do.
 */

import { langModuleIn, langNameIn } from "../../lang/names"
import { Sample, SampleTable, checkSamplesOf } from "../check"
import { charsCodePointAt, charsSequenceLength } from "../contract/chars"
import { contractF64Bits, contractF64Parse } from "../contract/f64"
import { ClauseKind, ExprKind, LitKind } from "../contract/types"
import { Clause, Contract, Expr, FnSig, Literal } from "../contract/types"
import { TypeEnv, typeCallsIn, typeEnvBind, typeIntBase, typeOf, typeOfInt } from "../contract/typing"
import {
  vocabBigEndian,
  vocabByteWidth,
  vocabFitsInt,
  vocabHas,
  vocabIsIntType,
  vocabIsOptional,
  vocabReadOps,
  vocabReadType,
  vocabValueType,
  vocabWriteOps,
} from "../contract/vocab"
import {
  EmitOptions,
  emitClauseFn,
  emitClauseLines,
  emitHeaderLines,
  emitSortedUnique,
  emitTestName,
  emitUndefinedWhy,
} from "./emit"
import { EMIT_SLOW_SKIP, emitF64IsFinite, emitLiteralHex } from "./lit"
import { emitTargetWindowRefusal, emitTargetWordsRefusal } from "./target"

/** What emitting one Go test has gathered so far. */
class EmitGoContext {
  c: Contract
  opts: EmitOptions
  /** The names in scope: the forall variables, then let bindings. */
  env: TypeEnv
  /** The modules the test imports, in order; the i-th is imported as `_m<i>`. */
  modules: string[]
  /** What the emitter could not write, found while emitting. */
  errors: string[]

  constructor(c: Contract, opts: EmitOptions) {
    this.c = c
    this.opts = opts
    this.env = new TypeEnv(c.functions, true)
    this.modules = []
    this.errors = []
  }
}

/**
 * A contract function's name in the test: its go override, or the language
 * table's exported MixedCaps.
 *
 * @param f the function
 * @returns the Go name
 */
export const emitGoName = (f: FnSig): string => langNameIn("go", f.name, true, f.names)

/** The import path of a contract module: its path, or the contract's go override for the target. */
const emitGoModule = (c: Contract, module: string): string =>
  langModuleIn("go", module, module === c.target.module ? c.target.modules : null)

const emitGoFn = (ctx: EmitGoContext, name: string): FnSig | null => {
  for (const f of ctx.c.functions) {
    if (f.name === name) {
      return f
    }
  }
  return null
}

/** Whether `n` is an exported Go identifier: a capital ASCII letter, then letters, digits and `_`. */
const emitGoIsExported = (n: string): boolean => {
  if (n.length === 0) {
    return false
  }
  for (let i = 0; i < n.length; i++) {
    const c = toI32(n.charCodeAt(i))
    const upper = c >= 65 && c <= 90
    const ok = upper || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95
    if (!ok || (i === 0 && !upper)) {
      return false
    }
  }
  return true
}

/**
 * What in a contract the Go test cannot express, found before any output:
 * a function whose Go name is not an exported identifier (a package's
 * functions are called from outside it, so the name starts with a capital),
 * two functions of one module with one Go name, two clause ids that make the
 * same check name, and an f64 forall variable, which the sampler does not
 * draw yet. Every call is qualified by its package, so no name under test
 * meets one the test defines.
 *
 * @param c the contract
 * @returns one message per refusal; empty when Go can express it all
 */
export const emitGoRefusals = (c: Contract): string[] => {
  const out: string[] = []
  const names: string[] = []
  for (const f of c.functions) {
    const words = emitTargetWordsRefusal(f, "Go")
    if (words !== null) {
      out.push(words)
    }
    const window = emitTargetWindowRefusal(f, "Go")
    if (window !== null) {
      out.push(window)
    }
    const n = emitGoName(f)
    if (!emitGoIsExported(n)) {
      out.push(
        `${f.name}: its Go name ${n} is not exported (it must start with a capital): give it a go name in the contract`,
      )
    }
    const key = `${f.module ?? c.target.module} ${n}`
    if (names.indexOf(key) >= 0) {
      out.push(`${f.name}: its Go name ${n} is another function's too`)
    }
    names.push(key)
  }
  const fns: string[] = []
  for (const k of c.clauses) {
    const fn = emitClauseFn(k)
    if (fns.indexOf(fn) >= 0) {
      out.push(`${k.id}: its check would be ${fn}, which an earlier clause's id already makes`)
    }
    fns.push(fn)
    for (const v of k.forall) {
      if (v.type === "f64") {
        out.push(`${k.id}: ${v.name} is f64: the sampler has no f64 forall variable yet, so there are no samples`)
      }
    }
  }
  return out
}

/** `n` as `width` lowercase hex digits. */
const emitGoHex = (n: i32, width: i32): string => {
  const out: string[] = []
  for (let i = width - 1; i >= 0; i--) {
    const d = (n >> (4 * i)) & 15
    out.push("0123456789abcdef".substring(d, d + 1))
  }
  return out.join("")
}

/**
 * Text as a Go string literal: `"` and `\` escaped, newline, tab and
 * carriage return as `\n`, `\t` and `\r`, any other control character and
 * every non-ASCII one as `\uXXXX`, and a scalar above U+FFFF as
 * `\UXXXXXXXX`, so the source is ASCII.
 *
 * @param s the text
 * @returns it in double quotes
 */
export const emitGoQuote = (s: string): string => {
  const out: string[] = ['"']
  let j = 0
  while (j < s.length) {
    const cp = charsCodePointAt(s, j)
    const n = charsSequenceLength(s, j)
    if (cp === 0x22 || cp === 0x5c) {
      out.push(`\\${s.substring(j, j + 1)}`)
    } else if (cp === 0x0a) {
      out.push("\\n")
    } else if (cp === 0x09) {
      out.push("\\t")
    } else if (cp === 0x0d) {
      out.push("\\r")
    } else if (cp >= 0xd800 && cp <= 0xdfff) {
      out.push("\\ufffd")
    } else if (cp > 0xffff) {
      out.push(`\\U${emitGoHex(cp, 8)}`)
    } else if (cp < 0x20 || cp >= 0x7f) {
      out.push(`\\u${emitGoHex(cp, 4)}`)
    } else {
      out.push(s.substring(j, j + n))
    }
    j += n
  }
  out.push('"')
  return out.join("")
}

/** A type's value type, secret bytes read as bytes. */
const emitGoVt = (t: string): string => vocabValueType(t)

/** A contract value type as a Go type; null for one Go cannot hold. */
const emitGoType = (t: string): string | null => {
  const vt = emitGoVt(t)
  if (vt === "bytes") {
    return "[]byte"
  }
  if (vt === "bytes?") {
    return "*[]byte"
  }
  if (vt === "string" || vt === "bool") {
    return vt
  }
  if (vt === "string?") {
    return "*string"
  }
  if (vt === "f64") {
    return "float64"
  }
  if (vocabIsIntType(vt)) {
    return vt.startsWith("u") ? `uint${vt.substring(1, vt.length)}` : `int${vt.substring(1, vt.length)}`
  }
  return null
}

/** An integer type's Go name. */
const emitGoIntType = (t: string): string => emitGoType(t) ?? "int64"

/**
 * An integer literal of type `ty`, converted so its width is exact.
 *
 * @param text the decimal text
 * @param ty the integer type
 * @returns the Go expression, such as `int32(42)`
 */
export const emitGoInt = (text: string, ty: string): string => `${emitGoIntType(ty)}(${text})`

/**
 * An f64 literal, from its binary64 bits so every value (-0, a NaN's
 * payload, the infinities) is the one the contract means.
 *
 * @param text the literal's decimal text
 * @param bits its bits as 16 hex digits, or null to compute them
 * @returns the Go expression
 */
export const emitGoF64 = (text: string, bits: string | null): string =>
  `math.Float64frombits(0x${bits ?? contractF64Bits(contractF64Parse(text))})`

/**
 * An int literal where an integer of type `want` goes: at `want` when it
 * fits, else at its own type and converted, through `_v` so the conversion
 * is not a constant one and wraps.
 */
const emitGoIntLit = (text: string, want: string | null): string => {
  const w: string | null = want === null ? null : typeIntBase(want)
  if (w !== null && vocabFitsInt(text, w)) {
    return emitGoInt(text, w)
  }
  const lit = emitGoInt(text, typeOfInt(text) ?? "i64")
  return w === null ? lit : `${emitGoIntType(w)}(_v(${lit}))`
}

/** A literal as a value: `[]byte` for bytes, a string for a string. */
const emitGoLiteral = (lit: Literal, want: string | null): string => {
  if (lit.kind === LitKind.Null) {
    return "nil"
  }
  if (lit.kind === LitKind.Bool) {
    return lit.flag ? "true" : "false"
  }
  if (lit.kind === LitKind.Int) {
    return emitGoIntLit(lit.text, want)
  }
  if (lit.kind === LitKind.F64) {
    return emitGoF64(lit.text, lit.bits)
  }
  if (lit.kind === LitKind.Str) {
    return emitGoQuote(lit.text)
  }
  return `_h("${emitLiteralHex(lit)}")`
}

/** A literal passed straight to a parameter of type `ty`: a present optional points at its value. */
const emitGoLitArg = (lit: Literal, ty: string): string => {
  const t = emitGoVt(ty)
  if (lit.kind === LitKind.Null) {
    return "nil"
  }
  if (t === "bytes?" || t === "string?") {
    return `_some(${emitGoLiteral(lit, null)})`
  }
  return emitGoLiteral(lit, t)
}

const emitGoTypeOf = (ctx: EmitGoContext, e: Expr): string => {
  const errors: string[] = []
  return emitGoVt(typeOf(e, ctx.env, "", errors) ?? "null")
}

/** An integer of type `natural` where `want` is wanted, converted to `want` when the two differ. */
const emitGoConv = (s: string, natural: string, want: string | null): string => {
  const w: string | null = want === null ? null : typeIntBase(want)
  if (w !== null && natural !== w && vocabIsIntType(natural)) {
    return `${emitGoIntType(w)}(${s})`
  }
  return s
}

/** The integer type an arithmetic or comparison op's operands share. */
const emitGoOperands = (ctx: EmitGoContext, e: Expr): string => {
  for (const x of e.args) {
    if (x.kind !== ExprKind.Lit) {
      const t = emitGoTypeOf(ctx, x)
      if (vocabIsIntType(t)) {
        return t
      }
    }
  }
  return emitGoTypeOf(ctx, e.args[0])
}

const emitGoArg = (ctx: EmitGoContext, e: Expr, i: i32, want: string | null): string => emitGoExpr(ctx, e.args[i], want)

/** An argument passed to a parameter of type `ty`; a present value meeting an optional parameter is pointed at. */
const emitGoCallArg = (ctx: EmitGoContext, e: Expr, ty: string): string => {
  const t = emitGoVt(ty)
  if (t === "bytes?" || t === "string?") {
    if (emitGoIsNullLit(e)) {
      return "nil"
    }
    const s = emitGoExpr(ctx, e, null)
    return vocabIsOptional(emitGoTypeOf(ctx, e)) ? s : `_some(${s})`
  }
  return emitGoExpr(ctx, e, t)
}

/** A call of a function under test, through its package; a refusing result becomes a pointer, nil for the refusal. */
const emitGoCall = (ctx: EmitGoContext, sig: FnSig, args: string[]): string => {
  const at = ctx.modules.indexOf(sig.module ?? ctx.c.target.module)
  const call = `_m${at}.${emitGoName(sig)}(${args.join(", ")})`
  const ret = emitGoVt(sig.returns)
  if (ret === "bytes?") {
    return `_ob(${call})`
  }
  return ret === "string?" ? `_os(${call})` : call
}

/** An expression as a value where a value of type `want` goes (null: its own type). */
const emitGoExpr = (ctx: EmitGoContext, e: Expr, want: string | null): string => {
  if (e.kind === ExprKind.Var) {
    return emitGoConv(`v_${e.name}`, emitGoTypeOf(ctx, e), want)
  }
  if (e.kind === ExprKind.Call) {
    const sig = emitGoFn(ctx, e.name)
    if (sig === null) {
      ctx.errors.push(`unknown function ${e.name}`)
      return ""
    }
    const args: string[] = []
    for (let i = 0; i < e.args.length; i++) {
      args.push(emitGoCallArg(ctx, e.args[i], sig.params[i].type))
    }
    return emitGoConv(emitGoCall(ctx, sig, args), emitGoVt(sig.returns), want)
  }
  if (e.kind === ExprKind.Let) {
    ctx.errors.push("a let may only open the assert")
    return ""
  }
  if (e.kind === ExprKind.Lit) {
    const lit = e.lit
    return lit === null ? "" : emitGoLiteral(lit, want)
  }
  return emitGoOp(ctx, e, want)
}

/** The ops on bytes and strings, which go through a helper; null for any other op. */
const emitGoHelperOp = (ctx: EmitGoContext, e: Expr): string | null => {
  const op = e.name
  if (op === "zeros") {
    return `_fill(int64(0), ${emitGoArg(ctx, e, 0, null)})`
  }
  if (vocabHas(vocabWriteOps(), op)) {
    const x = e.args[0]
    const lit = x.lit
    const natural = lit !== null ? (lit.text.startsWith("-") ? "i64" : "u64") : emitGoTypeOf(ctx, x)
    return `_intBytes(${emitGoExpr(ctx, x, natural)}, ${vocabByteWidth(op)}, ${vocabBigEndian(op)})`
  }
  if (vocabHas(vocabReadOps(), op)) {
    const read = `_bytesInt(u, ${emitGoArg(ctx, e, 0, null)}, ${vocabByteWidth(op)}, ${vocabBigEndian(op)})`
    const ty = vocabReadType(op)
    return ty === "u64" ? read : `${emitGoIntType(ty)}(${read})`
  }
  const one = ["utf8", "ascii", "strLen", "lower", "upper"]
  const oneHelper = ["_utf8(", "_ascii(", "_strLen(", "_shiftCase(", "_shiftCase("]
  const oneTail = [")", ")", ")", ", 65, 90, 32)", ", 97, 122, -32)"]
  const at = one.indexOf(op)
  if (at >= 0) {
    return `${oneHelper[at]}${emitGoArg(ctx, e, 0, null)}${oneTail[at]}`
  }
  const two = ["fill", "flipBit", "charAt", "concat", "strConcat"]
  const twoHelper = ["_fill", "_flipBit", "_charAt", "_concat", "_strConcat"]
  const at2 = two.indexOf(op)
  if (at2 >= 0) {
    return `${twoHelper[at2]}(${emitGoArg(ctx, e, 0, null)}, ${emitGoArg(ctx, e, 1, null)})`
  }
  if (op === "slice") {
    const b = emitGoArg(ctx, e, 0, null)
    return `_slice(${b}, ${emitGoArg(ctx, e, 1, null)}, ${emitGoArg(ctx, e, 2, null)})`
  }
  const bitwise = ["xor", "bitAnd", "bitOr"].indexOf(op)
  if (bitwise >= 0) {
    return `_bitwise(${emitGoArg(ctx, e, 0, null)}, ${emitGoArg(ctx, e, 1, null)}, ${bitwise})`
  }
  return null
}

/** Whether a literal is the null literal. */
const emitGoIsNullLit = (e: Expr): boolean => {
  const lit = e.lit
  return e.kind === ExprKind.Lit && lit !== null && lit.kind === LitKind.Null
}

/**
 * A comparison. A side that is the null literal compares the other with
 * nil; bytes compare by content, and optionals by what they point at, a
 * plain value meeting an optional pointed at first.
 */
const emitGoCompare = (ctx: EmitGoContext, e: Expr, op: string): string => {
  const l = emitGoTypeOf(ctx, e.args[0])
  const r = emitGoTypeOf(ctx, e.args[1])
  if (emitGoIsNullLit(e.args[1]) || emitGoIsNullLit(e.args[0])) {
    const other = emitGoIsNullLit(e.args[1]) ? 0 : 1
    return `(${emitGoArg(ctx, e, other, null)} ${op} nil)`
  }
  const side = l === "null" ? r : l
  const t: string | null = vocabIsIntType(side) ? emitGoOperands(ctx, e) : null
  let a = emitGoArg(ctx, e, 0, t)
  let b = emitGoArg(ctx, e, 1, t)
  const lo = vocabIsOptional(l)
  const ro = vocabIsOptional(r)
  if (!lo && !ro && l !== "bytes") {
    return `(${a} ${op} ${b})`
  }
  if (lo && !ro) {
    b = `_some(${b})`
  }
  if (ro && !lo) {
    a = `_some(${a})`
  }
  const base = l === "bytes" || l === "bytes?" || r === "bytes?" ? (lo || ro ? "_eqob" : "_eqb") : "_eqo"
  if (op === "==") {
    return `${base}(${a}, ${b})`
  }
  if (op === "!=") {
    return `(!${base}(${a}, ${b}))`
  }
  ctx.errors.push(`Go cannot order ${l} and ${r} with ${op}`)
  return ""
}

/** An operator application. */
const emitGoOp = (ctx: EmitGoContext, e: Expr, want: string | null): string => {
  const op = e.name
  const viaHelper = emitGoHelperOp(ctx, e)
  if (viaHelper !== null) {
    return emitGoConv(viaHelper, emitGoTypeOf(ctx, e), want)
  }
  if (op === "len") {
    return emitGoConv(`int32(len(${emitGoArg(ctx, e, 0, null)}))`, "i32", want)
  }
  if (op === "unwrap") {
    const get = emitGoTypeOf(ctx, e.args[0]) === "string?" ? "s" : "b"
    return `u.${get}(${emitGoArg(ctx, e, 0, null)})`
  }
  if (op === "isNull") {
    return `(${emitGoArg(ctx, e, 0, null)} == nil)`
  }
  if (op === "notNull") {
    return `(${emitGoArg(ctx, e, 0, null)} != nil)`
  }
  const arith = ["+", "-", "*", "%"].indexOf(op)
  if (arith >= 0) {
    const t = emitGoOperands(ctx, e)
    const helper = ["_add", "_sub", "_mul", "_rem"][arith]
    return emitGoConv(`${helper}(${emitGoArg(ctx, e, 0, t)}, ${emitGoArg(ctx, e, 1, t)})`, t, want)
  }
  if (op === "<" || op === "<=" || op === ">" || op === ">=" || op === "==" || op === "!=") {
    return emitGoCompare(ctx, e, op)
  }
  if (op === "and" || op === "or") {
    const parts: string[] = []
    for (let i = 0; i < e.args.length; i++) {
      parts.push(emitGoArg(ctx, e, i, null))
    }
    return `(${parts.join(op === "and" ? " && " : " || ")})`
  }
  if (op === "not") {
    return `(!${emitGoArg(ctx, e, 0, null)})`
  }
  if (op === "implies") {
    return `(!${emitGoArg(ctx, e, 0, null)} || ${emitGoArg(ctx, e, 1, null)})`
  }
  ctx.errors.push(`Go has no spelling for the op ${op}`)
  return ""
}

/** `var`s for the lets that open `assert`, pushed onto `out`; answers the expression they scope over. */
const emitGoBindings = (ctx: EmitGoContext, assert: Expr, indent: string, out: string[]): Expr => {
  let e = assert
  while (e.kind === ExprKind.Let) {
    for (const b of e.binds) {
      const ty = emitGoTypeOf(ctx, b.value)
      const goTy = emitGoType(ty)
      if (goTy === null) {
        ctx.errors.push(`Go cannot hold the let ${b.name}, of type ${ty}`)
      }
      out.push(`${indent}var v_${b.name} ${goTy ?? ""} = ${emitGoExpr(ctx, b.value, null)}`)
      out.push(`${indent}_ = v_${b.name}`)
      typeEnvBind(ctx.env, b.name, ty)
    }
    const body = e.body
    if (body === null) {
      return e
    }
    e = body
  }
  return e
}

/** The comment above a clause's check: its title and each covered requirement quoted. */
const emitGoComment = (c: Contract, k: Clause): string => {
  const lines: string[] = []
  const body = emitClauseLines(c, k)
  for (let i = 0; i < body.length; i++) {
    lines.push(i > 0 && body[i] === "" ? "//" : `// ${body[i]}`)
  }
  return lines.join("\n")
}

/** A vector clause's check. */
const emitGoVector = (ctx: EmitGoContext, k: Clause): string => {
  const sig = emitGoFn(ctx, k.call)
  const expect = k.expect
  if (sig === null || expect === null) {
    ctx.errors.push(`${k.id}: no function ${k.call} or no expected value`)
    return ""
  }
  const name = emitGoQuote(emitTestName(k))
  const it = k.iterate
  if ((it?.slow ?? false) && !ctx.opts.slow) {
    return `func ${emitClauseFn(k)}(t *Suite) bool {\n\treturn t.skip(${name}, "${EMIT_SLOW_SKIP}")\n}`
  }
  const args: string[] = []
  for (let i = 0; i < k.args.length; i++) {
    args.push(emitGoLitArg(k.args[i], sig.params[i].type))
  }
  const steps: string[] = it === null ? [] : emitGoIterate(ctx, k, sig, args, name)
  const call = it === null ? emitGoCall(ctx, sig, args) : "it_r"
  const ret = emitGoVt(sig.returns)
  let body = ""
  const tr = k.truncate
  if (ret === "bytes" && tr !== null) {
    body = `t.eqStr(${name}, _hexPrefix(${call}, ${tr.bytes}), "${emitLiteralHex(expect)}")`
  } else if (ret === "bytes") {
    body = `t.eqStr(${name}, _hexOf(${call}), "${emitLiteralHex(expect)}")`
  } else if (ret === "bytes?") {
    const want = expect.kind === LitKind.Null ? "null" : emitLiteralHex(expect)
    body = `t.eqStr(${name}, _ohex(${call}), "${want}")`
  } else if (ret === "bool") {
    body = `t.eqBool(${name}, ${call}, ${expect.flag ? "true" : "false"})`
  } else if (vocabIsIntType(ret)) {
    body = `t.eqInt(${name}, fmt.Sprint(${call}), fmt.Sprint(${emitGoIntLit(expect.text, ret)}))`
  } else if (ret === "f64") {
    body = emitGoVectorF64(k, expect, name, call)
  } else if (ret === "string") {
    body = `t.eqStr(${name}, ${call}, ${emitGoQuote(expect.text)})`
  } else if (ret === "string?") {
    const want = expect.kind === LitKind.Null ? "null" : `"${expect.text}"`
    body = `t.eqStr(${name}, _strOrNull(${call}), ${emitGoQuote(want)})`
  } else {
    ctx.errors.push(`${k.id}: Go cannot check a ${sig.returns} result`)
  }
  return `func ${emitClauseFn(k)}(t *Suite) bool {\n${steps.join("\n")}${steps.length > 0 ? "\n" : ""}\treturn ${body}\n}`
}

/**
 * An iterated vector's calls, up to the last result bound as `it_r`: the
 * arguments (`it_a<i>`, by position) start as the vector's and are rebound
 * to its `next` after each call; a nil result at any step fails the clause,
 * naming the step.
 */
const emitGoIterate = (ctx: EmitGoContext, k: Clause, sig: FnSig, args: string[], name: string): string[] => {
  const it = k.iterate
  if (it === null) {
    return []
  }
  const lines: string[] = []
  const types: string[] = []
  const vars: string[] = []
  for (let i = 0; i < it.names.length; i++) {
    const t = emitGoVt(sig.params[i].type)
    types.push(t)
    vars.push(`it_a${i}`)
    lines.push(`\tvar it_a${i} ${emitGoType(t) ?? ""} = ${args[i]}`)
  }
  const optional = vocabIsOptional(emitGoVt(sig.returns))
  lines.push(`\tfor it_i := 1; it_i < ${it.count}; it_i++ {`)
  lines.push(`\t\tit_s := ${emitGoCall(ctx, sig, vars)}`)
  if (optional) {
    lines.push("\t\tif it_s == nil {")
    lines.push(`\t\t\treturn t.fail(${name}, fmt.Sprintf("step %d of ${it.count}: ${sig.name} returned null", it_i))`)
    lines.push("\t\t}")
  }
  for (let i = 0; i < it.next.length; i++) {
    const e = it.next[i]
    let v = `it_a${toI32(it.names.indexOf(e.name))}`
    if (e.kind === ExprKind.Call) {
      v = optional && !vocabIsOptional(types[i]) ? "*it_s" : "it_s"
    }
    lines.push(`\t\tit_n${i} := ${v}`)
  }
  for (let i = 0; i < it.next.length; i++) {
    lines.push(`\t\tit_a${i} = it_n${i}`)
  }
  lines.push("\t}")
  lines.push(`\tit_r := ${emitGoCall(ctx, sig, vars)}`)
  if (optional) {
    lines.push("\tif it_r == nil {")
    lines.push(`\t\treturn t.fail(${name}, "step ${it.count} of ${it.count}: ${sig.name} returned null")`)
    lines.push("\t}")
  }
  return lines
}

/**
 * An f64 vector's check: bit for bit, or within its tolerance; a
 * non-finite expected value is checked bit for bit whatever the tolerance.
 */
const emitGoVectorF64 = (k: Clause, expect: Literal, name: string, call: string): string => {
  const want = emitGoF64(expect.text, expect.bits)
  const tol = k.tolerance
  if (tol === null || !emitF64IsFinite(expect.text, expect.bits)) {
    return `t.eqF64Bits(${name}, ${call}, ${want})`
  }
  if (!tol.isUlps) {
    return `t.nearF64(${name}, ${call}, ${want}, ${emitGoF64(tol.abs, null)})`
  }
  return `t.nearUlpsF64(${name}, ${call}, ${want}, ${tol.ulps})`
}

/** One forall variable's sample table, as a slice: integers and bools as they are, bytes as hex, strings quoted. */
const emitGoTable = (name: string, type: string, j: i32, samples: Sample[], out: string[]): void => {
  const vals: string[] = []
  let elem = "string"
  for (const s of samples) {
    const lit = s.args[j]
    if (vocabIsIntType(type)) {
      elem = emitGoIntType(type)
      vals.push(lit.text)
    } else if (type === "bool") {
      elem = "bool"
      vals.push(lit.flag ? "true" : "false")
    } else if (type === "bytes") {
      vals.push(`"${emitLiteralHex(lit)}"`)
    } else {
      vals.push(emitGoQuote(lit.text))
    }
  }
  out.push(`\ttable_${name} := []${elem}{`)
  for (const v of vals) {
    out.push(`\t\t${v},`)
  }
  out.push("\t}")
}

/** A property clause's check: a loop over its baked samples. */
const emitGoProperty = (ctx: EmitGoContext, k: Clause, samples: Sample[]): string => {
  const name = emitGoQuote(emitTestName(k))
  const count = samples.length
  const out: string[] = [`func ${emitClauseFn(k)}(t *Suite) bool {`]
  const assert = k.assert
  if (count === 0 || assert === null) {
    out.push(`\treturn t.skip(${name}, "no samples")`)
    out.push("}")
    return out.join("\n")
  }
  for (let j = 0; j < k.forall.length; j++) {
    const v = k.forall[j]
    emitGoTable(v.name, v.type, j, samples, out)
  }
  const undefinedWhy = emitUndefinedWhy(assert)
  const usesUnwrap = undefinedWhy !== null
  out.push(`\tfor i := 0; i < ${count}; i++ {`)
  ctx.env = new TypeEnv(ctx.c.functions, true)
  const shown: string[] = []
  const shownArgs: string[] = []
  for (const v of k.forall) {
    typeEnvBind(ctx.env, v.name, v.type)
    if (v.type === "bytes") {
      out.push(`\t\tv_${v.name} := _h(table_${v.name}[i])`)
      shown.push(`len(${v.name}) = %d`)
      shownArgs.push(`len(v_${v.name})`)
    } else if (v.type === "string") {
      out.push(`\t\tv_${v.name} := table_${v.name}[i]`)
      shown.push(`len(${v.name}) = %d`)
      shownArgs.push(`len(v_${v.name})`)
    } else {
      out.push(`\t\tv_${v.name} := table_${v.name}[i]`)
      shown.push(`${v.name} = %v`)
      shownArgs.push(`v_${v.name}`)
    }
  }
  if (usesUnwrap) {
    out.push("\t\tu := &_Unwrap{}")
  }
  const body = emitGoBindings(ctx, assert, "\t\t", out)
  out.push(`\t\tholds := ${emitGoExpr(ctx, body, null)}`)
  const where = emitGoQuote(`sample %d of ${count} (${shown.join(", ")}): %s`)
  const whereArgs = `i+1, ${shownArgs.join(", ")}`
  if (usesUnwrap) {
    out.push("\t\tif u.saw || !holds {")
    out.push(`\t\t\twhy := "the assertion is false"`)
    out.push("\t\t\tif u.saw {")
    out.push(`\t\t\t\twhy = ${emitGoQuote(undefinedWhy ?? "")}`)
    out.push("\t\t\t}")
  } else {
    out.push("\t\tif !holds {")
    out.push(`\t\t\twhy := "the assertion is false"`)
  }
  out.push(`\t\t\treturn t.fail(${name}, fmt.Sprintf(${where}, ${whereArgs}, why))`)
  out.push("\t\t}")
  out.push("\t}")
  out.push(`\treturn t.ok(${emitGoQuote(`${emitTestName(k)} — ${count} samples`)})`)
  out.push("}")
  return out.join("\n")
}

/** The modules of the functions a test calls, each once, in the order of the functions' names. */
const emitGoModulesOf = (ctx: EmitGoContext, called: string[]): string[] => {
  const modules: string[] = []
  for (const n of emitSortedUnique(called)) {
    const f = emitGoFn(ctx, n)
    if (f !== null) {
      const mod = f.module ?? ctx.c.target.module
      if (modules.indexOf(mod) < 0) {
        modules.push(mod)
      }
    }
  }
  return modules
}

/** The import block: the standard library the runtime uses, `testing` for gotest, and each module as `_m<i>`. */
const emitGoImports = (ctx: EmitGoContext, harness: string): string => {
  const lines: string[] = ["import ("]
  const std = ["encoding/hex", "fmt", "math", "os", "strconv", "strings"]
  if (harness === "gotest") {
    std.push("testing")
  }
  for (const s of std) {
    lines.push(`\t"${s}"`)
  }
  if (ctx.modules.length > 0) {
    lines.push("")
  }
  for (let i = 0; i < ctx.modules.length; i++) {
    lines.push(`\t_m${i} ${emitGoQuote(emitGoModule(ctx.c, ctx.modules[i]))}`)
  }
  lines.push(")")
  return lines.join("\n")
}

/** The suite and the helpers every test shares. */
const EMIT_GO_RUNTIME: string = `// Suite is one PASS, FAIL or SKIP line per check, then a tally: nish/testing's transcript.
type Suite struct {
	name     string
	passed   int
	failed   int
	skipped  int
	failures []string
	detail   string
}

func newSuite(name string) *Suite {
	return &Suite{name: name}
}

func (t *Suite) ok(name string) bool {
	t.passed++
	fmt.Printf("PASS  %s\\n", name)
	return true
}

func (t *Suite) fail(name string, detail string) bool {
	t.failed++
	t.failures = append(t.failures, name)
	t.detail = detail
	fmt.Printf("FAIL  %s\\n", name)
	if detail != "" {
		fmt.Printf("      %s\\n", detail)
	}
	return false
}

func (t *Suite) skip(name string, reason string) bool {
	t.skipped++
	t.detail = reason
	fmt.Printf("SKIP  %s (%s)\\n", name, reason)
	return true
}

func (t *Suite) done() int {
	if len(t.failures) > 0 {
		fmt.Printf("failed: %s\\n", strings.Join(t.failures, ", "))
	}
	fmt.Printf("%s: %d passed, %d failed, %d skipped\\n", t.name, t.passed, t.failed, t.skipped)
	if t.failed > 0 {
		return 1
	}
	return 0
}

func (t *Suite) eqStr(name string, actual string, expected string) bool {
	if actual == expected {
		return t.ok(name)
	}
	return t.fail(name, fmt.Sprintf("expected \\"%s\\", got \\"%s\\"", expected, actual))
}

func (t *Suite) eqInt(name string, actual string, expected string) bool {
	if actual == expected {
		return t.ok(name)
	}
	return t.fail(name, fmt.Sprintf("expected %s, got %s", expected, actual))
}

func (t *Suite) eqBool(name string, actual bool, expected bool) bool {
	if actual == expected {
		return t.ok(name)
	}
	return t.fail(name, fmt.Sprintf("expected %t, got %t", expected, actual))
}

func (t *Suite) eqF64Bits(name string, actual float64, expected float64) bool {
	if math.Float64bits(actual) == math.Float64bits(expected) {
		return t.ok(name)
	}
	return t.fail(name, fmt.Sprintf("expected %s, got %s (other binary64 bits)", _f64s(expected), _f64s(actual)))
}

func (t *Suite) nearF64(name string, actual float64, expected float64, tolerance float64) bool {
	if math.Abs(actual-expected) <= tolerance {
		return t.ok(name)
	}
	return t.fail(name, fmt.Sprintf("expected %s +/- %s, got %s", _f64s(expected), _f64s(tolerance), _f64s(actual)))
}

func (t *Suite) nearUlpsF64(name string, actual float64, expected float64, ulps uint64) bool {
	if !math.IsNaN(actual) && !math.IsNaN(expected) && _ulpsApart(_ordered(actual), _ordered(expected)) <= ulps {
		return t.ok(name)
	}
	return t.fail(name, fmt.Sprintf("expected %s within %d ulps, got %s", _f64s(expected), ulps, _f64s(actual)))
}

// _run is a clause's check; one that panics fails, with what it panicked with.
func _run(t *Suite, check func(*Suite) bool, name string) (passed bool) {
	defer func() {
		if e := recover(); e != nil {
			passed = t.fail(name, fmt.Sprintf("panicked: %v", e))
		}
	}()
	return check(t)
}

// _f64s is x as the other emitted tests show an f64: NaN, inf, a decimal
// with a fraction from 1e-4 up to 1e16, else the shortest exponent form.
func _f64s(x float64) string {
	if math.IsNaN(x) {
		return "NaN"
	}
	if math.IsInf(x, 0) {
		if x > 0 {
			return "inf"
		}
		return "-inf"
	}
	a := math.Abs(x)
	if a == 0 || (a >= 1e-4 && a < 1e16) {
		s := strconv.FormatFloat(x, 'f', -1, 64)
		if !strings.Contains(s, ".") {
			s += ".0"
		}
		return s
	}
	s := strconv.FormatFloat(x, 'e', -1, 64)
	at := strings.IndexByte(s, 'e')
	exp := strings.TrimLeft(s[at+2:], "0")
	if s[at+1] == '-' {
		exp = "-" + exp
	}
	return s[:at] + "e" + exp
}

// _ordered is x's place on the line of binary64 bit patterns, where -0 meets +0.
func _ordered(x float64) int64 {
	n := int64(math.Float64bits(x))
	if n < 0 {
		return -(n & 0x7fffffffffffffff)
	}
	return n
}

func _ulpsApart(a int64, b int64) uint64 {
	if a > b {
		return uint64(a) - uint64(b)
	}
	return uint64(b) - uint64(a)
}

func _h(s string) []byte {
	b, err := hex.DecodeString(s)
	if err != nil {
		panic(err)
	}
	return b
}

func _hexOf(b []byte) string {
	return hex.EncodeToString(b)
}

func _hexPrefix(b []byte, n int) string {
	if len(b) < n {
		return fmt.Sprintf("a %d-byte result, shorter than the %d bytes it is truncated to", len(b), n)
	}
	return hex.EncodeToString(b[:n])
}

func _ohex(b *[]byte) string {
	if b == nil {
		return "null"
	}
	return _hexOf(*b)
}

func _strOrNull(s *string) string {
	if s == nil {
		return "null"
	}
	return "\\"" + *s + "\\""
}

// _ob is a refusing bytes result as a pointer: nil for the refusal.
func _ob(b []byte, err error) *[]byte {
	if err != nil {
		return nil
	}
	return &b
}

// _os is a refusing string result as a pointer: nil for the refusal.
func _os(s string, err error) *string {
	if err != nil {
		return nil
	}
	return &s
}

func _some[T any](x T) *T {
	return &x
}

// _v is x as it is, but not a constant, so converting it wraps.
func _v[T any](x T) T {
	return x
}

func _eqb(a []byte, b []byte) bool {
	return string(a) == string(b)
}

func _eqob(a *[]byte, b *[]byte) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return _eqb(*a, *b)
}

func _eqo[T comparable](a *T, b *T) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

type _ints interface {
	~int8 | ~int16 | ~int32 | ~int64 | ~uint8 | ~uint16 | ~uint32 | ~uint64
}

func _add[T _ints](a T, b T) T {
	return a + b
}

func _sub[T _ints](a T, b T) T {
	return a - b
}

func _mul[T _ints](a T, b T) T {
	return a * b
}

// _rem is the contract's a % b: truncating, and 0 when b is 0.
func _rem[T _ints](a T, b T) T {
	if b == 0 {
		return 0
	}
	return a % b
}

// _at is x clamped into [0, n].
func _at[T _ints](x T, n int) int {
	if x < 0 {
		return 0
	}
	if uint64(x) > uint64(n) {
		return n
	}
	return int(x)
}

// _slice is b[lo, hi), both ends clamped into b.
func _slice[L _ints, H _ints](b []byte, lo L, hi H) []byte {
	l := _at(lo, len(b))
	h := _at(hi, len(b))
	if h < l {
		h = l
	}
	return append([]byte{}, b[l:h]...)
}

func _fill[V _ints, N _ints](v V, n N) []byte {
	out := make([]byte, _at(n, math.MaxInt32))
	for i := range out {
		out[i] = byte(v)
	}
	return out
}

// _flipBit is a copy of b with bit (mod 8 * len(b)) inverted.
func _flipBit[T _ints](b []byte, bit T) []byte {
	out := append([]byte{}, b...)
	if len(out) > 0 {
		m := uint64(len(out)) * 8
		var at uint64
		if bit >= 0 {
			at = uint64(bit) % m
		} else {
			at = (m - uint64(-(int64(bit)+1))%m - 1) % m
		}
		out[at>>3] ^= 1 << (at & 7)
	}
	return out
}

// _bitwise is a and b byte by byte (k 0: xor, 1: and, 2: or); the shorter reads as zeros.
func _bitwise(a []byte, b []byte, k int) []byte {
	n := len(a)
	if len(b) > n {
		n = len(b)
	}
	out := make([]byte, n)
	for i := range out {
		var x, y byte
		if i < len(a) {
			x = a[i]
		}
		if i < len(b) {
			y = b[i]
		}
		switch k {
		case 1:
			out[i] = x & y
		case 2:
			out[i] = x | y
		default:
			out[i] = x ^ y
		}
	}
	return out
}

// _intBytes is n's w bytes, big-endian when be, a negative n in two's complement.
func _intBytes[T _ints](n T, w int, be bool) []byte {
	x := uint64(n)
	out := make([]byte, w)
	for i := range out {
		k := i
		if be {
			k = w - 1 - i
		}
		out[i] = byte(x >> (8 * k))
	}
	return out
}

// _bytesInt is the integer b's w bytes hold; any other length records on u, so the sample fails.
func _bytesInt(u *_Unwrap, b []byte, w int, be bool) uint64 {
	if len(b) != w {
		u.saw = true
		return 0
	}
	var x uint64
	for i := range b {
		k := w - 1 - i
		if be {
			k = i
		}
		x = x<<8 | uint64(b[k])
	}
	return x
}

func _utf8(s string) []byte {
	return []byte(s)
}

func _strLen(s string) int32 {
	return int32(len(s))
}

// _charAt is the byte at i as a string, or "" out of range.
func _charAt[T _ints](s string, i T) string {
	if i < 0 || uint64(i) >= uint64(len(s)) {
		return ""
	}
	if s[int(i)] >= 128 {
		return "\\ufffd"
	}
	return s[int(i) : int(i)+1]
}

func _ascii(b []byte) *string {
	for _, x := range b {
		if x >= 128 {
			return nil
		}
	}
	s := string(b)
	return &s
}

// _shiftCase is s with every character in [lo, hi] moved by delta (ASCII case mapping).
func _shiftCase(s string, lo rune, hi rune, delta rune) string {
	out := []rune{}
	for _, c := range s {
		if lo <= c && c <= hi {
			c += delta
		}
		out = append(out, c)
	}
	return string(out)
}

func _concat(a []byte, b []byte) []byte {
	return append(append([]byte{}, a...), b...)
}

func _strConcat(a string, b string) string {
	return a + b
}

// _Unwrap records a nil it unwraps and stands in empty, so the sample fails.
type _Unwrap struct {
	saw bool
}

func (u *_Unwrap) b(x *[]byte) []byte {
	if x == nil {
		u.saw = true
		return []byte{}
	}
	return *x
}

func (u *_Unwrap) s(x *string) string {
	if x == nil {
		u.saw = true
		return ""
	}
	return *x
}`

/** The hook every gotest test calls. */
const EMIT_GO_GOTEST: string = `// _gotest is a clause's check as a go test: a failure fails it with its
// detail, and a check that skipped skips it.
func _gotest(tt *testing.T, check func(*Suite) bool, name string) {
	t := newSuite(name)
	if !_run(t, check, name) {
		tt.Fatal(t.detail)
	}
	if t.skipped > 0 {
		tt.Skip(t.detail)
	}
}`

/** `main`: every clause run in order, then the end line with the nonce `spec run` passes. */
const emitGoMain = (c: Contract): string => {
  const lines: string[] = ["func main() {", `\tt := newSuite(${emitGoQuote(c.contract)})`, '\tran := ""']
  for (const k of c.clauses) {
    lines.push(`\tif _run(t, ${emitClauseFn(k)}, ${emitGoQuote(emitTestName(k))}) {`)
    lines.push('\t\tran += "1"')
    lines.push("\t} else {")
    lines.push('\t\tran += "0"')
    lines.push("\t}")
  }
  lines.push("\tcode := t.done()")
  lines.push('\tnonce := "-"')
  lines.push("\tif len(os.Args) > 1 {")
  lines.push("\t\tnonce = os.Args[1]")
  lines.push("\t}")
  lines.push('\tfmt.Printf("vector-done %s %s\\n", nonce, ran)')
  lines.push("\tos.Exit(code)")
  lines.push("}")
  return lines.join("\n")
}

/** A clause's go test: `Test_` and the check's name after `clause_`. */
const emitGoGotest = (k: Clause): string => {
  const fn = emitClauseFn(k)
  return `func Test_${fn.substring(7, fn.length)}(tt *testing.T) {\n\t_gotest(tt, ${fn}, ${emitGoQuote(emitTestName(k))})\n}`
}

/**
 * The whole Go test for a contract: a header naming the contract's sha256,
 * the imports of the packages under test, the suite and helpers, one check
 * per clause under the requirements it covers, `main`, and with the gotest
 * harness one `func Test_<clause>` per clause.
 *
 * @param c the contract, already checked
 * @param table the property samples `checkContract` chose
 * @param opts the header's regenerate command and the contract's sha256
 * @param harness `standalone` or `gotest`
 * @returns the test's text, or every reason Go cannot express the contract
 */
export const emitGoProgram = (
  c: Contract,
  table: SampleTable,
  opts: EmitOptions,
  harness: string,
): Result<string, string[]> => {
  const refused = emitGoRefusals(c)
  if (refused.length > 0) {
    return Err(refused)
  }
  const ctx = new EmitGoContext(c, opts)
  const called: string[] = []
  for (const k of c.clauses) {
    if (k.kind === ClauseKind.Vector) {
      called.push(k.call)
    } else {
      const assert = k.assert
      if (assert !== null) {
        for (const n of typeCallsIn(assert)) {
          called.push(n)
        }
      }
    }
  }
  ctx.modules = emitGoModulesOf(ctx, called)
  const bodies: string[] = []
  for (const k of c.clauses) {
    if (k.kind === ClauseKind.Vector) {
      bodies.push(`${emitGoComment(c, k)}\n${emitGoVector(ctx, k)}`)
    } else {
      bodies.push(`${emitGoComment(c, k)}\n${emitGoProperty(ctx, k, checkSamplesOf(table, k.id))}`)
    }
  }
  if (ctx.errors.length > 0) {
    return Err(ctx.errors)
  }
  const header = emitHeaderLines(c, opts)
    .map((l: string): string => (l === "" ? "//" : `// ${l}`))
    .join("\n")
  const parts: string[] = [`${header}\n\npackage main`, emitGoImports(ctx, harness), EMIT_GO_RUNTIME]
  for (const b of bodies) {
    parts.push(b)
  }
  parts.push(emitGoMain(c))
  if (harness === "gotest") {
    parts.push(EMIT_GO_GOTEST)
    for (const k of c.clauses) {
      parts.push(emitGoGotest(k))
    }
  }
  return Ok(`${parts.join("\n\n")}\n`)
}
