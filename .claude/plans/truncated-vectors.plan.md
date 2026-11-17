---
name: Truncated vector rows (RFC 4231 test case 5)
overview: Add a Truncate paragraph that makes a vector row's Expected value the first N bytes of the result, recorded in the contract, checked by fidelity against the cited section, and emitted as a length-guarded prefix comparison in every target language — so nish can hold RFC 4231 test case 5 as vector rows.
stages:
  - id: truncate-rows
    title: "feat(spec): hold a truncated result to a vector row with a Truncate paragraph"
    goal: A spec can write RFC 4231 test case 5 as three vector rows plus Truncate paragraphs, and vector extracts, checks, emits and runs them as a check on the first 16 bytes.
    verification: npm run build && node tests/run.mjs spec && node tests/run.mjs cli && node tests/run.mjs guide && npm run lint && npm run tested-exports && npm run dogfood
    todos:
      - id: tr-repro
        content: Reproduce on the base — a TC5 row passes spec check but fails spec run on the whole 32-byte tag — as a failing test first — see Reproduce
      - id: tr-profile
        content: Parse the Truncate paragraph in src/spec/profile/profile.ts beside Iterate, with every refusal listed — see Syntax and refusals
      - id: tr-contract
        content: Add the truncate field to the vector clause in src/spec/contract (types, read, write, shape) and schemas/rfc-contract.json — see Contract
      - id: tr-gates
        content: Gate it in src/spec/gates (typing and fidelity) so the length is printed in the cited section and matches the Expected bytes — see Gates
      - id: tr-emit
        content: Emit a length-guarded prefix comparison in src/spec/emit for nish, typescript, python, rust and go, and show the truncation in reports — see Emit and run
      - id: tr-tests
        content: Add table-driven tests (profile, contract round trip, fidelity, typing, each emitter, an end-to-end run) and a golden or fixture for the RFC 4231 case — see Tests
      - id: tr-docs
        content: Document it in docs/guide/guides/writing-a-spec.md and the vector-spec skill, and regenerate docs/reference — see Docs
---

## Stage: truncate-rows

**Owns:** `src/spec/**`, `src/cli/spec-*.ts`, `schemas/rfc-contract.json`, `tests/spec/**`, `tests/fixtures/**`, `tests/cli/**`, `tests/guide/**`, `docs/guide/**`, `docs/reference/**`, `scalar.config.json`, `.claude/skills/vector-spec/SKILL.md`

One stage: the syntax, contract field, gates and emitters are a chain (each consumes the one before), together one PR's worth, so splitting them buys no parallelism.

## Context

RFC 4231 §4.6 (Test Case 5, "Test with a truncation of output to 128 bits") prints only the first 16 bytes of each HMAC. vector 0.3.1 compares a vector row's Expected value with the function's whole return value, so the row is accepted by `spec check` (the 16 bytes are a whole printed value in §4.6) but the emitted test fails on the real 32-byte tag. Reproduced on the base against nish's std (`vector spec run`):

```
FAIL  [TC5-256] RFC 4231 test case 5, HMAC-SHA-256 (R-HMAC-SHA256, R-TRUNC)
      expected "a3b6167473100ee06e0c796c2955552b", got "a3b6167473100ee06e0c796c2955552bfa6f7c0a6a8aef8b93f860aab0cd20c5"
```

nish (amritk/nish `specs/rfc4231-hmac-sha2.md`) works around it with `P-TRUNC-256/384/512` properties over `.slice(0, n)` with `n` pinned to 16..16. The vector-spec skill says the same: "A truncated result … still cannot be compared."

## Approach

Follow the `Iterate:` precedent ([writing-a-spec.md § Iterations](../../docs/guide/guides/writing-a-spec.md)): a per-row paragraph in the run directly after the vector table, mixed freely with `Tolerance:` and `Iterate:` paragraphs. It keeps the Call and Expected cells one code span each, keeps the row grammar unchanged, and records the length explicitly rather than inferring it from the Expected value — so a row cannot pass on arbitrary output, and fidelity can check the length against the RFC text the same way it checks an iteration count.

```md
Truncate: TC5-256 to 128 bits

Truncate: TC5-384 to 128 bits
```

## Reproduce

Before changing anything, add the failing test: a fixture spec (a cut of RFC 4231 §4.6 in `tests/fixtures/`, the pattern of `tests/fixtures/profile/rfc7748.txt`) whose TC5 row plus `Truncate:` paragraph is refused today (an unknown paragraph after the table) and is extracted with the truncation once the change lands.

## Syntax and refusals

`Truncate: <id> to <N> bits` or `Truncate: <id> to <N> bytes`.

