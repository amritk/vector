---
name: Place the unprinted-count refusal at its Iterate paragraph
overview: Fidelity raises "the count N is not printed" at the vector's Iterate paragraph itself, so extract no longer routes a refusal by matching its message text (amritk/vector#151).
stages:
  - id: iterate-at
    title: "fix(spec): place the unprinted-count refusal at its Iterate paragraph"
    goal: No refusal is placed by matching its message text, and every placement stays where #148 put it
    verification: npm run build && node tests/run.mjs iterate && node tests/run.mjs spec && npm run lint && npm run tested-exports && npm run dogfood
    todos:
      - id: fidelity-at-iterate
        content: Raise the unprinted-count refusal at the id plus .iterate in gateIterateCount, src/spec/gates/fidelity.ts — see Fidelity
        status: pending
      - id: drop-extract-gate-key
        content: Delete extractGateKey and EXTRACT_ITERATE_COUNT from src/spec/extract.ts — see Extract
        status: pending
      - id: regen-goldens
        content: Regenerate tests/cli/check-iterate-count/stdout and any other golden that changes — see Goldens
        status: pending
      - id: test-placement
        content: Add a table-driven test that fails when either change is reverted — see Tests
        status: pending
      - id: refusal-order
        content: Sort profile refusals in XML document order only if cheap, else file a follow-up — see Refusal order
        status: pending
---

# Place the unprinted-count refusal at its Iterate paragraph

Fixes amritk/vector#151. #148 (6f68c42) is on `main`.

## iterate-at

**Owns:** `src/spec/gates/**`, `src/spec/profile/**`, `src/spec/extract.ts`, `tests/spec/**`, `tests/cli/check-*/**`, `tests/cli/extract-*/**`, `tests/cli/run-*/**`, `tests/fixtures/profile/**`, `tests/fixtures/iterate-contract/**`, `tests/dogfood/**`, `docs/**`

### Fidelity

`gateIterateCount` (`src/spec/gates/fidelity.ts`, about line 1097) calls
`gateIssue(ctx, out, GATE_FIDELITY, k.id, "the count … is not printed in …")`.
Pass `` `${k.id}.iterate` `` instead, the same form the truncation refusal
uses with `<id>.truncate`. The expected-label refusal stays at `${k.id}.expect`.

### Extract

In `src/spec/extract.ts`, delete `EXTRACT_ITERATE_COUNT` and `extractGateKey`
(about lines 452–463), and have `extractGateRowAdd` call
`profileLocate(locator, at)` directly.

### Goldens

`vector spec check` prints a gate's `at`, so the first gate line of
`tests/cli/check-iterate-count/stdout` becomes
`fidelity 5.2-ITER-2000.iterate: the count 2,000 is not printed in RFC §5.2`.
Run every `check-*`, `extract-*` and `run-*` golden and regenerate what
changes. `tests/cli/extract-iterate-count-unprinted` must still print
`.md:58 (…xml:95)` unchanged. Any fixture `.xml` is built with
`scripts/build-spec.sh`, never copied from another fixture.

### Tests

Per CLAUDE.md, a change lands with a test that fails without it. Add a
table-driven test that drives the fidelity gate and asserts the note's `at`
for the unprinted count is `<id>.iterate`, alongside its neighbours: the
expected-label refusal at `<id>.expect`, and the truncation refusal at
`<id>.truncate`. The extract golden at `.md:58` covers the placement end to
end once `extractGateKey` is gone.

### Refusal order

Only if cheap. Refusals sort by `ProfileRefusal.line`
(`src/spec/profile/profile.ts`, `profileSortRefusals`, and the sort in
`extractGateRefusals`). Since #148 that is a markdown line for a found place
and an XML line for the rest. Sorting by XML document order needs the XML
line stored for an md-only place (a refusal on a mark's own line), which it
is not today. If that means more than a small change to `ProfileRefusal`
construction plus a table test across a page of refusals, skip it and say so
in the PR body; the lead files a follow-up issue.

### Docs

No flag, exit code or install step changes. Grep `docs/` (including
`docs/AI.md`) for a printed `ITER-2000:` or other unprinted-count gate line
and update a guide page that shows one.
