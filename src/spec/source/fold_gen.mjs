// Generates src/spec/source/fold.ts: every code point that reads as one ASCII
// letter once its compatibility decomposition is taken and its marks are
// dropped, as String.prototype.normalize("NFKD") and /\p{M}/u define them in
// the node that runs it. Nish has no Unicode normalisation, so the guard in
// hidden.ts reads this table instead. Run from the repository root:
//
//   node src/spec/source/fold_gen.mjs > src/spec/source/fold.ts
//   npx biome format --write src/spec/source/fold.ts

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

const hex = (n) => `0x${n.toString(16)}`;
const body = pairs.map(([cp, a]) => `${hex(cp)}, ${a},`).join(" ");

process.stdout.write(`/**
 * \`spec/source/fold\` — GENERATED; do not edit it by hand. Regenerate it with
 * src/spec/source/fold_gen.mjs (this copy: node ${process.version}, Unicode
 * ${process.versions.unicode}). Each non-ASCII code point whose NFKD form,
 * with its combining marks removed, is a single ASCII letter, and that
 * letter: the precomposed Latin and Greek letters, superscripts, subscripts,
 * modifier letters, letterlike symbols, circled, fullwidth and mathematical
 * letters. Nish has no normalisation, so the spoof guard reads this.
 */

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
