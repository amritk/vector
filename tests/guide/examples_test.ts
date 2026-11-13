/**
 * Runs every shell example in the guide (docs/guide/**.md) and the README
 * against dist/vector, and checks what it prints and how it exits.
 *
 * An example is a ```sh or ```bash fence. Its expected output is the next
 * fence on the page when that is a ```text fence (prose may sit between);
 * with none, it must print nothing. Its stdout and stderr are read together.
 * A comment on the line before the fence (blank lines aside) marks it:
 *
 *   <!-- exit 1 -->         it must exit 1 (the default is 0)
 *   <!-- illustrative -->   it is not run, and neither is its output checked
 *
 * An expected output whose last line is `…` alone need only start the actual
 * output. The workspace's own path prints as /path/to/vector, and trailing
 * spaces and blank lines are ignored.
 *
 * Each page runs in a fresh workspace: a copy of the repository's files (as
 * git sees the working tree), with the built dist/vector copied in and .nish
 * and .z3 linked, committed once as `base`. A page's examples run in order in
 * that one directory, so a later example sees what an earlier one did.
 */

import { Suite } from "nish/testing"
import { replaceAll, splitLines, trim, trimEnd } from "nish/text"
import { dirname, joinPath, makeTempDir } from "../../src/core/fs"
import { ProcessResult, runProcess } from "../../src/core/process"

/** How long one example may run. */
const GUIDE_TIMEOUT_MS: i32 = 60000

/** What the workspace's own path prints as. */
const GUIDE_ROOT_SHOWN: string = "/path/to/vector"

/** One shell example on a page. */
class GuideExample {
  /** The line of its opening fence, from 1. */
  line: i32
  /** The commands. */
  script: string
  /** The output it must print. */
  expected: string
  /** The status it must exit with. */
  exit: i32
  /** Whether it is shown only, never run. */
  illustrative: boolean

  constructor(line: i32, script: string, exit: i32, illustrative: boolean) {
    this.line = line
    this.script = script
    this.expected = ""
    this.exit = exit
    this.illustrative = illustrative
  }
}

/** Single-quotes `s` for sh. */
const guideQuote = (s: string): string => {
  const parts: string[] = []
  let start = 0
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 39) {
      parts.push(s.substring(start, i))
      parts.push("'\\''")
      start = i + 1
    }
  }
  parts.push(s.substring(start))
  return `'${parts.join("")}'`
}

/** The examples on a page, in order. */
const guideExamples = (text: string): GuideExample[] => {
  const lines = splitLines(text)
  const out: GuideExample[] = []
  let exit = 0
  let illustrative = false
  // The example still waiting for its output fence, as an index into `out`.
  let open = -1
  let i = 0
  while (i < lines.length) {
    const line = trimEnd(lines[i])
    if (line.startsWith("```")) {
      const lang = trim(line.substring(3))
      const body: string[] = []
      let j = i + 1
      while (j < lines.length && trimEnd(lines[j]) !== "```") {
        body.push(lines[j])
        j++
      }
      if (lang === "sh" || lang === "bash") {
        out.push(new GuideExample(i + 1, body.join("\n"), exit, illustrative))
        open = out.length - 1
      } else {
        if (lang === "text" && open >= 0) {
          out[open].expected = body.join("\n")
        }
        open = -1
      }
      exit = 0
      illustrative = false
      i = j + 1
      continue
    }
    const t = trim(line)
    if (t === "<!-- illustrative -->") {
      illustrative = true
    } else if (t.startsWith("<!-- exit ") && t.endsWith(" -->")) {
      exit = toI32(Number(t.substring(10, t.length - 4)))
    } else if (t !== "") {
      exit = 0
      illustrative = false
    }
    i++
  }
  return out
}

/** `text` as compared: the workspace path replaced, trailing spaces and blank lines dropped. */
const guideNormal = (text: string, ws: string): string => {
  const lines: string[] = []
  for (const l of splitLines(replaceAll(text, ws, GUIDE_ROOT_SHOWN))) {
    lines.push(trimEnd(l))
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop()
  }
  return lines.join("\n")
}

/** Whether `actual` is what `expected` says, `…` ending it as a prefix. */
const guideMatches = (expected: string, actual: string): boolean => {
  if (expected === "…") {
    return true
  }
  if (expected.endsWith("\n…")) {
    return actual.startsWith(expected.substring(0, expected.length - "…".length))
  }
  return expected === actual
}

