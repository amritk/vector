---
name: Make frozen and mutate fit to gate nish's spec-first PRs
overview: nish runs vector 0.5.0's spec frozen and spec mutate only as advisory CI steps, for four design reasons. This plan fixes each one so nish can make both gates required — the reference cache counts as spec side, a pure rename of a contracted export may land in one PR, mutate only mutates code the contract tests, and mutate builds from a seed with the root's std/ laid over it, so it no longer needs a compiler built from the checkout.
stages:
  - id: frozen-refcache
    title: "feat(spec): count the kramdown-rfc reference cache as spec side in frozen"
    goal: A PR that adds a spec and the .refcache/ entries for the references it cites is one side, not both
    verification: npm run build && node tests/run.mjs frozen && npm run lint && npm run tested-exports && npm run doc-caps
    todos:
      - id: refcache-kind
        content: Class .refcache/ paths as FROZEN_SPEC in frozenPathKind, and update the frozen module comment — see Frozen refcache
      - id: refcache-tests
        content: Add table-driven frozenPathKind rows and a both-sides golden for .refcache/ next to its neighbours — see Frozen refcache
      - id: refcache-docs
        content: Update the frozen section of pr-gates.md, docs/AI.md item 12 and the vector-spec skill's spec-side list — see Frozen refcache
  - id: frozen-rename
    title: "feat(spec): let frozen accept one PR that only renames a contracted export"
    goal: A PR whose whole change is renaming exports a contract tests, on both sides at once, passes frozen, and the report says it passed as a rename
    verification: npm run build && node tests/run.mjs frozen && node tests/run.mjs rename && npm run lint && npm run tested-exports && npm run doc-caps
    todos:
      - id: rename-detect
        content: Add src/spec/pr/rename.ts that pairs the functions a contract drops and adds since the fork point into a rename map — see Frozen rename
      - id: rename-check
        content: Check every changed file maps back to its fork-point text under the rename map, fail closed on anything else — see Frozen rename
      - id: rename-wire
        content: Wire the rename path into frozenCheck so a pure rename passes with a rename line in the report, and any other both-sides change still fails — see Frozen rename
      - id: rename-tests
        content: Add unit tests and golden cases for a passing rename and each refusal that neighbours it — see Frozen rename
      - id: rename-docs
        content: Document the rename path in pr-gates.md, docs/AI.md and the vector-spec skill — see Frozen rename
  - id: mutate-scope
    title: "feat(spec): mutate only the code a contract tests"
    goal: Mutants come only from changed lines inside the declarations the contract's functions reach, and changed lines elsewhere in the module are reported as a note, never as survivors
    verification: npm run build && node tests/run.mjs mutate && node tests/run.mjs e2e && npm run lint && npm run tested-exports && npm run doc-caps
    todos:
      - id: scope-reach
        content: Compute the module's top-level declarations reachable from the contract's functions — see Mutate scope
      - id: scope-sites
        content: Restrict mutateSites to changed lines inside reachable declarations and pass the contract in from mutateCheck — see Mutate scope
      - id: scope-report
        content: Report changed lines left unmutated as one note naming their declarations, and keep the no-mutants refusal for a change with nothing in scope — see Mutate scope
      - id: scope-tests
        content: Add table-driven reachability tests and an e2e case where an out-of-scope edit yields no survivors — see Mutate scope
      - id: scope-docs
        content: Update the mutate section of pr-gates.md, docs/AI.md and the vector-spec skill — see Mutate scope
  - id: mutate-overlay
    title: "feat(spec): build mutants from the root's seed with its std/ laid over it"
    goal: spec mutate --nish-root on a nish checkout with build/seed, or an install, needs no build/nish, and still passes its canary
    verification: npm run build && node tests/run.mjs mutate && node tests/run.mjs e2e && node tests/run.mjs run && npm run lint && npm run tested-exports && npm run doc-caps
    todos:
      - id: overlay-slots
        content: Make each mutate slot a scratch install from runSeedOf with the root's std/, instead of a copy of the checkout, when --nish is not given — see Mutate overlay
      - id: overlay-canary
        content: Keep the baseline and canary on the overlaid slot, and keep --nish as the explicit copy-the-checkout path — see Mutate overlay
      - id: overlay-errors
        content: Replace the unbuilt-checkout error with one that names build/seed and scripts/fetch-seed.sh — see Mutate overlay
      - id: overlay-tests
        content: Add tests that drive the overlay path through vectorRun and the binary, including a canary failure — see Mutate overlay
      - id: overlay-docs
        content: Rewrite the mutate compiler section of pr-gates.md and update docs/AI.md, exit-codes.md and the vector-spec skill — see Mutate overlay
