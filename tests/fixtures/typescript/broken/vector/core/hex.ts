// A port of vector's src/core/hex.ts with a bug: uppercase hex digits.
// `vector spec run` judges it VIOLATED.

import { sha256 } from "../../../sha256.ts"

/** Each byte of `data` as two hex digits, wrongly uppercase. */
export function toHex(data: Uint8Array): string {
  let out = ""
  for (const b of data) {
    out += b.toString(16).padStart(2, "0").toUpperCase()
  }
  return out
}

/** The SHA-256 of `text`'s UTF-8 bytes, as lowercase hex. */
export function sha256Hex(text: string): string {
  let out = ""
  for (const b of sha256(new TextEncoder().encode(text))) {
    out += b.toString(16).padStart(2, "0")
  }
  return out
}
