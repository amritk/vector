/**
 * `spec/sample/property` — chooses a property's inputs: the boundaries Z3
 * finds in its integer skeleton, then seeded random draws, every one kept
 * only when its `where` evaluates to true. A property is inhabited only when
 * some concrete input satisfies `where`; one that no input satisfies would
 * hold vacuously, so it is refused.
 */

import { wrappingAdd, wrappingSub } from "nish:unsafe"
import { jsonStringifyString } from "nish/json"
import { runZ3 } from "../../core/z3"
import { CheckSampleStat, Sample } from "../check"
import { shapeAlphabetChars } from "../contract/shape"
import { Clause, Expr, ForallVar } from "../contract/types"
import { vocabIntMax, vocabIntMin, vocabIsIntType } from "../contract/vocab"
import { SampleValue, sampleBytes, sampleHolds, sampleInt, sampleStr, sampleToLiteral } from "./eval"
import { sampleIntLess, sampleParseInt } from "./ints"
import { SamplePrng, sampleBelow, sampleBiasedInt } from "./prng"
import {
  SampleQuery,
  sampleBoolTerm,
  sampleEdges,
  sampleInlineLets,
  sampleNamesIn,
  sampleRange,
  sampleScript,
  sampleSmtIntOf,
  sampleSmtName,
} from "./smt"

/**
 * Whether a z3 error line is only a refused `get-value` (no model after
 * unsat or unknown), the one error a run may carry. The same rule as
 * solveIsModelRefusal in verify/solve/report, which spec cannot import: its
 * AST's class names are the contract's.
 */
const sampleIsModelRefusal = (line: string): boolean => line.endsWith(': model is not available")')

/** Random samples a property gets when it does not say. */
const SAMPLE_DEFAULT_RANDOM: i32 = 24
/** The most samples one property gets. */
const SAMPLE_MAX: i32 = 96

/** What sampling one property found. */
export class SampleOutcome {
  /** The inputs chosen, each in the domain. */
  samples: Sample[]
  stat: CheckSampleStat
  /** Why the property is refused, or null. */
  issue: string | null = null
  /**
   * Makes an empty outcome.
   *
   * @param clause the property's id
   */
  constructor(clause: string) {
    this.samples = []
    this.stat = new CheckSampleStat(clause)
  }
}

/** What sampling holds while it runs. */
class SampleRun {
  k: Clause
  vars: ForallVar[]
  ranges: i64[][]
  rnd: SamplePrng
  out: SampleOutcome
  seen: string[]
  constructor(k: Clause, ranges: i64[][], seed: string) {
    this.k = k
    this.vars = k.forall
    this.ranges = ranges
    this.rnd = new SamplePrng(seed)
    this.out = new SampleOutcome(k.id)
    this.seen = []
  }
}

/**
 * The characters a string variable draws from: its alphabet's, each once,
 * or the printable ASCII characters when it has none.
 *
 * @param v the variable
 * @returns the characters
 */
export const sampleAlphabet = (v: ForallVar): string[] => {
  const entries = v.alphabet
  const list = entries === null ? ["ascii-printable"] : entries
  const out: string[] = []
  for (const e of list) {
    const chars = shapeAlphabetChars(e)
    if (chars !== null) {
      for (const ch of chars) {
        if (out.indexOf(ch) < 0) {
          out.push(ch)
        }
      }
    }
  }
  return out
}

/** An input: the pinned values kept, every other value drawn. */
const sampleFill = (run: SampleRun, pinned: Map<string, i64>): Map<string, SampleValue> => {
  const env = new Map<string, SampleValue>()
  for (let i = 0; i < run.vars.length; i++) {
    const v = run.vars[i]
    const at = pinned.get(v.name)
    const n = at !== undefined ? at : sampleBiasedInt(run.rnd, run.ranges[i][0], run.ranges[i][1])
    if (vocabIsIntType(v.type)) {
      env.set(v.name, sampleInt(n, v.type))
    } else if (v.type === "string") {
      const chars = sampleAlphabet(v)
      let s = ""
      for (let j: i64 = 0; j < n; j++) {
        s = s + chars[sampleBelow(run.rnd, chars.length)]
      }
      env.set(v.name, sampleStr(s))
    } else {
      const b: u8[] = []
      for (let j: i64 = 0; j < n; j++) {
        b.push(toU8(sampleBelow(run.rnd, 256)))
      }
      env.set(v.name, sampleBytes(b))
    }
  }
  return env
}

