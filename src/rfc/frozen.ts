// `vector spec frozen`: a PR either changes the spec side (specs/, contracts/,
// rfcs/) or the implementation, never both, so a test can't be loosened to
// match the code it tests. A path's side is decided by the path, never by what
// the PR writes: the one exception is a generated test under test/spec/, which
// is spec side only while it names the sha256 of a contract at the PR's head.
// Each contract's main source must also still hash to the `source.sha256` it
// records, each source must still be the file and sha256 its `sources` entry
// records (an RFC file too), and every source it declares by path must lie
// under specs/ or rfcs/. Fails closed: a git error, an unreadable contract or
// a missing source is a failure.

import {
  constants,
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  statSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
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
 * rfc<N>.xml or rfc<N>.txt beside the contract, in ../rfcs, then in vector's
 * rfcs/. The nearest with its recorded `file`'s name, else the first that
 * exists, or undefined. At each place the XML comes first: it is the RFC's definitive
 * form since RFC 8650, and its <bcp14> markup says which keywords bind.
 */
export function sourceFile(
  src: SourceDecl,
  contractPath: string,
): string | undefined {
  const here = dirname(contractPath);
  if (src.path) return resolve(here, src.path);
  const found = [here, join(here, "../rfcs"), join(VECTOR_ROOT, "rfcs")]
    .flatMap((d) => ["xml", "txt"].map((x) => join(d, `rfc${src.rfc}.${x}`)))
    .filter(existsSync);
  // A recorded file names the bytes the contract was checked against: an
  // rfc<N>.xml added later, at that place or a nearer one, must not displace
  // it. Its name, not its label, picks it, so a nearer file of that name that
  // no label can name (a symlink out of the tree) is still the one found, and
  // sourcePathProblem refuses it rather than a further copy being read.
  const recorded = src.file && basename(src.file);
  return found.find((f) => basename(f) === recorded) ?? found[0];
}

/**
 * Why a contract may not read `file` as a source it declares, or undefined
 * when it may. A contract can come from anyone, so its sources may be only
 * spec text: in the contract's own directory, or in the specs/ and rfcs/ beside
 * it, beside its parent or in vector. A specs/ or rfcs/ that is itself a
 * symlink is no root: it could lead anywhere. The file's own symlinks are
 * resolved first, and no part of its path below its root may start with "."
 * (.git, .ssh, .env). This holds for an implicit rfc<N>.xml or .txt as well as a
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

/**
 * How a contract's `sources[].file` names `file`: its path under specs/ or
 * rfcs/ of the innermost directory that holds it there, of vector's own root
 * (where an rfc<N>.xml or .txt may come from) and the contract's directory and its
 * ancestors, so a contract at the repo root, in contracts/ or deeper names
 * rfcs/x.txt alike. A file in or below the contract's directory but under no
 * specs/ or rfcs/ is named from the directory holding it (contracts/x.txt).
 * Symlinks are resolved, and the name does not depend on where vector or the
 * repo sits on disk. Undefined for any other file: no path can record it.
 */
export function sourceLabel(
  file: string,
  contractPath: string,
): string | undefined {
  const f = real(file);
  const here = real(dirname(resolve(contractPath)));
  const roots = [real(VECTOR_ROOT)];
  for (let d = here; ; d = dirname(d)) {
    roots.push(d);
    if (dirname(d) === d) break;
  }
  const labels = roots
    .map((root) => relative(root, f))
    .filter((r) => SOURCE_DIRS.some((d) => r.startsWith(`${d}${sep}`)));
  if (labels.length > 0)
    return labels.reduce((a, b) => (b.length < a.length ? b : a));
  if (f.startsWith(`${here}${sep}`)) return relative(dirname(here), f);
  return undefined;
}

/**
 * Why `file`, with sha256 `got`, is not what `src` records it read, or
 * undefined when it is (or `src` records neither).
 */
export function recordedProblem(
  src: SourceDecl,
  contractPath: string,
  file: string,
  got: string,
): string | undefined {
  const label = sourceLabel(file, contractPath);
  const read = label ?? real(file);
  if (src.file !== undefined && label === undefined)
    return `source ${src.id} was read from ${read}, which its file cannot name: it is under no specs/ or rfcs/ of the contract's repo or of vector, nor beside the contract`;
  if (src.file !== undefined && read !== src.file)
    return `source ${src.id} was read from ${read}, but its file is ${src.file}`;
  if (src.sha256 !== undefined && got !== src.sha256)
    return `source ${src.id} (${read}) has sha256 ${got}, but its sha256 is ${src.sha256}: the source changed under the contract`;
  return undefined;
}

/**
 * The text of `file` and the sha256 of its bytes, or why it may not be read.
 * `problem` judges a resolved path; it is asked twice: before `file` is opened, and then of the file that
 * was actually opened (its path from /proc/self/fd on Linux; elsewhere its
 * realpath, which must still be the same inode). So a symlink or directory
 * swapped between the check and the read cannot change what is read: the
 * text comes from the descriptor that was judged, never from the path again.
 * Throws if the file cannot be opened or read.
 */
export function readChecked(
  file: string,
  problem: (real: string) => string | undefined,
): { text: string; sha256: string } | { problem: string } {
  const before = problem(real(file));
  if (before) return { problem: before };
  // O_NONBLOCK: a FIFO opens at once instead of waiting for a writer.
  const fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const st = fstatSync(fd);
    let opened: string | undefined;
    try {
      const link = readlinkSync(`/proc/self/fd/${fd}`);
      if (link.startsWith("/") && !link.endsWith(" (deleted)")) opened = link;
    } catch {}
    if (opened === undefined) {
      opened = realpathSync(file);
      const now = statSync(opened);
      if (now.dev !== st.dev || now.ino !== st.ino)
        return { problem: `${file} changed while it was being read` };
    }
    const after = problem(opened);
    if (after) return { problem: after };
    if (!st.isFile()) return { problem: `${file} is not a regular file` };
    const bytes = readFileSync(fd);
    return { text: bytes.toString("utf8"), sha256: sha256(bytes) };
  } finally {
    closeSync(fd);
  }
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
  // Each source that records its file or sha256, an RFC's included.
  for (const s of list) {
    if (s.file === undefined && s.sha256 === undefined) continue;
    const f = sourceFile(s, path);
    if (!f || !existsSync(f)) return `source ${s.id} is not on disk`;
    // Read as spec check reads it: spec text only, and never a device or FIFO.
    const got = readChecked(f, (p) => sourcePathProblem(s, path, p));
    if ("problem" in got) return got.problem;
    const problem = recordedProblem(s, path, f, got.sha256);
    if (problem) return problem;
  }
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
