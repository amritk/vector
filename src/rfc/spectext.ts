// Reading a specification that is not an RFC: a markdown document whose
// sections are numbered headings. It yields the same RfcDocument an RFC does,
// so every gate (quotes, hex runs, labelled ints, normative sentences) reads
// either without knowing which it has.
//
// How markdown constructs feed the gates:
//
//   numbered headings  `## 3. Encoding` is section "3", `### 3.1. Length` is
//                      "3.1", `## Appendix A. Vectors` is "A". The trailing dot
//                      is required, as in an RFC. A section runs until the
//                      next heading at its own level or above, so "3" includes
//                      "3.1"; its own text stops at the next numbered heading.
//                      The same id twice is refused.
//   other headings     end nothing but their own heading line; an unnumbered
//                      `##` heading at a section's level ends it, and the text
//                      under it belongs to no section (see `loose`).
//   fenced code        ``` or ~~~ fences (a ``` fence's info string has no
//                      backtick; the closing fence is bare and at least as
//                      long as the opening one): the fence lines are dropped, the
//                      lines inside are kept verbatim (a `#` there is not a
//                      heading, a `<!--` not a comment), so a quote or hex
//                      value in code is found and a MUST in code still has to
//                      be accounted for. A fence never closed is refused.
//                      They are not prose (`proseLines`), so they never
//                      state a vector's expected null or bool.
//   indented code      kept verbatim, like any other line; a `<!--` on a line
//                      indented four spaces or a tab is text.
//   inline code        the backticks are dropped: "`hexEncode`" reads as
//                      "hexEncode" in quotes, strings and hex runs. A `<!--`
//                      inside a span is text.
//   tables             each cell becomes a line of its own (the delimiter row
//                      is dropped); every row starts a new hex run and every
//                      cell ends one, so a cell is never glued to its
//                      neighbour, or a row to the line above, in a hex run.
//                      Cells are not prose either.
//   blockquotes        kept as written, `>` included; not prose.
//   HTML comments      `<!-- … -->` is dropped, headings inside it included. A
//                      `<!--` never closed is refused: it would otherwise hide
//                      the rest of the document from every gate.
//   blank lines        a paragraph break ends a hex run, as do fence lines and
//                      headings, so a value is one paragraph's, block's or
//                      cell's. A dump within one of them still joins.
//   byte lists         "[00 0f f0 ff]" anywhere in a line is also read as hex,
//                      a run of its own (only for hex runs, not for quotes).
//   BCP 14 boilerplate the key-words sentence itself ("The key words", the
//                      keyword list, "are to be interpreted", the BCP 14 or
//                      RFC 2119 reference, on to its full stop) names the
//                      keywords without using them, so that sentence alone is
//                      removed: it is neither quotable nor normative. The rest
//                      of its paragraph stays, a keyword after the list ends
//                      the removal there, and a sentence that only mentions
//                      key words ("The key words in the header MUST be
//                      sorted, see BCP 14.") is not boilerplate.
//   emphasis           kept as written, so a quote copies it verbatim
//                      (`**MUST**` stays starred); `_MUST_` and `__MUST__` are
//                      keywords all the same (see rfctext.ts KEYWORD_RE).
//   anything else      links and lists are kept as written.

import { type RfcDocument, type RfcSection, parseRfc } from "./rfctext.ts";

export type SpecFormat = "rfc" | "markdown";

const MD_HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const NUMBERED_RE = /^(\d+(?:\.\d+)*|[A-Z](?:\.\d+)*)\.[ \t]+(\S.*)$/;
const MD_APPENDIX_RE = /^Appendix ([A-Z])\.[ \t]+(\S.*)$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const TABLE_DELIM_RE = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const BYTE_LIST_RE = /\[((?:[0-9a-fA-F]{2})(?:[ ,]+[0-9a-fA-F]{2})*)\]/g;
const KEYWORD = "(?:MUST|SHALL|SHOULD|REQUIRED|RECOMMENDED|MAY|OPTIONAL)";
/** A keyword as the boilerplate lists it: bare, quoted or emphasised. */
const LISTED = `[*_"]*(?:MUST NOT|MUST|SHALL NOT|SHALL|SHOULD NOT|SHOULD|REQUIRED|NOT RECOMMENDED|RECOMMENDED|MAY|OPTIONAL)[*_"]*`;
/**
 * The BCP 14 key-words sentence itself: "key words", the list of keywords
 * (if any),
 * "are to be interpreted", a BCP 14 / RFC 2119 reference, then on to its full
 * stop, stopping early at a keyword after the list. A sentence that only
 * mentions key words ("The key words in the header MUST be sorted, see
 * BCP 14.") is not it: its MUST is not in a list followed by "are to be
 * interpreted", so nothing of it is dropped.
 */
