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
import {
  checkAxiomTraceability,
  checkSpecProgramConsistency,
  formatReportFeedback,
} from "./verify.ts";

// The vector state machine: SPEC → GENERATE → VALIDATE → VERIFY → (retry) → REPORT.
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
        // Malformed AST: cheap retry, no solver time burned. Always relay the
        // parse errors — even on the first attempt, when there is no previous
        // program to include, the generator must know what to avoid.
        failureReasons = [
          `generator produced a malformed program: ${err.message}`,
        ];
        onPhase("[3/5] Generative logic", "malformed program — retrying");
        feedback = {
          previousProgram: lastProgram,
          message: failureReasons.join("\n"),
        };
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
            ...checkSpecProgramConsistency(specPlan, program),
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
        "vector could not produce a verifiable program.",
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

// checkAxiomTraceability and formatReportFeedback now live in verify.ts, shared
// with the standalone `--verify` entry point (Claude Code as Architect +
// Generator). They are re-exported here so existing importers keep working.
export { checkAxiomTraceability } from "./verify.ts";
