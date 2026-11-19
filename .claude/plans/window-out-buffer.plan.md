---
name: Window arguments and out-buffer results in contracts
overview: Let a spec's ts-interface declare a (buf, off, len) window as one bytes parameter and an (out, at) -> end-offset write as a bytes result, so vectors and properties treat both as bytes and the Nish emitter expands them. This makes nish std/compress checksums, the base64 Into functions and the compressors contractable; constructed values (classes) are a later run.
stages:
  - id: window-arg
    title: "feat(spec): declare a (buf, off, len) window as one bytes parameter"
    goal: A ts-interface parameter annotated /* window */ is one contract bytes parameter that the gates check against a real (u8[], i32, i32) and the Nish emitter expands at a nonzero offset between guard bytes
    verification: npm run build && node tests/run.mjs spec && node tests/run.mjs cli && npm run lint && npm run tested-exports && npm run dogfood && npm run doc-caps
    todos:
      - id: window-parse
        content: Parse the /* window */ annotation on a u8[] interface parameter in frontInterfaceIn (src/spec/front/front.ts) and refuse it on any other type or with any other annotation text — see Window argument › Declaration
      - id: window-contract
        content: Add the optional form field to Param (src/spec/contract/types.ts) with read, write, shape and schemas/rfc-contract.json, omitted when absent so every existing contract is byte-identical — see Window argument › Contract
      - id: window-signatures
        content: Teach gateSignatures (src/spec/gates/signatures.ts) that a window parameter matches three real parameters (u8[], i32, i32) and nothing else — see Window argument › Signatures gate
      - id: window-emit-nish
        content: Expand a window parameter in the Nish emitter through a plain_ wrapper in emitCall (src/spec/emit/emit.ts), placing the bytes at a nonzero offset between guard bytes — see Window argument › Nish emitter
      - id: window-refuse-targets
        content: Refuse a contract with a window parameter in the typescript, rust, go and python emitters with a diagnostic, after the emitTargetWordsRefusal precedent — see Window argument › Other targets
      - id: window-e2e-fixture
        content: Add a module-spec fixture for nish std/compress/checksum (crc32, adler32) and CLI goldens that extract, check and emit it and run the emitted test against the pinned std, plus a mutant that ignores off and is caught — see Window argument › End-to-end
      - id: window-docs
        content: Document the window form in docs/guide/guides/writing-a-spec.md, docs/guide/guides/spec-to-contract.md, docs/AI.md and .claude/skills/vector-spec/SKILL.md, and regenerate docs/reference — see Window argument › Docs
  - id: out-buffer
    title: "feat(spec): declare an (out, at) -> end write as a bytes result"
    goal: A ts-interface pseudo-parameter annotated /* out CAP */ makes the function return bytes in the contract, checked against a real (u8[], i32) pair and i32 result, and emitted as a guarded buffer whose [at, end) slice is the result
    verification: npm run build && node tests/run.mjs spec && node tests/run.mjs cli && npm run lint && npm run tested-exports && npm run dogfood && npm run doc-caps
    todos:
      - id: out-parse
        content: Parse an out pseudo-parameter with its capacity expression in frontInterfaceIn and refuse every malformed form, table-driven — see Out-buffer result › Declaration
      - id: out-contract
        content: Add the optional out field to FnSig with read, write, shape and schemas/rfc-contract.json, omitted when absent — see Out-buffer result › Contract
      - id: out-signatures
        content: Teach gateSignatures that an out pseudo-parameter matches a real (u8[], i32) pair at its position and that the real result is i32 — see Out-buffer result › Signatures gate
      - id: out-emit-nish
        content: Emit the out call in the Nish plain_ wrapper with sentinel-filled capacity, the range and untouched-byte checks, and null for a negative end under a bytes? result — see Out-buffer result › Nish emitter
      - id: out-refuse-targets
        content: Refuse a contract with an out result in the typescript, rust, go and python emitters — see Out-buffer result › Other targets
      - id: out-e2e-fixture
        content: Add module-spec fixtures for nish std base64EncodeInto and deflateCompress/deflateDecompress with known-answer vectors, a round-trip property and a corrupt-stream null vector, and CLI goldens that run them against the pinned std, plus mutants that write outside the range — see Out-buffer result › End-to-end
      - id: out-docs
        content: Document the out form beside the window form in the same guide pages, docs/AI.md and the vector-spec skill, and regenerate docs/reference — see Out-buffer result › Docs
