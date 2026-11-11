// The deterministic gates a contract passes before it may become a test. None
// of them consults a model; each failure is a precise, repairable message.
//
//   shape        the JSON has the RfcContract form
//   typing       every call and expression is well-typed against `functions`
//   coverage     every MUST/SHALL/REQUIRED requirement is cited by a clause, and
//                every citation names a real requirement (anti-gaming: a
//                contract cannot drop a requirement or invent one)
//   fidelity     every quote appears in its cited section of its source
//                document; every hex/ascii/str a vector uses appears in the
//                section it cites, and every labelled int appears there right
//                after its label, on the same line (an unlabelled int is
//                reported as unchecked)
//   completeness every MUST/SHALL/REQUIRED of the main source is quoted by a
//                requirement or an exclusion (in RFC XML, every one its
//                <bcp14> markup marks)
//   provenance   every vector says where its expected value comes from, and it
//                does: printed in the cited section, stated by the spec
//                section (null/bool only), or printed by a source command run
//                under --run-sources
//   signatures   (with the module source) the declared signatures are the
//                implementation's exported ones
//
// Non-vacuity of property domains needs Z3 and lives in sample.ts.

import {
  BINDING_LEVELS,
  type Citation,
  type Clause,
  type ExprTy,
  type FnSig,
  type Literal,
  type RfcContract,
  type SigTy,
  type TypeEnv,
  type ValueTy,
  type VectorClause,
  assignable,
  bytesToHex,
  callsIn,
  citeLabel,
  declaredSources,
  literalBytes,
  sourceOf,
  typeOf,
  typeOfLiteral,
  validateContractShape,
  valueTy,
  vectorArgsAt,
} from "./contract.ts";
import {
  type HexValue,
  KEYWORD_RE,
  type RfcDocument,
  type RfcSection,
  findSection,
  hexPrinted,
  hexValues,
  intLabelCount,
  intRounds,
  normalizeText,
  normativeSentences,
  ownSpans,
  sectionLines,
  sectionSpans,
  sectionText,
} from "./rfctext.ts";
import type { V3Document } from "./xmlv3.ts";

export interface GateIssue {
  gate:
    | "shape"
    | "typing"
    | "coverage"
    | "fidelity"
    | "completeness"
    | "provenance"
    | "signatures";
  at: string;
  message: string;
}

export interface GateWarning {
  at: string;
  message: string;
}

export interface GateResult {
  ok: boolean;
  issues: GateIssue[];
  warnings: GateWarning[];
  /** Requirement id → the clause ids that cite it. */
  coverage: Map<string, string[]>;
}

/** What running a vector's source command showed. */
export interface SourceRun {
  id: string;
  command: string;
  outcome: "pass" | "fail";
  detail?: string;
}

export interface GateOptions {
  /**
   * The main source's text (a single-RFC contract's RFC); without it, and
   * without `docs`, the fidelity gates are skipped (and say so).
   */
  rfc?: RfcDocument;
  /**
   * Every source's text, by source id. A declared source missing here is a
   * fidelity failure: a cited document that cannot be read fails closed.
   */
  docs?: Map<string, RfcDocument>;
  /** Source command results by vector id (from --run-sources). */
  commands?: Map<string, SourceRun>;
  /** The target module's source; without it the signature gate is skipped. */
  moduleSource?: string;
}

export function runGates(input: unknown, opts: GateOptions = {}): GateResult {
  const issues: GateIssue[] = [];
  const warnings: GateWarning[] = [];
  const coverage = new Map<string, string[]>();

  const shape = validateContractShape(input);
  if (shape.length > 0) {
    return {
      ok: false,
      issues: shape.map((m) => ({ gate: "shape", at: "", message: m })),
      warnings,
      coverage,
    };
  }
  const c = input as RfcContract;

  // Ids are unique within their kind.
  const dupes = (ids: string[], what: string) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) {
        issues.push({
          gate: "shape",
          at: id,
          message: `duplicate ${what} id "${id}"`,
        });
      }
      seen.add(id);
    }
  };
  dupes(
    c.requirements.map((r) => r.id),
    "requirement",
  );
  dupes(
    c.functions.map((f) => f.name),
    "function",
  );
  dupes(
    c.clauses.map((k) => k.id),
    "clause",
  );

  checkTyping(c, issues);
  checkCoverage(c, issues, warnings, coverage);

  const { main, list } = declaredSources(c);
  const docs = new Map(opts.docs);
  if (opts.rfc && !docs.has(main)) docs.set(main, opts.rfc);
  if (opts.docs || opts.rfc) {
    for (const d of list) {
      const doc = docs.get(d.id);
      if (!doc) {
        issues.push({
          gate: "fidelity",
          at: `sources.${d.id}`,
          message: `the text of source "${d.id}" was not given, so nothing citing it can be checked`,
        });
      } else if (
        d.rfc !== undefined &&
        doc.number !== null &&
        doc.number !== d.rfc
      ) {
        issues.push({
          gate: "fidelity",
          at: c.sources ? `sources.${d.id}.rfc` : "source.rfc",
          message: `the contract cites RFC ${d.rfc} but the text is RFC ${doc.number}`,
        });
      }
    }
    checkFidelity(c, docs, issues, warnings);
    const mainDoc = docs.get(main);
    if (mainDoc) checkCompleteness(c, main, mainDoc, docs, issues, warnings);
  } else {
    warnings.push({
      at: "fidelity",
      message:
        "no RFC text given: quotes and test vectors were NOT checked against the RFC",
    });
  }
  checkProvenance(c, docs, opts.commands, issues, warnings);

  if (opts.moduleSource !== undefined) {
    checkSignatures(c, opts.moduleSource, issues);
  }

  return { ok: issues.length === 0, issues, warnings, coverage };
}

