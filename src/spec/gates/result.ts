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

import { asciiLower, split, trim } from "nish/text"
import { Citation, Clause, Contract, LitKind, Literal } from "../contract/types"
import { SourceSet, sourceFind } from "../source/load"
import { RfcSection, rfcNormalize, rfcSection } from "../source/rfc"
import { GATE_CLAUSE_GOES_ON, GATE_DENY, GATE_HEDGE, GATE_RETRACT, gateWordFind, gateWordLeads } from "./text"

/** The section's prose sentences, joined by one space, and where each is. */
class GateProse {
  text: string
  /** Start and end offsets, two per sentence. */
  spans: i32[]
  constructor() {
    this.text = ""
    this.spans = []
  }
}

const gateResultIsAlnum = (c: i32): boolean => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)

/** The byte at `i`, or -1 outside `s`. */
const gateResultByte = (s: string, i: i32): i32 => (i >= 0 && i < s.length ? s.charCodeAt(i) : -1)

/** Whether a sentence ends at `i` of normalized text: . ; ! ? then the end, or a space and a capital, quote or bracket. */
const gateSentenceEnds = (t: string, i: i32): boolean => {
  const c = gateResultByte(t, i)
  if (c !== 0x2e && c !== 0x3b && c !== 0x21 && c !== 0x3f) {
    return false
  }
  let j = i + 1
  while (gateResultByte(t, j) === 32) {
    j = j + 1
  }
  if (j === t.length) {
    return true
  }
  if (j === i + 1) {
    return false
  }
  const n = gateResultByte(t, j)
  return (n >= 65 && n <= 90) || n === 0x22 || n === 0x27 || n === 0x28 || n === 0x5b || t.substring(j, j + 3) === "“"
}

