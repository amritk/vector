# Exit codes and tool failures

Every vector command exits with one of three codes, so a script or a CI step
can act on the status alone:

| Code | Means |
| --- | --- |
| 0 | the check ran and passed |
| 1 | the check ran and refused the input |
| 2 | the command could not run: bad usage, a file that cannot be read or written, or a tool (z3, git, nish) that failed; or `MISMATCH`, a counterexample or witness that does not replay: a bug in vector to report |

The [command-line reference](../../reference/command-line.md#exit-codes) is
the normative list. Read a check by its status, never by the tail of its
output: `vector spec check … | tail` exits with `tail`'s status, 0.

## By command

| Command | 0 | 1 | 2 |
| --- | --- | --- | --- |
| `verify` | `PROVEN` | `REFUTED`, `UNKNOWN`, `INVALID`, `ERROR` (z3 failed) | bad usage, an unreadable file, an `--emit` file that cannot be written, `MISMATCH` (a counterexample that does not replay: a bug in vector) |
| `diff` | `EQUIVALENT` | `DIFFERENT`, `UNDECIDED` | bad usage, an unreadable file, `INVALID`, `ERROR` (z3 failed), `MISMATCH` (a witness that does not replay: a bug in vector) |
| `spec extract` | written, or up to date with `--check` | refusals, or a difference with `--check` | bad usage, an unreadable file, a missing RFC, a z3 failure |
| `spec check` | `CONTRACT_VALID` | `INVALID` | bad usage, an unreadable file, a missing RFC, a z3 failure |
| `spec emit` | written | the contract does not check | bad usage, an unwritable `-o`, a z3 failure |
| `spec run` | `SATISFIED` | `VIOLATED`, `ERROR`, or the contract does not check | bad usage, no nish for a Nish test, a z3 failure |
| `spec frozen` | OK | both sides touched, or a source changed | bad usage, a git failure |
| `spec stale` | OK | stale, or no marker line | bad usage, an unreadable file |
| `spec exports` | OK | an export the contract does not cover | bad usage (`--nish-root` is required), a git failure |
| `spec mutate` | OK | a survivor, no mutants (none in the tested code), none built, too many timeouts | bad usage, a git failure, a compiler failure the mutant did not cause, a z3 failure |

[Proving a function](proving.md), [From a spec to a
contract](spec-to-contract.md), [Testing an implementation](testing.md) and
[Gating a spec-first PR](pr-gates.md) show each of these with its output.

## Finding z3

vector runs z3 for every proof and for every contract it checks. It looks in
this order:

1. `$VECTOR_Z3`, which must name a file (set but empty, it is skipped);
2. `.z3/z3` beside the repository the binary was built in (`dist/../.z3/z3`),
   where `scripts/fetch-z3.sh` puts the pinned z3;
3. `z3` on `PATH`.

The current directory is never searched, so a `z3` in a directory you run
vector from is never run. A `VECTOR_Z3` that names no file is a usage error:

<!-- exit 2 -->
```sh
VECTOR_Z3=/nonexistent ./dist/vector spec check contracts/example-hex.json
```

```text
vector: spec check: VECTOR_Z3 is /nonexistent, which is not a file
```

## When z3 fails

A z3 that exits early, crashes or answers what vector cannot read decided
nothing. `spec check`, `spec extract`, `spec emit`, `spec run` and
`spec mutate` exit 2 on it, and write nothing:

<!-- exit 2 -->
```sh
VECTOR_Z3=/bin/false ./dist/vector spec check contracts/example-hex.json
```

```text
vector: spec check: z3 (/bin/false) exited 1 before query 4
```

<!-- exit 2 -->
```sh
VECTOR_Z3=/bin/false ./dist/vector spec emit contracts/rfc5869-hkdf-sha256.json -o hkdf.ts
```

```text
vector: contracts/rfc5869-hkdf-sha256.json: cannot be checked: z3 (/bin/false) exited 1 before query 8
```

`diff` exits 2 too (`Solver error: …`). `verify` reports it as the `ERROR` verdict, which exits 1
like every verdict but `PROVEN`:

<!-- exit 1 -->
```sh
VECTOR_Z3=/bin/false ./dist/vector verify tests/fixtures/currency-spec.json tests/fixtures/currency.json
```

```text
Solver error: z3 (/bin/false) exited 1 before query 8
```

## Other tools

- **git**: `frozen`, `exports` and `mutate` read the change from git. A ref
  it cannot resolve, or a directory that is not a repository, exits 2 with
  git's own message.
- **nish**: `run` and `mutate` build the generated test with nish. No nish to
  build with exits 2; a test that does not build is the `ERROR` verdict
  (exit 1) for `run`. `mutate` refuses an unmutated module that does not
  build because of an error in the module (exit 1), and exits 2 when the
  build fails for any other reason.
- **Source commands**: `spec check --run-sources` runs the shell commands a
  contract's vectors cite. One that fails, times out or prints the wrong value
  fails the provenance gate (exit 1); see [Running the source
  commands](spec-to-contract.md#running-the-source-commands).
