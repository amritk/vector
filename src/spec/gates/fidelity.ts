/**
 * `spec/gates/fidelity` — the contract says what its sources say. Every
 * requirement's and tolerance's quote is printed verbatim (whitespace
 * collapsed) as whole words in the section it cites. A section's text holds
 * its subsections', so a quote cited to §2 may be printed in §2.1; a quote
 * printed only in a sibling, or in the parent of the section cited, is not
 * found. Completeness, which reads each section's own text, still asks the
 * subsection for a quote of its own. Every value of a cited vector is
 * printed whole in its section, under the label the contract gives it, and
 * all of them as one test case: on one line, or from one round of repeated
 * labels, with the expected value not also an input. In a source read from
 * XML, a byte list such as `[00 0f f0 ff]` is a whole printed value, as
 * `hexEncode([00 0f f0 ff])` prints one; in plain text, `[10]` is a
 * reference. A u16[], u32[] or u64[] value is one whole block of words
 * the section prints (spec/gates/words), word for word as printed, `0x` and
 * all, and the expected value is not the block an input is. A value printed for one of several variants ("HMAC-SHA-256"
 * beside "HMAC-SHA-512") must be the one the called function names. An
 * expected null, true or false must be stated by a covered requirement
 * (gateStatesResult). A truncated vector's length is printed there too, as
 * a whole number then its unit (`128 bits`), outside a heading; its
 * expected value is still a whole printed value, the truncated output.
 */

import { jsonStringifyString } from "nish/json"
import { toHex, utf8Bytes } from "../../core/hex"
import { textAsciiLower } from "../../core/text"
import { CheckContext, CheckNote } from "../check"
import { charsTestVector } from "../contract/chars"
import { contractF64Bits, contractF64IsNaN, contractF64Parse } from "../contract/f64"
import {
  Clause,
  ClauseKind,
  Iterate,
  LitKind,
  Literal,
  Truncate,
  VectorSourceKind,
  typesIsWords,
} from "../contract/types"
import { SourceSet, sourceFind } from "../source/load"
import {
  HexValue,
  RfcSection,
  rfcCaseSection,
  rfcHasCases,
  rfcHexValues,
  rfcNormalize,
  rfcParse,
  rfcSectionText,
  rfcUnvaluedLabels,
  rfcUnvaluedLines,
  rfcWithHeading,
  rfcWithHeadings,
} from "../source/rfc"
import { gateArgsAt, gateCitedSection, gatePlace, gateQuoteMissing, gateSources } from "./cite"
import { gateIssue, gateWarn } from "./note"
import { gateResultWord, gateStatesResult } from "./result"
import {
  gateByteLists,
  gateF64Printed,
  gateIntLabelCount,
  gateIntLines,
  gateIntRounds,
  gateLines,
  gateQuotePairs,
  gateTextLines,
} from "./text"
import { GateWordBlock, gateWordBlocks } from "./words"

/** Where one literal of a vector was found: under a label, or on lines. */
class GateBound {
  /** The literal's path in the clause: `args[0]`, `expect`. */
  at: string
  /** The label it is printed under; null when it is text or unlabelled. */
  label: string | null
  /** How many times the label is printed with a value of its kind; 0 or 1 when it is not repeated. */
  of: i32
  /** Which of those printings (from 0) hold this value. */
  has: i32[]
  /** For text: the line numbers it is printed whole on; null otherwise. */
  lines: i32[] | null
  /** For text: the value. */
  text: string
  /** For words: the index of the block of words it is, or -1. */
  block: i32
  /**
   * The section line of each printing of its label, in order, for a hex or
   * empty value under a label; empty for numbers and text, whose places are
   * not read by line.
   */
  printed: i32[]
  /** For a labelled integer: its digits; "" otherwise. */
  num: string
  /** For a hex value under a label: the printed values it is, under that label as the RFC prints it. */
  held: HexValue[]
  /** Whether it is printed in the call label its vector's expected value is printed under (gateLabelArgs). */
  paired: boolean
  /** For an expected value: whether arguments are paired with it by its call label. */
  callArgs: boolean
  /** For a paired argument: the lines (of GateLits.lines) its call label is printed on. */
  call: i32[]
  /** Whether it was refused as printed in another test case's call label (gateLabelArgs), which says why. */
  other: boolean
  /** For a hex value or labelled integer: the section line of each printing that is it. */
  shown: i32[]
  constructor(at: string, label: string | null) {
    this.shown = []
    this.at = at
    this.label = label
    this.num = ""
    this.held = []
    this.paired = false
    this.callArgs = false
    this.call = []
    this.other = false
    this.of = 0
    this.has = []
    this.printed = []
    this.lines = null
    this.text = ""
    this.block = -1
  }
}

/** What checking one vector's literals against one section reads. */
class GateLits {
  /** The findings and warnings, copied into the context when the vector is done. */
  notes: CheckNote[]
  id: string
  where: string
  /** `RFC §2.2 ("Title")`. */
  inSection: string
  /** The section, read again only for an empty labelled value (gateEmptyCheck). */
  sec: RfcSection
  values: HexValue[]
  text: string
  lines: string
  /** The blocks of words the section prints (gateWordBlocks). */
  blocks: GateWordBlock[]
  bounds: GateBound[]
  /** Appended to a refusal that asks for one test case: how to name one of the section's, or "". */
  hint: string
  /** The section line of each case heading (rfcWithHeadings). */
  heads: i32[]
  /** The text of each case heading, parallel to heads. */
  headLines: string[]
  /** The case heading every value is printed under (gateHeadingCase), or -1. */
  chosen: i32
  /**
   * @param id the vector's id
   * @param where the section, for messages
   * @param sec the section
   * @param byteLists whether a bracketed byte list is a printed value: true for a source read from XML
   */
  constructor(id: string, where: string, sec: RfcSection, byteLists: boolean) {
    this.notes = []
    this.id = id
    this.where = where
    this.inSection = `${where} ("${sec.title}")`
    this.values = rfcHexValues(sec)
    this.sec = sec
    if (byteLists) {
      for (const line of sec.lines) {
        for (const hex of gateByteLists(line)) {
          this.values.push(new HexValue(hex, null))
        }
      }
    }
    this.text = rfcSectionText(sec)
    this.lines = gateLines(sec.lines)
    this.blocks = gateWordBlocks(sec.lines, sec.pageBreaks)
    this.bounds = []
    this.hint = ""
    this.heads = []
    this.headLines = []
    const lines = sec.lines
    for (const h of rfcWithHeadings(sec)) {
      // rfcWithHeadings gives line indices of sec, so this always holds; a
      // constructor has no finding to report, and heads stays parallel to headLines.
      if (h >= 0 && h < lines.length) {
        const line = lines[h]
        this.heads.push(h)
        this.headLines.push(line)
      }
    }
    this.chosen = -1
  }
}

const GATE_FIDELITY: string = "fidelity"

/** Whether two labels are the same, whitespace collapsed and case ignored. */
const gateSameLabel = (a: string, b: string): boolean =>
  textAsciiLower(rfcNormalize(a)) === textAsciiLower(rfcNormalize(b))

/** Labels as `"a" or "b"`, each once. */
const gateQuoted = (labels: string[]): string => {
  const seen: string[] = []
  for (const l of labels) {
    if (seen.indexOf(l) < 0) {
      seen.push(l)
    }
  }
  return seen.map((l: string): string => `"${l}"`).join(" or ")
}

/** 1st, 2nd, 3rd, 4th, 11th, 21st. */
const gateOrdinal = (n: i32): string => {
  const ten = n % 10
  const hundred = n % 100
  if (ten === 1 && hundred !== 11) {
    return `${n}st`
  }
  if (ten === 2 && hundred !== 12) {
    return `${n}nd`
  }
  return ten === 3 && hundred !== 13 ? `${n}rd` : `${n}th`
}

/**
 * `a + b` for two counts or offsets whose sum is itself a count or offset of
 * something the caller holds, so it fits an i32; the sum is taken wide so it
 * is not checked.
 */
const gateFidPlus = (a: i32, b: i32): i32 => toI32(toI64(a) + toI64(b))

/** Whether `hex` is byte-aligned inside `value`. */
const gateHexInside = (value: string, hex: string): boolean => {
  let at = toI32(value.indexOf(hex))
  while (at >= 0) {
    if (at % 2 === 0) {
      return true
    }
    // at is an offset of value, so at + 1 fits.
    at = toI32(value.indexOf(hex, gateFidPlus(at, 1)))
  }
  return false
}

