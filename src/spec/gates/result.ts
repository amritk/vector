/**
 * `spec/gates/result` — whether a section states a vector's result (null,
 * true or false) rather than printing it. Only through a requirement the
 * vector covers, cited to that very section, whose verbatim quote (in the
 * section's prose, not a blockquote) says MUST, SHALL or REQUIRED to (never
 * followed by NOT), optionally "always", a result verb, then the value as a
 * whole word; with nothing before the keyword in its sentence that denies or
 * conditions it (GATE_DENY), no alternative or hyphen right after the value,
 * the value ending its clause (punctuation, the end, or a condition such as
 * "when …"), and no retraction, hedge or other result in the rest of any
 * sentence the quote touches. Everything this does not recognise is refused:
 * a false refusal costs a rewording, a false pass breaks the gate.
 */

import { split, trim } from "nish/text"
import { textAsciiLower } from "../../core/text"
import { Citation, Clause, Contract, LitKind, Literal } from "../contract/types"
import { SourceSet, sourceFind } from "../source/load"
import { RfcSection, rfcNormalize, rfcSection } from "../source/rfc"
import { GATE_CLAUSE_GOES_ON, GATE_DENY, GATE_HEDGE, GATE_RETRACT, gateWordFind, gateWordLeads } from "./text"

/** A sentence's start and end offsets in the prose. */
class GateSpan {
  start: i32
  end: i32
  constructor(start: i32, end: i32) {
    this.start = start
    this.end = end
  }
}

/** The section's prose sentences, joined by one space, and where each is. */
class GateProse {
  text: string
  spans: GateSpan[]
  constructor() {
    this.text = ""
    this.spans = []
  }
}

const gateResultIsAlnum = (c: i32): boolean => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)

/** The byte at `i`, or -1 outside `s`. */
const gateResultByte = (s: string, i: i32): i32 => (i >= 0 && i < s.length ? s.charCodeAt(i) : -1)

/**
 * `a + b` for two offsets whose sum is itself an offset into a string the
 * caller names, so it fits an i32; the sum is taken wide so it is not checked.
 */
const gateResultPlus = (a: i32, b: i32): i32 => toI32(toI64(a) + toI64(b))

/** The `n` bytes of `s` from `j` (n >= 0), cut at its end as substring cuts them. */
const gateResultAt = (s: string, j: i32, n: i32): string => {
  const e = toI64(j) + toI64(n)
  return s.substring(j, e > toI64(s.length) ? s.length : toI32(e))
}

/** The offset after the spaces at `i` of `s`. */
const gateResultSkip = (s: string, i: i32): i32 => {
  let j = i
  while (j >= 0 && j < s.length && s.charCodeAt(j) === 32) {
    j++
  }
  return j
}

/** Whether a sentence ends at `i` of normalized text: . ; ! ? then the end, or a space and a capital, quote or bracket. */
const gateSentenceEnds = (t: string, i: i32): boolean => {
  const c = gateResultByte(t, i)
  if (c !== 0x2e && c !== 0x3b && c !== 0x21 && c !== 0x3f) {
    return false
  }
  // c is a byte of t, so i is an offset of t and i + 1 fits.
  if (!(i >= 0 && i < t.length)) {
    return false
  }
  const next = i + 1
  const j = gateResultSkip(t, next)
  if (j === t.length) {
    return true
  }
  if (j === next) {
    return false
  }
  const n = gateResultByte(t, j)
  return (n >= 65 && n <= 90) || n === 0x22 || n === 0x27 || n === 0x28 || n === 0x5b || gateResultAt(t, j, 3) === "“"
}

/**
 * A section's prose: its lines without blockquotes or (as an XML source
 * marks them) lines of code, cut into paragraphs (the heading alone first)
 * and sentences.
 */
