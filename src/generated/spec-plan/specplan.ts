import { validateArray } from '@amritk/helpers/validate-array';
import { isObject } from '@amritk/helpers/is-object';

export type SpecPlan = {
  programName: string;
  /** The formal contract extracted from the casual prompt. */
  axioms: ({
  /** Short stable id, e.g. "AX1" or "AX-RATE" (letters, digits, _ and - only — ids are embedded in emitted source). */
  id: string;
  /** pre = a constraint on inputs (including "throws if X" → precondition NOT X); post = a guarantee about the result. */
  kind: "pre" | "post";
  /** Precise mathematical English, e.g. "for all amount >= 0, result equals amount times 0.91". */
  statement: string;
})[];
  /** Dijkstra-style layered decomposition, lowest layer first. Keep it small: 1-4 pure functions, each layer only calls strictly lower layers. */
  units: ({
  name: string;
  layer: number;
  purpose: string;
  params: ({ name: string; type: "Real" | "Int" | "Bool" })[];
  returnType: "Real" | "Int" | "Bool";
  /** Which axioms this unit is responsible for enforcing. */
  relevantAxiomIds: string[];
})[];
};

export const validateSpecPlanShape = (input: unknown): boolean => {
  if (!isObject(input)) return false;
  return typeof input.programName === "string" && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(input.programName)
    && Array.isArray(input.axioms) && input.axioms.length >= 1 && _everySpecPlan_AxiomsItem(input.axioms)
    && Array.isArray(input.units) && input.units.length >= 1 && input.units.length <= 4 && _everySpecPlan_UnitsItem(input.units)
    && Object.getPrototypeOf(input) === Object.prototype && Object.keys(input).length === 3;
};

type SpecPlan_AxiomsItem = NonNullable<SpecPlan["axioms"]>[number];

const validateSpecPlan_AxiomsItemShape = (input: unknown): boolean => {
  if (!isObject(input)) return false;
  return typeof input.id === "string" && /^[A-Za-z][A-Za-z0-9_-]*$/.test(input.id)
    && (input.kind === "pre" || input.kind === "post")
    && typeof input.statement === "string"
    && Object.getPrototypeOf(input) === Object.prototype && Object.keys(input).length === 3;
};

const _everySpecPlan_AxiomsItem = (arr: readonly unknown[]): boolean => {
  for (let i = 0; i < arr.length; i++) if (!validateSpecPlan_AxiomsItemShape(arr[i])) return false;
  return true;
};

const parseSpecPlan_AxiomsItem = (input: unknown): SpecPlan_AxiomsItem => {
  if (!isObject(input)) throw new Error(`[SpecPlan_AxiomsItem] expected object, got ${input === null ? "null" : typeof input}`);
  const _id = input.id;
  const _kind = input.kind;
  const _statement = input.statement;
  if (typeof _id === "string" && /^[A-Za-z][A-Za-z0-9_-]*$/.test(_id) && (_kind === "pre" || _kind === "post") && typeof _statement === "string" && Object.getPrototypeOf(input) === Object.prototype && Object.keys(input).length === 3) return input as SpecPlan_AxiomsItem;
  if (!("id" in input)) throw new Error("[SpecPlan_AxiomsItem] missing required property 'id'");
  if (typeof input.id !== "string") throw new Error("[SpecPlan_AxiomsItem] field 'id' expected string, got " + (typeof input.id));
  if (typeof input.id === "string" && !/^[A-Za-z][A-Za-z0-9_-]*$/.test(input.id)) throw new Error("[SpecPlan_AxiomsItem] field 'id' must match pattern ^[A-Za-z][A-Za-z0-9_-]*$");
  if (!("kind" in input)) throw new Error("[SpecPlan_AxiomsItem] missing required property 'kind'");
  if (!(["pre","post"] as readonly unknown[]).includes(input.kind)) throw new Error("[SpecPlan_AxiomsItem] field 'kind' must be one of: \"pre\", \"post\"");
  if (!("statement" in input)) throw new Error("[SpecPlan_AxiomsItem] missing required property 'statement'");
  if (typeof input.statement !== "string") throw new Error("[SpecPlan_AxiomsItem] field 'statement' expected string, got " + (typeof input.statement));
  for (const _k in input) {
    if (_k !== "id" && _k !== "kind" && _k !== "statement") throw new Error(`[SpecPlan_AxiomsItem] unknown property "${_k}"`);
  }
  return {
    id: _id,
    kind: _kind,
    statement: _statement,
  } as unknown as SpecPlan_AxiomsItem;
}

type SpecPlan_UnitsItem = NonNullable<SpecPlan["units"]>[number];

