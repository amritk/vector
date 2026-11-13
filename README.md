# vector — formally verified functions, written in Claude Code

vector is a judge for code a model writes. It does two jobs, and it never
calls a model itself. Claude Code, through the bundled skills and your Claude
subscription, does the writing. vector checks it, so you need no API key.

1. **Verified functions.** Claude Code turns a request such as "convert USD to
   EUR at 0.91, and throw on negatives" into a contract and a program. The Z3
   solver then **proves** that every postcondition holds for **all** inputs.
   Only proven code is written out as TypeScript.
2. **Spec conformance.** You write a spec for a nish module, or for the RFC it
   implements, in kramdown-rfc markdown. vector reads a **contract** out of it.
   Every quote is checked against the RFC it cites, every test vector says
   where its expected value comes from, and every MUST is tested or
   explicitly excluded. Then vector compiles the contract to a Nish test.

The idea comes from Dijkstra's EWD249: *"testing can show the presence of
bugs, but never their absence"*.

## One of each file

The examples below are real excerpts from this repository.

### Verified functions

**1. SpecPlan** (`test/fixtures/currency-spec.json`). This is the formal
contract: axioms, and the units that must satisfy them.

```json
{
  "programName": "usd_to_eur_converter",
  "axioms": [
    { "id": "AX1", "kind": "pre", "statement": "The USD amount must be non-negative (throws if amount < 0)." },
    { "id": "AX2", "kind": "post", "statement": "For all amount >= 0, the result equals amount times 0.91." },
    { "id": "AX-RATE", "kind": "pre", "statement": "The exchange rate applied must be strictly positive." },
    { "id": "AX2a", "kind": "post", "statement": "Applying a rate to an amount yields amount times rate." },
    …
  ],
  "units": [
    { "name": "applyRate", "layer": 1, "purpose": "Multiply an amount by a positive exchange rate.",
      "params": [{ "name": "amount", "type": "Real" }, { "name": "rate", "type": "Real" }],
      "returnType": "Real", "relevantAxiomIds": ["AX-RATE", "AX2a"] },
    …
  ]
}
```

**2. Program** (`test/fixtures/currency.json`). This is the implementation
and its contract in vector-lang, a small expression AST that Z3 can reason
about. The excerpt is one entry of the file's `functions` list, without its
`purpose`.

```json
{ "programName": "usd_to_eur_converter", "functions": [
{
  "name": "applyRate", "layer": 1,
  "params": [{ "name": "amount", "type": "Real" }, { "name": "rate", "type": "Real" }],
  "returnType": "Real",
  "requires": [{ "axiomId": "AX-RATE",
    "expr": { "kind": "binop", "op": ">", "left": { "kind": "var", "name": "rate" }, "right": { "kind": "num", "value": "0" } } }],
  "ensures": [{ "axiomId": "AX2a",
    "expr": { "kind": "binop", "op": "==", "left": { "kind": "var", "name": "result" },
              "right": { "kind": "binop", "op": "*", "left": { "kind": "var", "name": "amount" }, "right": { "kind": "var", "name": "rate" } } } }],
  "body": { "kind": "binop", "op": "*", "left": { "kind": "var", "name": "amount" }, "right": { "kind": "var", "name": "rate" } }
}, … ] }
```

**3. Proven TypeScript**, written by
`vector --verify test/fixtures/currency-spec.json test/fixtures/currency.json --emit converter.ts` only
once Z3 has proven every contract.

```ts
/**
 * Multiply an amount by a positive exchange rate.
 * Layer 1 — Hoare triple proven by Z3:
 *   requires AX-RATE: rate > 0
 *   ensures  AX2a: result == amount * rate
 */
export function applyRate(amount: number, rate: number): number {
  if (!Number.isFinite(amount)) {
    throw new RangeError("domain violated: amount must be a finite number");
  }
  if (!Number.isFinite(rate)) {
    throw new RangeError("domain violated: rate must be a finite number");
  }
  if (!(rate > 0)) {
    throw new RangeError("requires violated [AX-RATE]: rate > 0");
  }
  return amount * rate;
}
```

### Spec conformance

**4. Spec** (`specs/example-hex.md`). This is kramdown-rfc markdown. Each
requirement is a BCP 14 sentence with an id. Properties and a table of test
vectors cover the requirements.

````markdown
## Length