---

# Window arguments and out-buffer results

## Context

vector 0.5.0 contracts a function only as `name(params) -> result` with one contract parameter per real parameter: [`frontInterfaceIn`](../../src/spec/front/front.ts) parses one type per parameter, [`gateSignatures`](../../src/spec/gates/signatures.ts) compares the declared and real signatures exactly, and every emitter calls `name(args...)` one argument per parameter. Most of nish's `std/compress`, `std/base64` and `std/net` instead take a window into a caller's buffer, `(buf: u8[], off: i32, len: i32)`, or write into one, `(out: u8[], at: i32): i32` returning the end offset:

| nish std function | real signature |
|---|---|
| `crc32`, `adler32` | `(buf: u8[], off: i32, len: i32): u32` |
| `base64EncodeInto` | `(src: u8[], off: i32, len: i32, dst: u8[], at: i32): i32` |
| `deflateCompress`, `zlibCompress`, `gzipCompress` | `(src: u8[], off: i32, len: i32, out: u8[], at: i32, level: i32): i32` |
| `deflateDecompress` | `(src, off, len, out, at, limit: i32): i32`, negative is an error |

None of them can be declared today. This run adds the two declaration forms. Constructed values (classes such as `AesKey`, `HpackDecoder`) are step 3 and a later run.

## Approach

- **The contract is the declared signature.** Vectors, properties, typing, the sampler and literal settling keep reading only the declared parameters, so neither form changes them: a window is a `bytes` parameter and an out function returns `bytes` (or `bytes?`). The sampler never evaluates the function under test (`src/spec/sample/eval.ts`), so it is untouched.
- **Annotations are comments in the ts-interface**, the hook the forall bounds comment already uses (`frontRaw` after the type). An interface parameter comment is silently dropped today, so the parser must start reading it, and any comment it does not recognise in that position becomes a refusal.
- **The mapping to the real signature is recorded in the contract** (new optional fields, omitted when absent), so `check`, `emit`, `frozen` and `stale` all see the same thing, and every existing contract stays byte-identical.
- **Only the Nish target expands them** in this run. The other four targets refuse such a contract with a diagnostic, as they refuse word arrays today (`emitTargetWordsRefusal` in [`target.ts`](../../src/spec/emit/target.ts)).
- **The emitted test is adversarial about the buffer.** A window is placed at a nonzero offset between guard bytes, and an out buffer starts at a nonzero `at` in a sentinel-filled array, so an implementation that ignores `off`, `len` or `at`, or writes outside `[at, end)`, fails the emitted test.

## Window argument

**Owns:** `src/spec/**`, `schemas/**`, `tests/spec/**`, `tests/cli/**`, `tests/fixtures/**`, `docs/guide/**`, `docs/AI.md`, `docs/reference/**`, `scalar.config.json`, `.claude/skills/vector-spec/**`

### Declaration

```ts
// module: nish/std/compress/checksum
export const crc32 = (data: u8[] /* window */): u32
```

- `/* window */` is allowed only after `u8[]`. After `Secret<u8[]>`, a word array, a scalar or `| null` it is refused, naming the parameter; any other comment text in that position is refused too ("an interface parameter takes only /* window */").
- A function may have several window parameters; each expands on its own.
- Tests: table-driven in `tests/spec/extract/front_cases_test.ts` (or its neighbour), covering each accepted and refused neighbour, not just the motivating case.

