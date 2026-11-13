/**
 * `spec/pr/gitdiff` — what a change touches, read from git: the files it
 * changes against a base and the lines of each it adds, and the exports a
 * TypeScript module declares. Every git call goes through `runProcess` as
 * an argv, with a time limit; a base is refused when git could read it as an
 * option or a range, and `--` separates paths from everything else.
 */

import { split, splitLines, trim } from "nish/text"
import { runProcess } from "../../core/process"

/** How long one git call may take, in milliseconds. */
export const GITDIFF_TIMEOUT_MS: i32 = 60000

/**
 * Why `base` cannot name the commit a change is against.
 *
 * @param base the ref the user gave
 * @returns the problem, or null when it is a ref git reads as one
 */
export const gitdiffBaseProblem = (base: string): string | null => {
  if (base.length === 0) {
    return "--base is empty: give the ref the change is against, like origin/main"
  }
  if (base.charCodeAt(0) === 0x2d) {
    return `--base ${base} starts with "-": git would read it as an option`
  }
  if (base.indexOf("..") >= 0) {
    return `--base ${base} contains "..": give one ref, not a range`
  }
  for (let i = 0; i < base.length; i++) {
    const c = base.charCodeAt(i)
    if (c <= 0x20 || c === 0x7f) {
      return `--base ${base} holds a space or a control character`
    }
  }
  return null
}

/**
 * Runs git in `repo` and returns what it printed. Pathspecs are literal, so
 * a path holding `*` or `:(` names that file, never a pattern.
 *
 * @param repo the repository's directory
 * @param args git's arguments, after `-C <repo> --literal-pathspecs`
 * @returns its standard output, or `Err` naming the command and what git said
 */
export const gitdiffGit = (repo: string, args: string[]): Result<string, string> => {
  const argv: string[] = ["git", "-C", repo, "--literal-pathspecs"]
  for (const a of args) {
    argv.push(a)
  }
  const r = runProcess(argv, "", GITDIFF_TIMEOUT_MS).orReturn()
  if (r.timedOut) {
    return Err(`git ${args.join(" ")} took longer than ${GITDIFF_TIMEOUT_MS} ms`)
  }
  if (r.status !== 0) {
    const said = trim(r.stderr)
    return Err(`git ${args.join(" ")} failed (exit ${r.status})${said.length > 0 ? `: ${said}` : ""}`)
  }
  return Ok(r.stdout)
}

/**
 * The top directory of the work tree holding `repo`.
 *
 * @param repo a directory inside the repository
 * @returns the top directory, or `Err` when it is not in a work tree
 */
export const gitdiffTop = (repo: string): Result<string, string> => {
  const out = gitdiffGit(repo, ["rev-parse", "--show-toplevel"]).orReturn()
  return Ok(trim(out))
}

/**
 * The commit the change forked from: the merge base of `base` and HEAD, so
 * commits that landed on the base since are not counted as the change's.
 *
 * @param repo the repository
 * @param base the ref the change is against (checked with gitdiffBaseProblem)
 * @returns the fork point's commit id
 */
export const gitdiffForkPoint = (repo: string, base: string): Result<string, string> => {
  const problem = gitdiffBaseProblem(base)
  if (problem !== null) {
    return Err(problem)
  }
  const out = gitdiffGit(repo, ["merge-base", "--end-of-options", base, "HEAD"]).orReturn()
  return Ok(trim(out))
}

/** One file a change touches, and the lines of it the change adds. */
export class GitdiffFile {
  /** Its path from the repository's top, after the change (before it, when deleted). */
  path: string
  /** The file is new: the base does not have it. */
  added: boolean
  /** The change deletes the file. */
  deleted: boolean
  /** The lines the change adds or rewrites, as `[first, last]` pairs, 1-based, after the change. */
  ranges: i32[]

  /**
   * Makes a file with no lines changed yet.
   *
   * @param path its path from the repository's top
   */
  constructor(path: string) {
    this.path = path
    this.added = false
    this.deleted = false
    this.ranges = []
  }
}

/** Reads a decimal count, or -1 when `text` is not one. */
const gitdiffInt = (text: string): i32 => {
  if (text.length === 0 || text.length > 9) {
    return -1
  }
  let n: i32 = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c < 0x30 || c > 0x39) {
      return -1
    }
    n = n * 10 + (c - 0x30)
  }
  return n
}

