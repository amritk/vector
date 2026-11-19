---
name: Three spec-text misreads in a spec without vector-main-RFC
overview: In a spec whose main source is the spec itself, vector merges blocks into one sentence and ignores anchored RFC quotes, so it reports quoted RFC requirements and requirements next to a ts-property as unanchored, and reads a property's title as a requirement retracting its result. Two PRs fix this. One makes a sentence end at every block of the spec's own text. The other counts an anchored RFC quote as its requirement in the section where it stands.
stages:
  - id: block-bounds
    title: "fix(spec): end a sentence at every block of the spec's own text"
    goal: No sentence vector reads from a spec's own XML text spans a sourcecode, artwork, blockquote, table cell or paragraph boundary, so completeness, provenance and the result gate read only the sentence in question
    verification: npm run build && node tests/run.mjs spec && node tests/run.mjs cli && npm run lint && npm run tested-exports && npm run dogfood
    todos:
      - id: bb-reproduce
        content: Reproduce misread 2 (requirement after a ts-property reported unanchored), the result gate reading a property title (the deny form, and the retract form the user reported), and the citation of one blockquote leading the next quote's sentence, as failing tests — see Block bounds
        status: pending
      - id: bb-fix
        content: Make every paragraph splitter that reads a spec's own XML section see the block boundaries xmlSectionLines drops (sourcecode, artwork, blockquote, table cell, paragraph) — see Block bounds
        status: pending
      - id: bb-own-sentence
        content: Bound the result gate's deny, retract and hedge reads in src/spec/gates/result.ts to the requirement's own sentence, never a neighbouring block — see Block bounds
        status: pending
      - id: bb-neighbours
        content: Add table-driven rows for the neighbours — RFC text through rfcParse with page breaks is unchanged, a sentence that really spans two lines of one paragraph still reads as one, a real retract inside the requirement's own sentence is still refused — see Tests
        status: pending
  - id: anchored-quotes
    title: "fix(spec): count an anchored RFC quote as its requirement in the spec's own text"
    goal: In a spec without vector-main-RFC, a blockquote ending in a citation of another RFC and anchored as a requirement counts as that requirement for the completeness gate, in the spec section where it stands, as it already does in a main-RFC profile
    verification: npm run build && node tests/run.mjs spec && node tests/run.mjs cli && npm run lint && npm run tested-exports && npm run dogfood
    todos:
      - id: aq-reproduce
        content: Reproduce misread 1 with one anchored RFC4648 blockquote in a spec without vector-main-RFC as a failing test — see Anchored quotes
        status: pending
      - id: aq-fix
        content: Count an anchored RFC quote's text as covered in the spec section that holds its blockquote, in src/spec/gates/completeness.ts (and src/spec/profile/profile.ts only if the contract must record where the blockquote stands) — see Anchored quotes
        status: pending
      - id: aq-neighbours
        content: Add table-driven neighbour rows — an unanchored RFC blockquote and the spec's own unanchored MUST sentence are still reported, the quote does not cover the same words in another spec section, and the main-RFC profile is unchanged — see Tests
        status: pending
---

## Context

Three misreads came up while writing nish's `specs/rfc4648-base64.md` and `specs/rfc6455-websocket.md` with vector 0.5.0. Both specs have no `vector-main-RFC<N>` keyword, so the main source is the spec itself. The lead reproduced the first two at base `230cf32` with the spec under **Repro** below (`spec extract` exits 1):

```
completeness: Section 3: MUST NOT sentence is neither a requirement nor an exclusion: "Implementations MUST NOT add line feeds ..."
completeness: Section 3: MUST sentence is neither a requirement nor an exclusion: "Section 3.1 of [RFC4648] Implementations MUST include appropriate pad characters ..."
completeness: Section 4: MUST NOT sentence is neither a requirement nor an exclusion: "// P-ENC-LEN covers R-ENC-LEN, R-ENC-LOWER — two characters per byte forall (b: u8[] /* 0..64 */) => miniEncode(b).length === 2 * b.length miniEncode MUST NOT emit uppercase digits."
```