/** Runs `script` in `dir` with sh, stderr folded into stdout. */
const guideRun = (dir: string, script: string): Result<ProcessResult, string> =>
  runProcess(["sh", "-c", `cd ${guideQuote(dir)} || exit 99\nexec 2>&1\n${script}`], "", GUIDE_TIMEOUT_MS)

/** Makes a fresh workspace from the repository at `root`, and answers its path. */
const guideWorkspace = (root: string): Result<string, string> => {
  const tmp = makeTempDir("vector-guide-").orReturn()
  const ws = joinPath(tmp, "vector")
  const setup = [
    "set -e",
    `cd ${guideQuote(root)}`,
    `mkdir ${guideQuote(ws)}`,
    `git ls-files -z --cached --others --exclude-standard | tar -c --null -T - -f - | tar -x -C ${guideQuote(ws)}`,
    `cd ${guideQuote(ws)}`,
    "mkdir dist",
    `cp ${guideQuote(joinPath(root, "dist/vector"))} dist/vector`,
    `ln -s ${guideQuote(joinPath(root, ".nish"))} .nish`,
    `ln -s ${guideQuote(joinPath(root, ".z3"))} .z3`,
    "git init -q",
    "git add -A",
    "git commit -qm base",
  ].join("\n")
  const r = runProcess(["sh", "-c", `${GUIDE_GIT_ENV}\n${setup} 2>&1`], "", GUIDE_TIMEOUT_MS).orReturn()
  if (r.status !== 0) {
    return Err(`cannot make a workspace: ${r.stdout}`)
  }
  return Ok(ws)
}

/** The identity every git commit in a workspace is made under, and no user config. */
const GUIDE_GIT_ENV: string =
  "export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 GIT_AUTHOR_NAME=guide GIT_AUTHOR_EMAIL=guide@example.invalid GIT_COMMITTER_NAME=guide GIT_COMMITTER_EMAIL=guide@example.invalid"

/** Every markdown file under `dir`, sorted. */
const guidePages = (dir: string, out: string[]): void => {
  const names = readdirSync(dir)
  if (names === null) {
    return
  }
  for (const name of names) {
    const path = joinPath(dir, name)
    if (isDirectorySync(path)) {
      guidePages(path, out)
    } else if (name.endsWith(".md")) {
      out.push(path)
    }
  }
}

/** Checks every example on one page. */
const guideCheckPage = (t: Suite, root: string, page: string): void => {
  const text = readFileSyncOrNull(joinPath(root, page))
  if (text === null) {
    t.fail(page, "cannot read it")
    return
  }
  const examples = guideExamples(text)
  let ws = ""
  for (const ex of examples) {
    const name = `${page}:${ex.line}`
    if (ex.illustrative) {
      t.skip(name, "illustrative")
      continue
    }
    if (ws === "") {
      const made = guideWorkspace(root)
      if (made.isErr()) {
        t.fail(name, made.error)
        return
      }
      ws = made.value
    }
    const r = guideRun(ws, `${GUIDE_GIT_ENV}\n${ex.script}`)
    if (r.isErr()) {
      t.fail(name, r.error)
      continue
    }
    const actual = guideNormal(r.value.stdout, ws)
    const expected = guideNormal(ex.expected, ws)
    if (r.value.timedOut) {
      t.fail(name, `ran past ${GUIDE_TIMEOUT_MS} ms:\n${actual}`)
    } else if (r.value.status !== ex.exit) {
      t.fail(name, `exit ${r.value.status}, want ${ex.exit}:\n${actual}`)
    } else if (!guideMatches(expected, actual)) {
      t.fail(name, `output differs:\n--- want\n${expected}\n--- got\n${actual}`)
    } else {
      t.pass(name)
    }
  }
  if (ws !== "") {
    const removed = runProcess(["rm", "-rf", dirname(ws)], "", GUIDE_TIMEOUT_MS)
    if (removed.isErr() || removed.value.status !== 0) {
      t.fail(`${page}: clean up`, `cannot remove ${ws}`)
    }
  }
}

/** Checks every example, page by page. */
export const main = (): i32 => {
  const t = new Suite("guide examples")
  const root = realpathSync(".")
  if (root === null || !isExecutableSync(joinPath(root, "dist/vector"))) {
    t.fail("dist/vector", "no dist/vector: run npm run build")
    return t.done()
  }
  const pages: string[] = ["README.md"]
  guidePages(joinPath(root, "docs/guide"), pages)
  for (const p of pages) {
    guideCheckPage(t, root, p.startsWith(`${root}/`) ? p.substring(root.length + 1) : p)
  }
  return t.done()
}
