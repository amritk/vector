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
 * (gateStatesResult).
 */

import { jsonStringifyString } from "nish/json"
import { asciiLower } from "nish/text"
import { toHex, utf8Bytes } from "../../core/hex"
import { CheckContext, CheckNote } from "../check"
import { contractF64Bits, contractF64IsNaN, contractF64Parse } from "../contract/f64"
import { Clause, ClauseKind, Iterate, LitKind, Literal, VectorSourceKind, typesIsWords } from "../contract/types"
import { SourceSet, sourceFind } from "../source/load"
import {
  HexValue,
  RfcSection,
  rfcHexValues,
  rfcNormalize,
  rfcParse,
  rfcSectionText,
  rfcUnvaluedLabels,
} from "../source/rfc"
import { gateArgsAt, gateCitedSection, gatePlace, gateQuoteMissing, gateSources } from "./cite"
import { gateIssue, gateWarn } from "./note"
import { gateResultWord, gateStatesResult } from "./result"
import { gateByteLists, gateF64Printed, gateIntLabelCount, gateIntRounds, gateLines, gateTextLines } from "./text"
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
  constructor(at: string, label: string | null) {
    this.at = at
    this.label = label
    this.of = 0
    this.has = []
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
    this.blocks = gateWordBlocks(sec.lines)
    this.bounds = []
  }
}

const GATE_FIDELITY: string = "fidelity"

/** Whether two labels are the same, whitespace collapsed and case ignored. */
const gateSameLabel = (a: string, b: string): boolean => asciiLower(rfcNormalize(a)) === asciiLower(rfcNormalize(b))

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

/** Whether `hex` is byte-aligned inside `value`. */
const gateHexInside = (value: string, hex: string): boolean => {
  let at = toI32(value.indexOf(hex))
  while (at >= 0) {
    if (at % 2 === 0) {
      return true
    }
    at = toI32(value.indexOf(hex, at + 1))
  }
  return false
}

/** A literal's bytes as lowercase hex: a hex literal's run repeated, an ascii literal's text. */
const gateLitHex = (lit: Literal): string => {
  if (lit.kind === LitKind.Ascii) {
    return toHex(utf8Bytes(lit.text))
  }
  const run = asciiLower(lit.text)
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
          `${hex.length / 2}-byte value is only part of a value printed in ${l.inSection}${under}: a vector uses whole printed values (concat them to join several)`,
        )
        return
      }
    }
    gateLitFail(l, at, `${hex.length / 2}-byte value is not printed in ${l.inSection}`)
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
      l.bounds.push(new GateBound(at, null))
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
  for (const v of l.values) {
    const vl = v.label
    if (vl !== null && gateSameLabel(vl, label)) {
      if (v.hex === hex) {
        has.push(of)
      }
      of = of + 1
    }
  }
  gateRounds(l, new GateBound(at, label), of, has)
}

/** A word without its `0x`. */
const gateWordBare = (w: string): string => (w.startsWith("0x") ? w.substring(2, w.length) : w)

