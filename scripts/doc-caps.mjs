// Cap the size of the docs an agent reads, in bytes.
//
//   node scripts/doc-caps.mjs             exit 1 if a file in scripts/doc-caps.json
//                                         is missing or over its cap
//   node scripts/doc-caps.mjs --base REF  also exit 1 if a cap is higher than in
//                                         REF's scripts/doc-caps.json, or an entry
//                                         REF lists was removed
//
// Caps only ratchet down: adding an entry or lowering a cap is fine. A REF
// entry may leave only when git reports its file renamed between REF and HEAD
// to a path that REF did not cap and the current caps cap no higher. A REF
// without the file has no previous caps, so anything passes against it. Exit
// 2 on a malformed caps file (here or at REF), a REF that names no commit, a
// git failure while reading renames, or bad usage, which includes a REF that starts with "-". Paths are relative to
// the current directory, the repo's root.

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const capsFile = "scripts/doc-caps.json";
const advice =
  "shorten it in place: simplify, never move text into another file to fit";

const fail = (code, message) => {
  console.error(`doc-caps: ${message}`);
  process.exit(code);
};

/** The caps in `text`, or exit 2 naming `where` when it is not `{ path: bytes }`. */
const parseCaps = (text, where) => {
  let caps;
  try {
    caps = JSON.parse(text);
  } catch (e) {
    fail(2, `${where} is not valid JSON: ${e.message}`);
  }
  if (caps === null || typeof caps !== "object" || Array.isArray(caps)) {
    fail(2, `${where} must be an object mapping a path to its cap in bytes`);
  }
  for (const [file, cap] of Object.entries(caps)) {
    if (!Number.isSafeInteger(cap) || cap <= 0) {
      fail(2, `${where}: the cap of ${file} must be a positive integer`);
    }
  }
  return caps;
};

const git = (...args) =>
  execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

/** REF's copy of the caps file, "" when REF has none; exit 2 when REF names no commit. */
const capsAt = (ref) => {
  try {
    git("rev-parse", "--verify", "--quiet", `${ref}^{commit}`);
  } catch {
    fail(2, `cannot read the base ${ref}: it names no commit`);
  }
  try {
    git("cat-file", "-e", `${ref}:${capsFile}`);
  } catch {
    return "";
  }
  try {
    return git("show", `${ref}:${capsFile}`);
  } catch {
    fail(2, `cannot read ${capsFile} at the base ${ref}`);
  }
};

/** The files git reports renamed between REF and HEAD, old path to new; exit 2 when git fails. */
const renamesSince = (ref) => {
  let out;
  try {
    out = git("diff", "--name-status", "-z", "-M", ref, "HEAD", "--");
  } catch {
    fail(2, `cannot read the renames between the base ${ref} and HEAD`);
  }
  // With -M and no -C, a rename (R100) names two paths; every other status one.
  const fields = out.split("\0");
  const renames = new Map();
  for (let i = 0; i < fields.length; ) {
    if (fields[i].startsWith("R")) {
      renames.set(fields[i + 1], fields[i + 2]);
      i += 3;
    } else {
      i += 2;
    }
  }
  return renames;
};

const args = process.argv.slice(2);
let base = null;
if (
  args.length === 2 &&
  args[0] === "--base" &&
  args[1] !== "" &&
  !args[1].startsWith("-")
) {
  base = args[1];
} else if (args.length !== 0) {
  fail(2, "usage: node scripts/doc-caps.mjs [--base REF]");
}

let text;
try {
  text = readFileSync(capsFile, "utf8");
} catch (e) {
  fail(2, `cannot read ${capsFile}: ${e.message}`);
}
const caps = parseCaps(text, capsFile);

const problems = [];
for (const [file, cap] of Object.entries(caps)) {
  let size;
  try {
    const st = statSync(file);
    if (!st.isFile()) throw new Error("not a file");
    size = st.size;
  } catch {
    problems.push(
      `${file}: missing, but ${capsFile} caps it at ${cap} bytes; ${advice}`,
    );
    continue;
  }
  if (size > cap) {
    problems.push(`${file}: ${size} bytes, over its cap of ${cap}; ${advice}`);
  }
}

if (base !== null) {
  const baseText = capsAt(base);
  const baseCaps =
    baseText === "" ? {} : parseCaps(baseText, `${base}:${capsFile}`);
  let renames = null;
  for (const [file, was] of Object.entries(baseCaps)) {
    if (!Object.hasOwn(caps, file)) {
      renames ??= renamesSince(base);
      const to = renames.get(file);
      if (to === undefined) {
        problems.push(
          `${file}: its cap of ${was} bytes at ${base} was removed; caps are never dropped, ${advice}`,
        );
      } else if (Object.hasOwn(baseCaps, to)) {
        problems.push(
          `${file}: renamed to ${to}, which was already capped at ${base}, so its cap of ${was} bytes was removed; caps are never dropped, ${advice}`,
        );
      } else if (!Object.hasOwn(caps, to)) {
        problems.push(
          `${file}: renamed to ${to}, which has no cap, so its cap of ${was} bytes at ${base} was removed; caps are never dropped, ${advice}`,
        );
      } else if (caps[to] > was) {
        problems.push(
          `${file}: renamed to ${to}, whose cap of ${caps[to]} bytes is higher than its ${was} at ${base}; caps only go down, ${advice}`,
        );
      }
    } else if (caps[file] > was) {
      problems.push(
        `${file}: its cap was raised from ${was} to ${caps[file]} bytes since ${base}; caps only go down, ${advice}`,
      );
    }
  }
}

for (const p of problems) console.error(`doc-caps: ${p}`);
process.exit(problems.length > 0 ? 1 : 0);
