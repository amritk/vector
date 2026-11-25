/**
 * `spec/emit/emit` — a contract and its samples as a Nish test program.
 *
 * The program imports the functions under test from the contract's target
 * module and checks every clause with `nish/testing`'s Suite, one line per
 * clause: `PASS  [<clause id>] <title> (<requirements>)`. The bracketed id is
 * how `vector spec run` maps the output back to the requirements.
 *
 * Nish has no closures, exceptions or generics, which shapes the output:
 *   - a property is a loop over baked sample tables (the solver and the PRNG
 *     ran at check time, so a failure reproduces byte for byte);
 *   - `unwrap` of a null cannot throw, so it records the null on an `Unwrap`
 *     and the sample fails;
 *   - every helper is spelled for one type, and only the ones used are
 *     emitted.
 */

import { Sample, SampleTable, checkSamplesOf } from "../check"
import { capacityNish, capacityParse } from "../contract/capacity"
import { shapeNishModuleFile } from "../contract/shape"
import { ClauseKind, ExprKind, LitKind, typesIsWindow, typesIsWords } from "../contract/types"
import { Clause, Contract, Expr, FnSig, Literal } from "../contract/types"
import { TypeEnv, typeCallsIn, typeEnvBind, typeIntBase, typeOf } from "../contract/typing"
import {
  vocabBaseOf,
  vocabBigEndian,
  vocabByteWidth,
  vocabHas,
  vocabIsIntType,
  vocabIsOptional,
  vocabIsWordType,
  vocabReadOps,
  vocabReadType,
  vocabValueType,
  vocabWriteOps,
} from "../contract/vocab"
import { emitHelperDeps, emitHelperNames, emitHelperText } from "./helpers"
import {
  EMIT_SLOW_SKIP,
  emitCommentText,
  emitF64IsFinite,
  emitF64Lit,
  emitIntLit,
  emitLiteralHex,
  emitQuote,
  emitToInt,
} from "./lit"

const EMIT_NO_F64_FORALL: string = "the sampler has no f64 forall variable yet, so Nish has no samples to check"
const EMIT_NO_SMALL_INT: string = "Nish has no i8 or i16: write the parameter as i32"

/** How the emitted header describes the program. */
export class EmitOptions {
  /** How to regenerate the file, shown in the header; null to leave it out. */
  regenerate: string | null = null
  /** The sha256 of the contract file, written as `// vector-contract-sha256: <hex>`. */
  contractSha256: string
  /** Modules outside nish/ the test may import, each beside its import path in `localImports`. */
  localModules: string[]
  /** How the test imports each of `localModules`: a relative path, such as `../../src/core/hex`. */
  localImports: string[]
  /** Whether a slow iterated vector runs; when false it is emitted skipped. */
  slow: boolean

  /**
   * Makes options with no regenerate line and only nish/ modules.
   *
   * @param contractSha256 the sha256 of the contract file's bytes, in hex
   */
  constructor(contractSha256: string) {
    this.contractSha256 = contractSha256
    this.localModules = []
    this.localImports = []
    this.slow = false
  }
}

/** What emitting one program has gathered so far. */
class EmitContext {
  c: Contract
  opts: EmitOptions
  /** The helpers used, in first-use order. */
  used: string[]
  /** What the program imports from nish:secret and nish:unsafe. */
  secretNames: string[]
  unsafeNames: string[]
  /** The `plain_` wrappers of functions that take or return a Secret, with their text. */
  wrapperNames: string[]
  wrapperTexts: string[]
  /** The names in scope: the forall variables, then let bindings. */
  env: TypeEnv
  /** What Nish cannot express, found while emitting. */
  errors: string[]

  constructor(c: Contract, opts: EmitOptions) {
    this.c = c
    this.opts = opts
    this.used = []
    this.secretNames = []
    this.unsafeNames = []
    this.wrapperNames = []
    this.wrapperTexts = []
    this.env = new TypeEnv(c.functions, true)
    this.errors = []
  }
}

/** Adds `s` to `list` unless it is there. */
const emitAddOnce = (list: string[], s: string): void => {
  if (list.indexOf(s) < 0) {
    list.push(s)
  }
}

/** Whether `a` sorts before `b`, by UTF-8 bytes. */
const emitStrLess = (a: string, b: string): boolean => {
  const n = a.length < b.length ? a.length : b.length
  for (let i = 0; i < n; i++) {
    const x = toI32(a.charCodeAt(i))
    const y = toI32(b.charCodeAt(i))
    if (x !== y) {
      return x < y
    }
  }
  return a.length < b.length
}

/**
 * Strings in byte order, duplicates dropped.
 *
 * @param xs the strings
 * @returns them sorted, each once
 */
export const emitSortedUnique = (xs: string[]): string[] => {
  const out: string[] = []
  for (const x of xs) {
    if (out.indexOf(x) < 0) {
      out.push(x)
      let i = out.length - 1
      while (i > 0 && emitStrLess(out[i], out[i - 1])) {
        const t = out[i]
        out[i] = out[i - 1]
        out[i - 1] = t
        i--
      }
    }
  }
  return out
}

/** Marks a helper (and what it calls) as used; answers its name. */
const emitUse = (ctx: EmitContext, h: string): string => {
  if (ctx.used.indexOf(h) < 0) {
    ctx.used.push(h)
    for (const d of emitHelperDeps(h)) {
      emitUse(ctx, d)
    }
  }
  return h
}

/**
 * A contract value type as Nish spells it.
 *
 * @param t a value type (`bytes`, `string?`, `u32`, …)
 * @returns the Nish type
 */
export const emitNishType = (t: string): string => {
  const base = vocabBaseOf(t)
  let out = base
  if (base === "bytes") {
    out = "u8[]"
  } else if (base === "bool") {
    out = "boolean"
  } else if (vocabIsWordType(base)) {
    out = `u${base.substring(5, 7)}[]`
  }
  return vocabIsOptional(t) ? `${out} | null` : out
}

const emitFn = (ctx: EmitContext, name: string): FnSig | null => {
  for (const f of ctx.c.functions) {
    if (f.name === name) {
      return f
    }
  }
  return null
}

const emitIsSecret = (t: string): boolean => t !== vocabValueType(t)

/** Whether `sig` takes or returns a Secret. */
const emitTakesSecret = (sig: FnSig): boolean => {
  let secret = emitIsSecret(sig.returns)
  for (const p of sig.params) {
    secret = secret || emitIsSecret(p.type)
  }
  return secret
}

/** Whether `sig` takes a window. */
const emitTakesWindow = (sig: FnSig): boolean => sig.params.some((p): boolean => typesIsWindow(p))

