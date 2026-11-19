---
name: Check a main-RFC spec's command rows against the spec's own section
overview: In a spec with keyword vector-main-RFC<N>, a vector whose Source is a code span is fidelity-checked against RFC N at the spec's table section number. Check it against the spec's own section instead, as a non-main spec does, and pin both sides with goldens.
stages:
  - id: command-section
    title: "fix(spec): check a main-RFC spec's command rows against the spec's own section"
    goal: A command row in a main-RFC spec has its arguments checked against the spec section that holds its table, in extract and in check, while cited rows keep reading the RFC
    verification: npm run build && node tests/run.mjs spec && node tests/run.mjs extract && node tests/run.mjs check && npm run lint && npm run tested-exports && npm run dogfood && npm run doc-caps
    todos:
      - id: repro-fixture
        content: Add a main-RFC4648 fixture under tests/fixtures/ whose spec section 6 Test Vectors table holds one command row (python3 -c), with a passing variant (the section prints the args) and a refusing one (it does not), md and xml
      - id: failing-goldens
        content: Add tests/cli/ golden cases that extract both variants through dist/vector, and see the passing one fail on main with the RFC section 6 message before any fix
      - id: profile-section-source
        content: In src/spec/profile/profile.ts, when the main source is an RFC, give a command vector's section the spec as its source and declare the spec's own XML among the contract's sources, only when a command row needs it
      - id: gate-lookup
        content: Make gateArgsAt in src/spec/gates/cite.ts, and so the fidelity gate, resolve a command vector's section in the spec it names, so spec check agrees with spec extract
      - id: schema
        content: Update schemas/rfc-contract.json so the vector section's description and any new field say which source the section is in, and keep every existing contract byte-identical
      - id: unit-tests
        content: Add table-driven tests in tests/spec/ (profile and fidelity) for the neighbours too — command row in a main and a non-main spec, cited row in a main-RFC spec, args printed and not printed
      - id: docs
        content: Update docs/guide/guides/writing-a-spec.md (the Source table and the main-source section) and docs/AI.md if it covers this, then regenerate docs/reference with the repo's generator
---

## Context

In vector 0.5.0, [profile.ts](../../src/spec/profile/profile.ts) sets a command vector's `section` to the number of the spec section holding its table (`v.section = section`, around line 2507). The schema calls that field "the main-source section printing the args" ([rfc-contract.json](../../schemas/rfc-contract.json), around line 871). [gateArgsAt](../../src/spec/gates/cite.ts) turns it into a citation with no source, and `sourceFind(set, null)` gives the main source. In a non-main spec that is the spec, so the lookup is right. In a `vector-main-RFC<N>` spec it is RFC N, and the spec itself is not even among the contract's `sources` (`profileBuild` adds it only when `c.mainRfc < 0`). So the spec's §6 is looked up as RFC 4648's §6, "Base 32 Encoding".

Reproduced on main at 230cf32 with a hand-built XML in the session scratchpad:

```
main-RFC4648, §6 prints "Input = 666f6f":  fidelity: the 3-byte args[0] is not printed in RFC §6 ("Base 32 Encoding")   exit 1
same spec, no keyword:                     passes                                                                         exit 0
no keyword, §6 does not print the args:    fidelity: the 3-byte args[0] is not printed in §6 ("Test Vectors")             exit 1
```

So a non-main spec checks a command row's args against its own table section's text (the Call cell alone is not enough; the section must print `Input = 666f6f`). The main-RFC profile should do the same.

## Approach

Check against the spec's own section (the requirement's first choice), not refuse. A command row's inputs are the author's own, so the spec is their source whatever the main source is. The catch is that a main-RFC contract has no source for the spec. The fix adds one, `{id: <name>, path: "../specs/<name>.xml"}`, the same declaration a non-main contract has, and points the command vector's section at it. Add it only when a command row exists, so every committed contract (none of them has a command row under a main RFC) stays byte for byte the same and `spec extract --check` and frozen hashes do not move.

The worker picks the field shape (a source id on the vector, or a citation on its command source) and records the choice in the PR body. Constraints:

- A cited row (`{{Section N of RFCx}}`) in a main-RFC spec still resolves in the RFC. The spec's own BCP 14 sentences must not become a completeness obligation just because the spec is now a declared source. If declaring it does trigger completeness or provenance on the spec, the worker gates that off for this source and tests it.
- The refusal for an unprinted arg names the spec's section, `§6 ("Test Vectors")`, as a non-main spec's does, never `RFC §6`.
- The profile's existing refusal of a Source anchor to a spec section in a main-RFC spec (`profileOwnText`) is unchanged.

**Alternative, if sign-off picks it:** refuse a command row in a main-RFC spec at extract, with a message that says the main source is RFC N and a command row has no section of it to check its args against. Same fixture, goldens and Owns. No schema change and no `profile-section-source`/`gate-lookup` todos.

## Check a main-RFC spec's command rows against the spec's own section

| File | Change |
|---|---|
| [src/spec/profile/profile.ts](../../src/spec/profile/profile.ts) | command vector's section carries the spec as its source when `c.mainRfc >= 0`; `profileBuild` declares the spec's own source then |
| [src/spec/gates/cite.ts](../../src/spec/gates/cite.ts) | `gateArgsAt` returns a citation with that source |
| [src/spec/contract/](../../src/spec/contract/) | the contract type, its JSON reader and writer, for the new field |
| [schemas/rfc-contract.json](../../schemas/rfc-contract.json) | the field and its description |
| `tests/fixtures/<new>/` | the main-RFC4648 command-row specs, `.md` and `.xml` |
| `tests/cli/<new>/` | goldens: extract passes, extract refuses on the spec's section, `spec check` agrees |
| `tests/spec/**` | table-driven unit tests |
| [docs/guide/guides/writing-a-spec.md](../../docs/guide/guides/writing-a-spec.md), [docs/AI.md](../../docs/AI.md) | where a command row's args are checked when the main source is an RFC |

**Owns:** `src/spec/**`, `schemas/rfc-contract.json`, `tests/spec/**`, `tests/cli/**`, `tests/fixtures/**`, `docs/guide/guides/*.md`, `docs/AI.md`, `docs/reference/**`, `scalar.config.json`, `contracts/*.json`, `tests/dogfood/**`

`docs/reference/**`, `scalar.config.json`, `contracts/*.json` and `tests/dogfood/**` are owned only so they can be regenerated. `contracts/*.json` should not change at all, and a diff there is a finding.

## Out of scope

- The completeness noise a small main-RFC4648 fixture draws (RFC 4648's own MUST sentences). The fixture covers or excludes them; the rule does not change.
- Any change to how cited rows, `Iterate:` or `Truncate:` resolve.
- `--run-sources`, which runs the command. Only where its args are checked changes.

## Tests

Mirror [profile_dh_test.ts](../../tests/spec/extract/profile_dh_test.ts) and [fidelity_test.ts](../../tests/spec/gates/fidelity_test.ts) for the unit side, and [extract-truncate-unprinted](../../tests/cli/extract-truncate-unprinted/) for a refusing golden. Each new condition lands with a test shown to fail without it: revert the profile change and the passing golden must go red with the `RFC §6 ("Base 32 Encoding")` message.

## Verification

```
npm run build
node tests/run.mjs spec
node tests/run.mjs extract
node tests/run.mjs check
npm run lint
npm run tested-exports
npm run dogfood
npm run doc-caps
for f in specs/*.xml; do ./dist/vector spec extract "$f" -o "contracts/$(basename "$f" .xml).json" --check; done
```