/** Whether `want` is `words` from `from` on, as printed or, with `bare`, ignoring `0x`. */
const gateWordsAt = (words: string[], want: string[], from: i32, bare: boolean): boolean => {
  if (from + want.length > words.length) {
    return false
  }
  for (let i = 0; i < want.length; i++) {
    const a = words[from + i]
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
  for (let i = 0; i + want.length <= words.length; i++) {
    if (gateWordsAt(words, want, i, true)) {
      return true
    }
  }
  return false
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
  for (let b = 0; b < l.blocks.length; b++) {
    const words = l.blocks[b].words
    if (words.length === n && gateWordsAt(words, want, 0, false)) {
      exact.push(b)
    }
  }
  if (exact.length === 0) {
    const prefixed = want[0].startsWith("0x")
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
    const b = new GateBound(at, null)
    b.block = exact[0]
    l.bounds.push(b)
    return
  }
  const named: string[] = []
  let block = -1
  for (const e of exact) {
    const bl = l.blocks[e].label
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
      of = of + 1
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
  gateRounds(l, new GateBound(at, label), of, has)
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
  for (let i = 0; i + 1 < ts.length; i++) {
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
  const of = rfcUnvaluedLabels(l.sec).filter((u: string): boolean => gateSameLabel(u, label)).length
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
  gateRounds(l, new GateBound(at, label), toI32(of), has)
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
const gateNth = (has: i32[]): string => has.map((r: i32): string => gateOrdinal(r + 1)).join(" or ")

/**
 * A cited vector's values are one test case: text printed on one shared line,
 * repeated labels from one round, and the expected value not an input's.
 */
const gateOneTestCase = (l: GateLits, args: i32, sec: RfcSection): void => {
  const id = l.id
  const inSection = `${l.where} ("${sec.title}")`
  const texts = l.bounds.filter((b: GateBound): boolean => b.lines !== null)
  if (texts.length > 1) {
    const first = texts[0].lines
    let shared = false
    if (first !== null) {
      for (const line of first) {
        if (texts.every((b: GateBound): boolean => gateBoundHasLine(b, line))) {
          shared = true
        }
      }
    }
    if (!shared) {
      gateNote(
        l,
        id,
        `${texts.map(gateBoundText).join(", ")} are each printed in ${inSection}, but never on one line together, so nothing pairs them as one test case`,
        false,
      )
    }
  }
  const repeated = l.bounds.filter((b: GateBound): boolean => b.of > 1)
  if (texts.length > 0 && repeated.length > 0) {
    // A string is placed by its line and a labelled value by its round;
    // nothing relates the two.
    gateNote(
      l,
      id,
      `${texts.map(gateBoundText).join(", ")} and ${repeated.map(gateBoundRound).join(", ")} in ${inSection}: nothing pairs a printed string with one of several labelled values: cite the subsection that holds one test case`,
      false,
    )
  } else if (repeated.length > 1 && repeated.some((b: GateBound): boolean => b.of !== repeated[0].of)) {
    // Rounds pair only when every label is printed once per test case.
    const counts = repeated.map((b: GateBound): string => `"${gateBoundLabel(b)}" is printed ${b.of} times`)
    gateNote(
      l,
      id,
      `${counts.join(", ")} in ${inSection}, so which printings belong to one test case is unclear: cite the subsection that holds one test case`,
      false,
    )
  } else if (repeated.length > 1) {
    let shared = false
    for (const r of repeated[0].has) {
      if (repeated.every((b: GateBound): boolean => b.has.indexOf(r) >= 0)) {
        shared = true
      }
    }
    if (!shared) {
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
  for (let e = args; e < l.bounds.length; e++) {
    const block = l.bounds[e].block
    if (block >= 0) {
      for (let a = 0; a < args; a++) {
        if (l.bounds[a].block === block) {
          gateNote(
            l,
            `${id}.${l.bounds[e].at}`,
            `the expected value is the block of words ${l.bounds[a].at} is bound to as well: an input is not the expected result`,
            false,
          )
          break
        }
      }
      continue
    }
    const label = l.bounds[e].label
    if (label === null) {
      continue
    }
    for (let a = 0; a < args; a++) {
      const al = l.bounds[a].label
      if (al !== null && gateSameLabel(al, label)) {
        gateNote(
          l,
          `${id}.${l.bounds[e].at}`,
          `the expected value is the one printed under "${label}", which ${l.bounds[a].at} is bound to as well: an input is not the expected result`,
          false,
        )
        break
      }
    }
  }
}

/** Whether a text bound is printed on `line`. */
const gateBoundHasLine = (b: GateBound, line: i32): boolean => {
  const lines = b.lines
  return lines !== null && lines.indexOf(line) >= 0
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
  while (i < t.length) {
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
  const t = asciiLower(rfcNormalize(s))
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
    if (i >= d.length) {
      return false
    }
    const n = parseFloat(d[i])
    if (ns.indexOf(n) < 0) {
      ns.push(n)
    }
  }
  let lo = ns[0]
  let hi = ns[0]
  for (const n of ns) {
    lo = n < lo ? n : lo
    hi = n > hi ? n : hi
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
  const c = s.charCodeAt(i)
  if (gateFidDigit(c) || gateFidLetter(c) || c === 46 || c === 44) {
    return true
  }
  return (
    c === 45 &&
    i > start &&
    gateFidLetter(s.charCodeAt(start)) &&
    i + 1 < s.length &&
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
  while (i < s.length) {
    if (!gateFidTokenAt(s, i, i)) {
      i = i + 1
      continue
    }
    let j = i
    while (j < s.length && gateFidTokenAt(s, i, j)) {
      j = j + 1
    }
    let e = j
    while (e > i && (s.charCodeAt(e - 1) === 46 || s.charCodeAt(e - 1) === 44)) {
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
  for (let i = 0; i + 1 < spans.length; i = i + 2) {
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
      group = group < 0 ? group : group + 1
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
  const l = asciiLower(w)
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
  for (let i = 0; i + 3 < spans.length; i = i + 2) {
    const n = gateFidNumber(label.substring(spans[i], spans[i + 1]))
    if (n.length > 0 && spans[i] >= from && gateFidLengthWord(label.substring(spans[i + 2], spans[i + 3]))) {
      out = `${out}${label.substring(from, spans[i])}`
      from = spans[i + 3]
    }
  }
  return `${out}${label.substring(from, label.length)}`
}

/** Whether `w` is a word that counts rounds: "iteration", "iterations" or "times". */
const gateFidRoundsWord = (w: string): boolean => {
  const l = asciiLower(w)
  return l === "iteration" || l === "iterations" || l === "times"
}

/**
 * The number a label counts rounds with, its commas dropped: the one before
 * "iteration", "iterations" or "times" (`After 1,000 iterations` counts
 * 1000), or "" when no number is.
 */
const gateLabelRounds = (label: string): string => {
  const ts = gateFidTokens(label)
  for (let i = 0; i + 1 < ts.length; i++) {
    const n = gateFidNumber(ts[i])
    if (n.length > 0 && gateFidRoundsWord(ts[i + 1])) {
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
  for (let i = 0; i + 1 < spans.length; i = i + 2) {
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
 * label counts rounds with (`gateLabelCount`) is the count.
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
  for (let i = 0; i < sec.lines.length && !printed; i++) {
    // The cheap test first: a heading is read only when its line holds the count.
    printed = gateWholeNumbers(sec.lines[i]).indexOf(want) >= 0 && !gateFidHeading(sec.lines[i])
  }
  if (!printed) {
    gateIssue(ctx, out, GATE_FIDELITY, k.id, `the count ${gateGrouped(want)} is not printed in ${where}`)
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
    if (vl !== null && keys.indexOf(asciiLower(rfcNormalize(vl))) < 0) {
      keys.push(asciiLower(rfcNormalize(vl)))
      printed.push(vl)
    }
  }
  const named = gateDigitRuns(k.call)
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
    const label = gateLabelUnsized(rounds ? gateLabelUncounted(shown) : shown)
    const mine = gateDigitRuns(label)
    const shape = gateSkeleton(label)
    const siblings: string[] = []
    const shownAll = [shown]
    for (const p of printed) {
      const q = gateLabelUnsized(rounds ? gateLabelUncounted(p) : p)
      if (gateSkeleton(q) === shape && !gateSameLabel(p, shown)) {
        siblings.push(q)
        shownAll.push(p)
      }
    }
    if (siblings.length === 0) {
      continue
    }
    const all = [label]
    for (const s of siblings) {
      all.push(s)
    }
    const own: string[] = []
    const theirs: string[] = []
    const from: string[] = []
    for (let si = 0; si < siblings.length; si++) {
      const ds = gateDigitRuns(siblings[si])
      for (let i = 0; i < ds.length; i++) {
        const m = i < mine.length ? mine[i] : ""
        if (ds[i] === m || gateCounts(all, i)) {
          continue
        }
        if (own.indexOf(m) < 0) {
          own.push(m)
        }
        if (theirs.indexOf(ds[i]) < 0) {
          theirs.push(ds[i])
          from.push(shownAll[si + 1])
        }
      }
    }
    if (own.every((d: string): boolean => named.indexOf(d) >= 0)) {
      continue
    }
    let other = -1
    for (let i = 0; i < theirs.length && other < 0; i++) {
      if (named.indexOf(theirs[i]) >= 0 && own.indexOf(theirs[i]) < 0) {
        other = i
      }
    }
    if (other >= 0) {
      gateNote(
        l,
        `${k.id}.${b.at}`,
        `the value is printed under "${shown}" in ${inSection}, but ${k.call} names ${theirs[other]}, as in "${from[other]}": a vector uses the value printed for the variant its function computes`,
        false,
      )
    } else {
      gateNote(
        l,
        `${k.id}.${b.at}`,
        `the value is printed under "${shown}", one of ${gateQuoted(shownAll)} in ${inSection}, and nothing in the name ${k.call} says which variant it computes: not checked that this is its own`,
        true,
      )
    }
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
  const sec = gateCitedSection(ctx, out, g, at.source, at.section, k.id)
  if (sec === null) {
    return
  }
  const where = gatePlace(set, at.source, at.section)
  const loaded = sourceFind(set, at.source)
  const xml = loaded === null ? false : loaded.file.endsWith(".xml")
  const l = new GateLits(k.id, where, sec, xml)
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
  gateOneTestCase(l, args, sec)
  gateOwnVariant(l, k, sec)
  const it = k.iterate
  if (it !== null) {
    gateIterateCount(ctx, out, k, it, sec, where)
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
