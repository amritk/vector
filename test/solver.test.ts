import { describe, expect, test } from "bun:test";
import { parseProgram } from "../src/generated/program/index.ts";
import type { Expr, Program } from "../src/lang/ast.ts";
import { verifyProgramViaSolver } from "../src/solve/runner.ts";
import currencyFixture from "./fixtures/currency.json";
import unsatFixture from "./fixtures/unsat.json";

// These tests exercise the real Z3 pipeline end-to-end through the Node
// subprocess boundary — each case pays a ~1s WASM init, so keep them few
// and meaningful.

const SOLVER_TIMEOUT = 30_000;

const num = (value: string): Expr => ({ kind: "num", value });
const variable = (name: string): Expr => ({ kind: "var", name });

describe("verifyProgramViaSolver", () => {
  test(
    "proves the currency converter: 3 VCs, all unsat",
    async () => {
      const result = await verifyProgramViaSolver(
        parseProgram(currencyFixture),
      );
      if (result.kind !== "report") throw new Error(JSON.stringify(result));
      expect(result.report.ok).toBe(true);
      expect(result.report.totalVcs).toBe(3);
      expect(result.report.unsatCount).toBe(3);
      expect(result.report.satCount).toBe(0);
      expect(result.report.divHazardCount).toBe(0);
    },
    SOLVER_TIMEOUT,
  );

  test(
    "refutes the impossible spec with a concrete counterexample",
    async () => {
      const result = await verifyProgramViaSolver(parseProgram(unsatFixture));
      if (result.kind !== "report") throw new Error(JSON.stringify(result));
      expect(result.report.ok).toBe(false);
      expect(result.report.satCount).toBe(1);
      const verdict = result.report.functions[0]?.ensures[0];
      expect(verdict?.status).toBe("counterexample");
      expect(verdict?.counterexample?.inputs.amount).toBeDefined();
      expect(verdict?.counterexample?.result).toBeDefined();
    },
    SOLVER_TIMEOUT,
  );

  test(
    "proves an ite-based abs(): branches carry their path conditions",
    async () => {
      const program: Program = {
        programName: "abs_value",
        functions: [
          {
            name: "absValue",
            layer: 1,
            purpose: "Absolute value via if-then-else.",
            params: [{ name: "x", type: "Real" }],
            returnType: "Real",
            requires: [],
            ensures: [
              {
                axiomId: "AX1",
                expr: {
                  kind: "binop",
                  op: ">=",
                  left: variable("result"),
                  right: num("0"),
                },
              },
              {
                axiomId: "AX2",
                expr: {
                  kind: "binop",
                  op: "or",
                  left: {
                    kind: "binop",
                    op: "==",
                    left: variable("result"),
                    right: variable("x"),
                  },
                  right: {
                    kind: "binop",
                    op: "==",
                    left: variable("result"),
                    right: { kind: "unop", op: "neg", arg: variable("x") },
                  },
                },
              },
            ],
            body: {
              kind: "ite",
              cond: {
                kind: "binop",
                op: ">=",
                left: variable("x"),
                right: num("0"),
              },
              then: variable("x"),
              else: { kind: "unop", op: "neg", arg: variable("x") },
            },
          },
        ],
      };
      const result = await verifyProgramViaSolver(program);
      if (result.kind !== "report") throw new Error(JSON.stringify(result));
      expect(result.report.ok).toBe(true);
      expect(result.report.unsatCount).toBe(2);
    },
    SOLVER_TIMEOUT,
  );

  test(
    "flags a division-by-zero hazard, and clears it when guarded",
    async () => {
      const reciprocal = (guarded: boolean): Program => ({
        programName: "reciprocal",
        functions: [
          {
            name: "reciprocal",
            layer: 1,
            purpose: "1/x.",
            params: [{ name: "x", type: "Real" }],
            returnType: "Real",
            requires: guarded
              ? [
                  {
                    axiomId: "AX0",
                    expr: {
                      kind: "binop",
                      op: "!=",
                      left: variable("x"),
                      right: num("0"),
                    },
                  },
                ]
              : [],
            ensures: [
              {
                axiomId: "AX1",
                expr: {
                  kind: "binop",
                  op: "==",
                  left: variable("result"),
                  right: {
                    kind: "binop",
                    op: "/",
                    left: num("1"),
                    right: variable("x"),
                  },
                },
              },
            ],
            body: {
              kind: "binop",
              op: "/",
              left: num("1"),
              right: variable("x"),
            },
          },
        ],
      });

      const unguarded = await verifyProgramViaSolver(reciprocal(false));
      if (unguarded.kind !== "report")
        throw new Error(JSON.stringify(unguarded));
      expect(unguarded.report.divHazardCount).toBeGreaterThan(0);
      expect(unguarded.report.ok).toBe(false);

      const guarded = await verifyProgramViaSolver(reciprocal(true));
      if (guarded.kind !== "report") throw new Error(JSON.stringify(guarded));
      expect(guarded.report.divHazardCount).toBe(0);
      expect(guarded.report.ok).toBe(true);
    },
    SOLVER_TIMEOUT,
  );

  test(
    "reports schema violations as invalid, not a crash",
    async () => {
      const result = await verifyProgramViaSolver({
        nonsense: true,
      } as unknown as Program);
      expect(result.kind).toBe("invalid");
    },
    SOLVER_TIMEOUT,
  );
});
