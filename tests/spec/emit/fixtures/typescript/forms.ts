// nish/forms in TypeScript: the module tests/spec/emit/fixtures/forms.json's
// TypeScript test runs against, as forms.ts one directory up is for its Nish
// test. A form the TypeScript emitter writes wrong fails that test. Some
// bytes come back as a view into a larger buffer, because the test takes any.

/** x as it is. */
export function idI32(x: number): number {
  return x
}

/** a + b, wrapping to 64 bits. */
export function addI64(a: bigint, b: bigint): bigint {
  return BigInt.asIntN(64, a + b)
}

/** a + b, wrapping to 32 bits. */
export function addI32(a: number, b: number): number {
  return (a + b) | 0
}

/** a - b, wrapping to 32 bits. */
export function subI32(a: number, b: number): number {
  return (a - b) | 0
}

/** a * b, wrapping to 32 bits. */
export function mulI32(a: number, b: number): number {
  return Math.imul(a, b)
}

/** x sign-extended to 64 bits, as 8 little-endian bytes: a view into a larger buffer. */
export function leBytes(x: number): Uint8Array {
  const d = new DataView(new ArrayBuffer(16))
  d.setBigInt64(4, BigInt(x), true)
  return new Uint8Array(d.buffer, 4, 8)
}

/** a XOR b, as long as the shorter. */
export function xorB(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.min(a.length, b.length))
  for (let i = 0; i < out.length; i++) {
    out[i] = a[i] ^ b[i]
  }
  return out
}

/** s, or null when it is empty. */
export function nonEmpty(s: string): string | null {
  return s === "" ? null : s
}

/** a, or null when it is empty. */
export function nonEmptyB(a: Uint8Array): Uint8Array | null {
  return a.length === 0 ? null : a.slice()
}

/** Half of x. */
export function half(x: number): number {
  return x / 2
}

/** Whether x is the largest u64. */
export function isMax(x: bigint): boolean {
  return x === 18446744073709551615n
}

/** A copy of k; null when u is empty. */
export function keep(k: Uint8Array, u: Uint8Array): Uint8Array | null {
  return u.length === 0 ? null : k.slice()
}

/** k, or null when there is none. */
export function keepBase(k: Uint8Array | undefined): Uint8Array | null {
  return k === undefined ? null : k.slice()
}
