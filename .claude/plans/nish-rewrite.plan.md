---
name: Rewrite vector in Nish
overview: Replace the Bun/TypeScript vector (about 21k lines) with a fresh native CLI written in Nish. It keeps the jobs (prove numeric functions with Z3, and turn specs into contracts and Nish tests), the file formats and the exit codes, drops what nothing uses, and moves the docs onto a Scalar site with a generated reference, the way nish does.
stages:
  - id: foundation
    title: "build: replace the Bun toolchain with a Nish skeleton"
    goal: A clean clone builds a native vector binary from Nish source with the pinned compiler, and CI, the session hook, the test runner and CLAUDE.md all run on Nish
    verification: bash scripts/fetch-nish.sh && bash scripts/fetch-z3.sh && npm run build && ./dist/vector --version && npm test && npm run lint && npm run tested-exports
    todos:
      - id: f-remove-ts
        content: Delete the TypeScript implementation (src/, test/*.test.ts, scripts/*.ts, src/generated, bun.lock, tsconfig.json) and move test/fixtures to tests/fixtures unchanged — see Foundation
      - id: f-toolchain
        content: Add scripts/fetch-nish.sh (nish 0.39.0 pinned, into .nish/) and scripts/fetch-z3.sh (z3 4.16.0 into .z3/), and rewrite package.json scripts for build, test, lint and tested-exports — see Foundation
      - id: f-core
        content: Write src/core (files and paths, JSON helpers, hex and sha256, a subprocess runner with a timeout, the z3 runner and its s-expression reader, diagnostics with exit codes) with tests — see Foundation
      - id: f-cli
        content: Write src/main.ts and one stub file per command under src/cli/ that later stages fill in — see The command line
      - id: f-tests
        content: Write tests/run.mjs (runs every tests/**/*_test.ts with nish run plus CLI golden cases, takes a filter) and scripts/tested-exports.mjs — see Tests and the coverage gate
      - id: f-ci
        content: Rewrite .github/workflows/ci.yml, add pr-title.yml, and rewrite .claude/hooks/session-start.sh for nish, z3 and clang — see Foundation
      - id: f-claude-md
        content: Write CLAUDE.md with the rules carried over from nish, and cut README.md down to a short stub — see Rules carried over from nish
  - id: verify
    title: "feat: vector verify and vector diff in Nish"
    goal: The numeric track proves a SpecPlan and Program with Z3, emits guarded TypeScript only when proven, and compares program generations
    verification: npm run build && node tests/run.mjs verify && ./dist/vector verify tests/fixtures/currency-spec.json tests/fixtures/currency.json --json
    todos:
      - id: v-lang
        content: Write src/verify/lang (read Program and SpecPlan JSON against the unchanged schemas, report every shape error at once, resolve names and types, check layering) — see Verify
      - id: v-solve
        content: Write src/verify/smt and src/verify/solve (SMT-LIB2 generation, per-clause verdicts, vacuity, triviality, division and callee-precondition hazards, counterexamples, axiom traceability) — see Verify
      - id: v-emit
        content: Write src/verify/emit (guarded TypeScript), the float64 gate, the dashboard and the JSON outcome — see Verify
      - id: v-diff
        content: Write src/verify/equiv and fill in src/cli/diff.ts (EQUIVALENT, DIFFERENT, UNDECIDED with exit codes 0, 1, 2) — see Verify
      - id: v-skill
        content: Update .claude/skills/vector to the new command line — see Verify
  - id: contract-model
    title: "feat: the contract model, sources and the check pipeline"
    goal: Contracts are read, validated, typed and written canonically in Nish, RFC and spec texts are read and quoted, and a check pipeline exists that later gates plug into
    verification: npm run build && node tests/run.mjs spec/contract && node tests/run.mjs spec/source
    todos:
      - id: c-vocab
        content: Write src/spec/contract (the neutral vocabulary, contract types, the expression grammar and typeOf, the shape validator, canonical JSON writer) — see Contract model
      - id: c-literals
        content: Write src/spec/contract/literals (vector-table Call and Expected cells to literals) — see Contract model
      - id: c-sources
        content: Write src/spec/source (find and read sources with path confinement, RFC text sections, quote and byte-string lookup, homoglyph and zero-width refusal) — see Contract model
      - id: c-check
        content: Write src/spec/check.ts, the gate pipeline with only the shape gate registered, and the Sample type emit will consume — see Contract model
  - id: extract
    title: "feat: vector spec extract in Nish"
    goal: The committed specs extract to byte-identical contracts, and every refusal names its markdown line
    verification: npm run build && node tests/run.mjs spec/extract && for f in specs/*.xml; do ./dist/vector spec extract "$f" -o "contracts/$(basename "$f" .xml).json" --check || exit 1; done
    todos:
      - id: e-xml
        content: Write src/spec/xml (the narrow RFC XML v3 reader, with no external entities or xi:include, and size and depth limits) — see Extract
      - id: e-front
        content: Write src/spec/front (the lexer and parser for ts-interface and ts-property blocks, with line and column refusals) — see Extract
      - id: e-profile
        content: Write src/spec/profile and src/spec/extract.ts (the vector profile, hashes, canonical output, check mode) and fill in src/cli/spec-extract.ts — see Extract
      - id: e-ci
        content: Add .github/workflows/spec.yml (build-spec.sh check and extract check over specs) — see Extract
  - id: gates
    title: "feat: vector spec check — gates, sampling and the report"
    goal: vector spec check runs every gate and the Z3 boundary sampling on a contract and prints the text, markdown or JSON report
    verification: npm run build && node tests/run.mjs spec/gates && ./dist/vector spec check contracts/rfc5869-hkdf-sha256.json
    todos:
      - id: g-gates
        content: Write src/spec/gates (typing, coverage, fidelity, completeness, provenance, signatures, domain) and register them in src/spec/check.ts — see Gates
      - id: g-sample
        content: Write src/spec/sample (seeded PRNG, the where evaluator, Z3 boundary sampling and the non-vacuity check) — see Gates
      - id: g-report
        content: Write src/spec/report and fill in src/cli/spec-check.ts, including --run-sources with a timeout — see Gates
  - id: emit
    title: "feat: vector spec emit and vector spec run"
    goal: A contract becomes a Nish test that runs against a nish checkout, with each PASS or FAIL mapped back to its requirement
    verification: npm run build && node tests/run.mjs spec/emit
    todos:
      - id: m-emit
        content: Write src/spec/emit (contract and samples to a nish/testing program, with the contract sha256 line) — see Emit and run
      - id: m-run
        content: Write src/spec/run (scratch copy of a nish checkout, nish run, result mapping) and fill in src/cli/spec-emit.ts and src/cli/spec-run.ts — see Emit and run
  - id: pr-gates
    title: "feat: vector spec frozen, stale, exports and mutate"
    goal: The spec-first PR gates run against a git repository and a nish checkout
    verification: npm run build && node tests/run.mjs spec/pr
    todos:
      - id: p-gitdiff
        content: Write src/spec/pr/gitdiff (git diff -U0 reader) and the export scanner — see PR gates
      - id: p-frozen
        content: Write frozen, stale and exports, and fill in their src/cli files — see PR gates
      - id: p-mutate
        content: Write src/spec/pr/mutate (operators, parallel runs, survivors and allowSurvivors) and fill in src/cli/spec-mutate.ts — see PR gates
  - id: docs-site
    title: "docs: a Scalar site with a generated reference"
    goal: Docs are hosted on Scalar from scalar.config.json, and the reference (commands, file formats, modules) is generated from source by TypeDoc and a generator, and CI keeps it honest
    verification: npm ci && node scripts/gen-reference.mjs --check && node scripts/check-links.mjs
    todos:
      - id: d-scalar
        content: Add scalar.config.json, docs/site (theme and logo), docs/guide/index.md and docs/guide/getting-started — see Docs site
      - id: d-gen
        content: Write scripts/gen-reference.mjs (TypeDoc over src for the modules, the command tree for the CLI, schemas for the file formats) with check mode and the undocumented list that only shrinks — see Docs site
      - id: d-links
        content: Port scripts/check-links.mjs and docs/README.md (writing a guide page), and add .github/workflows/docs.yml — see Docs site
  - id: guide
    title: "docs: the user guide and the skills"
    goal: Everything the old README said that is still true is in the guide, the README points at the site, and the vector-spec skill drives the new command line
    verification: npm run build && node scripts/check-links.mjs && node scripts/gen-reference.mjs --check && node tests/run.mjs guide
    todos:
      - id: u-pages
        content: Write the guide pages (verified functions, vector-lang, writing a spec, the profile, contracts, each spec command, PR gates, install) with compiled examples — see Guide
      - id: u-readme
        content: Rewrite README.md as a short pointer to the site — see Guide
      - id: u-skill
        content: Update .claude/skills/vector-spec to the new command line — see Guide
---

# Rewrite vector in Nish

## Context

vector is about 21k lines of TypeScript on Bun, with about 840 tests, in two tracks:

- **Verified functions** (about 4k lines). The `vector` skill writes a SpecPlan and a Program. `vector --verify` proves them with Z3 and emits guarded TypeScript. `--diff` compares program generations.
- **Spec to contract to Nish test** (about 14k lines). The `vector-spec` skill writes a kramdown-rfc spec. `vector spec extract|check|emit|run|frozen|stale|exports|mutate` turn it into a contract, gate it, and test nish's std against it.

Z3 is a subprocess (`z3 -in`, one script per call). The other external processes are nish, git and `sh -c`. Docs are a 2,181-line README.

The rewrite is a fresh design in Nish, not a line-by-line port. The old code stays readable at the base commit: `git show 06d3cec:src/<path>`. Workers read it for behaviour, edge cases and test cases, not for structure.

## Approach

| Decision | Choice | Why |
|---|---|---|
| Where | In place in amritk/vector. Foundation deletes the TypeScript, and later stages fill the command line back in | One codebase from the first merge. `main` loses features until each stage lands, and that is accepted for a 0.x tool |
| Compiler | nish **0.39.0**, pinned in `scripts/fetch-nish.sh`, installed to `.nish/` with nish's `install.sh`. Bumping it is its own PR | 0.39.0 adds what this tool leans on: `spawnPipedWithin` (a captured run with a deadline), function references in fields, arrays and `Map` values (gate and command tables), typed JSON tagged unions (the `Expr` and clause unions), object spread, and `split` with a limit |
| File formats | `schemas/spec-plan.json`, `program.json` and `rfc-contract.json` are unchanged, and so are the committed specs and contracts | The skills, the committed contracts and nish's `contracts/hex.json` keep working. Asked at sign-off |
| Command line | Subcommands: `vector verify`, `vector diff`, `vector spec <cmd>`. Exit codes stay 0 (pass), 1 (refused), 2 (usage or I/O) | The flag modes were an accident of history |
| Dropped | The 14 language tables and the README render (nothing used them), `--fixture`, `--spec/--program` aliases, the `rfc` alias, the embedded z3 tarball with z3cache and `--licenses`, `scripts/spec-stale.mjs`, mjst-generated code, Bun | Each is unused or exists only because of the Bun binary |
| Float64 gate | Interpret the AST in Nish `f64`. A test runs the emitted TypeScript under node on the same inputs and pins that the two agree | The old gate compiled the emitted code at runtime with `Bun.Transpiler` and `new Function`, which a native binary cannot do |
| Z3 | `$VECTOR_Z3`, then `.z3/z3`, then `z3` on PATH. One process per script, with the whole script on stdin | Same behaviour, with no binary to embed |
| Docs | A Scalar site from `scalar.config.json`, with a reference generated by TypeDoc and a generator, as nish does | The user asked for it |

## Rules carried over from nish

Foundation writes these into `CLAUDE.md`, and every stage follows them from its first commit:

- Commit subjects are conventional (`feat(spec): …`) and become the changelog. `pr-title.yml` checks the PR title.
- Every exported declaration has a doc comment, a `@param` per parameter and a `@returns` for a non-void return. The generated reference fails on a gap, and its undocumented list only shrinks.
- Generated files (`docs/reference/**`, the reference routes in `scalar.config.json`, `contracts/*.json`, `specs/*.xml`) are regenerated, never edited or hand-merged.
- Read a check's exit status, never its piped tail.
- A change a user sees updates its guide page in the same PR (this applies once the guide stage lands).
- Moving where a fact lives moves every pointer to it in the same PR.
- Nish specifics from `docs/AI.md`: function names are unique program-wide, so prefix helpers per module. No `throw`; use `Result`. State lives in a context class, not in module `let`. Run the compiler instead of reasoning about what is legal.

## The command line

`src/main.ts` builds the command tree with `nish/cli-args`. Each command lives in `src/cli/<command>.ts` and exports `register<Command>(cli)`, which declares its own flags and handler. Foundation creates every file as a stub that exits 2 with `not implemented yet`, so that no two stages edit `main.ts`.

| Command | Stage | Behaviour (as today unless noted) |
|---|---|---|
| `vector verify <spec.json> <program.json> [--json] [--emit f]` | verify | PROVEN exits 0, anything else exits 1. `--emit` writes only when PROVEN |
| `vector diff <old.json> <new.json> [--json]` | verify | 0 EQUIVALENT, 1 DIFFERENT or UNDECIDED, 2 invalid |
| `vector spec extract <spec.xml> [-o c.json] [--check]` | extract | Byte-identical canonical output, `file:line` refusals |
| `vector spec check <contract> [--run-sources] [--module f\|--nish-root d] [--format text\|markdown\|json]` | gates | |
| `vector spec emit <contract> -o <test.ts>` | emit | |
| `vector spec run <contract> --nish-root <d> [--format …]` | emit | |
| `vector spec frozen [contracts…] --base <ref>` | pr-gates | |
| `vector spec stale <test.ts> <contract>` | pr-gates | |
| `vector spec exports <contract> --nish-root <d> --base <ref>` | pr-gates | |
| `vector spec mutate <contract> --nish-root <d> --base <ref> [--jobs N --max N]` | pr-gates | |
| `vector --version`, `vector --help` | foundation | |

## Tests and the coverage gate

Nish has no coverage tool, so the 91% line-coverage floor cannot carry over. It is replaced by:

- **Unit tests**: `tests/<area>/**/*_test.ts`, which are Nish programs using `nish/testing` `Suite`, run with `nish run`.
- **CLI golden cases**: `tests/cli/<case>/` with `cmd`, `stdout`, `stderr` (optional) and `exit`, run against `dist/vector`.
- **`npm run tested-exports`** (`scripts/tested-exports.mjs`): fails when an exported function under `src/` is not called by name in any file under `tests/`. It is function-level coverage by reference: weaker than line coverage, but it is a command with an exit code.
- `node tests/run.mjs [filter]` runs every test whose path contains the filter. `npm test` runs them all.
- Fixtures a stage adds live under its own `tests/<area>/` directory, so concurrent stages never write the same path. The existing fixtures move once, by foundation, to `tests/fixtures/` and are read-only afterwards.
- Each stage carries over the behaviours that the old tests pinned for its area (`git show 06d3cec:test/<file>`), as Nish tests or CLI golden cases.

## Foundation

Owns: `src/**` (it deletes all of it, then writes `src/main.ts`, `src/core/**` and the `src/cli/*.ts` stubs), `test/**`, `tests/run.mjs`, `tests/core/**`, `tests/cli/**`, `tests/fixtures/**`, `scripts/*.ts`, `scripts/fetch-nish.sh`, `scripts/fetch-z3.sh`, `scripts/tested-exports.mjs`, `package.json`, `package-lock.json`, `bun.lock`, `tsconfig.json`, `biome.json`, `.gitignore`, `.github/workflows/ci.yml`, `.github/workflows/pr-title.yml`, `.claude/hooks/**`, `.claude/settings.json`, `CLAUDE.md`, `README.md`, `THIRD_PARTY_NOTICES.md`

- `src/core`: files and paths (join, dirname, recursive mkdir, temp dirs; nish has none of these), JSON helpers over `nish/json-value`, hex and sha256, `runProcess(argv, stdin, timeoutMs)` over `spawnPipedWithin`, and `runZ3(script)`, which keeps the `@@Q<i>` echo markers and the s-expression and rational reader from `git show 06d3cec:src/solve/runner.ts` and `smt.ts`.
- `package.json` keeps npm as the task runner: `build`, `test`, `lint` (biome), `tested-exports`. It adds `typedoc` and `typescript` as devDependencies now, so that docs-site does not need to touch the file.
- `ci.yml` has a `check` job: fetch nish and z3, build, `npm test`, lint, tested-exports, and a smoke run of `dist/vector --version`.
- The session hook installs nish and z3 if they are missing, and exports their paths.

## Verify

Owns: `src/verify/**`, `src/cli/verify.ts`, `src/cli/diff.ts`, `tests/verify/**`, `tests/cli/verify-*/**`, `tests/cli/diff-*/**`, `schemas/spec-plan.json`, `schemas/program.json`, `.claude/skills/vector/**`

Reference: `git show 06d3cec:src/{verify.ts,lang/,solve/,emit/,report/,diff.ts}`. The JSON outcome keeps the fields the skill reads: `status`, `feedback`, `items[]` (`function`, `axiomId`, `property`, `issue`, `counterexample`, `hint`), `errors[]`, `message`, `dashboard`, `emittedCode`, `styleWarnings`. The currency fixture proves and its emitted TypeScript matches the README excerpt. The unsat fixture is REFUTED with a counterexample.

## Contract model

Owns: `src/spec/contract/**`, `src/spec/source/**`, `src/spec/check.ts`, `tests/spec/contract/**`, `tests/spec/source/**`, `schemas/rfc-contract.json`

Reference: `contract.ts`, `vocab.ts`, `literals.ts`, `rfctext.ts`, `spectext.ts` and `sources.ts` under `git show 06d3cec:src/rfc/`. `check.ts` exports `checkContract(ctx, contract): CheckReport`, which runs a registered list of gates. Only the shape gate is registered here. It also defines the `Sample` table type that emit consumes.

## Extract

Owns: `src/spec/xml/**`, `src/spec/front/**`, `src/spec/profile/**`, `src/spec/extract.ts`, `src/cli/spec-extract.ts`, `tests/spec/extract/**`, `tests/cli/extract-*/**`, `.github/workflows/spec.yml`, `scripts/build-spec.sh`, `specs/**`, `contracts/**`, `rfcs/**`, `.refcache/**`

Extract calls `checkContract`. It gains the real gates automatically when the gates stage registers them. The proof is that the three committed contracts come out byte for byte. `spec.yml` brings back the old `spec-xml-drift` job and the `extract --check` loop.

## Gates

Owns: `src/spec/gates/**`, `src/spec/sample/**`, `src/spec/report/**`, `src/spec/check.ts` (after contract-model merges), `src/cli/spec-check.ts`, `tests/spec/gates/**`, `tests/cli/check-*/**`

Reference: `gates.ts`, `sample.ts`, `report.ts`, and `run.ts` (for `--run-sources`) under `git show 06d3cec:src/rfc/`. `--run-sources` keeps its 30 s timeout. `spawnPipedWithin` kills only the child pid, so a source command runs under `setsid` with a group kill on timeout (or `timeout -s KILL`, which signals the group), and the guide says what it does and does not contain.

## Emit and run

Owns: `src/spec/emit/**`, `src/spec/run/**`, `src/cli/spec-emit.ts`, `src/cli/spec-run.ts`, `tests/spec/emit/**`, `tests/cli/emit-*/**`

Reference: `emit-nish.ts`, `run.ts` and `scratch.ts`. Emitted tests compile under the pinned nish. A golden test for the hex example contract pins the output. `run` tests use the session's nish checkout when `VECTOR_NISH_ROOT` is set, and skip with a printed reason when it is not.

## PR gates

Owns: `src/spec/pr/**`, `src/cli/spec-frozen.ts`, `src/cli/spec-stale.ts`, `src/cli/spec-exports.ts`, `src/cli/spec-mutate.ts`, `tests/spec/pr/**`, `tests/cli/pr-*/**`

Reference: `gitdiff.ts`, `exports.ts`, `frozen.ts` and `mutate.ts`. Tests build temporary git repositories. Mutate uses a stub nish, as the old tests did.

## Docs site

Owns: `scalar.config.json`, `docs/README.md`, `docs/site/**`, `docs/reference/**`, `docs/guide/index.md`, `docs/guide/getting-started/**`, `scripts/gen-reference.mjs`, `scripts/check-links.mjs`, `scripts/undocumented.txt`, `.github/workflows/docs.yml`

Modelled on nish's `scripts/gen-reference.mjs`, `docs/check-links.mjs`, `scalar.config.json` and `docs/README.md`. Read those and carry their lessons over: a "Do not edit by hand" header, byte-deterministic output, a check mode that fails on stale, missing or extra pages and on stale routes, generated routes limited to the `/reference` subtree, relative links only between routed pages, and anchors that work on both GitHub and Scalar.

The reference has three parts:

1. **Command line**, generated from the `src/cli/*.ts` command definitions.
2. **File formats**, generated from `schemas/*.json`.
3. **Modules**, generated by TypeDoc over `src/**` with nish's `runtime/nish.d.ts` and `nish/*` path mapping, with the doc-comment rule and `scripts/undocumented.txt`.

Hosting goes through Scalar's own GitHub integration, which you connect in Scalar (nish has no publish step in its repo either).

docs-site starts once foundation merges, but it **merges last** among the code stages (a merge-order edge from verify, extract, gates, emit and pr-gates). It then regenerates the reference over the final source, and no other stage has to regenerate it.

## Guide

Owns: `docs/guide/**` (after docs-site merges), `scalar.config.json` (non-reference routes, after docs-site merges), `README.md` (after foundation merges), `.claude/skills/vector-spec/**`, `tests/guide/**`

The old README's content, re-cut into guide pages: verified functions, vector-lang, writing a spec (kramdown-rfc and build-spec.sh), the profile table, contracts and expressions, each spec command, the PR gates, and install (nish, z3, the pinned IETF tools). Examples are compiled or run by `node tests/run.mjs guide`: `nish:ok` fences and `vector` command fences with expected output.

## Dependencies

```mermaid
graph LR
  foundation --> verify
  foundation --> contract-model
  foundation --> docs-site
  contract-model --> extract
  contract-model --> gates
  contract-model --> emit
  contract-model --> pr-gates
  gates -. merge before .-> emit
  emit -. merge before .-> pr-gates
  verify -. merge before .-> docs-site
  extract -. merge before .-> docs-site
  gates -. merge before .-> docs-site
  emit -. merge before .-> docs-site
  pr-gates -. merge before .-> docs-site
  docs-site --> guide
```

A solid arrow blocks the start. A dotted arrow blocks only the merge: emit uses gates' samples end to end, mutate runs emitted tests, and docs-site regenerates the reference last.

## Out of scope

- Release artifacts and a published binary (a follow-up: a release workflow such as nish's).
- Language tables and emitters other than Nish.
- Format changes to the three schemas.
- Changes to nish itself.

## Verification

Each stage's `verification` line. On `main` after the last merge: `npm run build && npm test && npm run lint && npm run tested-exports && node scripts/gen-reference.mjs --check && node scripts/check-links.mjs`, plus the `spec.yml` loop.
