import { regexCompile } from "nish/regex"
import { Suite } from "nish/testing"
import { replaceAll } from "nish/text"
import { charsFromCodePoint, charsName } from "../../../src/spec/contract/chars"
import { foldTable } from "../../../src/spec/source/fold"
import {
  hiddenAsciiLetterOf,
  hiddenDropBreaks,
  hiddenIsInvisible,
  hiddenProblem,
  hiddenText,
  hiddenWordClass,
} from "../../../src/spec/source/hidden"

/** A string of the given code points. */
const hiddenTestOf = (cps: i32[]): string => {
  const out: string[] = []
  for (const cp of cps) {
    out.push(charsFromCodePoint(cp))
  }
  return out.join("")
}

/** The one problem hiddenText reports, or a description of how many it reported. */
const hiddenTestOne = (text: string): string => {
  const p = hiddenText(text)
  return p.length === 1 ? p[0] : `${p.length} problems: ${p.join(" | ")}`
}

/** `text` with each `@` the code point `cp` and each `^` a U+0301 combining acute. */
const hiddenTestHint = (text: string, cp: i32): string => {
  const out: string[] = []
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    out.push(c === 0x40 ? charsFromCodePoint(cp) : c === 0x5e ? charsFromCodePoint(0x301) : text.substring(i, i + 1))
  }
  return out.join("")
}

/** What a source's text reads as once its break hints are dropped: the text, or what the scan refuses in it. */
const hiddenTestDrop = (text: string): string => {
  const dropped = hiddenDropBreaks(text)
  const p = hiddenText(dropped)
  return p.length === 0 ? `clean: ${dropped}` : p.join(" | ")
}

/**
 * hiddenDropBreaks's cases, for a hint `@`: a name, a text, and what
 * hiddenTestDrop makes of it once `@` is U+200B or U+2060 (`#` in the
 * expected text is that character's name).
 */
const hiddenTestDropCases = (): string[][] => [
  ["after a hyphen, as in RFC 9000", "0x0100-@0x01ff", "clean: 0x0100-0x01ff"],
  ["before a digit", "(@1)", "clean: (1)"],
  ["at a line's start", "a\n@MUST", "clean: a\nMUST"],
  ["at a line's end", "MUST@\nb", "clean: MUST\nb"],
  ["beside a space", "a @b c@ d", "clean: a b c d"],
  ["at the text's start and end", "@MUST@", "clean: MUST"],
  ["a run of hints beside a hyphen", "a-@@b", "clean: a-b"],
  ["beside a symbol of more than one byte", "a\u2192@b", "clean: a\u2192b"],
  ["no hint: the text as it is", "It MUST.", "clean: It MUST."],
  ["between two letters", "  it MU@ST", "line 1: invisible character #: remove it"],
  ["between two letters, line 3", "a\nb\nMU@ST", "line 3: invisible character #: remove it"],
  [
    "a run between two letters",
    "MU@@ST",
    "line 1: invisible character #: remove it | line 1: invisible character #: remove it",
  ],
  [
    "a mixed run between two letters",
    "MU\u200b\u2060ST@",
    "line 1: invisible character U+200B: remove it | line 1: invisible character U+2060: remove it",
  ],
  ["between a 4-byte letter and a letter", "\u{1d431}@x", "line 1: invisible character #: remove it"],
  ["between two digits", "0x01@00", "line 1: invisible character #: remove it"],
  ["between a letter and a digit", "a@1", "line 1: invisible character #: remove it"],
  ["between a non-ASCII letter and a letter", "\u00e9@x", "line 1: invisible character #: remove it"],
  ["next to a combining mark", "e^@x", "line 1: invisible character #: remove it"],
  ["beside U+200C, which stays", "-@\u200c0", "line 1: invisible character U+200C: remove it"],
  [
    "a look-alike beside a dropped hint",
    "-@MUS\u0422",
    'line 1: "MUS\u0422" reads as MUST but is not spelled in ASCII: write MUST',
  ],
]

