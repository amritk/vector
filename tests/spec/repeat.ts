/** Long test inputs, shared by the spec tests that build them. */

/**
 * `s` written `n` times, built by doubling so a long one stays linear.
 * @param s the piece to repeat
 * @param n how many times
 * @returns the pieces joined
 */
export const specTestRepeat = (s: string, n: i32): string => {
  let out = ""
  let piece = s
  let k: i32 = n
  while (k > 0) {
    if (k % 2 === 1) {
      out = `${out}${piece}`
    }
    piece = `${piece}${piece}`
    k = k / 2
  }
  return out
}
