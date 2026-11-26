import { Suite } from "nish/testing"
import { replaceAll } from "nish/text"
import { makeTempDir } from "../../../src/core/fs"
import { runProcess } from "../../../src/core/process"
import { contractLoadFile } from "../../../src/spec/contract/contract"
import { Contract } from "../../../src/spec/contract/types"
import { RunRequest, runCommand } from "../../../src/spec/run/command"
import {
  RunOutcome,
  RunResult,
  runEscape,
  runFormatJson,
  runFormatMarkdown,
  runFormatText,
  runIsStdPath,
  runOutcomeName,
  runParse,
  runRemove,
  runTestCommand,
  runTranscript,
  runWriteInside,
} from "../../../src/spec/run/run"

/** A transcript in which every clause passed, ending with `nonce`'s end line, without its trailing newline. */
const guardsPass = (c: Contract, nonce: string): string => {
  const lines: string[] = []
  let bits = ""
  for (const k of c.clauses) {
    lines.push(`PASS  [${k.id}] ${k.title}`)
    bits = `${bits}1`
  }
  lines.push(`vector-done ${nonce} ${bits}`)
  return lines.join("\n")
}

const guardsProblems = (c: Contract, out: string, nonce: string): string[] =>
  runTranscript(c, out, nonce, runParse(c, out))

/** `n` copies of `s`. */
const guardsRepeat = (s: string, n: i32): string => {
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    out.push(s)
  }
  return out.join("")
}

/** The end line: its bits after the one space, the counts of end lines, and the first one being the one read. */
const guardsEnd = (t: Suite, c: Contract): void => {
  const nonce = "n0nce"
  const good = guardsPass(c, nonce)
  const bits = guardsRepeat("1", c.clauses.length)
  t.eqLines("the bits after the space are read whole", guardsProblems(c, good, nonce), guardsNone())
  t.eqLines("an end line with no bits records none", guardsProblems(c, replaceAll(good, ` ${bits}`, " "), nonce), [
    `the end line records 0 clause result(s), but the contract has ${c.clauses.length}`,
  ])
  const noNonce = replaceAll(good, `vector-done ${nonce} `, "vector-done  ")
  t.ok(
    "an end line with no nonce is not an end line",
    guardsProblems(c, noNonce, nonce).join("\n").indexOf("the test never reached the end of main") === 0,
  )
  const one = guardsProblems(c, `vector-done x 1\n${good}`, nonce)
  t.eqStr(
    "one wrong-nonce end line",
    one.length > 0 ? one[0] : "",
    "1 vector-done line(s) with the wrong nonce: something other than the test's main printed them",
  )
  const two = guardsProblems(c, `vector-done x 1\nvector-done y 1\n${good}`, nonce)
  t.eqStr(
    "two wrong-nonce end lines",
    two.length > 0 ? two[0] : "",
    "2 vector-done line(s) with the wrong nonce: something other than the test's main printed them",
  )
  t.eqLines(
    "three end lines with this nonce, the first read",
    guardsProblems(c, `${good}\n${good}\n${good}`, nonce),
    guardsWith(["3 vector-done lines carry this run's nonce"], guardsRepeatedAfter(c), []),
  )
  t.eqLines(
    "two end lines with this nonce, the first's bits read",
    guardsProblems(c, `vector-done ${nonce} 1\n${good}`, nonce),
    guardsWith(["2 vector-done lines carry this run's nonce"], guardsAfter(c), [
      `the end line records 1 clause result(s), but the contract has ${c.clauses.length}`,
    ]),
  )
}

/** No problems. */
const guardsNone = (): string[] => {
  const out: string[] = []
  return out
}

/** A shell command printing `n` x's and no newline. */
const guardsXs = (n: i32): string => `head -c ${n} /dev/zero | tr '\\0' x`

/** `a`, then `b`, then `c`. */
const guardsWith = (a: string[], b: string[], c: string[]): string[] => {
  const out: string[] = []
  for (const l of a) {
    out.push(l)
  }
  for (const l of b) {
    out.push(l)
  }
  for (const l of c) {
    out.push(l)
  }
  return out
}

