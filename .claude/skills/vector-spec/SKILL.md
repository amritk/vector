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

`vector rfc` is the same command under its old name.

**You** write the spec. **`vector spec extract`** writes the contract from it.
**The RFC text and Z3 hold the veto**, and **nish runs the test.** Never write
or edit `contracts/<name>.json` by hand: change the spec, rebuild, and
re-extract. You never decide that a quote or a vector is right; extract and
`check` do, against the cited text. Every gate below is deterministic and fails
closed: a git error, a missing source, an unreadable diff or a Z3 `unknown` is
a failure, never a pass. A FAIL is a finding about the implementation (or the
spec). Show it, and never weaken a clause to pass.

Exit codes, for every command: **0** pass, **1** refused (extract's refusals,
`INVALID`, `VIOLATED`, `ERROR`, a stale test, an unlisted export, a survivor),
**2** a usage error, a missing file or RFC, the wrong build tools, or a git
error.

The README's [Writing a spec (kramdown-rfc)](../../../README.md#writing-a-spec-kramdown-rfc)
is the reference for every construct below.
`test/fixtures/profile/profile-hex.md` is a spec that uses all of them.

## The PR workflow, in order

A module lands in two PRs. The first is the **spec side** (`specs/`,
`contracts/`, `rfcs/`, and generated tests in `test/spec/`); the second is the
**implementation**. `frozen` refuses a PR that touches both, so a test can
never be loosened in the PR that changes the code it tests. Do the steps in
this order; each one's command is the gate CI runs.

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
must say what is asked for, not what some code does.

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

The boilerplate is the first paragraph of `# Introduction`. Then add these
parts.

**One interface block.** It is the contract's `target` and `functions`, so
keep it to the module's exports:

````
~~~ ts-interface
// module: nish/hex
export const hexEncode = (bytes: u8[]): string
export function hexDecode(text: string): u8[] | null
~~~
````

The types are `u8[]`, `string`, `i32`, `u32`, `boolean` and `Secret<u8[]>`.
Add `| null` to `u8[]` or `string`, and to `Secret<u8[]>` as a result only.

A property may compare the module with another nish module (HKDF with
HMAC). Declare that module's functions after a second `// module:` line,
below the module under test's own; they are reference functions, not exports:

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
accepted there.

```
hexEncode MUST return exactly two characters per input byte.
{: #R-ENC-LEN}

Definition: a hex digit is one of the characters 0-9, a-f and A-F.
{: #R-DEF-DIGIT}
```

**Quotes from an RFC** go in a blockquote. The last line of the blockquote is
the citation, and the attribute must include `gi="blockquote"`. The quote must
appear verbatim in that section of the RFC.

```
> BASE16("f") = "66"
> {{Section 10 of RFC4648}}
{: #R-RFC-VECTORS gi="blockquote"}
```

**Exclusions.** Some BCP 14 sentences cannot be observed by a functional
test: caller obligations, timing, key management. Follow each one directly
with an `Untested:` paragraph that gives the reason and, where it exists, what
checks it instead. That sentence can be a requirement or an unanchored
paragraph. A requirement followed by `Untested:` becomes an exclusion: no
vector's Covers and no property may name it.

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
`specs/rfc8439-chacha20-poly1305.md` are worked examples. `spec check --spec`
takes the main source's text, so for such a spec pass the RFC or leave it out.

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
  - `concat(a, b, …)`: one level, all parts bytes. Never `‖`.
- **Source** says where the expected value comes from:
  - `{{Section N of RFCx}}`: the value is printed there. Prefer this.
  - `{{anchor}}`: a numbered section of this spec. For a `null` or `bool`
    expected value it is a `spec` source (the covered requirement states it);
    for any other value it is a `cite` of that section, which must print the
    value.
  - A code span holding a command: the value is its trimmed stdout, so the
    Expected cell must be bytes or a string.
- **Values from an RFC:**
  - Each one is a *whole* printed value, never a prefix or a tail.
  - Take the arguments and the expected value from one test case.
  - Where a case is printed for several variants, use the row whose number
    is in the function's name.
  - The README's "What a printed value is" and "When a section states
    `null`, `true` or `false`" give the full rules.

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

Write the spec's definitions as checks over a typed domain:

- lengths;
- bounds written as integer comparisons (Z3 samples both sides of each);
- round trips;
- tamper rejection;
- the construction rebuilt from other functions.

Use the README's ts-property list for the subset: operators, operations,
`where`, and the forms that are refused. Remember that its semantics are
vector's, not JavaScript's. For example, `.slice` clamps, `a % 0` is 0, and
`===` on bytes compares contents.

