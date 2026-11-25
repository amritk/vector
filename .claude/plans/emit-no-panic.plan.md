---
name: Emitted Nish tests build under the no-panic rule
overview: Every Nish test vector emits (spec emit, and the programs spec run and spec mutate build) compiles under nish 0.47.0's default no-panic rule with no relax flag, proven by a new test that runs a pinned 0.47.0 prover over an emitted program of every clause kind and type.
stages:
  - id: prover-pin
    title: Pin a 0.47.0 prover beside the 0.39.0 compiler
    goal: A second, separately pinned nish (0.47.0) is installed into .nish-prover/ locally, by the SessionStart hook and in CI, without moving the 0.39.0 pin that builds vector itself
    verification: bash scripts/fetch-nish-prover.sh installs .nish-prover/bin/nish reporting 0.47.0, is idempotent on a second run, CI's check job fetches and caches it, and npm run build, npm test, npm run lint pass unchanged
    todos:
      - id: prover-version-file
        content: Add .nish-prover-version holding 0.47.0 and ignore /.nish-prover in .gitignore — see Prover pin
        status: pending
      - id: prover-fetch-script
        content: Add scripts/fetch-nish-prover.sh installing the pinned prover into .nish-prover/ — see Prover pin
        status: pending
      - id: prover-hook-ci
        content: Fetch the prover in .claude/hooks/session-start.sh and in the check job of .github/workflows/ci.yml, cache key covering the new pin — see Prover pin
        status: pending
      - id: prover-docs
        content: Add the fetch-nish-prover row to the CLAUDE.md command table and say what the second pin is for — see Prover pin
        status: pending
  - id: emit-no-panic
    title: Emit panic-free Nish tests
    goal: Every Nish emitter template and helper writes code the 0.47.0 prover accepts, with a test over every clause kind and type that fails on one unproven emitter-written site
    verification: node tests/run.mjs spec/emit passes with the prover installed and fails after deleting any one guard, the emitted SHA-1 and X25519 tests build with plain 0.47.0 nish run, and npm run build, npm test, npm run lint, npm run tested-exports, npm run dogfood are green
    todos:
      - id: panic-test
        content: Add tests/spec/emit/panics_test.ts — emits a fixture spec covering every clause kind and type via spec emit, builds it with .nish-prover/bin/nish --emit-panics, and refuses any unproven non-OOM site the emitter wrote — see Panic test
        status: pending
      - id: helper-guards
        content: Make every helper in src/spec/emit/helpers.ts prover-clean (unhex, nibble, bytesEq, sliceBytes, fillBytes, flipBit, bitwiseBytes, remI32, concat and the wordsHex family) — see Emitter guards
        status: pending
      - id: emit-guards
        content: Make the templates in src/spec/emit/emit.ts prover-clean (property tables and samplers, iterate and repeat loops, window and out CAP expansions, truncate, nonce and vector-done epilogue) — see Emitter guards
        status: pending
      - id: argv-no-relax
        content: Assert no argv built by runNishArgv (src/spec/run/run.ts) or the mutate build (src/spec/pr/mutaterun.ts) contains --allow-panics — see No relax flag
        status: pending
      - id: regen-goldens
        content: Regenerate the tests/cli emit and run golden cases and tests/dogfood with their generators, never by hand — see Regenerated files
        status: pending
      - id: mutation-check
        content: Delete each guard added in turn and record in the PR body that the panic test fails for each — see Panic test
        status: pending
---

## Context

nish 0.47.0 refuses by default every unproven panic site in the root package except out-of-memory (errors NL2457/NL2458); `--allow-panics` relaxes it. vector's Nish emitter writes such sites into every test. Measured on this branch with a scratch 0.47.0 over tests emitted from nish's own contracts:

| Emitted test | Refused sites | Where |
| --- | --- | --- |
| RFC 6234 SHA-1 | 12 | `unhex` index, overflow, `charCodeAt`; `nibble` `v - 48`; `bytesEq` `a[i]`/`b[i]`; property tables `table_m[i]`/`table_b[i]`; `main`'s `process.argv[1]` |
| RFC 7748 X25519 | 33 | the above plus `bitwiseBytes`, `flipBit` (index and overflow), `sliceBytes`, an overflow in `clause_5_2_ITER_1000`, table index sites in each `P_*` clause |

Neither calls a module function that may panic, so once the emitter is fixed both must build with plain `nish run` under 0.47.0.

vector itself cannot move to 0.47.0: `src/main.ts` has 2021 refused sites under it. So the 0.39.0 pin in [.nish-version](.nish-version) stays, and the prover is a second pin.

## Approach

