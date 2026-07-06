import programJsonSchema from "../../schemas/program.json" with {
  type: "json",
};
import { parseProgram } from "../generated/program/index.ts";
import type { Program, SpecPlan } from "../lang/ast.ts";
import { structuredCall } from "./client.ts";

// Phase 3 of EWD-1: write the implementation AND its formal contract
// simultaneously, in EWD-lang. On retries the user turn carries the previous
// program plus the solver's counterexamples or the validator's errors; the
// system prompt (the language manual) stays frozen and cached. The schema in
// schemas/program.json constrains the model's output AND generates the
// Program type/parser via mjst; the pipeline's validation stage applies the
// deep shape/type/traceability checks.

const GENERATOR_SYSTEM_PROMPT = `You are the EWD-1 Generator. You write programs in EWD-lang, \
a tiny expression language that is verified by an SMT solver: every ensures clause you write \
will be PROVEN to hold for ALL inputs satisfying the requires clauses, or refuted with a \
counterexample. Write the implementation and its contract together.

THE LANGUAGE (JSON AST):
- Types: Real (exact rationals), Int, Bool. No strings, arrays, loops, recursion, or state.
- Expression nodes: num (decimal STRING literal like "0.91" — never scientific notation), \
bool, var, unop (not/neg), binop (+ - * / < <= > >= == != and or implies), ite \
(if-then-else expression), call.
- A function body is ONE pure expression whose type equals returnType. \
"result" may appear ONLY in ensures clauses, where it denotes the return value.
- Layering (Dijkstra's step-wise composition): functions are ordered lowest layer first and \
may only call functions in STRICTLY LOWER layers of this same program.
- Division: the verifier proves the denominator is nonzero on every reachable path; guard \
divisions with a requires clause (denominator != 0) or an ite.

THE CONTRACT:
- requires = preconditions. A spec axiom saying "throws/errors if X" becomes requires NOT X; \
the emitted TypeScript enforces it with a runtime throw.
- ensures = postconditions over params and result, proven by the solver.
- Every clause carries the axiomId of the spec-plan axiom it formalizes, and EVERY axiom in \
the spec plan must be enforced by at least one clause somewhere in the program. Do not add \
clauses for axioms that do not exist, and do not weaken an axiom's meaning.

SOLVER-FRIENDLINESS:
- Prefer linear arithmetic: multiply variables by literal constants, not by other variables. \
Nonlinear terms can make the solver answer "unknown".
- Keep functions tiny; put shared arithmetic in a lower layer and call it.

When you receive FEEDBACK about a previous attempt, repair the program minimally — keep \
everything that was already proven and fix only what the feedback refutes.`;

export interface GeneratorFeedback {
  previousProgram: Program;
  message: string;
}

export async function generateProgram(
  specPlan: SpecPlan,
  feedback?: GeneratorFeedback,
): Promise<Program> {
  const feedbackBlock = feedback
    ? `\n\nFEEDBACK on your previous attempt — repair it minimally:\n${feedback.message}\n\nPrevious program:\n${JSON.stringify(feedback.previousProgram)}`
    : "";
  return structuredCall({
    systemPrompt: GENERATOR_SYSTEM_PROMPT,
    userContent: `Spec plan:\n${JSON.stringify(specPlan, null, 2)}${feedbackBlock}`,
    jsonSchema: programJsonSchema as Record<string, unknown>,
    parse: parseProgram,
  });
}
