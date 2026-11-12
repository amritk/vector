---
name: RFC contracts extracted from kramdown-rfc profile specs
overview: Port contracts/rfc5869-hkdf-sha256.json and contracts/rfc8439-chacha20-poly1305.json onto the kramdown-rfc pipeline as profile specs whose main source is the RFC, so every committed contract is extracted; then remove the old custom-markdown spec format.
stages:
  - id: port
    title: RFC profile specs, extracted with the RFC as main source
    goal: specs/rfc5869-hkdf-sha256.md and specs/rfc8439-chacha20-poly1305.md build to XML and extract reproduces both committed contracts, with completeness checked against every binding sentence of the RFC
    verification: for n in rfc5869-hkdf-sha256 rfc8439-chacha20-poly1305; do bash scripts/build-spec.sh --check specs/$n.md && bun src/cli.ts spec extract specs/$n.xml -o contracts/$n.json --check && bun src/cli.ts spec check contracts/$n.json --spec specs/$n.xml --run-sources; done && bun run typecheck && bun run lint && bun run coverage
    todos:
      - id: main-key
        content: Add the main-source front-matter key to the profile so source.main names the cited RFC — see Main source
        status: pending
      - id: rfc-completeness
        content: Make profile completeness read the main RFC's binding sentences (txt via normativeSentences, xml via bcp14) — see Completeness against an RFC main source
        status: pending
      - id: xml-fixture-test
        content: Add a small v3 XML RFC fixture test where an unquoted, unexcluded bcp14 sentence is refused naming sentence and section — see Completeness against an RFC main source
        status: pending
      - id: rfc8439-source
        content: Keep RFC 8439 on rfcs/rfc8439.txt (no v3 XML exists) and record the bcp14-vs-regex comparison for the PR — see RFC 8439 source
        status: pending
      - id: spec-5869
        content: Write specs/rfc5869-hkdf-sha256.md, build its XML, extract the contract — see Profile specs
        status: pending
      - id: spec-8439
        content: Write specs/rfc8439-chacha20-poly1305.md, build its XML, extract the contract — see Profile specs
        status: pending
      - id: syntax-extensions
        content: Extend literals or profile only where these RFCs need it and document each extension in README — see Syntax extensions
        status: pending
      - id: diff-table
        content: Justify every contract field that changes, and compare spec mutate results with the base — see Results
        status: pending
      - id: notices-docs
        content: Update THIRD_PARTY_NOTICES.md, SURVIVAL.md and the README kramdown-rfc section — see Profile specs
        status: pending
  - id: remove-md
    title: Remove the custom-markdown spec format
    goal: parseMarkdownSpec, detectFormat's markdown branch, hiddenText's markdown handling and their tests and README text are gone, and nothing reads a markdown spec
    verification: bun run typecheck && bun run lint && bun run coverage && ! grep -rn "parseMarkdownSpec" src test
    todos:
      - id: find-users
        content: List every user of parseMarkdownSpec, detectFormat's markdown branch and hiddenText before deleting — see Removal
        status: pending
      - id: delete-reader
        content: Delete the markdown reader from src/rfc/spectext.ts and its call in parseDocument — see Removal
        status: pending
      - id: migrate-tests
        content: Delete the markdown-format tests and move tests that only used a markdown spec as a vehicle onto XML or RFC text — see Removal
        status: pending
      - id: readme-removal
        content: Remove the README text describing markdown spec sources — see Removal
        status: pending
---

## Context

