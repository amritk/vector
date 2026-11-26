/**
 * `spec/sample/prng` — the seeded generator random samples are drawn from.
 * It is seeded from the contract's and the property's names, so a check
 * draws the same samples every run, on every machine.
 */

import { wrappingAdd } from "nish:unsafe"

/**
 * The 32-bit FNV-1a hash of a string's code units, as `charCodeAt` reads them.
 *
 * @param s the text
 * @returns its hash
 */
export const sampleFnv1a = (s: string): u32 => {
  let h: u32 = 0x811c9dc5
  const prime: u32 = 0x01000193
  for (let i = 0; i < s.length; i++) {
    h = h ^ toU32(s.charCodeAt(i))
    h = h * prime
  }
  return h
}

/** The generator's state: one 32-bit word, advanced by each draw. */
export class SamplePrng {
  /** The word the next draw advances. */
  state: u32
  /**
   * Makes a generator.
   *
   * @param seed the text it is seeded from
   */
  constructor(seed: string) {
    this.state = sampleFnv1a(seed)
  }
}

/**
 * The next draw, uniform in [0, 1).
 *
 * @param r the generator, which it advances
 * @returns the draw
 */
export const sampleNext = (r: SamplePrng): f64 => {
  const step: u32 = 0x6d2b79f5
  r.state = r.state + step
  let t: u32 = r.state
  t = (t ^ (t >> toU32(15))) * (t | toU32(1))
  t = t ^ (t + (t ^ (t >> toU32(7))) * (t | toU32(61)))
  return toF64(t ^ (t >> toU32(14))) / 4294967296.0
}

/**
 * A uniform draw in [0, n), for n of at least 1.
 *
 * @param r the generator
 * @param n how many values there are
 * @returns the draw
 */
export const sampleBelow = (r: SamplePrng, n: i32): i32 => {
  const x = toI32(Math.floor(sampleNext(r) * toF64(n)))
  // The else branch is never taken: sampleNext() < 1, so x < n. It clamps
  // to n - 1, in u32, which cannot overflow and is the same value for n of
  // at least 1.
  return x < n ? x : toI32(toU32(n) - toU32(1))
}

/**
 * A uniform integer in [lo, hi]. A span of up to 2^32 takes one draw; a wider
 * one takes two, reduced into the span.
 *
 * @param r the generator
 * @param lo the least value
 * @param hi the greatest value, not below `lo`
 * @returns the draw
 */
export const sampleIntIn = (r: SamplePrng, lo: i64, hi: i64): i64 => {
  const one: u64 = 1
  const span: u64 = toU64(hi) - toU64(lo) + one
  if (span !== toU64(0) && span <= one << toU64(32)) {
    return toI64(toU64(lo) + (toU64(Math.floor(sampleNext(r) * toF64(span))) % span))
  }
  const high = toU64(Math.floor(sampleNext(r) * 4294967296.0))
  const low = toU64(Math.floor(sampleNext(r) * 4294967296.0))
  const draw = (high << toU64(32)) | low
  return span === toU64(0) ? toI64(draw) : wrappingAdd(lo, toI64(draw % span))
}

/**
 * An integer in [lo, hi] biased toward both ends: uniform half the time,
 * otherwise within 16 of one end, where the edge cases live.
 *
 * @param r the generator
 * @param lo the least value
 * @param hi the greatest value, not below `lo`
 * @returns the draw
 */
export const sampleBiasedInt = (r: SamplePrng, lo: i64, hi: i64): i64 => {
  const p = sampleNext(r)
  const width = toU64(hi) - toU64(lo)
  if (p < 0.5 || width < toU64(32)) {
    return sampleIntIn(r, lo, hi)
  }
  const sixteen: u64 = 16
  if (p < 0.75) {
    return sampleIntIn(r, lo, toI64(toU64(lo) + sixteen))
  }
  return sampleIntIn(r, toI64(toU64(hi) - sixteen), hi)
}
