import type { BinOp, Expr } from "../lang/ast.ts";

// Renders EWD-lang expressions for humans: "math" style for the dashboard and
// counterexample feedback, "ts" style for emitted TypeScript source.

export type PrettyStyle = "math" | "ts";

const PREC: Record<BinOp, number> = {
  implies: 1,
  or: 2,
  and: 3,
  "==": 5,
  "!=": 5,
  "<": 5,
  "<=": 5,
  ">": 5,
  ">=": 5,
  "+": 6,
  "-": 6,
  "*": 7,
  "/": 7,
};
const PREC_NOT = 4;
const PREC_NEG = 8;
const PREC_ATOM = 10;

const MATH_OPS: Record<BinOp, string> = {
  and: "∧",
  or: "∨",
  implies: "⇒",
  "==": "==",
  "!=": "!=",
  "<": "<",
  "<=": "<=",
  ">": ">",
  ">=": ">=",
  "+": "+",
  "-": "-",
  "*": "*",
  "/": "/",
};

const TS_OPS: Record<Exclude<BinOp, "implies">, string> = {
  and: "&&",
  or: "||",
  "==": "===",
  "!=": "!==",
  "<": "<",
  "<=": "<=",
  ">": ">",
  ">=": ">=",
  "+": "+",
  "-": "-",
  "*": "*",
  "/": "/",
};

export function prettyExpr(expr: Expr, style: PrettyStyle = "math"): string {
  return render(expr, 0, style);
}

function render(expr: Expr, parentPrec: number, style: PrettyStyle): string {
  switch (expr.kind) {
    case "num":
      return expr.value.startsWith("-") && parentPrec >= PREC_ATOM
        ? `(${expr.value})`
        : expr.value;
    case "bool":
      return String(expr.value);
    case "var":
      return expr.name;
    case "unop": {
      const token = expr.op === "not" ? (style === "ts" ? "!" : "¬") : "-";
      const prec = expr.op === "not" ? PREC_NOT : PREC_NEG;
      return wrap(
        `${token}${render(expr.arg, prec + 1, style)}`,
        prec,
        parentPrec,
      );
    }
    case "binop": {
      if (style === "ts" && expr.op === "implies") {
        // TS has no implication operator; desugar to !a || b.
        const desugared: Expr = {
          kind: "binop",
          op: "or",
          left: { kind: "unop", op: "not", arg: expr.left },
          right: expr.right,
        };
        return render(desugared, parentPrec, style);
      }
      const prec = PREC[expr.op];
      const rightAssoc = expr.op === "implies";
      const left = render(expr.left, rightAssoc ? prec + 1 : prec, style);
      const right = render(expr.right, rightAssoc ? prec : prec + 1, style);
      const token =
        style === "ts"
          ? TS_OPS[expr.op as Exclude<BinOp, "implies">]
          : MATH_OPS[expr.op];
      return wrap(`${left} ${token} ${right}`, prec, parentPrec);
    }
    case "ite":
      return `(${render(expr.cond, 0, style)} ? ${render(expr.then, 0, style)} : ${render(expr.else, 0, style)})`;
    case "call":
      return `${expr.fn}(${expr.args.map((a) => render(a, 0, style)).join(", ")})`;
  }
}

function wrap(text: string, prec: number, parentPrec: number): string {
  return prec < parentPrec ? `(${text})` : text;
}
