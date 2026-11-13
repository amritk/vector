# Project rules

vector is written in [Nish](https://github.com/amritk/nish), a static subset
of TypeScript compiled ahead of time to a native binary, `dist/vector`. The
compiler is pinned in `scripts/fetch-nish.sh` and lives in `.nish/`; z3 is
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

## Layout

- `src/main.ts` declares the commands, parses the arguments and dispatches.
  It handles `--help` and `--version`; everything else is a command's.
- `src/cli/<command>.ts` exports `register<Command>(cli, parent)`, which
  declares the command's flags and arguments and returns the object whose
  `run(r)` is its handler.
- `src/core/` holds what every command shares: paths and files, JSON, hex
  and SHA-256, child processes, z3, and diagnostics.
- `tests/<area>/*_test.ts` are Nish programs built on `nish/testing`.
  `tests/cli/<case>/` is a golden case: `cmd` (`vector <args>`), `stdout`,
  an optional `stderr`, and `exit`, checked against `dist/vector`.

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
  parameter, and `@returns` when it returns something.
- Exit codes are 0 when a check passed, 1 when vector refused the input, and
  2 for bad usage or an I/O or tool failure (`src/core/diag.ts`).

## Definition of done

Locally, before pushing: `npm run build`, `node tests/run.mjs <filter>` for
every area the change touches, `npm run lint`, and `npm run tested-exports`.
**The full gate is CI** (`.github/workflows/ci.yml`): it builds, runs every
test, lints and smoke-runs the binary on every push.

**Read a check's exit status, never its piped tail.** `npm run lint | tail`
reports success when lint fails. Run it bare, or check `$?` / `PIPESTATUS`.

**Generated files are regenerated, never edited by hand.** That covers
`docs/reference/**` and its routes in `scalar.config.json`, `contracts/*.json`
(extracted from `specs/*.xml`) and `specs/*.xml` (built from `specs/*.md` by
`scripts/build-spec.sh`). Change the source and rerun the generator.

**A change a user sees updates its guide page in the same PR**: a command, a
flag, an exit code, an install step, or a message a guide page shows.

**Moving where a fact lives moves every pointer to it in the same PR.** Grep
the docs, `.claude/`, `CLAUDE.md` and source comments for the old location.

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
