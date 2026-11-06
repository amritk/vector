// RFC → contract with a model in the loop: the model proposes a contract, the
// deterministic gates (and Z3's domain check) judge it, and their failures go
// back as feedback until it passes or the retries run out. The model never
// decides whether the contract is faithful; the RFC text does.

import { readFileSync, writeFileSync } from "node:fs";
import contractJsonSchema from "../../schemas/rfc-contract.json" with {
  type: "json",
};
import { MalformedOutputError } from "../agents/client.ts";
import {
  type RfcContract,
  declaredSources,
  sourceOf,
  validateContractShape,
} from "./contract.ts";
import { type GateIssue, exportedSignatures, runGates } from "./gates.ts";
import {
  type ContractReport,
  renderMarkdown,
  renderReport,
  reportJson,
  reportStatus,
} from "./report.ts";
import {
  type RfcDocument,
  findSection,
  normalizeText,
  normativeSentences,
  ownSpans,
} from "./rfctext.ts";
import { sampleContract } from "./sample.ts";
import {
  type SpecInterface,
  interfaceDeclarations,
  interfaceSignatures,
  parseDocument,
} from "./spectext.ts";

const PROMPT_HEAD = `You turn an RFC into a test contract for an implementation \
of it. The contract is JSON (the schema is enforced). It is checked mechanically against the RFC \
text before anything runs, so:

- requirements[].quote is copied VERBATIM from the cited section (line breaks may differ; nothing \
else may). Cite the most specific section that contains it. Use the BCP 14 keyword as the level \
when the sentence has one, DEFINITION when it defines what the algorithm computes.
- Every MUST / MUST NOT / SHALL / SHALL NOT / REQUIRED sentence in the RFC must sit inside a \
requirement's quote or an exclusion's quote. Exclude only what a functional test cannot observe \
(caller obligations such as nonce uniqueness, timing, key management) and say why.
- Every requirement you state must be cited by at least one clause, and clauses may only cite \
requirements you stated.
- Vector clauses use the RFC's own test vectors: every hex/ascii/int value must be printed in the \
cited section. Give each vector a source: {"cite": {"section": "A.1"}} when the section prints the \
expected value too. Use concat when the RFC prints a value in parts (ciphertext then tag; a fixed \
part then an IV). Never compute or invent a value.
- Property clauses state what the RFC defines, over a typed domain: lengths, bounds (put the bound \
in an integer comparison so the solver samples both sides of it), round trips, tamper rejection, \
and the RFC's own construction rebuilt from other functions under test (e.g. a block of output \
equals the formula that defines it). Keep 'where' free of calls.
`;

const PROMPT_TAIL = `- The spec may be an RFC or a markdown document whose sections are numbered headings. For an RFC \
set source.rfc to its number; for anything else declare sources: [{"id": "<short name>", "path": \
"<file>"}] and source.main: "<that id>".`;

const TYPE_MAP = `mapped to bytes (u8[]), bytes? (u8[] | null), string, string? (string | null), \
i32, u32, bool`;

export const EXTRACTOR_SYSTEM_PROMPT = `${PROMPT_HEAD}
- functions[] are the implementation's real exported signatures, ${TYPE_MAP}. A function from \
another module (a reference such as HMAC) names its module.
${PROMPT_TAIL}`;

/**
 * Spec-only extraction: the model sees the spec and nothing of the
 * implementation, so the contract states what the spec asks for, not what the
 * code happens to do. Its signatures are the spec's Interface section.
 */
export const SPEC_ONLY_SYSTEM_PROMPT = `${PROMPT_HEAD}
- functions[] are exactly the signatures the spec's Interface section declares, ${TYPE_MAP}. \
There is no implementation to read: the contract must follow from the spec alone.
${PROMPT_TAIL}`;

export interface ExtractInputs {
  rfcText: string;
  /**
   * The target module's source, for its signatures. Absent in spec-only
   * extraction, which refuses one: the signatures come from the spec.
   */
  moduleSource?: string;
  target: string;
  /** Give the model only the spec; take signatures from its Interface. */
  specOnly?: boolean;
}

