#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { diffPrograms } from "./diff.ts";
import { emitTypeScript } from "./emit/typescript.ts";
import { parseProgram } from "./generated/program/index.ts";
import { validateProgramShape } from "./lang/shape.ts";
import type { StyleWarning } from "./lang/style.ts";
import { typecheckProgram } from "./lang/validate.ts";
import { renderDashboard, verdictStatus } from "./report/dashboard.ts";
import { verifyProgramViaSolver } from "./solve/runner.ts";
import { verifySpecAndProgram } from "./verify.ts";

// vector CLI. Five modes:
//   vector "Build a USD to EUR converter..."            (full LLM pipeline)
//   vector --fixture test/fixtures/currency.json        (solver-only, no API key)
//   vector --verify spec.json program.json --json       (verify LLM-emitted JSON;
//                                                      the Claude Code skill path)
//   vector --diff old-program.json new-program.json     (prove a regeneration
//                                                      behavior-preserving, or
//                                                      show the concrete deltas)
//   vector --review spec.json [--baseline old-spec.json]
//                             [--deltas diff.json]
//                             [--intent-file pr.md]     (adversarial LLM review of
//                                                      contract ⊨ intent; API key)

interface CliArgs {
  prompt?: string;
  fixture?: string;
  spec?: string;
  program?: string;
  diffOld?: string;
  diffNew?: string;
  review?: string;
  baseline?: string;
  deltas?: string;
  intent?: string;
  intentFile?: string;
  maxRetries: number;
  json: boolean;
  emit?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { maxRetries: 3, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--fixture":
        args.fixture = argv[++i];
        break;
      case "--verify":
        // Two positional paths follow: the spec plan and the program.
        args.spec = argv[++i];
        args.program = argv[++i];
        break;
      case "--diff":
        // Two positional paths follow: the old and the new program.
        args.diffOld = argv[++i];
        args.diffNew = argv[++i];
        break;
      case "--review":
        args.review = argv[++i];
        break;
      case "--baseline":
        args.baseline = argv[++i];
        break;
      case "--deltas":
        args.deltas = argv[++i];
        break;
      case "--intent":
        args.intent = argv[++i];
        break;
      case "--intent-file":
        args.intentFile = argv[++i];
        break;
      case "--spec":
        args.spec = argv[++i];
        break;
      case "--program":
        args.program = argv[++i];
        break;
      case "--max-retries":
        args.maxRetries = Number(argv[++i]) || 3;
        break;
      case "--json":
        args.json = true;
        break;
      case "--emit":
        args.emit = argv[++i];
        break;
      default:
        if (arg?.startsWith("--")) {
          console.error(`Unknown flag: ${arg}`);
          process.exit(2);
        }
        args.prompt = args.prompt ? `${args.prompt} ${arg}` : arg;
    }
  }
  return args;
}

function phase(label: string, message: string): void {
  console.log(
    `  ${label} ${".".repeat(Math.max(2, 30 - label.length))} ${message}`,
  );
}

async function runFixture(args: CliArgs): Promise<number> {
  if (!args.fixture) throw new Error("runFixture requires --fixture");
  console.log("VECTOR (fixture mode — no LLM)");
  const program = parseProgram(JSON.parse(readFileSync(args.fixture, "utf8")));
  phase(
    "[1/3] Load program",
    `"${program.programName}" (${program.functions.length} layer(s))`,
  );

  const shapeErrors = validateProgramShape(program);
  const errors =
    shapeErrors.length > 0 ? shapeErrors : typecheckProgram(program).errors;
  if (errors.length > 0) {
    console.error("Validation failed:");
    for (const err of errors) console.error(`  ✘ ${err}`);
    return 1;
  }

  const result = await verifyProgramViaSolver(program);
  if (result.kind !== "report") {
    console.error(
      result.kind === "invalid"
        ? `Solver rejected program:\n  ${result.errors.join("\n  ")}`
        : `Solver error: ${result.message}`,
    );
    return 1;
  }
  const { report } = result;
  phase(
    "[2/3] Deterministic solver",
    `${report.solver} · ${report.totalVcs} VCs · ${report.unsatCount} unsat · ${report.satCount} sat · ${report.millis} ms`,
  );
  phase("[3/3] Report", verdictStatus(report));
  console.log();

  console.log(
    renderDashboard({
      prompt: `fixture: ${args.fixture}`,
      attempt: 1,
      maxRetries: 1,
      report,
    }),
  );

  if (report.ok) {
    const code = emitTypeScript(program);
    console.log(
      "\n── EMITTED TYPESCRIPT ─────────────────────────────────────────────\n",
    );
    console.log(code);
    if (args.emit) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(args.emit, code);
      console.log(`(written to ${args.emit})`);
    }
  } else {
    console.log("\n(code withheld — the contract was not proven)");
  }
  if (args.json) {
    console.log(JSON.stringify({ program, report }, null, 2));
  }
  return report.ok ? 0 : 1;
}

