// nish/crypto/hmac in TypeScript, over the fixtures' SHA-256 (RFC 2104).

import { sha256 } from "../../sha256.ts"

/** HMAC-SHA-256 of `data` under `key`. */
export function hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
  const k = new Uint8Array(64)
  k.set(key.length > 64 ? sha256(key) : key)
  const inner = new Uint8Array(64 + data.length)
  const outer = new Uint8Array(64 + 32)
  for (let i = 0; i < 64; i++) {
    inner[i] = k[i] ^ 0x36
    outer[i] = k[i] ^ 0x5c
  }
  inner.set(data, 64)
  outer.set(sha256(inner), 64)
  return sha256(outer)
}