The spec-extract run (amritk/vector#38–#45) added `scripts/build-spec.sh`, the XML v3 reader [src/rfc/xmlv3.ts](src/rfc/xmlv3.ts), the TypeScript front end [src/rfc/front/ts.ts](src/rfc/front/ts.ts), the profile [src/rfc/profile.ts](src/rfc/profile.ts) and `vector spec extract`. Its follow-ups (#48–#52) added labelled integers, `repeat`, and more. Only [contracts/example-hex.json](contracts/example-hex.json) is extracted today. The two RFC contracts are hand-written and have `source.rfc` with no `source.main`. The profile always makes the spec itself the main source ([profile.ts:925](src/rfc/profile.ts)), and its completeness check reads the spec's own BCP 14 sentences.

The gate side already exists: [gates.ts `bindingSentences`](src/rfc/gates.ts) reads `<bcp14>` for a V3Document main source and `normativeSentences` for RFC text, and keeps only MUST / SHALL / REQUIRED levels (`BINDING_LEVELS`). Both hand-written contracts pass it today against `rfcs/*.txt`.

Read README "Writing a spec (kramdown-rfc)" and the descriptions of #42 and #44 (their "Open design choices") before starting.

Base: `main` @ `3261af1`. Baseline in a cloud container: `bun run coverage` 1066 pass / 34 skip / 0 fail, lines 93.14%, functions 95.62% (floor 91 / 84).

## Stage port

**Owns:** `src/rfc/profile.ts`, `src/rfc/extract.ts`, `src/rfc/literals.ts`, `src/rfc/xmlv3.ts`, `src/rfc/gates.ts`, `src/rfc/rfctext.ts`, `src/rfc/contract.ts`, `src/rfc/front/**`, `schemas/**`, `src/generated/**`, `specs/rfc5869-hkdf-sha256.*`, `specs/rfc8439-chacha20-poly1305.*`, `contracts/rfc5869-hkdf-sha256*.json`, `contracts/rfc8439-chacha20-poly1305*.json`, `rfcs/**`, `.refcache/**`, `THIRD_PARTY_NOTICES.md`, `test/profile.test.ts`, `test/notices.test.ts`, `test/xmlv3.test.ts`, `test/rfc-profiles.test.ts` (new), `test/fixtures/rfc-main/**` (new), `test/fixtures/profile/**`, `test/fixtures/kramdown/**`, `.claude/skills/vector-spec/**`, `README.md` (sections "Writing a spec (kramdown-rfc)" and "Project layout" contracts line only)

### Main source

There is no main-source key yet: #44 deferred "how RFC-main-source profiles account for an RFC's own sentences". kramdown-rfc drops unknown front-matter keys with a `*** attributes left` warning, and `build-spec.sh` makes that fatal, so the key must be one kramdown-rfc carries into the XML. Use `keyword:` (it becomes `<keyword>` in `<front>`, from `ps.ele("keyword=kw")` in kramdown-rfc's ERB): for example `keyword: [vector-main-RFC5869]`. Exact spelling is the worker's; record it in README's profile table and in [SURVIVAL.md](test/fixtures/kramdown/SURVIVAL.md). The named RFC must be listed under `normative:` and cited at least once, or the profile refuses.

With the key, the contract's `source` is `{title, main: "rfc<N>"}` and `sources` lists the RFC (with `file` and `sha256`). Decide whether the profile spec itself is also a `sources` entry: today's contracts have none, so leaving it out reproduces them; if it stays in, justify it in the diff table.

### Completeness against an RFC main source

With an RFC main source, completeness means every binding sentence of that RFC is quoted by a requirement or excluded by an `Untested:` quote. Keep the gate's decision rule unchanged; only the sentences' source changes. The profile's own `BCP 14 sentence has no anchor…` check is replaced, in this mode, by the gate's RFC-wide check run at extract. Its refusal names the sentence and its RFC section at the spec's location.

- `.xml` RFC → `<bcp14>` (`V3Document.normative`).
- `.txt` RFC → `normativeSentences`.
- Test: `test/fixtures/rfc-main/` holds a small v3 XML RFC (a few numbered sections, two or three `<bcp14>` sentences) and a profile spec XML quoting all but one. Extract must refuse, naming that sentence and its section. Also cover the passing case, and the `.txt` case.

### RFC 8439 source

`curl -sSfL -o rfcs/rfc8439.xml https://www.rfc-editor.org/rfc/rfc8439.xml` returns **404**. rfc-editor.org publishes v3 XML only for RFC 8650 onwards, and RFC 5869 has none either. **Decided at sign-off:** RFC 8439 stays on `rfcs/rfc8439.txt` (kept, not removed), so both contracts read `.txt`, and the XML main-source path is exercised by the fixture test only. The `<bcp14>`-vs-regex comparison then runs on `rfcs/rfc8707.xml` against `rfc8707.txt`, fetched to a temp dir and not committed. Report each difference in the PR, with which side is right.

### Profile specs

One kramdown-rfc document per RFC, built by `scripts/build-spec.sh` with the pinned tools. A profile states no requirements of its own:

- Front matter: `docname: draft-<name>-00`, `normative:` with the RFC, the main-source key, a pinned `date:`, closed with `--- abstract`.
- One `ts-interface` block. Its first line is `// module: nish/crypto/<x>`, then the functions with the existing contracts' names, parameter names and types. Map each contract type to its interface type (`bytes` → `u8[]`, `bytes?` → `u8[] | null`, and `Secret<u8[]>` wherever the contract's type demands it).
- Each requirement is a blockquote of the RFC's text, `{{Section X of RFCnnnn}}` last, `{: #R-ID gi="blockquote"}`, with the existing ids, quotes and levels. A DEFINITION quote has no keyword. Check how the profile assigns DEFINITION to a quoted requirement, and extend it only if it cannot.
- Each binding sentence the contract excludes gets the same quoted form, followed by `Untested: <reason>` with the existing reason verbatim.
- Properties as `ts-property` blocks and vectors as the one table, following the existing clauses (ids, titles, covers, bounds, `where`). Vector Sources are `{{Section A.1 of RFC5869}}` etc. Bytes are checked against the RFC by the fidelity and provenance gates, as today.
- Requirement `note` (R-L in 5869): if the profile has no construct for it, add the smallest one and document it, or drop the field and justify it in the diff table.
- Commit `.refcache/` entries for RFC 5869 and 8439 (`--fetch` once) and update THIRD_PARTY_NOTICES.md for the new BibXML and for any new RFC file.

