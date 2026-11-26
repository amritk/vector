---
name: nish-no-panic
overview: Make every module under src/ build under nish 0.47 with its default no-panic rule, by guarding or restructuring each unproven non-OOM panic site, redesigning the two exports that take a function reference, and replacing panicking std calls with panic-free equivalents, then move .nish-version to the latest release. A ratchet script and a CI step refuse any new unproven site while the stages land.
stages:
  - id: panic-gate
    title: Panic ratchet script, baselines and a panic-free ASCII case helper
    goal: npm run panics counts unproven non-OOM sites per module under src/ with the next nish, refuses any module over its baseline, and src/core/text.ts gives panic-free textAsciiLower and textAsciiUpper
    verification: npm run build && npm run panics && node --test scripts/panics.test.mjs && node tests/run.mjs core && npm run lint && npm run tested-exports && node scripts/gen-reference.mjs --check
    todos:
      - id: fetch-next
        content: scripts/fetch-nish-next.sh installs the version in .nish-next-version (0.47.0) into .nish-next/, which .gitignore ignores
        status: pending
      - id: script
        content: scripts/panics.mjs runs the next nish with --allow-panics --emit-panics on src/main.ts, counts by the counting rule, and compares against scripts/panic-baseline/*.json
        status: pending
      - id: baselines
        content: one baseline file per stage with that stage's per-module counts, summing to the measured total at the base commit
        status: pending
      - id: script-tests
        content: scripts/panics.test.mjs runs the script on fixture Nish programs and fixture reports, table-driven, including a mutation row per comparison
        status: pending
      - id: text-helper
        content: src/core/text.ts with textAsciiLower and textAsciiUpper, byte-identical to std asciiLower and asciiUpper on every input, tested in tests/core/text_test.ts
        status: pending
  - id: panic-ci
    title: Run the panic ratchet in CI
    goal: ci.yml runs npm run panics and its own tests on every push and pull request, and CLAUDE.md lists the command
    verification: npm run panics && node --test scripts/panics.test.mjs && npm run lint
    todos:
      - id: ci-step
        content: a check job step after Build that fetches the next nish, runs npm run panics and node --test scripts/panics.test.mjs, with .nish-next in the toolchain cache keyed on .nish-next-version
        status: pending
      - id: claude-md
        content: a commands-table row for npm run panics in CLAUDE.md
        status: pending
  - id: fn-ref
    title: Dispatch source readers on a tag, not a function reference
    goal: no exported function or class member under src/ takes a parameter of function type, and checkAddReader and SourceReaderEntry dispatch on a reader-kind enum
    verification: npm run build && node tests/run.mjs spec/extract && node tests/run.mjs spec/gates && node tests/run.mjs spec/source && node tests/run.mjs cli && npm run lint && npm run tested-exports && npm run dogfood && node scripts/gen-reference.mjs --check && npm run panics
    todos:
      - id: enum
        content: a reader-kind enum and one module-private dispatch function replace the read parameter of checkAddReader and the constructor field of SourceReaderEntry
        status: pending
      - id: callers
        content: extract.ts, source/path.ts and the tests call the enum form, and the reference is regenerated
        status: pending
  - id: spec-pr
    title: Prove src/spec/pr cannot panic
    goal: npm run panics reports zero sites in src/spec/pr and its baseline file is deleted
    verification: npm run build && node tests/run.mjs spec/pr && node tests/run.mjs cli && npm run lint && npm run tested-exports && npm run dogfood && npm run panics && git diff --exit-code origin/main -- tests/cli tests/dogfood
    todos:
      - id: guard
        content: guard or restructure each site in gitdiff, mutate, lex, mutaterun, scope, rename, frozen, stale, cli and exports
        status: pending
  - id: spec-gates
    title: Prove src/spec/gates cannot panic
    goal: npm run panics reports zero sites in src/spec/gates, asciiLower and asciiUpper calls there go through textAsciiLower and textAsciiUpper, and its baseline file is deleted
    verification: npm run build && node tests/run.mjs spec/gates && node tests/run.mjs cli && npm run lint && npm run tested-exports && npm run dogfood && npm run panics && git diff --exit-code origin/main -- tests/cli tests/dogfood
    todos:
      - id: guard
        content: guard or restructure each site in fidelity, text, result, words, signatures, completeness, derive, cite, coverage, run and typing
        status: pending
  - id: spec-contract
    title: Prove src/spec/contract cannot panic
    goal: npm run panics reports zero sites in src/spec/contract and its baseline file is deleted
    verification: npm run build && node tests/run.mjs spec/contract && node tests/run.mjs cli && npm run lint && npm run tested-exports && npm run dogfood && npm run panics && git diff --exit-code origin/main -- tests/cli tests/dogfood
    todos:
      - id: guard
        content: guard or restructure each site in literals, read, write, shape, chars, capacity, typing, f64, vocab and types
        status: pending
  - id: spec-xml
    title: Prove src/spec/xml cannot panic
    goal: npm run panics reports zero sites in src/spec/xml and its baseline file is deleted
    verification: npm run build && node tests/run.mjs spec/extract && node tests/run.mjs cli && npm run lint && npm run tested-exports && npm run dogfood && npm run panics && git diff --exit-code origin/main -- tests/cli tests/dogfood
    todos:
      - id: guard
        content: guard or restructure each site in reader, text and doc
        status: pending
  - id: spec-emit
    title: Prove src/spec/emit cannot panic
    goal: npm run panics reports zero sites in src/spec/emit and its baseline file is deleted
    verification: npm run build && node tests/run.mjs spec/emit && node tests/run.mjs cli && npm run lint && npm run tested-exports && npm run dogfood && npm run panics && git diff --exit-code origin/main -- tests/cli tests/dogfood
    todos:
      - id: guard
        content: guard or restructure each site in rust, emit, go, python, typescript, packages, lit, file and target
        status: pending
  - id: spec-profile
    title: Prove src/spec/profile cannot panic
    goal: npm run panics reports zero sites in src/spec/profile and its baseline file is deleted
    verification: npm run build && node tests/run.mjs spec/extract && node tests/run.mjs cli && npm run lint && npm run tested-exports && npm run dogfood && npm run panics && git diff --exit-code origin/main -- tests/cli tests/dogfood
    todos:
      - id: guard
        content: guard or restructure each site in profile.ts, including the profileRefusalOrder comparator
        status: pending
  - id: spec-source
    title: Prove src/spec/source cannot panic
    goal: npm run panics reports zero sites in src/spec/source and its baseline file is deleted
    verification: npm run build && node tests/run.mjs spec/source && node tests/run.mjs cli && npm run lint && npm run tested-exports && npm run dogfood && npm run panics && git diff --exit-code origin/main -- tests/cli tests/dogfood
    todos:
      - id: guard
        content: guard or restructure each site in rfc, hidden, path and fold
        status: pending
  - id: spec-sample
    title: Prove src/spec/sample cannot panic
    goal: npm run panics reports zero sites in src/spec/sample and its baseline file is deleted
    verification: npm run build && node tests/run.mjs spec/gates && node tests/run.mjs cli && npm run lint && npm run tested-exports && npm run dogfood && npm run panics && git diff --exit-code origin/main -- tests/cli tests/dogfood
    todos:
      - id: guard
        content: guard or restructure each site in smt, eval, property, ints and prng, including sampleToLiteral
        status: pending
  - id: spec-front
    title: Prove src/spec/front cannot panic
    goal: npm run panics reports zero sites in src/spec/front, its asciiLower calls go through textAsciiLower, and its baseline file is deleted
    verification: npm run build && node tests/run.mjs spec/extract && node tests/run.mjs cli && npm run lint && npm run tested-exports && npm run dogfood && npm run panics && git diff --exit-code origin/main -- tests/cli tests/dogfood
    todos:
      - id: guard
        content: guard or restructure each site in front.ts
        status: pending
  - id: spec-extract
    title: Prove src/spec/extract.ts cannot panic
    goal: npm run panics reports zero sites in src/spec/extract.ts and its baseline file is deleted
    verification: npm run build && node tests/run.mjs spec/extract && node tests/run.mjs cli && npm run lint && npm run tested-exports && npm run dogfood && npm run panics && git diff --exit-code origin/main -- tests/cli tests/dogfood
    todos:
      - id: guard
        content: guard or restructure each site in extract.ts
        status: pending
  - id: spec-run
    title: Prove src/spec/run cannot panic
    goal: npm run panics reports zero sites in src/spec/run and its baseline file is deleted
    verification: npm run build && node tests/run.mjs spec/emit && node tests/run.mjs cli && npm run lint && npm run tested-exports && npm run dogfood && npm run panics && git diff --exit-code origin/main -- tests/cli tests/dogfood
    todos:
      - id: guard
        content: guard or restructure each site in run.ts and command.ts
        status: pending
  - id: verify-solve
    title: Prove src/verify/solve cannot panic
    goal: npm run panics reports zero sites in src/verify/solve and its baseline file is deleted
    verification: npm run build && node tests/run.mjs verify && node tests/run.mjs cli && npm run lint && npm run tested-exports && npm run panics && git diff --exit-code origin/main -- tests/cli tests/dogfood
    todos:
      - id: guard
        content: guard or restructure each site in replay and report
        status: pending
  - id: verify-emit
    title: Prove src/verify/emit cannot panic
    goal: npm run panics reports zero sites in src/verify/emit and its baseline file is deleted
    verification: npm run build && node tests/run.mjs verify && node tests/run.mjs cli && npm run lint && npm run tested-exports && npm run panics && git diff --exit-code origin/main -- tests/cli tests/dogfood
    todos:
      - id: guard
        content: guard or restructure each site in float64, dashboard, outjson and typescript
        status: pending
  - id: verify-lang
    title: Prove src/verify/lang cannot panic
    goal: npm run panics reports zero sites in src/verify/lang and its baseline file is deleted
    verification: npm run build && node tests/run.mjs verify && node tests/run.mjs cli && npm run lint && npm run tested-exports && npm run panics && git diff --exit-code origin/main -- tests/cli tests/dogfood
    todos:
      - id: guard
        content: guard or restructure each site in check, read, pretty and style
        status: pending
  - id: verify-equiv
    title: Prove src/verify/equiv cannot panic
    goal: npm run panics reports zero sites in src/verify/equiv and its baseline file is deleted
    verification: npm run build && node tests/run.mjs verify && node tests/run.mjs cli && npm run lint && npm run tested-exports && npm run panics && git diff --exit-code origin/main -- tests/cli tests/dogfood
    todos:
      - id: guard
        content: guard or restructure each site in diff.ts
        status: pending
  - id: core-misc
    title: Prove src/core, src/lang, src/cli and the remaining modules cannot panic
    goal: npm run panics reports zero own sites in src/core, src/lang, src/cli, src/verify/smt, src/verify/verify.ts, src/spec/report, src/main.ts and src/index.ts, and the only sites left in its baseline are Cli declaration and ParseResult accessor calls annotated for nish-bump
    verification: npm run build && node tests/run.mjs core && node tests/run.mjs lang && node tests/run.mjs verify && node tests/run.mjs package && node tests/run.mjs cli && npm run lint && npm run tested-exports && npm run dogfood && npm run panics && git diff --exit-code origin/main -- tests/cli tests/dogfood
    todos:
      - id: guard
        content: guard or restructure each own site in smt, hex, fs, z3, process, json, names, script, report/common, report/markdown, verify.ts and the cli handlers
        status: pending
      - id: ascii
        content: names.ts calls textAsciiLower and textAsciiUpper instead of the std functions
        status: pending
      - id: std-left
        content: the baseline keeps only the Cli.flag, Cli.argument, Cli.command, Cli.group, Cli.repeatable and ParseResult accessor sites, plus sha256 and JsonDocument.stringify, the Cli and ParseResult sites annotated for nish-bump and sha256 and JsonDocument.stringify annotated with amritk/nish#2322
        status: pending
  - id: nish-bump
    title: Move .nish-version to the latest nish release
    goal: .nish-version names the latest amritk/nish release, npm run build passes with no flags under it, 0.39.0 is dropped, and the ratchet and its --allow-panics are gone because the build itself refuses every unproven site
    verification: bash scripts/fetch-nish.sh && npm run build && npm test && npm run lint && npm run tested-exports && npm run dogfood && npm run doc-caps && node scripts/gen-reference.mjs --check && ! git grep -n -e '--allow-panics' -- scripts .github docs src package.json
    todos:
      - id: pin
        content: .nish-version and the package.json nish engine move to the release that fixes amritk/nish#2322, and the installation guide line names it
        status: pending
      - id: cli-try
        content: the cli declarations switch to tryFlag, tryArgument, tryCommand, tryGroup and tryRepeatable, passing a declaration error up as Err, and the ParseResult accessors switch to readFlag, readValue, readValues, readSource, readPositional and readPositionals on the returned CliFlag and CliArgument handles
        status: pending
      - id: std-fixes
        content: the sha256 and JsonDocument.stringify sites clear on the release that fixes amritk/nish#2322, and the last baseline file is deleted
        status: pending
      - id: retire-next
        content: the ratchet is retired (amritk/vector#215 D1, owner decision): scripts/panics.mjs, scripts/panics.test.mjs, the panics package.json script, scripts/panic-baseline/**, .nish-next-version, fetch-nish-next.sh, the .nish-next .gitignore entry and biome ignore, and the CI fetch, ratchet and self-test steps and .nish-next cache entry are removed; CLAUDE.md's npm run panics row goes; no --allow-panics is left in scripts/, .github/, docs/, src/ or package.json
        status: pending
      - id: release-fixes
        content: whatever else the new release changed is fixed, and the PR body states the release and each change
        status: pending
---

# nish-no-panic

## Context

nish 0.47.0 refuses to compile a program with a panic site its prover cannot discharge. At base `b94f92a`, vector builds under 0.39.0. Under 0.47.0 the build fails with 2021 errors:

- unproven own sites (NL2457);
- calls into std functions that may panic (NL2458);
- two exported parameters that hold a function reference.

The measurement is `nish src/main.ts --allow-panics --emit-panics panics.json --link /tmp/v`.

**The counting rule.** A site counts when all of these hold:

- it is in a module under `src/`;
- its kind is not `oom`;
- it is neither `proven` nor `allowed`;
- it is not a `call` whose callee is a function defined under `src/`. Such a call clears when its callee is fixed.

By this rule there are 2041 sites at base. The table gives each stage's count.

| Stage | Own sites | Std-call sites |
|---|---|---|
| spec-pr | 299 | 4 |
| spec-gates | 283 | 26 |
| spec-contract | 268 | 0 |
| spec-xml | 141 | 0 |
| spec-emit | 131 | 0 |
| core-misc | 106 | 121 |
| spec-profile | 95 | 7 |
| spec-source | 94 | 2 |
| spec-sample | 80 | 2 |
| verify-solve | 75 | 0 |
| spec-front | 75 | 1 |
| verify-emit | 74 | 0 |
| spec-extract | 68 | 0 |
| verify-lang | 36 | 1 |
| verify-equiv | 28 | 0 |
| spec-run | 24 | 0 |

The std calls fall into four groups:

- **`Cli.flag/argument/command/group/repeatable`** (68 sites) panic on a bad declaration. 0.47 adds `tryFlag`, `tryArgument`, `tryCommand`, `tryGroup` and `tryRepeatable`, which return a `Result`. 0.39 lacks them, so the switch waits for the bump.
- **`ParseResult.flag/value/values/positional/positionals`** (45 sites) panic on a bad handle. 0.47 adds `readFlag`, `readValue`, `readValues`, `readSource`, `readPositional` and `readPositionals`, which take the `CliFlag` and `CliArgument` handles the `try*` declarations return and do not panic. 0.39 lacks them, so this switch also waits for the bump. No upstream issue is needed.
- **`asciiLower` and `asciiUpper`** (25 sites) slice at std/text.ts:886. vector replaces them with its own panic-free helpers.
- **`sha256` and `JsonDocument.stringify`** (2 sites each) are std defects. Reimplementing crypto or JSON in vector is out of scope, so they wait on amritk/nish#2322. That issue also notes `asciiLower` and `asciiUpper`, which #2309 owns upstream; vector replaces them itself and does not wait.

The remaining std-call sites are instantiations of `map`, `some`, `filter`, `every`, `everyIndexed` and `sortWith`. They take a vector closure or comparator, and each clears when the stage that owns that closure fixes it.

## Approach

**The guard rule** comes from 0.47's docs/AI.md, "Proving it cannot panic". Each site gets one of these:

- a guard the prover discharges:
  - index: `i >= 0 && i < xs.length`, or a `u32` compare;
  - divide: `d !== 0 && d !== -1`;
  - pop: `xs.length > 0`;
  - array-length: `n >= 0`;
  - slice: `0 <= start <= end <= len`;
  - overflow: bounded operands or wider arithmetic;
  - io-exit: `orReturn` or `unwrapOr` in place of `expect`;
- or a restructure that removes the site, such as iterating `for…of` in place of indexing.

A guard whose failing branch returns a made-up value the caller cannot tell from a real one is refused in review. The failing branch returns `Err` through the function's existing `Result`, or the code is restructured so the branch does not exist. There is no `--allow-panics` in a build, no `noPanic` scoping, and no `nish:unsafe`.

**Two compilers.** Until the bump, every stage must also build and pass under the pinned 0.39.0. `npm run build` and `npm test` use 0.39.0. The ratchet uses 0.47.0 from `.nish-next/`. Guards are plain TypeScript, so they compile under both.

**The ratchet** is `npm run panics`, which runs `scripts/panics.mjs`. It works like this:

1. It fetches the next nish into `.nish-next/` if it is missing.
2. It emits the panic report.
3. It counts sites by the rule above.
4. It reads `scripts/panic-baseline/<stage-id>.json`, one file per stage, each mapping module to count.

Exit 1 means some module is over its baseline, or a site sits in a module no baseline names. The script prints each excess site as `module:line:col kind`. A count below its baseline only warns. Exit 2 means a tool failure, and exit 0 means the gate passed.

Because each stage owns its own baseline file, concurrent stages never touch the same file. A stage at zero deletes its file, and from then on any new site in its modules is refused.

**Byte-identical behaviour.** Every guarded path is one the old code could not reach without panicking, so no golden and no dogfood test changes. Each stage proves this with `git diff --exit-code origin/main -- tests/cli tests/dogfood`. A stage that must change one says which and why in its PR body.

**Merge order.**

1. panic-gate merges first, and every other stage starts from it.
2. spec-source and spec-extract wait for fn-ref, because fn-ref edits `source/load.ts`, `source/path.ts` and `extract.ts`.
3. nish-bump comes last. It waits on every stage and on an amritk/nish release that fixes amritk/nish#2322.

## Stage: panic-gate

**Owns**:

- `scripts/panics.mjs`, `scripts/panics.test.mjs` and `scripts/panic-baseline/**`;
- `scripts/fetch-nish-next.sh` and `.nish-next-version`;
- `.gitignore` and `package.json` (only the `panics` script entry);
- `src/core/text.ts` and `tests/core/text_test.ts`;
- `docs/reference/**` and `scalar.config.json`, both regenerated.

**Build.** `scripts/fetch-nish-next.sh` mirrors `fetch-nish.sh`, reading `.nish-next-version` and installing into `.nish-next/`. It leaves `fetch-nish.sh` and the session-start hook untouched.

The script's tests run on small fixture Nish programs and fixture JSON reports, as table-driven rows:

- a guarded index passes;
- the same index with its guard removed is refused, exit 1, naming the site;
- an OOM-only report passes;
- a proven site and an allowed site pass;
- a `call` into an own function is not counted, and a call into std is;
- a module with no baseline is refused;
- a count one over its baseline is refused, and one under it warns;
- a missing or unreadable report exits 2.

Every comparison the script makes gets a row that fails when that comparison is flipped.

`textAsciiLower` and `textAsciiUpper` are written with no slice and no unproven index. Their tests compare them to the std functions on every byte value and on multi-byte UTF-8 input.

**Verification**: `npm run build && npm run panics && node --test scripts/panics.test.mjs && node tests/run.mjs core && npm run lint && npm run tested-exports && node scripts/gen-reference.mjs --check`

## Stage: panic-ci

**Owns**: `.github/workflows/ci.yml` and `CLAUDE.md`. Both are sensitive paths, so this PR goes to a human for the merge.

**Build.** Add a step after Build in the `check` job. It runs `bash scripts/fetch-nish-next.sh`, then `npm run panics`, then `node --test scripts/panics.test.mjs`. Add `.nish-next` to the toolchain cache, with `.nish-next-version` and `fetch-nish-next.sh` in its key. Add one commands-table row to CLAUDE.md.

**Verification**: `npm run panics && node --test scripts/panics.test.mjs && npm run lint`, and CI green on the PR.

## Stage: fn-ref

**Owns**:

- `src/spec/check.ts`, `src/spec/source/load.ts`, `src/spec/source/path.ts` and `src/spec/extract.ts`;
- `tests/spec/extract/extract_gates_test.ts`, `tests/spec/extract/extract_cases_test.ts`, `tests/spec/gates/readers_test.ts` and `tests/spec/source/load_test.ts`;
- `docs/reference/**` and `scalar.config.json`, both regenerated;
- `scripts/panic-baseline/fn-ref.json`, if the stage needs one.

**Build.** Replace the `read` parameter of `checkAddReader` (check.ts:234) and the `constructor` field of `SourceReaderEntry` (load.ts:35) with a reader-kind enum. One module-private function switches on it. No export under src/ may take or hold a function-typed value.

The existing reader tests drive the enum form, and every caller in extract.ts and path.ts switches to it. A new row confirms that each enum value reaches its reader.

**Verification**:

- the stage's verification line;
- a grep that finds no exported parameter or field of function type: `grep -nE 'export .*\(([^)]*:[^)]*=>)' src -r` returns nothing;
- the 0.47 build reports neither function-reference error: `.nish-next/bin/nish src/main.ts --link "$TMPDIR/v" 2>&1 | grep -c 'function reference'` prints 0.

## Stages: spec-pr, spec-gates, spec-contract, spec-xml, spec-emit, spec-profile, spec-source, spec-sample, spec-front, spec-extract, spec-run, verify-solve, verify-emit, verify-lang, verify-equiv

**Owns**: `src/<dir>/**` for that stage's directory (`src/spec/extract.ts` for spec-extract), plus `scripts/panic-baseline/<stage-id>.json`.

**Build.** Guard or restructure every site the ratchet lists for the stage's modules, by the guard rule. Fix closures and comparators passed to std (`gitdiffCompare`, `gateCoverageOrder`, `profileRefusalOrder`, `sampleToLiteral` and others) so their std-call sites clear.

spec-gates and spec-front switch `asciiLower` and `asciiUpper` to `textAsciiLower` and `textAsciiUpper`.

New helpers stay module-private. No export's signature or doc comment changes, so `docs/reference` stays as it is.

Tests are not expected to change. When a restructure needs a new test, its file is named in the PR body and is outside every other stage's Owns. When the stage reaches zero, it deletes its baseline file.

**Verification**: each stage's verification line in the frontmatter. That line includes `npm run panics`, which exits 0 only when the stage's modules are back at baseline. The baseline file must be gone, and `git diff --exit-code origin/main -- tests/cli tests/dogfood` must show no change.

## Stage: core-misc

**Owns**:

- `src/core/**` except `src/core/text.ts`;
- `src/lang/**`, `src/cli/**`, `src/verify/smt/**`, `src/verify/verify.ts` and `src/spec/report/**`;
- `src/main.ts` and `src/index.ts`;
- `scripts/panic-baseline/core-misc.json`.

**Build.** Guard every own site. `lang/names.ts` switches to the text helpers.

The baseline keeps only these sites: `Cli.*` declarations, `ParseResult` accessors, `sha256` and `JsonDocument.stringify`. Each is annotated in a `"waiting"` key: `nish-bump` for the Cli and ParseResult sites, and `amritk/nish#2322` for sha256 and stringify. The stage does not work around them.

**Verification**: the stage's verification line in the frontmatter, plus the same no-change check on the goldens and dogfood tests.

## Stage: nish-bump

**Owns**:

- `.nish-version` and `.nish-next-version` (deleted);
- `package.json` (the nish engine) and `docs/guide/getting-started/installation.md`;
- `docs/AI.md`, if the release changes a fact it states;
- `src/cli/**` and `src/index.ts` (the `try*` declarations);
- `scripts/panics.mjs`, `scripts/panics.test.mjs`, `scripts/fetch-nish-next.sh` and `scripts/panic-baseline/**`, all deleted, and the `panics` script in `package.json`;
- `.gitignore`, `biome.json`, `CLAUDE.md` (the `npm run panics` row), and `.github/workflows/ci.yml` (removing the `.nish-next` fetch, the ratchet and self-test steps, and the cache entry);
- `tests/**` where the release changes behaviour.

This stage is sensitive and goes to a human for the merge.

**Build.** The stage waits on every other stage and on an amritk/nish release that fixes amritk/nish#2322.

1. Set `.nish-version` and the `package.json` nish engine to that release, and drop 0.39.0. THIRD_PARTY_NOTICES.md keeps its x25519 fixture provenance (nish v0.39.0), because that is a historical fact, not a pin.
2. Switch the cli declarations to the `try*` forms, and the ParseResult accessors to the `read*` forms.
3. Retire the ratchet (owner decision D1 on amritk/vector#215): delete `scripts/panics.mjs`, `scripts/panics.test.mjs`, `scripts/panic-baseline/**`, `.nish-next-version` and `scripts/fetch-nish-next.sh`, and their `package.json`, `.gitignore`, `biome.json`, `CLAUDE.md` and CI entries. Under the new pin, `npm run build` refuses every unproven non-OOM site and names it as `file:line:col`, so the CI Build step is the panic gate; amritk/vector#219 (run #215) adds a no-panic job and an `allow-panics` check and merges after this stage. Show in the PR body that an unguarded index in a `src/` module makes `npm run build` fail and name the site.
4. Fix whatever else the release changed.

The PR body states the release and each change.

**Verification**: `bash scripts/fetch-nish.sh && npm run build && npm test && npm run lint && npm run tested-exports && npm run dogfood && npm run doc-caps && node scripts/gen-reference.mjs --check`, and `git grep -n -e '--allow-panics' -- scripts .github docs src package.json` finds nothing.

## Out of scope

- Reimplementing sha256, JSON serialisation or cli-args parsing in vector.
- Proving the absence of panics in `tests/**` or in nish std. The ratchet counts modules under src/ only.
- Any behaviour change. A golden or dogfood diff is a defect unless its PR names it and says why.
- Changing `scripts/fetch-nish.sh` or the session-start hook before the bump.

## Tests

- `scripts/panics.test.mjs`: fixture programs and reports, table-driven, with mutation rows. It runs in CI from panic-ci until nish-bump deletes it with the ratchet.
- `tests/core/text_test.ts`: the text helpers against std on every byte and on UTF-8 input.
- `tests/spec/gates/readers_test.ts` and the extract tests: the enum dispatch.
- Every existing test, golden and dogfood test, unchanged.

## Verification

At the end of the run:

```bash
bash scripts/fetch-nish.sh && npm run build && npm test && npm run lint && npm run tested-exports && npm run dogfood && npm run doc-caps && node scripts/gen-reference.mjs --check && ! git grep -n -e '--allow-panics' -- scripts .github docs src package.json
```

Then mutation-check the gate. Delete one index guard in a src/ module. `npm run build` must fail and name that site as `file:line:col`, and so must CI's Build step on a pushed branch. Restore the guard, and both must pass.
