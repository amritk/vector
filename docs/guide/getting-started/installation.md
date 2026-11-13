# Installation

vector is written in [Nish](https://github.com/amritk/nish), a static subset of TypeScript compiled ahead of time to a native binary. You build it from source with a pinned compiler, and it runs a pinned z3.

## What you need

- Node 22, for the build and test scripts.
- Python 3 with pip, which installs z3 from its wheel on PyPI.
- clang with lld, LLVM 15 or newer, which Nish links with.

## Install the toolchain

From a clone of [amritk/vector](https://github.com/amritk/vector):

```sh
bash scripts/fetch-nish.sh   # nish 0.39.0, into .nish/
bash scripts/fetch-z3.sh     # z3 4.16.0, into .z3/
npm ci
```

Both scripts are pinned and idempotent: run again, they report the version already installed and exit. `NISH_VERSION` overrides the compiler's pin, to try another release.

vector runs `.z3/z3` unless `VECTOR_Z3` names another z3.

## Build

```sh
npm run build                # compiles src/main.ts to dist/vector
./dist/vector --version
./dist/vector --help
```

`--help` after any command shows that command's flags and arguments; the [command-line reference](../../reference/command-line.md) lists them all.

## Next

[Your first proof](first-proof.md) runs `vector verify` on a program.
