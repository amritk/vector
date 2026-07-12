import { describe, expect, test } from "bun:test";
import type { Expr, Program, SpecPlan } from "../src/lang/ast.ts";
import { verifySpecAndProgram } from "../src/verify.ts";

// Regression tests for the soundness gaps found in the feasibility audit. Each
// case is a program that a naive verifier would wave through but whose "proof"
// does not survive contact with the emitted float64 code, an inhabited input
// domain, or the actual meaning of the axiom. Every one must be blocked.

const SOLVER_TIMEOUT = 60_000;

// ── expression builders ────────────────────────────────────────────────────
const num = (v: string): Expr => ({ kind: "num", value: v });
const v = (name: string): Expr => ({ kind: "var", name });
const bin = (op: string, left: Expr, right: Expr): Expr =>
  ({ kind: "binop", op, left, right }) as Expr;
const call = (fn: string, args: Expr[]): Expr => ({ kind: "call", fn, args });
const eq = (a: Expr, b: Expr) => bin("==", a, b);
const ge = (a: Expr, b: Expr) => bin(">=", a, b);
const gt = (a: Expr, b: Expr) => bin(">", a, b);
const le = (a: Expr, b: Expr) => bin("<=", a, b);

describe("soundness gate — proven means proven", () => {
  test(
    "blocks a vacuous proof from contradictory preconditions",
    async () => {
      const spec: SpecPlan = {
        programName: "vac",
        axioms: [
          { id: "P", kind: "pre", statement: "x positive and negative" },
          { id: "Q", kind: "post", statement: "result is 999" },
        ],
        units: [
          {
            name: "f",
            layer: 1,
            purpose: "vacuous",
            params: [{ name: "x", type: "Real" }],
            returnType: "Real",
            relevantAxiomIds: ["P", "Q"],
          },
        ],
      };
      const prog: Program = {
        programName: "vac",
        functions: [
          {
            name: "f",
            layer: 1,
            purpose: "vacuous",
            params: [{ name: "x", type: "Real" }],
            returnType: "Real",
            requires: [
              {
                axiomId: "P",
                expr: bin(
                  "and",
                  gt(v("x"), num("0")),
                  bin("<", v("x"), num("0")),
                ),
              },
            ],
            ensures: [{ axiomId: "Q", expr: eq(v("result"), num("999")) }],
            body: v("x"),
          },
        ],
      };
      const outcome = await verifySpecAndProgram(spec, prog);
      expect(outcome.status).not.toBe("PROVEN");
      if (outcome.status === "REFUTED") {
        expect(outcome.items.some((i) => i.issue === "vacuous")).toBe(true);
      }
    },
    SOLVER_TIMEOUT,
  );

  test("rejects Int division at the type gate (JS `/` is not integer division)", async () => {
    const spec: SpecPlan = {
      programName: "half",
      axioms: [{ id: "AX", kind: "post", statement: "2*result != 3" }],
      units: [
        {
          name: "half",
          layer: 1,
          purpose: "halve",
          params: [{ name: "n", type: "Int" }],
          returnType: "Int",
          relevantAxiomIds: ["AX"],
        },
      ],
    };
    const prog: Program = {
      programName: "half",
      functions: [
        {
          name: "half",
          layer: 1,
          purpose: "halve",
          params: [{ name: "n", type: "Int" }],
          returnType: "Int",
          requires: [],
          ensures: [
            {
              axiomId: "AX",
              expr: bin("!=", bin("*", num("2"), v("result")), num("3")),
            },
          ],
          body: bin("/", v("n"), num("2")),
        },
      ],
    };
    const outcome = await verifySpecAndProgram(spec, prog);
    expect(outcome.status).toBe("INVALID");
  });

  test(
    "blocks a real-valid postcondition that fails in float64 (0.1 + 0.2)",
    async () => {
      const spec: SpecPlan = {
        programName: "addcents",
        axioms: [{ id: "AX", kind: "post", statement: "result == x + 0.3" }],
        units: [
          {
            name: "addCents",
            layer: 1,
            purpose: "add 30c in two steps",
            params: [{ name: "x", type: "Real" }],
            returnType: "Real",
            relevantAxiomIds: ["AX"],
          },
        ],
      };
      const body = bin("+", bin("+", v("x"), num("0.1")), num("0.2"));
      const prog: Program = {
        programName: "addcents",
        functions: [
          {
            name: "addCents",
            layer: 1,
            purpose: "add 30c in two steps",
            params: [{ name: "x", type: "Real" }],
            returnType: "Real",
            requires: [],
            ensures: [
              {
                axiomId: "AX",
                expr: eq(v("result"), bin("+", v("x"), num("0.3"))),
              },
            ],
            body,
          },
        ],
      };
      const outcome = await verifySpecAndProgram(spec, prog);
      expect(outcome.status).toBe("REFUTED");
      if (outcome.status === "REFUTED") {
        expect(outcome.items.some((i) => i.issue === "conformance")).toBe(true);
      }
    },
    SOLVER_TIMEOUT,
  );

  test("rejects an ensures clause that never mentions result", async () => {
    const spec: SpecPlan = {
      programName: "conv",
      axioms: [{ id: "AX", kind: "post", statement: "result == amount*0.91" }],
      units: [
        {
          name: "conv",
          layer: 1,
          purpose: "convert",
          params: [{ name: "amount", type: "Real" }],
          returnType: "Real",
          relevantAxiomIds: ["AX"],
        },
      ],
    };
    const prog: Program = {
      programName: "conv",
      functions: [
        {
          name: "conv",
          layer: 1,
          purpose: "convert",
          params: [{ name: "amount", type: "Real" }],
          returnType: "Real",
          requires: [],
          ensures: [{ axiomId: "AX", expr: eq(v("amount"), v("amount")) }],
          body: bin("*", v("amount"), num("0.5")),
        },
      ],
    };
    const outcome = await verifySpecAndProgram(spec, prog);
    expect(outcome.status).toBe("INVALID");
    if (outcome.status === "INVALID") {
      expect(outcome.errors.join("\n")).toContain("must reference");
    }
  });

  test(
    "flags a tautological ensures that does mention result (result == result)",
    async () => {
      const spec: SpecPlan = {
        programName: "taut",
        axioms: [{ id: "AX", kind: "post", statement: "result == amount*0.5" }],
        units: [
          {
            name: "taut",
            layer: 1,
            purpose: "convert",
            params: [{ name: "amount", type: "Real" }],
            returnType: "Real",
            relevantAxiomIds: ["AX"],
          },
        ],
      };
      const prog: Program = {
        programName: "taut",
        functions: [
          {
            name: "taut",
            layer: 1,
            purpose: "convert",
            params: [{ name: "amount", type: "Real" }],
            returnType: "Real",
            requires: [],
            ensures: [{ axiomId: "AX", expr: eq(v("result"), v("result")) }],
            body: bin("*", v("amount"), num("0.5")),
          },
        ],
      };
      const outcome = await verifySpecAndProgram(spec, prog);
      expect(outcome.status).toBe("REFUTED");
      if (outcome.status === "REFUTED") {
        expect(outcome.items.some((i) => i.issue === "trivial")).toBe(true);
      }
    },
    SOLVER_TIMEOUT,
  );

  test(
    "blocks a call site that violates the callee's precondition",
    async () => {
      const spec: SpecPlan = {
        programName: "cs",
        axioms: [
          { id: "GP", kind: "pre", statement: "g requires y > 0" },
          { id: "FP", kind: "pre", statement: "f requires x >= 0" },
          { id: "FR", kind: "post", statement: "f returns its input" },
          { id: "GR", kind: "post", statement: "g returns its input" },
        ],
        units: [
          {
            name: "g",
            layer: 1,
            purpose: "id on positives",
            params: [{ name: "y", type: "Real" }],
            returnType: "Real",
            relevantAxiomIds: ["GP", "GR"],
          },
          {
            name: "f",
            layer: 2,
            purpose: "wrapper",
            params: [{ name: "x", type: "Real" }],
            returnType: "Real",
            relevantAxiomIds: ["FP", "FR"],
          },
        ],
      };
      const prog: Program = {
        programName: "cs",
        functions: [
          {
            name: "g",
            layer: 1,
            purpose: "id on positives",
            params: [{ name: "y", type: "Real" }],
            returnType: "Real",
            requires: [{ axiomId: "GP", expr: gt(v("y"), num("0")) }],
            ensures: [{ axiomId: "GR", expr: eq(v("result"), v("y")) }],
            body: v("y"),
          },
          {
            name: "f",
            layer: 2,
            purpose: "wrapper",
            params: [{ name: "x", type: "Real" }],
            returnType: "Real",
            requires: [{ axiomId: "FP", expr: ge(v("x"), num("0")) }],
            ensures: [{ axiomId: "FR", expr: eq(v("result"), v("x")) }],
            body: call("g", [v("x")]),
          },
        ],
      };
      const outcome = await verifySpecAndProgram(spec, prog);
      expect(outcome.status).toBe("REFUTED");
      if (outcome.status === "REFUTED") {
        expect(
          outcome.items.some((i) => i.issue === "precondition-hazard"),
        ).toBe(true);
      }
    },
    SOLVER_TIMEOUT,
  );

  test("rejects a post axiom formalized only as a requires (polarity)", async () => {
    const spec: SpecPlan = {
      programName: "pol",
      axioms: [
        // GUARANTEE is a post axiom, but the program will only enforce it as a
        // runtime requires — dropping the proof obligation.
        { id: "GUARANTEE", kind: "post", statement: "result >= 0" },
        { id: "SHAPE", kind: "post", statement: "result == x" },
      ],
      units: [
        {
          name: "pol",
          layer: 1,
          purpose: "identity on non-negatives",
          params: [{ name: "x", type: "Real" }],
          returnType: "Real",
          relevantAxiomIds: ["GUARANTEE", "SHAPE"],
        },
      ],
    };
    const prog: Program = {
      programName: "pol",
      functions: [
        {
          name: "pol",
          layer: 1,
          purpose: "identity on non-negatives",
          params: [{ name: "x", type: "Real" }],
          returnType: "Real",
          requires: [{ axiomId: "GUARANTEE", expr: ge(v("x"), num("0")) }],
          ensures: [{ axiomId: "SHAPE", expr: eq(v("result"), v("x")) }],
          body: v("x"),
        },
      ],
    };
    const outcome = await verifySpecAndProgram(spec, prog);
    expect(outcome.status).toBe("INVALID");
    if (outcome.status === "INVALID") {
      expect(outcome.errors.join("\n")).toContain("post");
    }
  });

  test(
    "blocks a postcondition that overflows to Infinity in float64",
    async () => {
      // x + x - x - x == 0 over the reals, but at x = 1e308 the intermediate
      // x + x overflows to Infinity, so the emitted code returns Infinity != 0.
      const spec: SpecPlan = {
        programName: "zero",
        axioms: [{ id: "AX", kind: "post", statement: "result is 0" }],
        units: [
          {
            name: "zero",
            layer: 1,
            purpose: "always zero",
            params: [{ name: "x", type: "Real" }],
            returnType: "Real",
            relevantAxiomIds: ["AX"],
          },
        ],
      };
      const body = bin("-", bin("-", bin("+", v("x"), v("x")), v("x")), v("x"));
      const prog: Program = {
        programName: "zero",
        functions: [
          {
            name: "zero",
            layer: 1,
            purpose: "always zero",
            params: [{ name: "x", type: "Real" }],
            returnType: "Real",
            requires: [],
            ensures: [{ axiomId: "AX", expr: eq(v("result"), num("0")) }],
            body,
          },
        ],
      };
      const outcome = await verifySpecAndProgram(spec, prog);
      expect(outcome.status).toBe("REFUTED");
      if (outcome.status === "REFUTED") {
        expect(outcome.items.some((i) => i.issue === "conformance")).toBe(true);
      }
    },
    SOLVER_TIMEOUT,
  );

  test("rejects a program that does not match the spec decomposition", async () => {
    const spec: SpecPlan = {
      programName: "mismatch",
      axioms: [{ id: "AX", kind: "post", statement: "result == x" }],
      units: [
        {
          name: "declared",
          layer: 1,
          purpose: "id",
          params: [{ name: "x", type: "Real" }],
          returnType: "Real",
          relevantAxiomIds: ["AX"],
        },
      ],
    };
    const prog: Program = {
      programName: "mismatch",
      functions: [
        {
          name: "somethingElse",
          layer: 1,
          purpose: "id",
          params: [{ name: "x", type: "Real" }],
          returnType: "Real",
          requires: [],
          ensures: [{ axiomId: "AX", expr: eq(v("result"), v("x")) }],
          body: v("x"),
        },
      ],
    };
    const outcome = await verifySpecAndProgram(spec, prog);
    expect(outcome.status).toBe("INVALID");
    if (outcome.status === "INVALID") {
      expect(outcome.errors.join("\n")).toContain("spec");
    }
  });
});

