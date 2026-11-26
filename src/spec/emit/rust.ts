/**
 * `spec/emit/rust` — a contract and its samples as a Rust test.
 *
 * The test is one file that builds with `rustc` and the standard library
 * alone: run, it checks every clause and prints the transcript `vector spec
 * run` judges, line for line what the Nish test prints. With the cargo
 * harness it also defines one `#[test] fn test_<clause>` per clause, so
 * `cargo test` (or `rustc --test`) runs the same checks.
 *
 * The functions under test are found by the language table's rules: each
 * name in snake_case (or the contract's rust override), used from the
 * module's crate path, or loaded with `#[path]` from the file `--package`
 * places it in. A bytes input is `&[u8]`, a string `&str`, an optional input
 * `Option<&[u8]>` or `Option<&str>`; a result is taken as any `AsRef<[u8]>`
 * or `AsRef<str>`, so `Vec<u8>`, `[u8; N]`, `String` and `&str` all check.
 * The contract's `+`, `-` and `*` wrap, and the test builds with overflow
 * checks on, so an implementation that overflows where the contract wraps
 * panics, and the check fails with the panic's message.
 */

import { langModuleIn, langNameIn } from "../../lang/names"
import { Sample, SampleTable, checkSamplesOf } from "../check"
import { charsCodePointAt, charsSequenceLength } from "../contract/chars"
import { contractF64Bits, contractF64Parse } from "../contract/f64"
import { ClauseKind, ExprKind, LitKind } from "../contract/types"
import { Clause, Contract, Expr, FnSig, Literal } from "../contract/types"
import { TypeEnv, typeCallsIn, typeEnvBind, typeIntBase, typeOf, typeOfInt } from "../contract/typing"
import {
  vocabBaseOf,
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
import { emitTargetOutRefusal, emitTargetWindowRefusal, emitTargetWordsRefusal } from "./target"

/** What emitting one Rust test has gathered so far. */
class EmitRsContext {
  c: Contract
  opts: EmitOptions
  /** The names in scope: the forall variables, then let bindings. */
  env: TypeEnv
  /** What the emitter could not write, found while emitting. */
  errors: string[]

  constructor(c: Contract, opts: EmitOptions) {
    this.c = c
    this.opts = opts
    this.env = new TypeEnv(c.functions, true)
    this.errors = []
  }
}

/** Rust's keywords, strict and reserved, which no function under test can be named. */
const emitRsKeywords = (): string[] => [
  "abstract",
  "as",
  "async",
  "await",
  "become",
  "box",
  "break",
  "const",
  "continue",
  "crate",
  "do",
  "dyn",
  "else",
  "enum",
  "extern",
  "false",
  "final",
  "fn",
  "for",
  "gen",
  "if",
  "impl",
  "in",
  "let",
  "loop",
  "macro",
  "match",
  "mod",
  "move",
  "mut",
  "override",
  "priv",
  "pub",
  "ref",
  "return",
  "self",
  "static",
  "struct",
  "super",
  "trait",
  "true",
  "try",
  "type",
  "typeof",
  "unsafe",
  "unsized",
  "use",
  "virtual",
  "where",
  "while",
  "yield",
]

/** The names the test itself defines or uses, which no function under test can take. */
const emitRsTaken = (): string[] => [
  "Err",
  "None",
  "Ok",
  "Option",
  "Some",
  "String",
  "Suite",
  "Unwrap",
  "Vec",
  "alloc",
  "core",
  "holds",
  "i",
  "main",
  "r",
  "std",
  "t",
  "u",
  "why",
]

/**
 * A contract function's name in the test: its rust override, or the
 * language table's snake_case.
 *
 * @param f the function
 * @returns the Rust name
 */
export const emitRsName = (f: FnSig): string => langNameIn("rust", f.name, true, f.names)

/** The Rust path a contract module is used from: its crate path. */
const emitRsModule = (c: Contract, module: string): string =>
  langModuleIn("rust", module, module === c.target.module ? c.target.modules : null)

const emitRsFn = (ctx: EmitRsContext, name: string): FnSig | null => {
  for (const f of ctx.c.functions) {
    if (f.name === name) {
      return f
    }
  }
  return null
}

/** Why a function under test cannot keep its Rust name in the test, or null. */
const emitRsNameRefusal = (f: FnSig): string | null => {
  const n = emitRsName(f)
  if (emitRsKeywords().indexOf(n) >= 0) {
    return `${f.name}: its Rust name ${n} is a keyword: give it a rust name in the contract`
  }
  const reserved =
    emitRsTaken().indexOf(n) >= 0 ||
    n.startsWith("_") ||
    n.startsWith("clause_") ||
    n.startsWith("test_") ||
    n.startsWith("v_") ||
    n.startsWith("table_")
  if (reserved) {
    return `${f.name}: its Rust name ${n} is one the test uses for its own: give it a rust name in the contract`
  }
  return null
}

/**
 * What in a contract the Rust test cannot express, found before any output:
 * a function whose Rust name is a keyword or one the test uses itself
 * (`Suite`, `main`, `t`, `clause_*`, `test_*`, `_`-prefixed), two functions
 * with one Rust name, two clause ids that make the same check name, and an
 * f64 forall variable, which the sampler does not draw yet.
 *
 * @param c the contract
 * @returns one message per refusal; empty when Rust can express it all
 */
export const emitRsRefusals = (c: Contract): string[] => {
  const out: string[] = []
  const names: string[] = []
  for (const f of c.functions) {
    const words = emitTargetWordsRefusal(f, "Rust")
    if (words !== null) {
      out.push(words)
    }
    const window = emitTargetWindowRefusal(f, "Rust")
    if (window !== null) {
      out.push(window)
    }
    const buffer = emitTargetOutRefusal(f, "Rust")
    if (buffer !== null) {
      out.push(buffer)
    }
    const why = emitRsNameRefusal(f)
    if (why !== null) {
      out.push(why)
    }
    const n = emitRsName(f)
    if (names.indexOf(n) >= 0) {
      out.push(`${f.name}: its Rust name ${n} is another function's too`)
    }
    names.push(n)
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

/** The low hex digit of `n`. */
const emitRsHexDigit = (n: i32): string => {
  const d = n & 15
  return "0123456789abcdef".substring(d, d + 1)
}

/**
 * Text as a Rust string literal: `"` and `\` escaped, newline, tab and
 * carriage return as `\n`, `\t` and `\r`, any other control character as
 * `\u{XX}`, everything else as written (Rust source is UTF-8).
 *
 * @param s the text
 * @returns it in double quotes
 */
export const emitRsQuote = (s: string): string => {
  const out: string[] = ['"']
  // In u32, so the steps cannot overflow: each is 1 to 4 bytes, inside the text.
  let j: u32 = 0
  while (j < toU32(s.length)) {
    const cp = charsCodePointAt(s, toI32(j))
    const n = toU32(charsSequenceLength(s, toI32(j)))
    if (cp === 0x22 || cp === 0x5c) {
      out.push(`\\${s.substring(toI32(j), toI32(j + 1))}`)
    } else if (cp === 0x0a) {
      out.push("\\n")
    } else if (cp === 0x09) {
      out.push("\\t")
    } else if (cp === 0x0d) {
      out.push("\\r")
    } else if (cp < 0x20 || cp === 0x7f) {
      out.push(`\\u{${emitRsHexDigit(cp >> 4)}${emitRsHexDigit(cp & 15)}}`)
    } else {
      out.push(s.substring(toI32(j), toI32(j + n)))
    }
    j += n
  }
  out.push('"')
  return out.join("")
}

/** A type's value type, secret bytes read as bytes. */
const emitRsVt = (t: string): string => vocabValueType(t)

/** Whether a value of type `t` is Copy in the test: an integer, a bool or an f64. */
const emitRsIsCopy = (t: string): boolean => vocabIsIntType(t) || t === "bool" || t === "f64"

/**
 * An integer literal of type `ty`, suffixed so its width is exact, in
 * parentheses when negative.
 *
 * @param text the decimal text
 * @param ty the integer type
 * @returns the Rust literal
 */
export const emitRsInt = (text: string, ty: string): string =>
  text.startsWith("-") ? `(${text}${ty})` : `${text}${ty}`

/**
 * An f64 literal, from its binary64 bits so every value (-0, a NaN's
 * payload, the infinities) is the one the contract means.
 *
 * @param text the literal's decimal text
 * @param bits its bits as 16 hex digits, or null to compute them
 * @returns the Rust expression
 */
export const emitRsF64 = (text: string, bits: string | null): string =>
  `f64::from_bits(0x${bits ?? contractF64Bits(contractF64Parse(text))})`

/** An int literal where an integer of type `want` goes: at `want` when it fits, else at its own type and cast. */
const emitRsIntLit = (text: string, want: string | null): string => {
  const w: string | null = want === null ? null : typeIntBase(want)
  if (w !== null && vocabFitsInt(text, w)) {
    return emitRsInt(text, w)
  }
  const lit = emitRsInt(text, typeOfInt(text) ?? "i128")
  return w === null ? lit : `(${lit} as ${w})`
}

/** A literal as an owned value: Vec<u8> for bytes, String for a string. */
const emitRsLiteral = (lit: Literal, want: string | null): string => {
  if (lit.kind === LitKind.Null) {
    return "None"
  }
  if (lit.kind === LitKind.Bool) {
    return lit.flag ? "true" : "false"
  }
  if (lit.kind === LitKind.Int) {
    return emitRsIntLit(lit.text, want)
  }
  if (lit.kind === LitKind.F64) {
    return emitRsF64(lit.text, lit.bits)
  }
  if (lit.kind === LitKind.Str) {
    return `String::from(${emitRsQuote(lit.text)})`
  }
  return `_h("${emitLiteralHex(lit)}")`
}

/** A literal passed straight to a parameter of type `ty`: borrowed where the parameter borrows. */
const emitRsLitArg = (lit: Literal, ty: string): string => {
  const t = emitRsVt(ty)
  if (lit.kind === LitKind.Null) {
    return "None"
  }
  if (t === "bytes") {
    return `&_h("${emitLiteralHex(lit)}")`
  }
  if (t === "bytes?") {
    return `Some(&_h("${emitLiteralHex(lit)}")[..])`
  }
  if (t === "string") {
    return emitRsQuote(lit.text)
  }
  if (t === "string?") {
    return `Some(${emitRsQuote(lit.text)})`
  }
  return emitRsLiteral(lit, t)
}

const emitRsTypeOf = (ctx: EmitRsContext, e: Expr): string => {
  const errors: string[] = []
  return emitRsVt(typeOf(e, ctx.env, "", errors) ?? "null")
}

/** An integer of type `natural` where `want` is wanted, cast to `want` when the two differ. */
const emitRsConv = (s: string, natural: string, want: string | null): string => {
  const w: string | null = want === null ? null : typeIntBase(want)
  if (w !== null && natural !== w && vocabIsIntType(natural)) {
    return `((${s}) as ${w})`
  }
  return s
}

/** The integer type an arithmetic or comparison op's operands share. */
const emitRsOperands = (ctx: EmitRsContext, e: Expr): string => {
  for (const x of e.args) {
    if (x.kind !== ExprKind.Lit) {
      const t = emitRsTypeOf(ctx, x)
      if (vocabIsIntType(t)) {
        return t
      }
    }
  }
  return emitRsArgType(ctx, e, 0)
}

/**
 * Argument `i` of an op, or null once its absence is recorded: a checked
 * contract gives every op its arity, so only a contract built by hand lacks one.
 */
const emitRsArgAt = (ctx: EmitRsContext, e: Expr, i: i32): Expr | null => {
  if (i >= 0 && i < e.args.length) {
    return e.args[i]
  }
  const msg = `${e.name} has no argument ${i}`
  if (ctx.errors.indexOf(msg) < 0) {
    ctx.errors.push(msg)
  }
  return null
}

/** The type of argument `i` of an op ("null" once its absence is recorded). */
const emitRsArgType = (ctx: EmitRsContext, e: Expr, i: i32): string => {
  const x = emitRsArgAt(ctx, e, i)
  return x === null ? "null" : emitRsTypeOf(ctx, x)
}

/** Argument `i` of an op, wanted at `want` ("" once its absence is recorded). */
const emitRsArg = (ctx: EmitRsContext, e: Expr, i: i32, want: string | null): string => {
  const x = emitRsArgAt(ctx, e, i)
  return x === null ? "" : emitRsExpr(ctx, x, want)
}

/** Argument `i` of an op as a place ("" once its absence is recorded). */
const emitRsPlaceArg = (ctx: EmitRsContext, e: Expr, i: i32): string => {
  const x = emitRsArgAt(ctx, e, i)
  return x === null ? "" : emitRsPlace(ctx, x)
}

/** A borrow of argument `i` of an op ("" once its absence is recorded). */
const emitRsRefArg = (ctx: EmitRsContext, e: Expr, i: i32): string => {
  const x = emitRsArgAt(ctx, e, i)
  return x === null ? "" : emitRsRef(ctx, x)
}

/** Argument `i` of an op widened to i128 ("" once its absence is recorded). */
const emitRsWideArg = (ctx: EmitRsContext, e: Expr, i: i32): string => {
  const x = emitRsArgAt(ctx, e, i)
  return x === null ? "" : emitRsWide(ctx, x)
}

/** An expression as a place a method can be called on or borrowed: a variable as it is, anything else in parentheses. */
const emitRsPlace = (ctx: EmitRsContext, e: Expr): string =>
  e.kind === ExprKind.Var ? `v_${e.name}` : `(${emitRsExpr(ctx, e, null)})`

/** A borrow of an expression's value: `&[u8]` from bytes, `&str` from a string. */
const emitRsRef = (ctx: EmitRsContext, e: Expr): string => `&${emitRsPlace(ctx, e)}`

/** An integer expression widened to i128, which the helpers take. */
const emitRsWide = (ctx: EmitRsContext, e: Expr): string => `(${emitRsExpr(ctx, e, null)}) as i128`

/** An argument passed to a parameter of type `ty`: by value, borrowed, or as a borrowed option. */
const emitRsCallArg = (ctx: EmitRsContext, e: Expr, ty: string): string => {
  const t = emitRsVt(ty)
  if (t === "bytes" || t === "string") {
    return emitRsRef(ctx, e)
  }
  if (t === "bytes?" || t === "string?") {
    const lit = e.lit
    if (e.kind === ExprKind.Lit && lit !== null && lit.kind === LitKind.Null) {
      return "None"
    }
    if (vocabIsOptional(emitRsTypeOf(ctx, e))) {
      return `${emitRsPlace(ctx, e)}.as_deref()`
    }
    return `Some(&${emitRsPlace(ctx, e)}[..])`
  }
  return emitRsExpr(ctx, e, t)
}

/** A call of a function under test; a bytes or string result is made owned whatever form it came back in. */
const emitRsCall = (sig: FnSig, args: string[]): string => {
  const call = `${emitRsName(sig)}(${args.join(", ")})`
  const ret = emitRsVt(sig.returns)
  if (ret === "bytes") {
    return `_b(${call})`
  }
  if (ret === "bytes?") {
    return `_ob(${call})`
  }
  if (ret === "string") {
    return `_s(${call})`
  }
  return ret === "string?" ? `_os(${call})` : call
}

/** An expression as an owned value where a value of type `want` goes (null: its own type). */
const emitRsExpr = (ctx: EmitRsContext, e: Expr, want: string | null): string => {
  if (e.kind === ExprKind.Var) {
    const t = emitRsTypeOf(ctx, e)
    return emitRsConv(emitRsIsCopy(t) ? `v_${e.name}` : `v_${e.name}.clone()`, t, want)
  }
  if (e.kind === ExprKind.Call) {
    const sig = emitRsFn(ctx, e.name)
    if (sig === null) {
      ctx.errors.push(`unknown function ${e.name}`)
      return ""
    }
    // typingCall checks a call's arity at extraction; this guards a contract built by hand.
    if (e.args.length !== sig.params.length) {
      ctx.errors.push(`${e.name} takes ${sig.params.length} arguments, got ${e.args.length}`)
      return ""
    }
    const args: string[] = []
    const params = sig.params
    for (let i = 0; i < e.args.length && i < params.length; i++) {
      args.push(emitRsCallArg(ctx, e.args[i], params[i].type))
    }
    return emitRsConv(emitRsCall(sig, args), emitRsVt(sig.returns), want)
  }
  if (e.kind === ExprKind.Let) {
    ctx.errors.push("a let may only open the assert")
    return ""
  }
  if (e.kind === ExprKind.Lit) {
    const lit = e.lit
    return lit === null ? "" : emitRsLiteral(lit, want)
  }
  return emitRsOp(ctx, e, want)
}

/** The ops on bytes and strings, which go through a helper; null for any other op. */
const emitRsHelperOp = (ctx: EmitRsContext, e: Expr): string | null => {
  const op = e.name
  if (op === "zeros") {
    return `_fill(0, ${emitRsWideArg(ctx, e, 0)})`
  }
  if (vocabHas(vocabWriteOps(), op)) {
    return `_int_bytes(${emitRsWideArg(ctx, e, 0)}, ${vocabByteWidth(op)}, ${vocabBigEndian(op)})`
  }
  if (vocabHas(vocabReadOps(), op)) {
    const read = `_bytes_int(&u, ${emitRsRefArg(ctx, e, 0)}, ${vocabByteWidth(op)}, ${vocabBigEndian(op)})`
    const ty = vocabReadType(op)
    return ty === "u64" ? read : `(${read} as ${ty})`
  }
  if (op === "lower" || op === "upper") {
    const tail = op === "lower" ? ", 65, 90, 32)" : ", 97, 122, -32)"
    return `_shift_case(${emitRsRefArg(ctx, e, 0)}${tail}`
  }
  if (op === "utf8" || op === "ascii" || op === "strLen") {
    const helper = op === "utf8" ? "_utf8" : op === "ascii" ? "_ascii" : "_str_len"
    return `${helper}(${emitRsRefArg(ctx, e, 0)})`
  }
  if (op === "fill") {
    return `_fill(${emitRsWideArg(ctx, e, 0)}, ${emitRsWideArg(ctx, e, 1)})`
  }
  if (op === "flipBit" || op === "charAt") {
    const helper = op === "flipBit" ? "_flip_bit" : "_char_at"
    return `${helper}(${emitRsRefArg(ctx, e, 0)}, ${emitRsWideArg(ctx, e, 1)})`
  }
  if (op === "concat" || op === "strConcat") {
    const helper = op === "concat" ? "_concat" : "_str_concat"
    return `${helper}(${emitRsRefArg(ctx, e, 0)}, ${emitRsRefArg(ctx, e, 1)})`
  }
  if (op === "slice") {
    const b = emitRsRefArg(ctx, e, 0)
    return `_slice(${b}, ${emitRsWideArg(ctx, e, 1)}, ${emitRsWideArg(ctx, e, 2)})`
  }
  const bitwise = ["xor", "bitAnd", "bitOr"].indexOf(op)
  if (bitwise >= 0) {
    return `_bitwise(${emitRsRefArg(ctx, e, 0)}, ${emitRsRefArg(ctx, e, 1)}, ${bitwise})`
  }
  return null
}

/** Whether a literal is the null literal. */
const emitRsIsNullLit = (e: Expr): boolean => {
  const lit = e.lit
  return e.kind === ExprKind.Lit && lit !== null && lit.kind === LitKind.Null
}

/** A comparison; an optional side met by a plain value compares with that value in `Some`. */
const emitRsCompare = (ctx: EmitRsContext, e: Expr, op: string): string => {
  const x0 = emitRsArgAt(ctx, e, 0)
  const x1 = emitRsArgAt(ctx, e, 1)
  if (x0 === null || x1 === null) {
    return ""
  }
  const l = emitRsTypeOf(ctx, x0)
  const r = emitRsTypeOf(ctx, x1)
  const side = l === "null" ? r : l
  const t: string | null = vocabIsIntType(side) ? emitRsOperands(ctx, e) : null
  let a = emitRsArg(ctx, e, 0, t)
  let b = emitRsArg(ctx, e, 1, t)
  if (vocabIsOptional(l) && !vocabIsOptional(r) && !emitRsIsNullLit(x1)) {
    b = `Some(${b})`
  }
  if (vocabIsOptional(r) && !vocabIsOptional(l) && !emitRsIsNullLit(x0)) {
    a = `Some(${a})`
  }
  return `(${a} ${op} ${b})`
}

/** An operator application. */
const emitRsOp = (ctx: EmitRsContext, e: Expr, want: string | null): string => {
  const op = e.name
  const viaHelper = emitRsHelperOp(ctx, e)
  if (viaHelper !== null) {
    return emitRsConv(viaHelper, emitRsTypeOf(ctx, e), want)
  }
  if (op === "len") {
    return emitRsConv(`(${emitRsPlaceArg(ctx, e, 0)}.len() as i32)`, "i32", want)
  }
  if (op === "unwrap") {
    const get = emitRsArgType(ctx, e, 0) === "string?" ? "s" : "b"
    return `u.${get}(${emitRsArg(ctx, e, 0, null)})`
  }
  if (op === "isNull") {
    return `${emitRsPlaceArg(ctx, e, 0)}.is_none()`
  }
  if (op === "notNull") {
    return `${emitRsPlaceArg(ctx, e, 0)}.is_some()`
  }
  if (op === "+" || op === "-" || op === "*") {
    const t = emitRsOperands(ctx, e)
    const method = op === "+" ? "wrapping_add" : op === "-" ? "wrapping_sub" : "wrapping_mul"
    const s = `(${emitRsArg(ctx, e, 0, t)}).${method}(${emitRsArg(ctx, e, 1, t)})`
    return emitRsConv(s, t, want)
  }
  if (op === "%") {
    const t = emitRsOperands(ctx, e)
    const a = emitRsArg(ctx, e, 0, t)
    const b = emitRsArg(ctx, e, 1, t)
    return emitRsConv(`(_rem((${a}) as i128, (${b}) as i128) as ${t})`, t, want)
  }
  if (op === "<" || op === "<=" || op === ">" || op === ">=" || op === "==" || op === "!=") {
    return emitRsCompare(ctx, e, op)
  }
  if (op === "and" || op === "or") {
    const parts: string[] = []
    for (let i = 0; i < e.args.length; i++) {
      parts.push(emitRsArg(ctx, e, i, null))
    }
    return `(${parts.join(op === "and" ? " && " : " || ")})`
  }
  if (op === "not") {
    return `(!${emitRsArg(ctx, e, 0, null)})`
  }
  if (op === "implies") {
    return `(!${emitRsArg(ctx, e, 0, null)} || ${emitRsArg(ctx, e, 1, null)})`
  }
  ctx.errors.push(`Rust has no spelling for the op ${op}`)
  return ""
}

/** `let`s for the lets that open `assert`, pushed onto `out`; answers the expression they scope over. */
const emitRsBindings = (ctx: EmitRsContext, assert: Expr, indent: string, out: string[]): Expr => {
  let e = assert
  while (e.kind === ExprKind.Let) {
    for (const b of e.binds) {
      const ty = emitRsTypeOf(ctx, b.value)
      out.push(`${indent}let v_${b.name} = ${emitRsExpr(ctx, b.value, null)};`)
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
const emitRsComment = (c: Contract, k: Clause): string => {
  const lines: string[] = []
  const body = emitClauseLines(c, k)
  for (let i = 0; i < body.length; i++) {
    lines.push(i > 0 && body[i] === "" ? "//" : `// ${body[i]}`)
  }
  return lines.join("\n")
}

/** A vector clause's check. */
const emitRsVector = (ctx: EmitRsContext, k: Clause): string => {
  const sig = emitRsFn(ctx, k.call)
  const expect = k.expect
  if (sig === null || expect === null) {
    ctx.errors.push(`${k.id}: no function ${k.call} or no expected value`)
    return ""
  }
  const name = emitRsQuote(emitTestName(k))
  const it = k.iterate
  if ((it?.slow ?? false) && !ctx.opts.slow) {
    return `fn ${emitClauseFn(k)}(t: &mut Suite) -> bool {\n    t.skip(${name}, "${EMIT_SLOW_SKIP}")\n}`
  }
  // literalsSettleVector checks a vector's arity at extraction; this guards a contract built by hand.
  if (k.args.length !== sig.params.length) {
    ctx.errors.push(`${k.id}: ${k.call} takes ${sig.params.length} arguments, got ${k.args.length}`)
    return ""
  }
  const args: string[] = []
  const params = sig.params
  for (let i = 0; i < k.args.length && i < params.length; i++) {
    args.push(emitRsLitArg(k.args[i], params[i].type))
  }
  const steps: string[] = it === null ? [] : emitRsIterate(ctx, k, sig, name)
  const call = it === null ? emitRsCall(sig, args) : "it_r"
  const ret = emitRsVt(sig.returns)
  let body = ""
  const tr = k.truncate
  if (ret === "bytes" && tr !== null) {
    body = `t.eq_str(${name}, &_hex_prefix(&${call}, ${tr.bytes}), "${emitLiteralHex(expect)}")`
  } else if (ret === "bytes") {
    body = `t.eq_str(${name}, &_hex_of(&${call}), "${emitLiteralHex(expect)}")`
  } else if (ret === "bytes?") {
    const want = expect.kind === LitKind.Null ? "null" : emitLiteralHex(expect)
    body = `t.eq_str(${name}, &_ohex(${call}), "${want}")`
  } else if (ret === "bool") {
    body = `t.eq_bool(${name}, ${call}, ${expect.flag ? "true" : "false"})`
  } else if (vocabIsIntType(ret)) {
    body = `t.eq_int(${name}, { let r: ${ret} = ${call}; r as i128 }, ${emitRsInt(expect.text, "i128")})`
  } else if (ret === "f64") {
    body = emitRsVectorF64(k, expect, name, call)
  } else if (ret === "string") {
    body = `t.eq_str(${name}, &${call}, ${emitRsQuote(expect.text)})`
  } else if (ret === "string?") {
    const want = expect.kind === LitKind.Null ? "null" : `"${expect.text}"`
    body = `t.eq_str(${name}, &_str_or_null(${call}), ${emitRsQuote(want)})`
  } else {
    ctx.errors.push(`${k.id}: Rust cannot check a ${sig.returns} result`)
  }
  return `fn ${emitClauseFn(k)}(t: &mut Suite) -> bool {\n${steps.join("\n")}${steps.length > 0 ? "\n" : ""}    ${body}\n}`
}

/** A parameter's owned Rust type: what an iterated vector's argument variable holds. */
const emitRsOwnedType = (t: string): string => {
  if (t === "bytes") {
    return "Vec<u8>"
  }
  if (t === "string") {
    return "String"
  }
  if (t === "bytes?") {
    return "Option<Vec<u8>>"
  }
  return t === "string?" ? "Option<String>" : t
}

/** Whether a value of type `t` is moved rather than copied, so a second use clones it. */
const emitRsIsOwned = (t: string): boolean => t === "bytes" || t === "string" || t === "bytes?" || t === "string?"

/** An owned variable passed to a parameter of type `t`: borrowed, as a borrowed option, or by value. */
const emitRsVarArg = (v: string, t: string): string => {
  if (t === "bytes" || t === "string") {
    return `&${v}`
  }
  return t === "bytes?" || t === "string?" ? `${v}.as_deref()` : v
}

/**
 * An iterated vector's calls, up to the last result bound as `it_r`: owned
 * arguments (`it_a<i>`, by position) start as the vector's and are rebound
 * to its `next` after each call; a None result at any step fails the clause,
 * naming the step.
 */
const emitRsIterate = (ctx: EmitRsContext, k: Clause, sig: FnSig, name: string): string[] => {
  const it = k.iterate
  if (it === null) {
    return []
  }
  const n = it.names.length
  // shapeIterate refuses names, next and parameters of different counts at extraction; this guards a contract built by hand.
  if (it.next.length !== n || sig.params.length !== n) {
    ctx.errors.push(
      `${k.id}: the iterate has ${n} names and ${it.next.length} next for ${sig.params.length} parameters`,
    )
    return []
  }
  const lines: string[] = []
  const types: string[] = []
  const vars: string[] = []
  const params = sig.params
  const kargs = k.args
  for (let i = 0; i < it.names.length && i < params.length && i < kargs.length; i++) {
    const p = params[i]
    const lit = kargs[i]
    const t = emitRsVt(p.type)
    types.push(t)
    const init =
      vocabIsOptional(t) && lit.kind !== LitKind.Null
        ? `Some(${emitRsLiteral(lit, vocabBaseOf(t))})`
        : emitRsLiteral(lit, t)
    lines.push(`    let mut it_a${i}: ${emitRsOwnedType(t)} = ${init};`)
    vars.push(emitRsVarArg(`it_a${i}`, t))
  }
  const optional = vocabIsOptional(emitRsVt(sig.returns))
  lines.push(`    for ${optional ? "it_i" : "_"} in 1..${it.count} {`)
  if (optional) {
    lines.push(`        let it_s = match ${emitRsCall(sig, vars)} {`)
    lines.push("            Some(v) => v,")
    lines.push(
      `            None => return t.fail(${name}, &format!("step {} of ${it.count}: ${sig.name} returned null", it_i)),`,
    )
    lines.push("        };")
  } else {
    lines.push(`        let it_s = ${emitRsCall(sig, vars)};`)
  }
  const next = it.next
  for (let i = 0; i < next.length && i < types.length; i++) {
    const e = next[i]
    const t = types[i]
    const from = e.kind === ExprKind.Call ? "it_s" : `it_a${toI32(it.names.indexOf(e.name))}`
    const v = emitRsIsOwned(t) ? `${from}.clone()` : from
    const wrap = e.kind === ExprKind.Call && vocabIsOptional(t) ? `Some(${v})` : v
    lines.push(`        let it_n${i} = ${wrap};`)
  }
  for (let i = 0; i < it.next.length; i++) {
    lines.push(`        it_a${i} = it_n${i};`)
  }
  lines.push("    }")
  lines.push(`    let it_r = ${emitRsCall(sig, vars)};`)
  if (optional) {
    lines.push("    if it_r.is_none() {")
    lines.push(`        return t.fail(${name}, "step ${it.count} of ${it.count}: ${sig.name} returned null");`)
    lines.push("    }")
  }
  return lines
}

/**
 * An f64 vector's check: bit for bit, or within its tolerance; a
 * non-finite expected value is checked bit for bit whatever the tolerance.
 */
const emitRsVectorF64 = (k: Clause, expect: Literal, name: string, call: string): string => {
  const want = emitRsF64(expect.text, expect.bits)
  const tol = k.tolerance
  if (tol === null || !emitF64IsFinite(expect.text, expect.bits)) {
    return `t.eq_f64_bits(${name}, ${call}, ${want})`
  }
  if (!tol.isUlps) {
    return `t.near_f64(${name}, ${call}, ${want}, ${emitRsF64(tol.abs, null)})`
  }
  return `t.near_ulps_f64(${name}, ${call}, ${want}, ${tol.ulps})`
}

/** One forall variable's sample table, as a slice: integers and bools as they are, bytes as hex, strings quoted. */
const emitRsTable = (
  ctx: EmitRsContext,
  name: string,
  type: string,
  j: i32,
  samples: Sample[],
  out: string[],
): void => {
  const vals: string[] = []
  let elem = "&str"
  for (const s of samples) {
    // The sampler gives every sample a value for each variable; this guards a table built by hand.
    if (j < 0 || j >= s.args.length) {
      const msg = `a sample has no value for ${name}`
      if (ctx.errors.indexOf(msg) < 0) {
        ctx.errors.push(msg)
      }
      return
    }
    const lit = s.args[j]
    if (vocabIsIntType(type)) {
      elem = type
      vals.push(lit.text)
    } else if (type === "bool") {
      elem = "bool"
      vals.push(lit.flag ? "true" : "false")
    } else if (type === "bytes") {
      vals.push(`"${emitLiteralHex(lit)}"`)
    } else {
      vals.push(emitRsQuote(lit.text))
    }
  }
  out.push(`    let table_${name}: &[${elem}] = &[`)
  for (const v of vals) {
    out.push(`        ${v},`)
  }
  out.push("    ];")
}

/** A property clause's check: a loop over its baked samples. */
const emitRsProperty = (ctx: EmitRsContext, k: Clause, samples: Sample[]): string => {
  const name = emitRsQuote(emitTestName(k))
  const count = samples.length
  const out: string[] = [`fn ${emitClauseFn(k)}(t: &mut Suite) -> bool {`]
  const assert = k.assert
  if (count === 0 || assert === null) {
    out.push(`    t.skip(${name}, "no samples")`)
    out.push("}")
    return out.join("\n")
  }
  for (let j = 0; j < k.forall.length; j++) {
    const v = k.forall[j]
    emitRsTable(ctx, v.name, v.type, j, samples, out)
  }
  const undefinedWhy = emitUndefinedWhy(assert)
  const usesUnwrap = undefinedWhy !== null
  out.push(`    for i in 0..${count} {`)
  ctx.env = new TypeEnv(ctx.c.functions, true)
  const shown: string[] = []
  const shownArgs: string[] = []
  for (const v of k.forall) {
    typeEnvBind(ctx.env, v.name, v.type)
    if (v.type === "bytes") {
      out.push(`        let v_${v.name}: Vec<u8> = _h(table_${v.name}[i]);`)
      shown.push(`len(${v.name}) = {}`)
      shownArgs.push(`v_${v.name}.len()`)
    } else if (v.type === "string") {
      out.push(`        let v_${v.name}: String = table_${v.name}[i].to_string();`)
      shown.push(`len(${v.name}) = {}`)
      shownArgs.push(`v_${v.name}.len()`)
    } else {
      out.push(`        let v_${v.name}: ${v.type} = table_${v.name}[i];`)
      shown.push(`${v.name} = {}`)
      shownArgs.push(`v_${v.name}`)
    }
  }
  if (usesUnwrap) {
    out.push("        let u = Unwrap::new();")
  }
  const body = emitRsBindings(ctx, assert, "        ", out)
  out.push(`        let holds: bool = ${emitRsExpr(ctx, body, null)};`)
  const where = `sample {} of ${count} (${shown.join(", ")}): {}`
  const whereArgs = `i + 1, ${shownArgs.join(", ")}`
  if (usesUnwrap) {
    out.push("        if u.saw_null() || !holds {")
    out.push(
      `            let why = if u.saw_null() { ${emitRsQuote(undefinedWhy ?? "")} } else { "the assertion is false" };`,
    )
  } else {
    out.push("        if !holds {")
    out.push(`            let why = "the assertion is false";`)
  }
  out.push(`            return t.fail(${name}, &format!("${where}", ${whereArgs}, why));`)
  out.push("        }")
  out.push("    }")
  out.push(`    t.ok(${emitRsQuote(`${emitTestName(k)} — ${count} samples`)})`)
  out.push("}")
  return out.join("\n")
}

/**
 * Where the test finds `module` when it is one of `localModules`, or null
 * when it is not one (`emitRsProgram` refuses options whose two lists differ in length).
 */
const emitRsLocalImport = (opts: EmitOptions, module: string): string | null => {
  for (let i = 0; i < opts.localModules.length && i < opts.localImports.length; i++) {
    if (opts.localModules[i] === module) {
      return opts.localImports[i]
    }
  }
  return null
}

/** The uses of the functions under test, by module: by crate path, or a `#[path]` module of the file a package places. */
const emitRsImports = (ctx: EmitRsContext, called: string[]): string => {
  const fns: FnSig[] = []
  const modules: string[] = []
  for (const n of emitSortedUnique(called)) {
    const f = emitRsFn(ctx, n)
    if (f !== null) {
      fns.push(f)
      const mod = f.module ?? ctx.c.target.module
      if (modules.indexOf(mod) < 0) {
        modules.push(mod)
      }
    }
  }
  const lines: string[] = []
  for (let i = 0; i < modules.length; i++) {
    const mod = modules[i]
    const names: string[] = []
    for (const f of fns) {
      if ((f.module ?? ctx.c.target.module) === mod) {
        names.push(emitRsName(f))
      }
    }
    const local = emitRsLocalImport(ctx.opts, mod)
    if (local === null) {
      lines.push(`use ${emitRsModule(ctx.c, mod)}::{${names.join(", ")}};`)
    } else {
      const m = `_m${i}`
      lines.push(`#[path = ${emitRsQuote(`${local}.rs`)}]`)
      lines.push(`mod ${m};`)
      lines.push(`use ${m}::{${names.join(", ")}};`)
    }
  }
  return lines.join("\n")
}

/** The lints every test allows: its names follow the clause ids, and it carries helpers a contract may not use. */
const EMIT_RS_HEAD: string = "#![allow(non_snake_case, dead_code, unused)]"

/** The suite and the helpers every test shares. */
const EMIT_RS_RUNTIME: string = `/// One PASS, FAIL or SKIP line per check, then a tally: nish/testing's transcript.
struct Suite {
    name: String,
    passed: u32,
    failed: u32,
    skipped: u32,
    failures: Vec<String>,
    detail: String,
}

impl Suite {
    fn new(name: &str) -> Suite {
        Suite { name: name.to_string(), passed: 0, failed: 0, skipped: 0, failures: Vec::new(), detail: String::new() }
    }

    fn ok(&mut self, name: &str) -> bool {
        self.passed += 1;
        println!("PASS  {}", name);
        true
    }

    fn fail(&mut self, name: &str, detail: &str) -> bool {
        self.failed += 1;
        self.failures.push(name.to_string());
        self.detail = detail.to_string();
        println!("FAIL  {}", name);
        if !detail.is_empty() {
            println!("      {}", detail);
        }
        false
    }

    fn skip(&mut self, name: &str, reason: &str) -> bool {
        self.skipped += 1;
        self.detail = reason.to_string();
        println!("SKIP  {} ({})", name, reason);
        true
    }

    fn done(&self) -> i32 {
        if !self.failures.is_empty() {
            println!("failed: {}", self.failures.join(", "));
        }
        println!("{}: {} passed, {} failed, {} skipped", self.name, self.passed, self.failed, self.skipped);
        if self.failed > 0 { 1 } else { 0 }
    }

    fn eq_str(&mut self, name: &str, actual: &str, expected: &str) -> bool {
        if actual == expected {
            return self.ok(name);
        }
        self.fail(name, &format!("expected \\"{}\\", got \\"{}\\"", expected, actual))
    }

    fn eq_int(&mut self, name: &str, actual: i128, expected: i128) -> bool {
        if actual == expected {
            return self.ok(name);
        }
        self.fail(name, &format!("expected {}, got {}", expected, actual))
    }

    fn eq_bool(&mut self, name: &str, actual: bool, expected: bool) -> bool {
        if actual == expected {
            return self.ok(name);
        }
        self.fail(name, &format!("expected {}, got {}", expected, actual))
    }

    fn eq_f64_bits(&mut self, name: &str, actual: f64, expected: f64) -> bool {
        if actual.to_bits() == expected.to_bits() {
            return self.ok(name);
        }
        self.fail(name, &format!("expected {:?}, got {:?} (other binary64 bits)", expected, actual))
    }

    fn near_f64(&mut self, name: &str, actual: f64, expected: f64, tolerance: f64) -> bool {
        if (actual - expected).abs() <= tolerance {
            return self.ok(name);
        }
        self.fail(name, &format!("expected {:?} +/- {:?}, got {:?}", expected, tolerance, actual))
    }

    fn near_ulps_f64(&mut self, name: &str, actual: f64, expected: f64, ulps: i128) -> bool {
        if !actual.is_nan() && !expected.is_nan() && (_ordered(actual) - _ordered(expected)).abs() <= ulps {
            return self.ok(name);
        }
        self.fail(name, &format!("expected {:?} within {} ulps, got {:?}", expected, ulps, actual))
    }
}

/// A clause's check; one that panics fails, with what it panicked with.
fn _run(t: &mut Suite, check: fn(&mut Suite) -> bool, name: &str) -> bool {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| check(t))) {
        Ok(passed) => passed,
        Err(e) => {
            let why = match e.downcast_ref::<&str>() {
                Some(s) => s.to_string(),
                None => match e.downcast_ref::<String>() {
                    Some(s) => s.clone(),
                    None => "a panic".to_string(),
                },
            };
            t.fail(name, &format!("panicked: {}", why))
        }
    }
}

/// x's place on the line of binary64 bit patterns, where -0 meets +0.
fn _ordered(x: f64) -> i128 {
    let n = x.to_bits() as i64;
    if n < 0 { -((n & 0x7fff_ffff_ffff_ffff) as i128) } else { n as i128 }
}

fn _h(hex: &str) -> Vec<u8> {
    (0..hex.len() / 2).map(|i| u8::from_str_radix(&hex[2 * i..2 * i + 2], 16).unwrap()).collect()
}

fn _hex_of(b: &[u8]) -> String {
    b.iter().map(|x| format!("{:02x}", x)).collect()
}

fn _hex_prefix(b: &[u8], n: usize) -> String {
    if b.len() < n {
        return format!("a {}-byte result, shorter than the {} bytes it is truncated to", b.len(), n);
    }
    _hex_of(&b[..n])
}

fn _ohex(b: Option<Vec<u8>>) -> String {
    match b {
        Some(v) => _hex_of(&v),
        None => "null".to_string(),
    }
}

fn _str_or_null(s: Option<String>) -> String {
    match s {
        Some(v) => format!("\\"{}\\"", v),
        None => "null".to_string(),
    }
}

/// A bytes result as Vec<u8>, whatever form (Vec, array, slice) it came back in.
fn _b<T: AsRef<[u8]>>(x: T) -> Vec<u8> {
    x.as_ref().to_vec()
}

fn _ob<T: AsRef<[u8]>>(x: Option<T>) -> Option<Vec<u8>> {
    x.map(|v| v.as_ref().to_vec())
}

/// A string result as String, whether it came back owned or borrowed.
fn _s<T: AsRef<str>>(x: T) -> String {
    x.as_ref().to_string()
}

fn _os<T: AsRef<str>>(x: Option<T>) -> Option<String> {
    x.map(|v| v.as_ref().to_string())
}

/// The contract's a % b: truncating, and 0 when b is 0.
fn _rem(a: i128, b: i128) -> i128 {
    if b == 0 { 0 } else { a % b }
}

/// b[lo, hi), both ends clamped into b.
fn _slice(b: &[u8], lo: i128, hi: i128) -> Vec<u8> {
    let n = b.len() as i128;
    let lo = lo.clamp(0, n);
    let hi = hi.clamp(lo, n);
    b[lo as usize..hi as usize].to_vec()
}

fn _fill(v: i128, n: i128) -> Vec<u8> {
    vec![(v & 255) as u8; n.max(0) as usize]
}

/// A copy of b with bit (mod 8 * len(b)) inverted.
fn _flip_bit(b: &[u8], bit: i128) -> Vec<u8> {
    let mut out = b.to_vec();
    if !out.is_empty() {
        let at = bit.rem_euclid(out.len() as i128 * 8);
        out[(at >> 3) as usize] ^= 1 << (at & 7);
    }
    out
}

/// a and b byte by byte (k 0: xor, 1: and, 2: or); the shorter reads as zeros.
fn _bitwise(a: &[u8], b: &[u8], k: u8) -> Vec<u8> {
    (0..a.len().max(b.len()))
        .map(|i| {
            let x = *a.get(i).unwrap_or(&0);
            let y = *b.get(i).unwrap_or(&0);
            match k {
                1 => x & y,
                2 => x | y,
                _ => x ^ y,
            }
        })
        .collect()
}

/// n's w bytes, big-endian when be, a negative n in two's complement.
fn _int_bytes(n: i128, w: usize, be: bool) -> Vec<u8> {
    let x = n as u128;
    (0..w).map(|i| (x >> (8 * if be { w - 1 - i } else { i })) as u8).collect()
}

/// The integer b's w bytes hold; any other length records on u, so the sample fails.
fn _bytes_int(u: &Unwrap, b: &[u8], w: usize, be: bool) -> u64 {
    if b.len() != w {
        u.saw.set(true);
        return 0;
    }
    (0..w).fold(0u64, |x, i| x << 8 | b[if be { i } else { w - 1 - i }] as u64)
}

fn _utf8(s: &str) -> Vec<u8> {
    s.as_bytes().to_vec()
}

fn _str_len(s: &str) -> i32 {
    s.len() as i32
}

/// The byte at i as a string, or "" out of range.
fn _char_at(s: &str, i: i128) -> String {
    let b = s.as_bytes();
    if i < 0 || i >= b.len() as i128 {
        return String::new();
    }
    String::from_utf8_lossy(&b[i as usize..i as usize + 1]).into_owned()
}

fn _ascii(b: &[u8]) -> Option<String> {
    if b.iter().any(|&x| x >= 128) {
        return None;
    }
    Some(b.iter().map(|&x| x as char).collect())
}

/// s with every character in [lo, hi] moved by delta (ASCII case mapping).
fn _shift_case(s: &str, lo: u32, hi: u32, delta: i32) -> String {
    s.chars()
        .map(|c| {
            let n = c as u32;
            if lo <= n && n <= hi { char::from_u32((n as i32 + delta) as u32).unwrap_or(c) } else { c }
        })
        .collect()
}

fn _concat(a: &[u8], b: &[u8]) -> Vec<u8> {
    [a, b].concat()
}

fn _str_concat(a: &str, b: &str) -> String {
    format!("{}{}", a, b)
}

/// unwrap that records a None and stands in empty, so the sample fails.
struct Unwrap {
    saw: std::cell::Cell<bool>,
}

impl Unwrap {
    fn new() -> Unwrap {
        Unwrap { saw: std::cell::Cell::new(false) }
    }

    fn b(&self, x: Option<Vec<u8>>) -> Vec<u8> {
        match x {
            Some(v) => v,
            None => {
                self.saw.set(true);
                Vec::new()
            }
        }
    }

    fn s(&self, x: Option<String>) -> String {
        match x {
            Some(v) => v,
            None => {
                self.saw.set(true);
                String::new()
            }
        }
    }

    fn saw_null(&self) -> bool {
        self.saw.get()
    }
}`

/** The hook every cargo `#[test]` calls. */
const EMIT_RS_CARGO: string = `/// A clause's check as a cargo test: a failure panics with its detail.
#[cfg(test)]
fn _cargo(check: fn(&mut Suite) -> bool, name: &str) {
    let mut t = Suite::new(name);
    let passed = _run(&mut t, check, name);
    assert!(passed, "{}", t.detail);
}`

/** `main`: every clause run in order, then the end line with the nonce `spec run` passes. */
const emitRsMain = (c: Contract): string => {
  const lines: string[] = [
    "fn main() {",
    "    std::panic::set_hook(Box::new(|_| {}));",
    `    let mut t = Suite::new(${emitRsQuote(c.contract)});`,
    "    let mut ran = String::new();",
  ]
  for (const k of c.clauses) {
    const run = `_run(&mut t, ${emitClauseFn(k)}, ${emitRsQuote(emitTestName(k))})`
    lines.push(`    ran.push(if ${run} { '1' } else { '0' });`)
  }
  lines.push("    let code = t.done();")
  lines.push(`    let nonce = std::env::args().nth(1).unwrap_or_else(|| "-".to_string());`)
  lines.push(`    println!("vector-done {} {}", nonce, ran);`)
  lines.push("    std::process::exit(code);")
  lines.push("}")
  return lines.join("\n")
}

/** A clause's cargo test; a property with no samples, or a slow vector unless `runSlow`, is ignored, as its check would skip. */
const emitRsCargoTest = (table: SampleTable, k: Clause, runSlow: boolean): string => {
  const fn = emitClauseFn(k)
  const lines: string[] = ["#[test]"]
  const it = k.iterate
  if (k.kind !== ClauseKind.Vector && (checkSamplesOf(table, k.id).length === 0 || k.assert === null)) {
    lines.push(`#[ignore = "no samples"]`)
  } else if ((it?.slow ?? false) && !runSlow) {
    lines.push(`#[ignore = "${EMIT_SLOW_SKIP}"]`)
  }
  lines.push(`fn test_${fn.substring(7, fn.length)}() {`)
  lines.push(`    _cargo(${fn}, ${emitRsQuote(emitTestName(k))});`)
  lines.push("}")
  return lines.join("\n")
}

/**
 * The whole Rust test for a contract: a header naming the contract's
 * sha256, the uses of the functions under test, the suite and helpers, one
 * check per clause under the requirements it covers, `main`, and with the
 * cargo harness one `#[test] fn test_<clause>` per clause.
 *
 * @param c the contract, already checked
 * @param table the property samples `checkContract` chose
 * @param opts the header's regenerate command, the contract's sha256, and the
 *   modules `--package` places
 * @param harness `standalone` or `cargo`
 * @returns the test's text, or every reason Rust cannot express the contract
 */
export const emitRsProgram = (
  c: Contract,
  table: SampleTable,
  opts: EmitOptions,
  harness: string,
): Result<string, string[]> => {
  if (opts.localImports.length !== opts.localModules.length) {
    return Err([`${opts.localModules.length} local modules but ${opts.localImports.length} import paths`])
  }
  const refused = emitRsRefusals(c)
  if (refused.length > 0) {
    return Err(refused)
  }
  const ctx = new EmitRsContext(c, opts)
  const bodies: string[] = []
  const called: string[] = []
  for (const k of c.clauses) {
    if (k.kind === ClauseKind.Vector) {
      called.push(k.call)
      bodies.push(`${emitRsComment(c, k)}\n${emitRsVector(ctx, k)}`)
    } else {
      const assert = k.assert
      if (assert !== null) {
        for (const n of typeCallsIn(assert)) {
          called.push(n)
        }
      }
      bodies.push(`${emitRsComment(c, k)}\n${emitRsProperty(ctx, k, checkSamplesOf(table, k.id))}`)
    }
  }
  if (ctx.errors.length > 0) {
    return Err(ctx.errors)
  }
  const header = emitHeaderLines(c, opts)
    .map((l: string): string => (l === "" ? "//" : `// ${l}`))
    .join("\n")
  const parts: string[] = [`${header}\n${EMIT_RS_HEAD}`]
  const imports = emitRsImports(ctx, called)
  if (imports !== "") {
    parts.push(imports)
  }
  parts.push(EMIT_RS_RUNTIME)
  for (const b of bodies) {
    parts.push(b)
  }
  parts.push(emitRsMain(c))
  if (harness === "cargo") {
    parts.push(EMIT_RS_CARGO)
    for (const k of c.clauses) {
      parts.push(emitRsCargoTest(table, k, opts.slow))
    }
  }
  return Ok(`${parts.join("\n\n")}\n`)
}
