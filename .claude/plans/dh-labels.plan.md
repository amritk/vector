---
name: Label grammar for RFC 7748 §6.1's Diffie-Hellman labels
overview: Extend the labelled-value grammar so a vector row can cite "Alice's private key, a", "Alice's public key, X25519(a, 9)" and "Their shared secret, K" verbatim (apostrophe, a ", alias" suffix, a group holding a comma), with fidelity still refusing any row whose values are not printed under those labels in the cited section.
stages:
  - id: label-grammar
    title: "feat(spec): let a label hold an apostrophe, a comma alias and a group with a comma"
    goal: Rows labelled as RFC 7748 §6.1 prints its test vector extract and pass fidelity, and near-miss labels are still refused
    verification: npm run build && node tests/run.mjs spec && node tests/run.mjs cli && npm run lint && npm run tested-exports && npm run dogfood
    todos:
      - id: reproduce
        content: Reproduce the refusal on main (Call/Expected "not a literal" for the §6.1 rows) before changing anything — see Reproduction
        status: pending
      - id: grammar
        content: Extend literalsLabelEnd and its helpers in src/spec/contract/literals.ts with the three forms — see Grammar
        status: pending
      - id: fidelity
        content: Confirm the RFC reader in src/spec/source/rfc.ts and the fidelity gate match the new labels, changing them only if a §6.1 row fails — see Fidelity
        status: pending
      - id: unit-table
        content: Add a table-driven grammar test in tests/spec/contract/literals_test.ts covering the new forms, the old forms and the near misses — see Tests
        status: pending
      - id: e2e
        content: Add an RFC 7748 §6.1 fixture spec plus an extract test and CLI goldens through the binary, accepted and refused — see Tests
        status: pending
      - id: guide
        content: Update the labelled-bytes row and the Labels bullet of docs/guide/guides/writing-a-spec.md — see Guide
        status: pending
---

# Label grammar for RFC 7748 §6.1

## Why

RFC 7748 §6.1 prints its Diffie-Hellman test vector under these labels:

```
Alice's private key, a:
Alice's public key, X25519(a, 9):
Bob's private key, b:
Bob's public key, X25519(b, 9):
Their shared secret, K:
```

vector 0.3.1's `literalsLabelEnd` (src/spec/contract/literals.ts) allows label
words of `[A-Za-z0-9_-]` one space apart, plus at most one parenthesised
group, entered only after a space, with no comma inside it. So it rejects the
apostrophe, the `, a` alias, and the `X25519(a, 9)` group. amritk/nish works
around this by keeping the values in a property (P-DH-VECTOR in
specs/rfc7748-x25519.md), so fidelity never checks them.

## Stage label-grammar

**Owns:** `src/spec/contract/literals.ts`, `src/spec/source/rfc.ts`, `src/spec/gates/**`, `tests/spec/**`, `tests/cli/**`, `tests/fixtures/**`, `docs/guide/**`, `docs/reference/**` (generated, regenerate only)

### Reproduction

The lead reproduced it on main @ f787185. A copy of
`tests/fixtures/rfc7748/specs/rfc7748-iterated.md` that declares
`x25519Base`, adds an R-DH quote from Section 6.1 ("Both now share K = X25519(a, X25519(b, 9)) = X25519(b, X25519(a, 9)) as a shared secret.") and these two rows:

