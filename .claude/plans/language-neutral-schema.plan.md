---
name: Language-neutral contract schema
overview: Make schemas/rfc-contract.json describe functions in any of fourteen languages without naming Nish — integer widths, f64, the refusing return and the optional input, neutral secrets, modules and names — and prove it with a typed mapping table per language. Nish stays the only language vector emits tests for; the three committed contracts and their Nish tests stay byte-identical.
stages:
  - id: vocab
    title: A neutral vocabulary for the contract schema
    goal: The schema and one TypeScript module define every construct a contract can carry, with full detail and no language named, and existing contracts stay valid unchanged
    verification: bun run typecheck && bun run lint && bun test test/vocab.test.ts && for n in example-hex rfc5869-hkdf-sha256 rfc8439-chacha20-poly1305; do bun src/cli.ts spec extract specs/$n.xml -o contracts/$n.json --check || exit 1; done
    todos:
      - id: vocab-module
        content: Add src/rfc/vocab.ts with the construct unions — base types, signature types, outcomes, literal kinds, integer widths, languages, name and module overrides — see Stage vocab
        status: pending
      - id: vocab-schema
        content: Extend schemas/rfc-contract.json with the new types, the f64 literal, tolerance, big-int literals, neutral module form and per-language name overrides; rewrite every Nish-specific description — see Stage vocab
        status: pending
      - id: vocab-test
        content: Add test/vocab.test.ts — schema enums equal the vocab constants, the three committed contracts validate against the schema, and each new schema shape has a valid and an invalid example — see Stage vocab
        status: pending
      - id: vocab-readme
        content: Document the new types, the refusing return and the optional input, f64 and tolerance, secret-bytes, module form and name overrides in README Writing a spec (kramdown-rfc) — see Stage vocab
        status: pending
  - id: type-flow
    title: Carry the new types through extract, literals, sampling, evaluation, gates and the Nish emitter
    goal: A spec using any new width or f64 extracts, type-checks, samples at its boundaries with Z3 bit-vectors, evaluates with per-width wrapping, and emits a Nish test, while the committed contracts and their Nish tests stay byte-identical
    verification: bun run typecheck && bun run lint && bun run coverage && for n in example-hex rfc5869-hkdf-sha256 rfc8439-chacha20-poly1305; do bun src/cli.ts spec extract specs/$n.xml -o contracts/$n.json --check || exit 1; done
    todos:
      - id: flow-contract
        content: Switch src/rfc/contract.ts to the vocab unions, validate the new literal and override shapes, and accept any neutral target.module while nishModuleFile stays the Nish emitter's own check — see Stage type-flow
        status: pending
      - id: flow-front
        content: Accept i8 i16 i64 u8 u16 u64 f64 and T | null on every base type in the ts-interface front end (src/rfc/front/ts.ts), accept a non-nish module line, and refuse a ts-property over f64 with a clear message — see Stage type-flow
        status: pending
      - id: flow-literals
        content: Range-check int literals per width in src/rfc/literals.ts and gates.ts, read 64-bit values exactly (bigint), and read f64 literals and tolerances — see Stage type-flow
        status: pending
      - id: flow-sample
        content: Encode integer forall variables as Z3 bit-vectors of their width in src/rfc/sample.ts, and make evalPure wrap per width (bigint for 64-bit) — see Stage type-flow
        status: pending
      - id: flow-gates
        content: Extend the typing and coverage gates (src/rfc/gates.ts) and the Nish emitter (src/rfc/emit-nish.ts) to every new type, refusing clearly where Nish cannot express one — see Stage type-flow
        status: pending
      - id: flow-tests
        content: Add passing and refusing literal tests per new width, boundary sampling tests per width, wrap tests, f64 vector bit-equality and tolerance tests, and the f64 property refusal test — see Tests
        status: pending
      - id: flow-byte-identical
        content: Prove vector spec emit output is byte-identical to a worktree at the base SHA for all three contracts, and record the commands and results in the PR body — see Verification
        status: pending
  - id: languages
    title: A mapping table per language
    goal: Fourteen typed tables in src/rfc/languages map every schema construct, with explicit unsupported entries and the hard-case choices stated, and a test and the README matrix prove the schema can describe each language
    verification: bun run typecheck && bun run lint && bun test test/languages.test.ts
    todos:
      - id: lang-shape
        content: Add src/rfc/languages/table.ts with the LanguageTable type built as Records over the vocab unions, and index.ts listing all fourteen — see Stage languages
        status: pending
      - id: lang-tables
        content: Write rust ruby zig go cpp csharp c java kotlin python typescript php swift dart tables, each stating its choice on the hard cases — see Hard cases
        status: pending
      - id: lang-test
        content: Add test/languages.test.ts and test/fixtures/languages/expected.json — total coverage of every construct, a reason on every unsupported entry, and names and modules of the three committed contracts against committed expected values — see Stage languages
        status: pending
      - id: lang-readme
        content: Add a Languages section to README.md with the construct by language matrix, unsupported cells and their reasons — see Stage languages
        status: pending