/** A literal's bytes as lowercase hex: a hex literal's run repeated, an ascii literal's text. */
const gateLitHex = (lit: Literal): string => {
  if (lit.kind === LitKind.Ascii) {
    return toHex(utf8Bytes(lit.text))
  }
  const run = textAsciiLower(lit.text)
  const parts: string[] = []
  const n = lit.repeat >= 1 ? lit.repeat : 1
  for (let i = 0; i < n; i++) {
    parts.push(run)
  }
  return parts.join("")
}

/** A finding about one literal, at `${id}.${at}`. */
const gateLitFail = (l: GateLits, at: string, message: string): void => {
  gateNote(l, `${l.id}.${at}`, message, false)
}

/**
 * Refuses the vector when an invariant the gate's own reading keeps does not
 * hold (two lists that are parallel, an index into a list): a vector bug, so
 * the vector fails closed instead of being checked on a guess.
 */
const gateLitBroken = (l: GateLits, what: string): void => {
  gateNote(
    l,
    l.id,
    `the fidelity gate's reading of ${l.inSection} is inconsistent (${what}): refused, not checked`,
    false,
  )
}

/** A finding (or, with `warning`, a warning) about the vector, at `at`. */
const gateNote = (l: GateLits, at: string, message: string, warning: boolean): void => {
  l.notes.push(new CheckNote(GATE_FIDELITY, at, message, warning))
}

/** A bound with its round, when its label is printed more than once. */
const gateRounds = (l: GateLits, b: GateBound, of: i32, has: i32[]): void => {
  if (of > 1) {
    b.of = of
    b.has = has
  }
  l.bounds.push(b)
}

/** A hex value: printed whole in the section, under the label the literal names. */
const gateHexCheck = (l: GateLits, at: string, hex: string, label: string | null): void => {
  const whole = l.values.filter((v: HexValue): boolean => v.hex === hex)
  if (whole.length === 0) {
    for (const v of l.values) {
      if (gateHexInside(v.hex, hex)) {
        const vl = v.label
        const under = vl !== null ? ` (under "${vl}")` : ""
        gateLitFail(
          l,
          at,
          `the ${hex.length / 2}-byte ${at} is only part of a value printed in ${l.inSection}${under}: a vector uses whole printed values (concat them to join several)`,
        )
        return
      }
    }
    gateLitFail(l, at, `the ${hex.length / 2}-byte ${at} is not printed in ${l.inSection}`)
    return
  }
  const named: string[] = []
  for (const v of whole) {
    const vl = v.label
    if (vl !== null) {
      named.push(vl)
    }
  }
  if (label === null) {
    if (named.length === 0) {
      const u = new GateBound(at, null)
      for (const v of whole) {
        u.shown.push(v.line)
      }
      l.bounds.push(u)
    } else {
      gateLitFail(
        l,
        at,
        `the value is printed in ${l.inSection} under ${gateQuoted(named)}: name it with "label", so the contract says which printed value it is`,
      )
    }
    return
  }
  if (!named.some((n: string): boolean => gateSameLabel(n, label))) {
    gateLitFail(
      l,
      at,
      named.length > 0
        ? `the value is printed in ${l.inSection} under ${gateQuoted(named)}, not under "${label}"`
        : `the value is printed in ${l.inSection}, but not under the label "${label}"`,
    )
    return
  }
  let of = 0
  const has: i32[] = []
  const b = new GateBound(at, label)
  for (const v of l.values) {
    const vl = v.label
    if (vl !== null && gateSameLabel(vl, label)) {
      if (v.hex === hex) {
        has.push(of)
        b.held.push(v)
        b.shown.push(v.line)
      }
      b.printed.push(v.line)
      // of counts values, so it fits.
      of = gateFidPlus(of, 1)
    }
  }
  gateRounds(l, b, of, has)
}

/** A word without its `0x`. */
const gateWordBare = (w: string): string => (w.startsWith("0x") ? w.substring(2, w.length) : w)

/** Whether `want` is `words` from `from` on, as printed or, with `bare`, ignoring `0x`. */
const gateWordsAt = (words: string[], want: string[], from: i32, bare: boolean): boolean => {
  if (!(from >= 0 && from <= words.length && want.length <= words.length - from)) {
    return false
  }
  for (let i = 0; i < want.length; i++) {
    // from + i is under from + want.length, at most words.length.
    const w = gateFidPlus(from, i)
    if (!(w >= 0 && w < words.length)) {
      return false
    }
    const a = words[w]
    const b = want[i]
    if (bare ? gateWordBare(a) !== gateWordBare(b) : a !== b) {
      return false
    }
  }
  return true
}

/** Whether `want` is a run of `words` shorter than all of them, ignoring `0x`. */
const gateWordsInside = (words: string[], want: string[]): boolean => {
  if (want.length >= words.length) {
    return false
  }
  for (let i = 0; i < words.length; i++) {
    if (want.length <= words.length - i && gateWordsAt(words, want, i, true)) {
      return true
    }
  }
  return false
}

/**
 * Whether `want` runs across a page break between blocks that break may
 * join (GateWordBlock.joinsNext), ignoring `0x`: the words on either side
 * may be one block or two, so the print does not say whether it is a block.
 */
const gateWordsAcross = (blocks: GateWordBlock[], want: string[]): boolean => {
  let b = 0
  while (b >= 0 && b < blocks.length) {
    const words: string[] = []
    const joins: i32[] = []
    let e = b
    let block = blocks[b]
    for (const w of block.words) {
      words.push(w)
    }
    while (block.joinsNext && e >= 0 && e < blocks.length - 1) {
      joins.push(words.length)
      const next = gateFidPlus(e, 1)
      if (!(next >= 0 && next < blocks.length)) {
        break
      }
      block = blocks[next]
      e = next
      for (const w of block.words) {
        words.push(w)
      }
    }
    for (let i = 0; i < words.length && want.length <= words.length - i; i++) {
      let crosses = false
      for (const j of joins) {
        // i is at most words.length - want.length, so the sum fits.
        if (i < j && gateFidPlus(i, want.length) > j) {
          crosses = true
        }
      }
      if (crosses && gateWordsAt(words, want, i, true)) {
        return true
      }
    }
    // e is under blocks.length, so e + 1 fits.
    b = gateFidPlus(e, 1)
  }
  return false
}

/** The refusal of a word value that meets a page break the print does not say a block ends at. */
const gateWordsBreakFail = (l: GateLits, at: string, n: i32): void => {
  gateLitFail(
    l,
    at,
    `${n}-word value meets a page break in ${l.inSection}, and the rows on either side of it may be one block or two: the print does not say which, so the value cannot be checked against it`,
  )
}

/** ` (under "label")` for a block printed under a label, or "". */
const gateWordsUnder = (b: GateWordBlock): string => {
  const bl = b.label
  return bl !== null ? ` (under "${bl}")` : ""
}

/**
 * A word-array value: one whole block of words the section prints, word for
 * word as printed, under the label the literal names. An unlabelled value
 * binds to the block it is.
 */
