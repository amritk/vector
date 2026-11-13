You are implementing one stage of an accepted plan. Work only this stage.

Repo: amritk/vector          Base: main as it is when you start (git fetch origin main; branch from origin/main)
Branch: feature/open-issues-pass/completeness-copies   (already assigned — commit and push here, nothing else)
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
fix(gates): an unmarked copy of a quoted sentence does not need its own quote
Goal: Reproduce whether the completeness gate asks for both copies of a sentence that an unmarked paragraph repeats, and if it does, let the gate tell the copies apart.
Owns (do not create or edit files outside these globs): `src/spec/gates/completeness.ts`, `tests/spec/gates/completeness_test.ts`, `tests/spec/gates/fixtures/**`, `src/spec/xml/**`, `tests/fixtures/normative-line/**`
Verification: npm run build && node tests/run.mjs spec/gates && node tests/run.mjs spec/extract && npm run lint && npm run tested-exports
Targeted tests: node tests/run.mjs <filter> (the tests whose path contains <filter>; golden CLI cases are tests/cli/<case>/)

Todos (line numbers are from main e6e6565 and may have moved; re-find them, do not trust them blindly):
- #46-3, reported against the old TypeScript code: "Completeness on an XML main source asks for both copies of a sentence to be quoted when an unmarked paragraph repeats a marked one. This fails closed, never as a false pass. xmlv3 could expose which line each `normative` entry came from, so the gate can tell the two copies apart." The gate is now src/spec/gates/completeness.ts: each BCP 14 use in a section must lie inside a requirement or exclusion quote. Reproduce it first. Write a completeness test (on an XML main source, the way existing completeness tests and tests/fixtures/normative-line build theirs) where a BCP 14 sentence is quoted by a requirement once and the identical sentence appears again in an unmarked paragraph of the same section. Record what the gate does today.
- If it reproduces (the gate demands a second quote), carry each normative entry's source line (or position) from the XML reader (src/spec/xml) so the gate can match the quoted copy to the right occurrence and accept the unmarked repeat. Keep it failing closed everywhere else: a BCP 14 sentence that appears ONLY in an unmarked paragraph must still be refused. Pin both. If the fix would need files outside your Owns (for example src/spec/profile or src/spec/extract.ts), stop, push what you have, and open the PR as a draft that says exactly what is needed.
- If it does not reproduce, the PR is the pinning test alone, plus a sentence in the PR body that says why (which code already tells the copies apart).
- Decide what "an unmarked paragraph" means in the current profile (read docs/guide/guides/writing-a-spec.md) and state it in the test's comment.

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
- Send the lead exactly two messages, one line each, with `send_message` to `@parent`: `completeness-copies branch up <sha>` after your first push, and `completeness-copies PR #<n> open` when the PR exists. After that send nothing — not CI results, not progress, not "over to you".
- Do not merge main into your branch whenever it moves. Merge it when the PR conflicts, or when the lead tells you to update from it before merging. Then regenerate the generated files with the repo's tooling, run the full suite once, and push.

## Rules
- Push only to your own branch. Never push to main, never touch another feature/open-issues-pass/* branch, never force-push.
- If CI goes red or a test fails, run /debug — reproduce it before you change anything. If that command is not available, follow the same order anyway: reproduce, localise, one hypothesis at a time, then pin the fix with a test.
- When unsure whether some Nish compiles or what it does, `.nish/bin/nish run <file>` answers in seconds. Run it rather than guess.
- If your stage turns out to be impossible as written, push what you have, open the PR as a draft, and say exactly what blocked you in the PR body. Do not substitute different work and do not widen your scope to fix it.
- You will get review comments as a single batch. Address every blocking one in one push, then stop. For each blocking finding, fix every instance of the same rule across your diff, not only the cited line, and say in the PR body how many you checked. Non-blocking ones go in that same push when they are cheap; never push for them alone. Keep the PR body accurate, but do not rewrite it unless a round says it is wrong. Do not reply to argue; if a finding is wrong, say so in one line on that thread and move on.
