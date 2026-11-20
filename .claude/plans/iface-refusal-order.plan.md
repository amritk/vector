---
name: Finish refused-interface reporting
overview: A spec with 0 or 2 ts-interface blocks reports the block-count refusal first and drops the refusals that only follow from it, as a refused block already does; the refusal-order doc comments say what the code does; a refused ts-interface module line names the hyphen rule; and the contract schema's module pattern is tested against charsIsModule.
stages:
  - id: iface-count
    title: "fix(spec): report a missing or duplicated ts-interface block first, without its cascade"
    goal: A spec with 0 or 2 ts-interface blocks prints the count refusal first and no refusal that follows only from the missing or duplicated block, while every independent refusal stays
    verification: npm run build && node tests/run.mjs spec/extract && node tests/run.mjs cli && npm run lint && npm run tested-exports && node scripts/gen-reference.mjs --check
    todos:
      - id: count-in-iface-refusals
        content: Make the count refusal in profileReadInterface a ts-interface refusal printed first — see Iface count
        status: pending
      - id: count-cascade
        content: Suppress the unknown-function and not-a-function cascade for 0 blocks, and for 2 blocks only for names a later block declares — see Iface count
        status: pending
      - id: count-tests
        content: Add tests/spec/extract/profile_iface_count_test.ts, table-driven with neighbours, and update the count pins — see Iface count tests
        status: pending
      - id: order-comments
        content: Correct the refusal-order doc comments in src/spec/extract.ts and profileRead, then regenerate docs/reference — see Order comments
        status: pending
  - id: module-message
    title: "fix(spec): name the hyphen rule when a ts-interface module line is not a module path"
    goal: A refused ts-interface module line names the segment and hyphen rule as the contract shape check does, and the schema's module pattern is tested to agree with charsIsModule
    verification: npm run build && node tests/run.mjs spec/extract && node tests/run.mjs spec/contract && node tests/run.mjs cli && npm run lint && npm run tested-exports && node scripts/gen-reference.mjs --check
    todos:
      - id: front-message
        content: Reword frontNotModule in src/spec/front/front.ts to name the hyphen rule, and update its pins — see Module message
        status: pending
      - id: schema-pattern-test
        content: Add tests/spec/contract/module_path_schema_test.ts running the schema's modulePath pattern over module_paths.ts against charsIsModule — see Schema pattern test
        status: pending
---

## Context

main @ 7c27b9b. #181 made a refused ts-interface block (one that fails to parse) print first and dropped the calls that are unknown only because it declares nothing: [profile.ts](src/spec/profile/profile.ts) keeps those refusals in `ifaceRefusals`, `profileSorted` prints them first, and two sites skip the cascade while `ifaceRefusals` is non-empty (`"… is not a function of the ts-interface block"` near :2485, `unknown function \`` in property blocks near :2749). Pinned by [profile_iface_refused_test.ts](tests/spec/extract/profile_iface_refused_test.ts).

The block-count refusal in `profileReadInterface` (:1327, `a spec has exactly one ts-interface block; this one has N`) is not in `ifaceRefusals`. So it sorts among the rest by document order, and a spec with no block also gets one "not a function" refusal per vector call. #184 gave the contract shape check a module message that names the hyphen rule (`shapeModule`, [shape.ts](src/spec/contract/shape.ts)). The ts-interface module line's message (`frontNotModule`, [front.ts](src/spec/front/front.ts) :768) still says `write <root>/<path>, lowercase segments split by /`.

## Iface count

**Owns:** `src/spec/profile/profile.ts`, `src/spec/extract.ts`, `tests/spec/extract/profile_iface_count_test.ts`, `tests/spec/extract/profile_cases_test.ts`, `tests/spec/extract/profile_test.ts`, `tests/cli/extract-refused/**`, `tests/cli/extract-iface-count*/**`, `tests/fixtures/iface-count*/**`

- The count refusal joins `ifaceRefusals` for 0 and for 2 (or more) blocks. It is the **first** refusal printed, ahead of any parse refusal of the first block.
- **0 blocks**: no function is declared, so every `"<f>" is not a function of the ts-interface block` and every `unknown function \`<f>\`` refusal is the cascade. Drop them all.
- **2+ blocks**: the first block is read as today. A call to a name that only a later block declares is the cascade: it fails only because the block is duplicated, so drop it. A call to a name that no block declares is independent, so keep it. Read the later blocks' names with the existing `frontParseInterface`, which needs no change to [front.ts](src/spec/front/front.ts). A later block that does not parse declares nothing.
- A first block that fails to parse keeps #181's behaviour.
- Today one predicate, `ifaceRefusals.size === 0`, guards both cascade sites. Replace it with one that states why a call is a cascade, so a 2-block spec does not drop independent refusals. Keep one helper both sites share, in the `profile` prefix.
- Every other refusal (docName, v2 XML, sections, quotes, etc.) is untouched.

