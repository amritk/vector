import {
  type Expr,
  type FunctionUnit,
  type NumericTy,
  type Program,
  RESULT_NAME,
  type Ty,
} from "./ast.ts";

// Semantic checks no schema can express: name resolution, monomorphic types,
// `result` only in ensures, and Dijkstra layering (calls go strictly downward,
// which also guarantees the call graph is a DAG so inlining terminates).
// Callers should run validateProgramShape (shape.ts) first; the defensive
// default below is a backstop for malformed nodes, not the primary check.
//
// `numTypes` records the resolved type of every numeric literal so the Z3
// compiler knows whether to build an Int or a Real value for it.

export interface TypecheckResult {
  errors: string[];
  numTypes: WeakMap<Expr, NumericTy>;
}

interface Scope {
  vars: Map<string, Ty>;
  allowResult: boolean;
}

export function typecheckProgram(program: Program): TypecheckResult {
  const errors: string[] = [];
  const numTypes = new WeakMap<Expr, NumericTy>();
  const byName = new Map<string, FunctionUnit>();

  for (const fn of program.functions) {
    if (byName.has(fn.name)) {
      errors.push(`duplicate function name "${fn.name}"`);
    }
    byName.set(fn.name, fn);
  }

  for (const fn of program.functions) {
    const where = (part: string) => `${fn.name}/${part}`;
    const paramTypes = new Map<string, Ty>();
    for (const p of fn.params) {
      if (p.name === RESULT_NAME) {
        errors.push(`${where("params")}: "${RESULT_NAME}" is reserved`);
      }
      if (paramTypes.has(p.name)) {
        errors.push(`${where("params")}: duplicate parameter "${p.name}"`);
      }
      paramTypes.set(p.name, p.type);
    }

    const infer = (
      expr: Expr,
      scope: Scope,
      expected: Ty | undefined,
      part: string,
    ): Ty | null => {
      const fail = (msg: string): null => {
        errors.push(`${where(part)}: ${msg}`);
        return null;
      };
      const check = (actual: Ty | null): Ty | null => {
        if (actual && expected && actual !== expected) {
          return fail(`expected ${expected}, got ${actual}`);
        }
        return actual;
      };

      switch (expr.kind) {
        case "num": {
          if (expected === "Bool")
            return fail(`numeric literal "${expr.value}" where Bool expected`);
          if (expected === "Int") {
            if (expr.value.includes(".")) {
              return fail(`literal "${expr.value}" is not an integer`);
            }
            numTypes.set(expr, "Int");
            return "Int";
          }
          numTypes.set(expr, "Real");
          return "Real";
        }
        case "bool":
          return check("Bool");
        case "var": {
          if (expr.name === RESULT_NAME && !scope.allowResult) {
            return fail(`"${RESULT_NAME}" may only appear in ensures clauses`);
          }
          const ty = scope.vars.get(expr.name);
          if (!ty) return fail(`unknown variable "${expr.name}"`);
          return check(ty);
        }
        case "unop": {
          if (expr.op === "not") {
            infer(expr.arg, scope, "Bool", part);
            return check("Bool");
          }
          const ty = inferNumericPair(
            expr.arg,
            undefined,
            scope,
            expected,
            part,
          );
          return check(ty);
        }
        case "binop": {
          switch (expr.op) {
            case "+":
            case "-":
            case "*":
            case "/": {
              const ty = inferNumericPair(
                expr.left,
                expr.right,
                scope,
                expected,
                part,
              );
              return check(ty);
            }
            case "<":
            case "<=":
            case ">":
            case ">=":
              inferNumericPair(expr.left, expr.right, scope, undefined, part);
              return check("Bool");
            case "==":
            case "!=": {
              // Operands must share a type; prefer inferring the non-literal side first.
              const [first, second] =
                expr.left.kind === "num" && expr.right.kind !== "num"
                  ? [expr.right, expr.left]
                  : [expr.left, expr.right];
              const ty = infer(first, scope, undefined, part);
              infer(second, scope, ty ?? undefined, part);
              return check("Bool");
            }
            case "and":
            case "or":
            case "implies":
              infer(expr.left, scope, "Bool", part);
              infer(expr.right, scope, "Bool", part);
              return check("Bool");
          }
          break;
        }
        case "ite": {
          infer(expr.cond, scope, "Bool", part);
          const thenTy = infer(expr.then, scope, expected, part);
          const elseTy = infer(expr.else, scope, thenTy ?? expected, part);
          if (thenTy && elseTy && thenTy !== elseTy) {
            return fail(`ite branches disagree: ${thenTy} vs ${elseTy}`);
          }
          return check(thenTy ?? elseTy);
        }
        case "call": {
          const callee = byName.get(expr.fn);
          if (!callee) return fail(`call to unknown function "${expr.fn}"`);
          if (callee.name === fn.name || callee.layer >= fn.layer) {
            errors.push(
              `${where(part)}: "${fn.name}" (layer ${fn.layer}) may only call strictly lower layers, ` +
                `but calls "${callee.name}" (layer ${callee.layer})`,
            );
          }
          if (expr.args.length !== callee.params.length) {
            return fail(
              `"${expr.fn}" expects ${callee.params.length} argument(s), got ${expr.args.length}`,
            );
          }
          expr.args.forEach((arg, i) => {
            const param = callee.params[i];
            if (param) infer(arg, scope, param.type, part);
          });
          return check(callee.returnType);
        }
        default:
          // Unreachable for shape-validated input; catches malformed nodes so
          // they surface as retryable validation errors, never a solver crash.
          return fail(
            `unknown expression kind ${JSON.stringify((expr as { kind?: unknown }).kind)}`,
          );
      }
      return null;
    };

    // Numeric operator: both operands share one numeric type. Infer the
    // non-literal side first so bare literals pick up Int from context.
    const inferNumericPair = (
      left: Expr,
      right: Expr | undefined,
      scope: Scope,
      expected: Ty | undefined,
      part: string,
    ): Ty | null => {
      const hint =
        expected === "Int" || expected === "Real" ? expected : undefined;
      if (expected === "Bool") {
        errors.push(
          `${where(part)}: arithmetic expression where Bool expected`,
        );
      }
      let ty: Ty | null;
      if (right && left.kind === "num" && right.kind !== "num") {
        ty = infer(right, scope, hint, part);
        infer(left, scope, ty ?? hint, part);
      } else {
        ty = infer(left, scope, hint, part);
        if (right) infer(right, scope, ty ?? hint, part);
      }
      if (ty === "Bool") {
        errors.push(`${where(part)}: expected a numeric operand, got Bool`);
        return null;
      }
      return ty;
    };

    const paramScope: Scope = { vars: paramTypes, allowResult: false };
    const ensuresScope: Scope = {
      vars: new Map([...paramTypes, [RESULT_NAME, fn.returnType]]),
      allowResult: true,
    };

    fn.requires.forEach((c, i) =>
      infer(c.expr, paramScope, "Bool", `requires[${i}]`),
    );
    fn.ensures.forEach((c, i) =>
      infer(c.expr, ensuresScope, "Bool", `ensures[${i}]`),
    );
    infer(fn.body, paramScope, fn.returnType, "body");
  }

  return { errors, numTypes };
}
