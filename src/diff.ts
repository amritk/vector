import type { Program } from "./lang/ast.ts";
import { validateProgramShape } from "./lang/shape.ts";
import { typecheckProgram } from "./lang/validate.ts";
import {
  type DiffCheck,
  type MatchedFunctionDiff,
  assembleDiffs,
  emitDiffScript,
  pairFunctions,
} from "./solve/equiv.ts";
import { runZ3Script } from "./solve/runner.ts";
import { signatureOf } from "./solve/smt.ts";

// The regeneration gate: prove that a NEW version of a program preserves the
// OLD version's observable behavior, or produce the concrete input/output
// deltas where it doesn't. This is what lets a contract stay property-shaped
// (partial, ticket-sized) without regenerated code silently drifting on the
// inputs the contract doesn't pin down — behavioral stability is carried by
// this check, not by fattening the contract into code.
//
//   EQUIVALENT — every shared function provably behaves identically for all
//                inputs; nothing to review.
//   DIFFERENT  — at least one concrete behavioral change (a value delta, a
//                domain change, a removed function, or a changed signature);
//                review the listed witnesses against the intended change.
//   UNDECIDED  — no difference found, but some check came back unknown
//                (usually nonlinear arithmetic); not proven equivalent.
//
// Both inputs are assumed to individually pass `--verify` (CI should gate on
// that first); only shape + typecheck are re-run here.

export type DiffStatus = "EQUIVALENT" | "DIFFERENT" | "UNDECIDED";

export interface ProgramDiffReport {
  solver: string;
  millis: number;
  oldProgramName: string;
  newProgramName: string;
  matched: MatchedFunctionDiff[];
  /** New functions — cannot affect existing callers; informational. */
  added: string[];
  /** Deleted functions — breaking for any caller; counts as a difference. */
  removed: string[];
  signatureChanged: {
    name: string;
    oldSignature: string;
    newSignature: string;
  }[];
}

export type DiffOutcome =
  | { status: DiffStatus; report: ProgramDiffReport; summary: string }
  | { status: "INVALID"; errors: string[] }
  | { status: "ERROR"; message: string };

export async function diffPrograms(
  rawOld: unknown,
  rawNew: unknown,
): Promise<DiffOutcome> {
  const shapeErrors = [
    ...validateProgramShape(rawOld).map((e) => `old program: ${e}`),
    ...validateProgramShape(rawNew).map((e) => `new program: ${e}`),
  ];
  if (shapeErrors.length > 0) {
    return { status: "INVALID", errors: shapeErrors };
  }
  const oldProgram = rawOld as Program;
  const newProgram = rawNew as Program;

  const oldCheck = typecheckProgram(oldProgram);
  const newCheck = typecheckProgram(newProgram);
  const typeErrors = [
    ...oldCheck.errors.map((e) => `old program: ${e}`),
    ...newCheck.errors.map((e) => `new program: ${e}`),
  ];
  if (typeErrors.length > 0) {
    return { status: "INVALID", errors: typeErrors };
  }

  const pairing = pairFunctions(oldProgram, newProgram);
  const { script, queries } = emitDiffScript(
    pairing.comparable,
    oldProgram,
    oldCheck.numTypes,
    newProgram,
    newCheck.numTypes,
  );

  let matched: MatchedFunctionDiff[] = [];
  let solver = "(no comparable functions)";
  let millis = 0;
  if (pairing.comparable.length > 0) {
    const run = await runZ3Script(script, queries.length);
    if (run.kind === "error") return { status: "ERROR", message: run.message };
    matched = assembleDiffs(pairing.comparable, queries, run.answers);
    solver = run.label;
    millis = run.millis;
  }

  const report: ProgramDiffReport = {
    solver,
    millis,
    oldProgramName: oldProgram.programName,
    newProgramName: newProgram.programName,
    matched,
    added: pairing.added.map(signatureOf),
    removed: pairing.removed.map(signatureOf),
    signatureChanged: pairing.signatureChanged,
  };

  const hasDifference =
    report.removed.length > 0 ||
    report.signatureChanged.length > 0 ||
    matched.some((m) => anyStatus(m, "witness"));
  const hasUnknown = matched.some((m) => anyStatus(m, "unknown"));
  const status: DiffStatus = hasDifference
    ? "DIFFERENT"
    : hasUnknown
      ? "UNDECIDED"
      : "EQUIVALENT";

  return { status, report, summary: renderDiffSummary(status, report) };
}

