// Reading an RFC in its XML v3 source form (RFC 7991), as xml2rfc renders it
// and as kramdown-rfc writes it, into the RfcDocument the gates already read
// from the .txt rendering and from markdown. No dependency and no network:
// the tokenizer below is the whole XML reader.
//
// The document is untrusted input, so the reader is narrow on purpose:
//
//   - A DOCTYPE may carry no external identifier, and its internal subset may
//     hold nothing but general entities whose value is one numeric character
//     reference (`<!ENTITY nbsp "&#160;">`), the set xml2rfc's templates and
//     kramdown-rfc declare. External and parameter entities, any other
//     declaration, and a reference to an entity nobody declared are refused.
//   - An `xi:include` with a non-empty href is refused: nothing is fetched.
//     Expand references first (kramdown-rfc with `v: 3`, or `xml2rfc --expand`).
//   - Input over MAX_INPUT_BYTES and elements nested over MAX_DEPTH deep are
//     refused before they can cost anything.
//   - A character XML does not allow (U+0000-U+0008, U+000B, U+000C,
//     U+000E-U+001F, U+FFFE, U+FFFF, a lone surrogate) is refused wherever it
//     stands, raw or as a reference: in text, CDATA, an attribute, a comment
//     or a processing instruction.
//   - What the reader derives is bounded too: the xref text it works out for
//     source the preptool has not seen (MAX_XREF_TEXT past the input's own
//     length), and the lines numbered sections hold, a section holding its
//     subsections' lines as well (MAX_SECTION_LINES).
//
// Every refusal is an XmlRefusal naming the file and the XML line.
//
// Lines. Each node's Loc has its XML line and, after a `<?line N?>`
// processing instruction (kramdown-rfc writes one at the start of each
// `--- middle`/`--- back` part, N being the markdown line of that marker),
// the markdown line N + (XML lines since that instruction): exact while the
// XML keeps the markdown's line breaks, and the nearest line kramdown-rfc
// recorded otherwise. A signed `<?line -N?>` or `<?line +N?>` is, as in
// kramdown-rfc, a correction to every later unsigned N (it writes one after
// the boilerplate it expands); it moves no line by itself. N has at most 9
// digits. Where the XML runs longer than the markdown (a table, which
// kramdown-rfc writes a line per cell), lines after it read too far on
// until the next `<?line N?>`.
//
// Sections are numbered as xml2rfc numbers them: `<middle>` sections 1, 2,
// 2.1; `<back>` sections A, B, A.1. Every `<section>` takes a place in the
// count (so the numbers equal the pn xml2rfc writes); a numbered="false"
// section and everything under it shows no number, and its text is the
// document's `loose` section, like a markdown spec's unnumbered headings.
// `<references>`, the abstract, notes and boilerplate are not sections here.
//
// The plain-text rule (plainText, and every line of every section):
//
//   - character and entity references are resolved;
//   - inline markup (bcp14, tt, em, strong, sub, sup, u, spanx) is replaced by
//     its text: xml2rfc's `_em_`, `*strong*`, `_sub` and `^sup` decorations
//     are dropped, since no quote should depend on them;
//   - an xref renders as `xml2rfc --text` renders it ("Section 4.3 of
//     [RFC3986]", "[RFC6749]", "OAuth 2.0 (Section 2)"), from its
//     derivedContent; an eref as "text <url>", or "text (url)" with
//     brackets="none"; iref and cref render as nothing; br as a space;
//   - contact and author print their fullname attribute before their text;
//   - U+2011 (non-breaking hyphen) reads as "-", U+200B and U+2060 vanish,
//     and whitespace, U+00A0 included, collapses to single spaces, trimmed
//     (normalizeText).
//
// A block element's text is separated from its neighbours' by a space.

import { LEVELS, type Level } from "./contract.ts";
import { type RfcDocument, type RfcSection, normalizeText } from "./rfctext.ts";
import { LOOSE_SECTION } from "./spectext.ts";

/** Larger input is refused before it is read. */
export const MAX_INPUT_BYTES = 8 * 1024 * 1024;
/** Elements may nest this deep; one more is refused. */
export const MAX_DEPTH = 256;
/**
 * The xref text worked out for xrefs without derivedContent may run this many
 * characters past the input's length; more is refused.
 */
export const MAX_XREF_TEXT = 64 * 1024;
/**
 * Numbered sections may hold this many lines in all, each counting its
 * subsections' lines too; more is refused.
 */
export const MAX_SECTION_LINES = 2_000_000;

export interface Loc {
  xmlLine: number;
  /** From the nearest preceding `<?line N?>`. */
  mdLine?: number;
}
export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: (XmlNode | XmlText)[];
  loc: Loc;
}
export interface XmlText {
  text: string;
  loc: Loc;
}
export interface V3Document extends RfcDocument {
  title: string;
  docName?: string;
  root: XmlNode;
  references: { anchor: string; rfc?: number; loc: Loc }[];
  /** anchor -> computed number, for numbered sections. */
  sectionByAnchor: Map<string, string>;
  normative: {
    section: string;
    level: Level;
    sentence: string;
    loc: Loc;
    anchor?: string;
  }[];
}

