/**
 * A broken `core/hex`: toHex writes uppercase digits. `vector spec run`
 * finds the byte-order contract VIOLATED, on the bytes that hold a-f.
 */

/**
 * Writes bytes as hex, two digits a byte, wrongly uppercase.
 *
 * @param bytes the bytes to write
 * @returns the hex text, twice as long as `bytes`
 */
export const toHex = (bytes: u8[]): string => {
  const digits: string = "0123456789ABCDEF"
  const out: u8[] = new Array<u8>(bytes.length * 2)
  for (let i = 0; i < bytes.length; i++) {
    out[i * 2] = toU8(digits.charCodeAt(toI32(bytes[i] >> 4)))
    out[i * 2 + 1] = toU8(digits.charCodeAt(toI32(bytes[i] & 15)))
  }
  return String.fromBytes(out, 0, toI32(out.length))
}