/** Each clause reported after the first end line, once. */
const guardsAfter = (c: Contract): string[] => {
  const out: string[] = []
  for (const k of c.clauses) {
    out.push(`[${k.id}] reported after the test's main had finished`)
  }
  return out
}

/** Each clause of a transcript printed three times: two late reports each, then three reports of each. */
const guardsRepeatedAfter = (c: Contract): string[] => {
  const out: string[] = []
  for (const l of guardsAfter(c)) {
    out.push(l)
  }
  for (const l of guardsAfter(c)) {
    out.push(l)
  }
  for (const k of c.clauses) {
    out.push(`[${k.id}] reported 3 times; a clause reports once`)
  }
  return out
}

/** Counting each clause's reports, and reading a line by its clause at either end of the contract. */
const guardsReports = (t: Suite, c: Contract): void => {
  const nonce = "n0nce"
  const good = guardsPass(c, nonce)
  const first = c.clauses[0].id
  const last = c.clauses[c.clauses.length - 1].id
  const thrice = replaceAll(good, `PASS  [${first}]`, `PASS  [${first}] a\nPASS  [${first}] b\nPASS  [${first}]`)
  t.eqLines("the first clause reported three times", guardsProblems(c, thrice, nonce), [
    `[${first}] reported 3 times; a clause reports once`,
  ])
  const both = replaceAll(thrice, `PASS  [${last}]`, `PASS  [${last}] a\nPASS  [${last}]`)
  t.eqLines("each clause reported more than once, in contract order", guardsProblems(c, both, nonce), [
    `[${first}] reported 3 times; a clause reports once`,
    `[${last}] reported 2 times; a clause reports once`,
  ])
  const stranger = replaceAll(good, `PASS  [${first}]`, `PASS  [NOT-A-CLAUSE] x\nPASS  [${first}]`)
  t.eqLines("a line naming no clause is not counted", guardsProblems(c, stranger, nonce), guardsNone())
  const failLast = replaceAll(good, `PASS  [${last}]`, `FAIL  [${last}]`)
  const parsed = runParse(
    c,
    `${replaceAll(failLast, "vector-done", "      got 1, want 2\nvector-done")}\nFAIL  [NOT-A-CLAUSE] y\n      z`,
  )
  t.eqI32("one clause per contract clause", parsed.length, c.clauses.length)
  const lastRun = parsed[parsed.length - 1]
  t.eqStr("the last clause is read by its id", runOutcomeName(lastRun.outcome), "fail")
  t.eqStr("with its reason", lastRun.detail, "got 1, want 2")
  t.eqStr("the first clause too", runOutcomeName(parsed[0].outcome), "pass")
}

/** A line's clause is found by its id: only a slow clause skipped as slow is marked slow, first or last. */
const guardsSlow = (t: Suite): void => {
  const c = contractLoadFile("tests/fixtures/iterate-emit/contracts/sha256-chain.json").expect("load")
  const why = "(slow: pass --slow to run)"
  const out = `SKIP  [CHAIN-1] once ${why}\nPASS  [CHAIN-1000] 1,000 times\nSKIP  [CHAIN-100000] 100,000 times ${why}\n`
  const parsed = runParse(c, out)
  t.eqI32("one per clause", parsed.length, 3)
  t.ok("the last clause, which is slow, is marked slow", parsed.length === 3 && parsed[2].slow)
  t.ok("the first, which is not, is not", parsed.length === 3 && !parsed[0].slow)
}

/** Every part of an override path is checked, the last one too. */
const guardsStdPaths = (t: Suite): void => {
  const yes = ["std/a", "std/a.ts", "std/a/b.ts", "std/a/b/c", "std/..a", "std/a.."]
  const no = [
    "std/",
    "std",
    "src/a",
    "std/a/",
    "std//a",
    "std/./a",
    "std/a/.",
    "std/../x",
    "std/a/..",
    "std/a//b",
    "/std/a",
  ]
  for (const p of yes) {
    t.ok(`${p} is an override path`, runIsStdPath(p))
  }
  for (const p of no) {
    t.ok(`${p} is not`, !runIsStdPath(p))
  }
}

