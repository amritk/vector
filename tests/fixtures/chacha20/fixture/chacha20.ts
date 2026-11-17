// The ChaCha20 quarter round of RFC 8439 Section 2.1, written for
// tests/fixtures/chacha20's contract to check under its own module root
// (`--package fixture=...`). tests/fixtures/chacha20/broken holds a copy with
// one rotation changed, which the same contract refuses.

/** `x` rotated left by `n` bits, 0 < n < 32. */
const chacha20Rotl = (x: u32, n: u32): u32 => (x << n) | (x >> (toU32(32) - n))

/**
 * The ChaCha quarter round on four words of a state (RFC 8439 §2.1, §2.2).
 *
 * @param state the state, as 32-bit words
 * @param a the index of the first word
 * @param b the index of the second word
 * @param c the index of the third word
 * @param d the index of the fourth word
 * @returns a copy of the state after the quarter round, or null when an index
 * is outside the state
 */
export const chacha20QuarterRound = (state: u32[], a: i32, b: i32, c: i32, d: i32): u32[] | null => {
  const n: i32 = toI32(state.length)
  for (const i of [a, b, c, d]) {
    if (i < 0 || i >= n) {
      return null
    }
  }
  const s: u32[] = []
  for (const w of state) {
    s.push(w)
  }
  s[a] = s[a] + s[b]
  s[d] = chacha20Rotl(s[d] ^ s[a], toU32(16))
  s[c] = s[c] + s[d]
  s[b] = chacha20Rotl(s[b] ^ s[c], toU32(12))
  s[a] = s[a] + s[b]
  s[d] = chacha20Rotl(s[d] ^ s[a], toU32(8))
  s[c] = s[c] + s[d]
  s[b] = chacha20Rotl(s[b] ^ s[c], toU32(7))
  return s
}
