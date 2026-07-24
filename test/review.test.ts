import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { StructuredCallOptions } from "../src/agents/client.ts";
import { parseAdversarialReview } from "../src/generated/adversarial-review/index.ts";
import type { AdversarialReview } from "../src/generated/adversarial-review/index.ts";
import type { SpecPlan } from "../src/lang/ast.ts";
import { renderReviewMarkdown } from "../src/report/review.ts";
import currencySpec from "./fixtures/currency-spec.json";

// The adversarial review phase with the LLM client mocked. Covers: the verdict
// being derived from finding severities (never trusted from the model), the
// artifacts reaching the user turn, the generated parser rejecting malformed
// model output, and the PR markdown rendering.

const spec = currencySpec as SpecPlan;

let capturedCalls: StructuredCallOptions<unknown>[] = [];
let cannedResponse: AdversarialReview = { summary: "ok", findings: [] };

mock.module("../src/agents/client.ts", () => ({
  structuredCall: async (options: StructuredCallOptions<unknown>) => {
    capturedCalls.push(options);
    return options.parse(cannedResponse);
  },
}));

const { deriveVerdict, reviewSpecPlan } = await import(
  "../src/agents/adversary.ts"
);

beforeEach(() => {
  capturedCalls = [];
});

describe("deriveVerdict", () => {
  test("FLAGGED iff any blocking finding", () => {
    const advisory = {
      severity: "advisory",
      kind: "formula-shaped-axiom",
      title: "t",
      detail: "d",
    } as const;
    const blocking = {
      severity: "blocking",
      kind: "intent-conflict",
      title: "t",
      detail: "d",
    } as const;
    expect(deriveVerdict([])).toBe("CLEAR");
    expect(deriveVerdict([advisory])).toBe("CLEAR");
    expect(deriveVerdict([advisory, blocking])).toBe("FLAGGED");
  });
});

describe("reviewSpecPlan", () => {
  test("derives the verdict and passes every artifact to the model", async () => {
    cannedResponse = {
      summary: "The contract omits the intent's fee cap.",
      findings: [
        {
          severity: "blocking",
          kind: "missing-axiom",
          title: "No axiom enforces the 40 EUR cap",
          detail: "Intent says fees are capped; no axiom mentions a cap.",
          suggestedAxiom: "result is at most 40",
        },
      ],
    };
    const result = await reviewSpecPlan({
      spec,
      baselineSpec: spec,
      intent: "Cap fees at 40 EUR",
      deltas: { status: "DIFFERENT" },
    });

    expect(result.verdict).toBe("FLAGGED");
    expect(result.findings).toHaveLength(1);
    const call = capturedCalls[0];
    expect(call?.userContent).toContain("Cap fees at 40 EUR");
    expect(call?.userContent).toContain("PREVIOUS SPECPLAN");
    expect(call?.userContent).toContain("SPECPLAN UNDER REVIEW");
    expect(call?.userContent).toContain('"DIFFERENT"');
    expect(call?.systemPrompt).toContain("contract-vs-intent");
  });

  test("advisory-only findings yield CLEAR even if the model sounds alarmed", async () => {
    cannedResponse = {
      summary: "Minor style issue only.",
      findings: [
        {
          severity: "advisory",
          kind: "formula-shaped-axiom",
          title: "AX2 restates the algorithm",
          detail: "result == amount * 0.91 is the implementation as spec.",
        },
      ],
    };
    const result = await reviewSpecPlan({ spec });
    expect(result.verdict).toBe("CLEAR");
    expect(capturedCalls[0]?.userContent).toContain(
      "none provided — review the SpecPlan on its own terms",
    );
    expect(capturedCalls[0]?.userContent).not.toContain("PREVIOUS SPECPLAN");
  });
});

describe("parseAdversarialReview", () => {
  test("rejects malformed model output", () => {
    expect(() => parseAdversarialReview({ summary: "x" })).toThrow();
    expect(() =>
      parseAdversarialReview({
        summary: "x",
        findings: [{ severity: "fatal", kind: "missing-axiom" }],
      }),
    ).toThrow();
  });
});

describe("renderReviewMarkdown", () => {
  test("CLEAR with no findings", () => {
    const md = renderReviewMarkdown({
      verdict: "CLEAR",
      summary: "Contract and intent agree.",
      findings: [],
    });
    expect(md).toContain("**Adversarial review:** ✅ CLEAR");
    expect(md).toContain("No gaps found");
  });

  test("FLAGGED groups blocking before advisory with scenario and axiom", () => {
    const md = renderReviewMarkdown({
      verdict: "FLAGGED",
      summary: "One real gap.",
      findings: [
        {
          severity: "advisory",
          kind: "underspecified-domain",
          title: "Nothing pins amounts above 1e6",
          detail: "Large amounts are unconstrained.",
        },
        {
          severity: "blocking",
          kind: "intent-conflict",
          title: "Negative fees are permitted",
          detail: "AX1 only bounds the input, not the result.",
          scenario: "amount = 0.01 gives result = -0.5",
          suggestedAxiom: "result is non-negative",
        },
      ],
    });
    expect(md).toContain("**Adversarial review:** 🛑 FLAGGED");
    expect(md.indexOf("### Blocking")).toBeLessThan(md.indexOf("### Advisory"));
    expect(md).toContain("Intent conflict: Negative fees are permitted");
    expect(md).toContain("Scenario: amount = 0.01 gives result = -0.5");
    expect(md).toContain("Suggested axiom: `result is non-negative`");
  });
});
