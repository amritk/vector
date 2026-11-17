---
name: Cite a vector's result to a second RFC section
overview: An RFC-profile vector row may cite its inputs to one section and its null/true/false result to another, as {{Section 7.1 of RFC8032}}; result {{Section 5.1.7 of RFC8032}}. The result section supports the result through a covered requirement cited to it, either because its quote states the result (today's rule, unchanged) or because a property covering it, instantiated by the row's sibling vectors, derives the row. Everything else is refused as today.
stages:
  - id: result-citation
    title: "feat(spec): cite a vector's stated result to a second RFC section"
    goal: A row with inputs cited to one RFC section and its boolean or null result cited to another extracts when the result section supports the result, and is refused when it does not
    verification: npm run build && node tests/run.mjs spec && node tests/run.mjs cli && npm run lint && npm run tested-exports && npm run dogfood && node scripts/gen-reference.mjs --check && node scripts/check-links.mjs
    todos:
      - id: rc-reproduce
        content: Reproduce the 7.1-T1-VER refusal and the hand-built two-citation contract's provenance refusal on a scratch copy of nish's spec before changing code — see Reproduction
        status: pending
      - id: rc-source-cell
        content: Accept the two-citation Source cell in profileSourceCell (src/spec/profile/profile.ts) and emit the existing spec-kind contract shape with section set to the inputs' RFC section — see Source cell and contract
        status: pending
      - id: rc-stated
        content: Check the result citation with gateStatesResult against the result section, naming that section in the refusal (src/spec/gates/provenance.ts) — see Stated result
        status: pending
      - id: rc-derived
        content: Add the derived-result rule (a property covering a covered requirement of the result section, instantiated by sibling vectors) in a new src/spec/gates/derive.ts, called from provenance — see Derived result
        status: pending
      - id: rc-report
        content: Show both citations wherever a source is shown (src/spec/report/common.ts, refusal text, the emitted test's comment) — see Source cell and contract
        status: pending
      - id: rc-tests
        content: Add the table-driven tests that fail on base, through the profile reader and through the binary — see Tests
        status: pending
      - id: rc-regression
        content: Prove every committed spec and fixture extracts byte-identically, and that the five nish verify rows extract on the scratch copy — see Regression
        status: pending
      - id: rc-docs
        content: Document the form in docs/guide/guides/writing-a-spec.md and .claude/skills/vector-spec/SKILL.md, and regenerate docs/reference — see Docs
        status: pending
---

## Context

nish's [specs/rfc8032-ed25519.md](https://github.com/amritk/nish/blob/main/specs/rfc8032-ed25519.md) cannot hold a vector that verifies a §7.1 signature. A row `ed25519Verify(PUBLIC KEY, MESSAGE, SIGNATURE) = true` cited to §7.1 is refused by fidelity (`gateStatesResult` in [src/spec/gates/result.ts](src/spec/gates/result.ts)), because §7.1 holds no requirement the row covers: `7.1-T1-VER covers no requirement cited to it, so nothing there requires the result "true"`.

The contract already models "inputs in one section, result stated by another": a vector source `{"spec": "5.1.7"}` with `"section": "7.1"`. In an RFC-main contract the main source is the RFC, so fidelity binds the args in RFC §7.1 ([gateArgsAt](src/spec/gates/cite.ts)) and provenance checks the result in RFC §5.1.7 ([gateSpecSource](src/spec/gates/provenance.ts)). [schemas/rfc-contract.json](schemas/rfc-contract.json) accepts it. Only the RFC profile has no way to write it: `{{anchor}}` is a spec section and is refused under `vector-main-RFC<N>`.

The lead hand-built that contract on base `f787185`. Fidelity passed the args; provenance refused the result: `RFC §5.1.7 ("Verify") does not state the expected result: R-VERIFY-EQ does not require "true" as the result (an affirmative MUST, SHALL or REQUIRED to, a result verb, then "true")`. That refusal is right: "Check the group equation [8][S]B = [8]R + [8][k]A'." states a check, not its outcome on these bytes, and no sentence of RFC 8032 says verification returns true. So the syntax alone does not make nish's rows pass. The derived-result rule does, without loosening the stated-result rule.

## Approach

- **Two citations, both RFC sections of the main RFC.** Inputs: fidelity, exactly as a plain cite. Result: the result section must support the result. The plain one-citation form is untouched.
- **Support is one of two rules, both fail closed.**
  1. *Stated* — today's `gateStatesResult`, run on the result section. Unchanged.
  2. *Derived* — a property in the contract covers a requirement that the row covers and that is cited to the result section; the property's assertion is `<call>(…) === <the row's expected>`, and substituting the row's inputs, plus the inputs of sibling vectors whose printed results are the row's inputs, turns it into exactly the row. Then the row is an instance of a claim the spec already makes about that requirement, at values the RFC prints.
- **Rejected: letting an imperative "Check …" sentence state `true`.** Nothing ties the check's outcome on the cited bytes to `true`. A section printing a tampered case would pass with the same text.
- **Strict inputs.** Every input is still bound in the inputs section as one test case. A wrong PUBLIC KEY, or one taken from another test, is refused as today.

## Reproduction

The worker repeats this first, on base, with `dist/vector` built from it:

1. Clone `amritk/nish` (public, read-only). Copy `specs/rfc8032-ed25519.md`, `rfcs/rfc8032.txt`, `.refcache/` and `scripts/build-spec.sh` into a scratch dir, `git init` it, `mkdir contracts`.
2. Add the TEST 1 row below to the vector table; `bash scripts/build-spec.sh specs/rfc8032-ed25519.md`; `dist/vector spec extract specs/rfc8032-ed25519.xml -o contracts/x.json`. Expect exit 1 and the `covers no requirement cited to it` refusal.
3. Drop the row, extract clean, then append to `contracts/x.json` a vector with `"source": {"spec": "5.1.7"}`, `"section": "7.1"` and the TEST 1 args, and run `dist/vector spec check contracts/x.json`. Expect exit 1 and the `R-VERIFY-EQ does not require "true"` refusal.

The pinned spec tools are `gem install kramdown-rfc -v 1.7.43 --no-document` and `pip install xml2rfc==3.35.0`. In this environment the gem's binaries are in `/opt/rbenv/versions/3.3.6/bin`; put that on `PATH`. vector's own `scripts/build-spec.sh` reads vector's `.refcache/`, so use nish's copy of the script in the scratch dir.

```
| 7.1-T1-VER | `ed25519Verify(PUBLIC KEY = d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a, MESSAGE (length 0 bytes) = (empty), SIGNATURE = e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b)` | `true` | R-VERIFY-EQ | {{Section 7.1 of RFC8032}} | RFC 8032 7.1 TEST 1: the signature verifies |
```

## Source cell and contract

- Accept exactly `{{Section A of RFCn}}; result {{Section B of RFCn}}`: two section xrefs, separated by `; result ` (read the XML kramdown-rfc emits for it, an `<xref>`, text, an `<xref>`; do not guess). The worker may pick a different separator if kramdown-rfc mangles this one, and must say why in the PR body.
- Only in an RFC-main profile, only for an Expected of `null`, `true` or `false`. Refuse each near miss with a message naming the accepted form: bytes or a string expected (cite the section that prints it); a spec anchor on either side; either side naming an RFC other than the main one; A equal to B (use the plain cite); a code span on either side; three citations; a missing or different separator word.
- Contract: `{"spec": "B"}` and `"section": "A"`, the shape that exists today. No schema change. `spec check --spec <xml>` must re-derive the same contract.
- Show both wherever a source is shown: `§7.1, result §5.1.7` in the text and markdown reports ([src/spec/report/common.ts](src/spec/report/common.ts)), in refusals, and in the emitted test's per-vector comment if it names the source. Check what the emitters print today for a `spec` source and keep the dogfood tests byte-identical.

## Stated result

`gateSpecSource` already runs `gateStatesResult` on B with the main source. Keep it; make its refusal name both sections, for example `RFC §5.1.7 ("Verify"), the result citation of 7.1-T1-VER, does not support the result "true": R-VERIFY-EQ does not require "true" …; and no property derives it: …`. When the derived rule also fails, list why for each candidate property, so the author knows which rule to satisfy.

## Derived result

A new module [src/spec/gates/derive.ts](src/spec/gates/derive.ts), called from provenance only when the stated rule fails, and only for a two-citation row (a plain cite and a non-profile `spec` source keep today's single rule). The row is supported when some property P passes all of:

1. P covers a requirement R that the row also covers, and R is cited to section B of the main source.
2. P's assertion is a single comparison `E === L` (or `L === E`) where L is the row's expected literal and E is a call of the row's function. A block body, `!==`, `&&`, or any other shape is not derivable: say so.
3. Unify E's arguments with the row's arguments, left to right:
   - a forall variable binds to the argument's value; a second use must equal the first binding;
   - `unwrap(g(a…))` or `g(a…)` matches when some other vector in the contract calls `g`, its expected value equals the argument byte for byte, and its arguments unify with `a…` under the same bindings (recursively, depth at most 2);
   - any other expression is not derivable.
4. Every forall variable is bound, and each binding is inside its variable's domain (type, length bounds, integer bounds), checked with the sampler's own value types ([src/spec/sample/eval.ts](src/spec/sample/eval.ts)).
5. P's `where`, if any, holds at the bindings (`sampleHolds`); an evaluation error is a refusal.
6. Every sibling vector used is itself a cited vector in the contract (its values pass fidelity on their own), and none is the row itself.

The refusal for each candidate names the step that failed, e.g. `P-ROUNDTRIP binds msg to a 1023-byte value, outside its domain 0..130`. Record nothing new in the contract: the derivation is recomputed by every `check`, like the stated rule.

## Tests

Table-driven, every row failing on base. Unit tables beside [tests/spec/gates/provenance_test.ts](tests/spec/gates/provenance_test.ts) and [tests/spec/extract/profile_cases_test.ts](tests/spec/extract/profile_cases_test.ts); an end-to-end golden under `tests/cli/extract-result-cite*/` over a fixture under `tests/fixtures/result-cite/` holding the unmodified `rfc8032.txt` and an Ed25519-shaped spec.

| case | expect |
|---|---|
| T1 verify row, two citations, stated rule fails, P-ROUNDTRIP derives it via the T1 PUB and SIG rows | accepted |
| the same with TEST 2, 3, SHA(abc) | accepted |
| TEST 1024 with P-ROUNDTRIP's msg domain 0..130 | refused, names the domain |
| the same row, plain cite of §7.1 | refused exactly as base |
| two citations, result section holds a covered requirement that states `true` (synthetic RFC) | accepted by the stated rule |
| result section is §7.1 again | refused at the Source cell |
| result section holds no requirement the row covers | refused, names the result section |
| row expects `false`, P asserts `=== true` | refused |
| T1 PUBLIC KEY with T2 MESSAGE and T2 SIGNATURE | refused by fidelity (not one test case) |
| SIGNATURE not printed in §7.1 (one byte changed) | refused by fidelity |
| T1 row, but the T1 SIG vector is missing from the contract | refused, no sibling prints the SIGNATURE |
| a sibling vector whose expected differs by one byte | refused |
| P covers R-VERIFY-EQ but the row covers only R-VERIFY-DECODE | refused |
| P with a block body, with `!==`, with `&&` | refused, not derivable |
| P with a `where` that is false at the bindings | refused |
| forall variable used twice with two different bindings | refused |
| each malformed Source cell from Source cell and contract | refused, with the accepted form |
| expected bytes with two citations | refused |
| `spec check --spec` of an accepted contract, and of one hand-edited to `"spec": "7.1"` | exit 0, then exit 1 |

Every new export is called by name from a test, or `npm run tested-exports` refuses it.

## Regression

Build `dist/vector` from base and from the branch. Extract every `specs/*.xml` and every `tests/fixtures/**/*.xml` that base extracts with both, and `cmp` the contracts. Do the same for nish's six committed `specs/rfc*.xml` and `hex.xml` from the scratch clone. All byte-identical. Then add the five verify rows to the scratch copy of nish's spec (with P-ROUNDTRIP's msg domain widened to 0..1023 so TEST 1024 derives), extract with exit 0, `spec check contracts/x.json --spec specs/rfc8032-ed25519.xml` exit 0, and, if a nish checkout builds here, `spec run contracts/x.json --nish-root <clone>` exit 0. Paste the five rows and the property change into the PR body as the proposed nish change.

## Docs

- [docs/guide/guides/writing-a-spec.md](docs/guide/guides/writing-a-spec.md): a row in the Source cell table; in "An RFC as the main source", the one spec-section form the profile now accepts; in "Where a vector's value comes from", the `spec` row with an RFC main source; in "When a section states null, true or false", the two-citation form and the derived rule with its steps, and why a "Check …" sentence alone does not state a result.
- [.claude/skills/vector-spec/SKILL.md](.claude/skills/vector-spec/SKILL.md): one bullet under **Source**.
- Regenerate `docs/reference/**` and `scalar.config.json` with `node scripts/gen-reference.mjs`; never edit them by hand.

## Out of scope

- Any change to the stated-result allow list in [src/spec/gates/result.ts](src/spec/gates/result.ts).
- A result citation into a non-main source, and bytes or strings as the derived result.
- Combining with the `Test Vector #N` form planned in run #125 (`rfc-test-vector-scope`). If that merges first, refuse the combination with a clear message.
- Editing nish. The rows go in the PR body and the run's close-out.
- Coverage, lint, CI or release config.

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
for f in specs/*.xml; do ./dist/vector spec extract "$f" -o "contracts/$(basename "$f" .xml).json" --check; done
```

### result-citation

**Owns:** `src/spec/**`, `tests/spec/**`, `tests/fixtures/**`, `tests/cli/**`, `docs/guide/**`, `.claude/skills/vector-spec/SKILL.md`, `docs/reference/**` and `scalar.config.json` (regenerated), `tests/dogfood/**` and `contracts/**` (regenerated, expected unchanged)
