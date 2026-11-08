// `vector spec …` (alias `vector rfc …`) — spec → contract → Nish test. A spec
// is an RFC's plain text or a markdown document with numbered headings.
//
//   vector spec check   <contract.json>   gates + Z3 domains; exit 0 when valid
//   vector spec emit    <contract.json> -o <main.ts>
//   vector spec run     <contract.json>   check, emit, then run it with nish
//   vector spec extract --spec <spec> --module <src.ts> --target <spec> -o <contract.json>
//                                         (the LLM proposes; the gates dispose)
//   vector spec extract --spec-only --spec <spec> --target <spec> -o <contract.json> [--twice]
//                                         (the model sees only the spec; signatures from its
//                                         Interface section; --twice compares two runs)
//
// The PR gates:
//   vector spec frozen  [contract.json…] --base <ref>   spec side or implementation, not both
//   vector spec stale   <test.ts> <contract.json>      the test was emitted from this contract
//   vector spec exports <contract.json> --base <ref> --nish-root <dir>
//   vector spec mutate  <contract.json> --base <ref> --nish-root <dir> [--jobs N] [--max N]

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  type RfcContract,
  declaredSources,
  validateContractShape,
} from "./contract.ts";
import { emitNishTest, sha256, staleReason } from "./emit-nish.ts";
import { exportsCheck, moduleDiff, renderExports } from "./exports.ts";
import type { ExtractDeps } from "./extract.ts";
import {
  frozenCheck,
  renderFrozen,
  sourceFile,
  sourcePathProblem,
} from "./frozen.ts";
import { type SourceRun, runGates } from "./gates.ts";
import { MutationRunError, runMutants } from "./mutate.ts";
import {
  type ContractReport,
  renderMarkdown,
  renderReport,
  reportJson,
  reportStatus,
} from "./report.ts";
import type { RfcDocument } from "./rfctext.ts";
import { runNishTest, runSourceCommands } from "./run.ts";
import { sampleContract } from "./sample.ts";
import { parseDocument } from "./spectext.ts";

export const RFC_USAGE = `Usage: vector spec check <contract.json> [options]
       vector spec emit  <contract.json> -o <main.ts> [options]
       vector spec run   <contract.json> [-o <main.ts>] [options]
       vector spec extract --spec <file> --module <src.ts> --target <module> -o <contract.json> [--twice]
       vector spec extract --spec-only --spec <file> --target <module> -o <contract.json> [--twice]
       vector spec frozen  [<contract.json>…] --base <ref> [--repo <dir>]
       vector spec stale   <test.ts> <contract.json>
       vector spec exports <contract.json> --base <ref> --nish-root <dir>
       vector spec mutate  <contract.json> --base <ref> --nish-root <dir> [--jobs <n>] [--max <n>]
       (vector rfc … is the same command)

Options:
  --spec <file>       the main source's text, an RFC or a markdown spec (--rfc is the same)
                      (default: the source's path, relative to the contract, or
                      rfcs/rfc<N>.txt next to the contract or in vector)
  --run-sources       run the vectors' \`command\` sources (30 s each) and check their output;
                      without it they are reported as not run
  --module <file>     the target module's source, for the signature gate
  --nish-root <dir>   a nish checkout: finds the module (std/…) and the compiler
  --nish <bin>        the nish compiler (default: <nish-root>/build/seed/bin/nish, else nish)
  --base <ref>        frozen, exports, mutate: the commit the change is against
  --repo <dir>        frozen: the repository (default: the current directory)
  --jobs <n>          mutate: mutants run at once (default 1)
  --max <n>           mutate: at most this many mutants, spread over the changed lines
  --format <f>        text (default), markdown (check, emit, run, mutate, extract: a PR comment) or json
  --json              the same as --format json
  --max-retries <n>   extract: repair attempts (default 3)
  --spec-only         extract: the model's prompt holds only the spec; signatures come from the
                      spec's Interface section (refused without one, and with --module)
  --twice             extract: two independent extractions; where they disagree is listed as
                      warnings for the reviewer`;

interface RfcArgs {
  cmd: string;
  contract?: string;
  /** Every non-option argument; contract is the first. */
  positional: string[];
  out?: string;
  rfc?: string;
  module?: string;
  nishRoot?: string;
  nish?: string;
  target?: string;
  base?: string;
  repo?: string;
  jobs?: number;
  max?: number;
  format: "text" | "markdown" | "json";
  runSources: boolean;
  maxRetries: number;
  specOnly: boolean;
  twice: boolean;
}

