// order/read in TypeScript: integers read from and written to bytes, the module
// the byte-order-read contract checks against vector's read and write ops.

/** Eight bytes big-endian, top two bits cleared. */
export function varint62(b: Uint8Array): bigint {
  const v = new DataView(b.buffer, b.byteOffset, 8).getBigUint64(0, false)
  return v & ((1n << 62n) - 1n)
}

/** Four bytes as a signed integer, little-endian. */
export function readLeI32(b: Uint8Array): number {
  return new DataView(b.buffer, b.byteOffset, 4).getInt32(0, true)
}

/** Two bytes as an unsigned integer, big-endian. */
export function readBeU16(b: Uint8Array): number {
  return new DataView(b.buffer, b.byteOffset, 2).getUint16(0, false)
}

/** A u32 as four bytes, big-endian. */
export function putBe32(n: number): Uint8Array {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, n, false)
  return out
}

/** An i64 as eight bytes in two's complement, little-endian. */
export function putLe64(n: bigint): Uint8Array {
  const out = new Uint8Array(8)
  new DataView(out.buffer).setBigInt64(0, n, true)
  return out
}

/** `n` unchanged: a u32 parameter that takes an i32 read. */
export function idU32(n: number): number {
  return n
}

/** `n` unchanged: a u16 parameter that takes a u16 read. */
export function idU16(n: number): number {
  return n
}

/** `n` unchanged: a i32 parameter that takes a i32 read. */
export function idI32(n: number): number {
  return n
}

/** `n` unchanged: a u64 parameter that takes a u64 read. */
export function idU64(n: bigint): bigint {
  return n
}

/** `n` unchanged: a i64 parameter that takes a i64 read. */
export function idI64(n: bigint): bigint {
  return n
}