/**
 * The new side of a hunk header, `@@ -a,b +c,d @@`, as `[first, count]`.
 *
 * @param line the header
 * @returns the first line and the count, or null when it is not a header
 */
export const gitdiffHunk = (line: string): i32[] | null => {
  if (!line.startsWith("@@ -")) {
    return null
  }
  const plus = line.indexOf(" +")
  if (plus < 0) {
    return null
  }
  const end = line.indexOf(" @@", plus)
  if (end < 0) {
    return null
  }
  const spec = line.substring(plus + 2, end)
  const comma = spec.indexOf(",")
  const first = gitdiffInt(comma >= 0 ? spec.substring(0, comma) : spec)
  const count = comma >= 0 ? gitdiffInt(spec.substring(comma + 1)) : 1
  if (first < 0 || count < 0) {
    return null
  }
  return [first, count]
}

/** The path a `--- a/x` or `+++ b/x` line names; "" for /dev/null. */
const gitdiffSidePath = (line: string): Result<string, string> => {
  // git ends a path holding a space with a tab, so the line reads unambiguously.
  const rest = line.endsWith("\t") ? line.substring(4, line.length - 1) : line.substring(4)
  if (rest === "/dev/null") {
    return Ok("")
  }
  if (rest.startsWith('"')) {
    return Err(`git quoted the path ${rest}: vector reads only paths without control characters`)
  }
  if (rest.startsWith("a/") || rest.startsWith("b/")) {
    return Ok(rest.substring(2))
  }
  return Err(`cannot read the path in "${line}"`)
}

/**
 * Reads the output of `git diff -U0` with `a/` and `b/` prefixes into the
 * files it changes and the lines of each it adds.
 *
 * @param text the diff
 * @returns the files, in the diff's order, or `Err` when it cannot be read
 */
export const gitdiffParse = (text: string): Result<GitdiffFile[], string> => {
  const files: GitdiffFile[] = []
  let oldPath = ""
  let cur: GitdiffFile | null = null
  for (const raw of splitLines(text)) {
    const line = raw.endsWith("\r") ? raw.substring(0, raw.length - 1) : raw
    if (line.startsWith("diff --git ")) {
      cur = null
      oldPath = ""
    } else if (line.startsWith("--- ") && cur === null) {
      oldPath = gitdiffSidePath(line).orReturn()
    } else if (line.startsWith("+++ ") && cur === null) {
      const newPath = gitdiffSidePath(line).orReturn()
      const f = new GitdiffFile(newPath.length > 0 ? newPath : oldPath)
      f.added = oldPath.length === 0
      f.deleted = newPath.length === 0
      files.push(f)
      cur = f
    } else if (line.startsWith("@@ ") && cur !== null) {
      const h = gitdiffHunk(line)
      if (h === null) {
        return Err(`cannot read the hunk header "${line}"`)
      }
      if (h[1] > 0) {
        cur.ranges.push(h[0])
        cur.ranges.push(h[0] + h[1] - 1)
      }
    } else if (line.startsWith("Binary files ") && cur === null && oldPath.length === 0) {
      return Err(`the change touches a binary file: ${line}`)
    }
  }
  return Ok(files)
}

/**
 * Whether `line` is inside one of `file`'s changed ranges.
 *
 * @param file the file
 * @param line a 1-based line number after the change
 * @returns true when the change adds or rewrites that line
 */
export const gitdiffTouches = (file: GitdiffFile, line: i32): boolean => {
  for (let i = 0; i + 1 < file.ranges.length; i += 2) {
    if (line >= file.ranges[i] && line <= file.ranges[i + 1]) {
      return true
    }
  }
  return false
}

/** The number of lines in `text`, counting a last line without a newline. */
const gitdiffLineCount = (text: string): i32 => toI32(splitLines(text).length)

/**
 * The files a change touches against `base`: what `git diff` shows from the
 * fork point to the work tree (commits, staged and unstaged edits), and the
 * untracked files git does not ignore, each wholly added.
 *
 * @param repo the repository
 * @param base the ref the change is against
 * @param paths the paths to look at, from the repository's top; empty for all
 * @returns the files, or `Err` when git fails or the base is refused
 */
