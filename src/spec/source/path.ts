/**
 * `spec/source/path` — where a contract's source is read from, and the
 * refusal of a path that reaches outside the repository.
 *
 * A source is found in one of three places: its `file` (relative to the
 * repository root), its `path` (relative to the contract's directory), or,
 * for an RFC given only by number, `rfcs/rfc<n>.txt` under the root. Wherever
 * it is, the file read is the one `realpathSync` resolves the name to, and
 * that must lie inside the root's own real path, so neither `..` nor a
 * symbolic link can read a file outside the repository. The resolved path is
 * the one returned and read, so the name is never resolved twice.
 */

import { dirname, joinPath } from "../../core/fs"
import { charsFirstControl } from "../contract/chars"
import { SourceDecl } from "../contract/types"

/**
 * Where an RFC is read from when its source gives only its number.
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

/**
 * The file a source names, before it is resolved: its `file` under the root,
 * else its `path` beside the contract, else its RFC under `rfcs/`.
 *
 * @param decl the source
 * @param contractPath the contract's own path
 * @param root the repository root
 * @returns `Ok` with the path to resolve, or `Err` when its name is refused
 *   (sourceNameProblem) or it names nothing
 */
export const sourceCandidate = (decl: SourceDecl, contractPath: string, root: string): Result<string, string> => {
  const file = decl.file
  if (file !== null) {
    const problem = sourceNameProblem(file)
    if (problem !== null) {
      return Err(`source ${decl.id}: file: ${problem}`)
    }
    return Ok(joinPath(root, file))
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
    return Ok(joinPath(root, sourceRfcFile(decl.rfc)))
  }
  return Err(`source ${decl.id}: names no rfc, path or file`)
}

/**
 * Resolves a path and refuses it unless it is a regular file inside the
 * root, both judged after every symbolic link is followed.
 *
 * @param root the repository root
 * @param candidate the path to resolve
 * @returns `Ok` with the resolved absolute path to read, or `Err` when it
 *   does not resolve, leaves the root, or is not a regular file
 */
export const sourceConfine = (root: string, candidate: string): Result<string, string> => {
  const realRoot = realpathSync(root)
  if (realRoot === null) {
    return Err(`cannot resolve the repository root ${root}`)
  }
  const real = realpathSync(candidate)
  if (real === null) {
    return Err(`${candidate}: no such file`)
  }
  const inside = realRoot === "/" ? real.startsWith("/") : real.startsWith(`${realRoot}/`)
  if (!inside) {
    return Err(
      `${candidate}: resolves to ${real}, outside the repository ${realRoot}; a source is read only from inside it`,
    )
  }
  const fd = fileOpen(real)
  if (fd < 0) {
    if (fd === -21) {
      return Err(`${candidate}: a directory, not a file`)
    }
    if (fd === -22) {
      return Err(`${candidate}: not a regular file`)
    }
    return Err(`cannot read ${candidate} (errno ${-fd})`)
  }
  fileClose(fd)
  return Ok(real)
}
