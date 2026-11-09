import { emitTypeScript } from "../emit/typescript.ts";
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
      // The emitted callee first runs its domain guards (Number.isFinite for
      // Real, Number.isSafeInteger for Int) — a float64 overflow to ±Infinity
      // or past 2^53 in a computed argument throws there, before any requires
      // is evaluated.
      const domainFault = domainViolation(callee, inner);
      if (domainFault !== null) {
        throw new GuardViolation(callee.name, domainFault);
      }
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

/**
 * The emitted code's domain guard for a function's parameters: Real must be
 * finite, Int must be a safe integer, Bool must be a boolean. Returns a
 * description of the first violated guard, or null when every parameter is
 * in-domain.
 */
function domainViolation(
  fn: FunctionUnit,
  env: Map<string, Value>,
): string | null {
  for (const p of fn.params) {
    const v = env.get(p.name);
    if (p.type === "Real" && !Number.isFinite(v)) {
      return `${p.name} is a finite number`;
    }
    if (p.type === "Int" && !Number.isSafeInteger(v)) {
      return `${p.name} is a safe integer`;
    }
    if (p.type === "Bool" && typeof v !== "boolean") {
      return `${p.name} is a boolean`;
    }
  }
  return null;
}

type Outcome = { threw: true } | { threw: false; value: Value };

/** What the emitted function must do on this input, per the interpreter. */
function interpretCall(
  fn: FunctionUnit,
  env: Map<string, Value>,
  byName: Map<string, FunctionUnit>,
): Outcome {
  try {
    if (domainViolation(fn, env) !== null) return { threw: true };
    for (const c of fn.requires) {
      if (evalExpr(c.expr, env, byName) !== true) return { threw: true };
    }
    return { threw: false, value: evalExpr(fn.body, env, byName) };
  } catch {
    return { threw: true };
  }
}

type Emitted = Map<string, (...args: Value[]) => Value>;

/**
 * Compile the emitted TypeScript — the exact text the user receives — into
 * callable functions. Everything else in this gate interprets the AST, so a
 * fault in the printer or emitter (a dropped parenthesis, a wrong operator
 * token) is invisible to it; running the real output is what closes that gap.
 * Returns the reason when the source does not compile.
 */
