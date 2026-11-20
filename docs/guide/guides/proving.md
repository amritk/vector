# Proving a function

`vector verify` proves a program meets its spec plan, and `vector diff` proves two versions of a program equivalent. Both read JSON: the [spec plan](../../reference/formats/spec-plan.md) and the [program](../../reference/formats/program.md). [Your first proof](../getting-started/first-proof.md) walks through one; this page covers the verdicts, the flags and `diff`.

## The verdicts

`vector verify <spec.json> <program.json>` prints a proof report whose `Status` is one of:

| Status | Means | Exit |
| --- | --- | --- |
| `PROVEN` | every postcondition holds for every input the preconditions allow | 0 |
| `REFUTED` | z3 found a counterexample; the report and the feedback show it | 1 |
| `UNKNOWN` | z3 could not decide, usually for non-linear arithmetic; restate the clause with variables multiplied only by literal constants | 1 |
| `INVALID` | the files are not a well-formed spec plan and program; the problems print as `Validation failed:` | 1 |
| `ERROR` | z3 failed or rejected the script; the message prints as `Solver error: …` | 1 |
| `MISMATCH` | a counterexample z3 gave does not do what z3 said when vector replays it: a bug in vector, not in your program | 2 |

Only `PROVEN` exits 0: none of the others proved anything, so each refuses the program. Exit 2 is kept for bad usage, a file that cannot be read, an `--emit` file that cannot be written, and `MISMATCH`.

## Every counterexample is replayed

vector does not take z3's word for a counterexample. Before it reports one, it evaluates the function at that input itself, exactly and without z3: an `Int` as an integer, a `Real` as a rational with a 64-bit numerator and denominator, and a call as the verification script models it, with the callee's body inlined.

