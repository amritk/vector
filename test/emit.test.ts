import { describe, expect, test } from "bun:test";
import { emitTypeScript } from "../src/emit/typescript.ts";
import { validateExprShape } from "../src/generated/program/expr.ts";
import { parseProgram } from "../src/generated/program/index.ts";
import { type Expr, NUM_LITERAL_RE, type Program } from "../src/lang/ast.ts";
import { prettyExpr } from "../src/report/pretty.ts";
import { checkConformance } from "../src/solve/conformance.ts";
import { verifyProgramViaSolver } from "../src/solve/runner.ts";
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

  test("negation of an infix expression keeps its parentheses", () => {
    const x: Expr = { kind: "var", name: "x" };
    const zero: Expr = { kind: "num", value: "0" };
    const lt: Expr = { kind: "binop", op: "<", left: x, right: zero };
    const not: Expr = { kind: "unop", op: "not", arg: lt };
    // `!x < 0` parses as `(!x) < 0` in JS — a different predicate.
    expect(prettyExpr(not, "ts")).toBe("!(x < 0)");
    expect(prettyExpr(not, "math")).toBe("¬(x < 0)");
    const implies: Expr = { kind: "binop", op: "implies", left: lt, right: lt };
    expect(prettyExpr(implies, "ts")).toBe("!(x < 0) || x < 0");
    const abs: Expr = {
      kind: "ite",
      cond: { kind: "unop", op: "not", arg: { ...lt, op: ">=" } },
      then: { kind: "unop", op: "neg", arg: x },
      else: x,
    };
    const f = new Function("x", `return ${prettyExpr(abs, "ts")};`);
    expect(f(5)).toBe(5);
    expect(f(-5)).toBe(5);
  });

  const absProgram: Program = {
    programName: "p",
    functions: [
      {
        name: "pick",
        layer: 1,
        purpose: "pick",
        params: [
          { name: "n", type: "Int" },
          { name: "flag", type: "Bool" },
        ],
        returnType: "Int",
        requires: [],
        ensures: [
          {
            axiomId: "E0",
            expr: {
              kind: "binop",
              op: ">=",
              left: { kind: "var", name: "result" },
              right: { kind: "num", value: "0" },
            },
          },
        ],
        body: {
          kind: "ite",
          cond: { kind: "var", name: "flag" },
          then: { kind: "unop", op: "abs", arg: { kind: "var", name: "n" } },
          else: { kind: "num", value: "0" },
        },
      },
    ],
  };

  test("Int args must be safe integers and Bool args booleans", () => {
    const js = new Bun.Transpiler({ loader: "ts" })
      .transformSync(emitTypeScript(absProgram))
      .replace(/^export function /gm, "function ");
    const pick = new Function(`${js}\nreturn pick;`)() as (
      n: unknown,
      flag: unknown,
    ) => number;
    expect(pick(-3, true)).toBe(3);
    expect(pick(Number.MAX_SAFE_INTEGER, true)).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => pick(2 ** 53, true)).toThrow("n must be a safe integer");
    expect(() => pick(1.5, true)).toThrow("n must be a safe integer");
    expect(() => pick(1, 0)).toThrow("flag must be a boolean");
    expect(() => pick(1, "false")).toThrow("flag must be a boolean");
  });

  test("the conformance gate runs the emitted source, not just the AST", async () => {
    const solved = await verifyProgramViaSolver(absProgram);
    if (solved.kind !== "report") throw new Error(JSON.stringify(solved));
    expect(solved.report.ok).toBe(true);
    const run = (emit: (p: Program) => string) =>
      checkConformance(absProgram, solved.report, new Map(), emit);
    expect(run(emitTypeScript)).toEqual([]);

    // An emitter that prints the wrong body: the proof and the AST
    // interpreter are untouched, only the text handed to the user is wrong.
    const wrongBody = run((p) => emitTypeScript(p).replace("Math.abs(n)", "n"));
    expect(wrongBody.map((i) => i.kind)).toEqual(["emitted-code"]);
    expect(wrongBody[0]?.result).toContain("the proven program returns");

    // An emitter that drops a guard accepts what the program rejects.
    const noGuard = run((p) =>
      emitTypeScript(p).replace("!Number.isSafeInteger(n)", "false"),
    );
    expect(noGuard.map((i) => i.kind)).toEqual(["emitted-code"]);
    expect(noGuard[0]?.result).toContain("the proven program throws");

    // Guards that let through what only an ill-typed caller would send.
    const guardFaults: [string, string][] = [
      ['typeof flag !== "boolean"', "false"],
      ["!Number.isSafeInteger(n)", "!Number.isInteger(n)"],
      ["!Number.isSafeInteger(n)", 'typeof n !== "number"'],
    ];
    for (const [from, to] of guardFaults) {
      const source = emitTypeScript(absProgram);
      expect(source).toContain(from);
      const weak = run(() => source.replace(from, to));
      expect(weak.map((i) => i.kind)).toEqual(["emitted-code"]);
      expect(weak[0]?.result).toContain("the proven program throws");
    }

    // Source that does not compile was never checked: fail closed.
    const broken = run(() => "export function pick(n: number {");
    expect(broken.map((i) => i.kind)).toEqual(["emitted-code"]);
    expect(broken[0]?.result).toContain("does not compile");
  }, 60_000);
});

describe("numeric literals", () => {
  test("a leading zero is refused: Z3 reads decimal, JavaScript reads octal", () => {
    for (const ok of ["0", "-0", "10", "0.50", "-3.25", "100"]) {
      expect(NUM_LITERAL_RE.test(ok)).toBe(true);
    }
    for (const bad of ["010", "-010", "08", "00", "00.5", "1.", ".5", "1e3"]) {
      expect(NUM_LITERAL_RE.test(bad)).toBe(false);
      expect(validateExprShape({ kind: "num", value: bad })).toBe(false);
    }
  });
});
