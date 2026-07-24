import adversarialReviewJsonSchema from "../../schemas/adversarial-review.json" with {
  type: "json",
};
import { parseAdversarialReview } from "../generated/adversarial-review/index.ts";
import type { AdversarialReview } from "../generated/adversarial-review/index.ts";
import type { SpecPlan } from "../lang/ast.ts";
import { structuredCall } from "./client.ts";

// The adversarial review phase. Z3 proves *code ⊨ contract*; the one link it
// cannot check is *contract ⊨ intent*. This agent attacks exactly that link:
// given the SpecPlan (and optionally the previous SpecPlan, the --diff deltas,
// and the PR's stated intent), it tries to construct behaviors the contract
// permits but the intent forbids, properties the intent implies but no axiom
// enforces, and deltas the intent does not justify. The verdict is NOT the
// model's to give — it is derived deterministically from the findings'
// severities (see deriveVerdict), keeping "the model can't grade its own work"
// true for this phase too.

export type ReviewVerdict = "CLEAR" | "FLAGGED";

export interface AdversarialReviewResult {
  verdict: ReviewVerdict;
  summary: string;
  findings: AdversarialReview["findings"];
}

export interface ReviewInput {
  /** The SpecPlan under review (already shape-validated by the caller). */
  spec: SpecPlan;
  /** The base-branch SpecPlan, when reviewing a change rather than a new plan. */
  baselineSpec?: SpecPlan;
  /** The stated intent: PR title + description, or the ticket text. */
  intent?: string;
  /** Raw `vector --diff --json` outcome for old vs new program, if any. */
  deltas?: unknown;
}

// Frozen instructions — cached; the volatile artifacts go in the user turn.
const ADVERSARY_SYSTEM_PROMPT = `You are the vector Adversary, the hostile reviewer in a \
formally verified code-generation pipeline. Downstream, an SMT solver has already PROVEN that \
the implementation satisfies every axiom in the SpecPlan — code-vs-contract is settled and is \
not your concern. The single unproven link is contract-vs-intent, and your job is to break it.

You receive a SpecPlan (formal axioms + a layered decomposition), and possibly: the previous \
SpecPlan it replaces, the stated intent (a PR or ticket description), and a solver-produced \
list of behavioral deltas between the old and new generated programs. Attack, in order:

1. INTENT-CONFLICT — construct a concrete behavior the axioms permit but the intent forbids. \
Use actual numbers: name an input the contract accepts and an output it allows that the intent \
would reject. This is your highest-value finding; hunt for it first.
2. MISSING-AXIOM — a property the intent states or clearly implies (a bound, monotonicity, a \
conservation law like "the parts sum to the whole", tier/threshold behavior, error behavior \
like "rejects negatives") that NO axiom enforces. Propose the missing axiom as a \
property-shaped statement.
3. UNJUSTIFIED-DELTA — a behavioral delta in the solver's list that the stated intent does not \
explain. If the intent says "raise the fee cap to 40" and a delta shows outputs changing at \
inputs far below the old cap, that delta is unjustified.
4. UNDERSPECIFIED-DOMAIN — an input region where the axioms pin nothing down, so any \
regeneration may silently change behavior there.
5. FORMULA-SHAPED-AXIOM — an axiom that restates the algorithm (result == <formula>) rather \
than a property; reviewing it is reviewing code by another name. Advisory unless the formula \
itself contradicts the intent.
6. OUT-OF-SCOPE — the intent needs behavior outside the verified numeric kernel (strings, IO, \
state); the unverified glue will carry it.

Severity discipline: "blocking" ONLY when the contract permits something the intent forbids, \
the intent requires a property no axiom enforces, or a delta is unjustified by the intent — \
i.e. merging on the strength of the proof alone would be unsafe. Style and hygiene are \
"advisory". Do not pad: an empty findings list is a legitimate result and more useful than \
manufactured objections. Never flag something the axioms already handle — quote the axiom ids \
you checked in your detail so the reader can verify you read them. If no intent text was \
provided, restrict yourself to attacks 2, 4, 5, 6 judged against the axioms' own statements \
and the units' stated purposes.`;

function formatUserContent(input: ReviewInput): string {
  const sections: string[] = [];
  sections.push(
    input.intent
      ? `STATED INTENT (PR / ticket text):\n${input.intent}`
      : "STATED INTENT: none provided — review the SpecPlan on its own terms.",
  );
  if (input.baselineSpec) {
    sections.push(
      `PREVIOUS SPECPLAN (base branch):\n${JSON.stringify(input.baselineSpec, null, 2)}`,
    );
  }
  sections.push(
    `SPECPLAN UNDER REVIEW:\n${JSON.stringify(input.spec, null, 2)}`,
  );
  if (input.deltas !== undefined) {
    sections.push(
      `SOLVER BEHAVIORAL DELTAS (vector --diff, old generation vs new):\n${JSON.stringify(input.deltas, null, 2)}`,
    );
  }
  return sections.join("\n\n---\n\n");
}

/** FLAGGED iff any blocking finding — derived here, never trusted from the model. */
export function deriveVerdict(
  findings: AdversarialReview["findings"],
): ReviewVerdict {
  return findings.some((f) => f.severity === "blocking") ? "FLAGGED" : "CLEAR";
}

export async function reviewSpecPlan(
  input: ReviewInput,
): Promise<AdversarialReviewResult> {
  const review = await structuredCall({
    systemPrompt: ADVERSARY_SYSTEM_PROMPT,
    userContent: formatUserContent(input),
    jsonSchema: adversarialReviewJsonSchema as Record<string, unknown>,
    parse: parseAdversarialReview,
  });
  return {
    verdict: deriveVerdict(review.findings),
    summary: review.summary,
    findings: review.findings,
  };
}
