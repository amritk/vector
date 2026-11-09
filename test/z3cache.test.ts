import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  chownSync,
  lchownSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractZ3Tar,
  privateDir,
  readTar,
  z3CacheRoot,
} from "../src/solve/z3cache.ts";

// The compiled binary's z3 is unpacked into a directory only this user can
// write, and checked against the embedded tarball before it is run (#20).

const dirs: string[] = [];
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), "z3cache-test-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A tarball made by tar(1), the way scripts/build-binary.ts makes it. */
function tarball(files: Record<string, string>): Uint8Array {
  const stage = scratch();
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(stage, name), body);
  }
  const out = join(scratch(), "z3.tar");
  const r = spawnSync("tar", ["-cf", out, "-C", stage, "."]);
  expect(r.status).toBe(0);
  return readFileSync(out);
}

const z3 = "#!/bin/sh\necho z3\n";
const lib = "not really a shared library";

describe("reading the embedded tarball", () => {
  test("lists its regular files, without the ./ prefix", () => {
    const files = readTar(tarball({ z3, "libz3.so.4.16": lib }));
    expect(files.map((f) => f.name).sort()).toEqual(["libz3.so.4.16", "z3"]);
    expect(
      Buffer.from(files.find((f) => f.name === "z3")?.data ?? []).toString(),
    ).toBe(z3);
  });

  test("refuses links, nested paths and a tarball without z3", () => {
    const stage = scratch();
    writeFileSync(join(stage, "z3"), z3);
    symlinkSync("/bin/sh", join(stage, "libz3.so"));
    const out = join(scratch(), "t.tar");
    spawnSync("tar", ["-cf", out, "-C", stage, "."]);
    expect(() => readTar(readFileSync(out))).toThrow("is not a regular file");

    const nested = scratch();
    mkdirSync(join(nested, "sub"));
    writeFileSync(join(nested, "z3"), z3);
    writeFileSync(join(nested, "sub", "x"), "x");
    const out2 = join(scratch(), "n.tar");
    spawnSync("tar", ["-cf", out2, "-C", nested, "."]);
    expect(() => readTar(readFileSync(out2))).toThrow(
      "refusing the entry name",
    );

    expect(() => readTar(tarball({ "libz3.so": lib }))).toThrow(
      "no z3 executable",
    );
  });
});