- A refuted clause is confirmed when every requires holds at the input, the body returns z3's result there, and the clause is false.
- A hazard (a division by zero, a callee's requires that fails, or an `Int` outside ±(2^53−1)) is confirmed when the input reaches it and its condition holds. The body is compared with z3's result only when the replay knows the body there: a division by zero leaves it unspecified, and that does not undo the hazard.

A counterexample that does not replay is `MISMATCH`, and the fault is vector's, not your program's. Each one is a line of the FEEDBACK block, on stdout with the rest of the report, ending with the inputs and the first check that differed:

```text
MISMATCH  z3's counterexample does not refute <fn> <axiom> (<clause>) when replayed: this is a bug in vector, not in your program — please report it (<inputs>: <detail>)
MISMATCH  z3's counterexample does not reach the hazard <fn> <hazard> when replayed: this is a bug in vector, not in your program — please report it (<inputs>: <detail>)
```

The dashboard's status is `MISMATCH`, its verdict counts the counterexamples that did not replay, and each is marked `✘ DOES NOT REPLAY (a bug in vector)`. `MISMATCH` exits 2 and `--emit` writes nothing.

`diff` replays its witnesses the same way, through both versions: a witness that does not do what z3 said is diff's `MISMATCH`, which also exits 2. See [Compare two versions](#compare-two-versions).

With `--json`, each counterexample carries `"replay"`: `confirmed`, `mismatch`, or `not-replayed`. `not-replayed` means vector could not evaluate the input exactly: z3 gave a value it cannot read (such as an irrational root), a step overflowed 64 bits, or a value depends on a division by zero, which z3 leaves unspecified. The counterexample is not checked, and the verdict stays what z3 said. A `mismatch` or `not-replayed` counterexample also carries `"replayDetail"`, the replay's reason: the first check that differed, or why the input could not be evaluated (`a value depends on a division by zero, which z3 leaves unspecified`). A `confirmed` one has none.

Files that are not a spec plan and a program are `INVALID`:

<!-- exit 1 -->
```sh
./dist/vector verify tests/fixtures/currency.json tests/fixtures/currency.json
```

```text
Validation failed:
  ✘ spec plan: spec plan: unknown property "functions"
  ✘ spec plan: axioms must be a non-empty array
  ✘ spec plan: units must be an array of 1-4 entries
```

A file that cannot be read exits 2:

<!-- exit 2 -->
```sh
./dist/vector verify missing.json tests/fixtures/currency.json
```

```text
vector: verify: missing.json: cannot read file
```

## Int arithmetic runs in float64

The proof treats an `Int` as an unbounded integer, but the emitted TypeScript
runs it as a float64, which holds every integer exactly only within
±(2^53−1). So `verify` also proves that every `Int` `+`, `-` and `*` the
emitted code evaluates, in the body or in a `requires`, stays inside that
range. An `Int` parameter is a safe integer there, since its domain guard
throws on any other. One that may leave the range is an `Int overflow`, with
an input that reaches it, and the program is `REFUTED` even when every
postcondition holds over the integers.

[`tests/fixtures/overflow.json`](https://github.com/amritk/vector/blob/main/tests/fixtures/overflow.json)
computes `high + high - high`, which equals `high`, but the sum rounds once
`high` passes 2^52:

<!-- exit 1 -->
```sh
./dist/vector verify tests/fixtures/overflow-spec.json tests/fixtures/overflow.json | grep -E "Int overflow|rounds \(e.g."
```

```text
║   ✘ Int overflow: high + high may leave ±(2^53−1), where float64   ║
║   rounds (e.g. low = 0, high = 4503599627370496)                   ║
Function spanEnd: Int overflow — high + high can leave ±(2^53−1), where float64 rounds (e.g. low = 0, high = 4503599627370496) — rewrite it so no intermediate grows past its operands, or bound the parameters with requires clauses.
```

Write it so no intermediate grows past its operands, as
[`tests/fixtures/overflow-fixed.json`](https://github.com/amritk/vector/blob/main/tests/fixtures/overflow-fixed.json)
does with `low + (high - low)`: `low >= 0` and `low <= high` keep
`high - low` between 0 and `high`, so it proves.

```sh
./dist/vector verify tests/fixtures/overflow-spec.json tests/fixtures/overflow-fixed.json | grep Status
```

```text
║ Attempt: 1/1      Solver: Z3 4.16.0 (native)      Status: PROVEN   ║
```

A hazard is checked on the path the emitted code takes to it: under an `ite`
branch's condition, under the left side of a short-circuit `and`, `or` or
`implies`, and, in a `requires`, under the `requires` before it, which the
emitted code has already checked. Division by zero is checked the same way.

## Write the proven program

`--emit <file>` writes the verified program as TypeScript, but only when it is `PROVEN`. On any other verdict it writes nothing and leaves an existing file as it was. The write goes to a temporary file beside the target, renamed over it, so a failed write never leaves half a file. The report ends by naming the file:

```sh
./dist/vector verify --emit currency.ts tests/fixtures/currency-spec.json tests/fixtures/currency.json | tail -n 1
head -n 2 currency.ts
```

```text
(written to currency.ts)
// Generated by vector from program "usd_to_eur_converter".
// Every postcondition below was proven by Z3 over exact rationals for ALL
```

## Read the result as JSON

`--json` prints the outcome as one JSON object instead of the report, with the same exit code. Its `status` is the verdict; a proven outcome also has `dashboard`, `emittedCode` and `styleWarnings`, and a refuted one `dashboard`, `feedback` and `items`:

<!-- exit 1 -->
```sh
./dist/vector verify --json tests/fixtures/unsat-spec.json tests/fixtures/unsat.json
```

```text
{
  "status": "REFUTED",
…
```

## Compare two versions

`vector diff <old.json> <new.json>` takes two programs, matches their functions by name, and proves each pair equal over the reals, then compares them on sampled float64 inputs. It assumes both versions already pass `vector verify`.

A program diffed with itself is `EQUIVALENT`, and exits 0:

```sh
./dist/vector diff tests/fixtures/currency.json tests/fixtures/currency.json
```

```text
── VECTOR DIFF ─────────────────────────────────────────
 old: usd_to_eur_converter   new: usd_to_eur_converter
 Solver: Z3 4.16.0 (native)
 Status: EQUIVALENT

 ✓ applyRate(amount: Real, rate: Real): Real — EQUIVALENT for all inputs
 ✓ usdToEur(amount: Real): Real — EQUIVALENT for all inputs

 Every shared function is proven equal over the reals and agreed
 on every sampled float64 input; nothing to review.
 (Proven over exact rationals, then compared on sampled float64 inputs;
  assumes both versions pass vector verify.)
```

[`tests/cli/diff-different/new.json`](https://github.com/amritk/vector/blob/main/tests/cli/diff-different/new.json) renames a parameter, raises the rate to 0.92 and rejects a zero amount. `diff` shows a witness for each change in behaviour, and every contract clause added or removed, and exits 1:

<!-- exit 1 -->
```sh
./dist/vector diff tests/fixtures/currency.json tests/cli/diff-different/new.json
```

```text
── VECTOR DIFF ─────────────────────────────────────────
 old: usd_to_eur_converter   new: usd_to_eur_converter
 Solver: Z3 4.16.0 (native)
 Status: DIFFERENT

 ✓ applyRate(value: Real, rate: Real): Real — EQUIVALENT for all inputs
     note:   param renamed amount → value
     contract: + ensures result == value * rate
     contract: − ensures result == amount * rate
 ✘ usdToEur(amount: Real): Real — BEHAVIOR DIFFERS
     value:  at amount = 100 → old = 91, new = 92
     domain: amount = 0 was accepted, now REJECTED
     contract: + requires amount > 0
     contract: − requires amount >= 0
     contract: + ensures result == amount * 0.92
     contract: − ensures result == amount * 0.91

 Review each listed delta against the change you intended —
 the witnesses above are the entire behavioral change.
 (Proven over exact rationals, then compared on sampled float64 inputs;
  assumes both versions pass vector verify.)
```

| Status | Means | Exit |
| --- | --- | --- |
| `EQUIVALENT` | every shared function is proven equal and agreed on every sampled input | 0 |
| `DIFFERENT` | some function behaves differently; the witnesses are the whole change | 1 |
| `UNDECIDED` | some function was neither proven equal nor shown different | 1 |
| `INVALID` | a file is not a program | 2 |
| `ERROR` | z3 failed | 2 |
| `MISMATCH` | a witness z3 gave does not do what z3 said when replayed through both versions: a bug in vector | 2 |

Unlike `verify`, `diff` exits 2 for `INVALID` and `ERROR`: nothing was compared. Every witness is replayed through both versions exactly, as `verify` replays a counterexample, and one whose versions turn out to agree there is `MISMATCH`; with `--json` each witness carries `"replay"`, and a `mismatch` or `not-replayed` one `"replayDetail"` beside it, as in `verify`. `--json` prints the outcome as JSON here too.

The [`vector verify`](../../reference/command-line/verify.md) and [`vector diff`](../../reference/command-line/diff.md) references list every flag.
