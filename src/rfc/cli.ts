// `vector spec …` (alias `vector rfc …`) — spec → contract → Nish test. A spec
// is an RFC's plain text or a markdown document with numbered headings.
//
//   vector spec check   <contract.json>   gates + Z3 domains; exit 0 when valid
//   vector spec emit    <contract.json> -o <main.ts>
//   vector spec run     <contract.json>   check, emit, then run it with nish
//   vector spec extract --spec <spec> --module <src.ts> --target <spec> -o <contract.json>
//                                         (the LLM proposes; the gates dispose)

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  type RfcContract,
  declaredSources,
  validateContractShape,
} from "./contract.ts";
import { emitNishTest } from "./emit-nish.ts";
import { type SourceRun, runGates } from "./gates.ts";
import {
  type ContractReport,
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
       vector spec extract --spec <file> --module <src.ts> --target <module> -o <contract.json>
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
  --json              machine-readable output
  --max-retries <n>   extract: repair attempts (default 3)`;

interface RfcArgs {
  cmd: string;
  contract?: string;
  out?: string;
  rfc?: string;
  module?: string;
  nishRoot?: string;
  nish?: string;
  target?: string;
  json: boolean;
  runSources: boolean;
  maxRetries: number;
}

class UsageError extends Error {}

function parse(argv: string[]): RfcArgs {
  const a: RfcArgs = {
    cmd: argv[0] ?? "",
    json: false,
    runSources: false,
    maxRetries: 3,
  };
  for (let i = 1; i < argv.length; i++) {
    const x = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined) throw new UsageError(`${x} needs a value`);
      return v;
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
        a.json = true;
        break;
      case "--max-retries":
        a.maxRetries = Number(val());
        if (!Number.isInteger(a.maxRetries) || a.maxRetries < 1) {
          throw new UsageError("--max-retries expects an integer >= 1");
        }
        break;
      default:
        if (x.startsWith("-") || a.contract)
          throw new UsageError(`unexpected argument ${x}`);
        a.contract = x;
    }
  }
  return a;
}

const VECTOR_ROOT = resolve(
  dirname(new URL(import.meta.url).pathname),
  "../..",
);

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
 * main one; a `path` is relative to the contract; an `rfc` is looked for as
 * rfc<N>.txt beside the contract, in ../rfcs, then in vector's rfcs/. A source
 * found nowhere is left out, and the fidelity gate refuses the contract for it.
 */
function loadSources(
  a: RfcArgs,
  c: RfcContract,
  contractPath: string,
): Map<string, RfcDocument> {
  const docs = new Map<string, RfcDocument>();
  const here = dirname(contractPath);
  const { main, list } = declaredSources(c);
  for (const src of list) {
    const candidates =
      src.id === main && a.rfc
        ? [a.rfc]
        : src.path
          ? [resolve(here, src.path)]
          : [
              join(here, `rfc${src.rfc}.txt`),
              join(here, "../rfcs", `rfc${src.rfc}.txt`),
              join(VECTOR_ROOT, "rfcs", `rfc${src.rfc}.txt`),
            ];
    const found =
      candidates.length === 1 ? candidates[0] : candidates.find(existsSync);
    if (found) docs.set(src.id, readSpec(found));
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
    a.json ? JSON.stringify(reportJson(r), null, 2) : renderReport(r),
  );
}

export async function rfcMain(argv: string[]): Promise<number> {
  let a: RfcArgs;
  try {
    a = parse(argv);
    if (a.cmd === "extract") {
      const { runExtract } = await import("./extract.ts");
      return await runExtract({
        rfcPath: a.rfc,
        modulePath: a.module,
        target: a.target,
        out: a.out,
        maxRetries: a.maxRetries,
        json: a.json,
      });
    }
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
    });
    if (a.out) writeFileSync(a.out, source);
    if (a.cmd === "emit") {
      if (!a.json) {
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