**The shared cause.** [src/spec/xml/text.ts](src/spec/xml/text.ts) `xmlSectionLines` writes a spec section as one line per paragraph, table cell and line of code, with no blank line between blocks. Both paragraph splitters read paragraphs from blank lines: `gateParagraphStarts` in [src/spec/gates/text.ts](src/spec/gates/text.ts), which feeds `gateSentenceSpan` and completeness, and `gateProse` in [src/spec/gates/result.ts](src/spec/gates/result.ts). So each sees a whole spec section as one paragraph. A sentence then ends only at `.` followed by a capital, and code text or a citation line runs into the next sentence. RFC text has real blank lines and is not affected.

**Misread 3 (retract).** The lead confirmed that the result gate reads a property's text. A requirement after a property whose title says "is not" is refused with `is cut from a sentence that qualifies it before the quote ("not")` (variant `va` below). The exact "retracts … after stating it ('not')" form the user reported did not reproduce from the lead's guesses at their layout. Their spec is not pushed. The worker finds the layout that does reproduce it before fixing (see Block bounds).

**Misread 1, the rest.** [src/spec/gates/completeness.ts](src/spec/gates/completeness.ts) `gateSectionQuotes` counts only quotes whose source is the main one (`gateInMain`). An anchored blockquote quoting RFC4648 in the spec has source `rfc4648` and section `3.1`, so its words in the spec's own §3 count as nobody's quote. In a main-RFC profile the spec's text is not the main source, so the gate never reads it there.

## Approach

- Two stages with disjoint files, developed in parallel, **merged block-bounds first**. The second quote's sentence beginning with the first quote's citation is a block-boundary bug (stage 1), even though it shows up in misread 1. Stage 2 is tested with one anchored quote, and with two quotes in separate sections, so it passes against `main` without stage 1. The two-quotes-in-one-section case is checked end to end by acceptance once both have merged.
- Fix the boundary where both splitters can see it, not by patching each gate's message. Where the fix lives (blank separator lines from `xmlSectionLines`, or a block-start list carried on the section) is the worker's call. Whichever it is, `rfcOwnSpans`, quote finding and the `file:line` positions vector prints must keep working. An RFC's text must read exactly as before.
- Stage 2 must not weaken the gate. An RFC quote covers its words only in the spec section where its anchored blockquote stands. It never covers the same words elsewhere, and never covers the spec's own unquoted prose.

## Block bounds

Owns: `src/spec/xml/**`, `src/spec/gates/text.ts`, `src/spec/gates/result.ts`, `src/spec/source/rfc.ts`, `src/spec/source/load.ts`, `tests/spec/gates/text_test.ts`, `tests/spec/gates/coverage_test.ts`, `tests/spec/gates/blocks_test.ts` (new), `tests/spec/extract/xml_*_test.ts`, `tests/spec/extract/extract_cases_test.ts`, `tests/spec/extract/extract_gates_test.ts`, `tests/spec/source/rfc_test.ts`, `tests/cli/**` except any directory named `extract-anchored-quote*` or `check-anchored-quote*` (stage 2's), `tests/fixtures/**` except `tests/fixtures/anchored-quote/**` (stage 2's)

