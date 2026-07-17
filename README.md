# vector — formally verified functions from a prompt

Turn a casual natural-language request into a **formally verified** TypeScript
program. Inspired by Dijkstra's EWD249 — *"testing can show the presence of
bugs, but never their absence"* — vector never treats generated code as a black
box: an SMT solver (Z3) **proves** every postcondition holds for **all** inputs
before a single line of code is emitted. If a contract can't be proven, the code
is withheld.

```
prompt ─▶ Architect ─▶ formal axioms + a layered decomposition   (the SpecPlan)
       ─▶ Generator ─▶ program + contracts in "vector-lang"          (the Program)
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
  - [Diff mode (the regeneration gate)](#diff-mode-the-regeneration-gate)
  - [Flags](#flags)
- [Standalone binary](#standalone-binary)
- [The Claude Code skill](#the-claude-code-skill)
- [vector-lang reference](#vector-lang-reference)
- [The two artifacts](#the-two-artifacts)
- [Verify output (the JSON contract)](#verify-output-the-json-contract)
- [Contract-driven development (code as build artifact)](#contract-driven-development-code-as-build-artifact)
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
| Entry point | `vector "<prompt>"` | you just ask, in natural language |
| Retry loop | inside `pipeline.ts` | Claude repairs in-context, re-verifying |
| Engine's job | the whole pipeline | the deterministic **veto** only (`vector --verify`) |
| Best for | standalone / CI with a key | working inside Claude Code |

Both guarantee the same invariant: **code is presented only when Z3 has proven
every postcondition.**

---

## Install & requirements

```bash
bun install
bun run fetch-z3    # puts a native z3 into .z3/ (see below)
```

- [**Bun**](https://bun.sh) — runs the `vector` CLI and the test suite.
- **A native `z3`** — the solver. `bun run fetch-z3` fetches a version-matched
  one into `.z3/` (via pip; needs Python). Alternatively set `$VECTOR_Z3` to a
  `z3` binary or put one on `PATH`. The compiled binary bundles its own, so it
  needs none of this (see [Architecture notes](#architecture-notes)). No Node
  required anywhere.
- **`ANTHROPIC_API_KEY`** — only for *prompt mode*. Put it in `.env` (see
  `.env.example`) or the environment. The verify/fixture paths and the Claude
  Code skill need **no** key.

---

## CLI usage

The `vector` bin has four modes.

### Prompt mode (full pipeline)

Needs `ANTHROPIC_API_KEY`. vector calls the model as Architect then Generator,
verifies, and retries on counterexamples.

```bash
bun run vector "Build a USD to EUR converter that throws an error if the amount is negative"
```

Phases printed as it runs:

```
[1/5] Spec extraction ...... 5 axiom(s): AX1 (pre), AX2 (post), ...
[2/5] Decomposition ........ 2 layer(s): applyRate → usdToEur
[3/5] Generative logic ..... attempt 1/3
[4/5] Deterministic solver . Z3 4.16.0 (native) · 3 VCs · 3 unsat · 0 sat · 0 unknown · 170 ms
[5/5] Report ............... PROVEN
```

### Verify mode (deterministic, no API key)

Verify a **SpecPlan + Program** pair that some *other* agent produced — inside
Claude Code, that agent is Claude Code itself. This is the deterministic veto
only: shape → typecheck → axiom traceability → Z3. No credentials.

```bash
# structured JSON (what the skill consumes)
bun run vector --verify test/fixtures/currency-spec.json test/fixtures/currency.json --json

