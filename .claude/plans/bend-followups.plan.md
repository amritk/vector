---
name: bend-followups
overview: "Close the follow-ups from feature/bend-lessons (#149): document MISMATCH everywhere an agent reads exit codes, tighten the counterexample-replay tests, and stop a temp-dir leak."
stages:
  - id: mismatch-docs
    title: MISMATCH in the agent and guide docs
    goal: Every place docs/AI.md, the exit-code reference and proving.md describe exit 2 or replay also names MISMATCH as a vector bug to report.
    verification: npm run build && npm run doc-caps && node scripts/gen-reference.mjs --check && node scripts/check-links.mjs && node tests/run.mjs package && npm run lint
    todos:
      - id: ai-md-traps
        content: Name MISMATCH (exit 2, a vector bug to report, not a refusal) in docs/AI.md trap 2, trap 3, the exit-codes rule and the repair loop, under the 6400 B cap — see MISMATCH in the agent and guide docs
        status: pending
      - id: diag-comment
        content: Reword the EXIT_USAGE doc comment in src/core/diag.ts (and its module comment) to include a replay MISMATCH, then regenerate docs/reference with scripts/gen-reference.mjs — see MISMATCH in the agent and guide docs
        status: pending
      - id: proving-replay
        content: Say in the replay section of docs/guide/guides/proving.md that diff witnesses are replayed too and a failed replay is diff's MISMATCH, exit 2 — see MISMATCH in the agent and guide docs
        status: pending
  - id: replay-tests
    title: Counterexample replay tests
    goal: replayPreCases says what each row tests, covers an unknown callee body, pins the unreadable-result decision, and MISMATCH's exit and emit are driven through vectorRun or exempted in writing.
    verification: npm run build && node tests/run.mjs verify && node tests/run.mjs cli && npm run lint && npm run tested-exports
    todos:
      - id: second-call-site
        content: Rename the "a second call site" row of replayPreCases in tests/verify/replay_test.ts to what it tests (a hazard index past the recorded ones), or add a real second call site and keep the name — see Counterexample replay tests
        status: pending
      - id: unknown-callee
        content: Add a QUERY_PRE row whose callee body is unknown at the counterexample, so z3's result is not compared — see Counterexample replay tests
        status: pending
      - id: unreadable-result
        content: Pin with a table row what an unreadable z3 result means for a decidable hazard (not-replayed, the verdict and exit 1 kept, the reason named) — see Counterexample replay tests
        status: pending
      - id: mismatch-vectorrun
        content: Drive verify's and diff's MISMATCH (exit 2, nothing emitted) through vectorRun with a fake z3 via VECTOR_Z3, or write the exemption beside replayVerifyMismatch — see Counterexample replay tests
        status: pending
  - id: package-tempdir
    title: Package test temp dir
    goal: indexAgentsDocBinary removes its temp dir on every path, including when realpathSync(".") returns null.
    verification: npm run build && node tests/run.mjs package && npm run lint
    todos:
      - id: tempdir-cleanup
        content: Make indexAgentsDocBinary in tests/package/index_test.ts remove the temp dir it made when root is null, before returning — see Package test temp dir
        status: pending
---

# bend-followups

## Context

#145, #146 and #143 shipped docs/AI.md, counterexample replay with a
`MISMATCH` outcome (exit 2 on both `verify` and `diff`) and doc caps. The
review of that run left follow-ups in #149: the agent doc still says exit 2
means "could not run", the replay tests have a misnamed row and two gaps,
and one package test leaks a temp dir.

