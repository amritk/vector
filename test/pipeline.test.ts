import { describe, expect, test } from "bun:test";
import type { SpecPlan } from "../src/agents/architect.ts";
import { parseProgram } from "../src/generated/program/index.ts";
import { checkAxiomTraceability } from "../src/pipeline.ts";
import currencyFixture from "./fixtures/currency.json";

const specPlan: SpecPlan = {
  programName: "usd_to_eur_converter",
  axioms: [
    { id: "AX1", kind: "pre", statement: "amount is non-negative" },
    { id: "AX2", kind: "post", statement: "result equals amount times 0.91" },
    {
      id: "AX2a",
      kind: "post",
      statement: "applyRate returns amount times rate",
    },
    { id: "AX3", kind: "post", statement: "result is non-negative" },
    { id: "AX-RATE", kind: "pre", statement: "rate is positive" },
  ],
  units: [],
};

describe("checkAxiomTraceability", () => {
  const program = parseProgram(currencyFixture);

  test("passes when every axiom is enforced and no phantom axioms are cited", () => {
    expect(checkAxiomTraceability(specPlan, program)).toEqual([]);
  });

  test("flags spec axioms no clause enforces", () => {
    const withExtraAxiom: SpecPlan = {
      ...specPlan,
      axioms: [
        ...specPlan.axioms,
        { id: "AX9", kind: "post", statement: "result is even" },
      ],
    };
    const errors = checkAxiomTraceability(withExtraAxiom, program);
    expect(errors.join("\n")).toContain("axiom AX9");
    expect(errors.join("\n")).toContain("not enforced by any clause");
  });

  test("flags clauses citing axioms the spec never defined", () => {
    const narrowSpec: SpecPlan = {
      ...specPlan,
      axioms: specPlan.axioms.slice(0, 2),
    };
    const errors = checkAxiomTraceability(narrowSpec, program);
    expect(errors.join("\n")).toContain('unknown axiom "AX-RATE"');
  });
});
