---
name: PR spec → contract → verify the PR matches it
overview: Extend `vector rfc` from "RFC → nish test" to a PR workflow. A markdown spec is approved, a contract is extracted from the spec alone and frozen, then the implementation PR must satisfy that contract and the contract must constrain the PR's diff (exports and diff-scoped mutation testing).
stages:
  - id: lang
    title: "feat(rfc) — strings, let bindings and labelled int fidelity in the contract language"
    goal: Phase 1 — a string value type with its ops and alphabet-sampled variables, let bindings emitted as Nish locals, and int fidelity that needs a label
    verification: bun run typecheck && npx biome check . && bun run coverage && VECTOR_REQUIRE_NISH=1 bun test test/rfc.test.ts test/rfc-lang.test.ts
    todos:
      - id: lang-string-type
        content: Add the string value type, str literals and the ops strLen strConcat lower upper utf8 ascii charAt to src/rfc/contract.ts (shape, typing), sample.ts (evaluator, SMT lengths), emit-nish.ts and schemas/rfc-contract.json — see Stage lang
      - id: lang-string-vars
        content: Add string property variables with minLen maxLen alphabet (characters or named classes) to src/rfc/sample.ts, with Z3 picking lengths and samples drawn from the alphabet — see Stage lang
      - id: lang-let
        content: Add let bindings to property expressions, emitted as Nish locals, and rewrite contracts/rfc8439-chacha20-poly1305.json to use them — see Stage lang
      - id: lang-int-label
        content: Replace intPrinted in src/rfc/rfctext.ts with a label-adjacent check, add the int label field, report unlabelled ints as unchecked — see Stage lang
      - id: lang-require-nish
        content: Make VECTOR_REQUIRE_NISH=1 turn a missing VECTOR_NISH into a test failure in test/rfc.test.ts — see Running against nish
  - id: hex-fixture
    title: "test(spec) — the nish/hex spec, RFC 4648 and a Nish reference implementation"
    goal: Commit the acceptance spec verbatim, fetch RFC 4648, and write test/fixtures/nish-hex/hex.ts in Nish, proven to compile and behave in a scratch install
    verification: bash test/fixtures/nish-hex/smoke.sh
    todos:
      - id: hex-spec
        content: Commit specs/example-hex.md verbatim from the request and fetch RFC 4648 into rfcs/rfc4648.txt — see Stage hex-fixture
      - id: hex-impl
        content: Write test/fixtures/nish-hex/hex.ts in the style of nish std/base64.ts, with no table indexed by a digit value — see Stage hex-fixture
      - id: hex-smoke
        content: Add test/fixtures/nish-hex/smoke.sh and a nish/testing smoke program that build a scratch install and check V1–V9 — see Stage hex-fixture
  - id: mutate-engine
    title: "feat(rfc) — a diff-scoped mutation engine"
    goal: The library half of item 10 — diff parsing, mutation operators, scratch installs and outcome classification — proven on nish crypto with the three planted mutants
    verification: bun run typecheck && npx biome check . && bun run coverage && VECTOR_REQUIRE_NISH=1 bun test test/rfc-mutate.test.ts
    todos:
      - id: mut-gitdiff
        content: Add src/rfc/gitdiff.ts, which parses git diff -U0 into changed line ranges and added or changed export names per file, failing on anything it cannot parse — see Stage mutate-engine
      - id: mut-scratch
        content: Add src/rfc/scratch.ts, which builds a scratch install from build/seed with std/ replaced by a copy plus overrides — see Stage mutate-engine
      - id: mut-operators
        content: Add the mutation operators to src/rfc/mutate.ts, applied one at a time inside changed ranges only — see Stage mutate-engine
      - id: mut-runner
        content: Add the mutant runner to src/rfc/mutate.ts with jobs, max and timeout, classifying killed, survived, stillborn and timeout — see Stage mutate-engine
      - id: mut-planted
        content: Prove in test/rfc-mutate.test.ts that the three planted mutants are killed against nish crypto with a synthetic base — see Stage mutate-engine
  - id: sources
    title: "feat(spec) — markdown specs and multi-document contracts, and rename to vector spec"
    goal: Phase 2 — a markdown spec reader, multi-document sources, vector provenance, and the command renamed to vector spec with vector rfc kept as an alias
    verification: bun run typecheck && npx biome check . && bun run coverage && VECTOR_REQUIRE_NISH=1 bun test test/rfc.test.ts test/rfc-lang.test.ts test/rfc-spec.test.ts
    todos:
      - id: src-md-reader
        content: Add a markdown spec reader beside src/rfc/rfctext.ts, sharing the quote, hex-run and BCP 14 sentence functions, with format detection — see Stage sources
      - id: src-multidoc
        content: Add sources with id, rfc and path to the contract, citations as source plus section, and completeness over the main document only — see Stage sources
      - id: src-provenance
        content: Add the required vector source (cite, command, spec), with commands run only under --run-sources — see Stage sources
      - id: src-rename
        content: Rename the command to vector spec with vector rfc as an alias, and update README, usage and the skill directory — see Stage sources
  - id: pr-gates
    title: "feat(spec) — PR gates — frozen, stale, exports, mutate and markdown reports"
    goal: Phase 3 — the gates that tie a frozen contract to an implementation PR
    verification: bun run typecheck && npx biome check . && bun run coverage && node scripts/spec-stale.mjs --self-test && VECTOR_REQUIRE_NISH=1 bun test test/rfc.test.ts test/rfc-lang.test.ts test/rfc-spec.test.ts test/rfc-mutate.test.ts test/rfc-gates.test.ts
    todos:
      - id: gate-frozen
        content: Add vector spec frozen --base and the source.sha256 contract field — see Stage pr-gates
      - id: gate-stale
        content: Put the contract sha256 in the emitted test header, add vector spec stale, and add scripts/spec-stale.mjs for nish CI — see Stage pr-gates
      - id: gate-exports
        content: Add vector spec exports with the outOfScope contract list — see Stage pr-gates
      - id: gate-mutate-cli
        content: Wire vector spec mutate onto the engine, with the allowSurvivors contract list — see Stage pr-gates
      - id: gate-markdown
        content: Add --format markdown to check, run and mutate in src/rfc/report.ts — see Stage pr-gates
  - id: extract
    title: "feat(spec) — spec-only and twice-run extraction, and the PR workflow skill"
    goal: Phase 4 — extraction that sees only the spec, a two-run disagreement report, and skills that walk the PR workflow
    verification: bun run typecheck && npx biome check . && bun run coverage && bun test test/rfc-extract.test.ts
    todos:
      - id: ext-spec-only
        content: Add extract --spec-only, which gives the model only the spec and takes signatures from its Interface section — see Stage extract
      - id: ext-twice
        content: Add extract --twice, which reports requirement and clause disagreements as warnings — see Stage extract
      - id: ext-skill
        content: Update .claude/skills/vector-spec for the PR workflow — see Stage extract
  - id: hex-acceptance
    title: "test(spec) — the nish/hex contract, end to end"
    goal: The acceptance fixture — contracts/example-hex.json passes every gate, runs SATISFIED in a scratch install, and is mutation-tested honestly
    verification: bun run typecheck && npx biome check . && bun run coverage && VECTOR_REQUIRE_NISH=1 bun test test/rfc-hex.test.ts
    todos:
      - id: acc-contract
        content: Write contracts/example-hex.json from specs/example-hex.md, passing every gate with RFC 4648 cited for V1–V4 — see Stage hex-acceptance
      - id: acc-run
        content: Show V5 and V6 passing under --run-sources and the contract SATISFIED against a scratch install — see Stage hex-acceptance
      - id: acc-mutate
        content: Run vector spec mutate with the fixture as the diff, then kill a survivor with a new property or record why it survives — see Stage hex-acceptance
