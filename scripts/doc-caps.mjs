// Cap the size of the docs an agent reads, in bytes.
//
//   node scripts/doc-caps.mjs             exit 1 if a file in scripts/doc-caps.json
//                                         is missing or over its cap
//   node scripts/doc-caps.mjs --base REF  also exit 1 if a cap is higher than in
//                                         REF's scripts/doc-caps.json, or an entry
//                                         REF lists was removed
//
// Caps only ratchet down: adding an entry or lowering a cap is fine. A REF
// without the file has no previous caps, so anything passes against it. Exit
// 2 on a malformed caps file (here or at REF), a REF that names no commit, or
// bad usage. Paths are relative to the current directory, the repo's root.

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

/** REF's copy of the caps file, "" when REF has none; exit 2 when REF names no commit. */
const capsAt = (ref) => {
  const git = (...args) =>
    execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
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

const args = process.argv.slice(2);
let base = null;
if (args.length === 2 && args[0] === "--base" && args[1] !== "") {
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
  for (const [file, was] of Object.entries(baseCaps)) {
    if (!Object.hasOwn(caps, file)) {
      problems.push(
        `${file}: its cap of ${was} bytes at ${base} was removed; caps are never dropped, ${advice}`,
      );
    } else if (caps[file] > was) {
      problems.push(
        `${file}: its cap was raised from ${was} to ${caps[file]} bytes since ${base}; caps only go down, ${advice}`,
      );
    }
  }
}

for (const p of problems) console.error(`doc-caps: ${p}`);
process.exit(problems.length > 0 ? 1 : 0);
