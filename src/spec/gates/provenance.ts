/**
 * `spec/gates/provenance` — every vector's expected value comes from
 * somewhere, and that holds. A `spec` source's section must state the null or
 * bool the vector expects. A `command` source must have printed it: until the
 * commands are run (`--run-sources`) the value is reported as unverified,
 * never as passed, and a command that failed or printed something else is a
 * finding. A `cite` source is the fidelity gate's.
 */

import { CheckContext, CheckSourceRun } from "../check"
import { Citation, Clause, ClauseKind, VectorSourceKind } from "../contract/types"
import { gateCitedSection, gatePlace, gateSources } from "./cite"
import { gateIssue, gateWarn } from "./note"
import { gateResultWord, gateStatesResult } from "./result"

const GATE_PROVENANCE: string = "provenance"

/** The run of a vector's command, or null when it was not run. */
const gateSourceRun = (ctx: CheckContext, id: string): CheckSourceRun | null => {
  for (const r of ctx.sourceRuns) {
    if (r.clause === id) {
      return r
    }
  }
  return null
}

/** A spec source's section states the vector's expected result. */
const gateSpecSource = (ctx: CheckContext, out: string[], k: Clause, section: string): void => {
  const g = GATE_PROVENANCE
  const set = gateSources(ctx, out, g)
  const at = `${k.id}.source`
  const sec = gateCitedSection(ctx, out, g, null, section, at)
  if (sec === null) {
    return
  }
  const cite = new Citation()
  cite.section = section
  const why = gateStatesResult(ctx.contract, set, k, cite, sec, gateResultWord(k.expect))
  if (why !== null) {
    const place = gatePlace(set, null, section)
    gateIssue(ctx, out, g, at, `${place} ("${sec.title}") does not state the expected result: ${why}`)
  }
}

/**
 * The provenance gate (see the module comment). It reads `ctx.sourceRuns`,
 * which the run-sources gate fills just before it.
 *
 * @param ctx the check's context, holding the contract
 * @returns each finding
 */
export const gateProvenance = (ctx: CheckContext): string[] => {
  const out: string[] = []
  const g = GATE_PROVENANCE
  for (const k of ctx.contract.clauses) {
    const s = k.source
    if (k.kind !== ClauseKind.Vector || s === null) {
      continue
    }
    if (s.kind === VectorSourceKind.Spec) {
      gateSpecSource(ctx, out, k, s.text)
    } else if (s.kind === VectorSourceKind.Command) {
      const run = gateSourceRun(ctx, k.id)
      const at = `${k.id}.source`
      if (run === null || run.outcome === "not run") {
        gateWarn(
          ctx,
          g,
          at,
          `source command not run (pass --run-sources): the expected value is unverified: $ ${s.text}`,
        )
      } else if (run.outcome !== "pass") {
        const detail = run.detail.length > 0 ? run.detail : "failed"
        gateIssue(ctx, out, g, at, `source command ${detail}: $ ${s.text}`)
      }
    }
  }
  return out
}
