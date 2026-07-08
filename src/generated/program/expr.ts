import { isObject } from '@amritk/helpers/is-object';

/**
* Expr
*
* An vector-lang expression node. Pure, total (except division), no loops, no recursion.
*/
export type Expr = {
  kind: "num";
  /** Numeric literal as a plain decimal string, e.g. "0.91" or "-3". Never scientific notation, never a JSON number — the string reaches the solver as an exact rational. */
  value: string;
} | { kind: "bool"; value: boolean } | {
  kind: "var";
  /** A parameter name, or "result" (the return value — allowed ONLY inside ensures clauses). */
  name: string;
} | { kind: "unop"; op: "not" | "neg"; arg: Expr } | {
  kind: "binop";
  /** Prefer linear arithmetic: multiply variables by literal constants, not by other variables — nonlinear terms can make the solver return unknown. */
  op: "+" | "-" | "*" | "/" | "<" | "<=" | ">" | ">=" | "==" | "!=" | "and" | "or" | "implies";
  left: Expr;
  right: Expr;
} | { kind: "ite"; cond: Expr; then: Expr; else: Expr } | {
  kind: "call";
  /** Name of a function in a STRICTLY LOWER layer of this same program. */
  fn: string;
  args: Expr[];
};

export const validateExprShape = (input: unknown): boolean => ((isObject(input) && input.kind === "num" && typeof input.value === "string" && /^-?\d+(\.\d+)?$/.test(input.value) && Object.keys(input).every((_k) => ["kind","value"].includes(_k))) || (isObject(input) && input.kind === "bool" && typeof input.value === "boolean" && Object.keys(input).every((_k) => ["kind","value"].includes(_k))) || (isObject(input) && input.kind === "var" && typeof input.name === "string" && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(input.name) && Object.keys(input).every((_k) => ["kind","name"].includes(_k))) || (isObject(input) && input.kind === "unop" && (input.op === "not" || input.op === "neg") && validateExprShape(input.arg) && Object.keys(input).every((_k) => ["kind","op","arg"].includes(_k))) || (isObject(input) && input.kind === "binop" && (input.op === "+" || input.op === "-" || input.op === "*" || input.op === "/" || input.op === "<" || input.op === "<=" || input.op === ">" || input.op === ">=" || input.op === "==" || input.op === "!=" || input.op === "and" || input.op === "or" || input.op === "implies") && validateExprShape(input.left) && validateExprShape(input.right) && Object.keys(input).every((_k) => ["kind","op","left","right"].includes(_k))) || (isObject(input) && input.kind === "ite" && validateExprShape(input.cond) && validateExprShape(input.then) && validateExprShape(input.else) && Object.keys(input).every((_k) => ["kind","cond","then","else"].includes(_k))) || (isObject(input) && input.kind === "call" && typeof input.fn === "string" && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(input.fn) && Array.isArray(input.args) && input.args.every(validateExprShape) && Object.keys(input).every((_k) => ["kind","fn","args"].includes(_k))));

export const parseExpr = (input: unknown): Expr => {
  if (!(((isObject(input) && input.kind === "num" && typeof input.value === "string" && /^-?\d+(\.\d+)?$/.test(input.value) && Object.keys(input).every((_k) => ["kind","value"].includes(_k))) || (isObject(input) && input.kind === "bool" && typeof input.value === "boolean" && Object.keys(input).every((_k) => ["kind","value"].includes(_k))) || (isObject(input) && input.kind === "var" && typeof input.name === "string" && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(input.name) && Object.keys(input).every((_k) => ["kind","name"].includes(_k))) || (isObject(input) && input.kind === "unop" && (input.op === "not" || input.op === "neg") && validateExprShape(input.arg) && Object.keys(input).every((_k) => ["kind","op","arg"].includes(_k))) || (isObject(input) && input.kind === "binop" && (input.op === "+" || input.op === "-" || input.op === "*" || input.op === "/" || input.op === "<" || input.op === "<=" || input.op === ">" || input.op === ">=" || input.op === "==" || input.op === "!=" || input.op === "and" || input.op === "or" || input.op === "implies") && validateExprShape(input.left) && validateExprShape(input.right) && Object.keys(input).every((_k) => ["kind","op","left","right"].includes(_k))) || (isObject(input) && input.kind === "ite" && validateExprShape(input.cond) && validateExprShape(input.then) && validateExprShape(input.else) && Object.keys(input).every((_k) => ["kind","cond","then","else"].includes(_k))) || (isObject(input) && input.kind === "call" && typeof input.fn === "string" && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(input.fn) && Array.isArray(input.args) && input.args.every(validateExprShape) && Object.keys(input).every((_k) => ["kind","fn","args"].includes(_k)))))) throw new Error("[Expr] value does not match any union branch");
  return input as Expr;
};