### Contract

- `Param` gains an optional `form`, whose only value in this stage is `"window"`. `read.ts` adds it to the param key whitelist, `write.ts` writes it after `type` only when present, `shape.ts` refuses `form` on a non-`bytes` param and an unknown value, `schemas/rfc-contract.json` adds it to the param object.
- Round-trip and shape tests in `tests/spec/contract/`. `npm run dogfood` and the spec workflow's `contracts/*.json` extract `--check` must show every existing contract unchanged.

### Signatures gate

- The expected real parameter list is the declared one with each window param replaced by `u8[], i32, i32`; the comparison stays exact. So real `(buf: u8[], off: i32, len: i32): u32` matches, and real `(buf: u8[], len: i32): u32`, `(buf: u8[], off: i64, len: i32)` or a declared plain `u8[]` against the three-param function are refused, naming the function, with the existing exit code for a signature mismatch.
- Tests in `tests/spec/gates/signatures_test.ts`, table-driven over those neighbours.

### Nish emitter

- In `emitCall` (`src/spec/emit/emit.ts`) a function with a window param goes through a generated `plain_<name>` wrapper, as Secret params already do (`emitPlainWrapper`). For each window param the wrapper builds `[a5 a5 a5] ++ data ++ [a5 a5 a5]` and passes `(buf, 3, data.length)`. The rest of the program (vectors, iterate steps, properties) calls the wrapper.
- A fn needing both a Secret and a window wrapper gets one wrapper doing both; the `plain_` collision check in `emitRefusals` still applies.
- Tests: an emitter golden under `tests/spec/emit/` showing the wrapper, and `tests/spec/emit/program_test.ts`-style assertions.

### Other targets

`--lang typescript|rust|go|python` on a contract with a window param refuses with one diagnostic naming the function and saying only `--lang nish` expands a window, exit as `emitTargetWordsRefusal` exits. One test per target.

### End-to-end

