/**
 * `spec/source/hidden` — text that reads one way to a reviewer and another to
 * the gates. The gates look for MUST, SHALL and REQUIRED in the characters; a
 * reviewer reads the rendered page. A zero-width character inside a keyword,
 * or a Cyrillic capital Te for the T of MUST, shows a reviewer a requirement
 * the gates never see, so a source holding either is refused rather than
 * guessed at.
 *
 * Two refusals: an invisible code point anywhere (a format character, a
 * variation selector, a filler), and a word that reads as a binding keyword
 * but is not spelled in ASCII (look-alike capitals from other scripts,
 * mathematical or fullwidth letters, combining marks, or any non-ASCII letter
 * standing in for one of the keyword's).
 */

import { charsCodePointAt, charsName, charsSequenceLength } from "../contract/chars"

/** [lo, hi] pairs: the format characters (Cf) and the blank code points. */
const hiddenInvisibleTable = (): i32[] => [
  0x00ad, 0x00ad, 0x034f, 0x034f, 0x0600, 0x0605, 0x061c, 0x061c, 0x06dd, 0x06dd, 0x070f, 0x070f, 0x0890, 0x0891,
  0x08e2, 0x08e2, 0x115f, 0x1160, 0x17b4, 0x17b5, 0x180b, 0x180f, 0x200b, 0x200f, 0x202a, 0x202e, 0x2060, 0x2064,
  0x2066, 0x206f, 0x3164, 0x3164, 0xfe00, 0xfe0f, 0xfeff, 0xfeff, 0xffa0, 0xffa0, 0xfff9, 0xfffb, 0x110bd, 0x110bd,
  0x110cd, 0x110cd, 0x13430, 0x1343f, 0x1bca0, 0x1bca3, 0x1d173, 0x1d17a, 0xe0001, 0xe0001, 0xe0020, 0xe007f, 0xe0100,
  0xe01ef,
]

/** [lo, hi] pairs: combining marks, which a reader sees on the letter before. */
const hiddenMarksTable = (): i32[] => [0x0300, 0x036f, 0x1ab0, 0x1aff, 0x1dc0, 0x1dff, 0x20d0, 0x20ff, 0xfe20, 0xfe2f]

/** Pairs of a code point and the ASCII capital it renders as. */
const hiddenLookalikeTable = (): i32[] => [
  0x0391, 65, 0x0392, 66, 0x0395, 69, 0x0396, 90, 0x0397, 72, 0x0399, 73, 0x039a, 75, 0x039c, 77, 0x039d, 78, 0x039f,
  79, 0x03a1, 80, 0x03a4, 84, 0x03a5, 89, 0x03a7, 88, 0x0405, 83, 0x0406, 73, 0x0408, 74, 0x0410, 65, 0x0412, 66,
  0x0415, 69, 0x041a, 75, 0x041c, 77, 0x041d, 72, 0x041e, 79, 0x0420, 80, 0x0421, 67, 0x0422, 84, 0x0423, 89, 0x0425,
  88, 0x04ae, 89, 0x04c0, 73, 0x051a, 81, 0x051c, 87, 0x053c, 76, 0x054d, 85, 0x054f, 83, 0x0555, 79, 0x13a0, 68,
  0x13a1, 82, 0x13a2, 84, 0x13aa, 71, 0x13b3, 87, 0x13b7, 77, 0x13bb, 72, 0x13c0, 71, 0x13c3, 90, 0x13d2, 82, 0x13d5,
  83, 0x13da, 86, 0x13de, 76, 0x13df, 67, 0x13e2, 80, 0x13e6, 75, 0x13f4, 66, 0x2160, 73, 0x216c, 76, 0x216d, 67,
  0x216e, 68, 0x216f, 77, 0xa4d0, 66, 0xa4d1, 80, 0xa4d3, 68, 0xa4d4, 84, 0xa4d6, 71, 0xa4d7, 75, 0xa4d9, 74, 0xa4da,
  67, 0xa4dc, 90, 0xa4dd, 70, 0xa4df, 77, 0xa4e0, 78, 0xa4e1, 76, 0xa4e2, 83, 0xa4e3, 82, 0xa4e6, 86, 0xa4e7, 72,
  0xa4ea, 87, 0xa4eb, 88, 0xa4ec, 89, 0xa4ee, 65, 0xa4f0, 69, 0xa4f2, 73, 0xa4f3, 79, 0xa4f4, 85,
]

/** The words a binding requirement is found by. */
const hiddenKeywordsTable = (): string[] => ["MUST", "SHALL", "REQUIRED"]

/** Whether a code point lies in one of the [lo, hi] pairs of `ranges`. */
const hiddenInRanges = (ranges: i32[], cp: i32): boolean => {
  for (let i = 0; i + 1 < ranges.length; i += 2) {
    if (cp >= ranges[i] && cp <= ranges[i + 1]) {
      return true
    }
  }
  return false
}

