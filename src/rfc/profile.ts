// The vector profile: what an RFC XML v3 spec, built by kramdown-rfc and
// `xml2rfc --v2v3`, must say for vector to read a contract from it, and the
// reading. A pure function of the parsed document and of the RFCs it cites
// (through the resolver it is handed): no files, no clock, the same contract
// or the same refusals for the same input, in document order.
//
//   contract      `docName` draft-<name>-NN; <name> is the file's basename
//   target        the one `ts-interface` block's `// module: …` line
//   requirement   a `<t anchor>` holding one BCP 14 sentence, or one starting
//                 `Definition: `, or a `<blockquote anchor>` quoting an RFC
//                 and ending with `{{Section N of RFCx}}`
//   exclusion     a requirement followed by a `<t>` starting `Untested: `,
//                 or an unanchored paragraph or blockquote followed by one
//   note          a `<t>` starting `Note: ` directly after a requirement
//   main source   the spec itself, or the RFC a `keyword` vector-main-RFC<N>
//                 in `<front>` names; it must be under `normative:` and cited
//   property      a `ts-property` block, read by the front end of its language
//   vector        a row of a table headed Id | Call | Expected | Covers | Source | Title
//
// Every BCP 14 sentence must be a requirement or an exclusion (with an RFC
// main source: every binding sentence of that RFC, which the completeness
// gate checks at extract), every xref to
// an RFC must have a `<reference>`, and every section cited must exist in
// the RFC the resolver returns. A refusal names the markdown line where the
// XML carries kramdown-rfc's `<?line N?>`, else the XML line. That line can
// run late after a table: kramdown-rfc writes no `<?line?>` inside one, so a
// refusal past it names the last line it did write.

import {
  BINDING_LEVELS,
  type Clause,
  type Exclusion,
  type FnSig,
  ID_RE,
  LEVELS,
  type Level,
  type PropertyClause,
  type Requirement,
  type RfcContract,
  SECTION_RE,
  type SourceDecl,
  TEST_NAMES,
  TEST_PREFIXES,
  type VectorClause,
  type VectorSource,
  callsIn,
  controlChar,
  validateContractShape,
} from "./contract.ts";
import { frontEndFor } from "./front/index.ts";
import {
  isLiteralError,
  kindOf,
  parseCall,
  parseLiteral,
  settleVector,
} from "./literals.ts";
import {
  type RfcDocument,
  findSection,
  normalizeText,
  sectionText,
} from "./rfctext.ts";
import { LOOSE_SECTION } from "./spectext.ts";
import {
  type Loc,
  type V3Document,
  type XmlNode,
  codeOf,
  isElement,
  plainText,
} from "./xmlv3.ts";

export interface Refusal {
  /** The markdown file when `line` is its line, else the XML file. */
  file: string;
  /**
   * The markdown line when the XML carries `<?line N?>` and the markdown
   * file is known, else the XML line.
   */
  line: number;
  col?: number;
  message: string;
}

/** The RFC numbered `rfc`, as text or XML. May throw; the error is not caught. */
export type RfcResolver = (rfc: number) => RfcDocument | V3Document;

export const VECTOR_HEADER = [
  "Id",
  "Call",
  "Expected",
  "Covers",
  "Source",
  "Title",
] as const;
const VECTOR_NAMES = new Set(VECTOR_HEADER.map((h) => h.toLowerCase()));

const DEFINITION = "Definition: ";
const UNTESTED = "Untested: ";
const NOTE = "Note: ";
/** The front-matter keyword that names an RFC main source. */
export const MAIN_KEY = "vector-main-";
const MAIN_KEY_RE = /^vector-main-RFC([1-9][0-9]*)$/;
/** A keyword meant as the main-source key, spelt right or not. */
const MAIN_KEY_LIKE = /^vector[-_\s]*main(?:[-_\s]|rfc|$)/i;
const RFC_TARGET_RE = /^RFC([0-9]+)$/;
// The reader's keyword rule: a keyword is not inside a word or a quote, and
// longest first, so `MUST NOT` is not `MUST`; `NOT RECOMMENDED` is `SHOULD NOT`.
const KEYWORD_RE = new RegExp(
  `(?<!")(?<![A-Za-z0-9])(${[
    ...LEVELS.filter((l) => l !== "DEFINITION"),
    "NOT RECOMMENDED",
  ]
    .sort((a, b) => b.length - a.length)
    .map((l) => l.replace(" ", "\\s+"))
    .join("|")})(?![A-Za-z0-9])(?!")`,
  "g",
);
const levelOf = (word: string): Level => {
  const w = word.replace(/\s+/, " ");
  return (w === "NOT RECOMMENDED" ? "SHOULD NOT" : w) as Level;
};

const elements = (n: XmlNode): XmlNode[] => n.children.filter(isElement);
/**
 * Why `s` cannot be free text in a contract (validateContractShape's rule:
 * not blank, one line, no control characters), or undefined when it can.
 */
const textFault = (s: string): string | undefined => {
  if (s.trim() === "") return "is empty";
  const ch = controlChar(s);
  return ch ? `holds a control character (${ch})` : undefined;
};
/**
 * Where `loc` is printed: the markdown file `md` at its markdown line when
 * both are known, else the XML file `xml` at its XML line.
 */
