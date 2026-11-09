// Where the compiled binary keeps its extracted z3, and why that copy can be
// trusted. The binary embeds a tarball of the `z3` executable and its shared
// library; on first use it is unpacked into a directory only the current user
// can write, and every later run checks each file against the tarball's own
// bytes before executing anything. A shared, predictable path (the old
// `/tmp/vector-z3/<hash>`) let another local user plant a `z3` that answers
// `unsat` to everything — every function PROVEN — and run as the victim.

import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

/** One regular file of a tarball. */
export interface TarFile {
  name: string;
  data: Uint8Array;
}

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** A NUL-terminated (or field-filling) ASCII field of a tar header. */
function field(h: Uint8Array, at: number, len: number): string {
  let end = at;
  while (end < at + len && h[end] !== 0) end++;
  return Buffer.from(h.subarray(at, end)).toString("latin1");
}

/**
 * The regular files of a ustar/GNU tarball, flat: each name is a plain file
 * name (a leading "./" is dropped). Directories and pax headers are skipped;
 * anything else (links, devices, nested paths, "..") is refused, so the
 * archive cannot write outside the directory it is unpacked into.
 */
export function readTar(bytes: Uint8Array): TarFile[] {
  const files: TarFile[] = [];
  let at = 0;
  let longName: string | null = null;
  while (at + 512 <= bytes.length) {
    const h = bytes.subarray(at, at + 512);
    if (h.every((b) => b === 0)) break;
    const size = Number.parseInt(field(h, 124, 12).trim() || "0", 8);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error("z3 tarball: a header with an unreadable size");
    }
    const type = String.fromCharCode(h[156] || 48);
    const prefix = field(h, 345, 155);
    let name =
      longName ?? (prefix ? `${prefix}/${field(h, 0, 100)}` : field(h, 0, 100));
    longName = null;
    const body = bytes.subarray(at + 512, at + 512 + size);
    if (body.length !== size) throw new Error("z3 tarball: truncated");
    at += 512 + Math.ceil(size / 512) * 512;
    if (type === "L") {
      longName = field(body, 0, body.length);
      continue;
    }
    if (type === "x" || type === "g" || type === "5") continue;
    name = name.replace(/^(\.\/)+/, "");
    if (type !== "0") {
      throw new Error(`z3 tarball: ${name} is not a regular file`);
    }
    if (!/^[A-Za-z0-9._+-]+$/.test(name) || name === "." || name === "..") {
      throw new Error(
        `z3 tarball: refusing the entry name ${JSON.stringify(name)}`,
      );
    }
    files.push({ name, data: body });
  }
  if (!files.some((f) => f.name === "z3")) {
    throw new Error("z3 tarball: no z3 executable in it");
  }
  return files;
}

/**
 * The per-user directory extracted copies live under:
 * `$XDG_CACHE_HOME/vector/z3`, else `~/.cache/vector/z3`, else
 * `<tmpdir>/vector-z3-<uid>`.
 */
export function z3CacheRoot(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_CACHE_HOME;
  if (xdg && isAbsolute(xdg)) return join(xdg, "vector", "z3");
  let home = "";
  try {
    home = env.HOME || homedir();
  } catch {}
  if (home && isAbsolute(home)) return join(home, ".cache", "vector", "z3");
  return join(tmpdir(), `vector-z3-${process.getuid?.() ?? "user"}`);
}

/**
 * Create `dir` (mode 0700) if needed and make sure only this user can change
 * what is in it: a real directory, not a symlink, owned by this uid and not
 * writable by group or others. Throws, naming the problem, otherwise.
 */
export function privateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = lstatSync(dir);
  const refuse = (why: string) => {
    throw new Error(
      `refusing to run z3 from ${dir}: ${why}; remove it, or set XDG_CACHE_HOME to a directory of your own`,
    );
  };
  if (st.isSymbolicLink()) refuse("it is a symlink");
  if (!st.isDirectory()) refuse("it is not a directory");
  const uid = process.getuid?.();
  if (uid !== undefined && st.uid !== uid) {
    refuse(`it is owned by uid ${st.uid}, not ${uid}`);
  }
  if ((st.mode & 0o022) !== 0) {
    refuse(`it is writable by others (mode ${(st.mode & 0o777).toString(8)})`);
  }
}

/**
 * `dir` holds the tarball's files with exactly its bytes, and nothing else:
 * a library dropped beside z3 could be loaded by it.
 */
function intact(dir: string, files: TarFile[]): boolean {
  try {
    const names = new Set(files.map((f) => f.name));
    const present = readdirSync(dir);
    if (present.length !== names.size || present.some((n) => !names.has(n)))
      return false;
    return files.every((f) => {
      const p = join(dir, f.name);
      const st = lstatSync(p);
      return st.isFile() && sha256(readFileSync(p)) === sha256(f.data);
    });
  } catch {
    return false;
  }
}

/**
 * Unpack the z3 tarball under `root` (a private directory, see privateDir)
 * into a directory named for the tarball's hash, and return that directory.
 * An existing copy is used only when every file matches the tarball; one
 * that does not (partial, corrupted, replaced) is unpacked afresh.
 */
export function extractZ3Tar(
  bytes: Uint8Array,
  root: string = z3CacheRoot(),
): string {
  const files = readTar(bytes);
  privateDir(root);
  const dest = join(root, sha256(bytes).slice(0, 16));
  if (intact(dest, files)) return dest;

  const staging = mkdtempSync(join(root, ".staging-"));
  try {
    for (const f of files) {
      writeFileSync(join(staging, f.name), f.data, {
        mode: f.name === "z3" ? 0o700 : 0o600,
      });
    }
    try {
      renameSync(staging, dest);
    } catch {
      // Another process got there first, or a bad copy is in the way.
      if (!intact(dest, files)) {
        rmSync(dest, { recursive: true, force: true });
        renameSync(staging, dest);
      }
    }
  } finally {
    if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
  }
  if (!intact(dest, files)) {
    throw new Error(`z3 in ${dest} does not match the embedded copy`);
  }
  return dest;
}