const BCP14_RE = new RegExp(
  `\\b(?:[Tt]he\\s+)?[Kk]ey\\s+words\\s+(?:${LISTED}(?:\\s*,?\\s*(?:(?:and|or)\\s+)?${LISTED})*\\s*,?\\s+)?(?:(?:in|of)\\s+this\\s+(?:document|specification|memo)\\s+)?are\\s+to\\s+be\\s+interpreted\\b(?:(?!${KEYWORD}(?![A-Za-z0-9]))[^.])*?\\b(?:BCP\\s*14|RFC\\s*2119)\\b(?:(?!${KEYWORD}(?![A-Za-z0-9]))[^.])*\\.?`,
  "g",
);
const NUMBERED_HEADING_RE =
  /^ {0,3}#{1,6}[ \t]+`*(?:\d+(?:\.\d+)*|[A-Z](?:\.\d+)*|Appendix [A-Z])\.[ \t]+\S/m;

/** The id of the pseudo-section holding text outside every numbered section. */
export const LOOSE_SECTION = "(unnumbered)";

/**
 * Which reader a text needs. An RFC has its "Request for Comments: N" header
 * and the form feeds of its page breaks; a markdown spec has numbered `#`
 * headings (`## 1. Introduction`), so a script's `# comment` is not one.
 * Anything else is refused rather than read as a document with no sections.
 */
export function detectFormat(text: string): SpecFormat {
  if (/Request for Comments:\s*\d+/.test(text) && text.includes("\f")) {
    return "rfc";
  }
  if (NUMBERED_HEADING_RE.test(text)) return "markdown";
  throw new Error(
    'not a specification: neither an RFC (a "Request for Comments: N" header and form feeds) nor a markdown spec (numbered # headings such as "## 1. Introduction")',
  );
}

/** Read an RFC or a markdown spec, whichever the text is. */
export function parseDocument(text: string): RfcDocument {
  const format = detectFormat(text);
  const hidden = hiddenText(text, format);
  if (hidden.length > 0) {
    const more = hidden.length > 5 ? ` (and ${hidden.length - 5} more)` : "";
    throw new Error(
      `text a reader cannot see as the gates read it: ${hidden.slice(0, 5).join("; ")}${more}`,
    );
  }
  return format === "rfc" ? parseRfc(text) : parseMarkdownSpec(text);
}

// ---------------------------------------------------------------------------
// Text that reads one way and gates another. The completeness gate looks for
// MUST / SHALL / REQUIRED in the raw characters; a reviewer reads the
// rendered page. A zero-width character inside a keyword, a character
// reference that a markdown renderer turns into a letter, or a Cyrillic Т in
// MUSТ shows a reviewer a requirement the gate never sees. Such a spec is
// refused rather than guessed at.

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