export class XmlRefusal extends Error {
  loc: Loc;
  constructor(file: string, loc: Loc, reason: string) {
    super(`${file}:${loc.xmlLine}: ${reason}`);
    this.name = "XmlRefusal";
    this.loc = loc;
  }
}

export const isElement = (n: XmlNode | XmlText): n is XmlNode => "name" in n;

const elements = (n: XmlNode): XmlNode[] => n.children.filter(isElement);

// ---------------------------------------------------------------- tokenizer

const NAME_RE = /[A-Za-z_:][A-Za-z0-9_.:-]*/y;
const REF_RE = /&(?:#([0-9]+)|#x([0-9a-fA-F]+)|([A-Za-z_:][A-Za-z0-9_.:-]*));/y;
const NUMERIC_ENTITY_RE = /^&#(?:([0-9]+)|x([0-9a-fA-F]+));$/;
const LINE_PI_RE = /^line\s+([+-]?)([0-9]+)\s*$/;
// XML 1.0's Char production: what a character reference may name.
const xmlChar = (c: number): boolean =>
  c === 0x9 ||
  c === 0xa ||
  c === 0xd ||
  (c >= 0x20 && c <= 0xd7ff) ||
  (c >= 0xe000 && c <= 0xfffd) ||
  (c >= 0x10000 && c <= 0x10ffff);

class Reader {
  private pos = 0;
  private readonly lineStarts: number[] = [0];
  private linePi: { n: number; xmlLine: number } | null = null;
  // The sum of the signed `<?line ±N?>` met so far.
  private lineCorrection = 0;
  private readonly entities = new Map([
    ["amp", "&"],
    ["lt", "<"],
    ["gt", ">"],
    ["quot", '"'],
    ["apos", "'"],
  ]);

  constructor(
    private readonly src: string,
    private readonly file: string,
  ) {
    for (let i = src.indexOf("\n"); i >= 0; i = src.indexOf("\n", i + 1)) {
      this.lineStarts.push(i + 1);
    }
    // XML 1.0's Char production, raw: whatever text, CDATA, attribute,
    // comment or PI it stands in.
    for (let i = 0; i < src.length; i++) {
      const c = src.charCodeAt(i);
      if (c >= 0x20 && c < 0xd800) continue;
      if (c >= 0xd800 && c <= 0xdbff) {
        const d = src.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) {
          i++;
          continue;
        }
      } else if (c === 0x9 || c === 0xa || c === 0xd) continue;
      else if (c >= 0xe000 && c <= 0xfffd) continue;
      this.fail(
        `U+${c.toString(16).toUpperCase().padStart(4, "0")} is not an XML character`,
        i,
      );
    }
  }

  private line(at: number): number {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid] <= at) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }

  loc(at: number): Loc {
    const xmlLine = this.line(at);
    const pi = this.linePi;
    // A signed <?line -N?> can correct the count below the first line.
    return pi
      ? { xmlLine, mdLine: Math.max(1, pi.n + xmlLine - pi.xmlLine) }
      : { xmlLine };
  }

  fail(reason: string, at = this.pos): never {
    throw new XmlRefusal(this.file, this.loc(at), reason);
  }

  private at(s: string): boolean {
    return this.src.startsWith(s, this.pos);
  }

  private skipWs(): boolean {
    const from = this.pos;
    while (/\s/.test(this.src[this.pos] ?? "")) this.pos++;
    return this.pos > from;
  }

  private expect(s: string, where: string): void {
    if (!this.at(s)) this.fail(`malformed XML: expected "${s}" ${where}`);
    this.pos += s.length;
  }

  private name(where: string): string {
    NAME_RE.lastIndex = this.pos;
    const m = NAME_RE.exec(this.src);
    if (!m) this.fail(`malformed XML: expected a name ${where}`);
    this.pos += m[0].length;
    return m[0];
  }

  /** The text up to `end`, moving past it. */
  private until(end: string, what: string): string {
    const stop = this.src.indexOf(end, this.pos);
    if (stop < 0) this.fail(`malformed XML: unterminated ${what}`);
    const s = this.src.slice(this.pos, stop);
    this.pos = stop + end.length;
    return s;
  }

  private quoted(where: string): string {
    const q = this.src[this.pos];
    if (q !== '"' && q !== "'")
      this.fail(`malformed XML: expected a quoted value ${where}`);
    this.pos++;
    return this.until(q, `value ${where}`);
  }

  /** Resolve the references in character data or an attribute value. */
  private decode(raw: string, from: number): string {
    let out = "";
    let i = 0;
    for (let amp = raw.indexOf("&"); amp >= 0; amp = raw.indexOf("&", i)) {
      out += raw.slice(i, amp);
      REF_RE.lastIndex = amp;
      const m = REF_RE.exec(raw);
      if (!m) {
        this.fail(
          'malformed XML: "&" starts no entity or character reference',
          from + amp,
        );
      }
      if (m[3] !== undefined) {
        const v = this.entities.get(m[3]);
        if (v === undefined)
          this.fail(`undefined entity &${m[3]};`, from + amp);
        out += v;
      } else {
        out += this.char(m[0], m[1], m[2], from + amp);
      }
      i = amp + m[0].length;
    }
    return out + raw.slice(i);
  }

  private char(
    ref: string,
    dec: string | undefined,
    hex: string | undefined,
    at: number,
  ): string {
    const c =
      dec !== undefined
        ? Number.parseInt(dec, 10)
        : Number.parseInt(hex ?? "", 16);
    if (!xmlChar(c))
      this.fail(`character reference ${ref} names no XML character`, at);
    return String.fromCodePoint(c);
  }

  document(): XmlNode {
    if (this.src.charCodeAt(0) === 0xfeff) this.pos = 1;
    let root: XmlNode | null = null;
    let doctype = false;
    for (;;) {
      this.skipWs();
      if (this.pos >= this.src.length) break;
      if (this.at("<?")) this.pi();
      else if (this.at("<!--")) this.comment();
      else if (this.at("<!DOCTYPE")) {
        if (doctype || root) {
          this.fail(
            "malformed XML: a DOCTYPE comes once, before the root element",
          );
        }
        this.doctype();
        doctype = true;
      } else if (!root && this.at("<")) root = this.element(0);
      else {
        this.fail(
          root
            ? "malformed XML: content after the root element"
            : "malformed XML: expected the root element",
        );
      }
    }
    if (!root) this.fail("malformed XML: no root element");
    return root;
  }

  private pi(): void {
    const at = this.pos;
    this.pos += 2;
    const m = LINE_PI_RE.exec(this.until("?>", "processing instruction"));
    if (!m) return;
    if (m[2].length > 9)
      this.fail(`<?line ${m[1]}${m[2]}?> names a line past 999999999`, at);
    const n = Number(m[2]);
    if (m[1] === "") {
      this.linePi = { n: n + this.lineCorrection, xmlLine: this.line(at) };
    } else {
      this.lineCorrection += m[1] === "-" ? -n : n;
    }
  }

  private comment(): void {
    this.pos += 4;
    this.until("-->", "comment");
  }

  private doctype(): void {
    const at = this.pos;
    this.pos += "<!DOCTYPE".length;
    this.skipWs();
    this.name("in the DOCTYPE");
    this.skipWs();
    if (this.at("SYSTEM") || this.at("PUBLIC")) {
      this.fail(
        "a DOCTYPE with a SYSTEM or PUBLIC identifier is refused: vector never fetches",
        at,
      );
    }
    if (this.at("[")) {
      this.pos++;
      this.internalSubset();
    }
    this.skipWs();
    this.expect(">", "to end the DOCTYPE");
  }

  private internalSubset(): void {
    for (;;) {
      this.skipWs();
      if (this.pos >= this.src.length)
        this.fail("malformed XML: unterminated DOCTYPE");
      if (this.at("]")) {
        this.pos++;
        return;
      }
      const at = this.pos;
      if (!this.at("<!ENTITY")) {
        this.fail(
          'the DOCTYPE may declare only general entities with a numeric value, such as <!ENTITY nbsp "&#160;">; other markup is refused',
        );
      }
      this.pos += "<!ENTITY".length;
      this.skipWs();
      if (this.at("%"))
        this.fail("a parameter entity (<!ENTITY %) is refused", at);
      const name = this.name("in <!ENTITY");
      this.skipWs();
      if (this.at("SYSTEM") || this.at("PUBLIC")) {
        this.fail(
          `external entity &${name}; is refused: vector never fetches`,
          at,
        );
      }
      const value = this.quoted("in <!ENTITY");
      this.skipWs();
      this.expect(">", "to end <!ENTITY");
      const m = NUMERIC_ENTITY_RE.exec(value);
      if (!m) {
        this.fail(
          `entity &${name}; must be a single numeric character reference such as "&#160;"`,
          at,
        );
      }
      // XML binds the first declaration; the predefined five stay as they are.
      if (!this.entities.has(name))
        this.entities.set(name, this.char(value, m[1], m[2], at));
    }
  }

  private element(depth: number): XmlNode {
    const at = this.pos;
    if (depth >= MAX_DEPTH) {
      this.fail(`elements nest deeper than ${MAX_DEPTH} (MAX_DEPTH)`);
    }
    this.pos++;
    const name = this.name("after <");
    // No prototype, so an attribute named __proto__ or constructor is just
    // an attribute.
    const attrs: Record<string, string> = Object.create(null);
    const node: XmlNode = { name, attrs, children: [], loc: this.loc(at) };
    for (;;) {
      const ws = this.skipWs();
      if (this.at("/>")) {
        this.pos += 2;
        return this.checked(node, at);
      }
      if (this.at(">")) {
        this.pos++;
        break;
      }
      if (!ws)
        this.fail(
          `malformed XML: expected whitespace, ">" or "/>" in <${name}>`,
        );
      const attr = this.name(`in <${name}>`);
      this.skipWs();
      this.expect("=", `after ${attr}`);
      this.skipWs();
      const from = this.pos + 1;
      const raw = this.quoted(`of ${attr}`);
      if (raw.includes("<"))
        this.fail(`malformed XML: "<" in the value of ${attr}`, from);
      if (Object.hasOwn(node.attrs, attr)) {
        this.fail(`malformed XML: duplicate attribute ${attr} on <${name}>`);
      }
      // XML's attribute-value normalization: a literal tab or newline is a
      // space (one written as a character reference stays as written).
      node.attrs[attr] = this.decode(raw.replace(/[\t\n]/g, " "), from);
    }
    this.checked(node, at);

    let text: XmlText | null = null;
    const flush = () => {
      if (text) node.children.push(text);
      text = null;
    };
    for (;;) {
      if (this.pos >= this.src.length)
        this.fail(`malformed XML: <${name}> is never closed`, at);
      if (this.at("</")) {
        flush();
        this.pos += 2;
        const end = this.name("after </");
        this.skipWs();
        this.expect(">", `to end </${end}>`);
        if (end !== name) {
          this.fail(
            `malformed XML: </${end}> closes <${name}> from line ${node.loc.xmlLine}`,
          );
        }
        return node;
      }
      if (this.at("<![CDATA[")) {
        text ??= { text: "", loc: this.loc(this.pos) };
        this.pos += "<![CDATA[".length;
        text.text += this.until("]]>", "CDATA section");
      } else if (this.at("<!--")) {
        flush();
        this.comment();
      } else if (this.at("<?")) {
        flush();
        this.pi();
      } else if (this.at("<!")) {
        this.fail("malformed XML: a declaration inside an element");
      } else if (this.at("<")) {
        flush();
        node.children.push(this.element(depth + 1));
      } else {
        const stop = this.src.indexOf("<", this.pos);
        const end = stop < 0 ? this.src.length : stop;
        text ??= { text: "", loc: this.loc(this.pos) };
        text.text += this.decode(this.src.slice(this.pos, end), this.pos);
        this.pos = end;
      }
    }
  }

  private checked(node: XmlNode, at: number): XmlNode {
    const href = node.attrs.href ?? "";
    if (/(^|:)include$/.test(node.name) && href !== "") {
      this.fail(
        `<${node.name} href="${href}"> is refused: vector never fetches; expand it first (xml2rfc --expand)`,
        at,
      );
    }
    return node;
  }
}

