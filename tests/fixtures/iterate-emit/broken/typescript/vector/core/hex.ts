// A port of vector's src/core/hex.ts with a bug: sha256Hex writes uppercase
// digits once it is fed a 64-character text, as a chain feeds it its own
// digest. `vector spec run` finds the 1,000-step chain VIOLATED.

import { sha256 } from "../../../../../typescript/sha256.ts"

/** Each byte of `data` as two lowercase hex digits. */
export function toHex(data: Uint8Array): string {
  let out = ""
  for (const b of data) {
    out += b.toString(16).padStart(2, "0")
  }
  return out
}

/** The SHA-256 of `text`'s UTF-8 bytes, wrongly uppercase for a 64-character text. */
export function sha256Hex(text: string): string {
  const out = toHex(sha256(new TextEncoder().encode(text)))
  return text.length === 64 ? out.toUpperCase() : out
}
