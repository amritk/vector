import { describe, expect, mock, test } from "bun:test";
import type { SpecPlan } from "../src/agents/architect.ts";
import type { GeneratorFeedback } from "../src/agents/generator.ts";
import { parseProgram } from "../src/generated/program/index.ts";
import type { Program } from "../src/lang/ast.ts";
import currencyFixture from "./fixtures/currency.json";

// Exercises the full SPEC → GENERATE → VERIFY → retry loop with the two LLM
// agents mocked out (the solver subprocess is real). Attempt 1 formalizes
// axiom AX3 incorrectly; the solver's counterexample must flow back as
// feedback and attempt 2's correct program must prove.

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

const goodProgram = parseProgram(currencyFixture);

// Same axiom ids, but AX3 is mis-formalized as `result > amount` — refutable.
const badProgram: Program = structuredClone(goodProgram);
const badClause = badProgram.functions[1]?.ensures.find(
  (c) => c.axiomId === "AX3",
);
if (!badClause) throw new Error("fixture drift: usdToEur AX3 clause not found");
badClause.expr = {
  kind: "binop",
  op: ">",
  left: { kind: "var", name: "result" },
  right: { kind: "var", name: "amount" },
};

const generatorCalls: (GeneratorFeedback | undefined)[] = [];
let programQueue: Program[] = [];

mock.module("../src/agents/architect.ts", () => ({
  extractSpecPlan: async () => specPlan,
}));
mock.module("../src/agents/generator.ts", () => ({
  generateProgram: async (_spec: SpecPlan, feedback?: GeneratorFeedback) => {
    generatorCalls.push(feedback);
    const next = programQueue.shift();
    if (!next) throw new Error("mock generator ran out of programs");
    return next;
  },
}));

const { runPipeline } = await import("../src/pipeline.ts");

describe("runPipeline retry loop", () => {
  test("feeds the counterexample back and proves on attempt 2", async () => {
    generatorCalls.length = 0;
    programQueue = [badProgram, goodProgram];

    const outcome = await runPipeline("Build a USD to EUR converter", {
      maxRetries: 3,
    });

    expect(outcome.status).toBe("PROVEN");
    expect(outcome.attempts).toBe(2);
    expect(generatorCalls[0]).toBeUndefined();
    expect(generatorCalls[1]?.message).toContain("REFUTED");
    expect(generatorCalls[1]?.message).toContain("counterexample");
    expect(generatorCalls[1]?.previousProgram.programName).toBe(
      "usd_to_eur_converter",
    );
    expect(outcome.emittedCode).toContain("export function usdToEur");
    expect(outcome.dashboardText).toContain("Status: PROVEN");
  }, 60_000);

  test("exhausts retries on an unprovable program and withholds the code", async () => {
    generatorCalls.length = 0;
    programQueue = [badProgram, badProgram];

    const outcome = await runPipeline("Build a USD to EUR converter", {
      maxRetries: 2,
    });

    expect(outcome.status).toBe("REFUTED");
    expect(outcome.attempts).toBe(2);
    expect(outcome.emittedCode).toBeUndefined();
    expect(outcome.dashboardText).toContain("✘ ensures AX3");
    expect(outcome.dashboardText).toContain("counterexample");
  }, 60_000);

  test("treats axiom-traceability gaps as validation retries without invoking the solver", async () => {
    generatorCalls.length = 0;
    const missingAxiom: Program = structuredClone(goodProgram);
    const usdToEur = missingAxiom.functions[1];
    if (!usdToEur) throw new Error("fixture drift");
    usdToEur.ensures = usdToEur.ensures.filter((c) => c.axiomId !== "AX3");
    programQueue = [missingAxiom, goodProgram];

    const outcome = await runPipeline("Build a USD to EUR converter", {
      maxRetries: 3,
    });

    expect(outcome.status).toBe("PROVEN");
    expect(outcome.attempts).toBe(2);
    expect(generatorCalls[1]?.message).toContain("not enforced by any clause");
  }, 60_000);
});