/**
 * Whether a call of `sig` goes through its `plain_` wrapper: it takes or
 * returns a Secret, takes a window, or writes into an out buffer.
 */
const emitWraps = (sig: FnSig): boolean => emitTakesSecret(sig) || emitTakesWindow(sig) || sig.out !== null

/** Whether `e` calls a function that writes into an out buffer, so its clause holds an `OutFault`. */
const emitCallsOut = (ctx: EmitContext, e: Expr): boolean =>
  typeCallsIn(e).some((n: string): boolean => {
    const sig = emitFn(ctx, n)
    return sig !== null && sig.out !== null
  })

/** Where in an out buffer the function under test is told to write: guard bytes before and after. */
const EMIT_OUT_AT: i32 = 5

/** How many guard bytes a window's bytes sit after, so its offset is never 0. */
const EMIT_WINDOW_LEAD: i32 = 3

/** How many guard bytes follow a window's bytes, so a read past its length is seen. */
const EMIT_WINDOW_TAIL: i32 = 3

/**
 * `sig.name` on plain bytes. Under nish's rules for a Secret, each secret
 * argument is a fresh copy wrapped with `secret` and wiped after the call,
 * and a secret result is copied out with `expose`, then wiped. A window's
 * bytes are passed as `(buf, off, len)`, between guard bytes (0xa5 before,
 * 0x5a after), so a function that reads from 0 or past `len` sees them. An
 * out buffer is passed as `(out, at)`: `at` guard bytes, then its capacity,
 * then as many again, and `OutFault` takes `[at, end)` out of it.
 */
const emitPlainWrapper = (ctx: EmitContext, sig: FnSig, name: string): string => {
  const secret = emitTakesSecret(sig)
  if (secret) {
    emitUse(ctx, "copyBytes")
    emitAddOnce(ctx.secretNames, "Secret")
    emitAddOnce(ctx.secretNames, "wipe")
  }
  const params: string[] = []
  const args: string[] = []
  const body: string[] = []
  const wipes: string[] = []
  const o = sig.out
  if (o !== null) {
    params.push("of: OutFault")
  }
  for (const p of sig.params) {
    if (o !== null && args.length === o.at) {
      args.push(`o_out, ${EMIT_OUT_AT}`)
    }
    params.push(`a_${p.name}: ${emitNishType(vocabValueType(p.type))}`)
    if (typesIsWindow(p)) {
      const cat = emitUse(ctx, "concatBytes")
      const fill = emitUse(ctx, "fillBytes")
      const lead = `${fill}(0xa5, ${EMIT_WINDOW_LEAD})`
      const tail = `${fill}(0x5a, ${EMIT_WINDOW_TAIL})`
      body.push(`  const w_${p.name}: u8[] = ${cat}(${cat}(${lead}, a_${p.name}), ${tail});`)
      args.push(`w_${p.name}, ${EMIT_WINDOW_LEAD}, a_${p.name}.length`)
    } else if (!emitIsSecret(p.type)) {
      args.push(`a_${p.name}`)
    } else {
      emitAddOnce(ctx.secretNames, "secret")
      if (p.type === "secret-bytes") {
        body.push(`  const s_${p.name}: Secret<u8[]> = secret(copyBytes(a_${p.name}));`)
        wipes.push(`  wipe(s_${p.name});`)
      } else {
        body.push(`  let s_${p.name}: Secret<u8[]> | null = null;`)
        body.push(`  if (a_${p.name} !== null) {`)
        body.push(`    s_${p.name} = secret(copyBytes(a_${p.name}));`)
        body.push("  }")
        wipes.push(`  if (s_${p.name} !== null) {`)
        wipes.push(`    wipe(s_${p.name});`)
        wipes.push("  }")
      }
      args.push(`s_${p.name}`)
    }
  }
  if (o !== null && args.length === o.at) {
    args.push(`o_out, ${EMIT_OUT_AT}`)
  }
  const call = `${sig.name}(${args.join(", ")})`
  const ret = vocabValueType(sig.returns)
  if (o !== null) {
    emitOutBody(ctx, sig, o.capacity, call, wipes, body)
  } else if (emitIsSecret(sig.returns)) {
    emitAddOnce(ctx.secretNames, "expose")
    body.push(`  const r: Secret<u8[]>${ret === "bytes?" ? " | null" : ""} = ${call};`)
    for (const w of wipes) {
      body.push(w)
    }
    if (ret === "bytes?") {
      body.push("  if (r === null) {")
      body.push("    return null;")
      body.push("  }")
    }
    body.push("  const out: u8[] = expose(r, copyBytes);")
    body.push("  wipe(r);")
    body.push("  return out;")
  } else {
    body.push(`  const r: ${emitNishType(ret)} = ${call};`)
    for (const w of wipes) {
      body.push(w)
    }
    body.push("  return r;")
  }
  const how: string[] = []
  if (secret) {
    how.push("secrets are copied in, wiped after")
  }
  if (emitTakesWindow(sig)) {
    how.push("a window is passed as (buf, off, len) between guard bytes")
  }
  if (o !== null) {
    how.push("the out buffer is passed as (out, at) between guard bytes, and [at, end) is the result")
  }
  return [
    `/** ${sig.name} on plain bytes: ${how.join("; ")}. */`,
    `const ${name} = (${params.join(", ")}): ${emitNishType(ret)} => {`,
    body.join("\n"),
    "};",
  ].join("\n")
}

/**
 * The tail of an out buffer's wrapper: the buffer filled with guard bytes,
 * the call, then the result, `null` for a negative end when it may be null,
 * else what `OutFault` takes out of `[at, end)`.
 */
const emitOutBody = (
  ctx: EmitContext,
  sig: FnSig,
  capacity: string,
  call: string,
  wipes: string[],
  body: string[],
): void => {
  const fill = emitUse(ctx, "fillBytes")
  const cap = capacityParse(capacity)
  if (cap.isErr()) {
    ctx.errors.push(`${sig.name}: its capacity \`${capacity}\` ${cap.error}`)
    return
  }
  body.push(`  const o_cap: i32 = of.cap("${sig.name}", ${capacityNish(cap.value, "a_")});`)
  body.push("  if (o_cap < 0) {")
  for (const w of wipes) {
    body.push(`  ${w}`)
  }
  body.push(`    return ${fill}(0, 0);`)
  body.push("  }")
  body.push(`  const o_out: u8[] = ${fill}(0xa5, o_cap + ${2 * EMIT_OUT_AT});`)
  body.push(`  const o_end: i32 = ${call};`)
  for (const w of wipes) {
    body.push(w)
  }
  if (vocabValueType(sig.returns) === "bytes?") {
    body.push("  if (o_end < 0) {")
    body.push("    return null;")
    body.push("  }")
  }
  body.push(`  return of.take("${sig.name}", o_out, ${EMIT_OUT_AT}, o_end, o_cap);`)
}