---

## Context

nish gates its spec-first PRs with vector's [`spec frozen`](../../src/spec/pr/frozen.ts) and [`spec mutate`](../../src/spec/pr/mutaterun.ts), but only as advisory steps, for four reasons, each a design question:

1. `frozenPathKind` classes `.refcache/` as implementation, so a spec PR that commits the kramdown-rfc cache entry for a newly cited RFC ([`scripts/build-spec.sh`](../../scripts/build-spec.sh) requires it to be committed) is "both sides".
2. Renaming a contracted function cannot be done without a broken main: the spec PR declaring the new name fails `check --nish-root`, and the code PR may not touch the spec.
3. `mutateSites` mutates every changed line of the module. A contract that covers part of a module and lists the rest as `outOfScope` gets survivors it cannot kill from every edit to an out-of-scope export (nish/net/websocket: 29 of 40 survivors).
4. `mutate --nish-root` copies the whole checkout per slot and needs `build/nish` (about three minutes of CI per run), while `spec run --nish-root` builds with the seed and overlays the root's `std/` ([`runMakeScratch`](../../src/spec/run/run.ts)).

## Approach

Two tracks run in parallel, each two stages in order: **frozen** (refcache, then rename) and **mutate** (scope, then overlay). The stages in a track share `frozen.ts` or `mutaterun.ts`, so the second starts once the first merges. Each first stage is worth merging alone.

Every new rule fails closed, and each lands with a test that fails without it, driven through `vectorRun` or the binary (CLAUDE.md, Definition of done).