/** The character references a markdown spec may use: markup escapes. */
const NAMED_REFS: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00A0",
};
const CHAR_REF_RE =
  /&(?:#(\d{1,7})|#[xX]([0-9A-Fa-f]{1,6})|([A-Za-z][A-Za-z0-9]{0,31}));/g;

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
 * entry per spot (`line N: …`); empty when it reads the same. Markdown
 * character references are checked only in a markdown spec — an RFC is
 * plain text, where `&#85;` reads as itself.
 */
export function hiddenText(text: string, format: SpecFormat): string[] {
  const out: string[] = [];
  const lineIn = (t: string, i: number) => t.slice(0, i).split("\n").length;
  const lineAt = (i: number) => lineIn(text, i);

  let at = 0;
  for (const ch of text) {
    // A leading byte-order mark is an encoding marker, not text.
    if (invisible(ch) && !(at === 0 && ch === "\uFEFF"))
      out.push(
        `line ${lineAt(at)}: invisible character ${codePoint(ch)}: remove it`,
      );
    at += ch.length;
  }

  // What a markdown renderer shows: references decoded.
  let shown = text;
  if (format === "markdown") {
    shown = text.replace(CHAR_REF_RE, (ref, dec, hex, name, at: number) => {
      if (name !== undefined) {
        const known = NAMED_REFS[name];
        if (known !== undefined) return known;
        out.push(
          `line ${lineAt(at)}: character reference ${ref}: write the character itself (only ${Object.keys(
            NAMED_REFS,
          )
            .map((n) => `&${n};`)
            .join(" ")} are read)`,
        );
        return ref;
      }
      const cp = dec !== undefined ? Number(dec) : Number.parseInt(hex, 16);
      const ch = cp <= 0x10ffff ? String.fromCodePoint(cp) : "\uFFFD";
      if (/[A-Za-z0-9]/.test(ch) || invisible(ch))
        out.push(
          `line ${lineAt(at)}: character reference ${ref} renders as ${/[A-Za-z0-9]/.test(ch) ? `"${ch}"` : `invisible ${codePoint(ch)}`}: write the character itself`,
        );
      return ch;
    });
  }

  // A keyword spelled with look-alike letters or marks, or with ASCII letters
  // around letters of another script (MՍST): no table lists every look-alike.
  for (const m of shown.matchAll(/[\p{L}\p{N}\p{M}]+/gu)) {
    const word = m[0];
    if (!/[^A-Za-z0-9]/.test(word)) continue;
    const folded = fold(word);
    const keyword = KEYWORD_WORDS.has(folded) ? folded : spoofs(folded);
    if (keyword !== undefined)
      out.push(
        `line ${lineIn(shown, m.index ?? 0)}: "${word}" reads as ${keyword} but is not spelled in ASCII: write ${keyword}`,
      );
  }

  // A keyword split by markdown emphasis, a code span or an inline tag
  // (M*U*ST, MUS<i></i>T) renders whole; markup around it (**MUST**) is fine.
  if (format === "markdown")
    for (const m of shown.matchAll(MARKED_WORD_RE)) {
      const word = m[0].replace(EDGE_MARKUP_RE, "");
      if (!INLINE_MARKUP_RE.test(word)) continue;
      const plain = fold(word.replace(INLINE_MARKUP_G, ""));
      const keyword = KEYWORD_WORDS.has(plain) ? plain : spoofs(plain);
      if (keyword !== undefined)
        out.push(
          `line ${lineIn(shown, m.index ?? 0)}: "${word}" renders as ${keyword} but markup splits it for the gates: write ${keyword}`,
        );
    }
  return out;
}

/** Emphasis (not "_", which inside a word is a letter to CommonMark), code-span and strike markers, inline tags and comments. */
const INLINE_MARKUP = String.raw`[*~\x60]|<\/?[A-Za-z][^<>\n]*>|<!--.*?-->`;
const INLINE_MARKUP_RE = new RegExp(INLINE_MARKUP);
const INLINE_MARKUP_G = new RegExp(INLINE_MARKUP, "g");
const EDGE_MARKUP_RE = new RegExp(
  `^(?:${INLINE_MARKUP})+|(?:${INLINE_MARKUP})+$`,
  "g",
);
const MARKED_WORD_RE = new RegExp(
  `(?:[\\p{L}\\p{N}\\p{M}]|${INLINE_MARKUP})+`,
  "gu",
);

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

interface MdLine {
  /** The text the gates read: inline backticks dropped, a table cell. */
  text: string;
  /** Extra hex-run lines this line contributes (its bracketed byte lists). */
  hex: string[];
  /** Its inline code spans, without their backticks. */
  spans?: string[];
  heading?: { level: number; id: string | null; title: string };
  /** Code, a table cell or a blockquote: text, but not the spec's prose. */
  quoted?: true;
  /**
   * The line exactly as written, when it is code: inside a fenced block, or
   * an indented code line (four spaces or a tab after a blank line, a
   * heading or another code line). The Interface reads signatures only here.
   */
  code?: string;
}

/** The line, marked as not prose. */
const quoted = (l: MdLine): MdLine =>
  l.text === "" ? l : { ...l, quoted: true };

/** Table cells, split on `|` not escaped as `\|`. */
const cells = (row: string): string[] =>
  row
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));

