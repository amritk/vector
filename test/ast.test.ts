import { describe, expect, test } from "bun:test";
import { parseProgram } from "../src/generated/program/index.ts";
import type { Expr, Program } from "../src/lang/ast.ts";
import { validateProgramShape } from "../src/lang/shape.ts";
import { typecheckProgram } from "../src/lang/validate.ts";
import currencyFixture from "./fixtures/currency.json";
import unsatFixture from "./fixtures/unsat.json";

const num = (value: string): Expr => ({ kind: "num", value });
const variable = (name: string): Expr => ({ kind: "var", name });
const binop = (op: "==" | ">=" | "*" | "+", left: Expr, right: Expr): Expr => ({
  kind: "binop",
  op,
  left,
  right,
});

function minimalProgram(
  overrides: Partial<Program["functions"][number]> = {},
): Program {
  return {
    programName: "test_program",
    functions: [
      {
        name: "double",
        layer: 1,
        purpose: "Double a value.",
        params: [{ name: "x", type: "Real" }],
        returnType: "Real",
        requires: [],
        ensures: [
          {
            axiomId: "AX1",
            expr: binop(
              "==",
              variable("result"),
              binop("*", variable("x"), num("2")),
            ),
          },
        ],
        body: binop("*", variable("x"), num("2")),
        ...overrides,
      },
    ],
  };
}

describe("generated program parser + shape validator", () => {
  test("accepts the currency and unsat fixtures", () => {
    expect(() => parseProgram(currencyFixture)).not.toThrow();
    expect(() => parseProgram(unsatFixture)).not.toThrow();
    expect(validateProgramShape(currencyFixture)).toEqual([]);
    expect(validateProgramShape(unsatFixture)).toEqual([]);
  });

  test("parser rejects unknown top-level keys and bad identifiers (mjst strict mode)", () => {
    expect(() => parseProgram({ ...minimalProgram(), extra: 1 })).toThrow(
      /unknown property/,
    );
    expect(() =>
      parseProgram({ ...minimalProgram(), programName: "3bad" }),
    ).toThrow(/pattern/);
  });

  test("shape validator rejects malformed numeric literals", () => {
    const bad = minimalProgram({ body: num("1e9") });
    expect(validateProgramShape(bad).join("\n")).toContain("decimal string");
  });
});

describe("typecheckProgram", () => {
  test("passes valid programs", () => {
    const currency = parseProgram(currencyFixture);
    expect(typecheckProgram(currency).errors).toEqual([]);
    expect(typecheckProgram(minimalProgram()).errors).toEqual([]);
  });

  test("rejects unknown variables", () => {
    const program = minimalProgram({ body: variable("y") });
    expect(typecheckProgram(program).errors.join("\n")).toContain(
      'unknown variable "y"',
    );
  });

  test("rejects `result` outside ensures", () => {
    const program = minimalProgram({
      requires: [
        { axiomId: "AX0", expr: binop(">=", variable("result"), num("0")) },
      ],
    });
    expect(typecheckProgram(program).errors.join("\n")).toContain(
      '"result" may only appear in ensures clauses',
    );
  });

  test("rejects calls that do not go strictly downward", () => {
    const program: Program = {
      programName: "bad_layers",
      functions: [
        {
          name: "a",
          layer: 1,
          purpose: "Calls sideways.",
          params: [{ name: "x", type: "Real" }],
          returnType: "Real",
          requires: [],
          ensures: [
            {
              axiomId: "AX1",
              expr: binop("==", variable("result"), variable("x")),
            },
          ],
          body: { kind: "call", fn: "b", args: [variable("x")] },
        },
        {
          name: "b",
          layer: 1,
          purpose: "Same layer.",
          params: [{ name: "x", type: "Real" }],
          returnType: "Real",
          requires: [],
          ensures: [
            {
              axiomId: "AX1",
              expr: binop("==", variable("result"), variable("x")),
            },
          ],
          body: variable("x"),
        },
      ],
    };
    expect(typecheckProgram(program).errors.join("\n")).toContain(
      "strictly lower layers",
    );
  });

  test("rejects a Bool body for a Real return type", () => {
    const program = minimalProgram({ body: { kind: "bool", value: true } });
    expect(typecheckProgram(program).errors.join("\n")).toContain(
      "expected Real, got Bool",
    );
  });

  test("rejects fractional literals in Int context", () => {
    const program = minimalProgram({
      params: [{ name: "x", type: "Int" }],
      returnType: "Int",
      ensures: [
        {
          axiomId: "AX1",
          expr: binop("==", variable("result"), variable("x")),
        },
      ],
      body: binop("+", variable("x"), num("0.5")),
    });
    expect(typecheckProgram(program).errors.join("\n")).toContain(
      "is not an integer",
    );
  });
});
