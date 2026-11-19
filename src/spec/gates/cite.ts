/**
 * `spec/gates/cite` — what the gates that read a contract's sources share:
 * reading them once a run, finding the section a citation names, and naming
 * a citation in a message ("RFC §2.2" in the main RFC, "rfc2104 §2" in
 * another source).
 */

import { jsonStringifyString } from "nish/json"
import { CheckContext } from "../check"
import { Citation, Clause, Contract, FnSig } from "../contract/types"
import { hiddenText } from "../source/hidden"
import { LoadedSource, SourceSet, sourceFind, sourceLoadWith } from "../source/load"
import { RfcSection, rfcNormalize, rfcSection, rfcSectionText } from "../source/rfc"
import { gateIssue } from "./note"

/**
 * The contract's sources, read on the first call of a run. The call that
 * reads them reports each source that could not be read, under its gate, so
 * that nothing citing it passes unchecked unnoticed.
 *
 * @param ctx the check's context
 * @param out the calling gate's findings
 * @param gate the calling gate's name
 * @returns the sources read
 */
export const gateSources = (ctx: CheckContext, out: string[], gate: string): SourceSet => {
  const have = ctx.sources
  if (have !== null) {
    return have
  }
  const set = sourceLoadWith(ctx.contract, ctx.contractPath, ctx.root, ctx.readers)
  for (const p of set.problems) {
    gateIssue(ctx, out, gate, "sources", `${p}, so nothing citing it can be checked`)
  }
  // `--spec` never swaps the file read: it only asserts which one that is, so
  // the confinement and the pins above still decide what is trusted.
  const spec = ctx.specPath
  const main = sourceFind(set, null)
  const real: string | null = spec === null ? null : realpathSync(spec)
  if (spec !== null && main !== null && (real === null || real !== main.file)) {
    gateIssue(ctx, out, gate, "sources", `--spec ${spec} is not ${main.label}, the main source the contract records`)
  }
  ctx.sources = set
  return set
}

/** The id a citation's source resolves to: its own, or the main source's. */
const gateSourceId = (set: SourceSet, source: string | null): string => (source !== null ? source : set.main)

/**
 * A citation in a message: `§2.2` in the main source, `rfc2104 §2` in another.
 *
 * @param set the contract's sources
 * @param source the source the citation names; null for the main one
 * @param section the section it names
 * @returns the label
 */
export const gateCiteLabel = (set: SourceSet, source: string | null, section: string): string => {
  const id = gateSourceId(set, source)
  return id === set.main ? `§${section}` : `${id} §${section}`
}

/**
 * Where a citation points, for a message: `RFC §2.2` when it is in the main
 * source and that is an RFC, else the label alone.
 *
 * @param set the contract's sources
 * @param source the source the citation names; null for the main one
 * @param section the section it names
 * @returns the place
 */
export const gatePlace = (set: SourceSet, source: string | null, section: string): string => {
  const label = gateCiteLabel(set, source, section)
  const main = sourceFind(set, null)
  return gateSourceId(set, source) === set.main && main !== null && main.doc.number >= 1 ? `RFC ${label}` : label
}

/**
 * The section a citation names. A source that was not read gives null
 * silently (gateSources reported it); a section its source lacks is a
 * finding.
 *
 * @param ctx the check's context
 * @param out the gate's findings
 * @param gate the gate's name
 * @param source the source the citation names; null for the main one
 * @param section the section it names
 * @param at what the finding is about
 * @returns the section, or null
 */
export const gateCitedSection = (
  ctx: CheckContext,
  out: string[],
  gate: string,
  source: string | null,
  section: string,
  at: string,
): RfcSection | null => {
  const set = gateSources(ctx, out, gate)
  const src = sourceFind(set, source)
  if (src === null) {
    return null
  }
  const sec = rfcSection(src.doc, section)
  if (sec === null) {
    gateIssue(ctx, out, gate, at, `${gateDocName(src)} has no section ${section}`)
  }
  return sec
}

/** A source in a message: `RFC 5869`, or `source "spec"`. */
const gateDocName = (src: LoadedSource): string =>
  src.doc.number >= 1 ? `RFC ${src.doc.number}` : `source "${src.id}"`

