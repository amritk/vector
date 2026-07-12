import specPlanJsonSchema from "../../schemas/spec-plan.json" with {
  type: "json",
};
import { parseSpecPlan as parseSpecPlanDocument } from "../generated/spec-plan/index.ts";
import type { SpecPlan } from "../lang/ast.ts";
import { validateSpecPlanShape } from "../lang/shape.ts";
import { MalformedOutputError, structuredCall } from "./client.ts";

// Phase 1+2 of vector: translate a casual prompt into formal axioms and a
// layered decomposition. Merged into one call so the spec and the
// decomposition cannot drift apart. The resulting SpecPlan is the fixed point
// of the whole run — the Generator retries against it, never the other way.
// The schema in schemas/spec-plan.json constrains the model's output AND
// generates the SpecPlan type/parser via mjst.

export type { SpecPlan } from "../lang/ast.ts";

// Frozen instructions — cached; the volatile user prompt goes in the user turn.
const ARCHITECT_SYSTEM_PROMPT = `You are the vector Architect, the spec-extraction phase of a \
formally verified code-generation pipeline in the tradition of Dijkstra's "Notes on Structured \
Programming": the program will be PROVEN correct by an SMT solver, not tested.

Translate the user's casual request into:
1. AXIOMS — the formal contract as precise pre/post-conditions in mathematical English. \
"Throws/errors/rejects if X" means a PRECONDITION of not-X (the runtime guard is generated \
from it). Guarantees about the output are POSTCONDITIONS. Give each axiom a short stable id \
(AX1, AX2, ...). Do not invent requirements the user did not state or clearly imply; if the \
request names a constant (like an exchange rate), fix it as a literal in the axioms.
2. UNITS — a Dijkstra-style layered decomposition into 1-4 small pure functions, lowest layer \
first. Each layer abstracts the one below it and may only call strictly lower layers. Every \
function is a single pure expression over Real/Int/Bool values — no strings, arrays, loops, \
recursion, or state. Assign each unit the axiom ids it is responsible for enforcing.

Stay within what the expression language can verify: arithmetic (+ - * /), comparisons, \
boolean logic, and if-then-else. Prefer Real for money and measurements. Prefer linear \
arithmetic (variables times literal constants). If the request is fundamentally outside this \
fragment (needs strings, IO, loops), still produce the closest faithful numeric core of it.`;

function parseSpecPlan(input: unknown): SpecPlan {
  const spec = parseSpecPlanDocument(input);
  const errors = validateSpecPlanShape(spec);
  if (errors.length > 0) {
    throw new MalformedOutputError(
      `spec plan failed shape validation:\n- ${errors.join("\n- ")}`,
    );
  }
  return spec;
}

export async function extractSpecPlan(prompt: string): Promise<SpecPlan> {
  return structuredCall({
    systemPrompt: ARCHITECT_SYSTEM_PROMPT,
    userContent: `User request:\n\n${prompt}`,
    jsonSchema: specPlanJsonSchema as Record<string, unknown>,
    parse: parseSpecPlan,
  });
}
