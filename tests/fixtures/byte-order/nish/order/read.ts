/**
 * `order/read`: integers read from and written to bytes, the module the
 * byte-order-read contract checks against vector's read and write ops.
 */

/**
 * Reads `w` bytes of `b` from `at` as an unsigned integer.
 *
 * @param b the bytes
 * @param w how many bytes to read
 * @param be true to read the first byte as the most significant
 * @returns the integer the bytes hold
 */
const orderBytesU64 = (b: u8[], w: i32, be: boolean): u64 => {
  let acc: u64 = toU64(0)
  for (let i = 0; i < w; i++) {
    const j: i32 = be ? i : w - 1 - i
    acc = (acc << toU64(8)) | toU64(b[j])
  }
  return acc
}

/**
 * Writes the low `w` bytes of `n`.
 *
 * @param n the integer
 * @param w how many bytes to write
 * @param be true to write the most significant byte first
 * @returns the `w` bytes
 */
const orderU64Bytes = (n: u64, w: i32, be: boolean): u8[] => {
  const out: u8[] = new Array<u8>(w)
  for (let i = 0; i < w; i++) {
    const shift: u64 = toU64(8 * (be ? w - 1 - i : i))
    out[i] = toU8((n >> shift) & toU64(255))
  }
  return out
}

/**
 * The QUIC-style 62-bit value in eight bytes: big-endian, top two bits cleared.
 *
 * @param b eight bytes
 * @returns the value
 */
export const varint62 = (b: u8[]): u64 => {
  return orderBytesU64(b, 8, true) & ((toU64(1) << toU64(62)) - toU64(1))
}

/**
 * Reads four bytes as a signed integer, little-endian.
 *
 * @param b four bytes
 * @returns the integer, in two's complement
 */
export const readLeI32 = (b: u8[]): i32 => {
  return toI32(toU32(orderBytesU64(b, 4, false)))
}

/**
 * Reads two bytes as an unsigned integer, big-endian.
 *
 * @param b two bytes
 * @returns the integer
 */
export const readBeU16 = (b: u8[]): u16 => {
  return toU16(orderBytesU64(b, 2, true))
}

/**
 * Writes a u32 as four bytes, big-endian.
 *
 * @param n the integer
 * @returns four bytes
 */
export const putBe32 = (n: u32): u8[] => {
  return orderU64Bytes(toU64(n), 4, true)
}

/**
 * Writes an i64 as eight bytes in two's complement, little-endian.
 *
 * @param n the integer
 * @returns eight bytes
 */
export const putLe64 = (n: i64): u8[] => {
  return orderU64Bytes(toU64(n), 8, false)
}

/**
 * Returns `n` unchanged: a u32 parameter that takes an i32 read.
 *
 * @param n the integer
 * @returns `n`
 */
export const idU32 = (n: u32): u32 => {
  return n
}

/**
 * Returns `n` unchanged: a u16 parameter that takes a u16 read.
 *
 * @param n the integer
 * @returns `n`
 */
export const idU16 = (n: u16): u16 => {
  return n
}

/**
 * Returns `n` unchanged: a i32 parameter that takes a i32 read.
 *
 * @param n the integer
 * @returns `n`
 */
export const idI32 = (n: i32): i32 => {
  return n
}

/**
 * Returns `n` unchanged: a u64 parameter that takes a u64 read.
 *
 * @param n the integer
 * @returns `n`
 */
export const idU64 = (n: u64): u64 => {
  return n
}

/**
 * Returns `n` unchanged: a i64 parameter that takes a i64 read.
 *
 * @param n the integer
 * @returns `n`
 */
export const idI64 = (n: i64): i64 => {
  return n
}
