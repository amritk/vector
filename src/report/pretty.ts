import type { BinOp, Expr } from "../lang/ast.ts";

// Renders vector-lang expressions for humans: "math" style for the dashboard and
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
  // min/max render as function calls (atoms), never infix; these are unused.
  min: 10,
  max: 10,
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
  min: "min",
  max: "max",
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
  min: "min",
  max: "max",
};

// Function-style operators (rendered `f(a, b)` / `Math.f(a, b)`, not infix).
const CALL_UNOPS: Record<"abs" | "floor" | "ceil", string> = {
  abs: "abs",
  floor: "floor",
  ceil: "ceil",
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
      if (expr.op === "abs" || expr.op === "floor" || expr.op === "ceil") {
        const name = CALL_UNOPS[expr.op];
        const fn = style === "ts" ? `Math.${name}` : name;
        return `${fn}(${render(expr.arg, 0, style)})`;
      }
      const token = expr.op === "not" ? (style === "ts" ? "!" : "¬") : "-";
      const prec = expr.op === "not" ? PREC_NOT : PREC_NEG;
      const child = render(expr.arg, prec + 1, style);
      // Separate a leading "-" so `neg(-3)` is `- -3` (valid), not `--3`
      // (parsed as pre-decrement — invalid TS and misleading math).
      const sep = child.startsWith("-") ? " " : "";
      return wrap(`${token}${sep}${child}`, prec, parentPrec);
    }
    case "binop": {
      if (expr.op === "min" || expr.op === "max") {
        const fn = style === "ts" ? `Math.${expr.op}` : expr.op;
        return `${fn}(${render(expr.left, 0, style)}, ${render(expr.right, 0, style)})`;
      }
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
