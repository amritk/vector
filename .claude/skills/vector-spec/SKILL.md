---
name: vector-spec
description: >-
  Turn a specification, an RFC or a module's spec, into a kramdown-rfc spec
  that vector extracts into a contract, plus a generated Nish test that checks
  an implementation against it. The test holds verbatim requirements, test
  vectors, and properties sampled at solver-chosen boundaries. Every quote is
  checked against the RFC it quotes, every vector says where its expected value
  comes from, and every BCP 14 sentence in the spec must be tested or
  explicitly excluded. Also walks a spec-first PR: approve the spec, extract
  and freeze its contract, then gate the implementation PR on it (frozen,
  stale, exports, mutate). Use when asked to check nish's std/crypto (or any
  nish module) against an RFC or a spec, to write RFC-conformance tests,
  "RFC => nish test" / "spec => nish test", or to land a module spec-first.
---

# vector spec — spec → contract → Nish test, and the PR that implements it

Before running vector, read [`docs/AI.md`](../../../docs/AI.md): its rules, traps first.

**You** write the spec. **`vector spec extract`** writes the contract from it.
**The RFC text and Z3 hold the veto**, and **nish runs the test.** Never write
or edit `contracts/<name>.json` by hand: change the spec, rebuild, and
re-extract. You never decide that a quote or a vector is right; extract and
`check` do, against the cited text. Every gate below is deterministic and fails
closed: a git error, a missing source, an unreadable diff or a Z3 `unknown` is
a failure, never a pass. A FAIL is a finding about the implementation (or the
spec). Show it; never weaken a clause to pass.

Exit codes, for every command: **0** pass, **1** refused (extract's refusals,
`INVALID`, `VIOLATED`, `ERROR`, a stale test, an unlisted export, a survivor),
**2** a usage error, a missing file or RFC, the wrong build tools, a z3
failure (`check`, `extract`, `emit`, `run` and `mutate`), or a git error.

[Writing a spec](../../../docs/guide/guides/writing-a-spec.md) is the
reference for every construct below.
`tests/fixtures/profile/profile-hex.md` is a spec that uses all of them.

## The PR workflow, in order

A module lands in two PRs. The first is the **spec side** (`specs/`,
`contracts/`, `rfcs/`, `.refcache/`, and generated tests in `test/spec/`); the second is the
**implementation**. `frozen` refuses a PR that touches both, so a test can
never be loosened in the PR that changes the code it tests. Do the steps in
order; each one's command is the gate CI runs.

### 0. Tools

`scripts/build-spec.sh` runs only with the pinned tools, and exits 2 with this
hint otherwise:

```bash
gem install kramdown-rfc -v 1.7.43 --no-document
pip install xml2rfc==3.35.0
```

### 1. Draft the spec

Write `specs/<name>.md` in kramdown-rfc from the RFC or the request alone.
**Do not read the implementation**: there may not be one yet, and the spec
must say what is asked for, not what code does.

Front matter: `docname: draft-<name>-00`, where `<name>` is the file's
basename, and a pinned `date: YYYY-MM-DD`. List each RFC you cite under
`normative:`, but not RFC 2119 or 8174. Close the front matter with
`--- abstract`, then write the abstract, then `--- middle`.

```yaml
---
title: "Hex encoding"
abbrev: Hex
docname: draft-hex-00
category: info
ipr: trust200902
submissiontype: independent
v: 3
date: 2026-11-11
author:
  - name: …
normative:
  RFC4648:
--- abstract

…

--- middle

# Introduction

{::boilerplate bcp14-tagged}
```

The boilerplate is the first paragraph of `# Introduction`. Then add:

**One interface block.** It is the contract's `target` and `functions`, so
keep it to the module's exports:

````
~~~ ts-interface
// module: nish/hex
export const hexEncode = (bytes: u8[]): string
export function hexDecode(text: string): u8[] | null
~~~
````

