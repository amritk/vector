// Populates a repo-local .z3/ with the native `z3` executable + its shared
// library, which the source/dev path and the binary build both consume.
//
// It sources z3 via pip (`z3-solver`, the same version the project pins), which
// ships a prebuilt `z3` binary and libz3 for the host platform and is available
// everywhere Python is. Alternatively, drop a `z3` + `libz3.*` into .z3/ by hand
// from a GitHub release (https://github.com/Z3Prover/z3/releases) and skip this.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";

const Z3_VERSION = "4.16.0";
const repoRoot = join(import.meta.dir, "..");
const dotZ3 = join(repoRoot, ".z3");

function run(cmd: string, args: string[]): void {
  const res = spawnSync(cmd, args, { stdio: "inherit" });
  if (res.status !== 0) {
    throw new Error(
      `step failed (exit ${res.status}): ${cmd} ${args.join(" ")}`,
    );
  }
}

// Recursively find files whose basename matches, without pulling in a glob dep.
function findFiles(dir: string, match: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findFiles(full, match));
    else if (match(entry.name)) out.push(full);
  }
  return out;
}

const staging = join(dotZ3, ".pip-tmp");
console.log(`• installing z3-solver==${Z3_VERSION} via pip`);
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
// pip flakes on fresh containers / cold proxies; retry with a short backoff
// before giving up — this is the first command every new checkout runs.
const PIP_ATTEMPTS = 3;
for (let attempt = 1; ; attempt++) {
  try {
    run("pip3", [
      "install",
      "--quiet",
      "--target",
      staging,
      `z3-solver==${Z3_VERSION}`,
    ]);
    break;
  } catch (err) {
    if (attempt >= PIP_ATTEMPTS) throw err;
    const delayMs = 2000 * attempt;
    console.log(
      `  pip attempt ${attempt}/${PIP_ATTEMPTS} failed — retrying in ${delayMs / 1000}s`,
    );
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

const [bin] = findFiles(staging, (n) => n === "z3");
const libs = findFiles(
  staging,
  (n) => n === "libz3.so" || n.startsWith("libz3.so."),
);
if (!bin || libs.length === 0) {
  throw new Error(
    "could not locate a z3 binary + libz3 in the pip package; install z3 into .z3/ manually",
  );
}

console.log("• copying z3 + libz3 into .z3/");
copyFileSync(bin, join(dotZ3, "z3"));
run("chmod", ["+x", join(dotZ3, "z3")]);
for (const lib of libs) copyFileSync(lib, join(dotZ3, basename(lib)));
rmSync(staging, { recursive: true, force: true });

console.log(`\n✓ z3 ${Z3_VERSION} ready in .z3/`);
