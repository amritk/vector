// Generates src/spec/source/fold.ts: every code point that reads as one ASCII
// letter once its compatibility decomposition is taken and its marks are
// dropped, as String.prototype.normalize("NFKD") and /\p{M}/u define them in
// the node that runs it. Nish has no Unicode normalisation, so the guard in
// hidden.ts reads this table instead. Run from the repository root:
//
//   node src/spec/source/fold_gen.mjs > src/spec/source/fold.ts
//   npx biome format --write src/spec/source/fold.ts
//
// `--check` regenerates the table and exits 1 when the committed fold.ts
// differs from it: its pairs, entry count, SHA-256 or class.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const pairs = [];
for (let cp = 0x80; cp <= 0x10ffff; cp++) {
  if (cp >= 0xd800 && cp <= 0xdfff) {
    continue;
  }
  const folded = String.fromCodePoint(cp)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "");
  if (folded.length === 1 && /^[A-Za-z]$/.test(folded)) {
    pairs.push([cp, folded.charCodeAt(0)]);
  }
}

// The table's identity: its values in decimal, joined by commas, hashed.
const flat = pairs.flat();
const sha = createHash("sha256").update(flat.join(",")).digest("hex");

// Every folded code point, as regex ranges: the spoof guard's word class
// takes them whatever Unicode version its regex engine knows (a letter new
// to Unicode, or a symbol letter `\p{L}` leaves out, still joins a word).
const ranges = [];
for (const [cp] of pairs) {
  const last = ranges[ranges.length - 1];
  if (last !== undefined && last[1] === cp - 1) {
    last[1] = cp;
  } else {
    ranges.push([cp, cp]);
  }
}
const esc = (n) => `\\\\u{${n.toString(16)}}`;
const foldClass = ranges
  .map(([a, b]) => (a === b ? esc(a) : `${esc(a)}-${esc(b)}`))
  .join("");

if (process.argv.includes("--check")) {
  const committed = readFileSync(new URL("./fold.ts", import.meta.url), "utf8");
  const problems = [];
  const table = committed.match(/foldTable = \(\): i32\[\] => \[([^\]]*)\]/);
  const got =
    table === null
      ? []
      : table[1]
          .split(",")
          .map((v) => v.trim())
          .filter((v) => v.length > 0)
          .map(Number);
  if (got.join(",") !== flat.join(",")) {
    problems.push(
      `the pairs differ: ${got.length / 2} committed, ${pairs.length} generated`,
    );
  }
  const constant = (name) => {
    const m = committed.match(new RegExp(`${name}: \\w+ =\\s*"?([^"\\n]*)"?`));
    return m === null ? null : m[1];
  };
  if (constant("FOLD_ENTRIES") !== `${pairs.length}`) {
    problems.push(`FOLD_ENTRIES is not ${pairs.length}`);
  }
  if (constant("FOLD_SHA256") !== sha) {
    problems.push(`FOLD_SHA256 is not ${sha}`);
  }
  if (constant("FOLD_CLASS") !== foldClass) {
    problems.push("FOLD_CLASS differs");
  }
  if (problems.length > 0) {
    process.stderr.write(
      `src/spec/source/fold.ts is stale: ${problems.join("; ")}; regenerate it\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `src/spec/source/fold.ts matches its generator (${pairs.length} entries)\n`,
  );
  process.exit(0);
}

const hex = (n) => `0x${n.toString(16)}`;
const body = pairs.map(([cp, a]) => `${hex(cp)}, ${a},`).join(" ");

process.stdout.write(`/**
 * \`spec/source/fold\` — GENERATED; do not edit it by hand. Regenerate it with
 * src/spec/source/fold_gen.mjs (this copy: node ${process.version}, Unicode
 * ${process.versions.unicode}). Each non-ASCII code point whose NFKD form,
 * with its combining marks removed, is a single ASCII letter, and that
 * letter: the precomposed Latin and Greek letters, superscripts, subscripts,
 * modifier letters, letterlike ranges, circled, fullwidth and mathematical
 * letters. Nish has no normalisation, so the spoof guard reads this.
 */

/** How many pairs foldTable holds. */
export const FOLD_ENTRIES: i32 = ${pairs.length}

/** The SHA-256 of foldTable's values in decimal, joined by commas: a hand edit changes it. */
export const FOLD_SHA256: string = "${sha}"

/**
 * Every code point foldTable holds, as ranges for a regex character class: a
 * word takes each of them whatever Unicode version the regex engine knows.
 */
export const FOLD_CLASS: string = "${foldClass}"

/**
 * The fold, as [code point, ASCII letter] pairs sorted by code point. Build it
 * once and hand it to foldAsciiLetter.
 *
 * @returns the pairs
 */
export const foldTable = (): i32[] => [${body}]

/**
 * The ASCII letter a non-ASCII code point folds to: NFKD, then its marks
 * dropped. "Ḿ" (U+1E3E) folds to "M", "ᴿ" (U+1D3F) to "R".
 *
 * @param table the fold (foldTable)
 * @param cp a code point
 * @returns the ASCII letter's code, or -1 when it folds to none
 */
export const foldAsciiLetter = (table: i32[], cp: i32): i32 => {
  let lo = 0
  let hi = table.length / 2 - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const at = table[mid * 2]
    if (at === cp) {
      return table[mid * 2 + 1]
    }
    if (at < cp) {
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return -1
}
`);
