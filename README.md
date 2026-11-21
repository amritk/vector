# vector

vector is a deterministic judge for code a model writes. It proves small
numeric functions correct with the Z3 solver, and it holds implementations to
contracts extracted from specs and RFCs. It never calls a model itself:
Claude Code, through the bundled skills, does the writing, and vector checks
it.

vector is written in [Nish](https://github.com/amritk/nish), a static subset
of TypeScript compiled ahead of time to a native binary, `dist/vector`. There
is no Bun or Node runtime to install for it: Node runs only the build, test
and documentation scripts.

## Documentation

The [user guide](docs/guide/index.md) and the generated
[reference](docs/reference/command-line.md) are published as a
[Scalar Docs](https://scalar.com/products/docs) site from
[`scalar.config.json`](scalar.config.json); the Markdown reads the same on
GitHub. Start with [Installation](docs/guide/getting-started/installation.md)
and [Your first proof](docs/guide/getting-started/first-proof.md).

## Install

You need Node 22, Python 3 with pip (for z3), and clang with lld from LLVM 18
(what CI installs). The two fetch scripts install the pinned compiler into
`.nish/` and the pinned z3 into `.z3/`; the build compiles `src/main.ts`:

<!-- illustrative -->
```sh
bash scripts/fetch-nish.sh
bash scripts/fetch-z3.sh
npm ci
npm run build
```

vector finds the z3 beside the repository it was built in, so `dist/vector`
runs from any directory. [Installation](docs/guide/getting-started/installation.md)
covers each step and what to do when one fails.

## Usage

```sh
./dist/vector --help
```

<!-- x-release-please-start-version -->
```text
vector 0.6.0  Prove small programs correct, and hold implementations to their specs

usage: vector <command> [flags]

Commands
  verify         Prove a program meets its spec plan
  diff           Prove two programs equivalent, or show where they differ
  spec           Turn a spec into a contract and a test, and gate changes on it

Flags
  -h, --help     show help
  -v, --version  show the version

Agents
  before using vector, read its rules, traps first:
  /path/to/vector/docs/AI.md
```
<!-- x-release-please-end -->

Prove a function meets its spec plan:

```sh
./dist/vector verify tests/fixtures/currency-spec.json tests/fixtures/currency.json
```

```text
╔════════════════════════════════════════════════════════════════════╗
║                        VECTOR — PROOF REPORT                       ║
╠════════════════════════════════════════════════════════════════════╣
║ Prompt:  "verify: tests/fixtures/currency.json"                    ║
║ Attempt: 1/1      Solver: Z3 4.16.0 (native)      Status: PROVEN   ║
…
```

Check a contract against the RFC it quotes:

```sh
./dist/vector spec check contracts/rfc5869-hkdf-sha256.json
```

```text
── VECTOR RFC CONTRACT ─────────────────────────────────────────
 rfc5869-hkdf-sha256 · RFC 5869 (HMAC-based Extract-and-Expand Key Derivation Function (HKDF)) · nish/crypto/hkdf
 Status: CONTRACT_VALID
…
```

A check exits 0 when it passed, 1 when vector refused the input, and 2 for bad
usage, a tool failure, or a `MISMATCH` (a bug in vector); [Exit codes and tool
failures](docs/guide/guides/exit-codes.md) lists them by command. The guides
cover [proving](docs/guide/guides/proving.md), [specs and
contracts](docs/guide/guides/spec-to-contract.md),
[testing](docs/guide/guides/testing.md) and [gating a
PR](docs/guide/guides/pr-gates.md).

## Develop

`npm test` runs every test, `npm run lint` lints, and `npm run
tested-exports` checks every exported function is called in a test. The
rules for working in this repository are in [CLAUDE.md](CLAUDE.md).

## License

MIT. Third-party notices are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
