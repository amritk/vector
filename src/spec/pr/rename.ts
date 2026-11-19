/**
 * `spec/pr/rename` — the one change that may touch both sides of a frozen
 * contract: renaming the functions it tests, and nothing else. The rename is
 * computed, never assumed: each checked contract's `functions` at the fork
 * point and in the work tree must differ by exactly one function, dropped
 * under one name and added under another with the same signature. Every
 * changed path must then be a regular file at both, whose work-tree text,
 * with each new name put back to its old one at identifier boundaries, is
 * its fork-point text. Only what the gate re-verifies is exempt: a checked
 * contract's recorded `sha256` values (held to the sources by frozen) and a
 * generated test's one `// vector-contract-sha256:` line. Fails closed: a
 * new name the fork point already uses, an old name the work tree still
 * uses, an added, deleted or retyped file, or any other edit refuses.
 */

import { splitLines, trim } from "nish/text"
import { contractLoad, contractLoadFile } from "../contract/contract"
import { FnSig, NameOverride } from "../contract/types"
import { gitdiffGit } from "./gitdiff"
import { STALE_PREFIX } from "./stale"

/** One function a contract renames. */
export class RenamePair {
  /** The contract that renames it, from the repository's top. */
  contract: string
  /** Its name at the fork point. */
  from: string
  /** Its name in the work tree. */
  to: string

  /**
   * Makes a pair.
   *
   * @param contract the contract, from the repository's top
   * @param from the name at the fork point
   * @param to the name in the work tree
   */
  constructor(contract: string, from: string, to: string) {
    this.contract = contract
    this.from = from
    this.to = to
  }
}

/** What renaming computed: the pairs, or why the change is no rename. */
export class RenameVerdict {
  /** The functions renamed, one per contract that renames one. */
  pairs: RenamePair[]
  /** Why the change is not the rename alone; null when it is. */
  refusal: string | null
  /** Makes a verdict with no pairs and no refusal. */
  constructor() {
    this.pairs = []
    this.refusal = null
  }
}

/** Whether `c` (a char code) can be part of an identifier. */
const renameIdentChar = (c: i32): boolean =>
  (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36

/**
 * `text` with every identifier token equal to `find[i]` replaced by
 * `put[i]`, all at once: a token is a longest run of letters, digits, `_`
 * and `$`, so a name inside a longer one is left alone.
 *
 * @param text the text
 * @param find the names to replace
 * @param put what each one becomes
 * @returns the replaced text
 */
export const renameTokens = (text: string, find: string[], put: string[]): string => {
  let out = ""
  let at = 0
  let i = 0
  while (i < text.length) {
    if (!renameIdentChar(text.charCodeAt(i))) {
      i++
      continue
    }
    let j = i
    while (j < text.length && renameIdentChar(text.charCodeAt(j))) {
      j++
    }
    const k = find.indexOf(text.substring(i, j))
    if (k >= 0) {
      out = `${out}${text.substring(at, i)}${put[k]}`
      at = j
    }
    i = j
  }
  return `${out}${text.substring(at)}`
}

/**
 * Whether `text` holds `name` as an identifier token (renameTokens).
 *
 * @param text the text
 * @param name the name
 * @returns true when some token is `name`
 */
export const renameHas = (text: string, name: string): boolean => renameTokens(text, [name], [""]) !== text

/**
 * A contract's text with each recorded `"sha256": "<hex>"` value blanked,
 * so two contracts that differ only there compare equal.
 *
 * @param text the contract's text
 * @returns the text with every such value emptied
 */
export const renameBlankShas = (text: string): string => {
  const key = '"sha256"'
  let out = ""
  let at = 0
  let i = text.indexOf(key)
  while (i >= 0) {
    let j = i + key.length
    while (j < text.length && (text.charCodeAt(j) === 32 || text.charCodeAt(j) === 9)) {
      j++
    }
    if (j < text.length && text.charCodeAt(j) === 58) {
      j++
      while (j < text.length && (text.charCodeAt(j) === 32 || text.charCodeAt(j) === 9)) {
        j++
      }
      if (j < text.length && text.charCodeAt(j) === 34) {
        const start = j + 1
        let end = start
        while (end < text.length && renameHexChar(text.charCodeAt(end))) {
          end++
        }
        if (end < text.length && text.charCodeAt(end) === 34) {
          out = `${out}${text.substring(at, start)}`
          at = end
        }
      }
    }
    i = text.indexOf(key, i + key.length)
  }
  return `${out}${text.substring(at)}`
}

/** Whether `c` (a char code) is a hex digit. */
const renameHexChar = (c: i32): boolean => (c >= 48 && c <= 57) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70)

