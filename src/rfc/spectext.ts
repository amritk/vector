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
//   indented code      kept verbatim, like any other line; a `<!--` on a line
//                      indented four spaces or a tab is text.
//   inline code        the backticks are dropped: "`hexEncode`" reads as
//                      "hexEncode" in quotes, strings and hex runs. A `<!--`
//                      inside a span is text.
//   tables             each cell becomes a line of its own (the delimiter row
//                      is dropped); every row starts a new hex run and every
//                      cell ends one, so a cell is never glued to its
//                      neighbour, or a row to the line above, in a hex run.
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
  return detectFormat(text) === "rfc"
    ? parseRfc(text)
    : parseMarkdownSpec(text);
}

interface MdLine {
  /** The text the gates read: inline backticks dropped, a table cell. */
  text: string;
  /** Extra hex-run lines this line contributes (its bracketed byte lists). */
  hex: string[];
  heading?: { level: number; id: string | null; title: string };
}

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
  for (let n = 0; n < raw.length; n++) {
    const rawLine = raw[n];
    if (fence !== null) {
      const f = rawLine.match(FENCE_RE);
      if (
        f &&
        f[1][0] === fence.mark[0] &&
        f[1].length >= fence.mark.length &&
        f[2].trim() === ""
      ) {
        fence = null;
        out.push(BREAK());
      } else out.push(withBytes(rawLine));
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
      continue;
    }
    if (/^\s*\|/.test(inline)) {
      if (TABLE_DELIM_RE.test(inline)) continue;
      // Every cell ends a hex run ("--" is never hex), and so does the start
      // of a row, so two cells, two rows, or a row and the line above it are
      // never read as one value.
      out.push(BREAK());
      for (const cell of cells(inline)) {
        const l = withBytes(cell);
        l.hex.push("--");
        out.push(l);
      }
      continue;
    }
    out.push(withBytes(inline));
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
      if (text !== para[j]) lines[i - para.length + j] = withBytes(text);
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
  };
}