const checksOf = (m: MatchedFunctionDiff): DiffCheck[] => [
  m.domainNarrowed,
  m.domainWidened,
  m.valueDiff,
];

const anyStatus = (m: MatchedFunctionDiff, s: DiffCheck["status"]): boolean =>
  checksOf(m).some((c) => c.status === s);

const fmtInputs = (inputs: Record<string, string>): string =>
  Object.entries(inputs)
    .map(([k, v]) => `${k} = ${v}`)
    .join(", ");

export function renderDiffSummary(
  status: DiffStatus,
  report: ProgramDiffReport,
): string {
  const lines: string[] = [];
  lines.push("── VECTOR DIFF ─────────────────────────────────────────");
  lines.push(` old: ${report.oldProgramName}   new: ${report.newProgramName}`);
  lines.push(` Solver: ${report.solver} · ${report.millis} ms`);
  lines.push(` Status: ${status}`);
  lines.push("");

  for (const m of report.matched) {
    if (m.equivalent) {
      lines.push(` ✓ ${m.signature} — EQUIVALENT for all inputs`);
    } else if (anyStatus(m, "witness")) {
      lines.push(` ✘ ${m.signature} — BEHAVIOR DIFFERS`);
    } else {
      lines.push(` ? ${m.signature} — UNDECIDED (not proven equivalent)`);
    }
    const v = m.valueDiff;
    if (v.status === "witness" && v.witness) {
      lines.push(
        `     value:  at ${fmtInputs(v.witness.inputs)} → old = ${v.witness.oldResult}, new = ${v.witness.newResult}`,
      );
    } else if (v.status === "unknown") {
      lines.push("     value:  solver returned unknown");
    }
    const n = m.domainNarrowed;
    if (n.status === "witness" && n.witness) {
      lines.push(
        `     domain: ${fmtInputs(n.witness.inputs)} was accepted, now REJECTED`,
      );
    } else if (n.status === "unknown") {
      lines.push("     domain: narrowing check returned unknown");
    }
    const w = m.domainWidened;
    if (w.status === "witness" && w.witness) {
      lines.push(
        `     domain: ${fmtInputs(w.witness.inputs)} was rejected, now ACCEPTED`,
      );
    } else if (w.status === "unknown") {
      lines.push("     domain: widening check returned unknown");
    }
    for (const r of m.paramRenames) {
      lines.push(`     note:   param renamed ${r.oldName} → ${r.newName}`);
    }
    const cc = m.contractChanges;
    for (const c of cc.requiresAdded)
      lines.push(`     contract: + requires ${c}`);
    for (const c of cc.requiresRemoved)
      lines.push(`     contract: − requires ${c}`);
    for (const c of cc.ensuresAdded)
      lines.push(`     contract: + ensures ${c}`);
    for (const c of cc.ensuresRemoved)
      lines.push(`     contract: − ensures ${c}`);
  }

  for (const sig of report.signatureChanged) {
    lines.push(` ✘ ${sig.name} — SIGNATURE CHANGED (breaking)`);
    lines.push(`     old: ${sig.oldSignature}`);
    lines.push(`     new: ${sig.newSignature}`);
  }
  for (const sig of report.removed) {
    lines.push(` ✘ removed: ${sig} (breaking for existing callers)`);
  }
  for (const sig of report.added) {
    lines.push(` + added:   ${sig} (cannot affect existing callers)`);
  }

  lines.push("");
  lines.push(
    status === "EQUIVALENT"
      ? " Every shared function provably behaves identically — the"
      : status === "DIFFERENT"
        ? " Review each listed delta against the change you intended —"
        : " No difference was found, but equivalence was not proven —",
  );
  lines.push(
    status === "EQUIVALENT"
      ? " regeneration is behavior-preserving; nothing to review."
      : status === "DIFFERENT"
        ? " the witnesses above are the entire behavioral change."
        : " restate nonlinear bodies in linear arithmetic and re-run.",
  );
  lines.push(
    " (Proven over exact rationals; assumes both versions pass --verify.)",
  );
  return lines.join("\n");
}
