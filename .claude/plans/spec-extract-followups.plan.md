---
name: spec-extract follow-ups (amritk/vector#46)
overview: Close the loose ends the spec-extract run left in #46 — refusals name the markdown file, completeness tells unmarked copies of a sentence apart, a computed % 0 means the same in where and in the emitted test, frozen skips sidecars passed by name, the schema text is current, the coverage floor is 91, and vector literals gain labelled integers and repeat. Vector stays model-free, extract stays offline, and nothing shells out to Ruby or Python.
stages:
  - id: refusal-md-path
    title: Refusals name the markdown file beside its line
    goal: Every extract refusal that carries a markdown line prints the .md path with it, not the .xml
    verification: bun test test/rfc-extract.test.ts test/profile.test.ts test/refusal-md-path.test.ts && bun run typecheck && bun run lint
    todos:
      - id: md-path-resolve
        content: Work out the markdown path for an XML source in src/rfc/extract.ts — see Stage refusal-md-path
        status: pending
      - id: md-path-print
        content: Print md-path colon md-line in xmlRefusalLine, the profile refusals and gateRefusals, keeping the .xml path and xml line when no markdown line is known — see Stage refusal-md-path
        status: pending
      - id: md-path-readme
        content: Update the README paragraph on refusal format (around line 166) — see Stage refusal-md-path
        status: pending
      - id: md-path-tests
        content: Add test/refusal-md-path.test.ts and update expectations in test/rfc-extract.test.ts — see Stage refusal-md-path
        status: pending
  - id: normative-source-line
    title: Completeness tells an unmarked copy of a sentence from the marked one
    goal: xmlv3 records the source line of each normative entry, and the completeness gate uses it so an unmarked repeat of a marked sentence no longer has to be quoted
    verification: bun test test/xmlv3.test.ts test/rfc-gates.test.ts test/rfc-linked.test.ts test/normative-line.test.ts && bun run typecheck && bun run lint
    todos:
      - id: normative-loc
        content: Add the source location (xml line, and markdown line when known) to each Normative entry in src/rfc/xmlv3.ts — see Stage normative-source-line
        status: pending
      - id: completeness-by-line
        content: Make bindingSentences in src/rfc/gates.ts locate each binding entry by its own position instead of counting identical sentences — see Stage normative-source-line
        status: pending
      - id: normative-tests
        content: Add test/normative-line.test.ts with a fixture where an unmarked paragraph repeats a marked sentence — see Stage normative-source-line
        status: pending
  - id: mod-zero
    title: A computed % 0 agrees between where and the emitted test
    goal: The Nish test emit-nish.ts writes evaluates a % b with b == 0 to 0, exactly as sample.ts does, so where and assert cannot disagree
    verification: bun test test/rfc-lang.test.ts test/rfc-bitwise.test.ts test/rfc.test.ts test/mod-zero.test.ts && bun run typecheck && bun run lint
    todos:
      - id: mod-zero-emit
        content: Emit % through a helper in src/rfc/emit-nish.ts that gives 0 for a zero divisor and truncating % otherwise — see Stage mod-zero
        status: pending
      - id: mod-zero-sample
        content: Check src/rfc/sample.ts evaluation and its Z3 encoding agree with the emitted helper, and fix whichever does not — see Stage mod-zero
        status: pending
      - id: mod-zero-tests
        content: Add test/mod-zero.test.ts pinning a computed zero divisor in both where and assert — see Stage mod-zero
        status: pending
  - id: housekeeping
    title: frozen skips explicit sidecars, schema text, coverage floor 91
    goal: vector spec frozen ignores *.survivors.json passed by name, sourceDecl.rfc describes the .xml form, and the coverage gate enforces lines of at least 91 percent
    verification: bun test test/frozen-sidecars.test.ts test/rfc-sources.test.ts && bun run generate:schemas && git diff --exit-code src/generated/ && bun run typecheck && bun run lint && bun run coverage
    todos:
      - id: frozen-skip
        content: Drop *.survivors.json from the explicit contract list in src/rfc/frozen.ts (frozenCheck), failing as today when nothing is left — see Stage housekeeping
        status: pending
      - id: schema-text
        content: Fix the sourceDecl.rfc description in schemas/rfc-contract.json and regenerate — see Stage housekeeping
        status: pending
      - id: coverage-floor
        content: Raise FLOOR.lines in scripts/coverage.ts from 74 to 91 and update its comment — see Stage housekeeping
        status: pending
      - id: frozen-tests
        content: Add test/frozen-sidecars.test.ts — see Stage housekeeping
        status: pending
  - id: literal-int-repeat
    title: Labelled integers and repeat in vector literals
    goal: A vector table cell can write a labelled integer and a repeated byte run, and they resolve to the contract's existing int+label and hex+repeat literals
    verification: bun test test/literals.test.ts test/profile.test.ts && bun run typecheck && bun run lint
    todos:
      - id: literal-labelled-int
        content: Parse a labelled integer cell (L = 42) in src/rfc/literals.ts and resolve it to an int literal with its label — see Stage literal-int-repeat
        status: pending
      - id: literal-repeat
        content: Parse a repeated byte run in src/rfc/literals.ts and resolve it to a hex literal with repeat — see Stage literal-int-repeat
        status: pending
      - id: literal-readme
        content: Add both forms to the README literal table (around line 245) — see Stage literal-int-repeat
        status: pending
      - id: literal-tests
        content: Add test/literals.test.ts for both forms, their refusals, and an end-to-end extract of a vector using them — see Stage literal-int-repeat
        status: pending
---

# spec-extract follow-ups

Source: amritk/vector#46. Base: `main` at `bcc739d`. #45 (the CI drift job) is already merged, so criterion 12 of the previous run needs no work here.

Constraints for every stage:

- vector never calls a model.
- `spec extract` reads only committed bytes and never touches the network.
- No new shell-out to Ruby, Python or any other interpreter. `scripts/build-spec.sh` is untouched.
- Do not edit `specs/*.md`, `specs/*.xml`, `contracts/*.json` or `.github/workflows/**`. Any of those changing means the stage is wrong.

## Stage refusal-md-path

**Owns:** `src/rfc/extract.ts`, `src/rfc/profile.ts`, `test/rfc-extract.test.ts`, `test/refusal-md-path.test.ts`, `test/fixtures/extract/**`, `test/fixtures/profile/**`, and in `README.md` only the paragraph on refusal format under `spec extract` (around lines 160–180).

Today `specs/example-hex.xml:130: BCP 14 sentence has no anchor …` prints the markdown line beside the XML path. The requirement is `file:line` where the line is the markdown line. So when a refusal's `Loc` has an `mdLine`, print the markdown file's path with it. When there is no `mdLine`, keep the `.xml` path with the XML line, as today.

- The markdown path is the `.md` with the same directory and base name as the `.xml`. That is where `scripts/build-spec.sh` reads it from. Print it relative, the same way the `.xml` path is printed today. Decide, and say in the PR, what happens when that `.md` is not on disk. One option is to fall back to the `.xml` path and its XML line, so a refusal never names a file that does not exist.
- Cover all three places that print one: `xmlRefusalLine`, the profile's `Refusal` (`lineOf` in profile.ts) and `gateRefusals`. A sidecar refusal still names the sidecar.
- Out of scope: the order refusals arrive in (profile first, then the gates). Do not touch src/rfc/xmlv3.ts. That belongs to normative-source-line, and `Loc` already carries what this stage needs.

## Stage normative-source-line

**Owns:** `src/rfc/xmlv3.ts`, `src/rfc/gates.ts`, `test/xmlv3.test.ts`, `test/rfc-gates.test.ts`, `test/rfc-linked.test.ts`, `test/normative-line.test.ts`, `test/fixtures/xmlv3/**`, `test/fixtures/linked/**`, `test/fixtures/normative-line/**`.

Reported in #41. With an XML main source, `bindingSentences` keys entries by section, level and sentence, and works out which occurrence each one is by counting. When an unmarked paragraph (no `<bcp14>`) repeats a marked sentence word for word, completeness asks for both copies to be quoted. This fails closed, never as a false pass, but it is wrong.

- Give each `Normative` entry its source location (the `Loc` of the `<bcp14>`, or of the sentence start) in `xmlv3.ts`.
- In `gates.ts`, use that location to find the offset(s) of *that* sentence in the section's own text. The unmarked copy then needs no quote. A marked sentence printed twice, both copies marked, still needs both quoted.
- Completeness must still fail closed. An entry whose position cannot be found is reported, never skipped.
- Test with a small XML fixture: one section where a marked MUST sentence is followed by an unmarked paragraph repeating it. Quoting the marked copy passes. Quoting only the unmarked copy fails. Also keep a case where both copies are marked.

## Stage mod-zero

**Owns:** `src/rfc/sample.ts`, `src/rfc/emit-nish.ts`, `test/rfc-lang.test.ts`, `test/rfc-bitwise.test.ts`, `test/rfc.test.ts`, `test/mod-zero.test.ts`.

The README (around line 286) says `a % 0` is 0, and `sample.ts` evaluates it that way. But `emit-nish.ts` (around line 492) emits a raw `(a % b)`, so a computed zero divisor (`x % (y - y)`) can pass `where` in sampling and still trap or disagree in the emitted Nish test. A literal `% 0` is already refused and stays refused.

- Emit `%` through a helper that the emitted file defines only when it is used (the way `this.use(...)` adds helpers). It returns 0 for a zero divisor and the truncating `%` otherwise, wrapped as today (`wrapU32`).
- Check that sample.ts's `intTerm` Z3 encoding still matches. It only encodes positive literal divisors, so a computed divisor stays outside the Z3 encoding. Say so in a comment if that is the reason it agrees.
- Emitted goldens for the shipped contracts change only if they use `%`. Regenerate them, never hand-edit.

## Stage housekeeping

**Owns:** `src/rfc/frozen.ts`, `src/rfc/cli.ts`, `schemas/rfc-contract.json`, `src/generated/**`, `scripts/coverage.ts`, `test/frozen-sidecars.test.ts`, `test/rfc-sources.test.ts`.

- **frozen.** `vector spec frozen --base origin/main contracts/*.json` expands the glob to include `contracts/example-hex.survivors.json`, which fails with "not a contract". Only the no-path default skips sidecars today. Make `frozenCheck` drop any explicit path ending in `SIDECAR_SUFFIX`, in the same way. If nothing is left, fail as today when no contract is found. The README already shows the glob form, so it becomes correct as written, and this stage does not edit it. Testing: a temporary git repo with a contract and its sidecar, frozen called with both paths, passes; frozen called with only the sidecar fails with the no-contract message. The existing sidecar tests in `test/rfc-extract.test.ts` belong to refusal-md-path, so put the new ones in the new file.
- **schema.** `sourceDecl.rfc` reads "An RFC number: rfcs/rfc<N>.txt." Say what `sources.ts` actually does: it looks for `rfcs/rfc<N>.xml` first, then `.txt`. Check sources.ts before writing it. Run `bun run generate:schemas` and commit any change under `src/generated/`.
- **coverage.** The human approved this config change in the /feature request. `FLOOR.lines` goes from 74 to 91. `functions` stays at 84 unless the human says otherwise. Update the comment above `FLOOR` to give the measurement it is based on: main at `bcc739d` measures lines 93.00% and functions 95.61% in a cloud session. Run `bun run coverage` and quote its output in the PR. No other coverage config changes.

## Stage literal-int-repeat

**Owns:** `src/rfc/literals.ts`, `test/literals.test.ts`, `test/profile.test.ts`, `test/fixtures/literals/**`, and in `README.md` only the literal table under the vector-table section (around lines 235–260).

The contract already supports `{int, label}` and `{hex, repeat}` (contract.ts around line 110, validated around line 520). The fidelity gate already checks labelled ints. What is missing is a way to write them in a vector table cell. The next PR extracts the HKDF and ChaCha contracts, which need both (`L = 42`, and RFC-printed runs like `22 × 0b`, which is 0x0b repeated 22 times).

- **Labelled integer.** `Label = 42` resolves to `{int: 42, label: "Label"}` where an integer goes, by the callee signature (as `RawLiteral` does now for strings). `Label = 0b0b` stays labelled bytes. Pick an unambiguous rule for something like `L = 42`, where `42` is also valid hex, and document it. One option: the callee's parameter type decides, and anything left ambiguous is refused with a column.
- **repeat.** Pick a cell syntax that matches how RFCs print runs. One option is `22 × 0b` (also accept ASCII `x`?). Allow it standalone, as part of `concat(...)`, and labelled (`IKM = 22 × 0b`). Resolve it to `{hex, repeat}`, and refuse a count below 1 or a run that is not whole bytes.
- Both forms round-trip through `spec extract` on a fixture, and the contract passes `validateContractShape` and the fidelity gate against a section that prints the value.
- Do not touch contract.ts, gates.ts or profile.ts. If the stage cannot be done without them, open the PR as a draft and say why.

## Cross-stage notes

- `test/profile.test.ts` belongs to literal-int-repeat, whose refusal messages it asserts (around lines 790–830 and 1032). refusal-md-path runs it but should not need to change it. Its one location assertion (around line 1171, `specs/t.xml:9`) uses a temporary `.xml` with no `.md` beside it. If refusal-md-path does have to change an assertion there, it may change only refusal-location assertions, and must say so in its PR.
- README.md is shared by section: refusal-md-path owns the refusal-format paragraph and literal-int-repeat owns the literal table. They are about 80 lines apart, so git merges them cleanly. No other stage edits README.md.
- No dependency edges between stages: each one is written and merged against `main` on its own.

## Acceptance criteria

These are checked against `main` after the merges, not against the stages.

1. When `vector spec extract specs/<name>.xml` refuses at a point with a markdown line, and `specs/<name>.md` is beside the XML, the refusal reads `specs/<name>.md:<md line>: …`. This holds for XML-reader, profile and gate refusals. With no markdown line, it reads `<path>.xml:<xml line>: …`.
2. Take an XML spec section where an unmarked paragraph repeats a `<bcp14>`-marked MUST sentence word for word. Quoting the marked copy satisfies completeness. Quoting only the unmarked copy is refused by completeness.
3. In a property whose divisor is computed and equals 0 (for example `x % (y - y)`), sample.ts's evaluation and the emitted Nish test both give 0 for that `%`. The emitted Nish source does not apply a bare `%` to an unguarded computed divisor. A literal `% 0` is still refused.
4. `vector spec frozen --base <ref> contracts/<name>.json contracts/<name>.survivors.json` does not fail with "not a contract". A run given only sidecars fails as a run with no contract does.
5. The `sourceDecl.rfc` description in `schemas/rfc-contract.json` names the `.xml` form, matching what `src/rfc/sources.ts` resolves.
6. `scripts/coverage.ts` fails when line coverage is below 91%. `bun run coverage` passes on `main`.
7. In a vector table, a cell `L = 42` extracts to `{"int": 42, "label": "L"}`, and the repeat form extracts to `{"hex": …, "repeat": N}`, labelled or not. The README literal table documents both. Malformed forms are refused with a column.
8. Invariants: no model calls; `spec extract` makes no network access; no new spawn of ruby, python or kramdown-rfc/xml2rfc in `src/`; `specs/`, `contracts/` and `.github/workflows/` are unchanged by this run; CI is green on `main` after the last merge.