class UsageError extends Error {}

function parse(argv: string[]): RfcArgs {
  const a: RfcArgs = {
    cmd: argv[0] ?? "",
    positional: [],
    format: "text",
    runSources: false,
    maxRetries: 3,
    specOnly: false,
    twice: false,
  };
  for (let i = 1; i < argv.length; i++) {
    const x = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined) throw new UsageError(`${x} needs a value`);
      return v;
    };
    const count = () => {
      const n = Number(val());
      if (!Number.isInteger(n) || n < 1)
        throw new UsageError(`${x} expects an integer >= 1`);
      return n;
    };
    switch (x) {
      case "-o":
      case "--out":
        a.out = val();
        break;
      case "--rfc":
      case "--spec":
        a.rfc = val();
        break;
      case "--run-sources":
        a.runSources = true;
        break;
      case "--spec-only":
        a.specOnly = true;
        break;
      case "--twice":
        a.twice = true;
        break;
      case "--module":
        a.module = val();
        break;
      case "--nish-root":
        a.nishRoot = val();
        break;
      case "--nish":
        a.nish = val();
        break;
      case "--target":
        a.target = val();
        break;
      case "--json":
        a.format = "json";
        break;
      case "--format": {
        const f = val();
        if (f !== "text" && f !== "markdown" && f !== "json")
          throw new UsageError(
            `--format expects text, markdown or json, not ${f}`,
          );
        a.format = f;
        break;
      }
      case "--base":
        a.base = val();
        break;
      case "--repo":
        a.repo = val();
        break;
      case "--jobs":
        a.jobs = count();
        break;
      case "--max":
        a.max = count();
        break;
      case "--max-retries":
        a.maxRetries = Number(val());
        if (!Number.isInteger(a.maxRetries) || a.maxRetries < 1) {
          throw new UsageError("--max-retries expects an integer >= 1");
        }
        break;
      default:
        if (x.startsWith("-")) throw new UsageError(`unexpected argument ${x}`);
        a.positional.push(x);
    }
  }
  a.contract = a.positional[0];
  // Each command takes its own number of files: frozen any, stale two, the rest one.
  const want = a.cmd === "frozen" ? undefined : a.cmd === "stale" ? 2 : 1;
  if (want !== undefined && a.positional.length > want)
    throw new UsageError(`unexpected argument ${a.positional[want]}`);
  if (a.cmd === "stale" && a.positional.length < 2)
    throw new UsageError("stale needs <test.ts> <contract.json>");
  if (
    a.format === "markdown" &&
    !["check", "emit", "run", "mutate", "extract"].includes(a.cmd)
  )
    throw new UsageError(
      "--format markdown is for check, emit, run, mutate and extract",
    );
  for (const [on, flag] of [
    [a.specOnly, "--spec-only"],
    [a.twice, "--twice"],
  ] as const)
    if (on && a.cmd !== "extract")
      throw new UsageError(`${flag} is for extract`);
  return a;
}

/** A value the command cannot run without. */
function need<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new UsageError(`${what}`);
  return v;
}

function readSpec(path: string): RfcDocument {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new UsageError(`cannot read ${path}`);
  }
  try {
    return parseDocument(text);
  } catch (err) {
    throw new UsageError(`${path}: ${(err as Error).message}`);
  }
}

/**
 * The text of every source the contract declares, by id. `--spec` gives the
 * main one; the rest are where sourceFile finds them. A source found nowhere
 * is left out, and the fidelity gate refuses the contract for it. A path the
 * contract gives must lead to spec text (sourcePathProblem): the contract is
 * input, and its sources' text reaches gate messages.
 */
function loadSources(
  a: RfcArgs,
  c: RfcContract,
  contractPath: string,
): Map<string, RfcDocument> {
  const docs = new Map<string, RfcDocument>();
  const { main, list } = declaredSources(c);
  for (const src of list) {
    if (src.id === main && a.rfc) {
      docs.set(src.id, readSpec(a.rfc));
      continue;
    }
    const found = sourceFile(src, contractPath);
    if (!found) continue;
    const problem =
      src.path === undefined
        ? undefined
        : sourcePathProblem(src, contractPath, found);
    if (problem)
      throw new UsageError(
        `${contractPath}: ${problem}${src.id === main ? " (to check against another file, give it with --spec)" : ""}`,
      );
    docs.set(src.id, readSpec(found));
  }
  return docs;
}

