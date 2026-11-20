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
| `npm run doc-caps` | refuse an agent-facing doc over its byte cap in `scripts/doc-caps.json` |

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
  an optional `stderr`, and `exit`, checked against `dist/vector`. An
  optional `repo` names a `tests/fixtures/<name>/` with `base/` and `head/`
  trees: the runner commits them into a throwaway git repository (`main` =
  base, `work` = head), which `{{repo}}` names in `cmd` and `<repo>` in the
  output.
- `tests/dogfood/` holds vector's tests of itself, emitted from its own specs
  (`specs/vector-*.md`) with `--package vector=src`.

## Writing Nish

- **Function names are unique across the program.** Prefix a module's
  functions with its name (`jsonMember`, `z3Timeout`), so two modules never
  collide.
- **Return a `Result`, never throw.** A failure is `Err(message)`; pass it up
  with `.orReturn()`.
- **Keep state in a context class**, passed to the functions that need it,
  not in module-level mutable variables.
- **Run the compiler rather than guess.** Whether something compiles, and
  what it does, `.nish/bin/nish run <file>` answers in seconds.
- **Every export has a doc comment**: what it is for, `@param` for each
  parameter, and `@returns` when it returns something. The generated
  reference fails on a gap, and its undocumented list only shrinks.
- Exit codes are 0 when a check passed, 1 when vector refused the input, and
  2 for bad usage, an I/O or tool failure, or a `MISMATCH`, a vector bug
  (`src/core/diag.ts`).

## Definition of done

Locally, before pushing: `npm run build`, `node tests/run.mjs <filter>` for
every area the change touches, `npm run lint`, `npm run tested-exports`, and
`npm run dogfood` when the emitter, a `specs/vector-*` spec or its module changed,
and `npm run doc-caps` when an agent-facing doc changed. A doc over its cap is
shortened in place; a cap is never raised or dropped, and CI refuses either.
**The full gate is CI** (`.github/workflows/ci.yml`, on every push).

**Read a check's exit status, never its piped tail.** `npm run lint | tail`
reports success when lint fails. Run it bare, or check `$?` / `PIPESTATUS`.

**A new rule, refusal or flag lands with a test that fails without it.** A
golden that only shows a flag is accepted, or a unit test that sets the
option directly, does not count: drive it through `vectorRun` or the binary
and assert its effect. For a parser or gate rule, test its neighbours too
(table-driven), not just the case that motivated it. An op every emitter
implements runs in each language on a broken implementation and on fixed
values: round trips pass when both directions are wrong the same way.

**A gate that accepts a value on another clause's word computes it, never
assumes it.** When a rule takes one clause's printed value as what another
clause's expression denotes (a sibling vector's result standing in for a
property's sub-call), evaluate that expression with the sampler's semantics
and refuse every form it does not compute: a truncated, iterated or
toleranced value, or `unwrap` of a `null`, is not `g(args)`. Every condition
such a rule adds lands with a test shown to fail when that condition is
deleted.

**A gate rule that reads an RFC's layout (a block, a grid, a dump) is tested
on text that goes through `rfcParse` with real `[Page N]` footers and `\f`
headers.** The tests cover a value on each side of a page break, and two
separate blocks split only by one. A boundary rule tested without that page
text passes even with the rule removed.

**Generated files are regenerated, never edited by hand.** That covers
`docs/reference/**` and its routes in `scalar.config.json`, `tests/dogfood/**`, `contracts/*.json`
(extracted from `specs/*.xml`) and `specs/*.xml` and fixture `.xml` (built from
their `.md` by `scripts/build-spec.sh`). Change the source and rerun the generator.
`CHANGELOG.md` and every version bump are release-please's: never edit the
version or the changelog by hand.

**A change a user sees updates its guide page and `docs/AI.md` in the same PR**:
a command, a flag, an exit code, an install step, or a message a guide page
shows.

**Moving where a fact lives moves every pointer to it in the same PR.** Grep
the docs, `.claude/`, `CLAUDE.md` and source comments for the old location.

## Releasing

Releases are cut by [release-please](https://github.com/googleapis/release-please),
through the reusable workflows in [amritk/workflows](https://github.com/amritk/workflows)
that `.github/workflows/release.yml` calls, pinned by commit:

1. Every push to `main` updates one open **release PR**. It bumps
   `package.json`, `package-lock.json`, `VECTOR_VERSION` in `src/index.ts`
   and the version test in `tests/package/index_test.ts` (each line marked
   `x-release-please-version`), the `vector --version` and `--help` output
   in `README.md` and the installation guide (between
   `x-release-please-start-version` and `x-release-please-end`), and
   `CHANGELOG.md`, from the conventional commits since the last release.
   Nothing else may hold the version: a golden writes it `{{version}}`, and
   the generated reference leaves out a marked value. A release commit that
   leaves CI red on `main` means a copy was missed.
2. Merging the release PR tags `v<version>`, creates the GitHub release, and
   starts `release.yml` on the tag.
3. That run packs `@amritk/vector` (the Nish source under `src/`, as
   `npm publish` would), attaches it with `SHA256SUMS` to the release, and
   publishes it to npm. Nothing is built, and no binary ships.

Config is `.github/release-please-config.json`, with the current version in
`.github/.release-please-manifest.json`; the release workflow checks both on
every pull request that touches the release. A version with a hyphen
(`1.2.0-rc.1`) is a prerelease, published under npm's `next` dist-tag.
Attestations and npm provenance exist only while the repository is public.
Dependabot (`.github/dependabot.yml`) proposes updates to the pin once a
release is 5 days old.

The release PR is opened with `GITHUB_TOKEN`, so CI does not run on it;
close and reopen it to run the checks before merging.

npm publishes through trusted publishing alone: no npm token is stored
anywhere. The trusted publisher for `@amritk/vector` on
npmjs.com names repository `amritk/vector`, workflow file `release.yml` and
environment `npm`, which is limited to `v*` tags in Settings, Environments.

## Commits and PRs

Commits and PR titles are conventional, `type(scope): imperative subject`:

```
fix(cli): exit 2 when the contract cannot be read

What changed, and why this way.
```

- **type**: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`,
  `ci`, `chore`, `style` or `revert`. `pr-title.yml` checks the PR title,
  which a squash merge lands. release-please reads it to pick the next
  version (`fix` a patch, `feat` a minor, `!` or a `BREAKING CHANGE`
  footer a major, which is a minor before 1.0), and
  `feat`, `fix`, `perf`, `refactor` and `revert` reach the changelog. A
  feature merged as `chore` ships without a bump.
- **scope** (optional): the area, such as `cli`, `core`, `spec` or a
  command name.
