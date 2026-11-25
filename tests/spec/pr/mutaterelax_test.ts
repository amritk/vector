import { Suite } from "nish/testing"
import { replaceAll } from "nish/text"
import { runProcess } from "../../../src/core/process"
import { vectorRun } from "../../../src/index"
import { prTestCommit, prTestGit, prTestRemove, prTestRepo, prTestWrite } from "./repo"

/**
 * A stub compiler. `--help` lists `--allow-panics` when STRICT is "yes". A
 * strict one refuses, with an error located in the module, any build not
 * given `--allow-panics`, as a nish holding the root package to no panic
 * refuses an emitted test; an older one refuses the flag as unknown. Either
 * refuses a module holding the canary, and otherwise links a "binary" that
 * runs the test, its first argument, as a shell script from the root.
 */
const MUTATERELAX_TEST_NISH: string = `#!/bin/sh
root=$(cd "$(dirname "$0")/.." && pwd)
if [ "$1" = "--help" ]; then
  echo "usage: nish <file.ts> [flags]"
  if [ "STRICT" = "yes" ]; then echo "  --allow-panics  hold only the noPanic list to no panic"; fi
  exit 0
fi
relaxed=no
for a in "$@"; do
  if [ "$a" = "--allow-panics" ]; then relaxed=yes; fi
  out=$a
done
if [ "STRICT" = "yes" ] && [ "$relaxed" = "no" ]; then
  printf '%s/std/m.ts:1:1: error: a call that may panic, in a module held to no panic\\n1 error\\n' "$root" >&2
  exit 1
fi
if [ "STRICT" != "yes" ] && [ "$relaxed" = "yes" ]; then
  echo "nish: unknown flag --allow-panics" >&2
  exit 2
fi
if grep -rq 'canary' "$root/std"; then
  printf '%s/std/m.ts:1:1: error: refused\\n1 error\\n' "$root" >&2
  exit 1
fi
printf '#!/bin/sh\\ncd "%s" && exec sh "%s"\\n' "$root" "$1" > "$out"
chmod +x "$out"
`

/** The module at the base. */
const MUTATERELAX_TEST_BEFORE: string = "export const old = (): i32 => 1\n"

/** The module the change makes: one relational and one integer site. */
const MUTATERELAX_TEST_AFTER: string = `export const old = (): i32 => 1
export const lt = (a: i32, b: i32): boolean => a < b
export const k = (): i32 => 7
`

/** A test that notices both mutants: it fails unless both sites are as written. */
const MUTATERELAX_TEST_SCRIPT: string =
  "grep -q 'a < b' std/m.ts || exit 1\ngrep -q '=> 7' std/m.ts || exit 1\nexit 0\n"

/** A contract on nish/m, testing lt and k. */
const MUTATERELAX_TEST_CONTRACT: string = `{
  "contract": "c1",
  "source": {"title": "T", "rfc": 4648},
  "target": {"module": "nish/m"},
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

/**
 * Runs `vector spec mutate --nish bin/nish` on a checkout whose module gains
 * two sites, with the stub compiler strict or not.
 *
 * @param strict whether the stub lists and requires `--allow-panics`
 * @returns the exit status
 */
const mutaterelaxTestWith = (strict: boolean): Result<i32, string> => {
  const dir = prTestRepo("vector-mutaterelax-").orReturn()
  prTestWrite(dir, "nish/std/m.ts", MUTATERELAX_TEST_BEFORE).orReturn()
  const nish = replaceAll(MUTATERELAX_TEST_NISH, "STRICT", strict ? "yes" : "no")
  prTestWrite(dir, "nish/bin/nish", nish).orReturn()
  const chmod = runProcess(["chmod", "+x", "--", `${dir}/nish/bin/nish`], "", 10000).orReturn()
  if (chmod.status !== 0) {
    return Err(`chmod: ${chmod.stderr}`)
  }
  prTestCommit(dir, "base").orReturn()
  prTestGit(dir, ["checkout", "-q", "-b", "work"]).orReturn()
  prTestWrite(dir, "nish/std/m.ts", MUTATERELAX_TEST_AFTER).orReturn()
  prTestCommit(dir, "work").orReturn()
  prTestWrite(dir, "t.sh", MUTATERELAX_TEST_SCRIPT).orReturn()
  prTestWrite(dir, "c.json", MUTATERELAX_TEST_CONTRACT).orReturn()
  const code = vectorRun([
    "spec",
    "mutate",
    `${dir}/c.json`,
    "--nish-root",
    `${dir}/nish`,
    "--nish",
    "bin/nish",
    "--test",
    `${dir}/t.sh`,
    "--base",
    "main",
  ])
  prTestRemove(dir)
  return Ok(code)
}

/** One row: the compiler, and the exit status `spec mutate` must have with it. */
class MutaterelaxRow {
  /** What the row checks. */
  name: string
  /** Whether the stub compiler lists and requires `--allow-panics`. */
  strict: boolean
  /** The exit status. */
  code: i32

  /**
   * Makes a row.
   *
   * @param name what it checks
   * @param strict whether the stub is strict
   * @param code the exit status
   */
  constructor(name: string, strict: boolean, code: i32) {
    this.name = name
    this.strict = strict
    this.code = code
  }
}

export const main = (): i32 => {
  const t = new Suite("spec mutate: --allow-panics, where the compiler has it")
  const rows: MutaterelaxRow[] = [
    new MutaterelaxRow("a compiler that holds the test to no panic builds it with --allow-panics", true, 0),
    new MutaterelaxRow("an older compiler, which has no --allow-panics, is not given it", false, 0),
  ]
  for (const row of rows) {
    const code = mutaterelaxTestWith(row.strict)
    if (code.isErr()) {
      t.ok(`${row.name}: the fixture is made (${code.error})`, false)
      continue
    }
    t.eqStr(`${row.name}: every mutant is killed, so it exits 0`, `${code.value}`, `${row.code}`)
  }
  return t.done()
}
