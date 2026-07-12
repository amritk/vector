import type { Expr, FunctionUnit, Program } from "../lang/ast.ts";
import { prettyExpr } from "../report/pretty.ts";
import type { ConformanceIssue, VerificationReport } from "./types.ts";

// The proof is over exact rationals; the emitted code runs float64. That gap is
// real — `(x + 0.1) + 0.2 == x + 0.3` is a theorem over the reals and false in
// float64 at x = 0. Z3 cannot see it, so we test it empirically: interpret the
// program exactly as the emitted TypeScript would evaluate it (float64, JS
// operators) over many boundary + random inputs that satisfy the preconditions,
// and flag any clause the solver marked *proven* that nonetheless comes out
// false. This is the one deliberately non-Z3 gate — it validates the
// proof→runtime bridge, not the proof.

type Value = number | boolean;

class DomainError extends Error {}

/** Evaluate a vector-lang expression the way the emitted JS would. */
function evalExpr(
  expr: Expr,
  env: Map<string, Value>,
  byName: Map<string, FunctionUnit>,
): Value {
  switch (expr.kind) {
    case "num":
      return Number(expr.value);
    case "bool":
      return expr.value;
    case "var": {
      const v = env.get(expr.name);
      if (v === undefined) throw new DomainError(`unbound ${expr.name}`);
      return v;
    }
    case "unop": {
      const a = evalExpr(expr.arg, env, byName);
      switch (expr.op) {
        case "not":
          return !(a as boolean);
        case "neg":
          return -(a as number);
        case "abs":
          return Math.abs(a as number);
        case "floor":
          return Math.floor(a as number);
        default:
          return Math.ceil(a as number);
      }
    }
    case "binop": {
      const l = evalExpr(expr.left, env, byName);
      const r = evalExpr(expr.right, env, byName);
      switch (expr.op) {
        case "+":
          return (l as number) + (r as number);
        case "-":
          return (l as number) - (r as number);
        case "*":
          return (l as number) * (r as number);
        case "/":
          return (l as number) / (r as number);
        case "min":
          return Math.min(l as number, r as number);
        case "max":
          return Math.max(l as number, r as number);
        case "<":
          return (l as number) < (r as number);
        case "<=":
          return (l as number) <= (r as number);
        case ">":
          return (l as number) > (r as number);
        case ">=":
          return (l as number) >= (r as number);
        case "==":
          return l === r;
        case "!=":
          return l !== r;
        case "and":
          return (l as boolean) && (r as boolean);
        case "or":
          return (l as boolean) || (r as boolean);
        default: // implies
          return !(l as boolean) || (r as boolean);
      }
    }
    case "ite":
      return evalExpr(expr.cond, env, byName)
        ? evalExpr(expr.then, env, byName)
        : evalExpr(expr.else, env, byName);
    case "call": {
      const callee = byName.get(expr.fn);
      if (!callee) throw new DomainError(`unknown fn ${expr.fn}`);
      const inner = new Map<string, Value>();
      callee.params.forEach((p, i) => {
        const arg = expr.args[i];
        if (arg) inner.set(p.name, evalExpr(arg, env, byName));
      });
      return evalExpr(callee.body, inner, byName);
    }
  }
}

// A tiny deterministic PRNG (mulberry32) so the fuzz set is reproducible across
// runs — the environment/CI must not see flaky conformance results.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const REAL_POOL = [
  0, 1, -1, 2, -2, 0.5, -0.5, 0.1, 0.2, 0.3, 0.7, 3, -3, 10, -10, 100, -100,
  0.25, 1.5, 0.01,
];
const INT_POOL = [0, 1, -1, 2, -2, 3, -3, 5, -5, 7, 10, -10, 100, 42];
const MAX_SAMPLES = 2000;

function sampleValues(
  fn: FunctionUnit,
  rand: () => number,
): Map<string, Value>[] {
  const pools = fn.params.map((p) =>
    p.type === "Int" ? INT_POOL : p.type === "Bool" ? [true, false] : REAL_POOL,
  );
  const samples: Map<string, Value>[] = [];

  // Full cartesian product of the pools when small enough; otherwise random.
  const product = pools.reduce((n, pool) => n * pool.length, 1);
  if (product <= MAX_SAMPLES) {
    for (let i = 0; i < product; i++) {
      const env = new Map<string, Value>();
      let rem = i;
      fn.params.forEach((p, k) => {
        const pool = pools[k];
        env.set(p.name, pool[rem % pool.length] as Value);
        rem = Math.floor(rem / pool.length);
      });
      samples.push(env);
    }
  } else {
    for (let i = 0; i < MAX_SAMPLES; i++) {
      const env = new Map<string, Value>();
      fn.params.forEach((p, k) => {
        const pool = pools[k];
        env.set(p.name, pool[Math.floor(rand() * pool.length)] as Value);
      });
      samples.push(env);
    }
  }

  // A handful of purely random reals to escape the fixed pool.
  for (let i = 0; i < 200; i++) {
    const env = new Map<string, Value>();
    for (const p of fn.params) {
      if (p.type === "Bool") env.set(p.name, rand() < 0.5);
      else {
        const v = (rand() - 0.5) * 2000;
        env.set(p.name, p.type === "Int" ? Math.round(v) : v);
      }
    }
    samples.push(env);
  }
  return samples;
}

/**
 * Fuzz every *proven* clause of every function against float64 execution.
 * Returns the clauses that fail to conform. Only meaningful to call on a report
 * that already proved clean over the reals.
 */
export function checkConformance(
  program: Program,
  report: VerificationReport,
): ConformanceIssue[] {
  const byName = new Map(program.functions.map((f) => [f.name, f]));
  const issues: ConformanceIssue[] = [];
  const rand = rng(0x9e3779b9);

  for (const fn of program.functions) {
    const fnReport = report.functions.find((f) => f.name === fn.name);
    if (!fnReport) continue;
    // Only clauses the solver proved (and that aren't already flagged trivial).
    const provenAxioms = new Set(
      fnReport.ensures
        .filter((e) => e.status === "proven" && !e.trivial)
        .map((e) => e.axiomId),
    );
    const clauses = fn.ensures.filter((c) => provenAxioms.has(c.axiomId));
    if (clauses.length === 0) continue;

    for (const env of sampleValues(fn, rand)) {
      let requiresHold: boolean;
      let result: Value;
      try {
        requiresHold = fn.requires.every(
          (c) => evalExpr(c.expr, env, byName) === true,
        );
        if (!requiresHold) continue;
        result = evalExpr(fn.body, env, byName);
      } catch {
        continue; // domain/eval error on this sample — skip it
      }
      const ensuresEnv = new Map(env);
      ensuresEnv.set("result", result);

      for (const clause of clauses) {
        if (!provenAxioms.has(clause.axiomId)) continue; // already flagged
        let holds: boolean;
        try {
          holds = evalExpr(clause.expr, ensuresEnv, byName) === true;
        } catch {
          holds = false;
        }
        if (!holds) {
          const inputs: Record<string, string> = {};
          for (const p of fn.params) inputs[p.name] = String(env.get(p.name));
          issues.push({
            function: fn.name,
            axiomId: clause.axiomId,
            pretty: prettyExpr(clause.expr, "math"),
            inputs,
            result: String(result),
            note: "proven over exact reals but false in float64 execution — the postcondition uses exact arithmetic the emitted code cannot honor (rounding, non-finite, or exact equality).",
          });
          // One witness per clause is enough to fail the gate.
          provenAxioms.delete(clause.axiomId);
          break;
        }
      }
      if (provenAxioms.size === 0) break;
    }
  }
  return issues;
}
