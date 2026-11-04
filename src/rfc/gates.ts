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
//                requirement or an exclusion
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
  type TypeEnv,
  type ValueTy,
  type VectorClause,
  assignable,
  bytesToHex,
  citeLabel,
  declaredSources,
  literalBytes,
  sourceOf,
  typeOf,
  typeOfLiteral,
  validateContractShape,
  vectorArgsAt,
} from "./contract.ts";
import {
  type RfcDocument,
  type RfcSection,
  findSection,
  hexPrinted,
  hexRuns,
  intLabelled,
  normalizeText,
  normativeSentences,
  ownSpans,
  sectionLines,
  sectionText,
} from "./rfctext.ts";

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
          if (p && !literalFits(a, p.type)) {
            errors.push(
              `args[${i}]: ${k.call}(${p.name}) wants ${p.type}, got ${typeOfLiteral(a)}`,
            );
          }
        });
        if (!literalFits(k.expect, sig.returns)) {
          errors.push(
            `expect: ${k.call} returns ${sig.returns}, got ${typeOfLiteral(k.expect)}`,
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
    const check = literalCheck(sec, place(c, docs, at), k.id, issues, warnings);
    k.args.forEach((a, i) => check(a, `args[${i}]`));
    // A command or spec source vouches for the expected value instead.
    if (!("cite" in k.source)) continue;
    const word = resultWord(k.expect);
    if (word === null) check(k.expect, "expect");
    else if (!statesResult(sec, word)) {
      issues.push({
        gate: "fidelity",
        at: `${k.id}.expect`,
        message: `${place(c, docs, at)} ("${sec.title}") never says "${word}", so it does not state the expected result`,
      });
    }
  }
}

/** "null", "true" or "false" for an expected null or bool; null otherwise. */
function resultWord(lit: Literal): string | null {
  if ("null" in lit) return "null";
  return "bool" in lit ? String(lit.bool) : null;
}

const statesResult = (sec: RfcSection, word: string): boolean =>
  new RegExp(`\\b${word}\\b`, "i").test(sectionText(sec));

/** Checks literals against one section's text. */
function literalCheck(
  sec: NonNullable<ReturnType<typeof findSection>>,
  where: string,
  id: string,
  issues: GateIssue[],
  warnings: GateWarning[],
) {
  const runs = hexRuns(sec);
  const text = sectionText(sec);
  const lines = sectionLines(sec);
  const check = (lit: Literal, at: string) => {
    if ("concat" in lit) {
      lit.concat.forEach((p, i) => check(p, `${at}.concat[${i}]`));
      return;
    }
    if ("unchecked" in lit && lit.unchecked) {
      warnings.push({
        at: `${id}.${at}`,
        message: `not checked against the RFC: ${lit.unchecked}`,
      });
      return;
    }
    if ("hex" in lit || "ascii" in lit) {
      const bytes = literalBytes(lit) as Uint8Array;
      const printedAsText =
        "ascii" in lit && text.includes(normalizeText(lit.ascii));
      if (!printedAsText && !hexPrinted(runs, bytesToHex(bytes))) {
        issues.push({
          gate: "fidelity",
          at: `${id}.${at}`,
          message: `${bytes.length}-byte value is not printed in ${where} ("${sec.title}")`,
        });
      }
    } else if ("str" in lit) {
      // The section text is whitespace-collapsed, so only a string already
      // in that form is compared as the test uses it; "" is in every text.
      if (lit.str === "" || lit.str !== normalizeText(lit.str)) {
        issues.push({
          gate: "fidelity",
          at: `${id}.${at}`,
          message: `the string ${JSON.stringify(lit.str)} is empty or has leading, trailing or repeated whitespace, so it cannot be matched against the RFC text`,
        });
      } else if (!text.includes(lit.str)) {
        issues.push({
          gate: "fidelity",
          at: `${id}.${at}`,
          message: `the string ${JSON.stringify(lit.str)} is not printed in ${where} ("${sec.title}")`,
        });
      }
    } else if ("int" in lit) {
      if (lit.label === undefined) {
        warnings.push({
          at: `${id}.${at}`,
          message: `not checked against the RFC: the integer ${lit.int} has no "label" to find it by`,
        });
      } else if (!intLabelled(lines, lit.label, lit.int)) {
        issues.push({
          gate: "fidelity",
          at: `${id}.${at}`,
          message: `${where} does not print "${lit.label}" followed by ${lit.int}`,
        });
      }
    }
  };
  return check;
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
      if (!statesResult(sec, word)) {
        issues.push({
          gate: "provenance",
          at: `${k.id}.source`,
          message: `§${s.spec} ("${sec.title}") never says "${word}", so it does not state the expected result`,
        });
      }
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
  for (const n of normativeSentences(rfc)) {
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
        ownSpans(sec, q.quote).some(([a, b]) => a <= n.at && n.at < b),
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

// ── Signatures against the implementation's source ───────────────────────

const NISH_TYPES: Record<string, ValueTy> = {
  "u8[]": "bytes",
  "u8[] | null": "bytes?",
  "null | u8[]": "bytes?",
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