export const whereOf = (
  loc: Loc,
  xml: string,
  md?: string,
): { file: string; line: number } =>
  md !== undefined && loc.mdLine !== undefined
    ? { file: md, line: loc.mdLine }
    : { file: xml, line: loc.xmlLine };
/** `loc` moved `n` lines down, in the XML and in the markdown alike. */
const below = (loc: Loc, n: number): Loc => ({
  xmlLine: loc.xmlLine + n,
  ...(loc.mdLine === undefined ? {} : { mdLine: loc.mdLine + n }),
});
const rfcId = (rfc: number) => `rfc${rfc}`;

/** A section of the document, as parseV3 numbers it. */
interface Section {
  node: XmlNode;
  /** The computed number, or LOOSE_SECTION when unnumbered. */
  id: string;
}

function sectionsOf(root: XmlNode): Section[] {
  const out: Section[] = [];
  const walk = (
    parent: XmlNode,
    prefix: string,
    back: boolean,
    numbered: boolean,
  ) => {
    let i = 0;
    for (const s of elements(parent).filter((c) => c.name === "section")) {
      i++;
      const n = back && !prefix ? String.fromCharCode(64 + i) : String(i);
      const id = prefix ? `${prefix}.${n}` : n;
      const on = numbered && s.attrs.numbered !== "false";
      out.push({ node: s, id: on ? id : LOOSE_SECTION });
      walk(s, id, back, on);
    }
  };
  const part = (name: string) => elements(root).find((c) => c.name === name);
  const middle = part("middle");
  const back = part("back");
  if (middle) walk(middle, "", false, true);
  if (back) walk(back, "", true, true);
  return out;
}

/** Every element under `n`, `n` included, in document order. */
function descendants(n: XmlNode, out: XmlNode[] = []): XmlNode[] {
  out.push(n);
  for (const c of elements(n)) descendants(c, out);
  return out;
}

/** The sourcecode blocks of a section, its subsections' excluded. */
function ownCode(sec: XmlNode): XmlNode[] {
  return elements(sec)
    .filter((c) => c.name !== "section")
    .flatMap((c) => descendants(c))
    .filter((n) => n.name === "sourcecode");
}

/** A code span's text as written: its text nodes, entities resolved, nothing else. */
const rawText = (n: XmlNode): string =>
  n.children.map((c) => (isElement(c) ? rawText(c) : c.text)).join("");

/** A cell's raw text, ends trimmed: no character inside is rewritten. */
const cellText = (n: XmlNode): string => rawText(n).trim();

/** Whitespace-only text around exactly one element child, or null. */
function only(n: XmlNode): XmlNode | null {
  const els = elements(n);
  if (els.length !== 1) return null;
  const textOnly = n.children.every((c) => isElement(c) || !c.text.trim());
  return textOnly ? els[0] : null;
}

/** A requirement or exclusion as read, before the resolver checks a quote. */
interface Quoted {
  id: string;
  section: string;
  quote: string;
  level: Level;
  /** For a blockquote: the RFC quoted. */
  cite?: { rfc: number; section: string };
  /** A `Note: ` paragraph after it. */
  note?: string;
  loc: Loc;
}

/** The front-matter keywords meant as the main-source key, spelt right or not. */
function mainKeys(doc: V3Document): XmlNode[] {
  const front = elements(doc.root).find((n) => n.name === "front");
  return (front ? elements(front) : []).filter(
    (n) => n.name === "keyword" && MAIN_KEY_LIKE.test(plainText(n).trim()),
  );
}

/** Whether `doc` is a profile that names an RFC main source, spelt right or not. */
export const namesMainRfc = (doc: V3Document): boolean =>
  mainKeys(doc).length > 0;