// ---------------------------------------------------------------- plain text

// What parseV3 works out about each xref: its derivedContent (when the
// source has none) and whether its target is a reference, which decides
// xml2rfc's "[RFC1234]" against "Section 2".
const xrefInfo = new WeakMap<
  XmlNode,
  { reftext: string; reference: boolean }
>();

// Elements that are not running text: their text is kept apart from their
// neighbours' by a space.
const BLOCKS = new Set([
  "rfc",
  "front",
  "middle",
  "back",
  "section",
  "name",
  "t",
  "ul",
  "ol",
  "dl",
  "li",
  "dt",
  "dd",
  "blockquote",
  "aside",
  "figure",
  "sourcecode",
  "artwork",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "texttable",
  "ttcol",
  "c",
  "preamble",
  "postamble",
  "references",
  "reference",
  "note",
  "abstract",
  "boilerplate",
  "title",
  "author",
  "address",
  "seriesInfo",
  "date",
]);

// Kept out of the text by sentinels that no XML text can hold (the reader
// refuses U+0001 and U+0002 anywhere in the input, raw or as a reference),
// so a bcp14 keyword's offset in the normalized text can be read off
// afterwards.
const OPEN = "\u0001";
const CLOSE = "\u0002";

interface Render {
  /** The bcp14 elements met, in order; null when they are not tracked. */
  bcp14: XmlNode[] | null;
}

