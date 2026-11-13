/**
 * `spec/gates/completeness` — every binding sentence of the main source is
 * accounted for. Each use of MUST, MUST NOT, SHALL, SHALL NOT or REQUIRED in
 * a section's own text must lie inside the quote of a requirement (which
 * coverage then forces a clause to test) or of an exclusion (which says why
 * it is not tested). So a contract cannot pass by leaving out the requirement
 * it would fail. An exclusion's quote must be in its section, and each one is
 * shown as a warning, so a reader sees what was left out.
 */

import { jsonStringifyString } from "nish/json"
import { CheckContext } from "../check"
import { Exclusion } from "../contract/types"
import { SourceSet, sourceFind } from "../source/load"
import { RfcSection, rfcNormalize, rfcOwnSpans } from "../source/rfc"
import { gateCiteLabel, gateCitedSection, gatePlace, gateQuoteMissing, gateSources } from "./cite"
import { gateIssue, gateWarn } from "./note"
import { gateKeywordName, gateKeywordUses, gateParagraphStarts, gateSentenceSpan } from "./text"

const GATE_COMPLETENESS: string = "completeness"

/** Whether a citation's source is the main one. */
const gateInMain = (set: SourceSet, source: string | null): boolean => source === null || source === set.main

/** The quotes cited to one section of the main source: requirements' and exclusions'. */
const gateSectionQuotes = (ctx: CheckContext, set: SourceSet, section: string): string[] => {
  const out: string[] = []
  for (const r of ctx.contract.requirements) {
    if (r.section === section && gateInMain(set, r.source)) {
      out.push(r.quote)
    }
  }
  const ex = ctx.contract.exclusions
  if (ex !== null) {
    for (const x of ex) {
      if (x.section === section && gateInMain(set, x.source)) {
        out.push(x.quote)
      }
    }
  }
  return out
}

/** Whether one of the spans, two numbers a span, holds all of [start, end). */
const gateSpanHolds = (spans: i32[], start: i32, end: i32): boolean => {
  for (let i = 0; i + 1 < spans.length; i += 2) {
    if (spans[i] <= start && end <= spans[i + 1]) {
      return true
    }
  }
  return false
}

/**
 * Where the sentence around an offset starts, stops and ends in a section's
 * own text, as gateSentenceSpan bounds it: without a list bullet, or the
 * section's heading before it when the heading shares its paragraph, and
 * without its terminator (which a quote may leave out) before `stop`.
 */
const gateSentenceBounds = (sec: RfcSection, text: string, paras: i32[], at: i32): i32[] => {
  const b = gateSentenceSpan(text, paras, at)
  let start = b[0]
  const head = `${rfcNormalize(sec.title)} `
  const first = paras.length > 0 ? paras[0] : text.length
  if (start > 0 && start < first && text.substring(start).startsWith(head)) {
    start = start + head.length
  }
  return [start, b[1], b[2]]
}

/** Each exclusion's quote is in its section; each one found is a warning. */
const gateExclusions = (ctx: CheckContext, out: string[], set: SourceSet, ex: Exclusion[]): void => {
  const g = GATE_COMPLETENESS
  for (const x of ex) {
    const where = `exclusion ${gateCiteLabel(set, x.source, x.section)}`
    const sec = gateCitedSection(ctx, out, g, x.source, x.section, where)
    if (sec === null) {
      continue
    }
    const why = gateQuoteMissing(sec, x.quote)
    if (why === null) {
      gateWarn(ctx, g, gateCiteLabel(set, x.source, x.section), `excluded: ${x.reason}`)
    } else if (why === "quote not found") {
      const place = gatePlace(set, x.source, x.section)
      gateIssue(ctx, out, g, where, `quote not found in ${place} ("${sec.title}"): ${jsonStringifyString(x.quote)}`)
    } else {
      gateIssue(ctx, out, g, where, why)
    }
  }
}

/** Every binding keyword in a section's own text lies inside some quote cited to it. */
const gateSectionComplete = (ctx: CheckContext, out: string[], set: SourceSet, sec: RfcSection): void => {
  const text = rfcNormalize(sec.ownLines.join("\n"))
  const uses = gateKeywordUses(text)
  if (uses.length === 0) {
    return
  }
  const paras = gateParagraphStarts(sec.ownLines)
  const spans: i32[] = []
  for (const q of gateSectionQuotes(ctx, set, sec.id)) {
    for (const s of rfcOwnSpans(sec, q)) {
      spans.push(s)
    }
  }
  for (let i = 0; i + 1 < uses.length; i += 2) {
    const b = gateSentenceBounds(sec, text, paras, uses[i])
    if (!gateSpanHolds(spans, b[0], b[1])) {
      const sentence = text.substring(b[0], b[2])
      gateIssue(
        ctx,
        out,
        GATE_COMPLETENESS,
        `§${sec.id}`,
        `${gateKeywordName(uses[i + 1])} sentence is neither a requirement nor an exclusion: ${jsonStringifyString(sentence)}`,
      )
    }
  }
}

/**
 * The completeness gate (see the module comment). It reads only the main
 * source: a contract quotes other sources for what it needs, not whole.
 *
 * @param ctx the check's context, holding the contract
 * @returns each finding
 */
export const gateCompleteness = (ctx: CheckContext): string[] => {
  const out: string[] = []
  const set = gateSources(ctx, out, GATE_COMPLETENESS)
  const ex = ctx.contract.exclusions
  if (ex !== null) {
    gateExclusions(ctx, out, set, ex)
  }
  const main = sourceFind(set, null)
  if (main === null) {
    return out
  }
  for (const sec of main.doc.sections) {
    gateSectionComplete(ctx, out, set, sec)
  }
  return out
}