```
| 6.1-ALICE | `x25519Base(Alice's private key, a = 77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a)` | `Alice's public key, X25519(a, 9) = 8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a` | R-DH | {{Section 6.1 of RFC7748}} | Alice's public key |
| 6.1-K | `x25519(Alice's private key, a = 77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a, Bob's public key, X25519(b, 9) = de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f)` | `Their shared secret, K = 4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742` | R-DH | {{Section 6.1 of RFC7748}} | the shared secret |
```

builds with `scripts/build-spec.sh` and `vector spec extract` exits 1 with
`Call: not a literal` and `Expected: not a literal` for both rows. Reproduce
this first, and keep it as the regression: it must exit 0 after the change.

### Grammar

Extend the label grammar, and only these three ways:

1. **An apostrophe inside a word**, joined to letters on both sides
   (`Alice's`, `Bob's`). An apostrophe that opens or closes a word, or two in a
   row, is still refused.
2. **A `, <alias>` suffix**: after the label's words, exactly `, ` and one
   alias, then ` = `. The alias is one label word, or a word joined to a
   parenthesised group (`X25519(a, 9)`). Only one alias. Because `,` also
   separates Call arguments, the comma is part of a label only when the alias
   after it is followed by ` = `. Otherwise it ends the argument as it does
   today. `f(Key = 00, b = 11)` must still read as two arguments.
3. **A group that holds a comma**: inside a group, words may be separated by
   `, ` as well as a space (`X25519(a, 9)`, `X25519(b, 9)`). A bare comma, a
   leading or trailing comma, an empty group, a nested paren and an unclosed
   group are still refused. The existing space-then-group form
   (`MESSAGE (length 1 byte)`) and its "at most one group" rule are unchanged.

Keep every existing form parsing exactly as it does now:
`32-bit fixed-common part`, `After 1,000 iterations`,
`MESSAGE (length 1 byte)`, runs (`22 x 0b`), labelled ints, `(empty)` and `[]`.
Update the doc comment on `literalsLabelEnd`, and on any helper you add.
Function names are unique program-wide, so prefix them `literals`.

### Fidelity

`rfcLabelLine` / `rfcLabelBefore` (src/spec/source/rfc.ts) appear to read
`Alice's private key, a:` as the label `Alice's private key, a`, and
`gateSameLabel` compares labels with whitespace collapsed and case ignored. So
fidelity may need no change. Prove it with the e2e test. If it does need a
change, keep it as narrow as the grammar change. **Fidelity stays strict.**
A row must still be refused when:

- the label is not printed in the cited section (`Alice's private key, b`,
  `Alice private key, a`, `Alice's public key, X25519(a, 5)`);
- the value is printed, but under another label (Bob's key under `Alice's private key, a`);
- the section cited is not the one that prints it (`{{Section 6.2 of RFC7748}}`);
- an argument is not printed in the section at all, such as
  `x25519(Alice's private key, a = 7707…, [09 00 … 00])`: the encoded base point is
  described in §6.1's prose, but not printed there as a value.

### Tests

Per CLAUDE.md, a new rule lands with a test that fails without it, and a
grammar rule is tested with its neighbours, table-driven:

- **tests/spec/contract/literals_test.ts**: one table of label cells. Each
  entry gives the cell, the expected outcome (the label, or refused) and,
  for Call cells, the argument count. Accepted: the five §6.1 labels as
  labelled bytes; a §6.1 Call holding two of them as two arguments; the
  existing forms above. Refused near misses: `'Alice`, `Alice'`, `Alice''s`,
  `key,a`, `key ,a`, `key, , a`, `key, a, b`, `key,`, `X25519(a,9)` if you
  keep the comma-space rule, `X25519(a, 9`, `X25519()`, `X25519((a))`,
  `X25519(a, )`, and a second group after an alias.
- **An RFC 7748 §6.1 fixture**, such as `tests/fixtures/rfc7748-dh/specs/*.md`
  plus its `.xml`, built with `scripts/build-spec.sh` and never hand-edited.
  Use the RFC text at `tests/fixtures/x25519/rfcs/rfc7748.txt` or a copy laid
  out the same way, and the module `tests/fixtures/x25519/fixture/x25519.ts`,
  which exports `x25519` and `x25519Base`. Rows: the two rows in Reproduction
  above. An extract test (next to `tests/spec/extract/profile_iterate_test.ts`)
  asserts the contract records the labels verbatim and fidelity passes. Its
  table-driven refusals cover the Fidelity bullets above, and assert that
  extract refuses each one with fidelity's message.
- **CLI goldens** in `tests/cli/<case>/`, driving the binary: `vector spec
  extract` on the fixture exits 0, and on a near-miss copy exits 1 with the
  refusal on stderr. If it is cheap, also run `vector spec run --package
  fixture=tests/fixtures/x25519/fixture` on the fixture contract and assert
  `SATISFIED`.

### Guide

`docs/guide/guides/writing-a-spec.md` has a `Key = 0b0b0b` row in the
literals table, which lists the label forms and the ones that are refused,
and a **Labels** bullet in "What a printed value is". Add the apostrophe, the
`, alias` suffix and the group with a comma, with the §6.1 labels as the
examples. Update the refused list to match. If a doc comment you changed
feeds `docs/reference/**`, regenerate it with `node scripts/gen-reference.mjs`.

## After this ships (not this stage)

amritk/nish's `specs/rfc7748-x25519.md` replaces P-DH-VECTOR's transcribed bytes
with §6.1 vector rows. The lead writes out the exact rows at close-out.
