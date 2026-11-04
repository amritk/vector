// A scratch nish install: a copy of a checkout's release seed whose std/ is the
// checkout's working-tree std plus overrides. `nish run` resolves `nish/…` to
// the std/ beside its binary, so a test run with `<dir>/libexec/nish` sees the
// overridden library and nothing else does.

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize, resolve, sep } from "node:path";

export interface Scratch {
  /** The install's root: bin/, libexec/, runtime/, std/. */
  dir: string;
  /** The compiler to run: `<dir>/libexec/nish`, never the seed's wrapper. */
  nish: string;
  dispose(): void;
}

export interface ScratchOptions {
  /** A nish checkout with build/seed (its last release) and std/. */
  nishRoot: string;
  /** Path relative to nishRoot (under std/) → the contents to write there. */
  overrides?: Record<string, string>;
}

/** `std/crypto/hkdf.ts` → itself, or an error for a path outside std/. */
function stdPath(rel: string): string {
  const n = normalize(rel).split(sep).join("/");
  if (!n.startsWith("std/") || n.split("/").includes("..")) {
    throw new Error(`scratch: override ${rel} is not a path under std/`);
  }
  return n;
}

export function makeScratch(opts: ScratchOptions): Scratch {
  const seed = resolve(opts.nishRoot, "build/seed");
  const std = resolve(opts.nishRoot, "std");
  for (const p of [join(seed, "libexec/nish"), std]) {
    if (!existsSync(p)) throw new Error(`scratch: ${p} does not exist`);
  }
  const overrides = Object.entries(opts.overrides ?? {}).map(
    ([rel, contents]) => [stdPath(rel), contents] as const,
  );
  const dir = mkdtempSync(join(tmpdir(), "vector-scratch-"));
  const dispose = () => rmSync(dir, { recursive: true, force: true });
  try {
    const seedStd = join(seed, "std");
    cpSync(seed, dir, {
      recursive: true,
      filter: (src) => src !== seedStd && !src.startsWith(seedStd + sep),
    });
    cpSync(std, join(dir, "std"), { recursive: true });
    for (const [rel, contents] of overrides) {
      const target = join(dir, rel);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, contents);
    }
  } catch (err) {
    dispose();
    throw err;
  }
  return { dir, nish: join(dir, "libexec/nish"), dispose };
}