export interface ExtractDeps {
  /** One model call: the user turn and system prompt in, a contract-shaped object out. */
  propose: (userContent: string, systemPrompt: string) => Promise<unknown>;
}

export interface ExtractOutcome {
  contract: RfcContract | null;
  report: ContractReport;
  attempts: number;
}

function userTurn(
  inputs: ExtractInputs,
  iface: SpecInterface | null,
  previous: unknown,
  feedback: string[],
): string {
  const parts = iface
    ? [
        `Target module: ${inputs.target}`,
        `Its interface, as the spec's Interface section (§${iface.section}) declares it:\n${iface.signatures
          .map(
            (s) =>
              `  ${s.name}(${s.params.map((p) => `${p.name}: ${p.type}`).join(", ")}): ${s.returns}`,
          )
          .join("\n")}`,
        `The spec:\n\n${inputs.rfcText}`,
      ]
    : [
        `Target module: ${inputs.target}`,
        `Its exported functions:\n${
          [...exportedSignatures(inputs.moduleSource ?? "")]
            .map(
              ([name, s]) => `  ${name}(${s.params.join(", ")}): ${s.returns}`,
            )
            .join("\n") || "  (none found)"
        }`,
        `The RFC:\n\n${inputs.rfcText}`,
      ];
  if (previous !== undefined) {
    parts.push(
      `Your previous contract:\n${JSON.stringify(previous)}`,
      `It failed these checks. Fix exactly these, keep everything that passed:\n- ${feedback.join("\n- ")}`,
    );
  }
  return parts.join("\n\n");
}

/**
 * Spec-only: the contract's functions are exactly the Interface's. The
 * signature gate checks only functions of the target module, so a function
 * naming another module would go unchecked, and nothing there asks that every
 * declared signature is in the contract; both are refused here.
 */
function interfaceIssues(c: RfcContract, iface: SpecInterface): GateIssue[] {
  const issues: GateIssue[] = [];
  for (const f of c.functions) {
    if (f.module && f.module !== c.target.module) {
      issues.push({
        gate: "signatures",
        at: f.name,
        message: `names module ${f.module}, but spec-only extraction takes every function from the spec's Interface section (§${iface.section}), which declares only ${c.target.module}'s`,
      });
    }
  }
  for (const s of iface.signatures) {
    if (!c.functions.some((f) => f.name === s.name)) {
      issues.push({
        gate: "signatures",
        at: s.name,
        message: `the spec's Interface section (§${iface.section}) declares ${s.name}, but the contract's functions[] leave it out`,
      });
    }
  }
  return issues;
}