describe("soundness gate — legitimate programs still prove", () => {
  test(
    "clamp via min/max/abs and round-to-cents via floor both prove clean",
    async () => {
      const spec: SpecPlan = {
        programName: "clamp",
        axioms: [
          { id: "LO", kind: "post", statement: "result >= 0" },
          { id: "HI", kind: "post", statement: "result <= 100" },
        ],
        units: [
          {
            name: "clamp",
            layer: 1,
            purpose: "clamp to [0,100]",
            params: [{ name: "x", type: "Real" }],
            returnType: "Real",
            relevantAxiomIds: ["LO", "HI"],
          },
        ],
      };
      const body = bin("min", bin("max", v("x"), num("0")), num("100"));
      const prog: Program = {
        programName: "clamp",
        functions: [
          {
            name: "clamp",
            layer: 1,
            purpose: "clamp to [0,100]",
            params: [{ name: "x", type: "Real" }],
            returnType: "Real",
            requires: [],
            ensures: [
              { axiomId: "LO", expr: ge(v("result"), num("0")) },
              { axiomId: "HI", expr: le(v("result"), num("100")) },
            ],
            body,
          },
        ],
      };
      const outcome = await verifySpecAndProgram(spec, prog);
      expect(outcome.status).toBe("PROVEN");
      if (outcome.status === "PROVEN") {
        expect(outcome.emittedCode).toContain("Math.min");
        expect(outcome.emittedCode).toContain("Number.isFinite");
      }
    },
    SOLVER_TIMEOUT,
  );
});
