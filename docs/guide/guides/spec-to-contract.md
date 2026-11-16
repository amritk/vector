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

### An iterated vector

A vector may carry `iterate`, for a value its section prints after calling
the function many times over (RFC 7748 §5.2: X25519 1,000 and 1,000,000
times). The vector's `args` start it, and each step feeds the step before
back in:

```json
"call": "x25519",
"args": [{"hex": "0900…"}, {"hex": "0900…"}],
"expect": {"hex": "684c…", "label": "After 1,000 iterations"},
"iterate": {
  "count": 1000,
  "names": ["k", "u"],
  "next": [{"call": "x25519", "args": [{"var": "k"}, {"var": "u"}]}, {"var": "k"}]
}
```

- **count** is how many times the function is called, 1 to 1,000,000,000.
  The vector passes when the last call returns `expect`, exactly: an iterated
  vector takes no `tolerance`, and its `expect` is never `null` or a bool.
- **names** gives each parameter a name, in order, for one step's arguments.
  A name is an identifier, appears once, and is no function's name.
- **next** gives each parameter its argument for the following step: one of
  the names (that step's argument, carried over) or the call on the names in
  order (that step's result). At least one element is the call, or nothing
  feeds the result back. Each element must be its parameter's type: the call
  feeds a parameter of the return type (a nullable result its base type, and
  `bytes` and `secret-bytes` interchange), a name a parameter of its own
  parameter's type.
- **slow** (`true`, or left out) marks a count too long to run on every test
  run. `spec emit` and `spec run` skip a slow vector, with the reason `slow:
  pass --slow to run`, unless `--slow` is passed; see [Slow
  vectors](testing.md#slow-vectors).

`spec check` binds the count to the cited section:

- The section prints it as a whole number, outside a heading: `1,000` and
  `1000` both count. A number is a whole token: one inside a word or a name
  (`a1000`, `X25519`, `SHA-256-128`, `5.2`) is none, nor is a malformed
  group (`1,00`, `10,00,000`), nor a heading's number, read as the RFC's
  sections are (`5.2.  Test Vectors`, `A.2.  Test Case 2`, `Appendix A.`). A
  `-` after a number and any non-ASCII character end it, so `1,000-iteration`
  and `5,000–6,000` count.
- The expected value's label counts the count. The number it counts is the
  one before `iteration`, `iterations` or `times`, else the label's only
  number; with two or more numbers and neither word, the label is not
  checked. A label that counts another number is refused (`the expected
  label "After 1,000 iterations" counts 1,000, but the vector iterates 2,000
  times`).
- The count is the only number exempt from the variant rule, and only when a
  word names it: every copy of the number before `iteration`, `iterations` or
  `times` is left out when the label is compared with the labels beside it,
  and a label with no such word (`X448 1,000`, `X448 after 1,000 rounds`) is
  compared whole, its only number included. So beside `X25519 after 1,000
  iterations`, a value printed under `X448 after 1,000 iterations` is still
  refused for a call to `x25519`, while `After 1,000,000 iterations` is not
  a variant of `After 1,000 iterations`.

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
`file:line`, or `file:line:col` when it knows the column (a malformed literal
in a test vector's cell, a parse error in the `ts-interface` block, malformed
XML). A refusal names the markdown the XML was built from, `specs/<name>.md`
beside it, only at a line the XML vouches for. kramdown-rfc marks the XML with
`<?line N?>` only where a part starts (the abstract, the middle, the back),
not at every paragraph, and tables and other multi-line constructs move the
lines after a mark apart. So a refusal on the line of a mark names
the markdown line alone; any other names the markdown line of the last mark
before it, with the XML line it is exactly on beside it:

```text
specs/<name>.md:<last mark's line> (specs/<name>.xml:<line>[:col])
```

The column, when there is one, counts along the XML line, so it is printed
with an XML line and never with a markdown line alone. A refusal before any
mark, past the end of the markdown, or with no markdown beside the XML names
the XML alone, so a refusal never names a file that is not there or a line
that is not in it. A refusal that cites a second place, such as an anchor used
twice or a closing tag that does not match, prints it the same way. Here a
BCP 14 sentence is added to the XML with no anchor and no `Untested:`
paragraph:

<!-- exit 1 -->
```sh
sed -i 's|return an empty array, not null.</t>|&\n<t>hexDecode <bcp14>MUST</bcp14> be fast.</t>|' specs/example-hex.xml
./dist/vector spec extract specs/example-hex.xml -o contracts/example-hex.json
```

```text
vector: specs/example-hex.md:21 (specs/example-hex.xml:140): BCP 14 sentence has no anchor and no Untested: paragraph after it: "hexDecode MUST be fast."
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
| shape | a contract that is not well formed, including free text (titles, quotes, reasons) with a line break or another control character; an `iterate` whose names or next do not match the parameters (see [An iterated vector](#an-iterated-vector)) |
| fidelity | a quote not in its cited section; a vector's value not printed in its section as a whole value, under the label it is printed under (see [What a printed value is](writing-a-spec.md#what-a-printed-value-is)); values from two test cases; an iterated vector's count not printed in its section, or a label that counts another number; a source whose bytes no longer match its pinned SHA-256 |
| completeness | any MUST, MUST NOT, SHALL, SHALL NOT or REQUIRED sentence of the main source that is neither inside a requirement's quote nor an exclusion's |
| provenance | a `spec` source whose section never states the expected `null` or bool (see [When a section states null, true or false](writing-a-spec.md#when-a-section-states-null-true-or-false)); a `command` source that failed under `--run-sources` |
| coverage | a binding requirement no clause checks; a clause citing a requirement the contract does not state; a property or vector that calls no function under test |
| typing | an ill-typed call or expression (`bytes?` and `string?` must be `unwrap`ped; `where` may not call the implementation; a `let` may not shadow a name or bind a bare `null`); an `iterate.next` element of the wrong type for its parameter |
| signatures | a declared signature that is not the module's export (with `--nish-root` or `--module`) |
| domain | a property whose domain is empty (Z3 says `unsat`: it would pass vacuously) |

Then **Z3 picks the samples**. For every integer comparison in a property it
solves for inputs on the edge and one either side (`n <= 255*32` gives
`n = 8159, 8160, 8161`), plus each variable's extremes, and a seeded PRNG adds
random ones. The samples are baked into the generated test, so a failure
reproduces byte for byte.

A property gets every boundary sample plus 24 random, at most 96 in all,
unless its block's line 2 says `// samples: N`. Then N, from 1 to 256, is
the total: the boundaries first, at most N of them, then random draws until
there are N, within N × 20 tries. A domain with fewer than N inputs, or a
`where` that refuses most draws, gives what it found, and `spec check`
notes `asked for N samples; found M`. Extract refuses
a count outside 1..256 (`samples must be 1..256, not 0`), one that is not
plain digits, and a samples line anywhere but line 2, each at its line.
Any comment in a ts-property block whose first word is `samples` counts as
a samples line, prose included, so word such a comment another way.

## Sources

A contract cites one or more documents. A source is RFC XML v3 (`.xml`) or an
RFC's plain text (with its `Request for Comments: N` header and form feeds);
anything else is refused. `.xml` sources are read everywhere a source is: by
extract, check, emit, run, mutate and frozen.

- **Linked RFCs** (`{"id": "rfc4648", "rfc": 4648}`) are looked up in four
  places, nearest first, the same for every command (`extract`, `check`,
  `emit`, `run`, `mutate`, and `frozen`, which reads a contract's sources the
  same way):
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

## Worked example: an iterated vector

RFC 7748 §5.2 prints k after 1, 1,000 and 1,000,000 calls of X25519 from
k = u = 9, and nothing in between. The spec in
`tests/fixtures/rfc7748/specs/rfc7748-iterated.md` states the 1,000- and
1,000,000-iteration vectors as rows like the 1-iteration one: Call holds
the starting arguments, Expected the final k. An `Iterate:` paragraph after
the table says how often to call, and how each step's result feeds the next:

```md
| 5.2-ITER-1000 | `x25519(For X25519 = 0900…00, For X25519 = 0900…00)` | `After 1,000 iterations = 684cf59b…2c51` | R-ITER | {{Section 5.2 of RFC7748}} | RFC 7748 5.2: 1,000 iterations from k = u = 9 |

Iterate: 5.2-ITER-1000 1,000 times, (k, u) <- (x25519(k, u), k)

Iterate: 5.2-ITER-1M 1,000,000 times, slow, (k, u) <- (x25519(k, u), k)
```

(The row's hex is shortened here; the spec prints all 32 bytes.) `(k, u) <-
(x25519(k, u), k)` is the RFC's sentence "set k to be the result of calling
the function and u to be the old value of k", which the spec quotes as
R-ITER. Extracting it gives the vector an
[`iterate`](#an-iterated-vector), and the 1,000,000 one `"slow": true`:

```json
"iterate": {
  "count": 1000,
  "names": ["k", "u"],
  "next": [{"call": "x25519", "args": [{"var": "k"}, {"var": "u"}]}, {"var": "k"}]
}
```

Running it against a reference X25519 calls the function 1,001 times, once
for 5.2-ITER-1 and 1,000 times for 5.2-ITER-1000, and skips the slow vector:

```sh
./dist/vector spec run tests/fixtures/rfc7748/contracts/rfc7748-iterated.json \
  --package fixture=tests/fixtures/x25519/fixture --nish-root .nish
```

```text
SATISFIED: rfc7748-iterated (exit 0)
  pass  R-FUNC
  pass  R-ITER
  skip  5.2-ITER-1M (slow; pass --slow)
```

R-ITER passes because both 5.2-ITER-1 and 5.2-ITER-1000 return the printed
k. With `--slow` the 1,000,000-iteration vector runs too, which takes about
two minutes rather than about three seconds.

A vector is compared with its expected value whole, so a result the RFC
prints truncated (RFC 4231 test case 5, the first 128 bits of the HMAC)
still cannot be compared: exclude it with `Untested:`.

[schema]: https://github.com/amritk/vector/blob/main/schemas/rfc-contract.json