export async function extractContract(
  inputs: ExtractInputs,
  deps: ExtractDeps,
  maxRetries = 3,
): Promise<ExtractOutcome> {
  const rfc = parseDocument(inputs.rfcText);
  // Both refusals come before any model call: a spec-only run that could see
  // the module, or a module run with no module, is not the run asked for.
  let iface: SpecInterface | null = null;
  let signatureSource: string;
  if (inputs.specOnly) {
    if (inputs.moduleSource !== undefined) {
      throw new Error(
        "spec-only extraction takes no module source: its signatures come from the spec's Interface section",
      );
    }
    iface = interfaceSignatures(rfc);
    signatureSource = interfaceDeclarations(iface);
  } else {
    if (inputs.moduleSource === undefined) {
      throw new Error(
        "extraction needs the module source, or spec-only mode to take signatures from the spec",
      );
    }
    signatureSource = inputs.moduleSource;
  }
  const system = iface ? SPEC_ONLY_SYSTEM_PROMPT : EXTRACTOR_SYSTEM_PROMPT;
  let previous: unknown;
  let feedback: string[] = [];
  let report: ContractReport = {
    contract: null,
    gates: { ok: false, issues: [], warnings: [], coverage: new Map() },
  };
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    let proposed: unknown;
    try {
      proposed = await deps.propose(
        userTurn(inputs, iface, previous, feedback),
        system,
      );
    } catch (err) {
      if (!(err instanceof MalformedOutputError)) throw err;
      feedback = [err.message];
      continue;
    }
    previous = proposed;
    const gates = runGates(proposed, { rfc, moduleSource: signatureSource });
    if (iface && !gates.issues.some((i) => i.gate === "shape")) {
      const more = interfaceIssues(proposed as RfcContract, iface);
      gates.issues.push(...more);
      if (more.length > 0) gates.ok = false;
    }
    report = {
      contract: gates.issues.some((i) => i.gate === "shape")
        ? null
        : (proposed as RfcContract),
      gates,
    };
    if (gates.ok) {
      report.sampling = await sampleContract(proposed as RfcContract);
      if (report.sampling.ok)
        return { contract: proposed as RfcContract, report, attempts: attempt };
    }
    feedback = [
      ...gates.issues.map((i) => `[${i.gate}] ${i.at}: ${i.message}`),
      ...(report.sampling?.issues ?? []).map(
        (i) => `[domain] ${i.at}: ${i.message}`,
      ),
    ];
  }
  return { contract: null, report, attempts: maxRetries + 1 };
}

// ── Twice: two independent extractions, and where they disagree ───────────

/**
 * One place the two extractions read the spec differently. A warning for the
 * human reviewer, never a gate: either contract passed every gate on its own.
 */
export interface Disagreement {
  kind: "requirement" | "coverage";
  at: string;
  message: string;
}

export interface TwiceOutcome {
  first: ExtractOutcome;
  second: ExtractOutcome;
  /** Empty when the two contracts agree; null when either run failed. */
  disagreements: Disagreement[] | null;
}

const shortQuote = (q: string, n = 72) => {
  const t = q.replace(/\s+/g, " ").trim();
  return JSON.stringify(t.length > n ? `${t.slice(0, n - 1)}…` : t);
};

/** Which document a citation is in, named so the two runs can share it. */
function docKey(c: RfcContract, source: string | undefined): string {
  const src = sourceOf(c, source);
  return src === declaredSources(c).main ? "" : src;
}

const atLabel = (doc: string, section: string) =>
  doc ? `${doc} §${section}` : `§${section}`;

type Cited = { source?: string; section: string; quote: string };

/**
 * Whether two citations, one from each run, quote the same text: the same
 * document and section, and spans that overlap. Two runs rarely quote
 * byte-identical spans of one sentence, so "A MUST do X" and "A MUST do X,
 * and Y" are the same requirement. Outside the main spec there is no section
 * text to place a span in, so one quote containing the other counts.
 */
function sameText(
  doc: RfcDocument,
  a: { c: RfcContract; x: Cited },
  b: { c: RfcContract; x: Cited },
): boolean {
  const d = docKey(a.c, a.x.source);
  if (d !== docKey(b.c, b.x.source) || a.x.section !== b.x.section)
    return false;
  const qa = normalizeText(a.x.quote);
  const qb = normalizeText(b.x.quote);
  if (qa === "" || qb === "") return false;
  if (qa.includes(qb) || qb.includes(qa)) return true;
  const sec = d === "" ? findSection(doc, a.x.section) : null;
  if (!sec) return false;
  const sb = ownSpans(sec, b.x.quote);
  return ownSpans(sec, a.x.quote).some(([s1, e1]) =>
    sb.some(([s2, e2]) => s1 < e2 && s2 < e1),
  );
}

// A binding BCP 14 keyword: a requirement quoting one is compared sentence by
// sentence in the coverage pass, so the requirement pass leaves it to that.
const BINDING_KEYWORD_RE =
  /(?<![A-Za-z0-9])(?:MUST|SHALL|REQUIRED)(?![A-Za-z0-9])/;

