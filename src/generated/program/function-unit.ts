import { type Clause, parseClause, validateClauseShape } from './clause.ts';
import { type Expr, parseExpr, validateExprShape } from './expr.ts';
import { type Ty, parseTy, validateTyShape } from './ty.ts';
import { validateArray } from '@amritk/helpers/validate-array';
import { isObject } from '@amritk/helpers/is-object';

export type FunctionUnit = {
  name: string;
  layer: number;
  /** One plain-language sentence. */
  purpose: string;
  params: { name: string; type: Ty }[];
  returnType: Ty;
  /** Preconditions. "Throws/errors if X" in the spec means a precondition of NOT X — the emitted code enforces it with a runtime throw. */
  requires: Clause[];
  /** Postconditions over the parameters and `result`. Proven by the solver for ALL inputs satisfying the preconditions. */
  ensures: Clause[];
  /** A single pure expression matching returnType. No `result` here. */
  body: Expr;
};

export const validateFunctionUnitShape = (input: unknown): boolean => {
  if (!isObject(input)) return false;
  return typeof input.name === "string" && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(input.name)
    && typeof input.layer === "number" && Number.isInteger(input.layer) && input.layer >= 1
    && typeof input.purpose === "string"
    && Array.isArray(input.params) && _everyFunctionUnit_ParamsItem(input.params)
    && validateTyShape(input.returnType)
    && Array.isArray(input.requires) && input.requires.every(validateClauseShape)
    && Array.isArray(input.ensures) && input.ensures.every(validateClauseShape)
    && validateExprShape(input.body)
    && Object.getPrototypeOf(input) === Object.prototype && Object.keys(input).length === 8;
};

type FunctionUnit_ParamsItem = NonNullable<FunctionUnit["params"]>[number];

const validateFunctionUnit_ParamsItemShape = (input: unknown): boolean => {
  if (!isObject(input)) return false;
  return typeof input.name === "string" && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(input.name)
    && validateTyShape(input.type)
    && Object.getPrototypeOf(input) === Object.prototype && Object.keys(input).length === 2;
};

const _everyFunctionUnit_ParamsItem = (arr: readonly unknown[]): boolean => {
  for (let i = 0; i < arr.length; i++) if (!validateFunctionUnit_ParamsItemShape(arr[i])) return false;
  return true;
};

const parseFunctionUnit_ParamsItem = (input: unknown): FunctionUnit_ParamsItem => {
  if (!isObject(input)) throw new Error(`[FunctionUnit_ParamsItem] expected object, got ${input === null ? "null" : typeof input}`);
  const _name = input.name;
  const _type = input.type;
  if (typeof _name === "string" && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(_name) && validateTyShape(_type) && Object.getPrototypeOf(input) === Object.prototype && Object.keys(input).length === 2) return input as FunctionUnit_ParamsItem;
  if (!("name" in input)) throw new Error("[FunctionUnit_ParamsItem] missing required property 'name'");
  if (typeof input.name !== "string") throw new Error("[FunctionUnit_ParamsItem] field 'name' expected string, got " + (typeof input.name));
  if (typeof input.name === "string" && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(input.name)) throw new Error("[FunctionUnit_ParamsItem] field 'name' must match pattern ^[a-zA-Z_][a-zA-Z0-9_]*$");
  if (!("type" in input)) throw new Error("[FunctionUnit_ParamsItem] missing required property 'type'");
  for (const _k in input) {
    if (_k !== "name" && _k !== "type") throw new Error(`[FunctionUnit_ParamsItem] unknown property "${_k}"`);
  }
  return {
    name: _name,
    type: parseTy(_type),
  } as unknown as FunctionUnit_ParamsItem;
}

export const parseFunctionUnit = (input: unknown): FunctionUnit => {
  if (!isObject(input)) throw new Error(`[FunctionUnit] expected object, got ${input === null ? "null" : typeof input}`);
  const _name = input.name;
  const _layer = input.layer;
  const _purpose = input.purpose;
  const _params = input.params;
  const _returnType = input.returnType;
  const _requires = input.requires;
  const _ensures = input.ensures;
  const _body = input.body;
  if (typeof _name === "string" && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(_name) && typeof _layer === "number" && Number.isInteger(_layer) && _layer >= 1 && typeof _purpose === "string" && Array.isArray(_params) && _everyFunctionUnit_ParamsItem(_params) && validateTyShape(_returnType) && Array.isArray(_requires) && _requires.every(validateClauseShape) && Array.isArray(_ensures) && _ensures.every(validateClauseShape) && validateExprShape(_body) && Object.getPrototypeOf(input) === Object.prototype && Object.keys(input).length === 8) return {
    name: _name,
    layer: _layer,
    purpose: _purpose,
    params: _params,
    returnType: _returnType,
    requires: _requires,
    ensures: _ensures,
    body: _body,
  } as FunctionUnit;
  if (!("name" in input)) throw new Error("[FunctionUnit] missing required property 'name'");
  if (typeof input.name !== "string") throw new Error("[FunctionUnit] field 'name' expected string, got " + (typeof input.name));
  if (typeof input.name === "string" && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(input.name)) throw new Error("[FunctionUnit] field 'name' must match pattern ^[a-zA-Z_][a-zA-Z0-9_]*$");
  if (!("layer" in input)) throw new Error("[FunctionUnit] missing required property 'layer'");
  if ((typeof input.layer !== "number" || !Number.isInteger(input.layer))) throw new Error("[FunctionUnit] field 'layer' expected number, got " + (typeof input.layer));
  if (typeof input.layer === "number" && input.layer < 1) throw new Error("[FunctionUnit] field 'layer' must be >= 1");
  if (!("purpose" in input)) throw new Error("[FunctionUnit] missing required property 'purpose'");
  if (typeof input.purpose !== "string") throw new Error("[FunctionUnit] field 'purpose' expected string, got " + (typeof input.purpose));
  if (!("params" in input)) throw new Error("[FunctionUnit] missing required property 'params'");
  if (!Array.isArray(input.params)) throw new Error("[FunctionUnit] field 'params' expected array, got " + (typeof input.params));
  if (!("returnType" in input)) throw new Error("[FunctionUnit] missing required property 'returnType'");
  if (!("requires" in input)) throw new Error("[FunctionUnit] missing required property 'requires'");
  if (!Array.isArray(input.requires)) throw new Error("[FunctionUnit] field 'requires' expected array, got " + (typeof input.requires));
  if (!("ensures" in input)) throw new Error("[FunctionUnit] missing required property 'ensures'");
  if (!Array.isArray(input.ensures)) throw new Error("[FunctionUnit] field 'ensures' expected array, got " + (typeof input.ensures));
  if (Array.isArray(input.ensures) && input.ensures.length < 1) throw new Error("[FunctionUnit] field 'ensures' must have at least 1 items");
  if (!("body" in input)) throw new Error("[FunctionUnit] missing required property 'body'");
  for (const _k in input) {
    if (_k !== "name" && _k !== "layer" && _k !== "purpose" && _k !== "params" && _k !== "returnType" && _k !== "requires" && _k !== "ensures" && _k !== "body") throw new Error(`[FunctionUnit] unknown property "${_k}"`);
  }
  return {
    name: _name,
    layer: _layer,
    purpose: _purpose,
    params: validateArray(_params, parseFunctionUnit_ParamsItem),
    returnType: parseTy(_returnType),
    requires: validateArray(_requires, parseClause),
    ensures: validateArray(_ensures, parseClause),
    body: parseExpr(_body),
  } as unknown as FunctionUnit;
}