const gateWordsCheck = (l: GateLits, lit: Literal, at: string): void => {
  const want = lit.words
  const n = want.length
  const exact: i32[] = []
  let broken = false
  for (let b = 0; b < l.blocks.length; b++) {
    const words = l.blocks[b].words
    if (words.length === n && gateWordsAt(words, want, 0, false)) {
      if (l.blocks[b].atBreak) {
        broken = true
      } else {
        exact.push(b)
      }
    }
  }
  if (exact.length === 0 && broken) {
    gateWordsBreakFail(l, at, n)
    return
  }
  if (exact.length === 0) {
    if (gateWordsAcross(l.blocks, want)) {
      gateWordsBreakFail(l, at, n)
      return
    }
    const prefixed = want.length > 0 && want[0].startsWith("0x")
    for (const b of l.blocks) {
      if (b.words.length === n && gateWordsAt(b.words, want, 0, true)) {
        gateLitFail(
          l,
          at,
          `the ${n} words are printed in ${l.inSection}${gateWordsUnder(b)} ${prefixed ? "without" : "with"} 0x: write each word as printed`,
        )
        return
      }
    }
    for (const b of l.blocks) {
      if (gateWordsInside(b.words, want)) {
        gateLitFail(
          l,
          at,
          `${n}-word value is only part of a ${b.words.length}-word block printed in ${l.inSection}${gateWordsUnder(b)}: a vector uses a whole printed block`,
        )
        return
      }
    }
    gateLitFail(l, at, `${n}-word value is not printed as one block in ${l.inSection}`)
    return
  }
  const label = lit.label
  if (label === null) {
    if (exact.length > 0) {
      const b = new GateBound(at, null)
      b.block = exact[0]
      l.bounds.push(b)
    }
    return
  }
  const named: string[] = []
  let block = -1
  const blocks = l.blocks
  for (const e of exact) {
    if (!(e >= 0 && e < blocks.length)) {
      gateLitBroken(l, `block ${e} of ${blocks.length}`)
      return
    }
    const bl = blocks[e].label
    if (bl !== null) {
      named.push(bl)
      if (block < 0 && gateSameLabel(bl, label)) {
        block = e
      }
    }
  }
  if (block < 0) {
    gateLitFail(
      l,
      at,
      named.length > 0
        ? `the value is printed in ${l.inSection} under ${gateQuoted(named)}, not under "${label}"`
        : `the value is printed in ${l.inSection}, but not under the label "${label}"`,
    )
    return
  }
  let of = 0
  const has: i32[] = []
  for (let b = 0; b < l.blocks.length; b++) {
    const bl = l.blocks[b].label
    if (bl !== null && gateSameLabel(bl, label)) {
      if (exact.indexOf(b) >= 0) {
        has.push(of)
      }
      // of counts blocks, so it fits.
      of = gateFidPlus(of, 1)
    }
  }
  const bound = new GateBound(at, label)
  bound.block = block
  gateRounds(l, bound, of, has)
}

/** A text value printed whole on some lines of the section; false when it is not. */
const gateTextBound = (l: GateLits, at: string, value: string): boolean => {
  const shown = gateTextLines(l.lines, value)
  if (shown.length === 0) {
    return false
  }
  const b = new GateBound(at, null)
  b.lines = shown
  b.text = value
  l.bounds.push(b)
  return true
}

/** A labelled number's check: `want` says whether a printed value is the literal's. */
const gateNumberCheck = (l: GateLits, lit: Literal, at: string, has: i32[], of: i32): void => {
  const label = lit.label
  if (label === null) {
    return
  }
  if (has.length === 0) {
    gateLitFail(l, at, `${l.where} does not print "${label}" followed by ${lit.text}`)
    return
  }
  const b = new GateBound(at, label)
  if (lit.kind === LitKind.Int) {
    b.num = lit.text
    b.shown = gateIntLines(l.lines, label, lit.text).map((k: i32): i32 => gateSecLine(l, k))
  }
  gateRounds(l, b, of, has)
}

/** The printings of an f64 under its label that read as the literal's binary64 (any NaN for a NaN). */
const gateF64Has = (lit: Literal, printed: string[]): i32[] => {
  const bits = lit.bits
  const want = bits !== null ? bits : contractF64Bits(contractF64Parse(lit.text))
  const nan = contractF64IsNaN(contractF64Parse(lit.text))
  const has: i32[] = []
  for (let i = 0; i < printed.length; i++) {
    const x = contractF64Parse(printed[i])
    if (nan ? contractF64IsNaN(x) : contractF64Bits(x) === want) {
      has.push(i)
    }
  }
  return has
}

/** Whether a label states a length of zero: `0` before `byte`, `bytes`, `octet` or `octets` (`MESSAGE (length 0 bytes)`). */
const gateZeroLength = (label: string): boolean => {
  const ts = gateFidTokens(label)
  for (let i = 0; i < ts.length - 1; i++) {
    if (ts[i] === "0" && gateFidLengthWord(ts[i + 1])) {
      return true
    }
  }
  return false
}

/**
 * An empty value under a label: the label is printed with nothing below it
 * (`MESSAGE (length 0 bytes):`), and states a length of zero.
 */
const gateEmptyCheck = (l: GateLits, at: string, label: string): void => {
  const under = l.values.filter((v: HexValue): boolean => {
    const vl = v.label
    return vl !== null && gateSameLabel(vl, label)
  })
  if (under.length > 0) {
    gateLitFail(
      l,
      at,
      `"${label}" is printed with a ${under[0].hex.length / 2}-byte value in ${l.inSection}, so the value is not empty`,
    )
    return
  }
  const names = rfcUnvaluedLabels(l.sec)
  const lines = rfcUnvaluedLines(l.sec)
  if (names.length !== lines.length) {
    gateLitBroken(l, `${names.length} unvalued labels on ${lines.length} lines`)
    return
  }
  const b = new GateBound(at, label)
  // The two lists are parallel (checked above): one line per label.
  for (let i = 0; i < names.length && i < lines.length; i++) {
    const line = lines[i]
    if (gateSameLabel(names[i], label)) {
      b.printed.push(line)
    }
  }
  const of = b.printed.length
  if (of === 0) {
    gateLitFail(l, at, `the empty value is not printed in ${l.inSection} under "${label}" with nothing below it`)
    return
  }
  if (!gateZeroLength(label)) {
    gateLitFail(
      l,
      at,
      `"${label}" is printed with nothing below it in ${l.inSection}, but does not state a length of 0 bytes, so nothing says the value is empty`,
    )
    return
  }
  const has: i32[] = []
  for (let i = 0; i < of; i++) {
    has.push(i)
  }
  gateRounds(l, b, of, has)
}

/** Checks one literal (and a concat's parts) against the section, adding its bounds. */
const gateLitCheck = (l: GateLits, lit: Literal, at: string): void => {
  if (lit.kind === LitKind.Concat) {
    for (let i = 0; i < lit.parts.length; i++) {
      gateLitCheck(l, lit.parts[i], `${at}.concat[${i}]`)
    }
    return
  }
  const why = lit.unchecked
  if (why !== null) {
    gateNote(l, `${l.id}.${at}`, `not checked against the RFC: ${why}`, true)
    return
  }
  const bytes = lit.kind === LitKind.Hex || lit.kind === LitKind.Ascii
  const named = lit.label
  if (bytes && lit.text.length === 0 && named !== null) {
    gateEmptyCheck(l, at, named)
    return
  }
  if ((bytes || lit.kind === LitKind.Str) && lit.text.length === 0) {
    // "" is in every text and no bytes in every value, so an empty value is
    // found only where the section prints one.
    if (l.text.indexOf('""') < 0 && l.text.indexOf("(0 octets)") < 0) {
      gateLitFail(l, at, `the empty value is not printed in ${l.inSection}: it needs "" or "(0 octets)" there`)
    }
    return
  }
  if (bytes) {
    // Whitespace alone normalizes to "", which every text holds: such a value
    // is matched only as hex.
    const shown = rfcNormalize(lit.text)
    if (lit.kind === LitKind.Ascii && shown.length > 0 && gateTextBound(l, at, shown)) {
      return
    }
    gateHexCheck(l, at, gateLitHex(lit), lit.label)
    return
  }
  if (lit.kind === LitKind.Str) {
    const s = lit.text
    const json = jsonStringifyString(s)
    if (s !== rfcNormalize(s)) {
      gateLitFail(
        l,
        at,
        `the string ${json} has leading, trailing or repeated whitespace, so it cannot be matched against the RFC text`,
      )
    } else if (!gateTextBound(l, at, s)) {
      gateLitFail(
        l,
        at,
        l.text.indexOf(s) >= 0
          ? `the string ${json} is only part of a longer value in ${l.inSection}: it must be printed whole (in quotes, on a line of its own, or ending a line after "=" or ":")`
          : `the string ${json} is not printed in ${l.inSection}`,
      )
    }
    return
  }
  if (typesIsWords(lit.kind)) {
    gateWordsCheck(l, lit, at)
    return
  }
  if (lit.kind !== LitKind.Int && lit.kind !== LitKind.F64) {
    return
  }
  const label = lit.label
  const name = lit.kind === LitKind.Int ? "integer" : "f64"
  if (label === null) {
    gateNote(
      l,
      `${l.id}.${at}`,
      `not checked against the RFC: the ${name} ${lit.text} has no "label" to find it by`,
      true,
    )
  } else if (lit.kind === LitKind.Int) {
    gateNumberCheck(l, lit, at, gateIntRounds(l.lines, label, lit.text), gateIntLabelCount(l.lines, label))
  } else {
    const printed = gateF64Printed(l.lines, label)
    gateNumberCheck(l, lit, at, gateF64Has(lit, printed), printed.length)
  }
}

