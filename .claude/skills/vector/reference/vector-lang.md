# vector-lang manual — Architect & Generator

This is the knowledge vector's two LLM roles used to carry before they became
*you*. When the skill runs, you play both roles; the deterministic engine
(`vector verify`) plays the theorem prover. Read this once, then emit the two JSON
artifacts. The authoritative shapes are `schemas/spec-plan.json` and
`schemas/program.json` — this manual is the intent behind them.

## Role 1 — Architect: prompt → SpecPlan

Translate the user's casual request into:

1. **AXIOMS** — the formal contract as precise pre/post-conditions in
   mathematical English. Give each a short stable id (`AX1`, `AX2`, …).
   - `"throws / errors / rejects if X"` ⟶ a **precondition** of `NOT X`
     (`kind: "pre"`). The emitted code enforces it with a runtime throw.
   - A guarantee about the output ⟶ a **postcondition** (`kind: "post"`).
   - Do **not** invent requirements the user didn't state or clearly imply. If
     the request names a constant (an exchange rate, a threshold), fix it as a
     literal in the axioms.

2. **UNITS** — a Dijkstra-style layered decomposition into 1–4 small pure
   functions, **lowest layer first**. Each layer abstracts the one below and may
   only call strictly lower layers. Every function is a single pure expression
   over `Real` / `Int` / `Bool` — no strings, arrays, loops, recursion, or
   state. Assign each unit the axiom ids it is responsible for enforcing via
   `relevantAxiomIds`.

Stay inside what the solver can verify: arithmetic (`+ - * /`), comparisons,
boolean logic, if-then-else. Prefer `Real` for money and measurements. Prefer
**linear** arithmetic (variables times literal constants). If the request is
fundamentally outside this fragment (needs strings, IO, loops), still produce
the closest faithful numeric core of it and say so to the user.

## Role 2 — Generator: SpecPlan → Program (vector-lang)

Write the implementation **and** its contract together. Every `ensures` clause
you write will be PROVEN to hold for ALL inputs satisfying the `requires`
clauses, or refuted with a concrete counterexample.

**The language (JSON AST):**
- Types: `Real` (exact rationals), `Int`, `Bool`. Nothing else.
  - An `Int` is a float64 in the emitted code, exact only within ±(2^53−1).
    The verifier proves every `Int` `+`, `-` and `*` (in the body and in each
    `requires`) stays in that range; bound the parameters with `requires`, and
    prefer forms whose intermediates never outgrow their operands
    (`low + (high - low)`, not `(low + high) - low`).
- Expr nodes: `num` (decimal **string** like `"0.91"` — never scientific
  notation, never a JSON number), `bool`, `var`, `unop`
  (`not`/`neg`/`abs`/`floor`/`ceil`), `binop`
  (`+ - * /`, `min`, `max`, `< <= > >= == != and or implies`), `ite`, `call`.
  - `abs`/`neg` preserve the numeric type; `floor`/`ceil` take a `Real` and
    return a `Real` (integer-valued). Round to cents with
    `floor(x*100 + 0.5) / 100`. Clamp with `min(max(x, lo), hi)`.
- A function `body` is ONE pure expression whose type equals `returnType`.
  `result` may appear ONLY in `ensures` clauses, where it denotes the return.
- **Layering:** functions are ordered lowest layer first and may only `call`
  functions in strictly lower layers of the same program. A callee's `requires`
  is **proven** to hold for your actual arguments — don't call into a lower
  layer outside its precondition.
- **Division:** `/` needs **`Real`** operands and yields `Real` (JS `/` is
  float64 division, so `Int/Int` is rejected — use `floor`/`ceil` for discrete
  results). The verifier proves the denominator is nonzero on every reachable
  path; guard every `/` with a `requires` (denominator `!= 0`) or an `ite`.

**The contract:**
- `requires` = preconditions. A spec axiom "throws if X" becomes `requires NOT X`.
  `requires` may NOT mention `result`.
- `ensures` = postconditions over params and `result`, proven by the solver.
  Every `ensures` **must reference `result`** and must actually constrain it —
  a tautology like `result == result` or a restated precondition is rejected as
  *trivial*. Prefer inequalities/tolerances over exact `==` on a `Real` result
  (float64 rounding makes exact real-number equalities fail the conformance
  check — e.g. `result == x + 0.3` for `(x+0.1)+0.2`).
- Every clause carries the `axiomId` of the spec-plan axiom it formalizes,
  matching its **polarity**: a `pre` axiom → a `requires` clause, a `post`
  axiom → an `ensures` clause. **Every axiom must be enforced**, and the program
  must implement **exactly** the spec's units (same names, layers, signatures).
- Preconditions must be **satisfiable** — contradictory `requires` make the
  proof vacuous and are rejected. Never tighten `requires` just to force a proof
  through.

**Solver-friendliness:**
- Prefer linear arithmetic. Nonlinear terms (variable × variable) can make the
  solver answer `unknown` — which the engine treats as *not proven*.
- Keep functions tiny; push shared arithmetic into a lower layer and call it.

## Repairing on feedback

`vector verify … --json` returns `status` plus, when not PROVEN, a `feedback`
string and a structured `items[]` array. Each item names the `function`, the
`axiomId`, the `property`, the `issue`, an optional `counterexample`, and a
`hint`. The `issue` is one of:

- `counterexample` — the postcondition is false for the input shown; fix the
  body or tighten a `requires`.
- `unknown` — solver undecided; restate in linear arithmetic.
- `division-hazard` — denominator may be zero; add a `requires` or `ite` guard.
- `range-hazard` — an `Int` value may leave ±(2^53−1), where float64 rounds;
  bound the parameters with `requires` or rewrite so no intermediate grows.
- `precondition-hazard` — a call violates the callee's `requires` for the args
  shown; strengthen this function's `requires` or guard the call with an `ite`.
- `vacuous` — the `requires` are contradictory; **remove** the bad precondition,
  do NOT add more.
- `trivial` — the `ensures` holds regardless of the body; restate it as a real
  constraint on `result`.
- `conformance` — proven over reals but false in float64 at the input shown;
  avoid exact `==` on `Real`, use an inequality/tolerance.

Repair the program **minimally** — keep every clause that already proved, change
only what the feedback refutes — then re-verify. Never present code from any run
whose status was not `PROVEN`.

## Worked example

Prompt: *"Build a USD to EUR converter that throws an error if the amount is
negative"* (rate 0.91).

SpecPlan axioms: `AX1` pre (`amount >= 0`), `AX2` post
(`result == amount * 0.91`), `AX3` post (`result >= 0`), plus a lower-layer
`applyRate(amount, rate)` with `AX-RATE` pre (`rate > 0`) and `AX2a` post
(`result == amount * rate`). Two units: `applyRate` (layer 1) and `usdToEur`
(layer 2) calling it with the literal rate `"0.91"`. See
`tests/fixtures/currency-spec.json` and `tests/fixtures/currency.json` for the
exact JSON that proves.
