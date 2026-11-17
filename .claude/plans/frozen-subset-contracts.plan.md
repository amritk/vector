---
name: spec frozen classifies generated tests by every contract
overview: Make spec frozen class a changed test/spec/*.ts as generated when its one sha line names any contract under contracts/ (or a given one), not only a contract given on the command line, while still reporting problems only for the contracts given. Fixes nish's two-contract spec PRs being refused, and closes the converse hole where an edited generated test passes alongside a src/ change.
stages:
  - id: fix
    title: fix(spec) classify generated tests by every contract in spec frozen
    goal: A generated test is spec side when its one sha line names any contract under contracts/ or any given contract, and only the given contracts are checked and reported
    verification: npm run build && node tests/run.mjs frozen && npm run lint && npm run tested-exports && npm run dogfood && node scripts/gen-reference.mjs --check && node scripts/check-links.mjs
    todos:
      - id: repro
        content: Reproduce the bug through dist/vector in a throwaway repo before any change — see Reproduction
        status: pending
      - id: golden-repo-fixtures
        content: Teach tests/run.mjs an optional repo file in a golden case that builds a throwaway git repo from a fixture's base/ and head/ trees — see Golden repo fixtures
        status: pending
      - id: goldens
        content: Add goldens pr-frozen-two-contracts (exit 0) and pr-frozen-mixed (exit 1) with their fixtures under tests/fixtures/ — see Goldens
        status: pending
      - id: classify-fix
        content: Build frozenCheck's classification hash set from every contracts/*.json plus the given contracts, keeping problems to the given ones, in src/spec/pr/frozen.ts — see The fix
        status: pending
      - id: unit-cases
        content: Add table-driven neighbour cases to tests/spec/pr/frozen_test.ts (and e2e_test.ts where the binary matters) — see Tests
        status: pending
      - id: docs
        content: Update the frozen section of docs/guide/guides/pr-gates.md, the frozen.ts doc comments, and regenerate docs/reference — see Docs
        status: pending
---

## Context

[`frozenCheck`](../../src/spec/pr/frozen.ts) builds `shas` only from the contracts it checks (the ones given, or every `contracts/*.json` when none are given). A changed `test/spec/*.ts` is `generated` (spec side) only when its single `// vector-contract-sha256:` line is in that set. nish runs `vector spec frozen` in CI on every PR that touches `specs/`, `contracts/` or `test/spec/`, and it gives a subset of contracts.

## Stage fix

**Owns:** `src/spec/pr/frozen.ts`, `tests/spec/pr/frozen_test.ts`, `tests/spec/pr/e2e_test.ts`, `tests/spec/pr/repo.ts`, `tests/run.mjs`, `tests/cli/pr-frozen-*/**`, `tests/fixtures/frozen-*/**`, `docs/guide/guides/pr-gates.md`, `.claude/skills/vector-spec/SKILL.md`, `docs/reference/**` and `scalar.config.json` (regenerated only)

One stage, one PR: the fix, its tests and its guide change have to land together (CLAUDE.md), and the test infrastructure exists only to test this fix.

## Reproduction

Reproduced on `main` at f787185 with `dist/vector` in a throwaway repo holding `rfcs/rfc4648.txt`, valid `contracts/a.json` and `contracts/b.json`, and `test/spec/a.ts` / `test/spec/b.ts` whose sha lines name them:

| PR on top of main | command | today | after the fix |
| --- | --- | --- | --- |
| both contracts and both tests change | `spec frozen --base main contracts/a.json` | exit 1, `implementation test/spec/b.ts`, "touches the spec side … and the implementation (test/spec/b.ts)" | exit 0, both tests `generated`, only `✓ contract contracts/a.json` |
| same | `… contracts/a.json contracts/b.json` or no contracts | exit 0 | exit 0 (unchanged) |
| `src/x.ts` changes and `test/spec/b.ts` is edited | `… contracts/a.json` | **exit 0**, both `implementation` (a generated test loosened in the PR that changes code) | exit 1, both-sides problem |

The worker re-runs the first and last rows itself before changing `frozen.ts`, and the new goldens must fail on the unfixed binary.

## Approach

- Classification and checking are separate sets. **Checked** = the given contracts (or every `contracts/*.json` when none are given), as today: each is resolved with `frozenResolve`, loaded, and its problems reported. **Classifying** = checked ∪ `frozenDefaultContracts(top)`: the SHA-256 of each file's bytes as it is in the work tree. A contract that is only in the classifying set is never loaded for problems and never listed as `✓/✗ contract`.
- The rule for a test is unchanged except for the set: exactly one sha line, and that sha is in the classifying set, means `generated`. No sha line, two or more lines, or a sha that matches no contract stays `implementation`. `*.survivors.json` sidecars stay out of both sets.
- "Every contract under contracts/" rather than "every changed contract": a test regenerated against an unchanged contract (a pure emitter bump) is also spec side, and the work tree's contracts are what the test must match.

## Golden repo fixtures

A golden today is `cmd`/`stdout`/`stderr`/`exit`, run from the repo root, so it cannot express a git base. Add an optional `repo` file to a case, one line naming a fixture directory (from the repo root) that holds `base/` and `head/`:

1. copy `base/` into a fresh temp dir, `git init -b main`, set a local user, commit;
2. `git checkout -b work`, replace the tree with `head/` (files absent from `head/` are deleted), `git add -A`, commit;
3. substitute `{{repo}}` in `cmd` with the temp dir; run `dist/vector` with `GIT_DIR`, `GIT_WORK_TREE` and `GIT_INDEX_FILE` unset (as [`e2e_test.ts`](../../tests/spec/pr/e2e_test.ts) does);
4. replace the temp dir with `<repo>` in stdout and stderr before comparing; remove the temp dir.

Fixtures live in `tests/fixtures/frozen-*/` so biome (which ignores `tests/fixtures/**`) never reformats a contract whose bytes a sha line pins. Document the `repo` file in run.mjs's header comment. A case whose `repo` names a missing fixture is a FAIL, not a skip.

## Goldens

| case | fixture | cmd | exit |
| --- | --- | --- | --- |
| `tests/cli/pr-frozen-two-contracts/` | `tests/fixtures/frozen-two-contracts/` — head changes `contracts/a.json`, `contracts/b.json`, `test/spec/a.ts`, `test/spec/b.ts` | `vector spec frozen --base main --repo {{repo}} contracts/a.json` | 0 |
| `tests/cli/pr-frozen-mixed/` | `tests/fixtures/frozen-mixed/` — head changes `contracts/b.json`, `test/spec/b.ts` and `src/x.ts` | same | 1 |

Both may share one base. The `stdout` of the first lists only `✓ contract contracts/a.json` and both tests as `generated`; the second names `test/spec/b.ts` on the spec side and `src/x.ts` on the implementation side. Check each golden fails on the unfixed binary (stash the fix, rebuild, run `node tests/run.mjs pr-frozen`).

## The fix

In [`src/spec/pr/frozen.ts`](../../src/spec/pr/frozen.ts), `frozenCheck`: keep the `given`/`files`/`contractProblems` loop as is; build `shas` from `files` plus `frozenDefaultContracts(top)` (deduplicated by path). Keep the work in a helper if it reads better. A new export needs a doc comment and a test that calls it by name (`npm run tested-exports`). Update the module's header comment and `FROZEN_GENERATED`'s doc comment, which today say "a contract the gate checks".

## Tests

Table-driven in [`tests/spec/pr/frozen_test.ts`](../../tests/spec/pr/frozen_test.ts), on a repo with contracts `a` and `b` and only `a` given unless the row says so:

| change | want |
| --- | --- |
| a, b and both tests change | OK; `test/spec/b.ts` is `generated`; `contracts/b.json` not listed as checked |
| `test/spec/b.ts` regenerated, `b` unchanged, `src/` untouched | OK, `generated` |
| `test/spec/b.ts` edited and `src/x.ts` changed | refused, both sides |
| `contracts/b.json` + `test/spec/b.ts` + `src/x.ts` | refused, b.ts on the spec side |
| a test with no sha line, alongside a contract change | `implementation`, refused |
| a test with two sha lines (a's and b's) | `implementation` |
| a test whose sha names no contract | `implementation` |
| a test naming a `*.survivors.json` sidecar's bytes | `implementation` |
| `contracts/b.json` broken (source sha mismatch), not given | no problem about b reported |
| no contracts given | unchanged from today (both checked) |

Keep every existing frozen and e2e case passing unchanged.

## Docs

- [`docs/guide/guides/pr-gates.md`](../../docs/guide/guides/pr-gates.md), the frozen section's **generated** bullet: a test whose one sha line names a contract in `contracts/` or one given on the command line; only the given contracts are checked. Also say so in the vector-spec skill's Freeze step if it implies otherwise.
- Regenerate `docs/reference/**` (and its routes in `scalar.config.json` if they move) with `node scripts/gen-reference.mjs`; never edit them by hand.

## Out of scope

- A deleted generated test (no work-tree file to read) still classes as `implementation`, as today.
- Symbolic links in `contracts/`: the classifying set reads `frozenDefaultContracts` as the no-argument path already does.
- No change to `spec stale`, `exports` or `mutate`, to the exit codes, or to `CHANGELOG.md` and versions.

## Verification

```bash
npm run build
node tests/run.mjs frozen
node tests/run.mjs pr-frozen
npm run lint
npm run tested-exports
npm run dogfood
node scripts/gen-reference.mjs --check
node scripts/check-links.mjs
```

CI (`ci.yml`) runs the full `npm test`.
