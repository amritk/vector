# Worker rules for the nish-rewrite run

Every stage worker reads this file in full, together with the plan
(`nish-rewrite.plan.md`, on the same branch). Your spawn prompt names your
stage, its Owns globs, its todos and any stage-specific notes. This file
holds everything that is the same for every stage. Where the repo's
`CLAUDE.md` disagrees with this file, `CLAUDE.md` wins.

Tracking issue: #62. Repo: amritk/vector. Default branch: `main`.

## Commands

| What | Command |
| --- | --- |
| Install the toolchain (the session hook normally does this) | `bash scripts/fetch-nish.sh && bash scripts/fetch-z3.sh && npm ci` |
| Build | `npm run build` (writes `dist/vector`) |
| Targeted tests | `node tests/run.mjs <filter>`, which runs every test whose path contains the filter |
| Full suite | `npm test` |
| Coverage gate | `npm run tested-exports`: every exported function under `src/` must be called by name from a `tests/**/*_test.ts` |
| Lint | `npm run lint` |

Reproducing CI. Each CI job, and the local command that runs what it runs:

| CI job | Local command |
| --- | --- |
| `check` (ci.yml) | `npm ci && npm run lint && npm run tested-exports && npm run build && npm test && ./dist/vector --version` |
| `conventional` (pr-title.yml) | the PR title must match `type(scope): imperative`, e.g. `feat(spec): …` |
| `spec.yml` (once the extract stage adds it) | `bash scripts/build-spec.sh --check specs/*.md`, then `for f in specs/*.xml; do ./dist/vector spec extract "$f" -o "contracts/$(basename "$f" .xml).json" --check; done` |
| `docs.yml` (once the docs-site stage adds it) | `node scripts/gen-reference.mjs --check && node scripts/check-links.mjs` |

Validate any workflow file you touch with
`python3 -c 'import yaml,sys;[yaml.safe_load(open(f)) for f in sys.argv[1:]]' .github/workflows/*.yml`.
A step name containing `: ` breaks the whole file, so quote it.

Known environment failures: none recorded.

Generated files (`contracts/*.json`, `specs/*.xml`, `docs/reference/**`, and
the `/reference` routes in `scalar.config.json`) are regenerated with the
repo's tooling. Never edit them by hand, and never merge them by hand.

## Writing Nish

- The language reference is the nish checkout at `../nish`, or the installed
  `.nish/docs/AI.md`. Read `docs/AI.md` first (what you must unlearn), then the
  `docs/guide/` pages you need. Builtins are in `.nish/runtime/nish.d.ts`, and
  the library is in `.nish/std/`.
- Run the compiler instead of reasoning about what is legal.
- Function names are unique program-wide. Prefix helpers per module.
- 0.39.0 adds features this rewrite should use:
  - function references in fields, arrays, `Map` values and arguments, for
    tables of gates and handlers;
  - typed JSON tagged unions (`jsonDecodeUnion`);
  - object spread;
  - `split` with a limit;
  - `spawnPipedWithin`.
- Every exported declaration has a doc comment, with a `@param` per parameter
  and a `@returns` for a non-void return. The generated reference fails on a
  gap.
- The old Bun implementation is a behavioural reference only. Read it with
  `git show 06d3cec:src/<path>` and `git show 06d3cec:test/<file>`. Carry
  over the behaviours its tests pinned for your area, as Nish tests or as
  CLI golden cases. Design fresh; do not port line by line.

## What foundation already gives you

- **Commands.** Each command lives in its own `src/cli/<command>.ts`, which
  exports a `*_ID` const, `register<Command>(cli, parent)` and a command
  class whose `run(r: ParseResult): i32` is the handler.
  - Replace your stub by editing only your own file, and keep those three
    names.
  - Then `src/main.ts` and `tests/cli/register_test.ts` need no edit.
  - You may add flags inside your file.