function checkTyping(c: RfcContract, issues: GateIssue[]): void {
  const fns = new Map<string, FnSig>(c.functions.map((f) => [f.name, f]));
  for (const f of c.functions) {
    const names = new Set<string>();
    for (const p of f.params) {
      if (names.has(p.name)) {
        issues.push({
          gate: "typing",
          at: f.name,
          message: `duplicate parameter "${p.name}"`,
        });
      }
      names.add(p.name);
    }
  }
  for (const k of c.clauses) {
    const errors: string[] = [];
    if (k.kind === "vector") {
      const sig = fns.get(k.call);
      if (!sig) errors.push(`unknown function "${k.call}"`);
      else {
        if (k.args.length !== sig.params.length) {
          errors.push(
            `${k.call} takes ${sig.params.length} argument(s), got ${k.args.length}`,
          );
        }
        k.args.forEach((a, i) => {
          const p = sig.params[i];
          if (p && !literalFits(a, valueTy(p.type))) {
            errors.push(
              `args[${i}]: ${k.call}(${p.name}) wants ${valueTy(p.type)}, got ${typeOfLiteral(a)}`,
            );
          }
        });
        if (!literalFits(k.expect, valueTy(sig.returns))) {
          errors.push(
            `expect: ${k.call} returns ${valueTy(sig.returns)}, got ${typeOfLiteral(k.expect)}`,
          );
        }
      }
    } else {
      const vars = new Map<string, ValueTy>();
      for (const v of k.forall) {
        if (vars.has(v.name)) errors.push(`duplicate variable "${v.name}"`);
        vars.set(v.name, v.type);
      }
      if (k.where) {
        const env: TypeEnv = { fns, vars, allowCalls: false };
        const t = typeOf(k.where, env, "where", errors);
        if (t !== null && t !== "bool")
          errors.push(`where: must be bool, got ${t}`);
      }
      const env: TypeEnv = { fns, vars, allowCalls: true };
      const t = typeOf(k.assert, env, "assert", errors);
      if (t !== null && t !== "bool")
        errors.push(`assert: must be bool, got ${t}`);
    }
    for (const m of errors)
      issues.push({ gate: "typing", at: k.id, message: m });
  }
}

/** A literal can stand for a value of type `ty` (u32 takes any non-negative int). */
function literalFits(lit: Literal, ty: ValueTy): boolean {
  const t: ExprTy = typeOfLiteral(lit);
  if ("int" in lit) {
    if (ty === "u32") return lit.int >= 0 && lit.int <= 4294967295;
    if (ty === "i32") return lit.int >= -2147483648 && lit.int <= 2147483647;
    return false;
  }
  return assignable(t, ty);
}

function checkCoverage(
  c: RfcContract,
  issues: GateIssue[],
  warnings: GateWarning[],
  coverage: Map<string, string[]>,
): void {
  const reqs = new Map(c.requirements.map((r) => [r.id, r]));
  for (const r of c.requirements) coverage.set(r.id, []);
  for (const k of c.clauses) {
    for (const id of k.covers) {
      if (!reqs.has(id)) {
        issues.push({
          gate: "coverage",
          at: k.id,
          message: `cites requirement "${id}", which the contract does not state`,
        });
      } else {
        coverage.get(id)?.push(k.id);
      }
    }
  }
  for (const r of c.requirements) {
    if ((coverage.get(r.id) ?? []).length > 0) continue;
    if (BINDING_LEVELS.has(r.level)) {
      issues.push({
        gate: "coverage",
        at: r.id,
        message: `${r.level} requirement (${c.sources ? "" : "RFC "}${citeLabel(c, r)}) is not checked by any clause`,
      });
    } else {
      warnings.push({
        at: r.id,
        message: `${r.level} requirement is not checked by any clause`,
      });
    }
  }
  // Covering a requirement is a claim, so the clause making it has to test
  // something. A property whose assertion never calls a function under test
  // holds (or fails) whatever the implementation does, so it would "cover" a
  // requirement for free. This is a floor, not a measure of strength: a weak
  // assertion that does call a function is `spec mutate`'s to find.
  for (const k of c.clauses) {
    if (k.kind !== "property") continue;
    if (callsIn(k.assert).size === 0) {
      issues.push({
        gate: "coverage",
        at: k.id,
        message:
          "the assertion calls none of the functions under test, so it holds whatever the implementation does and checks nothing",
      });
    }
  }
  if (!c.clauses.some((k) => k.kind === "property")) {
    warnings.push({
      at: "clauses",
      message:
        "no property clauses: the contract checks only the RFC's own vectors",
    });
  }
}

/** The cited section, or an issue saying why there is none. */
function citedSection(
  c: RfcContract,
  docs: Map<string, RfcDocument>,
  at: Citation,
  where: string,
  issues: GateIssue[],
) {
  const src = sourceOf(c, at.source);
  const doc = docs.get(src);
  if (!doc) return null; // reported once, as a missing source
  const sec = findSection(doc, at.section);
  if (!sec) {
    const name = doc.number !== null ? `RFC ${doc.number}` : `source "${src}"`;
    issues.push({
      gate: "fidelity",
      at: where,
      message: `${name} has no section ${at.section}`,
    });
  }
  return sec;
}

/** "RFC §A.1" in the main RFC, "§3.1" in a main markdown spec, "rfc4648 §10" elsewhere. */
function place(
  c: RfcContract,
  docs: Map<string, RfcDocument>,
  at: Citation,
): string {
  const label = citeLabel(c, at);
  const main = sourceOf(c, at.source) === declaredSources(c).main;
  return main && docs.get(declaredSources(c).main)?.number != null
    ? `RFC ${label}`
    : label;
}

