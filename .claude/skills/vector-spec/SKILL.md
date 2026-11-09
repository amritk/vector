---
name: vector-spec
description: >-
  Turn a specification — an RFC, or a markdown spec with numbered headings —
  into a contract and a generated Nish test that checks an implementation
  against it: verbatim requirements, the spec's own test vectors, and
  properties sampled at solver-chosen boundaries. Every quote and every
  test-vector byte is checked against the spec text, every vector says where
  its expected value comes from, and every MUST/SHALL in the main spec must be
  tested or explicitly excluded. Also walks a spec-first PR: approve the spec,
  freeze its contract, then gate the implementation PR on it (frozen, stale,
  exports, mutate). Use when asked to check nish's std/crypto (or any nish
  module) against an RFC or a spec, to write RFC-conformance tests, "RFC =>
  nish test" / "spec => nish test", or to land a module spec-first.
---

# vector spec — spec → contract → Nish test, and the PR that implements it

`vector rfc` is the same command under its old name.

**You** write the contract; **the spec text and Z3 hold the veto**; **nish runs
the test.** You never decide that a quote or a vector is right — `vector spec
check` does, against the spec's own text. Every gate below is deterministic
and fails closed: a git error, a missing source, an unreadable diff or a Z3
`unknown` is a failure, never a pass. A FAIL is a finding about the
implementation (or the contract) — show it; never weaken a clause to pass.

Exit codes, for every command: **0** pass, **1** refused (`INVALID`,
`VIOLATED`, `ERROR`, a stale test, an unlisted export, a survivor), **2** a
usage error, an unreadable spec or a git error.

## The PR workflow, in order

A module lands in two PRs. The first is the **spec side** (`specs/`,
`contracts/`, `rfcs/`, and generated tests in `test/spec/`); the second is the
**implementation**. `frozen` refuses a PR that touches both, so a test can
never be loosened in the PR that changes the code it tests. Do the steps in
this order; each one's command is the gate CI runs.

### 1. Write the spec

`specs/<name>.md` (`specs/example-hex.md` is the worked example). Its sections
must be numbered headings (`## 3. Encoding`, `### 3.1. Length`,
`## Appendix A. Vectors`); a MUST outside every numbered section is refused.
Give it an **Interface** section whose code declares the module's exports,
one per line:

```
## 2. Interface

    export const hexEncode = (bytes: u8[]): string
    export const hexDecode = (text: string): u8[] | null
```

Signatures go only in code: an indented block (after a blank line or the
heading) or a ` ``` ` / `~~~` fence. Each is `export const f = (a: T): R` or
`export function f(a: T): R`, followed by nothing but an optional `;` and
`// comment`: no body, no `=>`, no `{`. Types only from `u8[]`, `u8[] | null`,
`null | u8[]`, `string`, `string | null`, `null | string`, `i32`, `u32`,
`boolean`. The section fails closed: the word `export` (any case) outside code
there — a bullet, table, inline code, or prose like "Export the bytes…" —
refuses the spec, as do `export type`/`interface`/other forms and `export`
anywhere but the start of a code line. The section's code holds only
signatures and `//` comments; names are ASCII letters and digits (no `_`).
Anywhere else in the spec the bare word `export` refuses too (entities, HTML,
invisible or look-alike letters do not hide it): write "exported" or
"exports".

For an RFC: `rfcs/rfc<N>.txt` if it is there, otherwise
`curl -sSfL -o rfcs/rfc<N>.txt https://www.rfc-editor.org/rfc/rfc<N>.txt`
(unmodified; the IETF Trust allows copying an RFC whole). A human approves the
spec; nothing after this step may change it.

### 2. Write the contract from the spec alone, then `check` it

The contract must say what the spec asks for, not what some code happens to
do, so **do not read the implementation** — there may not be one yet. Take
the signatures from the spec's Interface section, and the requirements from
its binding sentences: `grep -n "MUST\|SHALL\|REQUIRED" specs/<name>.md`.

With an API key, the model can propose it from the spec alone, twice:

```bash
bun run vector spec extract --spec-only --twice --spec specs/<name>.md \
  --target nish/<name> -o contracts/<name>.json [--format markdown]
```

`--spec-only` gives the model only the spec and checks signatures against the
Interface section (a spec without one, with an export line it cannot read,
or with `export` outside code there, exits 2 before any model call). `--twice` runs two independent extractions and
lists where they disagree as warnings — a requirement one states and the other
does not, a requirement stated at different levels, a partial match (one
run's quote holds a sentence the other's does not), one tested in one run and
untested in the other, or a binding sentence the runs handle differently
(tested, untested, excluded, not covered); read every one before you accept
run 1's contract. Exit 0 writes the contract, 1
means no valid contract (either run, with `--twice`).

