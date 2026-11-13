/**
 * `spec/gates/ids` — the ids gate: every requirement, function and clause id
 * is unique, so a citation or a call names exactly one thing.
 */

import { CheckContext } from "../check"
import { Clause, FnSig, Requirement } from "../contract/types"
import { gateIssue } from "./note"

/** Records each id of `ids` already seen, as a finding of `what`. */
const gateIdsUnique = (ctx: CheckContext, out: string[], what: string, ids: string[]): void => {
  const seen = new Map<string, boolean>()
  for (const id of ids) {
    if (seen.has(id)) {
      gateIssue(ctx, out, "ids", id, `duplicate ${what} id "${id}"`)
    }
    seen.set(id, true)
  }
}

/**
 * The ids gate: a requirement, function or clause id given twice.
 *
 * @param ctx the check's context, holding the contract
 * @returns one finding per repeated id
 */
export const gateIds = (ctx: CheckContext): string[] => {
  const out: string[] = []
  const c = ctx.contract
  gateIdsUnique(
    ctx,
    out,
    "requirement",
    c.requirements.map((r: Requirement): string => r.id),
  )
  gateIdsUnique(
    ctx,
    out,
    "function",
    c.functions.map((f: FnSig): string => f.name),
  )
  gateIdsUnique(
    ctx,
    out,
    "clause",
    c.clauses.map((k: Clause): string => k.id),
  )
  return out
}
