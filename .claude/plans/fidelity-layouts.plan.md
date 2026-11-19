---
name: Fidelity reads six more RFC layouts
overview: Specs for RFC 9001, 7914, 6455 and 6979 fell back to python3 commands because fidelity cannot bind values those RFCs print. Teach the RFC reader and the fidelity gate the six layouts, each tested on page-broken RFC text, in three serial PRs.
stages:
  - id: wrapped-values
    title: "feat(spec): read values named across wrapped lines"
    goal: A value printed on `= hex` continuation lines takes the name of the statement above it, and a value under a wrapped call label pairs with the arguments printed in that label (items 1 and 2).
    verification: npm run build && node tests/run.mjs spec && npm test && npm run lint && npm run tested-exports && npm run doc-caps
    todos:
      - id: continuation-name
        content: Name a value printed on `= <hex>` lines after `name = f(...)` or `name` + `= f(...)` in rfcHexRead (src/spec/source/rfc.ts) — see Wrapped values
      - id: wrapped-call-label
        content: Join a call label wrapped over several lines into one label with its line span, in src/spec/source/rfc.ts — see Wrapped values
      - id: label-args-pair
        content: Pair a vector's string and number arguments printed inside its expected value's call label as one test case, in src/spec/gates/fidelity.ts — see Wrapped values
      - id: wrapped-tests
        content: Table-driven tests on page-broken RFC 9001 A.1 and RFC 7914 §11 text, plus a CLI golden for each — see Tests
      - id: wrapped-docs
        content: Describe both layouts in docs/guide/guides/writing-a-spec.md ("What a printed value is"), docs/AI.md and the vector-spec skill, within their caps — see Docs
  - id: case-pairing
    title: "feat(spec): pair values under case headings and within one prose example"
    goal: A line such as `With SHA-256, message = "sample":` heads a test case, values printed above every case belong to each, and values in one wrapped prose example pair (items 3 and 4).
    verification: npm run build && node tests/run.mjs spec && npm test && npm run lint && npm run tested-exports && npm run doc-caps
    todos:
      - id: case-heading
        content: Read `With <words>, <name> = "<text>":` as a case heading beside `Test Vector #N:`, in src/spec/source/rfc.ts — see Case headings
      - id: heading-pairs-round
        content: Pair a string printed on a case heading with the labelled values under that heading, and a value printed above the first heading with every case, in src/spec/gates/fidelity.ts — see Case headings
      - id: prose-pairing
        content: Pair text, numbers and 0x values printed in one prose example that wraps over lines, in src/spec/gates/fidelity.ts — see Prose examples
      - id: case-tests
        content: Table-driven tests on page-broken RFC 6979 A.2.5, RFC 6455 §4.2.2 and RFC 9000 §A.1 text, plus a CLI golden for each — see Tests
      - id: case-docs
        content: Describe both layouts in the guide, docs/AI.md and the vector-spec skill, within their caps — see Docs
  - id: byte-parts
    title: "feat(spec): bind a format constant and a printed value's tail"
    goal: A spec paragraph can name a concat's unprinted format constant (`Format:`) or split one printed value into a body and a known-length tail (`Tail:`), and fidelity checks and reports both (items 5 and 6).
    verification: npm run build && node tests/run.mjs spec && npm test && npm run lint && npm run tested-exports && npm run doc-caps && npm run dogfood
    todos:
      - id: parts-paragraphs
        content: Read `Format:` and `Tail:` paragraphs after a vector table in src/spec/profile/profile.ts and carry them into the contract (types, read, write, shape, schemas) — see Byte parts
      - id: parts-gate
        content: Check a named format constant and a tail split in src/spec/gates/fidelity.ts, refusing every form it does not compute — see Byte parts
      - id: parts-evidence
        content: Report each constant and tail with its reason in the check's report (src/spec/report) — see Byte parts
      - id: parts-tests
        content: Tests driven through vectorRun or the binary on page-broken RFC 6979 A.2.5 and RFC 9001 A.4 text, each condition shown to fail when deleted — see Tests
      - id: parts-docs
        content: Document both paragraphs in the guide, the file-formats page if the contract changes, docs/AI.md and the vector-spec skill — see Docs
---

# Fidelity reads six more RFC layouts

## Context