/**
 * A call of a contract function on emitted arguments. One that takes or
 * returns a Secret, or takes a window, goes through a `plain_` wrapper, so
 * the rest of the test sees one plain bytes value.
 */
const emitCall = (ctx: EmitContext, sig: FnSig, args: string[]): string => {
  if (!emitWraps(sig)) {
    return `${sig.name}(${args.join(", ")})`
  }
  const name = `plain_${sig.name}`
  if (ctx.wrapperNames.indexOf(name) < 0) {
    ctx.wrapperNames.push(name)
    ctx.wrapperTexts.push(emitPlainWrapper(ctx, sig, name))
  }
  if (sig.out !== null) {
    emitUse(ctx, "OutFault")
    return `${name}(of, ${args.join(", ")})`
  }
  return `${name}(${args.join(", ")})`
}

/** A word's hex digits: the word as printed, without its `0x` (the literal is lowercase). */
const emitWordDigits = (w: string): string => (w.startsWith("0x") ? w.substring(2, w.length) : w)

/**
 * One word as a Nish value of its width. Each is typed on its own, from zero,
 * since an array literal in an optional parameter's place is read as i32[]
 * and a u64 literal past 2^53 is refused; a 64-bit word is its two halves.
 */
const emitWord = (digits: string): string => {
  if (digits.length === 4) {
    return `(toU16(0) + 0x${digits})`
  }
  if (digits.length === 8) {
    return `(toU32(0) + 0x${digits})`
  }
  const hi = digits.substring(0, 8)
  const lo = `(toU64(0) + 0x${digits.substring(8, 16)})`
  return hi === "00000000" ? lo : `(((toU64(0) + 0x${hi}) << toU64(32)) | ${lo})`
}

/** A word-array literal as a Nish array. */
const emitWordsLit = (lit: Literal): string => {
  const words: string[] = []
  for (const w of lit.words) {
    words.push(emitWord(emitWordDigits(w)))
  }
  return `[${words.join(", ")}]`
}

/** A word-array literal's words as the wordsHex helpers print them. */
const emitWordsWant = (lit: Literal): string => {
  const words: string[] = []
  for (const w of lit.words) {
    words.push(emitWordDigits(w))
  }
  return `[${words.join(" ")}]`
}

/** A literal where a value of type `ty` goes. */
const emitLiteral = (ctx: EmitContext, lit: Literal, ty: string): string => {
  if (lit.kind === LitKind.Null) {
    return "null"
  }
  if (lit.kind === LitKind.Bool) {
    return lit.flag ? "true" : "false"
  }
  if (lit.kind === LitKind.Int) {
    return emitIntLit(lit.text, typeIntBase(ty) ?? "i32")
  }
  if (lit.kind === LitKind.F64) {
    return emitF64Lit(lit.text, lit.bits)
  }
  if (lit.kind === LitKind.Str) {
    return emitQuote(lit.text)
  }
  if (typesIsWords(lit.kind)) {
    return emitWordsLit(lit)
  }
  return `${emitUse(ctx, "unhex")}("${emitLiteralHex(lit)}")`
}

/** The type of a (contract-checked) expression in the current scope. */
const emitTypeOf = (ctx: EmitContext, e: Expr): string => {
  const errors: string[] = []
  return typeOf(e, ctx.env, "", errors) ?? "null"
}

const emitIsBytesLike = (t: string): boolean => t === "bytes" || t === "bytes?" || t === "null"
const emitIsStringLike = (t: string): boolean => t === "string" || t === "string?" || t === "null"

/**
 * An integer of type `natural` where `want` is wanted, converted when the
 * two differ (only an i32 where a u32 is wanted type-checks): Nish converts
 * nothing on its own.
 */
const emitConv = (s: string, natural: string, want: string | null): string => {
  const w: string | null = want === null ? null : typeIntBase(want)
  if (w !== null && w !== "i32" && natural !== w && vocabIsIntType(natural)) {
    return `${emitToInt(w)}(${s})`
  }
  return s
}

/** The integer type an arithmetic or comparison op's operands share, which an int literal among them takes. */
const emitOperands = (ctx: EmitContext, e: Expr): string => {
  for (const x of e.args) {
    if (x.kind !== ExprKind.Lit) {
      const t = emitTypeOf(ctx, x)
      if (vocabIsIntType(t)) {
        return t
      }
    }
  }
  return emitTypeOf(ctx, e.args[0])
}

/** Argument `i` of an op, wanted at `want`. */
const emitArg = (ctx: EmitContext, e: Expr, i: i32, want: string | null): string => emitExpr(ctx, e.args[i], want)

/**
 * An expression where a value of type `want` goes (null: its own type).
 * Contract names are emitted as `v_<name>` locals.
 */
const emitExpr = (ctx: EmitContext, e: Expr, want: string | null): string => {
  if (e.kind === ExprKind.Var) {
    return emitConv(`v_${e.name}`, emitTypeOf(ctx, e), want)
  }
  if (e.kind === ExprKind.Call) {
    const sig = emitFn(ctx, e.name)
    if (sig === null) {
      ctx.errors.push(`unknown function ${e.name}`)
      return ""
    }
    const args: string[] = []
    for (let i = 0; i < e.args.length; i++) {
      args.push(emitExpr(ctx, e.args[i], vocabValueType(sig.params[i].type)))
    }
    return emitCall(ctx, sig, args)
  }
  if (e.kind === ExprKind.Let) {
    ctx.errors.push("a let may only open the assert")
    return ""
  }
  if (e.kind === ExprKind.Lit) {
    const lit = e.lit
    if (lit === null) {
      return ""
    }
    return emitLiteral(ctx, lit, want ?? "bytes")
  }
  return emitOp(ctx, e, want)
}

