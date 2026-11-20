---
name: Open issues pass
overview: Fix the open, unowned issues on amritk/vector — the symlink escape in `spec mutate --nish` (#195), the missing why on a not-replayed or mismatched replay in `--json` (#149 §3), and the two doc-caps gaps (#149 §5). #199 waits on #198, which another session is driving.
stages:
  - id: mutate-symlink
    title: "fix(spec): refuse a symlinked std/ in spec mutate --nish slots"
    goal: A --nish mutate slot never writes the canary or a mutant through a symbolic link into the user's checkout
    verification: npm run build && node tests/run.mjs spec/pr && node tests/run.mjs cli && npm run lint && npm run tested-exports && npm run doc-caps && node scripts/gen-reference.mjs --check
    todos:
      - id: slot-check-inside
        content: Run the seed path's inside check on each copied slot's module directories in src/spec/pr/mutaterun.ts, exiting 2 on a symlinked one — see Mutate symlink
        status: pending
      - id: slot-regular-file
        content: Unlink the slot's module and recreate it as a regular file before the canary, as runFillScratch does — see Mutate symlink
        status: pending
      - id: slot-symlink-test
        content: Add a test through vectorRun or the binary with a symlinked std/ (and a symlinked module file) that fails without each check — see Mutate symlink
        status: pending
      - id: ai-doc-none-in-scope
        content: Say in docs/AI.md that a change with changed lines but none in scope exits 1, within its 6400-byte cap — see Mutate symlink
        status: pending
  - id: replay-detail
    title: "feat(verify): say why a witness did not replay in --json"
    goal: verify --json and diff --json carry the replay's detail next to a not-replayed or mismatch verdict
    verification: npm run build && node tests/run.mjs verify && node tests/run.mjs cli && npm run lint && npm run tested-exports && node scripts/gen-reference.mjs --check
    todos:
      - id: carry-detail
        content: Keep ReplayOutcome.detail on FeedbackItem and DiffCheck beside replay in src/verify — see Replay detail
        status: pending
      - id: emit-detail
        content: Emit replayDetail in verify --json counterexamples and diff --json witnesses when replay is not-replayed or mismatch, never when confirmed — see Replay detail
        status: pending
      - id: detail-tests
        content: Pin replayDetail for a division-by-zero witness, a mismatch and a confirmed one, through vectorRun or goldens — see Replay detail
        status: pending
      - id: proving-doc
        content: Document replayDetail in docs/guide/guides/proving.md beside replay — see Replay detail
        status: pending
  - id: doc-caps
    title: "fix(ci): carry a doc cap across a rename and check caps on push to main"
    goal: A renamed capped doc keeps its cap under the new path, and a direct push to main cannot raise or drop a cap unchecked
    verification: node --test scripts/doc-caps.test.mjs && npm run doc-caps && npm run lint
    todos:
      - id: rename-carry
        content: Accept a removed entry under --base when git reports its file renamed and the new path carries a cap no higher than the old one, in scripts/doc-caps.mjs — see Doc caps
        status: pending
      - id: rename-tests
        content: Add table rows to scripts/doc-caps.test.mjs for the rename and each of its look-alikes — see Doc caps
        status: pending
      - id: push-base
        content: Run doc-caps --base against github.event.before on pushes to main in .github/workflows/ci.yml — see Doc caps
        status: pending
---

## Context

Open issues on amritk/vector at main `d150a60`:

| issue | state | this run |
|---|---|---|
| #195 mutate `--nish` writes through symlinks | open, unowned | stage `mutate-symlink` |
| #149 bend-lessons follow-ups | §1, §2, §4 done by #143 / #154; §3 and §5 still open | stages `replay-detail`, `doc-caps` |
| #199 fidelity-layouts follow-up | blocked on #198, which another session is reviewing and splitting right now (round 3 at 41dd5ed, 19:47Z) | out of scope |
| #142, #177, #201 | `feature-run` tracking issues of other runs | not touched; #142 can close once #149 does |

## Mutate symlink

Owns: `src/spec/pr/mutaterun.ts` `src/spec/run/run.ts` `tests/spec/pr/**` `tests/cli/pr-mutate-*/**` `tests/fixtures/mutate*/**` `docs/AI.md` `docs/guide/guides/pr-gates.md`

With `--nish <bin>`, `mutaterunCopy` tars the whole checkout into each slot, keeping symlinks, and `mutaterunLoop` then writes the canary and every mutant at `joinPath(slot.dir, run.file)`. If `std/`, or any directory between it and the module, is a symlink, those writes reach the real checkout. `runFillScratch` in `src/spec/run/run.ts` already refuses this on the seed path, with `runCheckInside` and unlink-then-`createFileExclusiveSync`. Reuse it rather than writing a second rule (export it from `run.ts` with a doc comment if needed, prefixed by its module per CLAUDE.md). Refuse with exit 2, before any write, and say which part of the path is a link.

The test drives `vectorRun` or `dist/vector` on a root whose `std` is a symlink to another directory, and asserts both the exit 2 and that the target's module file is byte-identical afterwards. Add a neighbour row with a symlink deeper than `std/` and one where the module file itself is a link (that one is not refused: it is unlinked and recreated, and the link target is unchanged). Delete each condition you add and show a row failing.

The `docs/AI.md` line (from #195's last paragraph): a change with changed lines but none in scope exits 1, as `docs/guide/guides/pr-gates.md` already says. AI.md is 6334/6400 bytes; shorten in place if the line does not fit, never raise its cap. If the refusal message is new to users, `pr-gates.md` names it.

## Replay detail

Owns: `src/verify/**` `tests/verify/**` `tests/cli/verify-*/**` `tests/cli/diff-*/**` `tests/fixtures/replay*/**` `docs/guide/guides/proving.md`

`ReplayOutcome` (`src/verify/solve/replay.ts:61-77`) already has `detail`: the first check that differed for a mismatch, why for not-replayed. Only `outcome` reaches `FeedbackItem.replay` (`src/verify/verify.ts:92`) and `DiffCheck.replay` (`src/verify/equiv/diff.ts:492`). Carry `detail` alongside, and emit it as `"replayDetail"` next to `"replay"` (`verify.ts:521`, `diff.ts:991`) only when replay is `not-replayed` or `mismatch`. A confirmed witness gets no `replayDetail`, so existing confirmed goldens do not change. The text is the detail as `replay.ts` writes it; do not rephrase it in the emitter.

Tests: a diff whose witness divides by zero (`#149`'s case) shows a `replayDetail` naming the division; a forged mismatch (reuse `tests/verify/mismatch_test.ts`'s forge) shows the differing check; a confirmed one has no key. Assert through `vectorRun` or a `tests/cli/` golden.

`proving.md:38` and `:204` describe `"replay"`; add `"replayDetail"` beside it in each.

## Doc caps

Owns: `scripts/doc-caps.mjs` `scripts/doc-caps.test.mjs` `.github/workflows/ci.yml`

**This stage touches `.github/workflows/ci.yml`, a sensitive path: it stops at a green, converged PR for a human merge, as #143 did.**

Rename (`doc-caps.mjs:100-104`): with `--base`, a base entry missing from the current caps is refused. Accept it only when `git diff --name-status -M <base> HEAD` reports that file renamed (`R`) to a path the current caps list with a cap no higher than the base's. Keep refusing:

- a removed entry with no rename,
- a rename whose new path carries a higher cap or no cap,
- a rename to a path that was already capped at the base (that would drop one cap),
- a file deleted outright.

Each gets a row in `doc-caps.test.mjs` beside the passing rename. A git failure while reading renames exits 2, like the other unreadable-base cases.

Push (`ci.yml`): the `--base` check runs only on `pull_request`. On `push` to `main`, fetch `github.event.before` and run `npm run doc-caps -- --base "$BEFORE"`, skipping when `before` is all zeros (a new branch). Keep every action pinned to its SHA (the first CI step checks this).

## Out of scope

- #199 and #198: another session is driving #198, which owns `src/spec/gates/fidelity.ts`, `src/spec/gates/text.ts` and `src/spec/source/rfc.ts`. #199's byte-parts and pre-existing `gateLitCheck` weaknesses wait for it.
- #149 §3's stale #146 PR body (merged, cosmetic).
- Closing #142, #149, #177 or #195: done at close-out, once their items have merged.

## Verification

Each stage's `verification` line, then the CI table in the ledger. `npm test` runs on every push in CI.
