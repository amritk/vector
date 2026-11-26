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
  SampleEdge,
  SampleQuery,
  sampleBoolTerm,
  sampleEdges,
  sampleInlineLets,
  sampleModelInt,
  sampleNamesIn,
  sampleRange,
  sampleScript,
  sampleSmtInt,
  sampleSmtLit,
  sampleSmtName,
  sampleWrapsOnInt,
} from "./smt"

/**
 * Whether a z3 error line is only a refused `get-value` (no model after
 * unsat or unknown), the one error a run may carry. The same rule as
 * solveIsModelRefusal in verify/solve/report, which spec cannot import: its
 * AST's class names are the contract's.
 */
const sampleIsModelRefusal = (line: string): boolean => line.endsWith(': model is not available")')

/** Random samples a property gets when it does not say how many. */
const SAMPLE_DEFAULT_RANDOM: i32 = 24
/**
 * The most samples a property gets when it does not say how many. A
 * property's own `samples` is its exact total instead, up to the contract's
 * ceiling of 256.
 */
const SAMPLE_MAX: i32 = 96
/** No cap on the boundaries: the default path keeps every one Z3 gives. */
const SAMPLE_NO_CAP: i32 = 2147483647

/** What sampling one property found. */
export class SampleOutcome {
  /** The inputs chosen, each in the domain. */
  samples: Sample[]
  /** How the samples were chosen, for the report. */
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

/** A variable with its range, so that no walk pairs two lists by index. */
class SampleSlot {
  v: ForallVar
  lo: i64
  hi: i64
  constructor(v: ForallVar, lo: i64, hi: i64) {
    this.v = v
    this.lo = lo
    this.hi = hi
  }
}

/** What sampling holds while it runs. */
class SampleRun {
  k: Clause
  vars: ForallVar[]
  ranges: i64[][]
  slots: SampleSlot[]
  rnd: SamplePrng
  out: SampleOutcome
  seen: string[]
  constructor(k: Clause, ranges: i64[][], slots: SampleSlot[], seed: string) {
    this.k = k
    this.vars = k.forall
    this.ranges = ranges
    this.slots = slots
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

/**
 * An input: the pinned values kept, every other value drawn. Err when a
 * string variable must draw a character from an alphabet with none.
 */
const sampleFill = (run: SampleRun, pinned: Map<string, i64>): Result<Map<string, SampleValue>, string> => {
  const env = new Map<string, SampleValue>()
  for (const slot of run.slots) {
    const v = slot.v
    const at = pinned.get(v.name)
    const n = at !== undefined ? at : sampleBiasedInt(run.rnd, slot.lo, slot.hi)
    if (vocabIsIntType(v.type)) {
      env.set(v.name, sampleInt(n, v.type))
    } else if (v.type === "string") {
      const chars = sampleAlphabet(v)
      let s = ""
      // Counts down from n, so the step cannot overflow.
      for (let left: i64 = n; left > 0; left--) {
        const c = sampleBelow(run.rnd, chars.length)
        if (!(c >= 0 && c < chars.length)) {
          return Err(`${v.name}: its alphabet has no character to draw`)
        }
        s = s + chars[c]
      }
      env.set(v.name, sampleStr(s))
    } else {
      const b: u8[] = []
      for (let left: i64 = n; left > 0; left--) {
        b.push(toU8(sampleBelow(run.rnd, 256)))
      }
      env.set(v.name, sampleBytes(b))
    }
  }
  return Ok(env)
}

/** Whether an input is in the domain; Err "where: ..." when `where` cannot be evaluated on it. */
const sampleInDomain = (run: SampleRun, env: Map<string, SampleValue>): Result<boolean, string> => {
  const r = sampleHolds(run.k.where, env)
  if (r.isErr()) {
    return Err(`where: cannot be evaluated: ${r.error}`)
  }
  return Ok(r.value)
}

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
  const edges: SampleEdge[] = []
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
    const pins = sampleNamesIn(d.diff, run.vars)
    for (const off of d.offsets) {
      queries.push(new SampleQuery(`(= ${d.diff} ${off})`, pins))
    }
  }
  if (edges.length === 0 && run.vars.some((v: ForallVar): boolean => vocabIsIntType(v.type))) {
    run.out.stat.notes.push("no integer comparison in the skeleton: boundaries are the variables' extremes only")
  }
  for (const slot of run.slots) {
    const v = slot.v
    // A u64 is held by its bits: compare unsigned, step with wrapping (only
    // inside the range, so a step never actually wraps).
    const ty = vocabIsIntType(v.type) ? v.type : "i64"
    const lo = slot.lo
    const hi = slot.hi
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
        const lit = vocabIsIntType(v.type) ? sampleSmtLit(x, v.type) : sampleSmtInt(x)
        queries.push(new SampleQuery(`(= ${n} ${lit})`, [n]))
      }
    }
  }
  return queries
}

/**
 * Adds the boundary samples Z3's models give, in Z3's order, until the
 * property has `cap`; Ok with whether the domain is unsat.
 */
