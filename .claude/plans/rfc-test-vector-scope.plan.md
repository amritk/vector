---
name: Scope a vector row to one in-section "Test Vector #N"
overview: RFC 8439 §A.3 prints 11 Poly1305 vectors in one section with no subsections, so vector 0.3.1 refuses every A.3 row as ambiguous. Add an opt-in Source form, {{Section A.3 of RFC8439}}, Test Vector #N, that makes the row's labels resolve only inside that vector, keeping every fidelity rule strict within it and leaving plain cites byte-for-byte unchanged.
stages:
  - id: test-vector-scope
    title: "feat(spec): scope a vector row's labels to an in-section Test Vector #N"
    goal: A row cited as a section plus "Test Vector #N" pairs its labelled values within that one vector, and is refused when they are not all printed there
    verification: npm run build && node tests/run.mjs spec && node tests/run.mjs cli && npm run lint && npm run tested-exports && npm run dogfood
    todos:
      - id: tv-reproduce
        content: Reproduce both refusals on a scratch copy of nish's spec with A.3 rows before changing code — see Reproduction
        status: pending
      - id: tv-source-cell
        content: Accept the Source cell form {{Section X of RFCn}}, Test Vector #N in the profile reader (src/spec/profile/profile.ts) and record it on the contract cite — see Source cell and contract
        status: pending
      - id: tv-schema
        content: Add the case field to schemas/rfc-contract.json and regenerate docs/reference — see Source cell and contract
        status: pending
      - id: tv-scope-source
        content: Find in-section Test Vector headings in the RFC text (src/spec/source/) and expose one case's text span — see Finding the vectors
        status: pending
      - id: tv-fidelity
        content: Resolve a scoped row's labels within its case only in src/spec/gates/fidelity.ts, and add the refusals listed — see Fidelity within a case
        status: pending
      - id: tv-tests
        content: Add table-driven tests that fail without the change, over every neighbour listed — see Tests
        status: pending
      - id: tv-regression
        content: Prove nish's current RFC 8439 spec (A.1, A.2, A.4, A.5) extracts to a byte-identical contract — see Regression
        status: pending
      - id: tv-docs
        content: Document the form in docs/guide/guides/writing-a-spec.md and .claude/skills/vector-spec/SKILL.md — see Docs
        status: pending
---

## Context