const gateProse = (sec: RfcSection): GateProse => {
  const lines = sec.lines
  const code: boolean[] = []
  for (let i = 0; i < lines.length; i++) {
    code.push(false)
  }
  for (const i of sec.codeLines) {
    // The source marks only its own lines, so `i` is always one of them.
    if (i >= 0 && i < code.length) {
      code[i] = true
    }
  }
  const head: string[] = []
  let para: string[] = []
  const paras: string[][] = [head, para]
  for (let i = 0; i < lines.length && i < code.length; i++) {
    const raw = lines[i]
    const l = code[i] || trim(raw).startsWith(">") ? "" : raw
    if (i === 0) {
      head.push(l)
    } else if (trim(l).length === 0) {
      para = []
      paras.push(para)
    } else {
      para.push(l)
    }
  }
  const sentences: string[] = []
  for (const one of paras) {
    const t = rfcNormalize(one.join("\n"))
    let from = 0
    for (let i = 0; i < t.length; i++) {
      if (gateSentenceEnds(t, i)) {
        sentences.push(trim(t.substring(from, i + 1)))
        from = i + 1
      }
    }
    sentences.push(trim(t.substring(from, t.length)))
  }
  const p = new GateProse()
  const kept: string[] = []
  // The joined text holds every kept sentence and a space after each but the
  // last, so each offset is within its length, an i32.
  let at = 0
  for (const s of sentences) {
    if (s.length > 0) {
      kept.push(s)
      const end = gateResultPlus(at, s.length)
      p.spans.push(new GateSpan(at, end))
      at = gateResultPlus(end, 1)
    }
  }
  p.text = kept.join(" ")
  return p
}

/** The sentence span holding offset `i`; [i, i] outside every one. */
const gateSpanAt = (p: GateProse, i: i32): GateSpan => {
  for (const sp of p.spans) {
    if (i >= sp.start && i < sp.end) {
      return sp
    }
  }
  return new GateSpan(i, i)
}

/** Where one of the phrases (separated by "|") matches `s` at `i`, case-sensitive, followed by spaces; -1 when none. */
const gatePhraseAt = (s: string, i: i32, phrases: string): i32 => {
  let start = i
  for (const ph of split(phrases, "|")) {
    const words = split(ph, " ")
    let j = start
    let ok = true
    for (let w = 0; w < words.length && ok; w++) {
      const word = words[w]
      if (w > 0) {
        if (gateResultByte(s, j) !== 32) {
          ok = false
          break
        }
        j = gateResultSkip(s, j)
      }
      if (gateResultAt(s, j, word.length) !== word) {
        ok = false
      } else {
        // The word is in `s` at `j`, so its end is an offset of `s`.
        j = gateResultPlus(j, word.length)
      }
    }
    if (ok && gateResultByte(s, j) === 32) {
      return gateResultSkip(s, j)
    }
  }
  start = -1
  return start
}

/** Whether `c` is a backtick, a star or an underscore, which may wrap a value. */
const gateIsMark = (c: i32): boolean => c === 0x60 || c === 0x2a || c === 0x5f

/** The offset after the marks at `i` of `s`. */
const gateResultSkipMarks = (s: string, i: i32): i32 => {
  let j = i
  while (j >= 0 && j < s.length && gateIsMark(s.charCodeAt(j))) {
    j++
  }
  return j
}

/**
 * The affirmative statement of `word` starting at `i` of `q`: a keyword at a
 * word start, optionally "always", a result verb, then the value (in any
 * case, in code or emphasis) as a whole word. Its end, or -1.
 */
const gateStatementAt = (q: string, i: i32, word: string): i32 => {
  if (i > 0 && gateResultIsAlnum(gateResultByte(q, i - 1))) {
    return -1
  }
  let j = gatePhraseAt(q, i, "MUST|SHALL|REQUIRED to")
  if (j < 0) {
    return -1
  }
  const always = gatePhraseAt(q, j, "always")
  if (always >= 0) {
    j = always
  }
  j = gatePhraseAt(q, j, "return|be|evaluate to|yield|give|output")
  if (j < 0) {
    return -1
  }
  j = gateResultSkipMarks(q, j)
  if (textAsciiLower(gateResultAt(q, j, word.length)) !== word) {
    return -1
  }
  // The word is in `q` at `j`, so its end is an offset of `q`.
  j = gateResultSkipMarks(q, gateResultPlus(j, word.length))
  return gateResultIsAlnum(gateResultByte(q, j)) ? -1 : j
}

/** The width of the hyphen at `i` of `s` (-, U+2010 to U+2015, U+2212, or a slash); 0 when none. */
const gateHyphenAt = (s: string, i: i32): i32 => {
  if (!(i >= 0 && i < s.length)) {
    return 0
  }
  const c = s.charCodeAt(i)
  if (c === 0x2d || c === 0x2f) {
    return 1
  }
  if (c !== 0xe2 || i >= s.length - 2) {
    return 0
  }
  const b1 = s.charCodeAt(i + 1)
  const b2 = s.charCodeAt(i + 2)
  return (b1 === 0x80 && b2 >= 0x90 && b2 <= 0x95) || (b1 === 0x88 && b2 === 0x92) ? 3 : 0
}

