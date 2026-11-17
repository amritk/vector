---
name: Word arrays (u16[], u32[], u64[]) as contract types
overview: vector's only array type is u8[], so nish's chacha20QuarterRound(state u32[], …) cannot be held to the RFC 8439 §2.1.1 and §2.2.1 quarter-round vectors. Add u16[], u32[] and u64[] end to end — ts-interface type, literal, contract, typing, fidelity against words as printed (including the 4x4 grid), signatures, and a Nish emitter that builds and compares typed arrays.
stages:
  - id: word-arrays
    title: "feat(spec): add u16[], u32[] and u64[] word arrays to contracts"
    goal: A spec can declare and test a function over u16[], u32[] or u64[], with vector rows whose words fidelity binds to the cited section exactly as printed, and emit a Nish test that builds and compares the typed arrays
    verification: npm run build && node tests/run.mjs spec && node tests/run.mjs cli && npm run lint && npm run tested-exports && npm run dogfood
    todos:
      - id: wa-repro
        content: Reproduce the refusal on main with the quarter-round spec, and turn it into the first failing table-driven case — see Reproduction
      - id: wa-type
        content: Accept u16[], u32[] and u64[] (and | null) in the ts-interface parser, the contract vocabulary and schemas/rfc-contract.json — see Types
      - id: wa-literal
        content: Parse the bracketed word literal, typed by its position's declared type, labelled or not, and refuse malformed words — see Literals
      - id: wa-contract
        content: Read and write the word literal in contract JSON, keeping each word's printed spelling — see Contract
      - id: wa-typing
        content: Make the typing gate check word literals against u16[], u32[], u64[] positions and refuse a bytes or word mismatch either way — see Typing
      - id: wa-fidelity
        content: Bind a word literal to one whole printed block of words in the cited section, as printed — see Fidelity
      - id: wa-signatures
        content: Make check --module and --nish-root compare word-array signatures against a module's exports — see Signatures
      - id: wa-emit
        content: Emit Nish tests that build u16[], u32[], u64[] literals and compare results word by word, and refuse cleanly where an emitter or the property sampler cannot hold them — see Emit
      - id: wa-acceptance-fixture
        content: Add a fixture spec with the exact RFC 8439 §2.1.1 and §2.2.1 rows plus a fixture quarter-round module, and a golden that extracts, emits and runs it — see Acceptance fixture
      - id: wa-docs
        content: Update the writing-a-spec guide, the vector-spec skill and every other page that lists the types, and regenerate docs/reference — see Docs
---

# Word arrays (u16[], u32[], u64[])

## Stage word-arrays

**Owns:** `src/**`, `tests/**`, `schemas/rfc-contract.json`, `docs/guide/**`, `docs/reference/**`, `scalar.config.json`, `scripts/undocumented.txt`, `.claude/skills/vector-spec/**`, `README.md`

## Context

On `main` at `f787185`, a spec declaring nish's quarter round is refused three times:

```
`u32[]` is not a ts-interface type; use u8[], string, boolean, i8, i16, i32, i64, u8, u16, u32, u64, f64, Secret<u8[]>, each optionally `| null`
Call: bytes are lowercase hex pairs in brackets, at most one space apart: [00 0f], or [] for none
Expected: bytes are lowercase hex pairs in brackets, at most one space apart: [00 0f], or [] for none
```

So nish's [specs/rfc8439-chacha20-poly1305.md](https://github.com/amritk/nish/blob/main/specs/rfc8439-chacha20-poly1305.md) excludes R-QUARTER-ROUND and R-QUARTER-ROUND-STATE with `Untested:` and lists `Out of scope: chacha20QuarterRound`. The export is `chacha20QuarterRound = (state: u32[], a: i32, b: i32, c: i32, d: i32): u32[] | null` in nish's `std/crypto/chacha20poly1305.ts`.

RFC 8439 prints the two vectors this way ([rfcs/rfc8439.txt](../../rfcs/rfc8439.txt), lines 302–364):

- **§2.1.1**: four `name = 0x…` lines (`a = 0x11111111` … `d = 0x01234567`), prose, then four more (`a = 0xea2a92f4` … `d = 0x5881c4bb`).
- **§2.2.1**: a 4x4 grid of bare 8-digit words under `Sample ChaCha State`. Then `QUARTERROUND(2, 7, 8, 13)`. Then a second grid under `After applying QUARTERROUND(2, 7, 8, 13)` whose changed words carry a leading `*` (`*bdb886dc`).

## Approach

One stage, one PR: type → literal → contract → typing → fidelity → emit is a chain, and each link consumes the one before. The decisions below are the plan's; the worker may refine a name, but not the rules.

