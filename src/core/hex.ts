/**
 * `core/hex` — bytes as lowercase hex, and SHA-256.
 */

import { sha256 } from "nish/crypto/sha256"

/** The lowercase hex digit of a nibble (0 to 15), in u32 so the add cannot overflow. */
const hexDigit = (nibble: u32): u8 => toU8(nibble < 10 ? nibble + 48 : nibble + 87)

/**
 * Writes bytes as lowercase hex, two digits a byte.
 *
 * @param bytes the bytes to write
 * @returns the hex text, twice as long as `bytes`
 */
export const toHex = (bytes: u8[]): string => {
  const out: u8[] = []
  for (const b of bytes) {
    out.push(hexDigit(toU32(b >> 4)))
    out.push(hexDigit(toU32(b & 15)))
  }
  return String.fromBytes(out, 0, toI32(out.length))
}

/** The value (0 to 15) of a hex digit, or 16 when `c` is not one; in u32, so no step can overflow. */
const hexNibble = (c: i32): u32 => {
  if (c >= 48 && c <= 57) {
    return toU32(c) - 48
  }
  if (c >= 97 && c <= 102) {
    return toU32(c) - 87
  }
  if (c >= 65 && c <= 70) {
    return toU32(c) - 55
  }
  return 16
}

/**
 * Reads hex text (either case) back into bytes.
 *
 * @param text an even number of hex digits
 * @returns `Ok` with the bytes, or `Err` saying what is wrong with the text
 */
export const fromHex = (text: string): Result<u8[], string> => {
  const n = toI32(text.length)
  if (n % 2 !== 0) {
    return Err(`hex text has an odd number of digits (${n})`)
  }
  const out: u8[] = []
  // n is even, so i < n - 1 visits the same pairs as i < n.
  for (let i = 0; i < n - 1; i += 2) {
    const hi = hexNibble(text.charCodeAt(i))
    const lo = hexNibble(text.charCodeAt(i + 1))
    if (hi > 15 || lo > 15) {
      return Err(`not a hex digit at offset ${hi > 15 ? i : i + 1}`)
    }
    out.push(toU8(hi * 16 + lo))
  }
  return Ok(out)
}

/**
 * The bytes of a string as stored (UTF-8).
 *
 * @param text the string to read
 * @returns one byte per byte of `text`
 */
export const utf8Bytes = (text: string): u8[] => {
  const out: u8[] = []
  for (let i = 0; i < toI32(text.length); i++) {
    out.push(toU8(text.charCodeAt(i)))
  }
  return out
}

/**
 * The SHA-256 digest of a string's bytes, as lowercase hex.
 *
 * @param text the string to hash
 * @returns 64 hex digits
 */
export const sha256Hex = (text: string): string => toHex(sha256(utf8Bytes(text)))