/** Paths and texts that pair, a directory in a file's place, and a link at each depth. */
const guardsWrite = (t: Suite): Result<boolean, string> => {
  const made = makeTempDir("vector-run-guards-").orReturn()
  const dir = realpathSync(made) ?? made
  const short = runWriteInside(dir, ["a.ts", "b.ts"], ["x\n"], "here", "the file")
  t.eqStr(
    "a path with no text is refused",
    short.isErr() ? short.error : "<ok>",
    "here: 2 the file path(s) but 1 text(s)",
  )
  const long = runWriteInside(dir, ["a.ts"], ["x\n", "y\n"], "here", "the file")
  t.eqStr(
    "a text with no path is refused",
    long.isErr() ? long.error : "<ok>",
    "here: 1 the file path(s) but 2 text(s)",
  )
  t.ok("before anything is written", readFileSyncOrNull(`${dir}/a.ts`) === null)
  const root = runWriteInside(dir, ["/"], ["x\n"], "here", "the file")
  t.eqStr(
    "a path that names no file is refused",
    root.isErr() ? root.error : "<ok>",
    "cannot write /: it names no file in a directory",
  )
  const nested = runWriteInside(dir, ["p/q/r.ts", "s.ts"], ["r\n", "s\n"], "here", "the file")
  t.ok("nested and top-level files are written", nested.isOk())
  t.eqStr("the nested one", readFileSyncOrNull(`${dir}/p/q/r.ts`) ?? "<none>", "r\n")
  t.eqStr("the top-level one", readFileSyncOrNull(`${dir}/s.ts`) ?? "<none>", "s\n")
  const onDir = runWriteInside(dir, ["p/q"], ["x\n"], "here", "the file")
  t.eqStr(
    "a directory in a file's place is refused with its errno",
    onDir.isErr() ? onDir.error : "<ok>",
    `cannot write ${dir}/p/q (errno 17)`,
  )
  const ln = runProcess(["ln", "-s", "--", `${dir}/p`, `${dir}/p/link`], "", 10000).orReturn()
  t.eqI32("a link is made", ln.status, 0)
  const deep = runWriteInside(dir, ["p/link/x.ts"], ["x\n"], "here", "the file")
  t.eqStr(
    "a link below the first part is refused",
    deep.isErr() ? deep.error : "<ok>",
    "here: p/link is a symlink, which the file p/link/x.ts would write through",
  )
  runRemove(dir).orReturn()
  return Ok(true)
}

/** A run's output kept to its last 64 KiB, from a line's start, at the cut's exact edges. */
const guardsTail = (t: Suite, c: Contract): Result<boolean, string> => {
  const keep: i32 = 65536
  const cases: string[][] = [
    [`${guardsXs(keep)}`, `${keep}`, "64 KiB is kept whole"],
    [`${guardsXs(keep + 1)}`, "0", "one byte over with no newline keeps nothing"],
    [`printf '\\n'; ${guardsXs(keep)}`, `${keep}`, "a newline just before the last 64 KiB keeps them"],
    [`printf 'a\\n'; ${guardsXs(keep)}`, `${keep}`, "and so with a byte before it"],
    [`printf '\\na'; ${guardsXs(keep)}`, "0", "a newline one byte too early keeps nothing"],
    [`printf 'ab\\n'; ${guardsXs(keep - 1)}`, `${keep - 1}`, "a newline inside the last 64 KiB keeps what follows it"],
  ]
  for (const row of cases) {
    const r = runTestCommand(c, ["sh", "-c", row[0]], 30000).orReturn()
    t.eqStr(row[2], `${r.stdout.length}`, row[1])
    t.ok(`${row[2]}: only x`, r.stdout.indexOf("\n") < 0 && r.stdout.indexOf("a") < 0)
  }
  return Ok(true)
}

/** A line cut at 500 bytes, between characters, at the cut's exact edges. */
const guardsEscape = (t: Suite): void => {
  const x499 = guardsRepeat("x", 499)
  t.eqStr("500 bytes are kept", runEscape(`${x499}y`), `${x499}y`)
  t.eqStr("501 are cut to 500", runEscape(`${x499}yz`), `${x499}y…`)
  t.eqStr("the 500th byte is escaped", runEscape(`${x499}\u0001`), `${x499}\\x01`)
  t.eqStr("and the cut drops the 501st", runEscape(`${x499}\u0001\u0002`), `${x499}\\x01…`)
  const x498 = guardsRepeat("x", 498)
  t.eqStr("a character ending at 500 is kept", runEscape(`${x498}é`), `${x498}é`)
  t.eqStr("one crossing 500 is dropped", runEscape(`${x499}é`), `${x499}…`)
  t.eqStr("an empty line", runEscape(""), "")
}

