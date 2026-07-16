import { describe, expect, test } from "bun:test";
import { emitTypeScript } from "../src/emit/typescript.ts";
import { parseProgram } from "../src/generated/program/index.ts";
import currencyFixture from "./fixtures/currency.json";

describe("emitTypeScript", () => {
  const program = parseProgram(currencyFixture);
  const source = emitTypeScript(program);

  test("emits both layers with guards and Hoare-triple docs", () => {
    expect(source).toContain(
      "export function applyRate(amount: number, rate: number): number",
    );
    expect(source).toContain(
      "export function usdToEur(amount: number): number",
    );
    expect(source).toContain("requires AX1: amount >= 0");
    expect(source).toContain("ensures  AX2: result == amount * 0.91");
    expect(source).toContain(
      'throw new RangeError("requires violated [AX1]: amount >= 0")',
    );
    expect(source).toContain("return applyRate(amount, 0.91);");
  });

  test("emitted code executes: guard throws, math is right", () => {
    // Strip module/doc syntax so the source runs under new Function().
    const runnable = source
      .replace(/\/\*\*[\s\S]*?\*\//g, "")
      .replace(/^\/\/.*$/gm, "")
      .replace(/export function/g, "function")
      .replace(/: number/g, "")
      .replace(/: boolean/g, "");
    const factory = new Function(
      `${runnable}; return { applyRate, usdToEur };`,
    );
    const { usdToEur } = factory() as { usdToEur: (amount: number) => number };

    expect(usdToEur(100)).toBeCloseTo(91, 10);
    expect(usdToEur(0)).toBe(0);
    expect(() => usdToEur(-1)).toThrow(RangeError);
  });

  test("renders ite as a ternary and implies as !a || b in TS style", () => {
    const withIte = parseProgram({
      programName: "clamp_low",
      functions: [
        {
          name: "clampLow",
          layer: 1,
          purpose: "Clamp negatives to zero.",
          params: [{ name: "x", type: "Real" }],
          returnType: "Real",
          requires: [],
          ensures: [
            {
              axiomId: "AX1",
              expr: {
                kind: "binop",
                op: "implies",
                left: {
                  kind: "binop",
                  op: "<",
                  left: { kind: "var", name: "x" },
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
          ],
          body: {
            kind: "ite",
            cond: {
              kind: "binop",
              op: "<",
              left: { kind: "var", name: "x" },
              right: { kind: "num", value: "0" },
            },
            then: { kind: "num", value: "0" },
            else: { kind: "var", name: "x" },
          },
        },
      ],
    });
    const emitted = emitTypeScript(withIte);
    expect(emitted).toContain("return (x < 0 ? 0 : x);");
    expect(emitted).toContain("ensures  AX1: x < 0 ⇒ result == 0");
  });

  test("negation of a negative literal renders as `- -3`, never `--3`", () => {
    const negProg = parseProgram({
      programName: "neg_lit",
      functions: [
        {
          name: "negLit",
          layer: 1,
          purpose: "Return three via double negation.",
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
                right: { kind: "num", value: "3" },
              },
            },
          ],
          body: { kind: "unop", op: "neg", arg: { kind: "num", value: "-3" } },
        },
      ],
    });
    const emitted = emitTypeScript(negProg);
    expect(emitted).toContain("return - -3;");
    expect(emitted).not.toContain("--3");
    // And it actually runs to the proven value.
    const runnable = emitted
      .replace(/\/\*\*[\s\S]*?\*\//g, "")
      .replace(/^\/\/.*$/gm, "")
      .replace(/export function/g, "function")
      .replace(/: number/g, "");
    const negLit = new Function(`${runnable}; return negLit;`)() as (
      x: number,
    ) => number;
    expect(negLit(0)).toBe(3);
  });

  test("emits domain guards for finite/integer parameters", () => {
    expect(source).toContain("Number.isFinite(amount)");
    expect(source).toContain("domain violated");
  });

  test("a purpose containing */ cannot terminate the doc comment", () => {
    const evil = parseProgram({
      programName: "inj",
      functions: [
        {
          name: "f",
          layer: 1,
          purpose: "ends the comment */ const pwned = 1; /*",
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
    });
    const emitted = emitTypeScript(evil);
    // The raw terminator must not survive inside the JSDoc body.
    expect(emitted).toContain("*\\/");
    // The whole emitted module still parses as TypeScript, and the payload
    // stays inside the comment — nothing of it reaches the compiled output.
    const transpiler = new Bun.Transpiler({ loader: "ts" });
    expect(() => transpiler.transformSync(emitted)).not.toThrow();
    expect(transpiler.transformSync(emitted)).not.toContain("pwned");
  });
});
