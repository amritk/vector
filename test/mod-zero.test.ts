import { describe, expect, test } from "bun:test";
import hkdfContract from "../contracts/rfc5869-hkdf-sha256.json";
import type { Expr, PropertyClause, RfcContract } from "../src/rfc/contract.ts";
import { emitNishTest } from "../src/rfc/emit-nish.ts";
import { runGates } from "../src/rfc/gates.ts";
import { parseTestOutput, runNishTest } from "../src/rfc/run.ts";
import { evalPure, sampleContract } from "../src/rfc/sample.ts";

// `a % 0` is 0 in the contract language, and a computed zero divisor
// (`x % (y - y)`) is not refused, so the sampler's `where` and
// the emitted test's assertion must both give 0 for it, or a sample `where`
// accepts could trap or fail in Nish.

const hkdf = hkdfContract as unknown as RfcContract;
const v = (name: string): Expr => ({ var: name });
const op = (o: string, ...args: Expr[]) => ({ op: o, args }) as Expr;
const int = (n: number): Expr => ({ int: n });

/** HKDF with its clauses replaced by one property over i32s `x` and `y`. */
function modContract(assert: Expr, where?: Expr): RfcContract {
  const c = structuredClone(hkdf);
  const p: PropertyClause = {
    kind: "property",
    id: "P-MOD",
    title: "a computed zero divisor gives 0",
    covers: ["R-EXTRACT"],
    forall: [
      { name: "x", type: "i32", min: -50, max: 50 },
      { name: "y", type: "i32", min: -5, max: 5 },
    ],
    assert,
    samples: 16,
  };
  if (where) p.where = where;
  c.clauses = [p];
  return c;
}

const zero = op("-", v("y"), v("y"));
const modZero = op("==", op("%", v("x"), zero), int(0));
/** `x % 0` in where, and in assert next to a nonzero computed divisor. */
const assert = op(
  "and",
  modZero,
  op(
    "implies",
    op("!=", v("y"), int(0)),
    op("<", op("%", v("x"), op("*", v("y"), v("y"))), op("*", v("y"), v("y"))),
  ),
);

describe("a computed % 0", () => {
  test("the evaluator gives 0 for a zero divisor and truncates otherwise", () => {
    const rem = (a: number, b: number) =>
      evalPure(op("%", int(a), op("-", int(b), int(0))), {});
    expect(rem(7, 0)).toBe(0);
    expect(rem(-7, 0)).toBe(0);
    expect(rem(7, 2)).toBe(1);
    expect(rem(-7, 2)).toBe(-1);
    expect(rem(7, -2)).toBe(1);
    expect(rem(-2147483648, -1)).toBe(0);
    expect(rem(-7, -1)).toBe(0);
  });

  test("where keeps every sample, and the assert holds on each", async () => {
    const c = modContract(assert, modZero);
    expect(runGates(c).issues.filter((i) => i.gate === "typing")).toEqual([]);
    const s = await sampleContract(c);
    expect(s.ok).toBe(true);
    const rows = s.properties.get("P-MOD")?.samples ?? [];
    expect(rows.some((r) => r.y === 0)).toBe(true);
    for (const r of rows) {
      expect(evalPure(modZero, r)).toBe(true);
      expect(evalPure(assert, r)).toBe(true);
    }
  });

  test("the emitted test computes % through remI32, defined once", async () => {
    const c = modContract(assert, modZero);
    const src = emitNishTest(c, (await sampleContract(c)).properties);
    expect(src).toContain("const remI32 = (a: i32, b: i32): i32 => {");
    expect(src).toContain("if (b === 0 || b === -1) {");
    expect(src).toContain("(remI32(v_x, (v_y - v_y)) === 0)");
    expect(src).toContain("remI32(v_x, (v_y * v_y))");
    expect(src).not.toMatch(/v_x %/);
    expect(src.match(/const remI32/g)?.length).toBe(1);
  });

  test("a test without % defines no remI32", async () => {
    const c = modContract(op("==", op("-", v("x"), v("x")), int(0)));
    const src = emitNishTest(c, (await sampleContract(c)).properties);
    expect(src).not.toContain("remI32");
  });
});

// Against a real nish (VECTOR_NISH=<path to a nish binary>): the emitted
// assertion passes on every sample where kept.
const nish = process.env.VECTOR_NISH;
describe.skipIf(!nish)("a computed % 0 against nish", () => {
  test("the emitted test passes", async () => {
    const c = modContract(assert, modZero);
    const s = await sampleContract(c);
    expect(s.ok).toBe(true);
    const run = await runNishTest(
      c,
      emitNishTest(c, s.properties),
      nish as string,
    );
    expect(run.stderr).toBe("");
    expect(parseTestOutput(c, run.stdout).get("P-MOD")?.outcome).toBe("pass");
  }, 600_000);
});
