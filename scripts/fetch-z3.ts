// Populates a repo-local .z3/ with the native `z3` executable + its shared
// library, which the source/dev path and the binary build both consume.
//
// Two sources, tried in order:
//   1. GitHub releases (Z3Prover/z3) — no Python needed; the platform-matched
//      zip is picked via the release API and unpacked with the built-in zip
//      reader in fetch-z3-lib.ts.
//   2. pip (`z3-solver`, same pinned version) — fallback for networks where
//      github.com is unreachable; the wheel ships the same prebuilt binaries.
// Force one with VECTOR_Z3_SOURCE=github or VECTOR_Z3_SOURCE=pip.
// Or skip both: drop a `z3` + `libz3.*` into .z3/ by hand.
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import {
  type ReleaseAsset,
  extractZipEntries,
  isWantedZ3File,
  pickZ3Asset,
} from "./fetch-z3-lib.ts";

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

async function fetchViaGithub(): Promise<void> {
  const tagUrl = `https://api.github.com/repos/Z3Prover/z3/releases/tags/z3-${Z3_VERSION}`;
  console.log(`• resolving z3 ${Z3_VERSION} release assets from GitHub`);
  const res = await fetch(tagUrl, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`release lookup failed: HTTP ${res.status}`);
  const release = (await res.json()) as { assets?: ReleaseAsset[] };
  const asset = pickZ3Asset(release.assets ?? []);
  if (!asset) {
    throw new Error(
      `no release asset matches ${process.arch}/${process.platform}`,
    );
  }

  console.log(`• downloading ${asset.name}`);
  const zipRes = await fetch(asset.browser_download_url);
  if (!zipRes.ok) throw new Error(`download failed: HTTP ${zipRes.status}`);
  const zip = new Uint8Array(await zipRes.arrayBuffer());

  const files = extractZipEntries(zip, isWantedZ3File);
  const bin = files.get("z3") ?? files.get("z3.exe");
  if (!bin) throw new Error(`${asset.name} contains no z3 executable`);

  console.log("• copying z3 + libz3 into .z3/");
  mkdirSync(dotZ3, { recursive: true });
  for (const [name, data] of files) writeFileSync(join(dotZ3, name), data);
  chmodSync(join(dotZ3, files.has("z3") ? "z3" : "z3.exe"), 0o755);
}

function fetchViaPip(): void {
  const staging = join(dotZ3, ".pip-tmp");
  console.log(`• installing z3-solver==${Z3_VERSION} via pip`);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  run("pip3", [
    "install",
    "--quiet",
    "--target",
    staging,
    `z3-solver==${Z3_VERSION}`,
  ]);

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
}

const source = process.env.VECTOR_Z3_SOURCE;
if (source && source !== "github" && source !== "pip") {
  throw new Error(
    `VECTOR_Z3_SOURCE must be "github" or "pip", got "${source}"`,
  );
}

if (source === "pip") {
  fetchViaPip();
} else {
  try {
    await fetchViaGithub();
  } catch (err) {
    if (source === "github") throw err;
    console.warn(
      `• GitHub source failed (${err instanceof Error ? err.message : err}) — falling back to pip`,
    );
    fetchViaPip();
  }
}

console.log(`\n✓ z3 ${Z3_VERSION} ready in .z3/`);
