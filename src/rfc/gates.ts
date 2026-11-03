// The deterministic gates a contract passes before it may become a test. None
// of them consults a model; each failure is a precise, repairable message.
//
//   shape        the JSON has the RfcContract form
//   typing       every call and expression is well-typed against `functions`
//   coverage     every MUST/SHALL/REQUIRED requirement is cited by a clause, and
//                every citation names a real requirement (anti-gaming: a
//                contract cannot drop a requirement or invent one)
//   fidelity     every quote appears in its cited RFC section; every hex/ascii/
//                int a vector uses appears in the vector's cited section
//   signatures   (with the module source) the declared signatures are the
//                implementation's exported ones
//
// Non-vacuity of property domains needs Z3 and lives in sample.ts.

import {
  BINDING_LEVELS,
  type Clause,
  type ExprTy,
  type FnSig,
  type Literal,
  type RfcContract,
  type TypeEnv,
  type ValueTy,
  assignable,
  bytesToHex,
  literalBytes,
  typeOf,
  typeOfLiteral,
  validateContractShape,
} from "./contract.ts";
import {
  type RfcDocument,
  findSection,
  hexPrinted,
  hexRuns,
  intPrinted,
  normalizeText,
  normativeSentences,
  ownSpans,
  sectionText,
} from "./rfctext.ts";

export interface GateIssue {
  gate:
    | "shape"
    | "typing"
    | "coverage"
    | "fidelity"
    | "completeness"
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

export interface GateOptions {
  /** The RFC's text; without it the fidelity gate is skipped (and says so). */
  rfc?: RfcDocument;
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

  if (opts.rfc) {
    if (opts.rfc.number !== null && opts.rfc.number !== c.source.rfc) {
      issues.push({
        gate: "fidelity",
        at: "source.rfc",
        message: `the contract cites RFC ${c.source.rfc} but the text is RFC ${opts.rfc.number}`,
      });
    }
    checkFidelity(c, opts.rfc, issues, warnings);
    checkCompleteness(c, opts.rfc, issues, warnings);
  } else {
    warnings.push({
      at: "fidelity",
      message:
        "no RFC text given: quotes and test vectors were NOT checked against the RFC",
    });
  }

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
        message: `${r.level} requirement (RFC §${r.section}) is not checked by any clause`,
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

function checkFidelity(
  c: RfcContract,
  rfc: RfcDocument,
  issues: GateIssue[],
  warnings: GateWarning[],
): void {
  for (const r of c.requirements) {
    const sec = findSection(rfc, r.section);
    if (!sec) {
      issues.push({
        gate: "fidelity",
        at: r.id,
        message: `RFC ${c.source.rfc} has no section ${r.section}`,
      });
      continue;
    }
    if (!sectionText(sec).includes(normalizeText(r.quote))) {
      issues.push({
        gate: "fidelity",
        at: r.id,
        message: `quote not found in RFC §${r.section} ("${sec.title}"): ${JSON.stringify(r.quote)}`,
      });
    }
  }
  for (const k of c.clauses) {
    if (k.kind !== "vector") continue;
    const sec = findSection(rfc, k.section);
    if (!sec) {
      issues.push({
        gate: "fidelity",
        at: k.id,
        message: `RFC ${c.source.rfc} has no section ${k.section}`,
      });
      continue;
    }
    const runs = hexRuns(sec);
    const text = sectionText(sec);
    const check = (lit: Literal, at: string) => {
      if ("concat" in lit) {
        lit.concat.forEach((p, i) => check(p, `${at}.concat[${i}]`));
        return;
      }
      if ("unchecked" in lit && lit.unchecked) {
        warnings.push({
          at: `${k.id}.${at}`,
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
            at: `${k.id}.${at}`,
            message: `${bytes.length}-byte value is not printed in RFC §${k.section} ("${sec.title}")`,
          });
        }
      } else if ("int" in lit) {
        if (!intPrinted(text, lit.int)) {
          issues.push({
            gate: "fidelity",
            at: `${k.id}.${at}`,
            message: `the integer ${lit.int} is not printed in RFC §${k.section}`,
          });
        }
      }
    };
    k.args.forEach((a, i) => check(a, `args[${i}]`));
    check(k.expect, "expect");
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
  rfc: RfcDocument,
  issues: GateIssue[],
  warnings: GateWarning[],
): void {
  const quotes = [
    ...c.requirements.map((r) => ({ section: r.section, quote: r.quote })),
    ...(c.exclusions ?? []).map((x) => ({
      section: x.section,
      quote: x.quote,
    })),
  ];
  for (const x of c.exclusions ?? []) {
    const sec = findSection(rfc, x.section);
    if (!sec || !sectionText(sec).includes(normalizeText(x.quote))) {
      issues.push({
        gate: "fidelity",
        at: `exclusion §${x.section}`,
        message: `quote not found in RFC §${x.section}: ${JSON.stringify(x.quote)}`,
      });
    } else {
      warnings.push({ at: `§${x.section}`, message: `excluded: ${x.reason}` });
    }
  }
  for (const n of normativeSentences(rfc)) {
    const sec = findSection(rfc, n.section);
    if (!sec) continue;
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