/** Whether a byte is part of a word: a letter, a digit, `_` or any non-ASCII byte. */
const gateIsWordChar = (c: i32): boolean =>
  (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c >= 128

/** Whether a byte is a digit. */
const gateIsDigitChar = (c: i32): boolean => c >= 48 && c <= 57

/**
 * Whether a quote's edge at an offset continues the text across it: a word
 * character on both sides, or a digit, then `.` or `,`, then a digit, as in
 * "1.5" cut to "5".
 *
 * @param text the text
 * @param inner the offset of the quote's edge character
 * @param outer the offset of the text's character beside it
 * @param step 1 when outer is after inner, -1 when before
 */
const gateCutsAt = (text: string, inner: i32, outer: i32, step: i32): boolean => {
  if (outer < 0 || outer >= text.length) {
    return false
  }
  const a = text.charCodeAt(inner)
  const b = text.charCodeAt(outer)
  if (gateIsWordChar(a) && gateIsWordChar(b)) {
    return true
  }
  const past = outer + step
  return (
    gateIsDigitChar(a) &&
    (b === 46 || b === 44) &&
    past >= 0 &&
    past < text.length &&
    gateIsDigitChar(text.charCodeAt(past))
  )
}

/**
 * Whether a quote is printed in a text as whole words somewhere: at some
 * occurrence, neither its first character nor its last continues a word of
 * the text around it. "MUST" inside "MUSTARD", "LEN" inside "K_LEN",
 * "5" cut from "1.5", or "ust not" cut from "must not", is not a quote of
 * the text.
 *
 * @param text the text, whitespace collapsed
 * @param q the quote, whitespace collapsed and non-empty
 * @returns true when some occurrence is word-bounded
 */
export const gateQuoteWhole = (text: string, q: string): boolean => {
  let at = toI32(text.indexOf(q))
  while (at >= 0) {
    const end = at + q.length
    if (!gateCutsAt(text, at, at - 1, -1) && !gateCutsAt(text, end - 1, end, 1)) {
      return true
    }
    at = toI32(text.indexOf(q, at + 1))
  }
  return false
}

/**
 * Why a quote is not in a section, verbatim with whitespace collapsed:
 * empty, holding text a reader cannot see, not printed there, or printed
 * only as part of a word.
 *
 * @param sec the section
 * @param quote the quote
 * @returns the reason, or null when the section prints it
 */
export const gateQuoteMissing = (sec: RfcSection, quote: string): string | null => {
  const hidden = hiddenText(quote)
  if (hidden.length > 0) {
    return `the quote holds text a reader cannot see: ${hidden[0]}`
  }
  const q = rfcNormalize(quote)
  if (q.length === 0) {
    return "the quote is empty"
  }
  const text = rfcSectionText(sec)
  if (text.indexOf(q) < 0) {
    return "quote not found"
  }
  return gateQuoteWhole(text, q) ? null : `the quote starts or ends inside a word: ${jsonStringifyString(q)}`
}

/**
 * The functions of the module under test: those with no `module`, or the
 * target's.
 *
 * @param c the contract
 * @returns their names
 */
export const gateTargets = (c: Contract): string[] => {
  const out: string[] = []
  for (const f of c.functions) {
    const m = f.module
    if (m === null || m === c.target.module) {
      out.push(f.name)
    }
  }
  return out
}

/**
 * A function a contract declares, by name.
 *
 * @param c the contract
 * @param name the name
 * @returns the function, or null
 */
export const gateFunction = (c: Contract, name: string): FnSig | null => {
  for (const f of c.functions) {
    if (f.name === name) {
      return f
    }
  }
  return null
}

/**
 * Where a vector's args are printed: its cited section, or its `section`
 * when a command or the spec vouches for its result, in the source
 * `sectionSource` names (the main one when it names none).
 *
 * @param k the vector
 * @returns the citation
 */
export const gateArgsAt = (k: Clause): Citation => {
  const src = k.source
  const cite: Citation | null = src !== null ? src.cite : null
  if (cite !== null) {
    return cite
  }
  const at = new Citation()
  at.source = k.sectionSource
  const sec = k.section
  at.section = sec !== null ? sec : ""
  return at
}
