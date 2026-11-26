---
name: Emitted Nish tests build under the no-panic rule
overview: Every Nish test vector emits (spec emit, and the programs spec run and spec mutate build) compiles under nish 0.47.0's default no-panic rule with no relax flag, proven by a new test that runs main's pinned 0.47.0 compiler (.nish-next) over an emitted program of every clause kind and type.
stages:
  - id: prover-pin
    title: Install main's 0.47.0 pin in cloud sessions
    goal: The SessionStart hook installs the 0.47.0 compiler that main already pins as .nish-next, so the panic test can run in cloud sessions; CI's fetch is run 217's PR 220
    verification: bash -n on the hook exits 0, the hook installs .nish-next/bin/nish reporting 0.47.0, and npm run lint passes with .nish-next present once PR 220's biome ignore is on main
    status: in_progress
    todos:
      - id: prover-version-file
        content: Add a separate 0.47.0 pin file — cancelled, main's .nish-next-version (PR 218) already pins it — see Prover pin
        status: cancelled
      - id: prover-fetch-script
        content: Add a separate fetch script — cancelled, main's scripts/fetch-nish-next.sh (PR 218) installs it — see Prover pin
        status: cancelled
      - id: prover-hook-ci
        content: Run scripts/fetch-nish-next.sh in .claude/hooks/session-start.sh (PR 216); the CI fetch is PR 220 — see Prover pin
        status: in_progress
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
        status: in_progress
      - id: helper-guards
        content: Make every helper in src/spec/emit/helpers.ts prover-clean (unhex, nibble, bytesEq, sliceBytes, fillBytes, flipBit, bitwiseBytes, remI32, concat and the wordsHex family) — see Emitter guards
        status: in_progress
      - id: emit-guards
        content: Make the templates in src/spec/emit/emit.ts prover-clean (property tables and samplers, iterate and repeat loops, window and out CAP expansions, truncate, nonce and vector-done epilogue) — see Emitter guards
        status: in_progress
      - id: argv-no-relax
        content: Assert no argv built by runNishArgv (src/spec/run/run.ts) or the mutate build (src/spec/pr/mutaterun.ts) contains --allow-panics — see No relax flag
        status: in_progress
      - id: regen-goldens
        content: Regenerate the tests/cli emit and run golden cases and tests/dogfood with their generators, never by hand — see Regenerated files
        status: in_progress
      - id: mutation-check
        content: Delete each guard added in turn and record in the PR body that the panic test fails for each — see Panic test
        status: in_progress
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

## Out of scope

- Moving `.nish-version` off 0.39.0, or making vector's own source prover-clean.
- Panics inside the module under test, such as nish std's `sha1` or `x25519`. Those are fixed in nish.
- Changes to nish's repository, including regenerating its `test/spec/*.ts`.
- The go, python, rust and typescript emitters, beyond regenerating goldens a shared change moves.

## Tests

| Test | Covers |
| --- | --- |
| `tests/spec/emit/panics_test.ts` (new) | every clause kind and type through `spec emit` under the 0.47.0 prover; the site classifier, table-driven |
| `tests/spec/emit/run_test.ts` | `runNishArgv` never contains `--allow-panics` |
| mutate argv test (next to the existing `mutaterun` coverage) | mutate build argv never contains `--allow-panics` |
| existing `tests/spec/emit/*_test.ts`, `tests/cli/emit-run-nish-*` | the emitted tests still compile under 0.39.0 and reach the same verdicts |

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