/**
 * Whether a code point renders as nothing: a format character, a variation
 * selector or a filler.
 *
 * @param cp a code point
 * @returns true when a reader cannot see it
 */
export const hiddenIsInvisible = (cp: i32): boolean => cp >= 0xad && hiddenInRanges(hiddenInvisibleTable(), cp)

/**
 * The ASCII letter a code point reads as, when it reads as one: itself for an
 * ASCII letter, its look-alike for a capital of another script, and the
 * letter of a mathematical alphanumeric or a fullwidth Latin letter.
 *
 * @param cp a code point
 * @returns the ASCII letter's code, or -1 when it reads as none
 */
export const hiddenAsciiLetterOf = (cp: i32): i32 => {
  if ((cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122)) {
    return cp
  }
  if (cp >= 0xff21 && cp <= 0xff3a) {
    return cp - 0xff21 + 65
  }
  if (cp >= 0xff41 && cp <= 0xff5a) {
    return cp - 0xff41 + 97
  }
  if (cp >= 0x1d400 && cp <= 0x1d6a3) {
    const k = (cp - 0x1d400) % 52
    return k < 26 ? 65 + k : 97 + k - 26
  }
  const table = hiddenLookalikeTable()
  for (let i = 0; i + 1 < table.length; i += 2) {
    if (table[i] === cp) {
      return table[i + 1]
    }
  }
  return -1
}

/** Whether a code point may stand inside a word: an ASCII letter or digit, or anything non-ASCII. */
const hiddenIsWordChar = (cp: i32): boolean =>
  (cp >= 48 && cp <= 57) || (cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122) || cp >= 0x80

/**
 * The keyword a word copies, judged on its code points with invisible ones
 * and marks dropped (`marked` says a mark was): every letter reads as the
 * keyword's, or is non-ASCII where the keyword's letter is (an Armenian Se
 * for the U of MUST), with at least one ASCII capital.
 */
const hiddenSpoofs = (cps: i32[], marked: boolean): string | null => {
  let ascii = !marked
  let capital = false
  for (const cp of cps) {
    if (cp >= 0x80) {
      ascii = false
    }
    if (cp >= 65 && cp <= 90) {
      capital = true
    }
  }
  if (ascii) {
    return null
  }
  for (const k of hiddenKeywordsTable()) {
    if (k.length !== cps.length) {
      continue
    }
    let folded = true
    let spoof = capital
    for (let i = 0; i < cps.length; i++) {
      const want = k.charCodeAt(i)
      if (hiddenAsciiLetterOf(cps[i]) !== want) {
        folded = false
        if (cps[i] < 0x80) {
          spoof = false
        }
      }
    }
    if (folded || spoof) {
      return k
    }
  }
  return null
}

/** Records a word that spoofs a keyword, if `cps` is one. */
const hiddenCheckWord = (cps: i32[], marked: boolean, word: string, line: i32, out: string[]): void => {
  if (cps.length === 0) {
    return
  }
  const k = hiddenSpoofs(cps, marked)
  if (k !== null) {
    out.push(`line ${line}: "${word}" reads as ${k} but is not spelled in ASCII: write ${k}`)
  }
}

/**
 * Why a text would read differently to a reviewer than to the gates, one
 * entry per spot: each invisible character, and each word that reads as a
 * binding keyword without being spelled in ASCII. A byte-order mark at the
 * very start is an encoding marker and passes.
 *
 * @param text the source's text
 * @returns `line N: …` entries; empty when the text reads the same
 */
export const hiddenText = (text: string): string[] => {
  const out: string[] = []
  let line = 1
  let cps: i32[] = []
  let inWord = false
  let marked = false
  let wordStart = 0
  let i = 0
  while (i < text.length) {
    const cp = charsCodePointAt(text, i)
    const n = charsSequenceLength(text, i)
    if (hiddenIsInvisible(cp) && !(i === 0 && cp === 0xfeff)) {
      out.push(`line ${line}: invisible character ${charsName(cp)}: remove it`)
    }
    if (hiddenIsWordChar(cp)) {
      if (!inWord) {
        inWord = true
        wordStart = i
      }
      if (cp >= 0x300 && hiddenInRanges(hiddenMarksTable(), cp)) {
        marked = true
      } else if (!hiddenIsInvisible(cp)) {
        cps.push(cp)
      }
    } else if (inWord) {
      hiddenCheckWord(cps, marked, text.substring(wordStart, i), line, out)
      cps = []
      inWord = false
      marked = false
    }
    if (cp === 10) {
      line++
    }
    i += n
  }
  if (inWord) {
    hiddenCheckWord(cps, marked, text.substring(wordStart, text.length), line, out)
  }
  return out
}