function compileEmitted(
  program: Program,
  emit: (program: Program) => string,
): Emitted | string {
  try {
    const js = new Bun.Transpiler({ loader: "ts" })
      .transformSync(emit(program))
      .replace(/^export function /gm, "function ");
    const names = program.functions.map((f) => f.name);
    const table = new Function(
      `"use strict";\n${js}\nreturn { ${names.join(", ")} };`,
    )() as Record<string, (...args: Value[]) => Value>;
    return new Map(names.map((n) => [n, table[n] as (...a: Value[]) => Value]));
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** Run the emitted function; a guard's RangeError is its only lawful throw. */
function runEmitted(
  emitted: (...args: Value[]) => Value,
  args: Value[],
): Outcome | { fault: string } {
  try {
    return { threw: false, value: emitted(...args) };
  } catch (err) {
    if (err instanceof RangeError) return { threw: true };
    return { fault: err instanceof Error ? err.message : String(err) };
  }
}

/** Every numeric literal in the expressions, as the float64 JS would read it. */
function literalValues(exprs: Expr[], out: number[] = []): number[] {
  for (const expr of exprs) {
    switch (expr.kind) {
      case "num":
        out.push(Number(expr.value));
        break;
      case "unop":
        literalValues([expr.arg], out);
        break;
      case "binop":
        literalValues([expr.left, expr.right], out);
        break;
      case "ite":
        literalValues([expr.cond, expr.then, expr.else], out);
        break;
      case "call":
        literalValues(expr.args, out);
        break;
      default:
        break;
    }
  }
  return out;
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
// Both sides of the safe-integer edge: ±(2^53 - 1) is the largest magnitude
// the emitted Int guard admits, ±2^53 the smallest it must reject.
const INT_POOL = [
  0, 1, -1, 2, -2, 3, -3, 5, -5, 7, 10, -10, 100, 42, 9007199254740991,
  -9007199254740991, 9007199254740992, -9007199254740992, 1e15,
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

// Short decimals are where float64 bites ordinary code hardest: 0.58 * 100 is
// 57.99999999999999, so floor-to-cents is wrong for "nice" inputs that a pool
// of round numbers and random magnitudes essentially never hits.
const DECIMAL_GRID: number[] = (() => {
  const out: number[] = [];
  for (let k = -1000; k <= 1000; k++) out.push(k / 100);
  for (let k = -100; k <= 100; k++) out.push(k / 1000);
  return out;
})();

/** Parse a z3 model value ("3", "-7/2", "1.5") to the nearest double. */
function parseModelNumber(text: string): number | undefined {
  const m = /^(-?\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?$/.exec(text.trim());
  if (!m) return undefined;
  const v = m[2] === undefined ? Number(m[1]) : Number(m[1]) / Number(m[2]);
  return Number.isFinite(v) ? v : undefined;
}

/**
 * Candidate values for one numeric parameter, aimed at the region the
 * function's own constants and the solver's witness point describe: every
 * literal (and its negation), evenly spaced points between adjacent literals
 * (so a narrow window like 3.1 < x < 3.2 is actually entered), short
 * decimals, and short decimals around the solver's in-region witness.
 */
function denseValues(
  literals: number[],
  seed: number | undefined,
  rand: () => number,
): number[] {
  const out = new Set<number>();
  const anchors = [
    ...new Set([...literals, ...literals.map((x) => -x), 0]),
  ].sort((a, b) => a - b);
  for (const a of anchors) {
    for (const d of [0, 0.01, -0.01, 1, -1, 0.5, -0.5]) out.add(a + d);
    out.add(a * (1 + Number.EPSILON));
    out.add(a * (1 - Number.EPSILON));
    out.add(a / 2);
    out.add(a * 2);
  }
  for (let i = 0; i + 1 < anchors.length; i++) {
    const lo = anchors[i] as number;
    const hi = anchors[i + 1] as number;
    for (let k = 1; k < 16; k++) out.add(lo + ((hi - lo) * k) / 16);
  }
  for (const x of DECIMAL_GRID) out.add(x);
  if (seed !== undefined) {
    const base = Math.round(seed * 100) / 100;
    for (let k = -200; k <= 200; k++) out.add(base + k / 100);
    out.add(seed);
  }
  // Two-decimal values across a wide magnitude range (prices, amounts).
  for (let i = 0; i < 300; i++) {
    out.add(Math.round((rand() * 2 - 1) * 1e8) / 100);
  }
  return [...out].filter((x) => Number.isFinite(x));
}

/**
 * The second sampling wave, run once the pool wave has found in-region
 * points: sweep each numeric parameter over its dense values while holding
 * the others at a known-valid base (the solver's witness, then pool samples
 * that satisfied requires), plus random combinations of dense values.
 */
function* denseSamples(
  fn: FunctionUnit,
  bases: Map<string, Value>[],
  seed: Record<string, number> | undefined,
  rand: () => number,
): Generator<Map<string, Value>> {
  const literals = literalValues([
    ...fn.requires.map((c) => c.expr),
    ...fn.ensures.map((c) => c.expr),
    fn.body,
  ]);
  const dense = new Map<string, number[]>();
  for (const p of fn.params) {
    if (p.type === "Bool") continue;
    let vals = denseValues(literals, seed?.[p.name], rand);
    if (p.type === "Int") vals = [...new Set(vals.map(Math.round))];
    dense.set(p.name, vals);
  }
  for (const base of bases) {
    for (const [name, vals] of dense) {
      for (const x of vals) {
        const env = new Map(base);
        env.set(name, x);
        yield env;
      }
    }
  }
  if (fn.params.length > 1) {
    for (let i = 0; i < 2000; i++) {
      const env = new Map<string, Value>();
      for (const p of fn.params) {
        const vals = dense.get(p.name);
        if (vals)
          env.set(p.name, vals[Math.floor(rand() * vals.length)] as number);
        else env.set(p.name, rand() < 0.5);
      }
      yield env;
    }
  }
}

/**
 * Per-function in-region witness points from the solver (the `reachable`
 * query's model), keyed by function name then parameter name.
 */
export type ConformanceSeeds = Map<string, Record<string, string>>;

/**
 * Fuzz every *proven* guarantee of every function against float64 execution:
 * each proven ensures clause must still evaluate true, and the body must run
 * to completion — a callee guard tripped by float64 rounding is a throw the
 * proof said could not happen. Every sample is also run through the emitted
 * TypeScript itself (`emit`, overridable for tests), which must agree with the
 * interpreter on both the value and whether the input is rejected. Returns the violations found. Only meaningful
 * to call on a report that already proved clean over the reals.
 */
export function checkConformance(
  program: Program,
  report: VerificationReport,
  seeds: ConformanceSeeds = new Map(),
  emit: (program: Program) => string = emitTypeScript,
): ConformanceIssue[] {
  const byName = new Map(program.functions.map((f) => [f.name, f]));
  const issues: ConformanceIssue[] = [];
  const rand = rng(0x9e3779b9);
  const emitted = compileEmitted(program, emit);
  if (typeof emitted === "string") {
    // Fail closed: source that does not compile was never checked at all.
    issues.push({
      function: program.functions[0]?.name ?? program.programName,
      kind: "emitted-code",
      axiomId: "(emitted code)",
      pretty: "the emitted TypeScript compiles",
      inputs: {},
      result: `(does not compile — ${emitted})`,
      note: "the emitted TypeScript could not be compiled, so it was never run against the proven program.",
    });
    return issues;
  }

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
    const emittedFn = emitted.get(fn.name);
    let emittedFlagged = false;

    // Seed: the solver's witness, rounded to float64. Only a starting point
    // — a witness on the boundary of an open region can round outside it.
    let seed: Record<string, number> | undefined;
    const rawSeed = seeds.get(fn.name);
    if (rawSeed) {
      seed = {};
      for (const p of fn.params) {
        const raw = rawSeed[p.name];
        const x = raw === undefined ? undefined : parseModelNumber(raw);
        if (x !== undefined)
          seed[p.name] = p.type === "Int" ? Math.round(x) : x;
      }
    }
    const seedEnv = (): Map<string, Value> | undefined => {
      if (!seed) return undefined;
      const env = new Map<string, Value>();
      for (const p of fn.params) {
        const x = seed[p.name];
        if (p.type === "Bool") env.set(p.name, rawSeed?.[p.name] === "true");
        else if (x === undefined) return undefined;
        else env.set(p.name, x);
      }
      return env;
    };

    let inRegion = 0;
    const bases: Map<string, Value>[] = [];
    // Returns false once every proven clause already has a witness and there
    // is nothing left to learn from further samples.
    const check = (env: Map<string, Value>): boolean => {
      const witnessInputs = (): Record<string, string> => {
        const inputs: Record<string, string> = {};
        for (const p of fn.params) inputs[p.name] = String(env.get(p.name));
        return inputs;
      };

      // Differential check, on every sample (rejected inputs included): the
      // emitted function must throw exactly where the proven program rejects
      // the input and return exactly what it computes everywhere else.
      if (emittedFn && !emittedFlagged) {
        const want = interpretCall(fn, env, byName);
        const got = runEmitted(
          emittedFn,
          fn.params.map((p) => env.get(p.name) as Value),
        );
        const show = (o: Outcome | { fault: string }): string =>
          "fault" in o
            ? `fails with "${o.fault}"`
            : o.threw
              ? "throws"
              : `returns ${String(o.value)}`;
        const agree =
          !("fault" in got) &&
          got.threw === want.threw &&
          (got.threw || want.threw || Object.is(got.value, want.value));
        if (!agree) {
          emittedFlagged = true;
          issues.push({
            function: fn.name,
            kind: "emitted-code",
            axiomId: "(emitted code)",
            pretty: "the emitted TypeScript computes the proven program",
            inputs: witnessInputs(),
            result: `(emitted code ${show(got)}; the proven program ${show(want)})`,
            note: "the emitted TypeScript, executed, disagrees with the program the solver proved. This is a fault in vector's emitter, not in the program — the proof does not cover this output.",
          });
        }
      }

      // The emitted function's own domain guard rejects non-finite Real and
      // non-safe-integer Int arguments before anything else runs.
      if (domainViolation(fn, env) !== null) return true;
      let requiresHold: boolean;
      try {
        requiresHold = fn.requires.every(
          (c) => evalExpr(c.expr, env, byName) === true,
        );
      } catch {
        // Guard/domain error while deciding validity: the emitted code rejects
        // this input either way, so it is outside the contract we must honor.
        return true;
      }
      if (!requiresHold) return true;
      inRegion += 1;
      if (bases.length < 3) bases.push(env);

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
        return true;
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
      return !(provenAxioms.size === 0 && !bodyHasCalls);
    };

    const first = seedEnv();
    let going = first ? check(first) : true;
    if (going) {
      for (const env of sampleValues(fn, rand)) {
        going = check(env);
        if (!going) break;
      }
    }
    if (going) {
      const sweepBases =
        first && bases[0] !== first ? [first, ...bases] : bases;
      for (const env of denseSamples(fn, sweepBases, seed, rand)) {
        going = check(env);
        if (!going) break;
      }
    }
    // Fail closed: if not one float64 input satisfied the preconditions, the
    // gate has tested nothing and must not report the code as conforming.
    if (inRegion === 0) {
      issues.push({
        function: fn.name,
        kind: "unsampled",
        axiomId: "(requires)",
        pretty: fn.requires.map((c) => prettyExpr(c.expr, "math")).join(" ∧ "),
        inputs: {},
        result: "(no float64 input satisfied the preconditions)",
        note: "the precondition region is inhabited over exact reals, but no float64 sample landed inside it, so the emitted code's behaviour there was never checked. Widen the requires, or make them float-representable.",
      });
    }
  }
  return issues;
}

/** A concrete input where two float64 evaluations disagree. */
export interface Float64Delta {
  inputs: Record<string, string>;
  oldResult: string;
  newResult: string;
}

/**
 * Run two versions of a function side by side in float64, the way their
 * emitted TypeScript would, and return the first sampled input where the
 * outputs are not bit-identical — or where one throws and the other does not,
 * a requires the float64 code finds false included (its RangeError guard). Equivalence over the rationals
 * says nothing about this: `x * 1.1 + 0.2` and `x * 1.1 + 0.1 + 0.1` are the
 * same real function and different float64 functions. Parameters are paired
 * by position (calls are positional).
 */
export function findFloat64Delta(
  oldProgram: Program,
  oldFn: FunctionUnit,
  newProgram: Program,
  newFn: FunctionUnit,
): Float64Delta | null {
  const oldByName = new Map(oldProgram.functions.map((f) => [f.name, f]));
  const newByName = new Map(newProgram.functions.map((f) => [f.name, f]));
  const rand = rng(0x85ebca6b);

  const run = (
    fn: FunctionUnit,
    byName: Map<string, FunctionUnit>,
    env: Map<string, Value>,
  ): { ok: true; value: Value } | { ok: false; why: string } | null => {
    if (domainViolation(fn, env) !== null) return null;
    // The emitted code throws a RangeError where a requires is false, so a
    // guard that differs in float64 is a difference in behaviour.
    try {
      const broken = fn.requires.find(
        (c) => evalExpr(c.expr, env, byName) !== true,
      );
      if (broken)
        return {
          ok: false,
          why: `(throws — requires violated [${broken.axiomId}])`,
        };
    } catch {
      return null;
    }
    try {
      return { ok: true, value: evalExpr(fn.body, env, byName) };
    } catch (err) {
      if (err instanceof GuardViolation) {
        return { ok: false, why: `(throws — ${err.message})` };
      }
      return null;
    }
  };
  const render = (
    r: { ok: true; value: Value } | { ok: false; why: string },
  ) => (r.ok ? String(r.value) : r.why);

  const bases: Map<string, Value>[] = [];
  const compare = (env: Map<string, Value>): Float64Delta | null => {
    const newEnv = new Map<string, Value>();
    oldFn.params.forEach((p, i) => {
      const np = newFn.params[i];
      const value = env.get(p.name);
      if (np && value !== undefined) newEnv.set(np.name, value);
    });
    const a = run(oldFn, oldByName, env);
    const b = run(newFn, newByName, newEnv);
    // Only inputs both versions accept; domain changes are the solver's job.
    if (a === null || b === null) return null;
    if (!a.ok && !b.ok) return null;
    if (bases.length < 3) bases.push(env);
    const same = a.ok && b.ok ? Object.is(a.value, b.value) : a.ok === b.ok;
    if (same) return null;
    const inputs: Record<string, string> = {};
    for (const p of oldFn.params) inputs[p.name] = String(env.get(p.name));
    return { inputs, oldResult: render(a), newResult: render(b) };
  };

  for (const env of sampleValues(oldFn, rand)) {
    const d = compare(env);
    if (d) return d;
  }
  // Dense around both versions' constants: a guard moved to 0.3 is tested
  // at 0.3 even though only the new version prints it.
  const both: FunctionUnit = {
    ...oldFn,
    requires: [...oldFn.requires, ...newFn.requires],
    ensures: [
      ...oldFn.ensures,
      ...newFn.ensures,
      { axiomId: "(new body)", expr: newFn.body },
    ],
  };
  for (const env of denseSamples(both, bases, undefined, rand)) {
    const d = compare(env);
    if (d) return d;
  }
  return null;
}
