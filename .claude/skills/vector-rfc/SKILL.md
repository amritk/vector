---
name: vector-rfc
description: >-
  Turn an RFC (or a section of one) into a contract and a generated Nish test
  that checks an implementation against it: verbatim requirements, the RFC's
  own test vectors, and properties sampled at solver-chosen boundaries. Every
  quote and every test-vector byte is checked against the RFC text, and every
  MUST/SHALL in the RFC must be tested or explicitly excluded. Use when asked to
  check nish's std/crypto (or any nish module) against an RFC, to write
  RFC-conformance tests, or "RFC => nish test".
---

# vector rfc — RFC → contract → Nish test

**You** write the contract; **the RFC text and Z3 hold the veto**; **nish runs
the test.** You never decide that a quote or a vector is right — `vector rfc
check` does, against the RFC's own text.

## Steps

1. Get the RFC's plain text: `rfcs/rfc<N>.txt` if it is there, otherwise
   `curl -sSfL -o rfcs/rfc<N>.txt https://www.rfc-editor.org/rfc/rfc<N>.txt`
   (unmodified; the IETF Trust allows copying an RFC whole).
2. Read the module under test (`<nish>/std/<path>.ts`) for its exported
   signatures, and the RFC sections that define it. Find every binding
   sentence: `grep -n "MUST\|SHALL\|REQUIRED" rfcs/rfc<N>.txt`.
3. Write `contracts/rfc<N>-<name>.json` against `schemas/rfc-contract.json`.
   `contracts/rfc5869-hkdf-sha256.json` and
   `contracts/rfc8439-chacha20-poly1305.json` are the worked examples.
   - **requirements**: verbatim quotes, cited to the most specific section.
     Level = the BCP 14 keyword, or `DEFINITION` for what the algorithm is.
   - **exclusions**: each MUST/SHALL sentence a functional test cannot observe
     (caller obligations, timing, key management), with the reason and where it
     *is* checked if anywhere.
   - **vector clauses**: the RFC's test vectors, values copied as lowercase hex.
     `concat` when the RFC prints a value in parts (ciphertext + tag).
   - **property clauses**: the RFC's definitions as checks over a typed domain —
     lengths, bounds written as integer comparisons (Z3 samples both sides of
     each), round trips, tamper rejection, and the RFC's construction rebuilt
     from other functions (a reference function from another module names it).
4. `bun run vector rfc check contracts/<file>.json --nish-root <nish>` — repair
   every gate failure it lists (fidelity, completeness, coverage, typing,
   signatures, domain) and re-run until `CONTRACT_VALID`.
5. `bun run vector rfc run contracts/<file>.json --nish-root <nish> -o <main.ts>`
   — compiles and runs the generated test. `build/nish` in the checkout tests
   the working tree; the seed tests the last release's std (it warns).
6. Report the dashboard: each requirement with its evidence, the exclusions,
   and any failure with its sample. A FAIL is a finding about the
   implementation (or the contract) — show it; never weaken a clause to pass.

## Expression language (property `assert` / `where`)

Literals `{"hex"}`, `{"ascii"}`, `{"int"}`, `{"bool"}`, `{"null":true}`,
`{"concat":[…]}`; `{"var": name}`; `{"call": fn, "args": […]}`;
`{"op": …, "args": […]}` with `len concat slice zeros fill flipBit le64 unwrap
isNull notNull + - * % < <= > >= == != and or not implies`. `unwrap` of a null
fails the sample. `where` may not call the functions under test.

## Limits — say them

A passing contract is evidence, not proof: properties are sampled (Z3
boundaries + seeded random), not quantified. Timing, secret wiping and other
non-functional MUSTs are excluded and must be checked elsewhere (nish's
ct-asm/ct-timing and wipe tests).
