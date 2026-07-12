import type { Program } from "../lang/ast.ts";
import { prettyExpr } from "../report/pretty.ts";
import { type QueryAnswer, type SmtQuery, signatureOf } from "./smt.ts";
import type {
  ClauseVerdict,
  Counterexample,
  DivHazard,
  FunctionReport,
  PreHazard,
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
  let preHazardCount = 0;
  let trivialCount = 0;
  let vacuousCount = 0;
  let totalVcs = 0;

  const byFn = new Map<
    string,
    {
      ensures: ClauseVerdict[];
      divHazards: DivHazard[];
      preHazards: PreHazard[];
      vacuous: boolean;
      // trivial verdicts arrive in a separate query; matched to ensures by index.
      trivialByPretty: Map<string, boolean>;
    }
  >();
  for (const fn of program.functions) {
    byFn.set(fn.name, {
      ensures: [],
      divHazards: [],
      preHazards: [],
      vacuous: false,
      trivialByPretty: new Map(),
    });
  }

  // First pass: record triviality and reachability so the ensures pass can read
  // them. (Queries are emitted reachable → [ensures, trivial]* → div → pre.)
  queries.forEach((q, i) => {
    const bucket = byFn.get(q.fn);
    if (!bucket) return;
    const answer = answers[i];
    if (q.kind === "reachable") {
      // unsat ⇒ no input satisfies the preconditions ⇒ vacuous proofs.
      if (answer.result === "unsat") bucket.vacuous = true;
    } else if (q.kind === "trivial") {
      // unsat ⇒ the clause holds regardless of the body ⇒ it proves nothing.
      if (answer.result === "unsat") bucket.trivialByPretty.set(q.pretty, true);
    }
  });

  // Second pass: the substantive verdicts.
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
        millis: 0,
      };
      if (status === "proven") {
        unsatCount += 1;
        if (bucket.trivialByPretty.get(q.pretty)) {
          verdict.trivial = true;
          trivialCount += 1;
        }
      } else if (status === "counterexample") {
        satCount += 1;
        verdict.counterexample = readCounterexample(q, answer);
      } else unknownCount += 1;
      bucket.ensures.push(verdict);
    } else if (q.kind === "div") {
      // Division hazard: anything but a proven-nonzero denominator is unsafe.
      if (answer.result === "unsat") return;
      divHazardCount += 1;
      bucket.divHazards.push({
        pretty: q.pretty,
        counterexample:
          answer.result === "sat" ? readCounterexample(q, answer) : undefined,
      });
    } else if (q.kind === "precondition") {
      // Safe iff the callee's requires can NOT be violated on this path (unsat).
      if (answer.result === "unsat") return;
      preHazardCount += 1;
      bucket.preHazards.push({
        callee: q.axiomId.replace(/^\(calls /, "").replace(/\)$/, ""),
        pretty: q.pretty,
        counterexample:
          answer.result === "sat" ? readCounterexample(q, answer) : undefined,
      });
    }
  });

  for (const bucket of byFn.values()) {
    if (bucket.vacuous) vacuousCount += 1;
  }

  const functions: FunctionReport[] = program.functions.map((fn) => {
    const bucket = byFn.get(fn.name);
    return {
      name: fn.name,
      layer: fn.layer,
      purpose: fn.purpose,
      signature: signatureOf(fn),
      requiresPretty: fn.requires.map((c) => prettyExpr(c.expr, "math")),
      bodyPretty: prettyExpr(fn.body, "math"),
      ensures: bucket?.ensures ?? [],
      divHazards: bucket?.divHazards ?? [],
      preHazards: bucket?.preHazards ?? [],
      vacuous: bucket?.vacuous ?? false,
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
    preHazardCount,
    trivialCount,
    vacuousCount,
    conformanceIssues: [],
    millis: totalMillis,
    ok:
      satCount === 0 &&
      unknownCount === 0 &&
      divHazardCount === 0 &&
      preHazardCount === 0 &&
      trivialCount === 0 &&
      vacuousCount === 0,
  };
}

function readCounterexample(q: SmtQuery, answer: QueryAnswer): Counterexample {
  const inputs: Record<string, string> = {};
  for (const p of q.params) {
    if (answer.model[p.smt] !== undefined) inputs[p.orig] = answer.model[p.smt];
  }
  return { inputs, result: answer.model[q.resultSmt] ?? "?" };
}
