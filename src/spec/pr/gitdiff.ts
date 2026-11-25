/**
 * `spec/pr/gitdiff` — what a change touches, read from git: the files it
 * changes against a base and the lines of each it adds, and the exports a
 * TypeScript module declares. Every git call goes through `runProcess` as
 * an argv, with a time limit; a base is refused when git could read it as an
 * option or a range, and `--` separates paths from everything else.
 */

import { split, splitLines, trim } from "nish/text"
import { runProcess } from "../../core/process"
import {
  LEX_IDENT,
  LEX_NUMBER,
  LEX_PUNCT,
  LEX_STRING,
  LEX_TEMPLATE,
  LexSpan,
  LexToken,
  lexStatements,
  lexTokens,
} from "./lex"

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
  if (base.startsWith("-")) {
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
 * The variables that would point git at another repository than the one
 * named, or change what it prints (added config, an external diff, a
 * prefix), cleared for every git call: a hook or a CI step may have set them.
 * Without GIT_CONFIG_COUNT git ignores every GIT_CONFIG_KEY_n.
 */
const gitdiffUnset = (): string[] => [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_CEILING_DIRECTORIES",
  "GIT_NAMESPACE",
  "GIT_PREFIX",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_EXTERNAL_DIFF",
  "GIT_DIFF_OPTS",
]

/** `text` without its one final line break, as git ends a single-line answer. */
const gitdiffLine = (text: string): string => {
  const t = text.endsWith("\n") ? text.substring(0, text.length - 1) : text
  return t.endsWith("\r") ? t.substring(0, t.length - 1) : t
}

/**
 * `-c safe.directory=<dir>` for `repo`'s real path and each directory above
 * it. With the global config skipped, a user's own safe.directory no longer
 * applies, so a checkout another user owns (a container job, a bind mount)
 * would fail as "dubious ownership"; git honours the setting from its
 * command line, and its top is one of these directories.
 */
const gitdiffSafe = (repo: string): string[] => {
  const out: string[] = []
  let p = realpathSync(repo) ?? repo
  while (p.length > 0) {
    out.push("-c")
    out.push(`safe.directory=${p}`)
    let at = p.length - 1
    while (at > 0 && p.charCodeAt(at) !== 0x2f) {
      at--
    }
    if (at <= 0) {
      break
    }
    p = p.substring(0, at)
  }
  return out
}

/**
 * Runs git in `repo` and returns what it printed. Pathspecs are literal, so
 * a path holding `*` or `:(` names that file, never a pattern. The GIT_*
 * variables that redirect git (GIT_DIR, GIT_WORK_TREE and the like) are
 * cleared, as are those that add config or an external diff, and the
 * system and global configs are skipped (a global core.excludesFile would
 * hide untracked files), so `repo` alone says which repository is read and
 * how. The repository is trusted whoever owns it (gitdiffSafe): the caller
 * named it.
 *
 * @param repo the repository's directory
 * @param args git's arguments, after `-C <repo> --literal-pathspecs`
 * @returns its standard output, or `Err` naming the command and what git said
 */
export const gitdiffGit = (repo: string, args: string[]): Result<string, string> => {
  const argv: string[] = ["env"]
  for (const v of gitdiffUnset()) {
    argv.push("-u")
    argv.push(v)
  }
  for (const a of ["GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null", "git"]) {
    argv.push(a)
  }
  for (const a of gitdiffSafe(repo)) {
    argv.push(a)
  }
  for (const a of ["-C", repo, "--literal-pathspecs"]) {
    argv.push(a)
  }
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
  return Ok(gitdiffLine(out))
}

/**
 * Where `repo` sits in its work tree, from the top: `std/` for a checkout's
 * std directory, "" at the top.
 *
 * @param repo a directory inside the repository
 * @returns the prefix, ending in `/` unless empty
 */
export const gitdiffPrefix = (repo: string): Result<string, string> =>
  Ok(gitdiffLine(gitdiffGit(repo, ["rev-parse", "--show-prefix"]).orReturn()))

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
  const out = gitdiffGit(repo, ["merge-base", "--end-of-options", base, "HEAD"])
  if (out.isErr()) {
    const shallow = gitdiffGit(repo, ["rev-parse", "--is-shallow-repository"])
    const hint =
      shallow.isOk() && gitdiffLine(shallow.value) === "true"
        ? " (the clone is shallow, so the fork point may be missing: fetch the full history, such as actions/checkout's `fetch-depth: 0`)"
        : ""
    return Err(`${out.error}${hint}`)
  }
  return Ok(gitdiffLine(out.value))
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

/** The decimal digits, each at the index of its value. */
const GITDIFF_DIGITS: string = "0123456789"

/** Reads a decimal count, or -1 when `text` is not one. */
const gitdiffInt = (text: string): i32 => {
  if (text.length === 0 || text.length > 9) {
    return -1
  }
  let n: i32 = 0
  for (let i = 0; i < text.length; i++) {
    const d = GITDIFF_DIGITS.indexOf(text.substring(i, i + 1))
    // `text` holds at most nine digits, so `n` never passes the bound below.
    if (d < 0 || d > 9 || n < 0 || n > 99999999) {
      return -1
    }
    n = n * 10 + d
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
  // The text from `plus` starts " +", so the spec is what follows those two.
  const spec = line.substring(plus, end).substring(2)
  const comma = spec.indexOf(",")
  const first = gitdiffInt(comma >= 0 ? spec.substring(0, comma) : spec)
  const count = comma >= 0 ? gitdiffInt(spec.substring(comma).substring(1)) : 1
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
      // gitdiffHunk answers two counts of at most nine digits each.
      if (h === null) {
        return Err(`cannot read the hunk header "${line}"`)
      }
      const hunk: i32[] = h
      if (hunk.length < 2) {
        return Err(`cannot read the hunk header "${line}"`)
      }
      const first = hunk[0]
      const count = hunk[1]
      if (first < 0 || first > 999999999 || count < 0 || count > 999999999) {
        return Err(`cannot read the hunk header "${line}"`)
      }
      if (count > 0) {
        cur.ranges.push(first)
        cur.ranges.push(first + count - 1)
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
  const ranges = file.ranges
  for (let i = 0; i < ranges.length - 1; i += 2) {
    if (line >= ranges[i] && line <= ranges[i + 1]) {
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
  for (let i = 0; i < a.length && i < b.length; i++) {
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
  /** The 1-based line its `export` is on. */
  line: i32
  /** Its statement, from `export` to its last token (a `;` included); for a list entry, the entry and the declaration it names. */
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

/** A declaration's names, or why it has none the scanner can trust. */
class GitdiffDecl {
  /** The names it declares, in order. */
  names: string[]
  /** GITDIFF_DECL_OK, GITDIFF_DECL_UNNAMED or GITDIFF_DECL_UNSPLIT. */
  problem: i32

  constructor(names: string[], problem: i32) {
    this.names = names
    this.problem = problem
  }
}

/** A declaration it reads. */
const GITDIFF_DECL_OK: i32 = 0
/** A statement that declares no name it can read. */
const GITDIFF_DECL_UNNAMED: i32 = 1
/** A `const`, `let` or `var` whose declarators it cannot tell apart. */
const GITDIFF_DECL_UNSPLIT: i32 = 2

/** The text of token `i`, or "" past `to`. */
const gitdiffTok = (toks: LexToken[], i: i32, to: i32): string =>
  i >= 0 && i < to && i < toks.length ? toks[i].text : ""

/** Whether token `i`, before `to`, is an identifier. */
const gitdiffIsIdent = (toks: LexToken[], i: i32, to: i32): boolean =>
  i >= 0 && i < to && i < toks.length && toks[i].kind === LEX_IDENT

/** Whether token `i`, before `to`, is an identifier outside every bracket. */
const gitdiffIsTopIdent = (toks: LexToken[], i: i32, to: i32): boolean =>
  i >= 0 && i < to && i < toks.length && toks[i].kind === LEX_IDENT && toks[i].depth === 0

/** Whether token `i`, before `to`, is the punctuation `p`. */
const gitdiffIsPunct = (toks: LexToken[], i: i32, to: i32, p: string): boolean =>
  i >= 0 && i < to && i < toks.length && toks[i].kind === LEX_PUNCT && toks[i].text === p

/** Whether token `i`, before `to`, is `p` at bracket depth `depth`. */
const gitdiffIsAt = (toks: LexToken[], i: i32, to: i32, depth: i32, p: string): boolean =>
  i >= 0 && i < to && i < toks.length && toks[i].depth === depth && toks[i].text === p

/**
 * Whether the `<` at `at` follows a type's name in a value: `new Map<`,
 * `x as Array<` or `x satisfies ns.T<`, the name a dotted chain of
 * identifiers after `new`, `as` or `satisfies`, all within the value.
 */
const gitdiffTypeChain = (toks: LexToken[], valueStart: i32, at: i32): boolean => {
  if (valueStart < 0 || at < 1 || at <= valueStart || at > toks.length) {
    return false
  }
  let i = at - 1
  if (!gitdiffIsTopIdent(toks, i, at)) {
    return false
  }
  while (i >= 2 && i - 2 >= valueStart && gitdiffIsPunct(toks, i - 1, at, ".") && gitdiffIsIdent(toks, i - 2, at)) {
    i = i - 2
  }
  if (i < 1 || i <= valueStart) {
    return false
  }
  const j = i - 1
  if (!gitdiffIsTopIdent(toks, j, at)) {
    return false
  }
  const w = gitdiffTok(toks, j, at)
  return w === "new" || w === "as" || w === "satisfies"
}

/**
 * Whether the `<` at `at` opens a call's type arguments in a value: it
 * follows a name (`f<` or `ns.f<`), and its matching `>` is followed at once
 * by `(`, with only names, `.`, `,`, `|`, `&`, `=>`, nested angle brackets
 * and bracketed groups between. A number, a string, an `=` or any other
 * operator in between reads it as a comparison instead, as does a `>` that
 * never comes, so `x < 1, y > (z)` is still a statement it cannot split.
 */
const gitdiffCallTypeArgs = (toks: LexToken[], valueStart: i32, at: i32, to: i32): boolean => {
  if (valueStart < 0 || at < 1 || at <= valueStart || at >= toks.length || !gitdiffIsTopIdent(toks, at - 1, at)) {
    return false
  }
  const atDepth = toks[at].depth
  // Only ever compared with 0, so a `>` before any `<` wrapping is harmless.
  let nest: u32 = 0
  for (let i = at; i < to && i < toks.length; i++) {
    const t = toks[i]
    if (t.depth > atDepth || (t.kind === LEX_PUNCT && (t.text === "(" || t.text === "[" || t.text === "{"))) {
      if (t.kind === LEX_STRING || t.kind === LEX_NUMBER || t.kind === LEX_TEMPLATE) {
        return false
      }
      continue
    }
    if (t.kind === LEX_IDENT) {
      continue
    }
    if (t.kind !== LEX_PUNCT) {
      return false
    }
    if (t.text === "<") {
      nest++
    } else if (t.text === ">") {
      nest--
      if (nest === 0) {
        return gitdiffIsPunct(toks, i + 1, to, "(")
      }
    } else if (
      t.text !== "," &&
      t.text !== "." &&
      t.text !== "|" &&
      t.text !== "&" &&
      t.text !== "=>" &&
      t.text !== ")" &&
      t.text !== "]" &&
      t.text !== "}"
    ) {
      return false
    }
  }
  return false
}

/**
 * Whether the token at `close` is the `)` ending an arrow's parameters at the
 * head of a value: `(…)`, `async (…)`, `<T>(…)` or `async <T>(…)`, so a `:`
 * after it starts the arrow's return type rather than a ternary's other arm.
 */
const gitdiffArrowHead = (toks: LexToken[], valueStart: i32, close: i32): boolean => {
  if (valueStart < 0 || close < 0 || close < valueStart || close >= toks.length || valueStart >= toks.length) {
    return false
  }
  if (!gitdiffIsPunct(toks, close, close + 1, ")") || toks[close].depth !== 0) {
    return false
  }
  let open = close - 1
  while (open >= 0 && open >= valueStart && !gitdiffIsAt(toks, open, close, 0, "(")) {
    open = open - 1
  }
  let head = valueStart
  if (gitdiffTok(toks, valueStart, open) === "async" && gitdiffIsIdent(toks, valueStart, open)) {
    head = valueStart + 1
  }
  if (open === head) {
    return true
  }
  return open >= 1 && open > head && gitdiffIsPunct(toks, head, open, "<") && gitdiffIsPunct(toks, open - 1, open, ">")
}

/** Whether a `,` at `at` is followed by another declarator: a name, then `:`, `=`, `!`, `,` or the end. */
const gitdiffNextDeclarator = (toks: LexToken[], at: i32, to: i32): boolean => {
  if (at < 0 || at >= toks.length - 1 || !gitdiffIsIdent(toks, at + 1, to)) {
    return false
  }
  const k = at + 2
  if (k >= to) {
    return true
  }
  return (
    gitdiffIsPunct(toks, k, to, ":") ||
    gitdiffIsPunct(toks, k, to, "=") ||
    gitdiffIsPunct(toks, k, to, "!") ||
    gitdiffIsPunct(toks, k, to, ",")
  )
}

/**
 * The names of the declarators of a `const`, `let` or `var`, from the token
 * `from` after the keyword to `to`. A top-level `,` outside angle brackets
 * starts the next declarator. Before a declarator's `=`, `<` and `>` pair as
 * a type's brackets; after it `<` is an operator (`i < 3`) unless it opens the
 * value (a generic arrow), follows a type's name (gitdiffTypeChain), opens a
 * call's type arguments (gitdiffCallTypeArgs: `f<T, U>(x)`), or is in
 * an arrow's return type: a `:` right after a top-level `)`, which must reach
 * its `=>` with no `=` or top-level `,` on the way. A `,` not followed by a
 * declarator, an angle bracket that never closes, or a return type that never
 * reaches its arrow is a statement it cannot split, never one it guesses at.
 */
const gitdiffDeclarators = (toks: LexToken[], from: i32, to: i32): GitdiffDecl => {
  const names: string[] = []
  let i = from
  while (true) {
    if (!gitdiffIsIdent(toks, i, to) || i < 0 || i >= toks.length) {
      return new GitdiffDecl(names, names.length === 0 ? GITDIFF_DECL_UNNAMED : GITDIFF_DECL_UNSPLIT)
    }
    names.push(gitdiffTok(toks, i, to))
    i = i + 1
    let inValue = false
    let valueStart: i32 = -1
    // Lowered only while above 0.
    let angle: u32 = 0
    let returnType = false
    let next = false
    while (i >= 0 && i < to && i < toks.length) {
      const t = toks[i]
      if (t.depth === 0 && t.kind === LEX_PUNCT) {
        const typeAngle = !inValue || returnType || angle > 0
        if (
          t.text === "<" &&
          (typeAngle ||
            i === valueStart ||
            gitdiffTypeChain(toks, valueStart, i) ||
            gitdiffCallTypeArgs(toks, valueStart, i, to))
        ) {
          angle++
        } else if (t.text === ">" && angle > 0) {
          angle--
        } else if (returnType) {
          if (t.text === "=>" && angle === 0) {
            returnType = false
          } else if (t.text === "=" || (t.text === "," && angle === 0)) {
            return new GitdiffDecl(names, GITDIFF_DECL_UNSPLIT)
          }
        } else if (inValue && angle === 0 && t.text === ":" && gitdiffArrowHead(toks, valueStart, i - 1)) {
          returnType = true
        } else if (t.text === "=" && !inValue && angle === 0) {
          inValue = true
          valueStart = i + 1
        } else if (t.text === "," && angle === 0) {
          if (!gitdiffNextDeclarator(toks, i, to)) {
            return new GitdiffDecl(names, GITDIFF_DECL_UNSPLIT)
          }
          next = true
          i = i + 1
          break
        }
      }
      i = i + 1
    }
    if (angle > 0 || returnType) {
      return new GitdiffDecl(names, GITDIFF_DECL_UNSPLIT)
    }
    if (!next) {
      return new GitdiffDecl(names, GITDIFF_DECL_OK)
    }
  }
}

/**
 * The names the declaration at tokens `[from, to)` declares, `export`
 * already passed: one for a function, class, enum, interface, type alias,
 * namespace or module, each declarator's for a `const`, `let` or `var`.
 */
const gitdiffDeclare = (toks: LexToken[], from: i32, to: i32): GitdiffDecl => {
  let i = from
  while (
    i >= 0 &&
    i < toks.length &&
    (gitdiffTok(toks, i, to) === "declare" ||
      gitdiffTok(toks, i, to) === "abstract" ||
      gitdiffTok(toks, i, to) === "async") &&
    gitdiffIsIdent(toks, i + 1, to)
  ) {
    i = i + 1
  }
  if (i < 0 || i >= toks.length || !gitdiffIsIdent(toks, i, to)) {
    return new GitdiffDecl([], GITDIFF_DECL_UNNAMED)
  }
  let k = gitdiffTok(toks, i, to)
  if (k === "const" && i < toks.length - 1 && gitdiffTok(toks, i + 1, to) === "enum") {
    i = i + 1
    k = "enum"
  }
  if (i >= toks.length) {
    return new GitdiffDecl([], GITDIFF_DECL_UNNAMED)
  }
  if (k === "const" || k === "let" || k === "var") {
    return gitdiffDeclarators(toks, i + 1, to)
  }
  if (k === "function") {
    i = i + 1
    if (i < toks.length && gitdiffIsPunct(toks, i, to, "*")) {
      i = i + 1
    }
  } else if (["class", "enum", "interface", "type", "namespace", "module"].indexOf(k) >= 0) {
    i = i + 1
  } else {
    return new GitdiffDecl([], GITDIFF_DECL_UNNAMED)
  }
  if (!gitdiffIsIdent(toks, i, to)) {
    return new GitdiffDecl([], GITDIFF_DECL_UNNAMED)
  }
  return new GitdiffDecl([gitdiffTok(toks, i, to)], GITDIFF_DECL_OK)
}

/** The index after a statement's last token other than a closing `;`. */
const gitdiffStmtEnd = (toks: LexToken[], span: LexSpan): i32 => {
  const from = span.from
  const to = span.to
  if (to > from && to >= 1 && gitdiffIsPunct(toks, to - 1, to, ";")) {
    return to - 1
  }
  return to
}

/** Why tokens `[from, to)` are not a statement of the module's `toks`. */
const gitdiffOutside = (toks: LexToken[], from: i32, to: i32): string =>
  `a statement at tokens [${from}, ${to}) of a module of ${toks.length} tokens`

/** The text of tokens `[from, to)`, from the first's start to the last's end. */
const gitdiffText = (text: string, toks: LexToken[], from: i32, to: i32): Result<string, string> => {
  if (from < 0 || from >= to || from >= toks.length || to < 1 || to > toks.length) {
    return Err(gitdiffOutside(toks, from, to))
  }
  return Ok(text.substring(toks[from].start, toks[to - 1].end))
}

/** A statement's text, from its first token to its last. */
const gitdiffStmtText = (text: string, toks: LexToken[], span: LexSpan): Result<string, string> =>
  gitdiffText(text, toks, span.from, span.to)

/** Whether a statement starts with `export`. */
const gitdiffIsExportStmt = (toks: LexToken[], span: LexSpan): boolean =>
  gitdiffIsIdent(toks, span.from, span.to) && gitdiffTok(toks, span.from, span.to) === "export"

/**
 * The text of every top-level statement declaring `name`, exported or not,
 * joined by line breaks (overloads); null when there is none.
 */
const gitdiffDeclText = (
  text: string,
  toks: LexToken[],
  spans: LexSpan[],
  name: string,
): Result<string | null, string> => {
  const found: string[] = []
  for (const span of spans) {
    const from = span.from
    const to = span.to
    const start = gitdiffIsExportStmt(toks, span) && from < to ? from + 1 : from
    const d = gitdiffDeclare(toks, start, gitdiffStmtEnd(toks, span))
    if (d.names.indexOf(name) >= 0) {
      found.push(gitdiffStmtText(text, toks, span).orReturn())
    }
  }
  const joined: string | null = found.length > 0 ? found.join("\n") : null
  return Ok(joined)
}

/**
 * The exports of a braced list, `export { a, b as c }`, each resolved to the
 * module's own declaration of the name it exports. A list that re-exports
 * from another module, or names a declaration the module lacks, is one the
 * scanner cannot resolve.
 */
const gitdiffListExports = (
  text: string,
  toks: LexToken[],
  spans: LexSpan[],
  span: LexSpan,
  open: i32,
  out: GitdiffExport[],
): Result<void, string> => {
  const end = gitdiffStmtEnd(toks, span)
  const statement = gitdiffStmtText(text, toks, span).orReturn()
  const from = span.from
  if (from < 0 || from >= toks.length || open < 0 || open >= end || end < 1 || end > toks.length) {
    return Err(gitdiffOutside(toks, from, span.to))
  }
  const line = toks[from].line
  let close = open + 1
  while (close < end && !gitdiffIsAt(toks, close, end, 0, "}")) {
    close = close + 1
  }
  if (close < end - 1) {
    const why =
      gitdiffTok(toks, close + 1, end) === "from"
        ? `a re-export from another module it cannot resolve: ${statement}`
        : `an export list it cannot read: ${statement}`
    out.push(new GitdiffExport("", line, statement, why))
    return Ok()
  }
  let a = open + 1
  while (a >= 0 && a < close) {
    let b = a
    while (b < close && !gitdiffIsAt(toks, b, close, 1, ",")) {
      b = b + 1
    }
    if (b > a) {
      let s = a
      if (s < b - 1 && gitdiffIsIdent(toks, s, b) && gitdiffTok(toks, s, b) === "type") {
        s = s + 1
      }
      const entry = gitdiffText(text, toks, s, b).orReturn()
      let name = ""
      if (gitdiffIsIdent(toks, s, b)) {
        if (s === b - 1) {
          name = gitdiffTok(toks, s, b)
        } else if (b >= 3 && s === b - 3) {
          // `s as t`: the `as` at b - 2, the exported name at b - 1.
          if (gitdiffTok(toks, b - 2, b) === "as" && gitdiffIsIdent(toks, b - 1, b)) {
            name = gitdiffTok(toks, b - 1, b)
          }
        }
      }
      let decl: string | null = null
      if (name.length > 0) {
        decl = gitdiffDeclText(text, toks, spans, gitdiffTok(toks, s, b)).orReturn()
      }
      if (decl === null) {
        out.push(
          new GitdiffExport(
            "",
            line,
            statement,
            `an export it cannot resolve to a declaration in this module (an imported name is not followed): ${entry}`,
          ),
        )
      } else {
        out.push(new GitdiffExport(name, line, `${entry}\n${decl}`, ""))
      }
    }
    // At `close` the list ends, as it does one past it.
    a = b < close ? b + 1 : close
  }
  return Ok()
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

/** The line a lexer message (`line N: why`) names, or 1. */
const gitdiffLexLine = (message: string): i32 => {
  if (!message.startsWith("line ")) {
    return 1
  }
  let n: i32 = 0
  for (let i = 5; i < message.length; i++) {
    const d = GITDIFF_DIGITS.indexOf(message.substring(i, i + 1))
    if (d < 0 || d > 9) {
      break
    }
    // A line past i32 is past any module the lexer reads.
    if (n < 0 || n > 214748363) {
      return 1
    }
    n = n * 10 + d
  }
  return n > 0 ? n : 1
}

/** The export statement `span`, added to `out`. */
const gitdiffExportStmt = (
  text: string,
  toks: LexToken[],
  spans: LexSpan[],
  span: LexSpan,
  out: GitdiffExport[],
): Result<void, string> => {
  const end = gitdiffStmtEnd(toks, span)
  const body = gitdiffStmtText(text, toks, span).orReturn()
  const from = span.from
  if (from < 0 || from >= toks.length) {
    return Err(gitdiffOutside(toks, from, span.to))
  }
  const line = toks[from].line
  // The statement's first line, as splitLines(body)[0] reads it.
  const nl = body.indexOf("\n")
  const first = trim(nl >= 0 ? body.substring(0, nl) : body)
  const k = from + 1
  if (gitdiffIsIdent(toks, k, end) && gitdiffTok(toks, k, end) === "default") {
    gitdiffAddExport(out, new GitdiffExport("default", line, body, ""))
    return Ok()
  }
  if (gitdiffIsPunct(toks, k, end, "{")) {
    return gitdiffListExports(text, toks, spans, span, k, out)
  }
  if (k < toks.length && gitdiffTok(toks, k, end) === "type" && gitdiffIsPunct(toks, k + 1, end, "{")) {
    return gitdiffListExports(text, toks, spans, span, k + 1, out)
  }
  const d = gitdiffDeclare(toks, k, end)
  const names = d.names
  // gitdiffDeclare names at least one when it answers OK.
  if (d.problem === GITDIFF_DECL_UNNAMED || names.length < 1) {
    out.push(new GitdiffExport("", line, body, `an export it cannot name: ${first}`))
  } else if (d.problem === GITDIFF_DECL_UNSPLIT) {
    out.push(
      new GitdiffExport(
        "",
        line,
        body,
        `an export it cannot split into names: ${first}: a comma or an angle bracket it cannot place, so it may declare more than one name`,
      ),
    )
  } else if (names.length > 1) {
    out.push(
      new GitdiffExport(
        "",
        line,
        body,
        `an export declaring more than one name: ${first}: give each name its own export`,
      ),
    )
  } else {
    gitdiffAddExport(out, new GitdiffExport(names[0], line, body, ""))
  }
  return Ok()
}

/**
 * The exports a module declares, each with its statement's text (lexStatements:
 * a statement ends at a top-level `;`, before the next `export`, or where
 * automatic semicolon insertion ends it, wherever lines start), so a doc
 * comment above the next declaration is not part of it. Declarations of one
 * name (overloads) are joined into one export. A braced list names each
 * entry, with the text of the declaration it exports. An export the scanner
 * cannot name, split or resolve, or one `const`, `let` or `var` declaring
 * several names, is kept with an empty name and its `problem`, so a change
 * that adds one can be refused. A module it cannot tokenize (lexTokens) is
 * one unnamed export whose body is the whole text, so any change to it is
 * refused.
 *
 * @param text the module's source
 * @returns the exports, in the order they are declared
 */
export const gitdiffExports = (text: string): GitdiffExport[] => {
  const out: GitdiffExport[] = []
  const lexed = lexTokens(text)
  if (lexed.isErr()) {
    out.push(new GitdiffExport("", gitdiffLexLine(lexed.error), text, `a module it cannot read: ${lexed.error}`))
    return out
  }
  const toks = lexed.value
  const spans = lexStatements(toks)
  for (const span of spans) {
    if (gitdiffIsExportStmt(toks, span)) {
      // lexStatements answers spans within `toks`, so this never fails.
      const r = gitdiffExportStmt(text, toks, spans, span, out)
      if (r.isErr()) {
        return [new GitdiffExport("", 1, text, `a module it cannot read: ${r.error}`)]
      }
    }
  }
  return out
}

/**
 * The name the first `export` in `source` declares: `default` for a default
 * export, the declared name for a declaration.
 *
 * @param source a statement or a few, such as one line of a module
 * @returns the name; "" when it holds no export; `Err` for an export it
 *   cannot name or resolve (a braced list without its declaration, `export *`,
 *   `export import`, `export =`, several names) or source it cannot read
 */
export const gitdiffExportName = (source: string): Result<string, string> => {
  const list = gitdiffExports(source)
  if (list.length < 1) {
    return Ok("")
  }
  const e = list[0]
  if (e.problem.length > 0) {
    return Err(e.problem)
  }
  return Ok(e.name)
}
