// CRC-32 and Adler-32 over a window, passed through to nish/compress/checksum,
// for tests/fixtures/checksum-window's contract to check under its own module
// root (`--package fixture=...`). tests/fixtures/checksum-window/broken holds a
// copy whose crc32 reads its window from the start of the buffer, which the
// same contract refuses.
import { adler32 as checksumAdler32, adler32Update as checksumAdler32Update, crc32 as checksumCrc32 } from "nish/compress/checksum"

/**
 * The CRC-32 of `buf[off, off + len)`.
 *
 * @param buf the buffer
 * @param off where the window starts
 * @param len how many bytes it holds
 * @returns the checksum
 */
export const crc32 = (buf: u8[], off: i32, len: i32): u32 => checksumCrc32(buf, off, len)

/**
 * The Adler-32 of `buf[off, off + len)`.
 *
 * @param buf the buffer
 * @param off where the window starts
 * @param len how many bytes it holds
 * @returns the checksum
 */
export const adler32 = (buf: u8[], off: i32, len: i32): u32 => checksumAdler32(buf, off, len)

/**
 * An Adler-32 continued over `buf[off, off + len)`.
 *
 * @param adler the checksum so far
 * @param buf the buffer
 * @param off where the window starts
 * @param len how many bytes it holds
 * @returns the checksum
 */
export const adler32Update = (adler: u32, buf: u8[], off: i32, len: i32): u32 =>
  checksumAdler32Update(adler, buf, off, len)
