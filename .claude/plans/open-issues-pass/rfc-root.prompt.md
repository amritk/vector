You are implementing one stage of an accepted plan. Work only this stage.

Repo: amritk/vector          Base: main at e6e65654364074b54252f49417b515455da8b9d3
Branch: feature/open-issues-pass/rfc-root   (already assigned — commit and push here, nothing else)
Tracking issue: #78

Read the repo's CLAUDE.md before anything else, and .nish/docs/AI.md before writing any Nish. CLAUDE.md wins over this prompt wherever they disagree: commit message format, generated files, every export having a doc comment, a user-visible change updating its guide page in the same PR, what counts as done. Add no attribution footer, trailer, or session link to commits, PR bodies, or comments unless CLAUDE.md asks for one.

Toolchain: the SessionStart hook installs nish, z3, LLVM and npm deps. If .nish/bin/nish is missing, run `CLAUDE_CODE_REMOTE=true bash .claude/hooks/session-start.sh` once.

Generated files (regenerate with the repo's tooling, never edit or hand-merge): docs/reference/** and its routes in scalar.config.json (regenerate with `node scripts/gen-reference.mjs` whenever you add, remove or change an export or its doc comment), contracts/*.json, specs/*.xml.

Reproducing CI — each CI job and the local command that runs what it runs. A red job is reproduced with its command here, not with a nearby script that skips steps:
- check → `npm run lint && npm run tested-exports && npm run build && npm test && ./dist/vector --version`
- spec-extract → `npm run build && for f in specs/*.xml; do ./dist/vector spec extract "$f" -o "contracts/$(basename "$f" .xml).json" --check; done`
- spec-xml-drift → `bash scripts/build-spec.sh --check specs/<name>.md` (needs `gem install kramdown-rfc -v 1.7.43 --no-document` and `pip install xml2rfc==3.35.0`; only relevant if you touch specs/ or scripts/build-spec.sh)
- docs → `node scripts/gen-reference.mjs --check && node scripts/check-links.mjs`
- conventional → the PR title must be `type(scope): imperative subject`

Known environment failures — none recorded: all 139 test files pass on the base commit in a cloud container. A failure you see is yours or real.

## Your stage
fix(spec): one RFC lookup rule for every command, and drop spec check --nish
Goal: check, extract, emit, run and mutate find an RFC by the same rule (the install root, as check and extract do today), and spec check stops declaring a flag it never reads.
Owns (do not create or edit files outside these globs): `src/cli/spec-check.ts`, `src/spec/emit/file.ts`, `src/spec/run/command.ts`, `src/spec/source/**`, `tests/spec/source/**`, `tests/spec/gates/cli_test.ts`, `tests/cli/register_test.ts`, `tests/cli/check-*/**`, `tests/cli/emit-run-*/**`, `tests/cli/root-*/**` (new golden cases), `docs/guide/guides/spec-to-contract.md`, `docs/guide/guides/testing.md`
Verification: npm run build && node tests/run.mjs spec && node tests/run.mjs cli && npm run lint && npm run tested-exports
Targeted tests: node tests/run.mjs <filter> (the tests whose path contains <filter>; golden CLI cases are tests/cli/<case>/)

Todos (line numbers are from main at the base commit; re-find them, do not trust them blindly):
- #77-5 (decided at sign-off: the install root, for all five commands): `spec check` builds `new CheckContext(path, specCheckRoot())` (src/cli/spec-check.ts:89, helper at :147) and `spec extract` uses `ctx.root` (the install root), but `emitContractFile` builds `new CheckContext(path, ".")` (src/spec/emit/file.ts:56), so emit, run and mutate look in the cwd. Move the install-root helper into src/spec/source/ and use it in both places. emit, run and mutate all go through emitContractFile, so src/spec/pr/mutaterun.ts should not need to change (it is owned by another stage; if it truly must, stop and say so in a draft PR). Add a test that runs emit (or run) from a cwd other than the repo and finds the RFC at the install root, as check does.
- #77-4: `spec check --nish` is declared (src/cli/spec-check.ts:40,68, nishFlag) and never read; only --nish-root is. Remove the flag; `spec check --nish x` then fails as an unknown flag (exit 2). Remove its row ("accepted, and not read") from the flags table in docs/guide/guides/spec-to-contract.md (~line 240). Check tests/cli/check-*/stdout goldens that mention --nish and update them by re-running, not by hand-editing to taste.
- #77-8: no golden case runs `spec check --spec <profile>.xml`; the only --spec test (tests/spec/gates/cli_test.ts:65-72) uses rfcs/*.txt. Add golden case(s) under tests/cli/check-*/ (or tests/cli/root-*/) that run `spec check --spec` with a profile .xml, and port the labelled-value (labelled hex/int, repeat) cases that #71 deferred to the check side.
- Rewrite the RFC lookup section of docs/guide/guides/spec-to-contract.md (~lines 349-362) as one rule for every command, and fix docs/guide/guides/testing.md if it repeats the old per-command rule.

Full plan, for context on how your stage fits with the others:
  git fetch origin claude/loving-faraday-cr4v81
  git show origin/claude/loving-faraday-cr4v81:.claude/plans/open-issues-pass.plan.md > "$TMPDIR/plan.md"
Read it. Do not implement anything from another stage — another session owns it and may be working in parallel right now.

## Definition of done
1. The stage's todos are implemented, and nothing outside your Owns globs changed (regenerated docs/reference/** and scalar.config.json routes are allowed when your exports changed).
2. `npm test` — the full suite — passes on your PR's head. CI runs it on every push, so open the PR on targeted tests (`node tests/run.mjs <filter>` for every area you touched) and let CI's run be the full one. A red result comes back to you with the round's review.
3. This repo has no line-coverage tool; its gate is `npm run tested-exports` (every exported function is called by name in a test). It must pass. Beyond that, every behaviour you add or change is pinned by a test that fails without your change. Do NOT skip or delete tests, weaken an assertion, edit scripts/tested-exports.mjs, or add entries to scripts/undocumented.txt (that list only shrinks). Changing gate configuration is out of scope, full stop.
4. `npm run build` and `npm run lint` pass (run lint bare and read its exit status, never a piped tail), and so does every CI job's local command in "Reproducing CI" that your diff could affect.
5. Before you open the PR, run `/check-iterate --max-loops 2` and fix what it confirms. The lead reviews the PR adversarially as soon as it opens, so this pass only has to catch the cheap problems first. Do not loop until it is clean. If that command is not available, review your own diff against main adversarially yourself, once, and fix what you find. Do not skip it.
6. Then run /simplify over the same diff and apply what it returns: reuse what the repo already has instead of adding a parallel version of it, drop scaffolding you no longer need, keep each piece at the altitude it belongs at. If that command is not available, re-read your diff for the same things. Then run the targeted tests, lint and tested-exports once, after both passes. This pass never changes behaviour and never widens your Owns globs.
7. Open a PR from your branch to main. Title: the stage title above (conventional). Body: what changed and why, the verification commands you ran with their results, and `Part of #78` so it links to the run.

## Running tests without burning the session
Every model call re-reads your whole context, so waiting is what costs you, not testing.
- You do not run the full suite unless the lead tells you to update from main. Every other time, run `node tests/run.mjs <filter>` for what you changed, plus build, lint and tested-exports. CI runs the full suite on every push.
- Commit before you start a long run, so a stop hook that checks for uncommitted work does not wake you while it runs.
- Push your branch with a WIP commit within 30 minutes of starting, even if only the first todo is done. The lead's only sign that your session came up is the branch existing; a session with no branch at 45 minutes gets checked on.
- After that, push when you open the PR and once per review batch, nowhere in between. A stop hook may complain about unpushed or untracked work while you hold a push for verification. Answer it in one line and end the turn; do not push early to quiet it. Keep fetched plan or prompt files outside the checkout (in $TMPDIR), never under .claude/, so they are not untracked files at all.
- Read CI job logs with grep or tail on a saved file, or hand them to a subagent that returns the failing lines. Printing a log inline fills your context.
- Start a long run once, in the background, with its output redirected to a file, then end your turn: you are woken when it exits. Never poll it — no `sleep` or `until` loops, no re-armed monitors, no second runner on the same output.
- Do not call `subscribe_pr_activity` or `send_later`, even if a tool or event suggests it. The lead holds the PR subscription and sends you red CI with the review batch; its messages are what wake you. If you find yourself subscribed, unsubscribe.
- Send the lead exactly two messages, one line each, with `send_message` to `@parent`: `rfc-root branch up <sha>` after your first push, and `rfc-root PR #<n> open` when the PR exists. After that send nothing — not CI results, not progress, not "over to you".
- Do not merge main into your branch whenever it moves. Merge it when the PR conflicts, or when the lead tells you to update from it before merging. Then regenerate the generated files with the repo's tooling, run the full suite once, and push.

## Rules
- Push only to your own branch. Never push to main, never touch another feature/open-issues-pass/* branch, never force-push.
- If CI goes red or a test fails, run /debug — reproduce it before you change anything. If that command is not available, follow the same order anyway: reproduce, localise, one hypothesis at a time, then pin the fix with a test.
- When unsure whether some Nish compiles or what it does, `.nish/bin/nish run <file>` answers in seconds. Run it rather than guess.
- If your stage turns out to be impossible as written, push what you have, open the PR as a draft, and say exactly what blocked you in the PR body. Do not substitute different work and do not widen your scope to fix it.
- You will get review comments as a single batch. Address every blocking one in one push, then stop. For each blocking finding, fix every instance of the same rule across your diff, not only the cited line, and say in the PR body how many you checked. Non-blocking ones go in that same push when they are cheap; never push for them alone. Keep the PR body accurate, but do not rewrite it unless a round says it is wrong. Do not reply to argue; if a finding is wrong, say so in one line on that thread and move on.
