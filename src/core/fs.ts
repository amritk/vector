/**
 * `core/fs` — paths and directories: join, dirname, a recursive mkdir and
 * fresh temporary directories. Paths are `/`-separated strings.
 */

import { toHex } from "./hex"

/**
 * Joins two path parts with one `/` between them. An absolute `b` replaces `a`,
 * and an empty part is dropped.
 *
 * @param a the leading part
 * @param b the trailing part
 * @returns the joined path
 */
export const joinPath = (a: string, b: string): string => {
  if (b.startsWith("/") || a.length === 0) {
    return b
  }
  if (b.length === 0) {
    return a
  }
  return a.endsWith("/") ? `${a}${b}` : `${a}/${b}`
}

/**
 * The directory part of a path, as POSIX `dirname` answers it: "." for a bare
 * name and "/" for a file at the root.
 *
 * @param path the path to cut
 * @returns everything before the last `/`, without trailing slashes
 */
export const dirname = (path: string): string => {
  let end = toI32(path.length)
  while (end > 1 && path.charCodeAt(end - 1) === 47) {
    end = end - 1
  }
  // `after` is one past the last `/` before `end`, or 0 when there is none.
  let after = end
  while (after > 0 && path.charCodeAt(after - 1) !== 47) {
    after = after - 1
  }
  if (after <= 0) {
    return "."
  }
  let i = after - 1
  while (i > 0 && path.charCodeAt(i - 1) === 47) {
    i = i - 1
  }
  return i === 0 ? "/" : path.substring(0, i)
}

/**
 * The last part of a path, as POSIX `basename` answers it: trailing slashes
 * are dropped, and a path of only slashes is "/". An empty path gives "".
 *
 * @param path the path to cut
 * @returns everything after the last `/`
 */
export const basename = (path: string): string => {
  let end = toI32(path.length)
  while (end > 1 && path.charCodeAt(end - 1) === 47) {
    end = end - 1
  }
  // end === 1 implies a non-empty path; the length test lets the read be proven.
  if (end === 1 && path.length > 0 && path.charCodeAt(0) === 47) {
    return "/"
  }
  // `after` is one past the last `/` before `end`, or 0 when there is none.
  let after = end
  while (after > 0 && path.charCodeAt(after - 1) !== 47) {
    after = after - 1
  }
  return path.substring(after, end)
}

/** Adds `part` to `out` unless it is empty or `.`. */
const fsKeepPart = (out: string[], part: string): void => {
  if (part.length > 0 && part !== ".") {
    out.push(part)
  }
}

/** A path's parts between slashes, with empty and `.` parts dropped. */
const fsParts = (path: string): string[] => {
  const out: string[] = []
  let start = 0
  for (let i = 0; i < toI32(path.length); i++) {
    if (path.charCodeAt(i) === 47) {
      fsKeepPart(out, path.substring(start, i))
      start = i + 1
    }
  }
  fsKeepPart(out, path.substring(start, toI32(path.length)))
  return out
}

/**
 * The path that leads from directory `from` to `to`, as a relative import
 * spells it: starting `./` or `../`. Both must be absolute and free of `..`
 * parts, as `realpathSync` answers them; nothing on disk is read.
 *
 * @param from the directory to start from
 * @param to the path to reach
 * @returns `./<path>` when `to` is at or below `from`, else `../` once per
 *   part of `from` to climb, then the rest of `to`
 */
export const relativePath = (from: string, to: string): string => {
  const a = fsParts(from)
  const b = fsParts(to)
  let same = 0
  while (same < a.length && same < b.length && a[same] === b[same]) {
    same = same + 1
  }
  const parts: string[] = []
  for (let i = same; i < a.length; i++) {
    parts.push("..")
  }
  for (let i = same; i < b.length; i++) {
    parts.push(b[i])
  }
  if (parts.length === 0) {
    return "."
  }
  // parts is not empty here; the length test lets the read be proven.
  return parts.length > 0 && parts[0] === ".." ? parts.join("/") : `./${parts.join("/")}`
}

/**
 * Makes a directory and every missing parent, like `mkdir -p`.
 *
 * @param path the directory to make
 * @param mode the permission bits for each directory it makes
 * @returns `Ok(true)` when the directory exists afterwards, or `Err` naming
 *   the part that could not be made
 */
export const mkdirAll = (path: string, mode: i32): Result<boolean, string> => {
  if (isDirectorySync(path)) {
    return Ok(true)
  }
  const parent = dirname(path)
  if (parent !== path) {
    const made = mkdirAll(parent, mode)
    if (made.isErr()) {
      return made
    }
  }
  const status = mkdirSyncMode(path, mode)
  if (status === 0 || isDirectorySync(path)) {
    return Ok(true)
  }
  return Err(`cannot make directory ${path} (errno ${-toI64(status)})`)
}

/**
 * Makes a new, empty directory only the current user can read, under
 * `$TMPDIR` (or `/tmp`), with a random name that starts with `prefix`.
 *
 * @param prefix the start of the directory's name, such as "vector-"
 * @returns `Ok` with the directory's path, or `Err` when none could be made
 */
export const makeTempDir = (prefix: string): Result<string, string> => {
  const env = getenv("TMPDIR")
  const root = env === null || env.length === 0 ? "/tmp" : env
  const bytes: u8[] = new Array<u8>(8)
  for (let attempt = 0; attempt < 16; attempt++) {
    crypto.getRandomValues(bytes)
    const path = joinPath(root, `${prefix}${toHex(bytes)}`)
    const status = mkdirSyncMode(path, 0o700)
    if (status === 0) {
      return Ok(path)
    }
    if (status !== -17) {
      return Err(`cannot make a temporary directory in ${root} (errno ${-toI64(status)})`)
    }
  }
  return Err(`cannot find a free temporary directory name in ${root}`)
}
