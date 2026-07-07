import { emitTypeScript } from "./emit/typescript.ts";
import type { Program, SpecPlan } from "./lang/ast.ts";
import { validateProgramShape, validateSpecPlanShape } from "./lang/shape.ts";
import { typecheckProgram } from "./lang/validate.ts";
import { renderDashboard, verdictStatus } from "./report/dashboard.ts";
import { verifyProgramViaSolver } from "./solve/runner.ts";
import type { VerificationReport } from "./solve/types.ts";

// The deterministic verifier, exposed as a one-shot over a (SpecPlan, Program)
// pair. This is the veto half of EWD-1 with the two LLM phases removed: when
// Claude Code itself plays Architect + Generator, it emits the two JSON
// artifacts and calls this to have Z3 (plus the shape/type/traceability gates)
// prove or refute them. The structured `feedback` it returns is what drives the
// in-context repair loop, exactly as the counterexamples drove the nested
// generator in pipeline.ts.

/** One machine-readable repair instruction: a single clause the solver could not prove. */
export interface VerifyFeedbackItem {
  function: string;
  axiomId: string;
  /** The property as pretty-printed EWD-lang. */
  property: string;
  issue: "counterexample" | "unknown" | "division-hazard";
  /** Present for counterexample / division-hazard issues. */
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
    }
  | {
      status: "REFUTED" | "UNKNOWN";
      report: VerificationReport;
      dashboard: string;
      /** A single prose block suitable for pasting back to the generator. */
      feedback: string;
      /** The same content, structured per unproven clause. */
      items: VerifyFeedbackItem[];
    }
  | { status: "INVALID"; errors: string[]; feedback: string }
  | { status: "ERROR"; message: string };

export interface VerifyOptions {
  /** Label shown on the dashboard's prompt line. */
  label?: string;
}

// The Generator writes both body and contract, so it could game the contract by
// dropping axioms. Deterministic check: every spec-plan axiom must be enforced
// by at least one clause, and no clause may cite a phantom axiom.
export function checkAxiomTraceability(
  specPlan: SpecPlan,
  program: Program,
): string[] {
  const errors: string[] = [];
  const specIds = new Set(specPlan.axioms.map((a) => a.id));
  const usedIds = new Set<string>();
  for (const fn of program.functions) {
    for (const clause of [...fn.requires, ...fn.ensures]) {
      usedIds.add(clause.axiomId);
      if (!specIds.has(clause.axiomId)) {
        errors.push(
          `${fn.name}: clause cites unknown axiom "${clause.axiomId}"`,
        );
      }
    }
  }
  for (const axiom of specPlan.axioms) {
    if (!usedIds.has(axiom.id)) {
      errors.push(
        `axiom ${axiom.id} ("${axiom.statement}") is not enforced by any clause`,
      );
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
    for (const verdict of fn.ensures) {
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
  }
  return items;
}

export function formatReportFeedback(report: VerificationReport): string {
  const lines: string[] = [];
  for (const fn of report.functions) {
    for (const verdict of fn.ensures) {
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
    ...checkAxiomTraceability(specPlan, program),
  ];
  if (semanticErrors.length > 0) {
    return {
      status: "INVALID",
      errors: semanticErrors,
      feedback: `The program failed deterministic validation:\n- ${semanticErrors.join("\n- ")}`,
    };
  }

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
    };
  }

  return {
    status: verdictStatus(report) === "UNKNOWN" ? "UNKNOWN" : "REFUTED",
    report,
    dashboard,
    feedback: formatReportFeedback(report),
    items: collectFeedbackItems(report),
  };
}