/** A line the gates see as blank, and a break in every hex run. */
const BREAK = (): MdLine => ({ text: "", hex: ["--"] });

function readLines(text: string): MdLine[] {
  const raw = text.replace(/\r\n?/g, "\n").split("\n");
  const out: MdLine[] = [];
  let fence: { mark: string; at: number } | null = null;
  let comment: number | null = null;
  // Whether an indented line here starts or continues an indented code block:
  // after a blank line, a heading or another code line, never inside a
  // paragraph (where it is the paragraph's lazy continuation).
  let codeMayStart = true;
  for (let n = 0; n < raw.length; n++) {
    const rawLine = raw[n];
    const indentedCode: boolean =
      fence === null &&
      comment === null &&
      codeMayStart &&
      /^(?: {4}|\t)/.test(rawLine) &&
      rawLine.trim() !== "";
    if (fence !== null) {
      const f = rawLine.match(FENCE_RE);
      if (
        f &&
        f[1][0] === fence.mark[0] &&
        f[1].length >= fence.mark.length &&
        /^[ \t]*$/.test(f[2])
      ) {
        fence = null;
        codeMayStart = true;
        out.push(BREAK());
      } else out.push({ ...quoted(withBytes(rawLine)), code: rawLine });
      continue;
    }
    const [line, open] = stripComments(rawLine, comment !== null);
    if (open && comment === null) comment = n + 1;
    if (!open) comment = null;
    const f = line.match(FENCE_RE);
    if (f && !(f[1][0] === "`" && f[2].includes("`"))) {
      if (open) {
        throw new Error(
          `line ${n + 1}: a code fence and an HTML comment open on one line`,
        );
      }
      fence = { mark: f[1], at: n + 1 };
      out.push(BREAK());
      continue;
    }
    const inline = line.replace(/`/g, "");
    const spans = codeSpans(line);
    const h = inline.match(MD_HEADING_RE);
    if (h) {
      const id = h[2].match(NUMBERED_RE) ?? h[2].match(MD_APPENDIX_RE);
      out.push({
        text: h[2],
        hex: ["--"],
        heading: {
          level: h[1].length,
          id: id ? id[1] : null,
          title: (id ? id[2] : h[2]).trim(),
        },
      });
      codeMayStart = true;
      continue;
    }
    if (/^\s*\|/.test(inline)) {
      codeMayStart = false;
      if (TABLE_DELIM_RE.test(inline)) continue;
      // Every cell ends a hex run ("--" is never hex), and so does the start
      // of a row, so two cells, two rows, or a row and the line above it are
      // never read as one value.
      out.push(BREAK());
      const raw = cells(line);
      cells(inline).forEach((cell, i) => {
        const l = withBytes(cell);
        l.hex.push("--");
        if (raw.length === cells(inline).length) l.spans = codeSpans(raw[i]);
        out.push(quoted(l));
      });
      continue;
    }
    const l = withBytes(inline);
    if (spans.length > 0) l.spans = spans;
    codeMayStart = l.text === "" || indentedCode;
    if (indentedCode) l.code = rawLine;
    out.push(/^ {0,3}>/.test(inline) ? quoted(l) : l);
  }
  // An unterminated form would swallow the rest of the document (its
  // headings and its MUSTs), so it is refused, never read to the end.
  if (fence !== null) {
    throw new Error(`line ${fence.at}: code fence is never closed`);
  }
  if (comment !== null) {
    throw new Error(`line ${comment}: HTML comment "<!--" is never closed`);
  }
  return dropBoilerplate(out);
}

/**
 * The line without its HTML comments, and whether a comment is still open
 * after it. A "<!--" inside an inline code span, or on an indented code line
 * (four spaces or a tab), is text, not a comment.
 */
function stripComments(line: string, open: boolean): [string, boolean] {
  if (!open && /^(?: {4}|\t)/.test(line)) return [line, false];
  let kept = "";
  let i = 0;
  let inside = open;
  while (i < line.length) {
    if (inside) {
      const end = line.indexOf("-->", i);
      if (end < 0) return [kept, true];
      i = end + 3;
      inside = false;
      continue;
    }
    if (line[i] === "`") {
      let n = i;
      while (line[n] === "`") n++;
      const ticks = line.slice(i, n);
      // The span closes at the next run of exactly as many backticks.
      const close = new RegExp(`(?<!\`)${ticks}(?!\`)`, "g");
      close.lastIndex = n;
      const m = close.exec(line);
      const to = m ? m.index + ticks.length : n;
      kept += line.slice(i, to);
      i = to;
      continue;
    }
    // A backslash escape is literal: `\<!--` opens nothing, `\`` no span.
    if (line[i] === "\\" && i + 1 < line.length) {
      kept += line.slice(i, i + 2);
      i += 2;
      continue;
    }
    // "<!-->" and "<!--->" are whole (empty) comments, as in CommonMark.
    const empty = /^<!---?>/.exec(line.slice(i));
    if (empty) {
      i += empty[0].length;
      continue;
    }
    if (line.startsWith("<!--", i)) {
      inside = true;
      i += 4;
      continue;
    }
    kept += line[i];
    i++;
  }
  return [kept, inside];
}

