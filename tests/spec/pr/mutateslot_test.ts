import { Suite } from "nish/testing"
import { replaceAll } from "nish/text"
import { makeTempDir } from "../../../src/core/fs"
import { runProcess } from "../../../src/core/process"
import { vectorRun } from "../../../src/index"
import { MutateRun, mutateCheck } from "../../../src/spec/pr/mutaterun"
import { runWriteInside } from "../../../src/spec/run/run"
import { prTestCommit, prTestGit, prTestRemove, prTestRepo, prTestWrite } from "./repo"

/**
 * A stub compiler: fails with no error located when the slot's module is a
 * symlink (so the copy must hold a file of its own), refuses a module holding
 * the canary, and otherwise links a "binary" that runs the test as a shell
 * script from the root.
 */
const MUTATESLOT_TEST_NISH: string = `#!/bin/sh
root=$(cd "$(dirname "$0")/.." && pwd)
if [ -L "$root/std/m.ts" ]; then
  echo "the slot's module is a symlink" >&2
  exit 3
fi
if grep -rq 'canary' "$root/std"; then
  printf '%s/std/m.ts:1:1: error: refused\\n1 error\\n' "$root" >&2
  exit 1
fi
printf '#!/bin/sh\\ncd "%s" && exec sh "%s"\\n' "$root" "$1" > "$3"
chmod +x "$3"
`

/** The module at the base. */
const MUTATESLOT_TEST_BEFORE: string = "export const old = (): i32 => 1\n"

/** The module the change makes: one relational and one integer site. */
const MUTATESLOT_TEST_AFTER: string = `export const old = (): i32 => 1
export const lt = (a: i32, b: i32): boolean => a < b
export const k = (): i32 => 7
`

/** A contract on nish/MODULE, testing lt and k. */
const MUTATESLOT_TEST_CONTRACT: string = `{
  "contract": "c1",
  "source": {"title": "T", "rfc": 4648},
  "target": {"module": "nish/MODULE"},
  "requirements": [{"id": "R1", "section": "3.1", "level": "MUST", "quote": "Q"}],
  "functions": [
    {"name": "lt", "params": [], "returns": "bool"},
    {"name": "k", "params": [], "returns": "i32"}
  ],
  "clauses": [
    {"kind": "vector", "id": "V1", "title": "t", "covers": ["R1"],
     "source": {"cite": {"section": "10"}}, "call": "k", "args": [], "expect": {"int": 7}}
  ]
}
`

/** What one run on a checkout with a link in it did. */
class MutateslotOutcome {
  /** The exit status of `vector spec mutate`. */
  code: i32
  /** mutateCheck's refusal, or "" when it returned a report. */
  error: string
  /** Whether the file the link reaches holds what it held before both runs. */
  intact: boolean

  /**
   * Makes an outcome.
   *
   * @param code the exit status
   * @param error the refusal, or ""
   * @param intact whether the link's target is unchanged
   */
  constructor(code: i32, error: string, intact: boolean) {
    this.code = code
    this.error = error
    this.intact = intact
  }
}

/** Runs `argv`, failing on a non-zero exit. */
const mutateslotTestRun = (argv: string[]): Result<boolean, string> => {
  const r = runProcess(argv, "", 10000).orReturn()
  return r.status === 0 ? Ok(true) : Err(`${argv.join(" ")} exits ${r.status}: ${r.stderr}`)
}

/**
 * A nish checkout whose module `std/<module>.ts` gains lines in a commit,
 * then has `link` (a path from the root, the module or a directory above it)
 * moved out of the checkout and replaced by a symlink to where it went. The
 * index is told the module is unchanged, as a sparse or `skip-worktree`
 * checkout is, so git still reports the change's lines. `spec mutate --nish`
 * runs on it twice, through `vectorRun` and through mutateCheck.
 */
const mutateslotTestWith = (module: string, link: string): Result<MutateslotOutcome, string> => {
  const dir = prTestRepo("vector-mutateslot-").orReturn()
  const away = makeTempDir("vector-mutateslot-away-").orReturn()
  const file = `nish/std/${module}.ts`
  prTestWrite(dir, file, MUTATESLOT_TEST_BEFORE).orReturn()
  prTestWrite(dir, "nish/bin/nish", MUTATESLOT_TEST_NISH).orReturn()
  mutateslotTestRun(["chmod", "+x", "--", `${dir}/nish/bin/nish`]).orReturn()
  prTestCommit(dir, "base").orReturn()
  prTestGit(dir, ["checkout", "-q", "-b", "work"]).orReturn()
  prTestWrite(dir, file, MUTATESLOT_TEST_AFTER).orReturn()
  prTestCommit(dir, "work").orReturn()
  prTestGit(dir, ["update-index", "--skip-worktree", "--", file]).orReturn()
  prTestWrite(dir, "t.sh", "grep -q 'a < b' std/m.ts std/sub/m.ts 2>/dev/null || exit 1\nexit 0\n").orReturn()
  prTestWrite(dir, "c.json", replaceAll(MUTATESLOT_TEST_CONTRACT, "MODULE", module)).orReturn()
  if (link !== "") {
    mutateslotTestRun(["mv", "--", `${dir}/nish/${link}`, `${away}/target`]).orReturn()
    mutateslotTestRun(["ln", "-s", "--", `${away}/target`, `${dir}/nish/${link}`]).orReturn()
  }
  const before = readFileSyncOrNull(`${dir}/${file}`)
  const root = `${dir}/nish`
  const code = vectorRun([
    "spec",
    "mutate",
    `${dir}/c.json`,
    "--nish-root",
    root,
    "--nish",
    "bin/nish",
    "--test",
    `${dir}/t.sh`,
    "--base",
    "main",
  ])
  const checked = mutateCheck(`${dir}/c.json`, "main", new MutateRun(root, "", "bin/nish", `${dir}/t.sh`, 1, 20000), 0)
  const after = readFileSyncOrNull(`${dir}/${file}`)
  const intact = (before ?? "") === MUTATESLOT_TEST_AFTER && (after ?? "") === MUTATESLOT_TEST_AFTER
  prTestRemove(dir)
  prTestRemove(away)
  return Ok(new MutateslotOutcome(code, checked.isErr() ? checked.error : "", intact))
}

