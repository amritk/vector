/**
 * `spec/gates/derive` — the derived rule for a vector whose inputs are cited
 * to one section of the main RFC and whose null, true or false result to
 * another. When the result's section does not state the result in words, it
 * still supports it when a property of the contract asserts it: the property
 * covers a requirement of that section the vector covers, asserts that the
 * vector's call is the vector's expected literal, and its call's arguments
 * are the vector's, each one either a quantified variable bound inside its
 * domain or another cited vector's call whose expected value it is, read
 * through `unwrap` only when that value is not null (unwrap of null fails the
 * sample, so it never denotes null). Only a vector compared whole and called
 * once is used, the row or a sibling: a truncated, iterated or toleranced
 * vector's expected value is not its call's. The property must imply the row,
 * not restate it: no argument is a literal, at any depth; each of the call's
 * arguments reads a quantified variable; and each variable admits another
 * value than the row's inside its domain and where (a neighbour: a byte
 * flipped, added or removed, or an integer one off). Every step is checked
 * here; any that fails refuses.
 */

import { Clause, ClauseKind, Expr, ExprKind, ForallVar, Literal, VectorSourceKind } from "../contract/types"
import { SampleKind, SampleValue, sampleBytes, sampleHolds, sampleInt, sampleLiteral } from "../sample/eval"
import { sampleParseInt } from "../sample/ints"

/** How many calls deep an argument may reach through other vectors. */
const DERIVE_DEPTH: i32 = 2

/** What a unification found: the bindings so far, or why it failed. */
class DeriveMatch {
  /** The variables bound so far. */
  env: Map<string, SampleValue>
  /** Why the match failed; null while it holds. */
  why: string | null = null
  /**
   * Starts from bindings.
   *
   * @param env the bindings
   */
  constructor(env: Map<string, SampleValue>) {
    this.env = env
  }
}

/** A copy of bindings, so a failed try leaves the original as it was. */
const deriveCopy = (env: Map<string, SampleValue>): Map<string, SampleValue> => {
  const out = new Map<string, SampleValue>()
  for (const name of env.keys()) {
    const v = env.get(name)
    if (v !== undefined) {
      out.set(name, v)
    }
  }
  return out
}