- **The literal is the bytes bracket form, typed by position.** A word-array literal looks like `[0x11111111 0x01020304 0x9b8d6f43 0x01234567]` or `[879531e0 c5ecf37d …]`. Where the declared type is `u16[]`, `u32[]` or `u64[]`, the brackets hold words; where it is `u8[]`, they hold bytes exactly as today. A label works as it does for bytes: `Sample ChaCha State = [879531e0 …]`.
- **A word is written as the RFC prints it.** That is exactly 4, 8 or 16 lowercase hex digits, with or without `0x`. Separate words with whitespace. A word of the wrong width, a non-hex digit, uppercase, or a mixture of `0x` and bare words in one literal is refused at parse.
- **Fidelity is token-exact.** Each word's spelling, `0x` included or omitted, must equal the printed token. The `*` change marker is not part of the token. The words must be one whole printed block, in order (see Fidelity).
- **Properties stay out.** Property clauses over word-array variables are refused with a clear "not yet" message; this feature is about vectors.

## Reproduction

The spec in Context (one interface line, the §2.1.1 row, `vector-main-RFC8439` optional) built with `scripts/build-spec.sh` and extracted reproduces all three refusals. Make it the first failing case before changing anything.

The spec tools are not in the SessionStart hook. Install them: `gem install kramdown-rfc -v 1.7.43 --no-document && pip install xml2rfc==3.35.0`. Then put the gem bin dir on PATH: `export PATH="$(ruby -e 'print Gem.bindir'):$PATH"`. rbenv's shim dir does not expose `kramdown-rfc`.

## Types

- ts-interface: `u16[]`, `u32[]`, `u64[]`, each optionally `| null`, as parameter and result. The refusal message's type list grows to match.
- Contract vocabulary ([src/spec/contract/vocab.ts](../../src/spec/contract/vocab.ts)) and [schemas/rfc-contract.json](../../schemas/rfc-contract.json): one type per width, named in the schema's language-neutral style (e.g. `words16`, `words32`, `words64`, beside `bytes`).

## Literals

In [src/spec/front/front.ts](../../src/spec/front/front.ts) (Call and Expected cells), parse the word literal by its position's declared type. Refusals are table-driven, each with its message:

| input at a `u32[]` position | result |
|---|---|
| `[0x11111111 0x01020304]` | 2 words, `0x` spelling |
| `[879531e0 c5ecf37d]` | 2 words, bare spelling |
| `Sample ChaCha State = [879531e0 …]` | labelled |
| `[]` | empty |
| `[0x1111111]` (7 digits), `[0x111111111]` (9) | refused: width |
| `[0x1111111g]` | refused: not hex |
| `[0x1111111F]` | refused: uppercase |
| `[0x11111111 22222222]` | refused: mixed spelling |
| `[00 0f]` at `u32[]`, `[0x11111111]` at `u8[]` | refused, or typed as the other kind and refused by typing |

Do the same table for `u16[]` (4 digits) and `u64[]` (16 digits).

## Contract

The contract JSON holds the word literal with each word's printed spelling, so `spec check` re-runs fidelity from the contract alone. A suggested shape is `{"words32": ["0x11111111", …], "label": …}`; the worker picks the shape and documents it in the schema. Read ([src/spec/contract/read.ts](../../src/spec/contract/read.ts)), write ([src/spec/contract/write.ts](../../src/spec/contract/write.ts)) and shape-check it. A contract round-trips byte for byte.

## Typing

[src/spec/contract/typing.ts](../../src/spec/contract/typing.ts) and [src/spec/gates/typing.ts](../../src/spec/gates/typing.ts): a word literal fits only a word-array position of its width. Bytes do not fit a word position, and words do not fit a `u8[]`, `string` or integer position. Make it table-driven across all four array types.

## Fidelity

[src/spec/gates/fidelity.ts](../../src/spec/gates/fidelity.ts). A word literal binds to **one whole printed block of words** in the cited section.

A **block** is a maximal run of consecutive non-blank lines. Each line holds only words of the literal's width, either as whitespace-separated tokens (a grid row, an optional leading `*` per token) or as one `name = word` assignment. Its words are read in row-major order.

The literal's words must equal the block's words exactly: same count, same order, same spelling. So the rules are:

- **Refused:** a prefix, a tail, or a middle of a block; words from two blocks; a word with a changed digit; two words swapped; `0x` added or dropped against the print; a block in another section.
- **Labels:** as for bytes. The label is the short line above a grid (`Sample ChaCha State`) or the name before `=`. The §2.1.1 per-word names `a`…`d` are not a block label, so that row is unlabelled. A label the section does not print the block under is refused.
- **One test case:** the expected value may not bind to the same block as an argument.
- **Rounds:** a block printed several times is read in rounds, as bytes are.

The decimal `i32` positions (`2, 7, 8, 13`) behave as unlabelled integers do today: a "not checked against the RFC" note, not a refusal. The rows must still extract with exit 0.