// Whitespace is collapsed once, by the caller (clean), not at each level:
// elements nest up to MAX_DEPTH deep, and each level copying and collapsing
// all the text under it again would cost depth times the input.
function render(n: XmlNode | XmlText, r: Render): string {
  if (!isElement(n)) return n.text;
  const inner = () => n.children.map((c) => render(c, r)).join("");
  switch (n.name) {
    case "iref":
    case "cref":
      return "";
    case "br":
      return " ";
    case "contact":
    case "author":
      // xml2rfc prints the name these carry as an attribute.
      return ` ${n.attrs.fullname ?? ""} ${inner()} `;
    case "xref":
      return renderXref(n, inner().trim());
    case "eref":
      return renderEref(n, inner().trim());
    case "bcp14":
      if (!r.bcp14) return inner();
      r.bcp14.push(n);
      // Trimmed inside the sentinels by normativeIn, once per sentence.
      return OPEN + inner() + CLOSE;
    default:
      return BLOCKS.has(n.name) ? ` ${inner()} ` : inner();
  }
}

// xml2rfc's text writer, render_xref.
function renderXref(x: XmlNode, content: string): string {
  const info = xrefInfo.get(x);
  const reftext = (
    x.attrs.derivedContent ??
    info?.reftext ??
    x.attrs.target ??
    ""
  ).trim();
  const exp = content ? `${content} ` : "";
  const section = x.attrs.section;
  if (section !== undefined) {
    const label = /^[0-9]/.test(section)
      ? "Section"
      : /^[A-Z](\.|$)/.test(section)
        ? "Appendix"
        : "Part";
    switch (x.attrs.sectionFormat ?? "of") {
      case "comma":
        return `${exp}[${reftext}], ${label} ${section}`;
      case "parens":
        return `${exp}[${reftext}] (${label} ${section})`;
      case "bare":
        return content ? `${section} (${content})` : section;
      default:
        return `${label} ${section} of ${exp}[${reftext}]`;
    }
  }
  const format = x.attrs.format ?? "default";
  if (!reftext || format === "none") return content;
  if (content)
    return info?.reference && format !== "title"
      ? `${exp}[${reftext}]`
      : `${exp}(${reftext})`;
  return info?.reference && format !== "title" ? `[${reftext}]` : reftext;
}

