import { describe, expect, test } from "bun:test";
import { parseProgram } from "../src/generated/program/index.ts";
import { parseSpecPlan } from "../src/generated/spec-plan/index.ts";
import {
  validateProgramShape,
  validateSpecPlanShape,
} from "../src/lang/shape.ts";
import currencyFixture from "./fixtures/currency.json";

// The engine's own deep structural gate. Two jobs: (1) it is the ONLY
// validator on the Node solver-worker path, where the mjst-generated parsers
// can't load (their .js-suffixed relative imports don't resolve under Node
// type stripping); (2) defense-in-depth on the Bun side. As of mjst 0.8.0
// every runtime gap found during the zod migration is closed upstream —
// recursive expr union and minItems (0.7.16), nested enums in array items
// (0.8.0) — so these tests assert BOTH gates reject each bad input.

const goodSpecPlan = {
  programName: "usd_to_eur",
  axioms: [{ id: "AX1", kind: "pre", statement: "amount >= 0" }],
  units: [
    {
      name: "usdToEur",
      layer: 1,
      purpose: "convert",
      params: [{ name: "amount", type: "Real" }],
      returnType: "Real",
      relevantAxiomIds: ["AX1"],
    },
  ],
};

describe("validateProgramShape (mjst gap coverage)", () => {
  test("accepts the currency fixture", () => {
    expect(validateProgramShape(currencyFixture)).toEqual([]);
  });

  // Clone the fixture and overwrite one function field with an invalid value.
  function brokenFixture(index: number, field: string, value: unknown) {
    const bad = structuredClone(currencyFixture) as unknown as {
      functions: Record<string, unknown>[];
    };
    const fn = bad.functions[index];
    if (!fn) throw new Error("fixture drift");
    fn[field] = value;
    return bad;
  }

  test("both gates reject an unknown expr kind (parser enforces since 0.7.16)", () => {
    const bad = brokenFixture(0, "body", { kind: "nonsense" });
    expect(() => parseProgram(bad)).toThrow(/union branch/);
    expect(validateProgramShape(bad).join("\n")).toContain(
      'unknown expression kind "nonsense"',
    );
  });

  test("both gates reject a non-decimal num literal (parser enforces since 0.7.16)", () => {
    const bad = brokenFixture(1, "body", { kind: "num", value: "1e9" });
    expect(() => parseProgram(bad)).toThrow(/union branch/);
    expect(validateProgramShape(bad).join("\n")).toContain("decimal string");
  });

  test("catches an empty ensures array (minItems)", () => {
    const bad = brokenFixture(0, "ensures", []);
    expect(validateProgramShape(bad).join("\n")).toContain("at least 1 clause");
  });

  test("catches a bad binop operator", () => {
    const bad = brokenFixture(0, "body", {
      kind: "binop",
      op: "**",
      left: { kind: "var", name: "amount" },
      right: { kind: "var", name: "rate" },
    });
    expect(validateProgramShape(bad).join("\n")).toContain(
      "not a known operator",
    );
  });

  test("rejects non-objects outright", () => {
    expect(validateProgramShape(null).length).toBeGreaterThan(0);
    expect(validateProgramShape([1, 2]).length).toBeGreaterThan(0);
    expect(validateProgramShape({ nonsense: true }).length).toBeGreaterThan(0);
  });
});

describe("validateSpecPlanShape (mjst gap coverage)", () => {
  test("accepts a well-formed spec plan", () => {
    expect(validateSpecPlanShape(goodSpecPlan)).toEqual([]);
  });

  test("both gates reject a bad axiom kind (parser enforces since 0.8.0)", () => {
    const bad = {
      ...goodSpecPlan,
      axioms: [{ id: "AX1", kind: "maybe", statement: "x" }],
    };
    expect(() => parseSpecPlan(bad)).toThrow(/must be one of/);
    expect(validateSpecPlanShape(bad).join("\n")).toContain(
      'kind must be "pre" or "post"',
    );
  });

  test("catches a bad unit type enum", () => {
    const bad = {
      ...goodSpecPlan,
      units: [{ ...goodSpecPlan.units[0], returnType: "String" }],
    };
    expect(validateSpecPlanShape(bad).join("\n")).toContain(
      "returnType must be one of",
    );
  });

  test("catches empty axioms/units (minItems)", () => {
    expect(
      validateSpecPlanShape({ ...goodSpecPlan, axioms: [] }).join("\n"),
    ).toContain("axioms must be a non-empty array");
    expect(
      validateSpecPlanShape({ ...goodSpecPlan, units: [] }).join("\n"),
    ).toContain("units must be an array of 1-4 entries");
  });
});
