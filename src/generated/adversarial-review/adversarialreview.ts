import { validateArray } from '@amritk/helpers/validate-array';
import { isObject } from '@amritk/helpers/is-object';

export type AdversarialReview = {
  /** Two or three sentences: what the contract claims, what the intent asks for, and where the sharpest gap is (or why none was found). */
  summary: string;
  /** Every gap the adversarial review found between the contract and the intent. Empty array means the review found nothing to attack. */
  findings: ({
  /** blocking = the contract permits behavior the intent forbids, the intent requires a property no axiom enforces, or a behavioral delta is not justified by the stated intent. advisory = a weakness worth noting that does not by itself make the merge unsafe. */
  severity: "blocking" | "advisory";
  /** missing-axiom = the intent implies a property (bound, monotonicity, conservation, error behavior) that no axiom enforces. intent-conflict = the axioms permit a concrete behavior the intent forbids. unjustified-delta = a behavioral delta between generations is not explained by the stated intent. underspecified-domain = an input region where the contract pins nothing down. formula-shaped-axiom = an axiom that restates the algorithm instead of a property. out-of-scope = the intent needs something outside the verified numeric kernel. */
  kind: "missing-axiom" | "intent-conflict" | "unjustified-delta" | "underspecified-domain" | "formula-shaped-axiom" | "out-of-scope";
  /** One line naming the gap. */
  title: string;
  /** The argument: which axiom(s), which intent clause, why the gap is real. */
  detail: string;
  /** Concrete numbers where possible: an input the contract accepts and the output it permits that the intent would reject. */
  scenario?: string;
  /** A property-shaped axiom statement that would close the gap, phrased like a SpecPlan axiom statement. */
  suggestedAxiom?: string;
})[];
};

export const validateAdversarialReviewShape = (input: unknown): boolean => {
  if (!isObject(input)) return false;
  return typeof input.summary === "string" && input.summary.length >= 1
    && Array.isArray(input.findings) && _everyAdversarialReview_FindingsItem(input.findings)
    && Object.getPrototypeOf(input) === Object.prototype && Object.keys(input).length === 2;
};

type AdversarialReview_FindingsItem = NonNullable<AdversarialReview["findings"]>[number];

const validateAdversarialReview_FindingsItemShape = (input: unknown): boolean => {
  if (!isObject(input)) return false;
  if (!_hasOnlyKnownKeysAdversarialReview_FindingsItem(input)) return false;
  return (input.severity === "blocking" || input.severity === "advisory")
    && (input.kind === "missing-axiom" || input.kind === "intent-conflict" || input.kind === "unjustified-delta" || input.kind === "underspecified-domain" || input.kind === "formula-shaped-axiom" || input.kind === "out-of-scope")
    && typeof input.title === "string" && input.title.length >= 1
    && typeof input.detail === "string" && input.detail.length >= 1
    && (input.scenario === undefined || typeof input.scenario === "string")
    && (input.suggestedAxiom === undefined || typeof input.suggestedAxiom === "string");
};

const _everyAdversarialReview_FindingsItem = (arr: readonly unknown[]): boolean => {
  for (let i = 0; i < arr.length; i++) if (!validateAdversarialReview_FindingsItemShape(arr[i])) return false;
  return true;
};

const _hasOnlyKnownKeysAdversarialReview_FindingsItem = (input: Record<string, unknown>): boolean => {
  for (const _k in input) if (_k !== "severity" && _k !== "kind" && _k !== "title" && _k !== "detail" && _k !== "scenario" && _k !== "suggestedAxiom") return false;
  return true;
};