/** What a contract does with one normative sentence of the main spec. */
function disposition(
  c: RfcContract,
  doc: RfcDocument,
  n: { section: string; at: number },
): { kind: "tested" | "untested" | "excluded" | "not covered"; by: string } {
  const sec = findSection(doc, n.section);
  const main = declaredSources(c).main;
  const holds = (x: { source?: string; section: string; quote: string }) =>
    sourceOf(c, x.source) === main &&
    x.section === n.section &&
    sec !== null &&
    ownSpans(sec, x.quote).some(([a, b]) => a <= n.at && n.at < b);
  const reqs = c.requirements.filter(holds);
  const tested = reqs.filter((r) =>
    c.clauses.some((k) => k.covers.includes(r.id)),
  );
  if (tested.length > 0)
    return { kind: "tested", by: tested.map((r) => r.id).join(", ") };
  if (reqs.length > 0)
    return { kind: "untested", by: reqs.map((r) => r.id).join(", ") };
  const ex = (c.exclusions ?? []).find(holds);
  if (ex) return { kind: "excluded", by: JSON.stringify(ex.reason) };
  return { kind: "not covered", by: "" };
}

const dispositionText = (d: ReturnType<typeof disposition>) =>
  d.kind === "tested"
    ? `tested (${d.by})`
    : d.kind === "untested"
      ? `stated but untested (${d.by})`
      : d.kind === "excluded"
        ? `excluded: ${d.by}`
        : "not covered";

/**
 * Where two contracts extracted from the same spec disagree: a requirement
 * one states and the other does not (matched on overlapping quotes, so two
 * spans of one sentence agree), one stated at a different level, one tested
 * in one run and stated but untested in the other, and a binding sentence of
 * the main spec that the runs handle differently (tested, untested, excluded
 * or not covered). Deterministic: the order is the first run's, then the
 * second's, then the spec's.
 */
export function compareContracts(
  a: RfcContract,
  b: RfcContract,
  doc: RfcDocument,
): Disagreement[] {
  const out: Disagreement[] = [];
  const runs = [
    { c: a, name: "run 1", other: "run 2" },
    { c: b, name: "run 2", other: "run 1" },
  ];
  const tested = (c: RfcContract, id: string) =>
    c.clauses.some((k) => k.covers.includes(id));
  // Each pair of matched requirements is compared once, whichever side finds it.
  const seen = new Set<string>();
  runs.forEach((r, i) => {
    const o = runs[1 - i];
    for (const req of r.c.requirements) {
      const at = atLabel(docKey(r.c, req.source), req.section);
      const mine = { c: r.c, x: req };
      const overlapping = o.c.requirements.filter((q) =>
        sameText(doc, mine, { c: o.c, x: q }),
      );
      // The same quote, when the other run has it, is the match; a longer or
      // shorter span of the same sentence only when it does not.
      const exact = overlapping.filter(
        (q) => normalizeText(q.quote) === normalizeText(req.quote),
      );
      const matches = exact.length > 0 ? exact : overlapping;
      if (matches.length === 0) {
        const ex = (o.c.exclusions ?? []).find((x) =>
          sameText(doc, mine, { c: o.c, x }),
        );
        out.push({
          kind: "requirement",
          at,
          message: `${r.name} states requirement ${req.id} (${req.level}) ${shortQuote(req.quote)}; ${r.other} ${ex ? `excludes it: ${JSON.stringify(ex.reason)}` : "does not state it"}`,
        });
        continue;
      }
      // A pair's key is (run 1's id, run 2's id), whichever side finds it.
      const pairs = matches.map((q) =>
        i === 0 ? `${req.id}\u0000${q.id}` : `${q.id}\u0000${req.id}`,
      );
      if (pairs.every((k) => seen.has(k))) continue;
      for (const k of pairs) seen.add(k);
      const ids = matches.map((q) => q.id).join(", ");
      const levels = [...new Set(matches.map((q) => q.level))];
      if (levels.some((l) => l !== req.level)) {
        out.push({
          kind: "requirement",
          at,
          message: `${r.name} states ${req.id} as ${req.level}, ${r.other} as ${levels.join(" / ")} (${ids}): ${shortQuote(req.quote)}`,
        });
      }
      // Main-spec text with a binding keyword is compared sentence by
      // sentence below; everything else (SHOULD, MAY, DEFINITION, a quote
      // from another source) is compared here, requirement by requirement.
      const main = docKey(r.c, req.source) === "";
      if (main && BINDING_KEYWORD_RE.test(normalizeText(req.quote))) continue;
      const t1 = tested(r.c, req.id);
      const t2 = matches.some((q) => tested(o.c, q.id));
      if (t1 === t2) continue;
      const how = (t: boolean, by: string) =>
        t ? `tested (${by})` : `stated but untested (${by})`;
      out.push({
        kind: "coverage",
        at,
        message: `requirement ${shortQuote(req.quote)} is ${how(t1, req.id)} in ${r.name}, ${how(t2, ids)} in ${r.other}`,
      });
    }
  });
  for (const n of normativeSentences(doc)) {
    if (!findSection(doc, n.section)) continue;
    const da = disposition(a, doc, n);
    const db = disposition(b, doc, n);
    if (da.kind === db.kind) continue;
    out.push({
      kind: "coverage",
      at: `§${n.section}`,
      message: `${n.keyword} sentence ${shortQuote(n.sentence, 160)} is ${dispositionText(da)} in run 1, ${dispositionText(db)} in run 2`,
    });
  }
  return out;
}