/** The ops on bytes and strings, which go through a helper. */
const emitHelperOp = (ctx: EmitContext, e: Expr): string | null => {
  const op = e.name
  if (op === "concat") {
    return `${emitUse(ctx, "concatBytes")}(${emitArg(ctx, e, 0, null)}, ${emitArg(ctx, e, 1, null)})`
  }
  if (op === "slice") {
    const b = emitArg(ctx, e, 0, null)
    return `${emitUse(ctx, "sliceBytes")}(${b}, ${emitArg(ctx, e, 1, null)}, ${emitArg(ctx, e, 2, null)})`
  }
  if (op === "zeros") {
    return `${emitUse(ctx, "fillBytes")}(0, ${emitArg(ctx, e, 0, null)})`
  }
  if (op === "fill") {
    return `${emitUse(ctx, "fillBytes")}(${emitArg(ctx, e, 0, null)}, ${emitArg(ctx, e, 1, null)})`
  }
  if (op === "flipBit") {
    return `${emitUse(ctx, "flipBit")}(${emitArg(ctx, e, 0, null)}, ${emitArg(ctx, e, 1, null)})`
  }
  const bitwise = ["xor", "bitAnd", "bitOr"].indexOf(op)
  if (bitwise >= 0) {
    const a = emitArg(ctx, e, 0, null)
    return `${emitUse(ctx, "bitwiseBytes")}(${a}, ${emitArg(ctx, e, 1, null)}, ${bitwise})`
  }
  if (vocabHas(vocabWriteOps(), op)) {
    const n = emitToU64(ctx, e.args[0])
    return `${emitUse(ctx, "intBytes")}(${n}, ${vocabByteWidth(op)}, ${vocabBigEndian(op)})`
  }
  if (vocabHas(vocabReadOps(), op)) {
    const read = `${emitUse(ctx, "bytesInt")}(u, ${emitArg(ctx, e, 0, null)}, ${vocabByteWidth(op)}, ${vocabBigEndian(op)})`
    const ty = vocabReadType(op)
    return ty === "u64" ? read : `${emitToInt(ty)}(${read})`
  }
  if (op === "strConcat") {
    return `\`\${${emitArg(ctx, e, 0, null)}}\${${emitArg(ctx, e, 1, null)}}\``
  }
  if (op === "lower") {
    return `${emitUse(ctx, "shiftCase")}(${emitArg(ctx, e, 0, null)}, false)`
  }
  if (op === "upper") {
    return `${emitUse(ctx, "shiftCase")}(${emitArg(ctx, e, 0, null)}, true)`
  }
  if (op === "utf8") {
    return `${emitUse(ctx, "utf8Bytes")}(${emitArg(ctx, e, 0, null)})`
  }
  if (op === "ascii") {
    return `${emitUse(ctx, "asciiOrNull")}(${emitArg(ctx, e, 0, null)})`
  }
  if (op === "charAt") {
    return `${emitUse(ctx, "charAtStr")}(${emitArg(ctx, e, 0, null)}, ${emitArg(ctx, e, 1, null)})`
  }
  return null
}

/** An integer expression as a u64 of the same bits, which `intBytes` writes. */
const emitToU64 = (ctx: EmitContext, x: Expr): string => {
  const t = emitTypeOf(ctx, x)
  const s = emitExpr(ctx, x, t)
  return t === "u64" ? s : `toU64(${s})`
}

/** An operator application. */
const emitOp = (ctx: EmitContext, e: Expr, want: string | null): string => {
  const op = e.name
  const viaHelper = emitHelperOp(ctx, e)
  if (viaHelper !== null) {
    return emitConv(viaHelper, emitTypeOf(ctx, e), want)
  }
  if (op === "len" || op === "strLen") {
    return emitConv(`toI32(${emitArg(ctx, e, 0, null)}.length)`, "i32", want)
  }
  if (op === "unwrap") {
    if (emitTypeOf(ctx, e.args[0]) === "string?") {
      emitUse(ctx, "unwrapStr")
      return `u.str(${emitArg(ctx, e, 0, null)})`
    }
    emitUse(ctx, "Unwrap")
    return `u.get(${emitArg(ctx, e, 0, null)})`
  }
  if (op === "isNull" || op === "notNull") {
    const h = emitTypeOf(ctx, e.args[0]) === "string?" ? "isNullStr" : "isNullBytes"
    return `${op === "notNull" ? "!" : ""}${emitUse(ctx, h)}(${emitArg(ctx, e, 0, null)})`
  }
  if (op === "+" || op === "-" || op === "*") {
    const t = emitOperands(ctx, e)
    if (t === "i32" || t === "i64") {
      // Signed overflow panics in Nish; the contract wraps, as evalPure and
      // the sampler do, so i32 and i64 go through nish:unsafe's
      // two's-complement wrap. The unsigned words already wrap.
      const w = op === "+" ? "wrappingAdd" : op === "-" ? "wrappingSub" : "wrappingMul"
      emitAddOnce(ctx.unsafeNames, w)
      return emitConv(`${w}(${emitArg(ctx, e, 0, t)}, ${emitArg(ctx, e, 1, t)})`, emitTypeOf(ctx, e), want)
    }
    return emitConv(`(${emitArg(ctx, e, 0, t)} ${op} ${emitArg(ctx, e, 1, t)})`, emitTypeOf(ctx, e), want)
  }
  if (op === "%") {
    // Through a helper, so a computed zero divisor gives 0 here exactly as
    // the sampler gives it when it evaluates `where`.
    const t = emitOperands(ctx, e)
    const h = emitUse(ctx, `rem${t === "i32" ? "I32" : emitToInt(t).substring(2, 5)}`)
    return emitConv(`${h}(${emitArg(ctx, e, 0, t)}, ${emitArg(ctx, e, 1, t)})`, emitTypeOf(ctx, e), want)
  }
  if (op === "<" || op === "<=" || op === ">" || op === ">=") {
    const t = emitOperands(ctx, e)
    return `(${emitArg(ctx, e, 0, t)} ${op} ${emitArg(ctx, e, 1, t)})`
  }
  if (op === "==" || op === "!=") {
    // A null literal takes its kind from the other side.
    const l = emitTypeOf(ctx, e.args[0])
    const side = l === "null" ? emitTypeOf(ctx, e.args[1]) : l
    const h = emitIsBytesLike(side) ? "bytesEq" : emitIsStringLike(side) ? "strEq" : ""
    if (h !== "") {
      const eq = `${emitUse(ctx, h)}(${emitArg(ctx, e, 0, null)}, ${emitArg(ctx, e, 1, null)})`
      return op === "==" ? eq : `!${eq}`
    }
    const t: string | null = vocabIsIntType(side) ? emitOperands(ctx, e) : null
    return `(${emitArg(ctx, e, 0, t)} ${op === "==" ? "===" : "!=="} ${emitArg(ctx, e, 1, t)})`
  }
  if (op === "and" || op === "or") {
    const parts: string[] = []
    for (let i = 0; i < e.args.length; i++) {
      parts.push(emitArg(ctx, e, i, null))
    }
    return `(${parts.join(op === "and" ? " && " : " || ")})`
  }
  if (op === "not") {
    return `!${emitArg(ctx, e, 0, null)}`
  }
  if (op === "implies") {
    return `(!${emitArg(ctx, e, 0, null)} || ${emitArg(ctx, e, 1, null)})`
  }
  ctx.errors.push(`Nish has no spelling for the op ${op}`)
  return ""
}

