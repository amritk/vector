import type { AdversarialReviewResult } from "../agents/adversary.ts";

// Renders the adversarial review as GitHub-flavored markdown, shaped for
// pasting straight into a PR description or sticky comment. The verdict line
// is machine-greppable (`**Adversarial review:** CLEAR|FLAGGED`) so CI can
// gate on the text as well as the exit code.

const KIND_LABEL: Record<string, string> = {
  "missing-axiom": "Missing axiom",
  "intent-conflict": "Intent conflict",
  "unjustified-delta": "Unjustified delta",
  "underspecified-domain": "Underspecified domain",
  "formula-shaped-axiom": "Formula-shaped axiom",
  "out-of-scope": "Out of scope",
};

export function renderReviewMarkdown(result: AdversarialReviewResult): string {
  const lines: string[] = [];
  const badge = result.verdict === "CLEAR" ? "✅ CLEAR" : "🛑 FLAGGED";
  lines.push(`**Adversarial review:** ${badge}`);
  lines.push("");
  lines.push(result.summary.trim());

  if (result.findings.length === 0) {
    lines.push("");
    lines.push(
      "_No gaps found between the contract and the stated intent. The proof plus this review cover the merge decision._",
    );
    return lines.join("\n");
  }

  const blocking = result.findings.filter((f) => f.severity === "blocking");
  const advisory = result.findings.filter((f) => f.severity === "advisory");

  for (const [heading, findings] of [
    ["Blocking", blocking],
    ["Advisory", advisory],
  ] as const) {
    if (findings.length === 0) continue;
    lines.push("");
    lines.push(`### ${heading}`);
    for (const f of findings) {
      lines.push("");
      lines.push(`- **${KIND_LABEL[f.kind] ?? f.kind}: ${f.title}**`);
      lines.push(`  ${f.detail.trim().replace(/\n/g, "\n  ")}`);
      if (f.scenario) {
        lines.push(`  - Scenario: ${f.scenario.trim()}`);
      }
      if (f.suggestedAxiom) {
        lines.push(`  - Suggested axiom: \`${f.suggestedAxiom.trim()}\``);
      }
    }
  }
  return lines.join("\n");
}