# human dashboard + write the proven TypeScript out
bun run vector --verify test/fixtures/currency-spec.json test/fixtures/currency.json --emit converter.ts
```

`--verify` takes two positional paths — the spec plan first, the program second.
(Equivalent explicit form: `--spec <file> --program <file>`.)

Exit code is `0` only when the status is `PROVEN`, `1` otherwise — usable as a CI
gate.

### Fixture mode

Verify a hand-written Program alone (no spec plan, so no traceability check).
Handy for iterating on vector-lang by hand.

```bash
bun run vector -- --fixture test/fixtures/currency.json
```

### Diff mode (the regeneration gate)

Prove that a **new generation** of a program preserves the old generation's
observable behavior — or get the concrete input/output deltas where it
doesn't. See [Contract-driven development](#contract-driven-development-code-as-build-artifact)
for why this exists.

```bash
bun run vector --diff old-program.json new-program.json
```

```
── VECTOR DIFF ─────────────────────────────────────────
 old: usd_to_eur_converter   new: usd_to_eur_converter
 Status: DIFFERENT

 ✓ applyRate(amount: Real, rate: Real): Real — EQUIVALENT for all inputs
 ✘ usdToEur(amount: Real): Real — BEHAVIOR DIFFERS
     value:  at amount = 100 → old = 91, new = 92
