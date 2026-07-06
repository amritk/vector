import { type SpecPlan, extractSpecPlan } from "./agents/architect.ts";
import { MalformedOutputError } from "./agents/client.ts";
import { type GeneratorFeedback, generateProgram } from "./agents/generator.ts";
import { emitTypeScript } from "./emit/typescript.ts";
import type { Program } from "./lang/ast.ts";
import { validateProgramShape } from "./lang/shape.ts";
import { typecheckProgram } from "./lang/validate.ts";
import {
  type VerdictStatus,
  renderDashboard,
  verdictStatus,
} from "./report/dashboard.ts";
import { verifyProgramViaSolver } from "./solve/runner.ts";
import type { VerificationReport } from "./solve/types.ts";

// The EWD-1 state machine: SPEC → GENERATE → VALIDATE → VERIFY → (retry) → REPORT.
// The spec plan is extracted once and never regenerated — Dijkstra's fixed
// point. Only the construction (the Generator's program) retries, driven by
// deterministic feedback: validator errors or the solver's counterexamples.

export type PipelineStatus = VerdictStatus | "FAILED";

export interface PipelineOptions {
  maxRetries?: number;
  onPhase?: (label: string, message: string) => void;
}

export interface PipelineOutcome {
  status: PipelineStatus;
  attempts: number;
  specPlan: SpecPlan;
  program?: Program;
  report?: VerificationReport;
  /** Only present when status is PROVEN — unproven code is never emitted. */
  emittedCode?: string;
  dashboardText: string;
  /** Populated when status is FAILED: the last validation or infrastructure errors. */
  failureReasons: string[];
}

export async function runPipeline(
  prompt: string,
  options: PipelineOptions = {},
): Promise<PipelineOutcome> {
  const maxRetries = options.maxRetries ?? 3;
  const onPhase = options.onPhase ?? (() => {});

  const specPlan = await extractSpecPlan(prompt);
  onPhase(
    "[1/5] Spec extraction",
    `${specPlan.axioms.length} axiom(s): ${specPlan.axioms.map((a) => `${a.id} (${a.kind})`).join(", ")}`,
  );
  onPhase(
    "[2/5] Decomposition",
    `${specPlan.units.length} layer(s): ${specPlan.units.map((u) => u.name).join(" → ")}`,
  );

  let feedback: GeneratorFeedback | undefined;
  let lastProgram: Program | undefined;
  let lastReport: VerificationReport | undefined;
  let failureReasons: string[] = [];
  let attempt = 0;

  while (attempt < maxRetries) {
    attempt += 1;
    onPhase("[3/5] Generative logic", `attempt ${attempt}/${maxRetries}`);

    let program: Program;
    try {
      program = await generateProgram(specPlan, feedback);
    } catch (err) {
      if (err instanceof MalformedOutputError) {
        // Malformed AST: cheap retry, no solver time burned.
        failureReasons = [
          `generator produced a malformed program: ${err.message}`,
        ];
        onPhase("[3/5] Generative logic", "malformed program — retrying");
        feedback = lastProgram
          ? { previousProgram: lastProgram, message: failureReasons.join("\n") }
          : undefined;
        continue;
      }
      throw err;
    }
    lastProgram = program;

    // Shape first: the typechecker assumes structurally sound nodes.
    const shapeErrors = validateProgramShape(program);
    const validationErrors =
      shapeErrors.length > 0
        ? shapeErrors
        : [
            ...typecheckProgram(program).errors,
            ...checkAxiomTraceability(specPlan, program),
          ];
    if (validationErrors.length > 0) {
      failureReasons = validationErrors;
      onPhase(
        "[3/5] Generative logic",
        `${validationErrors.length} validation error(s) — retrying`,
      );
      feedback = {
        previousProgram: program,
        message: `The program failed deterministic validation:\n- ${validationErrors.join("\n- ")}`,
      };
      continue;
    }

    const result = await verifyProgramViaSolver(program);
    if (result.kind === "invalid") {
      failureReasons = result.errors;
      feedback = {
        previousProgram: program,
        message: `The solver rejected the program:\n- ${result.errors.join("\n- ")}`,
      };
      continue;
    }
    if (result.kind === "error") {
      // Infrastructure failure — retrying the generator won't fix it.
      failureReasons = [result.message];
      break;
    }

    lastReport = result.report;
    onPhase(
      "[4/5] Deterministic solver",
      `${result.report.solver} · ${result.report.totalVcs} VCs · ${result.report.unsatCount} unsat · ` +
        `${result.report.satCount} sat · ${result.report.unknownCount} unknown · ${result.report.millis} ms`,
    );

    if (result.report.ok) break;

    feedback = {
      previousProgram: program,
      message: formatReportFeedback(result.report),
    };
  }

  const status: PipelineStatus = lastReport
    ? verdictStatus(lastReport)
    : "FAILED";
  onPhase("[5/5] Report", status);

  const dashboardText = lastReport
    ? renderDashboard({ prompt, attempt, maxRetries, report: lastReport })
    : [
        "EWD-1 could not produce a verifiable program.",
        ...failureReasons.map((r) => `  ✘ ${r}`),
      ].join("\n");

  return {
    status,
    attempts: attempt,
    specPlan,
    program: lastProgram,
    report: lastReport,
    emittedCode:
      status === "PROVEN" && lastProgram
        ? emitTypeScript(lastProgram)
        : undefined,
    dashboardText,
    failureReasons: status === "FAILED" ? failureReasons : [],
  };
}

// The Generator writes both body and contract, so it could game the contract
// by dropping axioms. Deterministic check: every spec-plan axiom must be
// enforced by at least one clause, and no clause may cite a phantom axiom.
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

function formatReportFeedback(report: VerificationReport): string {
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
