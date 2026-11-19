---
name: Read v3 RFCs as sources
overview: Let every RFC since RFC 8650 be a source — accept the unpaginated plain text xml2rfc v3 writes, and drop the literal zero-width break hints the RFC Editor leaves in RFC XML — without weakening the hidden-text gate.
stages:
  - id: rfc-v3-sources
    title: "feat(spec): read v3 plain-text RFCs and drop break hints in RFC sources"
    goal: An unmodified rfc9000.txt, rfc9001.txt and rfc9000.xml from rfc-editor.org load as sources, and every refusal that guarded them before still holds
    verification: npm run build && node tests/run.mjs spec/source && node tests/run.mjs spec/extract && node tests/run.mjs cli && npm run lint && npm run tested-exports && npm run doc-caps
    todos:
      - id: v3-text-accept
        content: Accept unpaginated plain text in rfcRead (src/spec/source/rfc.ts) — see v3 plain text
      - id: v3-text-tests
        content: Table-driven rfcRead tests in tests/spec/source/rfc_test.ts, paginated and unpaginated neighbours — see Tests
      - id: break-hint-drop
        content: Add the break-hint drop to src/spec/source/hidden.ts and apply it to RFC sources only, in src/spec/source/load.ts and src/spec/extract.ts — see Break hints
      - id: break-hint-tests
        content: Tests for the drop and for every refusal it must not loosen, in hidden_test.ts, load_test.ts and an extract test — see Tests
      - id: rfc9000-goldens
        content: CLI golden cases that load excerpts of the real RFC 9000 text and XML through dist/vector — see Tests
      - id: docs
        content: Update the Sources paragraphs and the Hidden text section of the guides, and docs/AI.md if it states either rule — see Docs
---

## Context

vector 0.5.0 refuses every RFC since RFC 8650 as a source:

- `rfcRead` ([src/spec/source/rfc.ts](src/spec/source/rfc.ts)) requires a form feed. xml2rfc v3's plain text (rfc9000.txt, rfc9001.txt) has none, and no `[Page N]` footers or running headers either. `rfcParse` already reads that text correctly — checked against the real files: RFC 9000 parses to number 9000 and 211 sections, RFC 9001 to 9001 and 75 — so only the acceptance rule refuses it. The real files start with a byte-order mark, which the hidden-text scan already allows at offset 0.
- rfc9000.xml holds one literal U+200B, as a line-break hint in a table cell (line 7928, `0x0100-<U+200B>0x01ff`). `hiddenProblem` refuses it. With that one character removed, `xmlRead` reads the file (number 9000, 208 sections, no other hidden-text spot). An RFC cannot be modified, so the spec author has no way out.
- The same hint written as a character reference (`&#8203;`, `&#8288;`) is already dropped by `xmlClean` ([src/spec/xml/text.ts](src/spec/xml/text.ts)), as xml2rfc's text writer drops it, and [tests/spec/source/load_test.ts](tests/spec/source/load_test.ts) pins that.

A survey of 21 RFC XMLs (8650, 8999, 9000, 9001, 9002, 9110–9114, 9180, 9204, 9293, 9420, 9562, 9580, 9606, 9651, 9700, 9750, 9839) found exactly one literal U+200B/U+2060, RFC 9000's, sitting between `-` and `0`. None sits between two word characters.

## Approach

**v3 plain text.** Two kinds of plain text are an RFC's: paginated (v2: form feeds, footers, headers — unchanged) and unpaginated (v3: no form feed, and no line that `rfcIsFooter` or `rfcIsHeader` takes as page furniture). Without form feeds the header is the only sign the text is an RFC, so for unpaginated text the `Request for Comments: N` header must begin a line that comes before the first section heading. Text with page furniture but no form feed is neither kind and stays refused: it is a paginated RFC whose form feeds were stripped, and its page breaks could not be placed.

**Break hints.** The drop applies only to a source that names an RFC (`SourceDecl.rfc >= 1`: a linked RFC or `extractReadRfc`'s decl), never to the spec's own XML or a non-RFC source. Only U+200B and U+2060 are dropped, and only where dropping them cannot change a word: a literal hint is dropped when at least one of its neighbours is not a word character (`hiddenWordClass`). A hint between two word characters is still refused, with today's message, so `MU<U+200B>ST` is still caught and no keyword can appear or disappear through the drop. Every other invisible or look-alike character is refused exactly as now, and the dropped text — not the raw text — is what `hiddenProblem`, the reader, and the decoded-text check then read, so a look-alike next to a dropped hint is still found. A source's SHA-256 pin stays the hash of the file's bytes as read. Line numbers in every later message stay those of the file, since nothing that is dropped is a newline.

## Read v3 plain-text RFCs and drop break hints in RFC sources

One stage, one PR. The two changes share both guide pages (`writing-a-spec.md` states the form-feed rule and the hidden-text rule a few lines apart), and CLAUDE.md puts a guide update in the same PR as the change it describes, so splitting them would put one file in two concurrent lanes.

**Owns:** `src/spec/source/rfc.ts`, `src/spec/source/hidden.ts`, `src/spec/source/load.ts`, `src/spec/extract.ts`, `tests/spec/source/**`, `tests/spec/extract/**`, `tests/cli/check-rfc9000-*/**`, `tests/fixtures/rfc9000/**`, `docs/guide/guides/writing-a-spec.md`, `docs/guide/guides/spec-to-contract.md`, `docs/AI.md`, `.claude/skills/vector-spec/SKILL.md`

Generated, regenerated with the repo's tooling: `docs/reference/**` and its routes in `scalar.config.json` (a new export's doc comment lands there).

