/**
 * `spec/emit/python` — a contract and its samples as a Python test.
 *
 * The test is one file that runs on the Python standard library alone:
 * `python3 test_x.py <nonce>` checks every clause and prints the transcript
 * `vector spec run` judges, line for line what the Nish test prints. With the
 * pytest harness it also defines one `test_<clause>` function per clause,
 * so pytest collects the same checks.
 *
 * The functions under test are found by the language table's rules: each
 * name in snake_case (or the contract's python override), imported from the
 * module's dotted path, or loaded from the file `--package` places it in.
 * Python's integers are unbounded and its strings are code points, so the
 * test writes the contract's semantics out: `+`, `-` and `*` wrap to their
 * operands' width, `%` truncates and is 0 on a zero divisor, and `strLen`
 * and `charAt` count UTF-8 bytes.
 */

import { langModuleIn, langNameIn } from "../../lang/names"
import { Sample, SampleTable, checkSamplesOf } from "../check"
import { contractF64Bits, contractF64Parse } from "../contract/f64"
import { ClauseKind, ExprKind, LitKind } from "../contract/types"
import { Clause, Contract, Expr, FnSig, Literal } from "../contract/types"
import { TypeEnv, typeCallsIn, typeEnvBind, typeIntBase, typeOf } from "../contract/typing"
import { vocabIsIntType, vocabIsOptional, vocabValueType } from "../contract/vocab"
import { EmitOptions, emitClauseFn, emitClauseLines, emitHeaderLines, emitSortedUnique, emitTestName } from "./emit"
import { EMIT_SLOW_SKIP, emitF64IsFinite, emitLiteralHex, emitQuote } from "./lit"

