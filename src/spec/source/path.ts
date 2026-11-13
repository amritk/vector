/**
 * `spec/source/path` — where a contract's source is read from, and the
 * refusal of a file that is not spec text.
 *
 * A source is located by its `path` (relative to the contract's directory)
 * or, for an RFC given by number, by looking for rfc<n>.xml then rfc<n>.txt
 * beside the contract, in ../rfcs, then in the root's rfcs/. Its `file` does
 * not locate it: it records which file was read (sourceLabel), and a check
 * refuses a contract whose `file` names another.
 *
 * A contract can come from anyone, so it may read only spec text: a file
 * beside it, or under specs/ or rfcs/ beside it, beside its parent, or in the
 * root, with no hidden directory below that and no specs/ or rfcs/ that is
 * itself a symbolic link (which could lead anywhere). The file is judged after
 * every link is followed, opened, and judged again as the file the descriptor
 * holds, and its bytes come from that descriptor: a link swapped between the
 * judgement and the read cannot change what is read.
 */

import { sha256 } from "nish/crypto/sha256"
import { basename, dirname, joinPath } from "../../core/fs"
import { toHex } from "../../core/hex"
import { charsFirstControl } from "../contract/chars"
import { SourceDecl } from "../contract/types"

/**
 * Where an RFC's plain text is fetched to (sourceFetchHint).
 *
 * @param n the RFC's number
 * @returns `rfcs/rfc<n>.txt`
 */
export const sourceRfcFile = (n: i32): string => `rfcs/rfc${n}.txt`

/**
 * How to fetch an RFC's plain text into `rfcs/`.
 *
 * @param n the RFC's number
 * @returns a curl command that writes rfcs/rfc<n>.txt from rfc-editor.org
 */
export const sourceFetchHint = (n: i32): string =>
  `curl -sSfL -o rfcs/rfc${n}.txt https://www.rfc-editor.org/rfc/rfc${n}.txt`

/**
 * Why a source's name may not be read, judged from its text alone: empty, a
 * control character, a backslash, or absolute.
 *
 * @param name the `path` or `file` a source gives
 * @returns the problem, or null when the name may be resolved
 */
export const sourceNameProblem = (name: string): string | null => {
  if (name.length === 0) {
    return "an empty path"
  }
  const control = charsFirstControl(name)
  if (control !== null) {
    return `${control} in the path`
  }
  if (name.indexOf("\\") >= 0) {
    return "a backslash in the path: separate with /"
  }
  if (name.startsWith("/")) {
    return `an absolute path, ${name}: give it relative to the contract`
  }
  return null
}

/** The largest source read, in bytes: an RFC is well under a megabyte. */
const SOURCE_MAX_BYTES: i64 = 16777216

/** The directories under which a contract may read spec text. */
const sourceSpecDirs = (): string[] => ["specs", "rfcs"]

/** Whether a path exists, after following links. */
const sourceExists = (path: string): boolean => realpathSync(path) !== null

/** Whether a path is itself a symbolic link. */
const sourceIsLink = (path: string): boolean => {
  const st = lstatOwnerModeSync(path)
  return st >= 0 && (st & 0o170000) === 0o120000
}

/** The real directory holding the contract; its own text when it does not resolve. */
const sourceHere = (contractPath: string): string => realpathSync(dirname(contractPath)) ?? dirname(contractPath)

/** `path` relative to directory `dir` when it is strictly below it, else null. */
const sourceBelow = (dir: string, path: string): string | null => {
  if (dir === "/") {
    return path.startsWith("/") && path.length > 1 ? path.substring(1) : null
  }
  return path.startsWith(`${dir}/`) ? path.substring(dir.length + 1) : null
}

/**
 * The places an RFC given only by number is looked for, nearest first: beside
 * the contract, in ../rfcs, then in the root's rfcs/; at each the XML before
 * the plain text, since the XML is an RFC's definitive form.
 *
 * @param n the RFC's number
 * @param contractPath the contract's own path
 * @param root the root whose rfcs/ is searched last
 * @returns the candidate paths, in the order they are tried
 */
export const sourceRfcPlaces = (n: i32, contractPath: string, root: string): string[] => {
  const here = dirname(contractPath)
  const out: string[] = []
  for (const d of [here, joinPath(here, "../rfcs"), joinPath(root, "rfcs")]) {
    out.push(joinPath(d, `rfc${n}.xml`))
    out.push(joinPath(d, `rfc${n}.txt`))
  }
  return out
}

/** Whether a reader reads `path`: it ends with one of `exts`. */
const sourceReadable = (path: string, exts: string[]): boolean => {
  for (const e of exts) {
    if (path.endsWith(e)) {
      return true
    }
  }
  return false
}