## Iface count tests

Mirror [profile_iface_refused_test.ts](tests/spec/extract/profile_iface_refused_test.ts): variants of `specs/mini-frame.xml` read through `profileRead`. Do not edit that file, because the module-message stage owns it. Put the rows in the new `profile_iface_count_test.ts`. Rows, at minimum:

| blocks | call | expect |
|---|---|---|
| 1 | declared | no count refusal (neighbour) |
| 0 | `frame(...)` | count refusal first, no not-a-function line |
| 0 | property block calling `frame` | count refusal first, no `unknown function` line |
| 0 | plus an independent refusal | count refusal first, then the independent one |
| 2 | name in block 1 | only the count refusal |
| 2 | name only in block 2 | only the count refusal |
| 2 | name in no block | count refusal first, then the not-a-function refusal |
| 2, block 1 unparseable | — | count refusal first, then block 1's parse refusal |
| 3 | — | count refusal says 3, still first |

Delete or flip each new condition and show that a row fails (CLAUDE.md). Update the count pins in [profile_cases_test.ts](tests/spec/extract/profile_cases_test.ts), [profile_test.ts](tests/spec/extract/profile_test.ts) and the `tests/cli/extract-refused/stderr` golden if their order or lines move. A golden is only changed by rerunning the binary.

## Order comments

[extract.ts](src/spec/extract.ts) :44 (`ExtractOutcome.refusals`) and :490 (the gate-findings comment) still say refusals come "in XML document order". Say what the code does: the ts-interface block's refusals first, the count refusal at their head, then the rest in XML document order, and gate findings as the code orders them (read it; do not guess). Bring `profileRead`'s and `profileSorted`'s comments into line with it. Run `node scripts/gen-reference.mjs` and commit the regenerated `docs/reference/**`. Then `--check` passes.

## Module message

**Owns:** `src/spec/front/front.ts`, `tests/spec/extract/front_test.ts`, `tests/spec/extract/front_cases_test.ts`, `tests/spec/extract/rfc_profiles_test.ts`, `tests/spec/extract/profile_iface_refused_test.ts`, `tests/cli/extract-module-refused/**`, `tests/spec/contract/module_path_schema_test.ts`, `tests/spec/contract/module_paths.ts`

`frontNotModule` names the segment grammar and the hyphen rule, as `shapeModule` does: `` `X` is not a module path; write <root>/<segment>/…, each segment [a-z][a-z0-9_]*(-[a-z0-9][a-z0-9_]*)*, words joined by single - (RFC 3986 §3.3)``. Keep the two messages' rule text identical if that reads well in both places. A shared constant is fine, but then it lives in `chars.ts` or `shape.ts`, and this stage owns neither, so prefer duplicating the text and pinning both. Update every pin: [front_test.ts](tests/spec/extract/front_test.ts), [rfc_profiles_test.ts](tests/spec/extract/rfc_profiles_test.ts), [profile_iface_refused_test.ts](tests/spec/extract/profile_iface_refused_test.ts), and `tests/cli/extract-module-refused/stderr` (rerun the binary). No guide page or `docs/AI.md` quotes this message today. Grep `docs/` again, and stop and say so in the PR if one does, because docs are not in this stage.

## Schema pattern test

A new Nish test reads `schemas/rfc-contract.json`. It follows `target.module`'s `$ref` to `$defs.modulePath.pattern`, so a renamed def breaks the test instead of passing silently. It evaluates the pattern with ECMAScript `RegExp` semantics (JSON Schema's), for example by handing it and the paths to `node -e` through the repo's child-process helper in `src/core/`. Nish has no regex engine, and hand-translating the pattern would test the translation. For every path in `modulePathsAccepted()` and `modulePathsRefused()`, the test requires `pattern matches` === `charsIsModule(path)`. Each row is named by its path. Show it fails when one character of the pattern is changed (for example dropping `0-9` from the later-word class) and when a list entry is moved to the other list. If the test spawns `node`, name that in its doc comment. Node is in CI and in every worker container.

## Out of scope

The parse-refused block's behaviour from #181 (beyond the message text), `charsIsModule`, the schema's pattern itself, `shapeModule`'s message, and any `docs/AI.md` change (it is at 6334 of 6400 bytes).

## Verification

Each stage's `verification` line, then CI (`ci.yml` check, `docs.yml` reference check, `spec.yml`, `pr-title.yml`).
