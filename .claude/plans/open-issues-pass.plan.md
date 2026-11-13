---
name: A pass on the open issues (#46, #53, #61, #77)
overview: Close out the follow-up items still open on main e6e6565 after the Nish rewrite — 16 items across four issues, sliced into seven PRs. Ten items in those issues are already fixed or obsolete and are only reported back on their issues.
stages:
  - id: loose-ends
    title: "chore: small loose ends from the Nish rewrite"
    goal: Pin spec run on RFC 8439, make the vector skill runnable as written, and drop the stale bun.lockb ignore
    verification: npm run build && node tests/run.mjs spec/emit && npm run lint && npm run tested-exports
    todos:
      - id: le-8439
        content: Add a live spec run of contracts/rfc8439-chacha20-poly1305.json to tests/spec/emit/command_test.ts — see Loose ends
        status: pending
      - id: le-skill
        content: Make .claude/skills/vector/SKILL.md call ./dist/vector (building it first if absent), as the vector-spec skill does — see Loose ends
        status: pending
      - id: le-gitignore
        content: Remove bun.lockb from .gitignore — see Loose ends
        status: pending
  - id: rfc-root
    title: "fix(spec): one RFC lookup rule for every command, and drop spec check --nish"
    goal: check, extract, emit, run and mutate find an RFC by the same rule, and spec check stops declaring a flag it never reads
    verification: npm run build && node tests/run.mjs spec && node tests/run.mjs cli && npm run lint && npm run tested-exports
    todos:
      - id: rr-root
        content: Move the install-root lookup out of src/cli/spec-check.ts into src/spec/source and use it in emitContractFile (src/spec/emit/file.ts) — see RFC lookup root
        status: pending
      - id: rr-nish
        content: Remove the unread --nish flag from src/cli/spec-check.ts and its row in spec-to-contract.md — see RFC lookup root
        status: pending
      - id: rr-spec-xml
        content: Add CLI coverage for spec check --spec with a profile .xml, and the labelled-value cases on the check side — see RFC lookup root
        status: pending
      - id: rr-docs
        content: Rewrite the lookup section of docs/guide/guides/spec-to-contract.md (and testing.md if it repeats it) as one rule — see RFC lookup root
        status: pending
  - id: pr-lexing
    title: "fix(pr): read code with the tokenizer in mutate and exports"
    goal: spec mutate places sites with the lex.ts tokenizer, explains a raw nish clone, and spec exports splits generic calls
    verification: npm run build && node tests/run.mjs spec/pr && node tests/run.mjs pr- && npm run lint && npm run tested-exports
    todos:
      - id: pl-mutate-lex
        content: Replace the line scan in src/spec/pr/mutate.ts (mutateLine, mutateSites) with lexTokens from src/spec/pr/lex.ts — see PR gates
        status: pending
      - id: pl-mutate-msg
        content: Make spec mutate's bad --nish message say a raw nish clone has no libexec/nish or build/seed and how to get one; say the same in pr-gates.md — see PR gates
        status: pending
      - id: pl-exports-generic
        content: Accept export const a = f<T, U>(x) in gitdiffDeclarators (src/spec/pr/gitdiff.ts) by reading angle brackets before a call as its type list — see PR gates
        status: pending
  - id: i32-wrap
    title: "fix(emit): wrap i32 arithmetic in emitted tests, as the sampler does"
    goal: An emitted Nish test computes i32 + - * the way evalPure and the sampler do, so an overflowing vector agrees instead of panicking
    verification: npm run build && node tests/run.mjs spec/emit && node tests/run.mjs emit- && npm run lint && npm run tested-exports
    todos:
      - id: iw-emit
        content: Emit wrapping i32 add, sub and mul in src/spec/emit/emit.ts, with helpers in src/spec/emit/helpers.ts if nish has no direct call — see i32 overflow
        status: pending
      - id: iw-goldens
        content: Regenerate the emit goldens and add a test where an i32 vector overflows — see i32 overflow
        status: pending
      - id: iw-docs
        content: Replace the panic paragraph in docs/guide/guides/writing-a-spec.md — see i32 overflow
        status: pending
  - id: refusal-locations
    title: "fix(extract): refusals point at the right file, line and column"
    goal: A refusal prints its column when it has one, never cites a markdown line it cannot vouch for, and cites second lines in the same file as its prefix
    verification: npm run build && node tests/run.mjs spec/extract && node tests/run.mjs core && node tests/run.mjs extract- && npm run lint && npm run tested-exports
    todos:
      - id: rl-col
        content: Carry a column through Diagnostic (src/core/diag.ts) and print file:line:col when a refusal has one, from src/cli/spec-extract.ts — see Refusal locations
        status: pending
      - id: rl-mdline
        content: Stop extrapolated markdown lines from drifting or running past the end of the .md (xmlMdLineOf in src/spec/xml/reader.ts, profileWhere in src/spec/profile/profile.ts) — see Refusal locations
        status: pending
      - id: rl-second-line
        content: Make the anchor-reuse and mismatched-close refusals cite their second line in the same file as the prefix (src/spec/xml/doc.ts, src/spec/xml/reader.ts) — see Refusal locations
        status: pending
      - id: rl-docs
        content: Update the refusal format in docs/guide/guides/spec-to-contract.md and exit-codes.md — see Refusal locations
        status: pending
  - id: f64-tolerance
    title: "feat(spec): a spec can state an f64 tolerance"
    goal: The kramdown profile has a spelling for an abs or ulps tolerance on an f64 vector, extract writes it into the contract, and a refused forall bound names its type
    verification: npm run build && node tests/run.mjs spec && npm run lint && npm run tested-exports
    todos:
      - id: ft-spelling
        content: Design and implement the profile spelling for a vector tolerance (abs or ulps, plus the sentence that states it) in src/spec/profile and src/spec/front — see f64 tolerance
        status: pending
      - id: ft-extract
        content: Make spec extract write tolerance into the contract, with extract and fidelity tests — see f64 tolerance
        status: pending
      - id: ft-docs
        content: Document the spelling in docs/guide/guides/writing-a-spec.md and drop the not-yet sentence — see f64 tolerance
        status: pending
      - id: ft-bound-type
        content: Name the type in the forall-bound refusal in src/spec/front/front.ts (the bounds of a u8 ...) — see f64 tolerance
        status: pending
  - id: completeness-copies
    title: "fix(gates): an unmarked copy of a quoted sentence does not need its own quote"
    goal: Reproduce whether completeness asks for both copies of a sentence that an unmarked paragraph repeats, and if it does, let the gate tell the copies apart
    verification: npm run build && node tests/run.mjs spec/gates && node tests/run.mjs spec/extract && npm run lint && npm run tested-exports
    todos:
      - id: cc-repro
        content: Write a failing completeness test for a sentence quoted once and repeated in an unmarked paragraph — see Completeness copies
        status: pending
      - id: cc-fix
        content: If it reproduces, expose the source line of each normative entry from src/spec/xml and use it in src/spec/gates/completeness.ts; if not, keep the test as a pin — see Completeness copies
        status: pending
---

## Context

Four issues hold follow-ups from earlier `/feature` runs: #46 and #53 (spec-extract), #61 (language-neutral schema) and #77 (the Nish rewrite). #46, #53 and #61 were written against the old Bun/TypeScript code, so each item was re-checked against main e6e6565.

| still applies (planned) | already fixed or obsolete (reported only) |
|---|---|
| #77-1, 2, 3, 4, 5, 7, 8, 9, 10 · #61-A, B, C · #53-A, B, C · #46-3 | #77-6 (wording pinned by tests; nothing to drift from) · #61-D (overrides unused by design) · #53-D (test gone) · #53-E (HKDF is extracted) · #46-1 (spec-xml-drift is on main) · #46-4 (`%` goes through remI32) · #46-5 (frozen skips sidecars) · #46-6 (no coverage tool; tested-exports is the gate) · #46-7 (schema text updated) · #46-8 (labelled ints and repeat exist) |

Not planned: #46-2's "refusals come in stages" (XML, then profile, then gates). That is how extract is built, and changing it is a design call, not a loose end.

## Approach

- Waves, from file ownership: **loose-ends, rfc-root, pr-lexing, i32-wrap** start at once. **refusal-locations** starts after rfc-root merges (both edit spec-to-contract.md). **f64-tolerance** starts after refusal-locations and i32-wrap merge (profile/extract code and writing-a-spec.md). **completeness-copies** starts after refusal-locations (src/spec/xml).
- #77-5: one rule — the places `check` and `extract` use today, with the **install root** as the third place, for all five commands.
- #61-C: **wrap** i32 like i64, so the emitted test agrees with evalPure and the sampler. Emitted goldens change.
- When the work is done, each source issue gets a comment mapping every item to its PR or to "already fixed / obsolete" with the evidence. An issue is closed only when every one of its items is resolved.

## Loose ends

**Owns:** `.gitignore`, `tests/spec/emit/command_test.ts`, `.claude/skills/vector/**`
**Model:** sonnet

- #77-1: mirror the existing HKDF live run in `command_test.ts` for `contracts/rfc8439-chacha20-poly1305.json` (expect SATISFIED, every vector pass).
- #77-2: the skill runs `./dist/vector …` everywhere it ran `vector …`, and builds with `npm run build` first when `dist/vector` is missing.
- #77-7: delete the `bun.lockb` line.

## RFC lookup root

**Owns:** `src/cli/spec-check.ts`, `src/spec/emit/file.ts`, `src/spec/run/command.ts`, `src/spec/source/**`, `tests/spec/source/**`, `tests/spec/gates/cli_test.ts`, `tests/cli/register_test.ts`, `tests/cli/check-*/**`, `tests/cli/emit-run-*/**`, `tests/cli/root-*/**`, `docs/guide/guides/spec-to-contract.md`, `docs/guide/guides/testing.md`; from round 2, the RFC-lookup paragraphs of `docs/guide/guides/writing-a-spec.md` and `.claude/skills/vector-spec/SKILL.md`

- #77-5 (amended in round 2): the lookup order is the same for all five commands: beside the contract, the contract's `../rfcs/`, the install root's `rfcs/` (`dirname(dirname(self))`), then the cwd's `rfcs/`. Nothing any command found before is lost.
- #77-5 (original): `emitContractFile` builds `new CheckContext(path, ".")` (`src/spec/emit/file.ts:56`), and `spec check` uses `specCheckRoot()` (`src/cli/spec-check.ts:147`). Move the root helper into `src/spec/source/` and use it in both. emit, run and mutate all go through `emitContractFile`, so `mutaterun.ts` does not change. Add a test that runs emit from a different cwd and finds the RFC at the install root.
- #77-4: delete `nishFlag` and its row in the flags table (`spec-to-contract.md:240`). `--nish` on `spec check` then fails as an unknown flag (exit 2).
- #77-8: add a golden case that runs `spec check --spec <profile>.xml`. Port the labelled-value cases that #71 deferred to the check side.

## PR gates

**Owns:** `src/spec/pr/**`, `tests/spec/pr/**`, `tests/cli/pr-*/**`, `docs/guide/guides/pr-gates.md`

- #77-10: `mutateLine`/`mutateSites` (`src/spec/pr/mutate.ts:210-330`) skip strings and comments by scanning lines, so they miss multi-line template literals and a `/*` opened mid-line. Place sites from `lexTokens` tokens instead. Add tests for both shapes. If the pr-gates.md example output shifts, update it.
- #77-3: `mutaterun.ts:706` reports only "not an executable file". When the path ends in `libexec/nish` and the directory looks like a nish checkout without a build, say so and name the fix. Mirror it in pr-gates.md's "The compiler" section, with a golden case.
- #77-9: `gitdiffDeclarators` (`src/spec/pr/gitdiff.ts:587`) refuses `f<T, U>(x)` because of the comma. Read `<…>` immediately before `(` as a type-argument list. Update the `SPLIT` pin at `tests/spec/pr/gitdiff_test.ts:253`, and keep a genuinely unsplittable case refused.

## i32 overflow

**Owns:** `src/spec/emit/emit.ts`, `src/spec/emit/helpers.ts`, `src/spec/emit/lit.ts`, `tests/spec/emit/forms_test.ts`, `tests/spec/emit/parts_test.ts`, `tests/spec/emit/program_test.ts`, `tests/spec/emit/golden/**`, `tests/spec/emit/fixtures/**`, `tests/cli/emit-ok/**`, `tests/cli/emit-example-hex/**`, `docs/guide/guides/writing-a-spec.md`

- `src/spec/emit/emit.ts:405-415` wraps i64 with the `nish:unsafe` wrapping calls and leaves i32 as plain operators, which panic in Nish (`writing-a-spec.md:221-223`). Do the same for i32. If nish 0.39.0 has no i32 wrapping call, compute it in i64 and truncate, in a helper. Check with `.nish/bin/nish run`; do not guess.
- Regenerate goldens with the repo's tooling. Add an emitted-test case whose i32 vector overflows and passes.

## Refusal locations

**Owns:** `src/core/diag.ts`, `src/cli/spec-extract.ts`, `src/spec/extract.ts`, `src/spec/xml/**`, `src/spec/profile/**`, `tests/core/diag_test.ts`, `tests/spec/extract/**`, `tests/cli/extract-*/**`, `tests/fixtures/xmlv3/**`, `tests/fixtures/kramdown/**`, `tests/fixtures/profile/**`, `docs/guide/guides/spec-to-contract.md`, `docs/guide/guides/exit-codes.md`
**Starts after:** rfc-root merges.

- #53-A: `ProfileRefusal` has a `col` (`src/spec/profile/profile.ts:79`), and `spec-extract.ts` drops it. Add an optional column to `Diagnostic` and print `file:line:col:` only when one is set. Refusals that have no column print exactly as before.
- #53-B: `xmlMdLineOf` (`src/spec/xml/reader.ts:176`) extrapolates `piN + line - piLine` from the last `<?line?>` mark, which drifts after tables. Print a markdown line only when it is exact (a mark on that line). Otherwise print the last mark's md line together with the XML line, and never print a line past the end of the .md. Use specs/example-hex as the regression: its BCP 14 sentence is on md line 52 and is reported at 55 today.
- #53-C: `doc.ts:214` ("first on line N") and `reader.ts:702` ("from line N") cite XML lines under an md prefix. Carry the second location so it is printed in the prefix's file.

## f64 tolerance

**Owns:** `src/spec/front/**`, `src/spec/profile/**`, `src/spec/extract.ts`, `tests/spec/extract/**`, `tests/fixtures/kramdown/**`, `tests/fixtures/profile/**`, `docs/guide/guides/writing-a-spec.md`
**Starts after:** refusal-locations and i32-wrap merge.

- #61-A: the emitter (`src/spec/emit/emit.ts:636`), the contract reader and writer, and fidelity already handle `tolerance`. Only the profile has no spelling for it. Design one that states the kind (abs or ulps), the value, and the quoted sentence that states it, in the style of the profile's other vector annotations. Document it in `writing-a-spec.md:191-205` and remove "yet". Pin it with a kramdown fixture and the extract → contract round trip. Committed `specs/*.md` and `contracts/*.json` must not change: none of them states a tolerance.
- #61-B: `front.ts:1310` reports ``the bounds of `a` must satisfy 0 <= lo <= hi <= 255``. Name the type (`u8`). Update the pins at `tests/spec/extract/front_test.ts:483-494`.

## Completeness copies

**Owns:** `src/spec/gates/completeness.ts`, `tests/spec/gates/completeness_test.ts`, `tests/spec/gates/fixtures/**`, `src/spec/xml/**`, `tests/fixtures/normative-line/**`
**Starts after:** refusal-locations merges.

- #46-3: when an unmarked paragraph repeats a marked sentence, completeness asks for both copies to be quoted. It fails closed. Reproduce this first. If it reproduces, carry each normative entry's source line from the XML reader so the gate can match the quoted copy and accept the unmarked repeat. If it does not reproduce, the PR is the pinning test alone. If the fix needs files outside Owns (for example `src/spec/profile`), stop and open a draft that says so.

## Out of scope

- Refusal staging (#46-2), per-language overrides (#61-D), and a coverage tool (#46-6).
- Changing any committed `specs/*` or `contracts/*`.

## Verification

Every stage runs `npm run build`, `node tests/run.mjs <its areas>`, `npm run lint` and `npm run tested-exports`. CI (`check`, `spec-xml-drift`, `spec-extract`, `docs`, `conventional`) runs the full suite on every push.