/** The contents of a line's inline code spans: "`abc` or ``a`b``" → abc, a`b. */
function codeSpans(line: string): string[] {
  return [...line.matchAll(/(`+)(?!`)(.+?)(?<!`)\1(?!`)/g)].map((m) =>
    m[2].trim() === "" ? m[2] : m[2].replace(/^ (.*) $/, "$1"),
  );
}

/**
 * A line, plus each "[00 0f …]" in it as a hex-run line fenced by breaks. A
 * blank line is a paragraph break, so it ends a hex run too: in markdown a
 * value is printed in one paragraph, one code block or one cell.
 */
function withBytes(text: string): MdLine {
  if (text.trim() === "") return BREAK();
  const hex: string[] = [];
  for (const m of text.matchAll(BYTE_LIST_RE)) {
    hex.push(m[1].replace(/[ ,]+/g, " "), "--");
  }
  return { text, hex };
}

/**
 * Remove the BCP 14 key-words sentence from each paragraph it is in, and
 * nothing else of that paragraph: the lines stay, minus the sentence's text.
 */
function dropBoilerplate(lines: MdLine[]): MdLine[] {
  let start = 0;
  for (let i = 0; i <= lines.length; i++) {
    const end =
      i === lines.length || lines[i].text.trim() === "" || lines[i].heading;
    if (!end) continue;
    const para = lines.slice(start, i).map((l) => l.text);
    start = i + 1;
    if (para.length === 0) continue;
    const kept = para
      .join("\n")
      .replace(BCP14_RE, (m) => m.replace(/[^\n]/g, ""))
      .split("\n");
    kept.forEach((text, j) => {
      const at = i - para.length + j;
      if (text === para[j]) return;
      // A table cell's own hex break stays, so the cell still ends its run.
      const next = { ...withBytes(text), spans: lines[at].spans };
      if (lines[at].hex.at(-1) === "--" && next.hex.at(-1) !== "--")
        next.hex.push("--");
      lines[at] = next;
    });
  }
  return lines;
}

/** Read a markdown spec whose sections are numbered headings. */
export function parseMarkdownSpec(text: string): RfcDocument {
  const lines = readLines(text);
  const sections = new Map<string, RfcSection>();
  const owned = new Array<boolean>(lines.length).fill(false);
  const take = (from: number, to: number) => lines.slice(from, to);
  lines.forEach((l, at) => {
    const h = l.heading;
    if (!h || h.id === null) return;
    // A second "## 3." would leave its text in no section, so it is refused.
    if (sections.has(h.id)) {
      throw new Error(`section ${h.id} has two headings`);
    }
    let end = lines.length;
    let ownEnd = lines.length;
    for (let j = at + 1; j < lines.length; j++) {
      const n = lines[j].heading;
      if (!n) continue;
      if (ownEnd === lines.length && (n.id !== null || n.level <= h.level)) {
        ownEnd = j;
      }
      if (n.level <= h.level) {
        end = j;
        break;
      }
    }
    for (let j = at; j < ownEnd; j++) owned[j] = true;
    const all = take(at, end);
    sections.set(h.id, {
      id: h.id,
      title: h.title,
      lines: all.map((x) => x.text),
      ownLines: take(at, ownEnd).map((x) => x.text),
      hexLines: all.flatMap((x) => [x.text, ...x.hex]),
      proseLines: all.map((x) => (x.quoted ? "" : x.text)),
      codeLines: all.map((x) => x.code ?? null),
      spanLines: all.map((x) => x.spans ?? []),
    });
  });
  const looseLines = lines.filter((_, i) => !owned[i]).map((x) => x.text);
  return {
    number: null,
    sections,
    loose: {
      id: LOOSE_SECTION,
      title: "text outside every numbered section",
      lines: looseLines,
      ownLines: looseLines,
    },
    source: text.replace(/\r\n?/g, "\n").split("\n"),
  };
}