const parseAdversarialReview_FindingsItem = (input: unknown): AdversarialReview_FindingsItem => {
  if (!isObject(input)) throw new Error(`[AdversarialReview_FindingsItem] expected object, got ${input === null ? "null" : typeof input}`);
  const _severity = input.severity;
  const _kind = input.kind;
  const _title = input.title;
  const _detail = input.detail;
  const _scenario = input.scenario;
  const _suggestedAxiom = input.suggestedAxiom;
  if ((_severity === "blocking" || _severity === "advisory") && (_kind === "missing-axiom" || _kind === "intent-conflict" || _kind === "unjustified-delta" || _kind === "underspecified-domain" || _kind === "formula-shaped-axiom" || _kind === "out-of-scope") && typeof _title === "string" && _title.length >= 1 && typeof _detail === "string" && _detail.length >= 1 && (_scenario === undefined || typeof _scenario === "string") && (_suggestedAxiom === undefined || typeof _suggestedAxiom === "string") && _hasOnlyKnownKeysAdversarialReview_FindingsItem(input)) return input as AdversarialReview_FindingsItem;
  if (!("severity" in input)) throw new Error("[AdversarialReview_FindingsItem] missing required property 'severity'");
  if (!(["blocking","advisory"] as readonly unknown[]).includes(input.severity)) throw new Error("[AdversarialReview_FindingsItem] field 'severity' must be one of: \"blocking\", \"advisory\"");
  if (!("kind" in input)) throw new Error("[AdversarialReview_FindingsItem] missing required property 'kind'");
  if (!(["missing-axiom","intent-conflict","unjustified-delta","underspecified-domain","formula-shaped-axiom","out-of-scope"] as readonly unknown[]).includes(input.kind)) throw new Error("[AdversarialReview_FindingsItem] field 'kind' must be one of: \"missing-axiom\", \"intent-conflict\", \"unjustified-delta\", \"underspecified-domain\", \"formula-shaped-axiom\", \"out-of-scope\"");
  if (!("title" in input)) throw new Error("[AdversarialReview_FindingsItem] missing required property 'title'");
  if (typeof input.title !== "string") throw new Error("[AdversarialReview_FindingsItem] field 'title' expected string, got " + (typeof input.title));
  if (typeof input.title === "string" && input.title.length < 1) throw new Error("[AdversarialReview_FindingsItem] field 'title' must have at least 1 characters");
  if (!("detail" in input)) throw new Error("[AdversarialReview_FindingsItem] missing required property 'detail'");
  if (typeof input.detail !== "string") throw new Error("[AdversarialReview_FindingsItem] field 'detail' expected string, got " + (typeof input.detail));
  if (typeof input.detail === "string" && input.detail.length < 1) throw new Error("[AdversarialReview_FindingsItem] field 'detail' must have at least 1 characters");
  if (input.scenario !== undefined && (typeof input.scenario !== "string")) throw new Error("[AdversarialReview_FindingsItem] field 'scenario' expected string, got " + (typeof input.scenario));
  if (input.suggestedAxiom !== undefined && (typeof input.suggestedAxiom !== "string")) throw new Error("[AdversarialReview_FindingsItem] field 'suggestedAxiom' expected string, got " + (typeof input.suggestedAxiom));
  for (const _k in input) {
    if (_k !== "severity" && _k !== "kind" && _k !== "title" && _k !== "detail" && _k !== "scenario" && _k !== "suggestedAxiom") throw new Error(`[AdversarialReview_FindingsItem] unknown property "${_k}"`);
  }
  return {
    severity: _severity,
    kind: _kind,
    title: _title,
    detail: _detail,
    ...(_scenario !== undefined && { scenario: _scenario }),
    ...(_suggestedAxiom !== undefined && { suggestedAxiom: _suggestedAxiom }),
  } as unknown as AdversarialReview_FindingsItem;
}

export const parseAdversarialReview = (input: unknown): AdversarialReview => {
  if (!isObject(input)) throw new Error(`[AdversarialReview] expected object, got ${input === null ? "null" : typeof input}`);
  const _summary = input.summary;
  const _findings = input.findings;
  if (typeof _summary === "string" && _summary.length >= 1 && Array.isArray(_findings) && _everyAdversarialReview_FindingsItem(_findings) && Object.getPrototypeOf(input) === Object.prototype && Object.keys(input).length === 2) return {
    summary: _summary,
    findings: _findings,
  } as AdversarialReview;
  if (!("summary" in input)) throw new Error("[AdversarialReview] missing required property 'summary'");
  if (typeof input.summary !== "string") throw new Error("[AdversarialReview] field 'summary' expected string, got " + (typeof input.summary));
  if (typeof input.summary === "string" && input.summary.length < 1) throw new Error("[AdversarialReview] field 'summary' must have at least 1 characters");
  if (!("findings" in input)) throw new Error("[AdversarialReview] missing required property 'findings'");
  if (!Array.isArray(input.findings)) throw new Error("[AdversarialReview] field 'findings' expected array, got " + (typeof input.findings));
  for (const _k in input) {
    if (_k !== "summary" && _k !== "findings") throw new Error(`[AdversarialReview] unknown property "${_k}"`);
  }
  return {
    summary: _summary,
    findings: validateArray(_findings, parseAdversarialReview_FindingsItem),
  } as unknown as AdversarialReview;
}