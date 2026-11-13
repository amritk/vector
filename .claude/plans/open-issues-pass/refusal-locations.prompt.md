You are implementing one stage of an accepted plan. Work only this stage.

Repo: amritk/vector          Base: main as it is when you start (git fetch origin main; branch from origin/main)
Branch: feature/open-issues-pass/refusal-locations   (already assigned — commit and push here, nothing else)
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
fix(extract): refusals point at the right file, line and column
Goal: A refusal prints its column when it has one, never cites a markdown line it cannot vouch for, and cites second lines in the same file as its prefix.
Owns (do not create or edit files outside these globs): `src/core/diag.ts`, `src/cli/spec-extract.ts`, `src/spec/extract.ts`, `src/spec/xml/**`, `src/spec/profile/**`, `tests/core/diag_test.ts`, `tests/spec/extract/**`, `tests/cli/extract-*/**`, `tests/fixtures/xmlv3/**`, `tests/fixtures/kramdown/**`, `tests/fixtures/profile/**`, `docs/guide/guides/spec-to-contract.md`, `docs/guide/guides/exit-codes.md`
Verification: npm run build && node tests/run.mjs spec/extract && node tests/run.mjs core && node tests/run.mjs extract- && node tests/run.mjs guide && npm run lint && npm run tested-exports
Targeted tests: node tests/run.mjs <filter> (the tests whose path contains <filter>; golden CLI cases are tests/cli/<case>/)

Todos (line numbers are from main e6e6565 and may have moved; re-find them, do not trust them blindly):
- #53-A: `ProfileRefusal` carries a `col` (src/spec/profile/profile.ts ~79-93), and the literal parser computes one for a malformed literal cell (for example `0 × 0b` in a Call cell), but src/cli/spec-extract.ts (~96) calls `refusal(f.file, f.line, f.message)` and drops it. `Diagnostic` has no column, and `formatDiagnostic` (src/core/diag.ts) prints only `file:line:`. Add an optional column to Diagnostic and print `file:line:col:` only when one is set. Every refusal without a column prints byte-for-byte as before: no golden without a column may change. Pin the change with a golden case under tests/cli/extract-*/ for a malformed literal cell, and with a diag unit test.
- #53-B: `xmlMdLineOf` (src/spec/xml/reader.ts ~176-182) computes `max(1, piN + line - piLine)`, extrapolating from the last `<?line?>` mark. Kramdown-rfc writes few marks, so the line drifts after tables and multi-line constructs and can point past the end of the .md. `profileWhere` (profile.ts ~324) prints it as is. Make a refusal never cite a markdown line it cannot vouch for: print the md line only when it is exact (a mark on that XML line). Otherwise print the md line of the last mark together with the XML line, in a clear form such as `spec.md:<last-mark line> (spec.xml:<xml line>)` (pick one form and document it), and never print a line past the end of the .md. Regression: in specs/example-hex.md, the BCP 14 sentence is on md line 52 and is reported at 55 today. Build a failing fixture that shows the drift (one with a table before the refused construct) and fix it. If exactness is only possible for some constructs, say which in the docs.
- #53-C: src/spec/xml/doc.ts (~214, `anchor "…" is used again; first on line N`) and src/spec/xml/reader.ts (~702, `</x> closes <y> from line N`) cite XML lines in the message body, under a prefix that names the .md. Carry the second location (a Loc) so the second line is printed in the same file and numbering as the prefix (following the #53-B rule when it is not exact). Pin both with tests.
- Docs: the refusal format is described in docs/guide/guides/spec-to-contract.md (~line 136, "`file:line`. Where the XML carries kramdown-rfc's `<?line?>` marks …", and the example around line 149) and maybe in exit-codes.md. Update them to the new rules (column, exactness). Guide pages' ```sh fences are run by tests/guide/examples_test.ts unless marked `<!-- illustrative -->`, so run `node tests/run.mjs guide`.
- Committed specs/*.md, specs/*.xml and contracts/*.json must not change.

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
- Send the lead exactly two messages, one line each, with `send_message` to `@parent`: `refusal-locations branch up <sha>` after your first push, and `refusal-locations PR #<n> open` when the PR exists. After that send nothing — not CI results, not progress, not "over to you".
- Do not merge main into your branch whenever it moves. Merge it when the PR conflicts, or when the lead tells you to update from it before merging. Then regenerate the generated files with the repo's tooling, run the full suite once, and push.

## Rules
- Push only to your own branch. Never push to main, never touch another feature/open-issues-pass/* branch, never force-push.
- If CI goes red or a test fails, run /debug — reproduce it before you change anything. If that command is not available, follow the same order anyway: reproduce, localise, one hypothesis at a time, then pin the fix with a test.
- When unsure whether some Nish compiles or what it does, `.nish/bin/nish run <file>` answers in seconds. Run it rather than guess.
- If your stage turns out to be impossible as written, push what you have, open the PR as a draft, and say exactly what blocked you in the PR body. Do not substitute different work and do not widen your scope to fix it.
- You will get review comments as a single batch. Address every blocking one in one push, then stop. For each blocking finding, fix every instance of the same rule across your diff, not only the cited line, and say in the PR body how many you checked. Non-blocking ones go in that same push when they are cheap; never push for them alone. Keep the PR body accurate, but do not rewrite it unless a round says it is wrong. Do not reply to argue; if a finding is wrong, say so in one line on that thread and move on.