// ── The Interface section: a spec's own signatures ─────────────────────────

/** One parameter of a signature, as the spec prints it. */
export interface InterfaceParam {
  name: string;
  type: string;
}

/** A function the spec's Interface section declares. */
export interface InterfaceSignature {
  name: string;
  params: InterfaceParam[];
  returns: string;
}

/** The spec's Interface section and the signatures it declares. */
export interface SpecInterface {
  section: string;
  signatures: InterfaceSignature[];
}

const INTERFACE_TITLE_RE = /^interfaces?$/i;
// Exactly one signature and nothing after it but a `;`: `export const f =
// (a: T): R` or `export function f(a: T): R`. No body: a sketch of the
// function is no part of its signature, and a body is where a second
// declaration hides. The types are checked against INTERFACE_TYPES after
// the match, so a note, a brace or a comma is never read as part of one.
const CONST_SIG_RE =
  /^export\s+const\s+([A-Za-z][A-Za-z0-9]*)\s*=\s*\(([^()]*)\)\s*:\s*([^=;{}()]+?)\s*;?$/;
const FUNCTION_SIG_RE =
  /^export\s+function\s+([A-Za-z][A-Za-z0-9]*)\s*\(([^()]*)\)\s*:\s*([^=;{}()]+?)\s*;?$/;
const PARAM_RE = /^([A-Za-z][A-Za-z0-9]*)\s*:\s*(.+)$/;
/**
 * The types a signature may use: the ones a contract can declare. The same
 * list as NISH_TYPES in gates.ts, which the signature gate reads a module by.
 */
export const INTERFACE_TYPES: readonly string[] = [
  "u8[]",
  "u8[] | null",
  "null | u8[]",
  "string",
  "string | null",
  "null | string",
  "i32",
  "u32",
  "boolean",
];
// The word `export`, in any letter case.
/**
 * How many times a spec says `export` as a reader of the rendered page could
 * see it, read several ways and the largest count kept: once with only entities
 * decoded and markup and invisible characters dropped, once with HTML
 * comments, tags and link targets dropped too (a renderer shows text such as
 * `a < b` that only looks like a tag). Any non-ASCII letter stands for
 * whatever ASCII letter it looks like.
 */
export function exportWordCount(raw: string): number {
  const decoded = raw
    .replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(Number(d) % 0x110000))
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) =>
      String.fromCodePoint(Number.parseInt(h, 16) % 0x110000),
    )
    .replace(/[\p{Cf}\p{M}]/gu, "");
  const stripped = decoded
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<[^>]*>?/g, "")
    .replace(/\]\([^)]*\)?/g, "");
  // And once more each way with every non-letter but whitespace dropped, so
  // no reference link (`[ex][1]port`) or other syntax splits the word.
  const lettersOnly = (t: string) => t.replace(/[^\p{L}\s]/gu, "");
  return Math.max(
    ...[decoded, stripped, lettersOnly(decoded), lettersOnly(stripped)].map(
      exportWords,
    ),
  );
}

