// The contract dashboard: every requirement of the RFC with the evidence for it.

import {
  type RfcContract,
  type VectorClause,
  citeLabel,
  declaredSources,
} from "./contract.ts";
import type { GateResult, SourceRun } from "./gates.ts";
import type { MutantResult, MutationReport } from "./mutate.ts";
import type { RunResult } from "./run.ts";
import type { SamplingResult } from "./sample.ts";

const MARK: Record<string, string> = {
  pass: "✓",
  fail: "✘",
  skip: "–",
  "not-run": "·",
};

const short = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export interface ContractReport {
  contract: RfcContract | null;
  gates: GateResult;
  sampling?: SamplingResult;
  run?: RunResult;
  /** Vector id → the result of its `command` source, under --run-sources. */
  sources?: Map<string, SourceRun>;
  /** `vector spec mutate`: the mutants run against the module's changed lines. */
  mutation?: MutationReport;
}

/** What a survivor means: the module can change there and no clause notices. */
export const SURVIVOR_MEANING = "behaviour no requirement pins down";

/** What SATISFIED claims, and what it does not (#30). */
export const SATISFIED_MEANING =
  "SATISFIED: the spec's vectors match and every property held at every sample. It is not a proof: code no vector or sample reaches is untested. `vector spec mutate` shows which plausible bugs the contract would miss.";

/** Mutants that ran to a verdict: stillborn ones (no build) are not counted. */
function mutationLine(m: MutationReport): string {
  const c = m.counts;
  return `${m.results.length} of ${m.generated} mutants run: ${c.killed} killed, ${c.timeout} timed out, ${c.survived} survived (${m.survivors.length} not allowed); ${c.stillborn} stillborn, not counted`;
}

/** The mutated line, or what a deleted statement was: its line is empty. */
const mutatedText = (x: MutantResult) =>
  x.mutant.mutated.trim() || `(deleted) ${x.mutant.original.trim()}`;

const allowedSurvivors = (m: MutationReport) =>
  m.results.filter((r) => r.outcome === "survived" && r.allowed);

/** "RFC 5869 (HKDF)", or the main source's id for a spec that is not an RFC. */
function sourceTitle(c: RfcContract): string {
  const { main, list } = declaredSources(c);
  const rfc = list.find((s) => s.id === main)?.rfc;
  return `${rfc ? `RFC ${rfc}` : main} (${c.source.title})`;
}

/** The vectors whose expected value comes from running a command. */
function commandVectors(c: RfcContract): (VectorClause & {
  source: { command: string };
})[] {
  return c.clauses.filter(
    (k): k is VectorClause & { source: { command: string } } =>
      k.kind === "vector" && "command" in k.source,
  );
}

/**
 * CONTRACT_VALID when every gate and every domain passed; the run's status
 * after a run; after mutation, SURVIVORS when a mutant no allowance covers lived.
 */
export function reportStatus(r: ContractReport): string {
  if (!r.gates.ok || (r.sampling && !r.sampling.ok)) return "INVALID";
  if (r.mutation)
    return r.mutation.survivors.length > 0 ? "SURVIVORS" : "MUTANTS_KILLED";
  return r.run ? r.run.status : "CONTRACT_VALID";
}

