// `vector spec frozen`: a PR either changes the spec side (specs/, contracts/,
// rfcs/) or the implementation, never both, so a test can't be loosened to
// match the code it tests. A path's side is decided by the path, never by what
// the PR writes: the one exception is a generated test under test/spec/, which
// is spec side only while it names the sha256 of a contract at the PR's head.
// Each contract's main source must also still hash to the `source.sha256` it
// records, and every source it declares by path must lie under specs/ or
// rfcs/. Fails closed: a git error, an unreadable contract or a missing source
// is a failure.

import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  type RfcContract,
  type SourceDecl,
  declaredSources,
  validateContractShape,
} from "./contract.ts";
import { contractShaLines, sha256 } from "./emit-nish.ts";
import { forkPoint, git } from "./gitdiff.ts";

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

/**
 * Why a contract may not read `file` as a source it declares, or undefined
 * when it may. A contract can come from anyone, so its sources may be only
 * spec text: in the contract's own directory, or in the specs/ and rfcs/ beside
 * it, beside its parent or in vector. A specs/ or rfcs/ that is itself a
 * symlink is no root: it could lead anywhere. The file's own symlinks are
 * resolved first, and no part of its path below its root may start with "."
 * (.git, .ssh, .env). This holds for an implicit rfc<N>.txt as well as a
 * `path`: a checked-out repository can hold symlinks of either name.
 */
export function sourcePathProblem(
  src: SourceDecl,
  contractPath: string,
  file: string,
): string | undefined {
  const here = real(dirname(resolve(contractPath)));
  const roots = [
    here,
    ...[join(here, ".."), join(here, "../.."), VECTOR_ROOT].flatMap((r) =>
      SOURCE_DIRS.map((d) => join(real(r), d)).filter((d) => !isSymlink(d)),
    ),
  ];
  const f = real(file);
  const under = roots.find((r) => f.startsWith(`${r}/`));
  if (
    under !== undefined &&
    !relative(under, f)
      .split("/")
      .some((part) => part.startsWith("."))
  )
    return undefined;
  return `source ${src.id} is ${src.path ?? file}, which is not spec text: a contract may read sources only beside it or under specs/ or rfcs/, and not in a hidden directory or through a symlinked specs/ or rfcs/`;
}

const isSymlink = (p: string) => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

/**
 * A changed path's side of the freeze. A generated test is on the spec side:
 * it is regenerated in the PR that changes its contract, and must not change
 * beside the code.
 */
export type PathKind = "spec" | "generated" | "neutral" | "implementation";

/** Where emitted tests live, from the repository top. */
export const EMITTED_TESTS = "test/spec/";

/** The directories a contract's `sources[].path` may point into. */
const SOURCE_DIRS = ["specs", "rfcs"];

/**
 * specs/, contracts/ and rfcs/ (the documents contracts quote) are the spec
 * side. docs/ and top-level *.md files are neutral. Everything else, tests and
 * config included, is implementation. frozenCheck puts a file under
 * EMITTED_TESTS on the spec side, as `generated`, only when its one
 * `// vector-contract-sha256:` line names a contract at the PR's head.
 */
export function pathKind(path: string): PathKind {
  if (/^(?:specs|contracts|rfcs)\//.test(path)) return "spec";
  if (path.startsWith("docs/") || /^[^/]+\.md$/.test(path)) return "neutral";
  return "implementation";
}

export interface FrozenReport {
  base: string;
  /** The commit the change is measured from: the fork point from `base`. */
  at: string;
  changed: { path: string; kind: PathKind }[];
  contracts: { path: string; problem?: string }[];
  problems: string[];
}

/** The path with symlinks resolved when it exists, so paths compare equal. */
const real = (p: string) => (existsSync(p) ? realpathSync(p) : resolve(p));

const nulList = (s: string) => s.split("\0").filter((f) => f !== "");

/**
 * Checks the working tree of `repo` against its fork point from `base`.
 * `contracts` defaults to every contracts/*.json at the repository's top;
 * finding none is a failure.
 */
export function frozenCheck(o: {
  repo: string;
  base: string;
  contracts?: string[];
}): FrozenReport {
  const top = git(
    o.repo,
    ["rev-parse", "--show-toplevel"],
    "git rev-parse",
  ).replace(/\n$/, "");
  const at = forkPoint(top, o.base);
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
          at,
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
  const problems: string[] = [];
  if (files.length === 0) problems.push("no contracts to check");
  const shas = new Set<string>();
  const contracts = files.map((path) => {
    try {
      shas.add(sha256(readFileSync(path)));
    } catch {
      // Unreadable: sourceProblem reports it.
    }
    const problem = sourceProblem(path, real(top));
    if (problem) problems.push(`${path}: ${problem}`);
    return { path, problem };
  });

  const kind = (path: string): PathKind => {
    const k = pathKind(path);
    if (k !== "implementation" || !path.startsWith(EMITTED_TESTS)) return k;
    try {
      const lines = contractShaLines(readFileSync(join(top, path), "utf8"));
      if (lines.length === 1 && shas.has(lines[0])) return "generated";
    } catch {
      // Deleted or unreadable: implementation, the stricter reading.
    }
    return k;
  };
  const changed = [...paths].sort().map((path) => ({ path, kind: kind(path) }));
  const spec = changed.filter(
    (c) => c.kind === "spec" || c.kind === "generated",
  );
  const impl = changed.filter((c) => c.kind === "implementation");
  if (spec.length > 0 && impl.length > 0)
    problems.unshift(
      `the change touches the spec side (${spec.map((c) => c.path).join(", ")}) and the implementation (${impl.map((c) => c.path).join(", ")}): change them in separate PRs`,
    );
  return { base: o.base, at, changed, contracts, problems };
}

/**
 * Why the contract at `path` does not match its main source, or declares a
 * source by a path outside `top`'s specs/ and rfcs/; undefined when neither.
 */
function sourceProblem(path: string, top: string): string | undefined {
  let c: RfcContract;
  try {
    c = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    return `cannot read it: ${(err as Error).message}`;
  }
  const shape = validateContractShape(c);
  if (shape.length > 0) return `not a contract: ${shape[0]}`;
  const { main, list } = declaredSources(c);
  for (const s of list) {
    if (s.path === undefined) continue;
    const f = real(resolve(dirname(path), s.path));
    if (!SOURCE_DIRS.some((d) => f.startsWith(`${join(top, d)}/`)))
      return `source ${s.id} is ${s.path}, outside ${SOURCE_DIRS.map((d) => `${d}/`).join(" and ")}: a contract's sources must be spec side`;
  }
  const want = c.source.sha256;
  if (!want)
    return "no source.sha256: record the sha256 of its main source file";
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