## v3 plain text

In `rfcRead`: keep the paginated path as it is. Add the unpaginated path per Approach. The refusal keeps its `${file}: not an RFC's plain text: ` prefix and says which part is missing — no header, a header not in the front matter, or page furniture without form feeds. `rfcParse` needs no change; if a change to it turns out to be needed, it is in this stage's lane.

## Break hints

A new exported function in [src/spec/source/hidden.ts](src/spec/source/hidden.ts), prefixed `hidden`, that takes a source's text and returns it with every droppable U+200B/U+2060 removed; a hint between two word characters stays in the text, so the existing scan refuses it at its line. Apply it in `sourceLoadOne` ([src/spec/source/load.ts](src/spec/source/load.ts)) and in extract's source read ([src/spec/extract.ts](src/spec/extract.ts) `extractReadRfc`) when the decl names an RFC, before the hidden-text check and the reader. The spec's own XML (`extract.ts`'s `hiddenProblem(text, xmlPath)`) is not touched.

## Docs

[docs/guide/guides/writing-a-spec.md](docs/guide/guides/writing-a-spec.md) "Sources and provenance" and "Hidden text", and [docs/guide/guides/spec-to-contract.md](docs/guide/guides/spec-to-contract.md) "Sources": a source may be paginated or unpaginated plain text, and a literal zero-width space or word joiner in an RFC source is dropped except inside a word. [docs/AI.md](docs/AI.md) and [.claude/skills/vector-spec/SKILL.md](.claude/skills/vector-spec/SKILL.md) only where they state either rule; both are under a byte cap in `scripts/doc-caps.json`, which is never raised.

## Out of scope

- No change to how the spec's own XML is checked: a literal U+200B there is still refused.
- No change to `xmlClean` or to character-reference handling.
- No new invisible character is allowed; U+200C, U+200D, U+FEFF after offset 0, U+00AD and every other entry of `hiddenInvisibleTable` stay refused in every source.
- No full RFC 9000 copy under `rfcs/`; tests use excerpts under `tests/fixtures/`.

## Tests

- **rfcRead, table-driven** ([tests/spec/source/rfc_test.ts](tests/spec/source/rfc_test.ts)): accepted — paginated text with real `[Page N]` footers and `\f` running headers; unpaginated text shaped like rfc9000.txt (BOM, front-page header block, indented table of contents, headings at column 0). Refused — no header in either kind; unpaginated with the header only after the first heading; `[Page N]` footers or running headers with no form feed. Each refusal asserts its message. For paginated text, a value on each side of a page break and two blocks split only by one still read as today.
- **The drop, table-driven** ([tests/spec/source/hidden_test.ts](tests/spec/source/hidden_test.ts)): U+200B and U+2060 after a hyphen, before a digit, at a line's start and end, beside a space — dropped. Between two letters (`MU<U+200B>ST`), two digits, a letter and a digit, and next to a combining mark — kept and refused. U+200C, U+200D, U+00AD, U+202E and a mid-text U+FEFF — refused as now. `MUS<U+0422>` next to a dropped hint — refused as a look-alike.
- **Through the loader** ([tests/spec/source/load_test.ts](tests/spec/source/load_test.ts)): a linked RFC `.xml` and `.txt` with a boundary hint load; one with `MU<U+200B>ST` is refused at its line; the same boundary hint in a source that names no RFC is still refused; a pinned SHA-256 is of the file's bytes. The existing `rfc7777.txt` `MU<U+200B>ST` refusal still holds.
- **Through extract**: a spec citing an RFC whose XML holds a boundary hint extracts; the spec's own XML holding a literal U+200B is still refused.
- **Through the binary** (`tests/cli/<case>/`): an excerpt of the real rfc9000.txt (front page, table of contents and at least one section, unmodified lines) and an excerpt of rfc9000.xml keeping the table cell at line 7928 with its literal U+200B load through `vector spec check` and verify a quoted requirement. Each new rule's test is shown to fail with the rule removed.

## Verification

```
npm run build
node tests/run.mjs spec/source
node tests/run.mjs spec/extract
node tests/run.mjs cli
npm run lint
npm run tested-exports
npm run doc-caps
```

CI's `check` job runs the full `npm test` and `npm run dogfood`.