/** A bound's text, for a message: `args[0] "abc"`. */
const gateBoundText = (b: GateBound): string => `${b.at} ${jsonStringifyString(b.text)}`

/** A repeated bound, for a message: `args[0] (one of 7 "IKM")`. */
const gateBoundRound = (b: GateBound): string => {
  const label = b.label
  return `${b.at} (one of ${b.of} "${label !== null ? label : ""}")`
}

/** A repeated bound's printings, for a message: `1st or 3rd`. */
const gateNth = (has: i32[]): string => has.map((r: i32): string => gateOrdinal(gateFidPlus(r, 1))).join(" or ")

/** Whether an argument's string or integer is printed inside a call label: `"salt"` or `c=1` in `PBKDF2 (P="passwd", S="salt", c=1)`. */
const gateInLabel = (b: GateBound, label: string): boolean => {
  if (label.indexOf("(") < 0) {
    return false
  }
  const name = b.label
  if (b.lines !== null) {
    return gateTextLines(rfcNormalize(label), b.text).length > 0
  }
  return name !== null && gateIntRounds(rfcNormalize(label), name, b.num).length > 0
}

/**
 * The lines (of GateLits.lines, which holds no blank line) a printed value's
 * label is printed on: from the line that names it to the line its call label
 * closes on, which rfcHexRead joined (at most RFC_CALL_LINES).
 */
const gateLabelLines = (l: GateLits, v: HexValue): i32[] => {
  const out: i32[] = []
  let k = 0
  for (let i = 0; i <= v.end && i < l.sec.lines.length; i++) {
    if (rfcNormalize(l.sec.lines[i]).length === 0) {
      continue
    }
    if (i >= v.line) {
      out.push(k)
    }
    // k counts lines of the section, so it stays below its length.
    k = gateFidPlus(k, 1)
  }
  return out
}

/** A text or paired bound's lines: a paired one's call label's only, else where it is printed whole. */
const gateBoundPlaces = (b: GateBound): i32[] => {
  const lines = b.lines
  return b.paired ? b.call : lines !== null ? lines : []
}

/** An argument, for a message: `args[0] "salt"`, `args[2] c=1`. */
const gateArgText = (b: GateBound): string => {
  const name = b.label
  return b.lines !== null ? gateBoundText(b) : `${b.at} ${name !== null ? name : ""}=${b.num}`
}

/**
 * The strings and integers a vector's expected value prints in its own call
 * label (`PBKDF2-HMAC-SHA-256 (P="passwd", S="salt", c=1, dkLen=64)`) are one
 * test case with it, so they are paired and not placed by line or round. One
 * printed in another call label of the section, and not in this one, is from
 * another test case and refused.
 */
const gateLabelArgs = (l: GateLits, args: i32): void => {
  // Every bound past the args is the expected value's.
  const bounds = l.bounds
  if (args < 0 || args > bounds.length) {
    gateLitBroken(l, `${args} arguments of ${bounds.length} bounds`)
    return
  }
  const last = bounds.length - 1
  // No expected value is bound; with one, last is an index (args checked above).
  if (last < args || !(last >= 0 && last < bounds.length)) {
    return
  }
  const e = bounds[last]
  const label = e.label
  if (label === null) {
    return
  }
  // Only a hex value is bound to printings; any other names its label.
  const under: string[] = e.held.length === 0 ? [rfcNormalize(label)] : []
  for (const v of e.held) {
    const vl = v.label
    if (vl !== null) {
      under.push(rfcNormalize(vl))
    }
  }
  // args <= bounds.length (checked above).
  for (let a = 0; a < args && a < bounds.length; a++) {
    const b = bounds[a]
    // Paired only by the label the RFC prints over the value, and placed on
    // that printing's lines: the contract's label is bound to it ignoring case.
    for (const v of e.held) {
      const vl = v.label
      if (vl !== null && gateInLabel(b, vl)) {
        b.paired = true
        e.callArgs = true
        for (const n of gateLabelLines(l, v)) {
          b.call.push(n)
        }
      }
    }
    if (b.paired) {
      continue
    }
    for (const v of l.values) {
      const vl = v.label
      if (vl !== null && gateInLabel(b, vl)) {
        gateNote(
          l,
          `${l.id}.${b.at}`,
          `${gateArgText(b)} is printed in the call label "${rfcNormalize(vl)}" in ${l.inSection}, not in ${gateQuoted(under)} that the expected value is printed under: they are different test cases`,
          false,
        )
        b.other = true
        break
      }
    }
  }
}

/** The index in the section's lines of line `k` of GateLits.lines, which holds no blank line; -1 past its end. */
const gateSecLine = (l: GateLits, k: i32): i32 => {
  let n = 0
  for (let i = 0; i < l.sec.lines.length; i++) {
    if (rfcNormalize(l.sec.lines[i]).length > 0) {
      if (n === k) {
        return i
      }
      // n counts lines of the section, so it stays below its length.
      n = gateFidPlus(n, 1)
    }
  }
  return -1
}

/**
 * The section lines a bound is printed on, for placing it under a case
 * heading: a text's lines (a paired one's call label's), a hex value's or labelled
 * integer's printings that are it, an empty value's printings; null when it
 * is not placed by line (a decimal fraction, a block of words).
 */
const gateBoundSecLines = (l: GateLits, b: GateBound): i32[] | null => {
  if (b.lines !== null) {
    return gateBoundPlaces(b).map((k: i32): i32 => gateSecLine(l, k))
  }
  if (b.shown.length > 0) {
    return b.shown
  }
  return b.printed.length > 0 ? b.printed : null
}

/**
 * The case headings (indices into GateLits.heads) a bound is printed under:
 * every one when it is printed above the first, which holds for every case.
 */
const gateBoundCases = (l: GateLits, places: i32[]): i32[] => {
  const out: i32[] = []
  for (const p of places) {
    let c = -1
    for (let h = 0; h < l.heads.length; h++) {
      if (l.heads[h] <= p) {
        c = h
      }
    }
    if (c < 0) {
      const all: i32[] = []
      for (let h = 0; h < l.heads.length; h++) {
        all.push(h)
      }
      return all
    }
    if (out.indexOf(c) < 0) {
      out.push(c)
    }
  }
  return out
}

/** A case heading, for a message: `"With SHA-256, message = "sample":"`. */
const gateHeadingText = (line: string): string => `"${rfcNormalize(line)}"`

/**
 * In a section split into cases by headings of RFC 6979 §A.2's form
 * (rfcWithHeadings), the values are placed by line: each is under the
 * heading above it, a string on a heading is that case's, and a value
 * printed above the first heading is every case's. One heading must hold
 * every value, and a value not placed by line is refused: nothing says
 * which case it is.
 */
const gateHeadingCase = (l: GateLits, inSection: string): void => {
  const placed: GateBound[] = []
  const cases: i32[][] = []
  const lost: string[] = []
  for (const b of l.bounds) {
    const at = gateBoundSecLines(l, b)
    if (at === null) {
      lost.push(b.at)
      continue
    }
    placed.push(b)
    cases.push(gateBoundCases(l, at))
  }
  if (lost.length > 0) {
    gateNote(
      l,
      l.id,
      `${lost.join(", ")} in ${inSection} is not placed by its line, so nothing says which case heading it is under: cite values printed on their own lines`,
      false,
    )
    return
  }
  if (placed.length !== cases.length || l.heads.length !== l.headLines.length) {
    gateLitBroken(
      l,
      `${cases.length} cases for ${placed.length} values, ${l.headLines.length} lines for ${l.heads.length} headings`,
    )
    return
  }
  const shared: i32[] = []
  for (let h = 0; h < l.heads.length; h++) {
    const hNow = h
    if (cases.every((c: i32[]): boolean => c.indexOf(hNow) >= 0)) {
      shared.push(h)
    }
  }
  if (shared.length === 0) {
    const each: string[] = []
    // cases is parallel to placed, and headLines to heads (checked above);
    // gateBoundCases gives indices into heads.
    for (let i = 0; i < placed.length && i < cases.length; i++) {
      const at = placed[i].at
      const under = cases[i]
      if (under.length < l.heads.length) {
        const heads: string[] = []
        const headLines = l.headLines
        for (const h of under) {
          if (!(h >= 0 && h < headLines.length)) {
            gateLitBroken(l, `heading ${h} of ${headLines.length}`)
            return
          }
          heads.push(gateHeadingText(headLines[h]))
        }
        each.push(`${at} is under ${heads.join(" or ")}`)
      }
    }
    gateNote(
      l,
      l.id,
      `${each.join(", ")} in ${inSection}, so they are from different test cases: use the values printed under one case heading`,
      false,
    )
  } else if (shared.length === 1) {
    l.chosen = shared[0]
  }
}

