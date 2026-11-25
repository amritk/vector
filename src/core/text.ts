/**
 * `core/text` — ASCII case mapping that cannot panic.
 *
 * `nish/text`'s `asciiLower` and `asciiUpper` hold a slice nish 0.47 cannot
 * prove in range, so a module held to no panic calls these instead. They
 * answer byte for byte what the std functions answer.
 */

/** `A`, the first ASCII upper-case letter. */
const TEXT_UPPER_A: i32 = 65
/** `Z`, the last ASCII upper-case letter. */
const TEXT_UPPER_Z: i32 = 90
/** `a`, the first ASCII lower-case letter. */
const TEXT_LOWER_A: i32 = 97
/** `z`, the last ASCII lower-case letter. */
const TEXT_LOWER_Z: i32 = 122
/** How far apart an ASCII letter's two cases are: `a` is `A` plus this. */
const TEXT_CASE_DISTANCE: i32 = 32

/**
 * `text` with every ASCII lower-case letter upper-cased when `upper`, or every
 * upper-case one lower-cased when not, and every other byte as it was. Only
 * ASCII bytes move, so the answer is as well-formed as `text`. Each bound is a
 * constant, so the checker proves the moved byte fits.
 */
const textShiftAsciiCase = (text: string, upper: boolean): string => {
  const bytes: u8[] = []
  for (let i = 0; i < text.length; i++) {
    const code: i32 = toI32(text.charCodeAt(i))
    let moved: i32 = code
    if (upper && code >= TEXT_LOWER_A && code <= TEXT_LOWER_Z) {
      moved = code - TEXT_CASE_DISTANCE
    } else if (!upper && code >= TEXT_UPPER_A && code <= TEXT_UPPER_Z) {
      moved = code + TEXT_CASE_DISTANCE
    }
    bytes.push(toU8(moved))
  }
  return String.fromBytes(bytes, 0, toI32(bytes.length))
}

/**
 * Lower-cases the ASCII letters of `text`, leaving every other byte as it is:
 * `nish/text`'s `asciiLower`, without its panic site.
 *
 * @param text the text whose ASCII letters are lower-cased
 * @returns a fresh string as long as `text`
 */
export const textAsciiLower = (text: string): string =>
  textShiftAsciiCase(text, false)

/**
 * Upper-cases the ASCII letters of `text`, leaving every other byte as it is:
 * `nish/text`'s `asciiUpper`, without its panic site.
 *
 * @param text the text whose ASCII letters are upper-cased
 * @returns a fresh string as long as `text`
 */
export const textAsciiUpper = (text: string): string =>
  textShiftAsciiCase(text, true)
