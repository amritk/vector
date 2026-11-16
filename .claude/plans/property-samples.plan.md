---
name: Let a spec set a property's sample count
overview: A ts-property block gains an optional samples comment on its second line that spec extract reads into the clause's samples field (1–256, refused out of range with file and line), and the sampler treats an explicit samples as the property's total, so a spec can ask for up to 256 samples where today every extracted contract gets the default boundary plus 24.
stages:
  - id: samples
    title: "feat(spec): let a ts-property block set its sample count"
    goal: A spec's ts-property block can set its sample count, extract writes it, check, emit and run honour it, and the guides say what it means
    verification: npm run build && node tests/run.mjs spec && node tests/run.mjs cli && npm run lint && npm run tested-exports && npm run dogfood && node scripts/gen-reference.mjs --check
    todos:
      - id: front-samples-line
        content: Parse the optional samples line 2 of a ts-property block in src/spec/front/front.ts into clause.samples, refusing malformed, misplaced and out-of-range values — see The setting
      - id: sampler-total
        content: Make an explicit samples the property's exact total in src/spec/sample/property.ts, with SAMPLE_MAX as the default path's ceiling only — see What samples means
      - id: contract-bounds
        content: Tighten the contract's samples bound to 1–256 in src/spec/contract/read.ts, the doc comment in src/spec/contract/types.ts and schemas/rfc-contract.json, and move tests that used samples 0 — see What samples means
      - id: extract-goldens
        content: Add extract goldens with and without the setting and refusal goldens for 0, 257 and non-integers under tests/cli — see Tests
      - id: emit-count-test
        content: Add a test that a property with samples 96 (and one with 200) emits and runs exactly that many samples — see Tests
      - id: kramdown-survival
        content: Add the setting to one property in tests/fixtures/kramdown/profile.md, rebuild profile.xml with scripts/build-spec.sh, and record the row in SURVIVAL.md — see The setting
      - id: docs
        content: Document the setting in writing-a-spec.md (Properties), spec-to-contract.md, the vector-spec skill's Limits section and the schema description, and regenerate docs/reference — see Docs
---

# Let a spec set a property's sample count

## Context

The contract already carries a property's `samples` ([read.ts:729](../../src/spec/contract/read.ts) accepts 0–256, [write.ts:248](../../src/spec/contract/write.ts) writes it, [types.ts:398](../../src/spec/contract/types.ts) defaults it to -1), but no spec can set it: [front.ts](../../src/spec/front/front.ts) `frontPropertyIn` never touches `clause.samples`. So every extracted property gets the default in [property.ts:333](../../src/spec/sample/property.ts): Z3's boundary samples plus `SAMPLE_DEFAULT_RANDOM` (24) random, the whole capped at `SAMPLE_MAX` (96). Contracts are generated, so a project cannot hand-edit its way to more coverage. nish's hex contract had `"samples": 96` on all ten properties when it was hand-written; re-extracted with 0.2.1 it runs 26–39.

## Approach

Two decisions, both put to the human at sign-off.

**Spelling: a second comment line.** The block's metadata already lives in comments (line 1 is `// P-ID covers R-ID — title`, bounds are `/* lo..hi */`), and the body stays valid TypeScript. A comment inside `<sourcecode type="ts-property">` is carried verbatim through kramdown-rfc and xml2rfc, which the kramdown-survival todo proves in CI.

```ts
// P-ROUND-TRIP covers R-ROUND-TRIP — hexDecode(hexEncode(b)) is b
// samples: 96
forall (b: u8[] /* 0..64 */) => {
  const d = hexDecode(hexEncode(b));
  return d !== null && unwrap(d) === b;
}
```

**Meaning: the total.** An explicit `samples N` is the number of samples the property's test runs, boundaries included. That is what "an emitted test that runs exactly the requested count" needs, it is why 0 is refused (a test of nothing), and it is what a hand-written `"samples": 96` already did in practice: 96 random wanted, cut to 96 total by `SAMPLE_MAX`. A property that does not say keeps today's default exactly, so every dogfood contract and test stays byte-identical.

## The setting

In `frontPropertyIn`, after `frontCoversLine`: if the next raw token is a line comment on line 2 whose text, trimmed, starts with `samples`, parse it and set `clause.samples`. Grammar: `// samples: N`, N a decimal integer with no sign, no leading zeros, no fraction or exponent. Refusals, each a `FrontRefusal` at that comment so extract reports `file:line`:

| input | refusal |
| --- | --- |
| `// samples: 0`, `// samples: 257` | `samples must be 1..256, not N` |
| `// samples: 12.5`, `// samples: -1`, `// samples: x`, `// samples:`, `// samples 96` (no colon) | `samples takes a decimal integer, 1..256` |
| a `// samples…` comment anywhere but line 2 | `the samples line goes on line 2, after the covers line` |

Any other comment on line 2 is left as it is today. The colon-less `// samples 96` is refused with a hint to the one spelling, so a typo is never silently ignored.

