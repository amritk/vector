---
name: vector-spec
description: >-
  Turn a specification — an RFC, or a markdown spec with numbered headings —
  into a contract and a generated Nish test that checks an implementation
  against it: verbatim requirements, the spec's own test vectors, and
  properties sampled at solver-chosen boundaries. Every quote and every
  test-vector byte is checked against the spec text, every vector says where
  its expected value comes from, and every MUST/SHALL in the main spec must be
  tested or explicitly excluded. Use when asked to check nish's std/crypto (or
  any nish module) against an RFC or a spec, to write RFC-conformance tests, or
  "RFC => nish test" / "spec => nish test".
---

# vector spec — spec → contract → Nish test

`vector rfc` is the same command under its old name.

**You** write the contract; **the spec text and Z3 hold the veto**; **nish runs
the test.** You never decide that a quote or a vector is right — `vector spec
check` does, against the spec's own text.

## Steps

1. Get the spec's text. An RFC: `rfcs/rfc<N>.txt` if it is there, otherwise
   `curl -sSfL -o rfcs/rfc<N>.txt https://www.rfc-editor.org/rfc/rfc<N>.txt`
   (unmodified; the IETF Trust allows copying an RFC whole). A markdown spec:
   its sections must be numbered headings (`## 3. Encoding`, `### 3.1. Length`,
   `## Appendix A. Vectors`); a MUST outside every numbered section is refused.
2. Read the module under test (`<nish>/std/<path>.ts`) for its exported
   signatures, and the spec sections that define it. Find every binding
   sentence: `grep -n "MUST\|SHALL\|REQUIRED" <spec>`.
3. Write `contracts/<name>.json` against `schemas/rfc-contract.json`.
   `contracts/rfc5869-hkdf-sha256.json` and
   `contracts/rfc8439-chacha20-poly1305.json` are the worked examples.
   - **source**: one RFC is `"source": {"rfc": N, "title": …}`. Several
     documents (or a markdown spec) are `"sources": [{"id": "hex", "path":
     "../specs/hex.md"}, {"id": "rfc4648", "rfc": 4648}]` with
     `"source": {"title": …, "main": "hex"}`. Completeness reads only the main
     source; any citation may name another with `"source": "<id>"`.
   - **requirements**: verbatim quotes, cited to the most specific section.
     Level = the BCP 14 keyword, or `DEFINITION` for what the algorithm is.
   - **exclusions**: each MUST/SHALL sentence a functional test cannot observe
     (caller obligations, timing, key management), with the reason and where it
     *is* checked if anywhere.
   - **vector clauses**: the spec's test vectors, values copied as lowercase
     hex. `concat` when the spec prints a value in parts (ciphertext + tag).
     Every vector has a `source` for its expected value:
     - `{"cite": {"section": "A.1"}}` (optionally `"source": "<id>"`): args and
       expected value are printed in that section. Prefer this.
     - `{"command": "…"}` plus `"section"` (where the args are printed): the
       expected value is the command's trimmed stdout (hex for bytes). It runs
       only under `--run-sources` (30 s timeout); otherwise it is reported as
       not run, never as passed.
     - `{"spec": "4.2"}` plus `"section"`: only for an expected `null` or
       `bool`. The vector must `cover` a requirement cited to §4.2 whose quote
       states the value as an affirmative requirement ("f MUST return null
       when …", "f SHALL be false") — not "null or …", not "null-terminated",
       not retracted later, not only in a table or code block, and not cut
       from a qualified sentence (the whole prose sentence around the quote
       is read: "For example, … MUST return null" fails). A descriptive
       "f returns null on failure" does not count; see the README's rule. A
       `cite` source for `null` or a `bool` is held to the same rule.
   - **property clauses**: the spec's definitions as checks over a typed
     domain — lengths, bounds written as integer comparisons (Z3 samples both
     sides of each), round trips, tamper rejection, and the construction
     rebuilt from other functions (a reference function from another module
     names it).
4. `bun run vector spec check contracts/<file>.json --nish-root <nish>` — repair
   every gate failure it lists (fidelity, completeness, coverage, provenance,
   typing, signatures, domain) and re-run until `CONTRACT_VALID`. Pass
   `--spec <file>` when the main source's text is elsewhere.
5. `bun run vector spec run contracts/<file>.json --nish-root <nish> -o <main.ts>`
   — compiles and runs the generated test. `build/nish` in the checkout tests
   the working tree; the seed tests the last release's std (it warns).
6. Report the dashboard: each requirement with its evidence, the exclusions,
   command sources that were not run, and any failure with its sample. A FAIL
   is a finding about the implementation (or the contract) — show it; never
   weaken a clause to pass.

## Expression language (property `assert` / `where`)

Literals `{"hex"}`, `{"ascii"}`, `{"int"}`, `{"bool"}`, `{"null":true}`,
`{"concat":[…]}`; `{"var": name}`; `{"call": fn, "args": […]}`;
`{"op": …, "args": […]}` with `len concat slice zeros fill flipBit le64 unwrap
isNull notNull + - * % < <= > >= == != and or not implies`. `unwrap` of a null
fails the sample. `where` may not call the functions under test.

## Limits — say them

A passing contract is evidence, not proof: properties are sampled (Z3
boundaries + seeded random), not quantified. A `command` source is only as
good as the command. Timing, secret wiping and other non-functional MUSTs are
excluded and must be checked elsewhere (nish's ct-asm/ct-timing and wipe
tests).
