/**
 * Throwaway git repositories for the `spec/pr` tests, made under a temp
 * directory the test made itself.
 */

import { dirname, makeTempDir, mkdirAll } from "../../../src/core/fs"
import { runProcess } from "../../../src/core/process"

/**
 * Runs git in `dir` for a test, with a fixed identity and no user config.
 *
 * @param dir the repository
 * @param args git's arguments
 * @returns its standard output, or `Err` when it fails
 */
export const prTestGit = (dir: string, args: string[]): Result<string, string> => {
  const argv: string[] = [
    "env",
    "GIT_CONFIG_GLOBAL=/dev/null",
    "GIT_CONFIG_NOSYSTEM=1",
    "GIT_AUTHOR_NAME=t",
    "GIT_AUTHOR_EMAIL=t@example.invalid",
    "GIT_COMMITTER_NAME=t",
    "GIT_COMMITTER_EMAIL=t@example.invalid",
    "git",
    "-C",
    dir,
  ]
  for (const a of args) {
    argv.push(a)
  }
  const r = runProcess(argv, "", 30000).orReturn()
  if (r.status !== 0) {
    return Err(`git ${args.join(" ")}: ${r.stderr}`)
  }
  return Ok(r.stdout)
}

/**
 * Writes `text` to `dir/rel`, making its directories.
 *
 * @param dir the repository
 * @param rel the path inside it
 * @param text the file's text
 * @returns `Ok(true)`, or `Err` when it cannot be written
 */
export const prTestWrite = (dir: string, rel: string, text: string): Result<boolean, string> => {
  const path = `${dir}/${rel}`
  mkdirAll(dirname(path), 0o755).orReturn()
  writeFileSync(path, text)
  return Ok(true)
}

/**
 * Commits everything in `dir`.
 *
 * @param dir the repository
 * @param message the commit message
 * @returns `Ok(true)`, or `Err` when git fails
 */
export const prTestCommit = (dir: string, message: string): Result<boolean, string> => {
  prTestGit(dir, ["add", "-A"]).orReturn()
  prTestGit(dir, ["commit", "-q", "--no-gpg-sign", "-m", message]).orReturn()
  return Ok(true)
}

/**
 * Makes a temp directory holding a new repository on branch `main`.
 *
 * @param prefix the temp directory's name prefix
 * @returns the repository's directory, which the test removes
 */
export const prTestRepo = (prefix: string): Result<string, string> => {
  const dir = makeTempDir(prefix).orReturn()
  prTestGit(dir, ["init", "-q", "-b", "main"]).orReturn()
  return Ok(dir)
}

/**
 * Removes a directory a test made.
 *
 * @param dir the directory
 */
export const prTestRemove = (dir: string): void => {
  const r = runProcess(["rm", "-rf", "--", dir], "", 10000)
  if (r.isErr()) {
    console.log(`cannot remove ${dir}: ${r.error}`)
  }
}
