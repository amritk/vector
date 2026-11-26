/**
 * `spec/sample/ints` — the integers a property's variables take, held in an
 * i64 whatever their type. A narrower value is kept wrapped to its type's
 * width, as the generated test computes it; a u64 above the i64 maximum is
 * held by its bits, so it compares unsigned and prints unsigned.
 */

import { wrappingAdd, wrappingSub } from "nish:unsafe"

/**
 * An integer type's width in bits.
 *
 * @param ty an integer type, `i8` to `u64`
 * @returns its width, 8 to 64
 */
export const sampleIntWidth = (ty: string): i32 => parseInt(ty.substring(1))

/**
 * Whether an integer type is two's complement.
 *
 * @param ty an integer type
 * @returns true for `iN`
 */
export const sampleIntSigned = (ty: string): boolean => ty.startsWith("i")

/**
 * A value reduced to an integer type: modulo 2^N, read as two's complement
 * for `iN`.
 *
 * @param x the value
 * @param ty an integer type
 * @returns `x` wrapped to `ty`'s width
 */
export const sampleIntWrap = (x: i64, ty: string): i64 => {
  const w = sampleIntWidth(ty)
  if (w >= 64) {
    return x
  }
  const one: i64 = 1
  const span = one << toI64(w)
  // Wrapping, so the mask and the difference have the i64 bits without an
  // overflow at w = 63, where `span` is i64 MIN.
  const low = x & wrappingSub(span, toI64(1))
  if (sampleIntSigned(ty) && low >= one << (toI64(w) - one)) {
    return wrappingSub(low, span)
  }
  return low
}

/**
 * Whether one value of an integer type is less than another: unsigned for
 * `u64`, whose large values are held by their bits.
 *
 * @param x the left value
 * @param y the right value
 * @param ty their type
 * @returns `x < y` in `ty`
 */
export const sampleIntLess = (x: i64, y: i64, ty: string): boolean => {
  if (ty === "u64") {
    const one: i64 = 1
    const flip = one << toI64(63)
    return (x ^ flip) < (y ^ flip)
  }
  return x < y
}

/**
 * A value as decimal text: unsigned for `u64`.
 *
 * @param x the value
 * @param ty its type
 * @returns its decimal text
 */
export const sampleIntText = (x: i64, ty: string): string => (ty === "u64" ? `${toU64(x)}` : `${x}`)

/**
 * Reads decimal text as an i64. Text up to the u64 maximum is accepted, and
 * a value above the i64 maximum is held by its bits (see the module comment).
 *
 * @param text decimal digits, with an optional leading `-`
 * @returns `Ok` with the value, or `Err` when the text is not such a number
 */
export const sampleParseInt = (text: string): Result<i64, string> => {
  const neg = text.startsWith("-")
  const digits = neg ? text.substring(1) : text
  if (digits.length === 0 || digits.length > 20) {
    return Err(`not an integer: ${text}`)
  }
  let mag: u64 = 0
  const ten: u64 = 10
  for (let i = 0; i < digits.length; i++) {
    const c = digits.charCodeAt(i)
    if (c < 48 || c > 57) {
      return Err(`not an integer: ${text}`)
    }
    const next = mag * ten + toU64(c - 48)
    if (next / ten !== mag) {
      return Err(`out of range: ${text}`)
    }
    mag = next
  }
  const one: u64 = 1
  if (neg) {
    if (mag > one << toU64(63)) {
      return Err(`out of range: ${text}`)
    }
    return Ok(wrappingAdd(toI64(~mag), toI64(1)))
  }
  return Ok(toI64(mag))
}
