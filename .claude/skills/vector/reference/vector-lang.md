# vector-lang manual — Architect & Generator

This is the knowledge vector's two LLM roles used to carry before they became
*you*. When the skill runs, you play both roles; the deterministic engine
(`vector --verify`) plays the theorem prover. Read this once, then emit the two JSON
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
- Expr nodes: `num` (decimal **string** like `"0.91"` — never scientific
  notation, never a JSON number), `bool`, `var`, `unop` (`not`/`neg`),
  `binop` (`+ - * / < <= > >= == != and or implies`), `ite`, `call`.
- A function `body` is ONE pure expression whose type equals `returnType`.
  `result` may appear ONLY in `ensures` clauses, where it denotes the return.
- **Layering:** functions are ordered lowest layer first and may only `call`
  functions in strictly lower layers of the same program.
- **Division:** the verifier proves the denominator is nonzero on every
  reachable path. Guard every `/` with a `requires` (denominator `!= 0`) or an
  `ite`.

**The contract:**
- `requires` = preconditions. A spec axiom "throws if X" becomes `requires NOT X`.
- `ensures` = postconditions over params and `result`, proven by the solver.
- Every clause carries the `axiomId` of the spec-plan axiom it formalizes, and
  **every axiom in the spec plan must be enforced by at least one clause** — the
  engine's traceability gate rejects the program otherwise. Do not add clauses
  for axioms that don't exist; do not weaken an axiom's meaning.

**Solver-friendliness:**
- Prefer linear arithmetic. Nonlinear terms (variable × variable) can make the
  solver answer `unknown` — which the engine treats as *not proven*.
- Keep functions tiny; push shared arithmetic into a lower layer and call it.

## Repairing on feedback

`vector --verify … --json` returns `status` plus, when not PROVEN, a `feedback`
string and a structured `items[]` array. Each item names the `function`, the
`axiomId`, the `property`, the `issue`
(`counterexample` | `unknown` | `division-hazard`), a concrete `counterexample`,
and a `hint`. Repair the program **minimally** — keep every clause that already
proved, change only what the feedback refutes — then re-verify. Never present
code from any run whose status was not `PROVEN`.

## Worked example

Prompt: *"Build a USD to EUR converter that throws an error if the amount is
negative"* (rate 0.91).

SpecPlan axioms: `AX1` pre (`amount >= 0`), `AX2` post
(`result == amount * 0.91`), `AX3` post (`result >= 0`), plus a lower-layer
`applyRate(amount, rate)` with `AX-RATE` pre (`rate > 0`) and `AX2a` post
(`result == amount * rate`). Two units: `applyRate` (layer 1) and `usdToEur`
(layer 2) calling it with the literal rate `"0.91"`. See
`test/fixtures/currency-spec.json` and `test/fixtures/currency.json` for the
exact JSON that proves.