Writing nish's RFC 9001, 7914, 6455 and 6979 specs against vector 0.5.0, six printed values could not be cited. Each spec fell back to a `python3 -c` command that recomputes the value, which is weaker than a cite. The values are read by [src/spec/source/rfc.ts](../../src/spec/source/rfc.ts) (`rfcHexRead`, `rfcCaseHeading`) and judged by [src/spec/gates/fidelity.ts](../../src/spec/gates/fidelity.ts) (`gateHexCheck`, `gateOneTestCase`, `gateOnceRound`, `gateLitCheck`).

Every stage edits `fidelity.ts` and the same docs, so the stages run one after another: each starts from `main` after the one before it merges. Each is worth merging on its own.

## Wrapped values

Item 1, RFC 9001 Appendix A.1 (RFC 8448's traces are similar):

```
   initial_secret = HKDF-Extract(initial_salt, cid)
       = 7db5df06e7a69e432496adedb0085192
         3595221596ae2ae9fb8115c1e9ed0a44

   client_initial_secret
       = HKDF-Expand-Label(initial_secret, "client in", "", 32)
       = c00cf151ca5be075ed0ebfb5c80323c4
         2d6b7db67881289af4008f1f6c357aea

   key = HKDF-Expand-Label(client_initial_secret, "quic key", "", 16)
       = 1f369613dd76d5467730efcbe3b1a22d
```

Today the `= c00c…` line is a text line (it starts with `=`), so only the second half is read, unnamed: "the 32-byte expect is not printed in rfc9001 §A.1". A line `= <hex>` continues the statement above it, and its value takes that statement's name: the text before the first `=` of the statement's first line (`initial_secret`, `client_initial_secret`, `key`). The `= f(...)` line between is part of the statement, not a label. `key`, `iv` and `hp` are printed twice in §A.1 (client, then server), so they are repeated labels and pair by round as today.

Item 2, RFC 7914 §11:

```
   PBKDF2-HMAC-SHA-256 (P="passwd", S="salt",
                       c=1, dkLen=64) =
   55 ac 04 6e 56 e3 08 9f ec 16 91 c2 25 44 b6 05
   …
```

Today the label is `c=1, dkLen=64)`, which no literal label can spell. A call label wrapped over lines (an open parenthesis on one line, closed on a later line that ends the label with `=` or `:`) is one label, whitespace collapsed: `PBKDF2-HMAC-SHA-256 (P="passwd", S="salt", c=1, dkLen=64)`. The vector's arguments printed inside that label ("passwd", "salt", `c=1`, `dkLen=64`) pair with the value below it as one test case, so the spec does not have to name the label at all to say which case it is. Arguments printed in another case's label are refused. §12's scrypt vectors print the same shape on one line; they must keep working.

## Case headings

Item 3, RFC 6979 Appendix A.2.5: the key pair (`x`, `Ux`, `Uy`) is printed once, above ten cases, each headed `With SHA-<n>, message = "<text>":` and holding `k`, `r` and `s`. A page break falls between the `"sample"` and `"test"` cases. Today the string `"sample"` and the repeated `r`/`s` are refused: "nothing pairs a printed string with one of several labelled values: cite the subsection that holds one test case".

Treat the line as a case heading, as `Test Vector #N:` already is: a string printed on a heading pairs with the round of labelled values under that heading (up to the next heading or the section's end), and a value printed once above the first heading belongs to every case. Today `gateOnceRound` ties such a value to the first round only, which would refuse `x` for every case but SHA-1 "sample". Whether a heading can also be named in the spec to narrow the section, as `Test Vector #N` can, is the worker's call; if it is, an `x` printed above the case must still be found.

## Prose examples

Item 4. RFC 6455 §4.2.2:

```
   NOTE: As an example, if the value of the |Sec-WebSocket-Key| header
   field in the client's handshake were "dGhlIHNhbXBsZSBub25jZQ==", the
   …
   is then base64-encoded, to give the value
   "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=", which would be returned in the
```

RFC 9000 §A.1:

```
   For example, the eight-byte sequence 0xc2197c5eff14e88c decodes to
   the decimal value 151,288,809,941,952,652; the four-byte sequence
   0x9d7f3e7d decodes to 494,878,333; the two-byte sequence 0x7bbd
   decodes to 15,293; and the single byte 0x25 decodes to 37 (as does
   the two-byte sequence 0x4025).
```

Today "never on one line together" refuses both. The pairing unit has to accept both and still refuse a wrong pair. Note the tension: the 6455 key and accept value are in different sentences of one paragraph with no `;`, while the 9000 sentence holds four examples split by `;`, so `0xc2197c5eff14e88c` with `494,878,333` shares a sentence and must still be refused. Values in two different paragraphs never pair; a page break inside a paragraph does not end it. The 9000 expected value is an unlabelled integer with thousands separators; how the contract finds it (it has no `label` to find it by today) is part of this stage.

## Byte parts

Both items add a spec paragraph that names part of one vector's bytes with a reason, read in [src/spec/profile/profile.ts](../../src/spec/profile/profile.ts) beside `Untested:` and `Note:`, and carried into the contract so the gate can check it. The exact grammar is the worker's design; it names the vector by id and the part by its place in the literal.

Item 5, RFC 6979 A.2.5: the public key as `concat([04], Ux = …, Uy = …)`. SEC1's `04` is never printed in the section, so it is refused as "only part of a value printed … under k". A `Format:` paragraph (for example `Format: 04 before Ux and Uy is SEC1's uncompressed point prefix`) lets that one literal part of a concat go unprinted. It is allowed only for a part of a concat whose other parts are printed and bound; it is not a general escape (the existing `unchecked` reason is not reachable from a spec, and must stay so). The check's report names the constant and the reason as evidence.

Item 6, RFC 9001 A.4: the Retry packet is printed whole, its 16-byte integrity tag last. A `Tail:` paragraph (for example `Tail: retry-tag is the last 16 bytes of the Retry packet`) binds the expected value to the last N bytes of one whole printed value and the argument to the bytes before it. Per CLAUDE.md, the gate computes this rather than assumes it: the argument and expected value, joined, are byte for byte one whole printed value, the tail is exactly N bytes, and N is what the paragraph says. Every condition lands with a test shown to fail when it is deleted.

## Docs

Each stage updates, in its own PR: [docs/guide/guides/writing-a-spec.md](../../docs/guide/guides/writing-a-spec.md) ("What a printed value is"), [docs/AI.md](../../docs/AI.md) and [.claude/skills/vector-spec/SKILL.md](../vector-spec/SKILL.md), within the caps in [scripts/doc-caps.json](../../scripts/doc-caps.json) (shorten in place; never raise a cap). Stage `byte-parts` also updates [docs/guide/guides/file-formats.md](../../docs/guide/guides/file-formats.md) and [schemas/](../../schemas) if the contract gains a field. Generated reference pages are regenerated, never edited.

## Owns

Every stage runs alone, so the lanes may overlap; each names what its worker may touch.

- **wrapped-values** — **Owns:** `src/spec/source/**`, `src/spec/gates/**`, `tests/spec/source/**`, `tests/spec/gates/**`, `tests/cli/**`, `tests/fixtures/**`, `tests/guide/**`, `rfcs/**`, `THIRD_PARTY_NOTICES.md`, `docs/guide/**`, `docs/AI.md`, `.claude/skills/vector-spec/**`
- **case-pairing** — **Owns:** the same globs as wrapped-values
- **byte-parts** — **Owns:** the globs above, plus `src/spec/profile/**`, `src/spec/contract/**`, `src/spec/report/**`, `src/spec/front/**`, `src/spec/xml/**`, `src/spec/extract.ts`, `src/spec/check.ts`, `schemas/**`, `tests/spec/contract/**`, `tests/spec/extract/**`, `tests/spec/emit/**`

Generated (regenerate, never edit): `docs/reference/**`, `scalar.config.json`, `tests/dogfood/**`, `contracts/*.json`, `specs/*.xml`, `tests/fixtures/**/*.xml`.

## Tests

CLAUDE.md's rule for a gate rule that reads an RFC's layout applies to every stage: the text goes through `rfcParse` with real `[Page N]` footers and `\f` headers; a value on each side of a page break; two separate blocks split only by one. Table-driven, with each rule's neighbours, mirroring [tests/spec/gates/fidelity_test.ts](../../tests/spec/gates/fidelity_test.ts) and [tests/spec/source/rfc_test.ts](../../tests/spec/source/rfc_test.ts). Each layout also gets a golden under `tests/cli/` driving `vector spec check` on an excerpt of the real RFC. Each stage's refusals keep a negative case: a mismatched pair from another case, round or example is refused.

## Out of scope

- Changing what `Test Vector #N` narrowing does today, or any existing refusal's meaning beyond the layouts named here.
- Rewriting nish's specs; that happens in nish once a release carries this.
- Recomputing values (no new `python3`-style source kinds).

## Verification

Each stage's `verification` line, run bare (never piped). `npm run dogfood` only in byte-parts, where the profile changes.
