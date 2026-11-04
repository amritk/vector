// Reading `git diff -U0`: which lines of each file a change touches, and which
// exports it adds or changes. Fails closed: a line it does not recognise, a
// hunk header it cannot parse, or a hunk whose line counts disagree with its
// header is an error, never an empty result.

import { spawnSync } from "node:child_process";

export type LineRange = [start: number, end: number];

export interface ExportChange {
  name: string;
  kind: "added" | "changed";
}

export interface FileDiff {
  /** The new path, or the old one when the file is deleted. */
  file: string;
  /** Inclusive, 1-based ranges of the new file's added or changed lines. */
  ranges: LineRange[];
  /** Exports on an added line: "changed" when a removed line declared the name too. */
  exports: ExportChange[];
}

export class DiffParseError extends Error {}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/;
const EXPORT_RE = /^\s*export\s+(?:const|function)\s+([A-Za-z_$][\w$]*)/;
/** Extended header lines git prints between `diff --git` and the first hunk. */
const HEADER_RE =
  /^(?:index |old mode |new mode |deleted file mode |new file mode |similarity index |dissimilarity index |rename from |rename to |copy from |copy to )/;

function path(line: string, prefix: string, n: number): string | null {
  const raw = line.slice(prefix.length).replace(/\t$/, "");
  if (raw === "/dev/null") return null;
  if (raw.startsWith('"'))
    throw new DiffParseError(
      `line ${n}: quoted path ${raw} (run git with -c core.quotePath=false)`,
    );
  const m = raw.match(/^[ab]\/(.+)$/);
  if (!m)
    throw new DiffParseError(`line ${n}: cannot read the path in ${line}`);
  return m[1];
}

export function parseGitDiff(text: string): FileDiff[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const out: FileDiff[] = [];
  let i = 0;
  const fail = (msg: string): never => {
    throw new DiffParseError(`line ${i + 1}: ${msg}`);
  };
  while (i < lines.length) {
    if (!lines[i].startsWith("diff --git "))
      fail(`expected "diff --git", found ${JSON.stringify(lines[i])}`);
    i++;
    while (i < lines.length && HEADER_RE.test(lines[i])) i++;
    if (lines[i]?.startsWith("Binary files "))
      fail("binary change: its lines cannot be read");
    if (i >= lines.length || lines[i].startsWith("diff --git ")) {
      // A mode change or a pure rename: no lines changed.
      continue;
    }
    if (!lines[i].startsWith("--- "))
      fail(`expected "--- ", found ${lines[i]}`);
    const oldPath = path(lines[i], "--- ", i + 1);
    i++;
    if (!lines[i]?.startsWith("+++ "))
      fail(`expected "+++ ", found ${lines[i]}`);
    const newPath = path(lines[i], "+++ ", i + 1);
    i++;
    const file = newPath ?? oldPath;
    if (file === null) return fail("both sides are /dev/null");
    const ranges: LineRange[] = [];
    const added = new Set<string>();
    const removed = new Set<string>();
    if (!lines[i]?.startsWith("@@")) fail(`expected a hunk for ${file}`);
    while (i < lines.length && lines[i].startsWith("@@")) {
      const m = lines[i].match(HUNK_RE);
      if (!m) fail(`cannot parse the hunk header ${JSON.stringify(lines[i])}`);
      const h = m as RegExpMatchArray;
      let oldLeft = h[2] === undefined ? 1 : Number(h[2]);
      let newLeft = h[4] === undefined ? 1 : Number(h[4]);
      const start = Number(h[3]);
      if (newLeft > 0) ranges.push([start, start + newLeft - 1]);
      i++;
      while (oldLeft > 0 || newLeft > 0) {
        const l = lines[i];
        if (l === undefined) fail(`the hunk for ${file} ends early`);
        if (l.startsWith("-") && oldLeft > 0) {
          oldLeft--;
          const e = l.slice(1).match(EXPORT_RE);
          if (e) removed.add(e[1]);
        } else if (l.startsWith("+") && newLeft > 0) {
          newLeft--;
          const e = l.slice(1).match(EXPORT_RE);
          if (e) added.add(e[1]);
        } else if (!l.startsWith("\\")) {
          fail(`a line the hunk header for ${file} does not count: ${l}`);
        }
        i++;
      }
      while (lines[i]?.startsWith("\\")) i++;
    }
    if (i < lines.length && !lines[i].startsWith("diff --git "))
      fail(`unexpected line after the hunks for ${file}: ${lines[i]}`);
    const exports = [...added].map(
      (name): ExportChange => ({
        name,
        kind: removed.has(name) ? "changed" : "added",
      }),
    );
    out.push({ file, ranges, exports });
  }
  return out;
}

/** `git diff -U0 <base>` in `cwd` (the working tree against base), parsed. A git error is an error. */
export function gitDiff(
  cwd: string,
  base: string,
  paths: string[] = [],
): FileDiff[] {
  const r = spawnSync(
    "git",
    [
      "-c",
      "core.quotePath=false",
      "diff",
      "-U0",
      "--no-color",
      "--no-ext-diff",
      "--no-renames",
      base,
      "--",
      ...paths,
    ],
    { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  if (r.status !== 0)
    throw new Error(
      `git diff -U0 ${base} failed in ${cwd}: ${(r.stderr || r.error?.message || "").trim()}`,
    );
  return parseGitDiff(r.stdout);
}