const sampleBoundaries = (
  run: SampleRun,
  whereTerm: string | null,
  queries: SampleQuery[],
  cap: i32,
): Result<boolean, string> => {
  const z3 = runZ3(sampleScript(run.vars, run.ranges, whereTerm, queries), queries.length).orReturn()
  for (const line of z3.errors) {
    if (!sampleIsModelRefusal(line)) {
      return Err(`z3 rejected the sampling script: ${line}`)
    }
  }
  for (let i = 0; i < z3.answers.length && i < queries.length && run.out.samples.length < cap; i++) {
    const ans = z3.answers[i]
    const q = queries[i]
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
      const parsed = sampleModelInt(raw, v.type)
      if (parsed.isErr()) {
        continue
      }
      const x = parsed.value
      model.set(v.name, x)
      if (q.pins.indexOf(sampleSmtName(v)) >= 0) {
        pinned.set(v.name, x)
      }
    }
    // Keep only what the query pinned and draw the rest, so the boundary
    // samples are not copies of Z3's favourite zero; fall back to the whole
    // model when the draw leaves the domain.
    const why = i === 0 ? "boundary: the domain" : `boundary: ${q.extra}`
    const drawn = sampleFill(run, pinned).orReturn()
    let added = false
    if (sampleInDomain(run, drawn).orReturn()) {
      added = sampleAdd(run, drawn, why).orReturn()
    } else {
      added = sampleAdd(run, sampleFill(run, model).orReturn(), why).orReturn()
    }
    if (added) {
      // In u32, which cannot overflow: the count is below the samples' length.
      run.out.stat.boundary = toI32(toU32(run.out.stat.boundary) + toU32(1))
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
  const slots: SampleSlot[] = []
  for (const v of k.forall) {
    const r = sampleRange(v)
    if (r.isErr()) {
      const out = new SampleOutcome(k.id)
      out.issue = r.error
      return Ok(out)
    }
    const range = r.value
    // sampleRange answers [lo, hi]; anything else is a bug here, not input.
    if (range.length === 2) {
      slots.push(new SampleSlot(v, range[0], range[1]))
      ranges.push(range)
    } else {
      return Err(`${v.name}: its range is not [lo, hi]`)
    }
  }
  const run = new SampleRun(k, ranges, slots, `${contract}/${k.id}`)
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
    // Int unsat proves nothing about i32 arithmetic, which wraps.
    const exact = where === null || !sampleWrapsOnInt(where, run.vars)
    if (unsat.value && whereTerm !== null && exact) {
      run.out.issue = "the domain is empty (Z3: unsat) — the property would hold vacuously"
    } else if (unsat.value && whereTerm !== null) {
      run.out.issue =
        "no sample satisfies the domain: Z3 found none over unbounded integers, where i32 arithmetic does not wrap, and no draw found one"
    } else {
      run.out.issue = "no input satisfies the domain (Z3 could not decide it and no sample was found)"
    }
  }
  return Ok(run.out)
}

/**
 * Seeded random draws, until `want` of them were kept or the run holds
 * `total` samples, within `want * 20` tries. Ok(true), the repo's Ok for
 * a step with no value; Err "where: ..." when `where` cannot be evaluated.
 */
const sampleDraw = (run: SampleRun, want: i32, total: i32): Result<boolean, string> => {
  // The tries left count down from want * 20, in i64 so neither the product
  // nor the step can overflow.
  for (
    let left = toI64(want) * toI64(20);
    run.out.stat.random < want && left > 0 && run.out.samples.length < total;
    left--
  ) {
    if (sampleAdd(run, sampleFill(run, new Map<string, i64>()).orReturn(), "random").orReturn()) {
      // In u32, which cannot overflow: the count is below the samples' length.
      run.out.stat.random = toI32(toU32(run.out.stat.random) + toU32(1))
    }
  }
  return Ok(true)
}

/**
 * The boundaries, then the random draws; Err "where: ..." when `where`
 * cannot be evaluated. Without its own `samples` a property gets every
 * boundary and up to SAMPLE_DEFAULT_RANDOM draws, at most SAMPLE_MAX in all;
 * with `samples` N it gets at most N boundaries, then draws until it has N,
 * and a note when it found some, but fewer.
 */
const sampleRun = (run: SampleRun, whereTerm: string | null, queries: SampleQuery[]): Result<boolean, string> => {
  sampleInDomain(
    run,
    sampleFill(new SampleRun(run.k, run.ranges, run.slots, "probe"), new Map<string, i64>()).orReturn(),
  ).orReturn()
  const n = run.k.samples
  if (n < 0) {
    const unsat = sampleBoundaries(run, whereTerm, queries, SAMPLE_NO_CAP).orReturn()
    sampleDraw(run, SAMPLE_DEFAULT_RANDOM, SAMPLE_MAX).orReturn()
    return Ok(unsat)
  }
  const unsat = sampleBoundaries(run, whereTerm, queries, n).orReturn()
  sampleDraw(run, n, n).orReturn()
  // An empty domain is an issue of its own; a note on top says nothing more.
  if (run.out.samples.length > 0 && run.out.samples.length < n) {
    run.out.stat.notes.push(`asked for ${n} samples; found ${run.out.samples.length}`)
  }
  return Ok(unsat)
}