export const gitdiffChanged = (repo: string, base: string, paths: string[]): Result<GitdiffFile[], string> => {
  const fork = gitdiffForkPoint(repo, base).orReturn()
  const top = gitdiffTop(repo).orReturn()
  const args: string[] = [
    "-c",
    "core.quotePath=false",
    "diff",
    "-U0",
    "--no-color",
    "--no-ext-diff",
    "--no-renames",
    "--no-textconv",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    "--end-of-options",
    fork,
    "--",
  ]
  const others: string[] = ["ls-files", "--others", "--exclude-standard", "--full-name", "-z", "--"]
  for (const p of paths) {
    args.push(p)
    others.push(p)
  }
  const files = gitdiffParse(gitdiffGit(top, args).orReturn()).orReturn()
  const untracked = gitdiffGit(top, others).orReturn()
  for (const p of gitdiffNulList(untracked)) {
    const f = new GitdiffFile(p)
    f.added = true
    const text = readFileSyncOrNull(`${top}/${p}`)
    const n = text === null ? 0 : gitdiffLineCount(text)
    if (n > 0) {
      f.ranges.push(1)
      f.ranges.push(n)
    }
    files.push(f)
  }
  return Ok(files)
}

/** The non-empty parts of NUL-separated git output. */
const gitdiffNulList = (text: string): string[] => {
  const out: string[] = []
  for (const p of split(text, String.fromCharCode(0))) {
    if (p.length > 0) {
      out.push(p)
    }
  }
  return out
}

/**
 * The paths a change touches against `base`, from the repository's top:
 * those `git diff --name-only` shows from the fork point to the work tree,
 * and the untracked files git does not ignore, sorted, each once.
 *
 * @param repo the repository
 * @param base the ref the change is against
 * @returns the paths, or `Err` when git fails or the base is refused
 */
export const gitdiffChangedPaths = (repo: string, base: string): Result<string[], string> => {
  const fork = gitdiffForkPoint(repo, base).orReturn()
  const top = gitdiffTop(repo).orReturn()
  const names = gitdiffGit(top, [
    "diff",
    "--name-only",
    "-z",
    "--no-renames",
    "--end-of-options",
    fork,
    "--",
  ]).orReturn()
  const others = gitdiffGit(top, ["ls-files", "--others", "--exclude-standard", "--full-name", "-z"]).orReturn()
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of gitdiffNulList(names)) {
    if (!seen.has(p)) {
      seen.add(p)
      out.push(p)
    }
  }
  for (const p of gitdiffNulList(others)) {
    if (!seen.has(p)) {
      seen.add(p)
      out.push(p)
    }
  }
  out.sort(gitdiffCompare)
  return Ok(out)
}

/**
 * Orders two strings by their bytes, for sort.
 *
 * @param a one string
 * @param b the other
 * @returns negative when `a` sorts first, positive when `b` does, 0 when equal
 */
export const gitdiffCompare = (a: string, b: string): i32 => {
  const n = a.length < b.length ? a.length : b.length
  for (let i = 0; i < n; i++) {
    const d = a.charCodeAt(i) - b.charCodeAt(i)
    if (d !== 0) {
      return d
    }
  }
  return a.length - b.length
}

/**
 * A file's text at a commit.
 *
 * @param repo the repository
 * @param commit the commit id
 * @param path the path from the repository's top
 * @returns its text, or null when the commit does not have it
 */
export const gitdiffShow = (repo: string, commit: string, path: string): Result<string | null, string> => {
  const has = gitdiffGit(repo, ["ls-tree", "--name-only", "--end-of-options", commit, "--", path]).orReturn()
  const none: string | null = null
  if (trim(has).length === 0) {
    return Ok(none)
  }
  const text = gitdiffGit(repo, ["cat-file", "blob", `${commit}:${path}`]).orReturn()
  return Ok(text)
}

/** One export a module declares, and the text that declares it. */
export class GitdiffExport {
  /** The name it exports. */
  name: string
  /** The 1-based line its declaration starts on. */
  line: i32
  /** Its declaration, up to the next top-level line, without trailing blank lines. */
  body: string
  /** Why the scanner cannot name or resolve it; "" when it can. */
  problem: string