describe("the per-user z3 directory", () => {
  test("is under XDG_CACHE_HOME, else ~/.cache, never a shared path", () => {
    expect(z3CacheRoot({ XDG_CACHE_HOME: "/c" })).toBe("/c/vector/z3");
    expect(z3CacheRoot({ XDG_CACHE_HOME: "rel", HOME: "/h" })).toBe(
      "/h/.cache/vector/z3",
    );
  });

  test("is created 0700 and the copy runs", () => {
    const root = join(scratch(), "cache", "vector", "z3");
    const dest = extractZ3Tar(tarball({ z3, "libz3.so.4.16": lib }), root);
    expect(statSync(root).mode & 0o777).toBe(0o700);
    expect(readFileSync(join(dest, "libz3.so.4.16"), "utf8")).toBe(lib);
    const r = spawnSync(join(dest, "z3"), [], { encoding: "utf8" });
    expect(r.stdout).toBe("z3\n");
  });

  test("a planted or damaged z3 is replaced by the embedded one", () => {
    const root = join(scratch(), "z3");
    const bytes = tarball({ z3 });
    const dest = extractZ3Tar(bytes, root);
    writeFileSync(join(dest, "z3"), "#!/bin/sh\necho unsat\n");
    expect(extractZ3Tar(bytes, root)).toBe(dest);
    expect(readFileSync(join(dest, "z3"), "utf8")).toBe(z3);
    rmSync(join(dest, "z3"));
    extractZ3Tar(bytes, root);
    expect(readFileSync(join(dest, "z3"), "utf8")).toBe(z3);
  });

  test("a file dropped beside z3 causes a fresh unpack", () => {
    const root = join(scratch(), "z3");
    const bytes = tarball({ z3, "libz3.so.4.16": lib });
    const dest = extractZ3Tar(bytes, root);
    writeFileSync(join(dest, "libc.so.6"), "planted");
    expect(extractZ3Tar(bytes, root)).toBe(dest);
    expect(readdirSync(dest).sort()).toEqual(["libz3.so.4.16", "z3"]);
  });

  test("a directory others can write is refused", () => {
    const root = join(scratch(), "z3");
    mkdirSync(root);
    chmodSync(root, 0o777);
    expect(() => extractZ3Tar(tarball({ z3 }), root)).toThrow(
      "it is writable by others (mode 777)",
    );
  });

  test("a directory above it that others can write is refused, unless sticky", () => {
    const shared = scratch();
    chmodSync(shared, 0o777);
    const root = join(shared, "cache", "z3");
    expect(() => privateDir(root)).toThrow(
      `${shared} above it is writable by others (mode 777) and not sticky`,
    );
    // A sticky one, like /tmp, is fine: others cannot rename what is in it.
    chmodSync(shared, 0o1777);
    expect(() => privateDir(root)).not.toThrow();
  });

  test("a directory above it reached through a symlink is checked as resolved", () => {
    const shared = scratch();
    chmodSync(shared, 0o777);
    mkdirSync(join(shared, "real"), { mode: 0o700 });
    const mine = scratch();
    symlinkSync(join(shared, "real"), join(mine, "link"));
    expect(() => privateDir(join(mine, "link", "z3"))).toThrow(
      `${shared} above it is writable by others`,
    );
  });

  test("a link in a directory others can write is refused, even passed through", () => {
    // mine/a -> shared/b -> mine/real: resolved, every directory is fine,
    // but whoever can write shared/ can point b anywhere later.
    const shared = scratch();
    chmodSync(shared, 0o777);
    const mine = scratch();
    mkdirSync(join(mine, "real"), { mode: 0o700 });
    symlinkSync(join(mine, "real"), join(shared, "b"));
    symlinkSync(join(shared, "b"), join(mine, "a"));
    expect(() => privateDir(join(mine, "a", "z3"))).toThrow(
      `${shared} above it is writable by others`,
    );
    // A relative link, and "..", resolve where the kernel would.
    symlinkSync("real/../real", join(mine, "rel"));
    expect(() => privateDir(join(mine, "rel", "z3"))).not.toThrow();
  });

  test("a symlink is refused", () => {
    const real = scratch();
    chmodSync(real, 0o700);
    const root = join(scratch(), "z3");
    symlinkSync(real, root);
    expect(() => privateDir(root)).toThrow("it is a symlink");
  });

  test.skipIf(process.getuid?.() !== 0)(
    "a directory another user owns is refused",
    () => {
      const root = join(scratch(), "z3");
      mkdirSync(root, { mode: 0o700 });
      chownSync(root, 65534, 65534);
      expect(() => privateDir(root)).toThrow("it is owned by uid 65534, not 0");
      const theirs = join(scratch(), "theirs");
      mkdirSync(theirs, { mode: 0o755 });
      chownSync(theirs, 65534, 65534);
      expect(() => privateDir(join(theirs, "z3"))).toThrow(
        `${theirs} above it is owned by uid 65534, not 0 or root`,
      );
    },
  );

  test.skipIf(process.getuid?.() !== 0)(
    "a symlink above it another user owns is refused, even in a sticky directory",
    () => {
      // In /tmp, its owner can point it elsewhere whenever they like.
      const sticky = scratch();
      chmodSync(sticky, 0o1777);
      const real = scratch();
      const link = join(sticky, "link");
      symlinkSync(real, link);
      expect(() => privateDir(join(link, "z3"))).not.toThrow();
      lchownSync(link, 65534, 65534);
      expect(() => privateDir(join(link, "z3"))).toThrow(
        `${link}, a symlink above it, is owned by uid 65534, not 0 or root`,
      );
    },
  );
});