/**
 * A generated test's text with its first `// vector-contract-sha256:` line
 * cut to the prefix, so two tests that differ only in the contract they
 * name compare equal.
 *
 * @param text the test's text
 * @returns the text with that line's value removed
 */
export const renameBlankStale = (text: string): string => {
  const lines = splitLines(text)
  const prefix = STALE_PREFIX.substring(0, STALE_PREFIX.length - 1)
  for (let i = 0; i < lines.length; i++) {
    const at = lines[i].indexOf(prefix)
    if (at >= 0 && trim(lines[i].substring(0, at)).length === 0) {
      lines[i] = lines[i].substring(0, at + prefix.length)
      return lines.join("\n")
    }
  }
  return lines.join("\n")
}

/** Whether two optional strings are both null or equal. */
const renameSameOpt = (a: string | null, b: string | null): boolean => {
  if (a === null || b === null) {
    return a === null && b === null
  }
  return a === b
}

/** Whether two name overrides lists say the same. */
const renameSameNames = (a: NameOverride[] | null, b: NameOverride[] | null): boolean => {
  if (a === null || b === null) {
    return a === null && b === null
  }
  if (a.length !== b.length) {
    return false
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i].language !== b[i].language || a[i].value !== b[i].value) {
      return false
    }
  }
  return true
}

/**
 * Whether two functions have the same signature apart from their names:
 * module, parameters (name, type and overrides), result and overrides.
 *
 * @param a one function
 * @param b the other
 * @returns true when only `name` differs, if anything
 */
export const renameSameSig = (a: FnSig, b: FnSig): boolean => {
  if (!renameSameOpt(a.module, b.module) || a.returns !== b.returns || a.params.length !== b.params.length) {
    return false
  }
  if (!renameSameNames(a.names, b.names)) {
    return false
  }
  for (let i = 0; i < a.params.length; i++) {
    const p = a.params[i]
    const q = b.params[i]
    if (p.name !== q.name || p.type !== q.type || !renameSameNames(p.names, q.names)) {
      return false
    }
  }
  return true
}

/** The functions of `fns` whose name no function of `others` has. */
const renameOnly = (fns: FnSig[], others: FnSig[]): FnSig[] => {
  const names = new Set<string>()
  for (const f of others) {
    names.add(f.name)
  }
  const out: FnSig[] = []
  for (const f of fns) {
    if (!names.has(f.name)) {
      out.push(f)
    }
  }
  return out
}

/** How many `fns` there are and their names, for a message. */
const renameNames = (fns: FnSig[]): string => {
  if (fns.length === 0) {
    return "none"
  }
  const out: string[] = []
  for (const f of fns) {
    out.push(f.name)
  }
  return `${fns.length} (${out.join(", ")})`
}

/** `path` from the repository's top when it is inside it, else as given. */
const renameShown = (path: string, top: string): string =>
  path.startsWith(`${top}/`) ? path.substring(top.length + 1) : path

/** A file's git mode at a commit ("100644", "120000", ...), or "" when the commit does not have it. */
const renameForkMode = (top: string, fork: string, path: string): Result<string, string> => {
  const line = gitdiffGit(top, ["ls-tree", "-z", "--end-of-options", fork, "--", path]).orReturn()
  const sp = line.indexOf(" ")
  return Ok(sp < 0 ? "" : line.substring(0, sp))
}

/**
 * The function each checked contract renames since the fork point. A
 * contract whose function names did not change renames nothing; one whose
 * names changed must drop exactly one and add exactly one, of the same
 * signature, or the change is no rename. Two contracts may rename the same
 * function the same way, but no name may be renamed two ways, and no new
 * name may be another's old one.
 *
 * @param top the repository's top
 * @param fork the fork point's commit
 * @param contracts the checked contracts, absolute, each loading in the work tree
 * @returns the pairs and, when the change is no rename, why; `Err` when git fails
 */
