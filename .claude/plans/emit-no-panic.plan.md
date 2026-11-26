---
name: Emitted Nish tests build under the no-panic rule
overview: Every Nish test vector emits (spec emit, and the programs spec run and spec mutate build) compiles under nish 0.47.0's default no-panic rule with no relax flag, proven by a new test that runs main's pinned 0.47.0 compiler (.nish-next) over an emitted program of every clause kind and type.
stages:
  - id: prover-pin
    title: Install main's 0.47.0 pin in cloud sessions
    goal: The SessionStart hook installs the 0.47.0 compiler that main already pins as .nish-next, so the panic test can run in cloud sessions; CI's fetch is run 217's PR 220
    verification: bash -n on the hook exits 0, the hook installs .nish-next/bin/nish reporting 0.47.0, and npm run lint passes with .nish-next present once PR 220's biome ignore is on main
    status: completed
    todos:
      - id: prover-version-file
        content: Add a separate 0.47.0 pin file — cancelled, main's .nish-next-version (PR 218) already pins it — see Prover pin
        status: cancelled
      - id: prover-fetch-script
        content: Add a separate fetch script — cancelled, main's scripts/fetch-nish-next.sh (PR 218) installs it — see Prover pin
        status: cancelled
      - id: prover-hook-ci
        content: Run scripts/fetch-nish-next.sh in .claude/hooks/session-start.sh (PR 216); the CI fetch is PR 220 — see Prover pin
        status: completed
      - id: prover-docs
        content: Add a CLAUDE.md row for the second pin — cancelled, PR 220 adds the npm run panics row — see Prover pin
        status: cancelled
  - id: emit-no-panic
    title: Emit panic-free Nish tests
    goal: Every Nish emitter template and helper writes code the 0.47.0 prover accepts, with a test over every clause kind and type that fails on one unproven emitter-written site
    verification: node tests/run.mjs spec/emit passes with .nish-next installed and fails after deleting any one guard, the emitted SHA-1 and X25519 tests build with plain 0.47.0 nish run, and npm run build, npm test, npm run lint, npm run tested-exports, npm run dogfood are green
    todos:
      - id: panic-test
        content: Add tests/spec/emit/panics_test.ts — emits a fixture spec covering every clause kind and type via spec emit, builds it with .nish-next/bin/nish --emit-panics, and refuses any unproven non-OOM site the emitter wrote — see Panic test
        status: completed
      - id: helper-guards
        content: Make every helper in src/spec/emit/helpers.ts prover-clean (unhex, nibble, bytesEq, sliceBytes, fillBytes, flipBit, bitwiseBytes, remI32, concat and the wordsHex family) — see Emitter guards
        status: completed
      - id: emit-guards
        content: Make the templates in src/spec/emit/emit.ts prover-clean (property tables and samplers, iterate and repeat loops, window and out CAP expansions, truncate, nonce and vector-done epilogue) — see Emitter guards
        status: completed
      - id: argv-no-relax
        content: Assert no argv built by runNishArgv (src/spec/run/run.ts) or the mutate build (src/spec/pr/mutaterun.ts) contains --allow-panics — see No relax flag
        status: completed
      - id: regen-goldens
        content: Regenerate the tests/cli emit and run golden cases and tests/dogfood with their generators, never by hand — see Regenerated files
        status: completed
      - id: mutation-check
        content: Delete each guard added in turn and record in the PR body that the panic test fails for each — see Panic test
        status: completed
  - id: sampler-no-unsafe
    title: Pin the sampler's wrapping edges
    goal: Rows pin the sampler's two on-purpose wraps (the int parser at i64 MIN, the boundary steps across the u64 bit boundary), which stay wrappingAdd and wrappingSub from nish:unsafe under the owner's rule
    verification: the PR diff is tests only, the new rows fail on a broken wrap site, and npm run build, node tests/run.mjs spec/sample, npm run lint, npm run tested-exports are green
    status: completed
    todos:
      - id: ints-no-unsafe
        content: Replace wrappingAdd in the int parser — cancelled, the owner's rule keeps a wrap that is meant to happen visible as nish:unsafe — see Sampler wrapping edges
        status: cancelled
      - id: property-no-unsafe
        content: Replace wrappingAdd and wrappingSub in the boundary steps — cancelled, same rule — see Sampler wrapping edges
        status: cancelled
      - id: sampler-rows
        content: Add table-driven rows at i64 MIN, the u64 bit boundary and their neighbours in tests/spec/sample/steps_test.ts — see Sampler wrapping edges
        status: completed
      - id: no-unsafe-test
        content: Add a test refusing nish:unsafe under src — cancelled, same rule — see Sampler wrapping edges
        status: cancelled
      - id: sampler-mutation
        content: Mutation-check both wrap sites and record the failing row for each in the PR body — see Sampler wrapping edges
        status: completed
  - id: purposeful-wrap
    title: On-purpose wraps through nish:unsafe
    goal: Every site under src that relies on a signed value wrapping does it with wrappingAdd, wrappingSub or wrappingMul from nish:unsafe instead of a u64 round trip, with byte-identical results
    verification: the eight sites in the table use nish:unsafe, a row at each wrap edge fails when its wrapping op is replaced by the plain operator, no golden or dogfood file changes, and npm run build, npm test, npm run lint, npm run tested-exports, npm run panics are green
    status: completed
    todos:
      - id: wrap-eval
        content: Use wrappingAdd, wrappingSub and wrappingMul in sampleArith in src/spec/sample/eval.ts — see On-purpose wraps
        status: completed
      - id: wrap-ints-prng
        content: Use wrappingSub in sampleIntWrap (src/spec/sample/ints.ts) and wrappingAdd in the wide branch of sampleIntIn (src/spec/sample/prng.ts) — see On-purpose wraps
        status: completed
      - id: wrap-replay
        content: Use wrappingSub in replayNeg and wrappingAdd in replayAdd64 in src/verify/solve/replay.ts — see On-purpose wraps
        status: completed
      - id: wrap-rows
        content: Add an exact-edge row for each converted site where main has none, and mutation-check each — see On-purpose wraps
        status: completed
  - id: emit-wrap
    title: Emitted wraps through nish:unsafe, and the rule in CLAUDE.md
    goal: The Nish emitter writes i32 and i64 + - * as wrappingAdd, wrappingSub and wrappingMul from nish:unsafe instead of a u32 or u64 round trip, and CLAUDE.md states the on-purpose wrap rule
    verification: no emitted test holds toI32(toU32( or toI64(toU64( for a + - * clause, the emitted SHA-1 and X25519 tests still build under bare 0.47.0 with only oom and module-call sites, a row fails when the emitter writes the plain operator, goldens and dogfood are regenerated, and npm run build, npm test, lint, tested-exports, panics, dogfood, doc-caps and gen-reference --check are green
    todos:
      - id: emit-wrap-emitter
        content: Emit wrappingAdd, wrappingSub and wrappingMul for i32 and i64 in src/spec/emit/emit.ts, importing only what a test uses — see Emitted wraps
        status: completed
      - id: emit-wrap-tests
        content: Flip the forms_test.ts round-trip and no-nish:unsafe assertions, and add rows that fail on a plain operator — see Emitted wraps
        status: completed
      - id: emit-wrap-regen
        content: Regenerate the example-hex golden, the CLI goldens and tests/dogfood from the emitter — see Emitted wraps
        status: completed
      - id: emit-wrap-docs
        content: Update docs/guide/guides/writing-a-spec.md and, if it describes emitted arithmetic, docs/AI.md — see Emitted wraps
        status: completed
      - id: emit-wrap-claude-md
        content: State the on-purpose wrap rule in CLAUDE.md under Writing Nish, in its own PR — see Emitted wraps
        status: completed
---

## Context

nish 0.47.0 refuses by default every unproven panic site in the root package except out-of-memory (errors NL2457/NL2458); `--allow-panics` relaxes it. vector's Nish emitter writes such sites into every test. Measured on this branch with a scratch 0.47.0 over tests emitted from nish's own contracts:

| Emitted test | Refused sites | Where |
| --- | --- | --- |
| RFC 6234 SHA-1 | 12 | `unhex` index, overflow, `charCodeAt`; `nibble` `v - 48`; `bytesEq` `a[i]`/`b[i]`; property tables `table_m[i]`/`table_b[i]`; `main`'s `process.argv[1]` |
| RFC 7748 X25519 | 33 | the above plus `bitwiseBytes`, `flipBit` (index and overflow), `sliceBytes`, an overflow in `clause_5_2_ITER_1000`, table index sites in each `P_*` clause |

Neither calls a module function that may panic, so once the emitter is fixed both must build with plain `nish run` under 0.47.0.

vector itself cannot move to 0.47.0: `src/main.ts` has 2021 refused sites under it. So the 0.39.0 pin in [.nish-version](.nish-version) stays, and 0.47.0 is a second pin: main's `.nish-next` ([.nish-next-version](.nish-next-version), installed by [scripts/fetch-nish-next.sh](scripts/fetch-nish-next.sh)), added by PR 218 while this plan ran.

## Approach

- **Two pins, two jobs.** `.nish-version` (0.39.0) builds vector and runs every existing test and golden. `.nish-next-version` (0.47.0) is used by `npm run panics` and by the panic test, via `--emit-panics`. When vector's own source is clean the two pins merge; that is out of scope here.
- **Two stages, merged in order.** `prover-pin` touches CI, the SessionStart hook and `CLAUDE.md`, which are sensitive paths. It is small, so a human can review it quickly. `emit-no-panic` is the emitter work and merges after it, and after PR 220, which fetches `.nish-next` in CI: the panic test requires the compiler when `CI=true`, so CI's `check` is red on it until then. Merge order: PR 220, PR 216, PR 221.
- **What counts as emitter-written.** A site in a function whose `module` is the emitted test file. Such a site passes only when it is `kind: "oom"`, `proven: true`, or a `kind: "call"` whose `callee` is a function of the module under test. Every other site fails the test: `index`, `overflow`, or a `call` into an emitter helper or std.
- **Guards the prover understands**, per the requirement: `if (i >= 0 && i < xs.length)`, loops bounded by the array they index, and checked or widened arithmetic. Never `nish:unsafe`, and never a guard that proves nothing, such as a check on one array guarding an index into another. Where a helper cannot fail on valid input, the guarded branch returns a value the caller's comparison then fails on. It never silently passes.

## Prover pin

**Owns:** `.claude/hooks/session-start.sh`. **Model:** sonnet. Sensitive path, so its merge waits for a human.

This stage first added its own `.nish-prover` pin, installer, CI fetch and CLAUDE.md row. While it ran, main gained the same 0.47.0 pin as `.nish-next` (PR 218), and run 217's PR 220 wires that fetch into CI, adds biome's `.nish-next/**` ignore and the CLAUDE.md row. So this stage shrank to one hook line, and the rest was reverted.

Interface `emit-no-panic` relies on:

| Item | Value |
| --- | --- |
| Pin file | [.nish-next-version](.nish-next-version), `0.47.0` (main) |
| Installer | `bash scripts/fetch-nish-next.sh` (main) |
| Binary | `.nish-next/bin/nish`, kept off PATH |
| Hook | [.claude/hooks/session-start.sh](.claude/hooks/session-start.sh) runs the installer after `fetch-nish.sh` (PR 216) |
| CI | `check` fetches and caches `.nish-next` (PR 220) |

The panic test fails rather than skips when the compiler is missing and `CI=true` or `VECTOR_PROVER_REQUIRED=1` is set.

## Emit panic-free Nish tests

**Owns:** `src/spec/emit/**`, `tests/spec/emit/**`, `tests/fixtures/emit-panics/**`, the mutate argv test under `tests/spec/pr/`, `tests/cli/**` goldens, `tests/dogfood/**`, `docs/AI.md` and guide pages under `docs/` only where they show emitted Nish. **Model:** opus. **Merges after** PR 220 and `prover-pin`.

### Panic test

[tests/spec/emit/panics_test.ts](tests/spec/emit/panics_test.ts), a Nish program on `nish/testing` like [tests/spec/emit/run_test.ts](tests/spec/emit/run_test.ts):

1. Fixture: a contract plus a fixture module under `tests/fixtures/emit-panics/`. The module's stub functions are themselves prover-clean, and between them they cover every clause kind and type the emitter supports:
   - Types: `u8[]`, `string`, each int width, `bool`, `u16[]`, `u32[]`, `u64[]`, `Secret<u8[]>`, and `| null` results.
   - Clause kinds: plain vector, window, `/* out CAP */`, truncate, iterate, iterate slow, and properties (tables and samplers).
   - If the contract is extracted from a spec, the spec `.md`, `.xml` and contract are built by their generators and pinned like the other fixtures.
2. Emit it through the real path, `vectorRun(["spec", "emit", …])` or the binary. Do not call internal emitter functions.
3. Build the output with `.nish-next/bin/nish <file> --emit-panics <json>`, with the fixture module reachable via the same `--package`/scratch-std mechanism the run tests use. Parse the JSON and fail with `module:line:col kind function` for every site that is not allowed by the rule in Approach.
4. Also assert that each emitted program builds with the prover and no flags at all, exit 0.
5. Skip only when `.nish-next/bin/nish` is missing. When `CI=true` or `VECTOR_PROVER_REQUIRED=1` is set, a missing compiler is a failure.
6. A second table-driven check runs the same rule on small hand-written panic-JSON samples: an OOM site, a proven index, an unproven index in the test module, an overflow, a call into the module under test, a call into a helper, and a site in another module. This pins the classifier's neighbours without the prover, so the rule itself is mutation-tested.

Mutation check: after the guards land, delete each guard in turn (or flip `<` to `<=`) and confirm the panic test fails. List each mutation and its failing row in the PR body.

### Emitter guards

Files: [src/spec/emit/helpers.ts](src/spec/emit/helpers.ts) (helper templates) and [src/spec/emit/emit.ts](src/spec/emit/emit.ts) (`emitPlainWrapper`, `emitOutBody`, `emitVector`, `emitIterateSteps`, `emitVectorCheck`, `emitTable`, `emitProperty`, `emitMain`). Known sites to start from (line numbers are in emitted code):

- `unhex`: `out[i]` and `2*i+1` against a `hex.length >> 1` bound; `charCodeAt` index.
- `nibble`: `v - 48` overflow.
- `bytesEq`, `sliceBytes`, `fillBytes`, `flipBit`, `bitwiseBytes`: indexing a second array under a loop bound taken from the first. `flipBit` also has a bit-shift overflow.
- Property tables: `table_b[i]` in a loop bounded by `table_a.length`. Use one loop over a single array of records, or an explicit `i < table_b.length` guard.
- Samplers, iterate and repeat loops: counters and sums. Use a widened type or checked add.
- `main`: `process.argv[1]` behind `toI32(process.argv.length) > 1`. Bind the length once and test the index the prover can see.

Calls into the module under test stay exactly as they are. Do not wrap them, hide them, or route them through a helper that would make the site look like the emitter's.

Keep the other language emitters (go, python, rust, typescript) unchanged. If a shared change moves their output, their goldens regenerate too.

### No relax flag

Add table-driven rows to [tests/spec/emit/run_test.ts](tests/spec/emit/run_test.ts), next to the existing `runNishArgv` rows, and to the mutate test that covers [src/spec/pr/mutaterun.ts](src/spec/pr/mutaterun.ts). Each row asserts that `--allow-panics` is absent from the argv for plain, `slow` (`--profile speed`) and mutate builds. The rows read the real argv-building function. They are not a grep.

### Regenerated files

- `tests/cli/emit-*`, `tests/cli/emit-run-nish-*`, `tests/cli/emit-words-nish` and any other golden whose stdout is emitted Nish text: regenerate the way the runner expects, by rerunning the command against the built `dist/vector`.
- `tests/dogfood/**`: regenerate with the dogfood generator (`npm run dogfood` names it).
- If a guide page or [docs/AI.md](docs/AI.md) shows emitted Nish code, update it. Run `npm run doc-caps` and shorten text in place if a doc goes over its cap.
- PR body note: nish's `test/spec/*.ts` (amritk/nish) were emitted by the old vector and need regenerating in a nish spec-side PR after this merges.

## Sampler wrapping edges

**Owns:** [tests/spec/sample/steps_test.ts](tests/spec/sample/steps_test.ts) (new). **Model:** sonnet. Added at the user's request after `emit-no-panic` merged; re-scoped to tests only by the owner on 2026-11-26.

The stage first set out to remove `nish:unsafe` from the sampler. Probing the 0.47.0 prover with full-range inputs showed that both sites wrap on purpose: `lo + 1` and `hi - 1` are not provable behind `lo < hi`, and the int parser's `~mag + 1` is i64 MIN's only route. The owner then set the rule: **a wrap that is meant to happen uses `nish:unsafe`**, so it is visible at the site. A `toI64(toU64(a) + toU64(b))` round trip hides it. Both sites therefore stay as they are on main:

| File | Site | Stays |
| --- | --- | --- |
| `ints.ts` | negative branch of the int parser, `mag <= 2^63` | `wrappingAdd(toI64(~mag), toI64(1))` |
| `property.ts` | boundary steps inside `[lo, hi]` when `lo < hi` | `wrappingAdd(lo, toI64(1))`, `wrappingSub(hi, toI64(1))` |

What lands is the rows, table-driven, through the sampler's real entry points: parsing `-9223372036854775808` gives i64 MIN; `-9223372036854775807`, `-1` and `-0` give what main gives; a u64 range with `lo` at i64 MAX steps to `0x8000000000000000`; a range with `hi` at `0x8000000000000000` steps down to i64 MAX; and an i64 range at `[MIN, MAX]` steps without a panic. Each wrap site is mutation-checked (drop the `+ 1`, swap add and sub), and the PR body lists the failing row. Criterion 9 (no `nish:unsafe` under `src/`) is dropped.

## On-purpose wraps

**Owns:** [src/spec/sample/eval.ts](src/spec/sample/eval.ts), [src/spec/sample/ints.ts](src/spec/sample/ints.ts), [src/spec/sample/prng.ts](src/spec/sample/prng.ts), [src/verify/solve/replay.ts](src/verify/solve/replay.ts), and new test files under `tests/spec/sample/` and `tests/verify/` (`solve_*_test.ts`). **Model:** sonnet. Added at the owner's request ("change it anywhere else we have it").

A site counts as **on purpose** when the signed result can fall outside its type and the code relies on the two's-complement wrap. Those sites move to `nish:unsafe`:

| File | Function | Now | Becomes |
| --- | --- | --- | --- |
| `eval.ts` | `sampleArith`, `+` `-` `*` (the type's wrapping arithmetic, reduced by `sampleIntWrap`) | `toI64(toU64(x.n) op toU64(y.n))` | `wrappingAdd` / `wrappingSub` / `wrappingMul(x.n, y.n)` |
| `ints.ts` | `sampleIntWrap` mask; `span` is i64 MIN at `w = 63` | `toI64(toU64(span) - toU64(1))` | `wrappingSub(span, toI64(1))` |
| `ints.ts` | `sampleIntWrap` sign; `low - span` overflows at `w = 63` | `toI64(toU64(low) - toU64(span))` | `wrappingSub(low, span)` |
| `prng.ts` | `sampleIntIn`, wide branch; the offset may exceed i64 MAX | `toI64(span === 0 ? draw : toU64(lo) + (draw % span))` | `span === 0 ? toI64(draw) : wrappingAdd(lo, toI64(draw % span))` |
| `replay.ts` | `replayNeg`, i64 MIN stays itself | `toI64(toU64(0) - toU64(a))` | `wrappingSub(toI64(0), a)` |
| `replay.ts` | `replayAdd64`, wrapped sum then the sign test | `toI64(toU64(a) + toU64(b))` | `wrappingAdd(a, b)` |

**Left as they are**, because no wrap happens in the value they compute:

- *Never wraps:* the signed result always fits, and the `u32`/`u64` detour only satisfies the prover. These are index and length arithmetic, and counters (`rfc.ts`, `xml/*`, `hidden.ts`, `path.ts`, `lex.ts`, `front.ts`, `literals.ts`, `z3.ts`, `report.ts`, `property.ts` `sampleBump`, `eval.ts:475`, `prng.ts:64`), plus `prng.ts:80/105/107` (offset within `[lo, hi]`), `replay.ts:194` (`-p` with `p <= REPLAY_MAX`) and `smt.ts:434` (a small signed difference). `wrappingAdd` there would say that a wrap is intended when it is not.
- *Unsigned by nature:* `u64` remainders, magnitudes and PRNG state (`eval.ts:243-255`, `replayMag`, `prng.ts`'s draws).
- *The emitter:* `src/spec/emit/**` writes no signed round trip into emitted tests (`git grep` for `toI64(toU64(` under it finds none), so the emitted code keeps the original rule of no `nish:unsafe`.

Results stay bit-identical, so no golden or dogfood file moves. Rows: add an exact-edge row where main has none, through the real entry points. Examples: `sampleArith` at i64 MAX + 1, MIN - 1, MAX * 2, and in `u64` at `2^64 - 1 + 1`; `sampleIntWrap` at `w = 63`, signed and unsigned; `sampleIntIn` over `[MIN, MAX]` and over a span above `2^63`; `replayNeg(MIN)`; `replayAdd64` at MAX - 1 + 1 and MAX + 1. #233 and #235 added some of these, so the worker lists which rows already exist. Mutation: replace each wrapping op with the plain operator (0.39.0 then aborts on overflow) and swap add and sub; the PR body names the failing row for each. `npm run panics` shows no new site.

**Note for run #217:** its acceptance criterion 2 asks for no `nish:unsafe` anywhere in `src/**`. The owner's rule contradicts that, and the conflict is reported to that run's lead.

## Emitted wraps

**Owns:** [src/spec/emit/emit.ts](src/spec/emit/emit.ts) (and other `src/spec/emit/**` files only for the import), `tests/spec/emit/**`, `tests/cli/**` and `tests/dogfood/**` (regenerated only), [docs/guide/guides/writing-a-spec.md](docs/guide/guides/writing-a-spec.md), [docs/AI.md](docs/AI.md), and, in a second PR, [CLAUDE.md](CLAUDE.md) alone. **Model:** sonnet. Added at the owner's request ("we now allow nish:unsafe if wrapping is the intended behaviour", then "do both as a new stage").

The contract says `i32` and `i64` `+ - *` wrap modulo 2^N, so every such op in an emitted test is an on-purpose wrap. Today [emit.ts](src/spec/emit/emit.ts) (the `op === "+" || "-" || "*"` branch, about line 698) writes it as `toI32(toU32(a) op toU32(b))`, and `toI64`/`toU64` for i64. That was #221's answer to the original "no `nish:unsafe` in emitted code" rule, which the owner has since replaced. It becomes `wrappingAdd(a, b)`, `wrappingSub(a, b)` or `wrappingMul(a, b)`. The test imports from `"nish:unsafe"` only the names it uses, and a test with no signed `+ - *` imports nothing from it. Unsigned ops stay plain operators. The Rust emitter already writes `wrapping_add` and friends (`rust.ts:610`).

Pre-flight, checked by the lead on main 090793c: under bare 0.47.0 (`.nish-next/bin/nish`), a program calling all three on `i32` and `i64` builds and runs with no flag, and `--emit-panics` lists one `oom` site and nothing else. Nish's own `AI.md` names these imports as the way to write a defined wrap.

- **Tests.** `tests/spec/emit/forms_test.ts` lines 133-137 move to the `wrapping*` forms, and its two "imports nothing from nish:unsafe" checks (lines 139 and 242) become checks that the import is exactly the names used. `example-hex` now uses `wrappingMul` (its `2 * len` clause). Add a row that a contract with only unsigned ops imports nothing from `nish:unsafe`. Mutations: emit the plain operator (the panics test fails under 0.47.0), swap two of the three names, and always import all three or none. Each one fails a row, or the PR states why it is equivalent.
- **Regenerated.** `tests/spec/emit/golden/example-hex.golden`, any CLI golden that prints an emitted test, and `tests/dogfood/vector-core-hex_test.ts`, each by the repo's generator, never by hand.
- **Docs.** In `writing-a-spec.md`, lines 431-433 describe the `wrapping*` forms. `docs/AI.md` changes only if it describes emitted arithmetic. It is at 6398 of its 6400-byte cap, so any line added there is paid for by shortening it in place.
- **CLAUDE.md, a separate PR.** Under "Writing Nish", one bullet: a wrap that is meant to happen is `wrappingAdd`/`wrappingSub`/`wrappingMul` from `nish:unsafe` at its site, never `toI64(toU64(a) op toU64(b))`, and arithmetic that cannot wrap stays plain. The file is at 8950 of its 8960-byte cap, so the bullet is paid for by shortening other text in place, never by raising the cap. `CLAUDE.md` is a sensitive path for the merge gate, so this PR waits for a human merge, and the emitter PR does not wait on it.
- **Fixtures.** The `toI32(toU32(` round trips in `tests/fixtures/{byte-order,nish-hex,x25519}` are hand-written stand-ins for modules under test, outside this stage. The worker lists which of them are on purpose, and changes none of them.
- **Downstream.** amritk/nish's `test/spec/*.ts` will import `nish:unsafe` once they are regenerated from this emitter. The PR body says so.

## Out of scope

- Moving `.nish-version` off 0.39.0, or making vector's own source prover-clean.
- Panics inside the module under test, such as nish std's `sha1` or `x25519`. Those are fixed in nish.
- Changes to nish's repository, including regenerating its `test/spec/*.ts`.
- The go, python, rust and typescript emitters, beyond regenerating goldens a shared change moves.
- `nish:unsafe` in the hand-written fixture [tests/spec/emit/fixtures/forms.ts](tests/spec/emit/fixtures/forms.ts), and `--allow-panics` in [scripts/panics.mjs](scripts/panics.mjs), which needs it to count sites.
- Sites that never wrap, and values that are unsigned by nature (see On-purpose wraps).

## Tests

| Test | Covers |
| --- | --- |
| `tests/spec/emit/panics_test.ts` (new) | every clause kind and type through `spec emit` under the 0.47.0 prover; the site classifier, table-driven |
| `tests/spec/emit/run_test.ts` | `runNishArgv` never contains `--allow-panics` |
| mutate argv test (next to the existing `mutaterun` coverage) | mutate build argv never contains `--allow-panics` |
| existing `tests/spec/emit/*_test.ts`, `tests/cli/emit-run-nish-*` | the emitted tests still compile under 0.39.0 and reach the same verdicts |
| `tests/spec/gates/sample_test.ts` (new rows) | the int parser at i64 MIN and its neighbours; boundary steps across the u64 bit boundary |
| `tests/spec/sample/steps_test.ts` (new) | the sampler's two wrap sites at their edges |
| new `tests/spec/sample/` and `tests/verify/solve_*_test.ts` rows | each on-purpose wrap at its edge |

## Verification

```bash
bash scripts/fetch-nish-next.sh
npm run build
node tests/run.mjs spec/emit
node tests/run.mjs emit-
npm test
npm run lint
npm run tested-exports
npm run dogfood
npm run doc-caps
```

Acceptance against nish's contracts (lead, after both merge). Use a nish checkout at its `v0.47.0` tag, so that std's `sha1` and `x25519` are the prover's own:

```bash
for c in rfc6234-sha1 rfc7748-x25519; do dist/vector spec emit <nish>/contracts/$c.json -o /tmp/$c.ts && .nish-next/bin/nish run /tmp/$c.ts && .nish-next/bin/nish /tmp/$c.ts --emit-panics /tmp/$c.json; done
```

Both builds exit 0 with no flags. Each `--emit-panics` list holds only `oom` sites and calls into `sha1`/`x25519`.

Sampler and on-purpose-wrap stages (lead, after each merges). The grep must print nothing, because no on-purpose wrap is left as a u64 round trip in the six converted functions:

```bash
git grep -n 'toI64(toU64(.*) [-+*] toU64(' src/spec/sample/eval.ts src/spec/sample/ints.ts src/verify/solve/replay.ts
node tests/run.mjs spec/sample
node tests/run.mjs verify
npm run panics
```
