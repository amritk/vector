/**
 * `verify/lang/pretty` — renders vector-lang expressions for people: the
 * `math` style for the dashboard and feedback (`∧`, `∨`, `⇒`, `¬`), and the
 * `ts` style for emitted TypeScript (`&&`, `===`, `Math.abs`), with only the
 * parentheses precedence needs.
 */

import { EXPR_BINOP, EXPR_BOOL, EXPR_CALL, EXPR_ITE, EXPR_NUM, EXPR_UNOP, EXPR_VAR, LangExpr } from "./ast"

// `!` and unary `-` bind tighter than every infix operator, as in JS.
const PRETTY_PREC_UNARY: i32 = 8
const PRETTY_PREC_ATOM: i32 = 10

const prettyPrec = (op: string): i32 => {
  if (op === "implies") {
    return 1
  }
  if (op === "or") {
    return 2
  }
  if (op === "and") {
    return 3
  }
  if (op === "+" || op === "-") {
    return 6
  }
  if (op === "*" || op === "/") {
    return 7
  }
  return 5
}

const prettyToken = (op: string, ts: boolean): string => {
  if (op === "and") {
    return ts ? "&&" : "∧"
  }
  if (op === "or") {
    return ts ? "||" : "∨"
  }
  if (op === "implies") {
    return "⇒"
  }
  if (ts && op === "==") {
    return "==="
  }
  if (ts && op === "!=") {
    return "!=="
  }
  return op
}

const prettyWrap = (text: string, prec: i32, parentPrec: i32): string => (prec < parentPrec ? `(${text})` : text)

const prettyRender = (e: LangExpr, parentPrec: i32, ts: boolean): string => {
  if (e.kind === EXPR_NUM) {
    return e.value.startsWith("-") && parentPrec >= PRETTY_PREC_ATOM ? `(${e.value})` : e.value
  }
  if (e.kind === EXPR_BOOL) {
    return e.value
  }
  if (e.kind === EXPR_VAR) {
    return e.name
  }
  if (e.kind === EXPR_UNOP) {
    if (e.op === "abs" || e.op === "floor" || e.op === "ceil") {
      return `${ts ? "Math." : ""}${e.op}(${prettyRender(e.args[0], 0, ts)})`
    }
    const token = e.op === "not" ? (ts ? "!" : "¬") : "-"
    const child = prettyRender(e.args[0], PRETTY_PREC_UNARY + 1, ts)
    // `neg(-3)` is `- -3`, never `--3`, which JS reads as a decrement.
    const sep = child.startsWith("-") ? " " : ""
    return prettyWrap(`${token}${sep}${child}`, PRETTY_PREC_UNARY, parentPrec)
  }
  if (e.kind === EXPR_BINOP) {
    const l = e.args[0]
    const r = e.args[1]
    if (e.op === "min" || e.op === "max") {
      return `${ts ? "Math." : ""}${e.op}(${prettyRender(l, 0, ts)}, ${prettyRender(r, 0, ts)})`
    }
    if (ts && e.op === "implies") {
      // TypeScript has no implication: `a ⇒ b` is `!a || b`.
      const not = new LangExpr(EXPR_UNOP, "not", "", "", [l])
      return prettyRender(new LangExpr(EXPR_BINOP, "or", "", "", [not, r]), parentPrec, ts)
    }
    const prec = prettyPrec(e.op)
    const rightAssoc = e.op === "implies"
    const left = prettyRender(l, rightAssoc ? prec + 1 : prec, ts)
    const right = prettyRender(r, rightAssoc ? prec : prec + 1, ts)
    return prettyWrap(`${left} ${prettyToken(e.op, ts)} ${right}`, prec, parentPrec)
  }
  if (e.kind === EXPR_ITE) {
    return `(${prettyRender(e.args[0], 0, ts)} ? ${prettyRender(e.args[1], 0, ts)} : ${prettyRender(e.args[2], 0, ts)})`
  }
  if (e.kind === EXPR_CALL) {
    const parts: string[] = []
    for (const a of e.args) {
      parts.push(prettyRender(a, 0, ts))
    }
    return `${e.name}(${parts.join(", ")})`
  }
  return "?"
}

/**
 * Renders an expression in math style, for the dashboard and feedback.
 *
 * @param e the expression
 * @returns its text, such as `result >= 0 ∧ result <= amount`
 */
export const prettyMath = (e: LangExpr): string => prettyRender(e, 0, false)

/**
 * Renders an expression as TypeScript, for emitted code.
 *
 * @param e the expression
 * @returns its text, such as `result >= 0 && result <= amount`
 */
export const prettyTs = (e: LangExpr): string => prettyRender(e, 0, true)
