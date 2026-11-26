/**
 * `spec/emit/typescript` — a contract and its samples as a TypeScript test.
 *
 * The test is one ES module that Node runs as it is, by its built-in type
 * stripping, with no npm package and no tsc: `node test.ts <nonce>` checks
 * every clause and prints the transcript `vector spec run` judges, line for
 * line what the Nish test prints. With the node harness it also defines one
 * `test()` per clause from `node:test`, so `node --test` runs the same checks.
 *
 * The functions under test are found by the language table's rules: each
 * name in lowerCamelCase (or the contract's typescript override), imported
 * from the module's path, or from the `.ts` file `--package` places it in. A
 * bytes value is a `Uint8Array`, an integer up to 32 bits a `number`, an i64
 * or u64 a `bigint`, a refusing return `null` and an absent optional input
 * `undefined`. JavaScript's numbers are binary64, so the test writes the
 * contract's semantics out: `+`, `-` and `*` are exact in bigint and wrap to
 * their operands' width, `%` truncates and is 0 on a zero divisor, and
 * `strLen` and `charAt` count UTF-8 bytes.
 */

import { langModuleIn, langNameIn } from "../../lang/names"
import { Sample, SampleTable, checkSamplesOf } from "../check"
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
import { EMIT_SLOW_SKIP, emitF64IsFinite, emitLiteralHex, emitQuote } from "./lit"
import { emitTargetOutRefusal, emitTargetWindowRefusal, emitTargetWordsRefusal } from "./target"

