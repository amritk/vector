// Reading `git diff -U0`: which lines of each file a change touches, and which
// exports it adds, changes or deletes. Fails closed: a line it does not
// recognise, a hunk header it cannot parse, a hunk whose line counts disagree
// with its header, or an export form it cannot name is an error, never an
// empty result.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { maskLines } from "./mutate.ts";

export type LineRange = [start: number, end: number];

export interface ExportChange {
  /** The declared name; `default` for `export default`. */
  name: string;
  /**
   * added: its declaration line is new and no removed line declared it.
   * changed: a changed line falls inside it (its body, its declaration, or
   * where lines were deleted from it). deleted: a removed line declared it and
   * the new file no longer exports it.
   */
  kind: "added" | "changed" | "deleted";
}

export interface FileDiff {
  /** The new path, or the old one when the file is deleted. */
  file: string;
  /** Inclusive, 1-based ranges of the new file's added or changed lines. */
  ranges: LineRange[];
  /** The exports the change touches, in the new file's order, then the deleted ones. */
  exports: ExportChange[];
}

export class DiffParseError extends Error {}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/;
/** A top-level declaration's export and name (only top-level ones start at column 0). */
const EXPORT_RE =
  /^export\s+(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:const\s+enum(?![\w$])|const|let|var|function\s*\*?|class|interface|type|enum|namespace|module)\s*([A-Za-z_$][\w$]*)/;
/** `export default …`: named "default" whatever follows. */
const DEFAULT_RE = /^export\s+default\b/;
/** Extended header lines git prints between `diff --git` and the first hunk. */
const HEADER_RE =
  /^(?:index |old mode |new mode |deleted file mode |new file mode |similarity index |dissimilarity index |rename from |rename to |copy from |copy to )/;