---

## Context

[`src/rfc/`](../../src/rfc/) turns an RFC into a contract (verbatim requirements, RFC test vectors, properties, exclusions). It checks the contract with deterministic gates, samples inputs with Z3 and a seeded PRNG, emits a `nish/testing` program, runs it with `nish run`, and reports per requirement. [`contracts/`](../../contracts/) holds RFC 5869 and RFC 8439, both SATISFIED by nish 0.33.0's std (checked live in amritk/vector#6). This plan adds a PR workflow on top. A markdown spec is approved by a human. A contract is extracted from the spec alone and frozen. The implementation PR must satisfy the frozen contract, and the contract must constrain the PR's diff.

## Rules every stage carries

- Every gate is deterministic and fails closed. A Z3 `unknown`, a missing source or an unparseable diff is a failure, never a pass.
- Never weaken a clause to make it pass.
- Every new gate ships with a test that shows it refusing a bad input, next to the test of the passing case.
- Report what was not verified, such as skipped live tests or commands that were not run.
- The existing modes keep working: prompt, `--verify`, `--fixture`, `--diff`, and `rfc check/emit/run/extract`.
- Conventional commit messages.

## Running against nish

The session hook clones nish to `../nish` and exports `VECTOR_NISH=../nish/build/seed/bin/nish` when the seed downloads, which needs amritk/nish attached to the session. A **scratch install** is a copy of `../nish/build/seed` whose `std/` is replaced by a copy of `../nish/std` plus overrides, run as `<scratch>/libexec/nish`. `nish run` resolves `nish/...` to `<binary dir>/../std`.

