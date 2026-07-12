import type { Program } from "../lang/ast.ts";
import { prettyExpr } from "../report/pretty.ts";
import { type QueryAnswer, type SmtQuery, signatureOf } from "./smt.ts";
import type {
  ClauseVerdict,
  Counterexample,
  DivHazard,
  FunctionReport,
  VerificationReport,
} from "./types.ts";

// Turns z3's per-query answers into a VerificationReport — the shape every
// consumer above the solver already speaks. For each postcondition, unsat means
// the clause holds for ALL inputs satisfying the preconditions; sat yields a
// concrete counterexample; unknown is reported honestly. A division query is a
// hazard unless its "denominator == 0 on this path" check came back unsat.
// Zero LLM involvement by construction.

export function assembleReport(
  program: Program,
  queries: SmtQuery[],
  answers: QueryAnswer[],
  solverLabel: string,
  totalMillis: number,
): VerificationReport {
  let unsatCount = 0;
  let satCount = 0;
  let unknownCount = 0;
  let divHazardCount = 0;
  let totalVcs = 0;

  // Per-clause timing isn't recoverable from a single batch invocation, so the
  // wall-clock total is attributed evenly; report.millis carries the real total.
  const checks = queries.length || 1;
  const perCheck = Math.round(totalMillis / checks);

  const byFn = new Map<
    string,
    { ensures: ClauseVerdict[]; divHazards: DivHazard[] }
  >();
  for (const fn of program.functions) {
    byFn.set(fn.name, { ensures: [], divHazards: [] });
  }

  queries.forEach((q, i) => {
    const answer = answers[i];
    const bucket = byFn.get(q.fn);
    if (!bucket) return;

    if (q.kind === "ensures") {
      totalVcs += 1;
      const status =
        answer.result === "unsat"
          ? "proven"
          : answer.result === "sat"
            ? "counterexample"
            : "unknown";
      const verdict: ClauseVerdict = {
        axiomId: q.axiomId,
        pretty: q.pretty,
        status,
        millis: perCheck,
      };
      if (status === "proven") unsatCount += 1;
      else if (status === "counterexample") {
        satCount += 1;
        verdict.counterexample = readCounterexample(q, answer);
      } else unknownCount += 1;
      bucket.ensures.push(verdict);
    } else {
      // Division hazard: anything but a proven-nonzero denominator is unsafe.
      if (answer.result === "unsat") return;
      divHazardCount += 1;
      bucket.divHazards.push({
        pretty: q.pretty,
        counterexample:
          answer.result === "sat" ? readCounterexample(q, answer) : undefined,
      });
    }
  });

  const functions: FunctionReport[] = program.functions.map((fn) => {
    const bucket = byFn.get(fn.name) ?? { ensures: [], divHazards: [] };
    return {
      name: fn.name,
      layer: fn.layer,
      purpose: fn.purpose,
      signature: signatureOf(fn),
      requiresPretty: fn.requires.map((c) => prettyExpr(c.expr, "math")),
      bodyPretty: prettyExpr(fn.body, "math"),
      ensures: bucket.ensures,
      divHazards: bucket.divHazards,
    };
  });

  return {
    solver: solverLabel,
    functions,
    totalVcs,
    unsatCount,
    satCount,
    unknownCount,
    divHazardCount,
    millis: totalMillis,
    ok: satCount === 0 && unknownCount === 0 && divHazardCount === 0,
  };
}

function readCounterexample(q: SmtQuery, answer: QueryAnswer): Counterexample {
  const inputs: Record<string, string> = {};
  for (const p of q.params) {
    if (answer.model[p.smt] !== undefined) inputs[p.orig] = answer.model[p.smt];
  }
  return { inputs, result: answer.model[q.resultSmt] ?? "?" };
}