Write table-driven tests over both RFC layouts, the §2.1.1 assignment lines and the §2.2.1 grid. Cover every accept and refuse row above. Include the neighbours too: the grid with and without `*` markers, a 16-word literal against the 4-word block, and 8 words of the 16-word grid.

## Signatures

[src/spec/gates/signatures.ts](../../src/spec/gates/signatures.ts): `spec check --module <src.ts>` / `--nish-root` accepts a module whose export is `u32[] | null` where the spec declares it. It refuses a mismatch (`u8[]` declared, `u32[]` exported, and the reverse) with the existing message form.

## Emit

[src/spec/emit/](../../src/spec/emit/) (Nish/TypeScript emitter, helpers, lit): a word literal emits as a typed array (`const x: u32[] = [0x11111111, …]`). A word-array result compares length and then every word, and a failure prints both arrays as words. The emitted test must compile with the pinned nish and run under `spec run`.

Where an emitter (`--lang` rust, go, python) or the property sampler ([src/spec/sample/](../../src/spec/sample/)) cannot hold word arrays, it refuses with a clear message and exit code per [src/core/diag.ts](../../src/core/diag.ts). It must not crash or emit code that does not build. Regenerate `tests/dogfood/**` if the emitter's output for existing contracts changes; it should not.

## Acceptance fixture

Add `tests/fixtures/…/rfc8439-quarter-round.md` (+ its built `.xml`). It declares the nish signature and carries exactly these two rows, cited to the committed [rfcs/rfc8439.txt](../../rfcs/rfc8439.txt):

```
| 2.1.1-QUARTER-ROUND | `chacha20QuarterRound([0x11111111 0x01020304 0x9b8d6f43 0x01234567], 0, 1, 2, 3)` | `[0xea2a92f4 0xcb1cf8ce 0x4581472e 0x5881c4bb]` | R-QUARTER-ROUND | {{Section 2.1.1 of RFC8439}} | … |
| 2.2.1-QUARTER-ROUND-STATE | `chacha20QuarterRound(Sample ChaCha State = [879531e0 c5ecf37d 516461b1 c9a62f8a 44c20ef3 3390af7f d9fc690b 2a5f714c 53372767 b00a5631 974c541a 359e9963 5c971061 3d631689 2098d9d6 91dbd320], 2, 7, 8, 13)` | `After applying QUARTERROUND(2, 7, 8, 13) = [879531e0 c5ecf37d bdb886dc c9a62f8a 44c20ef3 3390af7f d9fc690b cfacafd2 e46bea80 b00a5631 974c541a 359e9963 5c971061 ccc07c79 2098d9d6 91dbd320]` | R-QUARTER-ROUND-STATE | {{Section 2.2.1 of RFC8439}} | … |
```

If the label rule makes the second row's labels wrong or unnecessary, follow the rule and say so in the PR body; the close-out reports the final spelling to nish.

Add a fixture Nish module with a correct `chacha20QuarterRound` (the RFC §2.1 algorithm) and a broken copy (one rotation changed). Add CLI goldens (`tests/cli/<case>/`) for:

- `spec extract` exits 0 on the fixture;
- `spec run` exits 0 (`SATISFIED`) against the correct module and 1 (`VIOLATED`, naming the row) against the broken one;
- `spec extract` exits 1 on a copy with one grid word changed by one digit.

## Docs

- [docs/guide/guides/writing-a-spec.md](../../docs/guide/guides/writing-a-spec.md): the Literals table, the Types table, "What the Nish test can hold", and "What a printed value is" (word blocks, grids, `*` markers, token-exact spelling).
- [.claude/skills/vector-spec/SKILL.md](../../.claude/skills/vector-spec/SKILL.md): its type list and its Literals list.
- Grep `docs/`, `README.md`, `.claude/` and source comments for other lists of the types (`u8[], string, boolean`) and update each.
- Regenerate `docs/reference/**` with `node scripts/gen-reference.mjs` (never by hand); `node scripts/gen-reference.mjs --check` and `node scripts/check-links.mjs` pass.

## Out of scope

- Property clauses over word-array variables (refused, "not yet").
- Signed arrays (`i32[]` …) and `f64[]`.
- Changing nish's spec — this run ends by telling the user how to write its rows.
- Issue #111 (wrong `.md` line numbers in refusals).

## Tests

Mirror [tests/spec/](../../tests/spec/) (`front`, `contract`, `gates` fidelity and typing, `emit`) and the `tests/cli/` golden layout. Every new rule lands with a table-driven test that fails on `main`, driven through `vectorRun` or the binary per CLAUDE.md.

## Verification

```
npm run build
node tests/run.mjs spec
node tests/run.mjs cli
npm run lint
npm run tested-exports
npm run dogfood
node scripts/gen-reference.mjs --check && node scripts/check-links.mjs
```

CI (`ci.yml`, `spec.yml`, `docs.yml`, `pr-title.yml`) runs the full set on the PR.
