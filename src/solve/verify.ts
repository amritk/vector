import type { Context, Model } from "z3-solver";
import type { Expr, FunctionUnit, NumericTy, Program } from "../lang/ast.ts";
import { prettyExpr } from "../report/pretty.ts";
import { type CompiledFunction, compileFunction } from "./compile.ts";
import type {
  ClauseVerdict,
  Counterexample,
  DivHazard,
  FunctionReport,
  VerificationReport,
} from "./types.ts";

// The mathematical gatekeeper. For each function we assume its preconditions
// and `result == body`, then try to REFUTE each postcondition by asserting its
// negation: unsat means the clause holds for ALL inputs satisfying the
// preconditions; sat yields a concrete counterexample; unknown is reported
// honestly. Zero LLM involvement by construction.

type Ctx = Context<"main">;

export async function verifyProgram(
  ctx: Ctx,
  program: Program,
  numTypes: WeakMap<Expr, NumericTy>,
  solverLabel: string,
): Promise<VerificationReport> {
  const byName = new Map(program.functions.map((f) => [f.name, f]));
  const started = Date.now();
  const functions: FunctionReport[] = [];
  let unsatCount = 0;
  let satCount = 0;
  let unknownCount = 0;
  let divHazardCount = 0;
  let totalVcs = 0;

  for (const fn of program.functions) {
    const compiled = compileFunction(ctx, fn, byName, numTypes);
    const solver = new ctx.Solver();
    solver.add(...compiled.requires);
    solver.add(compiled.bodyDef);

    const ensures: ClauseVerdict[] = [];
    for (const { clause, term } of compiled.ensures) {
      totalVcs += 1;
      const clauseStarted = Date.now();
      solver.push();
      solver.add(ctx.Not(term));
      const checked = await solver.check();
      const verdict: ClauseVerdict = {
        axiomId: clause.axiomId,
        pretty: prettyExpr(clause.expr, "math"),
        status:
          checked === "unsat"
            ? "proven"
            : checked === "sat"
              ? "counterexample"
              : "unknown",
        millis: Date.now() - clauseStarted,
      };
      if (checked === "unsat") unsatCount += 1;
      else if (checked === "sat") {
        satCount += 1;
        verdict.counterexample = extractCounterexample(
          solver.model(),
          compiled,
        );
      } else unknownCount += 1;
      ensures.push(verdict);
      solver.pop();
    }

    const divHazards: DivHazard[] = [];
    for (const cond of compiled.divConds) {
      solver.push();
      solver.add(cond.path);
      solver.add(cond.denom.eq(0));
      const checked = await solver.check();
      if (checked !== "unsat") {
        divHazardCount += 1;
        divHazards.push({
          pretty: cond.pretty,
          counterexample:
            checked === "sat"
              ? extractCounterexample(solver.model(), compiled)
              : undefined,
        });
      }
      solver.pop();
    }

    functions.push({
      name: fn.name,
      layer: fn.layer,
      purpose: fn.purpose,
      signature: signatureOf(fn),
      requiresPretty: fn.requires.map((c) => prettyExpr(c.expr, "math")),
      bodyPretty: prettyExpr(fn.body, "math"),
      ensures,
      divHazards,
    });
  }

  return {
    solver: solverLabel,
    functions,
    totalVcs,
    unsatCount,
    satCount,
    unknownCount,
    divHazardCount,
    millis: Date.now() - started,
    ok: satCount === 0 && unknownCount === 0 && divHazardCount === 0,
  };
}

function signatureOf(fn: FunctionUnit): string {
  const params = fn.params.map((p) => `${p.name}: ${p.type}`).join(", ");
  return `${fn.name}(${params}): ${fn.returnType}`;
}

function extractCounterexample(
  model: Model<"main">,
  compiled: CompiledFunction,
): Counterexample {
  const inputs: Record<string, string> = {};
  for (const [name, term] of compiled.paramConsts) {
    inputs[name] = normalizeModelValue(model.eval(term, true).toString());
  }
  return {
    inputs,
    result: normalizeModelValue(
      model.eval(compiled.resultConst, true).toString(),
    ),
  };
}

// Z3 prints negatives as s-expressions, e.g. "(- 1)" or "(- 1/2)".
function normalizeModelValue(value: string): string {
  const match = value.match(/^\(- (.+)\)$/);
  return match?.[1] !== undefined ? `-${match[1]}` : value;
}