/** Whether two values are the same, kind and content. */
const deriveSame = (x: SampleValue, y: SampleValue): boolean => {
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

/** A literal's value, or null when it has none here. */
const deriveValue = (lit: Literal | null): SampleValue | null => {
  if (lit === null) {
    return null
  }
  const r = sampleLiteral(lit)
  return r.isOk() ? r.value : null
}

/** The quantified variable a name is, or null. */
const deriveVar = (p: Clause, name: string): ForallVar | null => {
  for (const v of p.forall) {
    if (v.name === name) {
      return v
    }
  }
  return null
}

/** A value as the variable holds it: an integer takes the variable's type. */
const deriveAs = (v: ForallVar, x: SampleValue): SampleValue => (x.kind === SampleKind.Int ? sampleInt(x.n, v.type) : x)

/** Why a vector's expected value is not its call's (truncated, iterated or toleranced), or null when it is. */
const deriveInexact = (k: Clause): string | null => {
  const tr = k.truncate
  if (tr !== null) {
    return `${k.id} compares only the first ${tr.bytes} bytes of its result`
  }
  const it = k.iterate
  if (it !== null) {
    return `${k.id} iterates its call ${it.count} times`
  }
  if (k.tolerance !== null) {
    return `${k.id} allows a tolerance`
  }
  return null
}

/** The vectors other than `row` whose expected value a cited section prints. */
const deriveSiblings = (clauses: Clause[], row: Clause): Clause[] =>
  clauses.filter((c: Clause): boolean => {
    const s = c.source
    return c.kind === ClauseKind.Vector && c.id !== row.id && s !== null && s.kind === VectorSourceKind.Cite
  })

/** Unifies a call's arguments with values, in order; fails on the first that does not match. */
const deriveArgs = (p: Clause, sibs: Clause[], args: Expr[], vals: SampleValue[], m: DeriveMatch, depth: i32): void => {
  if (args.length !== vals.length) {
    m.why = `${p.id} passes ${args.length} arguments where ${vals.length} are given`
    return
  }
  for (let i = 0; i < args.length && m.why === null; i++) {
    deriveUnify(p, sibs, args[i], vals[i], m, depth)
  }
}

/** Unifies a call of another function with a value: some cited vector calls it, expects the value, and unifies. */
const deriveCall = (p: Clause, sibs: Clause[], e: Expr, x: SampleValue, m: DeriveMatch, depth: i32): void => {
  if (depth >= DERIVE_DEPTH) {
    m.why = `${p.id} reaches ${e.name} more than ${DERIVE_DEPTH} calls deep`
    return
  }
  const inexact: string[] = []
  let tried: string | null = null
  for (const s of sibs) {
    if (s.call !== e.name) {
      continue
    }
    const loose = deriveInexact(s)
    if (loose !== null) {
      inexact.push(loose)
      continue
    }
    const want = deriveValue(s.expect)
    if (want === null || !deriveSame(want, x)) {
      continue
    }
    const vals: SampleValue[] = []
    for (const a of s.args) {
      const v = deriveValue(a)
      if (v !== null) {
        vals.push(v)
      }
    }
    if (vals.length !== s.args.length) {
      continue
    }
    const tryM = new DeriveMatch(deriveCopy(m.env))
    deriveArgs(p, sibs, e.args, vals, tryM, depth + 1)
    if (tryM.why === null) {
      m.env = tryM.env
      return
    }
    if (tried === null) {
      tried = tryM.why
    }
  }
  if (tried !== null) {
    m.why = tried
    return
  }
  const unused = inexact.length > 0 ? ` (unused: ${inexact.join(", ")}, so its expected value is not its call's)` : ""
  m.why = `${p.id} calls ${e.name} for a value no cited vector of ${e.name} expects with matching arguments${unused}`
}

/** Unifies one expression of the property with a value of the vector. */
const deriveUnify = (p: Clause, sibs: Clause[], e: Expr, x: SampleValue, m: DeriveMatch, depth: i32): void => {
  if (e.kind === ExprKind.Var) {
    const v = deriveVar(p, e.name)
    if (v === null) {
      m.why = `${p.id} uses ${e.name}, which it does not quantify over`
      return
    }
    const held = m.env.get(e.name)
    const value = deriveAs(v, x)
    if (held === undefined) {
      m.env.set(e.name, value)
    } else if (!deriveSame(held, value)) {
      m.why = `${p.id} uses ${e.name} for two different values`
    }
    return
  }
  if (e.kind === ExprKind.Lit) {
    m.why = `${p.id} passes a literal argument, which restates the vector instead of deriving its result: bind it through a quantified variable or a cited vector`
    return
  }
  if (e.kind === ExprKind.Op && e.name === "unwrap" && e.args.length === 1 && e.args[0].kind === ExprKind.Call) {
    if (x.kind === SampleKind.Null) {
      m.why = `${p.id} unwraps ${e.args[0].name} where the vector has null, a value unwrap never gives`
      return
    }
    deriveCall(p, sibs, e.args[0], x, m, depth)
    return
  }
  if (e.kind === ExprKind.Call) {
    deriveCall(p, sibs, e, x, m, depth)
    return
  }
  m.why = `${p.id} computes an argument (${e.kind === ExprKind.Op ? e.name : "a let"}) that is not matched here`
}

/** Why a bound value is outside its variable's domain, or null when inside. */
const deriveOutside = (p: Clause, v: ForallVar, x: SampleValue): string | null => {
  if (v.type === "bytes") {
    if (x.kind !== SampleKind.Bytes) {
      return `${p.id} binds ${v.name}, a bytes variable, to a value that is not bytes`
    }
    const n = toI32(x.bytes.length)
    if ((v.minLen >= 0 && n < v.minLen) || (v.maxLen >= 0 && n > v.maxLen)) {
      return `${p.id} binds ${v.name} to a ${n}-byte value, outside its domain ${v.minLen}..${v.maxLen}`
    }
    return null
  }
  if (x.kind !== SampleKind.Int || !v.hasBounds || v.type === "u64" || v.type === "f64") {
    return `${p.id} binds ${v.name}, of type ${v.type}, which is not bound here`
  }
  const lo = sampleParseInt(v.min)
  const hi = sampleParseInt(v.max)
  if (lo.isErr() || hi.isErr()) {
    return `${p.id} bounds ${v.name} by a value that is not an integer`
  }
  if (x.n < lo.value || x.n > hi.value) {
    return `${p.id} binds ${v.name} to ${x.n}, outside its domain ${v.min}..${v.max}`
  }
  return null
}

/** Whether an expression reads a variable anywhere. */
const deriveMentions = (e: Expr): boolean => {
  if (e.kind === ExprKind.Var) {
    return true
  }
  for (const a of e.args) {
    if (deriveMentions(a)) {
      return true
    }
  }
  return false
}

/** The values next to a bound one that the rule tries: each byte's low bit flipped, a byte added and one removed, or one more and one less. */
const deriveNeighbours = (x: SampleValue): SampleValue[] => {
  const out: SampleValue[] = []
  if (x.kind === SampleKind.Bytes) {
    for (let i = 0; i < x.bytes.length; i++) {
      const b: u8[] = x.bytes.slice(0, x.bytes.length)
      b[i] = toU8(toI32(b[i]) ^ 1)
      out.push(sampleBytes(b))
    }
    const longer: u8[] = x.bytes.slice(0, x.bytes.length)
    longer.push(toU8(0))
    out.push(sampleBytes(longer))
    if (x.bytes.length > 0) {
      out.push(sampleBytes(x.bytes.slice(0, x.bytes.length - 1)))
    }
    return out
  }
  if (x.kind === SampleKind.Int) {
    out.push(sampleInt(x.n - 1, x.ty))
    out.push(sampleInt(x.n + 1, x.ty))
  }
  return out
}

/**
 * Whether the property admits another value for a variable than the one the
 * vector binds, the others held: a neighbour inside its domain for which the
 * where holds. A variable that admits only the vector's value is a literal by
 * another name.
 */
const deriveAdmitsOther = (p: Clause, v: ForallVar, env: Map<string, SampleValue>): boolean => {
  const x = env.get(v.name)
  if (x === undefined) {
    return false
  }
  for (const y of deriveNeighbours(x)) {
    if (deriveOutside(p, v, y) !== null) {
      continue
    }
    const tryEnv = deriveCopy(env)
    tryEnv.set(v.name, y)
    const holds = sampleHolds(p.where, tryEnv)
    if (holds.isOk() && (p.where === null || holds.value)) {
      return true
    }
  }
  return false
}

/** Why one property does not derive the vector's result, or null when it does. */
const deriveFrom = (clauses: Clause[], k: Clause, want: SampleValue, p: Clause): string | null => {
  const a = p.assert
  if (a === null || a.kind !== ExprKind.Op || a.name !== "==" || a.args.length !== 2) {
    return `${p.id} does not assert a single equality`
  }
  const left = a.args[0]
  const right = a.args[1]
  const call = left.kind === ExprKind.Call ? left : right
  const lit = left.kind === ExprKind.Call ? right : left
  const said: SampleValue | null = lit.kind === ExprKind.Lit ? deriveValue(lit.lit) : null
  if (call.kind !== ExprKind.Call || call.name !== k.call || said === null) {
    return `${p.id} does not assert that ${k.call} is a literal`
  }
  if (!deriveSame(said, want)) {
    return `${p.id} asserts another result than the vector's`
  }
  const vals: SampleValue[] = []
  for (const arg of k.args) {
    const v = deriveValue(arg)
    if (v === null) {
      return `${k.id} has an argument that is not evaluated here`
    }
    vals.push(v)
  }
  const m = new DeriveMatch(new Map<string, SampleValue>())
  deriveArgs(p, deriveSiblings(clauses, k), call.args, vals, m, 0)
  const why = m.why
  if (why !== null) {
    return why
  }
  for (const v of p.forall) {
    const x = m.env.get(v.name)
    if (x === undefined) {
      return `${p.id} leaves ${v.name} unbound`
    }
    const out = deriveOutside(p, v, x)
    if (out !== null) {
      return out
    }
  }
  const holds = sampleHolds(p.where, m.env)
  if (holds.isErr()) {
    return `${p.id}'s where cannot be evaluated: ${holds.error}`
  }
  if (p.where !== null && !holds.value) {
    return `${p.id}'s where does not hold for the vector's inputs`
  }
  for (let i = 0; i < call.args.length; i++) {
    if (!deriveMentions(call.args[i])) {
      return `${p.id} passes argument ${i + 1} through no variable it quantifies over, so it restates the vector instead of deriving its result`
    }
  }
  for (const v of p.forall) {
    if (!deriveAdmitsOther(p, v, m.env)) {
      return `${p.id} admits only the vector's value for ${v.name} (its domain and where allow no other), so it restates the vector instead of deriving its result`
    }
  }
  return null
}

/**
 * Why no property derives a vector's result from its result's section, or
 * null when one does (see the module comment).
 *
 * @param clauses every clause of the contract
 * @param reqs the ids of the requirements of the main source quoted from the result's section
 * @param k the vector
 * @returns why not, or null
 */
export const gateDerivedResult = (clauses: Clause[], reqs: string[], k: Clause): string | null => {
  const loose = deriveInexact(k)
  if (loose !== null) {
    return `${loose}, so its expected value is not its call's`
  }
  const want = deriveValue(k.expect)
  if (want === null || (want.kind !== SampleKind.Bool && want.kind !== SampleKind.Null)) {
    return `${k.id} expects neither null, true nor false`
  }
  const reasons: string[] = []
  for (const p of clauses) {
    if (p.kind !== ClauseKind.Property) {
      continue
    }
    let shared = false
    for (const id of p.covers) {
      if (reqs.indexOf(id) >= 0 && k.covers.indexOf(id) >= 0) {
        shared = true
      }
    }
    if (!shared) {
      continue
    }
    const why = deriveFrom(clauses, k, want, p)
    if (why === null) {
      return null
    }
    reasons.push(why)
  }
  if (reasons.length === 0) {
    return `no property covers a requirement of the result's section that ${k.id} covers`
  }
  return reasons.join("; ")
}
