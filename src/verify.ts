import { emitTypeScript } from "./emit/typescript.ts";
import type { Program, SpecPlan } from "./lang/ast.ts";
import { validateProgramShape, validateSpecPlanShape } from "./lang/shape.ts";
import { type StyleWarning, collectStyleWarnings } from "./lang/style.ts";
import { typecheckProgram } from "./lang/validate.ts";
import { renderDashboard, verdictStatus } from "./report/dashboard.ts";
import { verifyProgramViaSolver } from "./solve/runner.ts";
import type { VerificationReport } from "./solve/types.ts";

// The deterministic verifier, exposed as a one-shot over a (SpecPlan, Program)
// pair. vector never calls a model: Claude Code (the vector skill) or a person
// writes the two JSON artifacts and calls this to have Z3 (plus the
// shape/type/traceability gates) prove or refute them. The structured
// `feedback` it returns is what drives the in-context repair loop.

/** One machine-readable repair instruction: a single clause the solver could not prove. */
export interface VerifyFeedbackItem {
  function: string;
  axiomId: string;
  /** The property as pretty-printed vector-lang. */
  property: string;
  issue:
    | "counterexample"
    | "unknown"
    | "division-hazard"
    | "precondition-hazard"
    | "vacuous"
    | "trivial"
    | "conformance";
  /** Present for counterexample / hazard / conformance issues. */
  counterexample?: { inputs: Record<string, string>; result?: string };
  /** Human/LLM-readable repair hint. */
  hint: string;
}

export type VerifyOutcome =
  | {
      status: "PROVEN";
      report: VerificationReport;
      dashboard: string;
      emittedCode: string;
      /** Advisory only — never blocks a proof. */
      styleWarnings: StyleWarning[];
    }
  | {
      status: "REFUTED" | "UNKNOWN";
      report: VerificationReport;
      dashboard: string;
      /** A single prose block suitable for pasting back to the generator. */
      feedback: string;
      /** The same content, structured per unproven clause. */
      items: VerifyFeedbackItem[];
      /** Advisory only — never blocks a proof. */
      styleWarnings: StyleWarning[];
    }
  | { status: "INVALID"; errors: string[]; feedback: string }
  | { status: "ERROR"; message: string };

export interface VerifyOptions {
  /** Label shown on the dashboard's prompt line. */
  label?: string;
}

// The Generator writes both body and contract, so it could game the contract by
// dropping axioms or formalizing them on the wrong side. Deterministic checks:
// no clause may cite a phantom axiom; every axiom must be enforced by a clause;
// and the enforcement must match the axiom's POLARITY — a `pre` axiom belongs in
// a `requires`, a `post` axiom in an `ensures`. (Enforcing a `post` guarantee as
// a mere runtime `requires` would silently drop the proof obligation.)
export function checkAxiomTraceability(
  specPlan: SpecPlan,
  program: Program,
): string[] {
  const errors: string[] = [];
  const axiomKind = new Map(specPlan.axioms.map((a) => [a.id, a.kind]));
  const citedByRequires = new Set<string>();
  const citedByEnsures = new Set<string>();

  for (const fn of program.functions) {
    for (const clause of fn.requires) {
      citedByRequires.add(clause.axiomId);
      if (!axiomKind.has(clause.axiomId)) {
        errors.push(
          `${fn.name}: requires clause cites unknown axiom "${clause.axiomId}"`,
        );
      }
    }
    for (const clause of fn.ensures) {
      citedByEnsures.add(clause.axiomId);
      if (!axiomKind.has(clause.axiomId)) {
        errors.push(
          `${fn.name}: ensures clause cites unknown axiom "${clause.axiomId}"`,
        );
      }
    }
  }

  for (const axiom of specPlan.axioms) {
    const inReq = citedByRequires.has(axiom.id);
    const inEns = citedByEnsures.has(axiom.id);
    if (!inReq && !inEns) {
      errors.push(
        `axiom ${axiom.id} ("${axiom.statement}") is not enforced by any clause`,
      );
      continue;
    }
    if (axiom.kind === "pre" && !inReq) {
      errors.push(
        `axiom ${axiom.id} is "pre" but is only formalized as an ensures clause; a precondition must be enforced by a requires clause`,
      );
    }
    if (axiom.kind === "post" && !inEns) {
      errors.push(
        `axiom ${axiom.id} is "post" but is only formalized as a requires clause; a postcondition must be proven by an ensures clause`,
      );
    }
  }
  return errors;
}

