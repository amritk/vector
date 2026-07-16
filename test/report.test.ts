import { describe, expect, test } from "bun:test";
import type { Program } from "../src/lang/ast.ts";
import {
  type QueryAnswer,
  type SmtQuery,
  normalizeValue,
  parseZ3Output,
} from "../src/solve/smt.ts";
import { assembleReport } from "../src/solve/verify.ts";

// Unit tests for the verdict-assembly layer, driven with synthetic solver
// answers — the one place the meaningfulness gates (non-vacuity,
// non-triviality) decide whether an `unknown` counts as established. They must
// fail CLOSED: a solver that gives up is not a solver that agreed.

const program: Program = {
  programName: "p",
  functions: [
    {
      name: "f",
      layer: 1,
      purpose: "id",
      params: [{ name: "x", type: "Real" }],
      returnType: "Real",
      requires: [],
      ensures: [
        {
          axiomId: "AX1",
          expr: {
            kind: "binop",
            op: "==",
            left: { kind: "var", name: "result" },
            right: { kind: "var", name: "x" },
          },
        },
      ],
      body: { kind: "var", name: "x" },
    },
  ],
};

const params = [{ smt: "f0_x", orig: "x" }];
const queries: SmtQuery[] = [
  {
    kind: "reachable",
    fn: "f",
    axiomId: "(reachable)",
    pretty: "requires are satisfiable",
    params,
    resultSmt: "f0_result",
  },
  {
    kind: "ensures",
    fn: "f",
    axiomId: "AX1",
    clauseIndex: 0,
    pretty: "result == x",
    params,
    resultSmt: "f0_result",
  },
  {
    kind: "trivial",
    fn: "f",
    axiomId: "AX1",
    clauseIndex: 0,
    pretty: "result == x",
    params,
    resultSmt: "f0_result",
  },
];

const answer = (result: QueryAnswer["result"]): QueryAnswer => ({
  result,
  model: {},
});

describe("assembleReport meaningfulness gates fail closed", () => {
  test("sat reachability + sat triviality + unsat ensures ⇒ ok", () => {
    const report = assembleReport(
      program,
      queries,
      [answer("sat"), answer("unsat"), answer("sat")],
      "Z3 (test)",
      1,
    );
    expect(report.ok).toBe(true);
    expect(report.functions[0]?.vacuous).toBe(false);
    expect(report.functions[0]?.ensures[0]?.trivial).toBeUndefined();
  });

  test("unknown on the reachability check counts as vacuous (not established)", () => {
    const report = assembleReport(
      program,
      queries,
      [answer("unknown"), answer("unsat"), answer("sat")],
      "Z3 (test)",
      1,
    );
    expect(report.functions[0]?.vacuous).toBe(true);
    expect(report.ok).toBe(false);
  });

  test("unknown on the triviality check counts as trivial (not established)", () => {
    const report = assembleReport(
      program,
      queries,
      [answer("sat"), answer("unsat"), answer("unknown")],
      "Z3 (test)",
      1,
    );
    expect(report.functions[0]?.ensures[0]?.trivial).toBe(true);
    expect(report.ok).toBe(false);
  });
});

describe("parseZ3Output model parsing", () => {
  test("reads nested negative rationals in either nesting order", () => {
    const stdout = [
      "@@Q0",
      "sat",
      "((f0_x (- (/ 1 2))) (f0_result (/ (- 1) 2)))",
      "@@Q1",
      "unsat",
      '(error "no model")',
      "",
    ].join("\n");
    const answers = parseZ3Output(stdout, 2);
    expect(answers[0]?.result).toBe("sat");
    expect(answers[0]?.model.f0_x).toBe("-1/2");
    expect(answers[0]?.model.f0_result).toBe("-1/2");
    expect(answers[1]?.result).toBe("unsat");
    expect(answers[1]?.model).toEqual({});
  });

  test("renders values it cannot canonicalize (root-obj) as readable text", () => {
    const stdout = [
      "@@Q0",
      "sat",
      "((f0_x (root-obj (+ (^ x 2) (- 2)) 1)))",
      "",
    ].join("\n");
    const answers = parseZ3Output(stdout, 1);
    // Nested unary minus still canonicalizes; the rest renders as-is.
    expect(answers[0]?.model.f0_x).toBe("(root-obj (+ (^ x 2) -2) 1)");
  });

  test("a query with no marker stays unknown", () => {
    const answers = parseZ3Output("@@Q0\nsat\n((f0_x 3.0))\n", 2);
    expect(answers[0]?.result).toBe("sat");
    expect(answers[0]?.model.f0_x).toBe("3");
    expect(answers[1]?.result).toBe("unknown");
  });
});

describe("normalizeValue", () => {
  test("canonicalizes integer-valued reals and leaves the rest alone", () => {
    expect(normalizeValue("3.0")).toBe("3");
    expect(normalizeValue("-3.00")).toBe("-3");
    expect(normalizeValue("0.91")).toBe("0.91");
    expect(normalizeValue("x")).toBe("x");
  });
});
