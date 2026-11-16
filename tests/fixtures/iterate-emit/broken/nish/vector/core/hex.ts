/**
 * A broken `core/hex`: sha256Hex writes uppercase digits once it is fed a
 * 64-character text, as a chain feeds it its own digest. `vector spec run`
 * finds the 1,000-step chain VIOLATED.
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
 * The SHA-256 of a text's bytes, wrongly uppercase for a 64-character text.
 *
 * @param text the text to hash
 * @returns the digest as hex
 */
export const sha256Hex = (text: string): string => {
  const bytes: u8[] = new Array<u8>(text.length)
  for (let i = 0; i < text.length; i++) {
    bytes[i] = toU8(text.charCodeAt(toI32(i)))
  }
  return hexIn(sha256(bytes), text.length === 64 ? "0123456789ABCDEF" : "0123456789abcdef")
}