---

# Language-neutral contract schema

## Context

[schemas/rfc-contract.json](../../schemas/rfc-contract.json) and the hand-written types in [src/rfc/contract.ts](../../src/rfc/contract.ts) (the contract types are **not** generated: `bun run generate:schemas` emits only `program` and `spec-plan` into `src/generated/`) describe functions in Nish terms: nine signature types, `T?` read as "or null (a refusal)" in both positions, `secret-bytes` as "a nish Secret<u8[]>", and `target.module` required to be `nish/<path>` ([contract.ts:349](../../src/rfc/contract.ts), [front/ts.ts:354](../../src/rfc/front/ts.ts)). The Z3 encoding in [src/rfc/sample.ts](../../src/rfc/sample.ts) uses unbounded `Int`, and `evalPure` uses JS `number`.

## Approach

- **The schema holds all the data; languages drop what they cannot express.** The contract records the most precise description available — exact width, which of the two outcomes a `?` means, secrecy, f64 tolerance, per-language names. A language table (and, later, an emitter) maps each construct down and states what it lost. Nothing is left out of the schema because some language lacks it.
- **Today's spelling stays canonical.** `bytes?`, `string?`, `secret-bytes`, `nish/crypto/hkdf`, camelCase names: every existing contract stays valid and byte-identical. What changes is what they are documented to mean.
- **One source for the unions.** `src/rfc/vocab.ts` (stage `vocab`) is the single place the constructs are listed. contract.ts, the gates and the language tables are typed against it. Stage `vocab` merges first and its exports are frozen for the rest of the run.

## Stage vocab

**Owns:** `schemas/rfc-contract.json`, `src/rfc/vocab.ts` (new), `test/vocab.test.ts` (new), `README.md`

`src/rfc/vocab.ts` exports, as `as const` arrays plus their unions:

| export | values |
|---|---|
| `INT_TYPES` | `i8 i16 i32 i64 u8 u16 u32 u64` |
| `BASE_TYPES` | `bytes string bool f64 secret-bytes` + `INT_TYPES` |
| `SIG_TYPES` | every `B` and `B?` for `B` in `BASE_TYPES` |
| `OUTCOMES` | `refusing-return`, `optional-input` |
| `LITERAL_KINDS` | `hex ascii str int f64 bool null concat` |
| `LANGUAGES` | `rust ruby zig go cpp csharp c java kotlin python typescript php swift dart` |
| `INT_RANGE` | `Record<IntType, {min: bigint; max: bigint}>` |
| helpers | `baseOf(SigTy)`, `isOptional(SigTy)`, `outcomeOf(position: "param" \| "return", t)` |

Also exported: `NameOverrides = Partial<Record<Language, string>>` and `ModuleOverrides` of the same shape.

Schema changes (all additive, all optional; descriptions name no language):

- `paramType` / `returnType` become `SIG_TYPES`. The descriptions define the two outcomes: `T?` as a **return** is a *refusing return* (the function declines this input; no value), and as a **parameter** is an *optional input* (the argument may be absent). Both are written `null` in literals. This is the canonical spelling, kept so today's contracts are unchanged.
- `secret-bytes`: bytes whose value is secret; a language may wrap them in its own secret type. In the contract they are plain bytes.
- `int` literal: a JSON integer, or a decimal string for values beyond ±(2^53−1) so 64-bit values are exact (`{"int": "18446744073709551615"}`).
- `f64` literal: `{"f64": "<decimal>"}`, a decimal string that parses to exactly one double, or `NaN`, `Infinity`, `-Infinity`, `-0`. Optional `bits` (16 lowercase hex digits) states the IEEE-754 bits; when both are given they must agree.
- `vectorClause.tolerance` (optional): `{"abs": "<decimal>"}` or `{"ulps": <int>}`. It must come from the spec: a `quote` of the sentence that states it, checked like a requirement quote. Without it, an f64 expect is compared bit for bit.
- `forall` entries: an integer domain takes any of `INT_TYPES` with `min`/`max` (integer or decimal string); an `f64` domain with `min`/`max` exists in the schema so the data can be recorded, and vector refuses to sample it for now.
- `target.module`: a neutral module path `<root>/<segment>/…` (lowercase segments, `[a-z][a-z0-9_]*`). `target.modules` (optional): per-language override of the module form.
- `function.names` and `param.names` (optional): per-language override of the default name rule.

`test/vocab.test.ts`: the schema's enums equal the vocab arrays; the three committed contracts validate against the schema; a valid and an invalid example for each new shape. README "Writing a spec (kramdown-rfc)" documents the new types (their `ts-interface` spellings: `i8 … u64`, `f64`, `T | null` on any type), the two outcomes, f64 literals and tolerance, secrets, module form and name overrides.

## Stage type-flow

**Owns:** `src/rfc/**` except `src/rfc/vocab.ts` and `src/rfc/languages/**`; `schemas/rfc-contract.json`; `test/**` except `test/vocab.test.ts`, `test/languages.test.ts` and `test/fixtures/languages/**`. Never `contracts/**`, `specs/**`, `README.md`.