function renderEref(e: XmlNode, content: string): string {
  const target = e.attrs.target ?? "";
  if (e.attrs.brackets === "none")
    return content ? `${content} (${target})` : target;
  return content ? `${content} <${target}>` : `<${target}>`;
}

const clean = (s: string): string =>
  normalizeText(s.replace(/‑/g, "-").replace(/[​⁠]/g, ""));

/** A node's text by the plain-text rule in this module's header. */
export function plainText(node: XmlNode): string {
  return clean(render(node, { bcp14: null }));
}

// ---------------------------------------------------------------- blocks

/** A `<sourcecode>` or `<artwork>`: its text as written, and where it starts. */
export function codeOf(node: XmlNode): {
  type?: string;
  text: string;
  loc: Loc;
} {
  const raw = node.children.map((c) => (isElement(c) ? "" : c.text)).join("");
  const first = node.children.find((c) => !isElement(c));
  const lead = raw.match(/^[ \t]*\n/)?.[0].length ?? 0;
  const text = raw.slice(lead).replace(/\n[ \t]*$/, "");
  const base = first?.loc ?? node.loc;
  const skip = lead > 0 ? 1 : 0;
  const loc: Loc =
    base.mdLine === undefined
      ? { xmlLine: base.xmlLine + skip }
      : { xmlLine: base.xmlLine + skip, mdLine: base.mdLine + skip };
  return node.attrs.type === undefined
    ? { text, loc }
    : { type: node.attrs.type, text, loc };
}

/** A table cell: its plain text and, apart, its code spans. */
export interface Cell {
  header: boolean;
  text: string;
  /** The `<tt>` (or v2 `<spanx style="verb">`) spans in it, as plain text. */
  code: string[];
  loc: Loc;
}

const isCode = (n: XmlNode): boolean =>
  n.name === "tt" || (n.name === "spanx" && n.attrs.style === "verb");

function codeSpans(n: XmlNode): string[] {
  return elements(n).flatMap((c) =>
    isCode(c) ? [plainText(c)] : codeSpans(c),
  );
}

const cell = (c: XmlNode, header: boolean): Cell => ({
  header,
  text: plainText(c),
  code: codeSpans(c),
  loc: c.loc,
});

/**
 * A `<table>`'s rows of cells, thead first. A v2 `<texttable>` (which
 * kramdown-rfc still writes) reads the same: its `<ttcol>`s are the header
 * row and its `<c>`s fill rows of that width.
 */
export function tableRows(table: XmlNode): Cell[][] {
  return cellNodes(table).map((row) => row.map((c) => cell(c.node, c.header)));
}

function cellNodes(table: XmlNode): { node: XmlNode; header: boolean }[][] {
  if (table.name === "texttable") {
    const cols = elements(table).filter((c) => c.name === "ttcol");
    const cs = elements(table).filter((c) => c.name === "c");
    const width = Math.max(cols.length, 1);
    const rows = [cols.map((node) => ({ node, header: true }))];
    for (let i = 0; i < cs.length; i += width) {
      rows.push(
        cs.slice(i, i + width).map((node) => ({ node, header: false })),
      );
    }
    return rows.filter((r) => r.length > 0);
  }
  const trs = (n: XmlNode): XmlNode[] =>
    elements(n).flatMap((c) =>
      c.name === "tr"
        ? [c]
        : ["thead", "tbody", "tfoot"].includes(c.name)
          ? trs(c)
          : [],
    );
  return trs(table).map((tr) =>
    elements(tr)
      .filter((c) => c.name === "td" || c.name === "th")
      .map((node) => ({ node, header: node.name === "th" })),
  );
}

interface Line {
  text: string;
  prose: boolean;
  code: string | null;
  spans: string[];
}

interface Normative {
  section: string;
  level: Level;
  sentence: string;
  loc: Loc;
  anchor?: string;
}

// Elements holding either running text or further blocks.
const CONTAINERS = new Set([
  "ul",
  "ol",
  "dl",
  "li",
  "dt",
  "dd",
  "blockquote",
  "aside",
  "figure",
]);
const KEYWORDS: ReadonlySet<string> = new Set(
  LEVELS.filter((l) => l !== "DEFINITION"),
);

class Builder {
  constructor(
    private readonly file: string,
    private readonly normative: Normative[],
  ) {}

  /** A section's own lines (its subsections excluded). */
  sectionLines(sec: XmlNode, id: string): Line[] {
    const out: Line[] = [];
    for (const c of sec.children) {
      if (isElement(c) && (c.name === "name" || c.name === "section")) continue;
      this.block(c, id, true, undefined, out);
    }
    return out;
  }

