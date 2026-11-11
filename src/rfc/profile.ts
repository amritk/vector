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
//   exclusion     a requirement followed by a `<t>` starting `Untested: `
//   property      a `ts-property` block, read by the front end of its language
//   vector        a row of a table headed Id | Call | Expected | Covers | Source | Title
//
// Every BCP 14 sentence must be a requirement or an exclusion, every xref to
// an RFC must have a `<reference>`, and every section cited must exist in
// the RFC the resolver returns. A refusal names the markdown line where the
// XML carries kramdown-rfc's `<?line N?>`, else the XML line. That line can
// run late after a table: kramdown-rfc writes no `<?line?>` inside one, so a
// refusal past it names the last line it did write.

import {
  type Clause,
  type Exclusion,
  type FnSig,
  LEVELS,
  type Level,
  type PropertyClause,
  type Requirement,
  type RfcContract,
  type SourceDecl,
  type VectorClause,
  type VectorSource,
} from "./contract.ts";
import { frontEndFor } from "./front/index.ts";
import {
  isLiteralError,
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
  file: string;
  /** The markdown line when the XML carries `<?line N?>`, else the XML line. */
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

const DEFINITION = "Definition: ";
const UNTESTED = "Untested: ";
const RFC_TARGET_RE = /^RFC([0-9]+)$/;
const KEYWORD_RE = new RegExp(
  `(?<!")\\b(${LEVELS.filter((l) => l !== "DEFINITION")
    .map((l) => l.replace(" ", "\\s+"))
    .join("|")})\\b(?!")`,
);

const elements = (n: XmlNode): XmlNode[] => n.children.filter(isElement);
const lineOf = (loc: Loc): number => loc.mdLine ?? loc.xmlLine;
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
  cite?: { rfc: number; section: string; loc: Loc };
  loc: Loc;
}