/** The alternative right after a value ("or throw", ", and 5", "-terminated"): its end, or -1. */
const gateAlternativeEnd = (rest: string): i32 => {
  let j = gateResultSkip(rest, 0)
  const c = gateResultByte(rest, j)
  if (c === 0x2c || c === 0x3a || c === 0x3b || c === 0x28 || c === 0x5b) {
    // `c` is a byte of `rest` at `j`, so the offset after it is one of `rest`.
    j = gateResultSkip(rest, gateResultPlus(j, 1))
  }
  // A hyphen or a word found in `rest` from `j` ends at an offset of `rest`.
  const hyphen = gateHyphenAt(rest, j)
  if (hyphen > 0) {
    return gateResultPlus(j, hyphen)
  }
  const end = gateWordLeads(rest.substring(j, rest.length), "or|and|else|alternatively|either")
  return end >= 0 ? gateResultPlus(j, end) : -1
}

/** Whether the value's clause ends right after it: punctuation, the end, or a connective after a space. */
const gateClauseEnds = (rest: string): boolean => {
  const j = gateResultSkip(rest, 0)
  if (j === rest.length) {
    return true
  }
  const c = gateResultByte(rest, j)
  if (".,;:!?()[]".indexOf(gateResultAt(rest, j, 1)) >= 0 && c < 128) {
    return true
  }
  return j > 0 && gateWordLeads(rest, GATE_CLAUSE_GOES_ON) >= 0
}

/** The word right after a value, up to a space or punctuation. */
const gateNextWord = (rest: string): string => {
  let j = gateResultSkip(rest, 0)
  const from = j
  while (j < rest.length && " .,;:!?)]".indexOf(rest.substring(j, j + 1)) < 0) {
    j = j + 1
  }
  return rest.substring(from, j)
}

/** The tail up to its first . ! or ? that a space or the end follows. */
const gateClauseOf = (tail: string): string => {
  for (let i = 0; i < tail.length; i++) {
    const c = tail.charCodeAt(i)
    if ((c === 0x2e || c === 0x21 || c === 0x3f) && (i + 1 >= tail.length || tail.charCodeAt(i + 1) === 32)) {
      return tail.substring(0, i)
    }
  }
  return tail
}

/** Another result in a clause, case-sensitive: true, false or null (not `word`), or return…, yield…. */
const gateOtherResult = (clause: string, word: string): string => {
  for (let i = 0; i < clause.length; i++) {
    if (gateResultIsAlnum(gateResultByte(clause, i - 1)) || !gateResultIsAlnum(gateResultByte(clause, i))) {
      continue
    }
    let j = i
    while (j >= 0 && j < clause.length && gateResultIsAlnum(clause.charCodeAt(j))) {
      j++
    }
    const w = clause.substring(i, j)
    const result = (w === "true" || w === "false" || w === "null") && w !== word
    let lowerRun = true
    for (let k = 0; k < w.length; k++) {
      const c = w.charCodeAt(k)
      if (c < 97 || c > 122) {
        lowerRun = false
      }
    }
    if (result || (lowerRun && (w.startsWith("return") || w.startsWith("yield")))) {
      return w
    }
  }
  return ""
}

/** The text `found` names in `s`, gateWordFind's start and end; "" when it found nothing. */
const gateResultFound = (s: string, found: i32[]): string => (found.length > 1 ? s.substring(found[0], found[1]) : "")