  private block(
    n: XmlNode | XmlText,
    id: string,
    prose: boolean,
    anchor: string | undefined,
    out: Line[],
  ): void {
    if (!isElement(n)) {
      this.paragraph(n, id, prose, anchor, out);
      return;
    }
    const here = n.attrs.anchor ?? anchor;
    if (n.name === "iref" || n.name === "cref") return;
    if (n.name === "sourcecode" || n.name === "artwork") {
      for (const l of codeOf(n).text.split("\n")) {
        out.push({ text: l, prose: false, code: l, spans: [] });
      }
      return;
    }
    if (n.name === "table" || n.name === "texttable") {
      for (const c of elements(n)) {
        if (c.name === "name") this.block(c, id, prose, here, out);
      }
      for (const row of cellNodes(n)) {
        for (const { node, header } of row) {
          const c = cell(node, header);
          this.normativeIn(node, id, here);
          out.push({ text: c.text, prose: false, code: null, spans: c.code });
        }
      }
      return;
    }
    const hasBlocks =
      CONTAINERS.has(n.name) &&
      n.children.some((c) => isElement(c) && !INLINE.has(c.name));
    if (hasBlocks) {
      const inner = prose && n.name !== "blockquote";
      for (const c of n.children) this.block(c, id, inner, here, out);
      return;
    }
    this.paragraph(n, id, prose && n.name !== "blockquote", here, out);
  }

  private paragraph(
    n: XmlNode | XmlText,
    id: string,
    prose: boolean,
    anchor: string | undefined,
    out: Line[],
  ): void {
    const text = isElement(n) ? plainText(n) : clean(n.text);
    if (text === "") return;
    if (isElement(n)) this.normativeIn(n, id, anchor);
    out.push({
      text,
      prose,
      code: null,
      spans: isElement(n) ? codeSpans(n) : [],
    });
  }

  /**
   * The sentences of `n` holding a `<bcp14>`, split as normativeSentences
   * splits a section's text, each at the level its markup names. A keyword
   * with a double quote on either side is named, not used (the RFC 2119
   * boilerplate's `"MUST"`), and makes no entry: rfctext's KEYWORD_RE reads
   * it the same way.
   */
  private normativeIn(
    n: XmlNode,
    section: string,
    anchor: string | undefined,
  ): void {
    const found: XmlNode[] = [];
    const marked = clean(render(n, { bcp14: found }));
    if (found.length === 0) return;
    // The text without sentinels, and where each keyword starts and ends in it.
    const parts: string[] = [];
    const start: number[] = [];
    const end: number[] = [];
    const open: number[] = [];
    let length = 0;
    let from = 0;
    for (let i = 0; i < marked.length; i++) {
      const ch = marked[i];
      if (ch !== OPEN && ch !== CLOSE) continue;
      parts.push(marked.slice(from, i));
      length += i - from;
      from = i + 1;
      if (ch === OPEN) {
        open.push(start.length);
        start.push(length);
        // A keyword's own leading and trailing space is not its text. After
        // clean, a run of whitespace is one space.
        if (marked[i + 1] === " ") from++;
      } else {
        const last = parts[parts.length - 1];
        if (last.endsWith(" ")) {
          parts[parts.length - 1] = last.slice(0, -1);
          length--;
        }
        end[open.pop() ?? 0] = length;
      }
    }
    parts.push(marked.slice(from));
    const text = parts.join("");
    // Where each sentence break (". ") starts, in order.
    const stops: number[] = [];
    for (let i = text.indexOf(". "); i >= 0; i = text.indexOf(". ", i + 1))
      stops.push(i);
    // The first stop at or after `at`.
    const next = (at: number): number => {
      let lo = 0;
      let hi = stops.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (stops[mid] < at) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    const seen = new Set<string>();
    found.forEach((b, i) => {
      // Its text as plainText would give it, read off the text already made.
      const word = end[i] - start[i] > 15 ? null : text.slice(start[i], end[i]);
      const level = word === "NOT RECOMMENDED" ? "SHOULD NOT" : word;
      if (level === null || !KEYWORDS.has(level)) {
        const shown =
          word ?? `${text.slice(start[i], start[i] + 40).trimEnd()}...`;
        throw new XmlRefusal(
          this.file,
          b.loc,
          `<bcp14> holds "${shown}", which is not a BCP 14 keyword`,
        );
      }
      if (text[start[i] - 1] === '"' || text[end[i]] === '"') return;
      // As lastIndexOf(". ", at) and indexOf(". ", at) would find them.
      const j = next(start[i]);
      const after = j < stops.length ? stops[j] : -1;
      const before = after === start[i] ? after : j > 0 ? stops[j - 1] : -1;
      const key = `${level}\n${before}`;
      if (seen.has(key)) return;
      seen.add(key);
      const entry: Normative = {
        section,
        level: level as Level,
        sentence: text.slice(
          before < 0 ? 0 : before + 2,
          after < 0 ? text.length : after + 1,
        ),
        loc: b.loc,
      };
      if (anchor !== undefined) entry.anchor = anchor;
      this.normative.push(entry);
    });
  }
}

// Running-text elements: a container holding only these is one paragraph.
const INLINE = new Set([
  "bcp14",
  "tt",
  "em",
  "strong",
  "sub",
  "sup",
  "u",
  "xref",
  "eref",
  "iref",
  "cref",
  "br",
  "spanx",
  "vspace",
]);

// ---------------------------------------------------------------- document

interface SectionInfo {
  id: string;
  node: XmlNode;
  numbered: boolean;
  back: boolean;
  own: Line[];
  subs: SectionInfo[];
}

function toSection(
  id: string,
  title: string,
  own: Line[],
  all: Line[],
): RfcSection {
  return {
    id,
    title,
    lines: all.map((l) => l.text),
    ownLines: own.map((l) => l.text),
    proseLines: all.map((l) => (l.prose ? l.text : "")),
    codeLines: all.map((l) => l.code),
    spanLines: all.map((l) => l.spans),
  };
}

/** Whether `text` looks like RFC XML (its root element is `<rfc>`). */
export function isV3Xml(text: string): boolean {
  return PROLOG_RE.test(text.slice(0, 65536));
}

// Each token can end in only one place (a PI at its first "?>", a comment at
// its first "-->"), so the match never backtracks into a token: linear time.
const MISC = String.raw`(?:<\?(?:[^?]|\?(?!>))*\?>\s*|<!--(?:[^-]|-(?!->))*-->\s*)*`;
const PROLOG_RE = new RegExp(
  String.raw`^\uFEFF?\s*${MISC}(?:<!DOCTYPE\s+rfc\b(?:[^[>]|\[[^\]]*\])*>\s*)?${MISC}<rfc[\s>/]`,
);

/** Read RFC XML v3. Throws XmlRefusal on input it will not read. */
export function parseV3(text: string, file: string): V3Document {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_INPUT_BYTES) {
    throw new XmlRefusal(
      file,
      { xmlLine: 1 },
      `input is ${bytes} bytes, over the ${MAX_INPUT_BYTES}-byte limit (MAX_INPUT_BYTES)`,
    );
  }
  const reader = new Reader(text.replace(/\r\n?/g, "\n"), file);
  const root = reader.document();
  if (root.name !== "rfc") {
    throw new XmlRefusal(
      file,
      root.loc,
      `not RFC XML: the root element is <${root.name}>, not <rfc>`,
    );
  }

