# Installation

vector is written in [Nish](https://github.com/amritk/nish), a static subset of TypeScript compiled ahead of time to a native binary, and it runs a pinned z3. Install a release, which carries both, or build it from source.

## Install a release

Every release publishes a prebuilt `vector` for Linux and macOS on x86_64 and ARM64, with z3 4.16.0 bundled. From npm:

<!-- illustrative -->
```sh
npm install -g @amritk/vector
vector --version
```

npm installs the package holding the binary for your machine, `@amritk/vector-<platform>`, as an optional dependency, so an install with `--omit=optional` has no binary and `vector` says so.

Or download `vector-<version>-<platform>.tar.gz` from the [GitHub releases](https://github.com/amritk/vector/releases), where `<platform>` is `x86_64-linux`, `aarch64-linux`, `x86_64-darwin` or `aarch64-darwin`. `SHA256SUMS` beside it lists every file's digest, and `gh attestation verify <file> --repo amritk/vector` checks the file was built by the release workflow. Unpack it anywhere and run `bin/vector` inside it: z3 sits at `.z3/z3` in the same directory, where vector looks for it. On macOS vector finds that z3 only when it is run by its path; run as a bare `vector` from your `PATH`, it uses the `z3` on `PATH` instead, so set `VECTOR_Z3` to the bundled one (`export VECTOR_Z3=<unpacked>/.z3/z3`). An npm install has no such gap.

The rest of this page builds vector from source.

## What you need

- Node 22, for the build and test scripts.
- Python 3 with pip, which installs z3 from its wheel on PyPI.
- clang and lld from LLVM 18 (Xcode's command-line tools on macOS), which Nish compiles and links with.

## Install LLVM

Nish runs `clang` from your `PATH`, or the compiler `CC` names when it is set. On Ubuntu or Debian:

<!-- illustrative -->
```sh
sudo apt-get install -y clang-18 lld-18 llvm-18
export CC=clang-18           # add this line to your shell profile
```

These packages install only versioned commands (`clang-18`, `ld.lld-18`), not a plain `clang`, which is why `CC` names the versioned one. On macOS, `xcode-select --install`: Xcode's command-line tools are enough.

## Install the toolchain

From a clone of [amritk/vector](https://github.com/amritk/vector):

<!-- illustrative -->
```sh
bash scripts/fetch-nish.sh   # nish 0.39.0, into .nish/
bash scripts/fetch-z3.sh     # z3 4.16.0, into .z3/
npm ci
```

Both scripts are pinned and idempotent: run again, they report the version already installed and exit. The compiler's pin is `.nish-version`; `NISH_VERSION` overrides it, to try another release.

vector runs the z3 that `VECTOR_Z3` names, if set; otherwise `.z3/z3` in the checkout it was built from, and failing that `z3` on your `PATH`. It never runs a z3 from the directory you run it in.

## Build

<!-- illustrative -->
```sh
npm run build                # compiles src/main.ts to dist/vector
```

Then check the binary. `--version` prints its version:

```sh
./dist/vector --version
```

```text
vector 0.1.0
```

and `--help` lists the commands:

```sh
./dist/vector --help
```

```text
vector 0.1.0  Prove small programs correct, and hold implementations to their specs

usage: vector <command> [flags]

Commands
  verify         Prove a program meets its spec plan
  diff           Prove two programs equivalent, or show where they differ
  spec           Turn a spec into a contract and a test, and gate changes on it

Flags
  -h, --help     show help
  -v, --version  show the version
```

`--help` after any command shows that command's flags and arguments; the [command-line reference](../../reference/command-line.md) lists them all.

## Use vector from a Nish program

vector is also a Nish package, `@amritk/vector`, whose entry is `src/index.ts`. A Nish package is its source, so a git dependency is all it takes; `npm install` puts it in `node_modules`, where a Nish import finds it:

<!-- illustrative -->
```sh
npm install github:amritk/vector
```

The package reads files, runs z3, writes files and reaches the network (`vector spec mutate` opens pull requests), so the program importing it must grant those in its own `package.json`, or the compiler refuses the import:

```json
{
  "nish": {
    "capabilities": {
      "dependencies": {
        "@amritk/vector": ["fs.read", "fs.write", "process.spawn", "net", "unsafe"]
      }
    }
  }
}
```

It exports the command line, `vectorRun(args)`, which runs `vector <args>` and returns its exit code, and the two proofs as functions of JSON text, `vectorVerifyJson(specText, programText)` and `vectorDiffJson(oldText, newText)`. Each returns the JSON `--json` prints, or an `Err` when a text is not JSON:

<!-- illustrative -->
```ts
import { vectorVerifyJson } from "@amritk/vector"

export const main = (): i32 => {
  const spec = readFileSyncOrNull("currency-spec.json") ?? ""
  const program = readFileSyncOrNull("currency.json") ?? ""
  const outcome = vectorVerifyJson(spec, program)
  console.log(outcome.isOk() ? outcome.value : outcome.error)
  return 0
}
```

Proofs run z3 as the binary does: the one `VECTOR_Z3` names, or else `z3` on your `PATH`. The [module reference](../../reference/modules/index.md) documents each export.

## Next

[Your first proof](first-proof.md) runs `vector verify` on a program.