/** One row: the module, the link, and what the run must do. */
class MutateslotRow {
  /** What the row checks. */
  name: string
  /** The module, from std/, without `.ts`. */
  module: string
  /** The path from the root made a symlink, or "" for none. */
  link: string
  /** The exit status the command must have. */
  code: i32
  /** The refusal mutateCheck must give, or "" for a report. */
  error: string

  /**
   * Makes a row.
   *
   * @param name what it checks
   * @param module the module
   * @param link the path made a link
   * @param code the exit status
   * @param error the refusal
   */
  constructor(name: string, module: string, link: string, code: i32, error: string) {
    this.name = name
    this.module = module
    this.link = link
    this.code = code
    this.error = error
  }
}

/** The refusal for `part`, a symlink on the way to `module`. */
const mutateslotTestRefusal = (part: string, module: string): string =>
  `${part} is a symlink, which the module std/${module}.ts would write through`

/** runWriteInside on a linked directory and a linked file. */
const mutateslotTestWrite = (t: Suite): Result<boolean, string> => {
  const dir = makeTempDir("vector-mutateslot-write-").orReturn()
  const away = makeTempDir("vector-mutateslot-write-away-").orReturn()
  prTestWrite(away, "a.ts", "kept\n").orReturn()
  mutateslotTestRun(["ln", "-s", "--", away, `${dir}/linked`]).orReturn()
  mutateslotTestRun(["ln", "-s", "--", `${away}/a.ts`, `${dir}/file.ts`]).orReturn()
  const refused = runWriteInside(dir, ["plain/x.ts", "linked/a.ts"], ["x\n", "y\n"], "here", "the file")
  t.eqStr(
    "a linked directory is refused",
    refused.isErr() ? refused.error : "<ok>",
    "here: linked is a symlink, which the file linked/a.ts would write through",
  )
  t.ok("before anything is written", readFileSyncOrNull(`${dir}/plain/x.ts`) === null)
  t.ok("and the link's target is kept", (readFileSyncOrNull(`${away}/a.ts`) ?? "<none>") === "kept\n")
  const written = runWriteInside(dir, ["plain/x.ts", "file.ts"], ["x\n", "y\n"], "here", "the file")
  t.ok("a linked file is written afresh", written.isOk())
  t.ok("in its place", (readFileSyncOrNull(`${dir}/file.ts`) ?? "<none>") === "y\n")
  t.ok("leaving its target alone", (readFileSyncOrNull(`${away}/a.ts`) ?? "<none>") === "kept\n")
  t.ok("a new directory is made", (readFileSyncOrNull(`${dir}/plain/x.ts`) ?? "<none>") === "x\n")
  prTestRemove(dir)
  prTestRemove(away)
  return Ok(true)
}

/**
 * Runs spec mutate on checkouts with a link in them, and runWriteInside on
 * linked directories and files.
 *
 * @returns the suite's exit status
 */
export const main = (): i32 => {
  const t = new Suite("spec/pr mutateslot")
  const rows: MutateslotRow[] = [
    new MutateslotRow("no link: the survivor k is found", "m", "", 1, ""),
    new MutateslotRow("a symlinked std/ is refused", "m", "std", 2, mutateslotTestRefusal("std", "m")),
    new MutateslotRow(
      "a link deeper than std/ is refused",
      "sub/m",
      "std/sub",
      2,
      mutateslotTestRefusal("std/sub", "sub/m"),
    ),
    new MutateslotRow(
      "a link above a deeper module is refused",
      "sub/m",
      "std",
      2,
      mutateslotTestRefusal("std", "sub/m"),
    ),
    new MutateslotRow("the module itself a link: rewritten in the copy, not refused", "m", "std/m.ts", 1, ""),
  ]
  for (const row of rows) {
    const o = mutateslotTestWith(row.module, row.link)
    if (o.isErr()) {
      t.fail(`${row.name}: the checkout is built`, o.error)
      continue
    }
    t.ok(`${row.name}: exits ${row.code}`, o.value.code === row.code)
    t.ok(`${row.name}: the file the link reaches is unchanged`, o.value.intact)
    if (row.error === "") {
      t.eqStr(`${row.name}: a report`, o.value.error, "")
    } else {
      t.ok(`${row.name}: says which part is a link (${o.value.error})`, o.value.error.endsWith(row.error))
    }
  }

  const w = mutateslotTestWrite(t)
  if (w.isErr()) {
    t.fail("the linked directory is built", w.error)
  }
  return t.done()
}
