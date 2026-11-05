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
//   other headings     end nothing but their own heading line; an unnumbered
//                      `##` heading at a section's level ends it, and the text
//                      under it belongs to no section (see `loose`).
//   fenced code        ``` or ~~~ fences (a ``` fence's info string has no
//                      backtick; the closing fence is bare and at least as
//                      long as the opening one): the fence lines are dropped, the
//                      lines inside are kept verbatim (a `#` there is not a
//                      heading), so a quote or hex value in code is found and a
//                      MUST in code still has to be accounted for.
//   indented code      kept verbatim, like any other line.
//   inline code        the backticks are dropped: "`hexEncode`" reads as
//                      "hexEncode" in quotes, strings and hex runs.
//   tables             each cell becomes a line of its own (the delimiter row
//                      is dropped), and every cell ends a hex run, so a cell is
//                      never glued to its neighbour in a quote or a hex run.
//   HTML comments      `<!-- … -->` is dropped, headings inside it included.
//   byte lists         "[00 0f f0 ff]" anywhere in a line is also read as hex,
//                      a run of its own (only for hex runs, not for quotes).
//   BCP 14 boilerplate the sentence from "The key words …" to the BCP 14 or
//                      RFC 2119 reference and on to its full stop names the
//                      keywords without using them, so that sentence alone is
//                      removed: it is neither quotable nor normative. The rest
//                      of its paragraph stays, so a MUST beside it still counts,
//                      and a tail after the reference that names a keyword
//                      itself ends the removal there.
//   anything else      emphasis, links and lists are kept as written, so a
//                      quote copies them verbatim (`**MUST**` stays starred).

import { type RfcDocument, type RfcSection, parseRfc } from "./rfctext.ts";

export type SpecFormat = "rfc" | "markdown";

const MD_HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const NUMBERED_RE = /^(\d+(?:\.\d+)*|[A-Z](?:\.\d+)*)\.[ \t]+(\S.*)$/;
const MD_APPENDIX_RE = /^Appendix ([A-Z])\.[ \t]+(\S.*)$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const TABLE_DELIM_RE = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const BYTE_LIST_RE = /\[((?:[0-9a-fA-F]{2})(?:[ ,]+[0-9a-fA-F]{2})*)\]/g;
const KEYWORD = "(?:MUST|SHALL|SHOULD|REQUIRED|RECOMMENDED|MAY|OPTIONAL)";
/**
 * The BCP 14 key-words sentence, whatever its verb phrase ("interpreted as
 * described in", "as in"): "key words", then a BCP 14 / RFC 2119 reference,
 * then up to its full stop, stopping early at a keyword after the reference.
 */
const BCP14_RE = new RegExp(
  `\\b(?:[Tt]he\\s+)?[Kk]ey\\s+words\\b[^.]*?\\b(?:BCP\\s*14|RFC\\s*2119)\\b(?:(?!\\b${KEYWORD}\\b)[^.])*\\.?`,
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

function readLines(text: string): MdLine[] {
  const raw = text.replace(/\r\n?/g, "\n").split("\n");
  const out: MdLine[] = [];
  let fence: string | null = null;
  let comment = false;
  for (const rawLine of raw) {
    if (fence !== null) {
      const f = rawLine.match(FENCE_RE);
      if (
        f &&
        f[1][0] === fence[0] &&
        f[1].length >= fence.length &&
        f[2].trim() === ""
      ) {
        fence = null;
        out.push({ text: "", hex: [] });
      } else out.push({ text: rawLine, hex: [] });
      continue;
    }
    const [line, open] = stripComments(rawLine, comment);
    comment = open;
    const f = line.match(FENCE_RE);
    if (f && !(f[1][0] === "`" && f[2].includes("`"))) {
      fence = f[1];
      out.push({ text: "", hex: [] });
      continue;
    }
    const inline = line.replace(/`/g, "");
    const h = inline.match(MD_HEADING_RE);
    if (h) {
      const n = h[2].match(NUMBERED_RE) ?? h[2].match(MD_APPENDIX_RE);
      out.push({
        text: h[2],
        hex: [],
        heading: {
          level: h[1].length,
          id: n ? n[1] : null,
          title: (n ? n[2] : h[2]).trim(),
        },
      });
      continue;
    }
    if (/^\s*\|/.test(inline)) {
      if (TABLE_DELIM_RE.test(inline)) continue;
      // Every cell ends a hex run ("--" is never hex), so two cells or two
      // rows are never read as one value.
      for (const cell of cells(inline)) {
        const l = withBytes(cell);
        l.hex.push("--");
        out.push(l);
      }
      continue;
    }
    out.push(withBytes(inline));
  }
  return dropBoilerplate(out);
}

/** The line without its HTML comments; whether a comment is still open after it. */
function stripComments(line: string, open: boolean): [string, boolean] {
  let kept = "";
  let rest = line;
  let inside = open;
  for (;;) {
    if (inside) {
      const end = rest.indexOf("-->");
      if (end < 0) return [kept, true];
      rest = rest.slice(end + 3);
      inside = false;
    }
    const start = rest.indexOf("<!--");
    if (start < 0) return [kept + rest, false];
    kept += rest.slice(0, start);
    rest = rest.slice(start + 4);
    inside = true;
  }
}

/** A line, plus each "[00 0f …]" in it as a hex-run line fenced by breaks. */
function withBytes(text: string): MdLine {
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
    if (!h || h.id === null || sections.has(h.id)) return;
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
