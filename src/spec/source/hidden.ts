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

import { Regex, RegexMatch, regexCompile } from "nish/regex"
import { charsCodePointAt, charsFromCodePoint, charsName, charsSequenceLength } from "../contract/chars"
import { FOLD_CLASS, foldAsciiLetter, foldTable } from "./fold"

/** [lo, hi] pairs: the format characters (Cf) and the blank code points. */
const hiddenInvisibleTable = (): i32[] => [
  0x00ad, 0x00ad, 0x034f, 0x034f, 0x0600, 0x0605, 0x061c, 0x061c, 0x06dd, 0x06dd, 0x070f, 0x070f, 0x0890, 0x0891,
  0x08e2, 0x08e2, 0x115f, 0x1160, 0x17b4, 0x17b5, 0x180b, 0x180f, 0x200b, 0x200f, 0x202a, 0x202e, 0x2060, 0x2064,
  0x2066, 0x206f, 0x3164, 0x3164, 0xfe00, 0xfe0f, 0xfeff, 0xfeff, 0xffa0, 0xffa0, 0xfff9, 0xfffb, 0x110bd, 0x110bd,
  0x110cd, 0x110cd, 0x13430, 0x1343f, 0x1bca0, 0x1bca3, 0x1d173, 0x1d17a, 0xe0001, 0xe0001, 0xe0020, 0xe007f, 0xe0100,
  0xe01ef,
]

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

/** The tables a text is judged with, built once per text rather than per code point. */
class HiddenTables {
  invisible: i32[]
  lookalike: i32[]
  fold: i32[]
  keywords: string[]
  constructor() {
    this.invisible = hiddenInvisibleTable()
    this.lookalike = hiddenLookalikeTable()
    this.fold = foldTable()
    this.keywords = hiddenKeywordsTable()
  }
}

/** Whether `cp` is invisible, by the tables held. */
const hiddenInvisibleIn = (tables: HiddenTables, cp: i32): boolean => cp >= 0xad && hiddenInRanges(tables.invisible, cp)