```

Functions are matched by name; a pair is comparable when its positional param
types and return type agree (param renames are noted, not flagged). Per pair,
Z3 decides three questions, each **for all inputs**:

- **value** — on the shared valid domain, can the two bodies ever disagree?
- **domain narrowed** — is any input the old version accepted now rejected?
- **domain widened** — is any input the old version rejected now accepted?

`ensures` clauses are proof-only, so rewording a contract never registers as a
behavioral difference (it is still listed textually for review). A **removed**
function or a **changed signature** counts as a difference; an **added**
function is informational.

Status → exit code: `EQUIVALENT` → `0`, `DIFFERENT` / `UNDECIDED` → `1`,
invalid input or solver failure → `2`. Both sides are assumed to individually
pass `--verify` first (gate on that in CI); `--diff` re-runs only shape and
type checks.

### Flags

| Flag | Modes | Meaning |
|---|---|---|
| `--verify <spec> <program>` | verify | Verify a spec-plan + program pair. |
| `--spec <file>` / `--program <file>` | verify | Explicit form of the two `--verify` paths. |
| `--diff <old> <new>` | diff | Prove a regeneration behavior-preserving, or show the deltas. |
| `--fixture <file>` | fixture | Verify a lone Program JSON. |
| `--max-retries N` | prompt | Generator repair attempts (default `3`). |
| `--json` | all | Emit machine-readable JSON instead of the dashboard. |
| `--emit <file>` | prompt/verify/fixture | Write the proven TypeScript to a file (only when PROVEN). |

> Note: because `vector` is an npm script, `bun run vector --flag` passes `--flag`
> straight through. The `--` in `bun run vector -- --fixture …` is optional but
> harmless.

---

## Standalone binary

To use vector **outside this repo** — on your `PATH`, in CI, or in another
project — compile it to a single executable:

```bash
bun run build      # → dist/vector
```

`dist/vector` bundles the CLI, the engine, and a native `z3` solver into one
file. It needs **nothing on `PATH`** — no Node, no separate z3 install, no `bun
install`, no repo checkout, no `ANTHROPIC_API_KEY` for the verify/fixture paths.
Drop it anywhere and run it:

```bash
./dist/vector --verify spec.json program.json --json
./dist/vector --fixture program.json
./dist/vector "Build a USD to EUR converter that throws if the amount is negative"
```

The build needs a native z3 in `.z3/` first (`bun run fetch-z3`).

How it's built (`scripts/build-binary.ts`): because `bun build --compile`
already emits a platform-specific executable, we embed a matching native z3 (the
`z3` binary + its shared library) as a tarball. On first solve the binary
extracts it once to a content-addressed cache under the system temp dir (reused
on subsequent runs) and runs z3 from there.

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

**What happens under the hood** (`SKILL.md` + `reference/vector-lang.md`):

1. Claude Code, as **Architect**, writes a `SpecPlan` JSON conforming to
   `schemas/spec-plan.json`.
2. Claude Code, as **Generator**, writes a `Program` JSON conforming to
   `schemas/program.json`.
3. It runs `vector --verify spec.json program.json --json` — the deterministic
   veto.
4. On `REFUTED` / `UNKNOWN` / `INVALID` it reads the structured `feedback` /
   `items`, repairs the **program** minimally (keeping every clause that already
   proved), and re-verifies — up to ~4 attempts.
5. It shows you the dashboard and the proven TypeScript **only** when the status
   is `PROVEN`.

The schemas remain the single source of truth — the skill points Claude at
`schemas/*.json` directly rather than keeping copies that could drift. The
nested-API pipeline (`vector "<prompt>"`) stays available for standalone/CI use.

---

## vector-lang reference

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
| `unop` | `op`, `arg` | `not` (Bool→Bool), `neg`/`abs` (numeric→same), `floor`/`ceil` (Real→Real, integer-valued but stays Real). |
| `binop` | `op`, `left`, `right` | `+ - * /`, `min`/`max`, `< <= > >= == != and or implies`. `min`/`max` render as `Math.min`/`Math.max`. |
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

**Division:** `/` requires **`Real`** operands and yields `Real` — JS `/` is
float64 division (`3/2 === 1.5`), so an `Int`-typed quotient would be unsound.
For discrete rounding use `floor`/`ceil` instead. Z3 proves the denominator is
nonzero on every reachable path; guard every `/` with a `requires`
(`denominator != 0`) or an `ite`; an unguarded division that could be zero is
reported as a *division hazard*.

**What "PROVEN" now guarantees.** Beyond proving each postcondition, the gate
enforces that the proof is *meaningful* and *survives execution*:

- **Non-vacuity.** The precondition region must be inhabited (Z3 checks
  `requires` are satisfiable). Contradictory `requires` — which would make every
  postcondition hold vacuously — are rejected. This gate fails closed: a Z3
  `unknown` counts as *not established*, never as a pass.
- **Non-triviality.** Every `ensures` must reference `result` and must actually
  depend on the body (Z3 checks the clause is *not* a tautology of the
  preconditions). `result == result` or a restated precondition is rejected.
  Fails closed on `unknown`, like non-vacuity.
- **Call-site preconditions.** A callee's `requires` is proven to hold for the
  actual arguments on every reachable path — not just inlined away.
- **Float64 conformance.** After the proof, the emitted code is interpreted in
  float64 over sampled boundary + random inputs (a sampling check, not a
  proof); a postcondition that is true over exact reals but false in float64
  (e.g. `(x+0.1)+0.2 == x+0.3` at `x = 0`) is reported and the code is
  withheld. The same stage simulates every callee's runtime guard, so a
  call-site precondition that float64 rounding pushes out of bounds (a proven
  `g(x*0.1)` throwing at `x = 5e-324`) also fails the gate. Prefer
  inequalities/tolerances over exact `==` on `Real` results.
- **Domain guards.** The emitted function rejects `NaN`/`Infinity` (`Real`
  params) and non-integer values (`Int` params) at runtime, so the runtime
  domain matches the finite/integer domain the proof quantified over.

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

The implementation *and* its contract, in vector-lang. (Abbreviated — see
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

Run these two together through `vector --verify` to see the whole thing prove.

---

## Verify output (the JSON contract)

`vector --verify … --json` prints a discriminated `VerifyOutcome` (defined in
`src/verify.ts`). The `status` field selects the shape:

**`PROVEN`** — carries the rendered `dashboard` and the `emittedCode`:

```jsonc
{ "status": "PROVEN", "report": { /* full VerificationReport */ },
  "dashboard": "╔════…", "emittedCode": "// Generated by vector …" }
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
                                              // | "precondition-hazard" | "vacuous"
                                              // | "trivial" | "conformance"
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

## Contract-driven development (code as build artifact)

vector supports a workflow where the **SpecPlan is the source of truth and the
generated code is ephemeral** — regenerated at will, never hand-reviewed. The
principle: *humans review intent, machines review everything else.* Z3 proves
*code ⊨ contract*; the one thing left for a human is *contract ⊨ intent*, so
the review surface for a change is the SpecPlan diff plus the behavioral
deltas below — never the code.