- Fixture `tests/fixtures/<name>/`: a module spec for `nish/std/compress/checksum` declaring `crc32` and `adler32` with windows. Vectors with python-command Sources, at least `crc32("123456789") = 0xcbf43926`, `crc32("") = 0`, `adler32("Wikipedia") = 0x11e60398`, `adler32("") = 1`; a forall property over the bytes param (for example the result fits in u32 and equal inputs give equal results, or adler32's low half is 1 + sum mod 65521). Built `.xml` from `.md` with `scripts/build-spec.sh` (install `kramdown-rfc` 1.7.43 and `xml2rfc` 3.35.0 if absent).
- CLI goldens: extract it, `check` it against the pinned nish std (signatures gate passes), `emit` it and run the emitted test against std (all pass), and the same emitted test against a fixture implementation whose crc32 reads from 0 instead of `off`, which fails.

### Docs

The window form in `docs/guide/guides/writing-a-spec.md`, `docs/guide/guides/spec-to-contract.md`, `docs/AI.md` and `.claude/skills/vector-spec/SKILL.md`; regenerate `docs/reference/**` with `node scripts/gen-reference.mjs`. Stay under every cap in `scripts/doc-caps.json`, shortening in place.

## Out-buffer result

**Owns:** `src/spec/**`, `schemas/**`, `tests/spec/**`, `tests/cli/**`, `tests/fixtures/**`, `docs/guide/**`, `docs/AI.md`, `docs/reference/**`, `scalar.config.json`, `.claude/skills/vector-spec/**`

**Depends on:** window-arg. It starts after window-arg merges, from the default branch, because it extends the same parser, contract fields and `plain_` wrapper.

### Declaration

```ts
// module: nish/std/base64
export const base64EncodeInto = (src: u8[] /* window */, dst: u8[] /* out 2 * src.length + 8 */): u8[]
// module: nish/std/compress/deflate
export const deflateCompress = (src: u8[] /* window */, out: u8[] /* out 2 * src.length + 64 */, level: i32): u8[]
export const deflateDecompress = (src: u8[] /* window */, out: u8[] /* out 4096 */, limit: i32): u8[] | null
```

- `/* out CAP */` on a `u8[]` parameter makes it a pseudo-parameter: it is **not** a contract parameter (vectors and properties do not pass it), and it marks where the real `(out: u8[], at: i32)` pair sits in the real parameter list.
- `CAP` is the room after `at`: an integer expression of decimal literals, `+`, `*`, parentheses and `<p>.length` where `<p>` is a declared bytes parameter (window or plain) of the same function. Anything else is refused with the token it stopped at.
- At most one out per function. The declared result must be `u8[]` or `u8[] | null`; anything else is refused, as are an out on a non-`u8[]` type and `/* out */` with no capacity.
- Tests: table-driven, each accepted form and each refusal.

### Contract

`FnSig` gains an optional `out`: `{ "at": <index in the declared params where the pair is inserted>, "capacity": "<CAP as written, normalised>" }`, with read, write (only when present), shape (index in range, returns is `bytes` or `bytes?`, capacity re-parses and names only bytes params) and schema. Every existing contract stays byte-identical.

### Signatures gate

The expected real list inserts `u8[], i32` at `out.at` (after window expansion), and the expected real result is `i32`. Refuse, table-driven: real result not `i32`, pair missing or at the wrong position, `at` typed other than `i32`.

### Nish emitter

The `plain_<name>` wrapper (shared with windows) allocates `out` of `5 + CAP + 5` bytes filled with `a5`, calls with `at = 5`, then:

- end in `[5, 5 + CAP]` → check `out[0..5)` and `out[end..)` are still `a5`, else fail naming the function ("wrote outside [at, end)"), and return `out[5..end)`;
- end negative and result `bytes?` → return `null`;
- otherwise fail naming the function and the end it returned ("returned end E outside [at, at + capacity]").

The failure is a test failure of the vector or property that made the call, not a panic of the program.

### Other targets

Refused as for windows, one test per target.

### End-to-end

- Fixture module specs: `base64EncodeInto` with RFC 4648 §10's vectors (`""`, `"f"` … `"foobar"`), and `deflateCompress`/`deflateDecompress` with a level-0 known-answer vector (stored blocks are deterministic), a decompress known-answer vector of a fixed stream, a corrupt stream giving `null`, and a forall round-trip property `deflateDecompress(deflateCompress(d, 6), 4096) == d`.
- CLI goldens: extract, check against the pinned std, emit and run against std (all pass); and mutants run against the emitted test that fail — one writing a byte before `at`, one returning an end past the capacity.

### Docs

The out form beside the window form in the same pages, `docs/AI.md` and the vector-spec skill; regenerate `docs/reference/**`; stay under the caps.

## Out of scope

- Constructed values (step 3): classes with a constructor and methods in the interface, `new AesKey(key).gcmSeal(...)`. Its own run, after this one.
- Window or out expansion for the typescript, rust, go and python targets (refused here).
- Specs for nish std in `specs/` (an RFC 1950/1951/1952/4648 conformance spec); the fixtures here prove the forms, and conformance specs are follow-up work with `/vector-spec`.
- Any change to the sampler, the solver, `verify`, or the dogfood specs.

## Tests

Mirror `tests/spec/extract/front_cases_test.ts`, `tests/spec/contract/{roundtrip,shape}_test.ts`, `tests/spec/gates/signatures_test.ts`, `tests/spec/emit/{program,words}_test.ts` and the `tests/cli/emit-run-*`, `tests/cli/check-rfc5869` goldens. Every new refusal lands with a test that fails without it, driven through `vectorRun` or the binary.

## Verification

```
npm run build
node tests/run.mjs spec
node tests/run.mjs cli
npm run lint
npm run tested-exports
npm run dogfood
npm run doc-caps
node scripts/gen-reference.mjs --check
```