function checkFidelity(
  c: RfcContract,
  docs: Map<string, RfcDocument>,
  issues: GateIssue[],
  warnings: GateWarning[],
): void {
  for (const r of c.requirements) {
    const sec = citedSection(c, docs, r, r.id, issues);
    if (sec && !sectionText(sec).includes(normalizeText(r.quote))) {
      issues.push({
        gate: "fidelity",
        at: r.id,
        message: `quote not found in ${place(c, docs, r)} ("${sec.title}"): ${JSON.stringify(r.quote)}`,
      });
    }
  }
  for (const k of c.clauses) {
    if (k.kind !== "vector") continue;
    const at = vectorArgsAt(k);
    const sec = citedSection(c, docs, at, k.id, issues);
    if (!sec) continue;
    const where = place(c, docs, at);
    const check = literalCheck(sec, where, k.id, issues, warnings);
    const args = k.args.flatMap((a, i) => check(a, `args[${i}]`));
    // A command or spec source vouches for the expected value instead.
    const cited = "cite" in k.source;
    const word = resultWord(k.expect);
    const expect = cited && word === null ? check(k.expect, "expect") : [];
    oneTestCase(k.id, where, sec, args, expect, issues);
    ownVariant(k, where, sec, [...args, ...expect], issues, warnings);
    if (!cited) continue;
    if (word !== null) {
      const why = statesResult(c, docs, k, at, sec, word);
      if (why !== null)
        issues.push({
          gate: "fidelity",
          at: `${k.id}.expect`,
          message: `${place(c, docs, at)} ("${sec.title}") does not state the expected result: ${why}`,
        });
    }
  }
}

/** "null", "true" or "false" for an expected null or bool; null otherwise. */
function resultWord(lit: Literal): string | null {
  if ("null" in lit) return "null";
  return "bool" in lit ? String(lit.bool) : null;
}