const validateSpecPlan_UnitsItemShape = (input: unknown): boolean => {
  if (!isObject(input)) return false;
  return typeof input.name === "string" && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(input.name)
    && typeof input.layer === "number" && Number.isInteger(input.layer) && input.layer >= 1
    && typeof input.purpose === "string"
    && Array.isArray(input.params) && _everySpecPlan_UnitsItem_ParamsItem(input.params)
    && (input.returnType === "Real" || input.returnType === "Int" || input.returnType === "Bool")
    && Array.isArray(input.relevantAxiomIds) && input.relevantAxiomIds.every((_it) => typeof _it === "string")
    && Object.getPrototypeOf(input) === Object.prototype && Object.keys(input).length === 6;
};

const _everySpecPlan_UnitsItem = (arr: readonly unknown[]): boolean => {
  for (let i = 0; i < arr.length; i++) if (!validateSpecPlan_UnitsItemShape(arr[i])) return false;
  return true;
};

type SpecPlan_UnitsItem_ParamsItem = NonNullable<SpecPlan_UnitsItem["params"]>[number];

const validateSpecPlan_UnitsItem_ParamsItemShape = (input: unknown): boolean => {
  if (!isObject(input)) return false;
  return typeof input.name === "string" && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(input.name)
    && (input.type === "Real" || input.type === "Int" || input.type === "Bool")
    && Object.getPrototypeOf(input) === Object.prototype && Object.keys(input).length === 2;
};

const _everySpecPlan_UnitsItem_ParamsItem = (arr: readonly unknown[]): boolean => {
  for (let i = 0; i < arr.length; i++) if (!validateSpecPlan_UnitsItem_ParamsItemShape(arr[i])) return false;
  return true;
};

const parseSpecPlan_UnitsItem_ParamsItem = (input: unknown): SpecPlan_UnitsItem_ParamsItem => {
  if (!isObject(input)) throw new Error(`[SpecPlan_UnitsItem_ParamsItem] expected object, got ${input === null ? "null" : typeof input}`);
  const _name = input.name;
  const _type = input.type;
  if (typeof _name === "string" && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(_name) && (_type === "Real" || _type === "Int" || _type === "Bool") && Object.getPrototypeOf(input) === Object.prototype && Object.keys(input).length === 2) return input as SpecPlan_UnitsItem_ParamsItem;
  if (!("name" in input)) throw new Error("[SpecPlan_UnitsItem_ParamsItem] missing required property 'name'");
  if (typeof input.name !== "string") throw new Error("[SpecPlan_UnitsItem_ParamsItem] field 'name' expected string, got " + (typeof input.name));
  if (typeof input.name === "string" && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(input.name)) throw new Error("[SpecPlan_UnitsItem_ParamsItem] field 'name' must match pattern ^[a-zA-Z_][a-zA-Z0-9_]*$");
  if (!("type" in input)) throw new Error("[SpecPlan_UnitsItem_ParamsItem] missing required property 'type'");
  if (!(["Real","Int","Bool"] as readonly unknown[]).includes(input.type)) throw new Error("[SpecPlan_UnitsItem_ParamsItem] field 'type' must be one of: \"Real\", \"Int\", \"Bool\"");
  for (const _k in input) {
    if (_k !== "name" && _k !== "type") throw new Error(`[SpecPlan_UnitsItem_ParamsItem] unknown property "${_k}"`);
  }
  return {
    name: _name,
    type: _type,
  } as unknown as SpecPlan_UnitsItem_ParamsItem;
}

