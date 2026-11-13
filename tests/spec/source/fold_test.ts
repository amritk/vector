import { Suite } from "nish/testing"
import { sha256Hex } from "../../../src/core/hex"
import { FOLD_ENTRIES, FOLD_SHA256, foldAsciiLetter, foldTable } from "../../../src/spec/source/fold"

/** The generated fold table: NFKD, marks dropped, one ASCII letter. */
export const main = (): i32 => {
  const t = new Suite("spec/source fold")
  const f = foldTable()
  // Pinned to its generator: a hand edit changes the count or the hash.
  t.ok("the table is generated in full", f.length % 2 === 0 && f.length / 2 === FOLD_ENTRIES && FOLD_ENTRIES > 1000)
  const values: string[] = []
  for (const v of f) {
    values.push(`${v}`)
  }
  t.eqStr("the table is the one generated", sha256Hex(values.join(",")), FOLD_SHA256)
  let sorted = true
  for (let i = 0; i < f.length; i += 2) {
    const a = f[i + 1]
    sorted = sorted && f[i] >= 0x80 && (i === 0 || f[i - 2] < f[i]) && ((a >= 65 && a <= 90) || (a >= 97 && a <= 122))
  }
  t.ok("sorted, each to an ASCII letter", sorted)

  // Precomposed Latin and Greek letters, each block the guard relies on.
  t.eqStr(
    "precomposed Latin",
    `${foldAsciiLetter(f, 0xda)} ${foldAsciiLetter(f, 0x15a)} ${foldAsciiLetter(f, 0x164)} ${foldAsciiLetter(f, 0x1e3e)}`,
    "85 83 84 77",
  )
  t.eqStr("Latin Extended-B", `${foldAsciiLetter(f, 0x1cd)} ${foldAsciiLetter(f, 0x1fa)}`, "65 65")
  // Superscripts, subscripts and modifier letters.
  t.eqStr(
    "modifier capitals",
    `${foldAsciiLetter(f, 0x1d3f)} ${foldAsciiLetter(f, 0x1d31)} ${foldAsciiLetter(f, 0x1d41)} ${foldAsciiLetter(f, 0x1d30)}`,
    "82 69 85 68",
  )
  t.eqStr("a modifier Q", `${foldAsciiLetter(f, 0xa7f4)}`, "81")
  t.eqStr("superscript and subscript", `${foldAsciiLetter(f, 0x2071)} ${foldAsciiLetter(f, 0x2090)}`, "105 97")
  t.eqStr("a spacing modifier", `${foldAsciiLetter(f, 0x2b0)}`, "104")
  // Letterlike, circled, fullwidth and mathematical letters.
  t.eqStr("letterlike", `${foldAsciiLetter(f, 0x211d)} ${foldAsciiLetter(f, 0x212a)}`, "82 75")
  t.eqStr("circled", `${foldAsciiLetter(f, 0x24c2)}`, "77")
  t.eqStr("fullwidth", `${foldAsciiLetter(f, 0xff2d)} ${foldAsciiLetter(f, 0xff5a)}`, "77 122")
  t.eqStr("math", `${foldAsciiLetter(f, 0x1d400)} ${foldAsciiLetter(f, 0x1d6a3)}`, "65 122")
  // What does not fold to one ASCII letter.
  t.eqStr(
    "ASCII, a look-alike, a ligature, a digit, the ends",
    `${foldAsciiLetter(f, 0x41)} ${foldAsciiLetter(f, 0x422)} ${foldAsciiLetter(f, 0xfb01)} ${foldAsciiLetter(f, 0xb2)} ${foldAsciiLetter(f, 0x80)} ${foldAsciiLetter(f, 0x10ffff)}`,
    "-1 -1 -1 -1 -1 -1",
  )
  return t.done()
}