// Verify a spec-plan + program pair that some *other* agent produced — inside
// Claude Code, that agent is Claude Code itself (the skill path). No API key:
// this is the deterministic veto only. With --json it prints the structured
// feedback the skill loops on; without, the human dashboard.
async function runVerify(args: CliArgs): Promise<number> {
  if (!args.spec || !args.program) {
    throw new Error("runVerify requires a spec plan and a program path");
  }
  const rawSpec = JSON.parse(readFileSync(args.spec, "utf8"));
  const rawProgram = JSON.parse(readFileSync(args.program, "utf8"));
  const outcome = await verifySpecAndProgram(rawSpec, rawProgram, {
    label: `verify: ${args.program}`,
  });

  if (args.json) {
    console.log(JSON.stringify(outcome, null, 2));
    return outcome.status === "PROVEN" ? 0 : 1;
  }

  switch (outcome.status) {
    case "PROVEN": {
      console.log(outcome.dashboard);
      printStyleWarnings(outcome.styleWarnings);
      console.log(
        "\n── EMITTED TYPESCRIPT ─────────────────────────────────────────────\n",
      );
      console.log(outcome.emittedCode);
      if (args.emit) {
        const { writeFileSync } = await import("node:fs");
        writeFileSync(args.emit, outcome.emittedCode);
        console.log(`(written to ${args.emit})`);
      }
      return 0;
    }
    case "REFUTED":
    case "UNKNOWN": {
      console.log(outcome.dashboard);
      printStyleWarnings(outcome.styleWarnings);
      console.log(
        "\n── FEEDBACK (repair and re-verify) ────────────────────\n",
      );
      console.log(outcome.feedback);
      return 1;
    }
    case "INVALID": {
      console.error("Validation failed:");
      for (const err of outcome.errors) console.error(`  ✘ ${err}`);
      return 1;
    }
    case "ERROR": {
      console.error(`Solver error: ${outcome.message}`);
      return 1;
    }
  }
}

function printStyleWarnings(warnings: StyleWarning[]): void {
  if (warnings.length === 0) return;
  console.log(
    "\n── STYLE (advisory — does not affect the proof) ───────────────────\n",
  );
  for (const w of warnings) {
    console.log(`  ⚠ ${w.function} ${w.axiomId}: ${w.property}`);
    console.log(`    ${w.hint}\n`);
  }
}

// Prove a regenerated program behavior-preserving against the previous
// generation, or print the concrete input/output deltas where it differs.
// Exit codes: 0 = EQUIVALENT, 1 = DIFFERENT or UNDECIDED, 2 = invalid/error.
async function runDiff(args: CliArgs): Promise<number> {
  if (!args.diffOld || !args.diffNew) {
    throw new Error("runDiff requires an old and a new program path");
  }
  const rawOld = JSON.parse(readFileSync(args.diffOld, "utf8"));
  const rawNew = JSON.parse(readFileSync(args.diffNew, "utf8"));
  const outcome = await diffPrograms(rawOld, rawNew);

  if (args.json) {
    console.log(JSON.stringify(outcome, null, 2));
  } else if (outcome.status === "INVALID") {
    console.error("Validation failed:");
    for (const err of outcome.errors) console.error(`  ✘ ${err}`);
  } else if (outcome.status === "ERROR") {
    console.error(`Solver error: ${outcome.message}`);
  } else {
    console.log(outcome.summary);
  }

  switch (outcome.status) {
    case "EQUIVALENT":
      return 0;
    case "DIFFERENT":
    case "UNDECIDED":
      return 1;
    default:
      return 2;
  }
}

