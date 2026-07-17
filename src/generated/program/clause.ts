import { type Expr, parseExpr, validateExprShape } from './expr.ts';
import { isObject } from '@amritk/helpers/is-object';

export type Clause = {
  /** The id of the spec-plan axiom this clause formalizes, e.g. "AX1" or "AX-RATE" (letters, digits, _ and - only — the id is embedded in emitted source). Every axiom in the spec plan must be enforced by at least one clause. */
  axiomId: string;
  /** A Bool-typed expression over the parameters (and `result` in ensures). */
  expr: Expr;
};

export const validateClauseShape = (input: unknown): boolean => {
  if (!isObject(input)) return false;
  return typeof input.axiomId === "string" && /^[A-Za-z][A-Za-z0-9_-]*$/.test(input.axiomId)
    && validateExprShape(input.expr)
    && Object.getPrototypeOf(input) === Object.prototype && Object.keys(input).length === 2;
};

export const parseClause = (input: unknown): Clause => {
  if (!isObject(input)) throw new Error(`[Clause] expected object, got ${input === null ? "null" : typeof input}`);
  const _axiomId = input.axiomId;
  const _expr = input.expr;
  if (typeof _axiomId === "string" && /^[A-Za-z][A-Za-z0-9_-]*$/.test(_axiomId) && validateExprShape(_expr) && Object.getPrototypeOf(input) === Object.prototype && Object.keys(input).length === 2) return {
    axiomId: _axiomId,
    expr: _expr,
  } as Clause;
  if (!("axiomId" in input)) throw new Error("[Clause] missing required property 'axiomId'");
  if (typeof input.axiomId !== "string") throw new Error("[Clause] field 'axiomId' expected string, got " + (typeof input.axiomId));
  if (typeof input.axiomId === "string" && !/^[A-Za-z][A-Za-z0-9_-]*$/.test(input.axiomId)) throw new Error("[Clause] field 'axiomId' must match pattern ^[A-Za-z][A-Za-z0-9_-]*$");
  if (!("expr" in input)) throw new Error("[Clause] missing required property 'expr'");
  for (const _k in input) {
    if (_k !== "axiomId" && _k !== "expr") throw new Error(`[Clause] unknown property "${_k}"`);
  }
  return {
    axiomId: _axiomId,
    expr: parseExpr(_expr),
  } as unknown as Clause;
}