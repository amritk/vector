// Builds the compiled single-file `vector` binary.
//
// The solver is the native `z3` CLI. Since `bun build --compile` already emits a
// platform-specific executable, we embed a matching native z3 (the `z3` binary
// plus its shared library) straight into it as a tarball:
//
//   1. Take z3 + libz3 from the repo-local .z3/ (populated by `bun run fetch-z3`).
//   2. Tar them flat.
//   3. `bun build --compile src/bin.ts`, which embeds the tarball.
//
// At runtime the binary extracts the tarball to a temp cache once and runs z3
// from there (see src/solve/runner.ts). The result needs nothing on PATH — no
// node, no separate z3 install.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..");
const dotZ3 = join(repoRoot, ".z3");
const dist = join(repoRoot, "dist");
const stage = join(dist, "z3");
const tarPath = join(dist, "vector-z3.tar");
const binPath = join(dist, "vector");

function run(cmd: string, args: string[], cwd = repoRoot): void {
  const res = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (res.status !== 0) {
    throw new Error(
      `step failed (exit ${res.status}): ${cmd} ${args.join(" ")}`,
    );
  }
}

const z3Bin = join(dotZ3, "z3");
if (!existsSync(z3Bin)) {
  throw new Error("missing .z3/z3 — run `bun run fetch-z3` first");
}
// z3's SONAME is the versioned name (libz3.so.4.16); ship exactly that one file
// (the loader resolves by SONAME) rather than the identical unversioned copy.
const allLibs = readdirSync(dotZ3).filter(
  (n) => n === "libz3.so" || n.startsWith("libz3.so."),
);
const versioned = allLibs.filter((n) => n !== "libz3.so");
const libs = versioned.length > 0 ? [versioned[0]] : allLibs;
if (libs.length === 0) {
  throw new Error("missing libz3 in .z3/ — run `bun run fetch-z3` first");
}

console.log("• cleaning dist/");
rmSync(dist, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

console.log("• staging native z3 runtime");
run("cp", [z3Bin, join(stage, "z3")]);
for (const lib of libs) run("cp", [join(dotZ3, lib), join(stage, lib)]);

console.log("• packing z3 tarball");
run("tar", ["-cf", tarPath, "-C", stage, "."]);

console.log("• compiling binary → dist/vector");
run("bun", ["build", "--compile", "src/bin.ts", "--outfile", binPath]);

// The tarball is now embedded; the loose stage + tar are build intermediates.
console.log("• cleaning build intermediates");
rmSync(stage, { recursive: true, force: true });
rmSync(tarPath, { force: true });

console.log(`\n✓ built ${binPath}`);
console.log(
  "  Self-contained: bundles the native z3 solver, needs nothing on PATH.",
);