// The SpecPlan's layered decomposition is the fixed point of a run. The Program
// must implement exactly that decomposition — same units, layers, and
// signatures — so the Generator can't quietly restructure around a hard proof.
export function checkSpecProgramConsistency(
  specPlan: SpecPlan,
  program: Program,
): string[] {
  const errors: string[] = [];
  const units = new Map(specPlan.units.map((u) => [u.name, u]));
  const fns = new Map(program.functions.map((f) => [f.name, f]));

  for (const u of specPlan.units) {
    if (!fns.has(u.name)) {
      errors.push(
        `spec unit "${u.name}" has no matching function in the program`,
      );
    }
  }
  for (const fn of program.functions) {
    const u = units.get(fn.name);
    if (!u) {
      errors.push(
        `function "${fn.name}" is not declared as a unit in the spec plan`,
      );
      continue;
    }
    if (fn.layer !== u.layer) {
      errors.push(
        `function "${fn.name}": layer ${fn.layer} disagrees with spec unit layer ${u.layer}`,
      );
    }
    if (fn.returnType !== u.returnType) {
      errors.push(
        `function "${fn.name}": returnType ${fn.returnType} disagrees with spec unit returnType ${u.returnType}`,
      );
    }
    if (fn.params.length !== u.params.length) {
      errors.push(
        `function "${fn.name}": has ${fn.params.length} param(s) but spec unit declares ${u.params.length}`,
      );
    } else {
      fn.params.forEach((p, i) => {
        const up = u.params[i];
        if (up && (p.name !== up.name || p.type !== up.type)) {
          errors.push(
            `function "${fn.name}": param ${i + 1} is ${p.name}:${p.type} but spec unit declares ${up.name}:${up.type}`,
          );
        }
      });
    }
  }
  return errors;
}