/** `nish/crypto/hkdf` → `<root>/std/crypto/hkdf.ts`. */
function moduleFile(a: RfcArgs, spec: string | undefined): string | undefined {
  if (a.module) return a.module;
  if (a.nishRoot && spec?.startsWith("nish/")) {
    const p = join(a.nishRoot, "std", `${spec.slice("nish/".length)}.ts`);
    if (existsSync(p)) return p;
  }
  return undefined;
}

/**
 * The compiler to run the test with. `nish/…` resolves to the `std/` beside
 * the binary, so in a checkout `build/nish` tests the working tree while the
 * seed tests the last release's library: say so rather than test the wrong one.
 */
function nishBin(a: RfcArgs): string {
  if (a.nish) return a.nish;
  if (a.nishRoot) {
    const built = join(a.nishRoot, "build/nish");
    if (existsSync(built)) return built;
    const seed = join(a.nishRoot, "build/seed/bin/nish");
    if (existsSync(seed)) {
      console.error(
        `warning: ${built} is not built, so this runs the seed — whose nish/… is the last release's std, not ${join(a.nishRoot, "std")}. Run \`npm run build\` there to test the working tree.`,
      );
      return seed;
    }
  }
  return "nish";
}

async function checkContract(a: RfcArgs): Promise<ContractReport> {
  if (!a.contract) throw new UsageError("which contract?");
  let input: unknown;
  try {
    input = JSON.parse(readFileSync(a.contract, "utf8"));
  } catch (err) {
    throw new UsageError(
      `cannot read ${a.contract}: ${err instanceof Error ? err.message : err}`,
    );
  }
  const maybe = input as Partial<RfcContract>;
  // Sources are read (and commands run) only for a contract of valid shape;
  // the shape gate reports the rest.
  const shaped = validateContractShape(input).length === 0;
  const docs = shaped
    ? loadSources(a, input as RfcContract, a.contract)
    : new Map<string, RfcDocument>();
  let commands: Map<string, SourceRun> | undefined;
  if (shaped && a.runSources)
    commands = await runSourceCommands(input as RfcContract, {
      cwd: dirname(resolve(a.contract)),
    });
  const modPath = moduleFile(a, maybe?.target?.module);
  const gates = runGates(input, {
    docs,
    commands,
    moduleSource: modPath ? readFileSync(modPath, "utf8") : undefined,
  });
  if (!modPath)
    gates.warnings.push({
      at: "signatures",
      message:
        "no module source: signatures were not checked (pass --module or --nish-root)",
    });
  if (!gates.ok)
    return {
      contract: gates.issues.some((i) => i.gate === "shape")
        ? null
        : (input as RfcContract),
      gates,
      sources: commands,
    };
  const contract = input as RfcContract;
  const sampling = await sampleContract(contract);
  return { contract, gates, sampling, sources: commands };
}

function print(a: RfcArgs, r: ContractReport): void {
  console.log(
    a.format === "json"
      ? JSON.stringify(reportJson(r), null, 2)
      : a.format === "markdown"
        ? renderMarkdown(r)
        : renderReport(r),
  );
}

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    throw new UsageError(`cannot read ${path}: ${(err as Error).message}`);
  }
}

/** frozen, stale and exports: a report, as text or JSON, and its exit code. */
function gateResult(
  a: RfcArgs,
  r: { problems: string[] },
  text: string,
): number {
  console.log(a.format === "json" ? JSON.stringify(r, null, 2) : text);
  return r.problems.length === 0 ? 0 : 1;
}

function stale(a: RfcArgs): number {
  const [testPath, contractPath] = a.positional;
  const test = readText(testPath);
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(contractPath);
  } catch (err) {
    throw new UsageError(
      `cannot read ${contractPath}: ${(err as Error).message}`,
    );
  }
  const why = staleReason(test, bytes);
  const r = {
    test: testPath,
    contract: contractPath,
    problems: why ? [why] : [],
  };
  return gateResult(
    a,
    r,
    why
      ? `${testPath}: ${why}`
      : `${testPath}: emitted from ${contractPath} as it is now`,
  );
}

