# vector — EWD-1 Dijkstra Engine

Turn a casual natural-language request into a **formally verified** TypeScript
program. Inspired by Dijkstra's EWD249 — *"testing can show the presence of
bugs, but never their absence"* — vector never treats generated code as a black
box: an SMT solver (Z3) **proves** every postcondition holds for **all** inputs
before a single line of code is emitted. If a contract can't be proven, the code
is withheld.

```
prompt ─▶ Architect ─▶ formal axioms + a layered decomposition   (the SpecPlan)
       ─▶ Generator ─▶ program + contracts in "EWD-lang"          (the Program)
       ─▶ Z3        ─▶ proves / refutes each contract for all inputs
       ─▶ emit      ─▶ runnable TypeScript + a "Dijkstra Dashboard"
```

The LLM only ever *proposes* a structured artifact; a theorem prover holds the
veto. When Z3 finds a counterexample it flows back as structured feedback and
the program is repaired, up to a retry bound. **Unproven code is never emitted.**

---

## Contents

- [The idea](#the-idea)
- [Two ways to run it](#two-ways-to-run-it)
- [Install & requirements](#install--requirements)
- [CLI usage](#cli-usage)
  - [Prompt mode (full pipeline)](#prompt-mode-full-pipeline)
  - [Verify mode (deterministic, no API key)](#verify-mode-deterministic-no-api-key)
  - [Fixture mode](#fixture-mode)
  - [Flags](#flags)
- [The Claude Code skill](#the-claude-code-skill)
- [EWD-lang reference](#ewd-lang-reference)
- [The two artifacts](#the-two-artifacts)
- [Verify output (the JSON contract)](#verify-output-the-json-contract)
- [The Dijkstra Dashboard](#the-dijkstra-dashboard)
- [Schema-driven types](#schema-driven-types)
- [Project layout](#project-layout)
- [Architecture notes](#architecture-notes)
- [Develop](#develop)
- [Limitations](#limitations)

---

## The idea

A generated function is only as trustworthy as the tests you happen to write.
vector removes the "happen to": it asks the model to state the program's
**contract** as formal pre/post-conditions, then hands the contract *and* the
implementation to Z3, which proves — over exact rationals, for every possible
input — that the postconditions follow from the preconditions. The model is a
*proposer*; Z3 is the *judge*. Three properties fall out of that split:

1. **Soundness by construction.** Emitted code carries a machine-checked proof,
   not a passing test suite. "Refuted" comes with a concrete counterexample.
2. **The model can't grade its own work.** Verification lives in deterministic
   code (schema validation → typecheck → axiom traceability → Z3), never in the
   model's judgement.
3. **Anti-gaming.** The Generator writes both body and contract, so it could
   "pass" by quietly dropping an axiom. A deterministic **traceability** check
   forbids that: every spec axiom must be enforced by some clause, and no clause
   may cite an axiom that isn't in the spec.

---

## Two ways to run it

The exact same deterministic engine (schemas, validators, Z3) backs both; they
differ only in **who plays the two LLM roles**.

| | Prompt mode (CLI) | Claude Code skill |
|---|---|---|
| Architect + Generator | vector's own Anthropic API calls | **Claude Code itself**, in-context |
| API key | `ANTHROPIC_API_KEY` required | none — no nested LLM call |
| Entry point | `ewd "<prompt>"` | you just ask, in natural language |
| Retry loop | inside `pipeline.ts` | Claude repairs in-context, re-verifying |
| Engine's job | the whole pipeline | the deterministic **veto** only (`ewd --verify`) |
| Best for | standalone / CI with a key | working inside Claude Code |

Both guarantee the same invariant: **code is presented only when Z3 has proven
every postcondition.**

---

## Install & requirements

```bash
bun install
```

- [**Bun**](https://bun.sh) — runs the `ewd` CLI and the test suite.
- **Node ≥ 22.18** on `PATH` — runs the solver subprocess (see
  [Architecture notes](#architecture-notes)). Node runs the TypeScript worker
  natively via type stripping.
- **`ANTHROPIC_API_KEY`** — only for *prompt mode*. Put it in `.env` (see
  `.env.example`) or the environment. The verify/fixture paths and the Claude
  Code skill need **no** key.

---

## CLI usage

The `ewd` bin has three modes.

### Prompt mode (full pipeline)

Needs `ANTHROPIC_API_KEY`. vector calls the model as Architect then Generator,
verifies, and retries on counterexamples.

```bash
bun run ewd "Build a USD to EUR converter that throws an error if the amount is negative"
```

Phases printed as it runs:

```
[1/5] Spec extraction ...... 5 axiom(s): AX1 (pre), AX2 (post), ...
[2/5] Decomposition ........ 2 layer(s): applyRate → usdToEur
[3/5] Generative logic ..... attempt 1/3
[4/5] Deterministic solver . Z3 4.16.0 (wasm) · 3 VCs · 3 unsat · 0 sat · 0 unknown · 170 ms
[5/5] Report ............... PROVEN
```

### Verify mode (deterministic, no API key)

Verify a **SpecPlan + Program** pair that some *other* agent produced — inside
Claude Code, that agent is Claude Code itself. This is the deterministic veto
only: shape → typecheck → axiom traceability → Z3. No credentials.

```bash
# structured JSON (what the skill consumes)
bun run ewd --verify test/fixtures/currency-spec.json test/fixtures/currency.json --json

# human dashboard + write the proven TypeScript out
bun run ewd --verify test/fixtures/currency-spec.json test/fixtures/currency.json --emit converter.ts
```

`--verify` takes two positional paths — the spec plan first, the program second.
(Equivalent explicit form: `--spec <file> --program <file>`.)

Exit code is `0` only when the status is `PROVEN`, `1` otherwise — usable as a CI
gate.

### Fixture mode

Verify a hand-written Program alone (no spec plan, so no traceability check).
Handy for iterating on EWD-lang by hand.

```bash
bun run ewd -- --fixture test/fixtures/currency.json
```

### Flags

| Flag | Modes | Meaning |
|---|---|---|
| `--verify <spec> <program>` | verify | Verify a spec-plan + program pair. |
| `--spec <file>` / `--program <file>` | verify | Explicit form of the two `--verify` paths. |
| `--fixture <file>` | fixture | Verify a lone Program JSON. |
| `--max-retries N` | prompt | Generator repair attempts (default `3`). |
| `--json` | all | Emit machine-readable JSON instead of the dashboard. |
| `--emit <file>` | all | Write the proven TypeScript to a file (only when PROVEN). |

> Note: because `ewd` is an npm script, `bun run ewd --flag` passes `--flag`
> straight through. The `--` in `bun run ewd -- --fixture …` is optional but
> harmless.

---

## The Claude Code skill

`.claude/skills/vector/` packages vector so it works **starting from the initial
prompt** inside Claude Code — no API key, no nested LLM call.

**How to use it:** just ask, in natural language, for a small numeric function
that must be *proven* correct — e.g. *"give me a provably correct fee calculator
that never returns a negative amount"*. The skill's description triggers on
intents like "prove", "formally verify", "provably correct", "no
counterexamples", and on shapes like converters, rate/threshold/pricing math,
clamping, rounding, and bounds checks.

**What happens under the hood** (`SKILL.md` + `reference/ewd-lang.md`):

1. Claude Code, as **Architect**, writes a `SpecPlan` JSON conforming to
   `schemas/spec-plan.json`.
2. Claude Code, as **Generator**, writes a `Program` JSON conforming to
   `schemas/program.json`.
3. It runs `ewd --verify spec.json program.json --json` — the deterministic
   veto.
4. On `REFUTED` / `UNKNOWN` / `INVALID` it reads the structured `feedback` /
   `items`, repairs the **program** minimally (keeping every clause that already
   proved), and re-verifies — up to ~4 attempts.
5. It shows you the dashboard and the proven TypeScript **only** when the status
   is `PROVEN`.

The schemas remain the single source of truth — the skill points Claude at
`schemas/*.json` directly rather than keeping copies that could drift. The
nested-API pipeline (`ewd "<prompt>"`) stays available for standalone/CI use.

---

## EWD-lang reference

Programs are a small, restricted JSON AST — pure, total (except division), no
loops, recursion, strings, arrays, or state. This is deliberate: it's exactly
the fragment Z3 can decide.

**Types:** `Real` (exact rationals), `Int`, `Bool`.

**Expression nodes** (`kind` discriminates):

| `kind` | Fields | Notes |
|---|---|---|
| `num` | `value` | Decimal **string**, e.g. `"0.91"`, `"-3"`. Never scientific notation, never a JSON number — the string reaches Z3 as an exact rational. |
| `bool` | `value` | `true` / `false`. |
| `var` | `name` | A parameter, or `result` (allowed **only** in `ensures`). |
| `unop` | `op`, `arg` | `not`, `neg`. |
| `binop` | `op`, `left`, `right` | `+ - * / < <= > >= == != and or implies`. |
| `ite` | `cond`, `then`, `else` | If-then-else **expression** (not a statement). |
| `call` | `fn`, `args` | Calls a function in a **strictly lower layer** of the same program. |

**Function contract:**

- `requires` — preconditions. A spec axiom "throws/errors/rejects if X" becomes
  `requires NOT X`, materialized as a runtime `throw` in the emitted TypeScript.
- `ensures` — postconditions over the params and `result`, **proven** by Z3 for
  all inputs satisfying the preconditions.
- Every clause carries the `axiomId` of the spec axiom it formalizes.

**Layering (Dijkstra's step-wise composition):** functions are ordered lowest
layer first; a function may only `call` functions in strictly lower layers. Each
`body` is a single pure expression whose type equals `returnType`.

**Division:** Z3 proves the denominator is nonzero on every reachable path.
Guard every `/` with a `requires` (`denominator != 0`) or an `ite`; an
unguarded division that could be zero is reported as a *division hazard*.

**Solver-friendliness:** prefer **linear** arithmetic — multiply variables by
literal constants, not by other variables. Nonlinear terms can make Z3 answer
`unknown`, which the engine treats as *not proven*.

**Exactness footnote:** proofs hold over exact rationals; the emitted JavaScript
runs `float64`, so extreme values may round. The dashboard and emitted code both
carry this note.

---

## The two artifacts

### SpecPlan (`schemas/spec-plan.json`)

The formal contract plus a layered decomposition. It is the *fixed point* of a
run — the Generator retries against it, never the reverse.

```jsonc
{
  "programName": "usd_to_eur_converter",
  "axioms": [
    { "id": "AX1", "kind": "pre",  "statement": "amount is non-negative (throws if amount < 0)" },
    { "id": "AX2", "kind": "post", "statement": "result equals amount times 0.91" },
    { "id": "AX3", "kind": "post", "statement": "result is non-negative" },
    { "id": "AX-RATE", "kind": "pre",  "statement": "the applied rate is strictly positive" },
    { "id": "AX2a",    "kind": "post", "statement": "applyRate returns amount times rate" }
  ],
  "units": [
    { "name": "applyRate", "layer": 1, "purpose": "Multiply an amount by a positive rate.",
      "params": [ { "name": "amount", "type": "Real" }, { "name": "rate", "type": "Real" } ],
      "returnType": "Real", "relevantAxiomIds": ["AX-RATE", "AX2a"] },
    { "name": "usdToEur", "layer": 2, "purpose": "Convert non-negative USD to EUR at 0.91.",
      "params": [ { "name": "amount", "type": "Real" } ],
      "returnType": "Real", "relevantAxiomIds": ["AX1", "AX2", "AX3"] }
  ]
}
```

### Program (`schemas/program.json`)

The implementation *and* its contract, in EWD-lang. (Abbreviated — see
`test/fixtures/currency.json` for the full AST.)

```jsonc
{
  "programName": "usd_to_eur_converter",
  "functions": [
    {
      "name": "applyRate", "layer": 1, "purpose": "Multiply an amount by a positive rate.",
      "params": [ { "name": "amount", "type": "Real" }, { "name": "rate", "type": "Real" } ],
      "returnType": "Real",
      "requires": [ { "axiomId": "AX-RATE", "expr": /* rate > 0 */ } ],
      "ensures":  [ { "axiomId": "AX2a",   "expr": /* result == amount * rate */ } ],
      "body": /* amount * rate */
    }
    /* … usdToEur (layer 2) calls applyRate(amount, "0.91") … */
  ]
}
```

Run these two together through `ewd --verify` to see the whole thing prove.

---

## Verify output (the JSON contract)

`ewd --verify … --json` prints a discriminated `VerifyOutcome` (defined in
`src/verify.ts`). The `status` field selects the shape:

**`PROVEN`** — carries the rendered `dashboard` and the `emittedCode`:

```jsonc
{ "status": "PROVEN", "report": { /* full VerificationReport */ },
  "dashboard": "╔════…", "emittedCode": "// Generated by EWD-1 …" }
```

**`REFUTED` / `UNKNOWN`** — carries a prose `feedback` block **and** structured
`items[]`, one per unproven clause, for a targeted repair:

```jsonc
{
  "status": "REFUTED",
  "report": { /* … */ },
  "dashboard": "╔════…",
  "feedback": "Function usdToEur, ensures AX-BAD (result > amount): REFUTED — counterexample amount = 0.0 gives result = 0.0.",
  "items": [
    {
      "function": "usdToEur",
      "axiomId": "AX-BAD",
      "property": "result > amount",
      "issue": "counterexample",              // | "unknown" | "division-hazard"
      "counterexample": { "inputs": { "amount": "0.0" }, "result": "0.0" },
      "hint": "The postcondition is false for the input shown. Fix the body or tighten a requires clause …"
    }
  ]
}
```

**`INVALID`** — shape / type / traceability failures, as the *complete* list
(so a repair loop fixes everything at once, not one error per round):

```jsonc
{
  "status": "INVALID",
  "errors": [
    "usdToEur: clause cites unknown axiom \"AX2\"",
    "axiom AX9 (\"unused axiom\") is not enforced by any clause"
  ],
  "feedback": "The program failed deterministic validation:\n- …"
}
```

**`ERROR`** — solver infrastructure failure (`{ "status": "ERROR", "message": … }`);
don't loop on it.

---

## The Dijkstra Dashboard

The human-readable proof report: per-layer Hoare triples, one checkmark per
postcondition, counterexamples when a claim is refuted, and an honest note on
what's *proven* vs. *enforced at runtime*.

```
╔════════════════════════════════════════════════════════════════════╗
║                 EWD-1 DIJKSTRA ENGINE — PROOF REPORT               ║
╠════════════════════════════════════════════════════════════════════╣
║ Prompt:  "verify: test/fixtures/currency.json"                    ║
║ Attempt: 1/1      Solver: Z3 4.16.0 (wasm)      Status: PROVEN     ║
╠════════════════════════════════════════════════════════════════════╣
║ LAYER 1 · applyRate(amount: Real, rate: Real): Real                ║
║   { rate > 0 }  amount * rate                                      ║
║   { result == amount * rate }                                      ║
║   ✔ ensures AX2a  proven (unsat · 159 ms)                         ║
║   ⚠ guard rate > 0 enforced by runtime throw (not proven at call   ║
║   sites)                                                           ║
╟────────────────────────────────────────────────────────────────────╢
║ LAYER 2 · usdToEur(amount: Real): Real                             ║
║   { amount >= 0 }  applyRate(amount, 0.91)                         ║
║   { result == amount * 0.91  ∧  result >= 0 }                      ║
║   ✔ ensures AX2  proven (unsat · 4 ms)                            ║
║   ✔ ensures AX3  proven (unsat · 7 ms)                            ║
╠════════════════════════════════════════════════════════════════════╣
║ VERDICT: ALL POSTCONDITIONS PROVEN FOR ALL INPUTS                  ║
╚════════════════════════════════════════════════════════════════════╝
```

And the emitted TypeScript for the proven program — preconditions become runtime
throws, and every function's proven Hoare triple is documented in its doc
comment:

```ts
/**
 * Convert a non-negative USD amount to EUR at rate 0.91.
 * Layer 2 — Hoare triple proven by Z3:
 *   requires AX1: amount >= 0
 *   ensures  AX2: result == amount * 0.91
 *   ensures  AX3: result >= 0
 */
export function usdToEur(amount: number): number {
  if (!(amount >= 0)) {
    throw new RangeError("requires violated [AX1]: amount >= 0");
  }
  return applyRate(amount, 0.91);
}
```

When a claim is refuted the dashboard shows `✘ ensures … REFUTED` with the
counterexample, the verdict reports the violation count, and **no code is
emitted**.

---

## Schema-driven types

`schemas/*.json` is the single source of truth. The same JSON Schemas both
constrain the model's structured output **and** generate the TypeScript
types/parsers via [`@amritk/mjst`](https://www.npmjs.com/package/@amritk/mjst):

```bash
bun run generate:schemas    # → src/generated/ (checked in, never hand-edited)
```

`src/lang/shape.ts` is a deep structural validator owned by the engine: it
returns the **full** list of problems (the generated parsers throw on the
first), and is what feeds both the pipeline's and the skill's repair loops.

---

## Project layout

```
schemas/            JSON Schemas — source of truth for types + LLM output
src/
  cli.ts            entrypoint (the `ewd` bin) — prompt / verify / fixture modes
  pipeline.ts       prompt mode: SPEC → GENERATE → VALIDATE → VERIFY → (retry) → REPORT
  verify.ts         deterministic (SpecPlan, Program) → proof veto + structured
                    feedback; the engine core the Claude Code skill calls
  lang/             AST types (generated), shape validator, typechecker
  agents/           Architect + Generator LLM phases (prompt mode)
  solve/            EWD-lang → Z3 terms, verification, Node worker + runner
  emit/             AST → runnable TypeScript
  report/           pretty-printer + Dijkstra Dashboard
  generated/        mjst output (checked in)
test/               bun test suites + fixtures
.claude/skills/vector/
  SKILL.md          the skill: the Architect→Generator→verify→repair loop
  reference/
    ewd-lang.md     the EWD-lang manual Claude reads before emitting artifacts
```

---

## Architecture notes

**Why a Node subprocess.** `z3-solver` is Z3 compiled to WASM with Emscripten
pthreads; its worker pool aborts under Bun. So the solver stage runs in a Node
subprocess (`src/solve/node-worker.ts`) that talks JSON over stdio, and
`src/solve/runner.ts` is the *only* file that knows this. Swapping in a different
verifier backend (a Dafny/Verus CLI, or in-process Z3 once Bun supports it)
would touch only `runner.ts`.

**Where the veto lives.** `src/verify.ts` is the deterministic core shared by
both entry points: shape → typecheck → `checkAxiomTraceability` → Z3, returning
the discriminated `VerifyOutcome`. `pipeline.ts` (prompt mode) re-exports its
`checkAxiomTraceability` and reuses its feedback formatter, so the two paths can
never disagree about what "proven" means.

---

## Develop

```bash
bun test                 # unit + solver + verify + pipeline suites
bun run typecheck        # tsc --noEmit
bun run lint             # biome
bun run format           # biome --write
bun run generate:schemas # regenerate parsers after editing schemas/
```

The test suites cover the shape validator, typechecker, emitter, the solver, the
`verify.ts` gate (PROVEN / REFUTED / INVALID paths), and the full prompt-mode
retry loop with the LLM agents mocked and the real solver subprocess.

---

## Limitations

vector verifies exactly the fragment Z3 can decide, and no more:

- **In scope:** `Real` / `Int` / `Bool`, arithmetic, comparisons, boolean logic,
  if-then-else, and layered calls. Money, rates, thresholds, clamping, rounding,
  bounds checks.
- **Out of scope:** strings, arrays, IO, loops, recursion, state, data
  structures. If a request needs those, vector can still formalize and prove its
  **numeric core** — but the rest isn't verified and shouldn't be forced through.
- **Nonlinearity:** multiplying two variables can make Z3 answer `unknown`
  (undecided, not proven). Restate in linear arithmetic where possible.
- **Reals vs. float64:** proofs are over exact rationals; emitted JS runs
  `float64`, so extreme magnitudes may round.
```