/** What emitting one Python test has gathered so far. */
class EmitPyContext {
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

/** Python's keywords, which no function under test can be named. */
const emitPyKeywords = (): string[] => [
  "False",
  "None",
  "True",
  "and",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "try",
  "while",
  "with",
  "yield",
]

/** The names the test itself defines, binds or calls, which no function under test can take. */
const emitPyTaken = (): string[] => [
  "Exception",
  "Suite",
  "abs",
  "all",
  "any",
  "bytearray",
  "bytes",
  "chr",
  "float",
  "holds",
  "i",
  "importlib",
  "int",
  "isinstance",
  "len",
  "list",
  "main",
  "math",
  "max",
  "memoryview",
  "min",
  "ord",
  "os",
  "print",
  "pytest",
  "range",
  "repr",
  "str",
  "struct",
  "sys",
  "t",
  "type",
  "u",
  "why",
]

/**
 * A contract function's name in the test: its python override, or the
 * language table's snake_case.
 *
 * @param f the function
 * @returns the Python name
 */
export const emitPyName = (f: FnSig): string => langNameIn("python", f.name, true, f.names)

/** The Python module a contract module is imported as: a dotted path. */
const emitPyModule = (c: Contract, module: string): string =>
  langModuleIn("python", module, module === c.target.module ? c.target.modules : null)

const emitPyFn = (ctx: EmitPyContext, name: string): FnSig | null => {
  for (const f of ctx.c.functions) {
    if (f.name === name) {
      return f
    }
  }
  return null
}

/** Why a function under test cannot keep its Python name in the test, or null. */
const emitPyNameRefusal = (f: FnSig): string | null => {
  const n = emitPyName(f)
  if (emitPyKeywords().indexOf(n) >= 0) {
    return `${f.name}: its Python name ${n} is a keyword: give it a python name in the contract`
  }
  const reserved =
    emitPyTaken().indexOf(n) >= 0 ||
    n.startsWith("_") ||
    n.startsWith("clause_") ||
    n.startsWith("test_") ||
    n.startsWith("v_") ||
    n.startsWith("table_")
  if (reserved) {
    return `${f.name}: its Python name ${n} is one the test uses for its own: give it a python name in the contract`
  }
  return null
}

/**
 * What in a contract the Python test cannot express, found before any
 * output: a function whose Python name is a keyword or one the test uses
 * itself (`Suite`, `main`, `clause_*`, `test_*`, `_`-prefixed), two
 * functions with one Python name, two clause ids that make the same check
 * name, and an f64 forall variable, which the sampler does not draw yet.
 *
 * @param c the contract
 * @returns one message per refusal; empty when Python can express it all
 */
export const emitPyRefusals = (c: Contract): string[] => {
  const out: string[] = []
  const names: string[] = []
  for (const f of c.functions) {
    const why = emitPyNameRefusal(f)
    if (why !== null) {
      out.push(why)
    }
    const n = emitPyName(f)
    if (names.indexOf(n) >= 0) {
      out.push(`${f.name}: its Python name ${n} is another function's too`)
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

/** Whether a value type holds bytes, which a call's result is normalized to. */
const emitPyIsBytes = (t: string): boolean => t === "bytes" || t === "bytes?"

/** A call of a function under test; a bytes result is made `bytes` whatever buffer it came back as. */
const emitPyCall = (sig: FnSig, args: string[]): string => {
  const call = `${emitPyName(sig)}(${args.join(", ")})`
  return emitPyIsBytes(vocabValueType(sig.returns)) ? `_b(${call})` : call
}

/** An integer literal: its decimal text, in parentheses when negative. */
const emitPyInt = (text: string): string => (text.startsWith("-") ? `(${text})` : text)

/**
 * An f64 literal, from its binary64 bits so every value (-0, a NaN's
 * payload, the infinities) is the one the contract means.
 *
 * @param text the literal's decimal text
 * @param bits its bits as 16 hex digits, or null to compute them
 * @returns the Python expression
 */
export const emitPyF64 = (text: string, bits: string | null): string =>
  `_f64("${bits ?? contractF64Bits(contractF64Parse(text))}")`

/** A literal where a value of type `ty` goes. */
const emitPyLiteral = (lit: Literal): string => {
  if (lit.kind === LitKind.Null) {
    return "None"
  }
  if (lit.kind === LitKind.Bool) {
    return lit.flag ? "True" : "False"
  }
  if (lit.kind === LitKind.Int) {
    return emitPyInt(lit.text)
  }
  if (lit.kind === LitKind.F64) {
    return emitPyF64(lit.text, lit.bits)
  }
  if (lit.kind === LitKind.Str) {
    return emitQuote(lit.text)
  }
  return `bytes.fromhex("${emitLiteralHex(lit)}")`
}

const emitPyTypeOf = (ctx: EmitPyContext, e: Expr): string => {
  const errors: string[] = []
  return typeOf(e, ctx.env, "", errors) ?? "null"
}

/** An integer of type `natural` where `want` is wanted, wrapped to `want` when the two differ. */
const emitPyConv = (s: string, natural: string, want: string | null): string => {
  const w: string | null = want === null ? null : typeIntBase(want)
  if (w !== null && natural !== w && vocabIsIntType(natural)) {
    return `_wrap(${s}, "${w}")`
  }
  return s
}

/** The integer type an arithmetic or comparison op's operands share. */
const emitPyOperands = (ctx: EmitPyContext, e: Expr): string => {
  for (const x of e.args) {
    if (x.kind !== ExprKind.Lit) {
      const t = emitPyTypeOf(ctx, x)
      if (vocabIsIntType(t)) {
        return t
      }
    }
  }
  return emitPyTypeOf(ctx, e.args[0])
}

const emitPyArg = (ctx: EmitPyContext, e: Expr, i: i32, want: string | null): string => emitPyExpr(ctx, e.args[i], want)

/** An expression where a value of type `want` goes (null: its own type). */
const emitPyExpr = (ctx: EmitPyContext, e: Expr, want: string | null): string => {
  if (e.kind === ExprKind.Var) {
    return emitPyConv(`v_${e.name}`, emitPyTypeOf(ctx, e), want)
  }
  if (e.kind === ExprKind.Call) {
    const sig = emitPyFn(ctx, e.name)
    if (sig === null) {
      ctx.errors.push(`unknown function ${e.name}`)
      return ""
    }
    const args: string[] = []
    for (let i = 0; i < e.args.length; i++) {
      args.push(emitPyExpr(ctx, e.args[i], vocabValueType(sig.params[i].type)))
    }
    return emitPyCall(sig, args)
  }
  if (e.kind === ExprKind.Let) {
    ctx.errors.push("a let may only open the assert")
    return ""
  }
  if (e.kind === ExprKind.Lit) {
    const lit = e.lit
    return lit === null ? "" : emitPyLiteral(lit)
  }
  return emitPyOp(ctx, e, want)
}

/** The ops on bytes and strings, which go through a helper; null for any other op. */
const emitPyHelperOp = (ctx: EmitPyContext, e: Expr): string | null => {
  const op = e.name
  const one = ["zeros", "le64", "utf8", "ascii", "strLen"]
  const oneHelper = ["_fill(0, ", "_le64(", "_utf8(", "_ascii(", "_str_len("]
  const at = one.indexOf(op)
  if (at >= 0) {
    return `${oneHelper[at]}${emitPyArg(ctx, e, 0, null)})`
  }
  const two = ["fill", "flipBit", "charAt"]
  const twoHelper = ["_fill", "_flip_bit", "_char_at"]
  const at2 = two.indexOf(op)
  if (at2 >= 0) {
    return `${twoHelper[at2]}(${emitPyArg(ctx, e, 0, null)}, ${emitPyArg(ctx, e, 1, null)})`
  }
  if (op === "concat" || op === "strConcat") {
    return `(${emitPyArg(ctx, e, 0, null)} + ${emitPyArg(ctx, e, 1, null)})`
  }
  if (op === "slice") {
    const b = emitPyArg(ctx, e, 0, null)
    return `_slice(${b}, ${emitPyArg(ctx, e, 1, null)}, ${emitPyArg(ctx, e, 2, null)})`
  }
  const bitwise = ["xor", "bitAnd", "bitOr"].indexOf(op)
  if (bitwise >= 0) {
    return `_bitwise(${emitPyArg(ctx, e, 0, null)}, ${emitPyArg(ctx, e, 1, null)}, ${bitwise})`
  }
  if (op === "lower") {
    return `_shift_case(${emitPyArg(ctx, e, 0, null)}, 65, 90, 32)`
  }
  if (op === "upper") {
    return `_shift_case(${emitPyArg(ctx, e, 0, null)}, 97, 122, -32)`
  }
  return null
}

/** An operator application. */
const emitPyOp = (ctx: EmitPyContext, e: Expr, want: string | null): string => {
  const op = e.name
  const viaHelper = emitPyHelperOp(ctx, e)
  if (viaHelper !== null) {
    return viaHelper === "" ? "" : emitPyConv(viaHelper, emitPyTypeOf(ctx, e), want)
  }
  if (op === "len") {
    return emitPyConv(`len(${emitPyArg(ctx, e, 0, null)})`, "i32", want)
  }
  if (op === "unwrap") {
    const empty = emitPyTypeOf(ctx, e.args[0]) === "string?" ? `""` : `b""`
    return `u.get(${emitPyArg(ctx, e, 0, null)}, ${empty})`
  }
  if (op === "isNull") {
    return `(${emitPyArg(ctx, e, 0, null)} is None)`
  }
  if (op === "notNull") {
    return `(${emitPyArg(ctx, e, 0, null)} is not None)`
  }
  if (op === "+" || op === "-" || op === "*") {
    const t = emitPyOperands(ctx, e)
    const raw = `${emitPyArg(ctx, e, 0, t)} ${op} ${emitPyArg(ctx, e, 1, t)}`
    const s = vocabIsIntType(t) ? `_wrap(${raw}, "${t}")` : `(${raw})`
    return emitPyConv(s, emitPyTypeOf(ctx, e), want)
  }
  if (op === "%") {
    const t = emitPyOperands(ctx, e)
    const s = `_rem(${emitPyArg(ctx, e, 0, t)}, ${emitPyArg(ctx, e, 1, t)}, "${t}")`
    return emitPyConv(s, emitPyTypeOf(ctx, e), want)
  }
  if (op === "<" || op === "<=" || op === ">" || op === ">=" || op === "==" || op === "!=") {
    const l = emitPyTypeOf(ctx, e.args[0])
    const side = l === "null" ? emitPyTypeOf(ctx, e.args[1]) : l
    const t: string | null = vocabIsIntType(side) ? emitPyOperands(ctx, e) : null
    return `(${emitPyArg(ctx, e, 0, t)} ${op} ${emitPyArg(ctx, e, 1, t)})`
  }
  if (op === "and" || op === "or") {
    const parts: string[] = []
    for (let i = 0; i < e.args.length; i++) {
      parts.push(emitPyArg(ctx, e, i, null))
    }
    return `(${parts.join(` ${op} `)})`
  }
  if (op === "not") {
    return `(not ${emitPyArg(ctx, e, 0, null)})`
  }
  if (op === "implies") {
    return `((not ${emitPyArg(ctx, e, 0, null)}) or ${emitPyArg(ctx, e, 1, null)})`
  }
  ctx.errors.push(`Python has no spelling for the op ${op}`)
  return ""
}

/** Assignments for the lets that open `assert`, pushed onto `out`; answers the expression they scope over. */
const emitPyBindings = (ctx: EmitPyContext, assert: Expr, indent: string, out: string[]): Expr => {
  let e = assert
  while (e.kind === ExprKind.Let) {
    for (const b of e.binds) {
      const ty = emitPyTypeOf(ctx, b.value)
      out.push(`${indent}v_${b.name} = ${emitPyExpr(ctx, b.value, null)}`)
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

/** Whether `e` applies the op `op` anywhere. */
const emitPyHasOp = (e: Expr, op: string): boolean => {
  if (e.kind === ExprKind.Op && e.name === op) {
    return true
  }
  for (const a of e.args) {
    if (emitPyHasOp(a, op)) {
      return true
    }
  }
  for (const b of e.binds) {
    if (emitPyHasOp(b.value, op)) {
      return true
    }
  }
  const body = e.body
  return body !== null && emitPyHasOp(body, op)
}

/** The comment above a clause's check: its title and each covered requirement quoted. */
const emitPyComment = (c: Contract, k: Clause): string => {
  const lines: string[] = []
  const body = emitClauseLines(c, k)
  for (let i = 0; i < body.length; i++) {
    lines.push(i > 0 && body[i] === "" ? "#" : `# ${body[i]}`)
  }
  return lines.join("\n")
}

/** A vector clause's check. */
const emitPyVector = (ctx: EmitPyContext, k: Clause): string => {
  const sig = emitPyFn(ctx, k.call)
  const expect = k.expect
  if (sig === null || expect === null) {
    ctx.errors.push(`${k.id}: no function ${k.call} or no expected value`)
    return ""
  }
  const args: string[] = []
  for (const a of k.args) {
    args.push(emitPyLiteral(a))
  }
  const name = emitQuote(emitTestName(k))
  const it = k.iterate
  if (it !== null && it.slow && !ctx.opts.slow) {
    return `def ${emitClauseFn(k)}(t):\n    return t.skip(${name}, "${EMIT_SLOW_SKIP}")`
  }
  const steps = emitPyIterate(k, sig, args, name)
  const call = it === null ? emitPyCall(sig, args) : "it_r"
  const ret = vocabValueType(sig.returns)
  let body = ""
  if (ret === "bytes") {
    body = `t.eq_str(${name}, _hex_of(${call}), "${emitLiteralHex(expect)}")`
  } else if (ret === "bytes?") {
    const want = expect.kind === LitKind.Null ? "null" : emitLiteralHex(expect)
    body = `t.eq_str(${name}, _hex_of(${call}), "${want}")`
  } else if (ret === "bool") {
    body = `t.eq_bool(${name}, ${call}, ${expect.flag ? "True" : "False"})`
  } else if (vocabIsIntType(ret)) {
    body = `t.eq_int(${name}, ${call}, ${emitPyInt(expect.text)})`
  } else if (ret === "f64") {
    body = emitPyVectorF64(k, expect, name, call)
  } else if (ret === "string") {
    body = `t.eq_str(${name}, ${call}, ${emitQuote(expect.text)})`
  } else if (ret === "string?") {
    const want = expect.kind === LitKind.Null ? "null" : `"${expect.text}"`
    body = `t.eq_str(${name}, _str_or_null(${call}), ${emitQuote(want)})`
  } else {
    ctx.errors.push(`${k.id}: Python cannot check a ${sig.returns} result`)
  }
  const lines = steps.length > 0 ? `${steps.join("\n")}\n` : ""
  return `def ${emitClauseFn(k)}(t):\n${lines}    return ${body}`
}

/**
 * An iterated vector's calls, up to the last result bound as `it_r`: the
 * arguments (`it_a<i>`, by position) start as the vector's and are rebound to
 * its `next` after each call; a None result at any step fails the clause,
 * naming the step. Empty for a vector that is not iterated.
 */
const emitPyIterate = (k: Clause, sig: FnSig, args: string[], name: string): string[] => {
  const it = k.iterate
  if (it === null) {
    return []
  }
  const lines: string[] = []
  const vars: string[] = []
  for (let i = 0; i < args.length; i++) {
    vars.push(`it_a${i}`)
    lines.push(`    it_a${i} = ${args[i]}`)
  }
  const optional = vocabIsOptional(vocabValueType(sig.returns))
  lines.push(`    for it_i in range(1, ${it.count}):`)
  lines.push(`        it_s = ${emitPyCall(sig, vars)}`)
  if (optional) {
    emitPyIterateNull(lines, "        ", name, "it_s", `{it_i} of ${it.count}`, sig.name)
  }
  const next: string[] = []
  for (const e of it.next) {
    next.push(e.kind === ExprKind.Call ? "it_s" : `it_a${toI32(it.names.indexOf(e.name))}`)
  }
  lines.push(`        ${vars.join(", ")} = ${next.join(", ")}`)
  lines.push(`    it_r = ${emitPyCall(sig, vars)}`)
  if (optional) {
    emitPyIterateNull(lines, "    ", name, "it_r", `${it.count} of ${it.count}`, sig.name)
  }
  return lines
}

/** Fails the clause `name` when step `step`'s result `v` is None. */
const emitPyIterateNull = (lines: string[], pad: string, name: string, v: string, step: string, fn: string): void => {
  lines.push(`${pad}if ${v} is None:`)
  lines.push(`${pad}    return t.fail(${name}, f"step ${step}: ${fn} returned null")`)
}

/**
 * An f64 vector's check: bit for bit, or within its tolerance; a
 * non-finite expected value is checked bit for bit whatever the tolerance.
 */
const emitPyVectorF64 = (k: Clause, expect: Literal, name: string, call: string): string => {
  const want = emitPyF64(expect.text, expect.bits)
  const tol = k.tolerance
  if (tol === null || !emitF64IsFinite(expect.text, expect.bits)) {
    return `t.eq_f64_bits(${name}, ${call}, ${want})`
  }
  if (!tol.isUlps) {
    return `t.near_f64(${name}, ${call}, ${want}, ${emitPyF64(tol.abs, null)})`
  }
  return `t.near_ulps_f64(${name}, ${call}, ${want}, ${tol.ulps})`
}

/** One forall variable's sample table, as a list. */
const emitPyTable = (name: string, type: string, j: i32, samples: Sample[], out: string[]): void => {
  const vals: string[] = []
  for (const s of samples) {
    const lit = s.args[j]
    if (vocabIsIntType(type)) {
      vals.push(emitPyInt(lit.text))
    } else if (type === "bool") {
      vals.push(lit.flag ? "True" : "False")
    } else if (type === "bytes") {
      vals.push(`"${emitLiteralHex(lit)}"`)
    } else {
      vals.push(emitQuote(lit.text))
    }
  }
  out.push(`    table_${name} = [`)
  for (const v of vals) {
    out.push(`        ${v},`)
  }
  out.push("    ]")
}

/** A property clause's check: a loop over its baked samples. */
const emitPyProperty = (ctx: EmitPyContext, k: Clause, samples: Sample[]): string => {
  const name = emitQuote(emitTestName(k))
  const count = samples.length
  const out: string[] = [`def ${emitClauseFn(k)}(t):`]
  const assert = k.assert
  if (count === 0 || assert === null) {
    out.push(`    return t.skip(${name}, "no samples")`)
    return out.join("\n")
  }
  for (let j = 0; j < k.forall.length; j++) {
    const v = k.forall[j]
    emitPyTable(v.name, v.type, j, samples, out)
  }
  const usesUnwrap = emitPyHasOp(assert, "unwrap")
  out.push(`    for i in range(${count}):`)
  ctx.env = new TypeEnv(ctx.c.functions, true)
  const shown: string[] = []
  for (const v of k.forall) {
    typeEnvBind(ctx.env, v.name, v.type)
    if (v.type === "bytes") {
      out.push(`        v_${v.name} = bytes.fromhex(table_${v.name}[i])`)
      shown.push(`len(${v.name}) = {len(v_${v.name})}`)
    } else {
      out.push(`        v_${v.name} = table_${v.name}[i]`)
      shown.push(v.type === "string" ? `len(${v.name}) = {_str_len(v_${v.name})}` : `${v.name} = {v_${v.name}}`)
    }
  }
  if (usesUnwrap) {
    out.push("        u = _Unwrap()")
  }
  const body = emitPyBindings(ctx, assert, "        ", out)
  out.push(`        holds = ${emitPyExpr(ctx, body, null)}`)
  const where = `sample {i + 1} of ${count} (${shown.join(", ")})`
  if (usesUnwrap) {
    out.push("        if u.saw_null or not holds:")
    out.push(`            why = "unwrap met a null" if u.saw_null else "the assertion is false"`)
    out.push(`            return t.fail(${name}, f"${where}: {why}")`)
  } else {
    out.push("        if not holds:")
    out.push(`            return t.fail(${name}, f"${where}: the assertion is false")`)
  }
  out.push(`    return t.ok(${emitQuote(`${emitTestName(k)} — ${count} samples`)})`)
  return out.join("\n")
}

/** The imports of the functions under test, by module: by dotted path, or loaded from the file a package places. */
const emitPyImports = (ctx: EmitPyContext, called: string[]): string => {
  const fns: FnSig[] = []
  const modules: string[] = []
  for (const n of emitSortedUnique(called)) {
    const f = emitPyFn(ctx, n)
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
    const names: string[] = []
    for (const f of fns) {
      if ((f.module ?? ctx.c.target.module) === modules[i]) {
        names.push(emitPyName(f))
      }
    }
    const dotted = emitPyModule(ctx.c, modules[i])
    const local = ctx.opts.localModules.indexOf(modules[i])
    if (local < 0) {
      lines.push(`from ${dotted} import ${names.join(", ")}`)
    } else {
      const m = `_m${i}`
      lines.push(`${m} = _load(${emitQuote(dotted)}, ${emitQuote(`${ctx.opts.localImports[local]}.py`)})`)
      for (const n of names) {
        lines.push(`${n} = ${m}.${n}`)
      }
    }
  }
  return lines.join("\n")
}

/** The standard-library imports and the loader every test begins with. */
const EMIT_PY_HEAD: string = `import importlib.util
import math
import os
import struct
import sys


def _load(name, relpath):
    """The module at relpath, relative to this file, loaded as name."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), relpath)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module`

/** The suite and the helpers every test shares. */
const EMIT_PY_RUNTIME: string = `class Suite:
    """One PASS, FAIL or SKIP line per check, then a tally: nish/testing's transcript."""

    def __init__(self, name):
        self.name = name
        self.passed = 0
        self.failed = 0
        self.skipped = 0
        self.failures = []
        self.detail = ""

    def ok(self, name):
        self.passed += 1
        print(f"PASS  {name}")
        return True

    def fail(self, name, detail):
        self.failed += 1
        self.failures.append(name)
        self.detail = detail
        print(f"FAIL  {name}")
        if detail:
            print(f"      {detail}")
        return False

    def skip(self, name, reason):
        self.skipped += 1
        self.detail = reason
        print(f"SKIP  {name} ({reason})")
        return True

    def done(self):
        if self.failures:
            print("failed: " + ", ".join(self.failures))
        print(f"{self.name}: {self.passed} passed, {self.failed} failed, {self.skipped} skipped")
        return 1 if self.failed > 0 else 0

    def eq_str(self, name, actual, expected):
        if type(actual) is str and actual == expected:
            return self.ok(name)
        return self.fail(name, f'expected "{expected}", got "{_show(actual)}"')

    def eq_int(self, name, actual, expected):
        if type(actual) is int and actual == expected:
            return self.ok(name)
        return self.fail(name, f"expected {expected}, got {_show(actual)}")

    def eq_bool(self, name, actual, expected):
        if actual is expected:
            return self.ok(name)
        return self.fail(name, f"expected {_show(expected)}, got {_show(actual)}")

    def eq_f64_bits(self, name, actual, expected):
        if type(actual) is float and _bits(actual) == _bits(expected):
            return self.ok(name)
        return self.fail(name, f"expected {expected!r}, got {_show(actual)} (other binary64 bits)")

    def near_f64(self, name, actual, expected, tolerance):
        if type(actual) is float and abs(actual - expected) <= tolerance:
            return self.ok(name)
        return self.fail(name, f"expected {expected!r} +/- {tolerance!r}, got {_show(actual)}")

    def near_ulps_f64(self, name, actual, expected, ulps):
        near = type(actual) is float and not math.isnan(actual) and not math.isnan(expected)
        if near and abs(_ordered(actual) - _ordered(expected)) <= ulps:
            return self.ok(name)
        return self.fail(name, f"expected {expected!r} within {ulps} ulps, got {_show(actual)}")


def _run(t, check, name):
    """A clause's check; one that raises fails, with what it raised."""
    try:
        return check(t)
    except Exception as e:
        return t.fail(name, f"raised {type(e).__name__}: {e}")


def _show(x):
    if x is True:
        return "true"
    if x is False:
        return "false"
    if x is None:
        return "null"
    if type(x) is str:
        return x
    return repr(x)


def _bits(x):
    return struct.pack(">d", x)


def _f64(bits):
    return struct.unpack(">d", bytes.fromhex(bits))[0]


def _ordered(x):
    """x's place on the line of binary64 bit patterns, where -0 meets +0."""
    n = struct.unpack(">q", _bits(x))[0]
    return -(n & 0x7FFFFFFFFFFFFFFF) if n < 0 else n


def _b(x):
    """A bytes-like result as bytes; anything else as it is, for the check to refuse."""
    if isinstance(x, (bytearray, memoryview)):
        return bytes(x)
    if isinstance(x, list) and all(type(v) is int and 0 <= v < 256 for v in x):
        return bytes(x)
    return x


def _hex_of(b):
    if b is None:
        return "null"
    if type(b) is bytes:
        return b.hex()
    return repr(b)


def _str_or_null(s):
    if s is None:
        return "null"
    if type(s) is str:
        return '"' + s + '"'
    return repr(s)


def _wrap(x, ty):
    """x as the integer type ty holds it: modulo 2**bits, two's complement when signed."""
    bits = int(ty[1:])
    x &= (1 << bits) - 1
    if ty[0] == "i" and x >= 1 << (bits - 1):
        x -= 1 << bits
    return x


def _rem(a, b, ty):
    """The contract's a % b: truncating, and 0 when b is 0 (or -1, signed)."""
    if b == 0 or (ty[0] == "i" and b == -1):
        return 0
    r = abs(a) % abs(b)
    return -r if a < 0 else r


def _slice(b, lo, hi):
    """b[lo, hi), both ends clamped into b."""
    n = len(b)
    lo = min(max(lo, 0), n)
    hi = min(max(hi, lo), n)
    return bytes(b[lo:hi])


def _fill(v, n):
    return bytes([v & 255]) * max(n, 0)


def _flip_bit(b, bit):
    """A copy of b with bit (mod 8 * len(b)) inverted."""
    out = bytearray(b)
    if len(out) > 0:
        at = bit % (len(out) * 8)
        out[at >> 3] ^= 1 << (at & 7)
    return bytes(out)


def _bitwise(a, b, k):
    """a and b byte by byte (k 0: xor, 1: and, 2: or); the shorter reads as zeros."""
    out = bytearray()
    for i in range(max(len(a), len(b))):
        x = a[i] if i < len(a) else 0
        y = b[i] if i < len(b) else 0
        out.append(x & y if k == 1 else x | y if k == 2 else x ^ y)
    return bytes(out)


def _le64(n):
    return (n & 0xFFFFFFFFFFFFFFFF).to_bytes(8, "little")


def _utf8(s):
    return s.encode("utf-8", "surrogateescape")


def _str_len(s):
    return len(_utf8(s))


def _char_at(s, i):
    """The byte at i as a string, or "" out of range."""
    b = _utf8(s)
    if i < 0 or i >= len(b):
        return ""
    return b[i : i + 1].decode("utf-8", "surrogateescape")


def _ascii(b):
    if any(x >= 128 for x in b):
        return None
    return bytes(b).decode("ascii")


def _shift_case(s, lo, hi, delta):
    """s with every character in [lo, hi] moved by delta (ASCII case mapping)."""
    return "".join(chr(ord(c) + delta) if lo <= ord(c) <= hi else c for c in s)


class _Unwrap:
    """unwrap that records a None and stands in empty, so the sample fails."""

    def __init__(self):
        self.saw_null = False

    def get(self, x, empty):
        if x is None:
            self.saw_null = True
            return empty
        return x`

/** The pytest hook every `test_<clause>` calls. */
const EMIT_PY_PYTEST: string = `def _pytest(check, name):
    """A clause's check as a pytest test: a failure asserts with its detail."""
    t = Suite(name)
    passed = _run(t, check, name)
    if t.skipped > 0:
        import pytest

        pytest.skip(t.detail)
    assert passed, t.detail`

/** \`main\`: every clause run in order, then the end line with the nonce \`spec run\` passes. */
const emitPyMain = (c: Contract): string => {
  const lines: string[] = ["def main():", `    t = Suite(${emitQuote(c.contract)})`, `    ran = ""`]
  for (const k of c.clauses) {
    lines.push(`    ran += "1" if _run(t, ${emitClauseFn(k)}, ${emitQuote(emitTestName(k))}) else "0"`)
  }
  lines.push("    code = t.done()")
  lines.push(`    nonce = sys.argv[1] if len(sys.argv) > 1 else "-"`)
  lines.push(`    print(f"vector-done {nonce} {ran}")`)
  lines.push("    return code")
  return lines.join("\n")
}

/**
 * The whole Python test for a contract: a header naming the contract's
 * sha256, the imports, the suite and helpers, one check per clause under the
 * requirements it covers, `main`, and with the pytest harness one
 * `test_<clause>` per clause.
 *
 * @param c the contract, already checked
 * @param table the property samples `checkContract` chose
 * @param opts the header's regenerate command, the contract's sha256, and the
 *   modules `--package` places
 * @param harness `standalone` or `pytest`
 * @returns the test's text, or every reason Python cannot express the contract
 */
export const emitPyProgram = (
  c: Contract,
  table: SampleTable,
  opts: EmitOptions,
  harness: string,
): Result<string, string[]> => {
  const refused = emitPyRefusals(c)
  if (refused.length > 0) {
    return Err(refused)
  }
  const ctx = new EmitPyContext(c, opts)
  const bodies: string[] = []
  const called: string[] = []
  for (const k of c.clauses) {
    if (k.kind === ClauseKind.Vector) {
      called.push(k.call)
      bodies.push(`${emitPyComment(c, k)}\n${emitPyVector(ctx, k)}`)
    } else {
      const assert = k.assert
      if (assert !== null) {
        for (const n of typeCallsIn(assert)) {
          called.push(n)
        }
      }
      bodies.push(`${emitPyComment(c, k)}\n${emitPyProperty(ctx, k, checkSamplesOf(table, k.id))}`)
    }
  }
  if (ctx.errors.length > 0) {
    return Err(ctx.errors)
  }
  const header = emitHeaderLines(c, opts)
    .map((l: string): string => (l === "" ? "#" : `# ${l}`))
    .join("\n")
  const parts: string[] = [`${header}\n${EMIT_PY_HEAD}`]
  const imports = emitPyImports(ctx, called)
  if (imports !== "") {
    parts.push(imports)
  }
  parts.push(EMIT_PY_RUNTIME)
  for (const b of bodies) {
    parts.push(b)
  }
  parts.push(emitPyMain(c))
  if (harness === "pytest") {
    parts.push(EMIT_PY_PYTEST)
    for (const k of c.clauses) {
      const fn = emitClauseFn(k)
      parts.push(`def test_${fn.substring(7, fn.length)}():\n    _pytest(${fn}, ${emitQuote(emitTestName(k))})`)
    }
  }
  parts.push(`if __name__ == "__main__":\n    sys.exit(main())`)
  return Ok(`${parts.join("\n\n\n")}\n`)
}