/**
 * Check, emit, then mutate the target module's changed lines in scratch
 * installs of --nish-root, its working tree's std/ with one mutant each.
 */
async function mutate(a: RfcArgs): Promise<number> {
  const base = need(a.base, "mutate needs --base <ref>");
  const nishRoot = need(a.nishRoot, "mutate needs --nish-root <dir>");
  const report = await checkContract(a);
  if (
    reportStatus(report) === "INVALID" ||
    !report.contract ||
    !report.sampling
  ) {
    print(a, report);
    return 1;
  }
  const c = report.contract;
  const md = moduleDiff(c, nishRoot, base);
  const test = emitNishTest(c, report.sampling.properties, {
    regenerate: `vector spec mutate ${a.contract} --base ${base} --nish-root ${nishRoot}`,
    contractSha256: sha256(readFileSync(need(a.contract, "which contract?"))),
  });
  try {
    report.mutation = await runMutants({
      contract: c,
      test,
      nishRoot,
      modulePath: md.modulePath,
      source: readText(join(nishRoot, md.modulePath)),
      ranges: md.diff?.ranges ?? [],
      jobs: a.jobs,
      max: a.max,
      allowSurvivors: c.allowSurvivors,
    });
  } catch (err) {
    if (!(err instanceof MutationRunError)) throw err;
    console.error(`error: ${err.message}`);
    return 1;
  }
  print(a, report);
  return report.mutation.survivors.length === 0 ? 0 : 1;
}

/**
 * `vector spec …`. `deps` replaces the model behind `extract`; tests pass a
 * fake one, and the CLI the real one.
 */
export async function rfcMain(
  argv: string[],
  deps?: ExtractDeps,
): Promise<number> {
  let a: RfcArgs;
  try {
    a = parse(argv);
    if (a.cmd === "extract") {
      const { runExtract } = await import("./extract.ts");
      return await runExtract(
        {
          rfcPath: a.rfc,
          modulePath: a.module,
          nishRoot: a.nishRoot,
          target: a.target,
          out: a.out,
          maxRetries: a.maxRetries,
          format: a.format,
          specOnly: a.specOnly,
          twice: a.twice,
        },
        deps,
      );
    }
    if (a.cmd === "stale") return stale(a);
    if (a.cmd === "frozen") {
      const r = frozenCheck({
        repo: a.repo ?? process.cwd(),
        base: need(a.base, "frozen needs --base <ref>"),
        contracts:
          a.positional.length > 0
            ? a.positional.map((p) => resolve(p))
            : undefined,
      });
      return gateResult(a, r, renderFrozen(r));
    }
    if (a.cmd === "exports") {
      const r = exportsCheck({
        contract: JSON.parse(readText(need(a.contract, "which contract?"))),
        nishRoot: need(a.nishRoot, "exports needs --nish-root <dir>"),
        base: need(a.base, "exports needs --base <ref>"),
      });
      return gateResult(a, r, renderExports(r));
    }
    if (a.cmd === "mutate") return await mutate(a);
    if (!["check", "emit", "run"].includes(a.cmd)) {
      console.error(RFC_USAGE);
      return 2;
    }
    if (a.cmd === "emit" && !a.out)
      throw new UsageError("emit needs -o <main.ts>");
    const report = await checkContract(a);
    if (
      reportStatus(report) === "INVALID" ||
      !report.contract ||
      !report.sampling
    ) {
      print(a, report);
      return 1;
    }
    if (a.cmd === "check") {
      print(a, report);
      return 0;
    }
    const regenerate = `vector spec emit ${a.contract} -o ${a.out ?? "<main.ts>"}`;
    const source = emitNishTest(report.contract, report.sampling.properties, {
      regenerate,
      contractSha256: sha256(readFileSync(a.contract as string)),
    });
    if (a.out) writeFileSync(a.out, source);
    if (a.cmd === "emit") {
      if (a.format === "text") {
        print(a, report);
        console.log(`\n(written to ${a.out})`);
      } else print(a, report);
      return 0;
    }
    report.run = await runNishTest(report.contract, source, nishBin(a));
    print(a, report);
    return report.run.status === "SATISFIED" ? 0 : 1;
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`error: ${err.message}`);
      return 2;
    }
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}
