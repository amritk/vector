# Your first proof

`vector verify` takes two JSON files: a spec plan, which states what a program must do, and the program. It proves that every function meets its contract for every input, or shows an input on which it does not.

## The spec plan

A spec plan names the program, states its requirements in plain words as axioms, and breaks it into units. The repository has one for a currency converter, [tests/fixtures/currency-spec.json](https://github.com/amritk/vector/blob/main/tests/fixtures/currency-spec.json):

```json
{
  "programName": "usd_to_eur_converter",
  "axioms": [
    { "id": "AX1", "kind": "pre", "statement": "The USD amount must be non-negative (throws if amount < 0)." },
    { "id": "AX2", "kind": "post", "statement": "For all amount >= 0, the result equals amount times 0.91." },
    { "id": "AX3", "kind": "post", "statement": "The result is non-negative." },
    { "id": "AX-RATE", "kind": "pre", "statement": "The exchange rate applied must be strictly positive." },
    { "id": "AX2a", "kind": "post", "statement": "Applying a rate to an amount yields amount times rate." }
  ],
  "units": ["… two units, applyRate and usdToEur …"]
}
```

Each axiom is a precondition (`pre`) or a postcondition (`post`). The [spec-plan format](../../reference/formats/spec-plan.md) lists every field.

## The program

The program, [tests/fixtures/currency.json](https://github.com/amritk/vector/blob/main/tests/fixtures/currency.json), implements each unit as a function whose `requires` and `ensures` clauses are expressions tied to the axioms they encode. The [program format](../../reference/formats/program.md) lists every field.

## Verify it

```sh
./dist/vector verify tests/fixtures/currency-spec.json tests/fixtures/currency.json
```

vector hands each clause to z3 and prints a proof report. Here every postcondition is proved, and it exits 0:

```text
╔════════════════════════════════════════════════════════════════════╗
║                        VECTOR — PROOF REPORT                       ║
╠════════════════════════════════════════════════════════════════════╣
║ Prompt:  "verify: tests/fixtures/currency.json"                    ║
║ Attempt: 1/1      Solver: Z3 4.16.0 (native)      Status: PROVEN   ║
╠════════════════════════════════════════════════════════════════════╣
║ LAYER 1 · applyRate(amount: Real, rate: Real): Real                ║
║   { rate > 0 }  amount * rate                                      ║
║   { result == amount * rate }                                      ║
║   ✔ ensures AX2a  proven (unsat, ∀ inputs)                         ║
║   ⚠ guard rate > 0 enforced at runtime; proven to hold at every    ║
║   internal call site                                               ║
╟────────────────────────────────────────────────────────────────────╢
║ LAYER 2 · usdToEur(amount: Real): Real                             ║
║   { amount >= 0 }  applyRate(amount, 0.91)                         ║
║   { result == amount * 0.91  ∧  result >= 0 }                      ║
║   ✔ ensures AX2  proven (unsat, ∀ inputs)                          ║
║   ✔ ensures AX3  proven (unsat, ∀ inputs)                          ║
║   ⚠ guard amount >= 0 enforced at runtime; proven to hold at every ║
║   internal call site                                               ║
╠════════════════════════════════════════════════════════════════════╣
║ VERDICT: ALL POSTCONDITIONS PROVEN FOR ALL INPUTS                  ║
║ "Testing shows the presence of bugs, never their absence."         ║
║  — proven over exact reals; float64 conformance-checked.           ║
╚════════════════════════════════════════════════════════════════════╝
```

Below the report it prints style advice, which does not affect the proof, and the verified program as TypeScript. `--json` prints the result as JSON instead, and `--emit <file>` writes the TypeScript to a file when the program is proved.

## See a refusal

[tests/fixtures/unsat.json](https://github.com/amritk/vector/blob/main/tests/fixtures/unsat.json) claims its result is greater than the amount, which fails at 0. Verify it against its plan, [tests/fixtures/unsat-spec.json](https://github.com/amritk/vector/blob/main/tests/fixtures/unsat-spec.json):

```sh
./dist/vector verify tests/fixtures/unsat-spec.json tests/fixtures/unsat.json
```

vector shows the counterexample and exits 1:

```text
╔════════════════════════════════════════════════════════════════════╗
║                        VECTOR — PROOF REPORT                       ║
╠════════════════════════════════════════════════════════════════════╣
║ Prompt:  "verify: tests/fixtures/unsat.json"                       ║
║ Attempt: 1/1      Solver: Z3 4.16.0 (native)      Status: REFUTED  ║
╠════════════════════════════════════════════════════════════════════╣
║ LAYER 1 · usdToEur(amount: Real): Real                             ║
║   { amount >= 0 }  amount * 0.91                                   ║
║   { result > amount }                                              ║
║   ✘ ensures AX-BAD  REFUTED (sat)                                  ║
║       counterexample: amount = 0 → result = 0                      ║
║   ⚠ guard amount >= 0 enforced at runtime; proven to hold at every ║
║   internal call site                                               ║
╠════════════════════════════════════════════════════════════════════╣
║ VERDICT: 1 CONTRACT VIOLATION(S) FOUND — SEE ABOVE                 ║
║ "Testing shows the presence of bugs, never their absence."         ║
╚════════════════════════════════════════════════════════════════════╝

── FEEDBACK (repair and re-verify) ────────────────────

Function usdToEur, ensures AX-BAD (result > amount): REFUTED — counterexample amount = 0 gives result = 0.
```

The [`vector verify` reference](../../reference/command-line/verify.md) lists its flags.