/** A section's prose: its lines without blockquotes, cut into paragraphs (the heading alone first) and sentences. */
const gateProse = (sec: RfcSection): GateProse => {
  const paras: string[][] = [[], []]
  for (let i = 0; i < sec.lines.length; i++) {
    const raw = sec.lines[i]
    const l = trim(raw).startsWith(">") ? "" : raw
    if (i === 0) {
      paras[0].push(l)
    } else if (trim(l).length === 0) {
      paras.push([])
    } else {
      paras[paras.length - 1].push(l)
    }
  }
  const sentences: string[] = []
  for (const para of paras) {
    const t = rfcNormalize(para.join("\n"))
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
  let at = 0
  for (const s of sentences) {
    if (s.length > 0) {
      kept.push(s)
      p.spans.push(at)
      p.spans.push(at + s.length)
      at = at + s.length + 1
    }
  }
  p.text = kept.join(" ")
  return p
}

/** The sentence span holding offset `i`: its start and end; [i, i] outside every one. */
const gateSpanAt = (p: GateProse, i: i32): i32[] => {
  for (let k = 0; k < p.spans.length; k += 2) {
    if (i >= p.spans[k] && i < p.spans[k + 1]) {
      return [p.spans[k], p.spans[k + 1]]
    }
  }
  return [i, i]
}

/** Where one of the phrases (separated by "|") matches `s` at `i`, case-sensitive, followed by spaces; -1 when none. */
const gatePhraseAt = (s: string, i: i32, phrases: string): i32 => {
  let start = i
  for (const ph of split(phrases, "|")) {
    const words = split(ph, " ")
    let j = start
    let ok = true
    for (let w = 0; w < words.length && ok; w++) {
      if (w > 0) {
        if (gateResultByte(s, j) !== 32) {
          ok = false
          break
        }
        while (gateResultByte(s, j) === 32) {
          j = j + 1
        }
      }
      if (s.substring(j, j + words[w].length) !== words[w]) {
        ok = false
      } else {
        j = j + words[w].length
      }
    }
    if (ok && gateResultByte(s, j) === 32) {
      while (gateResultByte(s, j) === 32) {
        j = j + 1
      }
      return j
    }
  }
  start = -1
  return start
}

/** Whether `c` is a backtick, a star or an underscore, which may wrap a value. */
const gateIsMark = (c: i32): boolean => c === 0x60 || c === 0x2a || c === 0x5f

/**
 * The affirmative statement of `word` starting at `i` of `q`: a keyword at a
 * word start, optionally "always", a result verb, then the value (in any
 * case, in code or emphasis) as a whole word. Its end, or -1.
 */
const gateStatementAt = (q: string, i: i32, word: string): i32 => {
  if (gateResultIsAlnum(gateResultByte(q, i - 1))) {
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
  while (gateIsMark(gateResultByte(q, j))) {
    j = j + 1
  }
  if (asciiLower(q.substring(j, j + word.length)) !== word) {
    return -1
  }
  j = j + word.length
  while (gateIsMark(gateResultByte(q, j))) {
    j = j + 1
  }
  return gateResultIsAlnum(gateResultByte(q, j)) ? -1 : j
}

/** Whether `s` at `i` starts a hyphen of any kind: -, U+2010 to U+2015, U+2212. */
const gateHyphenAt = (s: string, i: i32): boolean => {
  if (gateResultByte(s, i) === 0x2d || gateResultByte(s, i) === 0x2f) {
    return true
  }
  if (gateResultByte(s, i) !== 0xe2) {
    return false
  }
  const b1 = gateResultByte(s, i + 1)
  const b2 = gateResultByte(s, i + 2)
  return (b1 === 0x80 && b2 >= 0x90 && b2 <= 0x95) || (b1 === 0x88 && b2 === 0x92)
}

/** The alternative right after a value ("or throw", ", and 5", "-terminated"): its end, or -1. */
const gateAlternativeEnd = (rest: string): i32 => {
  let j = 0
  while (gateResultByte(rest, j) === 32) {
    j = j + 1
  }
  const c = gateResultByte(rest, j)
  if (c === 0x2c || c === 0x3a || c === 0x3b || c === 0x28 || c === 0x5b) {
    j = j + 1
    while (gateResultByte(rest, j) === 32) {
      j = j + 1
    }
  }
  if (gateHyphenAt(rest, j)) {
    return gateResultByte(rest, j) === 0xe2 ? j + 3 : j + 1
  }
  if (j > 0 && gateResultByte(rest, j - 1) !== 32 && gateResultAlnumStart(rest, j)) {
    const end = gateWordLeads(rest.substring(j, rest.length), "or|and|else|alternatively|either")
    return end >= 0 ? j + end : -1
  }
  const end = gateWordLeads(rest.substring(j, rest.length), "or|and|else|alternatively|either")
  return end >= 0 ? j + end : -1
}

/** Whether a letter or digit is at `j`. */
const gateResultAlnumStart = (s: string, j: i32): boolean => gateResultIsAlnum(gateResultByte(s, j))

/** Whether the value's clause ends right after it: punctuation, the end, or a connective after a space. */
const gateClauseEnds = (rest: string): boolean => {
  let j = 0
  while (gateResultByte(rest, j) === 32) {
    j = j + 1
  }
  if (j === rest.length) {
    return true
  }
  const c = gateResultByte(rest, j)
  if (".,;:!?()[]".indexOf(rest.substring(j, j + 1)) >= 0 && c < 128) {
    return true
  }
  return j > 0 && gateWordLeads(rest, GATE_CLAUSE_GOES_ON) >= 0
}

/** The word right after a value, up to a space or punctuation. */
const gateNextWord = (rest: string): string => {
  let j = 0
  while (gateResultByte(rest, j) === 32) {
    j = j + 1
  }
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
    if ((c === 0x2e || c === 0x21 || c === 0x3f) && (i + 1 === tail.length || tail.charCodeAt(i + 1) === 32)) {
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
    while (gateResultIsAlnum(gateResultByte(clause, j))) {
      j = j + 1
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

/** Why the quote's occurrence at `p` of the prose does not state `word`; null when it does. */
const gateOccurrence = (p: GateProse, q: string, at: i32, word: string): string | null => {
  const text = p.text
  let why = `does not require "${word}" as the result (an affirmative MUST, SHALL or REQUIRED to, a result verb, then "${word}")`
  const last = gateSpanAt(p, at + q.length - 1)[1]
  let i = 0
  while (i < q.length) {
    const end = gateStatementAt(q, i, word)
    if (end < 0) {
      i = i + 1
      continue
    }
    const from = at + i
    const to = at + end
    i = end
    const start = gateSpanAt(p, from)[0]
    const deny = gateWordFind(text.substring(start, from), GATE_DENY)
    if (deny.length > 0) {
      if (start + deny[1] <= at) {
        const d = text.substring(start + deny[0], start + deny[1])
        why = `is cut from a sentence that qualifies it before the quote ("${d}"), so the sentence does not require "${word}"`
      }
      continue
    }
    const stop = gateSpanAt(p, to - 1)[1]
    const rest = text.substring(to, last > stop ? last : stop)
    const alt = gateAlternativeEnd(rest)
    if (alt >= 0) {
      why = `offers an alternative right after "${word}" ("${trim(rest.substring(0, alt))}"), so "${word}" is not the whole result`
      continue
    }
    if (!gateClauseEnds(rest)) {
      why = `continues past "${word}" ("${word} ${gateNextWord(rest)}"), so "${word}" is a word in a longer phrase, not the stated result (end the clause after it, or follow it with a condition such as "when …")`
      continue
    }
    const retract = gateWordFind(rest, GATE_RETRACT)
    if (retract.length > 0) {
      why = `retracts "${word}" after stating it ("${rest.substring(retract[0], retract[1])}")`
      continue
    }
    const clause = gateClauseOf(rest)
    const hedge = gateWordFind(clause, GATE_HEDGE)
    if (hedge.length > 0) {
      why = `hedges "${word}" after stating it ("${clause.substring(hedge[0], hedge[1])}"), so it is not the result each time`
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
  let covered = 0
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
    covered = covered + 1
    const q = rfcNormalize(r.quote)
    if (q.length === 0 || pr.text.indexOf(q) < 0) {
      reasons.push(`${r.id} is not in its prose (only in code, a blockquote or a table)`)
      continue
    }
    let why: string | null = null
    let p = toI32(pr.text.indexOf(q))
    while (p >= 0 && why === null) {
      why = gateOccurrence(pr, q, p, word)
      p = toI32(pr.text.indexOf(q, p + 1))
    }
    if (why === null) {
      return null
    }
    reasons.push(`${r.id} ${why}`)
  }
  if (covered === 0) {
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
