import { type FunctionUnit, parseFunctionUnit, validateFunctionUnitShape } from './function-unit.ts';
import { validateArray } from '@amritk/helpers/validate-array';
import { isObject } from '@amritk/helpers/is-object';

export type Program = {
  programName: string;
  /** Ordered lowest layer first. Each function is one small Dijkstra layer: it may only call functions in strictly lower layers. */
  functions: FunctionUnit[];
};

export const validateProgramShape = (input: unknown): boolean => {
  if (!isObject(input)) return false;
  return typeof input.programName === "string" && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(input.programName)
    && Array.isArray(input.functions) && input.functions.every(validateFunctionUnitShape)
    && Object.getPrototypeOf(input) === Object.prototype && Object.keys(input).length === 2;
};

export const parseProgram = (input: unknown): Program => {
  if (!isObject(input)) throw new Error(`[Program] expected object, got ${input === null ? "null" : typeof input}`);
  const _programName = input.programName;
  const _functions = input.functions;
  if (typeof _programName === "string" && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(_programName) && Array.isArray(_functions) && _functions.every(validateFunctionUnitShape) && Object.getPrototypeOf(input) === Object.prototype && Object.keys(input).length === 2) return {
    programName: _programName,
    functions: _functions,
  } as Program;
  if (!("programName" in input)) throw new Error("[Program] missing required property 'programName'");
  if (typeof input.programName !== "string") throw new Error("[Program] field 'programName' expected string, got " + (typeof input.programName));
  if (typeof input.programName === "string" && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(input.programName)) throw new Error("[Program] field 'programName' must match pattern ^[a-zA-Z_][a-zA-Z0-9_]*$");
  if (!("functions" in input)) throw new Error("[Program] missing required property 'functions'");
  if (!Array.isArray(input.functions)) throw new Error("[Program] field 'functions' expected array, got " + (typeof input.functions));
  if (Array.isArray(input.functions) && input.functions.length < 1) throw new Error("[Program] field 'functions' must have at least 1 items");
  for (const _k in input) {
    if (_k !== "programName" && _k !== "functions") throw new Error(`[Program] unknown property "${_k}"`);
  }
  return {
    programName: _programName,
    functions: validateArray(_functions, parseFunctionUnit),
  } as unknown as Program;
}