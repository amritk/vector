import { describe, expect, test } from "bun:test";
import type { Program, SpecPlan } from "../src/lang/ast.ts";
import { verifySpecAndProgram } from "../src/verify.ts";
import currencySpec from "./fixtures/currency-spec.json";
import currencyFixture from "./fixtures/currency.json";

// The deterministic verify-only entry point used by the Claude Code skill:
// Claude plays Architect + Generator and hands (SpecPlan, Program) JSON to this
// gate. The solver subprocess is real; only the LLM is removed.

const goodProgram = currencyFixture as unknown as Program;

describe("verifySpecAndProgram", () => {
  test("PROVEN: returns emitted code and a PROVEN dashboard", async () => {
    const outcome = await verifySpecAndProgram(currencySpec, goodProgram);
    expect(outcome.status).toBe("PROVEN");
    if (outcome.status !== "PROVEN") return;
    expect(outcome.emittedCode).toContain("export function usdToEur");
    expect(outcome.dashboard).toContain("Status: PROVEN");
  }, 60_000);

  test("REFUTED: surfaces a structured counterexample the skill can repair on", async () => {
    const badProgram = structuredClone(goodProgram);
    const clause = badProgram.functions[1]?.ensures.find(
      (c) => c.axiomId === "AX3",
    );
    if (!clause)
      throw new Error("fixture drift: usdToEur AX3 clause not found");
    // Mis-formalize AX3 as `result > amount` — refutable at amount = 0.
    clause.expr = {
      kind: "binop",
      op: ">",
      left: { kind: "var", name: "result" },
      right: { kind: "var", name: "amount" },
    };

    const outcome = await verifySpecAndProgram(currencySpec, badProgram);
    expect(outcome.status).toBe("REFUTED");
    if (outcome.status !== "REFUTED") return;
    expect(outcome.feedback).toContain("REFUTED");
    const item = outcome.items.find((i) => i.axiomId === "AX3");
    expect(item?.issue).toBe("counterexample");
    expect(item?.counterexample?.inputs).toHaveProperty("amount");
  }, 60_000);

  test("INVALID: axiom-traceability gaps are reported without invoking the solver", async () => {
    const missingAxiom = structuredClone(goodProgram);
    const usdToEur = missingAxiom.functions[1];
    if (!usdToEur) throw new Error("fixture drift");
    usdToEur.ensures = usdToEur.ensures.filter((c) => c.axiomId !== "AX3");

    const outcome = await verifySpecAndProgram(currencySpec, missingAxiom);
    expect(outcome.status).toBe("INVALID");
    if (outcome.status !== "INVALID") return;
    expect(outcome.errors.join("\n")).toContain("not enforced by any clause");
  });

  test("INVALID: malformed program is rejected at the shape gate", async () => {
    const outcome = await verifySpecAndProgram(currencySpec, {
      programName: "broken",
    } as unknown as Program);
    expect(outcome.status).toBe("INVALID");
    if (outcome.status !== "INVALID") return;
    expect(outcome.errors.some((e) => e.startsWith("program:"))).toBe(true);
  });
});

// Keep the exported spec-plan fixture in sync with the program fixture's axioms.
describe("currency fixtures", () => {
  test("spec plan and program agree on axiom ids", () => {
    const spec = currencySpec as unknown as SpecPlan;
    const specIds = new Set(spec.axioms.map((a) => a.id));
    const program = goodProgram;
    const programIds = new Set<string>();
    for (const fn of program.functions) {
      for (const c of [...fn.requires, ...fn.ensures])
        programIds.add(c.axiomId);
    }
    expect([...programIds].every((id) => specIds.has(id))).toBe(true);
    expect([...specIds].every((id) => programIds.has(id))).toBe(true);
  });
});
