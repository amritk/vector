/**
 * A `core/hex` broken late: sha256Hex writes uppercase digits for a text
 * starting "000", which a chain from "abc" first feeds it at step 9,906.
 * The 1 and 1,000-step chains pass, so only `vector spec run --slow`, which
 * runs the 100,000-step chain, finds it VIOLATED.
 */

import { sha256 } from "nish/crypto/sha256"

const hexIn = (bytes: u8[], digits: string): string => {
  const out: u8[] = new Array<u8>(bytes.length * 2)
  for (let i = 0; i < bytes.length; i++) {
    out[i * 2] = toU8(digits.charCodeAt(toI32(bytes[i] >> 4)))
    out[i * 2 + 1] = toU8(digits.charCodeAt(toI32(bytes[i] & 15)))
  }
  return String.fromBytes(out, 0, toI32(out.length))
}

/**
 * The SHA-256 of a text's bytes, wrongly uppercase for a text starting "000".
 *
 * @param text the text to hash
 * @returns the digest as hex
 */
export const sha256Hex = (text: string): string => {
  const bytes: u8[] = new Array<u8>(text.length)
  for (let i = 0; i < text.length; i++) {
    bytes[i] = toU8(text.charCodeAt(toI32(i)))
  }
  return hexIn(sha256(bytes), text.startsWith("000") ? "0123456789ABCDEF" : "0123456789abcdef")
}
