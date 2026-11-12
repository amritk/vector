// Reading an RFC's plain text: the RFC text form (a "Request for Comments: N"
// header and the form feeds of its page breaks) is read by rfctext.ts, after
// a check that the text reads the same to a reviewer as to the gates. RFC XML
// v3 is read by xmlv3.ts; anything else is refused.

import { type RfcDocument, parseRfc } from "./rfctext.ts";

/** The id of the pseudo-section holding text outside every numbered section. */
export const LOOSE_SECTION = "(unnumbered)";

/**
 * Read an RFC's plain text. A text without the RFC header and form feeds is
 * refused rather than read as a document with no sections, and so is one
 * hiding text from the gates (hiddenText).
 */
export function parseDocument(text: string): RfcDocument {
  if (!(/Request for Comments:\s*\d+/.test(text) && text.includes("\f"))) {
    throw new Error(
      'not a specification: neither an RFC\'s plain text (a "Request for Comments: N" header and form feeds) nor RFC XML v3 (a .xml file)',
    );
  }
  const hidden = hiddenText(text);
  if (hidden.length > 0) {
    const more = hidden.length > 5 ? ` (and ${hidden.length - 5} more)` : "";
    throw new Error(
      `text a reader cannot see as the gates read it: ${hidden.slice(0, 5).join("; ")}${more}`,
    );
  }
  return parseRfc(text);
}

// ---------------------------------------------------------------------------
// Text that reads one way and gates another. The completeness gate looks for
// MUST / SHALL / REQUIRED in the raw characters; a reviewer reads the page. A
// zero-width character inside a keyword, or a Cyrillic Т in MUSТ, shows a
// reviewer a requirement the gate never sees. Such a text is refused rather
// than guessed at.

/** Blank code points that are not format characters (\p{Cf} is checked too). */
const BLANK_RANGES: [number, number][] = [
  [0x034f, 0x034f], // combining grapheme joiner
  [0x115f, 0x1160], // Hangul fillers
  [0x17b4, 0x17b5], // Khmer inherent vowels
  [0x180b, 0x180f], // Mongolian variation selectors
  [0x3164, 0x3164], // Hangul filler
  [0xfe00, 0xfe0f], // variation selectors
  [0xffa0, 0xffa0], // halfwidth Hangul filler
  [0xe0100, 0xe01ef], // variation selectors supplement
];

/** Whether `ch` is invisible in a rendered page. */
const invisible = (ch: string): boolean => {
  if (/\p{Cf}/u.test(ch)) return true;
  const cp = ch.codePointAt(0) ?? 0;
  return BLANK_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);
};