The types are those of the table in [Writing a
spec](../../../docs/guide/guides/writing-a-spec.md#types): `u8[]`, `string`,
`boolean`, `Secret<u8[]>`, the fixed-width integers `i8` … `i64` and
`u8` … `u64`, `f64`, and the word arrays `u16[]`, `u32[]` and `u64[]`. A
Nish test holds all but `i8` and `i16`, which the emitter refuses; only
it holds word arrays. Add `| null` to `u8[]`,
a word array or `string`, and to `Secret<u8[]>` as a result only; a
property passes `u8[]` to a `Secret<u8[]>` parameter. Give
word-array cases as vectors: a property over or calling word arrays is
refused. Nish test only: `u8[] /* window */` is one bytes parameter for a
`(buf, off, len)`, tested at a nonzero offset; `u8[] /* out CAP */` an
`(out, at) -> end` write, the result `u8[]` (`| null` if `end` < 0). CAP, the
bytes after `at`, is numbers, `+`, `*`, `()` and `<u8[] param>.length`.

A property may compare the module with another nish module (HKDF with
HMAC). Declare that module's functions after a second `// module:` line,
below the module under test's own, which declares at least one function;
they are reference functions, not exports. A vector's Call must name a
function of the module under test, and a property's assertion must call at
least one: a clause that calls only reference functions is refused. A module line is exactly
`// module: nish/<path>`, one module, after the previous signature. A comment of any style or case whose text starts `module:` or
`module nish/` but is not that (`// Module: …`, `//module nish/…`,
`/* module: … */`, `/// module: …`, two modules) is refused, and so is a module
line inside a signature. Other comments (`// module-level helper`) are
skipped:

````
~~~ ts-interface
// module: nish/crypto/hkdf
export const hkdfExtractSha256 = (salt: u8[], ikm: u8[]): u8[]
// module: nish/crypto/hmac
export const hmacSha256 = (key: u8[], data: u8[]): u8[]
~~~
````

**Requirements: one BCP 14 sentence per anchored paragraph,** at one level,
with the anchor on the next line. `X MUST a. Y MUST b.` under one anchor is
refused: give each sentence its own anchor. In an unnumbered section, a
requirement of this spec, an exclusion of an unanchored sentence, and a
vector table are refused (no section number to record); an RFC quote is
accepted.

```
hexEncode MUST return exactly two characters per input byte.
{: #R-ENC-LEN}

Definition: a hex digit is one of the characters 0-9, a-f and A-F.
{: #R-DEF-DIGIT}
```

**Quotes from an RFC** go in a blockquote. Its last line is the citation, and
its attribute must include `gi="blockquote"`. It must be verbatim in that
section of the RFC.

```
> BASE16("f") = "66"
> {{Section 10 of RFC4648}}
{: #R-RFC-VECTORS gi="blockquote"}
```

**Exclusions.** Some BCP 14 sentences cannot be observed by a functional
test: caller obligations, timing, key management. Follow each directly
with an `Untested:` paragraph that gives the reason and, where it exists, what
checks it instead. That sentence can be a requirement or an unanchored
paragraph. A requirement followed by `Untested:` becomes an exclusion: no
vector's Covers or property may name it.

```
hexDecode MUST NOT index a table by the value of a digit.
{: #R-DEC-TIMING}

Untested: timing is not observable from a unit test. Checked by: code review.
```

A `Note: ` paragraph right after a requirement is kept as its `note`: say
there how the module honours a sentence the RFC words loosely. A `Note:` that
follows no requirement is refused.

**A profile of one RFC.** When the spec checks a module against one RFC, make
the RFC the main source with the front-matter keyword `vector-main-RFC<N>`
(and RFC N under `normative:`):

```yaml
keyword:
  - vector-main-RFC5869
```

Completeness then runs over the RFC, not the spec: every `MUST`, `MUST NOT`,
`SHALL`, `SHALL NOT` and `REQUIRED` sentence of RFC N must be quoted in an
anchored blockquote or in an excluded one. Exclude an RFC sentence by quoting
it in an unanchored blockquote followed by `Untested:`:

```
> Words 13-15 are a nonce, which MUST not be repeated for the same key.
> {{Section 2.3 of RFC8439}}
{: gi="blockquote"}

Untested: an obligation on the caller: a pure function cannot see its other invocations
```

Every requirement must then be RFC text: a `Definition:` paragraph, a BCP 14
sentence of the spec's own, and a vector Source naming a section of the spec
are refused. `specs/rfc5869-hkdf-sha256.md` and
`specs/rfc8439-chacha20-poly1305.md` are worked examples. The contract records
the RFC, not the spec, so check it with `spec check contracts/<name>.json`
(the RFC is read from its recorded file), or name the RFC with
`--spec rfcs/rfc<N>.txt`. `--spec specs/<name>.xml` exits 1 (`--spec … is not rfcs/rfc<N>.txt, the main
source the contract records`). To check that the contract is exactly what the
profile extracts to, run
`spec extract specs/<name>.xml -o contracts/<name>.json --check`.

**One vector table** has exactly this header:

```
| Id | Call | Expected | Covers | Source | Title |
|----|------|----------|--------|--------|-------|
| V1 | `hexDecode("66")` | `"f"` | R-RFC-VECTORS | {{Section 10 of RFC4648}} | one byte |
| V2 | `hexEncode([00 0f f0 ff])` | `"000ff0ff"` | R-ENC-LEN | `python3 -c 'print(bytes([0,15,240,255]).hex())'` | bytes literal |
| V3 | `hexDecode("abc")` | `null` | R-DEC-REJECT | {{empty-input}} | odd length |
```

- **Call and Expected** are each one code span.
- **Literals:**
  - `"text"`: ASCII bytes where bytes go, a string where a string goes.
  - `[00 0f]`: bytes.
  - `[]` or `(empty)`: empty bytes.
  - `null`, `true`, `false`.
  - Decimal integers.
  - `Key = 0b0b0b`: labelled bytes. Use the label the cited section prints
    the value under, several words if it does; the first word may start with
    digits joined to a letter (`32-bit fixed-common part = 07000000`).
    A later word may be a comma-grouped number (`After 1,000 iterations`),
    and one later word a parenthesised group (`MESSAGE (length 1 byte) = 72`,
    as RFC 8032 prints it).
  - `MESSAGE (length 0 bytes) = (empty)`: the empty value a section prints
    as a label with nothing below it and a length of 0.
  - `concat(a, b, …)`: one level, all parts bytes. Never `‖`.
  - `[0x11111111 0x01020304]` or `State = [879531e0 c5ecf37d]`: a word
    array, for `u16[]`, `u32[]` or `u64[]`. Each word has the type's width
    and is spelled as the section prints it, `0x` and all.
- **Source** says where the expected value comes from:
  - `{{Section N of RFCx}}`: the value is printed there. Prefer this.
  - `{{Section N of RFCx}}, Test Vector #K`: the values are all printed in
    that one case of the section, under its `Test Vector #K:` heading. Use
    it when a section prints several cases and a plain cite is refused as
    unclear.
  - `{{Section N of RFCx}}; result {{Section M of RFCx}}`: for a `null`,
    `true` or `false` result, the inputs are printed in section N and the
    result is supported by section M of the main RFC: a covered requirement
    of M states it, or a property covering a requirement of M asserts the
    call equals it for inputs inside its domains, each input either a
    quantified variable or another cited vector's expected value (under
    `unwrap` only a non-null one), never a literal in the property, and
    each variable free to take another value than the vector's (a domain
    of one value, or a `where` that pins it, only restates the row). Use it
    for a verify vector whose section defines the check but never says
    "MUST return true" (see the guide's "When a property derives the
    result"). Widen the property's domain to hold the vector's inputs. A
    "Check …" sentence alone never states the result, and a truncated,
    iterated or toleranced vector, or a sibling vector that is, cannot be
    derived; `tests/fixtures/result-ed25519/` is the worked example.
  - `{{anchor}}`: a numbered section of this spec. For a `null` or `bool`
    expected value it is a `spec` source (the covered requirement states it);
    for any other value it is a `cite` of that section, which must print the
    value.
  - A code span holding a command: its trimmed stdout, as hex bytes, a
    string, a decimal int, `true`, `false` or `null` (no f64 or words).
- **Values from an RFC:**
  - Each one is a *whole* printed value, never a prefix or a tail. A word
    array is a whole printed block, word for word.
  - Take the args and the expected value from one test case. A label
    printed once goes with its own case (RFC 8032 §7.1's empty MESSAGE:
    TEST 1), and args in a call label's `( … )` with its value.
  - A wrapped value keeps the name before its first `=`.
  - A case printed per variant: use the row the function's name numbers.
  - [Writing a spec](../../../docs/guide/guides/writing-a-spec.md)'s "What a
    printed value is" and "When a section states `null`, `true` or `false`"
    give the full rules.

**Properties.** Each is a `ts-property` block. Line 1 is
`// P-ID covers R-ID, … — title`, where the separator is exactly ` — `
(space, em dash, space):

````
~~~ ts-property
// P-ROUND-TRIP covers R-ROUND-TRIP — hexDecode(hexEncode(b)) is b
forall (b: u8[] /* 0..64 */) => {
  const d = hexDecode(hexEncode(b));
  return d !== null && unwrap(d) === b;
}
~~~
````

Write definitions as checks over a typed domain:

- lengths;
- bounds written as integer comparisons (Z3 samples both sides of each);
- round trips;
- tamper rejection;
- the construction rebuilt from other functions.

Writing a spec's [Properties](../../../docs/guide/guides/writing-a-spec.md#properties)
gives the subset: operators, operations, `where`, and the refused forms. Its
semantics are vector's, not JavaScript's: `.slice` clamps, `a % 0` is 0, and
`===` on bytes compares contents.

**Linked RFCs.** The RFC text must be in `rfcs/`, unmodified. The IETF Trust
allows copying an RFC whole. Extract's missing-RFC message gives the `curl`
command, which fetches `rfc<N>.txt`; the `.txt` works for every RFC, and an
`rfc<N>.xml` is read instead when present. Every command looks nearest place
first (beside the contract, `../rfcs/`, the
`rfcs/` of vector's install root, the directory above the binary's own, then
the current directory's `rfcs/`), and at each place `.xml` before `.txt`. A `file` the
contract already records wins: adding an `.xml` later does not displace a
recorded `.txt`, and `check` and `frozen` verify the recorded bytes.

### 2. Build, extract, `check`

```bash
scripts/build-spec.sh specs/<name>.md         # writes specs/<name>.xml
./dist/vector spec extract specs/<name>.xml -o contracts/<name>.json
./dist/vector spec check contracts/<name>.json --run-sources
```

**build-spec.sh**

- It runs offline against the committed `.refcache/`. The first time the spec
  cites a reference, add `--fetch`, then review and commit the `.refcache/`
  diff in the same PR as the spec: `.refcache/` is spec side.
- Warnings are errors. Fix the markdown until it builds clean.

**extract**

- It lists every refusal at once, each as `file:line`. The file is the XML;
  the line is the `.md` line when the XML carries `<?line?>` marks, otherwise
  the XML line. The line can run late after a table.
- Repair the **spec**, never the contract. Rebuild and re-extract until
  it exits 0.
- It runs `check`'s gates: fidelity, completeness, coverage, provenance,
  typing and domain.
- It fills in every `sha256`: there is no freeze step by hand.
- `-o` writes the contract; without it, the contract goes to stdout.
  `--check -o contracts/<name>.json` writes nothing and exits 1 with a diff
  when the committed contract is not what the spec states. A refusal about
  `allowSurvivors` names the sidecar, not the XML.

**check --run-sources** runs the `command` sources. Read every command before
you pass `--run-sources`: it runs on your machine, as you, with your files and
network. Only the 30 s timeout kills the command's process group: a command
that exits quickly can leave background children running, and a process that
detaches with `setsid` is never contained. With no module yet, `check`
warns that signatures were not checked, as expected: once the module exists
(step 5), `check --nish-root` or `--module` checks them. No other command does.

Commit `specs/<name>.md`, `specs/<name>.xml` and `contracts/<name>.json`
together, then show the spec to a human for approval. **The reviewer confirms that:**

- each `ts-property` says what the prose it covers says, no more and no less;
- each `Untested:` reason is true, and what it says checks the sentence
  really does.

Nothing after this step may change the spec.

### 3. Freeze

```bash
./dist/vector spec frozen --base origin/main contracts/<name>.json
```

Run it last, after step 4's `emit` and `stale`, so it sees the whole PR.

- **Exit 0:** the PR is all spec side, and every contract source still hashes
  to its recorded `sha256`.
- **Exit 1:** any of:
  - the PR also touches implementation files;
  - the spec or a linked RFC changed under the contract;
  - a `sha256` is missing;
  - no contract was found.

Its arguments are the contracts to check, from the repository's
top; with none, it checks every `contracts/*.json`. Either way, a generated
test whose one sha line names a contract in `contracts/` (not a sidecar or a
symbolic link) or one given counts on the spec side, so a PR changing two
contracts may name only one of them. `--repo <dir>` names the repository
(default: `.`).

From here, the spec and contract change only in a PR of their own.

### 4. Emit the test, and keep it fresh

```bash
./dist/vector spec emit contracts/<name>.json -o test/spec/<name>.ts
./dist/vector spec stale test/spec/<name>.ts contracts/<name>.json
```

`emit` does not make directories: `mkdir -p test/spec` first.
`emit` writes `// vector-contract-sha256: <hex>` into the test's header.
`stale` exits 1 when that line names other bytes than the contract's, or is
missing, or appears twice. In a repository that does not install vector,
`node scripts/spec-stale.mjs <test> <contract>` is the same check with the
same exit codes. A test in `test/spec/` counts as spec side only while
`stale` passes it.

A module outside `nish/` is one of your project's own: give
`--package <name>=<dir>` to `emit` and `run` (the module `<name>/<path>` is
`<dir>/<path>.ts`), and the test imports it by a relative path, so emit it
into the directory it will run from. vector's own `specs/vector-*.md` work
this way: their tests are in `tests/dogfood/`, and `npm run dogfood` refuses
one that is not what vector emits now.

### 5. Implement, then `run`

The implementation PR touches the code and nothing on the spec side
(`frozen` refuses it otherwise). To rename a contracted export, land one PR
that renames it in the spec `.md`, rebuilt `.xml`, contract, regenerated
test and module, and changes nothing else. Then:

```bash
./dist/vector spec check contracts/<name>.json --nish-root ../nish
./dist/vector spec run contracts/<name>.json --nish-root ../nish [--format markdown]
```

`check --nish-root` (or `--module <src.ts>`) is the only command that checks
the declared signatures against the module's exports. `run` re-runs the other
`check` gates, but not the signature gate, and says nothing about it; then
it runs the test.

- **Exit 0** is `SATISFIED`: every clause passed.
- **Exit 1** is `VIOLATED` (a clause failed, shown with its sample) or
  `ERROR` (the test did not build, or finished early).

`--nish-root <root>` builds with the seed compiler, `<root>/libexec/nish` if
it exists (a nish install, such as `.nish/`) and `<root>/build/seed`
otherwise (a checkout), with the root's own `std/` overlaid, so it tests that
root's std. `--nish <bin>` builds with that compiler as it is.

### 6. Check the exports

```bash
./dist/vector spec exports contracts/<name>.json --nish-root ../nish --base origin/main
```

Every export the diff adds to or changes in the target module must be a
function the contract tests. Exit 1 names each one that is not.

When `exports` fails, do one of these in a spec-side PR:

- drop the export from the implementation;
- add the function to the spec, with a clause that tests it;
- declare it out of scope with a paragraph
  `Out of scope: <export>, <the reason no clause tests it>`, anywhere in the
  body. The reason uses no BCP 14 keyword. `exports` then reports a change to
  that export as a note, not a failure. The name is not checked against the
  module, so a misspelt one excuses nothing.

### 7. Mutate the diff

```bash
./dist/vector spec mutate contracts/<name>.json --nish-root ../nish --base origin/main \
  [--jobs N] [--max N] [--format markdown]
```

It mutates the module's lines changed since `--base` in code the contract's
functions reach (the rest are one note) and runs the test on each mutant. A
survivor is printed with its `file:line`, its mutated line, and *behaviour no
requirement pins down*, and it exits 1. Kill the survivor with a property or
vector the spec supports. Or, in a spec-side PR, allow it with a reason in
`contracts/<name>.survivors.json`:

```json
{ "allowSurvivors": [{ "file": "std/hex.ts", "line": 42, "reason": "…" }] }
```

Re-extract, which merges it in verbatim, then re-run `emit`, `stale` and
`frozen` (which skips `*.survivors.json`): the contract's bytes changed.
Survivors usually surface in the implementation PR, but the allow-list belongs
in a spec-side PR.

`mutate` also exits 1 in these cases:

- zero mutants, as when no changed line is in reach;
- every mutant is stillborn or its build ran past its time;
- over 10% of the builds or tests ran past their time;
- the unmutated module fails the test, or an error in it stops its build.

It exits 2 for bad usage, a git error, a z3 failure, or a compiler failure the
mutant did not cause. Two compiler traps:

- **The compiler must read the slot.** With no `--nish`, mutants build on
  the root's seed (an install itself, or a checkout's `build/seed`) with its
  `std/` laid over it; with neither, run `bash scripts/fetch-seed.sh` there
  (no build needed). A canary checks the compiler fails on the module made
  unparseable. `--nish <file>` copies the whole root; `.nish/bin/nish` execs
  another install and fails the canary.
- **Run it from the repository's top.** Without `--test`, `mutate` emits the
  contract's test as `emit` does, checking the contract with the current
  directory as the repository's top, as CI runs it.

### 8. Report

Post the dashboard: `--format markdown` on `check`, `run` and `mutate` gives a
PR comment. It shows each requirement with its evidence, the exclusions,
command sources not run, every survivor, and any failure with its sample.

## Without a PR

To check an existing module against an RFC (nish's std/crypto):

1. Write the spec (step 1). Here you may read the module for its signatures.
2. Build and extract it (step 2).
3. `check` it, passing `--module <src.ts>` or `--nish-root` so the signature
   gate runs.
4. `run` it (step 5).

## Limits — say them

A passing contract is evidence, not proof. Properties are sampled (Z3
boundaries plus seeded random), not quantified. By default a property gets
every boundary sample plus 24 random, at most 96; raise it with
`// samples: N` as line 2 of the ts-property block, right after the covers
line. N is the total, boundaries included, and its ceiling is 256. A
`command` source is only as good as the command. Timing, secret wiping and
other non-functional MUSTs are excluded and must be checked elsewhere (nish's
ct-asm/ct-timing and wipe tests).

An iterated vector (a value printed after N calls, RFC 7748 §5.2) is a
plain row plus an `Iterate: <id> <N> times, (k, u) <- (f(k, u), k)`
paragraph after the vector table; see tests/fixtures/rfc7748. A vector
marked `slow` (`Iterate: <id> 1,000,000 times, slow, …`) is skipped, and
reported as skipped, never passed, unless `spec emit` / `spec run` get
`--slow`; say so when a run reports a skip. A truncated result (RFC 4231
test case 5, the first 128 bits of the HMAC) is a plain row whose Expected
is the printed, truncated value, plus a `Truncate: <id> to 128 bits` (or
`to 16 bytes`) paragraph after the vector table; see
tests/fixtures/profile/profile-truncate.md. The cited section must print the
length with that unit, the Expected must be exactly that long, and the
function must return bytes; a result shorter than the length fails.