/** Whether every bound is printed the same number of times. */
const gateSameRounds = (bs: GateBound[]): boolean => {
  if (bs.length < 1) {
    return true
  }
  const of = bs[0].of
  return bs.every((b: GateBound): boolean => b.of === of)
}

/**
 * A cited vector's values are one test case: text printed on one shared line,
 * repeated labels from one round, and the expected value not an input's.
 */
const gateOneTestCase = (l: GateLits, args: i32, sec: RfcSection): void => {
  if (args < 0 || args > l.bounds.length) {
    gateLitBroken(l, `${args} arguments of ${l.bounds.length} bounds`)
    return
  }
  const id = l.id
  const inSection = `${l.where} ("${sec.title}")`
  // A paired argument is placed by its call label's lines, so it is still
  // one test case with every other argument, not exempt from the checks.
  // One refused as another case's is not placed again: its refusal says why.
  const texts = l.bounds.filter((b: GateBound): boolean => (b.lines !== null || b.paired) && !b.other)
  if (texts.length > 1) {
    let shared = false
    for (const line of gateBoundPlaces(texts[0])) {
      if (texts.every((b: GateBound): boolean => gateBoundHasLine(b, line))) {
        shared = true
      }
    }
    if (!shared) {
      gateNote(
        l,
        id,
        `${texts.map(gateArgText).join(", ")} are each printed in ${inSection}, but never on one line together, so nothing pairs them as one test case`,
        false,
      )
    }
  }
  // An expected value its arguments pair with is placed by its printing's
  // label, as they are, not by its round.
  const repeated = l.bounds.filter((b: GateBound): boolean => b.of > 1 && !b.paired && !b.other && !b.callArgs)
  if (l.heads.length > 0) {
    // Placed under the case headings, by line.
    gateHeadingCase(l, inSection)
  } else if (texts.length > 0 && repeated.length > 0) {
    // A string is placed by its line and a labelled value by its round;
    // nothing relates the two.
    gateNote(
      l,
      id,
      `${texts.map(gateArgText).join(", ")} and ${repeated.map(gateBoundRound).join(", ")} in ${inSection}: nothing pairs a printed string with one of several labelled values: cite the subsection that holds one test case`,
      false,
    )
  } else if (repeated.length > 1 && !gateSameRounds(repeated)) {
    // Rounds pair only when every label is printed once per test case.
    const counts = repeated.map((b: GateBound): string => `"${gateBoundLabel(b)}" is printed ${b.of} times`)
    gateNote(
      l,
      id,
      `${counts.join(", ")} in ${inSection}, so which printings belong to one test case is unclear: cite the subsection that holds one test case${l.hint}`,
      false,
    )
  } else if (repeated.length > 0) {
    const shared: i32[] = []
    for (const r of repeated[0].has) {
      if (repeated.every((b: GateBound): boolean => b.has.indexOf(r) >= 0)) {
        shared.push(r)
      }
    }
    if (shared.length > 0) {
      gateOnceRound(l, repeated, shared, inSection)
    } else {
      const each = repeated.map(
        (b: GateBound): string => `${b.at} is the ${gateNth(b.has)} of ${b.of} "${gateBoundLabel(b)}"`,
      )
      gateNote(
        l,
        id,
        `${each.join(", ")} in ${inSection}, so they are from different test cases: use the values printed together (or cite the subsection that holds one test case)`,
        false,
      )
    }
  }
  // 0 <= args <= bounds.length (checked above), so each bound is reached.
  const bounds = l.bounds
  for (let e = args; e >= 0 && e < bounds.length; e++) {
    const be = bounds[e]
    const block = be.block
    if (block >= 0) {
      for (let a = 0; a < args && a < bounds.length; a++) {
        const ba = bounds[a]
        if (ba.block === block) {
          gateNote(
            l,
            `${id}.${be.at}`,
            `the expected value is the block of words ${ba.at} is bound to as well: an input is not the expected result`,
            false,
          )
          break
        }
      }
      continue
    }
    const label = be.label
    if (label === null) {
      continue
    }
    for (let a = 0; a < args && a < bounds.length; a++) {
      const ba = bounds[a]
      const al = ba.label
      if (al !== null && gateSameLabel(al, label)) {
        gateNote(
          l,
          `${id}.${be.at}`,
          `the expected value is the one printed under "${label}", which ${ba.at} is bound to as well: an input is not the expected result`,
          false,
        )
        break
      }
    }
  }
}

/**
 * A label printed once is tied to the round its line falls in: after the last
 * printing of the round before, and before the first printing of the round
 * after, of the repeated labels. RFC 8032 §7.1 prints `MESSAGE (length 0
 * bytes)` once, in TEST 1, so TEST 2's SECRET KEY and SIGNATURE with it are
 * refused. Numbers and text are not placed by line, so they are not tied.
 */
const gateOnceRound = (l: GateLits, repeated: GateBound[], shared: i32[], inSection: string): void => {
  if (repeated.length < 1) {
    return
  }
  const first = repeated[0]
  const rounds = first.of
  if (repeated.some((b: GateBound): boolean => b.printed.length !== rounds)) {
    // Repeated labels printed a different number of times have no rounds to
    // place a once-printed label in: none is tied (fidelity_test's RFC 4231 §4 rows).
    return
  }
  const start: i32[] = []
  const end: i32[] = []
  const firstPrinted = first.printed
  for (let r = 0; r < rounds && r < firstPrinted.length; r++) {
    let lo = firstPrinted[r]
    let hi = lo
    for (const b of repeated) {
      // Every bound is printed `rounds` times (checked above).
      const printed = b.printed
      if (r < printed.length) {
        lo = Math.min(lo, printed[r])
        hi = Math.max(hi, printed[r])
      }
    }
    start.push(lo)
    end.push(hi)
  }
  for (const b of l.bounds) {
    if (b.of > 1 || b.printed.length !== 1) {
      continue
    }
    const p = b.printed[0]
    const near: i32[] = []
    for (let r = 0; r < rounds; r++) {
      // start and end hold one entry per round.
      const afterLast = r <= 0 || (r <= end.length && end[r - 1] < p)
      const beforeNext = r + 1 >= rounds || (r < start.length - 1 && p < start[r + 1])
      if (afterLast && beforeNext) {
        near.push(r)
      }
    }
    if (near.length === 0 || near.some((r: i32): boolean => shared.indexOf(r) >= 0)) {
      continue
    }
    const each = repeated.map(
      (o: GateBound): string => `${o.at} is the ${gateNth(o.has)} of ${o.of} "${gateBoundLabel(o)}"`,
    )
    gateNote(
      l,
      `${l.id}.${b.at}`,
      `"${gateBoundLabel(b)}" is printed once in ${inSection}, with the ${gateNth(near)} of ${rounds} "${gateBoundLabel(first)}", but ${each.join(", ")}, so they are from different test cases: use the values printed together`,
      false,
    )
  }
}

/** Whether a text bound is printed on `line`, or a paired one's call label is: gateBoundPlaces. */
const gateBoundHasLine = (b: GateBound, line: i32): boolean => {
  return gateBoundPlaces(b).indexOf(line) >= 0
}

/** A bound's label, or "". */
const gateBoundLabel = (b: GateBound): string => {
  const label = b.label
  return label !== null ? label : ""
}

/** The runs of digits in a label, whitespace collapsed. */
const gateDigitRuns = (s: string): string[] => {
  const t = rfcNormalize(s)
  const out: string[] = []
  let i = 0
  while (i >= 0 && i < t.length) {
    const c = t.charCodeAt(i)
    if (c < 48 || c > 57) {
      i = i + 1
      continue
    }
    let j = i
    while (j < t.length && t.charCodeAt(j) >= 48 && t.charCodeAt(j) <= 57) {
      j = j + 1
    }
    out.push(t.substring(i, j))
    i = j
  }
  return out
}

