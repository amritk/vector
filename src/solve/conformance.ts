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

/**
 * A callee's runtime guard fired during float64 evaluation. The emitted code
 * evaluates every function's `requires` and throws on violation, so when
 * float64 rounding pushes a call-site argument outside the callee's (real-
 * proven) precondition, the emitted program throws — that is a conformance
 * failure of the caller, not a skippable evaluation error.
 */
class GuardViolation extends Error {
  constructor(
    readonly callee: string,
    readonly guardPretty: string,
  ) {
    super(`guard violated: ${callee} requires ${guardPretty}`);
  }
}

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
      // Boolean connectives are lazy, exactly like the emitted && / || / !a||b:
      // a callee guard (throw) in the right operand must not fire on paths the
      // emitted code short-circuits past.
      if (expr.op === "and") {
        return evalExpr(expr.left, env, byName) === true
          ? evalExpr(expr.right, env, byName)
          : false;
      }
      if (expr.op === "or") {
        return evalExpr(expr.left, env, byName) === true
          ? true
          : evalExpr(expr.right, env, byName);
      }
      if (expr.op === "implies") {
        return evalExpr(expr.left, env, byName) !== true
          ? true
          : evalExpr(expr.right, env, byName);
      }
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
        default: // !=
          return l !== r;
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
      // The emitted callee evaluates its own requires and throws — simulate
      // that, or a float64-triggered throw on a contract-valid caller input
      // would be invisible to this gate.
      for (const rc of callee.requires) {
        if (evalExpr(rc.expr, inner, byName) !== true) {
          throw new GuardViolation(callee.name, prettyExpr(rc.expr, "math"));
        }
      }
      return evalExpr(callee.body, inner, byName);
    }
  }
}

/** True when any expression in the list transitively contains a `call`. */
function containsCall(exprs: Expr[]): boolean {
  return exprs.some((expr) => {
    switch (expr.kind) {
      case "num":
      case "bool":
      case "var":
        return false;
      case "unop":
        return containsCall([expr.arg]);
      case "binop":
        return containsCall([expr.left, expr.right]);
      case "ite":
        return containsCall([expr.cond, expr.then, expr.else]);
      case "call":
        return true;
    }
  });
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

// Boundary values must span the whole float64 dynamic range, not just small
// magnitudes — a proof over the (unbounded) reals can be broken by float64
// OVERFLOW (x near 1e308 where x+x = Infinity) and by precision loss above
// 2^53, both of which live far outside a ±1000 window. The extremes here are
// chosen so that e.g. `x + x` overflows and `x + 1 == x` holds.
const REAL_POOL = [
  0, 1, -1, 2, -2, 0.5, -0.5, 0.1, 0.2, 0.3, 0.7, 3, -3, 10, -10, 100, -100,
  0.25, 1.5, 0.01, 1e6, -1e6, 1e15, 9007199254740992, -9007199254740992, 1e300,
  -1e300, 1e308, -1e308, 5e-324, 1e-300, 1.7976931348623157e308,
];
const INT_POOL = [
  0, 1, -1, 2, -2, 3, -3, 5, -5, 7, 10, -10, 100, 42, 9007199254740992,
  -9007199254740992, 1e15,
];
const MAX_SAMPLES = 2000;

// A magnitude spanning ~10^-320 … 10^308 with a random sign — draws the
// exponent uniformly so every order of magnitude (incl. the overflow edge) is
// reachable, unlike a linear draw that concentrates near zero.
function randomMagnitude(rand: () => number): number {
  const exp = Math.round((rand() * 2 - 1) * 320);
  const mantissa = 1 + rand() * 9;
  const sign = rand() < 0.5 ? -1 : 1;
  return sign * mantissa * 10 ** exp;
}

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

  // Random draws across the full float64 magnitude range to escape the pool.
  for (let i = 0; i < 400; i++) {
    const env = new Map<string, Value>();
    for (const p of fn.params) {
      if (p.type === "Bool") env.set(p.name, rand() < 0.5);
      else {
        const v = randomMagnitude(rand);
        env.set(p.name, p.type === "Int" ? Math.round(v) : v);
      }
    }
    samples.push(env);
  }
  return samples;
}

/**
 * Fuzz every *proven* guarantee of every function against float64 execution:
 * each proven ensures clause must still evaluate true, and the body must run
 * to completion — a callee guard tripped by float64 rounding is a throw the
 * proof said could not happen. Returns the violations found. Only meaningful
 * to call on a report that already proved clean over the reals.
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
    // A body with calls can still throw via a callee's guard even when there
    // is nothing left to check about the postconditions.
    const bodyHasCalls = containsCall([fn.body]);
    if (clauses.length === 0 && !bodyHasCalls) continue;
    // One witness per callee guard is enough.
    const seenGuards = new Set<string>();

    for (const env of sampleValues(fn, rand)) {
      const witnessInputs = (): Record<string, string> => {
        const inputs: Record<string, string> = {};
        for (const p of fn.params) inputs[p.name] = String(env.get(p.name));
        return inputs;
      };

      let requiresHold: boolean;
      try {
        requiresHold = fn.requires.every(
          (c) => evalExpr(c.expr, env, byName) === true,
        );
      } catch {
        // Guard/domain error while deciding validity: the emitted code rejects
        // this input either way, so it is outside the contract we must honor.
        continue;
      }
      if (!requiresHold) continue;

      // This input satisfies the preconditions — the proof promises the body
      // completes and every proven ensures holds. A callee guard firing here
      // is a spurious runtime throw the caller's contract does not allow.
      let result: Value;
      try {
        result = evalExpr(fn.body, env, byName);
      } catch (err) {
        if (err instanceof GuardViolation) {
          const key = `${err.callee}|${err.guardPretty}`;
          if (!seenGuards.has(key)) {
            seenGuards.add(key);
            issues.push({
              function: fn.name,
              kind: "callee-guard",
              axiomId: `(calls ${err.callee})`,
              pretty: err.guardPretty,
              inputs: witnessInputs(),
              result: `(throws — ${err.callee} requires ${err.guardPretty})`,
              note: "the call-site precondition was proven over exact reals, but float64 rounding of the computed argument violates the callee's guard, so the emitted code throws on an input this function's contract accepts.",
            });
          }
        }
        continue;
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
          issues.push({
            function: fn.name,
            kind: "postcondition",
            axiomId: clause.axiomId,
            pretty: prettyExpr(clause.expr, "math"),
            inputs: witnessInputs(),
            result: String(result),
            note: "proven over exact reals but false in float64 execution — the postcondition uses exact arithmetic the emitted code cannot honor (rounding, non-finite, or exact equality).",
          });
          // One witness per clause is enough to fail the gate.
          provenAxioms.delete(clause.axiomId);
          break;
        }
      }
      if (provenAxioms.size === 0 && !bodyHasCalls) break;
    }
  }
  return issues;
}