/** The ASCII letter `cp` reads as, by the tables held; -1 when none. */
const hiddenLetterIn = (tables: HiddenTables, cp: i32): i32 => {
  if ((cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122)) {
    return cp
  }
  if (cp < 0x80) {
    return -1
  }
  const folded = foldAsciiLetter(tables.fold, cp)
  if (folded >= 0) {
    return folded
  }
  const table = tables.lookalike
  for (let i = 0; i + 1 < table.length; i += 2) {
    if (table[i] === cp) {
      return table[i + 1]
    }
  }
  return -1
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
 * ASCII letter; the letter its compatibility decomposition leaves once its
 * marks are dropped (foldAsciiLetter: "Ú", "ᴿ", a fullwidth or mathematical
 * letter); else its look-alike, for a capital of another script.
 *
 * @param cp a code point
 * @returns the ASCII letter's code, or -1 when it reads as none
 */
export const hiddenAsciiLetterOf = (cp: i32): i32 => hiddenLetterIn(new HiddenTables(), cp)

/**
 * The regex character class a word is made of: letters, digits and marks of
 * any script, and every code point that folds to a letter (FOLD_CLASS,
 * generated with foldTable): the circled, squared and outlined letters
 * `\p{L}` leaves out, and letters newer than the regex engine's tables.
 *
 * @returns the class, brackets included
 */
export const hiddenWordClass = (): string => `[\\p{L}\\p{N}\\p{M}${FOLD_CLASS}]`

/** The patterns a text is read with, compiled once per call. */
class HiddenPatterns {
  /** A word: a run of letters, digits and marks of any script, and of symbol letters. */
  word: Regex
  /** One combining mark, the whole string. */
  mark: Regex
  /** One letter, the whole string. */
  letter: Regex
  tables: HiddenTables
  constructor(word: Regex, mark: Regex, letter: Regex) {
    this.word = word
    this.mark = mark
    this.letter = letter
    this.tables = new HiddenTables()
  }
}

/** Compiles the patterns; an error names the one that failed. */
const hiddenPatterns = (): Result<HiddenPatterns, string> => {
  const word = regexCompile(`${hiddenWordClass()}+`, "").orReturn()
  const mark = regexCompile("^\\p{M}$", "").orReturn()
  const letter = regexCompile("^\\p{L}$", "").orReturn()
  return Ok(new HiddenPatterns(word, mark, letter))
}

/**
 * The keyword a word copies, if it copies one. The word is folded first:
 * invisible characters dropped, marks dropped (`marked` says one was), and
 * each character read as the ASCII letter it looks like. It copies a keyword
 * when the folded word is the keyword, or when it has an ASCII capital and a
 * non-ASCII character and every character either is the keyword's or is a
 * non-ASCII letter standing in for it (an Armenian Se for the U of MUST).
 */
const hiddenSpoofs = (p: HiddenPatterns, word: string): string | null => {
  const folded: i32[] = []
  let marked = false
  let ascii = true
  let i = 0
  while (i < word.length) {
    const cp = charsCodePointAt(word, i)
    const n = charsSequenceLength(word, i)
    if (!hiddenInvisibleIn(p.tables, cp)) {
      if (cp >= 0x80 && p.mark.test(word.substring(i, i + n))) {
        marked = true
      } else {
        if (cp >= 0x80) {
          ascii = false
        }
        const f = hiddenLetterIn(p.tables, cp)
        folded.push(f >= 0 ? f : cp)
      }
    }
    i += n
  }
  if (ascii && !marked) {
    return null
  }
  let capital = false
  let foreign = false
  for (const cp of folded) {
    if (cp >= 65 && cp <= 90) {
      capital = true
    }
    if (cp >= 0x80) {
      foreign = true
    }
  }
  for (const k of p.tables.keywords) {
    if (k.length !== folded.length) {
      continue
    }
    let same = true
    let standIn = capital && foreign
    for (let j = 0; j < folded.length; j++) {
      const cp = folded[j]
      if (cp !== k.charCodeAt(j)) {
        same = false
        if (cp < 0x80 || !p.letter.test(charsFromCodePoint(cp))) {
          standIn = false
        }
      }
    }
    if (same || standIn) {
      return k
    }
  }
  return null
}

/** The line of byte `at`, counting the newlines from `from` (on line `line`). */
const hiddenLineAt = (text: string, from: i32, at: i32, line: i32): i32 => {
  let n = line
  for (let i = from; i < at; i++) {
    if (text.charCodeAt(i) === 10) {
      n = n + 1
    }
  }
  return n
}

/** What a scan found: the spots it kept, and how many it found in all. */
class HiddenScan {
  spots: string[]
  total: i32
  keep: i32
  constructor(keep: i32) {
    this.spots = []
    this.total = 0
    this.keep = keep
  }
}

/** Counts a spot, and keeps its text while fewer than `keep` are kept. */
const hiddenNote = (scan: HiddenScan, spot: string): void => {
  scan.total = scan.total + 1
  if (scan.spots.length < scan.keep) {
    scan.spots.push(spot)
  }
}

/** Scans `text` (hiddenText), keeping the first `keep` spots' text. */
const hiddenScan = (text: string, keep: i32): HiddenScan => {
  const scan = new HiddenScan(keep)
  const compiled = hiddenPatterns()
  const tables = compiled.isOk() ? compiled.value.tables : new HiddenTables()
  let line = 1
  let i = 0
  while (i < text.length) {
    const cp = charsCodePointAt(text, i)
    if (hiddenInvisibleIn(tables, cp) && !(i === 0 && cp === 0xfeff)) {
      hiddenNote(scan, `line ${line}: invisible character ${charsName(cp)}: remove it`)
    }
    if (cp === 10) {
      line = line + 1
    }
    i += charsSequenceLength(text, i)
  }
  if (compiled.isErr()) {
    hiddenNote(scan, `line 1: the words could not be read (${compiled.error}): nothing is trusted`)
    return scan
  }
  const p = compiled.value
  const m = new RegexMatch()
  let from = 0
  let at = 0
  line = 1
  while (from < text.length && p.word.exec(text, from, m)) {
    line = hiddenLineAt(text, at, m.start(), line)
    at = m.start()
    const word = text.substring(m.start(), m.end())
    const k = hiddenSpoofs(p, word)
    if (k !== null) {
      hiddenNote(scan, `line ${line}: "${word}" reads as ${k} but is not spelled in ASCII: write ${k}`)
    }
    from = m.end() > m.start() ? m.end() : m.start() + 1
  }
  return scan
}

/**
 * Why a text would read differently to a reviewer than to the gates, one
 * entry per spot: each invisible character, and each word that reads as a
 * binding keyword without being spelled in ASCII. A word is a run of letters,
 * digits and combining marks of any script (and of the circled and squared
 * letters), so a no-break space or a curly quote ends one. A byte-order mark at the very start is an encoding marker
 * and passes.
 *
 * @param text the source's text
 * @returns `line N: …` entries; empty when the text reads the same
 */
export const hiddenText = (text: string): string[] => hiddenScan(text, text.length + 1).spots

/**
 * The refusal of a source whose text hides what it says (hiddenText): its
 * first five spots, then a count of the rest.
 *
 * @param text the source's text
 * @param name the source's name, which starts the message
 * @returns the refusal, or null when the text reads the same to both
 */
export const hiddenProblem = (text: string, name: string): string | null => {
  const scan = hiddenScan(text, 5)
  if (scan.total === 0) {
    return null
  }
  const more = scan.total > 5 ? ` (and ${scan.total - 5} more)` : ""
  return `${name}: text a reader cannot see as the gates read it: ${scan.spots.join("; ")}${more}`
}