Without a key, write `contracts/<name>.json` yourself against
`schemas/rfc-contract.json`. `contracts/rfc5869-hkdf-sha256.json` and
`contracts/rfc8439-chacha20-poly1305.json` are the worked examples.

- **source**: one RFC is `"source": {"rfc": N, "title": …}`. Several
  documents (or a markdown spec) are `"sources": [{"id": "hex", "path":
  "../specs/hex.md"}, {"id": "rfc4648", "rfc": 4648}]` with
  `"source": {"title": …, "main": "hex"}`. Completeness reads only the main
  source; any citation may name another with `"source": "<id>"`.
- **functions**: exactly the Interface section's signatures, as `bytes`
  (`u8[]`), `bytes?` (`u8[] | null`), `string`, `string?`, `i32`, `u32`,
  `bool`, `secret-bytes` (`Secret<u8[]>`) and, as a result only,
  `secret-bytes?` (`Secret<u8[]> | null`). Vectors and properties give a
  secret as plain bytes; the generated test does the `secret`/`expose`. A reference function from another module names its module;
  `extract --spec-only` refuses one (the Interface declares only the
  target's functions), so add it by hand. Its signature is never checked,
  not even by `run --nish-root`: the signature gate reads only the target
  module's functions, so get the reference function's types right yourself.
- **requirements**: verbatim quotes, cited to the most specific section.
  Level = the BCP 14 keyword, or `DEFINITION` for what the algorithm is.
- **exclusions**: each MUST/SHALL sentence a functional test cannot observe
  (caller obligations, timing, key management), with the reason and where it
  *is* checked if anywhere.
- **vector clauses**: the spec's test vectors, values copied as lowercase
  hex. `concat` when the spec prints a value in parts (ciphertext + tag).
  Each literal is a *whole* printed value (never a prefix or a tail), and a
  value printed under a name carries it: `{"hex": "0b0b…", "label": "Key"}`
  for `Key = 0b0b…`. Take args and expected value from one test case (cite
  the subsection that holds it); the expected value is never a value an
  argument is bound to. Where a case is printed for several variants
  (`HMAC-SHA-256 =`, `HMAC-SHA-512 =`), use the row whose number is in the
  function's name. A `str` must be printed whole (quoted, in a code
  span, alone on a line, or after `=`/`:` at a line's end) and on one line
  with the other strings of its vector.
  Every vector has a `source` for its expected value:
  - `{"cite": {"section": "A.1"}}` (optionally `"source": "<id>"`): args and
    expected value are printed in that section. Prefer this.
  - `{"command": "…"}` plus `"section"` (where the args are printed): the
    expected value is the command's trimmed stdout (hex for bytes). It runs
    only under `--run-sources` (30 s timeout); otherwise it is reported as
    not run, never as passed.
  - `{"spec": "4.2"}` plus `"section"`: only for an expected `null` or
    `bool`. The vector must `cover` a requirement cited to §4.2 whose quote
    states the value as an affirmative requirement ("f MUST return null
    when …", "f SHALL be false") — not "null or …", not "null-terminated",
    not retracted later, not only in a table or code block, and not cut
    from a qualified sentence (the whole prose sentence around the quote
    is read: "For example, … MUST return null" fails). A descriptive
    "f returns null on failure" does not count; see the README's rule. A
    `cite` source for `null` or a `bool` is held to the same rule.
- **property clauses**: the spec's definitions as checks over a typed
  domain — lengths, bounds written as integer comparisons (Z3 samples both
  sides of each), round trips, tamper rejection, and the construction
  rebuilt from other functions.

Then:

```bash
bun run vector spec check contracts/<name>.json --spec specs/<name>.md --run-sources
```

Read every `command` source the model proposed before you pass
`--run-sources`: it runs on your machine, as you, with your files and
network. On Linux nothing it starts outlives it; elsewhere a process it
detaches with `setsid` outlives the timeout. Then repair every gate failure it lists (fidelity, completeness, coverage,
provenance, typing, domain) and re-run until it prints `CONTRACT_VALID` and
exits 0. With no module yet it warns that signatures were not checked; that
is expected here — `run --nish-root` (step 5) checks them against the
implementation, and fails on a mismatch.

### 3. Freeze the contract

Record the sha256 of the main spec file's bytes in the contract — the first
field of the output, not the file name after it:

```bash
sha256sum specs/<name>.md | cut -d' ' -f1      # macOS: shasum -a 256 specs/<name>.md | cut -d' ' -f1
# → "source": { …, "sha256": "<hex>" }
```

Commit the spec, the contract and (step 4's) generated test together, in the
spec-side PR, and gate it:

```bash
bun run vector spec frozen --base origin/main contracts/<name>.json
```

Run it last, after step 4's `emit` and `stale`, so it sees the whole PR.

Exit 0: the PR is all spec side, and every contract's main source still
hashes to its `source.sha256`. Exit 1: the PR also touches implementation
files, or the spec changed under the contract (or it has no `sha256`), or no
contract was found. From here, the spec and contract change only in a PR of
their own.

### 4. Emit the test, and keep it fresh

```bash
bun run vector spec emit contracts/<name>.json -o test/spec/<name>.ts
bun run vector spec stale test/spec/<name>.ts contracts/<name>.json
```

`emit` writes `// vector-contract-sha256: <hex>` into the test's header;
`stale` exits 1 when that line names other bytes than the contract's (or is
missing, or appears twice). In a repository that does not install vector,
`node scripts/spec-stale.mjs <test> <contract>` is the same check with the
same exit codes. A test in `test/spec/` counts as spec side only while
`stale` passes it.

### 5. Implement, then `run`

The implementation PR touches the code and nothing on the spec side
(`frozen` refuses it otherwise). Then:

```bash
bun run vector spec run contracts/<name>.json --nish-root ../nish [--format markdown]
```

It re-runs every `check` gate, now with the signature gate against the
module, then runs the test. Exit 0 is `SATISFIED`: every clause passed. `VIOLATED` (a clause failed, with
its sample) and `ERROR` (it did not build, or finished early) exit 1.
`--nish-root` uses `build/nish`, which tests the working tree's std; the seed
tests the last release's std and warns.

### 6. Check the exports

```bash
bun run vector spec exports contracts/<name>.json --nish-root ../nish --base origin/main
```

Every export the diff adds to or changes in the target module must be a
function the contract tests, or be listed with a reason:

```json
"outOfScope": [{ "name": "hexTable", "reason": "internal helper, not in the spec" }]
```

Exit 1 names each unlisted export. An `outOfScope` entry belongs in the
spec-side PR, approved with the contract, never added in the implementation
PR to get it green. Such entries usually become known only when the
implementation PR fails `exports`; adding one changes the contract's bytes,
so in that spec-side PR re-run `emit` and `stale` (step 4) and `frozen`.

### 7. Mutate the diff

```bash
bun run vector spec mutate contracts/<name>.json --nish-root ../nish --base origin/main \
  [--jobs N] [--max N] [--format markdown]
```

It mutates only the module's lines changed since `--base` and runs the test
against each mutant. A survivor is printed as `file:line`, its mutated line,
and *behaviour no requirement pins down*, and exits 1. Kill it with a property
or vector the spec supports, or — in a spec-side PR — allow it with the reason:

```json
"allowSurvivors": [{ "file": "std/hex.ts", "line": 42, "reason": "…" }]
```

Like `outOfScope`, an `allowSurvivors` entry is usually found by the
implementation PR's `mutate` run, and changes the contract's bytes: add it in
a spec-side PR, then re-run `emit`, `stale` and `frozen` there.

Zero mutants, every mutant stillborn, or a test that fails on the unmutated
module all exit 1 too.

### 8. Report

Post the dashboard (`--format markdown` on `check`, `run`, `mutate` and
`extract` is a PR comment): each requirement with its evidence, the
exclusions, command sources that were not run, `--twice` disagreements, every
survivor, and any failure with its sample.

## Without a PR

To check an existing module against an RFC (nish's std/crypto), steps 1, 2
and 5 are enough: write the contract (here you may read the module for its
signatures, and pass `--module <src.ts>` or `--nish-root` to `check` so the
signature gate runs), `check` it, then `run` it.

## Expression language (property `assert` / `where`)

Literals `{"hex"}`, `{"ascii"}` (both take `"label"`: the name the value is
printed under), `{"int"}`, `{"bool"}`, `{"null":true}`,
`{"concat":[…]}`; `{"var": name}`; `{"call": fn, "args": […]}`;
`{"op": …, "args": […]}` with `len concat slice zeros fill flipBit xor bitAnd
bitOr le64 unwrap isNull notNull + - * % < <= > >= == != and or not implies`.
`xor`/`bitAnd`/`bitOr` combine two byte strings byte by byte, as long as the
longer (the shorter reads as zeros past its end), so `xor(key, fill(0x36,
64))` is HMAC's inner padded key for a key of at most 64 bytes. `unwrap` of a
null fails the sample. `where` may not call the functions under test.

## Limits — say them

A passing contract is evidence, not proof: properties are sampled (Z3
boundaries + seeded random), not quantified. A `command` source is only as
good as the command. Timing, secret wiping and other non-functional MUSTs are
excluded and must be checked elsewhere (nish's ct-asm/ct-timing and wipe
tests).
