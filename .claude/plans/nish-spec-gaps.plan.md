---
name: Spec-language gaps nish's specs hit in vector 0.5.0
overview: Integer byte builders of every width and their reverse (bytes to integer), an integer, bool or null Expected from a command source, and a way for a property to drive a function that takes a Secret. Two PRs, in order, since they share the spec front-end, the shape gate and the authoring guide.
stages:
  - id: byte-order
    title: "feat(spec): build and read integers as bytes of every width and both byte orders"
    goal: A property can write any integer type as its little- or big-endian bytes, and read bytes back as an integer, in every emitted language
    verification: npm run build && node tests/run.mjs spec && node tests/run.mjs emit-run && npm run lint && npm run tested-exports && npm run dogfood && npm run doc-caps
    todos:
      - id: bo-typing
        content: Type le16 le32 le64 be16 be32 be64 over any integer no wider than the op, and the read ops over bytes, in src/spec/contract/typing.ts, vocab.ts and front.ts — see Byte order
      - id: bo-sample
        content: Evaluate and SMT-encode the new ops in src/spec/sample/eval.ts and smt.ts — see Byte order
      - id: bo-emit
        content: Emit the new ops in the Nish, Python, Rust, Go and TypeScript emitters with one shared helper per language — see Byte order
      - id: bo-shape
        content: Add the ops to the shape gate, the reserved names and schemas/rfc-contract.json — see Byte order
      - id: bo-tests
        content: Table-driven typing, sampler and emit tests, plus an emit-run golden per language that runs a write and a read property — see Tests
      - id: bo-docs
        content: List the ops in docs/guide/guides/writing-a-spec.md and regenerate docs/reference — see Byte order
  - id: command-values
    title: "feat(spec): let a command source print an integer, bool or null, and drive Secret parameters from a property"
    goal: A command source's Expected may be an integer, bool or null, and a spec author can hold a Secret-taking function to a property
    verification: npm run build && node tests/run.mjs spec && node tests/run.mjs cli && npm run lint && npm run tested-exports && npm run dogfood && npm run doc-caps
    todos:
      - id: cv-profile
        content: Accept an Int, Bool or Null Expected for a command source in src/spec/profile/profile.ts and src/spec/contract/shape.ts — see Command values
      - id: cv-run
        content: Compare a command's trimmed stdout with an integer, bool or null in src/spec/gates/run.ts and provenance.ts — see Command values
      - id: cv-secret
        content: Refuse a Secret forall and secret/expose/wipe calls with the u8[] form, document it, and golden a property through a Secret function — see Secret in a property
      - id: cv-tests
        content: Flip the profile and shape refusals to table-driven accepts, add run-gate rows and a spec check --run-sources golden — see Tests
      - id: cv-docs
        content: Update writing-a-spec.md, spec-to-contract.md, the vector-spec skill and the schema description — see Command values
---

# Spec-language gaps nish's specs hit in vector 0.5.0

## Context

nish's RFC specs ran into three limits of vector 0.5.0's spec language:

1. `le64` is typed `i32 -> bytes` ([typing.ts:407](../../src/spec/contract/typing.ts)). A u32 (ChaCha20's block counter) or an i64 or u64 (an 8-byte QUIC varint) has no byte form, and there is no reverse at all.
2. A `command` source's Expected must be bytes or a string ([profile.ts:2667](../../src/spec/profile/profile.ts), [shape.ts:~730](../../src/spec/contract/shape.ts)). RFC 9000 A.1's `151288809941952652` from `quicVarintRead` cannot come from a command, and fidelity cannot pair it either, so it has no source at all.
3. A spec author cannot hold a Secret-taking function (`p256SignSha256`, `pbkdf2HmacSha256`, every `*Secret` variant) to a property. Checked on main @ 230cf32: `forall (k: Secret<u8[]>)` is refused (`is not a forall type; use u8[] …`) and `secret(k)` is `unknown function`. But a property with `k: u8[]` passed straight to a `Secret<u8[]>` parameter already extracts, emits `plain_<fn>(…)` (which wraps in `secret(copyBytes(..))`, wipes, `expose`s the result) and passes (tried on the rfc7748-dh fixture). Nothing tells the author that.

## Approach

- Two stages, in order. They share `front.ts`, `shape.ts`, `schemas/rfc-contract.json`, `writing-a-spec.md` and the vector-spec skill, so the second starts after the first merges.
- **Op names carry the width.** A property's integer types are fixed and mixed widths are refused (`opSameInt`), so an op whose result type depended on its input's length could not be typed. `le32(n)` says its output length, and `beU64(b)` says its result type.
- **Doc caps are tight.** `.claude/skills/vector-spec/SKILL.md` is 24079 of 24320 bytes and `docs/AI.md` is 6359 of 6400. Whatever a stage adds to either, it shortens elsewhere in the same file. A cap is never raised (CLAUDE.md).

## Byte order

Stage `byte-order`. **Owns:** `src/spec/**`, `tests/spec/**`, `tests/cli/**`, `tests/fixtures/**`, `schemas/rfc-contract.json`, `docs/guide/**`, `docs/AI.md`, `.claude/skills/vector-spec/SKILL.md`

**Write ops:** `le16 le32 le64 be16 be32 be64`, each `(n: any integer type no wider than the op) -> bytes` of 2, 4 or 8 bytes. A signed value is written in two's complement, sign-extended to the op's width, which is what `le64(i32)` does today, so `le64` keeps its current output for every i32. An argument wider than the op is refused at typing, naming the op, its width and the argument's type (`le32 wants an integer of at most 32 bits, got u64`). An integer literal argument must fit the op's width, unsigned or signed.

**Read ops:** `leU16 leU32 leU64 beU16 beU32 beU64` and `leI32 leI64 beI32 beI64`, each `(b: bytes) -> the named type`, reading exactly N bytes. A length other than N is undefined, like `unwrap(null)` ([eval.ts:5](../../src/spec/sample/eval.ts)), and every emitter fails the sample the same way. There is no 16-bit signed read, because Nish has no i16. The motivating property is written `quicVarintRead(b, 0, 8) === beU64(b) % 4611686018427387904`, since the language has no `^`.

**Where:** `vocab.ts` (op list), `shape.ts` (allowed ops, and a reserved name for each new Nish helper), `typing.ts` (an any-int-up-to-width signature beside `opSig`), `front.ts` (`frontCallOps`, and the bytes-argument coercion for the read ops near :1872), `sample/eval.ts` (values, `SAMPLE_BYTES_OPS`, and an int result kind for reads), `sample/smt.ts` (length term per op, and the value term over bit-vectors), the emitters `emit.ts` with `helpers.ts`, `python.ts`, `rust.ts`, `go.ts` and `typescript.ts` (one helper per language that is parametrised by width, endianness and signedness, not ten copies), `schemas/rfc-contract.json` (op enum and description), and the Operations list in `writing-a-spec.md:419`.

Every emitter implements every new op, and none refuses one. Generated files are regenerated: `docs/reference/**`, `tests/dogfood/**`, `contracts/*.json`, `specs/*.xml`. `rfc8439`'s `le64(aad.length)` must emit and pass unchanged.

## Command values

Stage `command-values` (develops after `byte-order` merges). **Owns:** `src/spec/**`, `tests/spec/**`, `tests/cli/**`, `tests/fixtures/**`, `schemas/rfc-contract.json`, `docs/guide/**`, `docs/AI.md`, `.claude/skills/vector-spec/SKILL.md`

- Profile (`profile.ts:2662`) and shape (`shape.ts:~730`) accept a command source whose Expected is an integer (`LitKind` Int, including the wide decimal-string form), `true`/`false` or `null`, beside bytes and strings. f64 stays refused, with the message saying so.
- The run gate (`gates/run.ts:59-110`) compares the command's trimmed stdout with the canonical text of the expected value. An integer is decimal with no sign for a non-negative value, no leading zeros and no `+`, so `151288809941952652` and `-1` match and `0151…`, `+1` and `1.0` do not. A bool is `true` or `false`, and Python's `True` does not match. Null is `null`. Any other output fails, and `provenance.ts` reports it as it reports a bytes mismatch today ("printed X, not Y").
- Docs: `writing-a-spec.md` (:130, :513, :631, "a command source cannot expect null or a bool"), `spec-to-contract.md` (Running the source commands), the vector-spec skill (:270, within its cap), and the `rfc-contract.json` source description (:1087).

## Secret in a property

Part of stage `command-values`. Chosen at sign-off: **guide the author**, not new ops, since passing `u8[]` already works.

- `forall (k: Secret<u8[]>)`, and a call of `secret`, `expose` or `wipe` in a property, are refused with a message naming the form that works ("a property passes u8[] to a Secret<u8[]> parameter; the test wraps it in secret() and exposes a Secret result"). This covers the ts-property front-end and the contract's typing.
- writing-a-spec.md and the vector-spec skill say so where they list the types.
- A golden runs a round-trip property through a Secret-taking function (the x25519 fixture's `x25519` and `x25519Base`, for example `x25519(k, x25519Base(…))` agreement, or a determinism relation) in Nish, and in one other language whose fixture can stand in.
- No `secret`/`expose` op is added: it would duplicate what passing `u8[]` already does.

## Out of scope

- A `^` or `**` operator, a 16-bit signed read, f64 from a command, and any change to how a `cite` source is paired by fidelity.
- Changing what `le64` emits for an i32.

## Tests

- `byte-order`: table-driven typing rows for each op × each argument type, accepting each width up to the op's and refusing each wider one, plus literal bounds. Sampler rows for each op, both byte orders, sign extension, and the undefined wrong-length read. Emit forms in `tests/spec/emit/forms_test.ts` and the per-language emit tests. One `tests/cli/emit-run-<lang>-byte-order` golden per language, over a new `tests/fixtures/byte-order/` module, which runs a write property (`beU32(be32(n)) === n` over u32 `0..4294967295`), a read property, and one that is violated.
- `command-values`: flip `tests/spec/extract/profile_cases_test.ts:1492` and `tests/spec/contract/shape_test.ts:168-198` to accept rows for int, wide int, bool and null, and keep refusing f64. Add `tests/spec/gates/run_test.ts` rows for each match and mismatch form listed above, and a `tests/cli/` golden that runs `spec check --run-sources` on a contract whose command prints `151288809941952652`, with a sibling that prints a different value and exits 1. For Secret, front-end and typing rows for each refused form, and the golden in Secret in a property.
- Every new rule lands with a test that fails without it, driven through `vectorRun` or the binary (CLAUDE.md).

## Verification

Per stage, the `verification` line above. CI (`CI / check`, `Docs / docs`, `Spec / *`, `PR title / conventional`) is the full gate.
