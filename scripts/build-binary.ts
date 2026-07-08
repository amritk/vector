// Builds the compiled single-file `vector` binary.
//
// The wrinkle: the Z3 solver must run under Node (its pthread wasm build aborts
// under Bun), so a Bun-compiled binary can't run the solver in-process. We
// therefore ship the Node solver runtime *inside* the binary as a tarball:
//
//   1. Bundle the solver worker for Node, keeping z3-solver external so its
//      Emscripten glue keeps resolving its wasm via a natural __dirname.
//   2. Copy z3-solver and its dependency closure (async-mutex, tslib) next to
//      the worker, so the external import resolves wherever the tree lands.
//   3. Tar that runtime tree.
//   4. `bun build --compile src/bin.ts`, which embeds the tarball.
//
// At runtime the binary extracts the tarball to a temp cache once and spawns
// Node on the worker (see src/solve/runner.ts). Node must be on PATH — the same
// requirement the from-source path already has.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..");
const dist = join(repoRoot, "dist");
const runtime = join(dist, "runtime");
const runtimeNodeModules = join(runtime, "node_modules");
const tarPath = join(dist, "vector-runtime.tar");
const binPath = join(dist, "vector");

// z3-solver → async-mutex → tslib. If z3-solver's deps ever change, update this.
const RUNTIME_PACKAGES = ["z3-solver", "async-mutex", "tslib"];

function run(cmd: string, args: string[], cwd = repoRoot): void {
  const label = `${cmd} ${args.join(" ")}`;
  const res = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (res.status !== 0) {
    throw new Error(`step failed (exit ${res.status}): ${label}`);
  }
}

console.log("• cleaning dist/");
rmSync(dist, { recursive: true, force: true });
mkdirSync(runtimeNodeModules, { recursive: true });

console.log("• bundling solver worker for Node (z3-solver external)");
run("bun", [
  "build",
  "src/solve/node-worker.ts",
  "--target=node",
  "--external",
  "z3-solver",
  "--outfile",
  join(runtime, "worker.mjs"),
]);

console.log("• assembling solver runtime node_modules");
for (const pkg of RUNTIME_PACKAGES) {
  const src = join(repoRoot, "node_modules", pkg);
  if (!existsSync(src)) {
    throw new Error(
      `missing dependency "${pkg}" in node_modules — run "bun install" first`,
    );
  }
  run("cp", ["-R", src, join(runtimeNodeModules, pkg)]);
}

console.log("• packing runtime tarball");
run("tar", ["-cf", tarPath, "-C", runtime, "."]);

console.log("• compiling binary → dist/vector");
run("bun", ["build", "--compile", "src/bin.ts", "--outfile", binPath]);

// The tarball is now embedded in the binary; the loose runtime tree is only a
// build intermediate. Keep the binary alone in dist/.
console.log("• cleaning build intermediates");
rmSync(runtime, { recursive: true, force: true });
rmSync(tarPath, { force: true });

console.log(`\n✓ built ${binPath}`);
console.log("  Requires `node` on PATH at runtime (for the Z3 solver).");
