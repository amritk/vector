---
name: Bend lessons — replay, AI.md, doc caps
overview: Three lessons from bendlang/bend for vector. Every z3 counterexample is replayed by an exact interpreter, and a disagreement is its own MISMATCH verdict. A nish-style docs/AI.md, rules and traps first, is named from an Agents section in vector --help. Agent-facing docs get byte caps that only go down.
stages:
  - id: cex-replay
    title: Replay every counterexample
    goal: Each counterexample from verify (refuted clause or hazard) and each witness from diff is re-evaluated exactly, without z3, and a disagreement is reported as MISMATCH
    verification: npm run build && node tests/run.mjs verify && node tests/run.mjs diff && npm run lint && npm run tested-exports && node scripts/gen-reference.mjs --check
    todos:
      - id: replay-eval
        content: Add an exact evaluator of a Program at a Counterexample in src/verify/solve/replay.ts — see Replay every counterexample
        status: pending
      - id: replay-model-values
        content: Parse z3 model values (ints, negatives, rationals, decimals) into exact values, marking anything else not replayable — see Replay every counterexample
        status: pending
      - id: replay-verify
        content: Replay refuted clauses and hazards in vector verify, and add the MISMATCH outcome to the text and JSON reports — see Replay every counterexample
        status: pending
      - id: replay-diff
        content: Replay the witness of vector diff in src/verify/equiv/diff.ts — see Replay every counterexample
        status: pending
      - id: replay-tests
        content: Add table-driven replay tests and verify and diff goldens — see Tests
        status: pending
      - id: replay-docs
        content: Add MISMATCH to the verdict tables in proving.md and exit-codes.md — see Replay every counterexample
        status: pending
  - id: ai-doc
    title: docs/AI.md and the Agents section of --help
    goal: An agent learns vector's rules and traps from one short file, which vector --help names by path, the way nish --help names .nish/docs/AI.md
    verification: npm run build && node tests/run.mjs cli && node tests/run.mjs guide && node tests/run.mjs package && npm run lint && npm run tested-exports && node scripts/gen-reference.mjs --check
    todos:
      - id: ai-md
        content: Write docs/AI.md, rules and traps first, then known limits — see docs/AI.md
        status: pending
      - id: help-agents
        content: Add an Agents section to the top-level help in src/index.ts, printing the AI.md path from sourceInstallRoot — see Agents section
        status: pending
      - id: help-golden
        content: Update tests/cli/help, with a placeholder for the checkout path in tests/run.mjs if needed — see Agents section
        status: pending
      - id: help-copies
        content: Update the --help copies in README.md and installation.md, and point both vector skills at AI.md — see Agents section
        status: pending
  - id: doc-caps
    title: Byte caps on agent-facing docs
    goal: A skill, CLAUDE.md or AI.md cannot grow past its cap, and a cap cannot be raised in a PR without it being visible
    verification: npm run doc-caps && node --test scripts/doc-caps.test.mjs && npm run lint
    todos:
      - id: caps-script
        content: Add scripts/doc-caps.mjs and scripts/doc-caps.json, with --base to refuse a raised cap — see Byte caps
        status: pending
      - id: caps-test
        content: Add scripts/doc-caps.test.mjs (node --test), table-driven — see Tests
        status: pending
      - id: caps-wire
        content: Add npm run doc-caps, a CI step for it and its test, and a CLAUDE.md row — see Byte caps
        status: pending
      - id: caps-ai-md
        content: After ai-doc merges, merge main and add the docs/AI.md cap — see Byte caps
        status: pending
---

# Bend lessons — replay, AI.md, doc caps

## Context