Live tests stay `describe.skipIf(!nish)`, so CI (no nish) still passes. `VECTOR_REQUIRE_NISH=1` turns a missing nish into a failure, so a stage's verification can never pass on skipped live tests. Each test file that has live tests honours it.

## Stage lang

Owns: `src/rfc/contract.ts`, `src/rfc/sample.ts`, `src/rfc/emit-nish.ts`, `src/rfc/gates.ts`, `src/rfc/rfctext.ts`, `schemas/rfc-contract.json`, `contracts/**`, `test/rfc.test.ts`, `test/rfc-lang.test.ts`, `README.md`

- **The `string` type.** `"string"` in `VALUE_TYPES` (Nish `string`). The literal is `{"str": "..."}`. The ops are `strLen`, `strConcat`, `lower`, `upper`, `utf8` (string→bytes), `ascii` (bytes→`string?`, null when any byte is ≥ 0x80) and `charAt` (string, i32 → string). Typing, the pure evaluator, the SMT length terms and the emitted Nish helpers all cover every op. The existing "evaluator matches the emitted helpers" test extends to them.
- **String variables.** `{"type":"string","minLen","maxLen","alphabet"}`. The alphabet is a list of characters and/or the named classes `hexdigit`, `HEXDIGIT`, `digit`, `alpha`, `space`, `ascii-printable`. Z3 picks lengths, including both sides of every integer comparison on `strLen`. Characters come from the alphabet via the seeded PRNG. The shape gate refuses an unknown class, an empty alphabet, and a `minLen` greater than `maxLen`.
- **`let`.** `{"let":[{"name","value"}],"in":expr}`, scoped, with names checked against `IDENT_RE` and refused if they shadow. It is emitted as Nish `const` locals, so `seal(...)` runs once. Rewrite the repeated seal/unwrap in the RFC 8439 contract with `let`, and confirm it is still SATISFIED live.
- **Labelled ints.** `{"int":42,"label":"L"}` passes fidelity only when the section prints `L <sep> 42`, where the separator is whitespace, `=` or `:`. An int with no label is `unchecked` and is listed in the report. Update the 5869/8439 contracts to label their ints wherever the RFC prints a label. Never drop a vector to get green.

## Stage hex-fixture

Owns: `specs/example-hex.md`, `rfcs/rfc4648.txt`, `test/fixtures/nish-hex/**`

- `specs/example-hex.md` is the spec in the request, byte for byte.
- `rfcs/rfc4648.txt` comes from rfc-editor.org. Its §10 test vectors are the cited source for V1–V4.
- `hex.ts` exports `hexEncode(bytes: u8[]): string` and `hexDecode(text: string): u8[] | null`. Use u8[] and i32, with no closures and no exceptions, in the style of `../nish/std/base64.ts`. It must honour §5: decode digits arithmetically, never by indexing a table with a digit's value.
- `smoke.sh` builds a scratch install with `std/hex.ts` added, runs a hand-written `nish/testing` program over V1–V9, and exits non-zero on any failure or when nish is missing. It also runs the V5/V6 python commands and compares their output.

## Stage mutate-engine

