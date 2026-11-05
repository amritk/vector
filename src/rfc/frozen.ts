// `vector spec frozen`: a PR either changes the spec side (specs/, contracts/,
// rfcs/) or the implementation, never both, so a test can't be loosened to
// match the code it tests. Each contract's main source must also still hash
// to the `source.sha256` it records, so a spec can't change under a contract
// unnoticed. Fails closed: a git error, an unreadable contract or a missing
// source is a failure.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  type RfcContract,
  type SourceDecl,
  declaredSources,
  validateContractShape,
} from "./contract.ts";
import { checkBase, git } from "./gitdiff.ts";

export const VECTOR_ROOT = resolve(
  dirname(new URL(import.meta.url).pathname),
  "../..",
);

/**
 * Where a source's text is: its `path`, relative to the contract, else
 * rfc<N>.txt beside the contract, in ../rfcs, then in vector's rfcs/. The first
 * that exists, or undefined.
 */
export function sourceFile(
  src: SourceDecl,
  contractPath: string,
): string | undefined {
  const here = dirname(contractPath);
  if (src.path) return resolve(here, src.path);
  return [
    join(here, `rfc${src.rfc}.txt`),
    join(here, "../rfcs", `rfc${src.rfc}.txt`),
    join(VECTOR_ROOT, "rfcs", `rfc${src.rfc}.txt`),
  ].find(existsSync);
}

export const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

/** A changed path's side of the freeze. */
export type PathKind = "spec" | "neutral" | "implementation";

/**
 * specs/, contracts/ and rfcs/ (the documents contracts quote) are the spec
 * side. docs/ and top-level *.md files are neutral. Everything else, tests and
 * config included, is implementation.
 */
export function pathKind(path: string): PathKind {
  if (/^(?:specs|contracts|rfcs)\//.test(path)) return "spec";
  if (path.startsWith("docs/") || /^[^/]+\.md$/.test(path)) return "neutral";
  return "implementation";
}

export interface FrozenReport {
  base: string;
  changed: { path: string; kind: PathKind }[];
  contracts: { path: string; problem?: string }[];
  problems: string[];
}

const nulList = (s: string) => s.split("\0").filter((f) => f !== "");

/**
 * Checks the working tree of `repo` against `base`. `contracts` defaults to
 * every contracts/*.json at the repository's top; finding none is a failure.
 */
export function frozenCheck(o: {
  repo: string;
  base: string;
  contracts?: string[];
}): FrozenReport {
  checkBase(o.base);
  const top = git(
    o.repo,
    ["rev-parse", "--show-toplevel"],
    "git rev-parse",
  ).replace(/\n$/, "");
  git(
    top,
    [
      "rev-parse",
      "--verify",
      "--quiet",
      "--end-of-options",
      `${o.base}^{commit}`,
    ],
    `git rev-parse ${o.base}`,
  );
  const paths = new Set([
    ...nulList(
      git(
        top,
        [
          "diff",
          "--name-only",
          "-z",
          "--no-renames",
          "--end-of-options",
          o.base,
          "--",
        ],
        `git diff --name-only ${o.base}`,
      ),
    ),
    ...nulList(
      git(
        top,
        ["ls-files", "--others", "--exclude-standard", "--full-name", "-z"],
        "git ls-files --others",
      ),
    ),
  ]);
  const changed = [...paths]
    .sort()
    .map((path) => ({ path, kind: pathKind(path) }));
  const problems: string[] = [];
  const spec = changed.filter((c) => c.kind === "spec");
  const impl = changed.filter((c) => c.kind === "implementation");
  if (spec.length > 0 && impl.length > 0)
    problems.push(
      `the change touches the spec side (${spec.map((c) => c.path).join(", ")}) and the implementation (${impl.map((c) => c.path).join(", ")}): change them in separate PRs`,
    );

  let files = o.contracts ?? [];
  if (!o.contracts) {
    const dir = join(top, "contracts");
    files = existsSync(dir)
      ? readdirSync(dir)
          .filter((f) => f.endsWith(".json"))
          .sort()
          .map((f) => join(dir, f))
      : [];
  }
  if (files.length === 0) problems.push("no contracts to check");
  const contracts = files.map((path) => {
    const problem = sourceProblem(path);
    if (problem) problems.push(`${path}: ${problem}`);
    return { path, problem };
  });
  return { base: o.base, changed, contracts, problems };
}

/** Why the contract at `path` does not match its main source, or undefined. */
function sourceProblem(path: string): string | undefined {
  let c: RfcContract;
  try {
    c = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    return `cannot read it: ${(err as Error).message}`;
  }
  const shape = validateContractShape(c);
  if (shape.length > 0) return `not a contract: ${shape[0]}`;
  const want = c.source.sha256;
  if (!want)
    return "no source.sha256: record the sha256 of its main source file";
  const { main, list } = declaredSources(c);
  const decl = list.find((s) => s.id === main) as SourceDecl;
  const file = sourceFile(decl, path);
  if (!file || !existsSync(file))
    return `its main source ${main} is not on disk${file ? ` (${file})` : ""}`;
  const got = sha256(readFileSync(file));
  if (got !== want)
    return `its main source ${file} has sha256 ${got}, but source.sha256 is ${want}: the spec changed under the contract`;
  return undefined;
}

export function renderFrozen(r: FrozenReport): string {
  const out = [
    `spec frozen against ${r.base}: ${r.problems.length === 0 ? "OK" : "FAILED"}`,
    "",
    `${r.changed.length} changed path(s):`,
    ...r.changed.map((c) => `  ${c.kind.padEnd(14)} ${c.path}`),
    "",
    "contracts (main source sha256):",
    ...r.contracts.map((c) => `  ${c.problem ? "✗" : "✓"} ${c.path}`),
  ];
  if (r.problems.length > 0)
    out.push("", "problems:", ...r.problems.map((p) => `  ✗ ${p}`));
  return out.join("\n");
}
