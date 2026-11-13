# Installation

vector is written in [Nish](https://github.com/amritk/nish), a static subset of TypeScript compiled ahead of time to a native binary. You build it from source with a pinned compiler, and it runs a pinned z3.

## What you need

- Node 22, for the build and test scripts.
- Python 3 with pip, which installs z3 from its wheel on PyPI.
- clang and lld from LLVM 18 (Xcode's command-line tools on macOS), which Nish compiles and links with.

## Install LLVM

Nish runs `clang` from your `PATH`, or the compiler `CC` names when it is set. On Ubuntu or Debian:

```sh
sudo apt-get install -y clang-18 lld-18 llvm-18
export CC=clang-18           # add this line to your shell profile
```

These packages install only versioned commands (`clang-18`, `ld.lld-18`), not a plain `clang`, which is why `CC` names the versioned one. On macOS, `xcode-select --install`: Xcode's command-line tools are enough.

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