/** Structured, per-clause version of the generator feedback. */
export function collectFeedbackItems(
  report: VerificationReport,
): VerifyFeedbackItem[] {
  const items: VerifyFeedbackItem[] = [];
  for (const fn of report.functions) {
    if (fn.vacuous) {
      items.push({
        function: fn.name,
        axiomId: "(reachable)",
        property: "requires are satisfiable",
        issue: "vacuous",
        hint: "No input provably satisfies this function's requires clauses (they are contradictory, or too nonlinear for the solver to decide), so every postcondition would hold vacuously and prove nothing. Remove or simplify the precondition(s); do NOT tighten requires to force a proof through.",
      });
    }
    for (const verdict of fn.ensures) {
      if (verdict.trivial) {
        items.push({
          function: fn.name,
          axiomId: verdict.axiomId,
          property: verdict.pretty,
          issue: "trivial",
          hint: "This ensures clause could not be shown to depend on the implementation — it is a tautology (holds regardless of the body), or too nonlinear for the solver to decide. Restate it as a real constraint on `result` that the body determines.",
        });
        continue;
      }
      if (verdict.status === "proven") continue;
      if (verdict.status === "counterexample" && verdict.counterexample) {
        items.push({
          function: fn.name,
          axiomId: verdict.axiomId,
          property: verdict.pretty,
          issue: "counterexample",
          counterexample: verdict.counterexample,
          hint: "The postcondition is false for the input shown. Fix the body or tighten a requires clause so it holds for all remaining inputs.",
        });
      } else {
        items.push({
          function: fn.name,
          axiomId: verdict.axiomId,
          property: verdict.pretty,
          issue: "unknown",
          hint: "The solver returned UNKNOWN. Restate the property and body in linear arithmetic (variables multiplied only by literal constants).",
        });
      }
    }
    for (const hazard of fn.divHazards) {
      items.push({
        function: fn.name,
        axiomId: "(division)",
        property: hazard.pretty,
        issue: "division-hazard",
        counterexample: hazard.counterexample,
        hint: "The denominator may be zero on some reachable path. Add a requires clause (denominator != 0) or guard the division with an ite.",
      });
    }
    for (const hazard of fn.preHazards) {
      items.push({
        function: fn.name,
        axiomId: `(calls ${hazard.callee})`,
        property: hazard.pretty,
        issue: "precondition-hazard",
        counterexample: hazard.counterexample,
        hint: `The call to ${hazard.callee} can violate its precondition (${hazard.pretty}) for the arguments shown. Strengthen this function's requires, or guard the call with an ite, so the callee is only reached where its precondition holds.`,
      });
    }
  }
  for (const issue of report.conformanceIssues) {
    items.push({
      function: issue.function,
      axiomId: issue.axiomId,
      property: issue.pretty,
      issue: "conformance",
      counterexample: { inputs: issue.inputs, result: issue.result },
      hint:
        issue.kind === "unsampled"
          ? "No float64 input satisfied this function's preconditions, so the emitted code could not be checked against its contract. Widen the requires (or use bounds a double can represent) so real inputs exist."
          : issue.kind === "emitted-code"
            ? "The emitted TypeScript, executed, disagrees with the program the solver proved. This is a fault in vector's emitter rather than in this program; rewriting the expression in an equivalent form may avoid it, and it should be reported."
            : issue.kind === "callee-guard"
              ? "The callee's precondition holds at this call site over exact reals, but float64 rounding of the computed argument violates its guard — the emitted code throws on an input this function's contract accepts. Guard the call with an ite, or strengthen this function's requires with a float-safe margin."
              : "Proven over exact reals but FALSE when the emitted float64 code runs on the input shown. Avoid exact `==`/`!=` over Real results (float rounding); use an inequality/tolerance, or move to Int where the value is genuinely discrete.",
    });
  }
  return items;
}

export function formatReportFeedback(report: VerificationReport): string {
  const lines: string[] = [];
  for (const fn of report.functions) {
    if (fn.vacuous) {
      lines.push(
        `Function ${fn.name}: VACUOUS — no input provably satisfies its requires clauses (contradictory, or undecidable for the solver), so the postconditions are proven only vacuously. Remove or simplify the precondition(s).`,
      );
    }
    for (const verdict of fn.ensures) {
      if (verdict.trivial) {
        lines.push(
          `Function ${fn.name}, ensures ${verdict.axiomId} (${verdict.pretty}): TRIVIAL — the clause was not shown to depend on the body (a tautology, or undecidable), so it formalizes nothing. Restate it as a real constraint on result.`,
        );
        continue;
      }
      if (verdict.status === "proven") continue;
      if (verdict.status === "counterexample" && verdict.counterexample) {
        const inputs = Object.entries(verdict.counterexample.inputs)
          .map(([k, v]) => `${k} = ${v}`)
          .join(", ");
        lines.push(
          `Function ${fn.name}, ensures ${verdict.axiomId} (${verdict.pretty}): REFUTED — ` +
            `counterexample ${inputs} gives result = ${verdict.counterexample.result}.`,
        );
      } else {
        lines.push(
          `Function ${fn.name}, ensures ${verdict.axiomId} (${verdict.pretty}): the solver returned UNKNOWN — restate the property and body using linear arithmetic (variables multiplied only by literal constants).`,
        );
      }
    }
    for (const hazard of fn.divHazards) {
      const inputs = hazard.counterexample
        ? Object.entries(hazard.counterexample.inputs)
            .map(([k, v]) => `${k} = ${v}`)
            .join(", ")
        : "some input";
      lines.push(
        `Function ${fn.name}: possible division by zero in ${hazard.pretty} (e.g. ${inputs}) — add a requires clause or an ite guard.`,
      );
    }
    for (const hazard of fn.preHazards) {
      const inputs = hazard.counterexample
        ? Object.entries(hazard.counterexample.inputs)
            .map(([k, v]) => `${k} = ${v}`)
            .join(", ")
        : "some input";
      lines.push(
        `Function ${fn.name}: the call to ${hazard.callee} can violate its precondition ${hazard.pretty} (e.g. ${inputs}) — strengthen this function's requires or guard the call with an ite.`,
      );
    }
  }
  for (const issue of report.conformanceIssues) {
    const inputs = Object.entries(issue.inputs)
      .map(([k, v]) => `${k} = ${v}`)
      .join(", ");
    lines.push(
      issue.kind === "unsampled"
        ? `Function ${issue.function}: no float64 input satisfies its requires (${issue.pretty}), so the emitted code could not be checked — widen the requires or use float-representable bounds.`
        : issue.kind === "emitted-code"
          ? `Function ${issue.function}: the emitted TypeScript does not match the proven program${inputs ? ` at ${inputs}` : ""} ${issue.result} — a fault in vector's emitter, not in this program.`
          : issue.kind === "callee-guard"
            ? `Function ${issue.function}: the call into ${issue.axiomId.replace(/^\(calls /, "").replace(/\)$/, "")} throws in float64 at ${inputs} — its guard ${issue.pretty} was proven over reals but is violated by the rounded argument. Guard the call with an ite or add a float-safe margin to the requires.`
            : `Function ${issue.function}, ensures ${issue.axiomId} (${issue.pretty}): proven over reals but FALSE in float64 at ${inputs} → result = ${issue.result}. Avoid exact == over Real; use an inequality/tolerance.`,
    );
  }
  return lines.join("\n");
}