export function profileToContract(
  doc: V3Document,
  xmlPath: string,
  resolve: RfcResolver,
  mdPath?: string,
): { contract: RfcContract; locator: Locator } | { refusals: Refusal[] } {
  const refusals: Refusal[] = [];
  const where = (loc: Loc) => whereOf(loc, xmlPath, mdPath);
  const refuse = (loc: Loc, message: string, col?: number) => {
    refusals.push({
      ...where(loc),
      ...(col === undefined ? {} : { col }),
      message,
    });
  };

  /** `what` as free text in the contract, or a refusal at `loc`. */
  const checkText = (loc: Loc, what: string, s: string) => {
    const fault = textFault(s);
    if (fault) refuse(loc, `${what} ${fault}`);
  };
  const sorted = (): { refusals: Refusal[] } => ({
    refusals: refusals.sort(
      (a, b) =>
        a.line - b.line ||
        (a.col ?? 0) - (b.col ?? 0) ||
        (a.message < b.message ? -1 : a.message > b.message ? 1 : 0),
    ),
  });

  // The RFCs, each resolved once, and the sections cited in each.
  const resolved = new Map<number, RfcDocument>();
  const rfc = (n: number): RfcDocument => {
    let d = resolved.get(n);
    if (!d) {
      d = resolve(n);
      resolved.set(n, d);
    }
    return d;
  };
  // Each cited section's text, made once.
  const texts = new Map<string, string>();
  const textOf = (n: number, section: string): string | undefined => {
    const key = `${n} ${section}`;
    let t = texts.get(key);
    if (t === undefined) {
      const sec = findSection(rfc(n), section);
      if (!sec) return undefined;
      t = sectionText(sec);
      texts.set(key, t);
    }
    return t;
  };
  const referenced = new Map<string, number | undefined>(
    doc.references.map((r) => [r.anchor, r.rfc]),
  );
  /** The RFC an xref with a section cites, or a refusal. */
  const citedRfc = (x: XmlNode): number | null => {
    const target = x.attrs.target ?? "";
    const n = referenced.get(target);
    if (n === undefined) {
      // An RFC with no <reference> at all was refused with the other xrefs.
      if (!referenced.has(target) && RFC_TARGET_RE.test(target)) return null;
      refuse(x.loc, `xref to "${target}" names no RFC <reference>`);
      return null;
    }
    const section = x.attrs.section ?? "";
    if (!SECTION_RE.test(section)) {
      refuse(
        x.loc,
        `section "${section}" of RFC${n} is not a section number like 2.3 or A.1`,
      );
      return null;
    }
    return n;
  };

  // -- the main source: the spec, or the RFC its vector-main-RFC<N> names.
  const keys = mainKeys(doc);
  const normativeRfcs = new Set(
    descendants(doc.root)
      .filter(
        (r) =>
          r.name === "references" &&
          elements(r).some(
            (c) =>
              c.name === "name" &&
              plainText(c).trim() === "Normative References",
          ),
      )
      .flatMap((r) => descendants(r))
      .filter((r) => r.name === "reference")
      .map((r) => referenced.get(r.attrs.anchor ?? "")),
  );
  let mainRfc: number | undefined;
  const mainKey = keys[0];
  for (const k of keys.slice(1))
    refuse(
      k.loc,
      `a spec has one main source; keyword ${plainText(k).trim()} names a second`,
    );
  if (mainKey) {
    const text = plainText(mainKey).trim();
    const n = Number(text.match(MAIN_KEY_RE)?.[1] ?? Number.NaN);
    if (Number.isNaN(n))
      refuse(
        mainKey.loc,
        `the main-source keyword is ${MAIN_KEY}RFC<N>, not ${text}`,
      );
    else if (!normativeRfcs.has(n))
      refuse(
        mainKey.loc,
        `${text} names RFC${n}, which is not a normative reference; list it under normative:`,
      );
    else mainRfc = n;
  }
  /** Why a construct that quotes the spec itself is refused in main mode. */
  const ownText = (what: string) =>
    `${what} is the spec's own text, but the main source is RFC${mainRfc}; quote the RFC in a blockquote ending {{Section N of RFC${mainRfc}}}`;

  // -- contract: docName and the file name agree.
  const base = (xmlPath.split("/").pop() ?? "").replace(/\.xml$/, "");
  let contract = base;
  const name = doc.docName?.match(/^draft-(.+)-[0-9]{2}$/)?.[1];
  if (name === undefined) {
    refuse(
      doc.root.loc,
      `docName "${doc.docName ?? ""}" is not draft-<name>-NN`,
    );
  } else if (name !== base) {
    refuse(
      doc.root.loc,
      `docName "${doc.docName}" names contract "${name}", but the file is ${base}.xml`,
    );
  } else if (!ID_RE.test(name)) {
    refuse(
      doc.root.loc,
      `docName "${doc.docName}" names contract "${name}", which is not letters, digits, ".", "_" and "-", starting with a letter or digit`,
    );
  } else contract = name;
  checkText(doc.root.loc, "the title", doc.title);

  const sections = sectionsOf(doc.root);

  // -- v2 tables: the pipeline runs `xml2rfc --v2v3`, so none is left to read.
  for (const t of descendants(doc.root))
    if (t.name === "texttable")
      refuse(
        t.loc,
        "a <texttable> is v2 XML; write a v3 <table> (xml2rfc --v2v3 converts one)",
      );

  // -- xrefs: every RFC xref has a reference. The sections cited are checked
  // once the RFCs used as sources are known: an uncited one needs no file.
  const xrefs = descendants(doc.root).filter((x) => x.name === "xref");
  for (const x of xrefs) {
    const target = x.attrs.target ?? "";
    if (!referenced.has(target) && RFC_TARGET_RE.test(target))
      refuse(x.loc, `xref to ${target} has no <reference> for it`);
  }

  // -- the interface: one block, read by its front end.
  const code = sections.flatMap((s) => ownCode(s.node));
  const fronted = (node: XmlNode, kind: string) => {
    const type = node.attrs.type ?? "";
    if (!type.endsWith(`-${kind}`)) return undefined;
    const fe = frontEndFor(type);
    if (!fe) refuse(node.loc, `no front end reads sourcecode type "${type}"`);
    return fe;
  };
  const frontRefuse = (
    node: XmlNode,
    rs: { line: number; col: number; message: string }[],
  ) => {
    const at = codeOf(node).loc;
    for (const r of rs) refuse(below(at, r.line - 1), r.message, r.col);
  };
  const interfaces = code.filter((c) => fronted(c, "interface"));
  let functions: FnSig[] = [];
  let fnLocs: Loc[] = [];
  let module = "";
  if (interfaces.length !== 1) {
    const where = interfaces.length ? interfaces[1].loc : doc.root.loc;
    refuse(
      where,
      `a spec has exactly one ts-interface block; this one has ${interfaces.length}`,
    );
  }
  const iface = interfaces[0];
  if (iface) {
    const fe = frontEndFor(iface.attrs.type ?? "");
    const r = fe?.parseInterface(codeOf(iface).text);
    if (r && "refusals" in r) frontRefuse(iface, r.refusals);
    else if (r) {
      functions = r.functions;
      module = r.module;
      const at = codeOf(iface).loc;
      fnLocs = r.lines.map((l) => below(at, l - 1));
      checkText(iface.loc, "the ts-interface block's module", module);
      functions.forEach(({ name }, i) => {
        if (
          TEST_NAMES.has(name) ||
          TEST_PREFIXES.some((x) => name.startsWith(x))
        )
          refuse(
            fnLocs[i],
            `function ${name}: the generated test uses this name itself (its helpers, and names starting ${TEST_PREFIXES.join(" ")}), so it cannot call such a function`,
          );
      });
    }
  }
  const fnByName = new Map(functions.map((f) => [f.name, f]));

  // -- requirements and exclusions.
  type Entry = V3Document["normative"][number];
  const byLoc = new Map<Loc, Entry[]>();
  for (const e of doc.normative) {
    const at = byLoc.get(e.loc);
    if (at) at.push(e);
    else byLoc.set(e.loc, [e]);
  }
  const requirements: Quoted[] = [];
  const exclusions: (Quoted & { reason: string })[] = [];
  const handled = new Set<Loc>();
  const bcp14Under = (n: XmlNode) =>
    descendants(n)
      .filter((d) => d.name === "bcp14")
      .map((d) => d.loc);
  const entriesUnder = (n: XmlNode): Entry[] =>
    bcp14Under(n).flatMap((l) => byLoc.get(l) ?? []);
  const levelsOf = (es: { level: Level }[]) => [
    ...new Set(es.map((e) => e.level)),
  ];
  const isUntested = (n: XmlNode | undefined): n is XmlNode =>
    n?.name === "t" && plainText(n).startsWith(UNTESTED);
  const isNote = (n: XmlNode | undefined): n is XmlNode =>
    n?.name === "t" && plainText(n).startsWith(NOTE);

  /**
   * A requirement, or with `excluded` an exclusion; null when refused;
   * undefined when the block is none.
   */
  const readBlock = (
    n: XmlNode,
    section: string,
    excluded: boolean,
  ): Quoted | null | undefined => {
    const anchor = n.attrs.anchor;
    if (n.name === "t") {
      const text = plainText(n);
      const found = entriesUnder(n);
      if (text.startsWith(DEFINITION)) {
        if (mainRfc !== undefined) {
          refuse(n.loc, ownText("a Definition: paragraph"));
          return null;
        }
        if (anchor === undefined) {
          refuse(n.loc, "a Definition: paragraph needs an anchor");
          return null;
        }
        // A quoted keyword ("MUST") is named, not used: the reader makes no entry.
        if (found.length > 0) {
          refuse(
            n.loc,
            `${anchor} is a definition but holds BCP 14 keywords; a definition holds none`,
          );
          return null;
        }
        return {
          id: anchor,
          section,
          quote: text.slice(DEFINITION.length),
          level: "DEFINITION",
          loc: n.loc,
        };
      }
      if (anchor === undefined || found.length === 0) return undefined;
      if (mainRfc !== undefined) {
        refuse(n.loc, ownText(`${anchor}, a BCP 14 paragraph,`));
        return null;
      }
      const sentences = [...new Set(found.map((e) => e.sentence))];
      if (sentences.length > 1) {
        refuse(
          n.loc,
          `${anchor} holds ${sentences.length} BCP 14 sentences; give each its own anchor`,
        );
        return null;
      }
      const levels = levelsOf(found);
      if (levels.length > 1) {
        refuse(
          n.loc,
          `${anchor} holds more than one BCP 14 level (${levels.join(", ")}); give each level its own sentence`,
        );
        return null;
      }
      return {
        id: anchor,
        section,
        quote: found[0].sentence,
        level: levels[0],
        loc: n.loc,
      };
    }
    // An unanchored blockquote is an exclusion or nothing.
    if (anchor === undefined && !excluded) return undefined;
    const what =
      anchor === undefined ? "an excluded blockquote" : `blockquote ${anchor}`;
    const ts = elements(n);
    const last = ts[ts.length - 1];
    const lastKids = last?.children.filter(
      (c) => isElement(c) || c.text.trim(),
    );
    const x = lastKids?.[lastKids.length - 1];
    if (
      !ts.every((t) => t.name === "t") ||
      !x ||
      !isElement(x) ||
      x.name !== "xref" ||
      x.attrs.section === undefined
    ) {
      refuse(
        n.loc,
        `${what} must be <t> paragraphs, the last ending with {{Section N of RFCx}}`,
      );
      return null;
    }
    const n2 = citedRfc(x);
    if (n2 === null) return null;
    const stripped: XmlNode = {
      ...last,
      children: last.children.filter((c) => c !== x),
    };
    const quote = normalizeText(
      [...ts.slice(0, -1), stripped].map(plainText).join(" "),
    );
    const levels = levelsOf(
      [...quote.matchAll(KEYWORD_RE)].map((m) => ({ level: levelOf(m[1]) })),
    );
    // An unanchored exclusion exists to exclude a BCP 14 sentence, as the
    // unanchored <t> form does; one with no keyword excludes nothing.
    if (anchor === undefined && levels.length === 0) {
      refuse(
        n.loc,
        `${what} holds no BCP 14 keyword, so it excludes nothing; anchor it to exclude a definition`,
      );
      return null;
    }
    // An exclusion records no level, so it may quote a sentence with two.
    if (levels.length > 1 && !excluded) {
      refuse(
        n.loc,
        `${what} holds more than one BCP 14 level (${levels.join(", ")}); quote one level per requirement`,
      );
      return null;
    }
    return {
      id: anchor ?? "",
      section: x.attrs.section,
      quote,
      level: levels[0] ?? "DEFINITION",
      cite: { rfc: n2, section: x.attrs.section },
      loc: n.loc,
    };
  };
  const tables: { node: XmlNode; section: string }[] = [];
  /** BCP 14 sentences in unanchored blockquotes with no Untested: after. */
  const unclaimed = new Set<Loc>();
  const blocks = (parent: XmlNode, section: string) => {
    const kids = elements(parent).filter(
      (c) => c.name !== "name" && c.name !== "section",
    );
    // The Untested: paragraphs that exclude something.
    const used = new Set<XmlNode>();
    kids.forEach((n, i) => {
      if (n.name === "table") {
        tables.push({ node: n, section });
        return;
      }
      if (n.name !== "t" && n.name !== "blockquote") {
        blocks(n, section);
        return;
      }
      if (used.has(n)) return;
      const next = kids[i + 1];
      // An anchored block, or an unanchored blockquote with an Untested:
      // paragraph after it, is a requirement or exclusion or refused as one.
      if (
        n.attrs.anchor !== undefined ||
        (n.name === "blockquote" && isUntested(next))
      )
        for (const l of bcp14Under(n)) handled.add(l);
      const q = readBlock(n, section, isUntested(next));
      if (q === undefined) {
        // An unanchored blockquote with no Untested: after it quotes the RFC
        // but neither requires nor excludes what it quotes.
        if (n.name === "blockquote")
          for (const l of bcp14Under(n)) unclaimed.add(l);
        // An unanchored BCP 14 paragraph excluded by the paragraph after it.
        if (n.name !== "t" || !isUntested(next)) return;
        const found = entriesUnder(n);
        if (found.length === 0) return;
        used.add(next);
        if (mainRfc !== undefined) {
          for (const l of bcp14Under(n)) handled.add(l);
          refuse(n.loc, ownText("an excluded paragraph"));
          return;
        }
        for (const l of bcp14Under(n)) handled.add(l);
        for (const l of bcp14Under(next)) handled.add(l);
        if (section === LOOSE_SECTION) {
          refuse(
            n.loc,
            "an excluded sentence is in an unnumbered section; it needs a section number",
          );
          return;
        }
        const levels = levelsOf(found);
        if (levels.length > 1) {
          refuse(
            n.loc,
            `an excluded paragraph holds more than one BCP 14 level (${levels.join(", ")}); exclude each level apart`,
          );
          return;
        }
        const reason = plainText(next).slice(UNTESTED.length);
        checkText(next.loc, "the Untested: reason", reason);
        const quote = plainText(n);
        checkText(n.loc, "the excluded sentence", quote);
        exclusions.push({
          id: "",
          section,
          quote,
          level: levels[0],
          loc: n.loc,
          reason,
        });
        return;
      }
      // A refused block's Untested: paragraph goes with it, unjudged.
      const untested = isUntested(next) ? next : undefined;
      if (untested) {
        used.add(untested);
        for (const l of bcp14Under(untested)) handled.add(l);
      }
      if (q === null) return;
      // An excluded blockquote needs no anchor; an anchor it has is checked.
      if (!(untested && q.id === "") && !ID_RE.test(q.id)) {
        refuse(
          n.loc,
          `requirement id "${q.id}" is not letters, digits, ".", "_" and "-", starting with a letter or digit`,
        );
        return;
      }
      const fault = textFault(q.quote);
      if (fault) {
        refuse(n.loc, `${q.id}'s quote ${fault}`);
        return;
      }
      if (section === LOOSE_SECTION && !q.cite) {
        refuse(
          n.loc,
          `${q.id} is in an unnumbered section; a requirement needs a section number`,
        );
        return;
      }
      if (untested) {
        const name = q.id ? `${q.id}'s` : "the";
        const reason = plainText(untested).slice(UNTESTED.length);
        checkText(untested.loc, `${name} Untested: reason`, reason);
        exclusions.push({ ...q, reason });
        return;
      }
      if (isNote(next)) {
        used.add(next);
        q.note = plainText(next).slice(NOTE.length);
        checkText(next.loc, `${q.id}'s note`, q.note);
      }
      requirements.push(q);
    });
    for (const n of kids) {
      if (used.has(n)) continue;
      const why = isUntested(n)
        ? "this Untested: paragraph excludes nothing; it must directly follow the requirement or BCP 14 paragraph it excludes"
        : isNote(n)
          ? "this Note: paragraph notes nothing; it must directly follow the requirement it notes"
          : undefined;
      if (why) refuse(n.loc, why);
    }
  };
  for (const s of sections) blocks(s.node, s.id);
  for (const e of doc.normative) {
    if (handled.has(e.loc)) continue;
    refuse(
      e.loc,
      mainRfc === undefined
        ? `BCP 14 sentence has no anchor and no Untested: paragraph after it: "${e.sentence}"`
        : unclaimed.has(e.loc)
          ? `this BCP 14 sentence is an RFC quote with no anchor and no Untested: paragraph; anchor the blockquote to require it, or follow it with Untested: to exclude it: "${e.sentence}"`
          : `${ownText("this BCP 14 sentence")}: "${e.sentence}"`,
    );
  }

  // Blockquote quotes against the RFC they quote.
  const cited = new Set<number>();
  for (const q of [...requirements, ...exclusions]) {
    if (!q.cite) continue;
    cited.add(q.cite.rfc);
    // A missing section is refused with the other cited xrefs.
    const text = textOf(q.cite.rfc, q.cite.section);
    if (text !== undefined && !text.includes(normalizeText(q.quote)))
      refuse(
        q.loc,
        `${q.id || "the quote"} is not in Section ${q.cite.section} of RFC${q.cite.rfc}: "${q.quote}"`,
      );
  }
  // Ids are anchors, which the parser keeps unique.
  const ids = new Set(requirements.map((r) => r.id));
  /** A Covers list: at least one id, no empty or repeated one, each a requirement. */
  const checkCovers = (covers: string[], loc: Loc) => {
    if (covers.length === 0) refuse(loc, "Covers names no requirement");
    const seen = new Set<string>();
    for (const c of covers) {
      if (c === "") refuse(loc, "Covers has an empty item");
      else if (seen.has(c)) refuse(loc, `Covers names "${c}" twice`);
      else if (!ids.has(c))
        refuse(loc, `Covers names "${c}", which is no requirement`);
      seen.add(c);
    }
  };
  const clauseIds = new Set<string>();
  const checkId = (id: string, loc: Loc) => {
    if (!ID_RE.test(id))
      refuse(
        loc,
        `clause id "${id}" is not letters, digits, ".", "_" and "-", starting with a letter or digit`,
      );
    else if (clauseIds.has(id)) refuse(loc, `clause id ${id} is given twice`);
    clauseIds.add(id);
  };

  // -- vectors: one table.
  const vectors: VectorClause[] = [];
  const vectorLocs: Loc[] = [];
  let vectorTable: XmlNode | undefined;
  for (const t of tables) readTable(t.node, t.section);

  function readTable(table: XmlNode, section: string) {
    const rows = descendants(table).filter((n) => n.name === "tr");
    const cellsOf = (tr: XmlNode) =>
      elements(tr).filter((c) => c.name === "td" || c.name === "th");
    const header = rows[0] ? cellsOf(rows[0]).map(cellText) : [];
    // A table that looks like a vector table is one, exactly, or refused: it
    // has three or more of the six header names, in any order or case. Prose
    // tables (`ID | Algorithm | Notes`, `Case | Input | Expected`) have two
    // at most, so a renamed or reordered vector table is never dropped.
    if (header.filter((h) => VECTOR_NAMES.has(h.toLowerCase())).length < 3)
      return;
    if (header.join("|") !== VECTOR_HEADER.join("|")) {
      refuse(
        table.loc,
        `a vector table's header is ${VECTOR_HEADER.join(" | ")}, not ${header.join(" | ")}`,
      );
      return;
    }
    if (vectorTable) {
      refuse(table.loc, "a spec has one vector table; this is a second");
      return;
    }
    vectorTable = table;
    if (section === LOOSE_SECTION) {
      refuse(
        table.loc,
        "a vector table is in an unnumbered section; it needs a section number",
      );
      return;
    }
    for (const tr of rows.slice(1)) {
      const v = readRow(cellsOf(tr), section, tr);
      if (v) {
        vectors.push(v);
        vectorLocs.push(tr.loc);
      }
    }
  }

  function codeCell(td: XmlNode): string | null {
    const tt = only(td);
    if (tt?.name === "tt") return rawText(tt);
    refuse(td.loc, "cell must be a single code span");
    return null;
  }

  function readRow(
    cells: XmlNode[],
    section: string,
    tr: XmlNode,
  ): VectorClause | null {
    if (cells.length !== VECTOR_HEADER.length) {
      refuse(
        tr.loc,
        `a vector row has ${VECTOR_HEADER.length} cells, not ${cells.length}`,
      );
      return null;
    }
    // Every cell is judged; the row is refused if any is.
    const before = refusals.length;
    const [idC, callC, expC, coversC, srcC, titleC] = cells;
    const id = cellText(idC);
    checkId(id, idC.loc);
    const title = plainText(titleC);
    if (!title) refuse(titleC.loc, `vector ${id} has no title`);
    else checkText(titleC.loc, `vector ${id}'s title`, title);
    const coversText = cellText(coversC);
    const covers = coversText ? coversText.split(",").map((c) => c.trim()) : [];
    checkCovers(covers, coversC.loc);
    const call = codeCell(callC);
    const expected = codeCell(expC);
    const pc = call === null ? null : parseCall(call);
    if (pc && isLiteralError(pc))
      refuse(callC.loc, `Call: ${pc.message}`, pc.col);
    const pe = expected === null ? null : parseLiteral(expected);
    if (pe && isLiteralError(pe))
      refuse(expC.loc, `Expected: ${pe.message}`, pe.col);
    let settled: ReturnType<typeof settleVector> | null = null;
    if (pc && !isLiteralError(pc)) {
      const fn = fnByName.get(pc.call);
      if (!fn)
        refuse(
          callC.loc,
          `"${pc.call}" is not a function of the ts-interface block`,
        );
      else if (fn.module !== undefined)
        refuse(
          callC.loc,
          `Call: ${pc.call} is a reference function of ${fn.module}; a vector tests ${module}, the module under test, so call one of its functions`,
        );
      else if (pe && !isLiteralError(pe)) {
        settled = settleVector(fn, pc.args, pe);
        if (Array.isArray(settled))
          for (const e of settled)
            refuse(
              e.cell === "Call" ? callC.loc : expC.loc,
              `${e.cell}: ${e.message}`,
            );
      }
    }
    const expect =
      settled !== null && !Array.isArray(settled) ? settled.expect : null;
    const source = sourceCell(srcC, expect);
    if (
      refusals.length > before ||
      !source ||
      !pc ||
      isLiteralError(pc) ||
      !settled ||
      Array.isArray(settled)
    )
      return null;
    return {
      kind: "vector",
      id,
      title,
      covers,
      source,
      // Section sits before call; a cited vector's section is in its source.
      ...("cite" in source ? {} : { section }),
      call: pc.call,
      args: settled.args,
      expect: settled.expect,
    };
  }

  /** The Source cell, judged against the settled Expected when there is one. */
  function sourceCell(
    td: XmlNode,
    expect: VectorClause["expect"] | null,
  ): VectorSource | null {
    const el = only(td);
    if (el?.name === "tt") {
      const command = rawText(el);
      if (command.trim() === "") {
        refuse(td.loc, "Source: a command is a shell command, not blank");
        return null;
      }
      // What a command prints is compared as bytes (hex) or a string.
      if (
        expect &&
        !("hex" in expect || "ascii" in expect || "concat" in expect) &&
        !("str" in expect)
      ) {
        refuse(
          td.loc,
          `Source: a command prints bytes or a string, so its Expected is one, not ${kindOf(expect)}`,
        );
        return null;
      }
      return { command };
    }
    if (el?.name === "xref") {
      const target = el.attrs.target ?? "";
      const section = el.attrs.section;
      if (section !== undefined) {
        const n = citedRfc(el);
        if (n === null) return null;
        cited.add(n);
        return {
          cite: n === mainRfc ? { section } : { source: rfcId(n), section },
        };
      }
      const num = doc.sectionByAnchor.get(target);
      if (num === undefined) {
        refuse(
          el.loc,
          `Source names "${target}", which is no numbered section`,
        );
        return null;
      }
      if (mainRfc !== undefined) {
        refuse(el.loc, ownText(`Source ${target}, a section of the spec,`));
        return null;
      }
      const isSpec = expect !== null && ("null" in expect || "bool" in expect);
      return isSpec ? { spec: num } : { cite: { section: num } };
    }
    refuse(
      td.loc,
      "Source must be {{Section N of RFCx}}, a section anchor, or a single code span",
    );
    return null;
  }

  // -- properties, read by their front end against the interface.
  const properties: PropertyClause[] = [];
  const propertyLocs: Loc[] = [];
  for (const node of code) {
    const fe = fronted(node, "property");
    if (!fe) continue;
    const r = fe.parseProperty(codeOf(node).text, functions);
    if ("refusals" in r) {
      frontRefuse(node, r.refusals);
      continue;
    }
    const at = codeOf(node).loc;
    checkId(r.id, at);
    checkCovers(r.covers, at);
    checkText(at, `property ${r.id}'s title`, r.title ?? "");
    const { forall, where, assert } = r.clause;
    properties.push({
      kind: "property",
      id: r.id,
      title: r.title ?? "",
      covers: r.covers,
      forall,
      ...(where === undefined ? {} : { where }),
      assert,
    });
    propertyLocs.push(at);
  }

  // -- every section cited in an RFC used as a source exists.
  for (const x of xrefs) {
    const n = referenced.get(x.attrs.target ?? "");
    const section = x.attrs.section;
    if (n === undefined || section === undefined || !cited.has(n)) continue;
    if (!findSection(rfc(n), section))
      refuse(x.loc, `Section ${section} of RFC${n} does not exist`);
  }

  if (refusals.length > 0) return sorted();
  // Only now: when something was refused, an empty list is its consequence.
  if (requirements.length === 0)
    refuse(doc.root.loc, "a spec needs at least one requirement");
  if (vectors.length + properties.length === 0)
    refuse(
      doc.root.loc,
      "a spec needs at least one clause: a vector table row or a ts-property block",
    );
  if (refusals.length > 0) return sorted();

  // The coverage gate's two checks, refused here at a line: a binding
  // requirement is covered by some clause, and a property tests something.
  const covered = new Set([...vectors, ...properties].flatMap((k) => k.covers));
  for (const q of requirements)
    if (BINDING_LEVELS.has(q.level) && !covered.has(q.id))
      refuse(
        q.loc,
        `${q.id} is ${q.level}, but no clause covers it; cover it with a vector or a property, or follow it with an Untested: paragraph`,
      );
  const targets = new Set(
    functions.filter((f) => f.module === undefined).map((f) => f.name),
  );
  properties.forEach((k, i) => {
    const calls = callsIn(k.assert);
    if (calls.size === 0)
      refuse(
        propertyLocs[i],
        `property ${k.id}'s assertion calls none of the functions under test, so it checks nothing`,
      );
    else if (![...calls].some((f) => targets.has(f)))
      refuse(
        propertyLocs[i],
        `property ${k.id}'s assertion calls only reference functions (${[...calls].sort().join(", ")}); call a function of ${module}, the module under test`,
      );
  });
  if (refusals.length > 0) return sorted();

  if (mainRfc !== undefined && !cited.has(mainRfc) && mainKey)
    refuse(
      mainKey.loc,
      `RFC${mainRfc} is the main source, but nothing cites it; quote it in a requirement`,
    );
  if (refusals.length > 0) return sorted();

  const sources: SourceDecl[] = [
    ...(mainRfc === undefined
      ? [{ id: contract, path: `../specs/${contract}.xml` }]
      : []),
    ...[...cited].sort((a, b) => a - b).map((n) => ({ id: rfcId(n), rfc: n })),
  ];
  // What the main source says is in it, so names no source.
  const from = (q: Quoted) =>
    q.cite && q.cite.rfc !== mainRfc ? { source: rfcId(q.cite.rfc) } : {};
  const out = (q: Quoted): Requirement => ({
    id: q.id,
    ...from(q),
    section: q.section,
    level: q.level,
    quote: q.quote,
    ...(q.note === undefined ? {} : { note: q.note }),
  });
  const excl = (q: Quoted & { reason: string }): Exclusion => ({
    ...from(q),
    section: q.section,
    quote: q.quote,
    reason: q.reason,
  });
  const clauses: Clause[] = [...vectors, ...properties];
  const clauseLocs = [...vectorLocs, ...propertyLocs];
  const result: RfcContract = {
    contract,
    // An RFC main source takes the form RFC contracts have always had: the
    // RFC's number on source, its entry first in sources.
    source:
      mainRfc === undefined
        ? { title: doc.title, main: contract }
        : { rfc: mainRfc, title: doc.title },
    sources,
    target: { module },
    requirements: requirements.map(out),
    ...(mainRfc !== undefined && exclusions.length === 0
      ? {}
      : { exclusions: exclusions.map(excl) }),
    functions,
    clauses,
  };
  // The backstop: each value was checked where it was read, so this finds
  // nothing; if it ever does, the issue is refused at a line all the same.
  const shape = shapeRefusals(
    result,
    xmlPath,
    doc.root.loc,
    {
      requirements: requirements.map((q) => q.loc),
      exclusions: exclusions.map((q) => q.loc),
      clauses: clauseLocs,
      functions: fnLocs,
    },
    mdPath,
  );
  if (shape.length > 0) return { refusals: shape };
  // Where each id was read, for the gates' issues: the first wins.
  const root = where(doc.root.loc);
  const at: Record<string, number> = {};
  const files: Record<string, string> = {};
  const put = (key: string, loc: Loc) => {
    if (Object.hasOwn(at, key)) return;
    const w = where(loc);
    at[key] = w.line;
    if (w.file !== root.file) files[key] = w.file;
  };
  if (mainKey) put("source.main", mainKey.loc);
  for (const q of requirements) put(q.id, q.loc);
  for (const q of exclusions) put(`exclusion §${q.section}`, q.loc);
  clauses.forEach((k, i) => put(k.id, clauseLocs[i]));
  functions.forEach((f, i) => put(f.name, fnLocs[i]));
  return {
    contract: result,
    locator: {
      file: root.file,
      root: root.line,
      at,
      ...(Object.keys(files).length > 0 ? { files } : {}),
    },
  };
}

