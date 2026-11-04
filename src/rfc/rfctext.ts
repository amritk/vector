// Reading an RFC's plain-text rendering (rfc-editor.org/rfc/rfcNNNN.txt) well
// enough to answer two questions deterministically:
//
//   1. does this quote appear in section S?      (requirement fidelity)
//   2. are these bytes printed in section S?     (test-vector fidelity)
//
// Neither needs a model. Together they are the gate that stops a contract from
// citing a requirement the RFC does not state, or a test vector it does not
// print: the extractor (an LLM) proposes, the RFC text disposes.

export interface RfcSection {
  /** "2.3", "A.1", "A" (an appendix). */
  id: string;
  title: string;
  /** The section's own lines and its subsections', page furniture removed. */
  lines: string[];
  /** Only the section's own lines, up to its first subsection. */
  ownLines: string[];
  /**
   * The lines hex runs are read from, when they differ from `lines` (the
   * markdown reader adds each bracketed byte list on a line of its own).
   */
  hexLines?: string[];
}

export interface RfcDocument {
  number: number | null;
  sections: Map<string, RfcSection>;
  /**
   * Text outside every numbered section (a markdown spec's unnumbered
   * headings and preamble). Its normative sentences cannot be cited, so the
   * completeness gate refuses any it holds.
   */
  loose?: RfcSection;
}

// A page break in the .txt rendering: a footer line ending "[Page N]", a form
// feed, and a running header "RFC NNNN   Title   Month Year".
const FOOTER_RE = /\[Page \d+\]\s*$/;
const HEADER_RE = /^RFC \d+\s{2,}.*\s{2,}\S+ \d{4}\s*$/;

// Headings start in column 0: "2.3.  Step 2: Expand", "A.1.  Test Case 1",
// "Appendix A.  Test Vectors". The table of contents is indented, so it never
// matches.
const HEADING_RE = /^(\d+(?:\.\d+)*|[A-Z](?:\.\d+)+)\.\s+(\S.*)$/;
const APPENDIX_RE = /^Appendix ([A-Z])\.\s+(\S.*)$/;

export function parseRfc(text: string): RfcDocument {
  const raw = text.replace(/\r\n?/g, "\n").split("\n");
  const lines = raw
    .map((l) => l.replace(/\f/g, ""))
    .filter((l) => !FOOTER_RE.test(l) && !HEADER_RE.test(l));

  const numMatch = text.match(/Request for Comments:\s*(\d+)/);
  const headings: { id: string; title: string; at: number }[] = [];
  lines.forEach((l, at) => {
    const h = l.match(HEADING_RE) ?? l.match(APPENDIX_RE);
    if (h) headings.push({ id: h[1], title: h[2].trim(), at });
  });

  const sections = new Map<string, RfcSection>();
  headings.forEach((h, i) => {
    // A section runs until the next heading that is not one of its own
    // subsections, so "2.3" includes "2.3.1".
    let end = lines.length;
    for (let j = i + 1; j < headings.length; j++) {
      if (!headings[j].id.startsWith(`${h.id}.`)) {
        end = headings[j].at;
        break;
      }
    }
    const ownEnd = i + 1 < headings.length ? headings[i + 1].at : lines.length;
    if (!sections.has(h.id)) {
      sections.set(h.id, {
        id: h.id,
        title: h.title,
        lines: lines.slice(h.at, end),
        ownLines: lines.slice(h.at, ownEnd),
      });
    }
  });
  return { number: numMatch ? Number(numMatch[1]) : null, sections };
}

/** Collapse whitespace so a quote matches across the RFC's line wrapping. */
export const normalizeText = (s: string): string =>
  s.replace(/\s+/g, " ").trim();

export function sectionText(sec: RfcSection): string {
  return normalizeText(sec.lines.join("\n"));
}

/** The section's lines, each whitespace-collapsed, still one per line. */
export function sectionLines(sec: RfcSection): string {
  return sec.lines
    .map((l) => normalizeText(l))
    .filter((l) => l !== "")
    .join("\n");
}

// Hex as RFCs print it, in five shapes:
//   hexdump      "016  65 6d 65 6e 20 6f 66  ...  emen of the clas" (RFC 8439)
//   prefixed     "IKM  = 0x0b0b0b0b0b0b"                            (RFC 5869)
//   bare         "      101112131415161718191a1b1c1d1e1f"            (continuations)
//   colons       "1a:e1:0b:59:4f:09:e2:6a:"                         (RFC 8439)
//   inline       "o  Key = 00:01:02:...:12:13:" continued on the next line,
//                even mid-byte ("...:01:0" then "3:80:..."), and in parens
//                ("Nonce = (00:00:00:09:...)")
const HEXDUMP_RE =
  /^\s*[0-9a-fA-F]{3,4}\s+((?:[0-9a-fA-F]{2} )*[0-9a-fA-F]{2})(?:\s{2,}.*)?$/;
const PREFIXED_RE = /0x([0-9a-fA-F]+)/g;
const BARE_TOKEN_RE = /^(?:[0-9a-fA-F]{2})+$/;
const COLON_RUN_RE =
  /(?<![0-9A-Za-z:])[0-9a-fA-F]{1,2}(?::[0-9a-fA-F]{1,2})+:?(?![0-9A-Za-z])/g;
// An aside that is not itself a value: "(32 octets)", "(sender id=7)".
const ASIDE_RE = /\s+\(([^()]*)\)\s*$/;

/**
 * The runs of hex printed in a section. A run is consecutive hex-bearing lines
 * (blank lines do not end one, so a dump survives a page break); any other text
 * line ends it, and a labelled value ("0x…", "Key = 00:01:…") starts a new one,
 * so two labelled values are never glued together.
 */