// Capitals in other scripts that render as the Latin letter.
const LOOKALIKE: Record<string, string> = {
  "\u0391": "A",
  "\u0392": "B",
  "\u0395": "E",
  "\u0396": "Z",
  "\u0397": "H",
  "\u0399": "I",
  "\u039A": "K",
  "\u039C": "M",
  "\u039D": "N",
  "\u039F": "O",
  "\u03A1": "P",
  "\u03A4": "T",
  "\u03A5": "Y",
  "\u03A7": "X",
  "\u0405": "S",
  "\u0406": "I",
  "\u0408": "J",
  "\u0410": "A",
  "\u0412": "B",
  "\u0415": "E",
  "\u041A": "K",
  "\u041C": "M",
  "\u041D": "H",
  "\u041E": "O",
  "\u0420": "P",
  "\u0421": "C",
  "\u0422": "T",
  "\u0423": "Y",
  "\u0425": "X",
  "\u04AE": "Y",
  "\u04C0": "I",
  "\u051A": "Q",
  "\u051C": "W",
  "\u13A0": "D",
  "\u13A1": "R",
  "\u13A2": "T",
  "\u13AA": "G",
  "\u13B3": "W",
  "\u13B7": "M",
  "\u13BB": "H",
  "\u13C0": "G",
  "\u13C2": "h",
  "\u13C3": "Z",
  "\u13CF": "b",
  "\u13D2": "R",
  "\u13DA": "V",
  "\u13DE": "L",
  "\u13DF": "C",
  "\u13E2": "P",
  "\u13E6": "K",
  "\u13F4": "B",
  "\u13D5": "S",
  "\u13A5": "i",
  "\u2160": "I",
  "\u216C": "L",
  "\u216D": "C",
  "\u216E": "D",
  "\u216F": "M",
  // Armenian capitals
  "\u053C": "L",
  "\u054D": "U",
  "\u054F": "S",
  "\u0555": "O",
  // Lisu (Fraser) letters
  "\uA4D0": "B",
  "\uA4D1": "P",
  "\uA4D3": "D",
  "\uA4D4": "T",
  "\uA4D6": "G",
  "\uA4D7": "K",
  "\uA4D9": "J",
  "\uA4DA": "C",
  "\uA4DC": "Z",
  "\uA4DD": "F",
  "\uA4DF": "M",
  "\uA4E0": "N",
  "\uA4E1": "L",
  "\uA4E2": "S",
  "\uA4E3": "R",
  "\uA4E6": "V",
  "\uA4E7": "H",
  "\uA4EA": "W",
  "\uA4EB": "X",
  "\uA4EC": "Y",
  "\uA4EE": "A",
  "\uA4F0": "E",
  "\uA4F2": "I",
  "\uA4F3": "O",
  "\uA4F4": "U",
};
const KEYWORD_WORDS = new Set(["MUST", "SHALL", "REQUIRED"]);

/** A word as a reader sees it: compatibility forms, marks and look-alikes folded. */
const fold = (word: string): string =>
  [...word.normalize("NFKD").replace(/\p{M}/gu, "")]
    .filter((ch) => !invisible(ch))
    .map((ch) => LOOKALIKE[ch] ?? ch)
    .join("");

const codePoint = (ch: string): string =>
  `U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`;

/**
 * Why `text` would read differently to a reviewer than to the gates, one
 * entry per spot (`line N: …`); empty when it reads the same. An RFC is plain
 * text, so a character reference such as `&#85;` reads as itself.
 */
export function hiddenText(text: string): string[] {
  const out: string[] = [];
  const lineAt = (i: number) => text.slice(0, i).split("\n").length;

  let at = 0;
  for (const ch of text) {
    // A leading byte-order mark is an encoding marker, not text.
    if (invisible(ch) && !(at === 0 && ch === "\uFEFF"))
      out.push(
        `line ${lineAt(at)}: invisible character ${codePoint(ch)}: remove it`,
      );
    at += ch.length;
  }

  // A keyword spelled with look-alike letters or marks, or with ASCII letters
  // around letters of another script (MՍST): no table lists every look-alike.
  for (const m of text.matchAll(/[\p{L}\p{N}\p{M}]+/gu)) {
    const word = m[0];
    if (!/[^A-Za-z0-9]/.test(word)) continue;
    const folded = fold(word);
    const keyword = KEYWORD_WORDS.has(folded) ? folded : spoofs(folded);
    if (keyword !== undefined)
      out.push(
        `line ${lineAt(m.index ?? 0)}: "${word}" reads as ${keyword} but is not spelled in ASCII: write ${keyword}`,
      );
  }
  return out;
}

/**
 * The keyword a word copies letter for letter, with letters of another
 * script in some places (MՍST, MUꓢT): undefined for a plain word.
 */
const spoofs = (word: string): string | undefined => {
  const cs = [...word];
  if (!cs.some((c) => /[A-Z]/.test(c)) || !cs.some((c) => c > "\x7f"))
    return undefined;
  return [...KEYWORD_WORDS].find(
    (k) =>
      cs.length === k.length &&
      cs.every((c, i) => c === k[i] || (c > "\x7f" && /\p{L}/u.test(c))),
  );
};