/**
 * The file a source is read from, before it is judged: its `path` beside the
 * contract, else the first of sourceRfcPlaces that exists and that a reader
 * reads (so an rfc<n>.xml with no XML reader falls back to the .txt),
 * preferring the one its recorded `file` names exactly, then one with that
 * file's name (an rfc<n>.xml added later must not displace the file the
 * contract was checked against).
 *
 * @param decl the source
 * @param contractPath the contract's own path
 * @param root the root whose rfcs/ is searched last
 * @param exts the extensions a reader is registered for, with their dots
 * @returns `Ok` with the path to read, or `Err` when a name is refused
 *   (sourceNameProblem), the RFC is on disk nowhere, or it names nothing
 */
export const sourceCandidate = (
  decl: SourceDecl,
  contractPath: string,
  root: string,
  exts: string[],
): Result<string, string> => {
  const file = decl.file
  if (file !== null) {
    const problem = sourceNameProblem(file)
    if (problem !== null) {
      return Err(`source ${decl.id}: file: ${problem}`)
    }
  }
  const path = decl.path
  if (path !== null) {
    const problem = sourceNameProblem(path)
    if (problem !== null) {
      return Err(`source ${decl.id}: path: ${problem}`)
    }
    return Ok(joinPath(dirname(contractPath), path))
  }
  if (decl.rfc >= 1) {
    const recorded = file !== null ? basename(file) : ""
    let first = ""
    let named = ""
    for (const f of sourceRfcPlaces(decl.rfc, contractPath, root)) {
      if (!sourceReadable(f, exts) || !(sourceExists(f) || sourceIsLink(f))) {
        continue
      }
      if (file !== null) {
        const real = realpathSync(f)
        const label: string | null = real !== null ? sourceLabel(real, contractPath, root) : null
        if (label !== null && label === file) {
          return Ok(f)
        }
      }
      if (named.length === 0 && basename(f) === recorded) {
        named = f
      }
      if (first.length === 0) {
        first = f
      }
    }
    if (named.length > 0) {
      return Ok(named)
    }
    if (first.length > 0) {
      return Ok(first)
    }
    return Err(`rfc${decl.rfc} not found; fetch it: ${sourceFetchHint(decl.rfc)}`)
  }
  return Err(`source ${decl.id}: names no rfc or path`)
}

/**
 * The directories a contract may read spec text under: its own (real)
 * directory, and specs/ and rfcs/ of that directory's parent, of its
 * grandparent, and of the root, leaving out any specs/ or rfcs/ that is a
 * symbolic link.
 *
 * @param contractPath the contract's own path
 * @param root the root whose specs/ and rfcs/ are allowed too
 * @returns real absolute directories
 */
export const sourceRoots = (contractPath: string, root: string): string[] => {
  const here = sourceHere(contractPath)
  const out: string[] = [here]
  for (const r of [joinPath(here, ".."), joinPath(here, "../.."), root]) {
    const real = realpathSync(r)
    if (real === null) {
      continue
    }
    for (const d of sourceSpecDirs()) {
      const dir = joinPath(real, d)
      if (!sourceIsLink(dir) && out.indexOf(dir) < 0) {
        out.push(dir)
      }
    }
  }
  return out
}

/**
 * Why a contract may not read the file at `real` (a resolved path) as a
 * source: it is under none of sourceRoots, or a directory below its root
 * starts with "." (.git, .ssh).
 *
 * @param decl the source, which names itself in the message
 * @param shown how the message names the file
 * @param real the resolved path to judge
 * @param contractPath the contract's own path
 * @param root the root whose specs/ and rfcs/ are allowed too
 * @returns the problem, or null when it is spec text
 */
export const sourcePathProblem = (
  decl: SourceDecl,
  shown: string,
  real: string,
  contractPath: string,
  root: string,
): string | null => {
  for (const r of sourceRoots(contractPath, root)) {
    const rel = sourceBelow(r, real)
    if (rel !== null && !rel.startsWith(".") && rel.indexOf("/.") < 0) {
      return null
    }
  }
  return `source ${decl.id} is ${shown}, which is not spec text: a contract may read sources only beside it or under specs/ or rfcs/, and not in a hidden directory or through a symlinked specs/ or rfcs/`
}

/**
 * How a source's `file` names the file at `real`: its path under specs/ or
 * rfcs/ of the root or of the contract's directory or an ancestor, the
 * shortest such (rfcs/rfc4648.txt wherever the contract sits); else, for a
 * file below the contract's directory, its path from the directory holding
 * that one (contracts/x.txt).
 *
 * @param real the resolved path of the file read
 * @param contractPath the contract's own path
 * @param root the root whose specs/ and rfcs/ name files too
 * @returns the label, or null when no `file` can name it
 */