**Linked RFCs.** The RFC text must be in `rfcs/`, unmodified. The IETF Trust
allows copying an RFC whole. Extract's missing-RFC message gives the `curl`
command: `rfc<N>.xml` for N ≥ 8700, `.txt` below 8650, and both between.
The lookup goes nearest place first (beside the contract, `../rfcs/`, then
vector's `rfcs/`), and at each place `.xml` before `.txt`. A `file` the
contract already records wins: adding an `.xml` later does not displace a
recorded `.txt`, and `check` and `frozen` verify the recorded bytes.

### 2. Build, extract, `check`

```bash
scripts/build-spec.sh specs/<name>.md         # writes specs/<name>.xml
bun run vector spec extract specs/<name>.xml -o contracts/<name>.json
bun run vector spec check contracts/<name>.json --run-sources
```

**build-spec.sh**

- It runs offline against the committed `.refcache/`. The first time the spec
  cites a reference, add `--fetch`, then review and commit the `.refcache/`
  diff.
- Warnings are errors. Fix the markdown until it builds clean.

**extract**

- It lists every refusal at once, each as `file:line`. The file is the XML;
  the line is the `.md` line when the XML carries `<?line?>` marks, otherwise
  the XML line. The line can run late after a table.
- Repair the **spec**, never the contract. Then rebuild and re-extract until
  it exits 0.
- It runs `check`'s gates: fidelity, completeness, coverage, provenance,
  typing and domain.
- It fills in every `sha256`, so there is no freeze step to do by hand.
- `-o` writes the contract; without it, the contract goes to stdout.
  `--check -o contracts/<name>.json` writes nothing and exits 1 with a diff
  when the committed contract is not what the spec states. A refusal about
  `allowSurvivors` names the sidecar, not the XML.

**check --run-sources** runs the `command` sources. Read every command before
you pass `--run-sources`: it runs on your machine, as you, with your files and
network. On Linux nothing it starts outlives it; elsewhere, a process it
detaches with `setsid` outlives the 30 s timeout. With no module yet, `check`
warns that signatures were not checked. That is expected here: `run
--nish-root` (step 5) checks them against the implementation.

Commit `specs/<name>.md`, `specs/<name>.xml` and `contracts/<name>.json`
together. Then show the spec to
a human for approval. **The reviewer confirms that:**

- each `ts-property` says what the prose it covers says, no more and no less;
- each `Untested:` reason is true, and what it says checks the sentence
  really does.

Nothing after this step may change the spec.

### 3. Freeze

```bash
bun run vector spec frozen --base origin/main contracts/<name>.json
```

Run it last, after step 4's `emit` and `stale`, so it sees the whole PR.

- **Exit 0:** the PR is all spec side, and every contract source still hashes
  to its recorded `sha256`.
- **Exit 1:** one of these:
  - the PR also touches implementation files;
  - the spec or a linked RFC changed under the contract;
  - a `sha256` is missing;
  - no contract was found.

From here, the spec and contract change only in a PR of their own.

### 4. Emit the test, and keep it fresh

```bash
bun run vector spec emit contracts/<name>.json -o test/spec/<name>.ts
bun run vector spec stale test/spec/<name>.ts contracts/<name>.json
```

`emit` writes `// vector-contract-sha256: <hex>` into the test's header.
`stale` exits 1 when that line names other bytes than the contract's, or is
missing, or appears twice. In a repository that does not install vector,
`node scripts/spec-stale.mjs <test> <contract>` is the same check with the
same exit codes. A test in `test/spec/` counts as spec side only while
`stale` passes it.

### 5. Implement, then `run`

The implementation PR touches the code and nothing on the spec side
(`frozen` refuses it otherwise). Then:

```bash
bun run vector spec run contracts/<name>.json --nish-root ../nish [--format markdown]
```

It re-runs every `check` gate, now including the signature gate against the
module, then runs the test.

- **Exit 0** is `SATISFIED`: every clause passed.
- **Exit 1** is `VIOLATED` (a clause failed, shown with its sample) or
  `ERROR` (the test did not build, or finished early).

`--nish-root` uses `build/nish`, which tests the working tree's std. Without
it, the seed tests the last release's std and warns.

### 6. Check the exports

```bash
bun run vector spec exports contracts/<name>.json --nish-root ../nish --base origin/main
```

Every export the diff adds to or changes in the target module must be a
function the contract tests. Exit 1 names each one that is not.

A spec cannot declare `outOfScope` exports yet: the profile has no construct
for them. When `exports` fails, either drop the export from the
implementation, or add the function to the spec, with a clause that tests it,
in a spec-side PR.

### 7. Mutate the diff

```bash
bun run vector spec mutate contracts/<name>.json --nish-root ../nish --base origin/main \
  [--jobs N] [--max N] [--format markdown]
```

It mutates only the module's lines changed since `--base`, and runs the test
against each mutant. A survivor is printed with its `file:line`, its mutated
line, and *behaviour no requirement pins down*, and the command exits 1. Kill
the survivor with a property or vector the spec supports. Or, in a spec-side
PR, allow it with a reason in `contracts/<name>.survivors.json`:

```json
{ "allowSurvivors": [{ "file": "std/hex.ts", "line": 42, "reason": "…" }] }
```

Then re-extract, which merges that file in verbatim. Re-run `emit`, `stale`
and `frozen` too (`frozen` skips `*.survivors.json` sidecars), because the contract's bytes changed. Survivors are usually
found by the implementation PR's `mutate` run, but the allow-list still
belongs in a spec-side PR.

`mutate` also exits 1 in these cases:

- there are zero mutants;
- every mutant is stillborn;
- the test fails on the unmutated module.

### 8. Report

Post the dashboard: `--format markdown` on `check`, `run` and `mutate` gives a
PR comment. It shows:

- each requirement with its evidence;
- the exclusions;
- command sources that were not run;
- every survivor;
- any failure, with its sample.

## Without a PR

To check an existing module against an RFC (nish's std/crypto), do these
steps:

1. Write the spec (step 1). Here you may read the module for its signatures.
2. Build and extract it (step 2).
3. `check` it, passing `--module <src.ts>` or `--nish-root` so the signature
   gate runs.
4. `run` it (step 5).

## Limits — say them

A passing contract is evidence, not proof. Properties are sampled (Z3
boundaries plus seeded random), not quantified. A `command` source is only as
good as the command. Timing, secret wiping and other non-functional MUSTs are
excluded and must be checked elsewhere (nish's ct-asm/ct-timing and wipe
tests).