/**
 * `const` locals for the lets that open `assert` (each evaluated once, in
 * order), pushed onto `out`; answers the expression they scope over.
 */
const emitBindings = (ctx: EmitContext, assert: Expr, indent: string, out: string[]): Expr => {
  let e = assert
  while (e.kind === ExprKind.Let) {
    for (const b of e.binds) {
      const ty = emitTypeOf(ctx, b.value)
      out.push(`${indent}const v_${b.name}: ${emitNishType(ty)} = ${emitExpr(ctx, b.value, null)};`)
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
const emitHasOp = (e: Expr, op: string): boolean => {
  if (e.kind === ExprKind.Op && e.name === op) {
    return true
  }
  for (const a of e.args) {
    if (emitHasOp(a, op)) {
      return true
    }
  }
  for (const b of e.binds) {
    if (emitHasOp(b.value, op)) {
      return true
    }
  }
  const body = e.body
  return body !== null && emitHasOp(body, op)
}

/** Whether `e` reads an integer from bytes anywhere in it. */
const emitHasRead = (e: Expr): boolean => {
  for (const op of vocabReadOps()) {
    if (emitHasOp(e, op)) {
      return true
    }
  }
  return false
}

/**
 * Why a sample of an assertion is undefined, in every language: an `unwrap`
 * met a null, or a read met the wrong number of bytes. Both record on the
 * test's unwrap recorder, so the sample fails.
 *
 * @param assert the property's assertion
 * @returns the failure's reason, or null when the assertion neither unwraps nor reads
 */
export const emitUndefinedWhy = (assert: Expr): string | null => {
  const unwraps = emitHasOp(assert, "unwrap")
  const reads = emitHasRead(assert)
  if (unwraps && reads) {
    return "unwrap met a null, or a read met the wrong number of bytes"
  }
  if (reads) {
    return "a read met the wrong number of bytes"
  }
  return unwraps ? "unwrap met a null" : null
}

/**
 * A clause's test name: `[id] title (R1, R2)`.
 *
 * @param k the clause
 * @returns the name its PASS or FAIL line carries
 */
export const emitTestName = (k: Clause): string => `[${k.id}] ${k.title} (${k.covers.join(", ")})`

/**
 * The function a clause is checked by: `clause_` and its id, with every
 * character but a letter, a digit or `_` as `_`.
 *
 * @param k the clause
 * @returns the function's name
 */
export const emitClauseFn = (k: Clause): string => {
  const out: string[] = ["clause_"]
  for (let i = 0; i < k.id.length; i++) {
    const c = toI32(k.id.charCodeAt(i))
    const keep = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95
    out.push(keep ? k.id.substring(i, i + 1) : "_")
  }
  return out.join("")
}

/** A source as a reader knows it: "RFC 8439", or its id for a spec that is not an RFC. */
const emitSourceName = (c: Contract, id: string | null): string => {
  const sources = c.sources
  if (id !== null && sources !== null) {
    for (const s of sources) {
      if (s.id === id) {
        return s.rfc > 0 ? `RFC ${s.rfc}` : id
      }
    }
  }
  const main = c.source.main
  if (id === null || (main !== null && id === main)) {
    return c.source.rfc > 0 ? `RFC ${c.source.rfc}` : main ?? "the spec"
  }
  return id
}

/**
 * Text cut into lines of at most `width` characters at spaces (a longer
 * word stands alone).
 *
 * @param text the text; runs of whitespace count as one space
 * @param width the widest line
 * @returns the lines
 */
export const emitWrap = (text: string, width: i32): string[] => {
  const words: string[] = []
  let start = -1
  for (let i = 0; i <= text.length; i++) {
    const c = i < text.length ? toI32(text.charCodeAt(i)) : 32
    const space = c === 32 || c === 9 || c === 10 || c === 13
    if (space && start >= 0) {
      words.push(text.substring(start, i))
      start = -1
    } else if (!space && start < 0) {
      start = i
    }
  }
  const out: string[] = []
  let cur = ""
  for (const w of words) {
    if (cur.length > 0 && cur.length + 1 + w.length > width) {
      out.push(cur)
      cur = w
    } else {
      cur = cur.length > 0 ? `${cur} ${w}` : w
    }
  }
  if (cur.length > 0) {
    out.push(cur)
  }
  return out
}

/**
 * The text above a clause's check, one comment line each with no comment
 * marker: its title, then each covered requirement, a blank line before it,
 * named with its source and level and its quote wrapped at 72 characters
 * under it. Each language puts its own marker in front.
 *
 * @param c the contract
 * @param k the clause
 * @returns the lines, "" for a blank one (the title, first, is never one)
 */
export const emitClauseLines = (c: Contract, k: Clause): string[] => {
  const lines: string[] = [emitCommentText(k.title)]
  const tr = k.truncate
  if (tr !== null) {
    lines.push(emitCommentText(`Holds the result's ${tr.label()} to the expected value.`))
  }
  for (const id of k.covers) {
    for (const r of c.requirements) {
      if (r.id === id) {
        lines.push("")
        lines.push(emitCommentText(`${r.id} — ${emitSourceName(c, r.source)} §${r.section}, ${r.level}:`))
        for (const l of emitWrap(r.quote, 72)) {
          lines.push(`  ${emitCommentText(l)}`)
        }
      }
    }
  }
  return lines
}

/** The doc comment above a clause: its title, then each covered requirement quoted. */
const emitDocComment = (c: Contract, k: Clause): string => {
  const lines: string[] = ["/**"]
  const body = emitClauseLines(c, k)
  for (let i = 0; i < body.length; i++) {
    // Only the blank lines between requirements are bare; a title is never.
    lines.push(i > 0 && body[i] === "" ? " *" : ` * ${body[i]}`)
  }
  lines.push(" */")
  return lines.join("\n")
}

/** A vector clause's check, as one arrow. */
const emitVector = (ctx: EmitContext, k: Clause): string => {
  const sig = emitFn(ctx, k.call)
  const expect = k.expect
  if (sig === null || expect === null) {
    ctx.errors.push(`${k.id}: no function ${k.call} or no expected value`)
    return ""
  }
  const args: string[] = []
  for (let i = 0; i < k.args.length; i++) {
    args.push(emitLiteral(ctx, k.args[i], vocabValueType(sig.params[i].type)))
  }
  const name = emitQuote(emitTestName(k))
  const it = k.iterate
  if (it !== null) {
    if (it.slow && !ctx.opts.slow) {
      return `const ${emitClauseFn(k)} = (t: Suite): boolean => {\n  t.skip(${name}, "${EMIT_SLOW_SKIP}");\n  return true;\n};`
    }
    const lines: string[] = sig.out === null ? [] : ["  const of: OutFault = new OutFault();"]
    for (const l of emitIterateSteps(ctx, k, sig, args, name)) {
      lines.push(l)
    }
    if (sig.out !== null) {
      emitOutFail(lines, "  ", name, "")
    }
    lines.push(`  return ${emitVectorCheck(ctx, k, sig, expect, name, "it_r")};`)
    return `const ${emitClauseFn(k)} = (t: Suite): boolean => {\n${lines.join("\n")}\n};`
  }
  if (sig.out !== null) {
    const lines: string[] = ["  const of: OutFault = new OutFault();", `  const o_r = ${emitCall(ctx, sig, args)};`]
    emitOutFail(lines, "  ", name, "")
    lines.push(`  return ${emitVectorCheck(ctx, k, sig, expect, name, "o_r")};`)
    return `const ${emitClauseFn(k)} = (t: Suite): boolean => {\n${lines.join("\n")}\n};`
  }
  return `const ${emitClauseFn(k)} = (t: Suite): boolean => ${emitVectorCheck(ctx, k, sig, expect, name, emitCall(ctx, sig, args))};`
}

/**
 * An iterated vector's calls, up to the last result bound as `it_r`: the
 * arguments (`it_a<i>`, by position, whatever the contract names them) start
 * as the vector's and are rebound to its `next` after each call; a null
 * result at any step fails the clause, naming the step.
 */
const emitIterateSteps = (ctx: EmitContext, k: Clause, sig: FnSig, args: string[], name: string): string[] => {
  const it = k.iterate
  if (it === null) {
    return []
  }
  const lines: string[] = []
  const vars: string[] = []
  for (let i = 0; i < it.names.length; i++) {
    vars.push(`it_a${i}`)
    lines.push(`  let it_a${i}: ${emitNishType(vocabValueType(sig.params[i].type))} = ${args[i]};`)
  }
  const count = emitIntLit(`${it.count}`, "i64")
  const optional = vocabIsOptional(vocabValueType(sig.returns))
  lines.push(`  for (let it_i: i64 = 1; it_i < ${count}; it_i += 1) {`)
  lines.push(`    const it_s = ${emitCall(ctx, sig, vars)};`)
  if (optional) {
    emitIterateNull(lines, "    ", name, "it_s", `\${it_i} of ${it.count}`, sig.name)
  }
  const next: string[] = []
  for (let i = 0; i < it.next.length; i++) {
    const e = it.next[i]
    next.push(e.kind === ExprKind.Call ? "it_s" : `it_a${toI32(it.names.indexOf(e.name))}`)
  }
  for (let i = 0; i < next.length; i++) {
    lines.push(`    const it_n${i} = ${next[i]};`)
  }
  for (let i = 0; i < next.length; i++) {
    lines.push(`    ${vars[i]} = it_n${i};`)
  }
  lines.push("  }")
  lines.push(`  const it_r = ${emitCall(ctx, sig, vars)};`)
  if (optional) {
    emitIterateNull(lines, "  ", name, "it_r", `${it.count} of ${it.count}`, sig.name)
  }
  return lines
}

/** Fails the clause `name`, after `where`, when an out buffer's write was wrong. */
const emitOutFail = (lines: string[], pad: string, name: string, where: string): void => {
  lines.push(`${pad}if (of.why.length > 0) {`)
  lines.push(`${pad}  return t.fail(${name}, \`${where}\${of.why}\`);`)
  lines.push(`${pad}}`)
}

/** Fails the clause `name` when step `step`'s result `v` is null. */
const emitIterateNull = (lines: string[], pad: string, name: string, v: string, step: string, fn: string): void => {
  lines.push(`${pad}if (${v} === null) {`)
  lines.push(`${pad}  return t.fail(${name}, \`step ${step}: ${fn} returned null\`);`)
  lines.push(`${pad}}`)
}

/** A vector's check of `call`, a call or a bound result, against its expected value. */
const emitVectorCheck = (
  ctx: EmitContext,
  k: Clause,
  sig: FnSig,
  expect: Literal,
  name: string,
  call: string,
): string => {
  const ret = vocabValueType(sig.returns)
  let body = ""
  const tr = k.truncate
  if (ret === "bytes" && tr !== null) {
    body = `t.eqStr(${name}, ${emitUse(ctx, "hexPrefix")}(${call}, ${tr.bytes}), "${emitLiteralHex(expect)}")`
  } else if (ret === "bytes") {
    body = `t.eqStr(${name}, ${emitUse(ctx, "hexOf")}(${call}), "${emitLiteralHex(expect)}")`
  } else if (ret === "bytes?") {
    const want = expect.kind === LitKind.Null ? "null" : emitLiteralHex(expect)
    body = `t.eqStr(${name}, ${emitUse(ctx, "hexOrNull")}(${call}), "${want}")`
  } else if (ret === "bool") {
    body = `t.eqBool(${name}, ${call}, ${expect.flag ? "true" : "false"})`
  } else if (ret === "i32") {
    body = `t.eqI32(${name}, ${call}, ${expect.text})`
  } else if (ret === "i64") {
    body = `t.eqI64(${name}, ${call}, ${emitIntLit(expect.text, "i64")})`
  } else if (ret === "u8" || ret === "u16" || ret === "u32" || ret === "u64") {
    body = `t.eqStr(${name}, \`\${${call}}\`, "${expect.text}")`
  } else if (ret === "f64") {
    body = emitVectorF64(ctx, k, expect, name, call)
  } else if (ret === "string") {
    body = `t.eqStr(${name}, ${call}, ${emitQuote(expect.text)})`
  } else if (ret === "string?") {
    const want = expect.kind === LitKind.Null ? "null" : `"${expect.text}"`
    body = `t.eqStr(${name}, ${emitUse(ctx, "strOrNull")}(${call}), ${emitQuote(want)})`
  } else if (vocabIsWordType(vocabBaseOf(ret))) {
    const want = expect.kind === LitKind.Null ? "null" : emitWordsWant(expect)
    const helper = emitUse(ctx, `wordsHex${vocabBaseOf(ret).substring(5, 7)}`)
    body = `t.eqStr(${name}, ${helper}(${call}), "${want}")`
  } else {
    ctx.errors.push(`${k.id}: Nish cannot check a ${sig.returns} result`)
  }
  return body
}

/**
 * An f64 vector's check: bit for bit, or within its tolerance. nearF64 fails
 * equal infinities and nearUlpsF64 fails every NaN, so a non-finite expected
 * value is checked bit for bit whatever the tolerance.
 */
const emitVectorF64 = (ctx: EmitContext, k: Clause, expect: Literal, name: string, call: string): string => {
  const want = emitF64Lit(expect.text, expect.bits)
  const tol = k.tolerance
  if (tol === null || !emitF64IsFinite(expect.text, expect.bits)) {
    return `${emitUse(ctx, "eqF64Bits")}(t, ${name}, ${call}, ${want})`
  }
  if (!tol.isUlps) {
    return `t.nearF64(${name}, ${call}, ${want}, ${emitF64Lit(tol.abs, null)})`
  }
  return `${emitUse(ctx, "nearUlpsF64")}(t, ${name}, ${call}, ${want}, ${emitIntLit(`${tol.ulps}`, "i64")})`
}

/** One forall variable's sample table, as a const. */
const emitTable = (ctx: EmitContext, name: string, type: string, j: i32, samples: Sample[], out: string[]): void => {
  const vals: string[] = []
  for (const s of samples) {
    const lit = s.args[j]
    if (type === "i32") {
      vals.push(lit.text)
    } else if (vocabIsIntType(type)) {
      vals.push(emitIntLit(lit.text, type))
    } else if (type === "bytes") {
      vals.push(`"${emitLiteralHex(lit)}"`)
    } else {
      vals.push(emitQuote(lit.text))
    }
  }
  if (vocabIsIntType(type)) {
    out.push(`  const table_${name}: ${type}[] = [${vals.join(", ")}];`)
    return
  }
  if (type === "bytes") {
    emitUse(ctx, "unhex")
  }
  out.push(`  const table_${name}: string[] = [`)
  for (const v of vals) {
    out.push(`    ${v},`)
  }
  out.push("  ];")
}

/** A property clause's check: a loop over its baked samples. */
const emitProperty = (ctx: EmitContext, k: Clause, samples: Sample[]): string => {
  const name = emitQuote(emitTestName(k))
  const count = samples.length
  const out: string[] = [`const ${emitClauseFn(k)} = (t: Suite): boolean => {`]
  const assert = k.assert
  if (count === 0 || assert === null) {
    out.push(`  t.skip(${name}, "no samples");`)
    out.push("  return true;")
    out.push("};")
    return out.join("\n")
  }
  for (let j = 0; j < k.forall.length; j++) {
    const v = k.forall[j]
    emitTable(ctx, v.name, v.type, j, samples, out)
  }
  const undefinedWhy = emitUndefinedWhy(assert)
  const usesUnwrap = undefinedWhy !== null
  out.push(`  for (let i: i32 = 0; i < ${count}; i += 1) {`)
  ctx.env = new TypeEnv(ctx.c.functions, true)
  const shown: string[] = []
  for (const v of k.forall) {
    typeEnvBind(ctx.env, v.name, v.type)
    if (v.type === "bytes") {
      out.push(`    const v_${v.name}: u8[] = unhex(table_${v.name}[i]);`)
    } else {
      out.push(`    const v_${v.name}: ${v.type} = table_${v.name}[i];`)
    }
    shown.push(
      vocabIsIntType(v.type) ? `${v.name} = \${v_${v.name}}` : `len(${v.name}) = \${toI32(v_${v.name}.length)}`,
    )
  }
  if (usesUnwrap) {
    out.push("    const u: Unwrap = new Unwrap();")
  }
  const usesOut = emitCallsOut(ctx, assert)
  if (usesOut) {
    out.push("    const of: OutFault = new OutFault();")
  }
  const body = emitBindings(ctx, assert, "    ", out)
  out.push(`    const holds: boolean = ${emitExpr(ctx, body, null)};`)
  const where = `sample \${i + 1} of ${count} (${shown.join(", ")})`
  if (usesOut) {
    emitOutFail(out, "    ", name, `${where}: `)
  }
  if (usesUnwrap) {
    out.push("    if (u.sawNull || !holds) {")
    out.push(`      let why: string = "the assertion is false";`)
    out.push("      if (u.sawNull) {")
    out.push(`        why = ${emitQuote(undefinedWhy ?? "")};`)
    out.push("      }")
    out.push(`      return t.fail(${name}, \`${where}: \${why}\`);`)
  } else {
    out.push("    if (!holds) {")
    out.push(`      return t.fail(${name}, \`${where}: the assertion is false\`);`)
  }
  out.push("    }")
  out.push("  }")
  out.push(`  return t.pass(${emitQuote(`${emitTestName(k)} — ${count} samples`)});`)
  out.push("};")
  return out.join("\n")
}

/** A signature type Nish cannot express, or null. */
const emitTypeRefusal = (at: string, t: string): string | null => {
  const base = vocabBaseOf(t)
  if (base === "i8" || base === "i16") {
    return `${at} is ${t}: ${EMIT_NO_SMALL_INT}`
  }
  if (vocabIsOptional(t) && (base === "bool" || base === "f64" || vocabIsIntType(base))) {
    return `${at} is ${t}: Nish has \`T | null\` only on a reference type`
  }
  return null
}

/** The refusal of a module that is neither nish's nor placed by `--package`. */
const emitNotPlaced = (m: string): string =>
  `${m} is not a nish/ module: give --package <name>=<dir> to say where your own modules live`

/**
 * What in a contract Nish cannot express, found before any output: a
 * module outside nish/ that is not one of `local`, an i8 or i16, a nullable bool, integer or f64 (Nish
 * has `T | null` only on a reference type), an f64 forall variable, two
 * clause ids that make the same function name, and a clause check or
 * `plain_` wrapper whose name a contract function already has.
 *
 * @param c the contract
 * @param local the modules outside nish/ that `--package` places
 * @returns one message per refusal; empty when Nish can express it all
 */
export const emitRefusals = (c: Contract, local: string[]): string[] => {
  const out: string[] = []
  const modules: string[] = [c.target.module]
  for (const f of c.functions) {
    const m = f.module
    if (m !== null) {
      modules.push(m)
    }
  }
  for (const m of modules) {
    if (shapeNishModuleFile(m) === null && local.indexOf(m) < 0 && out.indexOf(emitNotPlaced(m)) < 0) {
      out.push(emitNotPlaced(m))
    }
  }
  for (const f of c.functions) {
    for (const p of f.params) {
      const why = emitTypeRefusal(`${f.name}(${p.name})`, p.type)
      if (why !== null) {
        out.push(why)
      }
    }
    const why = emitTypeRefusal(`${f.name}'s result`, f.returns)
    if (why !== null) {
      out.push(why)
    }
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
        out.push(`${k.id}: ${v.name} is f64: ${EMIT_NO_F64_FORALL}`)
      } else if (v.type === "i8" || v.type === "i16") {
        out.push(`${k.id}: ${v.name} is ${v.type}: ${EMIT_NO_SMALL_INT}`)
      }
    }
  }
  // The test defines clause_* and plain_* functions beside the contract's
  // own: none may take a name a contract function already has.
  const names: string[] = []
  for (const f of c.functions) {
    names.push(f.name)
  }
  for (const f of c.functions) {
    if (emitWraps(f) && names.indexOf(`plain_${f.name}`) >= 0) {
      out.push(`${f.name}: its wrapper would be plain_${f.name}, which is a contract function's name`)
    }
  }
  for (let i = 0; i < fns.length; i++) {
    if (names.indexOf(fns[i]) >= 0) {
      out.push(`${c.clauses[i].id}: its check would be ${fns[i]}, which is a contract function's name`)
    }
  }
  return out
}

/**
 * The header every emitted test opens with, one comment line each with no
 * comment marker: what generated it from which contract, how to regenerate
 * it, how its checks are named, and the contract's sha256 last.
 *
 * @param c the contract
 * @param opts the regenerate command and the sha256
 * @returns the lines, "" for a blank one
 */
export const emitHeaderLines = (c: Contract, opts: EmitOptions): string[] => {
  const lines: string[] = [
    `GENERATED by vector from the contract "${emitCommentText(c.contract)}" (${emitCommentText(emitSourceName(c, c.source.main))},`,
  ]
  const regenerate = opts.regenerate
  if (regenerate === null) {
    lines.push(`${emitCommentText(c.source.title)}). Do not edit: change the contract and regenerate.`)
  } else {
    lines.push(`${emitCommentText(c.source.title)}). Do not edit: change the contract and regenerate with`)
    lines.push(`  ${emitCommentText(regenerate)}.`)
  }
  lines.push("")
  lines.push("Each check names its clause in brackets and the requirements it covers in")
  lines.push("parentheses; every requirement's text is quoted above its checks.")
  lines.push("Property samples were chosen by the solver (boundaries) and a seeded PRNG.")
  lines.push("")
  lines.push(`vector-contract-sha256: ${opts.contractSha256}`)
  return lines
}

/** The header comment, ending with the contract's sha256. */
const emitHeader = (c: Contract, opts: EmitOptions): string =>
  emitHeaderLines(c, opts)
    .map((l: string): string => (l === "" ? "//" : `// ${l}`))
    .join("\n")

/** The imports: the suite, the functions called by module, then nish:secret and nish:unsafe. */
const emitImports = (ctx: EmitContext, called: string[]): string => {
  const lines: string[] = [`import { Suite } from "nish/testing";`]
  const modules: string[] = []
  const names: string[] = []
  for (const n of emitSortedUnique(called)) {
    const f = emitFn(ctx, n)
    const m: string | null = f === null ? null : f.module
    const named = m ?? ctx.c.target.module
    const local = ctx.opts.localModules.indexOf(named)
    const mod = local < 0 ? named : ctx.opts.localImports[local]
    const at = modules.indexOf(mod)
    if (at < 0) {
      modules.push(mod)
      names.push(n)
    } else {
      names[at] = `${names[at]}, ${n}`
    }
  }
  for (let i = 0; i < modules.length; i++) {
    lines.push(`import { ${names[i]} } from ${emitQuote(modules[i])};`)
  }
  const secrets: string[] = []
  for (const n of ["Secret", "expose", "secret", "wipe"]) {
    if (ctx.secretNames.indexOf(n) >= 0) {
      secrets.push(n)
    }
  }
  if (secrets.length > 0) {
    lines.push(`import { ${secrets.join(", ")} } from "nish:secret";`)
  }
  if (ctx.unsafeNames.length > 0) {
    lines.push(`import { ${emitSortedUnique(ctx.unsafeNames).join(", ")} } from "nish:unsafe";`)
  }
  return lines.join("\n")
}

/**
 * `main`: runs every clause, recording what each returned, and once the
 * suite is done prints that after the nonce `spec run` passes as the first
 * argument. The nonce closes accidental output: a module that exits early,
 * or prints PASS lines of its own, leaves no matching end line. It does not
 * stop a module written to forge one, which runs in the same process and can
 * read argv; `spec mutate` is the backstop for that.
 */
const emitMain = (c: Contract): string => {
  const lines: string[] = [
    "export const main = (): i32 => {",
    `  const t: Suite = new Suite(${emitQuote(c.contract)});`,
    `  let ran: string = "";`,
  ]
  for (const k of c.clauses) {
    lines.push(`  ran = \`\${ran}\${${emitClauseFn(k)}(t) ? "1" : "0"}\`;`)
  }
  lines.push("  const code: i32 = t.done();")
  lines.push(`  const nonce: string = toI32(process.argv.length) > 1 ? process.argv[1] : "-";`)
  lines.push("  console.log(`vector-done ${nonce} ${ran}`);")
  lines.push("  return code;")
  lines.push("};")
  return lines.join("\n")
}

/**
 * The whole test program for a contract: a header naming the contract's
 * sha256, the imports, the helpers used, one check per clause under the
 * requirements it covers, and `main`.
 *
 * @param c the contract, already checked
 * @param table the property samples `checkContract` chose
 * @param opts the header's regenerate command, the contract's sha256, and where
 *   modules outside nish/ are imported from
 * @returns the program's text, or every reason Nish cannot express the contract
 */
export const emitProgram = (c: Contract, table: SampleTable, opts: EmitOptions): Result<string, string[]> => {
  const refused = emitRefusals(c, opts.localModules)
  if (refused.length > 0) {
    return Err(refused)
  }
  const ctx = new EmitContext(c, opts)
  const bodies: string[] = []
  const called: string[] = []
  for (const k of c.clauses) {
    if (k.kind === ClauseKind.Vector) {
      called.push(k.call)
      bodies.push(`${emitDocComment(c, k)}\n${emitVector(ctx, k)}`)
    } else {
      const assert = k.assert
      if (assert !== null) {
        for (const n of typeCallsIn(assert)) {
          called.push(n)
        }
      }
      bodies.push(`${emitDocComment(c, k)}\n${emitProperty(ctx, k, checkSamplesOf(table, k.id))}`)
    }
  }
  if (ctx.errors.length > 0) {
    return Err(ctx.errors)
  }
  const parts: string[] = [emitHeader(c, opts), emitImports(ctx, called)]
  const withStr = ctx.used.indexOf("unwrapStr") >= 0
  for (const h of emitHelperNames()) {
    if (h !== "unwrapStr" && ctx.used.indexOf(h) >= 0) {
      parts.push(emitHelperText(h, withStr))
    }
  }
  for (const n of emitSortedUnique(ctx.wrapperNames)) {
    parts.push(ctx.wrapperTexts[ctx.wrapperNames.indexOf(n)])
  }
  for (const b of bodies) {
    parts.push(b)
  }
  parts.push(emitMain(c))
  return Ok(`${parts.join("\n\n")}\n`)
}