hexEncode MUST return exactly two characters per input byte.
{: #R-ENC-LEN}

~~~ ts-property
// P-ENC-LEN covers R-ENC-LEN — two characters per byte
forall (b: u8[] /* 0..64 */) => hexEncode(b).length === 2 * b.length
~~~

…

# Test Vectors

| Id | Call | Expected | Covers | Source | Title |
|----|------|----------|--------|--------|-------|
| V5 | `hexEncode([00 0f f0 ff])` | `"000ff0ff"` | R-ENC-LEN, R-ENC-DIGITS, R-ENC-ONLY | `python3 -c 'print(bytes([0,15,240,255]).hex())'` | every nibble boundary, encoded high nibble first in lowercase |
````

**5. Spec XML** (`specs/example-hex.xml`). `scripts/build-spec.sh` builds it
from the markdown with kramdown-rfc and xml2rfc. vector reads this file, not
the markdown.

```xml
<section anchor="length">
  <name>Length</name>
  <t anchor="R-ENC-LEN">hexEncode <bcp14>MUST</bcp14> return exactly two characters per input byte.</t>
  <sourcecode type="ts-property"><![CDATA[
// P-ENC-LEN covers R-ENC-LEN — two characters per byte
forall (b: u8[] /* 0..64 */) => hexEncode(b).length === 2 * b.length
]]></sourcecode>
</section>
```

**6. Contract** (`contracts/example-hex.json`), written by
`vector spec extract specs/example-hex.xml -o contracts/example-hex.json`.
It holds every requirement quoted verbatim, every vector with its source,
and every property.

```json
{
  "kind": "vector",
  "id": "V5",
  "title": "every nibble boundary, encoded high nibble first in lowercase",
  "covers": ["R-ENC-LEN", "R-ENC-DIGITS", "R-ENC-ONLY"],
  "source": { "command": "python3 -c 'print(bytes([0,15,240,255]).hex())'" },
  "section": "6",
  "call": "hexEncode",
  "args": [{ "hex": "000ff0ff" }],
  "expect": { "str": "000ff0ff" }
}
```

**7. Nish test**, written by
`vector spec emit contracts/example-hex.json -o hex_test.ts`. Each check names
its clause, and quotes the requirements it covers.

```ts
/**
 * every nibble boundary, encoded high nibble first in lowercase
 *
 * R-ENC-LEN — example-hex §3.1, MUST:
 *   hexEncode MUST return exactly two characters per input byte.
 * ...
 */
const clause_V5 = (t: Suite): boolean => t.eqStr("[V5] every nibble boundary, encoded high nibble first in lowercase (R-ENC-LEN, R-ENC-DIGITS, R-ENC-ONLY)", hexEncode(unhex("000ff0ff")), "000ff0ff");
```

## How a run goes

```
prompt ─▶ Architect ─▶ formal axioms + a layered decomposition   (the SpecPlan)
       ─▶ Generator ─▶ program + contracts in "vector-lang"          (the Program)
       ─▶ Z3        ─▶ proves / refutes each contract for all inputs
       ─▶ emit      ─▶ runnable TypeScript + a "Dijkstra Dashboard"
```

Claude Code plays Architect and Generator. It only ever *proposes* a
structured artifact, and a theorem prover holds the veto
(`vector --verify`). When Z3 finds a counterexample, the counterexample goes
back to Claude as structured feedback. Claude repairs the program in context
and verifies it again. **Unproven code is never emitted.** For specs, see
[RFC → contract → Nish test](#rfc--contract--nish-test).

---

## Contents

- [One of each file](#one-of-each-file)
- [How a run goes](#how-a-run-goes)
- [RFC → contract → Nish test](#rfc--contract--nish-test)
  - [Writing a spec (kramdown-rfc)](#writing-a-spec-kramdown-rfc)
- [Languages](#languages)
- [The idea](#the-idea)
- [Where the model runs](#where-the-model-runs)
- [Install & requirements](#install--requirements)
- [CLI usage](#cli-usage)
  - [Verify mode](#verify-mode)
  - [Fixture mode](#fixture-mode)
  - [Diff mode (the regeneration gate)](#diff-mode-the-regeneration-gate)
  - [Flags](#flags)
- [Standalone binary](#standalone-binary)
- [The Claude Code skill](#the-claude-code-skill)
- [vector-lang reference](#vector-lang-reference)
- [The two artifacts](#the-two-artifacts)
- [Verify output (the JSON contract)](#verify-output-the-json-contract)
- [Contract-driven development (code as build artifact)](#contract-driven-development-code-as-build-artifact)
- [The Dijkstra Dashboard](#the-dijkstra-dashboard)
- [Schema-driven types](#schema-driven-types)
- [Project layout](#project-layout)
- [Architecture notes](#architecture-notes)
- [Develop](#develop)
- [Limitations](#limitations)
- [License](#license)


## RFC → contract → Nish test

`vector spec` (or its alias `vector rfc`) turns a specification — a
kramdown-rfc document, built into RFC XML v3 — into a **contract**, and the
contract into a **Nish test** that checks an implementation (nish's
`std/crypto`) against it. The same split as the rest of vector holds: a model
(or you) *writes* the spec; deterministic code extracts the contract, and it
and Z3 decide whether it is faithful; nish runs it.

```
RFC text ─▶ contract (JSON) ─▶ gates ─▶ Z3 samples ─▶ main.ts (nish/testing) ─▶ nish run
            requirements        fidelity   boundaries      one PASS/FAIL per      ─▶ per-requirement
            vectors, properties completeness + seeded       clause, RFC quoted     verdict
            exclusions          coverage   random           above it
```

A contract (`schemas/rfc-contract.json`) has:

- **requirements**: verbatim quotes, each cited to a section and a BCP 14 level
  (or `DEFINITION`);
- **exclusions**: the MUST/SHALL sentences a functional test cannot observe
  (nonce uniqueness, constant-time comparison), each with its reason;
- **functions**: the implementation's signatures (`bytes`, `bytes?`,
  `string`, `string?`, `i32`, `u32`, `bool`, and `secret-bytes` for a nish
  `Secret<u8[]>`, with `secret-bytes?` as a result only), plus any
  reference function from another module. In the contract a secret is its
  bytes: the generated test copies an argument into a `Secret`, wipes it
  after the call, and reads a secret result with `expose`;
- **clauses**: **vectors** (the RFC's own known answers) and **properties**
  (`forall` a typed domain, `where` restricts it, `assert` must hold).

Expressions are JSON. Besides bytes and integers they have:

- **strings** — `{"str":"abc"}` (printable ASCII, tab, LF, CR: one byte per
  character) and the ops `strLen`, `strConcat`, `lower`, `upper` (ASCII only),
  `utf8` (string → bytes), `ascii` (bytes → `string?`, null when any byte is
  ≥ 0x80) and `charAt` (`""` out of range). A `forall` variable can be a
  string: `{"name":"s","type":"string","minLen":0,"maxLen":64,"alphabet":["hexdigit","-"]}`;
  the alphabet lists characters and the classes `hexdigit`, `HEXDIGIT`,
  `digit`, `alpha`, `space`, `ascii-printable`. Z3 picks the lengths, the
  seeded PRNG the characters.
- **let** — `{"let":[{"name":"sealed","value":…}],"in":…}` names a value once
  (each binding sees the ones before it). It may only open an `assert` (or a
  let's `in`), may not shadow a variable or function, and is emitted as Nish
  `const` locals ahead of the assertion.
- **labelled ints** — `{"int":42,"label":"L"}` in a vector passes fidelity
  only when its section prints `L = 42`, `L: 42` or `L 42` (decimal or `0x`).
  A bare number proves nothing — every section prints small integers — so an
  unlabelled int is reported as a warning, unchecked.

### Writing a spec (kramdown-rfc)

A spec is written in [kramdown-rfc](https://github.com/cabo/kramdown-rfc)
markdown, built into RFC XML v3 by the IETF tools, and the contract is
*extracted* from that XML. Nobody writes a contract by hand:

```
specs/<name>.md ─▶ kramdown-rfc ─▶ xml2rfc --v2v3 ─▶ specs/<name>.xml ─▶ vector spec extract ─▶ contracts/<name>.json
                   └──────────── scripts/build-spec.sh ────────────┘
```

**Installing the pinned tools.** `build-spec.sh` runs only with
kramdown-rfc 1.7.43 and xml2rfc 3.35.0, since the committed XML can only be
reproduced with the exact tools that made it. With any other version, or none,
it exits 2 and prints:

```bash
gem install kramdown-rfc -v 1.7.43 --no-document
pip install xml2rfc==3.35.0
```

**The edit loop.** Edit the `.md`, rebuild, re-extract, and commit all three:

```bash
scripts/build-spec.sh specs/<name>.md                               # writes specs/<name>.xml
bun run vector spec extract specs/<name>.xml -o contracts/<name>.json
git add specs/<name>.md specs/<name>.xml contracts/<name>.json
```

`build-spec.sh [--fetch] [--check] <spec.md>` writes `<name>.xml` beside the
`.md`, and renders it with `xml2rfc --text` and `--html` as a check (the
renderings are thrown away). It runs offline. kramdown-rfc reads references
only from the committed `.refcache/`, `{::include}` is disabled, and xml2rfc
runs with `--no-network`. A spec that cites a reference not yet in the cache
fails; run once with `--fetch`, then review and commit the `.refcache/` diff.
**Warnings are errors:** any kramdown-rfc `*** ` or `** ` line (an unknown
front-matter key, a missing reference, bad heading nesting) and any xml2rfc
`Warning:` or `Error:` line fails the build. Three cosmetic xml2rfc warnings
are silenced: long lines, table width, and the document date. The front matter
must pin `date:` as `YYYY-MM-DD`, or every rebuild on another day would drift.
`--check` rebuilds to a temp file and diffs it against the committed XML,
ignoring comments and processing instructions. Exit 0 means built or no
drift; 1 means drift, a warning, or a render failure; 2 means a usage error, a
missing input, or the wrong tools.

`vector spec extract specs/<name>.xml [-o contracts/<name>.json] [--check]`
reads the XML. Without `-o` it writes the contract to stdout, with its
relative paths (`$schema`, the sources, the sidecar it reads) taken as if it
were at `contracts/<name>.json` beside the spec's `specs/`. With `-o` it
writes that file. `--check` needs `-o` and writes nothing: it prints a unified
diff against the `-o` file and exits 1 if they differ (a missing file counts as
empty). Given a `.md` it exits 2: `build it first: scripts/build-spec.sh
specs/<name>.md`. `-o` may name neither the spec it reads nor a
`*.survivors.json` sidecar.

It refuses everything it cannot read, all at once, each refusal as `file:line`.
Where the XML carries kramdown-rfc's `<?line?>` marks, a refusal names the
markdown the XML was built from, `specs/<name>.md` beside it, at the markdown
line. Otherwise it names the XML at the XML line: before the first mark, and
for every refusal when that `.md` is not on disk, so a refusal never names a
file that is not there. It also runs `spec check`'s gates
(without `--run-sources`); a gate's refusal about `allowSurvivors` names the
sidecar file instead. Exit codes:

- 0: the contract was written or printed, or with `--check` is up to date.
- 1: one or more refusals, or with `--check` a difference.
- 2: a usage error, an unreadable file (the sidecar included), or a missing
  RFC, with the `curl` command that fetches it.

The output is canonical: schema key order, 2-space indent, a trailing newline,
so a rebuild changes only what the spec changed. Extract fills in the main
`source.sha256` and each RFC source's `file` and `sha256` from the bytes it
read, so there is no separate freeze step. `allowSurvivors` lives beside the
contract in `contracts/<name>.survivors.json` (`{"allowSurvivors": [...]}`)
and is merged in verbatim.

**The profile.** What vector reads, and where:

| Contract field | Markdown | XML |
|---|---|---|
| `contract` | `docname: draft-<name>-00` in the front matter; `<name>` must be the file's basename | `<rfc docName="draft-<name>-00">` |
| `source.rfc`, an RFC as the main source | `keyword: [vector-main-RFC<N>]` in the front matter, with RFC<N> under `normative:` | `<keyword>vector-main-RFC<N></keyword>` in `<front>` |
| `target.module`, the signatures | one `~~~ ts-interface` block, first line `// module: nish/<path>`, then `export function f(…): T` or `export const f = (…): T` lines; after a later `// module: nish/<other>` line, reference functions (`module`) that properties may call. The module under test declares at least one function before any other module line. A module line is a line comment of one module after the previous signature: a comment of any style or case whose text starts `module:` or `module nish/` (`/* Module: … */`, `/// module: …`) that is not `// module: nish/<path>`, or a module line inside a signature, is refused. A vector's Call names a function of the module under test, and a property's assertion calls at least one; a clause that calls only reference functions is refused | `<sourcecode type="ts-interface">` |
| a requirement (`MUST` … `MAY`) | a paragraph holding one BCP 14 sentence, at one level, then `{: #R-ID}` on the next line | `<t anchor="R-ID">` with `<bcp14>` |
| a requirement (`DEFINITION`) | a paragraph starting `Definition: `, with no BCP 14 keyword, then `{: #R-ID}` | `<t anchor="R-ID">Definition: …</t>` |
| a requirement quoting an RFC | a blockquote whose last line is `{{Section N of RFCx}}`, then `{: #R-ID gi="blockquote"}` | `<blockquote anchor="R-ID">`, the `<xref section>` last |
| an exclusion | a paragraph starting `Untested: ` right after a requirement, an unanchored BCP 14 paragraph, or an unanchored RFC blockquote (`{: gi="blockquote"}`) | the next sibling `<t>Untested: …</t>` |
| a requirement's `note` | a paragraph starting `Note: ` right after the requirement | the next sibling `<t>Note: …</t>` |
| a property | a `~~~ ts-property` block (see below) | `<sourcecode type="ts-property">` |
| the vectors | one table, header exactly `Id \| Call \| Expected \| Covers \| Source \| Title` | `<table>` |
| a requirement's or vector's `section` | the enclosing numbered section (`--- back` gives appendices A, B, …) | the section number `xml2rfc` gives |

Rules the profile enforces:

- **Requirements.** An id matches `[A-Za-z0-9][A-Za-z0-9._-]*`. Each
  anchored paragraph holds exactly one BCP 14 sentence, and that sentence
  one level: `X MUST a. Y MUST b.` under one anchor is refused, so give each
  sentence its own anchor, and split `MUST … SHOULD` into two sentences. In an
  unnumbered section (`{: numbered="false"}` on the line after the heading) a
  requirement of this spec, an exclusion of an unanchored sentence, and a
  vector table are refused, because they have no section number to record. A
  requirement quoting an RFC is accepted there, since it records the RFC's
  section. A quoted requirement must appear verbatim in that section of the
  RFC.
- **Completeness.** Every BCP 14 sentence is in a requirement or excluded by
  the `Untested:` paragraph after it. An `Untested:` paragraph that follows
  nothing it can exclude is refused, and so is a `MUST`, `MUST NOT`,
  `SHALL`, `SHALL NOT`, `REQUIRED` or `DEFINITION` requirement that no
  clause covers. A requirement followed by `Untested:` is an exclusion, not a
  requirement: no vector's Covers and no property may name it. The reason is
  the rest of the
  paragraph and is kept whole, including `Checked by: …`. The
  `{::boilerplate bcp14-tagged}` key-words paragraph is skipped. Put it first
  in `# Introduction`. A `Note: ` paragraph that follows no requirement is
  refused.
- **An RFC as the main source.** The front-matter keyword
  `vector-main-RFC<N>` makes RFC N the spec's main source: the contract takes the RFC
  form, `source.rfc` is N, `source.sha256` is the RFC's, and the spec is not a
  `sources[]` entry. Completeness then runs over the RFC: every `MUST`, `MUST NOT`,
  `SHALL`, `SHALL NOT` and `REQUIRED` sentence of RFC N must be quoted in a
  requirement or in an excluded blockquote, and a miss names the RFC section
  (`Section 2 of RFC9990: MUST NOT sentence is neither a requirement nor an
  exclusion`). Everything a requirement holds must be RFC text, so a
  `Definition:` paragraph, an anchored BCP 14 paragraph, an excluded
  paragraph, a vector Source naming a section of the spec, and any BCP 14
  sentence of the spec's own are refused. A spec has one key; a misspelt key,
  an RFC not under `normative:`, and an RFC nothing cites are refused. The
  RFC may be `.xml` or `.txt`
  ([`test/fixtures/rfc-main/`](test/fixtures/rfc-main/) has both);
  `specs/rfc5869-hkdf-sha256.md` and `specs/rfc8439-chacha20-poly1305.md` are
  the committed profiles. `spec check --spec` takes the profile itself
  (`--spec specs/<name>.xml`): the RFC is still read from its recorded file,
  and the contract is valid only if it is exactly what the profile extracts
  to; a profile whose `docName` names another contract is refused.
  `--spec rfcs/rfc<N>.txt`, or no `--spec`, checks against the RFC alone.
- **Vectors.** Call and Expected are each a single code span. Covers lists
  requirement ids, comma-separated, with no repeats. Title is required. The
  Source cell says where the expected value comes from:

  | Source cell | Contract source |
  |---|---|
  | `{{Section N of RFCx}}` | `cite`, section N of that RFC |
  | `{{anchor}}`, a numbered section of this spec | `spec` for a `null` or `bool` expected value; otherwise `cite`, that section, which must print the value |
  | a single code span, `` `python3 -c '…'` `` | `command`, with the table's section for the args; the expected value must be bytes or a string |

- **Whole spec.** At least one requirement, and at least one vector row or
  property. Every `{{…}}` has a reference, and every cited RFC section exists.
  Each property calls a function under test. A function's name may not
  collide with a name the generated test uses itself, or with a ts-property
  operation.

**Literals** in Call and Expected cells:

| Literal | Means |
|---|---|
| `"text"` | a JSON string of printable ASCII, tab, LF and CR. Where the signature takes bytes it is the ASCII bytes (`{ascii}`); where it takes a string, the string (`{str}`); anywhere else it is refused |
| `[00 0f f0 ff]` | bytes: lowercase hex pairs, separated by single spaces |
| `[]`, `(empty)` | empty bytes |
| `null`, `true`, `false` | themselves |
| `42`, `-1` | a decimal integer, in range for the parameter (`i32`, or `u32` 0..4294967295) |
| `Key = 0b0b0b` | labelled bytes: lowercase hex pairs, no spaces; the label is the name the cited section prints the value under. A label may be several words, and its first word may start with digits joined to a letter (`32-bit fixed-common part = 07000000`); a bare number is not a label |
| `L = 42` | a labelled decimal integer, checked against the cited section's "L = 42". Where the parameter (or return) type is `i32` or `u32` it is the int; anywhere else digits that are also hex pairs (`42`) are labelled bytes, and digits with a leading zero are never an int: `L = 00` is bytes, and `L = 042` (not whole hex pairs) is refused |
| `22 × 0b`, `22 x 0b`, `IKM = 22 × 0b` | a run of bytes written that many times (`{hex, repeat}`), as RFCs print runs; optionally labelled. `22×0b` also reads. The count is at least 1, the run lowercase hex pairs, and the expansion at most 65536 bytes |
| `concat([00], Key = ff)` | the parts joined, all bytes; one level (`concat` does not nest), at least one part. `‖` is refused |

The Call cell is `f(arg, …)`: as many arguments as `f` has parameters, each of
its parameter's type. The Expected cell must be of `f`'s return type.
Interface types are `u8[]`, `string`, `i32`, `u32`, `boolean` and
`Secret<u8[]>`. `u8[]` and `string` may be `| null`, and `Secret<u8[]>` may be
`| null` as a return type only.

**The contract's vocabulary.** The contract schema
([`schemas/rfc-contract.json`](schemas/rfc-contract.json)) names every type
and literal in no language's terms, and
[`src/rfc/vocab.ts`](src/rfc/vocab.ts) exports the same lists. The schema is
wider than what the profile reads today: it holds everything a spec can say,
and each language drops what it cannot express. What vector does not yet do
is marked *not yet*.

| Contract type | ts-interface spelling | Means |
|---|---|---|
| `bytes` | `u8[]` | an octet string, written as lowercase hex (RFC 4648 §8) |
| `string` | `string` | a Unicode string, UTF-8 (RFC 3629) |
| `bool` | `boolean` | true or false |
| `secret-bytes` | `Secret<u8[]>` | bytes whose value is secret; a language may wrap them, but in the contract they are bytes |
| `i8` … `i64`, `u8` … `u64` | `i8` … `i64`, `u8` … `u64` | fixed-width integers, as C11 §7.20.1.1 `intN_t`/`uintN_t`; `+ - *` wrap modulo 2^N |
| `f64` | `f64` | an IEEE 754-2019 binary64 value |
| `B?` | `B \| null` | see below; any type may take it |

The profile reads only the spellings of the first paragraph: `i8`, `i16`,
`i64`, `u8`, `u16`, `u64` and `f64`, and `| null` on `boolean`, an integer or
`f64`, are *not yet* read.

`B?` means one of two things, by position, and its absent value is written
`null` either way:

- **refusing return**: as a return type, the function declines this input and
  returns no value (`hexDecode("0") === null`);
- **optional input**: as a parameter type, the argument may be absent.

**Literals in the contract.** Beyond the profile's literals above:

- **`{"int": …}`** is a JSON integer up to ±(2^53−1); a wider value, such as a
  `u64` or `i64` near its bound, is a decimal string (`{"int":
  "18446744073709551615"}`), as RFC 7493 §2.2 and RFC 8259 §6 recommend.
- **`{"f64": "0.1"}`** is decimal text, read to binary64 with roundTiesToEven
  (IEEE 754-2019 §5.12.2, §4.3.1), or `NaN`, `Infinity`, `-Infinity`; `-0` is
  negative zero. `bits`, when given, is the binary64 encoding as 16
  lowercase hex digits, big-endian (§3.4), and must be the one the text
  converts to; for `NaN` it fixes the payload.
- **A vector's `tolerance`** says how close an f64 result must be: `{"ulps":
  n}` units in the last place, or `{"abs": "1e-9"}` (a decimal string, so it
  is not itself rounded), with the `section` and `quote` of the source that
  allows it. Without one an f64 result is compared bit for bit, so a NaN
  equals a NaN of the same bits.

The profile has no spelling for an f64 literal or a tolerance yet, and vector
does *not yet* sample a `forall` over `f64`: the schema records such a domain
(`{"type": "f64", "min": "-1.5", "max": "Infinity"}`, bounds as f64 text) and
vector refuses the property. A `forall` integer may be any of `i8` … `u64`,
with the same wide-integer strings for bounds; the profile reads only `i32`.

**Modules and names.** `target.module` and a reference function's `module`
are a neutral path: two or more lowercase segments joined by `/`
(`nish/crypto/hkdf`), each a path segment of RFC 3986 §3.3 limited to
`[a-z][a-z0-9_]*`. A language derives its own module name from the path; where
its rule gives the wrong one, `target.modules` overrides it per language
(`{"java": "org.example.Hkdf"}`). Likewise `names` on a function or a
parameter overrides its name per language (`{"rust": "expand"}`). The
languages are `rust`, `ruby`, `zig`, `go`, `cpp`, `csharp`, `c`, `java`,
`kotlin`, `python`, `typescript`, `php`, `swift` and `dart`. The profile has
no spelling for an override *yet*; the schema carries them.

**ts-property blocks** are a small, total subset of TypeScript:

```ts
// P-ROUND-TRIP covers R-ROUND-TRIP — hexDecode(hexEncode(b)) is b
forall (b: u8[] /* 0..64 */) => {
  const d = hexDecode(hexEncode(b));
  return d !== null && unwrap(d) === b;
}
```

- **Line 1** is `// P-ID covers R-ID, R-ID — title`. The title is required, and the
  separator before it is exactly ` — ` (space, em dash, space).
- **`forall (var, …) => body`**, optionally followed by `where expr`. Each
  variable has a bound in a comment:
  - `b: u8[] /* lo..hi */`: a length, with 0 ≤ lo ≤ hi ≤ 4096.
  - `n: i32 /* lo..hi */`: a value in the i32 range.
  - `t: string /* lo..hi CLASS… */`: a length and character classes, from
    `hexdigit`, `HEXDIGIT`, `digit`, `alpha`, `space` and `ascii-printable`.
    `/* lo..hi "chars" */` gives the characters as a JSON string instead.
  - `u32` is not a forall type.
- **The body** is an expression, or `{ const x = …; return …; }`.
  Semicolons are optional. `where` restricts the domain: a boolean that
  calls no function under test and cannot see the body's `const`s.
- **Operators:** `|| && === !== == != < <= > >= + - * %`, unary `!`, and `-`
  on an integer literal.
- **Members:** `.length`, `.concat`, `.slice`, `.toLowerCase`,
  `.toUpperCase`, `.charAt`.
- **Operations:** `xor`, `bitAnd`, `bitOr`, `fill`, `zeros`, `flipBit`, `le64`,
  `unwrap`, `utf8`, `ascii`, `implies` and `concat`.
- **Semantics** are vector's evaluator's, not JavaScript's:
  - `===` on `u8[]` compares contents.
  - `.slice` clamps its bounds.
  - `a % 0` is 0.
  - i32 `+ - *` wrap.
  - `+` with a string on either side joins strings.
  - A string literal is a string, except as an argument to a bytes operation.
- **Refused:**
  - `==>` (write `implies(a, b)`);
  - `/`, bit operators, `??` and `?:`;
  - indexing (use `.slice` or `.charAt`);
  - single-quoted strings;
  - non-decimal integers;
  - a literal negative `.slice` index, and a literal `% 0`;
  - nesting deeper than 64 (name a part with `const`).

  Only the first refusal in a block is reported.

**Linked RFCs.** A spec cites an RFC by listing it under `normative:` and
writing `{{Section N of RFCx}}`. A quoted requirement, an exclusion of a quote,
or a vector Source can cite it. Each cited RFC becomes a `sources[]` entry.
Its text is looked up in three places, nearest first: beside the contract,
in `../rfcs/`, then in vector's own `rfcs/`. At each place `rfc<N>.xml` comes
before `rfc<N>.txt`, so the order is `./rfc<N>.xml`, `./rfc<N>.txt`,
`../rfcs/rfc<N>.xml`, and so on. Once a contract records a source's `file`,
that name wins: a contract that recorded `rfcs/rfc4648.txt` keeps reading it
even after an `rfc4648.xml` is added at that place or a nearer one, and
`check` and `frozen` verify the recorded bytes. A missing one exits 2 with the command that fetches it:
`curl -sSfL -o rfcs/rfc<N>.xml https://www.rfc-editor.org/rfc/rfc<N>.xml` for
N ≥ 8700, `.txt` below 8650, and either between. An RFC listed but never cited
needs no file. Commit the file to `rfcs/`. Its `sha256` is in the contract, so
`check` and `frozen` fail if its bytes change. Do not list RFC 2119 or 8174:
the boilerplate adds them.

A spec cannot yet declare `outOfScope` exports; the profile has no construct
for them, so `exports` fails on any changed export no clause tests.

**Authoring notes.**

- Close the front matter with `--- abstract`.
- Give a section an explicit anchor as `## Empty input {#empty-input}`.
- Backslash escapes in a code span are passed through as written, so
  `` `"a\"b"` `` is the JSON string `a"b`.
- [`test/fixtures/profile/profile-hex.md`](test/fixtures/profile/profile-hex.md)
  uses every construct.
- [`test/fixtures/kramdown/SURVIVAL.md`](test/fixtures/kramdown/SURVIVAL.md)
  records what each construct becomes in the XML.

### Specs, sources and provenance

`extract` writes a contract from a kramdown-rfc spec. A contract can also cite
documents vector reads as they are. A source is RFC XML v3 (`.xml`) or an
RFC's plain text (with its `Request for Comments: N` header and form feeds).
Anything else is refused. These are what `check --spec` and the linked RFCs
are read as.

A contract may cite several documents:

```json
"source": { "title": "Hex encoding", "main": "hex" },
"sources": [
  { "id": "hex", "path": "../specs/hex.xml" },
  { "id": "rfc4648", "rfc": 4648 }
]
```

A citation (`requirement`, `exclusion`, a vector's `cite`) names its document
with `"source": "<id>"`, the main one by default. Fidelity reads the cited
document; completeness reads the main one only. An undeclared id, or a declared
source whose text cannot be found, fails `check` (a missing RFC file used to be
a warning; it is now a failure). `"source": {"rfc": N,
"title": …}` alone is the one-RFC form and still works.

Every vector says where its expected value comes from (`source`):

| `source` | The expected value is | Checked by |
|---|---|---|
| `{"cite": {"section": "A.1"}}` (`"source"` optional) | printed in that section, with the args, as one test case (see *What a printed value is*) | fidelity |
| `{"command": "…"}`, with `"section"` for the args | the command's trimmed stdout (lowercase hex for bytes) | `--run-sources` only (`sh -c` from the contract's directory, 30 s); otherwise reported as not run, never as passed. A timeout, non-zero exit or other output fails |
| `{"spec": "4.2"}`, with `"section"` for the args | `null` or a `bool` that section states | provenance: a requirement the vector covers, cited to that section, must state `null` / `true` / `false` as the result, by the rule below |

A vector without a source fails the shape gate. A `cite` source for a `null` or
`bool` is held to the same rule by fidelity.

**What a printed value is.** Fidelity binds each literal of a vector to one
printed value, not to any run of matching bytes:

- **Whole values.** A `hex` (or `ascii` read as bytes) must equal a whole
  printed value — a run of hex lines, a hexdump, a `0x…` or colon-hex value,
  or a `Key = 0b0b…` line and the lines that continue it. Part of one (a
  prefix of a key, the tail of a tag) is refused; `concat` joins whole
  values. A `str` must be printed whole: in quotes, in a markdown code span,
  on a line of its own, or ending a line after `=` or `:` (`"Zg"` is not
  printed by `"Zg=="`).
- **Labels.** A value printed under a name (`Key =`, `Input scalar:`, a
  short line such as `Plaintext:` above a dump) must give that name:
  `{"hex": "0b0b…", "label": "Key"}`. A label the section does not print the
  value under is refused.
- **One test case.** The expected value may not be bound to the same label
  as an argument (a key used as the expected MAC). Strings must share a
  printed line (`BASE64("f") = "Zg=="`). A label printed several times in
  the cited section is read in rounds — the k-th `Key` goes with the k-th
  `Data` and the k-th `HMAC-SHA-256` — so citing a parent section cannot mix
  values from two test cases.
- **Decimals.** In an RFC, an unnamed run of digit-only lines, or one under
  a name that calls it a number (`Input scalar as a number (base 10):`), is
  a decimal number, not bytes, and is not a value.
- **Variants.** Where the section prints the same case for several variants,
  under labels that differ only in a number (`HMAC-SHA-224` … `HMAC-SHA-512`),
  the label's number must be in the called function's name: the
  `HMAC-SHA-384` row as `hmacSha512`'s expected value is refused. A function
  named for none of them (`hmac`) gets a warning, since nothing says which
  variant it computes.

**When a section states `null`, `true` or `false`.** Only a requirement the
vector covers states a result, and only through its own quote. The rule is an
allow list and fails closed: a false refusal costs a rewording of the
requirement's quote, a false pass would break the gate. There is no way around
it — a `cite` source is held to the same rule, and a `command` source cannot
expect `null` or a `bool`.

1. The vector `covers` a requirement cited to that very section (same source,
   same section). Otherwise: "covers no requirement cited to it".
2. That requirement's quote is in the section's prose — not only in a code
   block, a blockquote or a table cell.
3. The section's prose is split into sentences: the heading on its own, then
   each paragraph cut at `.` `;` `!` or `?` followed by whitespace and a
   capital letter, an opening quote or bracket, or the end. Commas and colons
   never end a sentence. The match below must lie inside the quote, but the
   guards in steps 6 to 8 read the whole prose sentence around it, so a quote
   cut out of "For example, a Python decoder MUST return null." is judged
   with its "For example". Otherwise: "is cut from a sentence that qualifies
   it before the quote". Every place the quote occurs in the prose must pass.
4. Within one sentence, an affirmative keyword governs the result: `MUST`,
   `SHALL` or `REQUIRED to` (so also `is REQUIRED to`), in capitals and not
   followed by `NOT`. Nothing comes between the keyword and the verb except,
   optionally, `always`.
5. The verb is a result verb in its bare form — `return`, `be`,
   `evaluate to`, `yield`, `give` or `output` — followed directly by the
   value (in any case, optionally in backticks or emphasis) as a whole word.
6. Nothing **before the keyword in that sentence** is a deny word, matched
   case-insensitively as a whole word (so `_not_` and `**never**` count):
   - negators: `not`, `never`, `no`, `none`, `nor`, `neither`, `nothing`,
     `nobody`, `nowhere`, `cannot`, and any `…n't` / `…n’t`;
   - avoiders: `avoid…`, `forb…`, `prohibit…`, `prevent…`, `refus…`,
     `reject…`, `disallow…`, `instead`, `rather`, `except…`, `without`,
     `unless`, `fail…`, `error…`, `invalid…`, `illegal…`, `unlike`, `other`,
     `but`;
   - conditions and hypotheticals: `if`, `when`, `whenever`, `while`,
     `whether`, `assum…`, `suppos…`;
   - examples and reported text: `example…`, `e.g.`, `i.e.`, `instance`,
     `some`, `earlier`, `previous…`, `former…`, `draft…`, `said`, `says`,
     `historic…`, `legacy`.
7. The value is the whole result: it is not followed by `or` / `and`
   (optionally after a comma), `/`, or any hyphen or dash (`null-terminated`
   is not `null`). Otherwise: "offers an alternative right after …".
8. Nothing later in any sentence the quote touches retracts it: `not`, `never`, `no`, `none`,
   `nor`, `neither`, `cannot`, `…n't`, `avoid…`, `forb…`, `prohibit…`,
   `prevent…`, `disallow…`, `instead`, `rather`, `wrong…`, `incorrect…`,
   `bug…`, `an error`, `but`, `remov…`, `deprecat…`, `obsolete…`,
   `retract…`, `withdr…`, `supersed…`, `replaced`. Otherwise: "retracts …".

The refusal names the requirement and which step failed. So a vector covering
the requirement "hexDecode MUST return null when the text has an odd length"
(cited to that section) states null — its `when` comes after the value — as do
"f MUST return true for valid input", "f SHALL be false" and "f MUST always
return null on odd input". These do not: "MUST NOT, for any input, return
null", "Implementations MUST NOT, e.g. Python or Go, return null", "f MUST, for
every input, return null", "If the input is odd, f MUST return null", "f MUST
return null or an empty array", "f MUST return null. This was a bug.", the same
sentence only in a table or a code block, a requirement cited to another
section, and — by design — any descriptive sentence without a keyword, such as
"f returns null on failure" or "abc decodes to null".

### The gates (no model involved)

| Gate | Refuses |
|---|---|
| shape | a contract that is not well formed, including free text (titles, quotes, reasons) with a line break or other control character: it is copied into comments of the generated test, and the emitter also keeps `*/` from closing them |
| fidelity | a quote not in its cited section; a test-vector byte string not printed in its section as a whole value (hexdumps, `0x…`, `Key = …` lines, colon-hex split mid-byte across lines are all read), only part of one, without the `label` it is printed under, or under another label; a `str` not printed whole there; values from two test cases (strings never on one line, labelled values from different rounds) or an expected value bound to an argument's label; an empty value (`hex ""`, `ascii ""`, `str ""`) where the section prints no `""` or `(0 octets)`, and a whitespace-only `ascii` not printed as hex; a labelled int not printed after its label |
| completeness | any MUST / MUST NOT / SHALL / SHALL NOT / REQUIRED sentence of the main source that is neither inside a requirement's quote nor an exclusion's (or sits outside every numbered section) |
| provenance | a `spec` source whose section never states the expected `null`/`bool`; a `command` source that failed under `--run-sources` |
| coverage | a binding requirement no clause checks; a clause citing a requirement the contract does not state; a property whose assertion calls none of the functions under test; a property whose assertion calls only reference functions; a vector whose Call is a reference function; a module under test that declares no function |
| typing | an ill-typed call or expression (`bytes?`/`string?` must be `unwrap`ped; `where` may not call the implementation; a `let` may not shadow a name or bind a bare `null`) |
| signatures | a declared signature that is not the module's export (`--nish-root` / `--module`) |
| domain | a property whose domain is empty (Z3 `unsat`: it would pass vacuously) |

Then **Z3 picks the samples**: for every integer comparison in a property it
solves for inputs on the edge and one either side (`n <= 255*32` gives
`n = 8159, 8160, 8161`; `bit < 8*(len(pt)+16)` gives the last bit of the tag),
plus each variable's extremes, and a seeded PRNG adds random ones. Samples are
baked into the generated test, so a failure reproduces byte for byte.

### Usage

```bash
bun run vector spec check contracts/rfc8439-chacha20-poly1305.json --nish-root ../nish
bun run vector spec emit  contracts/rfc8439-chacha20-poly1305.json -o aead_rfc8439.ts
bun run vector spec run   contracts/rfc8439-chacha20-poly1305.json --nish-root ../nish
bun run vector spec extract specs/<name>.xml -o contracts/<name>.json
bun run vector spec check contracts/<name>.json --run-sources
```

`--run-sources` runs each `command` source with `sh -c`, as you, with your
files and network: it is not a sandbox. Read every command before you pass it,
above all in a contract you did not write; when the contract is not in the
current repository's `contracts/`, `check` prints the commands it is about to
run on stderr. On Linux each command runs in its own PID namespace (or,
where user namespaces are off, every process it starts carries a variable
naming the run), so at its 30 s timeout or its exit everything it started is
killed, a `setsid`'d process or daemon included; one that also clears its
environment escapes the fallback. Neither reaches what a command asks a
service already running to start (a tmux server, `systemd-run`, `at`,
`docker`), and setuid tools such as `sudo` do not work in the namespace.
Elsewhere only its process group is killed. If vector itself is interrupted
(SIGINT, SIGTERM, SIGHUP), the command it is running is killed first.

`check` exits 0 when the contract is valid, `run` when every clause passed
(`SATISFIED`); `VIOLATED` / `ERROR` / `INVALID` exit 1, usage errors 2.
`--nish-root` uses `build/nish` (the working tree's std); without it,
the seed — whose `nish/…` is the last release — and it warns. Contracts are not
written by hand: `extract` writes them from the spec. The `vector-spec` skill
drafts the kramdown-rfc spec, then builds and extracts it, and repairs the
spec against `extract`'s refusals. vector calls no model.

### What it catches

Both shipped contracts are `SATISFIED` by nish's std. Bugs planted in a copy of
it, one at a time:

| Planted bug | Caught by | At |
|---|---|---|
| HKDF-Expand accepts `L = 255*HashLen + 1` | P-EXPAND-LENGTH | `n = 8161` (Z3 boundary) |
| AEAD tag compare skips the last byte | P-TAMPER-SEALED | `bit = 127`, empty plaintext (Z3 boundary) |
| AEAD pads block-aligned AAD with 16 zeros instead of none | P-TAG-IS-POLY1305 | `len(aad) = 0` (Z3 boundary) |

The third passes every test vector RFC 8439 prints: only the property, which
rebuilds §2.8's MAC input from the other functions, catches it.

Byte `xor`, `bitAnd` and `bitOr` (the shorter operand reads as zeros past its
end) let a property rebuild a keyed construction the same way. RFC 4231
prints no key between 64 and 128 bytes, so its vectors pass an HMAC whose
block-size test is `<` where RFC 2104 needs `<=`. A property over keys of 0 to
64 bytes,
`hmacSha256(k, m) == sha256(concat(xor(k, fill(0x5c, 64)), sha256(concat(xor(k, fill(0x36, 64)), m))))`,
fails at `len(k) = 64`, a Z3 boundary (and its SHA-512 twin at 128).

### PR gates

Four checks for CI on a PR, each deterministic and failing closed: a git
error, an unreadable contract, a missing source or a diff it cannot read is a
failure, never a pass. Results exit 0 (OK) or 1 (refused); usage and git
errors exit 2.

```bash
bun run vector spec frozen  --base origin/main [contracts/*.json]
bun run vector spec stale   test/spec/aead_rfc8439.ts contracts/rfc8439-chacha20-poly1305.json
node scripts/spec-stale.mjs test/spec/aead_rfc8439.ts contracts/rfc8439-chacha20-poly1305.json
bun run vector spec exports contracts/rfc5869-hkdf-sha256.json --nish-root ../nish --base origin/main
bun run vector spec mutate  contracts/rfc5869-hkdf-sha256.json --nish-root ../nish --base origin/main \
  [--jobs N] [--max N] [--format markdown]
```

**frozen** — a PR changes the spec side or the implementation, never both, so
a test can't be loosened in the PR that changes the code it tests. Paths are
classed by their path from the repository top, for the diff from the fork
point (`git merge-base <base> HEAD`, so commits that landed on the base after
the branch was cut don't count) plus untracked files:

| Class | Paths |
|---|---|
| spec | `specs/…`, `contracts/…`, `rfcs/…` |
| neutral | `docs/…`, and `*.md` at the top level (`README.md`) |
| implementation | everything else: `src/`, `test/`, config, and `*.md` below the top outside `docs/` |

The class comes from the path alone; nothing in a file's content moves it to
the spec side. The one refinement is for generated tests, which live in
`test/spec/` and nowhere else: a file there is `generated` (spec side) only if
it has exactly one `// vector-contract-sha256:` line and that sha256 is the
sha256 of a contract at the PR's head, so `spec stale` passes it against that
contract. A marker anywhere else (`src/`, `test/`), or one naming no contract
at the head, is ignored and the file is implementation. A deleted file keeps
its path's class.

A contract's declared sources (`sources[].path`) must resolve, symlinks
followed, under `specs/` or `rfcs/`; frozen refuses one anywhere else
(`../src/a.ts`, `src/a.ts`, or out of the repository), and the shape gate
refuses an absolute path. So a contract can't name code as its spec to move it
to the spec side.

Every command that reads a contract (`check`, `emit`, `run`, `mutate`) also
treats it as input from anyone: a `sources[].path` must lead, symlinks
followed, to a file beside the contract or under a `specs/` or `rfcs/` beside
the contract's directory or its parent (or vector's own), with no hidden
directory (`.git`, `.ssh`, `.env`) on the way. Anything else is a usage error
before the file is read, so a contract can't pull a private file's text into
gate messages. `--spec` names the main source's file directly and is not
limited: that path comes from you.

It also refuses a contract whose **main** source no longer hashes to its
`source.sha256` (or that has none). Other `sources` are not hashed: their
quotes are still checked by the fidelity gate. Finding no contract is a
failure.

**stale** — `emit` writes `// vector-contract-sha256: <hex>` (the sha256 of the
contract file's bytes) into the test's header. `spec stale <test> <contract>`
refuses a test whose line names other bytes, or that has no such line or more
than one. `scripts/spec-stale.mjs` is the same check with only `node:fs` and
`node:crypto`, for a repository that does not install vector (nish's CI). Its reasons, output and exit codes are `spec stale`'s, including exit 2 for a
file it cannot read; `node scripts/spec-stale.mjs --self-test` shows one pass
and three refusals.

**exports** — every export the diff adds to or changes in the target module
(`nish/crypto/hkdf` → `std/crypto/hkdf.ts`) must be a function the contract
tests, or be listed in `outOfScope: [{ "name", "reason" }]` with a non-empty
reason. A contract may not list a function it tests as out of scope. Deleting
a tested function is refused (its test can no longer build); deleting an
untested export is a note, which also says when its `outOfScope` entry can
go. `extract` writes no `outOfScope` (the profile has no construct for it), so
for an extracted contract every changed export must be tested. An export commented out counts as deleted. A re-export (`export { a }`),
an `export const a = 1, b = 2`, or anything else it cannot name is refused.
Only `target.module` is checked: a contract that also exercises another
module (HKDF calls `hmacSha256`) does not gate that module's exports.

**mutate** — mutates only the module's lines changed since `--base`
(relational and logical operators, integer literals, `!`, whole statements,
`return null`) and runs the contract's test against each, in a scratch
install built from `--nish-root`'s working tree (its `build/seed` and `std/`;
the checkout is not touched). A mutant the test still passes on is reported
as `file:line`, its mutated line, and *behaviour no requirement pins down*,
and fails the gate, unless the contract allows it:

```json
"allowSurvivors": [
  { "file": "std/crypto/hkdf.ts", "line": 342, "reason": "TLS label helper, outside RFC 5869" }
]
```

`file` is the target module's path from the nish root (any other file is
refused), each `{file, line}` appears once, and the reason must be non-empty.
Allowances that match no survivor are listed as a warning but do not fail the
gate. Zero mutants is a failure: a diff that only deletes lines of the module
has no changed line left to mutate, so it fails too. So does a test that fails
on the unmutated module. A mutant
that does not build is *stillborn*: reported, not counted; when every mutant
is stillborn, none was judged, and that is a failure. `--max N` runs N
mutants spread across the diff; `--jobs N` runs them in parallel.

**`--format markdown`** (`check`, `emit`, `run`, `mutate`) prints the dashboard
for a PR comment: each requirement's quote, then a table of its clauses with
their outcome and evidence, the vector sources run, the exclusions, and the
mutation survivors. Text is the
default; `--json` / `--format json` is the machine form.

**Known limits** (each refuses rather than passes): `exports` and `mutate`
refuse a module with any export they cannot name, anywhere in it, not only in
the diff; a generic type argument split across lines reads as a second
declarator and is refused; a test or contract with CRLF line endings reads as
stale; a mutation run that cannot start (bad contract, unbuildable scratch
install) prints to stderr and exits 1 with no markdown.

### The PR workflow, in order

A module lands spec-first, in two PRs: the **spec side** (`specs/`,
`contracts/`, `rfcs/`, generated tests in `test/spec/`), then the
**implementation**. The `vector-spec` skill walks it step by step.

| Step | Command | Exit 0 | Exit 1 |
|---|---|---|---|
| 1. write the spec | `specs/<name>.md` in kramdown-rfc (see [Writing a spec](#writing-a-spec-kramdown-rfc)), then `scripts/build-spec.sh specs/<name>.md` | `specs/<name>.xml` written | a warning, or a render failure |
| 2. `extract`, `check` | `vector spec extract specs/<name>.xml -o contracts/<name>.json` (it fills every `sha256`), then `vector spec check contracts/<name>.json --run-sources` for the `command` sources | written; `CONTRACT_VALID` | refusals, each at `file:line`; `INVALID` |
| 3. `frozen` | `vector spec frozen --base origin/main contracts/<name>.json` | spec side only, hashes match | both sides touched, the spec changed, no `sha256`, a contract source outside `specs/` or `rfcs/`, no contract |
| 4. `emit` / `stale` | `vector spec emit contracts/<name>.json -o test/spec/<name>.ts`, then `vector spec stale test/spec/<name>.ts contracts/<name>.json` | the test is the contract's | stale, missing or doubled marker line |
| 5. implement, `run` | `vector spec run contracts/<name>.json --nish-root ../nish` | `SATISFIED` | `VIOLATED` / `ERROR` / `INVALID` |
| 6. `exports` | `vector spec exports contracts/<name>.json --nish-root ../nish --base origin/main` | every changed export tested | a changed export no clause tests (drop it, or add it to the spec with a clause that tests it) |
| 7. `mutate` | `vector spec mutate contracts/<name>.json --nish-root ../nish --base origin/main` | no survivor outside `allowSurvivors` | a survivor, zero mutants, all stillborn |

Every step exits 2 on a usage error (and `frozen`, `exports` and `mutate` on a
git error). Steps 1–4 are the spec-side PR, which a human approves; the
implementation PR then passes 3 and 5–7 without touching anything on the spec
side. `allowSurvivors` entries (in `contracts/<name>.survivors.json`, then
re-extract) are contract changes, so they belong in a spec-side PR too.

### What a pass means — and why not Lean

A `SATISFIED` contract is **evidence, not proof**: properties are sampled, and
the implementation is run, not reasoned about. That is deliberate. A Lean (or
Coq) proof is a proof about a *model*; nothing connects that model to nish's
code, which is where the bugs are, and building that bridge means a formal
semantics of Nish. What this gives instead, today, is a contract that provably
says what the RFC says (fidelity + completeness), tests chosen by a solver at
the RFC's edges, and an honest list of what was not tested. The proof route
that *does* reach the code is to verify the LLVM IR nish emits against an
executable spec (SAW/Cryptol style, or Z3 over bit-vectors for the fixed-size
primitives); the contract's requirements and properties are the statement such
a proof would discharge.

So `SATISFIED` means exactly this: the implementation returns the spec's
printed vectors, and the contract's properties hold at every sample. It does
not mean the implementation conforms where neither reaches. RFC 4231 prints no
HMAC key between 64 and 128 bytes long, so an off-by-one in the SHA-512
block-size test (`<=` for `<`) passes every RFC vector; a contract catches it
only with a vector of its own at that length (a `command` source) or a
property that pins the boundary. Run `vector spec mutate` to see which
plausible bugs the contract cannot tell apart from the real code; each
survivor is a gap of this kind.

The module under test also runs in the test's own process, and could print
`PASS` lines itself. So `run` only trusts a transcript that ends with the line
the generated `main` prints after every clause has returned: a fresh per-run
nonce (passed as the program's argument), then what each clause returned. An
early exit, a clause reported twice, a line after that end, or a line that
disagrees with its clause's return value makes the run `ERROR`. A module
written to read the nonce from its own argv could still forge a run; `mutate`
is the check against that (a gamed module's mutants all survive).

---

## Languages

A contract is language-neutral: one schema, checked against an implementation in any of fourteen languages. Each language has a mapping table in [`src/rfc/languages/`](src/rfc/languages/) that writes every construct of the vocabulary ([`src/rfc/vocab.ts`](src/rfc/vocab.ts)) in that language: every base type, both outcomes of `B?`, every literal form, the module path and the name rule. The tables are typed over the vocabulary, so a construct added there without a mapping fails `bun run typecheck`. [`test/languages.test.ts`](test/languages.test.ts) names every function of the three contracts in every language and checks this section is the tables' rendering.

The contract keeps all the data: an exact width, which outcome a `?` means, secrecy, the bits of an f64. A language that cannot express one of those says what it drops, in a note or a choice below. A construct it cannot express at all is marked unsupported, with the reason. `{T}` stands for the mapped base type. A contract's `names` or `modules` override for a language always wins over these rules.

### Base types

| | `bytes` | `string` | `bool` | `f64` | `secret-bytes` | `i8` | `i16` | `i32` | `i64` | `u8` | `u16` | `u32` | `u64` |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Rust | `&[u8]` | `&str` | `bool` | `f64` | `&[u8]` | `i8` | `i16` | `i32` | `i64` | `u8` | `u16` | `u32` | `u64` |
| Ruby | `String` | `String` | `bool` | `Float` | `String` | `Integer` | `Integer` | `Integer` | `Integer` | `Integer` | `Integer` | `Integer` | `Integer` |
| Zig | `[]const u8` | `[]const u8` | `bool` | `f64` | `[]const u8` | `i8` | `i16` | `i32` | `i64` | `u8` | `u16` | `u32` | `u64` |
| Go | `[]byte` | `string` | `bool` | `float64` | `[]byte` | `int8` | `int16` | `int32` | `int64` | `uint8` | `uint16` | `uint32` | `uint64` |
| C++ | `std::span<const std::uint8_t>` | `std::string_view` | `bool` | `double` | `std::span<const std::uint8_t>` | `std::int8_t` | `std::int16_t` | `std::int32_t` | `std::int64_t` | `std::uint8_t` | `std::uint16_t` | `std::uint32_t` | `std::uint64_t` |
| C# | `byte[]` | `string` | `bool` | `double` | `byte[]` | `sbyte` | `short` | `int` | `long` | `byte` | `ushort` | `uint` | `ulong` |
| C | `const uint8_t *, size_t` | `const char *` | `bool` | `double` | `const uint8_t *, size_t` | `int8_t` | `int16_t` | `int32_t` | `int64_t` | `uint8_t` | `uint16_t` | `uint32_t` | `uint64_t` |
| Java | `byte[]` | `String` | `boolean` | `double` | `byte[]` | `byte` | `short` | `int` | `long` | `int` | `int` | `long` | `long` |
| Kotlin | `ByteArray` | `String` | `Boolean` | `Double` | `ByteArray` | `Byte` | `Short` | `Int` | `Long` | `UByte` | `UShort` | `UInt` | `ULong` |
| Python | `bytes` | `str` | `bool` | `float` | `bytes` | `int` | `int` | `int` | `int` | `int` | `int` | `int` | `int` |
| TypeScript | `Uint8Array` | `string` | `boolean` | `number` | `Uint8Array` | `number` | `number` | `number` | `bigint` | `number` | `number` | `number` | `bigint` |
| PHP | `string` | `string` | `bool` | `float` | `string` | `int` | `int` | `int` | `int` | `int` | `int` | `int` | unsupported (1) |
| Swift | `[UInt8]` | `String` | `Bool` | `Double` | `[UInt8]` | `Int8` | `Int16` | `Int32` | `Int64` | `UInt8` | `UInt16` | `UInt32` | `UInt64` |
| Dart | `Uint8List` | `String` | `bool` | `double` | `Uint8List` | `int` | `int` | `int` | `int` | `int` | `int` | `int` | `BigInt` |

1. PHP `u64`: PHP int is signed 64-bit and a value above PHP_INT_MAX becomes float, losing precision; no native type holds 2^63..2^64-1 (GMP would, as an object)

### Outcomes of `B?`

`refusing-return` is a return of `B?`: the function refuses its input. `optional-input` is a parameter of `B?`: the argument may be absent.

| | `refusing-return` | `optional-input` |
|---|---|---|
| Rust | `Option<{T}>` | `Option<{T}>` |
| Ruby | `{T}?` | `{T}?` |
| Zig | `?{T}` | `?{T}` |
| Go | `({T}, error)` | `*{T}` |
| C++ | `std::optional<{T}>` | `std::optional<{T}>` |
| C# | `{T}?` | `{T}?` |
| C | `int f(..., {T} *out)` | `const {T} *` |
| Java | `Optional<{T}>` | `@Nullable {T}` |
| Kotlin | `{T}?` | `{T}? = null` |
| Python | `{T} \| None` | `{T} \| None = None` |
| TypeScript | `{T} \| null` | `{T} \| undefined` |
| PHP | `?{T}` | `?{T} $x = null` |
| Swift | `{T}?` | `{T}? = nil` |
| Dart | `{T}?` | `[{T}? x]` |

### Literals

| | `hex` | `ascii` | `str` | `int` | `f64` | `bool` | `null` | `concat` |
|---|---|---|---|---|---|---|---|---|
| Rust | `&[0x0b, 0x0b]` | `b"abc"` | `"abc"` | `42u32` | `f64::from_bits(0x3ff8000000000000)` | `true` | `None` | `&[a, b].concat()` |
| Ruby | `["0b0b"].pack("H*")` | `"abc".b` | `"abc"` | `42` | `["3ff8000000000000"].pack("H*").unpack1("G")` | `true` | `nil` | `a + b` |
| Zig | `&[_]u8{ 0x0b, 0x0b }` | `"abc"` | `"abc"` | `@as(u32, 42)` | `@as(f64, @bitCast(@as(u64, 0x3ff8000000000000)))` | `true` | `null` | `a ++ b` |
| Go | `[]byte{0x0b, 0x0b}` | `[]byte("abc")` | `"abc"` | `uint32(42)` | `math.Float64frombits(0x3ff8000000000000)` | `true` | `nil` | `append(append([]byte{}, a...), b...)` |
| C++ | `std::array<std::uint8_t, 2>{0x0b, 0x0b}` | `std::array<std::uint8_t, 3>{'a', 'b', 'c'}` | `"abc"sv` | `std::uint32_t{42}` | `std::bit_cast<double>(std::uint64_t{0x3ff8000000000000})` | `true` | `std::nullopt` | `std::array<std::uint8_t, 2>{0x0b, 0x61}` |
| C# | `new byte[] { 0x0b, 0x0b }` | `"abc"u8.ToArray()` | `"abc"` | `42u` | `BitConverter.UInt64BitsToDouble(0x3ff8000000000000UL)` | `true` | `null` | `[.. a, .. b]` |
| C | `(const uint8_t[]){0x0b, 0x0b}` | `(const uint8_t[]){"abc"}` | `"abc"` | `UINT32_C(42)` | `((union { uint64_t u; double d; }){.u = 0x3ff8000000000000u}).d` | `true` | `NULL` | `(const uint8_t[]){0x0b, 0x61}` |
| Java | `HexFormat.of().parseHex("0b0b")` | `"abc".getBytes(StandardCharsets.US_ASCII)` | `"abc"` | `42L` | `Double.longBitsToDouble(0x3ff8000000000000L)` | `true` | `null` | `ByteBuffer.allocate(a.length + b.length).put(a).put(b).array()` |
| Kotlin | `byteArrayOf(0x0b, 0x0b)` | `"abc".toByteArray(Charsets.US_ASCII)` | `"abc"` | `42u` | `Double.fromBits(0x3ff8000000000000uL.toLong())` | `true` | `null` | `a + b` |
| Python | `bytes.fromhex("0b0b")` | `b"abc"` | `"abc"` | `42` | `struct.unpack(">d", bytes.fromhex("3ff8000000000000"))[0]` | `True` | `None` | `a + b` |
| TypeScript | `Uint8Array.of(0x0b, 0x0b)` | `new TextEncoder().encode("abc")` | `"abc"` | `42` | `new DataView(Uint8Array.of(0x3f, 0xf8, 0, 0, 0, 0, 0, 0).buffer).getFloat64(0)` | `true` | `null` | `Uint8Array.of(...a, ...b)` |
| PHP | `hex2bin("0b0b")` | `'abc'` | `"abc"` | `42` | `unpack('E', hex2bin('3ff8000000000000'))[1]` | `true` | `null` | `$a . $b` |
| Swift | `[0x0b, 0x0b] as [UInt8]` | `Array("abc".utf8)` | `"abc"` | `UInt32(42)` | `Double(bitPattern: 0x3ff8000000000000)` | `true` | `nil` | `a + b` |
| Dart | `Uint8List.fromList([0x0b, 0x0b])` | `ascii.encode('abc')` | `'abc'` | `42` | `(ByteData(8)..setUint64(0, 0x3ff8000000000000)).getFloat64(0)` | `true` | `null` | `Uint8List.fromList([...a, ...b])` |

### Names and modules

Every rule starts from one word split: a capital starts a word, a run of capitals is one acronym (`parseHTTPRequest` → parse, HTTP, Request), a digit run stays on the word before it (`chacha20Poly1305Seal` → chacha20, Poly1305, Seal), and `_` separates words.

| | `hkdfExpandSha256` | `parseHTTPRequest` | param `userId` | `nish/crypto/hkdf` | called as | name standard |
|---|---|---|---|---|---|---|
| Rust | `hkdf_expand_sha256` | `parse_http_request` | `user_id` | `nish::crypto::hkdf` | `nish::crypto::hkdf::hkdf_expand_sha256` | Rust API Guidelines C-CASE (RFC 430, naming conventions) |
| Ruby | `hkdf_expand_sha256` | `parse_http_request` | `user_id` | `Nish::Crypto::Hkdf` | `Nish::Crypto::Hkdf.hkdf_expand_sha256` | The Ruby Style Guide, Naming Conventions (snake_case methods; CamelCase modules) |
| Zig | `hkdfExpandSha256` | `parseHttpRequest` | `user_id` | `nish/crypto/hkdf.zig` | `hkdf.hkdfExpandSha256` | The Zig Language Reference, Style Guide › Names (camelCase functions, snake_case variables) |
| Go | `HkdfExpandSha256` | `ParseHTTPRequest` | `userID` | `nish/crypto/hkdf` | `hkdf.HkdfExpandSha256` | Effective Go, Names (MixedCaps; an upper-case first letter exports) and Go Code Review Comments, Initialisms |
| C++ | `hkdf_expand_sha256` | `parse_http_request` | `user_id` | `nish::crypto::hkdf` | `nish::crypto::hkdf::hkdf_expand_sha256` | C++ Core Guidelines NL.10 (prefer underscore_style names) and NL.8 (consistent naming style) |
| C# | `HkdfExpandSha256` | `ParseHttpRequest` | `userId` | `Nish.Crypto.Hkdf` | `Nish.Crypto.Hkdf.HkdfExpandSha256` | .NET Framework Design Guidelines, Capitalization Conventions (PascalCase members, camelCase parameters; two-letter acronyms in capitals) |
| C | `hkdf_expand_sha256` | `parse_http_request` | `user_id` | `nish/crypto/hkdf.h` | `nish_crypto_hkdf_hkdf_expand_sha256` | ISO C has no naming standard; the common convention of lower snake_case behind a module prefix (as in POSIX and OpenSSL), invented for this table where none fits |
| Java | `hkdfExpandSha256` | `parseHttpRequest` | `userId` | `nish.crypto.Hkdf` | `nish.crypto.Hkdf.hkdfExpandSha256` | Google Java Style Guide, §5.3 Camel case: defined (acronyms cased as words) |
| Kotlin | `hkdfExpandSha256` | `parseHttpRequest` | `userId` | `nish.crypto.Hkdf` | `nish.crypto.Hkdf.hkdfExpandSha256` | Kotlin Coding Conventions, Naming rules (lowerCamelCase functions; two-letter acronyms in capitals) |
| Python | `hkdf_expand_sha256` | `parse_http_request` | `user_id` | `nish.crypto.hkdf` | `nish.crypto.hkdf.hkdf_expand_sha256` | PEP 8, Naming Conventions › Function and Variable Names |
| TypeScript | `hkdfExpandSha256` | `parseHttpRequest` | `userId` | `nish/crypto/hkdf` | `hkdf.hkdfExpandSha256` | Google TypeScript Style Guide, Identifiers › Naming style and Camel case (lowerCamelCase; acronyms cased as whole words) |
| PHP | `hkdfExpandSha256` | `parseHTTPRequest` | `userId` | `Nish\Crypto\Hkdf` | `\Nish\Crypto\Hkdf::hkdfExpandSha256` | PSR-1 Basic Coding Standard, §4.3 Methods (camelCase) and PSR-4 Autoloader |
| Swift | `hkdfExpandSha256` | `parseHTTPRequest` | `userId` | `NishCryptoHkdf` | `NishCryptoHkdf.hkdfExpandSha256` | Swift API Design Guidelines, Conventions › General Conventions (lowerCamelCase; acronyms uniformly cased as written) |
| Dart | `hkdfExpandSha256` | `parseHttpRequest` | `userId` | `package:nish/crypto/hkdf.dart` | `hkdf.hkdfExpandSha256` | Effective Dart: Style, Identifiers (lowerCamelCase; acronyms longer than two letters capitalized like words) |

### Per language

<details><summary>Rust</summary>

Types: The Rust Reference, Type system › Types (numeric, boolean, textual and slice types).

Names: functions and parameters snake_case (C-CASE): words split at each capital, an acronym is one word (parseHTTPRequest → parse_http_request), and a digit run stays on the word before it (chacha20Poly1305Seal → chacha20_poly1305_seal). A name override always wins; a name that is a keyword (type, match, …) takes one.

Modules (crate-path): the segments as a path of modules, the root segment the crate (The Rust Reference, Items › Modules): nish/crypto/hkdf → nish::crypto::hkdf.

Choices:

- A refusing return is Option&lt;T>, not Result&lt;T, E>: the contract says only that the function declines, and gives no reason, so an error type E would be invented. An implementation that returns Result is still checkable by mapping Err to the refusal; the reason it carries is outside the contract.
- An optional input is Option&lt;T>, so absent and empty (Some(&amp;[])) stay distinct.
- Integer arithmetic in the contract wraps modulo 2^N; Rust's + panics on overflow in debug builds, so an implementation uses wrapping_add and friends where the contract wraps.
- secret-bytes is a plain byte slice: std has no secret type, so the secrecy is dropped.

Notes:

- type `bytes`: a returned value is Vec&lt;u8>
- type `string`: a returned value is String; both are UTF-8 by construction
- type `f64`: IEEE 754-2008 binary64 (Reference, Numeric types)
- type `secret-bytes`: std has no secret type; secrecy is dropped (a crate such as secrecy or zeroize can add it)
- outcome `refusing-return`: None is the refusal
- outcome `optional-input`: None is the absent argument
- literal `str`: non-ASCII and control characters as \u{…} escapes
- literal `int`: suffixed with its type, so every width is exact
- literal `f64`: from its bits, so NaN payloads and -0 are exact
- literal `concat`: a borrow of the joined Vec&lt;u8>, as a bytes input is &amp;[u8]; a returned value is [a, b].concat()

</details>

<details><summary>Ruby</summary>

Types: RBS, Ruby's type signature language (core class names: String, Integer, Float, bool).

Names: methods and parameters snake_case: words split at each capital, an acronym is one word (parseHTTPRequest → parse_http_request), and a digit run stays on the word before it (hkdfExpandSha256 → hkdf_expand_sha256). A name override always wins.

Modules (module): nested modules, each segment in CamelCase (Style Guide: CamelCase for classes and modules); the file is the neutral path plus .rb: nish/crypto/hkdf → Nish::Crypto::Hkdf in nish/crypto/hkdf.rb.

Choices:

- Ruby's Integer is unbounded, so there is no native u64 or any fixed width: every integer type is Integer, and the width (its range and its wrapping) is dropped from the type and kept by the implementation.
- A refusing return is nil, not a raised exception: nil maps the contract's null one-to-one (as Integer(s, exception: false) does). An implementation that raises ArgumentError is still checkable by mapping the raise to the refusal.
- bytes and string are both String, told apart only by encoding (ASCII-8BIT vs UTF-8).

Notes:

- type `bytes`: with Encoding::ASCII_8BIT (binary)
- type `string`: with Encoding::UTF_8
- type `bool`: RBS's bool: true or false (Ruby has no Boolean class)
- type `f64`: a C double, IEEE 754 binary64 on every supported platform
- type `secret-bytes`: binary String; Ruby has no secret type, so secrecy is dropped
- type `i8`: unbounded; the width's range and wrapping are the implementation's (mask with &amp; (2\*\*N - 1))
- type `i16`: unbounded; the width's range and wrapping are the implementation's (mask with &amp; (2\*\*N - 1))
- type `i32`: unbounded; the width's range and wrapping are the implementation's (mask with &amp; (2\*\*N - 1))
- type `i64`: unbounded; the width's range and wrapping are the implementation's (mask with &amp; (2\*\*N - 1))
- type `u8`: unbounded; the width's range and wrapping are the implementation's (mask with &amp; (2\*\*N - 1))
- type `u16`: unbounded; the width's range and wrapping are the implementation's (mask with &amp; (2\*\*N - 1))
- type `u32`: unbounded; the width's range and wrapping are the implementation's (mask with &amp; (2\*\*N - 1))
- type `u64`: unbounded; the width's range and wrapping are the implementation's (mask with &amp; (2\*\*N - 1))
- outcome `refusing-return`: RBS optional: nil is the refusal
- outcome `optional-input`: nil is the absent argument
- literal `str`: double-quoted, so # is written \# (a double-quoted string interpolates #{x}), \ as \\ and " as \"; non-ASCII and control characters as \u{…} escapes
- literal `int`: exact at any width
- literal `f64`: from its big-endian bits, so -0.0 and NaN payloads are exact

</details>

<details><summary>Zig</summary>

Types: The Zig Language Reference, Primitive Types, Slices, Optionals and Error Union Type.

Names: functions camelCase and parameters snake_case (Style Guide): words split at each capital, an acronym is a word like any other (parseHTTPRequest → parseHttpRequest, parse_http_request), and a digit run stays on the word before it (chacha20Poly1305Seal → chacha20Poly1305Seal, hkdfExpandSha256 → hkdfExpandSha256). A name override always wins.

Modules (file): a source file is a struct; the neutral path plus .zig, imported under its last segment: nish/crypto/hkdf → nish/crypto/hkdf.zig, const hkdf = @import("nish/crypto/hkdf.zig").

Choices:

- A refusing return is an optional ?T, not an error union !T: the contract's refusal carries no reason, so an error set would be invented. Where the function allocates, the error union holds only allocation failure (Allocator.Error!?T), so the two never mix.
- bytes and string share one type, []const u8; the string's UTF-8 guarantee is dropped.
- Inputs are slices []const u8; outputs are allocated from a caller-supplied std.mem.Allocator, which the contract does not name (it is an extra first parameter).

Notes:

- type `bytes`: a returned slice is []u8 allocated from a caller-supplied std.mem.Allocator
- type `string`: Zig has no string type: UTF-8 bytes, so the guarantee that they are valid UTF-8 is dropped
- type `f64`: IEEE-754-2008 binary64
- type `secret-bytes`: no secret type; secrecy is dropped (std.crypto.secureZero can wipe a copy)
- outcome `refusing-return`: null is the refusal; a function that allocates returns std.mem.Allocator.Error!?{T}
- outcome `optional-input`: null is the absent argument
- literal `str`: non-ASCII as \u{…} escapes
- literal `int`: typed by @as, so every width is exact
- literal `f64`: from its bits, so -0 and NaN payloads are exact
- literal `concat`: comptime; at run time std.mem.concat

</details>

<details><summary>Go</summary>

Types: The Go Programming Language Specification, Types (Numeric types, String types, Slice types).

Names: MixedCaps: a function is exported, so its first letter is a capital (hkdfExpandSha256 → HkdfExpandSha256); a parameter is unexported (lowerCamel). Words split at each capital and a digit run stays on the word before it (chacha20Poly1305Seal → Chacha20Poly1305Seal). An initialism, one the contract writes in capitals or one in golint's list (ID, URL, HTTP, UTF8, …), is all capitals after the first word (userId → userID, parseHttpRequest → ParseHTTPRequest); HKDF and SHA are not on the list, so they stay Hkdf and Sha. A name override always wins.

Modules (package): the neutral path is the import path; the package name is its last segment without underscores (Effective Go, Package names): nish/crypto/hkdf → import "nish/crypto/hkdf", package hkdf.

Choices:

- A refusing return is (T, error): Go has no optional, and the error result is how Go reports that a call declined (Effective Go, Errors). The contract gives no reason, so any non-nil error is the refusal and its message is dropped.
- An optional input is a pointer \*T, nil when absent, so absent and empty stay distinct (a nil []byte and an empty one compare equal under len).
- Initialisms follow a fixed list (golint's commonInitialisms) plus whatever the contract writes in capitals, so the rule is deterministic; HKDF, HMAC, SHA, AEAD are not on the list, and a name override can spell them HKDF.

Notes:

- type `string`: a Go string may hold any bytes; the UTF-8 guarantee is the implementation's
- type `f64`: IEEE 754 binary64 (Spec, Numeric types)
- type `secret-bytes`: no secret type; secrecy is dropped
- outcome `refusing-return`: a non-nil error is the refusal; which error it is is outside the contract
- outcome `optional-input`: nil is the absent argument
- literal `str`: non-ASCII and control characters as \u escapes, a scalar above U+FFFF as \U
- literal `int`: converted to its type, so every width is exact
- literal `f64`: from its bits, so -0 and NaN payloads are exact

</details>

<details><summary>C++</summary>

Types: ISO/IEC 14882:2020 (C++20), [cstdint.syn] fixed-width integers, [basic.fundamental], [views.span], [optional].

Names: functions and parameters underscore_style (NL.10), as the standard library is: words split at each capital, an acronym is one word (parseHTTPRequest → parse_http_request), and a digit run stays on the word before it (chacha20Poly1305Seal → chacha20_poly1305_seal). A name override always wins.

Modules (namespace): nested namespaces, one per segment, declared in the header at the neutral path plus .hpp: nish/crypto/hkdf → namespace nish::crypto::hkdf in nish/crypto/hkdf.hpp.

Choices:

- A refusing return is std::optional&lt;T> (C++17), not std::expected&lt;T, E> (C++23) or an exception: the contract gives no reason, so E would be invented.
- Inputs are non-owning std::span / std::string_view and outputs owning std::vector / std::string, so the contract's single bytes type splits by position.

Notes:

- type `bytes`: a returned value is std::vector&lt;std::uint8_t>
- type `string`: UTF-8 octets; a returned value is std::string. The UTF-8 guarantee is the implementation's
- type `f64`: binary64 where std::numeric_limits&lt;double>::is_iec559 holds; the standard does not require it
- type `secret-bytes`: no secret type in the standard library; secrecy is dropped
- type `i8`: the exact-width types are optional in the standard; every mainstream target has them
- outcome `refusing-return`: std::nullopt is the refusal
- outcome `optional-input`: std::nullopt is the absent argument
- literal `str`: a std::string_view literal (using namespace std::literals; [string.view.literals]), so its length is the literal's and keeps an embedded U+0000, which a plain "a\0b" would end at. Non-ASCII and control characters as their UTF-8 bytes in \x escapes ("\xc3\xa9"sv for é), split into adjacent literals where a hex digit follows ("\x00" "b"sv); a u8 literal is char8_t in C++20 and does not convert to std::string_view
- literal `int`: braced, so a value out of range is a compile error; a minimum as -MAX - 1 (std::int64_t{-9223372036854775807 - 1}), and a u64 above INT64_MAX with a u suffix (std::uint64_t{18446744073709551615u})
- literal `f64`: from its bits (C++20 [bit.cast]), so -0 and NaN payloads are exact
- literal `concat`: no array concatenation in a literal; the joined bytes are written as one array

</details>

<details><summary>C#</summary>

Types: ECMA-334 (C# Language Specification), Types › Simple types and Nullable value types.

Names: methods PascalCase and parameters camelCase: words split at each capital, a digit run stays on the word before it (hkdfExpandSha256 → HkdfExpandSha256), a two-letter acronym stays in capitals and a longer one is cased like a word (readIOStream → ReadIOStream, parseHTTPRequest → ParseHttpRequest). A name override always wins.

Modules (class): a static class named for the last segment, in a namespace of the others, all PascalCase (Design Guidelines, Names of Namespaces): nish/crypto/hkdf → static class Hkdf in namespace Nish.Crypto.

Choices:

- A refusing return is a null return ({T}?), not a thrown exception or the Try pattern (bool TryX(..., out T)): a refusal is an expected outcome, tested by the vectors, and null maps the contract's null one-to-one. An implementation that throws ArgumentException is still checkable by mapping the throw to the refusal.
- bytes are byte[] in both positions, though ReadOnlySpan&lt;byte> would avoid a copy on input.
- A namespace holds no functions, so the module is a static class of static methods named for its last segment. A method whose PascalCase name equals that class's name is CS0542, so it takes a name override.

Notes:

- type `bytes`: a ReadOnlySpan&lt;byte> input would avoid a copy; byte[] is chosen for one type in and out
- type `string`: UTF-16; every Unicode scalar value is representable
- type `f64`: IEC 60559 binary64
- type `secret-bytes`: no secret type; secrecy is dropped (CryptographicOperations.ZeroMemory can wipe a copy)
- outcome `refusing-return`: null is the refusal: a nullable reference type for byte[] and string, Nullable&lt;T> for value types
- outcome `optional-input`: null is the absent argument
- literal `hex`: or Convert.FromHexString("0b0b")
- literal `ascii`: a UTF-8 literal (C# 11), ASCII being a subset
- literal `str`: non-ASCII as \u escapes, a scalar above U+FFFF as \U
- literal `int`: per width: sbyte, short, byte and ushort by a cast ((sbyte)-128), int bare, uint 42u, long 42L, ulong 42UL; -2147483648 and -9223372036854775808 are valid as written
- literal `f64`: from its bits (.NET 6), so -0 and NaN payloads are exact; Int64BitsToDouble would not take a hex literal with the sign bit set, which is a ulong (C# spec §6.4.5.3)
- literal `concat`: a collection expression (C# 12)

</details>

<details><summary>C</summary>

Types: ISO/IEC 9899:2018 (C17), §7.20 &lt;stdint.h>, §7.18 &lt;stdbool.h>, Annex F (IEC 60559 floating point).

Names: functions and parameters lower snake_case, a function behind its module prefix: words split at each capital, an acronym is one word (parseHTTPRequest → parse_http_request), and a digit run stays on the word before it (hkdfExpandSha256 → nish_crypto_hkdf_hkdf_expand_sha256). The prefix repeats a segment when the name does; a name override removes the repetition.

Modules (header-prefix): a header at the neutral path plus .h, and every symbol prefixed by the segments joined with _ (C has one namespace for external names): nish/crypto/hkdf → nish/crypto/hkdf.h, nish_crypto_hkdf_&lt;name>.

Choices:

- A refusing return is an int status (0 success, nonzero the refusal) with the value through an out-parameter. The contract gives no reason, so the nonzero value carries none.
- Bytes are a pointer/length pair; returned bytes go to a caller-supplied buffer (uint8_t \*out, size_t \*out_len), so a function returning bytes always returns a status: a buffer too small is a status the contract does not define, and is outside it.
- An optional input is a pointer that may be NULL. For bytes the NULL pointer is the absence, so (NULL, 0) and an empty buffer differ.
- A string is NUL-terminated, so a string containing U+0000 cannot be passed: that one value is dropped.

Notes:

- type `bytes`: a pointer and a length; a returned value goes through out-parameters uint8_t \*out, size_t \*out_len
- type `string`: NUL-terminated UTF-8, so a string holding U+0000 cannot be passed; that value is dropped. A returned string goes into a caller-supplied buffer char \*out, size_t out_cap, so the caller owns it
- type `bool`: &lt;stdbool.h>
- type `f64`: binary64 where __STDC_IEC_559__ is defined (Annex F)
- type `secret-bytes`: no secret type; secrecy is dropped (C23 memset_explicit can wipe a copy)
- outcome `refusing-return`: returns 0 with the value in \*out, or a nonzero status for the refusal; which nonzero value is outside the contract
- outcome `optional-input`: NULL is the absent argument; for bytes, a NULL pointer (its length ignored), so absent and empty stay distinct
- literal `hex`: a compound literal, with its length sizeof'd; empty bytes as a non-NULL pointer and length 0, as C before C23 has no empty initializer
- literal `ascii`: without the terminating NUL in its length
- literal `str`: non-ASCII and control characters as their UTF-8 bytes in \x escapes ("\xc3\xa9" for é), split into adjacent literals where a hex digit follows ("\xc3\xa9" "b"); a u8 literal is char8_t, not char, in C23
- literal `int`: &lt;stdint.h> constant macros give each width; a minimum is its INTn_MIN macro, or (-INT64_MAX - 1)
- literal `f64`: an expression: a compound literal of a union, read through its other member (C17 §6.5.2.3 footnote 97), so -0 and NaN payloads are exact
- literal `concat`: no concatenation of arrays; the joined bytes are written as one array

</details>

<details><summary>Java</summary>

Types: The Java Language Specification (Java SE 21), §4.2 Primitive Types and Values.

Names: methods and parameters lowerCamelCase: words split at each capital, a digit run stays on the word before it (hkdfExpandSha256 → hkdfExpandSha256), and an acronym is cased like a word (parseHTTPRequest → parseHttpRequest, readIOStream → readIoStream). A name that is a Java keyword takes a name override.

Modules (class): a final class of static methods named for the last segment, in a package of the others (JLS §6.1, package names lowercase): nish/crypto/hkdf → class Hkdf in package nish.crypto.

Choices:

- Unsigned widths widen to the next signed type (u8, u16 → int; u32 → long), and u64 stays long read unsigned: the value is kept, the type no longer states its range.
- A refusing return is Optional&lt;T>, not a thrown exception: the refusal is an expected outcome, and Optional's API note names this use. An implementation that throws IllegalArgumentException is still checkable by mapping the throw to the refusal.
- An optional input is a nullable reference; Optional parameters are discouraged by the same API note.

Notes:

- type `bytes`: each element read unsigned (b &amp; 0xff)
- type `string`: UTF-16; every Unicode scalar value is representable
- type `f64`: IEEE 754 binary64 (JLS §4.2.3)
- type `secret-bytes`: no secret type; secrecy is dropped (Arrays.fill can wipe a copy)
- type `u8`: Java has no unsigned types; widened to int, range 0..255 the implementation's to keep
- type `u16`: widened to int, as char is not a number here
- type `u32`: widened to long
- type `u64`: the same 64 bits read unsigned, with Long.compareUnsigned, Long.divideUnsigned and Long.toUnsignedString (JLS has no wider primitive)
- outcome `refusing-return`: {T} boxed (boolean → Boolean, byte → Byte, short → Short, int → Integer, long → Long, double → Double; byte[] and String as they are), since a type argument is a reference type (JLS §4.5.1). Optional.empty() is the refusal; java.util.Optional's API note names it the return type for 'no result'
- outcome `optional-input`: org.jspecify.annotations.Nullable (JSpecify 1.0), a type-use annotation on {T} boxed as for a refusing return, and on an array as byte @Nullable [] (@Nullable byte[] would annotate the element type); null is the absent argument, and Optional is not used for parameters
- literal `hex`: java.util.HexFormat (Java 17)
- literal `str`: non-ASCII as \u escapes, a scalar above U+FFFF as its UTF-16 surrogate pair; a control character as an octal escape (\000), since a \u escape is translated before the literal is read (JLS §3.3) and \u000a would end the line
- literal `int`: per width: i8 a cast (byte) 42 and i16 a cast (short) 42, since a method argument is not narrowed from int (JLS §5.3); i32, u8 and u16 42; i64, u32 and u64 42L. The minimums (byte) -128, (short) -32768, -2147483648 and -9223372036854775808L are valid as written, and a u64 above Long.MAX_VALUE is its bits as a hex long (0xffffffffffffffffL)
- literal `f64`: from its bits; a NaN payload may not survive arithmetic, but is kept by the conversion
- literal `null`: Optional.empty() where the refusal is meant

</details>

<details><summary>Kotlin</summary>

Types: Kotlin Language Specification, Built-in types and their semantics (kotlin.Byte…Long, kotlin.UByte…ULong, nullable types).

Names: functions and parameters lowerCamelCase: words split at each capital, a digit run stays on the word before it, a two-letter acronym stays in capitals and a longer one is cased like a word (readIOStream → readIOStream, parseHTTPRequest → parseHttpRequest). A name that is a hard keyword takes a name override.

Modules (class): an object named for the last segment, in a package of the others (Coding Conventions, Names for packages and classes): nish/crypto/hkdf → object Hkdf in package nish.crypto.

Choices:

- A refusing return is a nullable type ({T}?), not a thrown exception or Result&lt;T>: Kotlin's null safety makes the refusal visible in the type.
- Unsigned widths keep their own types (UByte…ULong); only bytes stays ByteArray, signed, as UByteArray is experimental.
- The module is an object rather than top-level functions, so a caller names it as Java does.

Notes:

- type `bytes`: UByteArray is still experimental; elements read unsigned with toUByte()
- type `string`: UTF-16; every Unicode scalar value is representable
- type `f64`: IEEE 754 binary64
- type `secret-bytes`: no secret type; secrecy is dropped (fill(0) can wipe a copy)
- outcome `refusing-return`: null is the refusal
- outcome `optional-input`: a nullable parameter, null the absent argument
- literal `hex`: a byte above 0x7f as 0xff.toByte(); "0b0b".hexToByteArray() needs @OptIn(ExperimentalStdlibApi::class) in Kotlin 1.9
- literal `str`: non-ASCII as \u escapes, a scalar above U+FFFF as its UTF-16 surrogate pair (Kotlin has no \U); $ escaped as \$
- literal `int`: per width: i8 42.toByte(), i16 42.toShort(), i32 42, i64 42L, u8 42u.toUByte(), u16 42u.toUShort(), u32 42u, u64 42uL; the minimums as Int.MIN_VALUE and Long.MIN_VALUE, since -2147483648 is a Long and -9223372036854775808L does not compile
- literal `f64`: from its bits, so -0 and NaN payloads are exact; the bits are a ULong literal, as a hex Long literal with the sign bit set (-0, any negative value) does not compile
- literal `concat`: ByteArray.plus

</details>

<details><summary>Python</summary>

Types: The Python Language Reference, §3.2 The standard type hierarchy; PEP 484 (type hints), PEP 604 (X | None).

Names: functions and parameters lower snake_case: words split at each capital, an acronym is one word (parseHTTPRequest → parse_http_request), and a digit run stays on the word before it (hkdfExpandSha256 → hkdf_expand_sha256). A name that is a keyword takes a name override.

Modules (module): a module at the dotted neutral path, lowercase (PEP 8, Package and Module Names): nish/crypto/hkdf → nish.crypto.hkdf.

Choices:

- Every integer width is int: the width is not in the type, so a value out of range is the implementation's to refuse.
- A refusing return is None, not a raised ValueError. The idiomatic raise is still checkable by mapping the exception to the refusal.
- secret-bytes is bytes: Python cannot wipe an immutable object, so secrecy is dropped.

Notes:

- type `string`: every Unicode scalar value is representable
- type `f64`: binary64 on every CPython platform (sys.float_info)
- type `secret-bytes`: no secret type and bytes are immutable, so a copy cannot be wiped; secrecy is dropped
- type `i8`: arbitrary precision; the width is the implementation's to check
- type `i16`: arbitrary precision; the width is the implementation's to check
- type `i32`: arbitrary precision; the width is the implementation's to check
- type `i64`: arbitrary precision; the width is the implementation's to check
- type `u8`: arbitrary precision; the width is the implementation's to check
- type `u16`: arbitrary precision; the width is the implementation's to check
- type `u32`: arbitrary precision; the width is the implementation's to check
- type `u64`: arbitrary precision; the width is the implementation's to check
- outcome `refusing-return`: None is the refusal (PEP 604)
- outcome `optional-input`: None is the absent argument
- literal `str`: non-ASCII and control characters as \u or \U escapes
- literal `f64`: from its bits, so -0 and NaN payloads are exact

</details>

<details><summary>TypeScript</summary>

Types: ECMA-262 (ECMAScript 2024), §6.1.6.1 The Number Type, §6.1.6.2 The BigInt Type, §23.2 TypedArray Objects (Uint8Array).

Names: functions and parameters lowerCamelCase, an acronym cased as a whole word (the guide's loadHttpUrl): words split at each capital, a digit run stays on the word before it (parseHTTPRequest → parseHttpRequest, readIOStream → readIoStream, hkdfExpandSha256 → hkdfExpandSha256). A name that is a reserved word takes a name override.

Modules (file): an ES module at the neutral path, imported as a namespace named for its last segment: nish/crypto/hkdf → import \* as hkdf from "nish/crypto/hkdf", called hkdf.&lt;name>.

Choices:

- Widths up to 32 bits are number, and i64/u64 are bigint, so every integer is exact; the type no longer states the width.
- f64 is number: every binary64 value but a NaN's payload is kept. That payload is dropped.
- A refusing return is null and an optional input is undefined, so the two outcomes of ? keep different spellings.

Notes:

- type `string`: UTF-16; a lone surrogate is also representable, and is the implementation's to refuse
- type `f64`: binary64, but a NaN payload is not preserved (ECMA-262 §6.1.6.1: all NaNs are one value)
- type `secret-bytes`: no secret type; secrecy is dropped (fill(0) can wipe a copy)
- type `i64`: number is exact only to 2^53
- type `u64`: as i64
- outcome `refusing-return`: null is the refusal
- outcome `optional-input`: an optional parameter; undefined is the absent argument
- literal `ascii`: UTF-8, of which ASCII is a subset
- literal `str`: non-ASCII and control characters as \u{…} escapes
- literal `int`: 42n for i64 and u64
- literal `f64`: from its bits, so -0 is exact; a NaN payload is lost

</details>

<details><summary>PHP</summary>

Types: PHP Language Reference, Types (Integers, Floating point numbers, Strings, Nullable types); PHP 8.2.

Names: methods and parameters camelCase with words as the contract writes them (PSR-1 requires camelCase and leaves acronyms open): parseHTTPRequest → parseHTTPRequest. A name that is a reserved word takes a name override.

Modules (class): a final class of static methods, its fully qualified name the segments in PascalCase (PSR-4 autoloads classes, not functions): nish/crypto/hkdf → Nish\Crypto\Hkdf.

Choices:

- u64 is unsupported: no native PHP type holds the upper half of its range. A contract with u64 cannot be checked against a PHP implementation.
- Every other integer width is int on a 64-bit build; the width is not in the type.
- bytes and string are both string; only the parameter's name and contract tell them apart.

Notes:

- type `bytes`: PHP strings are byte strings
- type `string`: UTF-8 bytes; validity is the implementation's to check
- type `f64`: binary64 on every supported platform
- type `secret-bytes`: with #[\SensitiveParameter] before the parameter (PHP 8.2), which keeps the value out of stack traces: #[\SensitiveParameter] ?string $x = null. An attribute is not part of a type, so a return cannot carry it and a returned secret drops it; the value is not wiped (sodium_memzero can)
- type `i8`: a 64-bit build is assumed; the width is the implementation's to check
- type `i16`: a 64-bit build is assumed; the width is the implementation's to check
- type `i32`: a 64-bit build is assumed; the width is the implementation's to check
- type `i64`: exact on a 64-bit build (PHP_INT_SIZE 8); its minimum is written PHP_INT_MIN
- type `u8`: a 64-bit build is assumed; the width is the implementation's to check
- type `u16`: a 64-bit build is assumed; the width is the implementation's to check
- type `u32`: a 64-bit build is assumed; the width is the implementation's to check
- outcome `refusing-return`: null is the refusal
- outcome `optional-input`: null is the absent argument
- literal `str`: double-quoted, so $ is written \$ (a double-quoted string interpolates $x), \ as \\ and " as \"; non-ASCII and control characters as \u{…} escapes
- literal `int`: i64's minimum as PHP_INT_MIN: -9223372036854775808 is the float negation of an overflowed literal
- literal `f64`: from its bits (big-endian double), so -0 and NaN payloads are exact

</details>

<details><summary>Swift</summary>

Types: The Swift Programming Language (Swift 5.9), The Basics › Integers, Floating-Point Numbers, Optionals.

Names: functions and parameters lowerCamelCase with words as the contract writes them, so an acronym keeps its uniform case (API Design Guidelines): parseHTTPRequest → parseHTTPRequest, hkdfExpandSha256 → hkdfExpandSha256. A name that is a keyword takes a name override (or backticks).

Modules (module): Swift modules do not nest, so one module named by the segments in UpperCamelCase, joined: nish/crypto/hkdf → NishCryptoHkdf.

Choices:

- A refusing return is an Optional ({T}?), not throws: the refusals are simple domain errors with no reason to report, the case Swift's error-handling rationale gives Optional.
- Modules do not nest, so the module path is flattened into one UpperCamelCase name.

Notes:

- type `bytes`: Data would also do; [UInt8] needs no Foundation
- type `string`: every Unicode scalar value is representable
- type `f64`: IEEE 754 binary64
- type `secret-bytes`: no secret type; secrecy is dropped (CryptoKit's SymmetricKey is one where available)
- outcome `refusing-return`: nil is the refusal
- outcome `optional-input`: nil is the absent argument
- literal `str`: non-ASCII as \u{…} escapes
- literal `int`: every width exact
- literal `f64`: from its bits, so -0 and NaN payloads are exact

</details>

<details><summary>Dart</summary>

Types: Dart Programming Language Specification (6th edition), §10 Types and dart:core (int, double, BigInt), dart:typed_data (Uint8List).

Names: functions and parameters lowerCamelCase: words split at each capital, a digit run stays on the word before it, a two-letter acronym stays in capitals and a longer one is cased like a word (readIOStream → readIOStream, parseHTTPRequest → parseHttpRequest). A name that is a reserved word takes a name override.

Modules (file): a library file in the package named by the first segment, imported with a prefix named for the last: nish/crypto/hkdf → import 'package:nish/crypto/hkdf.dart' as hkdf, called hkdf.&lt;name>; a one-segment module is the package's main library (nish → package:nish/nish.dart).

Choices:

- Every signed width and u8..u32 are int; u64 is BigInt, as int cannot hold its upper half. On the web, i64 is exact only to 2^53, which this table drops.
- A refusing return is null ({T}?), not a thrown ArgumentError.

Notes:

- type `string`: UTF-16; every Unicode scalar value is representable
- type `f64`: IEEE 754 binary64
- type `secret-bytes`: no secret type; secrecy is dropped (fillRange can wipe a copy)
- type `i8`: the width is the implementation's to check
- type `i16`: the width is the implementation's to check
- type `i32`: the width is the implementation's to check
- type `i64`: exact on native; on the web int is a JavaScript number, exact only to 2^53
- type `u8`: the width is the implementation's to check
- type `u16`: the width is the implementation's to check
- type `u32`: the width is the implementation's to check
- type `u64`: int is signed 64-bit, so the upper half of u64 needs BigInt
- outcome `refusing-return`: null is the refusal (sound null safety)
- outcome `optional-input`: an optional positional parameter; null is the absent argument
- literal `ascii`: dart:convert
- literal `str`: non-ASCII as \u{…} escapes; $ escaped as \$
- literal `int`: BigInt.parse('…') for u64
- literal `f64`: from its bits on native, so -0 and NaN payloads are exact

</details>

---

## The idea

A generated function is only as trustworthy as the tests you happen to write.
vector removes the "happen to": it asks the model to state the program's
**contract** as formal pre/post-conditions, then hands the contract *and* the
implementation to Z3, which proves — over exact rationals, for every possible
input — that the postconditions follow from the preconditions. The model is a
*proposer*; Z3 is the *judge*. Three properties fall out of that split:

1. **Soundness by construction.** Emitted code carries a machine-checked proof,
   not a passing test suite. "Refuted" comes with a concrete counterexample.
2. **The model can't grade its own work.** Verification lives in deterministic
   code (schema validation → typecheck → axiom traceability → Z3), never in the
   model's judgement.
3. **Anti-gaming.** The Generator writes both body and contract, so it could
   "pass" by quietly dropping an axiom. A deterministic **traceability** check
   forbids that: every spec axiom must be enforced by some clause, and no clause
   may cite an axiom that isn't in the spec.

---

## Where the model runs

vector is the deterministic half only: schemas, validators, traceability and Z3.
It makes no model calls and needs no API key. The two model roles, Architect
(the `SpecPlan`) and Generator (the `Program`), are played by **Claude Code
itself**, in context, through the bundled skill, so they run on your Claude
subscription rather than on API tokens.

| | |
|---|---|
| Architect + Generator | Claude Code, via `.claude/skills/vector` |
| Engine's job | the deterministic **veto** (`vector --verify`) |
| Repair loop | Claude repairs in context and re-verifies |
| Headless / CI | `claude -p "…"` with the skill, then gate on `vector --verify` |

The invariant: **code is presented only when Z3 has proven every
postcondition.**

---

## Install & requirements

```bash
bun install
bun run fetch-z3    # puts a native z3 into .z3/ (see below)
```

- [**Bun**](https://bun.sh) — runs the `vector` CLI and the test suite.
- **A native `z3`** — the solver. `bun run fetch-z3` fetches a version-matched
  one into `.z3/` (via pip; needs Python). Alternatively set `$VECTOR_Z3` to a
  `z3` binary or put one on `PATH`. The compiled binary bundles its own, so it
  needs none of this (see [Architecture notes](#architecture-notes)). No Node
  required anywhere.
- No API key. vector never calls a model; authoring happens in
  [Claude Code](https://claude.com/claude-code) through the bundled skills.

---

## CLI usage

The `vector` bin has three modes, plus `vector spec`.

### Verify mode

Verify a **SpecPlan + Program** pair that some *other* agent produced — inside
Claude Code, that agent is Claude Code itself. This is the deterministic veto
only: shape → typecheck → axiom traceability → Z3.

```bash
# structured JSON (what the skill consumes)
bun run vector --verify test/fixtures/currency-spec.json test/fixtures/currency.json --json

# human dashboard + write the proven TypeScript out
bun run vector --verify test/fixtures/currency-spec.json test/fixtures/currency.json --emit converter.ts
```

`--verify` takes two positional paths — the spec plan first, the program second.
(Equivalent explicit form: `--spec <file> --program <file>`.)

Exit code is `0` only when the status is `PROVEN`, `1` otherwise — usable as a CI
gate.

### Fixture mode

Verify a hand-written Program alone (no spec plan, so no traceability check).
Handy for iterating on vector-lang by hand.

```bash
bun run vector -- --fixture test/fixtures/currency.json
```

### Diff mode (the regeneration gate)

Prove that a **new generation** of a program preserves the old generation's
observable behavior — or get the concrete input/output deltas where it
doesn't. See [Contract-driven development](#contract-driven-development-code-as-build-artifact)
for why this exists.

```bash
bun run vector --diff old-program.json new-program.json
```

```
── VECTOR DIFF ─────────────────────────────────────────
 old: usd_to_eur_converter   new: usd_to_eur_converter
 Status: DIFFERENT

 ✓ applyRate(amount: Real, rate: Real): Real — EQUIVALENT for all inputs
 ✘ usdToEur(amount: Real): Real — BEHAVIOR DIFFERS
     value:  at amount = 100 → old = 91, new = 92
```

Functions are matched by name; a pair is comparable when its positional param
types and return type agree (param renames are noted, not flagged). Per pair,
Z3 decides three questions, each **for all inputs**:

- **value** — on the shared valid domain, can the two bodies ever disagree?
- **domain narrowed** — is any input the old version accepted now rejected?
- **domain widened** — is any input the old version rejected now accepted?

`ensures` clauses are proof-only, so rewording a contract never registers as a
behavioral difference (it is still listed textually for review). A **removed**
function or a **changed signature** counts as a difference; an **added**
function is informational.

Status → exit code: `EQUIVALENT` → `0`, `DIFFERENT` / `UNDECIDED` → `1`,
invalid input or solver failure → `2`. Both sides are assumed to individually
pass `--verify` first (gate on that in CI); `--diff` re-runs only shape and
type checks.

### Flags

| Flag | Modes | Meaning |
|---|---|---|
| `--verify <spec> <program>` | verify | Verify a spec-plan + program pair. |
| `--spec <file>` / `--program <file>` | verify | Explicit form of the two `--verify` paths. |
| `--diff <old> <new>` | diff | Prove a regeneration behavior-preserving, or show the deltas. |
| `--fixture <file>` | fixture | Verify a lone Program JSON. |
| `--json` | all | Emit machine-readable JSON instead of the dashboard. |
| `--emit <file>` | verify/fixture | Write the proven TypeScript to a file (only when PROVEN). |

> Note: because `vector` is an npm script, `bun run vector --flag` passes `--flag`
> straight through. The `--` in `bun run vector -- --fixture …` is optional but
> harmless.

---

## Standalone binary

To use vector **outside this repo** — on your `PATH`, in CI, or in another
project — compile it to a single executable:

```bash
bun run build      # → dist/vector
```

`dist/vector` bundles the CLI, the engine, and a native `z3` solver into one
file. It needs **nothing on `PATH`** — no Node, no separate z3 install, no `bun
install`, no repo checkout, no API key.
On first use it unpacks z3 into `$XDG_CACHE_HOME/vector/z3` (else
`~/.cache/vector/z3`), a directory it creates with mode 0700 and refuses to use
if it is a symlink, another user's, or writable by others, or if any directory
above it is another user's or writable by others without the sticky bit; every
run checks the unpacked files against the embedded copy before executing them.
Drop it anywhere and run it:

```bash
./dist/vector --verify spec.json program.json --json
./dist/vector --fixture program.json
```

The build needs a native z3 in `.z3/` first (`bun run fetch-z3`).

The binary embeds the Bun runtime and Z3, both under their own licenses. Anyone
you give it to can read vector's license and every third-party notice with
`./dist/vector --licenses` (see [License](#license)).

How it's built (`scripts/build-binary.ts`): because `bun build --compile`
already emits a platform-specific executable, we embed a matching native z3 (the
`z3` binary + its shared library) as a tarball. On first solve the binary
extracts it once to a content-addressed cache under the system temp dir (reused
on subsequent runs) and runs z3 from there.

---

## The Claude Code skill

`.claude/skills/vector/` packages vector so it works **starting from the initial
prompt** inside Claude Code: no API key, no model call from vector.

**How to use it:** just ask, in natural language, for a small numeric function
that must be *proven* correct — e.g. *"give me a provably correct fee calculator
that never returns a negative amount"*. The skill's description triggers on
intents like "prove", "formally verify", "provably correct", "no
counterexamples", and on shapes like converters, rate/threshold/pricing math,
clamping, rounding, and bounds checks.

**What happens under the hood** (`SKILL.md` + `reference/vector-lang.md`):

1. Claude Code, as **Architect**, writes a `SpecPlan` JSON conforming to
   `schemas/spec-plan.json`.
2. Claude Code, as **Generator**, writes a `Program` JSON conforming to
   `schemas/program.json`.
3. It runs `vector --verify spec.json program.json --json` — the deterministic
   veto.
4. On `REFUTED` / `UNKNOWN` / `INVALID` it reads the structured `feedback` /
   `items`, repairs the **program** minimally (keeping every clause that already
   proved), and re-verifies — up to ~4 attempts.
5. It shows you the dashboard and the proven TypeScript **only** when the status
   is `PROVEN`.

The schemas remain the single source of truth — the skill points Claude at
`schemas/*.json` directly rather than keeping copies that could drift. For
headless use (CI, scripts), run the same skill with `claude -p "…"`; vector's
part is still only `--verify`.

---

## vector-lang reference

Programs are a small, restricted JSON AST — pure, total (except division), no
loops, recursion, strings, arrays, or state. This is deliberate: it's exactly
the fragment Z3 can decide.

**Types:** `Real` (exact rationals), `Int`, `Bool`.

**Expression nodes** (`kind` discriminates):

| `kind` | Fields | Notes |
|---|---|---|
| `num` | `value` | Decimal **string**, e.g. `"0.91"`, `"-3"`. Never scientific notation, never a JSON number — the string reaches Z3 as an exact rational. |
| `bool` | `value` | `true` / `false`. |
| `var` | `name` | A parameter, or `result` (allowed **only** in `ensures`). |
| `unop` | `op`, `arg` | `not` (Bool→Bool), `neg`/`abs` (numeric→same), `floor`/`ceil` (Real→Real, integer-valued but stays Real). |
| `binop` | `op`, `left`, `right` | `+ - * /`, `min`/`max`, `< <= > >= == != and or implies`. `min`/`max` render as `Math.min`/`Math.max`. |
| `ite` | `cond`, `then`, `else` | If-then-else **expression** (not a statement). |
| `call` | `fn`, `args` | Calls a function in a **strictly lower layer** of the same program. |

**Function contract:**

- `requires` — preconditions. A spec axiom "throws/errors/rejects if X" becomes
  `requires NOT X`, materialized as a runtime `throw` in the emitted TypeScript.
- `ensures` — postconditions over the params and `result`, **proven** by Z3 for
  all inputs satisfying the preconditions.
- Every clause carries the `axiomId` of the spec axiom it formalizes.

**Layering (Dijkstra's step-wise composition):** functions are ordered lowest
layer first; a function may only `call` functions in strictly lower layers. Each
`body` is a single pure expression whose type equals `returnType`.

**Division:** `/` requires **`Real`** operands and yields `Real` — JS `/` is
float64 division (`3/2 === 1.5`), so an `Int`-typed quotient would be unsound.
For discrete rounding use `floor`/`ceil` instead. Z3 proves the denominator is
nonzero on every reachable path; guard every `/` with a `requires`
(`denominator != 0`) or an `ite`; an unguarded division that could be zero is
reported as a *division hazard*.

**What "PROVEN" now guarantees.** Beyond proving each postcondition, the gate
enforces that the proof is *meaningful* and *survives execution*:

- **Non-vacuity.** The precondition region must be inhabited (Z3 checks
  `requires` are satisfiable). Contradictory `requires` — which would make every
  postcondition hold vacuously — are rejected. This gate fails closed: a Z3
  `unknown` counts as *not established*, never as a pass.
- **Non-triviality.** Every `ensures` must reference `result` and must actually
  depend on the body (Z3 checks the clause is *not* a tautology of the
  preconditions). `result == result` or a restated precondition is rejected.
  Fails closed on `unknown`, like non-vacuity.
- **Call-site preconditions.** A callee's `requires` is proven to hold for the
  actual arguments on every reachable path — not just inlined away.
- **Float64 conformance.** After the proof, the emitted code is interpreted in
  float64 over sampled boundary + random inputs (a sampling check, not a
  proof); a postcondition that is true over exact reals but false in float64
  (e.g. `(x+0.1)+0.2 == x+0.3` at `x = 0`) is reported and the code is
  withheld. The same stage simulates every callee's runtime guard, so a
  call-site precondition that float64 rounding pushes out of bounds (a proven
  `g(x*0.1)` throwing at `x = 5e-324`) also fails the gate. Prefer
  inequalities/tolerances over exact `==` on `Real` results.
- **The emitted source is what gets run.** The same samples are also executed
  against the emitted TypeScript itself, compiled from the exact text you
  receive. It must return what the proven program computes and throw exactly
  where the program rejects the input; any disagreement (or source that does
  not compile) is reported as an emitter fault and the code is withheld. This
  is what catches a printer mistake such as a dropped parenthesis, which the
  proof and the AST interpreter cannot see.
- **Domain guards.** The emitted function rejects `NaN`/`Infinity` (`Real`
  params), anything that is not a safe integer (`Int` params — at 2^53 and
  beyond a double no longer holds every integer) and non-booleans (`Bool`
  params) at runtime, so the runtime domain matches the domain the proof
  quantified over.

**Solver-friendliness:** prefer **linear** arithmetic — multiply variables by
literal constants, not by other variables. Nonlinear terms can make Z3 answer
`unknown`, which the engine treats as *not proven*.

**Exactness footnote:** proofs hold over exact rationals; the emitted JavaScript
runs `float64`, so extreme values may round. The dashboard and emitted code both
carry this note.

---

## The two artifacts

### SpecPlan (`schemas/spec-plan.json`)

The formal contract plus a layered decomposition. It is the *fixed point* of a
run — the Generator retries against it, never the reverse.

```jsonc
{
  "programName": "usd_to_eur_converter",
  "axioms": [
    { "id": "AX1", "kind": "pre",  "statement": "amount is non-negative (throws if amount < 0)" },
    { "id": "AX2", "kind": "post", "statement": "result equals amount times 0.91" },
    { "id": "AX3", "kind": "post", "statement": "result is non-negative" },
    { "id": "AX-RATE", "kind": "pre",  "statement": "the applied rate is strictly positive" },
    { "id": "AX2a",    "kind": "post", "statement": "applyRate returns amount times rate" }
  ],
  "units": [
    { "name": "applyRate", "layer": 1, "purpose": "Multiply an amount by a positive rate.",
      "params": [ { "name": "amount", "type": "Real" }, { "name": "rate", "type": "Real" } ],
      "returnType": "Real", "relevantAxiomIds": ["AX-RATE", "AX2a"] },
    { "name": "usdToEur", "layer": 2, "purpose": "Convert non-negative USD to EUR at 0.91.",
      "params": [ { "name": "amount", "type": "Real" } ],
      "returnType": "Real", "relevantAxiomIds": ["AX1", "AX2", "AX3"] }
  ]
}
```

### Program (`schemas/program.json`)

The implementation *and* its contract, in vector-lang. (Abbreviated — see
`test/fixtures/currency.json` for the full AST.)

```jsonc
{
  "programName": "usd_to_eur_converter",
  "functions": [
    {
      "name": "applyRate", "layer": 1, "purpose": "Multiply an amount by a positive rate.",
      "params": [ { "name": "amount", "type": "Real" }, { "name": "rate", "type": "Real" } ],
      "returnType": "Real",
      "requires": [ { "axiomId": "AX-RATE", "expr": /* rate > 0 */ } ],
      "ensures":  [ { "axiomId": "AX2a",   "expr": /* result == amount * rate */ } ],
      "body": /* amount * rate */
    }
    /* … usdToEur (layer 2) calls applyRate(amount, "0.91") … */
  ]
}
```

Run these two together through `vector --verify` to see the whole thing prove.

---

## Verify output (the JSON contract)

`vector --verify … --json` prints a discriminated `VerifyOutcome` (defined in
`src/verify.ts`). The `status` field selects the shape:

**`PROVEN`** — carries the rendered `dashboard` and the `emittedCode`:

```jsonc
{ "status": "PROVEN", "report": { /* full VerificationReport */ },
  "dashboard": "╔════…", "emittedCode": "// Generated by vector …" }
```

**`REFUTED` / `UNKNOWN`** — carries a prose `feedback` block **and** structured
`items[]`, one per unproven clause, for a targeted repair:

```jsonc
{
  "status": "REFUTED",
  "report": { /* … */ },
  "dashboard": "╔════…",
  "feedback": "Function usdToEur, ensures AX-BAD (result > amount): REFUTED — counterexample amount = 0.0 gives result = 0.0.",
  "items": [
    {
      "function": "usdToEur",
      "axiomId": "AX-BAD",
      "property": "result > amount",
      "issue": "counterexample",              // | "unknown" | "division-hazard"
                                              // | "precondition-hazard" | "vacuous"
                                              // | "trivial" | "conformance"
      "counterexample": { "inputs": { "amount": "0.0" }, "result": "0.0" },
      "hint": "The postcondition is false for the input shown. Fix the body or tighten a requires clause …"
    }
  ]
}
```

**`INVALID`** — shape / type / traceability failures, as the *complete* list
(so a repair loop fixes everything at once, not one error per round):

```jsonc
{
  "status": "INVALID",
  "errors": [
    "usdToEur: clause cites unknown axiom \"AX2\"",
    "axiom AX9 (\"unused axiom\") is not enforced by any clause"
  ],
  "feedback": "The program failed deterministic validation:\n- …"
}
```

**`ERROR`** — solver infrastructure failure (`{ "status": "ERROR", "message": … }`);
don't loop on it.

---

## Contract-driven development (code as build artifact)

vector supports a workflow where the **SpecPlan is the source of truth and the
generated code is ephemeral** — regenerated at will, never hand-reviewed. The
principle: *humans review intent, machines review everything else.* Z3 proves
*code ⊨ contract*; the one thing left for a human is *contract ⊨ intent*, so
the review surface for a change is the SpecPlan diff plus the behavioral
deltas below — never the code.

Two pieces make this safe:

### 1. Property-shaped axioms (keep the contract from becoming code)

An axiom is legitimate if it could appear in the ticket that requested the
feature or in a compliance doc: bounds (`result >= 0`), monotonicity, tier
behavior, conservation ("the split parts sum to the whole"), error behavior
("throws if negative"). An `ensures result == <formula>` clause is the
algorithm restated as spec — reviewing it is reviewing code by another name.

The verifier flags these as **advisory style warnings** (`styleWarnings` in
the `--verify` JSON; a `STYLE` block after the CLI dashboard). They never
block a proof: sometimes the formula *is* the requirement (a regulated fee, a
published rate). But the default posture is: keep contracts partial and
property-shaped, and let the diff gate carry the rest.

### 2. The regeneration gate (let machines carry behavioral stability)

Property-shaped contracts are deliberately partial, so two generations can
both prove yet differ on inputs the contract doesn't pin down. Rather than
fattening the contract, [`vector --diff`](#diff-mode-the-regeneration-gate)
has Z3 decide whether the old and new generations can be told apart at all:

- **EQUIVALENT** — provably identical behavior for all inputs. Zero review.
  This is the common case for pure regenerations (model upgrades, refactors).
- **DIFFERENT** — a concrete witness per delta: *"at `amount = 100`, old
  returned `91`, new returns `92`"*. A human reviews that one behavioral fact
  against the intended change — a ten-second decision, not a code review.

### The workflow

1. **SpecPlans live in git** and are reviewed like code — but at ticket
   granularity, since axioms are property-shaped. Generated `.ts` is a build
   artifact (commit it like a lockfile; nobody reads it).
2. **A feature is a SpecPlan diff.** Add axioms/units, regenerate, and let the
   traceability gate prove every axiom is enforced.
3. **CI gates every change twice:**

   ```bash
   vector --verify spec.json program.json --json   # exit 0 ⇔ PROVEN
   vector --diff prev-program.json program.json    # exit 0 ⇔ EQUIVALENT
   ```

   A `--diff` exit of `1` isn't a failure — it means the PR must explicitly
   acknowledge the listed deltas (they should match the ticket).
4. **Review surface per PR:** the SpecPlan diff + acknowledged behavior
   deltas. That's all.

What this does *not* cover: the glue code around the verified kernel (IO,
routing, persistence) is ordinary code under ordinary review, and the
call-site boundary — passing cents where the contract means dollars — is
guarded only by naming and types. Push every decision that *can* be a pure
numeric function into the kernel, and keep the glue thin.

---

## The Dijkstra Dashboard

The human-readable proof report: per-layer Hoare triples, one checkmark per
postcondition, counterexamples when a claim is refuted, and an honest note on
what's *proven* vs. *enforced at runtime*.

```
╔════════════════════════════════════════════════════════════════════╗
║                 VECTOR — PROOF REPORT               ║
╠════════════════════════════════════════════════════════════════════╣
║ Prompt:  "verify: test/fixtures/currency.json"                    ║
║ Attempt: 1/1      Solver: Z3 4.16.0 (native)      Status: PROVEN     ║
╠════════════════════════════════════════════════════════════════════╣
║ LAYER 1 · applyRate(amount: Real, rate: Real): Real                ║
║   { rate > 0 }  amount * rate                                      ║
║   { result == amount * rate }                                      ║
║   ✔ ensures AX2a  proven (unsat · 159 ms)                         ║
║   ⚠ guard rate > 0 enforced at runtime; proven to hold at every    ║
║   internal call site                                               ║
╟────────────────────────────────────────────────────────────────────╢
║ LAYER 2 · usdToEur(amount: Real): Real                             ║
║   { amount >= 0 }  applyRate(amount, 0.91)                         ║
║   { result == amount * 0.91  ∧  result >= 0 }                      ║
║   ✔ ensures AX2  proven (unsat · 4 ms)                            ║
║   ✔ ensures AX3  proven (unsat · 7 ms)                            ║
╠════════════════════════════════════════════════════════════════════╣
║ VERDICT: ALL POSTCONDITIONS PROVEN FOR ALL INPUTS                  ║
╚════════════════════════════════════════════════════════════════════╝
```

And the emitted TypeScript for the proven program — preconditions become runtime
throws, and every function's proven Hoare triple is documented in its doc
comment:

```ts
/**
 * Convert a non-negative USD amount to EUR at rate 0.91.
 * Layer 2 — Hoare triple proven by Z3:
 *   requires AX1: amount >= 0
 *   ensures  AX2: result == amount * 0.91
 *   ensures  AX3: result >= 0
 */
export function usdToEur(amount: number): number {
  if (!(amount >= 0)) {
    throw new RangeError("requires violated [AX1]: amount >= 0");
  }
  return applyRate(amount, 0.91);
}
```

When a claim is refuted the dashboard shows `✘ ensures … REFUTED` with the
counterexample, the verdict reports the violation count, and **no code is
emitted**.

---

## Schema-driven types

`schemas/*.json` is the single source of truth. The same JSON Schemas both
constrain the model's structured output **and** generate the TypeScript
types/parsers via [`@amritk/mjst`](https://www.npmjs.com/package/@amritk/mjst):

```bash
bun run generate:schemas    # → src/generated/ (checked in, never hand-edited)
```

`src/lang/shape.ts` is a deep structural validator owned by the engine: it
returns the **full** list of problems (the generated parsers throw on the
first), and is what feeds the skill's repair loop.

---

## Project layout

```
schemas/            JSON Schemas — source of truth for types + the skill's output
scripts/
  build-binary.ts   compiles the standalone `dist/vector` executable
  fetch-z3.ts       fetches a native z3 into .z3/ (source + build both use it)
src/
  cli.ts            entrypoint (the `vector` bin) — verify / fixture / diff modes, `vector spec`
  bin.ts            compile-only entry: embeds the native z3, then runs cli.ts
  verify.ts         deterministic (SpecPlan, Program) → proof veto + structured
                    feedback; the engine core the Claude Code skill calls
  diff.ts           the regeneration gate: old vs new program → EQUIVALENT or
                    concrete behavioral deltas
  lang/             AST types (generated), shape validator, typechecker, style lint
  solve/            vector-lang → SMT-LIB2 (smt.ts) → native z3 → report (runner.ts);
                    equivalence checking (equiv.ts)
  emit/             AST → runnable TypeScript
  report/           pretty-printer + Dijkstra Dashboard
  generated/        mjst output (checked in)
  rfc/              spec → contract → Nish test: profile.ts (kramdown-rfc
                    XML → contract), literals.ts, contract.ts (format, typing),
                    rfctext.ts (sections, hex, BCP 14 sentences), spectext.ts
                    (RFC plain text, hidden-text check), gates.ts,
                    sample.ts (Z3 boundaries), emit-nish.ts, run.ts, report.ts,
                    cli.ts (`vector spec`)
contracts/          RFC contracts (RFC 5869 HKDF, RFC 8439 ChaCha20-Poly1305), extracted from specs/ with the RFC as main source
rfcs/               the RFCs, as XML (`rfc<N>.xml`) or plain text (`rfc<N>.txt`), unmodified, as rfc-editor.org serves them
test/               bun test suites + fixtures
.claude/skills/vector/
  SKILL.md          the skill: the Architect→Generator→verify→repair loop
.claude/skills/vector-spec/
  SKILL.md          the skill: kramdown-rfc spec → build → extract → check → run
  reference/
    vector-lang.md     the vector-lang manual Claude reads before emitting artifacts
```

---

## Architecture notes

**Why the native z3 CLI.** The solver stage emits an SMT-LIB2 script
(`src/solve/smt.ts`) and drives the native `z3` executable over stdin
(`src/solve/runner.ts`), parsing its textual verdicts back into a
`VerificationReport`. Those two files are the *only* ones coupled to the solver;
swapping in a different backend (a Dafny/Verus CLI) touches nothing else. z3 is
located in order: an embedded copy extracted from the compiled binary,
`$VECTOR_Z3`, the repo-local `.z3/`, or `z3` on `PATH`. (An earlier design ran
the `z3-solver` wasm build in a Node subprocess to dodge a Bun pthread abort;
the native CLI removes both the wasm and the Node dependency.)

**Where the veto lives.** `src/verify.ts` is the deterministic core:
shape → typecheck → `checkAxiomTraceability` → Z3, returning the discriminated
`VerifyOutcome`. `--verify`, `--fixture` and the skill all go through it, so
they cannot disagree about what "proven" means.

**No model calls.** vector has no model client and no SDK dependency. Writing
the spec plan, the program and the kramdown-rfc specs is Claude Code's job,
through the skills in `.claude/skills/`; vector only checks what they write,
and `vector spec extract` derives each contract from its spec.

---

## Develop

```bash
bun test                 # unit + solver + verify + spec suites
bun run typecheck        # tsc --noEmit
bun run lint             # biome
bun run format           # biome --write
bun run generate:schemas # regenerate parsers after editing schemas/
bun run fetch-z3         # fetch a native z3 into .z3/ (needed by the solver)
bun run build            # compile the standalone dist/vector binary
```

The solver-backed suites need a native z3 (`bun run fetch-z3`, or `$VECTOR_Z3` /
`PATH`). They cover the shape validator, typechecker, emitter, the solver, the
`verify.ts` gate (PROVEN / REFUTED / INVALID paths) against the real z3
subprocess.

The RFC suites (`test/rfc.test.ts`, `test/rfc-lang.test.ts`) also run the
generated tests against a real nish when `VECTOR_NISH` points at a nish binary,
and skip those live tests without one. Set `VECTOR_REQUIRE_NISH=1` wherever a
nish is available (a local checkout, a release check) to make a missing
`VECTOR_NISH` a failure instead of a skip. CI has no nish and does not set it, so
CI does not run the live tests.

---

## Limitations

vector verifies exactly the fragment Z3 can decide, and no more:

- **In scope:** `Real` / `Int` / `Bool`, arithmetic, comparisons, boolean logic,
  `if-then-else`, `abs`/`min`/`max`/`floor`/`ceil`, and layered calls. Money,
  rates, thresholds, clamping, rounding (via `floor`), bounds checks.
- **Out of scope:** strings, arrays, IO, loops, recursion, state, data
  structures. If a request needs those, vector can still formalize and prove its
  **numeric core** — but the rest isn't verified and shouldn't be forced through.
- **Nonlinearity:** multiplying two variables can make Z3 answer `unknown`
  (undecided, not proven). Restate in linear arithmetic where possible.
- **Integer division:** `/` yields `Real` by design (JS `/` is float64
  division). For integer/discrete results use `floor`/`ceil`. A dedicated
  Euclidean `div`/`mod` is future work.
- **Reals vs. float64:** proofs are over exact rationals; emitted JS runs
  `float64`. vector no longer *assumes* this is harmless — a post-proof
  **conformance** stage fuzzes the emitted code in float64 and withholds it if a
  proven postcondition fails there or a callee's runtime guard fires on a
  contract-valid input. Exact `==`/`!=` over `Real` results is the usual
  culprit; prefer inequalities or an explicit tolerance. Fuzzing samples the
  input space — it catches the systematic rounding failures, but it is not a
  proof over float64.
- **Trust boundary:** Z3 proves *code ⊨ contract*. It cannot prove *contract ⊨
  your intent* — the displayed Hoare triples are what you should read and sign
  off on. vector makes that contract small and auditable; it does not read your
  mind.

---

## License

vector is MIT-licensed; see [`LICENSE`](LICENSE).

It depends on, bundles or quotes work by others, under their own licenses:
the Bun runtime and Z3, which the compiled binary embeds; the npm packages it
bundles; the IETF RFCs in `rfcs/` and the excerpts quoted from them in
`contracts/`; and two excerpts of nish used as test fixtures.
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) lists each with its license
text, and `vector --licenses` prints vector's license and those notices from the
binary itself.
