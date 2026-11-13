# Your first proof

`vector verify` takes two JSON files: a spec plan, which states what a program must do, and the program. It proves that every function meets its contract for every input, or shows an input on which it does not.

## The spec plan

A spec plan names the program, lists its axioms, the requirements in plain words, and breaks it into units. The repository has one for a currency converter, [tests/fixtures/currency-spec.json](https://github.com/amritk/vector/blob/main/tests/fixtures/currency-spec.json):

```json
{
  "programName": "usd_to_eur_converter",
  "axioms": [
    { "id": "AX1", "kind": "pre", "statement": "The USD amount must be non-negative (throws if amount < 0)." },
    { "id": "AX2", "kind": "post", "statement": "For all amount >= 0, the result equals amount times 0.91." },
    { "id": "AX3", "kind": "post", "statement": "The result is non-negative." }
  ],
  "units": ["…"]
}
```

Each axiom is a precondition (`pre`) or a postcondition (`post`). The [spec-plan format](../../reference/formats/spec-plan.md) lists every field.

## The program

The program, [tests/fixtures/currency.json](https://github.com/amritk/vector/blob/main/tests/fixtures/currency.json), implements each unit as a function whose `requires` and `ensures` clauses are expressions tied to the axioms they encode. The [program format](../../reference/formats/program.md) lists every field.

## Verify it

```sh
./dist/vector verify tests/fixtures/currency-spec.json tests/fixtures/currency.json
```

vector hands each clause to z3. It exits 0 when every postcondition is proved, and 1 with a counterexample when one is not. `--json` prints the result as JSON, and `--emit <file>` writes the verified program's TypeScript to a file. [tests/fixtures/unsat.json](https://github.com/amritk/vector/blob/main/tests/fixtures/unsat.json) is a program that fails its plan, to see a refusal.

The [`vector verify` reference](../../reference/command-line/verify.md) lists its flags.