1. Reproduce first: misread 2 (Repro §4), the deny form (variant `va`), and the user's retract form. The retract form is a requirement `websocketKeyIsValid MUST return false for any key other than …`, a `{{anchor}}` vector expecting `false`, and a following property titled `// P-KEY-LEN covers R-KEY-INVALID — the encoding of any other number of bytes is not`. Try the property directly after the requirement with more prose after it in the same section. If no layout reproduces "retracts", say so in the PR body with the layouts tried, and pin the general rule instead: `gateOccurrence`'s `tail` never reaches past the requirement's own sentence.
2. Also pin the citation bleed: in a section with two anchored blockquotes, the second quote's sentence starts at `Implementations`, not `Section 3.1 of [RFC4648]`. Assert it at the sentence-span level (`gateSentenceSpan` or `gateProse` over the section `xmlSectionLines` builds), because completeness still refuses that section until stage 2 lands.
3. Fix it so that no reader of a spec's own text sees a sentence span a block. `src/spec/gates/completeness.ts` is stage 2's file. Keep the calls it makes working unchanged (`gateParagraphStarts(sec.ownLines)`, then `gateSentenceSpan(text, paras, at)`), so the fix reaches completeness without editing it. Put the fix in the section's lines or inside those two functions, never in a new parameter completeness would have to pass.

## Anchored quotes

Owns: `src/spec/gates/completeness.ts`, `src/spec/profile/**`, `tests/spec/gates/completeness_test.ts`, `tests/spec/extract/profile_*_test.ts`, `tests/cli/extract-anchored-quote*/**`, `tests/cli/check-anchored-quote*/**`, `tests/fixtures/anchored-quote/**`, `docs/guide/guides/spec-to-contract.md`, `docs/AI.md`, `.claude/skills/vector-spec/**` (only if a rule a guide states changes)

1. Reproduce misread 1 with Repro §3 cut down to one anchored quote (R-NO-LF): `spec extract` exits 1 with the completeness finding.
2. Count the quote. The coverage spans for a spec section include the quotes of requirements anchored on blockquotes in that section, whatever source they cite. If the contract does not say which spec section a requirement's blockquote stands in, have the profile record it. Do not match the quote text against every section.
3. Docs: if a guide page or `docs/AI.md` says an RFC quote counts only in a main-RFC profile, correct it. Otherwise leave the docs alone.

## Repro

`specs/mini-b64.md`. Build it with `scripts/build-spec.sh`, copy `rfcs/rfc4648.txt` beside it in `rfcs/`, create `contracts/`, then run `dist/vector spec extract specs/mini-b64.xml`:

````markdown
---
title: "Spec 0002: mini — repro"
abbrev: mini
docname: draft-mini-b64-00
category: info
ipr: trust200902
submissiontype: independent
v: 3
date: 2026-11-19
author:
  - name: Vector Authors
    org: vector
normative:
  RFC4648:
--- abstract

Status: proposed. Module: std/mini.ts (nish/mini). A repro.

--- middle

# Introduction

{::boilerplate bcp14-tagged}

A repro of three misreads.

# Interface

~~~ ts-interface
// module: nish/mini
export const miniEncode = (bytes: u8[]): string
export const miniIsValid = (text: string): boolean
~~~

# Line feeds

