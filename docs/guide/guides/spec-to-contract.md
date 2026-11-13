# From a spec to a contract

`vector spec` turns a specification into a **contract**, and the contract
into a Nish test that checks an implementation against it. Nobody writes a
contract by hand. You write the spec in
[kramdown-rfc](https://github.com/cabo/kramdown-rfc) markdown, the IETF tools
build it into RFC XML v3, and vector *extracts* the contract from that XML:

```
specs/<name>.md ─▶ kramdown-rfc ─▶ xml2rfc --v2v3 ─▶ specs/<name>.xml ─▶ vector spec extract ─▶ contracts/<name>.json
                   └──────────── scripts/build-spec.sh ────────────┘
```

Then `vector spec check` runs the contract's gates, and Z3 picks the samples
its properties are tested at. vector calls no model: a model (or you) writes
the spec, and deterministic code decides whether it is faithful.

This page walks the pipeline with the committed example, `specs/example-hex.md`.
[Writing a spec](writing-a-spec.md) describes what a spec may say;
[Testing an implementation](testing.md) runs the contract's test.

## What a contract holds

A contract ([`schemas/rfc-contract.json`][schema], described in
[the RFC contract format](../../reference/formats/rfc-contract.md)) has:

- **requirements**: verbatim quotes, each cited to a section and a BCP 14 level
  (or `DEFINITION`);
- **exclusions**: the MUST and SHALL sentences a functional test cannot observe
  (nonce uniqueness, constant-time comparison), each with its reason;
- **functions**: the implementation's signatures, plus any reference function
  from another module that a property may call;
- **clauses**: **vectors** (known answers, each saying where its expected value
  comes from) and **properties** (`forall` a typed domain, `where` restricts
  it, `assert` must hold).

## 1. Build the XML

`scripts/build-spec.sh` runs only with kramdown-rfc 1.7.43 and xml2rfc 3.35.0,
since the committed XML can only be reproduced with the exact tools that made
it. With any other version, or none, it exits 2 and prints how to install
them:

<!-- illustrative -->
```sh
gem install kramdown-rfc -v 1.7.43 --no-document
pip install xml2rfc==3.35.0
```

The edit loop is: edit the `.md`, rebuild, re-extract, and commit all three.
Rebuilding needs the pinned tools above:

<!-- illustrative -->
```sh
scripts/build-spec.sh specs/example-hex.md     # writes specs/example-hex.xml
```

Extract writes the contract and prints nothing when it succeeds; on a
committed spec it reproduces the committed contract byte for byte:

```sh
./dist/vector spec extract specs/example-hex.xml -o contracts/example-hex.json
git diff --exit-code contracts/example-hex.json && echo "unchanged"
```

```text
unchanged
```

Then commit the three files:

<!-- illustrative -->
```sh
git add specs/example-hex.md specs/example-hex.xml contracts/example-hex.json
```

`build-spec.sh [--fetch] [--check] <spec.md>` writes `<name>.xml` beside the
`.md`, and renders it with `xml2rfc --text` and `--html` as a check (the
renderings are thrown away). It runs offline: kramdown-rfc reads references
only from the committed `.refcache/`, `{::include}` is disabled, and xml2rfc
runs with `--no-network`. A spec that cites a reference not yet in the cache
fails; run once with `--fetch`, then review and commit the `.refcache/` diff.

- **Warnings are errors.** Any kramdown-rfc `*** ` or `** ` line (an unknown
  front-matter key, a missing reference, bad heading nesting) and any xml2rfc
  `Warning:` or `Error:` line fails the build. Three cosmetic xml2rfc warnings
  are silenced: long lines, table width, and the document date.
- **The date is pinned.** The front matter must pin `date:` as `YYYY-MM-DD`,
  or every rebuild on another day would drift.
- **`--check`** rebuilds to a temporary file and diffs it against the
  committed XML, ignoring comments and processing instructions.

It exits 0 when the XML was built or has not drifted; 1 on drift, a warning,
or a render failure; and 2 on a usage error, a missing input, or the wrong
tools.

## 2. Extract the contract

`vector spec extract <spec.xml> [-o <contract.json>] [--check]` reads the XML.
Without `-o` it writes the contract to stdout, with its relative paths
(`$schema`, the sources) taken as if it were at `contracts/<name>.json` beside
the spec's `specs/`:

```sh
./dist/vector spec extract specs/example-hex.xml | head -n 4
```

```text
{
  "$schema": "../schemas/rfc-contract.json",
  "contract": "example-hex",
  "source": {
```

With `-o` it writes that file. `--check` needs `-o` and writes nothing: it
exits 0 when the file is what the spec extracts to, and otherwise prints a
unified diff and exits 1 (a missing file counts as empty). CI runs it for
every committed spec:

```sh
./dist/vector spec extract specs/example-hex.xml -o contracts/example-hex.json --check
```

Extract reads only XML. Given the markdown, it says to build it first:

<!-- exit 2 -->
```sh
./dist/vector spec extract specs/example-hex.md -o contracts/example-hex.json
```

```text
vector: spec extract: build it first: scripts/build-spec.sh specs/example-hex.md
```

It refuses everything it cannot read, all at once, each refusal at
`file:line`. Where the XML carries kramdown-rfc's `<?line?>` marks, a refusal
names the markdown the XML was built from, `specs/<name>.md` beside it, at the
markdown line; otherwise it names the XML at the XML line, so a refusal never
names a file that is not there. Here a BCP 14 sentence is added to the XML
with no anchor and no `Untested:` paragraph:

<!-- exit 1 -->
```sh
sed -i 's|return an empty array, not null.</t>|&\n<t>hexDecode <bcp14>MUST</bcp14> be fast.</t>|' specs/example-hex.xml
./dist/vector spec extract specs/example-hex.xml -o contracts/example-hex.json
```

```text
vector: specs/example-hex.md:131: BCP 14 sentence has no anchor and no Untested: paragraph after it: "hexDecode MUST be fast."
```

```sh
git checkout -q specs contracts
```

Extract also runs `spec check`'s gates (without `--run-sources`); a gate's
refusal about `allowSurvivors` names the sidecar file instead. It exits:

- 0: the contract was written or printed, or with `--check` is up to date;
- 1: one or more refusals, or with `--check` a difference;
- 2: a usage error, an unreadable file (the sidecar included), a missing RFC
  (with the `curl` command that fetches it), or a z3 failure.

The output is canonical: schema key order, a 2-space indent and a trailing
newline, so a rebuild changes only what the spec changed. Extract fills in the
main `source.sha256` and each RFC source's `file` and `sha256` from the bytes
it read, so there is no separate freeze step. `allowSurvivors` lives beside the
contract in `contracts/<name>.survivors.json` (`{"allowSurvivors": [...]}`)
and is merged in verbatim; see [`spec mutate`](pr-gates.md#mutate). `-o` may
name neither the spec it reads nor a `*.survivors.json` sidecar.

## 3. Check the contract

`vector spec check <contract.json>` runs the gates and prints the contract's
dashboard. It exits 0 when the contract is valid (`CONTRACT_VALID`), 1 when a
gate refuses it (`INVALID`), and 2 on a usage error, an unreadable file or a
z3 failure:

```sh
./dist/vector spec check contracts/example-hex.json
```

```text
── VECTOR RFC CONTRACT ─────────────────────────────────────────
 example-hex · example-hex (Spec 0001: nish/hex — hexadecimal encoding and decoding) · nish/hex
 Status: CONTRACT_VALID

 Requirements
  ○ R-ENC-LEN  §3.1 MUST  "hexEncode MUST return exactly two characters per input byte."
      ○ V5  ○ P-ENC-LEN (29 samples: 5 boundary)
…
```

Its warnings end the report. Here two vectors take their expected value from
a command, which `check` does not run unless asked, and no module source was
given, so the signatures were not checked:

```sh
./dist/vector spec check contracts/example-hex.json | grep '^  !'
```

```text
  ! V5.source: source command not run (pass --run-sources): the expected value is unverified: $ python3 -c 'print(bytes([0,15,240,255]).hex())'
  ! V6.source: source command not run (pass --run-sources): the expected value is unverified: $ python3 -c 'print(bytes.fromhex("aBcD").hex())'
  ! signatures: no module source: signatures were not checked (pass --module or --nish-root)
```

A contract edited by hand fails. Changing one word of a quote breaks both
fidelity (the quote is no longer in its section) and completeness (the
section's sentence is no longer quoted), and `check` exits 1:

<!-- exit 1 -->
```sh
sed -i 's/MUST return exactly two characters/MUST return exactly 2 characters/' contracts/example-hex.json
./dist/vector spec check contracts/example-hex.json | sed -n '3,7p'
```

```text
 Status: INVALID

 Gate failures
  ✘ fidelity R-ENC-LEN: quote not found in §3.1 ("Length"): "hexEncode MUST return exactly 2 characters per input byte."
  ✘ completeness §3.1: MUST sentence is neither a requirement nor an exclusion: "hexEncode MUST return exactly two characters per input byte."
```

Put the contract back:

```sh
git checkout -q contracts
```

### Flags

| Flag | What it does |
|---|---|
| `--spec <file>` | the main source's file, read directly (a spec's XML, or an RFC's `.txt` or `.xml`) |
| `--run-sources` | run each vector's `command` source and compare what it prints (see below) |
| `--module <file>` | the module source the signatures are checked against |
| `--nish-root <dir>` | a nish checkout or install, whose `std/` holds the module under test |
| `--format <f>` | `text` (the default), `markdown` for a PR comment, or `json` |

`--format markdown` prints the dashboard for a PR comment: each requirement's
quote, then a table of its clauses with their outcome and evidence:

```sh
./dist/vector spec check contracts/example-hex.json --format markdown | head -n 7
```

```text
## ✅ example-hex: CONTRACT_VALID

example-hex (Spec 0001: nish/hex — hexadecimal encoding and decoding) · target `nish/hex`

### Requirements

#### R-ENC-LEN · §3.1 MUST · ⭕ checked, not run
```

With `--nish-root`, check also compares each declared signature with the
module's export. The pinned compiler in `.nish/` is a nish install whose
`std/` holds the HKDF module, so the HKDF contract checks against it with no
warnings:

```sh
out=$(./dist/vector spec check contracts/rfc5869-hkdf-sha256.json --nish-root .nish); echo "exit $?"
printf '%s\n' "$out" | grep '^  !' || echo "no warnings"
```

```text
exit 0
no warnings
```

### Running the source commands

A vector whose expected value comes from a command (`` `python3 -c '…'` `` in
the spec's Source cell) is reported as not run, never as passed, until you
pass `--run-sources`:

```sh
./dist/vector spec check contracts/example-hex.json --run-sources | grep -A 2 'Vector sources run'
```

```text
 Vector sources run
  ✓ V5: $ python3 -c 'print(bytes([0,15,240,255]).hex())'
  ✓ V6: $ python3 -c 'print(bytes.fromhex("aBcD").hex())'
```

Each command runs as `sh -c` from the contract's directory, under
`timeout -s KILL`, for at most 30 seconds. Its trimmed stdout must be the
expected value (bytes as hex, compared case-blind). A timeout, a nonzero exit
or other output fails the provenance gate.

**`--run-sources` is not a sandbox.** The commands come from the contract, and
they run as you, with your environment, files and network. `timeout` puts each
command in its own process group and kills the whole group at the deadline,
so a forked grandchild dies with it. But only the deadline kills the group: a
command that exits in time can leave a background child running, and a
process that leaves the group on purpose, with `setsid`, is never contained.
Read every command before you pass the flag, above all in a contract you did
not write. When the contract is not in the `contracts/` at the top of the git
repository you run from (`git rev-parse --show-toplevel`), check prints the
commands on stderr before it runs them. Outside a git repository every
contract with commands gets the warning:

```sh
mkdir review && cp contracts/example-hex.json review/
./dist/vector spec check review/example-hex.json --run-sources 2>&1 >/dev/null
```

```text
warning: --run-sources runs 2 shell command(s) from review/example-hex.json, which is not in /path/to/vector/contracts/.
They run as you, with sh -c, from the contract's directory, with your environment, files and network. A timeout kills each command's process group, but not a process it detached with setsid. Read them first:
  [V5] $ python3 -c 'print(bytes([0,15,240,255]).hex())'
  [V6] $ python3 -c 'print(bytes.fromhex("aBcD").hex())'
```

## The gates

No model is involved in any of them.

| Gate | Refuses |
|---|---|
| shape | a contract that is not well formed, including free text (titles, quotes, reasons) with a line break or another control character |
| fidelity | a quote not in its cited section; a vector's value not printed in its section as a whole value, under the label it is printed under (see [What a printed value is](writing-a-spec.md#what-a-printed-value-is)); values from two test cases; a source whose bytes no longer match its pinned SHA-256 |
| completeness | any MUST, MUST NOT, SHALL, SHALL NOT or REQUIRED sentence of the main source that is neither inside a requirement's quote nor an exclusion's |
| provenance | a `spec` source whose section never states the expected `null` or bool (see [When a section states null, true or false](writing-a-spec.md#when-a-section-states-null-true-or-false)); a `command` source that failed under `--run-sources` |
| coverage | a binding requirement no clause checks; a clause citing a requirement the contract does not state; a property or vector that calls no function under test |
| typing | an ill-typed call or expression (`bytes?` and `string?` must be `unwrap`ped; `where` may not call the implementation; a `let` may not shadow a name or bind a bare `null`) |
| signatures | a declared signature that is not the module's export (with `--nish-root` or `--module`) |
| domain | a property whose domain is empty (Z3 says `unsat`: it would pass vacuously) |

Then **Z3 picks the samples**. For every integer comparison in a property it
solves for inputs on the edge and one either side (`n <= 255*32` gives
`n = 8159, 8160, 8161`), plus each variable's extremes, and a seeded PRNG adds
random ones. The samples are baked into the generated test, so a failure
reproduces byte for byte.

## Sources

A contract cites one or more documents. A source is RFC XML v3 (`.xml`) or an
RFC's plain text (with its `Request for Comments: N` header and form feeds);
anything else is refused. `.xml` sources are read everywhere a source is: by
extract, check, emit, run, mutate and frozen.

- **Linked RFCs** (`{"id": "rfc4648", "rfc": 4648}`) are looked up in four
  places, nearest first, the same for every command (`extract`, `check`,
  `emit`, `run`, `mutate`):
  1. beside the contract;
  2. the contract's `../rfcs/`;
  3. the `rfcs/` of vector's install root, the directory above the binary's
     own (`<root>/dist/vector` reads `<root>/rfcs/`);
  4. the current directory's `rfcs/`.

  At each place `rfc<N>.xml` is read, and preferred over `rfc<N>.txt`, when it
  exists. Once a contract records a source's `file`, that name wins, and its
  recorded `sha256` must still match.
- **A missing RFC** exits 2 with the command that fetches its plain text,
  `curl -sSfL -o rfcs/rfc<N>.txt https://www.rfc-editor.org/rfc/rfc<N>.txt`.
  The `.txt` works for every RFC; drop in `rfc<N>.xml` too and it is read
  instead.
- **Paths are input from anyone.** Every command that reads a contract
  (`check`, `emit`, `run`, `mutate`) requires a `sources[].path` to lead,
  symlinks followed, to a file beside the contract or under a `specs/` or
  `rfcs/` beside the contract's directory, its parent or its grandparent, or
  in the install root or the current directory, with no hidden directory
  (`.git`, `.ssh`, `.env`) on the way. Anything else is a usage error before
  the file is read. `--spec` is not limited: that
  path comes from you.

## When z3 fails

`check`, `extract`, `emit` and `mutate` need z3 to pick samples and to decide
whether a domain is empty. When it is missing or fails, they exit 2, since
nothing was decided about the contract:

<!-- exit 2 -->
```sh
VECTOR_Z3=/nonexistent ./dist/vector spec check contracts/example-hex.json
```

```text
vector: spec check: VECTOR_Z3 is /nonexistent, which is not a file
```

See [Exit codes and tool failures](exit-codes.md) for where vector looks for
z3.

[schema]: https://github.com/amritk/vector/blob/main/schemas/rfc-contract.json
