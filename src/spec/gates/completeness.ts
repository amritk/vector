/**
 * `spec/gates/completeness` — every binding sentence of the main source is
 * accounted for. Each use of MUST, MUST NOT, SHALL, SHALL NOT or REQUIRED in
 * a section's own text must lie inside the quote of a requirement (which
 * coverage then forces a clause to test) or of an exclusion (which says why
 * it is not tested). So a contract cannot pass by leaving out the requirement
 * it would fail. An exclusion's quote must be in its section, and each one is
 * shown as a warning, so a reader sees what was left out.
 *
 * When the main source is XML (a spec's own, or an RFC's), a requirement
 * anchored on a blockquote that quotes another source
 * (`> … {{Section 3.1 of RFC4648}}` `{: #R-X gi="blockquote"}`) cites that
 * source's section, not the main one's. Its quote still accounts for its
 * words in the one main section that holds the blockquote anchored with its
 * id, and nowhere else. A requirement that cites the main source counts only
 * in the section it cites, wherever a blockquote with its id stands.
 */

import { jsonStringifyString } from "nish/json"
import { CheckContext } from "../check"
import { Exclusion } from "../contract/types"
import { LoadedSource, SourceSet, sourceFind } from "../source/load"
import { RfcSection, rfcNormalize, rfcOwnSpans } from "../source/rfc"
import { XmlDocument, xmlDocParse } from "../xml/doc"
import { XmlNode, xmlAttr, xmlElements } from "../xml/reader"
import { gateCiteLabel, gateCitedSection, gatePlace, gateQuoteMissing, gateSources } from "./cite"
import { gateIssue, gateWarn } from "./note"
import { gateKeywordName, gateKeywordUses, gateParagraphStarts, gateSentenceSpan } from "./text"

const GATE_COMPLETENESS: string = "completeness"

/** Whether a citation's source is the main one. */
const gateInMain = (set: SourceSet, source: string | null): boolean => source === null || source === set.main

/**
 * The quotes that account for one section of the main source: requirements'
 * and exclusions' cited to it, and the quotes of requirements anchored on a
 * blockquote that stands in it (`placed`, by id) whatever source they cite.
 */
const gateSectionQuotes = (
  ctx: CheckContext,
  set: SourceSet,
  placed: Map<string, string>,
  section: string,
): string[] => {
  const out: string[] = []
  for (const r of ctx.contract.requirements) {
    const main = gateInMain(set, r.source)
    if ((main && r.section === section) || (!main && (placed.get(r.id) ?? "") === section)) {
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

/** Whether two readings of a document hold the same sections, with the same own text. */
const gateSameSections = (a: RfcSection[], b: RfcSection[]): boolean => {
  if (a.length !== b.length) {
    return false
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].ownLines.join("\n") !== b[i].ownLines.join("\n")) {
      return false
    }
  }
  return true
}

/** Each anchored blockquote under `n`, by anchor, into `out` with the numbered section around it. */
const gateQuoteWalk = (doc: XmlDocument, n: XmlNode, out: Map<string, string>): void => {
  for (const k of xmlElements(n)) {
    const anchor = xmlAttr(k, "anchor")
    if (k.name === "blockquote" && anchor !== null) {
      let up: XmlNode | null = k.parent
      while (up !== null && up.name !== "section") {
        up = up.parent
      }
      const sa: string | null = up !== null ? xmlAttr(up, "anchor") : null
      if (sa !== null) {
        const id = doc.sectionByAnchor.get(sa)
        if (id !== undefined) {
          out.set(anchor, id)
        }
      }
    }
    gateQuoteWalk(doc, k, out)
  }
}

/**
 * The numbered section of the main source each anchored blockquote stands
 * in, by anchor. Only RFC XML has blockquotes to read: for any other source,
 * one that does not read as XML, or one whose sections no longer read as the
 * gates loaded them, it is empty, and no quote of another source counts.
 */
const gateQuoteSections = (main: LoadedSource): Map<string, string> => {
  const out = new Map<string, string>()
  const text = readFileSyncOrNull(main.file)
  if (text === null) {
    return out
  }
  const parsed = xmlDocParse(text)
  if (parsed.isErr() || !gateSameSections(parsed.value.sections, main.doc.sections)) {
    return out
  }
  gateQuoteWalk(parsed.value, parsed.value.root, out)
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
const gateSectionComplete = (
  ctx: CheckContext,
  out: string[],
  set: SourceSet,
  placed: Map<string, string>,
  sec: RfcSection,
): void => {
  const text = rfcNormalize(sec.ownLines.join("\n"))
  const uses = gateKeywordUses(text)
  if (uses.length === 0) {
    return
  }
  const paras = gateParagraphStarts(sec.ownLines)
  const spans: i32[] = []
  for (const q of gateSectionQuotes(ctx, set, placed, sec.id)) {
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
 * source: a contract quotes other sources for what it needs, not whole, and
 * a quote of one counts in the main source only where its blockquote stands.
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
  const placed = gateQuoteSections(main)
  for (const sec of main.doc.sections) {
    gateSectionComplete(ctx, out, set, placed, sec)
  }
  return out
}