**Shared docs exception.** Both tracks edit [`docs/guide/guides/pr-gates.md`](../../docs/guide/guides/pr-gates.md), [`docs/AI.md`](../../docs/AI.md) and [`.claude/skills/vector-spec/SKILL.md`](../../.claude/skills/vector-spec/SKILL.md), because CLAUDE.md requires a user-visible change to update its guide in the same PR. The frozen track edits only the frozen parts (pr-gates `## frozen`, AI.md item 12, the skill's spec-side and frozen steps). The mutate track edits only the mutate parts (pr-gates `## mutate`, AI.md item 11 and the mutate line, the skill's step 7, exit-codes' mutate row). The hunks are disjoint, so git merges them. A conflict goes back to the worker. `docs/AI.md` sits at 6359 of 6400 bytes, so each edit replaces words and does not add them.

## Frozen refcache

**Owns:** `src/spec/pr/frozen.ts`, `src/cli/spec-frozen.ts`, `tests/spec/pr/frozen_test.ts`, `tests/cli/pr-frozen-*/**`, `tests/fixtures/frozen-*/**`, `docs/guide/guides/pr-gates.md` (frozen section), `docs/guide/guides/spec-to-contract.md`, `docs/guide/guides/file-formats.md`, `docs/AI.md` (frozen item), `.claude/skills/vector-spec/SKILL.md` (frozen and refcache parts)
**Model:** sonnet

The frozen track does not edit the shared test helper `tests/spec/pr/repo.ts` (the mutate track owns it) or `tests/spec/pr/e2e_test.ts`. It keeps any new helper in its own test file.

- `frozenPathKind`: `.refcache/…` is `FROZEN_SPEC`, beside `specs/`, `contracts/` and `rfcs/`. Match the directory prefix exactly (`.refcache/x`), not `.refcache-old/` or `a/.refcache/`. `build-spec.sh` fixes the name as `<repo>/.refcache`, so the gate reads it at the repository's top only.
- Decided at sign-off: `.refcache/` only. No config file and no flag for extra spec-side paths.
- Tests: table rows for `.refcache/reference.RFC.8439.xml` (spec), `.refcache` with no slash, `.refcache-x/y`, `sub/.refcache/y` (implementation), and a golden `pr-frozen-refcache` whose fixture adds a spec and a `.refcache/` entry and exits 0, plus one that adds a `.refcache/` entry and `src/` code and exits 1.

## Frozen rename

**Owns:** everything Frozen refcache owns, plus `src/spec/pr/rename.ts`, `tests/spec/pr/rename_test.ts`
**Depends on:** frozen-refcache (starts after it merges)

The rename path is an exception to "both sides", so it computes the rename and never assumes it:

1. For each checked contract, load it at the fork point (`gitdiffShow`) and in the work tree. `functions` names dropped and names added form the candidates. Pair them only when exactly one is dropped and one is added per contract, and their `FnSig` is equal apart from `name`. Anything else (two dropped and one added, a changed param) means no rename, and the ordinary both-sides rule applies.
2. Refuse the rename (report why) when the new name occurs, as an identifier token, in the fork-point text of any changed file, since then mapping back is ambiguous.
3. Every changed path must exist at both the fork point and now: an added or deleted file refuses. For each one, replace each new name with its old name at identifier boundaries and compare with the fork-point text. Equal means it is the rename alone. The only lines exempt are those the gate already re-verifies: a contract's recorded `sha256` values (checked against the sources by `frozenContractProblems`) and a generated test's `// vector-contract-sha256:` line (spec side by the existing rule). A `specs/*.xml` whose mapped text differs only because xml2rfc reflowed it still refuses. The worker states in the PR how the nish case (the .md, the .xml and the module) maps back, or says it does not.
4. When every changed file passes, frozen passes and the report carries `rename <contract>: <old> → <new> (N files are the rename alone)` as a note. When any file fails, the report gives the both-sides problem as today, plus one line naming the first file that is not the rename alone.
- Tests (table-driven, each shown to fail with its condition deleted): a pure rename across spec, contract, generated test and module passes. The neighbours each refuse: an extra edit in one file, the new name already in use, two functions dropped, a changed signature, an added file, a rename of an export the contract does not test, and a reflowed xml line.

## Mutate scope

**Owns:** `src/spec/pr/mutate.ts`, `src/spec/pr/mutaterun.ts`, `src/spec/pr/scope.ts` (new), `tests/spec/pr/mutate_test.ts`, `tests/spec/pr/mutateemit_test.ts`, `tests/spec/pr/mutateshape_test.ts`, `tests/spec/pr/scope_test.ts` (new), `tests/spec/pr/e2e_test.ts`, `tests/spec/pr/repo.ts`, `tests/cli/pr-mutate-*/**`, `tests/fixtures/mutate/**`, `docs/guide/guides/pr-gates.md` (mutate section), `docs/guide/guides/exit-codes.md`, `docs/guide/guides/testing.md`, `docs/AI.md` (mutate lines), `.claude/skills/vector-spec/SKILL.md` (mutate step)

- **Reachability.** Lex the module (`lexTokens`, `lexStatements`) into top-level declarations, named as `gitdiffExports` names them, whether exported or not. The roots are the contract's `functions[].name`. A declaration is reachable when a reachable declaration's tokens name it as an identifier (a call, a reference to a const or class, or a type). Closure is transitive. Reachability wins over `outOfScope`: an out-of-scope export that a tested function calls is mutated.
- **Sites.** A changed line is mutated when it lies inside a reachable declaration's span. Changed lines outside every declaration (imports) are not mutated, as today's sites already skip non-code. A module the scanner cannot split into named declarations (unnamed export, lex failure) falls back to mutating every changed line, as now, with a note saying why. It never silently mutates fewer lines.
- **Report.** One note: `N changed lines outside the tested functions were not mutated: <decl>, <decl>`. When changed lines exist but none is in scope, it says so instead of the bare `no mutants` refusal, and still exits 1, since the change touches nothing the contract can judge. Decided at sign-off: exit 1.
- Tests: reachability rows (direct call, transitive call, const reference, type reference, a shadowing local of the same name, an out-of-scope export called by a tested one, an unreachable out-of-scope export). An e2e case on a fixture module with one tested and one out-of-scope export, where an edit to the out-of-scope export produces no mutants and the note, and an edit to the tested one still produces survivors.

## Mutate overlay

**Owns:** everything Mutate scope owns, plus `src/cli/spec-mutate.ts`, `src/spec/run/run.ts`, `tests/spec/emit/run_test.ts`
**Depends on:** mutate-scope (starts after it merges)

- When `--nish` is not given, each slot is a scratch install made like `runMakeScratch`: the root's seed (`runSeedOf`: an install's own `libexec/nish`, or a checkout's `build/seed`) without its std, plus the root's `std/`. The slot's compiler is `<slot>/libexec/nish`. The mutant is written into the slot's `std/<module>`. Reuse or export the run.ts helpers. Do not copy them.
- Per slot, the baseline (unmutated, must pass) and the canary (module made unparseable, must fail with an error located in the module) run as today. The canary is what proves the seed reads the overlaid std/.
- `--nish <bin>` keeps today's behaviour: copy the checkout and run that compiler from it, for a checkout whose std/ the seed cannot compile.
- A root with neither seed nor `--nish` exits 2 with a message naming `build/seed` and `bash scripts/fetch-seed.sh` (no build needed). Update the `pr-mutate-unbuilt-*` goldens.
- Tests: through `vectorRun` or the binary, an overlay run against an install root kills mutants with no `--nish`, a seed whose compiler ignores the overlay fails the canary (exit 2), and `--nish` still takes the copy path. Note in the PR the measured slot-setup time against the copy path.

## Out of scope

- nish's own CI. Making the gates required there is nish's change, after a vector release carries these.
- `spec stale`, `spec exports`, `spec run`'s behaviour.
- Version bumps and CHANGELOG (release-please).

## Verification

Each stage's `verification` line, plus `npm test` in CI. Generated files are regenerated, never hand-edited: `docs/reference/**` and its routes in `scalar.config.json` (`node scripts/gen-reference.mjs`), `tests/dogfood/**`, `contracts/*.json`, `specs/*.xml`.

## Acceptance criteria

Checked against `main` after the last merge, by running `dist/vector` on fixture repositories (the gates have no UI, so there is no browser pass).

1. A change that adds a spec, its contract and a `.refcache/reference.RFC.<n>.xml` entry passes `vector spec frozen --base main` (exit 0) and lists the `.refcache/` path as spec.
2. A change that adds a `.refcache/` entry and an implementation file is refused by `spec frozen` as both sides (exit 1).
3. A change whose whole diff renames one export a contract tests (spec `.md` and `.xml`, contract, generated test, module) passes `spec frozen` (exit 0), and the report names the rename `old → new`.
4. The same rename plus any one other edit, on either side, is refused by `spec frozen` (exit 1).
5. `spec mutate` on a change that edits only an export the contract lists as out of scope, and that no tested function reaches, reports no survivor from those lines and names them in a note.
6. `spec mutate` on a change to a tested function, or to a helper it calls, still mutates those lines and refuses a survivor (exit 1) as before.
7. `spec mutate --nish-root <dir>` with no `--nish`, on an install or on a checkout with `build/seed` and no `build/nish`, builds the mutants, passes its canary, and judges them.
8. `spec mutate` exits 2 when the compiler it builds with does not read the overlaid `std/` (the canary still builds).
9. `docs/guide/guides/pr-gates.md` and `docs/AI.md` describe all four changes, and `npm test`, `npm run lint`, `npm run tested-exports`, `npm run dogfood` and `npm run doc-caps` pass on `main`.
