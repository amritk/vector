import type {
  ClauseVerdict,
  FunctionReport,
  VerificationReport,
} from "../solve/types.ts";

// Renders the "Dijkstra Dashboard": the governance-deck view of a verification
// run. All structural proof state in one box — per-layer Hoare triples, one
// checkmark per postcondition, counterexamples when the solver refutes a
// claim, and an honest note about what is enforced at runtime vs proven.

export type VerdictStatus = "PROVEN" | "REFUTED" | "UNKNOWN";

export interface DashboardInput {
  prompt: string;
  attempt: number;
  maxRetries: number;
  report: VerificationReport;
}

const WIDTH = 68; // inner content width

export function verdictStatus(report: VerificationReport): VerdictStatus {
  if (report.ok) return "PROVEN";
  // Every failure mode except a bare solver UNKNOWN is a concrete defect.
  if (
    report.satCount > 0 ||
    report.divHazardCount > 0 ||
    report.preHazardCount > 0 ||
    report.trivialCount > 0 ||
    report.vacuousCount > 0 ||
    report.conformanceIssues.length > 0
  ) {
    return "REFUTED";
  }
  return "UNKNOWN";
}

export function renderDashboard(input: DashboardInput): string {
  const { report } = input;
  const status = verdictStatus(report);
  const lines: string[] = [];

  lines.push(top());
  lines.push(center("VECTOR — PROOF REPORT"));
  lines.push(divider());
  for (const line of wrapText(`Prompt:  "${input.prompt}"`, WIDTH - 2)) {
    lines.push(row(line));
  }
  lines.push(
    row(
      `Attempt: ${input.attempt}/${input.maxRetries}      Solver: ${report.solver}      Status: ${status}`,
    ),
  );
  lines.push(divider());

  report.functions.forEach((fn, i) => {
    if (i > 0) lines.push(lightDivider());
    for (const line of functionRows(fn)) lines.push(line);
  });

  if (report.conformanceIssues.length > 0) {
    lines.push(lightDivider());
    lines.push(row("FLOAT64 CONFORMANCE"));
    for (const issue of report.conformanceIssues) {
      const inputs = Object.entries(issue.inputs)
        .map(([k, v]) => `${k} = ${v}`)
        .join(", ");
      for (const line of wrapText(
        `✘ ${issue.function} ${issue.axiomId} (${issue.pretty}) proven over reals but FALSE at ${inputs} → result = ${issue.result}`,
        WIDTH - 4,
      )) {
        lines.push(row(`  ${line}`));
      }
    }
  }

  lines.push(divider());
  lines.push(row(`VERDICT: ${verdictLine(status, report)}`));
  lines.push(row('"Testing shows the presence of bugs, never their absence."'));
  lines.push(row(" — proven over exact reals; float64 conformance-checked."));
  lines.push(bottom());
  return lines.join("\n");
}

function functionRows(fn: FunctionReport): string[] {
  const rows: string[] = [];
  rows.push(row(`LAYER ${fn.layer} · ${fn.signature}`));
  const pre =
    fn.requiresPretty.length > 0 ? fn.requiresPretty.join("  ∧  ") : "true";
  for (const line of wrapText(`{ ${pre} }  ${fn.bodyPretty}`, WIDTH - 4)) {
    rows.push(row(`  ${line}`));
  }
  const post = fn.ensures.map((e) => e.pretty).join("  ∧  ");
  for (const line of wrapText(`{ ${post} }`, WIDTH - 4)) {
    rows.push(row(`  ${line}`));
  }
  if (fn.vacuous) {
    for (const line of wrapText(
      "✘ VACUOUS: no input provably satisfies the requires — postconditions hold only vacuously",
      WIDTH - 4,
    )) {
      rows.push(row(`  ${line}`));
    }
  }
  for (const verdict of fn.ensures) {
    rows.push(row(`  ${clauseRow(verdict)}`));
    if (verdict.counterexample) {
      const inputs = Object.entries(verdict.counterexample.inputs)
        .map(([k, v]) => `${k} = ${v}`)
        .join(", ");
      for (const line of wrapText(
        `counterexample: ${inputs} → result = ${verdict.counterexample.result}`,
        WIDTH - 8,
      )) {
        rows.push(row(`      ${line}`));
      }
    }
  }
  for (const hazard of fn.divHazards) {
    const inputs = hazard.counterexample
      ? Object.entries(hazard.counterexample.inputs)
          .map(([k, v]) => `${k} = ${v}`)
          .join(", ")
      : "";
    for (const line of wrapText(
      `✘ division hazard in ${hazard.pretty}${inputs ? ` (e.g. ${inputs})` : ""}`,
      WIDTH - 4,
    )) {
      rows.push(row(`  ${line}`));
    }
  }
  for (const hazard of fn.preHazards) {
    const inputs = hazard.counterexample
      ? Object.entries(hazard.counterexample.inputs)
          .map(([k, v]) => `${k} = ${v}`)
          .join(", ")
      : "";
    for (const line of wrapText(
      `✘ call to ${hazard.callee} may violate its precondition ${hazard.pretty}${inputs ? ` (e.g. ${inputs})` : ""}`,
      WIDTH - 4,
    )) {
      rows.push(row(`  ${line}`));
    }
  }
  if (fn.requiresPretty.length > 0) {
    for (const line of wrapText(
      `⚠ guard ${fn.requiresPretty.join(" ∧ ")} enforced at runtime; proven to hold at every internal call site`,
      WIDTH - 4,
    )) {
      rows.push(row(`  ${line}`));
    }
  }
  return rows;
}

function clauseRow(verdict: ClauseVerdict): string {
  if (verdict.trivial) {
    return `✘ ensures ${verdict.axiomId}  TRIVIAL (holds independent of the body)`;
  }
  switch (verdict.status) {
    case "proven":
      return `✔ ensures ${verdict.axiomId}  proven (unsat, ∀ inputs)`;
    case "counterexample":
      return `✘ ensures ${verdict.axiomId}  REFUTED (sat)`;
    case "unknown":
      return `? ensures ${verdict.axiomId}  undecided (unknown)`;
  }
}

function verdictLine(
  status: VerdictStatus,
  report: VerificationReport,
): string {
  switch (status) {
    case "PROVEN":
      return "ALL POSTCONDITIONS PROVEN FOR ALL INPUTS";
    case "REFUTED": {
      const violations =
        report.satCount +
        report.divHazardCount +
        report.preHazardCount +
        report.trivialCount +
        report.vacuousCount +
        report.conformanceIssues.length;
      return `${violations} CONTRACT VIOLATION(S) FOUND — SEE ABOVE`;
    }
    case "UNKNOWN":
      return `${report.unknownCount} CLAUSE(S) UNDECIDED BY THE SOLVER`;
  }
}

function top(): string {
  return `╔${"═".repeat(WIDTH)}╗`;
}
function bottom(): string {
  return `╚${"═".repeat(WIDTH)}╝`;
}
function divider(): string {
  return `╠${"═".repeat(WIDTH)}╣`;
}
function lightDivider(): string {
  return `╟${"─".repeat(WIDTH)}╢`;
}
function row(text: string): string {
  const clipped =
    text.length > WIDTH - 1 ? `${text.slice(0, WIDTH - 2)}…` : text;
  return `║ ${clipped.padEnd(WIDTH - 1)}║`;
}
function center(text: string): string {
  const pad = Math.max(0, Math.floor((WIDTH - text.length) / 2));
  return row(" ".repeat(pad) + text);
}

function wrapText(text: string, width: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current && current.length + word.length + 1 > width) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}
