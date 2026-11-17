/**
 * `spec/gates/typing` — the typing gate: every vector calls a declared
 * function with arguments and an expected value of its parameter and return
 * types, and every property's `where` and `assert` are well-typed booleans
 * over its variables (`where` may call nothing: a domain must be decidable
 * without the implementation).
 */

import { CheckContext } from "../check"
import { Clause, ClauseKind, Expr, ExprKind, FnSig, Iterate, LitKind, Literal, typesIsWords } from "../contract/types"
import { TypeEnv, typeCallsIn, typeEnvBind, typeLiteralFits, typeOf, typeOfLiteral } from "../contract/typing"
import {
  vocabBaseOf,
  vocabIntMax,
  vocabIntMin,
  vocabIsIntType,
  vocabIsWordType,
  vocabValueType,
} from "../contract/vocab"
import { gateIssue } from "./note"

/**
 * What a literal that does not fit `want` is: an int outside an integer
 * type's range names its value and that range, anything else its own type.
 *
 * @param lit the literal
 * @param want the type wanted
 * @returns how the message names what was given
 */
export const gateMisfit = (lit: Literal, want: string): string => {
  const base = vocabBaseOf(want)
  if (lit.kind === LitKind.Int && vocabIsIntType(base)) {
    return `${lit.text}, outside ${base}'s ${vocabIntMin(base)}..${vocabIntMax(base)}`
  }
  return typeOfLiteral(lit)
}

/** The declared function named `name`; null when none is. */
const gateTypingFn = (fns: FnSig[], name: string): FnSig | null => {
  for (const f of fns) {
    if (f.name === name) {
      return f
    }
  }
  return null
}

/** The typing errors of one vector. */
const gateTypingVector = (k: Clause, fns: FnSig[], errors: string[]): void => {
  const sig = gateTypingFn(fns, k.call)
  if (sig === null) {
    errors.push(`unknown function "${k.call}"`)
    return
  }
  if (k.args.length !== sig.params.length) {
    errors.push(`${k.call} takes ${sig.params.length} argument(s), got ${k.args.length}`)
  }
  for (let i = 0; i < k.args.length && i < sig.params.length; i++) {
    const p = sig.params[i]
    const want = vocabValueType(p.type)
    if (!typeLiteralFits(k.args[i], want)) {
      errors.push(`args[${i}]: ${k.call}(${p.name}) wants ${want}, got ${gateMisfit(k.args[i], want)}`)
    }
  }
  const ret = vocabValueType(sig.returns)
  const expect = k.expect
  if (expect !== null && !typeLiteralFits(expect, ret)) {
    errors.push(`expect: ${k.call} returns ${ret}, got ${gateMisfit(expect, ret)}`)
  }
  if (k.tolerance !== null && ret !== "f64") {
    errors.push(`tolerance: ${k.call} returns ${ret}, and only an f64 result is compared within a tolerance`)
  }
  if (k.truncate !== null && ret !== "bytes") {
    errors.push(`truncate: ${k.call} returns ${ret}, and only a bytes result is truncated`)
  }
  const it = k.iterate
  if (it !== null) {
    gateTypingIterate(k, it, sig, errors)
  }
}

/**
 * An iterated vector's next elements against the parameters they feed: the
 * call feeds a parameter of its return type (a nullable result its base
 * type), and a name feeds a parameter of its own parameter's type.
 */
const gateTypingIterate = (k: Clause, it: Iterate, sig: FnSig, errors: string[]): void => {
  const ret = vocabValueType(vocabBaseOf(sig.returns))
  for (let j = 0; j < it.next.length && j < sig.params.length; j++) {
    const p = sig.params[j]
    const want = vocabValueType(p.type)
    const e = it.next[j]
    if (e.kind === ExprKind.Call) {
      // A result is never null once it feeds the next step, so a nullable parameter takes it too.
      if (ret !== vocabBaseOf(want)) {
        errors.push(`iterate.next[${j}]: ${k.call} returns ${ret}, and ${k.call}(${p.name}) wants ${want}`)
      }
    } else if (e.kind === ExprKind.Var) {
      const m = it.names.indexOf(e.name)
      if (m >= 0 && m < sig.params.length) {
        const from = vocabValueType(sig.params[m].type)
        if (from !== want) {
          errors.push(
            `iterate.next[${j}]: ${e.name} is ${k.call}(${sig.params[m].name}), a ${from}, and ${k.call}(${p.name}) wants ${want}`,
          )
        }
      }
    }
  }
}