/** What emitting one TypeScript test has gathered so far. */
class EmitTsContext {
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

/** JavaScript's reserved words, strict mode's included, which no function under test can be named. */
const emitTsKeywords = (): string[] => [
  "arguments",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "eval",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]

/** The names the test itself defines or uses, which no function under test can take. */
const emitTsTaken = (): string[] => [
  "Array",
  "BigInt",
  "DataView",
  "Error",
  "Infinity",
  "Math",
  "NaN",
  "Number",
  "Object",
  "String",
  "Suite",
  "TextDecoder",
  "TextEncoder",
  "Uint8Array",
  "Unwrap",
  "code",
  "console",
  "holds",
  "i",
  "main",
  "nonce",
  "process",
  "ran",
  "t",
  "test",
  "u",
  "undefined",
  "why",
]

/**
 * A contract function's name in the test: its typescript override, or the
 * language table's lowerCamelCase.
 *
 * @param f the function
 * @returns the TypeScript name
 */
export const emitTsName = (f: FnSig): string => langNameIn("typescript", f.name, true, f.names)

/** The path a contract module is imported from. */
const emitTsModule = (c: Contract, module: string): string =>
  langModuleIn("typescript", module, module === c.target.module ? c.target.modules : null)

const emitTsFn = (ctx: EmitTsContext, name: string): FnSig | null => {
  for (const f of ctx.c.functions) {
    if (f.name === name) {
      return f
    }
  }
  return null
}

/** Why a function under test cannot keep its TypeScript name in the test, or null. */
const emitTsNameRefusal = (f: FnSig): string | null => {
  const n = emitTsName(f)
  if (emitTsKeywords().indexOf(n) >= 0) {
    return `${f.name}: its TypeScript name ${n} is a reserved word: give it a typescript name in the contract`
  }
  const reserved =
    emitTsTaken().indexOf(n) >= 0 ||
    n.startsWith("_") ||
    n.startsWith("clause_") ||
    n.startsWith("test_") ||
    n.startsWith("v_") ||
    n.startsWith("table_")
  if (reserved) {
    return `${f.name}: its TypeScript name ${n} is one the test uses for its own: give it a typescript name in the contract`
  }
  return null
}

/**
 * What in a contract the TypeScript test cannot express, found before any
 * output: a function whose TypeScript name is a reserved word or one the test
 * uses itself (`Suite`, `main`, `t`, `test`, `clause_*`, `_`-prefixed), two
 * functions with one TypeScript name, two clause ids that make the same
 * check name, and an f64 forall variable, which the sampler does not draw yet.
 *
 * @param c the contract
 * @returns one message per refusal; empty when TypeScript can express it all
 */
export const emitTsRefusals = (c: Contract): string[] => {
  const out: string[] = []
  const names: string[] = []
  for (const f of c.functions) {
    const words = emitTargetWordsRefusal(f, "TypeScript")
    if (words !== null) {
      out.push(words)
    }
    const window = emitTargetWindowRefusal(f, "TypeScript")
    if (window !== null) {
      out.push(window)
    }
    const buffer = emitTargetOutRefusal(f, "TypeScript")
    if (buffer !== null) {
      out.push(buffer)
    }
    const why = emitTsNameRefusal(f)
    if (why !== null) {
      out.push(why)
    }
    const n = emitTsName(f)
    if (names.indexOf(n) >= 0) {
      out.push(`${f.name}: its TypeScript name ${n} is another function's too`)
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

/** A type's value type, secret bytes read as bytes. */
const emitTsVt = (t: string): string => vocabValueType(t)

/** Whether an integer type is a bigint in the test: i64 and u64. */
const emitTsIsBig = (t: string): boolean => t === "i64" || t === "u64"

/**
 * An integer literal of type `ty`: a bigint (`5n`) for i64 and u64, else a
 * number, in parentheses when negative.
 *
 * @param text the decimal text
 * @param ty the integer type
 * @returns the TypeScript literal
 */
export const emitTsInt = (text: string, ty: string): string => {
  const lit = emitTsIsBig(ty) ? `${text}n` : text
  return text.startsWith("-") ? `(${lit})` : lit
}

/**
 * An f64 literal, from its binary64 bits so -0 and the infinities are the
 * values the contract means (a NaN's payload JavaScript does not keep).
 *
 * @param text the literal's decimal text
 * @param bits its bits as 16 hex digits, or null to compute them
 * @returns the TypeScript expression
 */
export const emitTsF64 = (text: string, bits: string | null): string =>
  `_f64("${bits ?? contractF64Bits(contractF64Parse(text))}")`

/** An int literal where an integer of type `want` goes: at `want` when it fits, else at its own type and wrapped. */
const emitTsIntLit = (text: string, want: string | null): string => {
  const w: string | null = want === null ? null : typeIntBase(want)
  if (w !== null && vocabFitsInt(text, w)) {
    return emitTsInt(text, w)
  }
  const lit = emitTsInt(text, typeOfInt(text) ?? "u64")
  return w === null ? lit : `_wrap(${lit}, "${w}")`
}

/** A literal as a value. */
const emitTsLiteral = (lit: Literal, want: string | null): string => {
  if (lit.kind === LitKind.Null) {
    return "null"
  }
  if (lit.kind === LitKind.Bool) {
    return lit.flag ? "true" : "false"
  }
  if (lit.kind === LitKind.Int) {
    return emitTsIntLit(lit.text, want)
  }
  if (lit.kind === LitKind.F64) {
    return emitTsF64(lit.text, lit.bits)
  }
  if (lit.kind === LitKind.Str) {
    return emitQuote(lit.text)
  }
  return `_h("${emitLiteralHex(lit)}")`
}

/** A literal passed straight to a parameter of type `ty`: an absent optional input is `undefined`. */
const emitTsLitArg = (lit: Literal, ty: string): string => {
  if (lit.kind === LitKind.Null) {
    return "undefined"
  }
  return emitTsLiteral(lit, emitTsVt(ty))
}

const emitTsTypeOf = (ctx: EmitTsContext, e: Expr): string => {
  const errors: string[] = []
  return emitTsVt(typeOf(e, ctx.env, "", errors) ?? "null")
}

/** An integer of type `natural` where `want` is wanted, wrapped to `want` when the two differ. */
const emitTsConv = (s: string, natural: string, want: string | null): string => {
  const w: string | null = want === null ? null : typeIntBase(want)
  if (w !== null && natural !== w && vocabIsIntType(natural)) {
    return `_wrap(${s}, "${w}")`
  }
  return s
}

/** The integer type an arithmetic or comparison op's operands share. */
const emitTsOperands = (ctx: EmitTsContext, e: Expr): string => {
  for (const x of e.args) {
    if (x.kind !== ExprKind.Lit) {
      const t = emitTsTypeOf(ctx, x)
      if (vocabIsIntType(t)) {
        return t
      }
    }
  }
  return emitTsArgType(ctx, e, 0)
}

/** Records `msg` in `errors` unless it is already there. */
const emitTsAddOnce = (errors: string[], msg: string): void => {
  if (errors.indexOf(msg) < 0) {
    errors.push(msg)
  }
}

/**
 * Argument `i` of an op, or null once its absence is recorded: a checked
 * contract gives every op its arity, so only a contract built by hand lacks one.
 */
const emitTsArgAt = (ctx: EmitTsContext, e: Expr, i: i32): Expr | null => {
  if (i >= 0 && i < e.args.length) {
    return e.args[i]
  }
  emitTsAddOnce(ctx.errors, `${e.name} has no argument ${i}`)
  return null
}

/** The type of argument `i` of an op ("null" once its absence is recorded). */
const emitTsArgType = (ctx: EmitTsContext, e: Expr, i: i32): string => {
  const x = emitTsArgAt(ctx, e, i)
  return x === null ? "null" : emitTsTypeOf(ctx, x)
}

/** Argument `i` of an op, wanted at `want` ("" once its absence is recorded). */
const emitTsArg = (ctx: EmitTsContext, e: Expr, i: i32, want: string | null): string => {
  const x = emitTsArgAt(ctx, e, i)
  return x === null ? "" : emitTsExpr(ctx, x, want)
}

/** Whether a literal is the null literal. */
const emitTsIsNullLit = (e: Expr): boolean => {
  const lit = e.lit
  return e.kind === ExprKind.Lit && lit !== null && lit.kind === LitKind.Null
}

/** An argument passed to a parameter of type `ty`; an optional parameter's absent value is `undefined`. */
const emitTsCallArg = (ctx: EmitTsContext, e: Expr, ty: string): string => {
  const t = emitTsVt(ty)
  if (vocabIsOptional(t)) {
    if (emitTsIsNullLit(e)) {
      return "undefined"
    }
    if (vocabIsOptional(emitTsTypeOf(ctx, e))) {
      return `(${emitTsExpr(ctx, e, null)} ?? undefined)`
    }
  }
  return emitTsExpr(ctx, e, t)
}

/** A call of a function under test; a bytes result is made a `Uint8Array` whatever view it came back as. */
const emitTsCall = (sig: FnSig, args: string[]): string => {
  const call = `${emitTsName(sig)}(${args.join(", ")})`
  const ret = emitTsVt(sig.returns)
  return ret === "bytes" || ret === "bytes?" ? `_b(${call})` : call
}

/** An expression where a value of type `want` goes (null: its own type). */
const emitTsExpr = (ctx: EmitTsContext, e: Expr, want: string | null): string => {
  if (e.kind === ExprKind.Var) {
    return emitTsConv(`v_${e.name}`, emitTsTypeOf(ctx, e), want)
  }
  if (e.kind === ExprKind.Call) {
    const sig = emitTsFn(ctx, e.name)
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
      args.push(emitTsCallArg(ctx, e.args[i], params[i].type))
    }
    return emitTsConv(emitTsCall(sig, args), emitTsVt(sig.returns), want)
  }
  if (e.kind === ExprKind.Let) {
    ctx.errors.push("a let may only open the assert")
    return ""
  }
  if (e.kind === ExprKind.Lit) {
    const lit = e.lit
    return lit === null ? "" : emitTsLiteral(lit, want)
  }
  return emitTsOp(ctx, e, want)
}

/** The ops on bytes and strings, which go through a helper; null for any other op. */
const emitTsHelperOp = (ctx: EmitTsContext, e: Expr): string | null => {
  const op = e.name
  if (vocabHas(vocabWriteOps(), op)) {
    return `_int_bytes(${emitTsArg(ctx, e, 0, null)}, ${vocabByteWidth(op)}, ${vocabBigEndian(op)})`
  }
  if (vocabHas(vocabReadOps(), op)) {
    const b = emitTsArg(ctx, e, 0, null)
    return `_bytes_int(u, ${b}, ${vocabByteWidth(op)}, ${vocabBigEndian(op)}, "${vocabReadType(op)}")`
  }
  if (op === "zeros" || op === "utf8" || op === "ascii" || op === "strLen") {
    const helper = op === "zeros" ? "_fill(0, " : op === "utf8" ? "_utf8(" : op === "ascii" ? "_ascii(" : "_str_len("
    return `${helper}${emitTsArg(ctx, e, 0, null)})`
  }
  if (op === "fill" || op === "flipBit" || op === "charAt" || op === "concat" || op === "strConcat") {
    const helper =
      op === "fill"
        ? "_fill"
        : op === "flipBit"
          ? "_flip_bit"
          : op === "charAt"
            ? "_char_at"
            : op === "concat"
              ? "_concat"
              : "_str_concat"
    return `${helper}(${emitTsArg(ctx, e, 0, null)}, ${emitTsArg(ctx, e, 1, null)})`
  }
  if (op === "slice") {
    const b = emitTsArg(ctx, e, 0, null)
    return `_slice(${b}, ${emitTsArg(ctx, e, 1, null)}, ${emitTsArg(ctx, e, 2, null)})`
  }
  const bitwise = ["xor", "bitAnd", "bitOr"].indexOf(op)
  if (bitwise >= 0) {
    return `_bitwise(${emitTsArg(ctx, e, 0, null)}, ${emitTsArg(ctx, e, 1, null)}, ${bitwise})`
  }
  if (op === "lower") {
    return `_shift_case(${emitTsArg(ctx, e, 0, null)}, 65, 90, 32)`
  }
  if (op === "upper") {
    return `_shift_case(${emitTsArg(ctx, e, 0, null)}, 97, 122, -32)`
  }
  return null
}

/** A comparison: an order between integers as it is, an equality by value (bytes byte for byte). */
const emitTsCompare = (ctx: EmitTsContext, e: Expr, op: string): string => {
  const l = emitTsArgType(ctx, e, 0)
  const side = l === "null" ? emitTsArgType(ctx, e, 1) : l
  const t: string | null = vocabIsIntType(side) ? emitTsOperands(ctx, e) : null
  const a = emitTsArg(ctx, e, 0, t)
  const b = emitTsArg(ctx, e, 1, t)
  if (op === "==") {
    return `_eq(${a}, ${b})`
  }
  if (op === "!=") {
    return `(!_eq(${a}, ${b}))`
  }
  return `(${a} ${op} ${b})`
}

/** An operator application. */
const emitTsOp = (ctx: EmitTsContext, e: Expr, want: string | null): string => {
  const op = e.name
  const viaHelper = emitTsHelperOp(ctx, e)
  if (viaHelper !== null) {
    return emitTsConv(viaHelper, emitTsTypeOf(ctx, e), want)
  }
  if (op === "len") {
    return emitTsConv(`${emitTsArg(ctx, e, 0, null)}.length`, "i32", want)
  }
  if (op === "unwrap") {
    const empty = emitTsArgType(ctx, e, 0) === "string?" ? `""` : "new Uint8Array(0)"
    return `u.get(${emitTsArg(ctx, e, 0, null)}, ${empty})`
  }
  if (op === "isNull") {
    return `(${emitTsArg(ctx, e, 0, null)} === null)`
  }
  if (op === "notNull") {
    return `(${emitTsArg(ctx, e, 0, null)} !== null)`
  }
  if (op === "+" || op === "-" || op === "*") {
    const t = emitTsOperands(ctx, e)
    const a = emitTsArg(ctx, e, 0, t)
    const b = emitTsArg(ctx, e, 1, t)
    return emitTsConv(`_wrap(BigInt(${a}) ${op} BigInt(${b}), "${t}")`, t, want)
  }
  if (op === "%") {
    const t = emitTsOperands(ctx, e)
    return emitTsConv(`_rem(${emitTsArg(ctx, e, 0, t)}, ${emitTsArg(ctx, e, 1, t)}, "${t}")`, t, want)
  }
  if (op === "<" || op === "<=" || op === ">" || op === ">=" || op === "==" || op === "!=") {
    return emitTsCompare(ctx, e, op)
  }
  if (op === "and" || op === "or") {
    const parts: string[] = []
    for (let i = 0; i < e.args.length; i++) {
      parts.push(emitTsArg(ctx, e, i, null))
    }
    return `(${parts.join(op === "and" ? " && " : " || ")})`
  }
  if (op === "not") {
    return `(!${emitTsArg(ctx, e, 0, null)})`
  }
  if (op === "implies") {
    return `(!${emitTsArg(ctx, e, 0, null)} || ${emitTsArg(ctx, e, 1, null)})`
  }
  ctx.errors.push(`TypeScript has no spelling for the op ${op}`)
  return ""
}

/** `const`s for the lets that open `assert`, pushed onto `out`; answers the expression they scope over. */
const emitTsBindings = (ctx: EmitTsContext, assert: Expr, indent: string, out: string[]): Expr => {
  let e = assert
  while (e.kind === ExprKind.Let) {
    for (const b of e.binds) {
      const ty = emitTsTypeOf(ctx, b.value)
      out.push(`${indent}const v_${b.name} = ${emitTsExpr(ctx, b.value, null)}`)
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
const emitTsComment = (c: Contract, k: Clause): string => {
  const lines: string[] = []
  const body = emitClauseLines(c, k)
  for (let i = 0; i < body.length; i++) {
    lines.push(i > 0 && body[i] === "" ? "//" : `// ${body[i]}`)
  }
  return lines.join("\n")
}

/** A vector clause's check. */
const emitTsVector = (ctx: EmitTsContext, k: Clause): string => {
  const sig = emitTsFn(ctx, k.call)
  const expect = k.expect
  if (sig === null || expect === null) {
    ctx.errors.push(`${k.id}: no function ${k.call} or no expected value`)
    return ""
  }
  // literalsSettleVector checks a vector's arity at extraction; this guards a contract built by hand.
  if (k.args.length !== sig.params.length) {
    ctx.errors.push(`${k.id}: ${k.call} takes ${sig.params.length} arguments, got ${k.args.length}`)
    return ""
  }
  const args: string[] = []
  const params = sig.params
  for (let i = 0; i < k.args.length && i < params.length; i++) {
    args.push(emitTsLitArg(k.args[i], params[i].type))
  }
  const name = emitQuote(emitTestName(k))
  const it = k.iterate
  if ((it?.slow ?? false) && !ctx.opts.slow) {
    return `function ${emitClauseFn(k)}(t: Suite): boolean {\n  return t.skip(${name}, "${EMIT_SLOW_SKIP}")\n}`
  }
  const steps = emitTsIterate(k, sig, args, name)
  const call = it === null ? emitTsCall(sig, args) : "it_r"
  const ret = emitTsVt(sig.returns)
  let body = ""
  const tr = k.truncate
  if (ret === "bytes" && tr !== null) {
    body = `t.eq_str(${name}, _hex_prefix(${call}, ${tr.bytes}), "${emitLiteralHex(expect)}")`
  } else if (ret === "bytes") {
    body = `t.eq_str(${name}, _hex_of(${call}), "${emitLiteralHex(expect)}")`
  } else if (ret === "bytes?") {
    const want = expect.kind === LitKind.Null ? "null" : emitLiteralHex(expect)
    body = `t.eq_str(${name}, _hex_of(${call}), "${want}")`
  } else if (ret === "bool") {
    body = `t.eq_bool(${name}, ${call}, ${expect.flag ? "true" : "false"})`
  } else if (vocabIsIntType(ret)) {
    body = `t.eq_int(${name}, ${call}, ${emitTsInt(expect.text, ret)})`
  } else if (ret === "f64") {
    body = emitTsVectorF64(k, expect, name, call)
  } else if (ret === "string") {
    body = `t.eq_str(${name}, ${call}, ${emitQuote(expect.text)})`
  } else if (ret === "string?") {
    const want = expect.kind === LitKind.Null ? "null" : `"${expect.text}"`
    body = `t.eq_str(${name}, _str_or_null(${call}), ${emitQuote(want)})`
  } else {
    ctx.errors.push(`${k.id}: TypeScript cannot check a ${sig.returns} result`)
  }
  const lines = steps.length > 0 ? `${steps.join("\n")}\n` : ""
  return `function ${emitClauseFn(k)}(t: Suite): boolean {\n${lines}  return ${body}\n}`
}

/**
 * An iterated vector's calls, up to the last result bound as `it_r`: the
 * arguments (`it_a<i>`, by position) start as the vector's and are rebound to
 * its `next` after each call; a null result at any step fails the clause,
 * naming the step. Empty for a vector that is not iterated.
 */
const emitTsIterate = (k: Clause, sig: FnSig, args: string[], name: string): string[] => {
  const it = k.iterate
  if (it === null) {
    return []
  }
  const lines: string[] = []
  const vars: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    vars.push(`it_a${i}`)
    lines.push(`  let it_a${i} = ${a}`)
  }
  const optional = vocabIsOptional(emitTsVt(sig.returns))
  lines.push(`  for (let it_i = 1; it_i < ${it.count}; it_i += 1) {`)
  lines.push(`    const it_s = ${emitTsCall(sig, vars)}`)
  if (optional) {
    emitTsIterateNull(lines, "    ", name, "it_s", `" + it_i + " of ${it.count}`, sig.name)
  }
  const next = it.next
  for (let i = 0; i < next.length; i++) {
    const e = next[i]
    lines.push(`    const it_n${i} = ${e.kind === ExprKind.Call ? "it_s" : `it_a${toI32(it.names.indexOf(e.name))}`}`)
  }
  for (let i = 0; i < it.next.length; i++) {
    lines.push(`    it_a${i} = it_n${i}`)
  }
  lines.push("  }")
  lines.push(`  const it_r = ${emitTsCall(sig, vars)}`)
  if (optional) {
    emitTsIterateNull(lines, "  ", name, "it_r", `${it.count} of ${it.count}`, sig.name)
  }
  return lines
}

/** Fails the clause `name` when step `step`'s result `v` is null or undefined. */
const emitTsIterateNull = (lines: string[], pad: string, name: string, v: string, step: string, fn: string): void => {
  lines.push(`${pad}if (${v} === null || ${v} === undefined) {`)
  lines.push(`${pad}  return t.fail(${name}, "step ${step}: ${fn} returned null")`)
  lines.push(`${pad}}`)
}

/**
 * An f64 vector's check: bit for bit, or within its tolerance; a
 * non-finite expected value is checked bit for bit whatever the tolerance.
 */
const emitTsVectorF64 = (k: Clause, expect: Literal, name: string, call: string): string => {
  const want = emitTsF64(expect.text, expect.bits)
  const tol = k.tolerance
  if (tol === null || !emitF64IsFinite(expect.text, expect.bits)) {
    return `t.eq_f64_bits(${name}, ${call}, ${want})`
  }
  if (!tol.isUlps) {
    return `t.near_f64(${name}, ${call}, ${want}, ${emitTsF64(tol.abs, null)})`
  }
  return `t.near_ulps_f64(${name}, ${call}, ${want}, ${tol.ulps}n)`
}

/** One forall variable's sample table, as an array: integers and bools as they are, bytes as hex, strings quoted. */
const emitTsTable = (
  ctx: EmitTsContext,
  name: string,
  type: string,
  j: i32,
  samples: Sample[],
  out: string[],
): void => {
  const vals: string[] = []
  let elem = "string"
  for (const s of samples) {
    // The sampler gives every sample a value for each variable; this guards a table built by hand.
    if (j < 0 || j >= s.args.length) {
      emitTsAddOnce(ctx.errors, `a sample has no value for ${name}`)
      return
    }
    const lit = s.args[j]
    if (vocabIsIntType(type)) {
      elem = emitTsIsBig(type) ? "bigint" : "number"
      vals.push(emitTsInt(lit.text, type))
    } else if (type === "bool") {
      elem = "boolean"
      vals.push(lit.flag ? "true" : "false")
    } else if (type === "bytes") {
      vals.push(`"${emitLiteralHex(lit)}"`)
    } else {
      vals.push(emitQuote(lit.text))
    }
  }
  out.push(`  const table_${name}: ${elem}[] = [`)
  for (const v of vals) {
    out.push(`    ${v},`)
  }
  out.push("  ]")
}

/** A property clause's check: a loop over its baked samples. */
const emitTsProperty = (ctx: EmitTsContext, k: Clause, samples: Sample[]): string => {
  const name = emitQuote(emitTestName(k))
  const count = samples.length
  const out: string[] = [`function ${emitClauseFn(k)}(t: Suite): boolean {`]
  const assert = k.assert
  if (count === 0 || assert === null) {
    out.push(`  return t.skip(${name}, "no samples")`)
    out.push("}")
    return out.join("\n")
  }
  for (let j = 0; j < k.forall.length; j++) {
    const v = k.forall[j]
    emitTsTable(ctx, v.name, v.type, j, samples, out)
  }
  const undefinedWhy = emitUndefinedWhy(assert)
  const usesUnwrap = undefinedWhy !== null
  out.push(`  for (let i = 0; i < ${count}; i++) {`)
  ctx.env = new TypeEnv(ctx.c.functions, true)
  const shown: string[] = []
  for (const v of k.forall) {
    typeEnvBind(ctx.env, v.name, v.type)
    if (v.type === "bytes") {
      out.push(`    const v_${v.name} = _h(table_${v.name}[i])`)
      shown.push(`"len(${v.name}) = " + v_${v.name}.length`)
    } else {
      out.push(`    const v_${v.name} = table_${v.name}[i]`)
      shown.push(
        v.type === "string" ? `"len(${v.name}) = " + _str_len(v_${v.name})` : `"${v.name} = " + String(v_${v.name})`,
      )
    }
  }
  if (usesUnwrap) {
    out.push("    const u = new Unwrap()")
  }
  const body = emitTsBindings(ctx, assert, "    ", out)
  out.push(`    const holds = ${emitTsExpr(ctx, body, null)}`)
  const where = `"sample " + (i + 1) + " of ${count} (" + ${shown.join(` + ", " + `)} + "): "`
  if (usesUnwrap) {
    out.push("    if (u.saw_null || holds !== true) {")
    out.push(`      const why = u.saw_null ? ${emitQuote(undefinedWhy ?? "")} : "the assertion is false"`)
  } else {
    out.push("    if (holds !== true) {")
    out.push(`      const why = "the assertion is false"`)
  }
  out.push(`      return t.fail(${name}, ${where} + why)`)
  out.push("    }")
  out.push("  }")
  out.push(`  return t.ok(${emitQuote(`${emitTestName(k)} — ${count} samples`)})`)
  out.push("}")
  return out.join("\n")
}

/**
 * Where the test finds `module` when it is one of `localModules`, or null
 * when it is not one (`emitTsProgram` refuses options whose two lists differ in length).
 */
const emitTsLocalImport = (opts: EmitOptions, module: string): string | null => {
  for (let i = 0; i < opts.localModules.length && i < opts.localImports.length; i++) {
    if (opts.localModules[i] === module) {
      return opts.localImports[i]
    }
  }
  return null
}

/** The imports of the functions under test, by module: from its path, or from the `.ts` file a package places. */
const emitTsImports = (ctx: EmitTsContext, called: string[]): string => {
  const fns: FnSig[] = []
  const modules: string[] = []
  for (const n of emitSortedUnique(called)) {
    const f = emitTsFn(ctx, n)
    if (f !== null) {
      fns.push(f)
      const mod = f.module ?? ctx.c.target.module
      if (modules.indexOf(mod) < 0) {
        modules.push(mod)
      }
    }
  }
  const lines: string[] = []
  for (const mod of modules) {
    const names: string[] = []
    for (const f of fns) {
      if ((f.module ?? ctx.c.target.module) === mod) {
        names.push(emitTsName(f))
      }
    }
    const local = emitTsLocalImport(ctx.opts, mod)
    const from = local === null ? emitTsModule(ctx.c, mod) : `${local}.ts`
    lines.push(`import { ${names.join(", ")} } from ${emitQuote(from)}`)
  }
  return lines.join("\n")
}

/** The suite and the helpers every test shares. */
const EMIT_TS_RUNTIME: string = `/** One PASS, FAIL or SKIP line per check, then a tally: nish/testing's transcript. */
class Suite {
  name: string
  passed = 0
  failed = 0
  skipped = 0
  failures: string[] = []
  detail = ""

  constructor(name: string) {
    this.name = name
  }

  ok(name: string): boolean {
    this.passed += 1
    console.log("PASS  " + name)
    return true
  }

  fail(name: string, detail: string): boolean {
    this.failed += 1
    this.failures.push(name)
    this.detail = detail
    console.log("FAIL  " + name)
    if (detail !== "") {
      console.log("      " + detail)
    }
    return false
  }

  skip(name: string, reason: string): boolean {
    this.skipped += 1
    this.detail = reason
    console.log("SKIP  " + name + " (" + reason + ")")
    return true
  }

  done(): number {
    if (this.failures.length > 0) {
      console.log("failed: " + this.failures.join(", "))
    }
    console.log(this.name + ": " + this.passed + " passed, " + this.failed + " failed, " + this.skipped + " skipped")
    return this.failed > 0 ? 1 : 0
  }

  eq_str(name: string, actual: unknown, expected: string): boolean {
    if (typeof actual === "string" && actual === expected) {
      return this.ok(name)
    }
    return this.fail(name, 'expected "' + expected + '", got "' + _show(actual) + '"' + _kind(actual, expected))
  }

  eq_int(name: string, actual: unknown, expected: number | bigint): boolean {
    if (typeof actual === typeof expected && actual === expected) {
      return this.ok(name)
    }
    return this.fail(name, "expected " + expected + ", got " + _show(actual) + _kind(actual, expected))
  }

  eq_bool(name: string, actual: unknown, expected: boolean): boolean {
    if (actual === expected) {
      return this.ok(name)
    }
    return this.fail(name, "expected " + expected + ", got " + _show(actual) + _kind(actual, expected))
  }

  eq_f64_bits(name: string, actual: unknown, expected: number): boolean {
    // JavaScript keeps no NaN payload, so any NaN is the NaN expected.
    const same = typeof actual === "number" && (_bits(actual) === _bits(expected) || (Number.isNaN(actual) && Number.isNaN(expected)))
    if (same) {
      return this.ok(name)
    }
    return this.fail(name, "expected " + _show(expected) + ", got " + _show(actual) + " (other binary64 bits)")
  }

  near_f64(name: string, actual: unknown, expected: number, tolerance: number): boolean {
    if (typeof actual === "number" && Math.abs(actual - expected) <= tolerance) {
      return this.ok(name)
    }
    return this.fail(name, "expected " + _show(expected) + " +/- " + _show(tolerance) + ", got " + _show(actual))
  }

  near_ulps_f64(name: string, actual: unknown, expected: number, ulps: bigint): boolean {
    if (typeof actual === "number" && !Number.isNaN(actual) && !Number.isNaN(expected)) {
      const d = _ordered(actual) - _ordered(expected)
      if ((d < 0n ? -d : d) <= ulps) {
        return this.ok(name)
      }
    }
    return this.fail(name, "expected " + _show(expected) + " within " + ulps + " ulps, got " + _show(actual))
  }
}

/** A clause's check; one that throws fails, with what it threw. */
function _run(t: Suite, check: (t: Suite) => boolean, name: string): boolean {
  try {
    return check(t)
  } catch (e) {
    const why = e instanceof Error ? e.name + ": " + e.message : String(e)
    return t.fail(name, "threw " + why)
  }
}

/** A value as a failure shows it: a string as it is, -0 with its sign, bytes as hex. */
function _show(x: unknown): string {
  if (typeof x === "string") {
    return x
  }
  if (typeof x === "number" && Object.is(x, -0)) {
    return "-0"
  }
  if (x instanceof Uint8Array) {
    return _hex_of(x)
  }
  return String(x)
}

/** When a result is not even of the expected kind, says which kind it is. */
function _kind(actual: unknown, expected: unknown): string {
  if (actual === null || typeof actual === typeof expected) {
    return ""
  }
  return " (a " + typeof actual + ", not a " + typeof expected + ")"
}

function _bits(x: number): bigint {
  const d = new DataView(new ArrayBuffer(8))
  d.setFloat64(0, x)
  return d.getBigUint64(0)
}

function _f64(bits: string): number {
  const d = new DataView(new ArrayBuffer(8))
  d.setBigUint64(0, BigInt("0x" + bits))
  return d.getFloat64(0)
}

/** x's place on the line of binary64 bit patterns, where -0 meets +0. */
function _ordered(x: number): bigint {
  const n = BigInt.asIntN(64, _bits(x))
  return n < 0n ? -(n & 0x7fffffffffffffffn) : n
}

function _h(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substring(2 * i, 2 * i + 2), 16)
  }
  return out
}

/** A bytes result as a Uint8Array of its own, whatever view it came back as; anything else as it is, for the check to refuse. */
function _b<T>(x: T): T {
  if (x instanceof ArrayBuffer) {
    return new Uint8Array(x.slice(0)) as T
  }
  if (ArrayBuffer.isView(x)) {
    return new Uint8Array(x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength)) as T
  }
  return x
}

function _hex_of(b: unknown): string {
  if (b === null) {
    return "null"
  }
  if (!(b instanceof Uint8Array)) {
    return String(b)
  }
  let out = ""
  for (const x of b) {
    out += "0123456789abcdef"[x >> 4] + "0123456789abcdef"[x & 15]
  }
  return out
}

function _hex_prefix(b: unknown, n: number): string {
  if (b instanceof Uint8Array && b.length < n) {
    return \`a \${b.length}-byte result, shorter than the \${n} bytes it is truncated to\`
  }
  return _hex_of(b instanceof Uint8Array ? b.subarray(0, n) : b)
}

function _str_or_null(s: unknown): string {
  if (s === null) {
    return "null"
  }
  if (typeof s === "string") {
    return '"' + s + '"'
  }
  return String(s)
}

/** Two values equal: bytes byte for byte, anything else as === has it. */
function _eq(a: unknown, b: unknown): boolean {
  if (a instanceof Uint8Array && b instanceof Uint8Array) {
    return a.length === b.length && a.every((x, i) => x === b[i])
  }
  return a === b
}

/** x as the integer type ty holds it: modulo 2**bits, two's complement when signed; a bigint for i64 and u64. */
function _wrap(x: number | bigint, ty: string): number | bigint {
  const bits = Number(ty.substring(1))
  const n = ty[0] === "i" ? BigInt.asIntN(bits, BigInt(x)) : BigInt.asUintN(bits, BigInt(x))
  return bits === 64 ? n : Number(n)
}

/** The contract's a % b: truncating, and 0 when b is 0. */
function _rem(a: number | bigint, b: number | bigint, ty: string): number | bigint {
  const d = BigInt(b)
  return _wrap(d === 0n ? 0n : BigInt(a) % d, ty)
}

/** b[lo, hi), both ends clamped into b. */
function _slice(b: Uint8Array, lo: number | bigint, hi: number | bigint): Uint8Array {
  const n = b.length
  const l = Math.min(Math.max(Number(lo), 0), n)
  const h = Math.min(Math.max(Number(hi), l), n)
  return b.slice(l, h)
}

function _fill(v: number | bigint, n: number | bigint): Uint8Array {
  return new Uint8Array(Math.max(Number(n), 0)).fill(Number(BigInt.asUintN(8, BigInt(v))))
}

/** A copy of b with bit (mod 8 * len(b)) inverted. */
function _flip_bit(b: Uint8Array, bit: number | bigint): Uint8Array {
  const out = b.slice()
  if (out.length > 0) {
    const n = BigInt(out.length * 8)
    const at = Number(((BigInt(bit) % n) + n) % n)
    out[at >> 3] ^= 1 << (at & 7)
  }
  return out
}

/** a and b byte by byte (k 0: xor, 1: and, 2: or); the shorter reads as zeros. */
function _bitwise(a: Uint8Array, b: Uint8Array, k: number): Uint8Array {
  const out = new Uint8Array(Math.max(a.length, b.length))
  for (let i = 0; i < out.length; i++) {
    const x = i < a.length ? a[i] : 0
    const y = i < b.length ? b[i] : 0
    out[i] = k === 1 ? x & y : k === 2 ? x | y : x ^ y
  }
  return out
}

/** n's w bytes, big-endian when be, a negative n in two's complement. */
function _int_bytes(n: number | bigint, w: number, be: boolean): Uint8Array {
  const x = BigInt.asUintN(w * 8, BigInt(n))
  const out = new Uint8Array(w)
  for (let i = 0; i < w; i++) {
    out[i] = Number((x >> BigInt(8 * (be ? w - 1 - i : i))) & 255n)
  }
  return out
}

/** The integer of type ty b's w bytes hold; any other length records on u, so the sample fails. */
function _bytes_int(u: Unwrap, b: Uint8Array, w: number, be: boolean, ty: string): number | bigint {
  if (b.length !== w) {
    u.saw_null = true
    return _wrap(0, ty)
  }
  let x = 0n
  for (let i = 0; i < w; i++) {
    x = (x << 8n) | BigInt(b[be ? i : w - 1 - i])
  }
  return _wrap(x, ty)
}

function _utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

function _str_len(s: string): number {
  return _utf8(s).length
}

/** The byte at i as a string, or "" out of range. */
function _char_at(s: string, i: number | bigint): string {
  const b = _utf8(s)
  const n = Number(i)
  if (n < 0 || n >= b.length) {
    return ""
  }
  return new TextDecoder().decode(b.subarray(n, n + 1))
}

function _ascii(b: Uint8Array): string | null {
  let out = ""
  for (const x of b) {
    if (x >= 128) {
      return null
    }
    out += String.fromCharCode(x)
  }
  return out
}

/** s with every character in [lo, hi] moved by delta (ASCII case mapping). */
function _shift_case(s: string, lo: number, hi: number, delta: number): string {
  let out = ""
  for (const c of s) {
    const n = c.codePointAt(0) ?? 0
    out += lo <= n && n <= hi ? String.fromCodePoint(n + delta) : c
  }
  return out
}

function _concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

function _str_concat(a: string, b: string): string {
  return a + b
}

/** unwrap that records a null and stands in empty, so the sample fails. */
class Unwrap {
  saw_null = false

  get<T>(x: T | null, empty: T): T {
    if (x === null) {
      this.saw_null = true
      return empty
    }
    return x
  }
}`

/** The hook every `node:test` test calls. */
const EMIT_TS_NODE: string = `/** A clause's check as a node:test test: a failure throws with its detail, a property with no samples skips. */
function _node(check: (t: Suite) => boolean, name: string, c: { skip: (why: string) => void }): void {
  const t = new Suite(name)
  const passed = _run(t, check, name)
  if (t.skipped > 0) {
    c.skip(t.detail)
    return
  }
  if (!passed) {
    throw new Error(t.detail)
  }
}`

/** `main`: every clause run in order, then the end line with the nonce `spec run` passes. */
const emitTsMain = (c: Contract): string => {
  const lines: string[] = [
    "function main(): number {",
    `  const t = new Suite(${emitQuote(c.contract)})`,
    `  let ran = ""`,
  ]
  for (const k of c.clauses) {
    lines.push(`  ran += _run(t, ${emitClauseFn(k)}, ${emitQuote(emitTestName(k))}) ? "1" : "0"`)
  }
  lines.push("  const code = t.done()")
  lines.push(`  const nonce = process.argv.length > 2 ? process.argv[2] : "-"`)
  lines.push(`  console.log("vector-done " + nonce + " " + ran)`)
  lines.push("  return code")
  lines.push("}")
  return lines.join("\n")
}

/** A clause's node:test test; a property with no samples, or a slow vector without `--slow`, is skipped, as its check would skip. */
const emitTsNodeTest = (table: SampleTable, k: Clause, runSlow: boolean): string => {
  const name = emitQuote(emitTestName(k))
  const empty = k.kind !== ClauseKind.Vector && (checkSamplesOf(table, k.id).length === 0 || k.assert === null)
  const it = k.iterate
  const slow = (it?.slow ?? false) && !runSlow
  const opts = empty ? `{ skip: "no samples" }, ` : slow ? `{ skip: "${EMIT_SLOW_SKIP}" }, ` : ""
  return `  test(${name}, ${opts}(c) => _node(${emitClauseFn(k)}, ${name}, c))`
}

/** The test's last lines: under `node --test` (node harness) one test per clause, else `main`. */
const emitTsEnd = (c: Contract, table: SampleTable, harness: string, runSlow: boolean): string => {
  if (harness !== "node") {
    return "process.exitCode = main()"
  }
  const lines: string[] = [`if (process.env.NODE_TEST_CONTEXT !== undefined || process.execArgv.includes("--test")) {`]
  for (const k of c.clauses) {
    lines.push(emitTsNodeTest(table, k, runSlow))
  }
  lines.push("} else {")
  lines.push("  process.exitCode = main()")
  lines.push("}")
  return lines.join("\n")
}

/**
 * The whole TypeScript test for a contract: a header naming the contract's
 * sha256, the imports of the functions under test, the suite and helpers,
 * one check per clause under the requirements it covers, `main`, and with
 * the node harness one `node:test` test per clause, which `node --test` runs
 * in place of `main`.
 *
 * @param c the contract, already checked
 * @param table the property samples `checkContract` chose
 * @param opts the header's regenerate command, the contract's sha256, and the
 *   modules `--package` places
 * @param harness `standalone` or `node`
 * @returns the test's text, or every reason TypeScript cannot express the contract
 */
export const emitTsProgram = (
  c: Contract,
  table: SampleTable,
  opts: EmitOptions,
  harness: string,
): Result<string, string[]> => {
  if (opts.localImports.length !== opts.localModules.length) {
    return Err([`${opts.localModules.length} local modules but ${opts.localImports.length} import paths`])
  }
  const refused = emitTsRefusals(c)
  if (refused.length > 0) {
    return Err(refused)
  }
  const ctx = new EmitTsContext(c, opts)
  const bodies: string[] = []
  const called: string[] = []
  for (const k of c.clauses) {
    if (k.kind === ClauseKind.Vector) {
      called.push(k.call)
      bodies.push(`${emitTsComment(c, k)}\n${emitTsVector(ctx, k)}`)
    } else {
      const assert = k.assert
      if (assert !== null) {
        for (const n of typeCallsIn(assert)) {
          called.push(n)
        }
      }
      bodies.push(`${emitTsComment(c, k)}\n${emitTsProperty(ctx, k, checkSamplesOf(table, k.id))}`)
    }
  }
  if (ctx.errors.length > 0) {
    return Err(ctx.errors)
  }
  const header = emitHeaderLines(c, opts)
    .map((l: string): string => (l === "" ? "//" : `// ${l}`))
    .join("\n")
  const imports: string[] = []
  if (harness === "node") {
    imports.push(`import { test } from "node:test"`)
  }
  const used = emitTsImports(ctx, called)
  if (used !== "") {
    imports.push(used)
  }
  const parts: string[] = [header]
  if (imports.length > 0) {
    parts.push(imports.join("\n"))
  }
  parts.push(EMIT_TS_RUNTIME)
  for (const b of bodies) {
    parts.push(b)
  }
  parts.push(emitTsMain(c))
  if (harness === "node") {
    parts.push(EMIT_TS_NODE)
  }
  parts.push(emitTsEnd(c, table, harness, opts.slow))
  return Ok(`${parts.join("\n\n")}\n`)
}
