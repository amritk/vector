/**
 * `nish/forms` — a module for tests/spec/emit/fixtures/forms.json, the
 * contract that uses every form the emitter writes. Its emitted test is
 * compiled against this module in place of a std one, so a form that does not
 * compile, or that computes the wrong thing, fails the test.
 */

import { Secret, expose, secret } from "nish:secret"
import { wrappingAdd, wrappingMul, wrappingSub } from "nish:unsafe"

const formsCopy = (b: u8[]): u8[] => {
  const out: u8[] = []
  for (const x of b) {
    out.push(x)
  }
  return out
}

/** `x` as it is. */
export const idI32 = (x: i32): i32 => x

/** `a + b`, wrapping. */
export const addI32 = (a: i32, b: i32): i32 => wrappingAdd(a, b)

/** `a - b`, wrapping. */
export const subI32 = (a: i32, b: i32): i32 => wrappingSub(a, b)

/** `a * b`, wrapping. */
export const mulI32 = (a: i32, b: i32): i32 => wrappingMul(a, b)

/** `a + b`, wrapping. */
export const addI64 = (a: i64, b: i64): i64 => wrappingAdd(a, b)

/** `x` sign-extended to 64 bits, as 8 little-endian bytes. */
export const leBytes = (x: i32): u8[] => {
  const out: u8[] = []
  let v: i64 = toI64(x)
  for (let i: i32 = 0; i < 8; i += 1) {
    out.push(toU8(toI32(v & toI64(255))))
    v = v >> toI64(8)
  }
  return out
}

/** `a` XOR `b`, as long as the shorter. */
export const xorB = (a: u8[], b: u8[]): u8[] => {
  const out: u8[] = []
  const n: i32 = toI32(a.length) < toI32(b.length) ? toI32(a.length) : toI32(b.length)
  for (let i: i32 = 0; i < n; i += 1) {
    out.push(toU8(toI32(a[i]) ^ toI32(b[i])))
  }
  return out
}

/** `s`, or null when it is empty. */
export const nonEmpty = (s: string): string | null => (s.length === 0 ? null : s)

/** `a`, or null when it is empty. */
export const nonEmptyB = (a: u8[]): u8[] | null => (a.length === 0 ? null : a)

/** Half of `x`. */
export const half = (x: f64): f64 => x / 2

/** Whether `x` is the largest u64. */
export const isMax = (x: u64): boolean => x === (toU64(0) + 4294967295) * 4294967296 + 4294967295

/** A copy of `k`, still secret; `u` is ignored. */
export const keep = (k: Secret<u8[]>, u: u8[]): Secret<u8[]> | null => {
  if (u.length === 0) {
    return null
  }
  return secret(expose(k, formsCopy))
}

/** `k` exposed, or null when there is none. */
export const keepBase = (k: Secret<u8[]> | null): u8[] | null => {
  if (k === null) {
    return null
  }
  return expose(k, formsCopy)
}