/**
 * Where a contract's parts were read: `at[key]` is the line of the
 * requirement, clause or function with that id or name, or of the first
 * exclusion in a section, keyed `exclusion §N` as the gates name it.
 */
export interface Locator {
  /** The file of `root`, and of each `at` line not in `files`. */
  file: string;
  /** The line of the document's root, for what names no part. */
  root: number;
  at: Record<string, number>;
  /**
   * The file of an `at` line when it is not `file`: the markdown for a part
   * read at a markdown line, or the XML for one read before the first.
   */
  files?: Record<string, string>;
}

/**
 * The file and line a gate issue's `at` names: the longest key that is `at`
 * or a prefix of it ending before a `.` (`V1.expect` is V1's line, and an id
 * may hold a dot), else the root.
 */
export function locate(l: Locator, at: string): { file: string; line: number } {
  for (let k = at; ; k = k.slice(0, k.lastIndexOf("."))) {
    if (Object.hasOwn(l.at, k))
      return { file: l.files?.[k] ?? l.file, line: l.at[k] };
    if (!k.includes(".")) return { file: l.file, line: l.root };
  }
}

/**
 * validateContractShape's issues with `contract`, each refused at the line of
 * the element its value came from: `locs.requirements[i]` for an issue under
 * `requirements[i]`, and so on; any other at `root`. Each is in the markdown
 * `md` at its markdown line when both are known, else in `file`. Sorted by
 * line.
 */
export function shapeRefusals(
  contract: RfcContract,
  file: string,
  root: Loc,
  locs: Record<"requirements" | "exclusions" | "clauses" | "functions", Loc[]>,
  md?: string,
): Refusal[] {
  return validateContractShape(contract)
    .map((issue) => {
      const m = issue.match(
        /^(requirements|exclusions|clauses|functions)\[(\d+)\]/,
      );
      const loc = (m && locs[m[1] as keyof typeof locs][Number(m[2])]) || root;
      return {
        ...whereOf(loc, file, md),
        message: `the contract read here is not valid: ${issue}`,
      };
    })
    .sort((a, b) => a.line - b.line);
}