/** Why the quote's occurrence at `p` of the prose does not state `word`; null when it does. */
const gateOccurrence = (p: GateProse, q: string, at: i32, word: string): string | null => {
  const text = p.text
  let why = `does not require "${word}" as the result (an affirmative MUST, SHALL or REQUIRED to, a result verb, then "${word}")`
  // The quote (never empty) is in the text at `at`, so `at` plus an offset
  // into it, or its length, is an offset of the text.
  const last = gateSpanAt(p, gateResultPlus(at, toI32(toI64(q.length) - toI64(1)))).end
  let i = 0
  while (i < q.length) {
    const end = gateStatementAt(q, i, word)
    if (end < 0) {
      i = i + 1
      continue
    }
    const from = gateResultPlus(at, i)
    const to = gateResultPlus(at, end)
    i = end
    const start = gateSpanAt(p, from).start
    const before = text.substring(start, from)
    const deny = gateWordFind(before, GATE_DENY)
    if (deny.length > 0) {
      // The denial is in `before`, which starts at `start`.
      if (deny.length > 1 && gateResultPlus(start, deny[1]) <= at) {
        const d = gateResultFound(before, deny)
        why = `is cut from a sentence that qualifies it before the quote ("${d}"), so the sentence does not require "${word}"`
      }
      continue
    }
    const rest = text.substring(to, text.length)
    const alt = gateAlternativeEnd(rest)
    if (alt >= 0) {
      why = `offers an alternative right after "${word}" ("${trim(rest.substring(0, alt))}"), so "${word}" is not the whole result`
      continue
    }
    if (!gateClauseEnds(rest)) {
      why = `continues past "${word}" ("${word} ${gateNextWord(rest)}"), so "${word}" is a word in a longer phrase, not the stated result (end the clause after it, or follow it with a condition such as "when …")`
      continue
    }
    // The statement ends after its keyword, so `to` is at least 1.
    const stop = gateSpanAt(p, toI32(toI64(to) - toI64(1))).end
    const tail = text.substring(to, last > stop ? last : stop)
    const retract = gateWordFind(tail, GATE_RETRACT)
    if (retract.length > 0) {
      why = `retracts "${word}" after stating it ("${gateResultFound(tail, retract)}")`
      continue
    }
    const clause = gateClauseOf(tail)
    const hedge = gateWordFind(clause, GATE_HEDGE)
    if (hedge.length > 0) {
      why = `hedges "${word}" after stating it ("${gateResultFound(clause, hedge)}"), so it is not the result each time`
      continue
    }
    const other = gateOtherResult(clause, word)
    if (other.length > 0) {
      why = `states another result after "${word}" ("${other}"), so "${word}" is not the whole result`
      continue
    }
    return null
  }
  return why
}

/**
 * Why a section does not state a vector's expected null, true or false; null
 * when it does (see the module comment for what stating it takes).
 *
 * @param c the contract
 * @param set its sources
 * @param k the vector
 * @param at where its args are printed, the section that must state it
 * @param sec that section
 * @param word "null", "true" or "false"
 * @returns why not, or null
 */
export const gateStatesResult = (
  c: Contract,
  set: SourceSet,
  k: Clause,
  at: Citation,
  sec: RfcSection,
  word: string,
): string | null => {
  const cited = at.source
  const src = cited !== null ? cited : set.main
  const loaded = sourceFind(set, at.source)
  if (loaded === null) {
    return `${k.id} cites a source that was not read`
  }
  const pr = gateProse(sec)
  const reasons: string[] = []
  let covered = false
  for (const r of c.requirements) {
    const own = r.source
    const rs = own !== null ? own : set.main
    if (k.covers.indexOf(r.id) < 0 || rs !== src) {
      continue
    }
    const rsec = rfcSection(loaded.doc, r.section)
    if (rsec === null || rsec.id !== sec.id) {
      continue
    }
    covered = true
    const q = rfcNormalize(r.quote)
    if (q.length === 0 || pr.text.indexOf(q) < 0) {
      reasons.push(`${r.id} is not in its prose (only in code, a blockquote or a table)`)
      continue
    }
    const text = pr.text
    let why: string | null = null
    let p = toI32(text.indexOf(q))
    while (p >= 0 && p < text.length && why === null) {
      why = gateOccurrence(pr, q, p, word)
      p = toI32(text.indexOf(q, p + 1))
    }
    if (why === null) {
      return null
    }
    reasons.push(`${r.id} ${why}`)
  }
  if (!covered) {
    return `${k.id} covers no requirement cited to it, so nothing there requires the result "${word}"`
  }
  return reasons.join("; ")
}

/**
 * The word a section must state for a vector's expected value: "null",
 * "true" or "false"; "" for any other value, which a section prints instead.
 *
 * @param lit the expected value
 * @returns the word, or ""
 */
export const gateResultWord = (lit: Literal | null): string => {
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