Depends on `vocab` to start. Runs alongside `languages`.

- contract.ts: `VALUE_TYPES`/`SIG_TYPES`/`Literal`/`FnSig` come from vocab; validation of big-int and f64 literals, tolerance, name and module overrides. `target.module` accepts any neutral path; `nishModuleFile` stays, and the Nish emitter refuses a non-`nish/` module with a message saying Nish is the only emitter.
- front/ts.ts: the new type names, `| null` on every base type, a non-nish `// module:` line, int literal parsing per width; a `ts-property` whose forall ranges over f64 is refused: "properties over f64 are not sampled yet; give f64 cases as vectors".
- literals.ts / gates.ts: range checks from `INT_RANGE`, exact for 64-bit; f64 literals and tolerance; the typing and coverage gates handle every `SigTy`.
- sample.ts: each integer forall variable is a `(_ BitVec w)` with signed or unsigned comparisons as its type requires; the boundary samples include each width's min and max. `evalPure` wraps `+ - *` to the width (bigint for 64-bit) and keeps today's i32 results byte-identical.
- emit-nish.ts: the new widths and f64 in Nish syntax (check `../nish` for the spellings); anything Nish cannot express is a clear refusal, never a wrong test.

## Stage languages

**Owns:** `src/rfc/languages/**` (new), `test/languages.test.ts` (new), `test/fixtures/languages/**` (new), `README.md`

Depends on `vocab` to start. Runs alongside `type-flow`; imports only from `src/rfc/vocab.ts`.

```ts
type Mapping = { spelling: string; note?: string } | { unsupported: string };
interface LanguageTable {
  id: Language;
  types: Record<BaseType, Mapping>;      // secret-bytes included
  outcomes: Record<Outcome, Mapping>;    // spelling is a template over {T}
  literals: Record<LiteralKind, Mapping>;
  module: { form: "crate-path" | "package" | "class" | "namespace" | "header-prefix" | "file" | "module"; apply(module: string): string; note: string };
  name(camel: string, kind: "function" | "param"): string;  // NameOverrides win
  choices: string[];                     // the hard-case decisions, in words
}
```

Module forms: Rust crate path, Go package, Java/Kotlin/C# a class of static methods, C++ namespace, C header plus symbol prefix, a file or module for the rest. Name rules are deterministic: snake_case for Rust, Python, Ruby and C, camelCase for PHP (PSR-1) and the JVM languages, an exported capital for Go, and so on — each table says which.

`test/languages.test.ts`: every table has an entry for every member of every vocab union, so a new schema construct without a mapping in all fourteen fails CI; every `unsupported` has a non-empty reason; each table's name rule and module form, applied to every function and parameter of the three committed contracts, equals `test/fixtures/languages/expected.json`. README gains a **Languages** section: the construct × language matrix, with unsupported cells and their reasons, and the hard-case choices.

## Hard cases

Each table states its choice in `choices`:

| language | case |
|---|---|
| Java, PHP, Ruby, Python | no native u64 (Java `long` with unsigned ops vs `BigInteger`; PHP int is signed 64; Ruby and Python ints are unbounded) |
| Java | `byte` is signed; bytes are `byte[]` read unsigned |
| Dart | `int` is 53-bit when compiled to JS |
| Zig | error unions (`!T`) vs optionals (`?T`); slices `[]const u8` |
| Go | `(T, error)` for a refusing return; `*T` or a flag for an optional input |
| Rust | `Option<T>` vs `Result<T, E>` |
| C | status codes and pointer/length pairs; out-parameters |
| Swift | `throws` vs optionals |
| Kotlin | unsigned types (`UByte`…`ULong`) and null-safety |
| C# | `byte[]` and exceptions |
| TypeScript | `bigint` for 64-bit integers |

## Out of scope

Test emitters, runners or mutation for any language but Nish; a Target/plugin interface; async functions, stateful methods, callbacks, I/O, generics, collections other than bytes; `.github/workflows/**` and coverage, lint and typecheck configuration.

## Tests

- Per new width: a passing and a refusing literal test (one past min, one past max), property sampling that hits min and max, and wrap-around in `evalPure`. Mirror [test/literals.test.ts](../../test/literals.test.ts), [test/front-ts.test.ts](../../test/front-ts.test.ts), [test/rfc.test.ts](../../test/rfc.test.ts).
- f64: exact literal parse, bit-for-bit compare, tolerance compare, the property refusal.
- Every test passes, coverage stays ≥ 91% lines.

## Verification

```bash
bun run typecheck && bun run lint && bun run coverage
for n in example-hex rfc5869-hkdf-sha256 rfc8439-chacha20-poly1305; do bun src/cli.ts spec extract specs/$n.xml -o contracts/$n.json --check; done
git worktree add ../vector-base 4c54dc8c99aca8f9f4a12a027be610157c19922f
# for each contract: vector spec emit in both trees, then cmp the outputs
```