// The allow list: an affirmative BCP 14 keyword (in capitals; MUST NOT and
// SHALL NOT never match, as "NOT" is not a verb), optionally "always", then
// a result verb in its bare form, then the value.
const RESULT_KEYWORD = "(?:MUST|SHALL|REQUIRED\\s+to)";
const RESULT_VERB = "(?:return|be|evaluate\\s+to|yield|give|output)";
// Anything before the keyword in its sentence that reverses, avoids or
// conditions the result. Deliberately broad: a false refusal costs a
// rewording, a false pass breaks the gate. Word edges are letters and digits
// (not \b), so `_not_` and `**never**` count; both apostrophes count in n't.
const DENY_RE = new RegExp(
  `(?<![A-Za-z0-9])(?:${[
    // negators
    "not",
    "never",
    "no",
    "none",
    "nor",
    "neither",
    "nothing",
    "nobody",
    "nowhere",
    "cannot",
    "[A-Za-z]+n['’]t",
    // avoiders
    "avoid[a-z]*",
    "forb[a-z]*",
    "prohibit[a-z]*",
    "prevent[a-z]*",
    "refus[a-z]*",
    "reject[a-z]*",
    "disallow[a-z]*",
    "instead",
    "rather",
    "except[a-z]*",
    "without",
    "unless",
    "fail[a-z]*",
    "error[a-z]*",
    "invalid[a-z]*",
    "illegal[a-z]*",
    "unlike",
    "other",
    "but",
    // conditions and hypotheticals
    "if",
    "when",
    "whenever",
    "while",
    "whether",
    "assum[a-z]*",
    "suppos[a-z]*",
    // examples, other parties and history: not this spec's own statement
    "example[a-z]*",
    "e\\.g",
    "i\\.e",
    "instance",
    "some",
    "earlier",
    "previous[a-z]*",
    "former[a-z]*",
    "draft[a-z]*",
    "said",
    "says",
    "historic[a-z]*",
    "legacy",
  ].join("|")})(?![A-Za-z0-9])`,
  "i",
);
// A sentence ends at . ; ! ? followed by whitespace and a capital (or an
// opening quote or bracket), or at the end of the text. Commas and colons
// never end one, and neither does "e.g. return".
const SENTENCE_END = /[.;!?](?=\s+["'“(\[A-Z]|\s*$)/;
// Right after the value: an alternative ("null or throw", "null, and 5") or
// a hyphen of any kind ("null-terminated", U+2010 to U+2015, U+2212).
// After a comma, colon, semicolon or opening bracket too: "null (or an empty
// array)", "null: or so the old text said".
const ALTERNATIVE_RE =
  /^\s*(?:[,:;([]\s*)?(?:(?:or|and|else|alternatively|either)(?![A-Za-z0-9])|[/\-\u2010-\u2015\u2212])/i;
// Right after the value: what may follow it when the value is the whole
// result. Punctuation or the end closes the clause; a connective starts a
// condition or circumstance ("null when the input is odd", "null on
// failure"). Anything else — "null checks", "true to RFC X" — makes the value
// a word in a longer phrase, not the stated result. An opening bracket
// starts an aside ("null (see below)"). `to` is left out on purpose:
// "MUST be true to RFC X" is not the result true, and so is `instead`, which
// RETRACT_RE refuses wherever it is. A connective only opens the condition:
// HEDGE_RE and another result in the rest of the sentence are refused too.
const CLAUSE_END_RE = new RegExp(
  `^(?:\\s*(?:$|[.,;:!?()[\\]])|\\s+(?:${[
    "when",
    "whenever",
    "if",
    "unless",
    "for",
    "on",
    "upon",
    "in",
    "at",
    "from",
    "after",
    "before",
    "otherwise",
    "because",
    "since",
    "as",
    "until",
    "while",
    "with",
    "without",
    "then",
    "here",
    "there",
    "immediately",
  ].join("|")})(?![A-Za-z0-9]))`,
  "i",
);
// Anywhere after the value in the rest of the quote: a word that withdraws,
// negates or condemns it ("…, but this was removed", "…, which is a bug").
const RETRACT_RE = new RegExp(
  `(?<![A-Za-z0-9])(?:${[
    "not",
    "never",
    "no",
    "none",
    "nor",
    "neither",
    "cannot",
    "[A-Za-z]+n['’]t",
    "avoid[a-z]*",
    "forb[a-z]*",
    "prohibit[a-z]*",
    "prevent[a-z]*",
    "disallow[a-z]*",
    "instead",
    "rather",
    "wrong[a-z]*",
    "incorrect[a-z]*",
    "bug[a-z]*",
    "an\\s+error",
    "but",
    "remov[a-z]*",
    "deprecat[a-z]*",
    "obsolete[a-z]*",
    "retract[a-z]*",
    "withdr[a-z]*",
    "supersed[a-z]*",
    "replaced",
  ].join("|")})(?![A-Za-z0-9])`,
  "i",
);

// Anywhere after the value in the rest of the quote: a word that makes it
// the result only sometimes, or only by someone's account ("true at most
// once", "null in some cases", "true with probability one half", "null, or
// so the old text said").
const HEDGE_RE = new RegExp(
  `(?<![A-Za-z0-9])(?:${[
    "at\\s+(?:most|least)",
    "some(?:times)?",
    "occasional[a-z]*",
    "usual[a-z]*",
    "often",
    "typical[a-z]*",
    "general[a-z]*",
    "most[a-z]*",
    "possib[a-z]*",
    "probab[a-z]*",
    "random[a-z]*",
    "perhaps",
    "maybe",
    "once",
    "twice",
    "times",
    "elsewhere",
    "said",
    "claim[a-z]*",
  ].join("|")})(?![A-Za-z0-9])`,
  "i",
);
// Anywhere after the value in the rest of the quote: another result ("null,
// then retry and return 5", "false here and true elsewhere").
const otherResultRe = (word: string): RegExp =>
  new RegExp(
    `(?<![A-Za-z0-9])(?:${[
      ...["true", "false", "null"].filter((w) => w !== word.toLowerCase()),
      "return[a-z]*",
      "yield[a-z]*",
    ].join("|")})(?![A-Za-z0-9])`,
    "i",
  );

/**
 * The section's prose, whitespace-collapsed, and the spans of its sentences
 * in that text. Prose is its lines without code, table cells or blockquotes
 * (as the markdown reader marks them; in an RFC, lines starting with ">"):
 * a requirement stated only there is an example, a quotation or a cell, not
 * the section's own statement. Sentences are the heading line on its own,
 * then each paragraph (up to a blank line) cut at SENTENCE_END.
 */
const proseSentences = (
  sec: RfcSection,
): { text: string; spans: [number, number][] } => {
  const lines = (sec.proseLines ?? sec.lines).map((l) =>
    /^\s*>/.test(l) ? "" : l,
  );
  const paras: string[][] = [[lines[0] ?? ""], []];
  for (const l of lines.slice(1)) {
    if (l.trim() === "") paras.push([]);
    else paras[paras.length - 1]?.push(l);
  }
  const sentences: string[] = [];
  const end = new RegExp(SENTENCE_END.source, "g");
  for (const para of paras) {
    const t = normalizeText(para.join("\n"));
    let from = 0;
    for (const m of t.matchAll(end)) {
      sentences.push(t.slice(from, m.index + 1).trim());
      from = m.index + 1;
    }
    sentences.push(t.slice(from).trim());
  }
  const spans: [number, number][] = [];
  let at = 0;
  for (const sentence of sentences.filter((x) => x !== "")) {
    spans.push([at, at + sentence.length]);
    at += sentence.length + 1;
  }
  return {
    text: sentences.filter((x) => x !== "").join(" "),
    spans,
  };
};

/**
 * Why one quote, found in the section's prose, does not state `word`, or
 * null when it does. The allow-list match must lie inside the quote, but
 * the guards read the whole prose sentence around it, so a quote cut out of
 * a qualified sentence ("Earlier drafts said that f MUST return null, but
 * …") is judged with what it left out: DENY_RE over the sentence before the
 * keyword, ALTERNATIVE_RE right after the value, and RETRACT_RE, HEDGE_RE
 * and another result over the rest of every sentence the quote touches.
 * Every occurrence of the quote in the prose must pass.
 */
const quoteStates = (
  quote: string,
  word: string,
  prose: { text: string; spans: [number, number][] },
): string | null => {
  // The value in any case ("False", "TRUE"), optionally in code or emphasis.
  const value = [...word].map((ch) => `[${ch}${ch.toUpperCase()}]`).join("");
  const re = new RegExp(
    `(?<![A-Za-z0-9])${RESULT_KEYWORD}\\s+(?:always\\s+)?${RESULT_VERB}\\s+[\`*_]*${value}[\`*_]*(?![A-Za-z0-9_\`*])`,
    "g",
  );
  const q = normalizeText(quote);
  const { text, spans } = prose;
  const spanAt = (i: number): [number, number] =>
    spans.find(([s, e]) => i >= s && i < e) ?? [i, i];
  const generic = `does not require "${word}" as the result (an affirmative MUST, SHALL or REQUIRED to, a result verb, then "${word}")`;
  const occurrence = (p: number): string | null => {
    let why = generic;
    const last = spanAt(p + q.length - 1)[1];
    for (const m of q.matchAll(re)) {
      const from = p + m.index;
      const to = from + m[0].length;
      const start = spanAt(from)[0];
      const deny = DENY_RE.exec(text.slice(start, from));
      if (deny) {
        if (start + deny.index + deny[0].length <= p)
          why = `is cut from a sentence that qualifies it before the quote ("${deny[0]}"), so the sentence does not require "${word}"`;
        continue;
      }
      const rest = text.slice(to);
      const alt = ALTERNATIVE_RE.exec(rest);
      if (alt) {
        why = `offers an alternative right after "${word}" ("${alt[0].trim()}"), so "${word}" is not the whole result`;
        continue;
      }
      if (!CLAUSE_END_RE.test(rest)) {
        const next = /^\s*([^\s.,;:!?)\]]+)/.exec(rest)?.[1] ?? "";
        why = `continues past "${word}" ("${word} ${next}"), so "${word}" is a word in a longer phrase, not the stated result (end the clause after it, or follow it with a condition such as "when …")`;
        continue;
      }
      const tail = text.slice(to, Math.max(last, spanAt(to - 1)[1]));
      const retract = RETRACT_RE.exec(tail);
      if (retract) {
        why = `retracts "${word}" after stating it ("${retract[0]}")`;
        continue;
      }
      // A hedge or a second result belongs to this statement only up to its
      // full stop, wherever SENTENCE_END would end the sentence: "to null.
      // isHex MUST be False" states two results, not one.
      const clause = tail.split(/[.!?](?:\s|$)/)[0] ?? "";
      const hedge = HEDGE_RE.exec(clause);
      if (hedge) {
        why = `hedges "${word}" after stating it ("${hedge[0]}"), so it is not the result each time`;
        continue;
      }
      const other = otherResultRe(word).exec(clause);
      if (other) {
        why = `states another result after "${word}" ("${other[0]}"), so "${word}" is not the whole result`;
        continue;
      }
      return null;
    }
    return why;
  };
  for (let p = text.indexOf(q); p >= 0; p = text.indexOf(q, p + 1)) {
    const why = occurrence(p);
    if (why !== null) return why;
  }
  return null;
};

/**
 * Does the section state `word` as the vector's result? Only through a
 * requirement the vector covers, cited to that very section, whose verbatim
 * quote (in the section's prose, not a code block, blockquote or table) says
 * MUST, SHALL or REQUIRED to (never followed by NOT), optionally "always",
 * a result verb, then `word` as a whole word; with nothing before the keyword
 * in its prose sentence (inside the quote or not) matching DENY_RE, no
 * alternative or hyphen right after the value, the value ending its clause
 * (CLAUSE_END_RE: punctuation, the end, or a condition such as "when …"
 * next, never "null checks" or "true to"), and no retraction, hedge or
 * other result in the rest of any sentence the quote touches. Returns why it does not, or
 * null when it does. Everything this does not recognise is refused.
 */
function statesResult(
  c: RfcContract,
  docs: Map<string, RfcDocument>,
  k: VectorClause,
  at: Citation,
  sec: RfcSection,
  word: string,
): string | null {
  const src = sourceOf(c, at.source);
  const doc = docs.get(src);
  const covered = c.requirements.filter(
    (r) =>
      k.covers.includes(r.id) &&
      sourceOf(c, r.source) === src &&
      doc !== undefined &&
      findSection(doc, r.section) === sec,
  );
  if (covered.length === 0)
    return `${k.id} covers no requirement cited to it, so nothing there requires the result "${word}"`;
  const prose = proseSentences(sec);
  const reasons: string[] = [];
  for (const r of covered) {
    if (!prose.text.includes(normalizeText(r.quote))) {
      reasons.push(
        `${r.id} is not in its prose (only in code, a blockquote or a table)`,
      );
      continue;
    }
    const why = quoteStates(r.quote, word, prose);
    if (why === null) return null;
    reasons.push(`${r.id} ${why}`);
  }
  return reasons.join("; ");
}

/**
 * How a section prints an empty value: an empty quoted string (RFC 4648 §10's
 * `BASE16("") = ""`) or a zero length (RFC 5869 A.3's `salt = (0 octets)`).
 */
const EMPTY_PRINTED_RE = /""|\(0 octets\)/;

/** A literal whose value is empty: the empty string or no bytes. */
function isEmptyValue(lit: Literal): boolean {
  if ("str" in lit) return lit.str === "";
  if ("ascii" in lit) return lit.ascii === "";
  if ("hex" in lit) return lit.hex === "";
  return false;
}

/**
 * Where one literal of a vector was found: a printed value's label (hex and
 * labelled ints), or the lines a string is printed on.
 */
type Bound =
  | { at: string; label: string | null; rounds?: Rounds }
  | { at: string; lines: Set<number>; text: string };

/**
 * A label printed more than once in a section (a parent of several test
 * cases, or one listing several cases under the same names, as RFC 7748
 * §5.2 does) is read in rounds: its k-th printing belongs with the k-th
 * printing of every other repeated label. `rounds` holds the printings that
 * carry the value; `of` is how many there are.
 */
type Rounds = { label: string; of: number; has: Set<number> };

const QUOTE_PAIRS: [string, string][] = [
  ['"', '"'],
  ["'", "'"],
  ["\u201c", "\u201d"],
  ["\u2018", "\u2019"],
  ["`", "`"],
];

/**
 * The lines (of `sectionLines`, joined by "\n") on which `value` is printed
 * as a whole value: inside quotes, as a markdown code span (`spans`, from
 * `sectionSpans`), as a whole line, or ending a line after "=" or ":". A
 * wrapped value counts on every line it spans. Never a substring of a longer
 * value: "Zg" is not printed by `"Zg=="`.
 */
function textLines(
  lines: string,
  spans: string[][],
  value: string,
): Set<number> {
  const v = value
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/ /g, "[ \\n]");
  const forms = [
    ...QUOTE_PAIRS.map(([o, c]) => `${o}(${v})${c}`),
    `(?<=^|\\n)(${v})(?=\\n|$)`,
    `[=:] ?(${v})(?=\\n|$)`,
  ];
  const found = new Set<number>();
  spans.forEach((on, i) => {
    if (on.includes(value)) found.add(i);
  });
  for (const form of forms) {
    for (const m of lines.matchAll(new RegExp(form, "g"))) {
      const from = (m.index ?? 0) + m[0].indexOf(m[1]);
      const first = lines.slice(0, from).split("\n").length - 1;
      const last = first + m[1].split("\n").length - 1;
      for (let i = first; i <= last; i++) found.add(i);
    }
  }
  return found;
}

const sameLabel = (a: string, b: string) =>
  normalizeText(a).toLowerCase() === normalizeText(b).toLowerCase();

const quoted = (labels: string[]) =>
  [...new Set(labels)].map((l) => `"${l}"`).join(" or ");

const ordinal = (n: number) =>
  `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;

/** Checks literals against one section's text. */
function literalCheck(
  sec: NonNullable<ReturnType<typeof findSection>>,
  where: string,
  id: string,
  issues: GateIssue[],
  warnings: GateWarning[],
): (lit: Literal, at: string) => Bound[] {
  const values = hexValues(sec);
  const text = sectionText(sec);
  const lines = sectionLines(sec);
  const spans = sectionSpans(sec);
  const fail = (at: string, message: string): Bound[] => {
    issues.push({ gate: "fidelity", at: `${id}.${at}`, message });
    return [];
  };
  const inSection = `${where} ("${sec.title}")`;
  const rounds = (label: string, of: number, has: number[]) =>
    of > 1 ? { rounds: { label, of, has: new Set(has) } } : {};
  const hexCheck = (
    at: string,
    hex: string,
    bytes: number,
    label: string | undefined,
  ): Bound[] => {
    const whole = values.filter((v) => v.hex === hex);
    if (whole.length === 0) {
      const part = values.find((v) => hexPrinted([v.hex], hex));
      return fail(
        at,
        part
          ? `${bytes}-byte value is only part of a value printed in ${inSection}${part.label ? ` (under "${part.label}")` : ""}: a vector uses whole printed values (concat them to join several)`
          : `${bytes}-byte value is not printed in ${inSection}`,
      );
    }
    const named = whole.filter((v) => v.label !== null) as (HexValue & {
      label: string;
    })[];
    if (label === undefined) {
      if (named.length === 0) return [{ at, label: null }];
      return fail(
        at,
        `the value is printed in ${inSection} under ${quoted(named.map((v) => v.label))}: name it with "label", so the contract says which printed value it is`,
      );
    }
    if (!named.some((v) => sameLabel(v.label, label)))
      return fail(
        at,
        named.length > 0
          ? `the value is printed in ${inSection} under ${quoted(named.map((v) => v.label))}, not under "${label}"`
          : `the value is printed in ${inSection}, but not under the label "${label}"`,
      );
    const under = values.filter(
      (v) => v.label !== null && sameLabel(v.label, label),
    );
    const has = under.flatMap((v, i) => (v.hex === hex ? [i] : []));
    return [{ at, label, ...rounds(label, under.length, has) }];
  };
  const check = (lit: Literal, at: string): Bound[] => {
    if ("concat" in lit) {
      return lit.concat.flatMap((p, i) => check(p, `${at}.concat[${i}]`));
    }
    if ("unchecked" in lit && lit.unchecked) {
      warnings.push({
        at: `${id}.${at}`,
        message: `not checked against the RFC: ${lit.unchecked}`,
      });
      return [];
    }
    if (isEmptyValue(lit)) {
      // "" is in every text and the empty hex run in every section, so an
      // empty value is found only where the section prints one.
      if (!EMPTY_PRINTED_RE.test(text))
        return fail(
          at,
          `the empty value is not printed in ${inSection}: it needs "" or "(0 octets)" there`,
        );
      return [];
    }
    if ("hex" in lit || "ascii" in lit) {
      const bytes = literalBytes(lit) as Uint8Array;
      const label = "label" in lit ? lit.label : undefined;
      // Whitespace alone normalizes to "", which every text holds: such a
      // value is matched only as hex.
      if ("ascii" in lit && normalizeText(lit.ascii) !== "") {
        const shown = textLines(lines, spans, normalizeText(lit.ascii));
        if (shown.size > 0) return [{ at, lines: shown, text: lit.ascii }];
      }
      return hexCheck(at, bytesToHex(bytes), bytes.length, label);
    }
    if ("str" in lit) {
      // The section text is whitespace-collapsed, so only a string already
      // in that form is compared as the test uses it.
      if (lit.str !== normalizeText(lit.str))
        return fail(
          at,
          `the string ${JSON.stringify(lit.str)} has leading, trailing or repeated whitespace, so it cannot be matched against the RFC text`,
        );
      const shown = textLines(lines, spans, lit.str);
      if (shown.size === 0)
        return fail(
          at,
          text.includes(lit.str)
            ? `the string ${JSON.stringify(lit.str)} is only part of a longer value in ${inSection}: it must be printed whole (in quotes, on a line of its own, or ending a line after "=" or ":")`
            : `the string ${JSON.stringify(lit.str)} is not printed in ${inSection}`,
        );
      return [{ at, lines: shown, text: lit.str }];
    }
    if ("int" in lit) {
      if (lit.label === undefined) {
        warnings.push({
          at: `${id}.${at}`,
          message: `not checked against the RFC: the integer ${lit.int} has no "label" to find it by`,
        });
        return [];
      }
      const has = intRounds(lines, lit.label, lit.int);
      if (has.length === 0)
        return fail(
          at,
          `${where} does not print "${lit.label}" followed by ${lit.int}`,
        );
      const of = intLabelCount(lines, lit.label);
      return [{ at, label: lit.label, ...rounds(lit.label, of, has) }];
    }
    return [];
  };
  return check;
}

/**
 * A section can print one test case's output for several variants, under
 * labels that differ only in a number: "HMAC-SHA-224", "HMAC-SHA-256",
 * "HMAC-SHA-384", "HMAC-SHA-512" (RFC 4231). Each is a real printed value of
 * that case, so only the function can say which one is its own. A value bound
 * to such a label must be the variant the called function names: the label's
 * distinguishing number must be in the function's name. A name holding
 * another variant's number instead is refused (the SHA-384 row as hmacSha512's
 * result); a name holding none of them is a warning, since nothing ties the
 * function to one variant.
 */
function ownVariant(
  k: VectorClause,
  where: string,
  sec: RfcSection,
  bounds: Bound[],
  issues: GateIssue[],
  warnings: GateWarning[],
): void {
  const skeleton = (l: string) =>
    normalizeText(l).toLowerCase().replace(/\d+/g, "#");
  const digits = (l: string) => normalizeText(l).match(/\d+/g) ?? [];
  const printed = [
    ...new Map(
      hexValues(sec)
        .flatMap((v) => (v.label === null ? [] : [v.label]))
        .map((l) => [normalizeText(l).toLowerCase(), l]),
    ).values(),
  ];
  const named = new Set(digits(k.call));
  for (const b of bounds) {
    if (!("label" in b) || b.label === null) continue;
    const label = b.label;
    const mine = digits(label);
    const siblings = printed.filter(
      (l) => skeleton(l) === skeleton(label) && !sameLabel(l, label),
    );
    if (siblings.length === 0) continue;
    // A position whose numbers run consecutively (Input1, Input2; Test Case
    // 3, 4) counts test cases, not variants: blake2s naming 2 says nothing
    // about which of Input1 and Input2 it computes.
    const counts = (i: number) => {
      const ns = [
        ...new Set([label, ...siblings].map((l) => Number(digits(l)[i]))),
      ];
      return Math.max(...ns) - Math.min(...ns) + 1 === ns.length;
    };
    // The label's numbers where a sibling differs, and the siblings' there.
    const own = new Set<string>();
    const theirs = new Map<string, string>();
    for (const sib of siblings) {
      digits(sib).forEach((d, i) => {
        if (d === mine[i] || counts(i)) return;
        own.add(mine[i]);
        if (!theirs.has(d)) theirs.set(d, sib);
      });
    }
    if ([...own].every((d) => named.has(d))) continue;
    const other = [...theirs].find(([d]) => named.has(d) && !own.has(d));
    if (other) {
      issues.push({
        gate: "fidelity",
        at: `${k.id}.${b.at}`,
        message: `the value is printed under "${label}" in ${where} ("${sec.title}"), but ${k.call} names ${other[0]}, as in "${other[1]}": a vector uses the value printed for the variant its function computes`,
      });
      continue;
    }
    warnings.push({
      at: `${k.id}.${b.at}`,
      message: `the value is printed under "${label}", one of ${quoted([label, ...siblings])} in ${where} ("${sec.title}"), and nothing in the name ${k.call} says which variant it computes: not checked that this is its own`,
    });
  }
}

/**
 * A cited vector's values must be one test case: strings printed on one
 * shared line (`BASE16("f") = "66"`), values under repeated labels from one
 * round (the first "Key" with the first "Data", never the second), and the
 * expected value not a value the arguments are also bound to (a key used as
 * the expected MAC).
 */
function oneTestCase(
  id: string,
  where: string,
  sec: RfcSection,
  args: Bound[],
  expect: Bound[],
  issues: GateIssue[],
): void {
  const texts = [...args, ...expect].filter(
    (b): b is Extract<Bound, { lines: Set<number> }> => "lines" in b,
  );
  if (texts.length > 1) {
    const shared = [...texts[0].lines].filter((l) =>
      texts.every((t) => t.lines.has(l)),
    );
    if (shared.length === 0)
      issues.push({
        gate: "fidelity",
        at: id,
        message: `${texts.map((t) => `${t.at} ${JSON.stringify(t.text)}`).join(", ")} are each printed in ${where} ("${sec.title}"), but never on one line together, so nothing pairs them as one test case`,
      });
  }
  const repeated = [...args, ...expect].flatMap((b) =>
    "rounds" in b && b.rounds ? [{ at: b.at, ...b.rounds }] : [],
  );
  // A string is placed by its line and a labelled value by its round; nothing
  // relates the two, so they pair only where the label is printed once.
  if (texts.length > 0 && repeated.length > 0)
    issues.push({
      gate: "fidelity",
      at: id,
      message: `${texts.map((t) => `${t.at} ${JSON.stringify(t.text)}`).join(", ")} and ${repeated.map((b) => `${b.at} (one of ${b.of} "${b.label}")`).join(", ")} in ${where} ("${sec.title}"): nothing pairs a printed string with one of several labelled values: cite the subsection that holds one test case`,
    });
  // Rounds pair only when every label is printed once per test case: a case
  // that prints one of them as "(0 octets)", or not at all, shifts its later
  // printings into the next case (RFC 5869 §A).
  else if (repeated.length > 1 && new Set(repeated.map((b) => b.of)).size > 1)
    issues.push({
      gate: "fidelity",
      at: id,
      message: `${repeated.map((b) => `"${b.label}" is printed ${b.of} times`).join(", ")} in ${where} ("${sec.title}"), so which printings belong to one test case is unclear: cite the subsection that holds one test case`,
    });
  else if (repeated.length > 1) {
    const shared = [...repeated[0].has].filter((r) =>
      repeated.every((b) => b.has.has(r)),
    );
    const nth = (has: Set<number>) =>
      [...has].map((r) => ordinal(r + 1)).join(" or ");
    if (shared.length === 0)
      issues.push({
        gate: "fidelity",
        at: id,
        message: `${repeated.map((b) => `${b.at} is the ${nth(b.has)} of ${b.of} "${b.label}"`).join(", ")} in ${where} ("${sec.title}"), so they are from different test cases: use the values printed together (or cite the subsection that holds one test case)`,
      });
  }
  for (const e of expect) {
    if (!("label" in e) || e.label === null) continue;
    const label = e.label;
    const same = args.find(
      (a) => "label" in a && a.label !== null && sameLabel(a.label, label),
    );
    if (same)
      issues.push({
        gate: "fidelity",
        at: `${id}.${e.at}`,
        message: `the expected value is the one printed under "${label}", which ${same.at} is bound to as well: an input is not the expected result`,
      });
  }
}

/**
 * Every vector's expected value has a provenance, and it holds: a `spec`
 * section names the null or bool it expects; a `command` printed it (when the
 * commands were run; until then it is reported as not run, never as passed).
 * A `cite` source is checked by the fidelity gate.
 */
function checkProvenance(
  c: RfcContract,
  docs: Map<string, RfcDocument>,
  commands: Map<string, SourceRun> | undefined,
  issues: GateIssue[],
  warnings: GateWarning[],
): void {
  for (const k of c.clauses) {
    if (k.kind !== "vector") continue;
    const s = (k as VectorClause).source;
    if ("spec" in s) {
      const sec = citedSection(
        c,
        docs,
        { section: s.spec },
        `${k.id}.source`,
        issues,
      );
      if (!sec) continue;
      const word = resultWord(k.expect) as string;
      const why = statesResult(
        c,
        docs,
        k as VectorClause,
        { section: s.spec },
        sec,
        word,
      );
      if (why !== null)
        issues.push({
          gate: "provenance",
          at: `${k.id}.source`,
          message: `${place(c, docs, { section: s.spec })} ("${sec.title}") does not state the expected result: ${why}`,
        });
    } else if ("command" in s) {
      const run = commands?.get(k.id);
      if (!run) {
        warnings.push({
          at: `${k.id}.source`,
          message: `source command not run (pass --run-sources): the expected value is unverified: $ ${s.command}`,
        });
      } else if (run.outcome === "fail") {
        issues.push({
          gate: "provenance",
          at: `${k.id}.source`,
          message: `source command ${run.detail ?? "failed"}: $ ${s.command}`,
        });
      }
    }
  }
}

/**
 * Every MUST/SHALL/REQUIRED sentence in the RFC is accounted for: inside the
 * quote of a requirement (which coverage then forces a clause to test) or of an
 * exclusion (which says why it is not tested). A contract cannot pass by
 * leaving out the requirement it would fail.
 */
function checkCompleteness(
  c: RfcContract,
  main: string,
  rfc: RfcDocument,
  docs: Map<string, RfcDocument>,
  issues: GateIssue[],
  warnings: GateWarning[],
): void {
  const inMain = (x: { source?: string }) => sourceOf(c, x.source) === main;
  const quotes = [...c.requirements, ...(c.exclusions ?? [])]
    .filter(inMain)
    .map((x) => ({ section: x.section, quote: x.quote }));
  for (const x of c.exclusions ?? []) {
    const where = `exclusion §${x.section}`;
    const sec = citedSection(c, docs, x, where, issues);
    if (!sec) continue;
    if (!sectionText(sec).includes(normalizeText(x.quote))) {
      issues.push({
        gate: "fidelity",
        at: where,
        message: `quote not found in ${place(c, docs, x)}: ${JSON.stringify(x.quote)}`,
      });
    } else {
      warnings.push({
        at: citeLabel(c, x),
        message: `excluded: ${x.reason}`,
      });
    }
  }
  for (const n of bindingSentences(rfc)) {
    const sec = findSection(rfc, n.section);
    if (!sec) {
      // Text outside every numbered section cannot be cited, so its
      // normative sentences can be neither tested nor excluded.
      issues.push({
        gate: "completeness",
        at: n.section,
        message: `${n.keyword} sentence is outside every numbered section, so it can be neither a requirement nor an exclusion: ${JSON.stringify(n.sentence)}`,
      });
      continue;
    }
    const covered = quotes.some(
      (q) =>
        q.section === n.section &&
        ownSpans(sec, q.quote).some(([a, b]) =>
          n.at.some((at) => a <= at && at < b),
        ),
    );
    if (!covered) {
      issues.push({
        gate: "completeness",
        at: `§${n.section}`,
        message: `${n.keyword} sentence is neither a requirement nor an exclusion: ${JSON.stringify(n.sentence)}`,
      });
    }
  }
}

/**
 * The binding keywords completeness accounts for, one entry each, with every
 * offset it may have in its section's normalized own text (a sentence can
 * appear there more than once). RFC XML marks its keywords with <bcp14>, and
 * that markup, not a scan of the text, says which sentences hold one: a
 * "MUST" in an example or a quoted definition is not one. Its SHOULDs and
 * MAYs bind nothing, as in plain text. The reader gives one entry per level
 * per sentence, so each use of that level in the sentence is found as
 * normativeSentences finds keywords (KEYWORD_RE): "MUST NOT do A and MUST do
 * B" is two keywords, and a quote must cover each. A sentence that cannot be
 * found in its section's own text (it spans a list or table), or whose level
 * KEYWORD_RE does not find, has no offset, so no quote covers it and it is
 * reported rather than passed.
 */
function bindingSentences(
  doc: RfcDocument,
): { section: string; keyword: string; sentence: string; at: number[] }[] {
  if (!("normative" in doc))
    return normativeSentences(doc).map((n) => ({ ...n, at: [n.at] }));
  return (doc as V3Document).normative
    .filter((n) => BINDING_LEVELS.has(n.level))
    .flatMap((n) => {
      const sec = findSection(doc, n.section);
      const starts = sec ? ownSpans(sec, n.sentence).map(([a]) => a) : [];
      const uses = [...n.sentence.matchAll(KEYWORD_RE)]
        .filter((m) => m[1] === n.level)
        .map((m) => m.index);
      const entry = {
        section: n.section,
        keyword: n.level,
        sentence: n.sentence,
      };
      if (uses.length === 0) return [{ ...entry, at: [] }];
      return uses.map((k) => ({ ...entry, at: starts.map((a) => a + k) }));
    });
}

// ── Signatures against the implementation's source ───────────────────────

const NISH_TYPES: Record<string, SigTy> = {
  "u8[]": "bytes",
  "u8[] | null": "bytes?",
  "null | u8[]": "bytes?",
  "Secret<u8[]>": "secret-bytes",
  "Secret<u8[]> | null": "secret-bytes?",
  "null | Secret<u8[]>": "secret-bytes?",
  string: "string",
  "string | null": "string?",
  "null | string": "string?",
  i32: "i32",
  u32: "u32",
  boolean: "bool",
};

/** `export const name = (a: T, b: U): R =>` signatures in a nish module. */
export function exportedSignatures(
  source: string,
): Map<string, { params: string[]; returns: string }> {
  const out = new Map<string, { params: string[]; returns: string }>();
  const re =
    /export const ([A-Za-z_]\w*)\s*=\s*\(([^)]*)\)\s*:\s*([^=]+?)\s*=>/g;
  for (const m of source.matchAll(re)) {
    const params = m[2]
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p !== "")
      .map((p) => p.slice(p.indexOf(":") + 1).trim());
    out.set(m[1], { params, returns: m[3].trim() });
  }
  return out;
}

function checkSignatures(
  c: RfcContract,
  source: string,
  issues: GateIssue[],
): void {
  const exported = exportedSignatures(source);
  for (const f of c.functions) {
    if (f.module && f.module !== c.target.module) continue;
    const real = exported.get(f.name);
    if (!real) {
      issues.push({
        gate: "signatures",
        at: f.name,
        message: `${c.target.module} does not export ${f.name}`,
      });
      continue;
    }
    const realParams = real.params.map((p) => NISH_TYPES[p] ?? `?${p}`);
    const realRet = NISH_TYPES[real.returns] ?? `?${real.returns}`;
    const want = `(${f.params.map((p) => p.type).join(", ")}) -> ${f.returns}`;
    const got = `(${realParams.join(", ")}) -> ${realRet}`;
    if (want !== got) {
      issues.push({
        gate: "signatures",
        at: f.name,
        message: `declared ${want}, but ${c.target.module} has (${real.params.join(", ")}): ${real.returns}`,
      });
    }
  }
}

export function clauseById(c: RfcContract, id: string): Clause | undefined {
  return c.clauses.find((k) => k.id === id);
}
