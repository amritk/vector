/**
 * `spec/gates/note` — how a gate records what it found. A gate returns one
 * message per finding (CheckGate), and writes a CheckNote beside it on the
 * context saying where the finding is; a warning is only a note, and never
 * fails the check.
 */

import { CheckContext, CheckNote } from "../check"

/**
 * Records a finding: a note on the context, and the message the gate returns.
 *
 * @param ctx the check's context
 * @param out the gate's findings, which the message is added to
 * @param gate the gate's name
 * @param at the id or field the finding is about
 * @param message what was found
 */
export const gateIssue = (ctx: CheckContext, out: string[], gate: string, at: string, message: string): void => {
  ctx.notes.push(new CheckNote(gate, at, message, false))
  out.push(`${at}: ${message}`)
}

/**
 * Records a warning, which the report shows and which never fails the check.
 *
 * @param ctx the check's context
 * @param gate the gate's name
 * @param at the id or field the warning is about
 * @param message what was found
 */
export const gateWarn = (ctx: CheckContext, gate: string, at: string, message: string): void => {
  ctx.notes.push(new CheckNote(gate, at, message, true))
}

/**
 * The warnings a check recorded.
 *
 * @param ctx the check's context
 * @returns its warning notes, in order
 */
export const gateWarnings = (ctx: CheckContext): CheckNote[] => ctx.notes.filter((n: CheckNote): boolean => n.warning)
