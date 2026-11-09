import { describe, expect, test } from "bun:test";
import type { Expr, FunctionUnit, Program } from "../src/lang/ast.ts";
import { roundTrips, validateProgramShape } from "../src/lang/shape.ts";
import { verifyProgramViaSolver } from "../src/solve/runner.ts";

// Regression tests for the float64 gap (#15, #16, #17): programs that are
// true over exact rationals but whose emitted float64 code breaks the
// contract on ordinary inputs. Each one used to come back PROVEN.

const SOLVER_TIMEOUT = 60_000;

const num = (value: string): Expr => ({ kind: "num", value });
const v = (name: string): Expr => ({ kind: "var", name });
const bin = (op: string, left: Expr, right: Expr): Expr =>
  ({ kind: "binop", op, left, right }) as Expr;
const call = (fn: string, args: Expr[]): Expr => ({ kind: "call", fn, args });

function fn(
  name: string,
  layer: number,
  params: string[],
  requires: Expr[],
  ensures: Expr[],
  body: Expr,
): FunctionUnit {
  return {
    name,
    layer,
    purpose: name,
    params: params.map((p) => ({ name: p, type: "Real" as const })),
    returnType: "Real",
    requires: requires.map((expr, i) => ({ axiomId: `R${i}`, expr })),
    ensures: ensures.map((expr, i) => ({ axiomId: `E${i}`, expr })),
    body,
  };
}

async function verify(...functions: FunctionUnit[]) {
  const program: Program = { programName: "p", functions };
  const result = await verifyProgramViaSolver(program);
  if (result.kind !== "report") throw new Error(JSON.stringify(result));
  return result.report;
}

describe("float64 conformance — samples reach the inputs that break", () => {
  test(
    "floor-to-cents is refuted at a two-decimal input (0.58 → 0.57)",
    async () => {
      const report = await verify(
        fn(
          "toCents",
          1,
          ["amount"],
          [
            bin(">=", v("amount"), num("0")),
            bin("<=", v("amount"), num("1000000")),
          ],
          [
            bin("<=", v("result"), v("amount")),
            bin(">", v("result"), bin("-", v("amount"), num("0.01"))),
          ],
          bin(
            "/",
            {
              kind: "unop",
              op: "floor",
              arg: bin("*", v("amount"), num("100")),
            },
            num("100"),
          ),
        ),
      );
      expect(report.ok).toBe(false);
      const issue = report.conformanceIssues.find((i) => i.axiomId === "E1");
      expect(issue?.kind).toBe("postcondition");
    },
    SOLVER_TIMEOUT,
  );

  test(
    "a narrow requires window is actually sampled (3.1 < x < 3.2)",
    async () => {
      const report = await verify(
        fn(
          "shift",
          1,
          ["x"],
          [
            bin(
              "and",
              bin(">", v("x"), num("3.1")),
              bin("<", v("x"), num("3.2")),
            ),
          ],
          [bin("<", v("result"), num("3.2"))],
          bin(
            "-",
            bin("+", v("x"), num("10000000000000000")),
            num("10000000000000000"),
          ),
        ),
      );
      expect(report.ok).toBe(false);
      expect(report.conformanceIssues.some((i) => i.axiomId === "E0")).toBe(
        true,
      );
    },
    SOLVER_TIMEOUT,
  );

  test(
    "a callee's finite-number domain guard is simulated (overflow → throw)",
    async () => {
      const report = await verify(
        fn(
          "g",
          1,
          ["y"],
          [bin(">=", v("y"), num("0"))],
          [bin(">=", v("result"), num("0"))],
          v("y"),
        ),
        fn(
          "f",
          2,
          ["x"],
          [bin(">=", v("x"), num("0"))],
          [bin(">=", v("result"), num("0"))],
          call("g", [bin("*", v("x"), num(`1${"0".repeat(300)}`))]),
        ),
      );
      expect(report.ok).toBe(false);
      const issue = report.conformanceIssues.find((i) => i.function === "f");
      expect(issue?.kind).toBe("callee-guard");
      expect(issue?.pretty).toContain("finite");
    },
    SOLVER_TIMEOUT,
  );

  test(
    "fails closed when no float64 input satisfies the requires",
    async () => {
      // The region (1, 1 + 2e-16) is inhabited over the reals, so the vacuity
      // check passes — but no double lies strictly inside it.
      const report = await verify(
        fn(
          "tiny",
          1,
          ["x"],
          [
            bin(">", v("x"), num("1")),
            bin(
              "<",
              bin("*", v("x"), num("10000000000000000")),
              num("10000000000000002"),
            ),
          ],
          [bin(">", v("result"), num("0"))],
          v("x"),
        ),
      );
      expect(report.ok).toBe(false);
      expect(report.conformanceIssues[0]?.kind).toBe("unsampled");
    },
    SOLVER_TIMEOUT,
  );

  test(
    "a correct program still proves clean",
    async () => {
      const report = await verify(
        fn(
          "clamp01",
          1,
          ["x"],
          [],
          [bin(">=", v("result"), num("0")), bin("<=", v("result"), num("1"))],
          bin("max", num("0"), bin("min", num("1"), v("x"))),
        ),
      );
      expect(report.ok).toBe(true);
    },
    SOLVER_TIMEOUT,
  );
});

describe("numeric literals must survive the trip to float64 (#16)", () => {
  test("roundTrips accepts ordinary decimals, rejects lossy ones", () => {
    for (const ok of ["0", "0.1", "0.50", "-3.25", "100", "9007199254740992"]) {
      expect(roundTrips(ok)).toBe(true);
    }
    for (const bad of [
      "1.10000000000000001",
      "9007199254740993",
      "123456789012345678901234",
    ]) {
      expect(roundTrips(bad)).toBe(false);
    }
  });

  test("the shape gate rejects a literal that would be emitted rounded", () => {
    const errors = validateProgramShape({
      programName: "p",
      functions: [
        fn(
          "margin",
          1,
          ["x"],
          [bin(">=", v("x"), num("1.10000000000000001"))],
          [bin(">", v("result"), num("0"))],
          bin("-", v("x"), num("1.1")),
        ),
      ],
    });
    expect(
      errors.some((e) => e.includes("more precision than a float64")),
    ).toBe(true);
  });
});
