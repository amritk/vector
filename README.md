# vector — formally verified functions, written in Claude Code

Turn a casual natural-language request into a **formally verified** TypeScript
program. vector itself never calls a model: Claude Code (the bundled skills, on
your Claude subscription) writes the spec plan and program, and vector judges
them. No API key.

Inspired by Dijkstra's EWD249 — *"testing can show the presence of
bugs, but never their absence"* — vector never treats generated code as a black
box: an SMT solver (Z3) **proves** every postcondition holds for **all** inputs
before a single line of code is emitted. If a contract can't be proven, the code
is withheld.

It also turns **RFCs into conformance contracts** for nish's crypto: requirements
checked verbatim against the RFC text, the RFC's own test vectors, and properties
sampled at solver-chosen boundaries, compiled to a Nish test — see
[RFC → contract → Nish test](#rfc--contract--nish-test).

```
prompt ─▶ Architect ─▶ formal axioms + a layered decomposition   (the SpecPlan)
       ─▶ Generator ─▶ program + contracts in "vector-lang"          (the Program)
       ─▶ Z3        ─▶ proves / refutes each contract for all inputs
       ─▶ emit      ─▶ runnable TypeScript + a "Dijkstra Dashboard"
```

Claude Code plays Architect and Generator; it only ever *proposes* a structured
artifact, and a theorem prover holds the veto (`vector --verify`). When Z3 finds
a counterexample it flows back as structured feedback and Claude repairs the
program in context, then re-verifies. **Unproven code is never emitted.**

---

## Contents

- [RFC → contract → Nish test](#rfc--contract--nish-test)
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

`vector spec` (or its alias `vector rfc`) turns a specification — an RFC's
plain text, or a markdown document with numbered headings — into a
**contract** and the contract into a **Nish test** that checks an
implementation (nish's `std/crypto`) against it. The same
split as the rest of vector holds: a model (or you) *proposes* the contract;
deterministic code and Z3 decide whether it is faithful; nish runs it.

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

### Specs, sources and provenance

A spec is read as an **RFC** when it has its `Request for Comments: N` header
and form feeds, as **markdown** when it has a numbered `#` heading
(`## 1. Introduction`); anything else is refused, including RFC text whose form
feeds were stripped. In markdown, `## 3. Encoding` is section `3`,
`### 3.1. Length` is `3.1`, `## Appendix A. Vectors` is `A` (the trailing dot
is required; a heading given twice is refused). A MUST outside every numbered
section is refused: completeness needs a section to cite.

How the markdown reader treats each construct:

- **Fenced code** is kept verbatim (a `#` there is not a heading, a `<!--` not
  a comment, a MUST still counts). A fence that is never closed is refused.
- **Inline code** loses its backticks; a `<!--` inside it is text. So is one on
  an indented code line.
- **HTML comments** are dropped, headings and MUSTs inside them included. A
  `<!--` that is never closed is refused, not read as a comment to the end.
- **Emphasis** is kept as written, and `_MUST_`, `__MUST NOT__` and `**MUST**`
  are keywords.
- **Hex runs** end at every blank line, fence, heading, table row and table
  cell: a value counts only if one paragraph, one code block or one cell
  prints it. `[00 0f ff]` byte lists count as hex.
- **The BCP 14 key-words sentence** ("The key words MUST, … are to be
  interpreted as … BCP 14 …") is removed, and nothing else: the rest of its
  paragraph stays, and a sentence that only mentions key words ("The key words
  in the header MUST be sorted, see BCP 14.") keeps its MUST.

A contract may cite several documents:

```json
"source": { "title": "Hex encoding", "main": "hex" },
"sources": [
  { "id": "hex", "path": "../specs/hex.md" },
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
| coverage | a binding requirement no clause checks; a clause citing a requirement the contract does not state; a property whose assertion calls none of the functions under test |
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
bun run vector spec check contracts/<name>.json --spec specs/<name>.md --run-sources
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
the seed — whose `nish/…` is the last release — and it warns. Contracts are written
by hand or by Claude Code: the `vector-spec` skill reads the spec, writes the
contract, and repairs it against `check`'s gate feedback. vector calls no
model.

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
go. An export commented out counts as deleted. A re-export (`export { a }`),
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
| 1. write the spec | `specs/<name>.md`, with numbered headings | — | — |
| 2. contract, `check` | write `contracts/<name>.json` (the `vector-spec` skill, or by hand), then `vector spec check contracts/<name>.json --spec specs/<name>.md --run-sources` | `CONTRACT_VALID` | `INVALID` |
| 3. freeze | `"source": {…, "sha256": "<sha256sum of the spec>"}`, then `vector spec frozen --base origin/main contracts/<name>.json` | spec side only, hashes match | both sides touched, the spec changed, no `sha256`, a contract source outside `specs/` or `rfcs/`, no contract |
| 4. `emit` / `stale` | `vector spec emit contracts/<name>.json -o test/spec/<name>.ts`, then `vector spec stale test/spec/<name>.ts contracts/<name>.json` | the test is the contract's | stale, missing or doubled marker line |
| 5. implement, `run` | `vector spec run contracts/<name>.json --nish-root ../nish` | `SATISFIED` | `VIOLATED` / `ERROR` / `INVALID` |
| 6. `exports` | `vector spec exports contracts/<name>.json --nish-root ../nish --base origin/main` | every changed export tested or `outOfScope` | an unlisted export |
| 7. `mutate` | `vector spec mutate contracts/<name>.json --nish-root ../nish --base origin/main` | no survivor outside `allowSurvivors` | a survivor, zero mutants, all stillborn |

Every step exits 2 on a usage error (and `frozen`, `exports` and `mutate` on a
git error). Steps 1–4 are the spec-side PR, which a human approves; the
implementation PR then passes 3 and 5–7 without touching anything on the spec
side. `outOfScope` and `allowSurvivors` entries are contract changes, so they
belong in a spec-side PR too.

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
  rfc/              spec → contract → Nish test: contract.ts (format, typing),
                    rfctext.ts (sections, hex, BCP 14 sentences), spectext.ts
                    (markdown specs, format detection), gates.ts,
                    sample.ts (Z3 boundaries), emit-nish.ts, run.ts, report.ts,
                    cli.ts (`vector spec`)
contracts/          RFC contracts (RFC 5869 HKDF, RFC 8439 ChaCha20-Poly1305)
rfcs/               the RFCs' plain text, unmodified, as rfc-editor.org serves it
test/               bun test suites + fixtures
.claude/skills/vector/
  SKILL.md          the skill: the Architect→Generator→verify→repair loop
.claude/skills/vector-spec/
  SKILL.md          the skill: spec → contract → check → run
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
the spec plan, the program and spec contracts is Claude Code's job, through the
skills in `.claude/skills/`; vector only checks what they write.

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