/** A label with every run of digits as "#", lowercase: what variants of it share. */
const gateSkeleton = (s: string): string => {
  const t = textAsciiLower(rfcNormalize(s))
  const parts: string[] = []
  let i = 0
  while (i < t.length) {
    const c = t.charCodeAt(i)
    if (c >= 48 && c <= 57) {
      while (i < t.length && t.charCodeAt(i) >= 48 && t.charCodeAt(i) <= 57) {
        i = i + 1
      }
      parts.push("#")
    } else {
      parts.push(t.substring(i, i + 1))
      i = i + 1
    }
  }
  return parts.join("")
}

/** Whether the numbers at position `i` of the labels run consecutively (Input1, Input2: test cases, not variants). */
const gateCounts = (labels: string[], i: i32): boolean => {
  const ns: f64[] = []
  for (const l of labels) {
    const d = gateDigitRuns(l)
    if (!(i >= 0 && i < d.length)) {
      return false
    }
    const n = parseFloat(d[i])
    if (ns.indexOf(n) < 0) {
      ns.push(n)
    }
  }
  // The first number starts both ends; with none, hi - lo + 1 is 1, never 0.
  let lo = toF64(0)
  let hi = toF64(0)
  for (let j = 0; j < ns.length; j++) {
    const n = ns[j]
    lo = j === 0 || n < lo ? n : lo
    hi = j === 0 || n > hi ? n : hi
  }
  return hi - lo + 1 === toF64(ns.length)
}

/** Whether `c` is a digit. */
const gateFidDigit = (c: i32): boolean => c >= 48 && c <= 57

/** Whether `c` is an ASCII letter or `_`. */
const gateFidLetter = (c: i32): boolean => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95

/**
 * Whether the byte at `i` of `s` belongs to the token that starts at
 * `start`: a letter, digit, `_`, `.` or `,`, or a `-` inside a token that
 * starts with a letter, joining it to the letter or digit after it
 * (`SHA-256`, `SHA-256-128`, `AES-128-GCM-96`). A `-` in a token that starts
 * with a digit, any non-ASCII character (an en dash) and anything else bound
 * a token, so `1,000-iteration` and `1,000–2,000` hold whole numbers while
 * `5.2`, `X25519` and `SHA-256-128` hold none.
 */
const gateFidTokenAt = (s: string, start: i32, i: i32): boolean => {
  // Past the end of s there is no byte, so none belongs to a token.
  if (!(i >= 0 && i < s.length)) {
    return false
  }
  const c = s.charCodeAt(i)
  if (gateFidDigit(c) || gateFidLetter(c) || c === 46 || c === 44) {
    return true
  }
  return (
    c === 45 &&
    i > start &&
    start >= 0 &&
    gateFidLetter(s.charCodeAt(start)) &&
    i < s.length - 1 &&
    (gateFidLetter(s.charCodeAt(i + 1)) || gateFidDigit(s.charCodeAt(i + 1)))
  )
}

/**
 * Where the tokens of `s` are, as start and end pairs, each without the `.`
 * and `,` that end a sentence or a list item.
 */
const gateFidSpans = (s: string): i32[] => {
  const out: i32[] = []
  let i = 0
  while (i >= 0 && i < s.length) {
    if (!gateFidTokenAt(s, i, i)) {
      i = i + 1
      continue
    }
    let j = i
    while (j < s.length && gateFidTokenAt(s, i, j)) {
      j = j + 1
    }
    let e = j
    while (e > i && e > 0 && e <= s.length && (s.charCodeAt(e - 1) === 46 || s.charCodeAt(e - 1) === 44)) {
      e = e - 1
    }
    if (e > i) {
      out.push(i)
      out.push(e)
    }
    i = j
  }
  return out
}

/** The tokens of `s` (`gateFidSpans`). */
const gateFidTokens = (s: string): string[] => {
  const spans = gateFidSpans(s)
  const out: string[] = []
  for (let i = 0; i >= 0 && i < spans.length - 1; i = gateFidPlus(i, 2)) {
    out.push(s.substring(spans[i], spans[i + 1]))
  }
  return out
}

/**
 * The whole number a token is, its commas dropped, or "" when it is none: a
 * run of digits, or one to three digits then groups of a comma and three
 * digits ("1,000,000"). A malformed group ("1,00", "10,00,000") is no number.
 */
const gateFidNumber = (t: string): string => {
  let digits = ""
  let group = -1
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i)
    if (gateFidDigit(c)) {
      digits = `${digits}${t.substring(i, i + 1)}`
      // group is at most 3 here, or the token was refused below.
      group = group < 0 ? group : gateFidPlus(group, 1)
      if (group > 3) {
        return ""
      }
    } else if (c === 44) {
      if ((group < 0 && (digits.length === 0 || digits.length > 3)) || (group >= 0 && group !== 3)) {
        return ""
      }
      group = 0
    } else {
      return ""
    }
  }
  return digits.length === 0 || (group >= 0 && group !== 3) ? "" : digits
}

/**
 * Whether `line` is a section heading, exactly as `rfcParse` reads one
 * ("5.2.  Test Vectors", "A.2.  Test Case 2", "Appendix A.  Examples"): a
 * heading's numbers are not a count printed in the section.
 */
const gateFidHeading = (line: string): boolean => rfcParse(line).sections.length > 0

/** The whole numbers in `s`, each a whole token and with its commas dropped ("1,000" is "1000"). */
const gateWholeNumbers = (s: string): string[] => {
  const out: string[] = []
  for (const t of gateFidTokens(s)) {
    const n = gateFidNumber(t)
    if (n.length > 0) {
      out.push(n)
    }
  }
  return out
}

/** A whole number's digits as English prints them, grouped by commas in threes: "1000" is "1,000". */
const gateGrouped = (d: string): string => {
  let out = ""
  for (let i = 0; i < d.length; i++) {
    if (i > 0 && (d.length - i) % 3 === 0) {
      out = `${out},`
    }
    out = `${out}${d.substring(i, i + 1)}`
  }
  return out
}

/** Whether `w` is a word that a length in bytes ends with: "byte", "bytes", "octet" or "octets". */
const gateFidLengthWord = (w: string): boolean => {
  const l = textAsciiLower(w)
  return l === "byte" || l === "bytes" || l === "octet" || l === "octets"
}

/**
 * A label with every length in bytes cut out, number and word
 * (`MESSAGE (length 2 bytes)` is `MESSAGE (length )`): a value's length is
 * checked by the value itself, so it is no variant's number.
 */
const gateLabelUnsized = (label: string): string => {
  const spans = gateFidSpans(label)
  let out = ""
  let from = 0
  for (let i = 0; i >= 0 && i < spans.length - 3; i = gateFidPlus(i, 2)) {
    const start = spans[i]
    const end = spans[i + 1]
    const wordStart = spans[i + 2]
    const wordEnd = spans[i + 3]
    const n = gateFidNumber(label.substring(start, end))
    if (n.length > 0 && start >= from && gateFidLengthWord(label.substring(wordStart, wordEnd))) {
      out = `${out}${label.substring(from, start)}`
      from = wordEnd
    }
  }
  return `${out}${label.substring(from, label.length)}`
}

/** Whether `w` is a word that counts rounds: "iteration", "iterations" or "times". */
const gateFidRoundsWord = (w: string): boolean => {
  const l = textAsciiLower(w)
  return l === "iteration" || l === "iterations" || l === "times"
}

/**
 * The number a label counts rounds with, its commas dropped: the one before
 * "iteration", "iterations" or "times" (`After 1,000 iterations` counts
 * 1000), or "" when no number is.
 */
const gateLabelRounds = (label: string): string => {
  const ts = gateFidTokens(label)
  for (let i = 0; i < ts.length - 1; i++) {
    const after = ts[i + 1]
    const n = gateFidNumber(ts[i])
    if (n.length > 0 && gateFidRoundsWord(after)) {
      return n
    }
  }
  return ""
}

/**
 * The number a label counts rounds with (`gateLabelRounds`), else its only
 * number, else null: with two or more numbers and no word to say which
 * counts, it is not checked.
 */
const gateLabelCount = (label: string): string | null => {
  const n = gateLabelRounds(label)
  if (n.length > 0) {
    return n
  }
  const ns = gateWholeNumbers(label)
  return ns.length === 1 ? ns[0] : null
}

