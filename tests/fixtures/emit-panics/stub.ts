/**
 * `emit-panics/stub` — the module tests/spec/emit/panics_test.ts emits a
 * test for: one small function per signature shape a contract can name,
 * each written so the no-panic prover accepts it, so every site the
 * prover reports in the emitted test is the emitter's own.
 */
import { Secret, expose, secret } from "nish:secret"

const stubCopy = (x: u8[]): u8[] => {
  const out: u8[] = []
  for (const b of x) {
    out.push(b)
  }
  return out
}

/**
 * The bytes it is given, copied.
 *
 * @param x the bytes
 * @returns a copy of x
 */
export const stubBytes = (x: u8[]): u8[] => stubCopy(x)

/**
 * The bytes it is given, or null for none.
 *
 * @param x the bytes
 * @returns a copy of x, or null when x is empty
 */
export const stubMaybe = (x: u8[]): u8[] | null => (x.length === 0 ? null : stubCopy(x))

/**
 * The string it is given.
 *
 * @param s the string
 * @returns s
 */
export const stubString = (s: string): string => s

/**
 * The string it is given, or null for the empty string.
 *
 * @param s the string
 * @returns s, or null when s is empty
 */
export const stubMaybeString = (s: string): string | null => (s.length === 0 ? null : s)

/**
 * The flag it is given, negated.
 *
 * @param b the flag
 * @returns not b
 */
export const stubBool = (b: boolean): boolean => !b

/**
 * The i32 it is given.
 *
 * @param a the value
 * @returns a
 */
export const stubI32 = (a: i32): i32 => a

/**
 * The i64 it is given.
 *
 * @param a the value
 * @returns a
 */
export const stubI64 = (a: i64): i64 => a

/**
 * The u8 it is given.
 *
 * @param a the value
 * @returns a
 */
export const stubU8 = (a: u8): u8 => a

/**
 * The u16 it is given.
 *
 * @param a the value
 * @returns a
 */
export const stubU16 = (a: u16): u16 => a

/**
 * The u32 it is given.
 *
 * @param a the value
 * @returns a
 */
export const stubU32 = (a: u32): u32 => a

/**
 * The u64 it is given.
 *
 * @param a the value
 * @returns a
 */
export const stubU64 = (a: u64): u64 => a

/**
 * The 16-bit words it is given, in reverse order.
 *
 * @param w the words
 * @returns w reversed
 */
export const stubWords16 = (w: u16[]): u16[] => {
  const out: u16[] = []
  let i: i32 = w.length - 1
  while (i >= 0 && i < w.length) {
    out.push(w[i])
    i -= 1
  }
  return out
}

/**
 * The 32-bit words it is given, in reverse order.
 *
 * @param w the words
 * @returns w reversed
 */
export const stubWords32 = (w: u32[]): u32[] => {
  const out: u32[] = []
  let i: i32 = w.length - 1
  while (i >= 0 && i < w.length) {
    out.push(w[i])
    i -= 1
  }
  return out
}

/**
 * The 64-bit words it is given, in reverse order.
 *
 * @param w the words
 * @returns w reversed
 */
export const stubWords64 = (w: u64[]): u64[] => {
  const out: u64[] = []
  let i: i32 = w.length - 1
  while (i >= 0 && i < w.length) {
    out.push(w[i])
    i -= 1
  }
  return out
}

/**
 * The secret it is given, as a new secret.
 *
 * @param k the secret
 * @returns a secret copy of k
 */
export const stubSecret = (k: Secret<u8[]>): Secret<u8[]> => secret(expose(k, stubCopy))

/**
 * The secret it is given, as a new secret, or null for none.
 *
 * @param k the secret, or null
 * @returns a secret copy of k, or null when k is null
 */
export const stubMaybeSecret = (k: Secret<u8[]> | null): Secret<u8[]> | null => {
  if (k === null) {
    return null
  }
  return secret(expose(k, stubCopy))
}

/**
 * The sum of a window's bytes.
 *
 * @param buf the buffer the window is in
 * @param off where the window starts
 * @param len how many bytes it holds
 * @returns the sum of buf[off .. off + len)
 */
export const stubWindowSum = (buf: u8[], off: i32, len: i32): u32 => {
  let s: u32 = 0
  let n: i32 = 0
  let k: i32 = off
  while (n < len && k >= 0 && k < buf.length) {
    s = s + toU32(buf[k])
    k += 1
    n += 1
  }
  return s
}

/**
 * A window's bytes, copied into an out buffer from `at`.
 *
 * @param buf the buffer the window is in
 * @param off where the window starts
 * @param len how many bytes it holds
 * @param out the buffer to write into
 * @param at where in out to start
 * @returns the index just past the last byte written, or -1 when either buffer is too short
 */
export const stubWindowCopy = (buf: u8[], off: i32, len: i32, out: u8[], at: i32): i32 => {
  let n: i32 = 0
  let k: i32 = off
  let j: i32 = at
  while (n < len) {
    if (k < 0 || k >= buf.length || j < 0 || j >= out.length) {
      return -1
    }
    out[j] = buf[k]
    k += 1
    j += 1
    n += 1
  }
  return j
}

/**
 * The f64 it is given.
 *
 * @param x the value
 * @returns x
 */
export const stubF64 = (x: f64): f64 => x
