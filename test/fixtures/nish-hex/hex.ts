/**
 * `nish/hex` — hexadecimal (RFC 4648 §8, base 16), as tests, test vectors and
 * configuration spell keys. The contract is `specs/example-hex.md`.
 *
 * - `hexEncode(bytes)` writes two lowercase digits per byte, high nibble
 *   first, with no separator and no prefix (spec §3).
 * - `hexDecode(text)` accepts `0-9 a-f A-F` in any mix of case and answers the
 *   bytes, or `null` for an odd length or any other character — whitespace and
 *   a `0x` prefix included (spec §4). The empty text is the empty array.
 *
 * **Neither direction indexes a table by a digit's value** (spec §5): what is
 * decoded here is often key material, and a lookup indexed by a secret nibble
 * leaves its trace in the cache. A nibble becomes a digit, and a digit a
 * nibble, by arithmetic on range masks, as in `nish/crypto/base64url`:
 * `(lo - 1 - c) & (c - hi - 1)` is negative exactly when `lo <= c <= hi`, and
 * an arithmetic shift by 31 turns that sign into an all-ones or all-zeros
 * mask. A malformed character is not refused where it is found: the verdict is
 * ORed into one word and read once, after the whole text, so the running time
 * depends only on the length, which is public and is tested first.
 *
 * Private helpers share the importing program's flat symbol namespace
 * (`docs/wp26-stdlib.md` §3e), which is why each one carries the module's name.
 */

/**
 * All ones when `lo <= c <= hi`, else zero, without a branch. The sums are in
 * `u32`, which wraps by definition, so that no overflow check — a branch on
 * the data — is emitted for an overflow that cannot happen.
 */
const hexRangeMask = (c: i32, lo: i32, hi: i32): i32 =>
  toI32((toU32(lo) - 1 - toU32(c)) & (toU32(c) - toU32(hi) - 1)) >> 31;

/**
 * The lowercase digit for the nibble `v` (`0 <= v <= 15`): `'0' + v`, plus the
 * 39 that steps from just past `'9'` to `'a'` once `v` reaches 10.
 */
const hexDigitOf = (v: i32): u8 =>
  toU8(toI32(48 + toU32(v) + toU32(hexRangeMask(v, 10, 15) & 39)));

/**
 * The nibble the byte `c` stands for, or `-1` when `c` is not a hex digit.
 * Each range contributes its value under its own mask, and a byte in none of
 * them has every bit set by the final OR.
 */
const hexNibbleOf = (c: i32): i32 => {
  const digit: i32 = hexRangeMask(c, 48, 57);
  const lower: i32 = hexRangeMask(c, 97, 102);
  const upper: i32 = hexRangeMask(c, 65, 70);
  const value: i32 =
    (digit & toI32(toU32(c) - 48)) |
    (lower & toI32(toU32(c) - 87)) |
    (upper & toI32(toU32(c) - 55));
  return value | ~(digit | lower | upper);
};

/** `bytes` as lowercase hex, two digits per byte. Panics past 2^30 - 1 bytes, whose encoding would not fit a string. */
export const hexEncode = (bytes: u8[]): string => {
  // Refused before `toI32`, which saturates a longer length under
  // `--number-mode f64`, and before `2 * n`, which would leave `i32`.
  if (bytes.length > 1073741823) {
    panic("hexEncode: more than 2^30 - 1 bytes");
  }
  const n: i32 = toI32(bytes.length);
  const out: u8[] = new Array<u8>(n * 2);
  const outLen: i32 = toI32(out.length);
  let o: i32 = 0;
  for (let i: i32 = 0; i < n; i++) {
    const b: i32 = toI32(bytes[i]);
    // Always true — `out` is twice `bytes` — but written out so that the
    // stores keep no bounds check.
    if (o >= 0 && o + 1 < outLen) {
      out[o] = hexDigitOf(b >> 4);
      out[o + 1] = hexDigitOf(b & 15);
    }
    o = o + 2;
  }
  return String.fromBytes(out, 0, outLen);
};

/**
 * The bytes `text` spells in hex, or `null` when its length is odd or any
 * character is not one of `0-9 a-f A-F`. The empty text is the empty array.
 */
export const hexDecode = (text: string): u8[] | null => {
  // A text past 2^31 - 1 bytes is refused before `toI32`, which would
  // saturate it under `--number-mode f64` and decode only a prefix.
  if (text.length > 2147483647) {
    return null;
  }
  const n: i32 = toI32(text.length);
  if ((n & 1) !== 0) {
    return null;
  }
  const out: u8[] = new Array<u8>(n >> 1);
  const outLen: i32 = toI32(out.length);
  // All ones once any character is not a digit (its nibble of `-1` shifted
  // right by 31).
  let bad: i32 = 0;
  let j: i32 = 0;
  for (let k: i32 = 0; k + 1 < n; k = k + 2) {
    const hi: i32 = hexNibbleOf(toI32(text.charCodeAt(k)));
    const lo: i32 = hexNibbleOf(toI32(text.charCodeAt(k + 1)));
    bad = bad | (hi >> 31) | (lo >> 31);
    // Always true — `out` was sized from the same length — but written out so
    // that the store keeps no bounds check.
    if (j >= 0 && j < outLen) {
      out[j] = toU8(((hi & 15) << 4) | (lo & 15));
    }
    j++;
  }
  if (bad !== 0) {
    return null;
  }
  return out;
};