  // The first child element of each name, indexed once per parent: xrefs ask
  // the same target again and again, and a scan of its children each time
  // would cost the xrefs times the target's size.
  const firsts = new Map<XmlNode, Map<string, XmlNode>>();
  const child = (n: XmlNode, name: string): XmlNode | undefined => {
    let byName = firsts.get(n);
    if (!byName) {
      byName = new Map();
      for (const c of n.children)
        if (isElement(c) && !byName.has(c.name)) byName.set(c.name, c);
      firsts.set(n, byName);
    }
    return byName.get(name);
  };

  // Sections, numbered as xml2rfc numbers them.
  const infos: SectionInfo[] = [];
  const number = (
    parent: XmlNode,
    prefix: string,
    back: boolean,
    numbered: boolean,
  ): SectionInfo[] => {
    let i = 0;
    const subs: SectionInfo[] = [];
    for (const s of elements(parent).filter((c) => c.name === "section")) {
      i++;
      if (back && !prefix && i > 26) {
        throw new XmlRefusal(
          file,
          s.loc,
          "<back> has more than 26 sections; appendix letters run out at Z",
        );
      }
      const n = back && !prefix ? String.fromCharCode(64 + i) : String(i);
      const id = prefix ? `${prefix}.${n}` : n;
      const on = numbered && s.attrs.numbered !== "false";
      const info: SectionInfo = {
        id,
        node: s,
        numbered: on,
        back,
        own: [],
        subs: [],
      };
      infos.push(info);
      subs.push(info);
      info.subs = number(s, id, back, on);
    }
    return subs;
  };
  const middle = child(root, "middle");
  const back = child(root, "back");
  if (middle) number(middle, "", false, true);
  if (back) number(back, "", true, true);

  // Every anchored element, the references, and what xrefs to them say.
  const byAnchor = new Map<string, XmlNode>();
  const xrefs: XmlNode[] = [];
  const figures = new Map<XmlNode, number>();
  const tables = new Map<XmlNode, number>();
  const references: V3Document["references"] = [];
  const display = new Map<string, string>();
  // Below a table cell: a table there is not v3, and refusing it keeps each
  // cell's text, rendered whole for the table, from being rendered again for
  // a table inside it, at each level.
  const walk = (n: XmlNode, inCell: boolean) => {
    const anchor = n.attrs.anchor;
    if (anchor !== undefined) {
      const first = byAnchor.get(anchor);
      if (first) {
        // Later stages name requirements by anchor: one anchor, one element.
        throw new XmlRefusal(
          file,
          n.loc,
          `anchor "${anchor}" is used again; first on line ${first.loc.xmlLine}`,
        );
      }
      byAnchor.set(anchor, n);
    }
    if (inCell && (n.name === "table" || n.name === "texttable")) {
      throw new XmlRefusal(
        file,
        n.loc,
        `<${n.name}> inside a table cell is not RFC XML v3`,
      );
    }
    if (n.name === "xref") xrefs.push(n);
    if (n.name === "figure") figures.set(n, figures.size + 1);
    if (n.name === "table" || n.name === "texttable")
      tables.set(n, tables.size + 1);
    if (n.name === "displayreference" && n.attrs.target && n.attrs.to) {
      display.set(n.attrs.target, n.attrs.to);
    }
    if (n.name === "reference" && n.attrs.anchor !== undefined) {
      const rfc = elements(n).find(
        (c) => c.name === "seriesInfo" && c.attrs.name === "RFC",
      );
      const ref: V3Document["references"][number] = {
        anchor: n.attrs.anchor,
        loc: n.loc,
      };
      if (rfc && /^[0-9]+$/.test(rfc.attrs.value ?? ""))
        ref.rfc = Number(rfc.attrs.value);
      references.push(ref);
    }
    const below =
      inCell || n.name === "td" || n.name === "th" || n.name === "c";
    for (const c of elements(n)) walk(c, below);
  };
  walk(root, false);