function path(line: string, prefix: string, n: number): string | null {
  const raw = line.slice(prefix.length).replace(/\t$/, "");
  if (raw.includes("\r"))
    throw new DiffParseError(`line ${n}: a carriage return in the path ${raw}`);
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

/**
 * The name `line` exports, null when it exports nothing, or an error for an
 * export it cannot name (`export { a }`, `export * from …`): a re-export
 * changes what a module offers without any declaration to point at.
 */
export function exportName(raw: string, where: string): string | null {
  // An indented line is inside something (a namespace's own exports);
  // topLevelItems names an indented export that is not. Otherwise its code
  // alone: no BOM and no comment before it.
  const text = raw.replace(/^\uFEFF/, "");
  if (/^\s/.test(text)) return null;
  const line = maskLines(text)[0].expr.trim();
  if (!line.startsWith("export")) return null;
  const e = line.match(EXPORT_RE);
  if (e) return e[1];
  if (DEFAULT_RE.test(line)) return "default";
  if (/^export\b/.test(line))
    throw new DiffParseError(`${where}: an export it cannot name: ${line}`);
  return null;
}

interface Item {
  /** 1-based first and last lines with code. */
  start: number;
  end: number;
  /** The exported name, or null for a top-level item that is not exported. */
  name: string | null;
  /** Why its export cannot be named: an error only if the change touches it. */
  bad?: string;
}

/** A declaration that never carries on an expression: always a new item. */
const DECL_HEAD =
  /^(?:export|import|const|let|var|interface|enum|declare|abstract|namespace|module|type\s+[A-Za-z_$])\b/;
/** A declaration that can also be an expression's operand (`= function …`). */
const VALUE_HEAD = /^(?:function|class|async)\b/;
/** A line that ends like this needs an operand on the next. */
const NEEDS_OPERAND = /(?:[=(,?:[]|=>|&&|\|\||\?\?)$/;
/** `export` as a keyword, not a property (`.export`) or part of a name. */
const EXPORT_WORD = /(?<![\w$.])export(?![\w$])/g;

/**
 * The top-level items of `src`. An item starts at a line, outside any
 * bracket, whose code begins with a declaration keyword (`function`, `class`
 * or `async` only when the line before does not need an operand), and takes
 * in every line after it up to the next. A string counts as an operand, so a
 * line ending in one never carries on. Fails closed: brackets that do not
 * balance (a regex literal with a bracket in it) are an error, and an item
 * with a second `export` in it (two on a line) cannot be named.
 */
function topLevelItems(source: string, file: string): Item[] {
  const src = source.replace(/^\uFEFF/, "");
  const items: Item[] = [];
  let depth = 0;
  let prev = "";
  for (const [k, { expr }] of maskLines(src).entries()) {
    const trimmed = expr.trim();
    if (trimmed === "") continue;
    const head =
      depth === 0 &&
      (DECL_HEAD.test(trimmed) ||
        (VALUE_HEAD.test(trimmed) && !NEEDS_OPERAND.test(prev)));
    const where = `${file}:${k + 1}`;
    if (head) {
      const it: Item = { start: k + 1, end: k + 1, name: null };
      try {
        it.name = exportName(trimmed, where);
      } catch (err) {
        it.bad = (err as Error).message;
      }
      items.push(it);
    } else if (items.length > 0) items[items.length - 1].end = k + 1;
    const lead = expr.length - expr.trimStart().length;
    // Each `export` outside every bracket must be the first code of an item's
    // head: a second one on a line declares something this reader misses.
    const exportsAt = new Set(
      [...expr.matchAll(EXPORT_WORD)].map((e) => e.index),
    );
    for (let j = 0; j < expr.length; j++) {
      const c = expr[j];
      if (depth === 0 && exportsAt.has(j) && !(head && j === lead)) {
        const it = items.at(-1);
        if (it)
          it.bad ??= `${where}: an export that is not its line's first code`;
        else throw new DiffParseError(`${where}: an export it cannot place`);
      }
      if ("([{".includes(c)) depth++;
      else if (")]}".includes(c) && --depth < 0)
        throw new DiffParseError(`${where}: a closing bracket with none open`);
    }
    prev = trimmed;
  }
  if (depth !== 0)
    throw new DiffParseError(`${file}: ${depth} bracket(s) never closed`);
  return items;
}

/** A file whose exports this reads: JavaScript or TypeScript. Others have lines only. */
const SCRIPT_RE = /\.(?:[cm]?[jt]s|[jt]sx)$/;

/** Reads a file's new contents by its path in the diff. */
export type ReadPostImage = (file: string) => string;

/**
 * Parses `git diff -U0` text. `read` gives each changed file's new contents,
 * which says which export each changed line falls inside.
 */
export function parseGitDiff(text: string, read: ReadPostImage): FileDiff[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const out: FileDiff[] = [];
  let i = 0;
  function fail(msg: string): never {
    throw new DiffParseError(`line ${i + 1}: ${msg}`);
  }
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
    if (file === null) fail("both sides are /dev/null");
    const script = SCRIPT_RE.test(file);
    const name = (l: string, n: number) =>
      script ? exportName(l, `line ${n}`) : null;
    const ranges: LineRange[] = [];
    /** New-file line numbers a pure deletion sits just after. */
    const cuts: number[] = [];
    const added = new Set<string>();
    const removed = new Set<string>();
    if (!lines[i]?.startsWith("@@")) fail(`expected a hunk for ${file}`);
    while (i < lines.length && lines[i].startsWith("@@")) {
      const m = lines[i].match(HUNK_RE);
      if (!m) fail(`cannot parse the hunk header ${JSON.stringify(lines[i])}`);
      let oldLeft = m[2] === undefined ? 1 : Number(m[2]);
      let newLeft = m[4] === undefined ? 1 : Number(m[4]);
      const start = Number(m[3]);
      if (newLeft > 0) ranges.push([start, start + newLeft - 1]);
      else cuts.push(start);
      i++;
      while (oldLeft > 0 || newLeft > 0) {
        const l = lines[i];
        if (l === undefined) fail(`the hunk for ${file} ends early`);
        if (l.startsWith("-") && oldLeft > 0) {
          oldLeft--;
          const e = name(l.slice(1), i + 1);
          if (e !== null) removed.add(e);
        } else if (l.startsWith("+") && newLeft > 0) {
          newLeft--;
          const e = name(l.slice(1), i + 1);
          if (e !== null) added.add(e);
        } else if (!l.startsWith("\\")) {
          fail(`a line the hunk header for ${file} does not count: ${l}`);
        }
        i++;
      }
      while (lines[i]?.startsWith("\\")) i++;
    }
    if (i < lines.length && !lines[i].startsWith("diff --git "))
      fail(`unexpected line after the hunks for ${file}: ${lines[i]}`);
    const items =
      newPath === null || !script ? [] : topLevelItems(read(newPath), newPath);
    out.push({
      file,
      ranges,
      exports: exportChanges(items, ranges, cuts, added, removed),
    });
  }
  return out;
}

function exportChanges(
  items: Item[],
  ranges: LineRange[],
  cuts: number[],
  added: Set<string>,
  removed: Set<string>,
): ExportChange[] {
  const inRange = (n: number) => ranges.some(([a, b]) => n >= a && n <= b);
  const out: ExportChange[] = [];
  const exported = new Set<string>();
  for (const it of items) {
    const touched =
      ranges.some(([a, b]) => a <= it.end && b >= it.start) ||
      // Lines deleted from inside it or right at either end: a deletion
      // between two items may have been either's first or last line, so
      // both count as changed.
      cuts.some((c) => c >= it.start - 1 && c <= it.end);
    if (touched && it.bad) throw new DiffParseError(it.bad);
    if (it.name === null) continue;
    exported.add(it.name);
    if (!touched) continue;
    const fresh = inRange(it.start) && !removed.has(it.name);
    out.push({ name: it.name, kind: fresh ? "added" : "changed" });
  }
  for (const name of removed)
    if (!exported.has(name)) out.push({ name, kind: "deleted" });
  // A declaration on an added line that is no top-level item: the file's
  // structure is not what this reader takes it to be.
  for (const name of added)
    if (!exported.has(name))
      throw new DiffParseError(
        `export ${name} is on an added line but is not a top-level item of the new file`,
      );
  return out;
}

const run = (cwd: string, args: string[], what: string): string => {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.status !== 0)
    throw new Error(
      `${what} failed in ${cwd}: ${(r.stderr || r.error?.message || "").trim()}`,
    );
  return r.stdout;
};

/**
 * `git diff -U0 <base>` in `cwd` (the working tree against base), parsed, plus
 * every untracked file (not ignored) as wholly added: a new module nobody has
 * `git add`ed yet is still part of the change. A git error is an error.
 */
export function gitDiff(
  cwd: string,
  base: string,
  paths: string[] = [],
): FileDiff[] {
  // A base that looks like an option would be read as one.
  if (base.startsWith("-"))
    throw new Error(`git diff: the base ${base} looks like an option`);
  // `A..B` or `A...B` diffs two commits, but the post-image is read from the
  // working tree: the exports would be judged against the wrong file.
  if (base.includes(".."))
    throw new Error(`git diff: the base ${base} is a range; give one commit`);
  const top = run(
    cwd,
    ["rev-parse", "--show-toplevel"],
    "git rev-parse",
  ).replace(/\n$/, "");
  const read = (file: string) => readFileSync(join(top, file), "utf8");
  const text = run(
    cwd,
    [
      "-c",
      "core.quotePath=false",
      "diff",
      "-U0",
      "--no-color",
      "--no-ext-diff",
      "--no-renames",
      "--no-textconv",
      // Whatever diff.noprefix or diff.mnemonicPrefix say: path() reads a/ and b/.
      "--src-prefix=a/",
      "--dst-prefix=b/",
      "--end-of-options",
      base,
      "--",
      ...paths,
    ],
    `git diff -U0 ${base}`,
  );
  const diffs = parseGitDiff(text, read);
  const untracked = run(
    cwd,
    [
      "ls-files",
      "--others",
      "--exclude-standard",
      "--full-name",
      "-z",
      "--",
      ...paths,
    ],
    "git ls-files --others",
  )
    .split("\0")
    .filter((f) => f !== "");
  for (const file of untracked.sort()) {
    const src = read(file);
    if (src.includes("\0"))
      throw new DiffParseError(`${file}: an untracked binary file`);
    const n = src.split("\n").length - (src.endsWith("\n") ? 1 : 0);
    const ranges: LineRange[] = src === "" ? [] : [[1, n]];
    if (!SCRIPT_RE.test(file)) {
      diffs.push({ file, ranges, exports: [] });
      continue;
    }
    const added = new Set(
      src.split("\n").flatMap((l, k) => {
        const e = exportName(l, `${file}:${k + 1}`);
        return e === null ? [] : [e];
      }),
    );
    diffs.push({
      file,
      ranges,
      exports: exportChanges(
        topLevelItems(src, file),
        ranges,
        [],
        added,
        new Set(),
      ),
    });
  }
  return diffs;
}
