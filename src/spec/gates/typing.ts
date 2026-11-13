/**
 * `spec/gates/typing` — the typing gate: every vector calls a declared
 * function with arguments and an expected value of its parameter and return
 * types, and every property's `where` and `assert` are well-typed booleans
 * over its variables (`where` may call nothing: a domain must be decidable
 * without the implementation).
 */

import { CheckContext } from "../check"
import { Clause, ClauseKind, FnSig, LitKind, Literal } from "../contract/types"
import { TypeEnv, typeEnvBind, typeLiteralFits, typeOf, typeOfLiteral } from "../contract/typing"
import { vocabBaseOf, vocabIntMax, vocabIntMin, vocabIsIntType, vocabValueType } from "../contract/vocab"
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
  }
  const a = k.assert
  if (a !== null) {
    const t = typeOf(a, assert, "assert", errors)
    if (t !== null && t !== "bool") {
      errors.push(`assert: must be bool, got ${t}`)
    }
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
