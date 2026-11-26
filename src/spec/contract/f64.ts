/**
 * `spec/contract/f64` — a contract's f64 values: the text a literal is
 * written in, and the binary64 encoding (IEEE 754-2019 §3.4) it reads as.
 */

/**
 * The binary64 encoding of `x`, as 16 lowercase hex digits.
 *
 * @param x the value
 * @returns its encoding, such as `3ff0000000000000` for 1
 */
export const contractF64Bits = (x: f64): string => {
  const bits = f64ToBits(x)
  const digits = "0123456789abcdef"
  let out = ""
  for (let k = 15; k >= 0; k--) {
    const nibble = toI32(bits >> toI64(k * 4)) & 15
    out = `${out}${digits.substring(nibble, nibble + 1)}`
  }
  return out
}

/**
 * The binary64 whose encoding is `hex`.
 *
 * @param hex 16 lowercase hex digits
 * @returns the value they encode, or `Err` when `hex` is not 16 lowercase hex digits
 */
export const contractF64FromBits = (hex: string): Result<f64, string> => {
  if (hex.length !== 16) {
    return Err(`"${hex}" is not 16 lowercase hex digits`)
  }
  let bits: i64 = 0
  for (let i = 0; i < hex.length; i++) {
    const c = hex.charCodeAt(i)
    let v = 0
    if (c >= 0x30 && c <= 0x39) {
      // The low nibble of "0" to "9" is the digit, of "a" to "f" 1 to 6.
      v = c & 15
    } else if (c >= 0x61 && c <= 0x66) {
      v = (c & 15) + 9
    } else {
      return Err(`"${hex}" is not 16 lowercase hex digits`)
    }
    bits = (bits << 4) | toI64(v)
  }
  return Ok(bitsToF64(bits))
}

/**
 * The binary64 an f64 literal's text reads as, rounding ties to even
 * (IEEE 754-2019 §5.12.2).
 *
 * @param text f64 text: a decimal, `NaN`, `Infinity` or `-Infinity`
 * @returns the value
 */
export const contractF64Parse = (text: string): f64 => parseFloat(text)

/**
 * Whether decimal text lies past binary64's largest finite value, so it
 * rounds to an infinity (IEEE 754-2019 §7.4).
 *
 * @param text f64 text
 * @returns true for decimal text that reads as an infinity
 */
export const contractF64Overflows = (text: string): boolean => {
  if (text === "Infinity" || text === "-Infinity" || text === "NaN") {
    return false
  }
  const bits = f64ToBits(parseFloat(text))
  return ((bits >> toI64(52)) & toI64(0x7ff)) === toI64(0x7ff) && bits << toI64(12) === toI64(0)
}

/**
 * Whether `x` is a NaN.
 *
 * @param x the value
 * @returns true for any NaN encoding
 */
export const contractF64IsNaN = (x: f64): boolean => {
  const bits = f64ToBits(x)
  return ((bits >> toI64(52)) & toI64(0x7ff)) === toI64(0x7ff) && bits << toI64(12) !== toI64(0)
}