### Syntax extensions

Keep #42/#44/#52 syntax wherever it suffices. Several of the listed cases already exist: `concat(…)`, labelled bytes and integers (`Key = …`, `L = 42`), `N × hh` repeat, and `Secret<u8[]>` in the interface. Add only what these two RFCs need, for example:

- a long hex value printed over several lines in the RFC (the cell holds it joined; the cited section must print it, as the provenance gate already reads wrapped hex);
- an expected value made of several printed fields (for example AEAD ciphertext ‖ tag as `concat(Ciphertext = …, Tag = …)`).

Document each extension in README's literal table, with a test in `test/profile.test.ts` or `test/rfc-profiles.test.ts`. Every extension is a new parse path, so each gets a refusal test as well as a passing one.

### Results

- `bun src/cli.ts spec extract specs/<n>.xml -o contracts/<n>.json --check` passes for both. Commit the extracted contracts.
- The PR carries a table of every field that differs from the base contract, with the reason (as #44's did). Expected: `source` gains `main` and drops `rfc`, `sources` order or entries, `$schema` unchanged. **Never edit a contract to make extract pass without that justification.**
- `spec check … --run-sources` prints `CONTRACT_VALID` for both.
- `vector spec mutate` on both contracts before and after, with the same arguments; report both result sets. If mutate cannot run in the container (no nish binary), say so and give the command that reproduces it.
- CI: the `spec-xml-drift` job globs `specs/*.md` and the `check` job globs `specs/*.xml`, so both new specs are covered without a workflow change. Do not edit `.github/workflows/**`.

## Stage remove-md

**Owns:** `src/rfc/spectext.ts`, `src/rfc/sources.ts`, `test/rfc-spec.test.ts`, `test/rfc-gates.test.ts`, `test/rfc-linked.test.ts`, `test/rfc-extract.test.ts`, `test/rfc-sources.test.ts`, `test/read-checked.test.ts`, `test/fixtures/legacy/**`, `test/fixtures/extract/**`, `README.md` (section "Specs, sources and provenance" and the "Project layout" `spectext.ts` line only)

Merges after `port` (README is shared by section) and updates from `main` before its merge.

### Removal

- First list every caller of `parseMarkdownSpec`, `detectFormat`, `hiddenText` and `parseDocument` (src, scripts, tests, skills). `LOOSE_SECTION` stays: xmlv3 and profile import it.
- Delete `parseMarkdownSpec` and the markdown branch of `detectFormat` (a non-RFC text is refused, with a message naming only the RFC text form and XML). Drop `SpecFormat` if it becomes one value.
- `hiddenText` also guards RFC `.txt` sources (invisible characters, look-alike letters in keywords), not only markdown. **Decided at sign-off:** delete only its markdown branch (character references) and keep the RFC-text check, so `.txt` RFCs stay guarded.
- Delete the markdown-format tests in `test/rfc-spec.test.ts`. Tests elsewhere that only used a markdown spec as a vehicle for a gate move to an RFC text or XML fixture, so the gate keeps its coverage. A test whose subject is markdown is deleted, not ported. Delete `test/fixtures/legacy/example-hex.md` and `test/fixtures/extract/extract-mini.md` if nothing else needs them.
- README: rewrite the "Specs, sources and provenance" opening so a source is RFC XML v3 or RFC plain text, and update the project-layout line for `spectext.ts`.
- If anything outside these files still needs the markdown reader, stop and say what it is in a draft PR.

## Out of scope

- `.github/workflows/**`, coverage, lint and typecheck configuration.
- `contracts/example-hex.json` and `specs/example-hex.*`, except where a change in this run makes extract change them, which is then justified.
- New features beyond what the two RFCs need.

## Tests

- port: `test/rfc-profiles.test.ts` covers the XML fixture refusal and pass, the `.txt` main source, the main-source key's refusals (RFC not in `normative:`, never cited, two keys), and each syntax extension. It also checks that two extracts of each RFC profile are byte-identical and equal the committed contract.
- remove-md: the suite still covers every gate. Coverage stays ≥ 91% lines.

## Verification

```bash
bun run typecheck && bun run lint && bun run coverage
for n in example-hex rfc5869-hkdf-sha256 rfc8439-chacha20-poly1305; do bun src/cli.ts spec extract specs/$n.xml -o contracts/$n.json --check; done
for f in specs/*.md; do bash scripts/build-spec.sh --check "$f"; done   # needs kramdown-rfc 1.7.43 + xml2rfc 3.35.0
```