Owns: `src/rfc/gitdiff.ts`, `src/rfc/scratch.ts`, `src/rfc/mutate.ts`, `test/rfc-mutate.test.ts`, `test/fixtures/mutate/**`

This stage builds only the library. The CLI and the contract fields arrive in pr-gates.

- **`gitdiff.ts`** parses `git diff -U0` into `{file, ranges: [start,end][], exports: {name, kind: "added"|"changed"}[]}`. An export is a changed or added line matching `export const|function <name>`. Any hunk header it cannot parse is an error, never an empty result.
- **`scratch.ts`** has `makeScratch({nishRoot, overrides: Record<relPath, contents>}) → {dir, nish, dispose}`.
- **Operators:** relational flip (`<`↔`<=`, `>`↔`>=`, `==`↔`!=`, and the `===` forms), integer literal ±1, `&&`↔`||`, drop a unary `!`, delete a statement line, and `return x` → `return null` when the function's declared return type admits null. Operators apply only to lines inside changed ranges. Strings and comments are skipped.
- **Runner:** `runMutants({contract, emitted test, nishRoot, module path, ranges, jobs, max, timeoutMs, allowSurvivors})`. Each mutant runs in its own scratch install. The outcome is `killed` (the test fails or exits non-zero), `survived` (it passes), `stillborn` (a compile error, not counted) or `timeout`. A mutant that doesn't compile and doesn't run is stillborn only when nish reports a compile diagnostic. Any other runner error fails the run.
- **Planted mutants:** with a synthetic base in which the target module's lines count as changed, these three mutants are killed by the emitted tests of the existing contracts. The engine must generate each of them itself, and the test asserts it did:
  - the HKDF `L` bound +1 in `std/crypto/hkdf.ts`;
  - the tag compare dropping byte 15, a literal −1 on the compare loop's bound;
  - `tail > 0 || zeroPad`, an `&&`→`||` flip in `std/crypto/chacha20poly1305.ts`.

## Stage sources

Owns: `src/rfc/rfctext.ts`, `src/rfc/spectext.ts`, `src/rfc/contract.ts`, `src/rfc/gates.ts`, `src/rfc/cli.ts`, `src/rfc/run.ts`, `src/rfc/report.ts`, `src/rfc/extract.ts`, `src/cli.ts`, `schemas/rfc-contract.json`, `contracts/**`, `test/rfc.test.ts`, `test/rfc-lang.test.ts`, `test/rfc-spec.test.ts`, `README.md`, `.claude/skills/vector-rfc/**`, `.claude/skills/vector-spec/**`

