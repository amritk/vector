/**
 * `core/hex` — bytes as lowercase hex, and SHA-256.
 */

import { sha256 } from "nish/crypto/sha256"

const HEX_DIGITS: string = "0123456789abcdef"

/**
 * Writes bytes as lowercase hex, two digits a byte.
 *
 * @param bytes the bytes to write
 * @returns the hex text, twice as long as `bytes`
 */
export const toHex = (bytes: u8[]): string => {
  const out: u8[] = new Array<u8>(bytes.length * 2)
  for (let i = 0; i < bytes.length; i++) {
    out[i * 2] = toU8(HEX_DIGITS.charCodeAt(toI32(bytes[i] >> 4)))
    out[i * 2 + 1] = toU8(HEX_DIGITS.charCodeAt(toI32(bytes[i] & 15)))
  }
  return String.fromBytes(out, 0, toI32(out.length))
}

const hexNibble = (c: i32): i32 => {
  if (c >= 48 && c <= 57) {
    return c - 48
  }
  if (c >= 97 && c <= 102) {
    return c - 87
  }
  if (c >= 65 && c <= 70) {
    return c - 55
  }
  return -1
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
  const out: u8[] = new Array<u8>(n / 2)
  for (let i = 0; i < n; i += 2) {
    const hi = hexNibble(text.charCodeAt(i))
    const lo = hexNibble(text.charCodeAt(i + 1))
    if (hi < 0 || lo < 0) {
      return Err(`not a hex digit at offset ${hi < 0 ? i : i + 1}`)
    }
    out[i / 2] = toU8(hi * 16 + lo)
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
  const out: u8[] = new Array<u8>(text.length)
  for (let i = 0; i < toI32(text.length); i++) {
    out[i] = toU8(text.charCodeAt(i))
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
