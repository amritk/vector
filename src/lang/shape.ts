import {
  AXIOM_ID_RE,
  BINOPS,
  IDENT_RE,
  NUM_LITERAL_RE,
  type Program,
  type SpecPlan,
  TYS,
  UNOPS,
} from "./ast.ts";

// Deep structural validation, written against `unknown` and owned by the
// engine. The generated mjst parsers (0.9.0) validate the same structure and
// now run under Node too, but they throw on the FIRST error; this module
// returns the FULL list of problems as string[], which is what the generator
// retry loop and the solver worker's `invalid` result feed back. Kept as the
// multi-error gate and defense-in-depth. Anything that passes here is safe to
// hand to the typechecker and the Z3 compiler.

type Dict = Record<string, unknown>;

function isDict(value: unknown): value is Dict {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdent(value: unknown): value is string {
  return typeof value === "string" && IDENT_RE.test(value);
}

function isIn(list: readonly string[], value: unknown): boolean {
  return typeof value === "string" && list.includes(value);
}

function checkExpr(value: unknown, where: string, errors: string[]): void {
  if (!isDict(value)) {
    errors.push(
      `${where}: expression must be an object, got ${JSON.stringify(value)}`,
    );
    return;
  }
  switch (value.kind) {
    case "num":
      if (
        typeof value.value !== "string" ||
        !NUM_LITERAL_RE.test(value.value)
      ) {
        errors.push(
          `${where}: num.value must be a plain decimal string like "0.91", got ${JSON.stringify(value.value)}`,
        );
      }
      break;
    case "bool":
      if (typeof value.value !== "boolean") {
        errors.push(`${where}: bool.value must be a boolean`);
      }
      break;
    case "var":
      if (!isIdent(value.name)) {
        errors.push(
          `${where}: var.name must be an identifier, got ${JSON.stringify(value.name)}`,
        );
      }
      break;
    case "unop":
      if (!isIn(UNOPS, value.op)) {
        errors.push(`${where}: unop.op must be one of ${UNOPS.join(", ")}`);
      }
      checkExpr(value.arg, `${where}.arg`, errors);
      break;
    case "binop":
      if (!isIn(BINOPS, value.op)) {
        errors.push(
          `${where}: binop.op ${JSON.stringify(value.op)} is not a known operator`,
        );
      }
      checkExpr(value.left, `${where}.left`, errors);
      checkExpr(value.right, `${where}.right`, errors);
      break;
    case "ite":
      checkExpr(value.cond, `${where}.cond`, errors);
      checkExpr(value.then, `${where}.then`, errors);
      checkExpr(value.else, `${where}.else`, errors);
      break;
    case "call":
      if (!isIdent(value.fn)) {
        errors.push(`${where}: call.fn must be an identifier`);
      }
      if (!Array.isArray(value.args)) {
        errors.push(`${where}: call.args must be an array`);
      } else {
        value.args.forEach((arg, i) =>
          checkExpr(arg, `${where}.args[${i}]`, errors),
        );
      }
      break;
    default:
      errors.push(
        `${where}: unknown expression kind ${JSON.stringify(value.kind)}`,
      );
  }
}

function checkClauses(
  value: unknown,
  where: string,
  minItems: number,
  errors: string[],
): void {
  if (!Array.isArray(value)) {
    errors.push(`${where}: must be an array`);
    return;
  }
  if (value.length < minItems) {
    errors.push(`${where}: must contain at least ${minItems} clause(s)`);
  }
  value.forEach((clause, i) => {
    if (!isDict(clause)) {
      errors.push(`${where}[${i}]: clause must be an object`);
      return;
    }
    if (
      typeof clause.axiomId !== "string" ||
      !AXIOM_ID_RE.test(clause.axiomId)
    ) {
      errors.push(
        `${where}[${i}]: axiomId must match ${AXIOM_ID_RE} (it is embedded in emitted source), got ${JSON.stringify(clause.axiomId)}`,
      );
    }
    checkExpr(clause.expr, `${where}[${i}].expr`, errors);
  });
}

function checkParams(value: unknown, where: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${where}: params must be an array`);
    return;
  }
  value.forEach((param, i) => {
    if (!isDict(param) || !isIdent(param.name) || !isIn(TYS, param.type)) {
      errors.push(
        `${where}[${i}]: param must be { name: identifier, type: ${TYS.join(" | ")} }, got ${JSON.stringify(param)}`,
      );
    }
  });
}

/** Returns [] when `input` is a structurally sound Program. Safe on any input. */
export function validateProgramShape(input: unknown): string[] {
  const errors: string[] = [];
  if (!isDict(input))
    return [`program must be an object, got ${JSON.stringify(input)}`];
  if (!isIdent(input.programName)) {
    errors.push("programName must be an identifier");
  }
  if (!Array.isArray(input.functions) || input.functions.length < 1) {
    errors.push("functions must be a non-empty array");
    return errors;
  }
  input.functions.forEach((fn, i) => {
    if (!isDict(fn)) {
      errors.push(`functions[${i}]: must be an object`);
      return;
    }
    const where = isIdent(fn.name) ? String(fn.name) : `functions[${i}]`;
    if (!isIdent(fn.name)) errors.push(`${where}: name must be an identifier`);
    if (
      typeof fn.layer !== "number" ||
      !Number.isInteger(fn.layer) ||
      fn.layer < 1
    ) {
      errors.push(`${where}: layer must be an integer >= 1`);
    }
    if (typeof fn.purpose !== "string")
      errors.push(`${where}: purpose must be a string`);
    checkParams(fn.params, `${where}/params`, errors);
    if (!isIn(TYS, fn.returnType)) {
      errors.push(`${where}: returnType must be one of ${TYS.join(", ")}`);
    }
    checkClauses(fn.requires, `${where}/requires`, 0, errors);
    checkClauses(fn.ensures, `${where}/ensures`, 1, errors);
    checkExpr(fn.body, `${where}/body`, errors);
  });
  return errors;
}

/** Returns [] when `input` is a structurally sound SpecPlan. Safe on any input. */
export function validateSpecPlanShape(input: unknown): string[] {
  const errors: string[] = [];
  if (!isDict(input))
    return [`spec plan must be an object, got ${JSON.stringify(input)}`];
  if (!isIdent(input.programName)) {
    errors.push("programName must be an identifier");
  }
  if (!Array.isArray(input.axioms) || input.axioms.length < 1) {
    errors.push("axioms must be a non-empty array");
  } else {
    const seenIds = new Set<string>();
    input.axioms.forEach((axiom, i) => {
      if (!isDict(axiom)) {
        errors.push(`axioms[${i}]: must be an object`);
        return;
      }
      if (typeof axiom.id !== "string" || !AXIOM_ID_RE.test(axiom.id)) {
        errors.push(
          `axioms[${i}]: id must match ${AXIOM_ID_RE} (ids are embedded in emitted source), got ${JSON.stringify(axiom.id)}`,
        );
      } else if (seenIds.has(axiom.id)) {
        errors.push(`axioms[${i}]: duplicate axiom id "${axiom.id}"`);
      } else {
        seenIds.add(axiom.id);
      }
      if (!isIn(["pre", "post"], axiom.kind)) {
        errors.push(
          `axioms[${i}]: kind must be "pre" or "post", got ${JSON.stringify(axiom.kind)}`,
        );
      }
      if (typeof axiom.statement !== "string" || axiom.statement.length === 0) {
        errors.push(`axioms[${i}]: statement must be a non-empty string`);
      }
    });
  }
  if (
    !Array.isArray(input.units) ||
    input.units.length < 1 ||
    input.units.length > 4
  ) {
    errors.push("units must be an array of 1-4 entries");
  } else {
    input.units.forEach((unit, i) => {
      if (!isDict(unit)) {
        errors.push(`units[${i}]: must be an object`);
        return;
      }
      const where = isIdent(unit.name) ? String(unit.name) : `units[${i}]`;
      if (!isIdent(unit.name))
        errors.push(`${where}: name must be an identifier`);
      if (
        typeof unit.layer !== "number" ||
        !Number.isInteger(unit.layer) ||
        unit.layer < 1
      ) {
        errors.push(`${where}: layer must be an integer >= 1`);
      }
      if (typeof unit.purpose !== "string")
        errors.push(`${where}: purpose must be a string`);
      checkParams(unit.params, `${where}/params`, errors);
      if (!isIn(TYS, unit.returnType)) {
        errors.push(`${where}: returnType must be one of ${TYS.join(", ")}`);
      }
      if (
        !Array.isArray(unit.relevantAxiomIds) ||
        !unit.relevantAxiomIds.every((id) => typeof id === "string")
      ) {
        errors.push(`${where}: relevantAxiomIds must be an array of strings`);
      }
    });
  }
  return errors;
}

/** Convenience narrowing helpers for callers that validated first. */
export function asProgram(input: unknown): Program {
  const errors = validateProgramShape(input);
  if (errors.length > 0) {
    throw new Error(
      `program failed shape validation:\n- ${errors.join("\n- ")}`,
    );
  }
  return input as Program;
}

export function asSpecPlan(input: unknown): SpecPlan {
  const errors = validateSpecPlanShape(input);
  if (errors.length > 0) {
    throw new Error(
      `spec plan failed shape validation:\n- ${errors.join("\n- ")}`,
    );
  }
  return input as SpecPlan;
}
