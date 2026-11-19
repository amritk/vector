---
name: Hyphenated module paths
overview: Let a module path segment hold hyphen-joined words (nish/net/quic-packet), everywhere vector reads, maps or names a module, and report a refused ts-interface module line as the first error without the cascade of unknown-function errors it causes today.
stages:
  - id: hyphen-segments
    title: "feat(spec): allow a hyphen inside a module path segment"
    goal: Every place that reads a module path accepts nish/net/quic-packet, refuses -a, a-, a--b and A-b, and maps or names it validly for files and for every language
    verification: npm run build && node tests/run.mjs spec/contract && node tests/run.mjs spec/extract/front && node tests/run.mjs lang && node tests/run.mjs spec/emit && node tests/run.mjs spec/pr && node tests/run.mjs spec/gates && node tests/run.mjs cli && npm run lint && npm run tested-exports && npm run dogfood && npm run doc-caps && node scripts/gen-reference.mjs --check
    todos:
      - id: grammar-chars
        content: Widen charsIsModule in src/spec/contract/chars.ts to the segment grammar, with a table-driven test of the neighbours — see Grammar
        status: pending
      - id: grammar-schema
        content: Update the target.module pattern in schemas/rfc-contract.json and the shapeModule message in src/spec/contract/shape.ts, then regenerate docs/reference — see Grammar
        status: pending
      - id: grammar-front
        content: Prove the ts-interface module line (first and later lines) in src/spec/front/front.ts accepts and refuses the same table, keeping frontNotModule's text unchanged — see Grammar
        status: pending
      - id: file-mapping
        content: Test every module-to-file mapping on a hyphenated module (--nish-root in spec check and emit, emit's Nish import line, spec exports, spec mutate, --package) through vectorRun or the binary — see File mapping
        status: pending
      - id: lang-forms
        content: Make every language form in src/lang/names.ts and the emitters valid for a hyphenated segment, table-driven per language — see Language forms
        status: pending
      - id: hyphen-docs
        content: State the grammar in docs/guide/guides/writing-a-spec.md and docs/AI.md, and the language forms in docs/guide/guides/testing.md — see Docs
        status: pending
  - id: refused-module-first
    title: "fix(spec): report a refused ts-interface module line first, without its cascade"
    goal: A spec whose ts-interface block is refused prints that refusal as its first error and no unknown-function or not-a-function-of-the-block error for the functions the block declares
    verification: npm run build && node tests/run.mjs spec/extract && node tests/run.mjs cli && npm run lint && npm run tested-exports
    todos:
      - id: refusal-first
        content: In src/spec/profile/profile.ts, report a refused ts-interface block before every other refusal and mark the interface refused — see Refusal first
        status: pending
      - id: refusal-no-cascade
        content: Suppress the unknown-function and not-a-function-of-the-block refusals that only follow from a refused interface, keeping every independent refusal — see Refusal first
        status: pending
      - id: refusal-tests
        content: Table-driven tests through the extract pipeline and one CLI golden of the repro spec with a still-refused module line — see Refusal first
        status: pending
---

# Hyphenated module paths

## Context

vector 0.5.0 refuses `// module: nish/net/quic-packet` with "`nish/net/quic-packet` is not a module path; write <root>/<path>, lowercase segments split by /". The grammar is `charsIsModule` in [src/spec/contract/chars.ts](../../src/spec/contract/chars.ts) (`[a-z][a-z0-9_]*` per segment, two or more segments), mirrored by the `pattern` of `target.module` in [schemas/rfc-contract.json](../../schemas/rfc-contract.json), the `shapeModule` message in [src/spec/contract/shape.ts](../../src/spec/contract/shape.ts) and the guide [docs/guide/guides/writing-a-spec.md](../../docs/guide/guides/writing-a-spec.md). nish 0.39.0's std/ has many hyphenated modules (`net/quic-packet`, `net/http1-codec`, `net/http-fields`, `net/tls-tcp`, …), so none of them can be contracted.

Reproduced on main at 230cf32: `tests/fixtures/kramdown/profile.xml` with its module line changed to `nish/net/quic-packet` exits 1 with the module refusal followed by 13 cascade errors (`unknown function \`hexEncode\`` on every property, `"hexDecode" is not a function of the ts-interface block` on every vector). The same file with `nish/net/quic_packet` has none of them. In that fixture the cause happens to print first because errors come out in document order; nothing makes it first, and the 13 errors after it read as the problem.

## Approach

**Segment grammar.** A segment is one or more words joined by single hyphens; the first word keeps today's rule and a later word may start with a digit:

```
segment = [a-z][a-z0-9_]*(-[a-z0-9][a-z0-9_]*)*
module  = segment("/" segment)+
```

This is a strict superset of what 0.5.0 accepts (no contract or spec that extracts today is refused). It accepts `a-b`, `http1-codec`, `x509-random`, `quic-packet`, and refuses `-a`, `a-`, `a--b`, `A-b`, `a-_b`. (The request wrote `[a-z0-9]+(-[a-z0-9]+)*`, which would also drop `_` and allow a leading digit; that would refuse paths 0.5.0 accepts, so this plan keeps both as they are. Sign-off chose this superset grammar.)

**No new message text in front.ts.** `frontNotModule`'s wording stays byte-identical, so the two stages never pin different text and can run at once. `shapeModule`'s message names the grammar and changes with it.

## Grammar

- `charsIsModule`: the grammar above; update its doc comment.
- `schemas/rfc-contract.json`: `pattern` becomes `^[a-z][a-z0-9_]*(?:-[a-z0-9][a-z0-9_]*)*(?:/[a-z][a-z0-9_]*(?:-[a-z0-9][a-z0-9_]*)*)+$`; the description says words joined by `-`. Regenerate `docs/reference/**` with `node scripts/gen-reference.mjs`; never edit it.
- `shapeModule` message: names the new segment grammar. Update its pins in [tests/spec/contract/shape_test.ts](../../tests/spec/contract/shape_test.ts).
- One table, used for `charsIsModule`, `shapeModule` (via a contract) and the ts-interface first and later module lines: accepted `nish/a-b`, `nish/net/quic-packet`, `nish/net/http1-codec`, `nish/crypto/x509-random`, `nish/a-1`, `nish/a_b-c`, `nish/crypto/hkdf`; refused `nish/-a`, `nish/a-`, `nish/a--b`, `nish/A-b`, `nish/a-_b`, `nish/a-B`, `-nish/a`, `nish-/a`, `nish/a/-`, `nish`, `Nish/a`. A test is shown to fail with the hyphen rule removed and with each refusal branch removed.

## File mapping

Each mapping is driven through `vectorRun` or `dist/vector`, on a hyphenated module, and asserts the file it resolves to or the line it writes:

| place | code | expected |
|---|---|---|
| `--nish-root` (spec check, spec emit) | [src/spec/run/command.ts](../../src/spec/run/command.ts), [src/spec/gates/signatures.ts](../../src/spec/gates/signatures.ts) | `nish/net/quic-packet` → `<root>/std/net/quic-packet.ts` |
| emit's Nish import line | [src/spec/emit/emit.ts](../../src/spec/emit/emit.ts) | `import { quicVarintSize } from "nish/net/quic-packet";` |
| spec exports, spec mutate | `shapeNishModuleFile` in shape.ts, [src/spec/pr/exports.ts](../../src/spec/pr/exports.ts), [src/spec/pr/mutaterun.ts](../../src/spec/pr/mutaterun.ts) | the target file is `std/net/quic-packet.ts`, not refused as "not a nish module" |
| `--package` | `emitModuleFile` in [src/spec/emit/packages.ts](../../src/spec/emit/packages.ts) | `app/net/quic-packet` with `app=src` → `src/net/quic-packet.ts` |

Most of these already pass any non-dot segment; the work is the test that pins each one, plus a fix wherever one does not.

## Language forms

`langModule` / `langQualify` in [src/lang/names.ts](../../src/lang/names.ts) build identifiers from segments, so a `-` would emit invalid code (`nish::net::quic-packet`, `from nish.net.quic-packet import …`, `quic-packet.Fn`). The rule: a path that stays a path (Nish and TypeScript import specifiers, Go import paths, Zig and C file names, Dart URIs) keeps the `-`; a segment that becomes an identifier turns each `-` into `_` (rust, cpp, python, java and kotlin packages, C's qualified prefix, the Zig/TypeScript/Dart qualifier); Go's package qualifier drops it (`quicpacket`); a Pascal form treats it as a word break (`QuicPacket` for ruby, csharp, php, swift and the java/kotlin class). Where an emitter loads a module by file rather than by name (python's `spec.loader`), the file keeps the `-`. Each language gets a row in a table-driven test in [tests/lang/](../../tests/lang/), and python, rust, go and typescript each get one emit test on a hyphenated contract asserting the import line. If `specs/vector-lang-names.md` gains a requirement, rebuild its xml, contract and dogfood test with their generators.

## Docs

User-visible, so in this PR: the grammar in [docs/guide/guides/writing-a-spec.md](../../docs/guide/guides/writing-a-spec.md) and [docs/AI.md](../../docs/AI.md), the hyphen's language forms where [docs/guide/guides/testing.md](../../docs/guide/guides/testing.md) gives language forms. `npm run doc-caps` passes; a doc over its cap is shortened, never its cap raised.

## Refusal first

In [src/spec/profile/profile.ts](../../src/spec/profile/profile.ts) (`frontParseInterface` at the interface, then `frontParseProperty` per property and the vector `Call:` check):

- When the ts-interface block is refused, its refusal is the first error printed, whatever section the block is in.
- Record that the interface was refused. A property's `unknown function \`f\`` and a vector's `"f" is not a function of the ts-interface block` are then not reported when they follow only from that refusal. Every other refusal (a property's syntax, a vector's expected value, a quote not in its RFC, docName) is still reported.
- Exit status stays 1.
- Tests, table-driven through the extract pipeline (mirror [tests/spec/extract/rfc_profiles_test.ts](../../tests/spec/extract/rfc_profiles_test.ts)): each refused-module-line form (`Std/len`, a block comment, a later module line refused, the first line missing) as the first error and with no cascade; an interface placed after the sections that call it; a spec with an independent refusal elsewhere that still reports it. Each condition is shown to fail when deleted. One CLI golden under `tests/cli/extract-module-refused/` with a fixture under `tests/fixtures/module-refused/`, using the repro (`quicVarintSize` in a property, `quicVarintRead` in a vector) under a module line that stays refused on both grammars (`nish/net/Quic-packet`).

## Out of scope

- Uppercase or other characters in a segment, and single-segment modules.
- Changing `frontNotModule`'s wording.
- Contracting any nish std module; this only makes it possible.

## Tests

Named in each section above. Existing files to mirror: [tests/spec/contract/shape_test.ts](../../tests/spec/contract/shape_test.ts), [tests/spec/extract/front_test.ts](../../tests/spec/extract/front_test.ts), [tests/spec/emit/packages_test.ts](../../tests/spec/emit/packages_test.ts), [tests/spec/extract/rfc_profiles_test.ts](../../tests/spec/extract/rfc_profiles_test.ts).

## Stage ownership

**hyphen-segments** — Owns: `src/spec/contract/chars.ts`, `src/spec/contract/shape.ts`, `src/spec/front/front.ts`, `src/lang/**`, `src/spec/emit/**`, `src/spec/pr/**`, `src/spec/run/**`, `src/spec/gates/**`, `src/spec/check.ts`, `src/cli/spec-*.ts`, `schemas/rfc-contract.json`, `tests/spec/contract/**`, `tests/spec/extract/front_test.ts`, `tests/spec/extract/front_cases_test.ts`, `tests/lang/**`, `tests/spec/emit/**`, `tests/spec/pr/**`, `tests/spec/gates/**`, `tests/cli/hyphen-module-*/**`, `tests/fixtures/hyphen-module*/**`, `specs/vector-lang-names.md`, `docs/guide/guides/writing-a-spec.md`, `docs/guide/guides/testing.md`, `docs/AI.md`.

**refused-module-first** — Owns: `src/spec/profile/**`, `tests/spec/extract/rfc_profiles_test.ts`, `tests/spec/extract/profile*_test.ts`, `tests/spec/extract/extract*_test.ts`, `tests/cli/extract-*/**` (the extract goldens pin profile.ts output; new case `tests/cli/extract-module-refused/`), `tests/fixtures/module-refused/**`. Depends on: hyphen-segments (merge order only).

Generated, regenerated by either stage with the repo's tooling: `docs/reference/**`, `scalar.config.json`, `tests/dogfood/**`, `contracts/*.json`, `specs/*.xml`.

## Verification

Each stage's `verification` line, then CI (`.github/workflows/ci.yml`, `spec.yml`, `docs.yml`, `pr-title.yml`).
