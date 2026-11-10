#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { diffPrograms } from "./diff.ts";
import { emitTypeScript } from "./emit/typescript.ts";
import type { Program } from "./lang/ast.ts";
import { validateProgramShape } from "./lang/shape.ts";
import type { StyleWarning } from "./lang/style.ts";
import { typecheckProgram } from "./lang/validate.ts";
import { renderDashboard, verdictStatus } from "./report/dashboard.ts";
import { verifyProgramViaSolver } from "./solve/runner.ts";
import { verifySpecAndProgram } from "./verify.ts";

// vector CLI. It never calls a model: the spec plan and program are written by
// Claude Code (the vector skill) or by hand, and vector judges them.
//   vector --fixture test/fixtures/currency.json        (verify one program)
//   vector --verify spec.json program.json --json       (verify a spec plan and
//                                                      its program; the skill path)
//   vector --diff old-program.json new-program.json     (prove a regeneration
//                                                      behavior-preserving, or
//                                                      show the concrete deltas)

interface CliArgs {
  fixture?: string;
  spec?: string;
  program?: string;
  diffOld?: string;
  diffNew?: string;
  json: boolean;
  emit?: string;
}

/** Invalid usage or unreadable input — reported cleanly, never a stack trace. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
  ) {
    super(message);
  }
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { json: false };
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
      case "--spec":
        args.spec = argv[++i];
        break;
      case "--program":
        args.program = argv[++i];
        break;
      case "--json":
        args.json = true;
        break;
      case "--emit":
        args.emit = argv[++i];
        break;
      default:
        if (arg?.startsWith("--")) {
          throw new CliError(`Unknown flag: ${arg}`, 2);
        }
        throw new CliError(
          `unexpected argument ${JSON.stringify(arg)}: vector does not call a model. Ask Claude Code for the function (the vector skill writes the spec plan and program), then check them with vector --verify`,
          2,
        );
    }
  }
  return args;
}

/** Read + parse a JSON input file, failing with a clean one-line message. */
function readJsonFile(path: string, what: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    throw new CliError(
      `cannot read ${what} ${JSON.stringify(path)}: ${err instanceof Error ? err.message : String(err)}`,
      2,
    );
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new CliError(
      `${what} ${JSON.stringify(path)} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      2,
    );
  }
}

function phase(label: string, message: string): void {
  console.log(
    `  ${label} ${".".repeat(Math.max(2, 30 - label.length))} ${message}`,
  );
}

async function runFixture(args: CliArgs): Promise<number> {
  if (!args.fixture) throw new Error("runFixture requires --fixture");
  console.log("VECTOR (fixture mode — no LLM)");
  // Shape-validate the raw JSON first: unlike the generated parser (which
  // throws on the first problem), this reports the FULL list — the same
  // multi-error contract every other entry point honors.
  const raw = readJsonFile(args.fixture, "program");
  const shapeErrors = validateProgramShape(raw);
  const program = raw as Program;
  const errors =
    shapeErrors.length > 0 ? shapeErrors : typecheckProgram(program).errors;
  if (errors.length > 0) {
    console.error("Validation failed:");
    for (const err of errors) console.error(`  ✘ ${err}`);
    return 1;
  }
  phase(
    "[1/3] Load program",
    `"${program.programName}" (${program.functions.length} function(s))`,
  );

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
  const rawSpec = readJsonFile(args.spec, "spec plan");
  const rawProgram = readJsonFile(args.program, "program");
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
  const rawOld = readJsonFile(args.diffOld, "old program");
  const rawNew = readJsonFile(args.diffNew, "new program");
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

export async function main(argv: string[]): Promise<number> {
  if (argv[0] === "spec" || argv[0] === "rfc") {
    const { rfcMain } = await import("./rfc/cli.ts");
    return rfcMain(argv.slice(1));
  }
  if (argv.length === 1 && argv[0] === "--licenses") {
    const { licensesText } = await import("./licenses.ts");
    process.stdout.write(licensesText());
    return 0;
  }
  try {
    const args = parseArgs(argv);
    const verifyMode = Boolean(args.spec || args.program);
    const diffMode = Boolean(args.diffOld || args.diffNew);
    if (!args.fixture && !verifyMode && !diffMode) {
      console.error(
        "Usage: vector --fixture <program.json> [--json] [--emit <file>]\n" +
          "       vector --verify <spec.json> <program.json> [--json] [--emit <file>]\n" +
          "       vector --diff <old-program.json> <new-program.json> [--json]\n" +
          "       vector spec check|emit|run|mutate|frozen|stale|exports …  (spec or RFC → contract → nish test; alias: vector rfc)\n" +
          "       vector --licenses  (vector's license and third-party notices)",
      );
      return 2;
    }
    if (diffMode) return await runDiff(args);
    if (verifyMode) return await runVerify(args);
    return await runFixture(args);
  } catch (err) {
    if (err instanceof CliError) {
      console.error(`error: ${err.message}`);
      return err.exitCode;
    }
    // Solver/infrastructure failures surface as one clean line, not a stack.
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

// bin.ts (the compiled binary) imports `main` and calls it itself, so gate the
// source-run entry on being the actual entrypoint.
if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
