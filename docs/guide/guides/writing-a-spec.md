# Writing a spec

A spec is a [kramdown-rfc](https://github.com/cabo/kramdown-rfc) markdown
file under `specs/`. vector reads a fixed set of constructs from it, called
the **profile**, and refuses everything else it cannot read. This page lists
what a spec may say and what each construct becomes in the contract.
[From a spec to a contract](spec-to-contract.md) covers building and
extracting it.

Two fixtures are worth keeping open while you write:
[`tests/fixtures/profile/profile-hex.md`][profile-hex] uses every construct,
and [`tests/fixtures/kramdown/SURVIVAL.md`][survival] records what each one
becomes in the XML.

## The profile

| Contract field | Markdown | XML |
|---|---|---|
| `contract` | `docname: draft-<name>-00` in the front matter; `<name>` must be the file's basename | `<rfc docName="draft-<name>-00">` |
| `source.rfc`, an RFC as the main source | `keyword: [vector-main-RFC<N>]` in the front matter, with RFC<N> under `normative:` | `<keyword>vector-main-RFC<N></keyword>` in `<front>` |
| `target.module`, the signatures | one `~~~ ts-interface` block (see [Signatures](#signatures)) | `<sourcecode type="ts-interface">` |
| a requirement (`MUST` … `MAY`) | a paragraph holding one BCP 14 sentence, at one level, then `{: #R-ID}` on the next line | `<t anchor="R-ID">` with `<bcp14>` |
| a requirement (`DEFINITION`) | a paragraph starting `Definition: `, with no BCP 14 keyword, then `{: #R-ID}` | `<t anchor="R-ID">Definition: …</t>` |
| a requirement quoting an RFC | a blockquote whose last line is `{{Section N of RFCx}}`, then `{: #R-ID gi="blockquote"}` | `<blockquote anchor="R-ID">`, the `<xref section>` last |
| an exclusion | a paragraph starting `Untested: ` right after a requirement, an unanchored BCP 14 paragraph, or an unanchored RFC blockquote (`{: gi="blockquote"}`) | the next sibling `<t>Untested: …</t>` |
| a requirement's `note` | a paragraph starting `Note: ` right after the requirement | the next sibling `<t>Note: …</t>` |
| a property | a `~~~ ts-property` block (see [Properties](#properties)) | `<sourcecode type="ts-property">` |
| the vectors | one table, header exactly `Id \| Call \| Expected \| Covers \| Source \| Title` | `<table>` |
| a vector's `tolerance` | a paragraph `Tolerance: V1 ulps 1, {{Section N of RFCx}}: "quote"` (or `abs 1e-9`) right after the vector table or another `Tolerance:` paragraph (see [Tolerances](#tolerances)) | the next sibling `<t>Tolerance: …</t>` |
| a vector's `iterate` | a paragraph `Iterate: V1 1,000 times, (k, u) <- (f(k, u), k)` in the run after the vector table, among its `Tolerance:` paragraphs (see [Iterations](#iterations)) | the next sibling `<t>Iterate: … &lt;- …</t>` |
| an `outOfScope` export | a paragraph `Out of scope: <export>, <the reason no clause tests it>`, anywhere in the body | `<t>Out of scope: …</t>` |
| a requirement's or vector's `section` | the enclosing numbered section (`--- back` gives appendices A, B, …) | the section number `xml2rfc` gives |

### Signatures

The `~~~ ts-interface` block's first line is `// module: <root>/<path>`,
followed by `export function f(…): T` or `export const f = (…): T` lines.
After a later `// module: <root>/<other>` line come reference functions
(each recorded with its `module`) that properties may call.

- The module under test declares at least one function before any other
  module line.
- A module line is a line comment of one module after the previous
  signature. A comment of any other style or case whose text starts
  `module:` or `module <root>/` (`/* Module: … */`, `/// module: …`) is
  refused, and so is a module line inside a signature.
- A vector's Call names a function of the module under test, and a
  property's assertion calls at least one. A clause that calls only
  reference functions is refused.

### Requirements

- An id matches `[A-Za-z0-9][A-Za-z0-9._-]*`.
- Each anchored paragraph holds exactly one BCP 14 sentence, at one level.
  `X MUST a. Y MUST b.` under one anchor is refused: give each sentence its
  own anchor, and split `MUST … SHOULD` into two sentences.
- In an unnumbered section (`{: numbered="false"}` on the line after the
  heading), a requirement of this spec, an exclusion of an unanchored
  sentence and a vector table are refused, because they have no section
  number to record. A requirement quoting an RFC is accepted there, since it
  records the RFC's section.
- A quoted requirement must appear verbatim in that section of the RFC.

### Completeness

Every BCP 14 sentence is in a requirement, or excluded by the `Untested:`
paragraph after it.

- An `Untested:` paragraph that follows nothing it can exclude is refused.
- A `MUST`, `MUST NOT`, `SHALL`, `SHALL NOT`, `REQUIRED` or `DEFINITION`
  requirement that no clause covers is refused.
- A requirement followed by `Untested:` is an exclusion, not a requirement:
  no vector's Covers and no property may name it. The reason is the rest of
  the paragraph, kept whole, including any `Checked by: …`.
- The `{::boilerplate bcp14-tagged}` key-words paragraph is skipped. Put it
  first in `# Introduction`.
- A `Note: ` paragraph that follows no requirement is refused.

### An RFC as the main source

The front-matter keyword `vector-main-RFC<N>` makes RFC N the spec's main
source. The contract then takes the RFC form: `source.rfc` is N,
`source.sha256` is the RFC's, and the spec is not a `sources[]` entry.

- Completeness runs over the RFC: every `MUST`, `MUST NOT`, `SHALL`,
  `SHALL NOT` and `REQUIRED` sentence of RFC N must be quoted in a
  requirement or in an excluded blockquote. A miss names the RFC section
  (`Section 2 of RFC9990: MUST NOT sentence is neither a requirement nor an
  exclusion`).
- Everything a requirement holds must be RFC text. A `Definition:`
  paragraph, an anchored BCP 14 paragraph, an excluded paragraph, a vector
  Source naming a section of the spec, and any BCP 14 sentence of the spec's
  own are refused.
- A spec has one such key. A misspelt key, an RFC not under `normative:`,
  and an RFC nothing cites are refused.
- The RFC may be `.xml` or `.txt`; [`tests/fixtures/rfc-main/`][rfc-main]
  has both. `specs/rfc5869-hkdf-sha256.md` and
  `specs/rfc8439-chacha20-poly1305.md` are the committed profiles.

`spec check --spec specs/<name>.xml` checks a contract against the profile
itself. The RFC is still read from its recorded file, and the contract is
valid only if it is exactly what the profile extracts to; a profile whose
`docName` names another contract is refused. `--spec rfcs/rfc<N>.txt`, or no
`--spec`, checks against the RFC alone.

### Vectors

Call and Expected are each a single code span. Covers lists requirement ids,
comma-separated, with no repeats. Title is required. The Source cell says
where the expected value comes from:

| Source cell | Contract source |
|---|---|
| `{{Section N of RFCx}}` | `cite`, section N of that RFC |
| `{{anchor}}`, a numbered section of this spec | `spec` for a `null` or `bool` expected value; otherwise `cite`, that section, which must print the value |
| a single code span, `` `python3 -c '…'` `` | `command`, with the table's section for the args; the expected value must be bytes or a string |

The Call cell is `f(arg, …)`: as many arguments as `f` has parameters, each
of its parameter's type. The Expected cell must be of `f`'s return type.

### Tolerances

An `f64` result is compared bit for bit unless its vector has a tolerance.
Give one in a paragraph of its own, in a run directly after the vector
table, one paragraph per vector:

```md
Tolerance: V1 ulps 1, {{Section 5 of RFC9999}}: "the result is correctly rounded to within 1 ulp"

Tolerance: V2 abs 1e-9, {{accuracy}}: "within 1e-9 of half its argument"
```

- The words before the citation are the vector's id, the kind and the
  value, then a comma. The kind is `ulps`, a whole number from 1 to
  9007199254740991 units in the last place, or `abs`, a decimal greater than
  0 (`1e-9`, `0.5`) that stays finite as an f64.
- The citation is the section that allows the tolerance: `{{Section N of
  RFCx}}`, or `{{anchor}}` for a numbered section of this spec, but not the
  section holding the table (the quote would be found in the `Tolerance:`
  paragraph itself). In a spec whose main source is an RFC, only the RFC can
  be cited.
- After the citation comes `: ` and the sentence that allows it, in double
  quotes. It must appear in the cited section; extract's fidelity gate
  refuses it at the paragraph's line otherwise.
- The vector must be in the table, have one tolerance at most, and call a
  function that returns `f64`.

A `Tolerance:` paragraph anywhere else, or after a table that is not the
vector table, is refused.

### Iterations

Some RFCs print a vector that runs the function over and over, feeding each
result back in: RFC 7748 Section 5.2 gives X25519 after 1 and 1,000 and
1,000,000 rounds. Give such a row its own paragraph, in the run directly
after the vector table, mixed freely with its `Tolerance:` paragraphs:

```md
Iterate: 5.2-ITER-1000 1,000 times, (k, u) <- (x25519(k, u), k)

Iterate: 5.2-ITER-1M 1000000 times, slow, (k, u) ← (x25519(k, u), k)
```

- The row's Call holds the arguments of the first round, and its Expected
  holds the value after the last.
- The words before the tuple are the vector's id, the count and `times,`.
  The count is a whole number from 1 to 1,000,000,000 in digits, grouped in
  threes by commas (`1,000`) or not at all (`1000`): `1,00`, `01000`, `0`,
  `-1` and `1e3` are refused.
- `slow,` may follow `times,`, and nothing else may.
- The names come first, one per parameter of the row's function, then `<-`
  (or `←`), then the next round's arguments, one per name. Each is a name,
  or the row's call on the names in their order. With one parameter, the
  parentheses may be dropped: `x <- f(x)`.
- The vector must be in the table and iterated once at most, and an
  iterated vector has no tolerance.
- Extract's fidelity gate refuses the row when its section does not print
  the count, when the Expected value is not printed there, or when the
  Expected label counts other rounds (`After 1,000 iterations` on a vector
  iterated 2,000 times).

An `Iterate:` paragraph anywhere else, or after a table that is not the
vector table, is refused.

### The whole spec

- At least one requirement, and at least one vector row or property.
- Every `{{…}}` has a reference, and every cited RFC section exists.
- Each property calls a function under test.
- A function's name may not collide with a name the generated test uses
  itself, or with a ts-property operation.
- An `Out of scope:` paragraph names an export of the module and gives a
  reason after a comma. The name is an identifier, not a function under test
  or one a property calls, and appears in one such paragraph; the reason is
  not empty and uses no BCP 14 keyword (quote one, `"MUST"`, to name it).
  The name is not checked against the module, so a misspelt one excuses
  nothing. [`spec exports`](pr-gates.md#exports) then reports a change to
  that export as a note instead of failing on it.

## Literals

These are what Call and Expected cells may hold:

| Literal | Means |
|---|---|
| `"text"` | a JSON string of printable ASCII, tab, LF and CR. Where the signature takes bytes it is the ASCII bytes (`{ascii}`); where it takes a string, the string (`{str}`); anywhere else it is refused |
| `[00 0f f0 ff]` | bytes: lowercase hex pairs, separated by single spaces |
| `[]`, `(empty)` | empty bytes; labelled (`MESSAGE (length 0 bytes) = (empty)`), the empty value a section prints under that label (see [What a printed value is](#what-a-printed-value-is)) |
| `null`, `true`, `false` | themselves |
| `42`, `-1` | a decimal integer, in range for the parameter's type (`i8` … `u64`, e.g. `u8` 0..255); where the type is `f64` it is that f64 |
| `Key = 0b0b0b` | labelled bytes: lowercase hex pairs, no spaces. The label is the name the cited section prints the value under. A label may be several words, and its first word may start with digits joined to a letter (`32-bit fixed-common part = 07000000`); a bare number is not a label. A later word may be a comma-grouped number (`After 1,000 iterations`), and one later word may be a parenthesised group of such words (`MESSAGE (length 1 byte) = 72`, as RFC 8032 prints it). An apostrophe may join two letters inside a word (`Alice's private key`). The words may end in one alias after `, `: a single word, which may be joined to a group whose words are also `, ` apart (`Alice's private key, a = 7707…`, `Alice's public key, X25519(a, 9) = 8520…`, as RFC 7748 §6.1 prints them). An apostrophe may not start or end a word, follow another, or touch a digit (`'Alice`, `Alice''s`, `Alice'9`). A comma takes no space before it and exactly one after (`key,a` and `X25519(a,9)` are refused). An alias is one word (`key, a b` is refused), there is at most one, and a number such as `NaN` takes none, so `f(NaN, a = 00)` is still two arguments. A group may not come first, hold a paren, be empty, be left open, be followed by a second group or by more of its word (`X25519(a, 9)b`), or, outside an alias, hold a comma (`M (a, 9)`); in an alias it may not stand apart from its word (`X25519 (a, 9)`) |
| `L = 42` | a labelled decimal integer, checked against the cited section's "L = 42". Where the parameter (or return) type is an integer type it is the int; anywhere else digits that are also hex pairs (`42`) are labelled bytes, and digits with a leading zero are never an int: `L = 00` is bytes, and `L = 042` (not whole hex pairs) is refused |
| `22 × 0b`, `22 x 0b`, `IKM = 22 × 0b` | a run of bytes written that many times (`{hex, repeat}`), as RFCs print runs; optionally labelled. `22×0b` also reads. The count is at least 1, the run lowercase hex pairs, and the expansion at most 65536 bytes |
| `concat([00], Key = ff)` | the parts joined, all bytes; one level (`concat` does not nest), at least one part. `‖` is refused |

A bare decimal integer (`42`, `-9223372036854775808`) is an int, and an f64
where the signature takes one; `1.5`, `-2e-3`, `NaN`, `Infinity` and
`-Infinity` are f64 text. An integer literal must fit its type's range.

## Types

The contract names every type and literal in no language's terms. The
contract schema ([`schemas/rfc-contract.json`][schema], described in
[the RFC contract format](../../reference/formats/rfc-contract.md)) and
[`src/spec/contract/vocab.ts`][vocab] hold the same lists. The schema is
wider than what the profile reads today: it holds everything a spec can say,
and each language drops what it cannot express. What vector does not do yet
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

The profile reads every spelling in the table, and `| null` on each. `B?`
means one of two things by position, and its absent value is written `null`
either way:

- **a refusing return**: as a return type, the function declines this input
  and returns no value (`hexDecode("0") === null`);
- **an optional input**: as a parameter type, the argument may be absent.

### Literals in the contract

Beyond the profile's literals:

- **`{"int": …}`** is a JSON integer up to ±(2^53−1). A wider value, such as
  a `u64` or `i64` near its bound, is a decimal string (`{"int":
  "18446744073709551615"}`), as RFC 7493 §2.2 and RFC 8259 §6 recommend.
- **`{"f64": "0.1"}`** is decimal text, read to binary64 with roundTiesToEven
  (IEEE 754-2019 §5.12.2, §4.3.1), or `NaN`, `Infinity`, `-Infinity`; `-0`
  is negative zero. `bits`, when given, is the binary64 encoding as 16
  lowercase hex digits, big-endian (§3.4), and must be the one the text
  converts to; for `NaN` it fixes the payload. Decimal text past binary64's
  largest finite value (`1e400`) is refused, since it would round to an
  infinity (§7.4): write `Infinity` when one is meant.
- **A vector's `tolerance`** says how close an f64 result must be: `{"ulps":
  n}` units in the last place, or `{"abs": "1e-9"}` (a decimal string, so it
  is not itself rounded), with the `section` and `quote` of the source that
  allows it. The `quote` must appear in that section, and a tolerance on a
  non-`f64` result is refused. Without one, an f64 result is compared bit for
  bit, so a NaN equals a NaN of the same bits; an expected NaN or infinity is
  compared bit for bit even with a tolerance. In a property body `==` on f64
  is IEEE 754-2019 equality (§5.11): `NaN == NaN` is false and `-0 == 0` is
  true.

The profile spells a tolerance as a [`Tolerance:` paragraph](#tolerances).

A `forall` over `f64` is *not yet* sampled: the schema records such a
domain (`{"type": "f64", "min": "-1.5", "max": "Infinity"}`) and vector
refuses the property. A
`forall` integer may be any of `i8` … `u64`, with the same wide-integer
strings for bounds. The sampler takes each type's minimum and maximum, and Z3
solves over bit-vectors of its width, so `+ - * %` wrap as the evaluator's
do.

### What the Nish test can hold

Nish has `i32`, `i64`, `u8`, `u16`, `u32`, `u64` and `f64` but no `i8` or
`i16`, and `| null` only on reference types (`u8[]`, `string`,
`Secret<u8[]>`). So the emitter refuses a signature or `forall` using what
Nish lacks, and a module outside `nish/` unless `--package` says where it
lives ([Test your own modules](testing.md#test-your-own-modules)).

- The test defines helpers of its own, such as `utf8Bytes` and `bytesEq`, and
  Nish has no import aliasing, so a function under test cannot share one of
  their names; `spec extract` names the clash.
- A 64-bit int is written as `hi·2^32 + lo`, so no literal passes 2^53.
- An f64 is its shortest round-tripping decimal, or, for `-0`, `NaN` and the
  infinities, its bits.
- `i32` and `i64` `+ - *` are emitted as `wrappingAdd`, `wrappingSub` and
  `wrappingMul` from `nish:unsafe`, since Nish's signed operators panic on
  overflow. `u8`, `u16`, `u32` and `u64` are emitted as plain operators,
  which wrap in Nish. So for every integer type the test can hold, a sample
  that overflows wraps, as it does in the evaluator and the sampler.

### Modules and names

`target.module` and a reference function's `module` are a neutral path: two
or more lowercase segments joined by `/` (`nish/crypto/hkdf`), each a path
segment of RFC 3986 §3.3 limited to `[a-z][a-z0-9_]*`. A language derives its
own module name from the path; where its rule gives the wrong one,
`target.modules` overrides it per language (`{"java": "org.example.Hkdf"}`).
Likewise `names` on a function or a parameter overrides its name per language
(`{"rust": "expand"}`). The language keys are those
[`vocab.ts`][vocab] lists. The profile has no spelling for an override *yet*;
the schema carries them.

## Properties

A `~~~ ts-property` block is a small, total subset of TypeScript:

```ts
// P-ROUND-TRIP covers R-ROUND-TRIP — hexDecode(hexEncode(b)) is b
forall (b: u8[] /* 0..64 */) => {
  const d = hexDecode(hexEncode(b));
  return d !== null && unwrap(d) === b;
}
```

- **Line 1** is `// P-ID covers R-ID, R-ID — title`. The title is required,
  and the separator before it is exactly ` — ` (space, em dash, space).
- **Line 2** may be `// samples: N`, the number of samples the property's
  test runs. N is a decimal integer from 1 to 256, and it is the total:
  Z3's boundary samples come first (at most N of them), then seeded random
  ones until there are N. Without the line, a property gets every boundary
  sample plus 24 random, at most 96 in all. When the domain holds fewer
  than N inputs, or a `where` refuses most of N × 20 draws, the property
  gets what was found and `spec check` notes
  `asked for N samples; found M`. Extract refuses 0, anything
  past 256, anything but plain digits (`12.5`, `-1`, `096`), a samples
  line in another case or a block comment, and one anywhere but line 2.
  Any comment in the block whose first word is `samples` is a samples
  line, so `// samples are drawn small` is refused too: on line 2 as not
  a count, anywhere else as out of place.
- **`forall (var, …) => body`**, optionally followed by `where expr`. Each
  variable has a bound in a comment:
  - `b: u8[] /* lo..hi */`: a length, with 0 ≤ lo ≤ hi ≤ 4096.
  - `n: i32 /* lo..hi */`: a value in the type's range, for any of `i8` …
    `u64` (`/* -9223372036854775808..9223372036854775807 */` for `i64`).
  - `f64` is not a forall type *yet*.
  - `t: string /* lo..hi CLASS… */`: a length and character classes, from
    `hexdigit`, `HEXDIGIT`, `digit`, `alpha`, `space` and `ascii-printable`.
    `/* lo..hi "chars" */` gives the characters as a JSON string instead.
- **The body** is an expression, or `{ const x = …; return …; }`.
  Semicolons are optional. `where` restricts the domain: a boolean that
  calls no function under test and cannot see the body's `const`s.
- **Operators:** `|| && === !== == != < <= > >= + - * %`, unary `!`, and `-`
  on an integer literal.
- **Members:** `.length`, `.concat`, `.slice`, `.toLowerCase`,
  `.toUpperCase`, `.charAt`.
- **Operations:** `xor`, `bitAnd`, `bitOr`, `fill`, `zeros`, `flipBit`,
  `le64`, `unwrap`, `utf8`, `ascii`, `implies` and `concat`.
- **Semantics** are vector's evaluator's, not JavaScript's:
  - `===` on `u8[]` compares contents.
  - `.slice` clamps its bounds.
  - `a % 0` is 0.
  - integer `+ - * %` wrap at the operands' width.
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

## Sources and provenance

A source is a document vector reads as it is: RFC XML v3 (`.xml`) or an
RFC's plain text (with its `Request for Comments: N` header and form feeds).
Anything else is refused. `.xml` sources are read everywhere a source is:
by `extract`, `check`, `emit`, `run`, `frozen` and `mutate`.

### Hidden text

The gates look for `MUST`, `SHALL` and `REQUIRED` in a source's characters,
while a reviewer reads the rendered page. Where the two could disagree, the
source is refused rather than guessed at:

- an invisible code point anywhere (a format character such as U+200B or
  U+202E, a variation selector, a filler);
- a word that reads as a binding keyword but is not spelled in ASCII: a
  look-alike capital from another script (a Cyrillic `Т` in `MUST`), a
  mathematical or fullwidth letter, or a combining mark.

Both checks run on the file's bytes and again on the text its reader
decoded, so an XML character reference such as `&#1058;` cannot slip a
look-alike past them. One exception follows xml2rfc's own text output: in
XML, a zero-width space or word joiner written as a character reference
(`&#8203;`) is dropped from the decoded text, not refused.

### Linked RFCs

A spec cites an RFC by listing it under `normative:` and writing
`{{Section N of RFCx}}`. A quoted requirement, an exclusion of a quote, or a
vector Source can cite it. Each cited RFC becomes a `sources[]` entry.

Its text is looked up in four places, nearest first, the same for every
command: beside the contract, in `../rfcs/`, in the `rfcs/` of vector's
install root (the directory above the binary's own), then in the current
directory's `rfcs/`. At each place `rfc<N>.xml` is preferred over
`rfc<N>.txt`, so the order is `./rfc<N>.xml`, `./rfc<N>.txt`,
`../rfcs/rfc<N>.xml`, and so on.

- Once a contract records a source's `file`, that name wins: a contract that
  recorded `rfcs/rfc4648.txt` keeps reading it even after an `rfc4648.xml` is
  added at that place or a nearer one.
- A missing RFC exits 2 with the command that fetches its plain text:
  `curl -sSfL -o rfcs/rfc<N>.txt https://www.rfc-editor.org/rfc/rfc<N>.txt`.
  The `.txt` works for every RFC; an `rfc<N>.xml` beside it is read instead.
- An RFC listed but never cited needs no file.
- Commit the file to `rfcs/`. Its `sha256` is in the contract, so `check`
  and `frozen` fail if its bytes change.
- Do not list RFC 2119 or 8174: the boilerplate adds them.

### Several sources

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
document; completeness reads the main one only. An undeclared id, or a
declared source whose text cannot be found, fails `check`.
`"source": {"rfc": N, "title": …}` alone is the one-RFC form.

### Where a vector's value comes from

Every vector says where its expected value comes from (`source`):

| `source` | The expected value is | Checked by |
|---|---|---|
| `{"cite": {"section": "A.1"}}` (`"source"` optional) | printed in that section, with the args, as one test case (see [What a printed value is](#what-a-printed-value-is)) | fidelity |
| `{"command": "…"}`, with `"section"` for the args | the command's trimmed stdout (lowercase hex for bytes) | `spec check --run-sources` only; otherwise reported as not run, never as passed. A timeout, a nonzero exit or other output fails. See [Running the source commands](spec-to-contract.md#running-the-source-commands) |
| `{"spec": "4.2"}`, with `"section"` for the args | `null` or a `bool` that section states | provenance: a requirement the vector covers, cited to that section, must state `null`, `true` or `false` as the result, by [the rule below](#when-a-section-states-null-true-or-false) |

A vector without a source fails the shape gate. A `cite` source for a `null`
or `bool` is held to the same rule by fidelity.

<a id="what-a-printed-value-is"></a>

### What a printed value is

Fidelity binds each literal of a vector to one printed value, not to any run
of matching bytes:

- **Whole values.** A `hex` (or `ascii` read as bytes) must equal a whole
  printed value: a run of hex lines, a hexdump, a `0x…` or colon-hex value,
  or a `Key = 0b0b…` line and the lines that continue it. Part of one (a
  prefix of a key, the tail of a tag) is refused; `concat` joins whole
  values. A `str` must be printed whole: in quotes, in a markdown code span,
  on a line of its own, or ending a line after `=` or `:` (`"Zg"` is not
  printed by `"Zg=="`).
- **Labels.** A value printed under a name (`Key =`, `Input scalar:`, a short
  line such as `Plaintext:` above a dump) must give that name:
  `{"hex": "0b0b…", "label": "Key"}`. A label is matched as the section
  prints it, apostrophe and alias included: RFC 7748 §6.1 prints Alice's key
  as `Alice's private key, a:`, so a row writes
  `x25519Base(Alice's private key, a = 7707…)` and expects
  `Alice's public key, X25519(a, 9) = 8520…`. A label the section does not
  print the value under is refused: `Alice's private key, b`,
  `Alice private key, a`, `Alice's public key, X25519(a, 5)`, and Bob's key
  under `Alice's private key, a` all are, as is a value the cited section
  does not print at all (the 32-byte base point `[09 00 … 00]` against
  §6.1, or §6.1's key cited from §6.2).
- **Empty values.** A section prints an empty value as a label with nothing
  below it, its length stated as 0 (`MESSAGE (length 0 bytes):`, or
  `octets`). Empty bytes bind only under such a label:
  `{"hex": "", "label": "MESSAGE (length 0 bytes)"}`, written
  `MESSAGE (length 0 bytes) = (empty)` or `= []`. Under a label printed with
  a value (`MESSAGE (length 1 byte):` above `72`), under a label printed
  nowhere with nothing below it, or under one that states no length of 0
  bytes, empty bytes are refused. With no label, they bind only where the
  section prints `""` or `(0 octets)`.
- **One test case.** The expected value may not be bound to the same label
  as an argument (a key used as the expected MAC). Strings must share a
  printed line (`BASE64("f") = "Zg=="`). A label printed several times in
  the cited section is read in rounds (the k-th `Key` goes with the k-th
  `Data` and the k-th `HMAC-SHA-256`), so citing a parent section cannot mix
  values from two test cases.
- **Decimals.** In an RFC, an unnamed run of digit-only lines, or one under a
  name that calls it a number (`Input scalar as a number (base 10):`), is a
  decimal number, not bytes, and is not a value.
- **Variants.** Where the section prints the same case for several variants,
  under labels that differ only in a number (`HMAC-SHA-224` …
  `HMAC-SHA-512`), the label's number must be in the called function's name:
  the `HMAC-SHA-384` row as `hmacSha512`'s expected value is refused. A
  function named for none of them (`hmac`) gets a warning, since nothing says
  which variant it computes. A length in bytes inside a label (`X25519 (32
  bytes)`, `MESSAGE (length 2 bytes)`) is not a variant's number, so labels
  that differ only there are one variant.
- **Counts.** An iterated vector's count must be printed as a whole number
  on a line that is not a heading. A number inside a letter-led hyphen chain
  (`Vector-2-1000 iterations`) is part of a word, not a number, so that
  count reads as not printed.

<a id="when-a-section-states-null-true-or-false"></a>

### When a section states `null`, `true` or `false`

Only a requirement the vector covers states a result, and only through its
own quote. The rule is an allow list and fails closed: a false refusal costs
a rewording of the requirement's quote, while a false pass would break the
gate. There is no way around it: a `cite` source is held to the same rule,
and a `command` source cannot expect `null` or a `bool`.

1. The vector `covers` a requirement cited to that very section (same source,
   same section). Otherwise: "covers no requirement cited to it".
2. That requirement's quote is in the section's prose, not only in a code
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
5. The verb is a result verb in its bare form (`return`, `be`, `evaluate to`,
   `yield`, `give` or `output`), followed directly by the value (in any case,
   optionally in backticks or emphasis) as a whole word.
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
8. Nothing later in any sentence the quote touches retracts it: `not`,
   `never`, `no`, `none`, `nor`, `neither`, `cannot`, `…n't`, `avoid…`,
   `forb…`, `prohibit…`, `prevent…`, `disallow…`, `instead`, `rather`,
   `wrong…`, `incorrect…`, `bug…`, `an error`, `but`, `remov…`,
   `deprecat…`, `obsolete…`, `retract…`, `withdr…`, `supersed…`,
   `replaced`. Otherwise: "retracts …".

The refusal names the requirement and which step failed.

These state the result: "hexDecode MUST return null when the text has an odd
length" (its `when` comes after the value), "f MUST return true for valid
input", "f SHALL be false" and "f MUST always return null on odd input".

These do not: "MUST NOT, for any input, return null", "Implementations MUST
NOT, e.g. Python or Go, return null", "f MUST, for every input, return null",
"If the input is odd, f MUST return null", "f MUST return null or an empty
array", "f MUST return null. This was a bug.", the same sentence only in a
table or a code block, a requirement cited to another section, and, by
design, any descriptive sentence without a keyword, such as "f returns null
on failure" or "abc decodes to null".

## Authoring notes

- Close the front matter with `--- abstract`.
- Pin `date:` in the front matter as `YYYY-MM-DD`, or every rebuild on
  another day would drift.
- Give a section an explicit anchor as `## Empty input {#empty-input}`.
- Backslash escapes in a code span are passed through as written, so
  `` `"a\"b"` `` is the JSON string `a"b`.
- A refusal's wording may differ slightly from the examples on this page; the
  rule it names is the same.

[profile-hex]: https://github.com/amritk/vector/blob/main/tests/fixtures/profile/profile-hex.md
[survival]: https://github.com/amritk/vector/blob/main/tests/fixtures/kramdown/SURVIVAL.md
[rfc-main]: https://github.com/amritk/vector/tree/main/tests/fixtures/rfc-main
[schema]: https://github.com/amritk/vector/blob/main/schemas/rfc-contract.json
[vocab]: https://github.com/amritk/vector/blob/main/src/spec/contract/vocab.ts