- N is a whole number in digits, ≥ 1; for `bits` a multiple of 8. `0`, `-1`, `01`, `1e3`, `12 bits`, a missing unit, a missing `to` are refused at the paragraph's line.
- The id names a row of the vector table; a row is truncated once at most.
- A truncated row's function returns `u8[]`, and its Expected is bytes (hex, labelled bytes or `concat`) — `null`, `true`, `false`, a string, an integer and an `f64` are refused.
- **The Expected value holds exactly N bytes.** Longer than N is refused (it cannot be a prefix of an N-byte truncation); shorter is refused too.
- A row is not both truncated and iterated, and a truncated row has no tolerance.
- A `Truncate:` paragraph anywhere else, or after a table that is not the vector table, is refused, as `Iterate:` is.

## Contract

The vector clause gains `truncate`: the length in bytes (the paragraph's bits ÷ 8), plus the unit and number as written so fidelity and reports can quote them. Absent means the whole result. Read, write and the shape gate round-trip it; `schemas/rfc-contract.json` documents it. A contract with `truncate` ≤ 0, or not equal to the Expected byte length, is refused by `spec check`'s shape gate, so a hand-edited contract cannot bypass the extract-time refusal.

## Gates

- **Fidelity:** the Expected bytes are still a whole printed value of the cited section (unchanged rule — a prefix of a longer printed value is still refused). In addition, the truncation length must be printed in the cited section as `<N> bits` or `<N> bytes` in the paragraph's unit (§4.6 prints "truncation of output to 128 bits"), on a line that is not a heading. A row truncated to a length its section does not print is refused, and so is a truncated row cited to a section that prints no truncation. Same strictness as the iteration count.
- **Typing:** return type `u8[]`, Expected bytes, length equal to N.

## Emit and run

Every target compares the first N bytes, and fails — never passes by clamping — when the result is shorter than N:

```ts
// nish, sketched
const r = hmacSha256(unhex("0c0c…"), unhex("5465…"))
t.ok(name, r.length >= 16) && t.eqStr(name, hexOf(r.slice(0, 16)), "a3b6167473100ee06e0c796c2955552b")
```

The same for typescript, python, rust and go, through the existing per-language helpers. The failure message for a short result names the length. The text/markdown/json reports name the truncation (`TC5-256 (first 128 bits)`). `spec run` gets the same through emit. The PR tools (`frozen`, `stale`, `mutate`) see the new field through the contract; check that `frozen` treats a changed truncation as a changed contract.

## Tests

Table-driven, neighbours included, each driven through the parser or `vectorRun`/the binary, not by setting the field directly:

| area | cases |
|---|---|
| profile (`tests/spec/extract/`, mirror `profile_iterate_test.ts`) | bits, bytes, 128 bits on a 16-byte value accepted; 120 bits, 7 bits, 0, `01`, no unit, no `to`, unknown id, twice, with Iterate, with Tolerance, after a non-vector table, string/null/bool/int Expected refused; Expected longer than N refused; Expected shorter than N refused |
| fidelity (`tests/spec/gates/fidelity_test.ts`) | §4.6 cut: 128 bits accepted; 256 bits (not printed) refused; the 16 bytes cited to §4.2 (whole value there is 32 bytes / not printed) refused; Expected that is a prefix of a longer printed value still refused |
| contract (`tests/spec/contract/`) | round trip; shape refuses truncate 0, negative, ≠ Expected length |
| emit (`tests/spec/emit/*_test.ts`, `forms.json`) | each language emits the guarded prefix check |
| run (`tests/spec/emit/run_test.ts`) | a truncated row passes on a longer correct result, fails on a wrong prefix, fails on a result shorter than N |
| cli golden (`tests/cli/`) | `spec extract` refusal message for an Expected longer than N |

## Docs

- [docs/guide/guides/writing-a-spec.md](../../docs/guide/guides/writing-a-spec.md): the profile table row, a `### Truncations` section after Iterations, and the "What a printed value is" bullets (a truncation's length is a value the section must print).
- [docs/guide/guides/spec-to-contract.md](../../docs/guide/guides/spec-to-contract.md) / [testing.md](../../docs/guide/guides/testing.md) where they list the vector forms.
- [.claude/skills/vector-spec/SKILL.md](../skills/vector-spec/SKILL.md): replace "A truncated result … still cannot be compared" (Limits) and the "never a prefix" bullet with the Truncate form.
- `docs/reference/**` and its routes regenerated with `node scripts/gen-reference.mjs`, never edited.

## Out of scope

- Changing nish's spec — this run tells the user how; nish is another repository.
- Truncation in a property, or of a non-bytes result. A suffix (tail) form. An `Expected` qualifier inside the cell.
- Version bumps and CHANGELOG (release-please).

## Verification

`npm run build`, `node tests/run.mjs spec`, `node tests/run.mjs cli`, `node tests/run.mjs guide`, `npm run lint`, `npm run tested-exports`, `npm run dogfood`, plus `node scripts/gen-reference.mjs --check` and `node scripts/check-links.mjs` (the Docs CI job) and the Spec CI job's `for f in specs/*.xml; do ./dist/vector spec extract "$f" -o contracts/$(basename "$f" .xml).json --check; done`.