[bendlang/bend](https://github.com/bendlang/bend) is a proof language built for AI agents. Three of its habits fit vector, a judge whose verdicts are only as good as the checks behind them:

- **A second kernel.** `bend --verdict` checks every proof with two kernels and reports a mismatch as its own failure, a bug in Bend, not in the proof. vector trusts z3's model as given. A wrong encoding in [script.ts](src/verify/smt/script.ts) would show up as a counterexample nobody can reproduce.
- **`bend guide`.** Bend prints its agent guide from the CLI. vector follows nish instead: [.nish/docs/AI.md](.nish/docs/AI.md) holds the rules, traps first, and `nish --help` names it under **Agents**. The command is not called `guide`.
- **Size caps.** Bend's `gates/repo.ts` caps files by token count, with the rule "simplify, never move code out". vector's agent-facing docs keep growing: [vector-spec/SKILL.md](.claude/skills/vector-spec/SKILL.md) is 22.8 KB.

Not taken: taint from `@unsafe` code (vector has no foreign calls to taint), graded evals (vector never calls a model), and a WONTFIX file (its content goes into AI.md's known limits).

## Approach

- **The replay is exact, not float64.** [float64.ts](src/verify/emit/float64.ts) already interprets programs, but in f64, which is the point of the float64 gate. The replay must agree with z3's semantics: Int as integers and Real as rationals. Its numerator and denominator are i64, and a value that overflows is *not replayed*, never guessed.
- **Three replay outcomes**: `confirmed`, `not-replayed` (a value z3 printed that the parser does not read, or an overflow) and `mismatch`. Only `mismatch` changes the verdict.
- **MISMATCH exits 2.** The program may be correct, so exit 1 ("vector refused the input") would blame it. A disagreement is a tool failure ([diag.ts](src/core/diag.ts)). This was decided at sign-off.
- **The AI.md path is printed, never the file.** The path comes from `sourceInstallRoot()` ([path.ts](src/spec/source/path.ts)), the checkout the binary was built from. It is how `.z3/z3` is found. If `<root>/docs/AI.md` does not exist (a binary built from the npm library), help prints the GitHub URL of the file on `main` instead.
- **Caps ratchet down.** Each cap is the file's size when the cap lands, rounded up to the next 256 B. `--base <sha>` refuses a cap higher than at the base, the way `gen-reference.mjs --check --base` refuses a growing baseline. The failure message tells the agent to shorten the file in place, and never to move text into another file.

## Replay every counterexample

**Owns:** `src/verify/**`, `src/cli/verify.ts`, `src/cli/diff.ts`, `tests/verify/**`, `tests/cli/verify-*/**`, `tests/cli/diff-*/**`, `docs/guide/guides/proving.md`, `docs/guide/guides/exit-codes.md`, `scalar.config.json`, and `docs/reference/**` (generated; regenerate it, never resolve a conflict in it)

- `src/verify/solve/replay.ts` (new) exports the evaluator: `replayClause(program, fn, clause, cex)` and `replayHazard(...)`, each returning `ReplayResult { outcome, detail }`.
  - It evaluates `LangExpr` exactly: `EXPR_NUM`, `EXPR_VAR`, `EXPR_BINOP`, `EXPR_UNOP`, `EXPR_ITE` and `EXPR_BOOL` over exact values, and `EXPR_CALL` by evaluating the callee's body.
  - A callee is modelled the way [script.ts](src/verify/smt/script.ts) models it; read that file first. If z3 sees a callee only through its contract, the replay cannot evaluate the body and reports `not-replayed`.
  - Division by zero, or an Int outside the safe range where the encoding bounds it, follows script.ts as well.
- A refuted clause is `confirmed` when every requires holds at the cex, the clause is false there, and the computed result equals `cex.result`, if one is given. A hazard is `confirmed` when its condition holds (the divisor is 0, the callee's requires is false, the Int is out of range). Anything else is `mismatch`, and its detail names the first check that differed.
- Model values: `5`, `(- 5)`, `(/ 1 3)`, `(/ (- 1) 3)`, `(- (/ 1 3))` and `1.5`. Anything else is `not-replayed`.
- In [verify.ts](src/verify/verify.ts) and [report.ts](src/verify/solve/report.ts), every refuted clause and hazard with `hasCex` is replayed after solving. Any `mismatch` makes the run's status `MISMATCH` (exit 2). The text report adds a line, roughly: `MISMATCH  z3's counterexample does not refute <clause> when replayed: this is a bug in vector, not in your program — please report it`. The JSON adds `"replay": "confirmed" | "not-replayed" | "mismatch"` to each counterexample. `--emit` writes nothing on MISMATCH.
- In [diff.ts](src/verify/equiv/diff.ts), the witness of a non-equivalence is replayed through both versions. Equal results there is a `mismatch`, with the same status and exit 2.
- Docs: a MISMATCH row in the verdict table of [proving.md](docs/guide/guides/proving.md), in the `verify` and `diff` rows of [exit-codes.md](docs/guide/guides/exit-codes.md), and a sentence on what `not-replayed` means.

## docs/AI.md

**Owns:** `docs/AI.md` (new), `src/index.ts`, `tests/cli/help/**`, `tests/run.mjs`, `tests/guide/**`, `tests/package/**`, `README.md`, `docs/guide/getting-started/installation.md`, `.claude/skills/vector/SKILL.md`, `.claude/skills/vector-spec/SKILL.md`, and `docs/reference/**` (generated)

Modelled on [.nish/docs/AI.md](.nish/docs/AI.md). Read it first. Keep it under 10 KB, in this order:

1. **Traps**, each a rule plus one line of why:
   - only PROVEN is a pass, and UNKNOWN is not;
   - PROVEN is over the rationals, and the float64 gate is a separate check;
   - Int parameters are assumed to be safe integers;
   - a `trivial` proof does not depend on the body;
   - never edit `tests/dogfood/`, `contracts/*.json` or `specs/*.xml` by hand;
   - a frozen contract changes only through a spec PR;
   - read the exit status, not piped output.
2. **Rules**: the commands and their exit codes (0, 1, 2), what each `spec` gate refuses, and where each input format is documented. Link the guide pages rather than repeat them.
3. **Known limits**: what vector will not do (it never calls a model, and has no loops or recursion in `verify`), each with a single-line reason. This replaces a WONTFIX file.

## Agents section

- In [index.ts](src/index.ts), the top-level `--help` gains, after Flags, roughly:

  ```text
  Agents
    before using vector, read its rules, traps first: <root>/docs/AI.md
  ```

  `<root>` is `sourceInstallRoot()`, with the URL fallback from Approach. Command help is unchanged.
- [tests/cli/help](tests/cli/help) changes. The path depends on the checkout, so `tests/run.mjs` gains a `{{root}}` placeholder in `stdout` for the repository root, beside `{{version}}`. The help copies in [README.md](README.md) and [installation.md](docs/guide/getting-started/installation.md) are checked by [examples_test.ts](tests/guide/examples_test.ts), which already replaces the workspace path. Keep them passing. They stay between the release-please markers.
- [vector/SKILL.md](.claude/skills/vector/SKILL.md) and [vector-spec/SKILL.md](.claude/skills/vector-spec/SKILL.md) each get one line near the top pointing at `docs/AI.md`. Do not move content out of them.

## Byte caps

**Owns:** `scripts/doc-caps.mjs`, `scripts/doc-caps.json`, `scripts/doc-caps.test.mjs` (all new), `package.json`, `.github/workflows/ci.yml`, `CLAUDE.md`

- `scripts/doc-caps.json` is `{ "<path>": <max bytes> }` for `CLAUDE.md`, `.claude/skills/vector/SKILL.md`, `.claude/skills/vector-spec/SKILL.md` and, after ai-doc merges, `docs/AI.md`. Each cap is the current size rounded up to the next 256 B.
- `node scripts/doc-caps.mjs` exits 1, naming the file, its size and its cap, when:
  - a file is over its cap;
  - a listed file is missing;
  - with `--base <sha>`, a cap is higher than the base's or an entry was removed.

  The message: `shorten it in place: simplify, never move text into another file to fit`. It exits 2 on a malformed JSON file or an unreadable base.
- `package.json` gets `"doc-caps": "node scripts/doc-caps.mjs"`. [ci.yml](.github/workflows/ci.yml) runs `npm run doc-caps` and `node --test scripts/doc-caps.test.mjs` next to lint, plus `--base` on pull requests, with the base fetched the way [docs.yml](.github/workflows/docs.yml) fetches it. [CLAUDE.md](CLAUDE.md) gets a row in the command table and a line under Definition of done.
- **Merge-order edge**: this stage merges after ai-doc. When the lead says ai-doc has merged, merge `main` into the branch and add the `docs/AI.md` entry at its merged size.

## Out of scope

- A second SMT solver. The replay is the second kernel.
- Replaying `spec` gates. They do not use z3 models.
- Changing the float64 gate, or the encoding in script.ts. If the replay finds a real mismatch on an existing golden, report it in the PR and the ledger; do not fix the encoding in this run.
- Moving content out of the skills to fit a cap.
- A `vector guide` command, or any command that prints AI.md.

## Tests

- **cex-replay**: `tests/verify/replay_test.ts` (new) is table-driven over hand-built programs and counterexamples:
  - `confirmed` for a true refutation;
  - `mismatch` for a cex where the clause holds, where a requires fails, and where the result differs;
  - `not-replayed` for an unparseable value and an i64 overflow;
  - each model-value form.

  Through `vectorRun` or the binary:
  - a refuted golden (e.g. [verify-emit-refuted](tests/cli/verify-emit-refuted)) shows `"replay": "confirmed"` in `--json`;
  - a test of the status-to-exit-code mapping shows that MISMATCH is 2;
  - a diff golden shows its witness `confirmed`.

  Mirror [verify_test.ts](tests/verify/verify_test.ts).
- **ai-doc**: the help golden with `{{root}}`; a test that the printed path exists from a built checkout; a test of the URL fallback when `<root>/docs/AI.md` is absent (unit-level on the function that picks it, given a root).
- **doc-caps**: `node --test`, table-driven over temp dirs: under the cap; over it; exactly at it; a missing file; a malformed JSON file; a raised cap with `--base`; a removed entry with `--base`; a lowered cap with `--base`, which passes.

## Verification

- cex-replay: `npm run build && node tests/run.mjs verify && node tests/run.mjs diff && npm run lint && npm run tested-exports && node scripts/gen-reference.mjs --check`
- ai-doc: `npm run build && node tests/run.mjs cli && node tests/run.mjs guide && node tests/run.mjs package && npm run lint && npm run tested-exports && node scripts/gen-reference.mjs --check`
- doc-caps: `npm run doc-caps && node --test scripts/doc-caps.test.mjs && npm run lint`
- Every PR: CI's `check`, `docs`, `spec` and `PR title` jobs are green. `npm test` is CI's.