/**
 * A label with its rounds cut out, so the rest of it can still be compared
 * with its variants: every copy of the number it counts rounds with
 * (`gateLabelRounds`), and the label whole when it counts none. The one rule
 * cuts an expected label and every label beside it.
 */
const gateLabelUncounted = (label: string): string => {
  const n = gateLabelRounds(label)
  if (n.length === 0) {
    return label
  }
  const spans = gateFidSpans(label)
  let out = ""
  let from = 0
  for (let i = 0; i >= 0 && i < spans.length - 1; i = i + 2) {
    if (gateFidNumber(label.substring(spans[i], spans[i + 1])) === n) {
      out = `${out}${label.substring(from, spans[i])} `
      from = spans[i + 1]
    }
  }
  return `${out}${label.substring(from, label.length)}`
}

/** Whether an iterated vector's expected label counts its rounds: `After 1,000 iterations` for 1000. */
const gateLabelIsCount = (k: Clause, label: string): boolean => {
  const it = k.iterate
  const n = gateLabelCount(label)
  return it !== null && n !== null && n === `${it.count}`
}

/**
 * An iterated vector's count against its section: the count is printed
 * there as a whole number (commas ignored), outside a heading, and the number the expected
 * label counts rounds with (`gateLabelCount`) is the count. An unprinted count
 * is refused at the vector's Iterate paragraph (`<id>.iterate`), which holds it.
 */
const gateIterateCount = (
  ctx: CheckContext,
  out: string[],
  k: Clause,
  it: Iterate,
  sec: RfcSection,
  where: string,
): void => {
  const want = `${it.count}`
  let printed = false
  const lines = sec.lines
  for (let i = 0; i < lines.length && !printed; i++) {
    // The cheap test first: a heading is read only when its line holds the count.
    const line = lines[i]
    printed = gateWholeNumbers(line).indexOf(want) >= 0 && !gateFidHeading(line)
  }
  if (!printed) {
    gateIssue(ctx, out, GATE_FIDELITY, `${k.id}.iterate`, `the count ${gateGrouped(want)} is not printed in ${where}`)
  }
  const expect = k.expect
  const label: string | null = expect === null ? null : expect.label
  if (label !== null) {
    const n = gateLabelCount(label)
    if (n !== null && n !== want) {
      gateIssue(
        ctx,
        out,
        GATE_FIDELITY,
        `${k.id}.expect`,
        `the expected label "${label}" counts ${gateGrouped(n)}, but the vector iterates ${gateGrouped(want)} times`,
      )
    }
  }
}

/**
 * A truncated vector's length against its section: the number then the unit
 * the contract records (`128 bits`, or `16 bytes`) are printed there as two
 * whole tokens, outside a heading, the unit in any case and the number with
 * its commas dropped. A line break between them is a space.
 */
const gateTruncateLength = (
  ctx: CheckContext,
  out: string[],
  k: Clause,
  t: Truncate,
  sec: RfcSection,
  where: string,
): void => {
  const want = `${t.count()}`
  const words: string[] = []
  for (const line of sec.lines) {
    if (!gateFidHeading(line)) {
      for (const w of gateFidTokens(line)) {
        words.push(w)
      }
    }
  }
  for (let i = 0; i < words.length - 1; i++) {
    const after = words[i + 1]
    if (gateFidNumber(words[i]) === want && textAsciiLower(after) === t.unit) {
      return
    }
  }
  gateIssue(
    ctx,
    out,
    GATE_FIDELITY,
    `${k.id}.truncate`,
    `the truncation to ${gateGrouped(want)} ${t.unit} is not printed in ${where} ("${sec.title}")`,
  )
}

/**
 * A label with one paired string's printing cut out, in whichever quotes it
 * stands in (gateQuotePairs): `"salt"` of `(P="passwd", S="salt")` leaves
 * `S=""`, and `'k1'` of `(key='k1')` leaves `key=''`.
 */
const gateLabelUnText = (label: string, text: string): string => {
  const quotes = gateQuotePairs()
  let out = label
  for (let q = 0; q >= 0 && q < quotes.length - 1; q += 2) {
    const quoted = `${quotes[q]}${text}${quotes[q + 1]}`
    const at = out.indexOf(quoted)
    if (at >= 0) {
      // quoted is in out at `at`, so the sum is at most out.length.
      out = `${out.substring(0, at)}${quotes[q]}${quotes[q + 1]}${out.substring(gateFidPlus(at, quoted.length))}`
    }
  }
  return out
}

/** Whether `c` is an ASCII letter or digit: it runs a name or a number on. */
const gateNameChar = (c: i32): boolean => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)

/**
 * A call label with the number after each name in `names` (the vector's
 * integer arguments) cut out: with `c` and `N` bound, `c=1` and `N=16` of
 * `(P="passwd", c=1, N=16, bits=256)` leave `c=` and `N=`, and `bits=256`,
 * which the vector does not bind, stays part of the variant.
 */
const gateLabelUnNumbered = (label: string, names: string[]): string => {
  const out: string[] = []
  let i = 0
  while (i >= 0 && i < label.length) {
    const c = label.charCodeAt(i)
    out.push(label.substring(i, i + 1))
    i = i + 1
    if (c !== 61) {
      continue
    }
    let s = i - 1
    while (s > 0 && s <= label.length && gateNameChar(label.charCodeAt(s - 1))) {
      s = s - 1
    }
    if (names.indexOf(label.substring(s, i - 1)) < 0) {
      continue
    }
    while (i >= 0 && i < label.length && gateNameChar(label.charCodeAt(i))) {
      i = i + 1
    }
  }
  return out.join("")
}

/**
 * The part of a label that names a variant: for an expected value paired with
 * its call label's arguments, the label with the arguments the vector binds
 * cut out (each paired string, and the number after each integer argument's
 * own name), so `HMAC (SHA-256, key="Jefe")` still names 256, a bound `c=1`
 * names nothing and an unbound `bits=256` still does; otherwise the whole
 * label.
 */
const gateCallHead = (l: GateLits, b: GateBound, label: string): string => {
  if (!b.callArgs) {
    return label
  }
  let out = rfcNormalize(label)
  const names: string[] = []
  for (const a of l.bounds) {
    const name = a.label
    if (a.lines !== null) {
      if (a.paired) {
        out = gateLabelUnText(out, a.text)
      }
    } else if ((a.paired || a.other) && name !== null) {
      // An integer the vector binds and a call label prints (its own, or
      // another case's) is an argument wherever that name is printed,
      // whichever value it prints there.
      names.push(name)
    }
  }
  return gateLabelUnNumbered(out, names)
}

/**
 * Whether a value's own variant (`label`, the label or case heading it is
 * printed under, as gateDigitRuns reads it) is the one the called function
 * names, against its siblings' (labels of the same skeleton): another
 * variant's number in the name is refused, none of them is a warning.
 * Numbers that run consecutively across them count test cases, not variants.
 */
const gateVariantNote = (
  l: GateLits,
  k: Clause,
  at: string,
  subject: string,
  label: string,
  siblings: string[],
  shownAll: string[],
  inSection: string,
): void => {
  if (siblings.length === 0) {
    return
  }
  const named = gateDigitRuns(k.call)
  const mine = gateDigitRuns(label)
  const all = [label]
  for (const s of siblings) {
    all.push(s)
  }
  if (shownAll.length !== gateFidPlus(siblings.length, 1)) {
    gateLitBroken(l, `${shownAll.length} printed labels for ${siblings.length} siblings`)
    return
  }
  const own: string[] = []
  const theirs: string[] = []
  const from: string[] = []
  // shownAll is the label, then each sibling as it is printed (checked above).
  for (let si = 0; si < siblings.length && si < shownAll.length - 1; si++) {
    const shown = shownAll[si + 1]
    const ds = gateDigitRuns(siblings[si])
    for (let i = 0; i < ds.length; i++) {
      const d = ds[i]
      const m = i < mine.length ? mine[i] : ""
      if (d === m || gateCounts(all, i)) {
        continue
      }
      if (own.indexOf(m) < 0) {
        own.push(m)
      }
      if (theirs.indexOf(d) < 0) {
        theirs.push(d)
        from.push(shown)
      }
    }
  }
  if (own.every((d: string): boolean => named.indexOf(d) >= 0)) {
    return
  }
  // from is parallel to theirs, pushed together above: where each other
  // variant's number is printed.
  let other: string | null = null
  let otherFrom = ""
  for (let i = 0; i < theirs.length && i < from.length && other === null; i++) {
    const t = theirs[i]
    const f = from[i]
    if (named.indexOf(t) >= 0 && own.indexOf(t) < 0) {
      other = t
      otherFrom = f
    }
  }
  if (other !== null) {
    gateNote(
      l,
      at,
      `${subject} in ${inSection}, but ${k.call} names ${other}, as in "${otherFrom}": a vector uses the value printed for the variant its function computes`,
      false,
    )
  } else {
    gateNote(
      l,
      at,
      `${subject}, one of ${gateQuoted(shownAll)} in ${inSection}, and nothing in the name ${k.call} says which variant it computes: not checked that this is its own`,
      true,
    )
  }
}