Out of scope (listed in #149, not asked for here): the stale #146 PR body,
a reason field for `diff --json` not-replayed, and the doc-caps #5 items.
Another run (#151) owns `src/spec/gates/fidelity.ts`, `src/spec/extract.ts`,
`src/spec/profile/**` and `tests/cli/check-iterate-count`; no stage here
touches them.

## MISMATCH in the agent and guide docs

**Owns:** `docs/AI.md`, `src/core/diag.ts`, `docs/reference/**`, `docs/guide/guides/proving.md`, `docs/guide/guides/exit-codes.md`

- docs/AI.md is 6144 B against a 6400 B cap: 256 B of headroom. Four places
  must name MISMATCH: trap 2 (exit 2 list), trap 3 (diff), the exit-codes
  rule, the repair loop ("a MISMATCH is a bug in vector: report it, change
  nothing"). Tighten other wording in place if needed; never raise the cap.
- `EXIT_USAGE`'s comment in src/core/diag.ts feeds
  docs/reference/command-line.md:52. Reword it to cover a replay MISMATCH,
  run `node scripts/gen-reference.mjs`, commit the regenerated output. Never
  edit docs/reference by hand.
- proving.md "Every counterexample is replayed": add that `diff` replays its
  witnesses the same way, and a witness that does not replay is diff's
  `MISMATCH`, exit 2. Check exit-codes.md says the same.

## Counterexample replay tests

**Owns:** `tests/verify/replay_test.ts`, `tests/verify/mismatch*_test.ts`, `src/verify/**`, `tests/cli/verify-mismatch*/**`, `tests/cli/diff-mismatch*/**`, `tests/fixtures/mismatch*/**`, `tests/run.mjs`

- The "a second call site" row asks for hazard index 1 of a function with
  one call site, so it is MISMATCH because the index is out of range. Rename
  it to say so, and if a second call site is worth testing, add one to the
  case.
- Add a QUERY_PRE row where the callee's body is unknown at the input (for
  example a callee whose body divides by zero there), so the result check is
  skipped and the hazard is confirmed by its condition alone.
- **Decision proposed for sign-off: an unreadable z3 result on a decidable
  hazard stays `not-replayed`** — the hazard's verdict and exit 1 stand, and
  the replay reason names the unreadable value. This is what replayHazard
  does now (replayParseValue → replayUnreadable → undecided); the stage pins
  it with a row and does not change behaviour, so no documented verdict or
  exit changes and docs/AI.md stays out of this stage.
- MISMATCH through vectorRun: `VECTOR_Z3` (src/core/z3.ts) already picks the
  z3 binary, so a test can point it at a script that prints a forged model
  and run `vectorRun(["verify", ...])` / `["diff", ...]`, asserting exit 2,
  the MISMATCH line, and that `--emit` wrote nothing. If the seam cannot be
  driven from a test (setenv unavailable, or the forged model cannot be
  produced reliably), write the exemption as a comment beside
  replayVerifyMismatch and say why in the PR. A harness change to
  tests/run.mjs, if any, stays minimal.
- If the work shows a verdict or exit would change, stop and report on the
  PR instead of editing docs: the docs belong to mismatch-docs.

## Package test temp dir

**Owns:** `tests/package/index_test.ts`
**Model:** sonnet

In `indexAgentsDocBinary`, `root === null` returns after `makeTempDir`
succeeded and leaks the dir. Split the check: return early on `made`'s
error, and on a null root remove `made.value` before failing. Mirror the
existing cleanup in the same file.

## Pre-flight

All three stages run at once, with no dependency edges. Their Owns sets do not
overlap, and none of them overlaps #151's files. The globs `tests/cli/*-mismatch*/**`,
`tests/fixtures/mismatch*/**` and `tests/verify/mismatch*_test.ts` match
nothing yet. That is on purpose: they are only for new files.

## Acceptance

1. `grep -c MISMATCH docs/AI.md` finds it in trap 2, trap 3, the exit-codes rule and the repair loop, and `npm run doc-caps` exits 0 on main.
2. On main, docs/reference/command-line.md's exit-2 row names a replay MISMATCH, and `node scripts/gen-reference.mjs --check` exits 0.
3. On main, the replay section of proving.md says a diff witness that does not replay is MISMATCH, exit 2.
4. `node tests/run.mjs verify` on main has no row named "a second call site" that tests an out-of-range index. It does have a QUERY_PRE row with an unknown callee body, and a row pinning an unreadable z3 result as not-replayed.
5. On main, a test runs `verify` and `diff` through vectorRun or the binary with a forged z3 model and asserts exit 2 and no `--emit` output. If no such test exists, replay_test.ts carries a written exemption saying why.
6. On main, `node tests/run.mjs package` leaves no `vector-agents-bin-*` dir behind, and the null-root path removes the dir it made before it fails.
7. `npm test`, `npm run lint` and `npm run tested-exports` exit 0 on main after the last merge.

## Verification

Per stage, its `verification` line. Before each push: `npm run build`,
`node tests/run.mjs <area>`, `npm run lint`, `npm run tested-exports`, and
`npm run doc-caps` when docs/AI.md changed. CI (`CI / check`, `Docs / docs`,
`Spec / *`, `PR title / conventional`) is the full gate.
