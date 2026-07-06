# vector — EWD-1 Dijkstra Engine

A CLI that turns a casual natural-language prompt into a **formally verified**
TypeScript program. Inspired by Dijkstra's EWD249 — *"testing can show the
presence of bugs, but never their absence"* — vector never treats generated code
as a black box: an SMT solver proves every postcondition holds for **all** inputs
before a single line is emitted.

```
prompt ──▶ Architect (LLM)  ──▶ formal axioms + layered decomposition
        └▶ Generator (LLM)  ──▶ program + contracts in "EWD-lang" (a tiny JSON AST)
        └▶ Z3 (deterministic)──▶ proves / refutes each contract for all inputs
        └▶ emit              ──▶ runnable TypeScript + a "Dijkstra Dashboard"
```

The LLM only ever *proposes* a structured artifact; a theorem prover holds the
veto. If Z3 finds a counterexample it is fed back to the generator and the program
is regenerated, up to a retry bound. Unproven code is never emitted.

## Install

```bash
bun install
```

Requires [Bun](https://bun.sh) for the CLI/tests and Node ≥ 22.18 on `PATH` for
the solver stage (see *Architecture* below). No `ANTHROPIC_API_KEY` is needed for
the fixture/solver path; the two LLM phases require one.

## Usage

Full pipeline (needs `ANTHROPIC_API_KEY` in `.env` or the environment):

```bash
bun run ewd "Build a USD to EUR converter that throws an error if the amount is negative"
```

Solver-only, no API key — verify a hand-written EWD-lang program:

```bash
bun run ewd -- --fixture test/fixtures/currency.json
```

Flags: `--max-retries N` (default 3), `--json` (dump spec/program/report),
`--emit <file>` (write the proven TypeScript).

Example dashboard:

```
╔════════════════════════════════════════════════════════════════════╗
║                 EWD-1 DIJKSTRA ENGINE — PROOF REPORT               ║
╠════════════════════════════════════════════════════════════════════╣
║ LAYER 2 · usdToEur(amount: Real): Real                             ║
║   { amount >= 0 }  applyRate(amount, 0.91)                         ║
║   { result == amount * 0.91  ∧  result >= 0 }                      ║
║   ✔ ensures AX2  proven      ✔ ensures AX3  proven                 ║
╠════════════════════════════════════════════════════════════════════╣
║ VERDICT: ALL POSTCONDITIONS PROVEN FOR ALL INPUTS                  ║
╚════════════════════════════════════════════════════════════════════╝
```

## EWD-lang

Programs are a small restricted JSON AST — arithmetic, comparisons, boolean
logic, if-then-else, and calls into strictly lower layers (Dijkstra's step-wise
composition). Each function carries `requires`/`ensures` clauses tied back to the
spec's axioms. Numeric literals are decimal **strings** (`"0.91"`) so they reach
Z3 as exact rationals; proofs hold over exact reals, while emitted JS runs float64
(the dashboard and emitted code both carry this footnote). `"throws if X"` becomes
a precondition of `NOT X`, materialized as a runtime guard in the emitted code.

## Schema-driven types

`schemas/*.json` is the single source of truth. The same JSON Schemas both
constrain the LLM's structured output **and** generate the TypeScript
types/parsers via [`@amritk/mjst`](https://www.npmjs.com/package/@amritk/mjst):

```bash
bun run generate:schemas    # → src/generated/ (checked in, never hand-edited)
```

`src/lang/shape.ts` is a deep structural validator owned by the engine; it returns
the full list of problems (the generated parsers throw on the first) and is what
feeds the generator's repair loop.

## Layout

```
schemas/            JSON Schemas — source of truth for types + LLM output
src/
  cli.ts            entrypoint (the `ewd` bin)
  pipeline.ts       SPEC → GENERATE → VALIDATE → VERIFY → (retry) → REPORT
  lang/             AST types (generated), shape validator, typechecker
  agents/           Architect + Generator LLM phases
  solve/            EWD-lang → Z3 terms, verification, Node worker + runner
  emit/             AST → runnable TypeScript
  report/           pretty-printer + Dijkstra Dashboard
  generated/        mjst output (checked in)
test/               bun test suites + fixtures
```

## Architecture note — why a Node subprocess

`z3-solver` is Z3 compiled to WASM with Emscripten pthreads. Its worker pool
aborts under Bun, so the solver stage runs in a Node subprocess
(`src/solve/node-worker.ts`) that talks JSON over stdio; `src/solve/runner.ts` is
the only file that knows this. Node ≥ 22.18 runs the TypeScript natively via type
stripping. Swapping in a different verifier backend (e.g. a Dafny/Verus CLI) would
touch only `runner.ts`.

## Develop

```bash
bun test                 # unit + solver + pipeline suites
bun run typecheck        # tsc --noEmit
bun run lint             # biome
bun run generate:schemas # regenerate parsers after editing schemas/
```
