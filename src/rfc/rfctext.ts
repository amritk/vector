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
   * The lines hex runs are read from, when they differ from `lines` (the XML
   * reader adds each bracketed byte list on a line of its own, and splits a
   * line holding blocks of its own, such as a table cell, at each block).
   */
  hexLines?: string[];
  /**
   * The section prints a bracketed byte list such as "[de ad be ef]" (XML),
   * so its bare digit pairs under no name are bytes on purpose.
   */
  printsByteList?: boolean;
  /**
   * Where each block (a paragraph, a table cell, a code block) starts, as
   * indexes into `hexLines ?? lines`, when the reader knows them (XML): a
   * value never runs across a block boundary.
   */
  blockStarts?: number[];
  /**
   * `lines` with code, table cells and blockquotes blanked out, when the
   * reader knows them (XML); only prose states a vector's result.
   */
  proseLines?: string[];
  /**
   * Per line of `lines`, the line exactly as written when it is code (a
   * `<sourcecode>` or `<artwork>` line), else null. XML only.
   */
  codeLines?: (string | null)[];
  /**
   * Per line of `lines`, its inline code spans (`<tt>abc</tt>`), whose tags
   * the line itself drops: each is a value printed whole. XML only.
   */
  spanLines?: string[][];
}

export interface RfcDocument {
  number: number | null;
  sections: Map<string, RfcSection>;
  /**
   * Text outside every numbered section (unnumbered sections, such as a
   * kramdown-rfc spec's unnumbered headings). Its normative sentences cannot
   * be cited, so the completeness gate refuses any it holds.
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
/**
 * Per line of `sectionLines`, the inline code spans printed on it (XML;
 * none for an RFC), normalized like the line.
 */
export function sectionSpans(sec: RfcSection): string[][] {
  return sec.lines.flatMap((l, i) =>
    normalizeText(l) === ""
      ? []
      : [(sec.spanLines?.[i] ?? []).map((v) => normalizeText(v))],
  );
}

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
// The name of a number printed in base 10 ("Input scalar as a number (base
// 10)", RFC 7748 §5.2), whose digits are not bytes.
const DECIMAL_LABEL_RE = /\b(?:decimal|base[ -]?10|number|integer)\b/i;
// "Key =          0b0b0b0b…", "Data: 4869205468657265": a value printed after
// its label on the same line (RFC 4231), whose run the next lines go on.
// RFC 4231 §4.4 drops the "=" ("Key            aaaa…"), so a gap of two or
// more spaces separates them too.
const LABELLED_RE =
  /^\s*(?:o\s+)?([A-Za-z][^:=]{0,79}?)(?:\s*[:=]\s*|\s{2,})((?:[0-9a-fA-F]{2})+(?:\s+(?:[0-9a-fA-F]{2})+)*)\s*$/;
const COLON_RUN_RE =
  /(?<![0-9A-Za-z:])[0-9a-fA-F]{1,2}(?::[0-9a-fA-F]{1,2})+:?(?![0-9A-Za-z])/g;
// An aside that is not itself a value: "(32 octets)", "(sender id=7)".
const ASIDE_RE = /\s+\(([^()]*)\)\s*$/;

/** One value printed in hex, and the name it is printed under, if any. */
export interface HexValue {
  hex: string;
  /**
   * "Key" for "Key = 00:01:…", "IKM" for "IKM = 0x0b…", "Ciphertext" for a
   * dump under a "Ciphertext:" line; null when nothing names it.
   */
  label: string | null;
}

// A line that names the value printed below it: "Ciphertext:", "  AAD:",
// "Plaintext::", or a short heading-like line with no colon ("The ChaCha20
// Key", RFC 8439 A.5) that does not end a sentence.
const LABEL_LINE_RE = /^\s*(?:o\s+)?([^\s:=][^:=]{0,79}?)\s*[:=]+\s*$/;
// Never a line holding brackets or quotes: in a spec that is the
// line a byte list ("hexEncode([00 0f])") was read from, not its name.
const SHORT_LABEL_RE = /^\s*([A-Za-z][^:=()[\]"'`]{0,39}?)\s*$/;
const labelLine = (line: string): string | null => {
  const named = LABEL_LINE_RE.exec(line);
  if (named) return labelBefore(named[1]) || null;
  const short = SHORT_LABEL_RE.exec(line);
  return short && !/[.,;!?]$/.test(short[1]) ? normalizeText(short[1]) : null;
};

/** "o  Key = (" → "Key"; "" when nothing is left. */
const labelBefore = (text: string): string =>
  normalizeText(
    text
      .replace(/^\s*o\s+/, "")
      .replace(/[\s(=:]+$/, "")
      .replace(/^[\s:;,.)]+/, ""),
  );

/**
 * The values printed in hex in a section, each with the label it is printed
 * under. A value is consecutive hex-bearing lines (blank lines do not end
 * one, so a dump survives a page break); any other text line ends it, and a
 * labelled value ("0x…", "Key = 00:01:…") starts a new one, so two labelled
 * values are never glued together; so does a label printed on the value's
 * own first line ("Key =  0b0b…"), whose run the lines below continue.
 * Lines of bare digit pairs with no hex letter and no 0x or colons are a
 * decimal number, not bytes, and are left out, unless printed under a name
 * that does not call them a number, or, in a section printing a byte list,
 * under no name ("Data:" over "4869205468657265" is hex; "Input scalar as a
 * number (base 10):" over "31029842492115040904…" is not). A value never runs
 * across a block boundary (`blockStarts`).
 */
export function hexValues(sec: RfcSection): HexValue[] {
  const values: HexValue[] = [];
  // A section printing a byte list prints bytes on purpose: there only a
  // name calling them a number makes digits decimal.
  const onPurpose = sec.printsByteList === true;
  const blockStarts = new Set(sec.blockStarts);
  let cur = "";
  let label: string | null = null;
  // Every line of the current value was bare digit pairs.
  let bareOnly = true;
  // The last text line, when it names what comes below it.
  let pending: string | null = null;
  // The previous line ended inside a colon run, which this line may continue.
  let colonOpen = false;
  const flush = () => {
    const decimal =
      bareOnly &&
      /^[0-9]+$/.test(cur) &&
      ((label === null && !onPurpose) ||
        (label !== null && DECIMAL_LABEL_RE.test(label)));
    if (cur && !decimal) values.push({ hex: cur, label });
    cur = "";
    label = null;
    bareOnly = true;
    colonOpen = false;
  };
  const start = (name: string | null, bare: boolean) => {
    if (cur === "") {
      label = name !== null && name !== "" ? name : pending;
      bareOnly = bare;
      pending = null;
    } else if (!bare) bareOnly = false;
  };
  for (const [i, rawLine] of (sec.hexLines ?? sec.lines).entries()) {
    // A block boundary ends a value; the name above it still names the next.
    if (blockStarts.has(i)) flush();
    const aside = rawLine.match(ASIDE_RE);
    const line =
      aside && !/^[0-9a-fA-F:\s]+$/.test(aside[1])
        ? rawLine.slice(0, aside.index)
        : rawLine;
    if (line.trim() === "") continue;
    const dump = line.match(HEXDUMP_RE);
    if (dump) {
      if (colonOpen) flush();
      start(null, false);
      cur += dump[1].replace(/ /g, "").toLowerCase();
      continue;
    }
    const prefixed = [...line.matchAll(PREFIXED_RE)];
    if (prefixed.length > 0) {
      let from = 0;
      for (const m of prefixed) {
        flush();
        const at = m.index ?? 0;
        start(labelBefore(line.slice(from, at)), false);
        cur = m[1].toLowerCase();
        from = at + m[0].length;
      }
      continue;
    }
    const colons = [...line.matchAll(COLON_RUN_RE)];
    if (colons.length > 0) {
      let from = 0;
      colons.forEach((m, i) => {
        const at = m.index ?? 0;
        const before = line.slice(from, at);
        const continues = i === 0 && colonOpen && before.trim() === "";
        if (!continues) {
          flush();
          start(labelBefore(before), false);
        }
        cur += m[0].replace(/:/g, "").toLowerCase();
        from = at + m[0].length;
        const rest = line.slice(from).trim();
        // A run that reaches the end of the line may go on in the next one;
        // anything after it ("1f.  The key is…") ends the value.
        colonOpen = rest === "";
        if (!colonOpen) flush();
      });
      continue;
    }
    const labelled = LABELLED_RE.exec(line);
    if (labelled) {
      flush();
      // Named on its own line, all-digit hex ("Data = 4869205468657265",
      // "Hi There") is still hex: only an unnamed run is taken as decimal.
      start(labelBefore(labelled[1]), false);
      cur = labelled[2].replace(/\s+/g, "").toLowerCase();
      continue;
    }
    const tokens = line.trim().split(/\s+/);
    if (tokens.every((t) => BARE_TOKEN_RE.test(t))) {
      if (colonOpen) flush();
      start(null, true);
      cur += tokens.join("").toLowerCase();
      continue;
    }
    flush();
    pending = labelLine(line);
  }
  flush();
  return values;
}

/** The hex of every value a section prints (see `hexValues`). */
export function hexRuns(sec: RfcSection): string[] {
  return hexValues(sec).map((v) => v.hex);
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
export function intLabelled(
  text: string,
  label: string,
  n: number | string | bigint,
): boolean {
  return intRounds(text, label, n).length > 0;
}

// `label` then some integer; the value's own end is checked by `intValueRe`.
const intLabelRe = (label: string) =>
  new RegExp(
    `(?<![0-9A-Za-z_.-])${escapeRe(normalizeText(label))}(?:[ \\t]*[=:][ \\t]*|[ \\t]+)(?=-?(?:0[xX])?[0-9a-fA-F]*[0-9])`,
    "g",
  );

// `n` in decimal or 0x hex, not running into a longer identifier or number
// (`1,000`, `4-5`, `12:30`, `255/256`, `1.5`, `1 000`).
const intValueRe = (v: number | string | bigint) => {
  const n = BigInt(v);
  const hex = (n < 0n ? -n : n)
    .toString(16)
    .replace(/[a-f]/g, (d) => `[${d}${d.toUpperCase()}]`);
  const value = n < 0n ? `${n}` : `(?:${n}|0[xX]0*${hex})`;
  return new RegExp(`^${value}(?![0-9A-Za-z_]|[.,:/-]\\d|[ \\t]\\d)`);
};

/**
 * At which of `label`'s printings (counting from 0, every `label` followed
 * by some integer) is the integer `n` the value? Empty when none.
 */
export function intRounds(
  text: string,
  label: string,
  n: number | string | bigint,
): number[] {
  const value = intValueRe(n);
  return [...text.matchAll(intLabelRe(label))].flatMap((m, i) =>
    value.test(text.slice((m.index ?? 0) + m[0].length)) ? [i] : [],
  );
}

/** How many times `label` is printed followed by some integer. */
export function intLabelCount(text: string, label: string): number {
  return [...text.matchAll(intLabelRe(label))].length;
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

/**
 * A binding BCP 14 keyword as used, in capitals: the longer "MUST NOT" before
 * "MUST", and not in double quotes (the RFC 2119 boilerplate naming the
 * keywords). The boundaries are letters and digits, not `\b`, so a markdown
 * `_MUST_` or `__MUST NOT__` (where `_` is a word character) is a keyword too.
 */
export const KEYWORD_RE =
  /(?<!")(?<![A-Za-z0-9])(MUST NOT|MUST|SHALL NOT|SHALL|REQUIRED)(?![A-Za-z0-9])(?!")/g;

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
