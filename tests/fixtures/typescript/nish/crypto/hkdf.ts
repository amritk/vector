// nish/crypto/hkdf in TypeScript: the port `vector spec run --lang typescript`
// checks against contracts/rfc5869-hkdf-sha256.json, written out from RFC 5869 §2.

import { hmacSha256 } from "./hmac.ts"

const HASH_LEN = 32

/** PRK = HMAC-Hash(salt, IKM); an empty salt is HashLen zeros. */
export function hkdfExtractSha256(salt: Uint8Array, ikm: Uint8Array): Uint8Array {
  return hmacSha256(salt.length === 0 ? new Uint8Array(HASH_LEN) : salt, ikm)
}

/** The first `length` octets of T(1) | T(2) | ...; null past 255 * HashLen or below 0. */
export function hkdfExpandSha256(prk: Uint8Array, info: Uint8Array, length: number): Uint8Array | null {
  if (length < 0 || length > 255 * HASH_LEN) {
    return null
  }
  const okm = new Uint8Array(Math.ceil(length / HASH_LEN) * HASH_LEN)
  let t: Uint8Array = new Uint8Array(0)
  for (let i = 1; (i - 1) * HASH_LEN < length; i++) {
    const msg = new Uint8Array(t.length + info.length + 1)
    msg.set(t)
    msg.set(info, t.length)
    msg[msg.length - 1] = i
    t = hmacSha256(prk, msg)
    okm.set(t, (i - 1) * HASH_LEN)
  }
  return okm.slice(0, length)
}
