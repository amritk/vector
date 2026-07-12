// Entry point for the compiled single-file binary (`bun run build`).
//
// `bun build --compile` embeds the z3 tarball — the native `z3` executable plus
// its shared library, assembled by scripts/build-binary.ts into
// dist/vector-z3.tar — directly into the executable. Importing it with the
// `file` loader yields its in-binary path, which we stash on a global for the
// solver runner to extract on first use. Everything else is the ordinary CLI.
// This module is compile-only: it is never loaded from source (cli.ts is the
// source/npm entry) and is excluded from typecheck, since the .tar module only
// exists after a build.
import z3TarPath from "../dist/vector-z3.tar" with { type: "file" };

(globalThis as Record<string, unknown>).__VECTOR_Z3_TAR__ = z3TarPath;

await import("./cli.ts");