- **Two pins, two jobs.** `.nish-version` (0.39.0) builds vector and runs every existing test and golden. `.nish-prover-version` (0.47.0) is used only by the panic test, via `--emit-panics`. When vector's own source is clean the two pins merge; that is out of scope here.
- **Two stages, merged in order.** `prover-pin` touches CI, the SessionStart hook and `CLAUDE.md`, which are sensitive paths. It is small, so a human can review it quickly. `emit-no-panic` is the emitter work and merges after it. Until `prover-pin` merges, the panic test skips in CI. The `emit-no-panic` worker installs 0.47.0 locally into `.nish-prover/` using the interface below, so development does not wait on that merge.
- **What counts as emitter-written.** A site in a function whose `module` is the emitted test file. Such a site passes only when it is `kind: "oom"`, `proven: true`, or a `kind: "call"` whose `callee` is a function of the module under test. Every other site fails the test: `index`, `overflow`, or a `call` into an emitter helper or std.
- **Guards the prover understands**, per the requirement: `if (i >= 0 && i < xs.length)`, loops bounded by the array they index, and checked or widened arithmetic. Never `nish:unsafe`, and never a guard that proves nothing, such as a check on one array guarding an index into another. Where a helper cannot fail on valid input, the guarded branch returns a value the caller's comparison then fails on. It never silently passes.

## Prover pin

**Owns:** `.nish-prover-version`, `scripts/fetch-nish-prover.sh`, `.gitignore`, `.claude/hooks/session-start.sh`, `.github/workflows/ci.yml`, `CLAUDE.md`. **Model:** sonnet. Sensitive paths, so its merge waits for a human.

Interface `emit-no-panic` relies on:

| Item | Value |
| --- | --- |
| Pin file | `.nish-prover-version`, one line `0.47.0` |
| Installer | `bash scripts/fetch-nish-prover.sh` (same installer URL and flags as [scripts/fetch-nish.sh](scripts/fetch-nish.sh), `--dir .nish-prover`) |
| Binary | `.nish-prover/bin/nish`, with its own std under `.nish-prover/` |
| Ignored | `/.nish-prover` in [.gitignore](.gitignore) |

- [.claude/hooks/session-start.sh](.claude/hooks/session-start.sh) runs the fetch after `fetch-nish.sh`. It is idempotent: it prints `already in .nish-prover/` when the version matches.
- [.github/workflows/ci.yml](.github/workflows/ci.yml) `check` job: add a prover fetch step next to the existing `fetch-nish.sh` step, and add `.nish-prover-version` and the new script to the cache's `hashFiles(...)`, with `.nish-prover` in the cached paths. Leave the other workflows alone: only `check` runs `npm test`.
- In CI, set `VECTOR_PROVER_REQUIRED=1` on the `npm test` step, so the panic test fails instead of skipping when the prover is missing (see Panic test). This is the only place a skip could hide a regression.
- [CLAUDE.md](CLAUDE.md): add a command-table row `bash scripts/fetch-nish-prover.sh`, and add one sentence in the opening paragraph that the prover pin exists only to check emitted tests.

## Emit panic-free Nish tests

**Owns:** `src/spec/emit/**`, `tests/spec/emit/**`, `tests/fixtures/emit-panics/**`, the mutate argv test under `tests/spec/pr/`, `tests/cli/**` goldens, `tests/dogfood/**`, `docs/AI.md` and guide pages under `docs/` only where they show emitted Nish. **Model:** opus. **Merges after** `prover-pin`.

### Panic test

[tests/spec/emit/panics_test.ts](tests/spec/emit/panics_test.ts), a Nish program on `nish/testing` like [tests/spec/emit/run_test.ts](tests/spec/emit/run_test.ts):

1. Fixture: a contract plus a fixture module under `tests/fixtures/emit-panics/`. The module's stub functions are themselves prover-clean, and between them they cover every clause kind and type the emitter supports:
   - Types: `u8[]`, `string`, each int width, `bool`, `u16[]`, `u32[]`, `u64[]`, `Secret<u8[]>`, and `| null` results.
   - Clause kinds: plain vector, window, `/* out CAP */`, truncate, iterate, iterate slow, and properties (tables and samplers).
   - If the contract is extracted from a spec, the spec `.md`, `.xml` and contract are built by their generators and pinned like the other fixtures.
2. Emit it through the real path, `vectorRun(["spec", "emit", …])` or the binary. Do not call internal emitter functions.
3. Build the output with `.nish-prover/bin/nish <file> --emit-panics <json>`, with the fixture module reachable via the same `--package`/scratch-std mechanism the run tests use. Parse the JSON and fail with `module:line:col kind function` for every site that is not allowed by the rule in Approach.
4. Also assert that each emitted program builds with the prover and no flags at all, exit 0.
5. Skip only when `.nish-prover/bin/nish` is missing. When `VECTOR_PROVER_REQUIRED=1` is set, a missing prover is a failure.
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
bash scripts/fetch-nish-prover.sh
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
for c in rfc6234-sha1 rfc7748-x25519; do dist/vector spec emit <nish>/contracts/$c.json -o /tmp/$c.ts && .nish-prover/bin/nish run /tmp/$c.ts && .nish-prover/bin/nish /tmp/$c.ts --emit-panics /tmp/$c.json; done
```

Both builds exit 0 with no flags. Each `--emit-panics` list holds only `oom` sites and calls into `sha1`/`x25519`.
