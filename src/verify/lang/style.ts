/**
 * `verify/lang/style` — advisory checks that never gate a proof. The one
 * check today: a definitional ensures, which pins `result` to a computed
 * formula (`result == amount * rate`) and so restates the algorithm as spec.
 */

import { EXPR_BINOP, EXPR_VAR, LangExpr, Program } from "./ast"
import { RESULT_NAME } from "./check"
import { prettyMath } from "./pretty"

/** One advisory warning on an ensures clause. */
export class StyleWarning {
  /** The function the clause belongs to. */
  fn: string
  /** The clause's axiom. */
  axiomId: string
  /** The clause, in math style. */
  property: string
  /** What kind of warning: `definitional-ensures`. */
  kind: string
  /** What to do about it. */
  hint: string

  /**
   * Makes a warning.
   *
   * @param fn the function
   * @param axiomId the clause's axiom
   * @param property the clause in math style
   * @param kind the kind of warning
   * @param hint what to do about it
   */
  constructor(fn: string, axiomId: string, property: string, kind: string, hint: string) {
    this.fn = fn
    this.axiomId = axiomId
    this.property = property
    this.kind = kind
    this.hint = hint
  }
}

const styleIsResult = (e: LangExpr): boolean => e.kind === EXPR_VAR && e.name === RESULT_NAME

// A composite computes something: anything but a literal or a variable.
const styleIsComposite = (e: LangExpr): boolean => toI32(e.args.length) > 0 || e.kind > EXPR_VAR

const styleDefinitional = (e: LangExpr): boolean => {
  if (e.kind === EXPR_BINOP && e.op === "==") {
    const l = e.args[0]
    const r = e.args[1]
    if ((styleIsResult(l) && styleIsComposite(r)) || (styleIsResult(r) && styleIsComposite(l))) {
      return true
    }
  }
  for (const a of e.args) {
    if (styleDefinitional(a)) {
      return true
    }
  }
  return false
}

/**
 * Collects the advisory style warnings for a program.
 *
 * @param program a checked program
 * @returns one warning per definitional ensures clause
 */
export const collectStyleWarnings = (program: Program): StyleWarning[] => {
  const out: StyleWarning[] = []
  for (const fn of program.functions) {
    for (const c of fn.ensures) {
      if (styleDefinitional(c.expr)) {
        out.push(
          new StyleWarning(
            fn.name,
            c.axiomId,
            prettyMath(c.expr),
            "definitional-ensures",
            "This postcondition pins `result` to a full formula — the algorithm restated as spec. Keep it only if the formula itself is the requirement (a regulated fee, a published rate); otherwise prefer property axioms (bounds, monotonicity, conservation, error behavior) and let `vector diff` guard behavior between regenerations.",
          ),
        )
      }
    }
  }
  return out
}