const parseSpecPlan_UnitsItem = (input: unknown): SpecPlan_UnitsItem => {
  if (!isObject(input)) throw new Error(`[SpecPlan_UnitsItem] expected object, got ${input === null ? "null" : typeof input}`);
  const _name = input.name;
  const _layer = input.layer;
  const _purpose = input.purpose;
  const _params = input.params;
  const _returnType = input.returnType;
  const _relevantAxiomIds = input.relevantAxiomIds;
  if (typeof _name === "string" && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(_name) && typeof _layer === "number" && Number.isInteger(_layer) && _layer >= 1 && typeof _purpose === "string" && Array.isArray(_params) && _everySpecPlan_UnitsItem_ParamsItem(_params) && (_returnType === "Real" || _returnType === "Int" || _returnType === "Bool") && Array.isArray(_relevantAxiomIds) && _relevantAxiomIds.every((_it) => typeof _it === "string") && Object.getPrototypeOf(input) === Object.prototype && Object.keys(input).length === 6) return input as SpecPlan_UnitsItem;
  if (!("name" in input)) throw new Error("[SpecPlan_UnitsItem] missing required property 'name'");
  if (typeof input.name !== "string") throw new Error("[SpecPlan_UnitsItem] field 'name' expected string, got " + (typeof input.name));
  if (typeof input.name === "string" && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(input.name)) throw new Error("[SpecPlan_UnitsItem] field 'name' must match pattern ^[a-zA-Z_][a-zA-Z0-9_]*$");
  if (!("layer" in input)) throw new Error("[SpecPlan_UnitsItem] missing required property 'layer'");
  if ((typeof input.layer !== "number" || !Number.isInteger(input.layer))) throw new Error("[SpecPlan_UnitsItem] field 'layer' expected number, got " + (typeof input.layer));
  if (typeof input.layer === "number" && input.layer < 1) throw new Error("[SpecPlan_UnitsItem] field 'layer' must be >= 1");
  if (!("purpose" in input)) throw new Error("[SpecPlan_UnitsItem] missing required property 'purpose'");
  if (typeof input.purpose !== "string") throw new Error("[SpecPlan_UnitsItem] field 'purpose' expected string, got " + (typeof input.purpose));
  if (!("params" in input)) throw new Error("[SpecPlan_UnitsItem] missing required property 'params'");
  if (!Array.isArray(input.params)) throw new Error("[SpecPlan_UnitsItem] field 'params' expected array, got " + (typeof input.params));
  if (!("returnType" in input)) throw new Error("[SpecPlan_UnitsItem] missing required property 'returnType'");
  if (!(["Real","Int","Bool"] as readonly unknown[]).includes(input.returnType)) throw new Error("[SpecPlan_UnitsItem] field 'returnType' must be one of: \"Real\", \"Int\", \"Bool\"");
  if (!("relevantAxiomIds" in input)) throw new Error("[SpecPlan_UnitsItem] missing required property 'relevantAxiomIds'");
  if (!Array.isArray(input.relevantAxiomIds)) throw new Error("[SpecPlan_UnitsItem] field 'relevantAxiomIds' expected array, got " + (typeof input.relevantAxiomIds));
  if (Array.isArray(input.relevantAxiomIds) && !input.relevantAxiomIds.every((_it) => typeof _it === "string")) throw new Error("[SpecPlan_UnitsItem] field 'relevantAxiomIds' items expected string");
  for (const _k in input) {
    if (_k !== "name" && _k !== "layer" && _k !== "purpose" && _k !== "params" && _k !== "returnType" && _k !== "relevantAxiomIds") throw new Error(`[SpecPlan_UnitsItem] unknown property "${_k}"`);
  }
  return {
    name: _name,
    layer: _layer,
    purpose: _purpose,
    params: validateArray(_params, parseSpecPlan_UnitsItem_ParamsItem),
    returnType: _returnType,
    relevantAxiomIds: _relevantAxiomIds,
  } as unknown as SpecPlan_UnitsItem;
}

export const parseSpecPlan = (input: unknown): SpecPlan => {
  if (!isObject(input)) throw new Error(`[SpecPlan] expected object, got ${input === null ? "null" : typeof input}`);
  const _programName = input.programName;
  const _axioms = input.axioms;
  const _units = input.units;
  if (typeof _programName === "string" && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(_programName) && Array.isArray(_axioms) && _axioms.length >= 1 && _everySpecPlan_AxiomsItem(_axioms) && Array.isArray(_units) && _units.length >= 1 && _units.length <= 4 && _everySpecPlan_UnitsItem(_units) && Object.getPrototypeOf(input) === Object.prototype && Object.keys(input).length === 3) return {
    programName: _programName,
    axioms: _axioms,
    units: _units,
  } as SpecPlan;
  if (!("programName" in input)) throw new Error("[SpecPlan] missing required property 'programName'");
  if (typeof input.programName !== "string") throw new Error("[SpecPlan] field 'programName' expected string, got " + (typeof input.programName));
  if (typeof input.programName === "string" && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(input.programName)) throw new Error("[SpecPlan] field 'programName' must match pattern ^[a-zA-Z_][a-zA-Z0-9_]*$");
  if (!("axioms" in input)) throw new Error("[SpecPlan] missing required property 'axioms'");
  if (!Array.isArray(input.axioms)) throw new Error("[SpecPlan] field 'axioms' expected array, got " + (typeof input.axioms));
  if (Array.isArray(input.axioms) && input.axioms.length < 1) throw new Error("[SpecPlan] field 'axioms' must have at least 1 items");
  if (!("units" in input)) throw new Error("[SpecPlan] missing required property 'units'");
  if (!Array.isArray(input.units)) throw new Error("[SpecPlan] field 'units' expected array, got " + (typeof input.units));
  if (Array.isArray(input.units) && input.units.length < 1) throw new Error("[SpecPlan] field 'units' must have at least 1 items");
  if (Array.isArray(input.units) && input.units.length > 4) throw new Error("[SpecPlan] field 'units' must have at most 4 items");
  for (const _k in input) {
    if (_k !== "programName" && _k !== "axioms" && _k !== "units") throw new Error(`[SpecPlan] unknown property "${_k}"`);
  }
  return {
    programName: _programName,
    axioms: validateArray(_axioms, parseSpecPlan_AxiomsItem),
    units: validateArray(_units, parseSpecPlan_UnitsItem),
  } as unknown as SpecPlan;
}