export function renderReport(r: ContractReport): string {
  const out: string[] = [];
  const c = r.contract;
  out.push("── VECTOR RFC CONTRACT ─────────────────────────────────────────");
  if (c) out.push(` ${c.contract} · ${sourceTitle(c)} · ${c.target.module}`);
  out.push(` Status: ${reportStatus(r)}`);
  if (r.sampling?.solver) out.push(` Solver: ${r.sampling.solver}`);
  if (r.run) out.push(` Tested: ${r.run.nish} (nish/… from the std beside it)`);

  const issues = [
    ...r.gates.issues.map((i) => ({
      at: `${i.gate} ${i.at}`,
      message: i.message,
    })),
  ];
  for (const i of r.sampling?.issues ?? [])
    issues.push({ at: `domain ${i.at}`, message: i.message });
  if (issues.length > 0) {
    out.push("", " Gate failures");
    for (const i of issues) out.push(`  ✘ ${i.at.trim()}: ${i.message}`);
  }

  if (c && r.gates.issues.every((i) => i.gate !== "shape")) {
    out.push("", " Requirements");
    for (const req of c.requirements) {
      const outcome = r.run?.requirements.get(req.id);
      const mark = outcome
        ? MARK[outcome]
        : (r.gates.coverage.get(req.id) ?? []).length > 0
          ? "○"
          : "✘";
      out.push(
        `  ${mark} ${req.id}  ${citeLabel(c, req)} ${req.level}  "${short(req.quote, 64)}"`,
      );
      const ev: string[] = [];
      for (const k of c.clauses) {
        if (!k.covers.includes(req.id)) continue;
        const res = r.run?.clauses.get(k.id);
        let label = `${res ? MARK[res.outcome] : "○"} ${k.id}`;
        const ps = r.sampling?.properties.get(k.id);
        if (ps)
          label += ` (${ps.samples.length} samples: ${ps.boundary} boundary)`;
        ev.push(label);
      }
      if (ev.length > 0) out.push(`      ${ev.join("  ")}`);
    }
    const failed = [...(r.run?.clauses.values() ?? [])].filter(
      (x) => x.outcome === "fail",
    );
    if (failed.length > 0) {
      out.push("", " Failures");
      for (const f of failed)
        out.push(`  ✘ ${f.id}: ${f.detail ?? "(no detail)"}`);
    }
    const commands = commandVectors(c);
    if (commands.length > 0) {
      out.push("", " Vector sources run");
      for (const k of commands) {
        const run = r.sources?.get(k.id);
        out.push(
          `  ${MARK[run?.outcome ?? "not-run"]} ${k.id}: $ ${k.source.command}${run?.detail ? ` — ${run.detail}` : ""}`,
        );
      }
    }
    if ((c.exclusions ?? []).length > 0) {
      out.push("", " Not tested, by decision");
      for (const x of c.exclusions ?? [])
        out.push(`  ${citeLabel(c, x)} "${short(x.quote, 56)}" — ${x.reason}`);
    }
  }
  const warnings = r.gates.warnings.filter(
    (w) => !w.message.startsWith("excluded:"),
  );
  if (warnings.length > 0) {
    out.push("", " Warnings");
    for (const w of warnings) out.push(`  ! ${w.at}: ${w.message}`);
  }
  if (r.mutation) {
    const m = r.mutation;
    out.push("", ` Mutation of ${m.file}`, `  ${mutationLine(m)}`);
    for (const x of m.survivors)
      out.push(
        `  ✘ ${m.file}:${x.mutant.line}  ${mutatedText(x)}  — ${SURVIVOR_MEANING}`,
      );
    for (const x of allowedSurvivors(m))
      out.push(
        `  – ${m.file}:${x.mutant.line}  ${mutatedText(x)}  — allowed: ${x.allowed}`,
      );
    for (const a of m.unusedAllowances)
      out.push(`  ! allowSurvivors ${a.file}:${a.line} matched no survivor`);
  }
  if (r.run && r.run.integrity.length > 0) {
    out.push("", " The transcript cannot be trusted:");
    for (const p of r.run.integrity) out.push(`  ! ${p}`);
  }
  if (r.run && r.run.status === "ERROR") {
    out.push("", " The test did not complete:");
    const tail = (r.run.stderr || r.run.stdout).trim().split("\n").slice(-15);
    for (const l of tail) out.push(`  | ${l}`);
  }
  if (reportStatus(r) === "SATISFIED") out.push("", ` ${SATISFIED_MEANING}`);
  out.push(
    "",
    " ○ = checked by the contract, not yet run · ✓ pass · ✘ fail · · not run",
  );
  return out.join("\n");
}

