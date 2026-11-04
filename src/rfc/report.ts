// The contract dashboard: every requirement of the RFC with the evidence for it.

import type { RfcContract } from "./contract.ts";
import type { GateResult } from "./gates.ts";
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
}

/** CONTRACT_VALID when every gate and every domain passed; the run's status after a run. */
export function reportStatus(r: ContractReport): string {
  if (!r.gates.ok || (r.sampling && !r.sampling.ok)) return "INVALID";
  return r.run ? r.run.status : "CONTRACT_VALID";
}

export function renderReport(r: ContractReport): string {
  const out: string[] = [];
  const c = r.contract;
  out.push("── VECTOR RFC CONTRACT ─────────────────────────────────────────");
  if (c)
    out.push(
      ` ${c.contract} · RFC ${c.source.rfc} (${c.source.title}) · ${c.target.module}`,
    );
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
        `  ${mark} ${req.id}  §${req.section} ${req.level}  "${short(req.quote, 64)}"`,
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
    if ((c.exclusions ?? []).length > 0) {
      out.push("", " Not tested, by decision");
      for (const x of c.exclusions ?? [])
        out.push(`  §${x.section} "${short(x.quote, 56)}" — ${x.reason}`);
    }
  }
  const warnings = r.gates.warnings.filter(
    (w) => !w.message.startsWith("excluded:"),
  );
  if (warnings.length > 0) {
    out.push("", " Warnings");
    for (const w of warnings) out.push(`  ! ${w.at}: ${w.message}`);
  }
  if (r.run && r.run.status === "ERROR") {
    out.push("", " The test did not complete:");
    const tail = (r.run.stderr || r.run.stdout).trim().split("\n").slice(-15);
    for (const l of tail) out.push(`  | ${l}`);
  }
  out.push(
    "",
    " ○ = checked by the contract, not yet run · ✓ pass · ✘ fail · · not run",
  );
  return out.join("\n");
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
        }
      : undefined,
  };
}