function exportWords(text: string): number {
  let n = 0;
  for (const word of text.replace(/[[\]*_~\\`]/g, "").match(/\p{L}+/gu) ?? []) {
    const ascii = /^[A-Za-z]+$/.test(word);
    if (ascii ? /^export$/i.test(word) : lookalike(word, "export")) n++;
  }
  return n;
}

/** Whether `word` reads as `target` when each non-ASCII letter may be any letter. */
function lookalike(word: string, target: string): boolean {
  const chars = [...word];
  return (
    chars.length === target.length &&
    chars.every(
      (c, i) => !/^[A-Za-z]$/.test(c) || c.toLowerCase() === target[i],
    )
  );
}

const EXPORT_WORD_RE = /\bexport\b/gi;
// What markdown can wrap a word in (emphasis, strike-through, an escape), so
// `_export_` or `ex**port**` outside code is still seen as the word.
const MARKUP_RE = /[*_~\\]/g;

/** A type as the spec prints it, spaced the way INTERFACE_TYPES is. */
function canonicalType(t: string): string {
  return t
    .trim()
    .replace(/\s*\[\s*\]/g, "[]")
    .replace(/\s*\|\s*/g, " | ")
    .replace(/\s+/g, " ");
}

/**
 * The signatures the spec's Interface section declares (a numbered section
 * titled "Interface"), so a contract can be extracted from the spec alone.
 *
 * Signatures are read only from code — a fenced block, or an indented code
 * block — where the text is exactly as written: markdown never rewrites it
 * (no table cells, emphasis or inline code to split or strip). A code line
 * without the word `export` is skipped (a usage example, a comment). A code
 * line with it must be exactly one signature: `export const f = (a: T): R`
 * or `export function f(a: T): R`, then nothing but an optional `;` and an
 * optional trailing `// comment`. Every parameter is `name: T`, named once,
 * and every T is one of INTERFACE_TYPES.
 *
 * Anything else fails closed and refuses the spec: the word `export` in any
 * letter case anywhere outside code in the section (prose, a list, a table, a
 * blockquote, inline code, emphasis), `export` that does not start its code
 * line or is not lowercase, a second `export` on the line, a body (`=> …` or
 * `{ …`), a `/* … *\/` comment, another kind of export, an unknown type, no
 * Interface section, more than one, a name declared twice, and none
 * declared. Throws, naming the line, so the caller refuses the spec.
 */
export function interfaceSignatures(doc: RfcDocument): SpecInterface {
  const found = [...doc.sections.values()].filter((s) =>
    INTERFACE_TITLE_RE.test(s.title.trim()),
  );
  if (found.length === 0) {
    throw new Error(
      'the spec has no Interface section (a numbered heading such as "## 2. Interface") to take signatures from',
    );
  }
  if (found.length > 1) {
    throw new Error(
      `the spec has ${found.length} Interface sections (§${found.map((s) => s.id).join(", §")}); signatures must come from exactly one`,
    );
  }
  const sec = found[0];
  if (!sec.codeLines) {
    throw new Error(
      `Interface §${sec.id}: signatures are read from a markdown spec's code blocks, and this spec is not markdown`,
    );
  }
  const signatures: InterfaceSignature[] = [];
  // The section's first line is its heading.
  for (let i = 1; i < sec.lines.length; i++) {
    const code = sec.codeLines[i];
    const shown = JSON.stringify((code ?? sec.lines[i]).trim());
    const refuse = (why: string): Error =>
      new Error(`Interface §${sec.id}: ${why}: ${shown}`);
    if (code === null) {
      if (sec.lines[i].replace(MARKUP_RE, "").match(EXPORT_WORD_RE)) {
        throw refuse(
          "a signature must be in a code block (indented, or fenced with ``` or ~~~), and `export` may not appear outside one in the Interface section, not even in prose",
        );
      }
      continue;
    }
    const words = code.match(EXPORT_WORD_RE)?.length ?? 0;
    let line = code.trim();
    // Code holds signatures and comments only: any other line could carry
    // on a signature's type (`| null` on the next line) or hide one.
    if (words === 0) {
      if (line === "" || line.startsWith("//")) continue;
      throw refuse(
        "the Interface section's code holds only signatures and `//` comments (put a usage example in another section)",
      );
    }
    const beforeComment = line.replace(/\/\/.*$/, "");
    if (/[^\x20-\x7e\t]/.test(beforeComment)) {
      throw refuse("a signature is written in ASCII only");
    }
    if (!/^export\b/i.test(line)) {
      throw refuse(
        "in the Interface section's code, `export` may only begin a signature",
      );
    }
    if (!/^export\b/.test(line)) {
      throw refuse("`export` must be written in lowercase");
    }
    if (words > 1) {
      throw refuse("one signature per line; this line says `export` twice");
    }
    if (line.includes("/*")) {
      throw refuse("cannot read this signature, a comment is inside it");
    }
    // A line comment after the signature is the spec's note, not its type.
    line = line.replace(/\s*\/\/.*$/, "");
    const m = line.match(CONST_SIG_RE) ?? line.match(FUNCTION_SIG_RE);
    if (!m) {
      throw refuse(
        /^export\s+(?:const|function)\b/.test(line)
          ? "cannot read this signature (exactly `export const f = (a: T): R` or `export function f(a: T): R`, followed by nothing but `;` and a `// comment`: no body)"
          : "cannot read this signature, the Interface section declares only functions (`export const` or `export function`)",
      );
    }
    const typeOf = (t: string, what: string): string => {
      const c = canonicalType(t);
      if (!INTERFACE_TYPES.includes(c)) {
        throw refuse(
          `${what} has type ${JSON.stringify(t.trim())}, not one a contract can declare (${INTERFACE_TYPES.join(", ")})`,
        );
      }
      return c;
    };
    const name = m[1];
    const params: InterfaceParam[] = [];
    if (m[2].trim() !== "") {
      for (const p of m[2].split(",")) {
        const pm = p.trim().match(PARAM_RE);
        if (!pm)
          throw refuse(
            `cannot read parameter ${JSON.stringify(p.trim())} of ${name}`,
          );
        const [, pname, ptype] = pm;
        if (params.some((q) => q.name === pname)) {
          throw refuse(`${name} names parameter ${pname} twice`);
        }
        params.push({
          name: pname,
          type: typeOf(ptype, `parameter ${pname} of ${name}`),
        });
      }
    }
    const returns = typeOf(m[3], `the return of ${name}`);
    if (signatures.some((s) => s.name === name)) {
      throw refuse(`${name} is declared twice`);
    }
    signatures.push({ name, params, returns });
  }
  if (signatures.length === 0) {
    throw new Error(
      `Interface §${sec.id} declares no signature (a code line such as "export const f = (x: u8[]): string")`,
    );
  }
  // Anywhere in the spec, the word `export` is a signature that was read, or
  // the spec is refused: a line the reader took for a comment, a heading's
  // end, boilerplate or prose may render as code a person reads as an export.
  const read = new Map<string, number>();
  for (const code of sec.codeLines) {
    if (code !== null && /\bexport\b/i.test(code)) {
      read.set(code, (read.get(code) ?? 0) + 1);
    }
  }
  doc.source?.forEach((raw, n) => {
    const words = exportWordCount(raw);
    if (words === 0) return;
    const left = read.get(raw) ?? 0;
    if (words === 1 && left > 0) {
      read.set(raw, left - 1);
      return;
    }
    throw new Error(
      `line ${n + 1}: the word \`export\` may appear in a spec only to begin a signature in the Interface section's code, one per line, and this line was not read as one: ${JSON.stringify(raw.trim())}`,
    );
  });
  // An HTML comment or tag may span lines (`ex<!--⏎-->port`), so the spec
  // is also counted whole.
  const whole = doc.source ? exportWordCount(doc.source.join("\n")) : 0;
  if (whole > signatures.length) {
    throw new Error(
      `the spec says \`export\` ${whole} times as a rendered page could show it, but declares ${signatures.length} signature(s): the word may appear in a spec only to begin a signature in the Interface section's code`,
    );
  }
  return { section: sec.id, signatures };
}

/**
 * The signatures as `export const` declarations, the form the signature gate
 * reads from a module: in spec-only extraction the spec stands in for the
 * module, so the contract's functions are checked against what it declares.
 */
export function interfaceDeclarations(iface: SpecInterface): string {
  return iface.signatures
    .map(
      (s) =>
        `export const ${s.name} = (${s.params.map((p) => `${p.name}: ${p.type}`).join(", ")}): ${s.returns} => _`,
    )
    .join("\n");
}