/**
 * Two extractions with no state shared between them: each starts from the
 * spec with no previous contract and no feedback from the other.
 */
export async function extractTwice(
  inputs: ExtractInputs,
  deps: ExtractDeps,
  maxRetries = 3,
): Promise<TwiceOutcome> {
  const first = await extractContract(inputs, deps, maxRetries);
  const second = await extractContract(inputs, deps, maxRetries);
  const disagreements =
    first.contract && second.contract
      ? compareContracts(
          first.contract,
          second.contract,
          parseDocument(inputs.rfcText),
        )
      : null;
  return { first, second, disagreements };
}

async function anthropicPropose(
  userContent: string,
  systemPrompt: string,
): Promise<unknown> {
  const { structuredCall } = await import("../agents/client.ts");
  return structuredCall({
    systemPrompt,
    userContent,
    jsonSchema: contractJsonSchema as Record<string, unknown>,
    parse: (input: unknown) => {
      const errors = validateContractShape(input);
      if (errors.length > 0) {
        throw new MalformedOutputError(
          `contract failed shape validation:\n- ${errors.join("\n- ")}`,
        );
      }
      return input;
    },
  });
}

export interface ExtractOptions {
  rfcPath?: string;
  modulePath?: string;
  /** --nish-root was given: refused with --spec-only, ignored otherwise. */
  nishRoot?: string;
  target?: string;
  out?: string;
  maxRetries: number;
  format: "text" | "markdown" | "json";
  specOnly?: boolean;
  twice?: boolean;
}

function render(format: ExtractOptions["format"], r: ContractReport): string {
  return format === "json"
    ? JSON.stringify(reportJson(r), null, 2)
    : format === "markdown"
      ? renderMarkdown(r)
      : renderReport(r);
}

const twiceSummary = (n: number) =>
  n === 0
    ? "Two independent extractions agree: the same requirements, and every binding sentence handled the same way."
    : `Two independent extractions disagree in ${n} place(s), listed under Warnings for the reviewer. The contract written is run 1's.`;

/**
 * `vector spec extract`. Exit 0: a contract passed every gate and was
 * written. 1: no valid contract (with --twice, either run had none). 2: a
 * usage error or a spec that cannot be read, before any model call.
 */