/** The refusal of invisible characters and of keywords not spelled in ASCII. */
export const main = (): i32 => {
  const t = new Suite("spec/source hidden")

  t.ok("plain text passes", hiddenText("Implementations MUST NOT; it SHALL be REQUIRED.\nMust must.").length === 0)
  t.ok(
    "non-ASCII prose passes",
    hiddenText(`na${charsFromCodePoint(0xef)}ve caf${charsFromCodePoint(0xe9)} ${hiddenTestOf([0x41c, 0x438, 0x440])}`)
      .length === 0,
  )
  t.ok("a BOM at the start passes", hiddenText(`${charsFromCodePoint(0xfeff)}MUST`).length === 0)

  // Each invisible character, inside a keyword and on its own.
  const invisible: i32[] = [
    0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x00ad, 0x202e, 0x2066, 0xfe0f, 0xe0041, 0x180e, 0x3164,
  ]
  for (const cp of invisible) {
    const name = charsName(cp)
    t.ok(`${name} is invisible`, hiddenIsInvisible(cp))
    t.eqStr(
      `${name} inside MUST is refused`,
      hiddenTestOne(`  it MU${charsFromCodePoint(cp)}ST`),
      `line 1: invisible character ${name}: remove it`,
    )
  }
  t.eqStr(
    "a zero-width space between words, line 3",
    hiddenTestOne(`a\nb\nx ${charsFromCodePoint(0x200b)}y`),
    "line 3: invisible character U+200B: remove it",
  )
  t.eqStr(
    "a BOM after the start is refused",
    hiddenTestOne(`x${charsFromCodePoint(0xfeff)}`),
    "line 1: invisible character U+FEFF: remove it",
  )
  t.ok(
    "visible characters are not invisible",
    !hiddenIsInvisible(65) && !hiddenIsInvisible(0xa0) && !hiddenIsInvisible(0xe9),
  )

  // Each kind of look-alike keyword.
  const cyrillicT = `MUS${charsFromCodePoint(0x422)}`
  t.eqStr(
    "a Cyrillic look-alike",
    hiddenTestOne(`it ${cyrillicT} be`),
    `line 1: "${cyrillicT}" reads as MUST but is not spelled in ASCII: write MUST`,
  )
  const greek = hiddenTestOf([0x39c, 85, 83, 0x3a4])
  t.eqStr(
    "a Greek look-alike",
    hiddenTestOne(greek),
    `line 1: "${greek}" reads as MUST but is not spelled in ASCII: write MUST`,
  )
  const cherokee = hiddenTestOf([83, 0x13bb, 65, 0x13de, 76])
  t.eqStr(
    "a Cherokee look-alike",
    hiddenTestOne(cherokee),
    `line 1: "${cherokee}" reads as SHALL but is not spelled in ASCII: write SHALL`,
  )
  const bold = hiddenTestOf([0x1d40c, 0x1d414, 0x1d412, 0x1d413])
  t.eqStr(
    "math bold letters",
    hiddenTestOne(bold),
    `line 1: "${bold}" reads as MUST but is not spelled in ASCII: write MUST`,
  )
  const full = hiddenTestOf([0xff32, 0xff25, 0xff31, 0xff35, 0xff29, 0xff32, 0xff25, 0xff24])
  t.eqStr(
    "fullwidth letters",
    hiddenTestOne(full),
    `line 1: "${full}" reads as REQUIRED but is not spelled in ASCII: write REQUIRED`,
  )
  const marked = `MU${charsFromCodePoint(0x301)}ST`
  t.eqStr(
    "a combining mark",
    hiddenTestOne(marked),
    `line 1: "${marked}" reads as MUST but is not spelled in ASCII: write MUST`,
  )
  const swapped = `M${charsFromCodePoint(0x54d)}ST`
  t.eqStr(
    "an Armenian look-alike",
    hiddenTestOne(swapped),
    `line 1: "${swapped}" reads as MUST but is not spelled in ASCII: write MUST`,
  )
  const substitute = `M${charsFromCodePoint(0xdc)}ST`
  t.eqStr(
    "any non-ASCII letter standing in",
    hiddenTestOne(substitute),
    `line 1: "${substitute}" reads as MUST but is not spelled in ASCII: write MUST`,
  )
  t.ok("an ASCII word that is not a keyword passes", hiddenText(`MAST M${charsFromCodePoint(0xdc)}STER`).length === 0)
  t.eqStr("two problems, two entries", `${hiddenText(`${cyrillicT}\n${charsFromCodePoint(0x200b)}`).length}`, "2")

  // A word ends at a no-break space or a quote, so neither hides a spoof.
  t.eqStr(
    "a spoof after a no-break space",
    hiddenTestOne(`it${charsFromCodePoint(0xa0)}${cyrillicT} be`),
    `line 1: "${cyrillicT}" reads as MUST but is not spelled in ASCII: write MUST`,
  )
  t.eqStr(
    "a spoof inside curly quotes",
    hiddenTestOne(`${charsFromCodePoint(0x201c)}${cyrillicT}${charsFromCodePoint(0x201d)}`),
    `line 1: "${cyrillicT}" reads as MUST but is not spelled in ASCII: write MUST`,
  )
  t.eqStr(
    "a spoof on line 2, after a quote",
    hiddenTestOne(`a\n'${cyrillicT}'`),
    `line 2: "${cyrillicT}" reads as MUST but is not spelled in ASCII: write MUST`,
  )
  // Any combining mark, not only the common blocks.
  const titlo = `M${charsFromCodePoint(0x483)}UST`
  t.eqStr(
    "a Cyrillic combining titlo",
    hiddenTestOne(titlo),
    `line 1: "${titlo}" reads as MUST but is not spelled in ASCII: write MUST`,
  )
  const sign = `MUS${charsFromCodePoint(0x94d)}T`
  t.eqStr(
    "a Devanagari virama",
    hiddenTestOne(sign),
    `line 1: "${sign}" reads as MUST but is not spelled in ASCII: write MUST`,
  )
  // The cases of the earlier implementation.
  const spoofs: string[] = [
    hiddenTestOf([0x405, 72, 65, 76, 76]),
    hiddenTestOf([0xff2d, 85, 83, 84]),
    hiddenTestOf([77, 0xda, 83, 84]),
    hiddenTestOf([77, 0x54d, 83, 84]),
    hiddenTestOf([77, 85, 0xa4e2, 84]),
    hiddenTestOf([0xa4df, 0xa4f4, 0xa4e2, 0xa4d4]),
  ]
  for (const w of spoofs) {
    const k = w === spoofs[0] ? "SHALL" : "MUST"
    t.eqStr(`${w} is refused`, hiddenTestOne(w), `line 1: "${w}" reads as ${k} but is not spelled in ASCII: write ${k}`)
  }
  t.eqStr(
    "a zero-width space splitting MUST is one problem",
    hiddenTestOne(`M${charsFromCodePoint(0x200b)}UST`),
    "line 1: invisible character U+200B: remove it",
  )
  t.eqStr(
    "a grapheme joiner inside MUST is one problem",
    hiddenTestOne(`MU${charsFromCodePoint(0x34f)}ST`),
    "line 1: invisible character U+034F: remove it",
  )
  // Precomposed letters and compatibility forms fold as NFKD would.
  const folds: string[] = [
    hiddenTestOf([0x1e3e, 0xda, 0x15a, 0x164]),
    hiddenTestOf([0x1d3f, 0x1d31, 0xa7f4, 0x1d41, 0x1d35, 0x1d3f, 0x1d31, 0x1d30]),
    hiddenTestOf([0x15a, 0x1e24, 0xc0, 0x139, 0x13d]),
    hiddenTestOf([0x24c2, 0x24ca, 0x24c8, 0x24c9]),
    hiddenTestOf([0x1f13c, 0x1f144, 0x1f142, 0x1f143]),
    hiddenTestOf([0x1cce2, 0x1ccea, 0x1cce8, 0x1cce9]),
  ]
  const foldsTo: string[] = ["MUST", "REQUIRED", "SHALL", "MUST", "MUST", "MUST"]
  for (let j = 0; j < folds.length; j++) {
    const w = folds[j]
    const k = foldsTo[j]
    t.eqStr(
      `${w} folds to ${k}`,
      hiddenTestOne(`a ${w} b`),
      `line 1: "${w}" reads as ${k} but is not spelled in ASCII: write ${k}`,
    )
  }
  t.eqStr(
    "accented words that are not keywords still read",
    hiddenTestOne(
      `Caf${charsFromCodePoint(0xe9)} ${charsFromCodePoint(0xc9)}TAT ${hiddenTestOf([0x1e3f, 0xfa, 0x15b, 0x165])} ${hiddenTestOf([0x1d39, 0x1d2c, 0x1d3f])}`,
    ),
    "0 problems: ",
  )
  t.eqStr(
    "a symbol that is not a letter still ends a word",
    hiddenTestOne(`${charsFromCodePoint(0xa9)}${cyrillicT}`),
    `line 1: "${cyrillicT}" reads as MUST but is not spelled in ASCII: write MUST`,
  )
  const ordinary = `A caf${charsFromCodePoint(0xe9)}, ${charsFromCodePoint(0x394)}x, &#169;, ${hiddenTestOf([0x414, 0x41e, 0x41c, 0x410])}, S_HALL, x*y*z, M&#85;ST.`
  t.eqStr("ordinary text still reads", hiddenTestOne(ordinary), "0 problems: ")
  t.eqStr(
    "a non-ASCII word of the right length without a stand-in passes",
    hiddenTestOne(hiddenTestOf([77, 85, 0x2163, 84])),
    "0 problems: ",
  )

  // The RFCs the repository reads pass as they are.
  for (const f of ["rfcs/rfc4648.txt", "rfcs/rfc5869.txt", "rfcs/rfc8439.txt"]) {
    const text = readFileSyncOrNull(f)
    t.ok(`${f} is read`, text !== null)
    if (text !== null) {
      t.eqStr(`${f} hides nothing`, hiddenTestOne(text), "0 problems: ")
    }
  }

  // The refusal of a whole text.
  t.ok("nothing hidden, no problem", hiddenProblem("It MUST work.", "a.txt") === null)
  t.eqStr(
    "one spot",
    hiddenProblem(`It ${cyrillicT}.`, "a.txt") ?? "",
    `a.txt: text a reader cannot see as the gates read it: line 1: "${cyrillicT}" reads as MUST but is not spelled in ASCII: write MUST`,
  )
  const zw = charsFromCodePoint(0x200b)
  t.eqStr(
    "five spots, then a count",
    hiddenProblem(`${zw}\n${zw}\n${zw}\n${zw}\n${zw}\n${zw}\n${zw}`, "b.txt") ?? "",
    "b.txt: text a reader cannot see as the gates read it: line 1: invisible character U+200B: remove it; line 2: invisible character U+200B: remove it; line 3: invisible character U+200B: remove it; line 4: invisible character U+200B: remove it; line 5: invisible character U+200B: remove it (and 2 more)",
  )

  // The letters a code point reads as.
  t.ok("ASCII letters read as themselves", hiddenAsciiLetterOf(65) === 65 && hiddenAsciiLetterOf(122) === 122)
  t.ok("fullwidth", hiddenAsciiLetterOf(0xff21) === 65 && hiddenAsciiLetterOf(0xff5a) === 122)
  t.ok("math italic", hiddenAsciiLetterOf(0x1d434) === 65 && hiddenAsciiLetterOf(0x1d44e) === 97)
  t.ok("look-alikes", hiddenAsciiLetterOf(0x410) === 65 && hiddenAsciiLetterOf(0x216f) === 77)
  t.ok("precomposed and modifier letters", hiddenAsciiLetterOf(0xe9) === 101 && hiddenAsciiLetterOf(0x1d3f) === 82)
  t.ok("not a letter", hiddenAsciiLetterOf(48) === -1 && hiddenAsciiLetterOf(0x3b1) === -1)
  t.ok("outlined", hiddenAsciiLetterOf(0x1ccd6) === 65 && hiddenAsciiLetterOf(0x1ccef) === 90)

  // A word takes every code point the fold knows, so none is split off from one.
  const one = regexCompile(`^${hiddenWordClass()}$`, "")
  t.ok("the word class compiles", one.isOk())
  if (one.isOk()) {
    const f = foldTable()
    const outside: string[] = []
    for (let i = 0; i < f.length; i += 2) {
      if (!one.value.test(charsFromCodePoint(f[i]))) {
        outside.push(charsName(f[i]))
      }
    }
    t.eqStr("every folded code point is in a word", outside.join(" "), "")
  }

  // An RFC's break hints: dropped where they cannot change a word, kept and
  // refused where they can; nothing else is dropped.
  for (const cp of [0x200b, 0x2060]) {
    const name = charsName(cp)
    for (const c of hiddenTestDropCases()) {
      t.eqStr(`${name} ${c[0]}`, hiddenTestDrop(hiddenTestHint(c[1], cp)), replaceAll(c[2], "#", name))
    }
  }
  for (const cp of [0x200c, 0x200d, 0x00ad, 0x202e, 0xfeff]) {
    const name = charsName(cp)
    t.eqStr(
      `${name} after a hyphen is not dropped`,
      hiddenTestDrop(`0x0100-${charsFromCodePoint(cp)}0x01ff`),
      `line 1: invisible character ${name}: remove it`,
    )
  }
  return t.done()
}
