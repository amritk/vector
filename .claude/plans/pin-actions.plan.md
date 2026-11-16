---
name: Pin every GitHub Action to its latest release's commit SHA
overview: The workflows reference actions by moving tags (`@v7`, `@v1`). Pin each to the full commit SHA of its latest release, with the release named in a trailing comment so Dependabot keeps updating it, and add a CI step that refuses an unpinned `uses:`.
stages:
  - id: pin-actions
    title: Pin actions by SHA
    goal: Every `uses:` in .github/workflows is a 40-hex commit SHA of the action's latest release, and CI refuses one that is not.
    verification: "test -z \"$(grep -rhoE 'uses:[[:space:]]*[^[:space:]]+' .github/workflows | grep -vE '@[0-9a-f]{40}$')\""
    todos:
      - id: pin-ci-docs-spec
        content: Replace each tag ref in ci.yml, docs.yml and spec.yml with its release's commit SHA plus a `# vX.Y.Z` comment — see Pins
        status: pending
      - id: guard-step
        content: Add a step to ci.yml's `check` job that fails when any `uses:` in .github/workflows is not pinned to a 40-hex SHA — see Guard
        status: pending
---

# Pin every GitHub Action to its latest release's commit SHA

## Pins

Owns: `.github/workflows/ci.yml`, `.github/workflows/docs.yml`, `.github/workflows/spec.yml`

Resolved on 2026-11-16 with `git ls-remote` and a shallow fetch of each tag (the
SHA is the tag's **commit**, dereferenced from an annotated tag, not the tag
object). Every release below is older than Dependabot's 5-day cooldown.

| Action | Was | Pin to | Commit SHA |
| --- | --- | --- | --- |
| actions/checkout | `@v7` | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| actions/setup-node | `@v7` | v7.1.0 | `949feb2413d6458794dcd2491c4babbbce0c15c1` |
| actions/cache | `@v6` | v6.1.0 | `55cc8345863c7cc4c66a329aec7e433d2d1c52a9` |
| actions/setup-python | `@v7` | v7.1.0 | `6d4fd22b20465ccc0f7354476588e8df7c9ca0e0` |
| ruby/setup-ruby | `@v1` | v1.338.0 | `b3aaceaef7e0ee231b499e7b5f49c03fc1d32199` |

Form: `uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`.
Dependabot (`.github/dependabot.yml`, `github-actions`) recognises this form and
bumps the SHA and the comment together.

The worker re-resolves each SHA itself before writing it
(`git ls-remote https://github.com/<action> refs/tags/<tag> refs/tags/<tag>^{}`,
taking the `^{}` line when present) and stops if one differs from this table.

`release.yml` is already pinned: both `amritk/workflows` refs are
`1fbca09b587f26cdbe1b1633c9a435db549f5288`, the current head of its `main`,
and that repo has no tags. It is not changed. `pr-title.yml` uses no actions.

## Guard

A step in `ci.yml`'s `check` job, right after checkout, named for what it
refuses, that runs the stage's verification command and prints each offending
line with `::error::` when it fails. It runs as plain shell, with no new action
and no new dependency.