/**
 * The case heading a vector's values are printed under (gateHeadingCase)
 * names its variant (`SHA-256` in `With SHA-256, message = "sample":`): it
 * must be the one the called function names, against the other headings'
 * (gateVariantNote).
 */
const gateHeadingVariant = (l: GateLits, k: Clause, sec: RfcSection): void => {
  const c = l.chosen
  const headLines = l.headLines
  if (!(c >= 0 && c < headLines.length)) {
    return
  }
  const line = headLines[c]
  const mine = rfcWithHeading(line)
  const shape = gateSkeleton(mine)
  const siblings: string[] = []
  const shownAll = [mine]
  for (const h of headLines) {
    const w = rfcWithHeading(h)
    if (gateSkeleton(w) === shape) {
      siblings.push(w)
      shownAll.push(w)
    }
  }
  const subject = `the values are printed under the case heading ${gateHeadingText(line)}`
  gateVariantNote(l, k, k.id, subject, mine, siblings, shownAll, `${l.where} ("${sec.title}")`)
}

/**
 * A value printed under one of several labels that differ only in a number
 * ("HMAC-SHA-256", "HMAC-SHA-512") must be the variant the called function
 * names: another variant's number in the name is refused, none of them is a
 * warning. A length in bytes (`MESSAGE (length 2 bytes)`) is no variant's
 * number (`gateLabelUnsized`).
 */
const gateOwnVariant = (l: GateLits, k: Clause, sec: RfcSection): void => {
  const printed: string[] = []
  const keys: string[] = []
  for (const v of l.values) {
    const vl = v.label
    if (vl !== null && keys.indexOf(textAsciiLower(rfcNormalize(vl))) < 0) {
      keys.push(textAsciiLower(rfcNormalize(vl)))
      printed.push(vl)
    }
  }
  const inSection = `${l.where} ("${sec.title}")`
  for (const b of l.bounds) {
    const shown = b.label
    if (shown === null) {
      continue
    }
    // An iterated vector's rounds (After 1,000 iterations) are not variants:
    // its count, and the round number of every label beside it, are cut out,
    // and the rest of the label is still its own variant's.
    const rounds = b.at === "expect" && gateLabelIsCount(k, shown)
    // A call label's paired arguments name its test case, not its variant:
    // the rest of the label, inside the `( … )` too, still names the variant.
    const head = gateCallHead(l, b, shown)
    const label = gateLabelUnsized(rounds ? gateLabelUncounted(head) : head)
    const shape = gateSkeleton(label)
    const siblings: string[] = []
    const shownAll = [shown]
    for (const p of printed) {
      const pOwn = gateCallHead(l, b, p)
      const q = gateLabelUnsized(rounds ? gateLabelUncounted(pOwn) : pOwn)
      if (gateSkeleton(q) === shape && !gateSameLabel(pOwn, head)) {
        siblings.push(q)
        shownAll.push(p)
      }
    }
    gateVariantNote(
      l,
      k,
      `${k.id}.${b.at}`,
      `the value is printed under "${shown}"`,
      label,
      siblings,
      shownAll,
      inSection,
    )
  }
}

/** A quote's finding: why it is not in the section, or "" when it is. */
const gateQuoteFinding = (
  set: SourceSet,
  source: string | null,
  section: string,
  sec: RfcSection,
  quote: string,
): string => {
  const why = gateQuoteMissing(sec, quote)
  if (why === null) {
    return ""
  }
  const place = gatePlace(set, source, section)
  return why === "quote not found" ? `quote not found in ${place} ("${sec.title}"): ${jsonStringifyString(quote)}` : why
}

/** One vector's values, tolerance and stated result against its section. */
const gateFidelityVector = (ctx: CheckContext, out: string[], set: SourceSet, k: Clause): void => {
  const g = GATE_FIDELITY
  const tol = k.tolerance
  if (tol !== null) {
    const at = `${k.id}.tolerance`
    const tsec = gateCitedSection(ctx, out, g, tol.source, tol.section, at)
    if (tsec !== null) {
      const why = gateQuoteFinding(set, tol.source, tol.section, tsec, tol.quote)
      if (why.length > 0) {
        gateIssue(ctx, out, g, at, why)
      }
    }
  }
  const at = gateArgsAt(k)
  if (at.section.length === 0) {
    return
  }
  const whole = gateCitedSection(ctx, out, g, at.source, at.section, k.id)
  if (whole === null) {
    return
  }
  let sec = whole
  let where = gatePlace(set, at.source, at.section)
  const loaded = sourceFind(set, at.source)
  const xml = loaded === null ? false : loaded.file.endsWith(".xml")
  // Named, one test case narrows the section to its own lines.
  const tc = at.testCase
  if (tc !== null) {
    const one = rfcCaseSection(whole, charsTestVector(tc))
    if (one.isErr()) {
      gateIssue(ctx, out, g, k.id, `${where} ("${whole.title}") ${one.error}`)
      return
    }
    sec = one.value
    where = `${where}, ${tc}`
  }
  const l = new GateLits(k.id, where, sec, xml)
  if (tc === null && loaded !== null && loaded.doc.number >= 1 && rfcHasCases(whole)) {
    l.hint = `, or name one: {{Section ${at.section} of RFC${loaded.doc.number}}}, Test Vector #N`
  }
  for (let i = 0; i < k.args.length; i++) {
    gateLitCheck(l, k.args[i], `args[${i}]`)
  }
  const args = l.bounds.length
  // A command or the spec vouches for the expected value instead.
  const src = k.source
  const cited = src !== null && src.kind === VectorSourceKind.Cite
  const word = gateResultWord(k.expect)
  const expect = k.expect
  if (cited && word.length === 0 && expect !== null) {
    gateLitCheck(l, expect, "expect")
  }
  gateLabelArgs(l, args)
  gateOneTestCase(l, args, sec)
  gateOwnVariant(l, k, sec)
  gateHeadingVariant(l, k, sec)
  const it = k.iterate
  if (it !== null) {
    gateIterateCount(ctx, out, k, it, sec, where)
  }
  const tr = k.truncate
  if (tr !== null) {
    gateTruncateLength(ctx, out, k, tr, sec, where)
  }
  for (const n of l.notes) {
    if (n.warning) {
      gateWarn(ctx, g, n.at, n.message)
    } else {
      gateIssue(ctx, out, g, n.at, n.message)
    }
  }
  if (cited && word.length > 0) {
    const why = gateStatesResult(ctx.contract, set, k, at, sec, word)
    if (why !== null) {
      gateIssue(ctx, out, g, `${k.id}.expect`, `${where} ("${sec.title}") does not state the expected result: ${why}`)
    }
  }
}

/**
 * The fidelity gate: quotes verbatim, vectors' values printed as one test
 * case, and stated results stated (see the module comment).
 *
 * @param ctx the check's context, holding the contract
 * @returns each finding
 */
export const gateFidelity = (ctx: CheckContext): string[] => {
  const out: string[] = []
  const g = GATE_FIDELITY
  const set = gateSources(ctx, out, g)
  for (const r of ctx.contract.requirements) {
    const sec = gateCitedSection(ctx, out, g, r.source, r.section, r.id)
    if (sec !== null) {
      const why = gateQuoteFinding(set, r.source, r.section, sec, r.quote)
      if (why.length > 0) {
        gateIssue(ctx, out, g, r.id, why)
      }
    }
  }
  for (const k of ctx.contract.clauses) {
    if (k.kind === ClauseKind.Vector) {
      gateFidelityVector(ctx, out, set, k)
    }
  }
  return out
}
