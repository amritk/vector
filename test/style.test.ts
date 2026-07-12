import { describe, expect, test } from "bun:test";
import type { Program } from "../src/lang/ast.ts";
import { collectStyleWarnings } from "../src/lang/style.ts";
import { verifySpecAndProgram } from "../src/verify.ts";
import currencySpec from "./fixtures/currency-spec.json";
import currencyFixture from "./fixtures/currency.json";

// Advisory style checks for contract-driven development. Definitional ensures
// (`result == <formula>`) are flagged — the algorithm restated as spec — while
// property-shaped clauses (bounds, monotonicity) pass silently. Never a gate:
// a program full of warnings still proves.

const base = currencyFixture as unknown as Program;

describe("collectStyleWarnings", () => {
  test("flags definitional ensures, not property-shaped ones", () => {
    // AX2a (result == amount * rate) and AX2 (result == amount * 0.91) are
    // definitional; AX3 (result >= 0) is a property.
    const warnings = collectStyleWarnings(base);
    expect(warnings.map((w) => w.axiomId).sort()).toEqual(["AX2", "AX2a"]);
    expect(warnings.every((w) => w.kind === "definitional-ensures")).toBe(true);
  });

  test("a bare literal or variable pin is not flagged", () => {
    const program = structuredClone(base);
    const usdToEur = program.functions[1];
    if (!usdToEur) throw new Error("fixture drift");
    // "returns 0 when amount is 0" — an edge-case property from a ticket, fine.
    usdToEur.ensures = [
      {
        axiomId: "AX2",
        expr: {
          kind: "binop",
          op: "implies",
          left: {
            kind: "binop",
            op: "==",
            left: { kind: "var", name: "amount" },
            right: { kind: "num", value: "0" },
          },
          right: {
            kind: "binop",
            op: "==",
            left: { kind: "var", name: "result" },
            right: { kind: "num", value: "0" },
          },
        },
      },
    ];
    expect(
      collectStyleWarnings(program).filter((w) => w.function === "usdToEur"),
    ).toHaveLength(0);
  });

  test("a definitional pin nested under implies is still flagged", () => {
    const program = structuredClone(base);
    const usdToEur = program.functions[1];
    if (!usdToEur) throw new Error("fixture drift");
    usdToEur.ensures = [
      {
        axiomId: "AX2",
        expr: {
          kind: "binop",
          op: "implies",
          left: {
            kind: "binop",
            op: ">",
            left: { kind: "var", name: "amount" },
            right: { kind: "num", value: "0" },
          },
          right: {
            kind: "binop",
            op: "==",
            left: { kind: "var", name: "result" },
            right: {
              kind: "binop",
              op: "*",
              left: { kind: "var", name: "amount" },
              right: { kind: "num", value: "0.91" },
            },
          },
        },
      },
    ];
    const warnings = collectStyleWarnings(program).filter(
      (w) => w.function === "usdToEur",
    );
    expect(warnings).toHaveLength(1);
  });
});

describe("style warnings in verify outcomes", () => {
  test("advisory only: a PROVEN outcome carries the warnings without failing", async () => {
    const outcome = await verifySpecAndProgram(currencySpec, base);
    expect(outcome.status).toBe("PROVEN");
    if (outcome.status !== "PROVEN") return;
    expect(outcome.styleWarnings.map((w) => w.axiomId).sort()).toEqual([
      "AX2",
      "AX2a",
    ]);
  }, 60_000);
});