/** Whether an expression holds a word-array literal. */
const gateTypingHasWords = (e: Expr): boolean => {
  const lit = e.lit
  if (lit !== null && typesIsWords(lit.kind)) {
    return true
  }
  for (const b of e.binds) {
    if (gateTypingHasWords(b.value)) {
      return true
    }
  }
  const body = e.body
  if (body !== null && gateTypingHasWords(body)) {
    return true
  }
  return e.args.some((a: Expr): boolean => gateTypingHasWords(a))
}

/** Whether a function takes or returns a word array. */
const gateTypingFnHasWords = (f: FnSig): boolean =>
  vocabIsWordType(vocabBaseOf(f.returns)) || f.params.some((p): boolean => vocabIsWordType(vocabBaseOf(p.type)))

/**
 * Why a property's `where` or assertion (`at`) cannot be checked yet because
 * it holds word arrays: a word literal, or a call of a function over them. A
 * property is sampled and evaluated, and neither the sampler nor the emitted
 * checks carry word arrays yet; a vector does.
 */
const gateTypingPropertyWords = (a: Expr, at: string, fns: FnSig[], errors: string[]): void => {
  if (gateTypingHasWords(a)) {
    errors.push(`${at}: word arrays in a property are not checked yet; give word-array cases as vectors`)
    return
  }
  for (const name of typeCallsIn(a)) {
    const f = gateTypingFn(fns, name)
    if (f !== null && gateTypingFnHasWords(f)) {
      errors.push(
        `${at}: ${name} takes or returns a word array, and word arrays in a property are not checked yet; give word-array cases as vectors`,
      )
    }
  }
}

/** The typing errors of one property. */
const gateTypingProperty = (k: Clause, fns: FnSig[], errors: string[]): void => {
  const where = new TypeEnv(fns, false)
  const assert = new TypeEnv(fns, true)
  const seen = new Map<string, boolean>()
  for (const v of k.forall) {
    if (seen.has(v.name)) {
      errors.push(`duplicate variable "${v.name}"`)
    }
    seen.set(v.name, true)
    typeEnvBind(where, v.name, v.type)
    typeEnvBind(assert, v.name, v.type)
  }
  const w = k.where
  if (w !== null) {
    const t = typeOf(w, where, "where", errors)
    if (t !== null && t !== "bool") {
      errors.push(`where: must be bool, got ${t}`)
    }
    gateTypingPropertyWords(w, "where", fns, errors)
  }
  const a = k.assert
  if (a !== null) {
    const t = typeOf(a, assert, "assert", errors)
    if (t !== null && t !== "bool") {
      errors.push(`assert: must be bool, got ${t}`)
    }
    gateTypingPropertyWords(a, "assert", fns, errors)
  }
}

/**
 * The typing gate: a repeated parameter, a call to an undeclared function or
 * with the wrong arguments, a literal of the wrong type, an ill-typed
 * expression, or a `where` or `assert` that is not a boolean.
 *
 * @param ctx the check's context, holding the contract
 * @returns one finding per error, each at its function or clause
 */
export const gateTyping = (ctx: CheckContext): string[] => {
  const out: string[] = []
  const c = ctx.contract
  for (const f of c.functions) {
    const names = new Map<string, boolean>()
    for (const p of f.params) {
      if (names.has(p.name)) {
        gateIssue(ctx, out, "typing", f.name, `duplicate parameter "${p.name}"`)
      }
      names.set(p.name, true)
    }
  }
  for (const k of c.clauses) {
    const errors: string[] = []
    if (k.kind === ClauseKind.Vector) {
      gateTypingVector(k, c.functions, errors)
    } else {
      gateTypingProperty(k, c.functions, errors)
    }
    for (const m of errors) {
      gateIssue(ctx, out, "typing", k.id, m)
    }
  }
  return out
}
