/**
 * `spec/gates/coverage` — every binding requirement is checked by some
 * clause, and every clause checks the module under test. Covering a
 * requirement is a claim, so the clause making it must call a function of the
 * target module: a property whose assertion calls nothing, or only reference
 * functions (HMAC under HKDF), holds whatever the implementation does.
 */

import { CheckContext } from "../check"
import { ClauseKind, Requirement } from "../contract/types"
import { typeCallsIn } from "../contract/typing"
import { vocabIsBinding } from "../contract/vocab"
import { sourceMainId } from "../source/load"
import { gateFunction, gateTargets } from "./cite"
import { gateIssue, gateWarn } from "./note"

/** A requirement's citation in a message: `§2.2`, or `rfc2104 §2`. */
const gateCoverageCite = (ctx: CheckContext, r: Requirement): string => {
  const s = r.source
  return s === null || s === sourceMainId(ctx.contract) ? `§${r.section}` : `${s} §${r.section}`
}

/** Byte order of two names, for sorting. */
const gateCoverageOrder = (x: string, y: string): i32 => {
  // The common prefix decides; past it, the shorter name sorts first.
  for (let i = 0; i < x.length && i < y.length; i++) {
    const d = x.charCodeAt(i) - y.charCodeAt(i)
    if (d !== 0) {
      return d
    }
  }
  return x.length - y.length
}

/**
 * The coverage gate. It fills `ctx.coverage` with the clauses covering each
 * requirement, for the report.
 *
 * @param ctx the check's context, holding the contract
 * @returns each finding
 */
export const gateCoverage = (ctx: CheckContext): string[] => {
  const out: string[] = []
  const c = ctx.contract
  const g = "coverage"
  const cov = new Map<string, string[]>()
  for (const r of c.requirements) {
    const none: string[] = []
    cov.set(r.id, none)
  }
  for (const k of c.clauses) {
    for (const id of k.covers) {
      const list = cov.get(id)
      if (list === undefined) {
        gateIssue(ctx, out, g, k.id, `cites requirement "${id}", which the contract does not state`)
      } else if (list.indexOf(k.id) < 0) {
        list.push(k.id)
      }
    }
  }
  ctx.coverage = cov
  const rfc = c.sources === null ? "RFC " : ""
  for (const r of c.requirements) {
    const list = cov.get(r.id)
    if (list !== undefined && list.length > 0) {
      continue
    }
    if (vocabIsBinding(r.level)) {
      gateIssue(
        ctx,
        out,
        g,
        r.id,
        `${r.level} requirement (${rfc}${gateCoverageCite(ctx, r)}) is not checked by any clause`,
      )
    } else {
      gateWarn(ctx, g, r.id, `${r.level} requirement is not checked by any clause`)
    }
  }
  const targets = gateTargets(c)
  const module = c.target.module
  if (targets.length === 0) {
    gateIssue(
      ctx,
      out,
      g,
      "functions",
      `${module}, the module under test, declares no function, so no clause can test it`,
    )
  }
  let anyProperty = false
  for (const k of c.clauses) {
    if (k.kind === ClauseKind.Vector) {
      if (gateFunction(c, k.call) !== null && targets.indexOf(k.call) < 0) {
        gateIssue(
          ctx,
          out,
          g,
          k.id,
          `calls ${k.call}, a reference function, not a function of ${module}, the module under test, so it checks nothing here`,
        )
      }
      continue
    }
    anyProperty = true
    const a = k.assert
    const nothing: string[] = []
    const calls = a !== null ? typeCallsIn(a) : nothing
    if (calls.length === 0) {
      gateIssue(
        ctx,
        out,
        g,
        k.id,
        "the assertion calls none of the functions under test, so it holds whatever the implementation does and checks nothing",
      )
    } else if (!calls.some((f: string): boolean => targets.indexOf(f) >= 0)) {
      const sorted = calls.slice(0).sort(gateCoverageOrder)
      gateIssue(
        ctx,
        out,
        g,
        k.id,
        `the assertion calls only reference functions (${sorted.join(", ")}), none of ${module}, the module under test, so it checks nothing here`,
      )
    }
  }
  if (!anyProperty) {
    gateWarn(ctx, g, "clauses", "no property clauses: the contract checks only the RFC's own vectors")
  }
  return out
}