/** A table cell: one line, no column breaks. */
const cell = (s: string) =>
  s
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\\|]/g, (ch) => `\\${ch}`) || " ";
/** Inline code that survives any backticks in `s`. */
const code = (s: string) => {
  const t = s.replace(/\s+/g, " ").trim();
  const fence = "`".repeat(
    Math.max(0, ...[...t.matchAll(/`+/g)].map((m) => m[0].length)) + 1,
  );
  return `${fence}${fence.length > 1 ? " " : ""}${t}${fence.length > 1 ? " " : ""}${fence}`;
};

/**
 * Inline code in a table cell: GFM splits a row at `|` even inside code, and
 * reads `\\` as an escaped pair first, so a backslash run before a pipe is
 * doubled too: `a\|b` becomes `a\\\|b`, never a column break.
 */
const codeCell = (s: string) =>
  code(s).replace(/(\\*)\|/g, (_, bs: string) => `${bs}${bs}\\|`);

/** Where a vector's expected value comes from. */
function vectorEvidence(c: RfcContract, k: VectorClause): string {
  if ("cite" in k.source) return `vector, ${citeLabel(c, k.source.cite)}`;
  if ("command" in k.source) return `vector, expected from ${k.source.command}`;
  return `vector, spec ${k.source.spec}`;
}

const MD_MARK: Record<string, string> = {
  pass: "✅ pass",
  fail: "❌ fail",
  skip: "➖ skip",
  "not-run": "⚪ not run",
};

/**
 * The dashboard as markdown for a PR comment: each requirement's quote, then
 * its clauses and their outcomes; then the exclusions and the mutation run's
 * survivors.
 */
export function renderMarkdown(r: ContractReport): string {
  const c = r.contract;
  const status = reportStatus(r);
  const ok = ["CONTRACT_VALID", "SATISFIED", "MUTANTS_KILLED"].includes(status);
  const out: string[] = [
    `## ${ok ? "✅" : "❌"} ${c ? `${c.contract}: ` : ""}${status}`,
    "",
  ];
  if (c)
    out.push(`${cell(sourceTitle(c))} · target ${code(c.target.module)}`, "");
  if (r.run) out.push(`Tested with ${code(r.run.nish)}.`, "");

  const issues = [
    ...r.gates.issues.map((i) => [`${i.gate} ${i.at}`.trim(), i.message]),
    ...(r.sampling?.issues ?? []).map((i) => [`domain ${i.at}`, i.message]),
  ];
  if (issues.length > 0) {
    out.push("### Gate failures", "", "| Where | Problem |", "| --- | --- |");
    for (const [at, msg] of issues) out.push(`| ${cell(at)} | ${cell(msg)} |`);
    out.push("");
  }

  if (c && r.gates.issues.every((i) => i.gate !== "shape")) {
    out.push("### Requirements", "");
    for (const req of c.requirements) {
      const outcome = r.run?.requirements.get(req.id);
      const covered = (r.gates.coverage.get(req.id) ?? []).length > 0;
      const mark = outcome
        ? MD_MARK[outcome]
        : covered
          ? "⭕ checked, not run"
          : "❌ uncovered";
      out.push(
        `#### ${req.id} · ${citeLabel(c, req)} ${req.level} · ${mark}`,
        "",
        ...req.quote
          .trim()
          .split("\n")
          .map((l) => `> ${l.trim()}`),
        "",
      );
      const rows: string[] = [];
      for (const k of c.clauses) {
        if (!k.covers.includes(req.id)) continue;
        const res = r.run?.clauses.get(k.id);
        const ps = r.sampling?.properties.get(k.id);
        const evidence =
          k.kind === "vector"
            ? vectorEvidence(c, k)
            : ps
              ? `${ps.samples.length} samples (${ps.boundary} boundary)`
              : "property";
        rows.push(
          `| ${codeCell(k.id)} | ${cell(k.title)} | ${res ? MD_MARK[res.outcome] : "⭕ not run"} | ${cell(evidence)} | ${cell(res?.detail ?? "")} |`,
        );
      }
      if (rows.length > 0)
        out.push(
          "| Clause | Title | Outcome | Evidence | Detail |",
          "| --- | --- | --- | --- | --- |",
          ...rows,
          "",
        );
    }
    const commands = commandVectors(c);
    if (commands.length > 0) {
      out.push(
        "### Vector sources run",
        "",
        "| Clause | Command | Outcome | Detail |",
        "| --- | --- | --- | --- |",
      );
      for (const k of commands) {
        const run = r.sources?.get(k.id);
        out.push(
          `| ${codeCell(k.id)} | ${codeCell(k.source.command)} | ${MD_MARK[run?.outcome ?? "not-run"]} | ${cell(run?.detail ?? "")} |`,
        );
      }
      out.push("");
    }
    if ((c.exclusions ?? []).length > 0) {
      out.push(
        "### Not tested, by decision",
        "",
        "| Where | Quote | Reason |",
        "| --- | --- | --- |",
      );
      for (const x of c.exclusions ?? [])
        out.push(
          `| ${cell(citeLabel(c, x))} | ${cell(x.quote)} | ${cell(x.reason)} |`,
        );
      out.push("");
    }
  }
  if (r.mutation) {
    const m = r.mutation;
    out.push(`### Mutation of ${code(m.file)}`, "", mutationLine(m), "");
    const rows = [
      ...m.survivors.map((x) => [x, `❌ ${SURVIVOR_MEANING}`] as const),
      ...allowedSurvivors(m).map(
        (x) => [x, `➖ allowed: ${x.allowed}`] as const,
      ),
    ];
    if (rows.length > 0) {
      out.push("| Where | Mutated line | Verdict |", "| --- | --- | --- |");
      for (const [x, verdict] of rows)
        out.push(
          `| ${codeCell(`${m.file}:${x.mutant.line}`)} | ${codeCell(mutatedText(x))} | ${cell(verdict)} |`,
        );
      out.push("");
    }
    for (const a of m.unusedAllowances)
      out.push(
        `- ⚠️ allowSurvivors ${code(`${a.file}:${a.line}`)} matched no survivor`,
      );
    if (m.unusedAllowances.length > 0) out.push("");
  }
  const warnings = r.gates.warnings.filter(
    (w) => !w.message.startsWith("excluded:"),
  );
  if (warnings.length > 0) {
    out.push("### Warnings", "");
    for (const w of warnings) out.push(`- ${cell(`${w.at}: ${w.message}`)}`);
    out.push("");
  }
  if (r.run && r.run.integrity.length > 0) {
    out.push("### The transcript cannot be trusted", "");
    for (const p of r.run.integrity) out.push(`- ${cell(p)}`);
    out.push("");
  }
  if (r.run && r.run.status === "ERROR") {
    const tail = (r.run.stderr || r.run.stdout).trim().split("\n").slice(-15);
    out.push(
      "### The test did not complete",
      "",
      "```",
      ...tail.map((l) => l.replace(/```/g, "ˋˋˋ")),
      "```",
      "",
    );
  }
  if (status === "SATISFIED") out.push(`_${SATISFIED_MEANING}_`, "");
  return out.join("\n").trimEnd();
}

export function reportJson(r: ContractReport): unknown {
  return {
    status: reportStatus(r),
    contract: r.contract?.contract,
    issues: [
      ...r.gates.issues,
      ...(r.sampling?.issues ?? []).map((i) => ({ gate: "domain", ...i })),
    ],
    warnings: r.gates.warnings,
    coverage: Object.fromEntries(r.gates.coverage),
    samples: r.sampling
      ? Object.fromEntries(
          [...r.sampling.properties].map(([id, p]) => [
            id,
            {
              count: p.samples.length,
              boundary: p.boundary,
              random: p.random,
              inhabited: p.inhabited,
              notes: p.notes,
            },
          ]),
        )
      : undefined,
    sources:
      r.contract && commandVectors(r.contract).length > 0
        ? Object.fromEntries(
            commandVectors(r.contract).map((k) => {
              const run = r.sources?.get(k.id);
              return [
                k.id,
                {
                  command: k.source.command,
                  outcome: run?.outcome ?? "not-run",
                  detail: run?.detail,
                },
              ];
            }),
          )
        : undefined,
    run: r.run
      ? {
          status: r.run.status,
          exitCode: r.run.exitCode,
          clauses: Object.fromEntries(
            [...r.run.clauses].map(([id, x]) => [
              id,
              { outcome: x.outcome, detail: x.detail },
            ]),
          ),
          requirements: Object.fromEntries(r.run.requirements),
          integrity: r.run.integrity,
        }
      : undefined,
    mutation: r.mutation
      ? {
          file: r.mutation.file,
          generated: r.mutation.generated,
          counts: r.mutation.counts,
          survivors: r.mutation.survivors.map((x) => ({
            at: `${r.mutation?.file}:${x.mutant.line}`,
            id: x.mutant.id,
            original: x.mutant.original,
            mutated: x.mutant.mutated,
          })),
          allowed: allowedSurvivors(r.mutation).map((x) => ({
            at: `${r.mutation?.file}:${x.mutant.line}`,
            id: x.mutant.id,
            reason: x.allowed,
          })),
          unusedAllowances: r.mutation.unusedAllowances,
        }
      : undefined,
  };
}