/** An ERROR with no clause run shows the last 20 lines of the compiler's output. */
const guardsCompilerTail = (t: Suite): void => {
  for (const n of [1, 19, 20, 21, 25]) {
    const lines: string[] = []
    for (let i = 1; i <= n; i++) {
      lines.push(`l${i}`)
    }
    const r = new RunResult("c", 2, lines.join("\n"), "")
    const want: string[] = ["ERROR: c (exit 2)"]
    const from = n > 20 ? n - 20 + 1 : 1
    for (let i = from; i <= n; i++) {
      want.push(`  | l${i}`)
    }
    t.eqLines(`${n} line(s) of output`, runFormatText(r), want)
  }
}

/**
 * The formats keep a requirement with no outcome as MISMATCH rather than index
 * past the outcomes. `spec run` never formats such a verdict: runJudge pairs
 * the lists, and the command exits 2 on lists that differ.
 */
const guardsMismatch = (t: Suite): void => {
  const r = new RunResult("c", 0, "", "")
  r.verdict.status = "ERROR"
  r.verdict.requirements = ["R-A", "R-B"]
  r.verdict.outcomes = [RunOutcome.Pass]
  t.contains("text", runFormatText(r).join("\n"), "  pass  R-A\n  MISMATCH  R-B")
  t.contains("markdown", runFormatMarkdown(r), "| R-A | pass |\n| R-B | MISMATCH |\n")
  t.contains("json", runFormatJson(r), `"requirements": {"R-A": "pass", "R-B": "MISMATCH"}`)
  r.verdict.outcomes = [RunOutcome.Fail, RunOutcome.Skip]
  t.contains("lists that pair", runFormatText(r).join("\n"), "  fail  R-A\n  skip  R-B")
}

/** `spec run` on a fake compiler that passes every clause: a paired verdict is reported, and exits 0. */
const guardsCommandPaired = (t: Suite, c: Contract): Result<boolean, string> => {
  const made = makeTempDir("vector-run-guards-").orReturn()
  const fake = `${made}/nish`
  const lines: string[] = ["#!/bin/sh", 'for n; do nonce="$n"; done']
  let bits = ""
  for (const k of c.clauses) {
    lines.push(`echo 'PASS  [${k.id}] ok'`)
    bits = `${bits}1`
  }
  lines.push(`echo "vector-done $nonce ${bits}"`)
  const script = `${lines.join("\n")}\n`
  const wrote = runProcess(
    ["sh", "-c", 'printf "%s" "$1" > "$2" && chmod 755 "$2"', "sh", script, fake],
    "",
    10000,
  ).orReturn()
  t.eqI32("the fake compiler is written", wrote.status, 0)
  const req = new RunRequest("contracts/example-hex.json")
  req.nish = fake
  t.eqI32("a paired SATISFIED verdict exits 0", runCommand(req), 0)
  runRemove(made).orReturn()
  return Ok(true)
}

/** Checks the guards that prove src/spec/run cannot panic, at their edges. */
export const main = (): i32 => {
  const t = new Suite("spec/run guards")
  const c = contractLoadFile("contracts/example-hex.json").expect("load")
  guardsEnd(t, c)
  guardsReports(t, c)
  guardsSlow(t)
  guardsStdPaths(t)
  const wrote = guardsWrite(t)
  if (wrote.isErr()) {
    t.fail("writing", wrote.error)
  }
  const tail = guardsTail(t, c)
  if (tail.isErr()) {
    t.fail("the kept tail", tail.error)
  }
  guardsEscape(t)
  guardsCompilerTail(t)
  guardsMismatch(t)
  const paired = guardsCommandPaired(t, c)
  if (paired.isErr()) {
    t.fail("spec run", paired.error)
  }
  return t.done()
}
