import { describe, expect, test } from "bun:test";
import type { Expr, FunctionUnit, Program } from "../src/lang/ast.ts";
import { typecheckProgram } from "../src/lang/validate.ts";

// #19: names that match IDENT_RE but break the emitted TypeScript must be
// refused before the solver runs — otherwise PROVEN code crashes at runtime.

const v = (name: string): Expr => ({ kind: "var", name });
const one: Expr = { kind: "num", value: "1" };
const ge = (a: Expr, b: Expr): Expr => ({
  kind: "binop",
  op: ">=",
  left: a,
  right: b,
});

function unit(name: string, layer: number, param: string, body: Expr) {
  return {
    name,
    layer,
    purpose: name,
    params: [{ name: param, type: "Real" }],
    returnType: "Real",
    requires: [],
    ensures: [{ axiomId: "E", expr: ge(v("result"), v(param)) }],
    body,
  } as FunctionUnit;
}

const errorsFor = (...functions: FunctionUnit[]): string[] =>
  typecheckProgram({ programName: "p", functions } as Program).errors;

describe("identifier hygiene", () => {
  for (const name of ["Math", "Number", "class", "await", "NaN", "undefined"]) {
    test(`a parameter named ${name} is refused`, () => {
      const errors = errorsFor(
        unit("f", 1, name, {
          kind: "binop",
          op: "+",
          left: v(name),
          right: one,
        }),
      );
      expect(errors.some((e) => e.includes("reserved"))).toBe(true);
    });
  }

  test("a function named like a keyword is refused", () => {
    const errors = errorsFor(unit("delete", 1, "x", v("x")));
    expect(errors.some((e) => e.includes("reserved"))).toBe(true);
  });

  test("a parameter that shadows a function name is refused", () => {
    const errors = errorsFor(
      unit("g", 1, "y", v("y")),
      unit("h", 2, "g", { kind: "call", fn: "g", args: [v("g")] }),
    );
    expect(errors.some((e) => e.includes("shadows"))).toBe(true);
  });

  test("ordinary names are still accepted", () => {
    expect(errorsFor(unit("scale", 1, "amount", v("amount")))).toEqual([]);
  });
});
