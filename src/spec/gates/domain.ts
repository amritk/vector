/**
 * `spec/gates/domain` — every property's domain is inhabited, and its inputs
 * are chosen. Each property is sampled (spec/sample/property): Z3's
 * boundaries in its integer skeleton, then seeded random draws, all filtered
 * by `where`. A property no input satisfies would hold vacuously, so it is a
 * finding; so is one whose variables cannot be sampled or whose `where`
 * cannot be evaluated. When Z3 cannot run or rejects the script, the run is
 * refused and `ctx.toolFailure` says why, so the command exits 2: unknown is
 * never read as either answer.
 */

import { CheckContext, checkAddSample } from "../check"
import { ClauseKind } from "../contract/types"
import { sampleProperty } from "../sample/property"
import { gateIssue } from "./note"

const GATE_DOMAIN: string = "domain"

/**
 * The domain gate (see the module comment). It adds each property's samples
 * to `ctx.samples` and its stats to `ctx.sampleStats`.
 *
 * @param ctx the check's context, holding the contract
 * @returns each finding
 */
export const gateDomain = (ctx: CheckContext): string[] => {
  const out: string[] = []
  const c = ctx.contract
  for (const k of c.clauses) {
    if (k.kind !== ClauseKind.Property) {
      continue
    }
    const r = sampleProperty(c.contract, k)
    if (r.isErr()) {
      ctx.toolFailure = r.error
      gateIssue(ctx, out, GATE_DOMAIN, k.id, `cannot be sampled: ${r.error}`)
      return out
    }
    const o = r.value
    for (const s of o.samples) {
      checkAddSample(ctx.samples, s)
    }
    ctx.sampleStats.push(o.stat)
    const issue = o.issue
    if (issue !== null) {
      gateIssue(ctx, out, GATE_DOMAIN, k.id, issue)
    }
  }
  return out
}
