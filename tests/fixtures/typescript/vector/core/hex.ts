// vector's src/core/hex.ts ported to TypeScript: the implementation
// `vector spec run contracts/vector-core-hex.json --lang typescript` checks.

import { sha256 } from "../../sha256.ts"

/** Each byte of `data` as two lowercase hex digits. */
export function toHex(data: Uint8Array): string {
  let out = ""
  for (const b of data) {
    out += b.toString(16).padStart(2, "0")
  }
  return out
}

/** The SHA-256 of `text`'s UTF-8 bytes, as lowercase hex. */
export function sha256Hex(text: string): string {
  return toHex(sha256(new TextEncoder().encode(text)))
}