  /**
   * Makes an export.
   *
   * @param name the name it exports
   * @param line the line it starts on
   * @param body its declaration's text
   * @param problem why it cannot be named or resolved, or ""
   */
  constructor(name: string, line: i32, body: string, problem: string) {
    this.name = name
    this.line = line
    this.body = body
    this.problem = problem
  }
}

/** Whether `c` can be part of an identifier. */
const gitdiffIdentChar = (c: i32): boolean =>
  (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x5f || c === 0x24

/** The identifier `text` starts with; "" when none. */
const gitdiffIdent = (text: string): string => {
  let i = 0
  while (i < text.length && gitdiffIdentChar(text.charCodeAt(i))) {
    i = i + 1
  }
  return text.substring(0, i)
}

/** The modifiers that may stand between `export` and a declaration's keyword. */
const gitdiffModifiers = (): string[] => ["declare ", "abstract ", "async "]

/** The keywords that declare one name, the name following. */
const gitdiffKinds = (): string[] => [
  "const enum ",
  "const ",
  "let ",
  "var ",
  "class ",
  "enum ",
  "type ",
  "interface ",
  "namespace ",
  "module ",
]

/** `text` without the spaces it starts with. */
const gitdiffTrimStart = (text: string): string => {
  let i = 0
  while (i < text.length && text.charCodeAt(i) === 0x20) {
    i = i + 1
  }
  return text.substring(i)
}

/**
 * The name a declaration declares, `export` already taken off: "" when it is
 * not one declaration of one name.
 */
const gitdiffDeclName = (decl: string): string => {
  let rest = decl
  let moved = true
  while (moved) {
    moved = false
    for (const w of gitdiffModifiers()) {
      if (rest.startsWith(w)) {
        rest = gitdiffTrimStart(rest.substring(w.length))
        moved = true
      }
    }
  }
  if (rest.startsWith("function") && !(rest.length > 8 && gitdiffIdentChar(rest.charCodeAt(8)))) {
    rest = gitdiffTrimStart(rest.substring(8))
    if (rest.startsWith("*")) {
      rest = gitdiffTrimStart(rest.substring(1))
    }
    return gitdiffIdent(rest)
  }
  for (const k of gitdiffKinds()) {
    if (rest.startsWith(k)) {
      return gitdiffIdent(gitdiffTrimStart(rest.substring(k.length)))
    }
  }
  return ""
}

/** Whether a line starts with the word `export`. */
const gitdiffIsExport = (line: string): boolean =>
  line.startsWith("export") && (line.length === 6 || !gitdiffIdentChar(line.charCodeAt(6)))

/** Whether an export line opens a braced list: `export {` or `export type {`. */
const gitdiffIsList = (line: string): boolean => {
  const rest = gitdiffTrimStart(line.substring(6))
  return rest.startsWith("{") || (rest.startsWith("type") && gitdiffTrimStart(rest.substring(4)).startsWith("{"))
}

/**
 * The name a top-level `export` line declares: `default` for a default
 * export, the declared name for a declaration.
 *
 * @param line a line of the module
 * @returns the name; "" when the line is not an export; `Err` for an export
 *   it cannot name (a braced list, `export *`, `export import`, `export =`),
 *   which names no declaration to compare
 */
export const gitdiffExportName = (line: string): Result<string, string> => {
  if (!gitdiffIsExport(line)) {
    return Ok("")
  }
  const rest = gitdiffTrimStart(line.substring(6))
  if (rest.startsWith("default") && !(rest.length > 7 && gitdiffIdentChar(rest.charCodeAt(7)))) {
    return Ok("default")
  }
  const name = gitdiffDeclName(rest)
  if (name.length === 0) {
    return Err(`an export it cannot name: ${trim(line)}`)
  }
  return Ok(name)
}

/** Whether a line starts at the top level: not blank, not indented, not a closing bracket. */
const gitdiffTopLevel = (line: string): boolean => {
  if (line.length === 0) {
    return false
  }
  const c = line.charCodeAt(0)
  return c !== 0x20 && c !== 0x09 && c !== 0x7d && c !== 0x29 && c !== 0x5d
}

/** The index after the last line of the item starting at `i`: the next top-level line. */
const gitdiffItemEnd = (lines: string[], i: i32): i32 => {
  let j = i + 1
  while (j < lines.length && !gitdiffTopLevel(lines[j])) {
    j = j + 1
  }
  return j
}

/** Lines `i` up to `j`, without the blank lines they end with. */
const gitdiffItemText = (lines: string[], i: i32, j: i32): string => {
  let end = j
  while (end > i + 1 && trim(lines[end - 1]).length === 0) {
    end = end - 1
  }
  const body: string[] = []
  for (let k = i; k < end; k++) {
    body.push(lines[k])
  }
  return body.join("\n")
}

/** The text of the top-level declaration of `name`, exported or not; null when there is none. */
const gitdiffDeclText = (lines: string[], name: string): string | null => {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!gitdiffTopLevel(line)) {
      continue
    }
    const decl = gitdiffIsExport(line) ? gitdiffTrimStart(line.substring(6)) : line
    if (gitdiffDeclName(decl) === name) {
      return gitdiffItemText(lines, toI32(i), gitdiffItemEnd(lines, toI32(i)))
    }
  }
  return null
}

