---
name: vector
description: >-
  Turn a natural-language request for a small numeric/pure function into a
  FORMALLY VERIFIED TypeScript program — an SMT solver (Z3) proves every
  postcondition holds for ALL inputs before any code is emitted. Use when the
  user wants code that is proven correct, not just tested: converters,
  rate/threshold/pricing calculators, clamping and rounding, fee/tax math,
  unit conversions, bounds-checked arithmetic, or any function whose contract
  ("throws if negative", "result never exceeds X", "always non-negative") must
  hold with certainty. Triggers on "prove", "formally verify", "verified",
  "provably correct", "no counterexamples".
---

# vector — formally verified functions from a prompt

Vector never treats generated code as a black box. **You** propose a formal
spec and a program; **Z3 holds the veto.** Unproven code is never presented.
The determinism (schema validation, typecheck, axiom traceability, the SMT
proof, the retry decision) lives in the engine — you supply only the two JSON
artifacts and the repairs.

## When this fits — and when it doesn't

Fits: a function (or 1–4 layered functions) over **Real / Int / Bool** —
arithmetic, comparisons, boolean logic, if-then-else, and
`abs`/`min`/`max`/`floor`/`ceil`. Money, rates, thresholds, clamping
(`min(max(x, lo), hi)`), rounding to cents (`floor(x*100 + 0.5) / 100`), bounds
checks.

Does **not** fit: strings, arrays, IO, loops, recursion, state, data
structures. If the request needs those, tell the user vector can only verify
the **numeric core**, offer that core, and don't force the rest through.

## Read first

1. `.claude/skills/vector/reference/vector-lang.md` — the Architect + Generator
   manual (axioms, layering, the expression language, repair protocol).
2. `schemas/spec-plan.json` and `schemas/program.json` — the **authoritative**
   shapes your two JSON artifacts must satisfy. These are the source of truth;
   conform to them exactly (`additionalProperties: false` everywhere).

## The loop

1. **Architect.** From the user's prompt, write a **SpecPlan** JSON conforming
   to `schemas/spec-plan.json`: axioms (pre/post, stable ids) and a lowest-first
   layered decomposition of units. Write it to a scratch file, e.g.
   `/tmp/vector-spec.json`.

2. **Generator.** Write a **Program** JSON conforming to `schemas/program.json`:
   each unit as one pure expression plus its `requires`/`ensures` clauses, every
   clause tagged with the `axiomId` it formalizes. Every spec axiom must be
   enforced by some clause. Write it to e.g. `/tmp/vector-program.json`.

3. **Verify (the veto).** Run:

   ```bash
   bun run vector --verify /tmp/vector-spec.json /tmp/vector-program.json --json
   ```

   No API key is needed — this stage is pure Z3 + validators. Parse the JSON
   `status`:

   - **`PROVEN`** → success. The result carries `dashboard` and `emittedCode`.
     Show the user the dashboard and the proven TypeScript (or write it out with
     `--emit <file>` in a non-`--json` run). Done.
   - **`REFUTED` / `UNKNOWN`** → read `feedback` and `items[]` (each has the
     `function`, `axiomId`, `property`, `issue`, a concrete `counterexample`,
     and a `hint`). Repair the **program** minimally — keep every clause that
     already proved, fix only what was refuted — rewrite the program file, and
     go back to step 3.
   - **`INVALID`** → `errors[]` lists shape / type / traceability problems (the
     *full* list, not just the first). Fix them — usually in the program,
     sometimes the spec — and re-verify. This costs no solver time.
   - **`ERROR`** → solver infrastructure failure (`message`). Report it; don't
     loop.

4. **Bound the retries.** Give up after ~4 repair attempts and report the last
   `feedback` honestly rather than presenting unproven code. If Z3 keeps
   answering `UNKNOWN`, the property is likely nonlinear — restate the body and
   clauses in linear arithmetic (variables × literal constants only).

## Regenerating an existing proven program

When the user asks you to regenerate, refactor, or evolve a program that
already has a proven `program.json`, don't make them re-review — prove the
regeneration behavior-preserving:

```bash
bun run vector --diff <old-program.json> <new-program.json> --json
```

- **`EQUIVALENT`** → report that behavior is provably unchanged for all
  inputs; nothing to review.
- **`DIFFERENT`** → relay each witness verbatim (input → old vs new result;
  domain narrowed/widened; removed functions; signature changes) and confirm
  the deltas match what the user intended. The witnesses are the entire
  behavioral change — never summarize them away.
- **`UNDECIDED`** → equivalence wasn't proven (usually nonlinear arithmetic);
  restate the bodies linearly and re-run. Do not report it as equivalent.

## Contract style (advisory)

`--verify` may return `styleWarnings` for **definitional** ensures —
`result == <formula>`, the algorithm restated as spec. Prefer property-shaped
axioms the user could have written in a ticket (bounds, monotonicity,
conservation, error behavior) and let `--diff` carry behavior between
regenerations; keep a definitional clause only when the formula itself is the
requirement (a regulated fee, a fixed published rate). Warnings never block a
proof — surface them to the user instead of silently rewriting the spec.

## Invariants — do not break these

- **Never present code whose verification status was not `PROVEN`.** That is the
  entire point of vector.
- **Never edit the engine to make a proof pass.** If something can't be proven,
  the spec or the program is wrong, not the solver.
- **Never force a proof through by tightening `requires`.** Contradictory
  preconditions are caught as *vacuous*; a `PROVEN` over an empty input region
  proves nothing.
- Every `ensures` must genuinely constrain `result` (no tautologies) and hold in
  float64, not just over the reals (the `conformance` gate). Prefer inequalities
  to exact `==` on `Real`.
- The SpecPlan is the fixed point: prefer repairing the **program** against a
  stable spec, and keep the program's units matching the spec's decomposition.
  Only revise the spec if it misread the user's intent.

## Human (non-JSON) output

For a rendered dashboard + emitted file instead of machine JSON:

```bash
bun run vector --verify /tmp/vector-spec.json /tmp/vector-program.json --emit converter.ts
```

## Reference example

`test/fixtures/currency-spec.json` + `test/fixtures/currency.json` are a spec +
program pair that proves clean — mirror their structure for a first artifact.