/** Whether an input is in the domain; Err when `where` cannot be evaluated. */
const sampleInDomain = (run: SampleRun, env: Map<string, SampleValue>): Result<boolean, string> =>
  sampleHolds(run.k.where, env)

/** Adds an input when it is new and in the domain; Ok(true) when added. */
const sampleAdd = (run: SampleRun, env: Map<string, SampleValue>, why: string): Result<boolean, string> => {
  if (!sampleInDomain(run, env).orReturn()) {
    return Ok(false)
  }
  const args = run.vars.map((v: ForallVar): SampleValue => {
    const x = env.get(v.name)
    return x === undefined ? sampleInt(0, "") : x
  })
  const lits = args.map(sampleToLiteral)
  // A position's kind is fixed by its variable's type, so the quoted texts
  // name an input.
  const key = lits.map((l): string => jsonStringifyString(l.text)).join(",")
  if (run.seen.indexOf(key) >= 0) {
    return Ok(false)
  }
  run.seen.push(key)
  run.out.samples.push(new Sample(run.k.id, lits, why))
  return Ok(true)
}

/** The queries: the domain itself, then each comparison's edges, then each variable's extremes. */
const sampleQueries = (run: SampleRun): SampleQuery[] => {
  const k = run.k
  const queries: SampleQuery[] = [new SampleQuery("", [])]
  const edges: string[] = []
  const none = new Map<string, Expr>()
  const where = k.where
  if (where !== null) {
    sampleEdges(sampleInlineLets(where, none), run.vars, edges)
  }
  const a = k.assert
  if (a !== null) {
    sampleEdges(sampleInlineLets(a, none), run.vars, edges)
  }
  for (const d of edges) {
    const pins = sampleNamesIn(d, run.vars)
    for (const off of ["(- 1)", "0", "1"]) {
      queries.push(new SampleQuery(`(= ${d} ${off})`, pins))
    }
  }
  if (edges.length === 0 && run.vars.some((v: ForallVar): boolean => vocabIsIntType(v.type))) {
    run.out.stat.notes.push("no integer comparison in the skeleton: boundaries are the variables' extremes only")
  }
  for (let i = 0; i < run.vars.length; i++) {
    const v = run.vars[i]
    // A u64 is held by its bits: compare unsigned, step with wrapping (only
    // inside the range, so a step never actually wraps).
    const ty = vocabIsIntType(v.type) ? v.type : "i64"
    const lo = run.ranges[i][0]
    const hi = run.ranges[i][1]
    const at: i64[] = [lo]
    if (sampleIntLess(lo, hi, ty)) {
      at.push(wrappingAdd(lo, toI64(1)))
      at.push(wrappingSub(hi, toI64(1)))
    }
    at.push(hi)
    if (vocabIsIntType(v.type)) {
      for (const t of [vocabIntMin(v.type), vocabIntMax(v.type)]) {
        const x = sampleParseInt(t)
        if (x.isOk()) {
          at.push(x.value)
        }
      }
    }
    const done: i64[] = []
    for (const x of at) {
      if (!sampleIntLess(x, lo, ty) && !sampleIntLess(hi, x, ty) && done.indexOf(x) < 0) {
        done.push(x)
        const n = sampleSmtName(v)
        queries.push(new SampleQuery(`(= ${n} ${sampleSmtIntOf(x, ty)})`, [n]))
      }
    }
  }
  return queries
}