/**
 * The exports of a braced list, `export { a, b as c }`, each resolved to the
 * module's own declaration of the name it exports. A list that re-exports
 * from another module, or names a declaration the module lacks, is one the
 * scanner cannot resolve.
 */
const gitdiffListExports = (lines: string[], at: i32, statement: string, out: GitdiffExport[]): void => {
  const open = statement.indexOf("{")
  const close = statement.indexOf("}")
  if (close < open) {
    out.push(new GitdiffExport("", at + 1, statement, `an export list it cannot read: ${trim(statement)}`))
    return
  }
  const tail = trim(statement.substring(close + 1))
  if (tail.length > 0 && tail !== ";") {
    out.push(
      new GitdiffExport("", at + 1, statement, `a re-export from another module it cannot resolve: ${trim(statement)}`),
    )
    return
  }
  for (const raw of split(statement.substring(open + 1, close), ",")) {
    let entry = trim(raw)
    if (entry.length === 0) {
      continue
    }
    if (entry.startsWith("type ")) {
      entry = trim(entry.substring(5))
    }
    const local = gitdiffIdent(entry)
    const as = trim(entry.substring(local.length))
    let name = local
    if (as.startsWith("as ")) {
      name = gitdiffIdent(trim(as.substring(3)))
    } else if (as.length > 0) {
      name = ""
    }
    const decl: string | null = local.length > 0 && name.length > 0 ? gitdiffDeclText(lines, local) : null
    if (decl === null) {
      out.push(new GitdiffExport("", at + 1, statement, `an export it cannot resolve to a declaration: ${entry}`))
    } else {
      out.push(new GitdiffExport(name, at + 1, `${entry}\n${decl}`, ""))
    }
  }
}

/** Adds `e` to `out`, joining it to an earlier export of the same name (an overload). */
const gitdiffAddExport = (out: GitdiffExport[], e: GitdiffExport): void => {
  if (e.name.length > 0) {
    for (const o of out) {
      if (o.name === e.name) {
        o.body = `${o.body}\n${e.body}`
        return
      }
    }
  }
  out.push(e)
}

/**
 * The exports a module declares, each with its declaration's text: from its
 * `export` line to the line before the next top-level line that is not a
 * closing bracket, so a doc comment above the next declaration is not part of
 * it. Declarations of one name (overloads) are joined into one export. A
 * braced list names each entry, with the text of the declaration it exports.
 * An export the scanner cannot name or resolve is kept with an empty name and
 * its `problem`, so a change that adds one can be refused.
 *
 * @param text the module's source
 * @returns the exports, in the order they are declared
 */
export const gitdiffExports = (text: string): GitdiffExport[] => {
  const lines = splitLines(text)
  const out: GitdiffExport[] = []
  let i: i32 = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!gitdiffIsExport(line)) {
      i = i + 1
      continue
    }
    const j = gitdiffItemEnd(lines, i)
    const statement = gitdiffItemText(lines, i, j)
    if (gitdiffIsList(line)) {
      gitdiffListExports(lines, i, statement, out)
    } else {
      const name = gitdiffExportName(line)
      if (name.isErr()) {
        out.push(new GitdiffExport("", i + 1, statement, name.error))
      } else {
        gitdiffAddExport(out, new GitdiffExport(name.value, i + 1, statement, ""))
      }
    }
    i = j
  }
  return out
}