[src/spec/gates/fidelity.ts](src/spec/gates/fidelity.ts) checks a vector row's labelled values against the cited section. When the labels in that section are printed a different number of times, it cannot tell which printings belong together, so it refuses with `… so which printings belong to one test case is unclear: cite the subsection that holds one test case` (around line 462). [RFC 8439 §A.3](https://www.rfc-editor.org/rfc/rfc8439#appendix-A.3) has no subsections. Its 11 vectors print `One-time Poly1305 Key`/`Text to MAC`/`Tag` (#1–#4) and `R`/`S`/`data`/`tag` (#5–#11), so a case-insensitive `tag` count is 11 against 4 and 7. Every A.3 row is refused. nish's [specs/rfc8439-chacha20-poly1305.md](https://github.com/amritk/nish/blob/main/specs/rfc8439-chacha20-poly1305.md) line 291 records the gap.

The Source cell has no form for naming a vector. `{{Section A.3 of RFC8439}}, Test Vector #2` is refused at [src/spec/profile/profile.ts:2192](src/spec/profile/profile.ts) with `Source must be {{Section N of RFCx}}, a section anchor, or a single code span`.

## Reproduction

Done by the lead on base `f787185`: nish's spec rebuilt with `scripts/build-spec.sh` matches nish's committed XML byte for byte and extracts cleanly. Then three rows were added after `A.4-KEYGEN-3`:

| row | Source | result |
|---|---|---|
| A.3 #2, plain | `{{Section A.3 of RFC8439}}` | exit 1, `"One-time Poly1305 Key" is printed 4 times, "Text to MAC" is printed 4 times, "Tag" is printed 11 times in RFC §A.3 … cite the subsection that holds one test case` |
| A.3 #2 | `{{Section A.3 of RFC8439}}, Test Vector #2` | exit 1, `Source must be {{Section N of RFCx}}, a section anchor, or a single code span` |
| A.3 #5, `concat(R = …, S = …)` | `{{Section A.3 of RFC8439}}, Test Vector #5` | exit 1, the same Source refusal |

The worker repeats this first: clone `amritk/nish`, copy `specs/rfc8439-chacha20-poly1305.md`, `rfcs/rfc8439.txt` and `.refcache/` into a scratch git dir, add the rows, then build and extract with this branch's `dist/vector`.

## Approach

- **Opt-in, never inferred.** A plain section cite keeps today's behaviour exactly, even in a section that has `Test Vector #N:` headings (A.1, A.2 and A.4 all do). Only a cite that names a vector is scoped. This makes "A.1, A.2 and A.4 extract exactly as before" true by construction, and the regression todo proves it.
- **Scope narrows; it never loosens.** Inside a case, every rule that applies to a section today still applies: a whole printed value, the counts check, pairing printings, case-insensitive label matching, `concat` parts. The only change is which text the rules run on.
- **Headings, not prose.** A case starts at a line whose first non-blank text is `Test Vector #<N>:`. It ends at the next such line or at the end of the section. Two shapes must both count: the heading alone, followed by a `====` rule (#1–#4), and the heading followed by description text on the same line, with no rule (#5–#11: `Test Vector #5: If one uses 130-bit partial reduction, …`). A mention in prose (`in test vector #2, r is equal to zero`) is not a heading: it is lower case, not at line start, and has no colon.

## Source cell and contract

- Accept exactly `{{Section X of RFCn}}, Test Vector #N` with N a positive decimal and no leading zero. Refuse every near miss, each with a message that names the accepted form. Near misses include `Test vector #2`, `Test Vector 2`, `#02`, `Test Vector #`, `Test Vector #2.`, a suffix after a spec anchor (`{{anchor}}, Test Vector #2`), after a code span, or after two cites. Read the XML kramdown-rfc actually emits for the cell (an `<xref>` followed by text) rather than guessing it.
- Record it on the cite as one new optional field. Suggested: `{"cite": {"section": "A.3", "case": "Test Vector #2"}}`. The worker may pick the exact name and shape if the code argues for another, and must say why in the PR body. A contract without the field reads exactly as before, and `spec check` re-applies the scope when it re-reads the RFC.
- Add the field to [schemas/rfc-contract.json](schemas/rfc-contract.json), then regenerate `docs/reference/**` with `node scripts/gen-reference.mjs`. Never edit generated files by hand.
- Wherever a source is shown to a user (text and markdown reports, refusal messages), show `§A.3, Test Vector #2`.

## Finding the vectors

In the RFC source reader ([src/spec/source/](src/spec/source/), `rfc.ts` or a new module), find the cases of one section. Read the section as vector already reads it, after page breaks and headers are removed: a vector split by a page break (A.3 #2's text) must stay one case. Add a function that returns one case's text from a section, or an `Err` when:

- the section prints no heading `Test Vector #N:` for that N;
- the heading for N appears twice in the section;
- the cited section has subsections (cite the subsection instead, as today).

Each `Err` message names the section and the vector.

## Fidelity within a case

In [src/spec/gates/fidelity.ts](src/spec/gates/fidelity.ts), when the cite has a case, run the existing label resolution over that case's text instead of the whole section. Refuse (exit 1) when:

- a labelled argument or the expected value is not printed in that case, even when another case in the section prints it. For example, Test Vector #3's tag under a `Test Vector #2` cite is refused, and the message names the case;
- any refusal that applies to a section applies inside the case, such as a label printed twice in the case, or a prefix of a value.

When a plain cite is refused for ambiguous counts and the section has `Test Vector #N:` headings, add a hint to the existing message: `or name one: {{Section A.3 of RFC8439}}, Test Vector #N`. That changes only the refusal text. The regression todo checks that the rows that pass are unchanged.

Check that the printed-value reader takes A.3 #5–#11's dumps. They have no offset column and use upper-case hex (`FF FF …`), and #7, #8 and #10 run over several lines. Check too that `concat(R = …, S = …)` fills the 32-byte key from two labels in one case. If either fails, fixing it is in scope, with its own table rows.

## Tests

The rows must be table-driven and must fail on base. Put the unit tables in [tests/spec/gates/fidelity_test.ts](tests/spec/gates/fidelity_test.ts) and [tests/spec/source/rfc_test.ts](tests/spec/source/rfc_test.ts), plus an end-to-end extract through `vectorRun` or the binary in [tests/spec/extract/extract_cases_test.ts](tests/spec/extract/extract_cases_test.ts) or a `tests/cli/<case>/` golden, over a fixture under `tests/fixtures/` holding the unmodified `rfc8439.txt`.

| case | expect |
|---|---|
| A.3 #1, #2 (split by a page break), #4, each with its own key, text and tag | accepted |
| A.3 #5, #7 (several data lines), #11, with `concat(R = …, S = …)` and `data`/`tag` | accepted |
| A.3 #2 call with #3's tag | refused, names Test Vector #2 |
| A.3 #2 call, cited as Test Vector #3 | refused |
| Test Vector #12 in A.3 | refused, no such vector |
| Test Vector #0, #02 | refused at the Source cell |
| plain A.3 cite | still refused, now with the hint |
| A.1 #1 cited plain, and A.1 #1 cited as Test Vector #1 | both accepted; the plain row's contract is identical to base |
| a section with a duplicated `Test Vector #2:` heading (synthetic fixture) | refused |
| prose `test vector #2` is not a heading | the A.3 intro paragraph does not open a case |
| each malformed Source suffix from "Source cell and contract" | refused, with the accepted form |
| `spec check` of a scoped contract, and of one edited to name another case | exit 0, then exit 1 |

Every new export is called by name from a test, or `npm run tested-exports` refuses it.

## Regression

Build `dist/vector` from base and from the branch. Extract nish's unmodified `specs/rfc8439-chacha20-poly1305.xml` with both. The two contracts must be byte-identical (`cmp`). Do the same for every `specs/*.xml` and `tests/fixtures/**/*.xml` vector already extracts. Put the commands and results in the PR body. Finish with the 11 A.3 rows added to the scratch copy of nish's spec, extracting with exit 0, and `spec check contracts/x.json --spec specs/….xml` exiting 0. Paste the 11 rows into the PR body as the proposed nish change.

## Docs

- [docs/guide/guides/writing-a-spec.md](docs/guide/guides/writing-a-spec.md): add a row to the Source cell table and a short paragraph in "What a printed value is", covering when to name a vector, what a heading is, and what is still refused. Add the `case` field to the `cite` row around line 450.
- [.claude/skills/vector-spec/SKILL.md](.claude/skills/vector-spec/SKILL.md): add one bullet under **Source**.
- Change any guide page that quotes the ambiguous-count refusal to match its new text.

## Out of scope

- Inferring a case from a plain cite, or from the row's Id or Title.
- Other in-section markers (`Test Case N`, `Example N`). Note them in the PR body if the code makes them cheap later.
- Editing nish. The rows for nish go in the PR body and the run's close-out.
- Any change to coverage, lint, CI, or release config.

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

### test-vector-scope

**Owns:** `src/spec/**`, `schemas/rfc-contract.json`, `tests/spec/**`, `tests/fixtures/**`, `tests/cli/**`, `docs/guide/**`, `docs/reference/**` (regenerated), `scalar.config.json` (regenerated), `tests/dogfood/**` (regenerated), `contracts/**` (regenerated), `.claude/skills/vector-spec/SKILL.md`
