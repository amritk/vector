# Using vector: the rules card

This is what an agent needs before it runs vector, stated as rules, traps
first. It is a digest, not the authority: the [guide](guide/index.md) shows
every command with its output, and the [command-line
reference](reference/command-line.md) lists the commands, flags and exit
codes. Where this page disagrees, they win.

vector does two things, and no model is involved in either:

- **`verify` and `diff`** prove a small numeric program (a spec plan plus a
  program, both JSON) with z3, then emit it as TypeScript. The loop is in the
  [`vector` skill](../.claude/skills/vector/SKILL.md).
- **`spec …`** turns a spec or an RFC into a contract, emits a test from the
  contract, runs it, and gates a spec-first PR. The loop is in the
  [`vector-spec` skill](../.claude/skills/vector-spec/SKILL.md).

## Traps

1. **Read the exit status, never a piped tail.** `vector … | tail` exits
   with `tail`'s status, 0. Run it bare, or check `$?` or `PIPESTATUS`.
2. **Only `PROVEN` passes `verify`.** `REFUTED`, `UNKNOWN`, `INVALID` and
   `ERROR` all exit 1. Exit 2 is bad usage, an unreadable file, an `--emit`
   file that cannot be written, or `MISMATCH`: a counterexample that did not
   replay, a bug in vector and not a refusal. Never present code from a run
   that was not `PROVEN`. See
   [Proving a function](guide/guides/proving.md#the-verdicts).
3. **`diff` exits 2 for `INVALID` and `ERROR`**, not 1 as `verify` does.
   Like `verify`, it exits 2 for `MISMATCH`, a witness that did not replay.
   `EQUIVALENT` exits 0, and `DIFFERENT` and `UNDECIDED` exit 1. Do not
   report `UNDECIDED` as equivalent. See
   [Exit codes](guide/guides/exit-codes.md#by-command).
4. **The proof is over exact rationals, and an `Int` is unbounded there.**
   The emitted code runs in float64. A float64 gate samples boundary, dense
   and random inputs, and anything it finds makes the run `REFUTED`. It
   samples float64 and proves nothing about it, so prefer inequalities to an
   exact `==` on `Real`.
5. **An `Int` `+`, `-` or `*` that may leave ±(2^53−1) is an `Int overflow`,
   and the run is `REFUTED`**, even when every postcondition holds over the
   integers. Write it so no intermediate grows past its operands, such as
   `low + (high - low)`, or bound the parameters with `requires`. See
   [Int arithmetic runs in float64](guide/guides/proving.md#int-arithmetic-runs-in-float64).
6. **`UNKNOWN` usually means the arithmetic is non-linear.** Multiply
   variables only by literal constants, and restate the clause.
7. **A trivial `ensures`, one that holds whatever the body does, fails.** So
   do contradictory `requires`, which make the proof vacuous. Restate the
   clause as a real constraint on `result`. Remove a contradictory
   `requires`; never add more.
8. **A hazard is checked on the path the emitted code takes.** An `ite`
   branch, the right side of a short-circuit `and`, `or` or `implies`, and
   each `requires` after the first lean only on what was checked before them.
   So `x != 0 and 1 / x > 0` is safe, and `1 / x > 0 and x != 0` is a
   division hazard.
9. **`--emit` writes only on `PROVEN`.** On any other verdict it writes
   nothing and leaves an existing file alone.
10. **`spec run` `SATISFIED` is evidence, not proof.** The implementation
   returned the printed vectors and held the properties at their samples.
   `spec mutate` finds the bugs the contract cannot tell from the real
   code. See [What a pass means](guide/guides/testing.md#what-a-pass-means).
11. **Never hand-edit a generated file.** `spec extract` writes
   `contracts/*.json`, `scripts/build-spec.sh` builds `specs/*.xml` from
   `specs/*.md`, and `spec emit` writes the test. Change the source and
   rerun the generator.
12. **`spec frozen` refuses a change that touches both sides**, unless it only
   renames a contracted export. The spec side is `specs/`, `contracts/`,
   `rfcs/`, `.refcache/` and generated tests. Land the spec first, then the code. See
   [frozen](guide/guides/pr-gates.md#frozen).

## Rules

- **Exit codes.** A command exits 0 when the check passed, 1 when it
  refused the input, and 2 when it could not run or on `MISMATCH`, except
  that `diff` also exits 2 for `INVALID` and `ERROR`. See
  [Exit codes](guide/guides/exit-codes.md#by-command).
- **z3.** vector finds z3 at `$VECTOR_Z3`, then at `.z3/z3` in the
  checkout the binary was built from, then on `PATH`. See [Finding z3](guide/guides/exit-codes.md#finding-z3).
- **The files.** A spec plan holds the axioms and the units, and a program
  holds one expression per unit, with `requires` and `ensures` clauses. Each
  clause is tagged with the axiom it enforces, and every axiom must be
  enforced. Their shapes are in [File formats](guide/guides/file-formats.md),
  [spec plan](reference/formats/spec-plan.md) and
  [program](reference/formats/program.md).
- **The repair loop.** Read `feedback` and `items[]`, and change only what
  was refuted. Keep every clause that proved. Fix the program, not the spec,
  unless the spec misread the request. Give up after about four attempts and
  report the last feedback. Never edit vector to make a proof pass. A
  `MISMATCH` is a bug in vector: report it, change nothing.
- **A contract's gates.** `spec check` runs shape, fidelity, completeness,
  provenance, coverage, typing, signatures and domain. Quotes are in their
  section, MUST and SHALL are tested or excluded, and a value is whole and
  named. See [The gates](guide/guides/spec-to-contract.md#the-gates).
- **Module paths.** Two or more `/`-split segments, each
  `[a-z][a-z0-9_]*(-[a-z0-9][a-z0-9_]*)*`. See [Modules and names](guide/guides/writing-a-spec.md#modules-and-names).
- **A spec-first PR** is gated by `spec frozen`, `spec stale`,
  `spec exports` and `spec mutate`, in that order. See
  [Gating a spec-first PR](guide/guides/pr-gates.md#the-workflow-in-order).

## Known limits

- `verify` handles 1 to 4 layered functions over `Real`, `Int` and `Bool`.
  Its expressions are numbers, booleans, variables, unary and binary
  operators, `ite`, and calls.
- A function calls only those layered below it: no recursion.
- Strings, arrays, IO, loops, state and data structures do not fit. Offer to
  verify the numeric core alone.
- The typing gate does not yet check a property that holds or calls word
  arrays. Give those as vectors instead.