/** Adds the boundary samples Z3's models give; Ok with whether the domain is unsat. */
const sampleBoundaries = (
  run: SampleRun,
  whereTerm: string | null,
  queries: SampleQuery[],
): Result<boolean, string> => {
  const z3 = runZ3(sampleScript(run.vars, run.ranges, whereTerm, queries), queries.length).orReturn()
  for (const line of z3.errors) {
    if (!sampleIsModelRefusal(line)) {
      return Err(`z3 rejected the sampling script: ${line}`)
    }
  }
  for (let i = 0; i < z3.answers.length && i < queries.length; i++) {
    const ans = z3.answers[i]
    if (ans.result !== "sat") {
      continue
    }
    const model = new Map<string, i64>()
    const pinned = new Map<string, i64>()
    for (const v of run.vars) {
      const raw = ans.value(sampleSmtName(v))
      if (raw === null) {
        continue
      }
      const parsed = sampleParseInt(raw)
      if (parsed.isErr()) {
        continue
      }
      const x = parsed.value
      model.set(v.name, x)
      if (queries[i].pins.indexOf(sampleSmtName(v)) >= 0) {
        pinned.set(v.name, x)
      }
    }
    // Keep only what the query pinned and draw the rest, so the boundary
    // samples are not copies of Z3's favourite zero; fall back to the whole
    // model when the draw leaves the domain.
    const why = i === 0 ? "boundary: the domain" : `boundary: ${queries[i].extra}`
    const drawn = sampleFill(run, pinned)
    let added = false
    if (sampleInDomain(run, drawn).orReturn()) {
      added = sampleAdd(run, drawn, why).orReturn()
    } else {
      added = sampleAdd(run, sampleFill(run, model), why).orReturn()
    }
    if (added) {
      run.out.stat.boundary = run.out.stat.boundary + 1
    }
  }
  return Ok(z3.answers.length > 0 && z3.answers[0].result === "unsat")
}

/**
 * Samples one property: Z3's boundaries in its integer skeleton, then seeded
 * random draws, seeded by `<contract>/<clause id>` so a run is reproducible.
 *
 * @param contract the contract's name
 * @param k the property clause
 * @returns `Ok` with the samples, stats and any refusal, or `Err` when Z3
 *   could not run or rejected the script
 */
export const sampleProperty = (contract: string, k: Clause): Result<SampleOutcome, string> => {
  const ranges: i64[][] = []
  for (const v of k.forall) {
    const r = sampleRange(v)
    if (r.isErr()) {
      const out = new SampleOutcome(k.id)
      out.issue = r.error
      return Ok(out)
    }
    ranges.push(r.value)
  }
  const run = new SampleRun(k, ranges, `${contract}/${k.id}`)
  const none = new Map<string, Expr>()
  const where = k.where
  const whereTerm = where === null ? "true" : sampleBoolTerm(sampleInlineLets(where, none), run.vars)
  if (whereTerm === null) {
    run.out.stat.notes.push(
      "where is outside the integer skeleton: Z3 saw only the variable ranges; samples are filtered by evaluation",
    )
  }
  const queries = sampleQueries(run)
  const unsat = sampleRun(run, whereTerm, queries)
  if (unsat.isErr()) {
    if (unsat.error.startsWith("where: ")) {
      run.out.issue = unsat.error
      return Ok(run.out)
    }
    return Err(unsat.error)
  }
  run.out.stat.inhabited = run.out.samples.length > 0
  if (!run.out.stat.inhabited) {
    run.out.issue =
      unsat.value && whereTerm !== null
        ? "the domain is empty (Z3: unsat) — the property would hold vacuously"
        : "no input satisfies the domain (Z3 could not decide it and no sample was found)"
  }
  return Ok(run.out)
}

/** The boundaries, then the random draws; Err "where: ..." when `where` cannot be evaluated. */
const sampleRun = (run: SampleRun, whereTerm: string | null, queries: SampleQuery[]): Result<boolean, string> => {
  const probe = sampleInDomain(run, sampleFill(new SampleRun(run.k, run.ranges, "probe"), new Map<string, i64>()))
  if (probe.isErr()) {
    return Err(`where: cannot be evaluated: ${probe.error}`)
  }
  const unsat = sampleBoundaries(run, whereTerm, queries).orReturn()
  const want = run.k.samples >= 0 ? run.k.samples : SAMPLE_DEFAULT_RANDOM
  for (let tries = 0; run.out.stat.random < want && tries < want * 20 && run.out.samples.length < SAMPLE_MAX; tries++) {
    if (sampleAdd(run, sampleFill(run, new Map<string, i64>()), "random").orReturn()) {
      run.out.stat.random = run.out.stat.random + 1
    }
  }
  return Ok(unsat)
}