- **`src/core`** provides:
  - paths and files, JSON, hex and SHA-256;
  - diagnostics with exit codes 0, 1 and 2;
  - `runProcess(argv, stdin, timeoutMs)`;
  - `runZ3(script, queryCount)`, which returns a `Z3Run` with per-query
    verdicts, models and `errors` (every `(error …)` line).
  - Model names must match `[A-Za-z_][A-Za-z0-9_]*`. Mangle yours into that
    alphabet.
- **Tests and fixtures.**
  - Golden cases live in `tests/cli/<case>/`, with `cmd`, `stdout`, an
    optional `stderr` (absent means stderr must be empty) and `exit`.
  - Put yours only under your own `tests/cli/<area>-*/` prefix.
  - The old fixtures are in `tests/fixtures/` and are read-only. Put new
    fixtures under your own `tests/<area>/`.

## Definition of done

1. The stage's todos are implemented, and nothing outside your Owns globs
   changed.
2. `npm test`, the full suite, passes on your PR's head. CI runs it on every
   push, so open the PR on targeted tests and let CI's run be the full one.
   A red result comes back to you with the round's review.
3. `npm run tested-exports` passes. Do not weaken the script, add
   exemptions, or skip a test. CI's run is the one that counts.
4. `npm run lint` and `npm run build` pass, and so does every CI job's local
   command above that your diff could affect.
5. Before you open the PR, run `/check-iterate --max-loops 2` and fix what it
   confirms. Do not loop until it is clean. If that command is not available
   in your session, review your own diff against `main` adversarially, once,
   and fix what you find.
6. Then run `/simplify` over the same diff and apply what it returns. If that
   command is not available, re-read your diff for reuse and dead
   scaffolding. Then run the targeted tests, lint and build once. This pass
   never changes behaviour and never widens your Owns globs.
7. Open a PR from your branch to `main`. The title is your stage title. The
   body says what changed and why, gives the verification commands you ran
   with their results, and ends with `Part of #62`.

## Running tests without burning the session

- Do not run the full suite unless the lead tells you to update from `main`.
  Every other time, run `node tests/run.mjs <filter>` for what you changed,
  plus lint and build.
- Commit before you start a long run.
- Push your branch with a WIP commit within 30 minutes of starting. A session
  with no branch at 45 minutes gets checked on.
- After that, push when you open the PR and once per review batch, nowhere in
  between. If a stop hook complains about unpushed work, answer it in one
  line and end the turn.
- Keep fetched plan or prompt files in `$TMPDIR`, never under `.claude/`.
- Read CI job logs with grep or tail on a saved file. Never print them inline.
- Start a long run once, in the background, with its output redirected to a
  file, then end your turn. Never poll it.
- Do not call `subscribe_pr_activity` or `send_later`. The lead holds the PR
  subscription.
- Send the lead exactly two messages, one line each, with `send_message` to
  `@parent`:
  1. `<stage-id> branch up <sha>` after your first push;
  2. `<stage-id> PR #<n> open` when the PR exists.

  After that, send one line per push that answers a review batch or a red
  check, and nothing else.
- Do not merge `main` into your branch unless the PR conflicts or the lead
  tells you to update. Then regenerate generated files, run the full suite
  once, and push.

## Rules

- Push only to your own branch. Never push to `main`, never touch another
  `feature/nish-rewrite/*` branch, and never force-push.
- If CI goes red or a test fails, run `/debug`: reproduce it before you change
  anything.
- If your stage turns out to be impossible as written, push what you have,
  open the PR as a draft, and say exactly what blocked you. Do not substitute
  different work, and do not widen your scope.
- Review comes as one batch per round.
  - Address every blocking finding in one push. Fix every instance of the
    same rule across your diff, and say in the PR body how many you checked.
  - Fold the cheap non-blocking findings into that same push.
  - Do not reply to argue. If a finding is wrong, say so in one line on that
    thread.
