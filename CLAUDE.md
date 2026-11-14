# Project rules

vector is written in [Nish](https://github.com/amritk/nish), a static subset
of TypeScript compiled ahead of time to a native binary, `dist/vector`. The
compiler is pinned in `.nish-version` (read by `scripts/fetch-nish.sh`) and
lives in `.nish/`; z3 is
pinned in `scripts/fetch-z3.sh` and lives in `.z3/`. Before writing Nish,
read `.nish/docs/AI.md` (the language as rules, traps first).

| Command | What it does |
| --- | --- |
| `bash scripts/fetch-nish.sh` | install the pinned compiler into `.nish/` |
| `bash scripts/fetch-z3.sh` | install the pinned z3 into `.z3/` |
| `npm run build` | compile `src/main.ts` to `dist/vector` |
| `node tests/run.mjs <filter>` | the tests whose path contains `<filter>` |
| `npm test` | every `tests/**/*_test.ts`, then every CLI golden case |
| `npm run lint` | biome, over the Nish sources and the Node scripts |
| `npm run tested-exports` | refuse an exported function no test calls by name |
| `npm run dogfood` | refuse a `tests/dogfood/` test that is not what vector emits from its spec now |

## Layout

- `src/index.ts` is the package's entry (`@amritk/vector`, the `nish`
  condition in `package.json`). Its `vectorRun` declares the commands, parses
  the arguments and dispatches; it handles `--help` and `--version`, and
  everything else is a command's. `src/main.ts` is the binary's entry: it
  hands the process's arguments to `vectorRun`.
- `src/cli/<command>.ts` exports `register<Command>(cli, parent)`, which
  declares the command's flags and arguments and returns the object whose
  `run(r)` is its handler.
- `src/core/` holds what every command shares: paths and files, JSON, hex
  and SHA-256, child processes, z3, and diagnostics.
- `tests/<area>/*_test.ts` are Nish programs built on `nish/testing`.
  `tests/cli/<case>/` is a golden case: `cmd` (`vector <args>`), `stdout`,
  an optional `stderr`, and `exit`, checked against `dist/vector`.
- `tests/dogfood/` holds vector's tests of itself, emitted from its own specs
  (`specs/vector-*.md`) with `--package vector=src`. They are generated, so
  regenerate them; never edit them.

## Writing Nish

- **Function names are unique across the program.** Prefix a module's
  functions with its name (`jsonMember`, `z3Timeout`), so two modules never
  collide.
- **Return a `Result`, never throw.** A failure is `Err(message)`; pass it up
  with `.orReturn()`.
- **Keep state in a context class**, passed to the functions that need it,
  not in module-level mutable variables.
- **Run the compiler rather than guess.** When unsure whether something
  compiles or what it does, `.nish/bin/nish run <file>` answers in seconds.
- **Every export has a doc comment**: what it is for, `@param` for each
  parameter, and `@returns` when it returns something. The generated
  reference fails on a gap, and its undocumented list only shrinks.
- Exit codes are 0 when a check passed, 1 when vector refused the input, and
  2 for bad usage or an I/O or tool failure (`src/core/diag.ts`).

## Definition of done

Locally, before pushing: `npm run build`, `node tests/run.mjs <filter>` for
every area the change touches, `npm run lint`, `npm run tested-exports`, and
`npm run dogfood` when the emitter, a `specs/vector-*` spec or its module changed.
**The full gate is CI** (`.github/workflows/ci.yml`): it builds, runs every
test, lints and smoke-runs the binary on every push.

**Read a check's exit status, never its piped tail.** `npm run lint | tail`
reports success when lint fails. Run it bare, or check `$?` / `PIPESTATUS`.

**Generated files are regenerated, never edited by hand.** That covers
`docs/reference/**` and its routes in `scalar.config.json`, `tests/dogfood/**`, `contracts/*.json`
(extracted from `specs/*.xml`) and `specs/*.xml` (built from `specs/*.md` by
`scripts/build-spec.sh`). Change the source and rerun the generator.

**A change a user sees updates its guide page in the same PR**: a command, a
flag, an exit code, an install step, or a message a guide page shows.

**Moving where a fact lives moves every pointer to it in the same PR.** Grep
the docs, `.claude/`, `CLAUDE.md` and source comments for the old location.

## Releasing

Push a tag `v<version>` equal to `package.json`'s version (and `VECTOR_VERSION`
in `src/index.ts`). `.github/workflows/release.yml` calls the reusable
release workflow in [amritk/workflows](https://github.com/amritk/workflows),
pinned by commit, in library mode: it packs `@amritk/vector`, the Nish source
under `src/`, as `npm publish` would, attaches it with `SHA256SUMS` to a GitHub
release, and publishes it to npm. Nothing is built, and no binary ships. A
version with a hyphen (`v1.2.0-rc.1`) is a prerelease, published under npm's
`next` dist-tag. Attestations and npm provenance exist only while the
repository is public. A pull request that touches the release packs the
package without releasing it. Dependabot (`.github/dependabot.yml`) proposes
updates to the pin.

## Commits and PRs

Commits and PR titles are conventional, `type(scope): imperative subject`:

```
fix(cli): exit 2 when the contract cannot be read

What changed, and why this way.
```

- **type**: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`,
  `ci`, `chore`, `style` or `revert`. `pr-title.yml` checks the PR title,
  which a squash merge lands.
- **scope** (optional): the area, such as `cli`, `core`, `spec` or a
  command name.