export const sourceLabel = (real: string, contractPath: string, root: string): string | null => {
  const here = sourceHere(contractPath)
  const roots: string[] = []
  const realRoot = realpathSync(root)
  if (realRoot !== null) {
    roots.push(realRoot)
  }
  let d = here
  while (true) {
    roots.push(d)
    const up = dirname(d)
    if (up === d || up.length === 0 || up === ".") {
      break
    }
    d = up
  }
  let best: string | null = null
  for (const r of roots) {
    const rel = sourceBelow(r, real)
    if (rel === null) {
      continue
    }
    for (const dir of sourceSpecDirs()) {
      if (rel.startsWith(`${dir}/`) && (best === null || rel.length < best.length)) {
        best = rel
      }
    }
  }
  if (best !== null) {
    return best
  }
  if (sourceBelow(here, real) !== null) {
    return sourceBelow(dirname(here), real)
  }
  return null
}

/** A source file's bytes as read, and where. */
export class SourceRead {
  /** The resolved path of the file the descriptor held. */
  real: string
  /** Its text. */
  text: string
  /** The SHA-256 of its bytes, lower-case hex. */
  sha256: string
  /**
   * Makes a read.
   *
   * @param real the resolved path
   * @param text its text
   * @param sha256 the SHA-256 of its bytes
   */
  constructor(real: string, text: string, sha256: string) {
    this.real = real
    this.text = text
    this.sha256 = sha256
  }
}

/** Reads all of `fd`, at most SOURCE_MAX_BYTES; `name` names it in errors. */
const sourceReadFd = (fd: i32, name: string): Result<u8[], string> => {
  const size = fileSize(fd)
  if (size < 0) {
    return Err(`cannot read ${name}`)
  }
  if (size > SOURCE_MAX_BYTES) {
    return Err(`${name} is ${size} bytes, more than a source may be (${SOURCE_MAX_BYTES})`)
  }
  const n = toI32(size)
  const buf: u8[] = new Array<u8>(n)
  let got = 0
  while (got < n) {
    const k = fileReadAt(fd, buf, got, n - got, toI64(got))
    if (k < 0) {
      return Err(`cannot read ${name} (errno ${-k})`)
    }
    if (k === 0) {
      break
    }
    got = got + k
  }
  if (got !== n) {
    return Err(`${name} changed while it was being read`)
  }
  return Ok(buf)
}

/**
 * Reads a source's file if it is spec text (sourcePathProblem). The path is
 * judged once resolved, opened, and judged again as the file the descriptor
 * holds (/proc/self/fd), and the bytes are read from that descriptor, so a
 * link or directory swapped in between cannot change what is read. A FIFO, a
 * device or a directory is refused before a byte is read.
 *
 * @param decl the source
 * @param candidate the path to read (sourceCandidate)
 * @param contractPath the contract's own path
 * @param root the root whose specs/ and rfcs/ are allowed too
 * @returns `Ok` with what was read, or `Err` with why it was not
 */
export const sourceReadConfined = (
  decl: SourceDecl,
  candidate: string,
  contractPath: string,
  root: string,
): Result<SourceRead, string> => {
  const shown = decl.path ?? candidate
  const real = realpathSync(candidate)
  if (real === null) {
    return Err(`source ${decl.id}: ${shown}: no such file`)
  }
  const before = sourcePathProblem(decl, shown, real, contractPath, root)
  if (before !== null) {
    return Err(before)
  }
  const fd = fileOpen(real)
  if (fd < 0) {
    if (fd === -21) {
      return Err(`source ${decl.id}: ${shown}: a directory, not a file`)
    }
    if (fd === -22) {
      return Err(`source ${decl.id}: ${shown}: not a regular file`)
    }
    return Err(`source ${decl.id}: cannot read ${shown} (errno ${-fd})`)
  }
  const opened = realpathSync(`/proc/self/fd/${fd}`)
  if (opened === null) {
    fileClose(fd)
    return Err(`source ${decl.id}: cannot tell which file ${shown} opened`)
  }
  const after = sourcePathProblem(decl, shown, opened, contractPath, root)
  if (after !== null) {
    fileClose(fd)
    return Err(after)
  }
  const bytes = sourceReadFd(fd, shown)
  fileClose(fd)
  if (bytes.isErr()) {
    return Err(`source ${decl.id}: ${bytes.error}`)
  }
  const b = bytes.value
  return Ok(new SourceRead(opened, String.fromBytes(b, 0, b.length), toHex(sha256(b))))
}