// Adversarial LLM review of contract ⊨ intent — the one link Z3 cannot check.
// Needs ANTHROPIC_API_KEY. Exit codes: 0 = CLEAR, 1 = FLAGGED, 2 = invalid
// input or infrastructure error — so CI can distinguish "unsafe to merge on
// the proof alone" from "the review itself did not run".
async function runReview(args: CliArgs): Promise<number> {
  if (!args.review) throw new Error("runReview requires --review <spec.json>");
  const { parseSpecPlan } = await import("./generated/spec-plan/index.ts");
  const { validateSpecPlanShape } = await import("./lang/shape.ts");

  const loadSpec = (path: string) => {
    const spec = parseSpecPlan(JSON.parse(readFileSync(path, "utf8")));
    const errors = validateSpecPlanShape(spec);
    if (errors.length > 0) {
      throw new Error(
        `${path} failed shape validation:\n- ${errors.join("\n- ")}`,
      );
    }
    return spec;
  };

  let exit = 2;
  try {
    const spec = loadSpec(args.review);
    const baselineSpec = args.baseline ? loadSpec(args.baseline) : undefined;
    const deltas = args.deltas
      ? JSON.parse(readFileSync(args.deltas, "utf8"))
      : undefined;
    const intentParts = [
      args.intent,
      args.intentFile ? readFileSync(args.intentFile, "utf8") : undefined,
    ].filter((part): part is string => Boolean(part?.trim()));
    const intent =
      intentParts.length > 0 ? intentParts.join("\n\n") : undefined;

    const { reviewSpecPlan } = await import("./agents/adversary.ts");
    const result = await reviewSpecPlan({ spec, baselineSpec, intent, deltas });

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      const { renderReviewMarkdown } = await import("./report/review.ts");
      console.log(renderReviewMarkdown(result));
    }
    exit = result.verdict === "CLEAR" ? 0 : 1;
  } catch (err) {
    console.error(
      `Review failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return exit;
}

async function runPrompt(args: CliArgs): Promise<number> {
  if (!args.prompt) throw new Error("runPrompt requires a prompt");
  const { runPipeline } = await import("./pipeline.ts");
  console.log("VECTOR");
  const outcome = await runPipeline(args.prompt, {
    maxRetries: args.maxRetries,
    onPhase: phase,
  });
  console.log();
  console.log(outcome.dashboardText);
  if (outcome.emittedCode) {
    console.log(
      "\n── EMITTED TYPESCRIPT ─────────────────────────────────────────────\n",
    );
    console.log(outcome.emittedCode);
    if (args.emit) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(args.emit, outcome.emittedCode);
      console.log(`(written to ${args.emit})`);
    }
  }
  if (args.json) {
    console.log(
      JSON.stringify(
        {
          status: outcome.status,
          attempts: outcome.attempts,
          specPlan: outcome.specPlan,
          program: outcome.program,
          report: outcome.report,
        },
        null,
        2,
      ),
    );
  }
  return outcome.status === "PROVEN" ? 0 : 1;
}

const args = parseArgs(process.argv.slice(2));
const verifyMode = Boolean(args.spec || args.program);
const diffMode = Boolean(args.diffOld || args.diffNew);
const reviewMode = Boolean(args.review);
if (!args.fixture && !args.prompt && !verifyMode && !diffMode && !reviewMode) {
  console.error(
    'Usage: vector "<prompt>" [--max-retries N] [--json] [--emit <file>]\n' +
      "       vector --fixture <program.json> [--json] [--emit <file>]\n" +
      "       vector --verify <spec.json> <program.json> [--json] [--emit <file>]\n" +
      "       vector --diff <old-program.json> <new-program.json> [--json]\n" +
      "       vector --review <spec.json> [--baseline <old-spec.json>] [--deltas <diff.json>]\n" +
      '                      [--intent "<text>"] [--intent-file <file>] [--json]',
  );
  process.exit(2);
}

let exitCode: number;
if (reviewMode) {
  exitCode = await runReview(args);
} else if (diffMode) {
  exitCode = await runDiff(args);
} else if (verifyMode) {
  exitCode = await runVerify(args);
} else if (args.fixture) {
  exitCode = await runFixture(args);
} else {
  exitCode = await runPrompt(args);
}
process.exit(exitCode);