export async function runExtract(
  opts: ExtractOptions,
  deps: ExtractDeps = { propose: anthropicPropose },
): Promise<number> {
  const needs = opts.specOnly
    ? "extract --spec-only needs --spec <file> --target <module> -o <contract.json>"
    : "extract needs --spec <file> --module <src.ts> --target <module> -o <contract.json>";
  if (
    !opts.rfcPath ||
    (!opts.specOnly && !opts.modulePath) ||
    !opts.target ||
    !opts.out
  ) {
    console.error(`error: ${needs}`);
    return 2;
  }
  if (opts.specOnly && (opts.modulePath || opts.nishRoot)) {
    console.error(
      `error: --spec-only takes signatures from the spec's Interface section and gives the model nothing else; drop ${opts.modulePath ? "--module" : "--nish-root"}`,
    );
    return 2;
  }
  let rfcText: string;
  let moduleSource: string | undefined;
  try {
    rfcText = readFileSync(opts.rfcPath, "utf8");
    if (!opts.specOnly)
      moduleSource = readFileSync(opts.modulePath as string, "utf8");
  } catch (err) {
    console.error(`error: ${(err as Error).message}`);
    return 2;
  }
  // The spec is read, and its Interface parsed, before any model call.
  try {
    const doc = parseDocument(rfcText);
    if (opts.specOnly) interfaceSignatures(doc);
  } catch (err) {
    console.error(`error: ${opts.rfcPath}: ${(err as Error).message}`);
    return 2;
  }
  const inputs: ExtractInputs = {
    rfcText,
    moduleSource,
    target: opts.target,
    specOnly: opts.specOnly,
  };
  let outcome: ExtractOutcome;
  if (opts.twice) {
    const t = await extractTwice(inputs, deps, opts.maxRetries);
    const failed = [t.first, t.second]
      .map((o, i) => (o.contract ? null : `run ${i + 1}`))
      .filter((x) => x !== null);
    if (t.disagreements === null) {
      if (opts.format === "json")
        console.log(
          JSON.stringify(
            { runs: [t.first, t.second].map((o) => reportJson(o.report)) },
            null,
            2,
          ),
        );
      else
        for (const [i, o] of [t.first, t.second].entries())
          console.log(
            `${i > 0 ? "\n" : ""}Run ${i + 1}:\n${render(opts.format, o.report)}`,
          );
      console.error(
        `--twice: ${failed.join(" and ")} found no valid contract; nothing written`,
      );
      return 1;
    }
    outcome = t.first;
    for (const d of t.disagreements)
      outcome.report.gates.warnings.push({
        at: `twice ${d.kind} ${d.at}`,
        message: d.message,
      });
    if (opts.format === "json") {
      console.log(
        JSON.stringify(
          {
            ...(reportJson(outcome.report) as Record<string, unknown>),
            twice: {
              agree: t.disagreements.length === 0,
              disagreements: t.disagreements,
              second: reportJson(t.second.report),
            },
          },
          null,
          2,
        ),
      );
    } else {
      console.log(render(opts.format, outcome.report));
      console.log(
        opts.format === "markdown"
          ? `\n### Two extractions\n\n${twiceSummary(t.disagreements.length)}`
          : `\n${twiceSummary(t.disagreements.length)}`,
      );
    }
  } else {
    outcome = await extractContract(inputs, deps, opts.maxRetries);
    console.log(render(opts.format, outcome.report));
    if (!outcome.contract) {
      console.error(
        `no valid contract after ${outcome.attempts} attempt(s); status ${reportStatus(outcome.report)}`,
      );
      return 1;
    }
  }
  const contract = outcome.contract as RfcContract;
  writeFileSync(opts.out, `${JSON.stringify(contract, null, 2)}\n`);
  const note = `(contract written to ${opts.out} after ${outcome.attempts} attempt(s); review it, then \`vector spec check --run-sources\` before relying on its command sources, then \`vector spec run\`)`;
  if (opts.format === "json") console.error(note);
  else console.log(`\n${note}`);
  return 0;
}