  const infoOf = new Map(infos.map((s) => [s.node, s]));
  const nameOf = (n: XmlNode) => {
    const name = child(n, "name");
    return name ? plainText(name) : "";
  };
  // Names and titles as derived() reads them, each rendered once: a name
  // holding an xref renders it as worked out so far, in document order.
  const named = new Map<XmlNode, string>();
  const textOf = (n: XmlNode | undefined): string => {
    if (!n) return "";
    let s = named.get(n);
    if (s === undefined) {
      s = plainText(n);
      named.set(n, s);
    }
    return s;
  };
  // A name can hold an xref to a section whose name holds xrefs too, so what
  // is worked out can outgrow the input many times over: it is counted.
  const budget = text.length + MAX_XREF_TEXT;
  let spent = 0;
  for (const x of xrefs) {
    const target = x.attrs.target ?? "";
    const t = byAnchor.get(target);
    const reference = t?.name === "reference" || t?.name === "referencegroup";
    const reftext =
      x.attrs.derivedContent === undefined ? derived(x, t, reference) : "";
    spent += reftext.length;
    if (spent > budget) {
      throw new XmlRefusal(
        file,
        x.loc,
        `the xref text worked out runs past ${budget} characters, the input's length and MAX_XREF_TEXT`,
      );
    }
    xrefInfo.set(x, { reftext, reference });
  }

  // The preptool's derivedContent, for source that has not been through it.
  function derived(
    x: XmlNode,
    t: XmlNode | undefined,
    reference: boolean,
  ): string {
    const target = x.attrs.target ?? "";
    const format = x.attrs.format ?? "default";
    if (!t) return target;
    if (reference) {
      if (format === "title") {
        const title = child(child(t, "front") ?? t, "title");
        return title ? textOf(title) : target;
      }
      return display.get(target) ?? target;
    }
    if (format === "none") return "";
    if (format === "title") return textOf(child(t, "name")) || target;
    const s = infoOf.get(t);
    if (s) {
      if (format === "counter") return s.numbered ? s.id : "";
      const kind = s.back ? "Appendix" : "Section";
      return s.numbered
        ? `${kind} ${s.id}`
        : `${kind} "${textOf(child(t, "name")) || target}"`;
    }
    const fig = figures.get(t);
    if (fig !== undefined)
      return format === "counter" ? String(fig) : `Figure ${fig}`;
    const tab = tables.get(t);
    if (tab !== undefined)
      return format === "counter" ? String(tab) : `Table ${tab}`;
    return target;
  }

  // Lines, text and normative sentences, now that xrefs render.
  const normative: Normative[] = [];
  const builder = new Builder(file, normative);
  for (const s of infos) {
    s.own = builder.sectionLines(s.node, s.numbered ? s.id : LOOSE_SECTION);
  }
  // Every section's lines in document order: a section's own, then its
  // subsections', so each section's lines are one run of `all`.
  const all: Line[] = [];
  const runs = new Map<SectionInfo, [number, number]>();
  const lay = (s: SectionInfo): void => {
    const from = all.length;
    for (const l of s.own) all.push(l);
    s.subs.forEach(lay);
    runs.set(s, [from, all.length]);
  };
  for (const s of infos) if (!runs.has(s)) lay(s);
  let held = 0;
  for (const s of infos) {
    if (!s.numbered) continue;
    const [from, to] = runs.get(s) ?? [0, 0];
    held += to - from;
    if (held > MAX_SECTION_LINES) {
      throw new XmlRefusal(
        file,
        s.node.loc,
        `numbered sections hold over ${MAX_SECTION_LINES} lines, counting each subsection's in its parents' (MAX_SECTION_LINES)`,
      );
    }
  }
  const sections = new Map<string, RfcSection>();
  const sectionByAnchor = new Map<string, string>();
  const loose: Line[] = [];
  for (const s of infos) {
    if (!s.numbered) {
      for (const l of s.own) loose.push(l);
      continue;
    }
    const [from, to] = runs.get(s) ?? [0, 0];
    sections.set(
      s.id,
      toSection(s.id, nameOf(s.node), s.own, all.slice(from, to)),
    );
    const anchor = s.node.attrs.anchor;
    // Anchors are unique: the walk above refuses one used twice.
    if (anchor !== undefined) sectionByAnchor.set(anchor, s.id);
  }

  const front = child(root, "front");
  const title = front && child(front, "title");
  const num = root.attrs.number;
  const doc: V3Document = {
    number: num !== undefined && /^[0-9]+$/.test(num) ? Number(num) : null,
    sections,
    title: title ? plainText(title) : "",
    root,
    references,
    sectionByAnchor,
    normative,
  };
  if (infos.some((s) => !s.numbered))
    doc.loose = toSection(LOOSE_SECTION, "", loose, loose);
  if (root.attrs.docName !== undefined) doc.docName = root.attrs.docName;
  return doc;
}
