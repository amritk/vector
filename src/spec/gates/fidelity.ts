/**
 * `spec/gates/fidelity` — the contract says what its sources say. Every
 * requirement's and tolerance's quote is printed verbatim (whitespace
 * collapsed) in the section it cites. Every value of a cited vector is
 * printed whole in its section, under the label the contract gives it, and
 * all of them as one test case: on one line, or from one round of repeated
 * labels, with the expected value not also an input. A value printed for one
 * of several variants ("HMAC-SHA-256" beside "HMAC-SHA-512") must be the one
 * the called function names. An expected null, true or false must be stated
 * by a covered requirement (gateStatesResult).
 */

import { jsonStringifyString } from "nish/json"
import { asciiLower } from "nish/text"
import { toHex, utf8Bytes } from "../../core/hex"
import { CheckContext, CheckNote } from "../check"
import { contractF64Bits, contractF64IsNaN, contractF64Parse } from "../contract/f64"
import { Clause, ClauseKind, LitKind, Literal, VectorSourceKind } from "../contract/types"
import { SourceSet } from "../source/load"
import { HexValue, RfcSection, rfcHexValues, rfcNormalize, rfcSectionText } from "../source/rfc"
import { gateArgsAt, gateCitedSection, gatePlace, gateQuoteMissing, gateSources } from "./cite"
import { gateIssue, gateWarn } from "./note"
import { gateStatesResult } from "./result"
import { gateF64Printed, gateIntLabelCount, gateIntRounds, gateLines, gateTextLines } from "./text"

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
  constructor(at: string, label: string | null) {
    this.at = at
    this.label = label
    this.of = 0
    this.has = []
    this.lines = null
    this.text = ""
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
  values: HexValue[]
  text: string
  lines: string
  bounds: GateBound[]
  constructor(id: string, where: string, sec: RfcSection) {
    this.notes = []
    this.id = id
    this.where = where
    this.inSection = `${where} ("${sec.title}")`
    this.values = rfcHexValues(sec)
    this.text = rfcSectionText(sec)
    this.lines = gateLines(sec.lines)
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

/**
 * A value printed under one of several labels that differ only in a number
 * ("HMAC-SHA-256", "HMAC-SHA-512") must be the variant the called function
 * names: another variant's number in the name is refused, none of them is a
 * warning.
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
    const label = b.label
    if (label === null) {
      continue
    }
    const mine = gateDigitRuns(label)
    const shape = gateSkeleton(label)
    const siblings = printed.filter((p: string): boolean => gateSkeleton(p) === shape && !gateSameLabel(p, label))
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
    for (const sib of siblings) {
      const ds = gateDigitRuns(sib)
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
          from.push(sib)
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
        `the value is printed under "${label}" in ${inSection}, but ${k.call} names ${theirs[other]}, as in "${from[other]}": a vector uses the value printed for the variant its function computes`,
        false,
      )
    } else {
      gateNote(
        l,
        `${k.id}.${b.at}`,
        `the value is printed under "${label}", one of ${gateQuoted(all)} in ${inSection}, and nothing in the name ${k.call} says which variant it computes: not checked that this is its own`,
        true,
      )
    }
  }
}

/** "null", "true" or "false" for an expected null or bool; "" otherwise. */
const gateResultWord = (lit: Literal | null): string => {
  if (lit === null) {
    return ""
  }
  if (lit.kind === LitKind.Null) {
    return "null"
  }
  if (lit.kind !== LitKind.Bool) {
    return ""
  }
  return lit.flag ? "true" : "false"
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
  const l = new GateLits(k.id, where, sec)
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