export const renamePairs = (top: string, fork: string, contracts: string[]): Result<RenameVerdict, string> => {
  const v = new RenameVerdict()
  for (const path of contracts) {
    const name = renameShown(path, top)
    const now = contractLoadFile(path)
    if (now.isErr()) {
      continue
    }
    if (renameForkMode(top, fork, name).orReturn() === "") {
      continue
    }
    const text = gitdiffGit(top, ["cat-file", "blob", `${fork}:${name}`]).orReturn()
    const then = contractLoad(text, `${fork}:${name}`)
    if (then.isErr()) {
      v.refusal = `${name}: no rename: it is not a contract at the fork point`
      return Ok(v)
    }
    const dropped = renameOnly(then.value.functions, now.value.functions)
    const added = renameOnly(now.value.functions, then.value.functions)
    if (dropped.length === 0 && added.length === 0) {
      continue
    }
    if (dropped.length !== 1 || added.length !== 1) {
      v.refusal = `${name}: no rename: it drops ${renameNames(dropped)} and adds ${renameNames(added)}, not one function each`
      return Ok(v)
    }
    if (!renameSameSig(dropped[0], added[0])) {
      v.refusal = `${name}: no rename: ${added[0].name} has another signature than ${dropped[0].name}`
      return Ok(v)
    }
    const p = new RenamePair(name, dropped[0].name, added[0].name)
    let dup = false
    for (const q of v.pairs) {
      if (q.from === p.from && q.to === p.to) {
        dup = true
      } else if (q.from === p.from || q.to === p.to || q.from === p.to || q.to === p.from) {
        v.refusal = `${name}: no rename: it renames ${p.from} to ${p.to}, but ${q.contract} renames ${q.from} to ${q.to}`
        return Ok(v)
      }
    }
    if (!dup) {
      v.pairs.push(p)
    }
  }
  return Ok(v)
}

/**
 * Why one changed path is not the rename alone.
 *
 * @param top the repository's top
 * @param fork the fork point's commit
 * @param path the path, from the top
 * @param pairs the renames
 * @param contract whether it is a checked contract, whose sha256 values are exempt
 * @param generated whether it is a generated test, whose sha line is exempt
 * @returns the reason, or null when it is the rename alone; `Err` when git fails
 */
const renameFileProblem = (
  top: string,
  fork: string,
  path: string,
  pairs: RenamePair[],
  contract: boolean,
  generated: boolean,
): Result<string | null, string> => {
  const mode = renameForkMode(top, fork, path).orReturn()
  const st = lstatOwnerModeSync(`${top}/${path}`)
  if (mode === "") {
    return Ok(`${path}: added by the change`)
  }
  if (st < 0) {
    return Ok(`${path}: deleted by the change`)
  }
  const kind = st & 0o170000
  if ((mode !== "100644" && mode !== "100755") || kind !== 0o100000) {
    return Ok(`${path}: not a regular file at the fork point and now`)
  }
  if ((mode === "100755") !== ((st & 0o100) !== 0)) {
    return Ok(`${path}: its mode changed`)
  }
  let then = gitdiffGit(top, ["cat-file", "blob", `${fork}:${path}`]).orReturn()
  const read = readFileSyncOrNull(`${top}/${path}`)
  if (read === null) {
    return Ok(`${path}: cannot be read`)
  }
  let now: string = read
  const olds: string[] = []
  const news: string[] = []
  for (const p of pairs) {
    if (renameHas(then, p.to)) {
      return Ok(`${path}: already names ${p.to} at the fork point, so the rename cannot be told from it`)
    }
    if (renameHas(now, p.from)) {
      return Ok(`${path}: still names ${p.from}, so the rename is partial`)
    }
    olds.push(p.from)
    news.push(p.to)
  }
  now = renameTokens(now, news, olds)
  if (contract) {
    then = renameBlankShas(then)
    now = renameBlankShas(now)
  }
  if (generated) {
    then = renameBlankStale(then)
    now = renameBlankStale(now)
  }
  if (then === now) {
    const none: string | null = null
    return Ok(none)
  }
  const a = splitLines(then)
  const b = splitLines(now)
  let line = 0
  while (line < a.length && line < b.length && a[line] === b[line]) {
    line++
  }
  return Ok(`${path}: line ${line + 1} is not the rename alone`)
}

/**
 * Whether a change touching both sides is the checked contracts' renames
 * alone (renamePairs), file by file.
 *
 * @param top the repository's top
 * @param fork the fork point's commit
 * @param paths every path the change touches, from the top
 * @param contracts the checked contracts, absolute, each loading in the work tree
 * @param generated the changed paths that are generated tests
 * @returns the verdict, with no pairs and no refusal when no contract renames
 *   a function; `Err` when git fails
 */
export const renameCheck = (
  top: string,
  fork: string,
  paths: string[],
  contracts: string[],
  generated: string[],
): Result<RenameVerdict, string> => {
  const v = renamePairs(top, fork, contracts).orReturn()
  if (v.refusal !== null || v.pairs.length === 0) {
    return Ok(v)
  }
  const shown: string[] = []
  for (const c of contracts) {
    shown.push(renameShown(c, top))
  }
  for (const p of paths) {
    const why = renameFileProblem(top, fork, p, v.pairs, shown.indexOf(p) >= 0, generated.indexOf(p) >= 0).orReturn()
    if (why !== null) {
      v.refusal = why
      return Ok(v)
    }
  }
  return Ok(v)
}