export function hexRuns(sec: RfcSection): string[] {
  const runs: string[] = [];
  let cur = "";
  // The previous line ended inside a colon run, which this line may continue.
  let colonOpen = false;
  const flush = () => {
    if (cur) runs.push(cur);
    cur = "";
    colonOpen = false;
  };
  for (const rawLine of sec.hexLines ?? sec.lines) {
    const aside = rawLine.match(ASIDE_RE);
    const line =
      aside && !/^[0-9a-fA-F:\s]+$/.test(aside[1])
        ? rawLine.slice(0, aside.index)
        : rawLine;
    if (line.trim() === "") continue;
    const dump = line.match(HEXDUMP_RE);
    if (dump) {
      if (colonOpen) flush();
      cur += dump[1].replace(/ /g, "").toLowerCase();
      continue;
    }
    const prefixed = [...line.matchAll(PREFIXED_RE)];
    if (prefixed.length > 0) {
      for (const m of prefixed) {
        flush();
        cur = m[1].toLowerCase();
      }
      continue;
    }
    const colons = [...line.matchAll(COLON_RUN_RE)];
    if (colons.length > 0) {
      colons.forEach((m, i) => {
        const at = m.index ?? 0;
        const continues =
          i === 0 && colonOpen && line.slice(0, at).trim() === "";
        if (!continues) flush();
        cur += m[0].replace(/:/g, "").toLowerCase();
        const rest = line.slice(at + m[0].length).trim();
        // A run that reaches the end of the line may go on in the next one;
        // anything after it ("1f.  The key is…") ends the value.
        colonOpen = rest === "";
        if (!colonOpen) flush();
      });
      continue;
    }
    const tokens = line.trim().split(/\s+/);
    if (tokens.every((t) => BARE_TOKEN_RE.test(t))) {
      if (colonOpen) flush();
      cur += tokens.join("").toLowerCase();
      continue;
    }
    flush();
  }
  flush();
  return runs;
}

/** Does `hex` appear, byte-aligned, inside one of the section's hex runs? */
export function hexPrinted(runs: string[], hex: string): boolean {
  if (hex === "") return true;
  for (const run of runs) {
    let from = 0;
    for (;;) {
      const at = run.indexOf(hex, from);
      if (at < 0) break;
      if (at % 2 === 0) return true;
      from = at + 1;
    }
  }
  return false;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Is the integer printed right after its label — `L = 42`, `Block Count: 1`,
 * `L 42` — in decimal or as 0x hex? A bare number proves nothing (every
 * section prints small integers), so the label pins it to the value it names.
 * Label and value must share a line: pass `sectionLines`, not the collapsed
 * section text, or "…the value of L" and a next line "5. Next" would match.
 */
export function intLabelled(text: string, label: string, n: number): boolean {
  const hex = n
    .toString(16)
    .replace(/[a-f]/g, (d) => `[${d}${d.toUpperCase()}]`);
  const value = n < 0 ? `${n}` : `(?:${n}|0[xX]0*${hex})`;
  // Neither end may run into a longer identifier (`MAX_L`, `T-L`, `x.L`) or
  // a longer number (`1,000`, `4-5`, `12:30`, `255/256`, `1.5`, `1 000`).
  return new RegExp(
    `(?<![0-9A-Za-z_.-])${escapeRe(normalizeText(label))}(?:[ \\t]*[=:][ \\t]*|[ \\t]+)${value}(?![0-9A-Za-z_]|[.,:/-]\\d|[ \\t]\\d)`,
  ).test(text);
}

export function findSection(doc: RfcDocument, id: string): RfcSection | null {
  return doc.sections.get(id) ?? null;
}

export interface NormativeSentence {
  section: string;
  keyword: string;
  /** Offset of the keyword in the section's normalized own text. */
  at: number;
  /** The sentence around it, for messages. */
  sentence: string;
}

// BCP 14 keywords in capitals. A keyword in double quotes is the RFC 2119
// boilerplate naming the keywords, not a requirement.
const KEYWORD_RE = /(?<!")\b(MUST NOT|MUST|SHALL NOT|SHALL|REQUIRED)\b(?!")/g;

/** Every binding BCP 14 keyword in the RFC, with the sentence it sits in. */
export function normativeSentences(doc: RfcDocument): NormativeSentence[] {
  const out: NormativeSentence[] = [];
  const all = doc.loose
    ? [...doc.sections.values(), doc.loose]
    : doc.sections.values();
  for (const sec of all) {
    const text = normalizeText(sec.ownLines.join("\n"));
    for (const m of text.matchAll(KEYWORD_RE)) {
      const at = m.index ?? 0;
      const start = Math.max(text.lastIndexOf(". ", at) + 2, 0);
      const stop = text.indexOf(". ", at);
      const sentence = text.slice(
        start === 1 ? 0 : start,
        stop < 0 ? text.length : stop + 1,
      );
      out.push({ section: sec.id, keyword: m[1], at, sentence });
    }
  }
  return out;
}

/** The [start, end) spans of `quote` in a section's own normalized text. */
export function ownSpans(sec: RfcSection, quote: string): [number, number][] {
  const text = normalizeText(sec.ownLines.join("\n"));
  const q = normalizeText(quote);
  const spans: [number, number][] = [];
  if (!q) return spans;
  for (let at = text.indexOf(q); at >= 0; at = text.indexOf(q, at + 1)) {
    spans.push([at, at + q.length]);
  }
  return spans;
}