Survival: add `// samples: 48` (any value other than the default) to one property in [tests/fixtures/kramdown/profile.md](../../tests/fixtures/kramdown/profile.md), rebuild `profile.xml` with `bash scripts/build-spec.sh tests/fixtures/kramdown/profile.md` (install the pinned kramdown-rfc and xml2rfc as `.github/workflows/spec.yml` does), update [profile_cases_test.ts](../../tests/spec/extract/profile_cases_test.ts) for the new field, and add the row to [SURVIVAL.md](../../tests/fixtures/kramdown/SURVIVAL.md). CI's `Spec / spec-xml-drift` job rebuilds that fixture with `--check`.

## What samples means

In `sampleRun` ([property.ts:330](../../src/spec/sample/property.ts)):

- `k.samples < 0` (absent): unchanged. Boundaries, then up to `SAMPLE_DEFAULT_RANDOM` random, the total capped at `SAMPLE_MAX`.
- `k.samples = N`: the boundaries first, keeping at most N of them in the order Z3 gives them, then seeded random draws until the property has N samples. `SAMPLE_MAX` does not apply; N's own ceiling is the schema's 256. The try budget scales with N as it does today (`N * 20`).
- When the domain has fewer than N distinct inputs, the property gets every one it finds and the sampler adds a note to its stats (`asked for N samples; the domain gave M`), shown by `spec check`. It is not a refusal.

`SAMPLE_MAX` stays at 96 as the default path's cap, renamed or re-documented so its comment says that. The contract bound becomes 1–256 in `read.ts` and the schema (`minimum: 1`), with the schema's description of `samples` saying it is the total. [bitvec_test.ts](../../tests/spec/gates/bitvec_test.ts) uses `"samples": 0` and `1` to get boundary-only sampling: move those to an explicit count that keeps what each test checks, or drop the field, and say which in the PR.

`spec check`, `emit` and `run` all read the samples `checkContract` chose ([check.ts](../../src/spec/check.ts), [emit/file.ts](../../src/spec/emit/file.ts)), so no emitter changes; the emitted test's `— N samples` line already reports `samples.length`.

## Docs

- [writing-a-spec.md](../../docs/guide/guides/writing-a-spec.md), Properties: the `// samples: N` line, its range, that it is the total, what happens without it (boundary + 24, at most 96), and what happens when the domain is smaller.
- [spec-to-contract.md](../../docs/guide/guides/spec-to-contract.md), after "Then **Z3 picks the samples**": the same rule, one paragraph, and the refusal in the extract section if it lists refusals.
- [.claude/skills/vector-spec/SKILL.md](../../.claude/skills/vector-spec/SKILL.md), "Limits — say them": the default count, how to raise it, and the 256 ceiling.
- [schemas/rfc-contract.json](../../schemas/rfc-contract.json): the `samples` description and minimum.
- `docs/reference/**` and `scalar.config.json` are generated: rerun `node scripts/gen-reference.mjs` if any doc comment changed, never edit them.
- `CHANGELOG.md` and the version are release-please's. The PR title is `feat(spec): let a ts-property block set its sample count`; the squash commit carries it, and `bump-minor-pre-major` makes that 0.3.0.

## Tests

| what | where |
| --- | --- |
| a property with `// samples: 96` extracts to `"samples": 96`; the same property without it extracts with no `samples` key | new `tests/cli/extract-samples/` golden, fixture under `tests/fixtures/extract/` |
| `0`, `257`, `12.5`, `-1`, `x`, an empty value and a misplaced line are refused, exit 1, with file:line | new `tests/cli/extract-samples-*` goldens, and cases in [front_cases_test.ts](../../tests/spec/extract/front_cases_test.ts) |
| samples 96 and 200 each give exactly that many samples (boundary + random = N), and the emitted test prints `— 96 samples` / `— 200 samples` and passes against a correct implementation | a test under `tests/spec/emit/` or `tests/spec/gates/` mirroring [program_test.ts](../../tests/spec/emit/program_test.ts) or [domain_test.ts](../../tests/spec/gates/domain_test.ts), plus an `emit-run-*` CLI golden |
| N larger than a small domain yields every input and the note | the same sampler test file |
| a hand-written contract with `"samples": 0` is refused by read | [check_test.ts](../../tests/spec/contract/check_test.ts) or `tests/cli/check-invalid-values` |
| dogfood contracts and tests unchanged | `npm run dogfood`, and `./dist/vector spec extract specs/<f>.xml -o contracts/<f>.json --check` for every spec |

## Out of scope

- No change to the default (24 random, cap 96) or to how boundaries are chosen.
- No sample setting for vectors, and no per-variable counts.
- No edit to `contracts/*.json`, `specs/*`, `tests/dogfood/**`, `CHANGELOG.md` or any version string.
- The nish follow-up (bump `.vector-version`, set `// samples: 96` on each property in `specs/hex.md`, rebuild, re-extract, re-emit, drop the caveat in `contracts/README.md`) is a separate run in amritk/nish once 0.3.0 is tagged.

## Verification

```bash
npm run build
node tests/run.mjs spec
node tests/run.mjs cli
npm run lint
npm run tested-exports
npm run dogfood
node scripts/gen-reference.mjs --check
node scripts/check-links.mjs
```

**Owns:** `src/spec/**`, `tests/spec/**`, `tests/cli/**`, `tests/fixtures/**`, `schemas/rfc-contract.json`, `docs/guide/**`, `docs/reference/**`, `scalar.config.json`, `.claude/skills/vector-spec/SKILL.md`, `scripts/undocumented.txt`