> Implementations MUST NOT add line feeds to base-encoded data unless the
> specification referring to this document explicitly directs base encoders
> to add line feeds after a specific number of characters.
> {{Section 3.1 of RFC4648}}
{: #R-NO-LF gi="blockquote"}

> Implementations MUST include appropriate pad characters at the end of
> encoded data unless the specification referring to this document
> explicitly states otherwise.
> {{Section 3.2 of RFC4648}}
{: #R-PAD gi="blockquote"}

~~~ ts-property
// P-NO-LF covers R-NO-LF, R-PAD — no line feed
forall (b: u8[] /* 0..64 */) => miniEncode(b).length === 2 * b.length
~~~

# Length

miniEncode MUST return exactly two characters per input byte.
{: #R-ENC-LEN}

~~~ ts-property
// P-ENC-LEN covers R-ENC-LEN, R-ENC-LOWER — two characters per byte
forall (b: u8[] /* 0..64 */) => miniEncode(b).length === 2 * b.length
~~~

miniEncode MUST NOT emit uppercase digits.
{: #R-ENC-LOWER}

# Validity {#validity}

miniIsValid MUST return false for any text other than an even run of hex digits.
{: #R-VALID}

~~~ ts-property
// P-ODD covers R-VALID — a text of odd length is not
forall (t: string /* 1..33 hexdigit */) => miniIsValid(t) === false
where t.length % 2 === 1
~~~

# Test Vectors

| Id | Call | Expected | Covers | Source | Title |
|----|------|----------|--------|--------|-------|
| V1 | `miniIsValid("abc")` | `false` | R-VALID | {{validity}} | an odd length is not valid |
````

Variant `va` (the deny form): drop §3 and R-ENC-LOWER (and the `normative` reference), then add `miniIsValid MUST return true for an even run of hex digits.` `{: #R-VALID-YES}` after the P-ODD block, with a vector `` `miniIsValid("ab")` `` → `` `true` `` covering it from `{{validity}}`. Today it is refused with `is cut from a sentence that qualifies it before the quote ("not")`.

## Acceptance criteria

Checked on `main` after both PRs merge, with the Repro spec built in a scratch directory as described above.

1. `vector spec extract specs/mini-b64.xml` exits 0 with no completeness finding, and `vector spec check` on the contract it writes reports `CONTRACT_VALID`.
2. Variant `va` extracts with exit 0, and `spec check` on its contract reports `CONTRACT_VALID` with no provenance finding for R-VALID-YES.
3. The gate still refuses what it should. Each of the following makes `spec extract` exit 1 with exactly one completeness finding, quoting that sentence alone, with no property text and no citation in it: (a) the Repro with the `{: #R-NO-LF gi="blockquote"}` line removed; (b) the Repro with `miniEncode MUST NOT emit a line feed.` added untested as its own paragraph at the end of §4.
4. A requirement whose own sentence takes its result back is still refused. With R-VALID changed to `miniIsValid MUST return false for any text other than an even run of hex digits, but not for the empty text.`, `spec check` (or `spec extract`) refuses V1 and names the retracting word.
5. Each fix is pinned. On `main` after both merges, reverting the `src/` changes of either PR alone makes `node tests/run.mjs spec` or `node tests/run.mjs cli` report at least one failure.
6. `npm run build`, `npm test`, `npm run lint`, `npm run tested-exports`, `npm run dogfood` and the Spec workflow's extract `--check` loop all exit 0 on `main` after the last merge.

## Out of scope

- Any change to how RFC text (`.txt`, or RFC `.xml` as a source) is paragraphed.
- New syntax for specs. The kramdown forms above are what nish writes today.
- The main-RFC profile's behaviour, except as a neighbour test that pins it unchanged.

## Tests

Per CLAUDE.md, each fix lands with a test that fails without it, driven through `vectorRun` or the binary. Each test is table-driven, with neighbour rows next to the motivating one:

| stage | motivating row | neighbours |
|---|---|---|
| block-bounds | requirement after a ts-property is anchored; property title never in a reported sentence; "not" in a property title neither denies nor retracts; citation of quote 1 does not lead quote 2's sentence | requirement before a property; property between two requirements; artwork and table cell boundaries; a two-line paragraph is still one sentence; a real "MUST return false, not …" still refused; RFC `.txt` through `rfcParse` with `[Page N]` footers and `\f` headers reads as before |
| anchored-quotes | one anchored RFC4648 quote in a non-main-RFC spec passes completeness | unanchored RFC blockquote with MUST still reported; spec's own unquoted MUST sentence still reported; quote text repeated as prose in another section still reported; a main-RFC profile is unchanged; two anchored quotes in different sections |

## Verification

`npm run build`, `node tests/run.mjs spec`, `node tests/run.mjs cli`, `npm run lint`, `npm run tested-exports`, `npm run dogfood`, and the Spec workflow's extract check (`for f in specs/*.xml; do ./dist/vector spec extract "$f" -o "contracts/$(basename "$f" .xml).json" --check; done`).
