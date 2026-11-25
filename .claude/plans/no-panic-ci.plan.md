---
name: Hold vector to the no-panic rule in CI
overview: One CI job builds vector and every Nish test it emits for its own contracts and fixtures with the latest nish release, under its default no-panic rule, and fails listing each unproven site. A check refuses `--allow-panics` anywhere in scripts/, .github/, docs/ and src/, except in text that says it is refused. The guide and docs/AI.md say the compiler builds the test as it is and refuses a module under test that may panic.
stages:
  - id: no-panic-job
    title: "ci: hold vector and its emitted tests to the no-panic rule of the latest nish"
    goal: A `no-panic` CI job and an `--allow-panics` refusal check, each runnable locally, with the guide and docs/AI.md saying what refuses a module that may panic.
    verification: npm run build && npm run lint && npm run doc-caps && node --test scripts/allow-panics.test.mjs scripts/no-panic.test.mjs && npm run allow-panics && node tests/run.mjs guide
    todos:
      - id: no-panic-script
        content: "Add scripts/no-panic.mjs (npm run no-panic): given a nish binary (NISH_BIN, default .nish/bin/nish), build src/main.ts with no relax flag and --emit-panics; emit every contract under contracts/ and tests/fixtures/**/contracts/ (skipping *.survivors.json) with dist/vector spec emit ... --package vector=src; compile each emitted test with no relax flag and --emit-panics. Fail (exit 1) listing every site as file:line:col kind, read from the compiler's own refusal diagnostics (nish 0.47.0 writes no --emit-panics report when it refuses the build) and from the report when it does write one (any unproven site whose kind is not out-of-memory)."
        status: pending
      - id: no-panic-skips
        content: "In scripts/no-panic.mjs, a contract spec emit refuses (exit 1, fixtures built to be refused) and an emitted test whose import no std module or --package provides are listed as skipped with the reason, never failed and never silently dropped; spec emit exit 2 or a compile failure that is not a panic refusal fails the job; zero tests compiled fails the job. Print counts: built, emitted, compiled, skipped."
        status: pending
      - id: no-panic-tests
        content: "Add scripts/no-panic.test.mjs (node --test), table-driven over the parsing and classification in no-panic.mjs: a refusal diagnostic per panic kind, an OOM-only report passing, an unproven non-OOM report entry failing, a missing-module error classed as skipped, any other compile error failing, emit exit 1 vs exit 2. Delete or flip each condition and confirm a row fails."
        status: pending
      - id: allow-panics-check
        content: "Add scripts/allow-panics.mjs (npm run allow-panics) that fails, naming file:line, on the flag `--allow-panics` in any tracked file under scripts/, .github/, docs/ and src/. A line is exempt only when it says the flag is refused (it contains `refuse`) AND it cannot run it: a comment line in scripts/, .github/ and src/, a prose line outside any code fence in docs/. A code-fence or run: line is never exempt. Build the pattern without the literal so the script and its test do not match themselves."
        status: pending
      - id: allow-panics-test
        content: "Add scripts/allow-panics.test.mjs (node --test): it fails on a planted flag in a workflow run: line, a shell script command, a src string, a docs sh fence (including one whose line says refused), and passes on a docs prose line and a script comment that say it is refused; neighbours both sides of each exemption rule."
        status: pending
      - id: ci-job
        content: "In .github/workflows/ci.yml add a `no-panic` job (pinned actions, same LLVM setup as `check`) that resolves the latest amritk/nish release tag (git ls-remote --tags, highest semver, not .nish-version), installs it with NISH_VERSION=<it> bash scripts/fetch-nish.sh, fetches the pinned z3, runs npm ci, npm run build with the pinned nish (to get dist/vector), then npm run no-panic with NISH_BIN at the latest install. Print the resolved version. In the existing `check` job, run npm run allow-panics and node --test scripts/allow-panics.test.mjs scripts/no-panic.test.mjs."
        status: pending
      - id: docs
        content: "Update docs/guide/guides/testing.md (the nish root section) and docs/guide/guides/pr-gates.md (### The compiler), and docs/AI.md: a nish root's compiler builds the emitted test as it is, with no relax flag; a module under test that may panic is refused, and say which part refuses it (the nish compiler, when it builds the test, with its NL code), and what vector then reports. Any example the pinned nish cannot reproduce is marked <!-- illustrative -->. docs/AI.md is 2 bytes under its cap: shorten in place, never raise the cap."
        status: pending
      - id: red-proof
        content: "Prove the job red and say so in the PR body: on today's main the latest nish refuses vector's own build (2021 sites at 0.47.0); and locally, with the two companion features absent, plant one unguarded index in an emitter template that a compiled test uses and show no-panic.mjs lists that site in the emitted test. Push no planted change."
        status: pending
---

# Hold vector to the no-panic rule in CI

## Context

vector pins nish 0.39.0 (`.nish-version`), which does not enforce no-panic.
The latest release, v0.47.0, refuses an unproven panic site by default
(`--deny-panics`); `--allow-panics` relaxes it, and its own help says never
to use it. Two companion features make vector conform: "the emitted nish
tests conform to the default no-panic rule" and "vector's own source conforms
to the no-panic rule of the latest nish". Neither is on main yet. This job is
what keeps them true.

Measured on main at b94f92a with nish 0.47.0:

- `nish src/main.ts --link …` refuses with 2021 errors (`index`, `overflow`,
  …, "may panic here"). With the build refused, `--emit-panics <file>`
  writes no file, so the sites are read from the diagnostics.
- Of 74 contracts (6 under contracts/, 68 under tests/fixtures, minus
  survivors files), `spec emit` writes 25 and refuses 49 (fixtures built to be
  refused, and `vector-*` contracts without `--package vector=src`).
- Of the 25 emitted, the std ones (hkdf, chacha20-poly1305, base64, deflate,
  checksum-window, scope-*) are refused for panic sites in the emitted code
  (7–20 each); the rest import a module no std or package provides
  (`nish/hex`, `nish/aq`, `nish/quic/varint`, …).

## no-panic-job

**Owns:** `.github/workflows/ci.yml`, `scripts/no-panic*`, `scripts/allow-panics*`, `scripts/fetch-nish.sh`, `package.json`, `docs/guide/guides/testing.md`, `docs/guide/guides/pr-gates.md`, `docs/AI.md`

One stage: the job, the check, and the docs a user reads about them land
together (CLAUDE.md: a change a user sees updates its guide page and
docs/AI.md in the same PR).

- The logic lives in scripts, so the job is reproducible locally with
  `NISH_BIN=<latest>/bin/nish npm run no-panic`.
- The job stays red on main until both companion features land; that is the
  point. This PR touches `.github/workflows/**`, so the merge gate escalates
  it for a human merge in any case, and it should merge only after the
  companions.
- `--emit-panics` is passed on every compile, so a future nish that reports
  rather than refuses a site still fails the job.
- The guide's examples run against the pinned nish (tests/guide), so a
  refusal the pinned compiler cannot show is `<!-- illustrative -->`.
- CLAUDE.md is 7 bytes under its cap and not owned; its command table is not
  updated here.

## Approach

Fixture contracts that `spec emit` refuses, and emitted tests whose module
exists nowhere, are skipped with their reason, so the job checks every test
that can be built, lists the rest, and fails when nothing compiles.

## Out of scope

Fixing any panic site in vector or its emitter (the companion features), and
bumping `.nish-version`.