export function profileToContract(
  doc: V3Document,
  xmlPath: string,
  resolve: RfcResolver,
): { contract: RfcContract } | { refusals: Refusal[] } {
  const refusals: Refusal[] = [];
  const refuse = (loc: Loc, message: string, col?: number) => {
    const r: Refusal = { file: xmlPath, line: lineOf(loc), message };
    if (col !== undefined) r.col = col;
    refusals.push(r);
  };

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
  const sectionOf = (n: number, section: string, loc: Loc) => {
    const sec = findSection(rfc(n), section);
    if (!sec) refuse(loc, `Section ${section} of RFC${n} does not exist`);
    return sec;
  };
  const referenced = new Map<string, number | undefined>(
    doc.references.map((r) => [r.anchor, r.rfc]),
  );
  /** The RFC an xref with a section cites, or a refusal. */
  const citedRfc = (x: XmlNode): number | null => {
    const target = x.attrs.target ?? "";
    const n = referenced.get(target);
    if (n === undefined) {
      refuse(x.loc, `xref to "${target}" names no RFC <reference>`);
      return null;
    }
    return n;
  };

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
  } else contract = name;

  const sections = sectionsOf(doc.root);

  // -- xrefs: every RFC xref has a reference, every cited section exists.
  for (const x of descendants(doc.root)) {
    if (x.name !== "xref") continue;
    const target = x.attrs.target ?? "";
    if (!referenced.has(target)) {
      if (RFC_TARGET_RE.test(target))
        refuse(x.loc, `xref to ${target} has no <reference> for it`);
      continue;
    }
    const n = referenced.get(target);
    const section = x.attrs.section;
    if (n !== undefined && section !== undefined) sectionOf(n, section, x.loc);
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
    const at = lineOf(codeOf(node).loc);
    for (const r of rs) refuse({ xmlLine: at + r.line - 1 }, r.message, r.col);
  };
  const interfaces = code.filter((c) => fronted(c, "interface"));
  let functions: FnSig[] = [];
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
    }
  }
  const fnByName = new Map(functions.map((f) => [f.name, f]));

  // -- requirements and exclusions.
  const requirements: Quoted[] = [];
  const exclusions: (Quoted & { reason: string })[] = [];
  const handled = new Set<Loc>();
  const bcp14Under = (n: XmlNode) =>
    descendants(n)
      .filter((d) => d.name === "bcp14")
      .map((d) => d.loc);
  const readBlock = (n: XmlNode, section: string): Quoted | null => {
    const anchor = n.attrs.anchor;
    if (anchor === undefined) return null;
    if (n.name === "t") {
      const text = plainText(n);
      if (text.startsWith(DEFINITION))
        return {
          id: anchor,
          section,
          quote: text.slice(DEFINITION.length),
          level: "DEFINITION",
          loc: n.loc,
        };
      const locs = new Set(bcp14Under(n));
      const found = doc.normative.filter((e) => locs.has(e.loc));
      if (found.length === 0) return null;
      const sentences = [...new Set(found.map((e) => e.sentence))];
      if (sentences.length > 1) {
        refuse(
          n.loc,
          `${anchor} holds ${sentences.length} BCP 14 sentences; give each its own anchor`,
        );
        return null;
      }
      return {
        id: anchor,
        section,
        quote: found[0].sentence,
        level: found[0].level,
        loc: n.loc,
      };
    }
    if (n.name !== "blockquote") return null;
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
        `blockquote ${anchor} must be <t> paragraphs, the last ending with {{Section N of RFCx}}`,
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
    const kw = quote.match(KEYWORD_RE)?.[1].replace(/\s+/, " ");
    return {
      id: anchor,
      section: x.attrs.section,
      quote,
      level: (kw ?? "DEFINITION") as Level,
      cite: { rfc: n2, section: x.attrs.section, loc: x.loc },
      loc: n.loc,
    };
  };
  const tables: { node: XmlNode; section: string }[] = [];
  const blocks = (parent: XmlNode, section: string) => {
    const kids = elements(parent).filter(
      (c) => c.name !== "name" && c.name !== "section",
    );
    kids.forEach((n, i) => {
      if (n.name === "table") {
        tables.push({ node: n, section });
        return;
      }
      if (n.name !== "t" && n.name !== "blockquote") {
        blocks(n, section);
        return;
      }
      const q = readBlock(n, section);
      if (!q) return;
      for (const l of bcp14Under(n)) handled.add(l);
      if (section === LOOSE_SECTION && !q.cite) {
        refuse(
          n.loc,
          `${q.id} is in an unnumbered section; a requirement needs a section number`,
        );
        return;
      }
      const next = kids[i + 1];
      const untested = next?.name === "t" ? plainText(next) : "";
      if (untested.startsWith(UNTESTED)) {
        for (const l of bcp14Under(next)) handled.add(l);
        exclusions.push({ ...q, reason: untested.slice(UNTESTED.length) });
      } else requirements.push(q);
    });
    // An unanchored BCP 14 paragraph excluded by the paragraph after it.
    kids.forEach((n, i) => {
      const next = kids[i + 1];
      if (n.name !== "t" || n.attrs.anchor !== undefined) return;
      if (next?.name !== "t" || !plainText(next).startsWith(UNTESTED)) return;
      const locs = new Set(bcp14Under(n));
      const found = doc.normative.filter((e) => locs.has(e.loc));
      if (found.length === 0) return;
      for (const l of locs) handled.add(l);
      if (section === LOOSE_SECTION) {
        refuse(
          n.loc,
          "an excluded sentence is in an unnumbered section; it needs a section number",
        );
        return;
      }
      exclusions.push({
        id: "",
        section,
        quote: plainText(n),
        level: found[0].level,
        loc: n.loc,
        reason: plainText(next).slice(UNTESTED.length),
      });
    });
  };
  for (const s of sections) blocks(s.node, s.id);
  for (const e of doc.normative) {
    if (handled.has(e.loc)) continue;
    refuse(
      e.loc,
      `BCP 14 sentence has no anchor and no Untested: paragraph after it: "${e.sentence}"`,
    );
  }

  // Blockquote quotes against the RFC they quote.
  const cited = new Set<number>();
  for (const q of [...requirements, ...exclusions]) {
    if (!q.cite) continue;
    cited.add(q.cite.rfc);
    const sec = sectionOf(q.cite.rfc, q.cite.section, q.cite.loc);
    if (sec && !sectionText(sec).includes(normalizeText(q.quote)))
      refuse(
        q.loc,
        `${q.id || "the quote"} is not in Section ${q.cite.section} of RFC${q.cite.rfc}: "${q.quote}"`,
      );
  }
  const ids = new Set(requirements.map((r) => r.id));
  const checkCovers = (covers: string[], loc: Loc) => {
    for (const c of covers)
      if (!ids.has(c))
        refuse(loc, `Covers names "${c}", which is no requirement`);
  };

  // -- vectors.
  const vectors: VectorClause[] = [];
  for (const t of tables) readTable(t.node, t.section);

  function readTable(table: XmlNode, section: string) {
    const rows = descendants(table).filter((n) => n.name === "tr");
    const cellsOf = (tr: XmlNode) =>
      elements(tr).filter((c) => c.name === "td" || c.name === "th");
    const header = rows[0] ? cellsOf(rows[0]).map(plainText) : [];
    if (header[0] !== "Id") return;
    if (header.join("|") !== VECTOR_HEADER.join("|")) {
      refuse(
        table.loc,
        `a vector table's header is ${VECTOR_HEADER.join(" | ")}, not ${header.join(" | ")}`,
      );
      return;
    }
    if (section === LOOSE_SECTION) {
      refuse(
        table.loc,
        "a vector table is in an unnumbered section; it needs a section number",
      );
      return;
    }
    for (const tr of rows.slice(1)) {
      const v = readRow(cellsOf(tr), section, tr);
      if (v) vectors.push(v);
    }
  }

  function codeCell(td: XmlNode): string | null {
    const tt = only(td);
    if (tt?.name === "tt") return plainText(tt);
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
    const [idC, callC, expC, coversC, srcC, titleC] = cells;
    const id = plainText(idC);
    const call = codeCell(callC);
    const expected = codeCell(expC);
    const title = plainText(titleC);
    if (!title) refuse(titleC.loc, `vector ${id} has no title`);
    const covers = plainText(coversC)
      .split(",")
      .map((c) => c.trim())
      .filter((c) => c);
    checkCovers(covers, coversC.loc);
    if (call === null || expected === null) return null;
    const pc = parseCall(call);
    if (isLiteralError(pc)) {
      refuse(callC.loc, `Call: ${pc.message}`, pc.col);
      return null;
    }
    const pe = parseLiteral(expected);
    if (isLiteralError(pe)) {
      refuse(expC.loc, `Expected: ${pe.message}`, pe.col);
      return null;
    }
    const fn = fnByName.get(pc.call);
    if (!fn) {
      refuse(
        callC.loc,
        `"${pc.call}" is not a function of the ts-interface block`,
      );
      return null;
    }
    const settled = settleVector(fn, pc.args, pe);
    if (typeof settled === "string") {
      refuse(callC.loc, settled);
      return null;
    }
    const isSpec = "null" in settled.expect || "bool" in settled.expect;
    const source = sourceCell(srcC, isSpec);
    if (!source) return null;
    if (!title) return null;
    const v: VectorClause = {
      kind: "vector",
      id,
      title,
      covers,
      source,
      call: pc.call,
      args: settled.args,
      expect: settled.expect,
    };
    if (!("cite" in source)) {
      // The key order a contract writes: section before call.
      return {
        kind: v.kind,
        id,
        title,
        covers,
        source,
        section,
        call: v.call,
        args: v.args,
        expect: v.expect,
      };
    }
    return v;
  }

  function sourceCell(td: XmlNode, isSpec: boolean): VectorSource | null {
    const el = only(td);
    if (el?.name === "tt") return { command: plainText(el) };
    if (el?.name === "xref") {
      const target = el.attrs.target ?? "";
      const section = el.attrs.section;
      if (section !== undefined) {
        const n = citedRfc(el);
        if (n === null) return null;
        cited.add(n);
        return { cite: { source: rfcId(n), section } };
      }
      const num = doc.sectionByAnchor.get(target);
      if (num === undefined) {
        refuse(
          el.loc,
          `Source names "${target}", which is no numbered section`,
        );
        return null;
      }
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
  for (const node of code) {
    const fe = fronted(node, "property");
    if (!fe) continue;
    const r = fe.parseProperty(codeOf(node).text, functions);
    if ("refusals" in r) {
      frontRefuse(node, r.refusals);
      continue;
    }
    checkCovers(r.covers, codeOf(node).loc);
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
  }

  if (refusals.length > 0) {
    refusals.sort(
      (a, b) =>
        a.line - b.line ||
        (a.col ?? 0) - (b.col ?? 0) ||
        (a.message < b.message ? -1 : a.message > b.message ? 1 : 0),
    );
    return { refusals };
  }

  const sources: SourceDecl[] = [
    { id: contract, path: `../specs/${contract}.xml` },
    ...[...cited].sort((a, b) => a - b).map((n) => ({ id: rfcId(n), rfc: n })),
  ];
  const from = (q: Quoted) => (q.cite ? { source: rfcId(q.cite.rfc) } : {});
  const out = (q: Quoted): Requirement => ({
    id: q.id,
    ...from(q),
    section: q.section,
    level: q.level,
    quote: q.quote,
  });
  const excl = (q: Quoted & { reason: string }): Exclusion => ({
    ...from(q),
    section: q.section,
    quote: q.quote,
    reason: q.reason,
  });
  const clauses: Clause[] = [...vectors, ...properties];
  return {
    contract: {
      contract,
      source: { title: doc.title, main: contract },
      sources,
      target: { module },
      requirements: requirements.map(out),
      exclusions: exclusions.map(excl),
      functions,
      clauses,
    },
  };
}