/**
 * Run the full deterministic gate over a spec plan and a program: shape → type
 * → axiom traceability → Z3. Takes raw JSON (as emitted by an LLM) and returns
 * the *complete* list of problems on any failure, so the caller's repair loop
 * never has to fix errors one at a time.
 */
export async function verifySpecAndProgram(
  rawSpecPlan: unknown,
  rawProgram: unknown,
  options: VerifyOptions = {},
): Promise<VerifyOutcome> {
  const label = options.label ?? "spec + program";

  const shapeErrors = [
    ...validateSpecPlanShape(rawSpecPlan).map((e) => `spec plan: ${e}`),
    ...validateProgramShape(rawProgram).map((e) => `program: ${e}`),
  ];
  if (shapeErrors.length > 0) {
    return {
      status: "INVALID",
      errors: shapeErrors,
      feedback: `The artifacts failed structural validation:\n- ${shapeErrors.join("\n- ")}`,
    };
  }

  const specPlan = rawSpecPlan as SpecPlan;
  const program = rawProgram as Program;

  const semanticErrors = [
    ...typecheckProgram(program).errors,
    ...checkSpecProgramConsistency(specPlan, program),
    ...checkAxiomTraceability(specPlan, program),
  ];
  if (semanticErrors.length > 0) {
    return {
      status: "INVALID",
      errors: semanticErrors,
      feedback: `The program failed deterministic validation:\n- ${semanticErrors.join("\n- ")}`,
    };
  }

  const styleWarnings = collectStyleWarnings(program);

  const result = await verifyProgramViaSolver(program);
  if (result.kind === "invalid") {
    return {
      status: "INVALID",
      errors: result.errors,
      feedback: `The solver rejected the program:\n- ${result.errors.join("\n- ")}`,
    };
  }
  if (result.kind === "error") {
    return { status: "ERROR", message: result.message };
  }

  const { report } = result;
  const dashboard = renderDashboard({
    prompt: label,
    attempt: 1,
    maxRetries: 1,
    report,
  });

  if (report.ok) {
    return {
      status: "PROVEN",
      report,
      dashboard,
      emittedCode: emitTypeScript(program),
      styleWarnings,
    };
  }

  return {
    status: verdictStatus(report) === "UNKNOWN" ? "UNKNOWN" : "REFUTED",
    report,
    dashboard,
    feedback: formatReportFeedback(report),
    items: collectFeedbackItems(report),
    styleWarnings,
  };
}
