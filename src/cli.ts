#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { emitTypeScript } from "./emit/typescript.ts";
import { parseProgram } from "./generated/program/index.ts";
import { validateProgramShape } from "./lang/shape.ts";
import { typecheckProgram } from "./lang/validate.ts";
import { renderDashboard, verdictStatus } from "./report/dashboard.ts";
import { verifyProgramViaSolver } from "./solve/runner.ts";
import { verifySpecAndProgram } from "./verify.ts";

// EWD-1 CLI. Three modes:
//   ewd "Build a USD to EUR converter..."            (full LLM pipeline)
//   ewd --fixture test/fixtures/currency.json        (solver-only, no API key)
//   ewd --verify spec.json program.json --json       (verify LLM-emitted JSON;
//                                                      the Claude Code skill path)

interface CliArgs {
  prompt?: string;
  fixture?: string;
  spec?: string;
  program?: string;
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
  console.log("EWD-1 DIJKSTRA ENGINE (fixture mode — no LLM)");
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

async function runPrompt(args: CliArgs): Promise<number> {
  if (!args.prompt) throw new Error("runPrompt requires a prompt");
  const { runPipeline } = await import("./pipeline.ts");
  console.log("EWD-1 DIJKSTRA ENGINE");
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
if (!args.fixture && !args.prompt && !verifyMode) {
  console.error(
    'Usage: ewd "<prompt>" [--max-retries N] [--json] [--emit <file>]\n' +
      "       ewd --fixture <program.json> [--json] [--emit <file>]\n" +
      "       ewd --verify <spec.json> <program.json> [--json] [--emit <file>]",
  );
  process.exit(2);
}

let exitCode: number;
if (verifyMode) {
  exitCode = await runVerify(args);
} else if (args.fixture) {
  exitCode = await runFixture(args);
} else {
  exitCode = await runPrompt(args);
}
process.exit(exitCode);