- **Markdown reader** (`spectext.ts`). Sections come from numbered headings: `## 3. Encoding` → `3`, `### 3.1. Length` → `3.1`. Both readers return the same document interface, so quotes, `hexRuns`, `normativeSentences` and `ownSpans` work on either. The BCP 14 boilerplate paragraph is skipped in quotes and in completeness. Detection: an RFC `.txt` has the RFC header and page-break form feeds, and a markdown spec has `#` headings. A file that is neither is refused.
- **Multiple documents.** `sources: [{id, rfc?, path?}]`, plus a `main` source id. Requirements, exclusions and vectors cite `{source, section}`, and `source` defaults to the main one. Fidelity reads the cited document. Completeness runs over the main document only. A citation of an unknown source is refused.
- **Provenance.** Every vector clause has a `source`:
  - `{cite:{source,section}}`: the expected value must be printed there (today's fidelity check, against the cited document).
  - `{command:"<shell>"}`: runs only with `--run-sources`, with a 30 s timeout. Its trimmed stdout must equal the expected value (hex, or the string). The command is shown in the report. Without `--run-sources` it is reported as not run, never as passed.
  - `{spec: section}`: allowed only when the expected value is null or a boolean that the section states.

  A vector with no source is a gate failure. The 5869/8439 contracts get `cite` sources.
- **Rename.** `vector spec` becomes the command and `vector rfc` stays as an alias that behaves identically. Rename the skill directory `vector-rfc` → `vector-spec`, and update the README and the usage text.

## Stage pr-gates

Owns: `src/rfc/frozen.ts`, `src/rfc/exports.ts`, `src/rfc/mutate.ts`, `src/rfc/gitdiff.ts`, `src/rfc/scratch.ts`, `src/rfc/cli.ts`, `src/rfc/report.ts`, `src/rfc/contract.ts`, `src/rfc/gates.ts`, `src/rfc/emit-nish.ts`, `schemas/rfc-contract.json`, `contracts/**`, `scripts/spec-stale.mjs`, `test/rfc-gates.test.ts`, `test/rfc-mutate.test.ts`, `README.md`

- **`vector spec frozen --base <ref>`** fails when the diff against base touches `specs/` or `contracts/` and also touches implementation files (anything outside specs/, contracts/ and docs). It also fails when `source.sha256` doesn't match the spec file's sha256. A git error is a failure.
- **`vector spec stale <test.ts> <contract.json>`.** The emitted test's header carries `// vector-contract-sha256: <hex>` of the contract file, and `stale` checks it. `scripts/spec-stale.mjs` does the same in about 20 dependency-free lines of Node, for nish CI. It is documented in the README and has a `--self-test`.
- **`vector spec exports --base <ref> --nish-root <dir>`** lists the exports the diff adds or changes in the target module(s), via `gitdiff.ts`. It fails when one is in neither the contract's functions nor `outOfScope: [{name, reason}]`.
- **`vector spec mutate <contract> --nish-root <dir> --base <ref> [--jobs N] [--max N]`** puts the engine behind the CLI. It reports survivors with `file:line`, the mutated line, and "behaviour no requirement pins down", and exits 1 when any survive. Contracts accept `allowSurvivors: [{file, line, reason}]`.
- **`--format markdown`** for check, run and mutate: the per-requirement dashboard as a PR comment (the quote, then its clauses and outcomes, then exclusions and survivors).

## Stage extract

Owns: `src/rfc/extract.ts`, `src/rfc/cli.ts`, `src/rfc/spectext.ts`, `.claude/skills/**`, `README.md`, `test/rfc-extract.test.ts`

- **`--spec-only`.** The model's prompt contains only the spec. Signatures come from the spec's Interface section, parsed in `spectext.ts`, never from the module source. The test checks that the prompt holds no module source.
- **`--twice`.** Two independent extractions, with a report of where they disagree: different requirement sets, or a quote covered in one but not the other. Disagreement is a warning, listed for the human reviewer. Tests use the existing fake-model seam.
- **Skill.** `.claude/skills/vector-spec` walks the PR workflow: write the spec, check it, freeze the contract, then implement, run, check exports, mutate.

## Stage hex-acceptance

Owns: `contracts/example-hex.json`, `test/rfc-hex.test.ts`, and fixes to `src/rfc/{contract,gates,sample,emit-nish,rfctext,run,report,mutate,gitdiff,scratch,frozen,exports}.ts` found while doing it (stage extract runs concurrently and owns `extract.ts`, `cli.ts`, `spectext.ts`, the skills and the README)

- A hand-written `contracts/example-hex.json` passes every gate. It cites RFC 4648 §10 for V1–V4, uses `command` for V5/V6 and `spec` for V7–V9, and covers every MUST, with §5's timing MUST as a stated exclusion.
- With `--run-sources`, V5 and V6 pass. `vector spec run` is SATISFIED against a scratch install with `std/hex.ts` from the fixture.
- `vector spec mutate`, with the fixture as the diff (a synthetic base without `std/hex.ts`), reports its survivors honestly. Then either add one property that kills a survivor or record it in `allowSurvivors` with the reason. Never weaken a clause.

## Out of scope

- Any change to amritk/nish. `std/hex.ts` exists only in the fixture and in scratch installs.
- Running live nish tests in vector's CI. They stay skipped there and are run by the sessions.

## Tests

[`test/rfc.test.ts`](../../test/rfc.test.ts) is the pattern. Each stage adds its own file (`rfc-lang`, `rfc-spec`, `rfc-mutate`, `rfc-gates`, `rfc-extract`, `rfc-hex`), with a passing and a refusing case for every gate.

## Verification

Every stage runs `bun run typecheck`, `npx biome check .`, `bun run coverage` (the aggregate floor: lines 74%, functions 84%) and its own test files with `VECTOR_REQUIRE_NISH=1`. The targeted command is `bun test <file>`.
