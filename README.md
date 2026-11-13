# vector

vector is a deterministic judge for code a model writes. It proves small
numeric functions correct with the Z3 solver, and it holds implementations to
contracts extracted from specs and RFCs. It never calls a model itself:
Claude Code, through the bundled skills, does the writing, and vector checks
it.

vector is being rewritten in [Nish](https://github.com/amritk/nish). This
branch holds the skeleton: the toolchain, the shared core and the command
line. Every command is declared and answers `--help`, but exits 2 with "not
implemented yet" until its handler lands.

## Build

You need Node 22, Python 3 with pip (for z3), and clang with lld (LLVM 15 or
newer).

```sh
bash scripts/fetch-nish.sh   # the pinned nish compiler, into .nish/
bash scripts/fetch-z3.sh     # the pinned z3, into .z3/
npm ci
npm run build                # dist/vector
./dist/vector --help
```

## Commands

```
vector verify <spec.json> <program.json>   prove a program meets its spec plan
vector diff <old.json> <new.json>          prove two programs equivalent
vector spec extract|check|emit|run         spec => contract => Nish test
vector spec frozen|stale|exports|mutate    gate a change on its contract
```

## Develop

`npm test` runs every test, `npm run lint` lints, and `npm run
tested-exports` checks every exported function is called in a test. The
rules for working in this repository are in [CLAUDE.md](CLAUDE.md).

## License

MIT. Third-party notices are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