Two pieces make this safe:

### 1. Property-shaped axioms (keep the contract from becoming code)

An axiom is legitimate if it could appear in the ticket that requested the
feature or in a compliance doc: bounds (`result >= 0`), monotonicity, tier
behavior, conservation ("the split parts sum to the whole"), error behavior
("throws if negative"). An `ensures result == <formula>` clause is the
algorithm restated as spec — reviewing it is reviewing code by another name.

The verifier flags these as **advisory style warnings** (`styleWarnings` in
the `--verify` JSON; a `STYLE` block after the CLI dashboard). They never
block a proof: sometimes the formula *is* the requirement (a regulated fee, a
published rate). But the default posture is: keep contracts partial and
property-shaped, and let the diff gate carry the rest.

### 2. The regeneration gate (let machines carry behavioral stability)

Property-shaped contracts are deliberately partial, so two generations can
both prove yet differ on inputs the contract doesn't pin down. Rather than
fattening the contract, [`vector --diff`](#diff-mode-the-regeneration-gate)
has Z3 decide whether the old and new generations can be told apart at all:

- **EQUIVALENT** — provably identical behavior for all inputs. Zero review.
  This is the common case for pure regenerations (model upgrades, refactors).
- **DIFFERENT** — a concrete witness per delta: *"at `amount = 100`, old
  returned `91`, new returns `92`"*. A human reviews that one behavioral fact
  against the intended change — a ten-second decision, not a code review.

### The workflow

1. **SpecPlans live in git** and are reviewed like code — but at ticket
   granularity, since axioms are property-shaped. Generated `.ts` is a build
   artifact (commit it like a lockfile; nobody reads it).
2. **A feature is a SpecPlan diff.** Add axioms/units, regenerate, and let the
   traceability gate prove every axiom is enforced.
3. **CI gates every change twice:**

   ```bash
   vector --verify spec.json program.json --json   # exit 0 ⇔ PROVEN
   vector --diff prev-program.json program.json    # exit 0 ⇔ EQUIVALENT
   ```

   A `--diff` exit of `1` isn't a failure — it means the PR must explicitly
   acknowledge the listed deltas (they should match the ticket).
4. **Review surface per PR:** the SpecPlan diff + acknowledged behavior
   deltas. That's all.

What this does *not* cover: the glue code around the verified kernel (IO,
routing, persistence) is ordinary code under ordinary review, and the
call-site boundary — passing cents where the contract means dollars — is
guarded only by naming and types. Push every decision that *can* be a pure
numeric function into the kernel, and keep the glue thin.

---

## The Dijkstra Dashboard

The human-readable proof report: per-layer Hoare triples, one checkmark per
postcondition, counterexamples when a claim is refuted, and an honest note on
what's *proven* vs. *enforced at runtime*.

```
╔════════════════════════════════════════════════════════════════════╗
║                 VECTOR — PROOF REPORT               ║
╠════════════════════════════════════════════════════════════════════╣
║ Prompt:  "verify: test/fixtures/currency.json"                    ║
║ Attempt: 1/1      Solver: Z3 4.16.0 (native)      Status: PROVEN     ║
╠════════════════════════════════════════════════════════════════════╣
║ LAYER 1 · applyRate(amount: Real, rate: Real): Real                ║
║   { rate > 0 }  amount * rate                                      ║
║   { result == amount * rate }                                      ║
║   ✔ ensures AX2a  proven (unsat · 159 ms)                         ║
║   ⚠ guard rate > 0 enforced at runtime; proven to hold at every    ║
║   internal call site                                               ║
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
scripts/
  build-binary.ts   compiles the standalone `dist/vector` executable
  fetch-z3.ts       fetches a native z3 into .z3/ (source + build both use it)
src/
  cli.ts            entrypoint (the `vector` bin) — prompt / verify / fixture / diff modes
  bin.ts            compile-only entry: embeds the native z3, then runs cli.ts
  pipeline.ts       prompt mode: SPEC → GENERATE → VALIDATE → VERIFY → (retry) → REPORT
  verify.ts         deterministic (SpecPlan, Program) → proof veto + structured
                    feedback; the engine core the Claude Code skill calls
  diff.ts           the regeneration gate: old vs new program → EQUIVALENT or
                    concrete behavioral deltas
  lang/             AST types (generated), shape validator, typechecker, style lint
  agents/           Architect + Generator LLM phases (prompt mode)
  solve/            vector-lang → SMT-LIB2 (smt.ts) → native z3 → report (runner.ts);
                    equivalence checking (equiv.ts)
  emit/             AST → runnable TypeScript
  report/           pretty-printer + Dijkstra Dashboard
  generated/        mjst output (checked in)
test/               bun test suites + fixtures
.claude/skills/vector/
  SKILL.md          the skill: the Architect→Generator→verify→repair loop
  reference/
    vector-lang.md     the vector-lang manual Claude reads before emitting artifacts
```

---

## Architecture notes

**Why the native z3 CLI.** The solver stage emits an SMT-LIB2 script
(`src/solve/smt.ts`) and drives the native `z3` executable over stdin
(`src/solve/runner.ts`), parsing its textual verdicts back into a
`VerificationReport`. Those two files are the *only* ones coupled to the solver;
swapping in a different backend (a Dafny/Verus CLI) touches nothing else. z3 is
located in order: an embedded copy extracted from the compiled binary,
`$VECTOR_Z3`, the repo-local `.z3/`, or `z3` on `PATH`. (An earlier design ran
the `z3-solver` wasm build in a Node subprocess to dodge a Bun pthread abort;
the native CLI removes both the wasm and the Node dependency.)

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
bun run fetch-z3         # fetch a native z3 into .z3/ (needed by the solver)
bun run build            # compile the standalone dist/vector binary
```

The solver-backed suites need a native z3 (`bun run fetch-z3`, or `$VECTOR_Z3` /
`PATH`). They cover the shape validator, typechecker, emitter, the solver, the
`verify.ts` gate (PROVEN / REFUTED / INVALID paths), and the full prompt-mode
retry loop with the LLM agents mocked and the real z3 subprocess.

---

## Limitations

vector verifies exactly the fragment Z3 can decide, and no more:

- **In scope:** `Real` / `Int` / `Bool`, arithmetic, comparisons, boolean logic,
  `if-then-else`, `abs`/`min`/`max`/`floor`/`ceil`, and layered calls. Money,
  rates, thresholds, clamping, rounding (via `floor`), bounds checks.
- **Out of scope:** strings, arrays, IO, loops, recursion, state, data
  structures. If a request needs those, vector can still formalize and prove its
  **numeric core** — but the rest isn't verified and shouldn't be forced through.
- **Nonlinearity:** multiplying two variables can make Z3 answer `unknown`
  (undecided, not proven). Restate in linear arithmetic where possible.
- **Integer division:** `/` yields `Real` by design (JS `/` is float64
  division). For integer/discrete results use `floor`/`ceil`. A dedicated
  Euclidean `div`/`mod` is future work.
- **Reals vs. float64:** proofs are over exact rationals; emitted JS runs
  `float64`. vector no longer *assumes* this is harmless — a post-proof
  **conformance** stage fuzzes the emitted code in float64 and withholds it if a
  proven postcondition fails there or a callee's runtime guard fires on a
  contract-valid input. Exact `==`/`!=` over `Real` results is the usual
  culprit; prefer inequalities or an explicit tolerance. Fuzzing samples the
  input space — it catches the systematic rounding failures, but it is not a
  proof over float64.
- **Trust boundary:** Z3 proves *code ⊨ contract*. It cannot prove *contract ⊨
  your intent* — the displayed Hoare triples are what you should read and sign
  off on. vector makes that contract small and auditable; it does not read your
  mind.
```
