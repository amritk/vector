# Gating a spec-first PR

A module lands spec-first, in two pull requests. The **spec side** comes
first: the spec in `specs/`, its contract in `contracts/`, the RFCs it cites in
`rfcs/`, the `.refcache/` entries for the references it cites, and its
generated test in `test/spec/`. A person reads and approves
it. The **implementation** comes second, and four gates hold it to the
approved contract without a person rereading the spec:

| Gate | Refuses |
| --- | --- |
| [`spec frozen`](#frozen) | a change that edits the spec side and the implementation together, or a contract whose sources changed under it |
| [`spec stale`](#stale) | a generated test that no longer matches its contract |
| [`spec exports`](#exports) | a new or changed export its contract does not cover |
| [`spec mutate`](#mutate) | a plausible bug, in the changed lines the contract's functions reach, that its test does not notice |

Every gate exits 0 when it passed, 1 when it refused the change, and 2 for bad
usage, a file that cannot be read, or a git or tool failure. Each takes
`--format markdown`, which prints the report as a PR comment, and
`--format json`.

## The workflow, in order

| Step | Command | Exit 0 | Exit 1 |
| --- | --- | --- | --- |
| 1. write the spec | `specs/<name>.md`, then `bash scripts/build-spec.sh specs/<name>.md` ([Writing a spec](writing-a-spec.md)) | `specs/<name>.xml` written | a warning, or a render failure |
| 2. extract and check | `vector spec extract specs/<name>.xml -o contracts/<name>.json`, then `vector spec check contracts/<name>.json --run-sources` ([From a spec to a contract](spec-to-contract.md)) | written; `CONTRACT_VALID` | refusals, each at `file:line` |
| 3. frozen | `vector spec frozen --base origin/main` | one side only, or a rename alone; hashes match | both sides, a changed source |
| 4. emit and stale | `vector spec emit contracts/<name>.json -o test/spec/<name>.ts`, then `vector spec stale test/spec/<name>.ts contracts/<name>.json` | the test is the contract's | stale, or no marker line |
| 5. implement and run | `vector spec run contracts/<name>.json --nish-root ../nish` ([Testing an implementation](testing.md)) | `SATISFIED` | `VIOLATED`, `ERROR` or refused |
| 6. exports | `vector spec exports contracts/<name>.json --nish-root ../nish --base origin/main` | every changed export is tested | an export no clause tests |
| 7. mutate | `vector spec mutate contracts/<name>.json --nish-root ../nish --base origin/main` | no survivor outside `allowSurvivors` | a survivor, or no mutant built |

Steps 1 to 4 are the spec-side PR. The implementation PR then passes 3 and 5
to 7 without touching anything on the spec side.

## frozen

`spec frozen [contracts...] --base <ref>` sorts every file the change touches
(committed since the merge base with `<ref>`, staged, unstaged or untracked)
into a class:

- **spec**: `specs/`, `contracts/`, `rfcs/` and `.refcache/` (the
  kramdown-rfc reference cache a spec's build reads, so a spec lands with the
  entries for the references it cites);
- **generated**: a test in `test/spec/` whose one `// vector-contract-sha256:`
  line names a contract in `contracts/` (not a symbolic link) or one given on
  the command line, as that contract is in the work tree. It counts on the
  spec side, so it lands with its contract, not with the implementation. A
  test with no such line, with two, or naming no contract is implementation;
- **neutral**: `docs/` and the top-level `*.md` files;
- **implementation**: everything else.

It refuses a change with both spec and implementation files, and a contract
whose recorded source hashes no longer match the files. The contracts are
named from the repository's top, and default to every `contracts/*.json`.
Only the contracts given are checked and listed: naming one contract of a PR
that changes two still classes both tests as generated, but reports nothing
about the other. `--repo <dir>` names the repository when it is not the
current directory.

One change on both sides passes: renaming an export a contract tests. When
every checked contract that changed drops one function and adds one with the
same signature (module, parameters, return type and name overrides), and
every changed file is that rename alone, `frozen` passes and notes
`passed as a rename: <contract> renames <old> to <new>, and the <n> changed
files are that rename alone`, where `<n>` counts every changed path, neutral
ones too. A file is the rename alone when it is a regular
file at the fork point and now, with the same mode, did not name `<new>` at
the fork point, names no `<old>` now, and replacing each whole
identifier `<old>` with `<new>` in its fork-point text gives its text now,
line for line. The contract's `"sha256"` values and a generated test's
`// vector-contract-sha256:` line are exempt, since the rename changes them.
Anything else (a second rename, two contracts renaming one name two ways, a
changed signature, an added or deleted file, one extra edit) is refused: the
report names the first file or contract that is not the rename, after the
usual both-sides problem:

```text
problems:
  ✗ the change touches the spec side (contracts/c.json, specs/s.md, specs/s.xml, test/spec/c_test.ts) and the implementation (src/x.ts): change them in separate PRs
  ✗ not a rename alone: src/x.ts: line 3 is not the rename alone
```

```sh
./dist/vector spec frozen --base HEAD
```

```text
spec frozen against HEAD: OK

  ✓ contract contracts/example-hex.json
  ✓ contract contracts/rfc5869-hkdf-sha256.json
  ✓ contract contracts/rfc8439-chacha20-poly1305.json
  ✓ contract contracts/vector-core-hex.json
  ✓ contract contracts/vector-lang-names.json
```

A change to a spec and to the code at once is refused:

<!-- exit 1 -->
```sh
echo 'More prose.' >> specs/rfc5869-hkdf-sha256.md
echo '// note' >> src/main.ts
./dist/vector spec frozen --base HEAD
```

```text
spec frozen against HEAD: FAILED

  ✓ contract contracts/example-hex.json
  ✓ contract contracts/rfc5869-hkdf-sha256.json
  ✓ contract contracts/rfc8439-chacha20-poly1305.json
  ✓ contract contracts/vector-core-hex.json
  ✓ contract contracts/vector-lang-names.json
  spec specs/rfc5869-hkdf-sha256.md
  implementation src/main.ts

problems:
  ✗ the change touches the spec side (specs/rfc5869-hkdf-sha256.md) and the implementation (src/main.ts): change them in separate PRs
```

So is a source that changed under the contract that pins it. The example-hex
contract's main source is its own spec, so editing the spec's XML breaks the
pin:

<!-- exit 1 -->
```sh
git checkout -q -- .
sed -i 's/38 test files/thirty-eight test files/' specs/example-hex.xml
./dist/vector spec frozen --base HEAD contracts/example-hex.json
```

```text
spec frozen against HEAD: FAILED

  ✗ contract contracts/example-hex.json
  spec specs/example-hex.xml

problems:
  ✗ contracts/example-hex.json: source example-hex (specs/example-hex.xml) has SHA-256 3385b75b2ef8d38bda5efa6382bdde95a5abaea0b06a4b78522269917e9eb826, but the contract pins 1c972eeca28874e9379542a3571f955dfb4f87262359484f86bbac1aede51c6b: the source changed
```

Re-extracting the contract fixes the pin, and belongs in a spec-side PR. A ref
git cannot resolve exits 2:

<!-- exit 2 -->
```sh
git checkout -q -- .
./dist/vector spec frozen --base nope
```

```text
vector: spec frozen: git merge-base --end-of-options nope HEAD failed (exit 128): fatal: Not a valid object name nope
```

## stale

`spec stale <test.ts> <contract.json>` compares the SHA-256 in the test's
`// vector-contract-sha256:` line with the contract's:

```sh
mkdir -p test/spec
./dist/vector spec emit contracts/rfc5869-hkdf-sha256.json -o test/spec/hkdf.ts
./dist/vector spec stale test/spec/hkdf.ts contracts/rfc5869-hkdf-sha256.json
```

```text
wrote test/spec/hkdf.ts
spec stale test/spec/hkdf.ts against contracts/rfc5869-hkdf-sha256.json: OK
```

Any change to the contract makes the test stale until it is emitted again:

<!-- exit 1 -->
```sh
sed -i 's/"title": "HMAC/"title": "The HMAC/' contracts/rfc5869-hkdf-sha256.json
./dist/vector spec stale test/spec/hkdf.ts contracts/rfc5869-hkdf-sha256.json
```

```text
spec stale test/spec/hkdf.ts against contracts/rfc5869-hkdf-sha256.json: FAILED

problems:
  ✗ test/spec/hkdf.ts: stale: emitted from a contract with sha256 fbe3c7c0bc77655517141ba694439510d12bb75f863e56e3197d86223e3786cf, but the contract's is 43660b624699accab2faadd14dcd466db9d1e8e2d119d9ee7e4aeb7f4530dcc7: regenerate it with vector spec emit
```

A repository that holds generated tests but not vector can run the same check
with `scripts/spec-stale.mjs`, which needs only Node:

```sh
git checkout -q -- .
node scripts/spec-stale.mjs test/spec/hkdf.ts contracts/rfc5869-hkdf-sha256.json
```

```text
test/spec/hkdf.ts: emitted from contracts/rfc5869-hkdf-sha256.json as it is now
```

`node scripts/spec-stale.mjs --self-test` checks the script itself against a
fresh, a stale, an unmarked and a doubly marked test.

## exports

`spec exports <contract.json> --nish-root <dir> --base <ref>` lists the
exports of the contract's module that the change adds or changes, and refuses
one the contract neither tests nor lists in its `outOfScope` with a reason.
`--nish-root` is required, and must be a git checkout of nish: the change is
read from its history. Make one from the pinned install, outside this
repository so `frozen` does not count it:

```sh
cp -rL .nish ../nish
cd ../nish && git init -q && git add -A && git commit -qm base
```

```sh
./dist/vector spec exports contracts/rfc5869-hkdf-sha256.json --nish-root ../nish --base HEAD
```

```text
spec exports of std/crypto/hkdf.ts against HEAD: OK
```

A new export the contract does not cover is refused:

<!-- exit 1 -->
```sh
printf '\n/**\n * Doubles `n`.\n *\n * @param n the number\n * @returns twice `n`\n */\nexport const hkdfTwice = (n: i32): i32 => n * 2\n' >> ../nish/std/crypto/hkdf.ts
./dist/vector spec exports contracts/rfc5869-hkdf-sha256.json --nish-root ../nish --base HEAD
```

```text
spec exports of std/crypto/hkdf.ts against HEAD: FAILED

  added hkdfTwice

problems:
  ✗ export hkdfTwice is added, but the contract neither tests it nor lists it in outOfScope with a reason
```

Test it in the spec, drop it, or declare it out of scope with a paragraph
`Out of scope: hkdfTwice, <the reason no clause tests it>` in the spec (see
[Writing a spec](writing-a-spec.md#the-whole-spec)). The contract extracted
from it lists the export in `outOfScope`, and the gate passes with a note:
`export hkdfTwice is added, out of scope: <the reason>`. A changed export
that a clause tests passes and is listed as `changed <name> (tested)`.
Without `--nish-root` it exits 2 (`VECTOR_NISH_ROOT` is not read here):

<!-- exit 2 -->
```sh
./dist/vector spec exports contracts/rfc5869-hkdf-sha256.json --base HEAD
```

```text
vector: spec exports: --nish-root <dir> is required: the nish checkout holding the module
```

## mutate

`spec mutate <contract.json> --nish-root <dir> --base <ref>` makes small
plausible bugs in the lines the change added to the contract's module, inside
the code the contract tests (a flipped comparison, an integer off by one,
`||` for `&&`, a deleted statement), builds the test against each mutant in a scratch slot (see
[The compiler](#the-compiler)), and runs it. A mutant the test fails on is **killed**; one it passes
on **survived**, and is behaviour no requirement pins down. Every survivor is
refused unless the contract allows it.

The code the contract tests is the module's top-level declarations its
`functions` reach: each function's own declaration, and every declaration a
reached one names (a call, a const, a class or a type), transitively, exported
or not and whatever `outOfScope` says. Top-level code runs at load, so it is
always reached. A changed line anywhere else, an import or an untested export,
gets no mutant, and one note names where they lie:

```text
notes:
  - 1 changed line outside the tested functions was not mutated: other
```

A module the scan cannot split into named declarations (an export has no name
it can read, or a contract function is not a top-level declaration there) is
mutated on every changed line, and a note says why (`every changed line was
mutated, not only the tested functions: …`). A function the contract cites
from another module (its `module` is set to a module other than the target)
is not looked for. A module that cannot be lexed is not mutated at all: the
command exits 2.

Start with a change: a redundant bound on line 186 of the module.

```sh
git -C ../nish checkout -q -- .
sed -i '186s/length < 0 ||/length < 0 || length > 9000 ||/' ../nish/std/crypto/hkdf.ts
```

### The compiler

Each mutant builds in a slot of its own. With no `--nish`, a slot is a
scratch install: the seed's files with the root's `std/` laid over them, so a
checkout's own tree is never copied. The seed is the root itself for an install
(it has `libexec/nish`, as `../nish` here does), or `build/seed` for a
checkout. A `git clone` of nish has neither, and mutate says so and stops:

<!-- illustrative -->
```sh
./dist/vector spec mutate contracts/rfc5869-hkdf-sha256.json --nish-root ../nish-clone --base HEAD
```

```text
vector: spec mutate: ../nish-clone has no seed to build mutants with: neither libexec/nish (an install) nor build/seed/libexec/nish (a checkout). Fetch one there with `bash scripts/fetch-seed.sh` (no build needed), or give --nish a compiler built in the checkout
```

Fetching the seed needs no build: `cd ../nish-clone && bash scripts/fetch-seed.sh`.

Before any mutant, mutate makes the module unparseable in a slot and builds
the test: if that still builds, the compiler is not reading the slot, and
every mutant would pass. A seed whose compiler ignores the `std/` beside it
fails this check, and so does a `--nish` that does not read the copy.

`--nish <file>` takes the other path: it copies the whole root into each slot
and builds with that compiler, relative to the root, such as a `build/nish`
built in the checkout. An installed `bin/nish` is a wrapper that execs
`libexec/nish` by its absolute path, so it fails the check:

<!-- exit 2 -->
```sh
./dist/vector spec mutate contracts/rfc5869-hkdf-sha256.json --nish-root ../nish --nish bin/nish --base HEAD
```

```text
vector: spec mutate: the compiler bin/nish builds the test even with std/crypto/hkdf.ts made unparseable in the copy, so it does not read the copy (an installed wrapper that execs another install by absolute path?): give a --nish that builds from the checkout it sits in
```

The compiler builds the test against each slot with its no-panic rule
relaxed, as `spec run` does, so a module that may panic still builds. A mutant
that reaches a panic stops the test with a nonzero exit, which kills it; a
panic in the unmutated module fails the baseline, so mutate refuses the change
(exit 1) and no mutant runs:

<!-- illustrative -->
```text
…
problems:
  ✗ the test fails on the unmutated module, so it proves nothing: …
```

Fix the panic site in the module. `npm run allow-panics` refuses the relax
flag everywhere in the repository but the emitted test's build, and CI's
`no-panic` job builds every emitted test with the latest nish and its rule
unrelaxed.

### Survivors

<!-- exit 1 -->
```sh
./dist/vector spec mutate contracts/rfc5869-hkdf-sha256.json --nish-root ../nish --base HEAD --jobs 4
```

```text
spec mutate std/crypto/hkdf.ts against HEAD: FAILED

  killed std/crypto/hkdf.ts:186:12 relational: length <= 0 || length > 9000 ||
  killed std/crypto/hkdf.ts:186:14 int: length < 1 || length > 9000 ||
  survived std/crypto/hkdf.ts:186:14 int: length < -1 || length > 9000 ||
  survived std/crypto/hkdf.ts:186:16 logical: length < 0 && length > 9000 ||
  survived std/crypto/hkdf.ts:186:26 relational: length < 0 || length >= 9000 ||
  survived std/crypto/hkdf.ts:186:28 int: length < 0 || length > 9001 ||
  survived std/crypto/hkdf.ts:186:28 int: length < 0 || length > 8999 ||
  survived std/crypto/hkdf.ts:186:5 delete-statement:

problems:
  ✗ survivor std/crypto/hkdf.ts:186 (186:14:int:-1): `length < -1 || length > 9000 ||` passes the test: behaviour no requirement pins down
  ✗ survivor std/crypto/hkdf.ts:186 (186:16:logical): `length < 0 && length > 9000 ||` passes the test: behaviour no requirement pins down
  ✗ survivor std/crypto/hkdf.ts:186 (186:26:relational): `length < 0 || length >= 9000 ||` passes the test: behaviour no requirement pins down
  ✗ survivor std/crypto/hkdf.ts:186 (186:28:int:+1): `length < 0 || length > 9001 ||` passes the test: behaviour no requirement pins down
  ✗ survivor std/crypto/hkdf.ts:186 (186:28:int:-1): `length < 0 || length > 8999 ||` passes the test: behaviour no requirement pins down
  ✗ survivor std/crypto/hkdf.ts:186 (186:5:delete-statement): `` passes the test: behaviour no requirement pins down
```

The survivors are right: the next line already refuses any length above 8160,
so nothing can tell the new bound apart from its mutants. A survivor is fixed
one of three ways: a requirement, vector or property that kills it (a
spec-side PR); dropping the code it lives in; or an `allowSurvivors` entry
with a reason, in `contracts/<name>.survivors.json`, which extract merges into
the contract:

```sh
cat > contracts/rfc5869-hkdf-sha256.survivors.json <<'EOF'
{
  "allowSurvivors": [
    { "file": "std/crypto/hkdf.ts", "line": 186, "reason": "A redundant bound: the next line already refuses any length above 8160." }
  ]
}
EOF
./dist/vector spec extract specs/rfc5869-hkdf-sha256.xml -o contracts/rfc5869-hkdf-sha256.json
./dist/vector spec mutate contracts/rfc5869-hkdf-sha256.json --nish-root ../nish --base HEAD --jobs 4
```

```text
spec mutate std/crypto/hkdf.ts against HEAD: OK

  killed std/crypto/hkdf.ts:186:12 relational: length <= 0 || length > 9000 ||
  killed std/crypto/hkdf.ts:186:14 int: length < 1 || length > 9000 ||
  survived std/crypto/hkdf.ts:186:14 int: length < -1 || length > 9000 ||
  survived std/crypto/hkdf.ts:186:16 logical: length < 0 && length > 9000 ||
  survived std/crypto/hkdf.ts:186:26 relational: length < 0 || length >= 9000 ||
  survived std/crypto/hkdf.ts:186:28 int: length < 0 || length > 9001 ||
  survived std/crypto/hkdf.ts:186:28 int: length < 0 || length > 8999 ||
  survived std/crypto/hkdf.ts:186:5 delete-statement:

notes:
  - survivor std/crypto/hkdf.ts:186 (186:14:int:-1) is allowed: A redundant bound: the next line already refuses any length above 8160.
…
```

The sidecar and the re-extracted contract are spec-side changes, so they land
in a spec-side PR before the implementation.

### Flags

- `--max <n>` runs at most `n` mutants, spread over the changed lines, and
  notes how many it dropped (`6 of 8 mutants were not run: --max kept 2`).
- `--jobs <n>` runs that many mutants at once (default 1), at most one per
  CPU: a larger `n` is cut to the CPU count.
- `--test <file>` runs that test program against each mutant. Without it,
  mutate emits the contract's test as `spec emit` does, checking the contract
  with the current directory as the repository's top, so run it from there,
  as CI does. That test skips a slow vector, as `spec emit` does without
  `--slow`, and mutate notes each one it skipped
  (`slow vector CHAIN-100000 was not run against the mutants: …`): no mutant
  meets it, so a bug only it would catch survives.

### When it refuses, and when it exits 2

Besides survivors, mutate refuses (exit 1):

- a change that adds no line of the module that can be mutated (`no mutants`),
  none in the code the contract's functions reach (`no mutants: no line the
  change adds to <file> lies in code the contract's functions reach`), or none
  there that can be mutated (`no mutants: no line the change adds to <file> in
  code the contract's functions reach can be mutated`);
- a test that fails on the unmutated module, since it proves nothing;
- `every mutant is stillborn or its build ran past its time: none built, so the test met none of them`;
- `every mutant that built ran its test past its time`: run with fewer
  `--jobs`;
- more than 10% of the mutants' builds, or of their tests, running past their
  time, since a survivor may hide among them;
- a stale `allowSurvivors` entry: one whose line had mutants this run and the
  test killed them all. Remove it, or move it to the line it means. An entry
  whose line had no mutant run is only a note (`STALE?`).

A build or a test may take three times as long as the unmutated module's
build and test together, and at least 10 seconds. Mutate exits 2 for bad usage (`--nish-root` is required,
and `VECTOR_NISH_ROOT` is not read), a contract, module or test that cannot be
read, a git failure, a compiler that fails for a reason the mutant did not
cause (the check above included), and a z3 failure while it emits the test.
With `--nish`, it also exits 2 when a directory on the module's path in the
checkout is a symlink (`the copy of <root>: std is a symlink, which the module
<file> would write through`), since every mutant would be written through it
into the checkout. A module that is itself a link is replaced in the copy by a
file of its own, and what it points at is left alone.
