import { prettyExpr } from "../report/pretty.ts";
import type { Expr, Program } from "./ast.ts";
import { RESULT_NAME } from "./ast.ts";

// Advisory style checks for contract-driven development. These never gate a
// proof — they exist to keep contracts reviewable as *intent* rather than
// drifting into a second copy of the implementation.
//
// The one check today: a "definitional" ensures pins `result` to a computed
// formula (`result == amount * rate`). That is sometimes exactly right — the
// formula IS the requirement (a regulated fee, a published rate) — but as a
// habit it turns the SpecPlan into code by another name. Property-shaped
// axioms (bounds, monotonicity, conservation, error behavior) stay at
// ticket granularity, and `vector --diff` carries behavioral stability
// between regenerations instead.

export interface StyleWarning {
  function: string;
  axiomId: string;
  /** The offending clause, pretty-printed. */
  property: string;
  kind: "definitional-ensures";
  hint: string;
}

/** True when the expression computes something (vs a bare literal/variable). */
const isComposite = (expr: Expr): boolean =>
  expr.kind === "unop" ||
  expr.kind === "binop" ||
  expr.kind === "ite" ||
  expr.kind === "call";

const isResultVar = (expr: Expr): boolean =>
  expr.kind === "var" && expr.name === RESULT_NAME;

/** Any `result == <computed formula>` node in the tree (incl. under implies/ite). */
function containsDefinitionalEq(expr: Expr): boolean {
  switch (expr.kind) {
    case "num":
    case "bool":
    case "var":
      return false;
    case "unop":
      return containsDefinitionalEq(expr.arg);
    case "binop":
      if (
        expr.op === "==" &&
        ((isResultVar(expr.left) && isComposite(expr.right)) ||
          (isResultVar(expr.right) && isComposite(expr.left)))
      ) {
        return true;
      }
      return (
        containsDefinitionalEq(expr.left) || containsDefinitionalEq(expr.right)
      );
    case "ite":
      return (
        containsDefinitionalEq(expr.cond) ||
        containsDefinitionalEq(expr.then) ||
        containsDefinitionalEq(expr.else)
      );
    case "call":
      return expr.args.some(containsDefinitionalEq);
  }
}

export function collectStyleWarnings(program: Program): StyleWarning[] {
  const warnings: StyleWarning[] = [];
  for (const fn of program.functions) {
    for (const clause of fn.ensures) {
      if (containsDefinitionalEq(clause.expr)) {
        warnings.push({
          function: fn.name,
          axiomId: clause.axiomId,
          property: prettyExpr(clause.expr, "math"),
          kind: "definitional-ensures",
          hint: "This postcondition pins `result` to a full formula — the algorithm restated as spec. Keep it only if the formula itself is the requirement (a regulated fee, a published rate); otherwise prefer property axioms (bounds, monotonicity, conservation, error behavior) and let `vector --diff` guard behavior between regenerations.",
        });
      }
    }
  }
  return warnings;
}
