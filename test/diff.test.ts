import { describe, expect, test } from "bun:test";
import { diffPrograms } from "../src/diff.ts";
import type { Program } from "../src/lang/ast.ts";
import currencyFixture from "./fixtures/currency.json";

// The regeneration gate: `vector --diff` proves a new generation of a program
// behavior-preserving against the old one, or produces concrete input/output
// deltas. The solver subprocess is real. Behavior = requires (runtime guards)
// + body; ensures are proof-only and must never register as a difference.

const base = currencyFixture as unknown as Program;

const clone = (): Program => structuredClone(base);

describe("diffPrograms", () => {
  test("EQUIVALENT: a program is equivalent to itself", async () => {
    const outcome = await diffPrograms(base, clone());
    expect(outcome.status).toBe("EQUIVALENT");
    if (outcome.status !== "EQUIVALENT") return;
    expect(outcome.report.matched).toHaveLength(2);
    expect(outcome.report.matched.every((m) => m.equivalent)).toBe(true);
    expect(outcome.summary).toContain("EQUIVALENT");
  }, 60_000);

  test("EQUIVALENT: a restructured but extensionally equal body proves equal", async () => {
    const next = clone();
    const applyRate = next.functions[0];
    if (!applyRate) throw new Error("fixture drift");
    // amount * rate → rate * amount: different AST, same function.
    applyRate.body = {
      kind: "binop",
      op: "*",
      left: { kind: "var", name: "rate" },
      right: { kind: "var", name: "amount" },
    };
    const outcome = await diffPrograms(base, next);
    expect(outcome.status).toBe("EQUIVALENT");
  }, 60_000);

  test("EQUIVALENT: a contract rewording alone is not a behavioral change", async () => {
    const next = clone();
    const usdToEur = next.functions[1];
    if (!usdToEur) throw new Error("fixture drift");
    // Weaken the proof-only ensures AX3 (result >= 0 → result >= -1). The
    // runtime behavior (guards + body) is untouched.
    const ax3 = usdToEur.ensures.find((c) => c.axiomId === "AX3");
    if (!ax3) throw new Error("fixture drift");
    ax3.expr = {
      kind: "binop",
      op: ">=",
      left: { kind: "var", name: "result" },
      right: { kind: "num", value: "-1" },
    };
    const outcome = await diffPrograms(base, next);
    expect(outcome.status).toBe("EQUIVALENT");
    if (outcome.status !== "EQUIVALENT") return;
    // …but the textual contract change is still surfaced for review.
    const m = outcome.report.matched.find((f) => f.name === "usdToEur");
    expect(m?.contractChanges.ensuresAdded).toContain("result >= -1");
  }, 60_000);

  test("DIFFERENT: a changed constant yields a concrete value witness", async () => {
    const next = clone();
    const body = next.functions[1]?.body;
    if (!body || body.kind !== "call") throw new Error("fixture drift");
    const rateArg = body.args[1];
    if (!rateArg || rateArg.kind !== "num") throw new Error("fixture drift");
    rateArg.value = "0.92";

    const outcome = await diffPrograms(base, next);
    expect(outcome.status).toBe("DIFFERENT");
    if (outcome.status !== "DIFFERENT") return;
    const m = outcome.report.matched.find((f) => f.name === "usdToEur");
    expect(m?.equivalent).toBe(false);
    expect(m?.valueDiff.status).toBe("witness");
    expect(m?.valueDiff.witness?.inputs).toHaveProperty("amount");
    expect(m?.valueDiff.witness?.oldResult).toBeDefined();
    expect(m?.valueDiff.witness?.newResult).toBeDefined();
    expect(m?.valueDiff.witness?.oldResult).not.toBe(
      m?.valueDiff.witness?.newResult as string,
    );
    // The untouched lower layer stays equivalent.
    expect(
      outcome.report.matched.find((f) => f.name === "applyRate")?.equivalent,
    ).toBe(true);
  }, 60_000);

  test("DIFFERENT: a tightened precondition is a domain narrowing, not a value diff", async () => {
    const next = clone();
    const req = next.functions[1]?.requires[0];
    if (!req || req.expr.kind !== "binop" || req.expr.right.kind !== "num") {
      throw new Error("fixture drift");
    }
    req.expr.right.value = "1"; // amount >= 0 → amount >= 1

    const outcome = await diffPrograms(base, next);
    expect(outcome.status).toBe("DIFFERENT");
    if (outcome.status !== "DIFFERENT") return;
    const m = outcome.report.matched.find((f) => f.name === "usdToEur");
    expect(m?.domainNarrowed.status).toBe("witness");
    expect(m?.domainWidened.status).toBe("none");
    // On the (shared) surviving domain the bodies still agree.
    expect(m?.valueDiff.status).toBe("none");
  }, 60_000);

  test("DIFFERENT: a removed function is breaking; an added one is informational", async () => {
    const removed = clone();
    removed.functions = removed.functions.filter((f) => f.name !== "usdToEur");
    const outcome = await diffPrograms(base, removed);
    expect(outcome.status).toBe("DIFFERENT");
    if (outcome.status !== "DIFFERENT") return;
    expect(outcome.report.removed).toEqual(["usdToEur(amount: Real): Real"]);

    // The reverse direction only *adds* — that alone is not a difference.
    const reverse = await diffPrograms(removed, base);
    expect(reverse.status).toBe("EQUIVALENT");
    if (reverse.status !== "EQUIVALENT") return;
    expect(reverse.report.added).toEqual(["usdToEur(amount: Real): Real"]);
  }, 60_000);

  test("DIFFERENT: a changed signature is reported without a solver query", async () => {
    const next = clone();
    const usdToEur = next.functions[1];
    if (!usdToEur) throw new Error("fixture drift");
    usdToEur.params.push({ name: "fee", type: "Real" });

    const outcome = await diffPrograms(base, next);
    expect(outcome.status).toBe("DIFFERENT");
    if (outcome.status !== "DIFFERENT") return;
    expect(outcome.report.signatureChanged).toEqual([
      {
        name: "usdToEur",
        oldSignature: "usdToEur(amount: Real): Real",
        newSignature: "usdToEur(amount: Real, fee: Real): Real",
      },
    ]);
    expect(outcome.report.matched.map((m) => m.name)).toEqual(["applyRate"]);
  }, 60_000);

  test("EQUIVALENT: a positional param rename is recorded but not a difference", async () => {
    const next = clone();
    const applyRate = next.functions[0];
    if (!applyRate?.params[0]) throw new Error("fixture drift");
    applyRate.params[0].name = "amt";
    const rename = (e: unknown): void => {
      if (typeof e !== "object" || e === null) return;
      const node = e as Record<string, unknown>;
      if (node.kind === "var" && node.name === "amount") node.name = "amt";
      for (const v of Object.values(node)) rename(v);
    };
    rename(applyRate.body);
    for (const c of [...applyRate.requires, ...applyRate.ensures]) {
      rename(c.expr);
    }

    const outcome = await diffPrograms(base, next);
    expect(outcome.status).toBe("EQUIVALENT");
    if (outcome.status !== "EQUIVALENT") return;
    const m = outcome.report.matched.find((f) => f.name === "applyRate");
    expect(m?.paramRenames).toEqual([{ oldName: "amount", newName: "amt" }]);
  }, 60_000);

  test("INVALID: a malformed side is rejected at the shape gate", async () => {
    const outcome = await diffPrograms(base, { programName: "broken" });
    expect(outcome.status).toBe("INVALID");
    if (outcome.status !== "INVALID") return;
    expect(outcome.errors.some((e) => e.startsWith("new program:"))).toBe(true);
  });
});
