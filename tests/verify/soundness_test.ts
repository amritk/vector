// Each case removes one guard's reason to exist: if the guard it names were
// deleted, the case would reach PROVEN (or exit 0) and fail here.

import { Suite } from "nish/testing"
import { verifyExitCode } from "../../src/cli/verify"
import { joinPath, makeTempDir } from "../../src/core/fs"
import { runProcess } from "../../src/core/process"
import { QueryAnswer } from "../../src/core/smt"
import { resolveZ3 } from "../../src/core/z3"
import { verdictStatus } from "../../src/verify/emit/dashboard"
import { QUERY_REACHABLE, QUERY_TRIVIAL, buildVerificationScript } from "../../src/verify/smt/script"
import { CLAUSE_REFUTED, VerifyReport, assembleReport, solveIsModelRefusal } from "../../src/verify/solve/report"
import {
  FeedbackItem,
  OUTCOME_ERROR,
  OUTCOME_INVALID,
  OUTCOME_PROVEN,
  OUTCOME_REFUTED,
  OUTCOME_UNKNOWN,
  collectFeedbackItems,
} from "../../src/verify/verify"
import { BCase, bBin, bCall, bNone, bNum, bProgram, bRemoveTree, bSolve, bVar, bVerify } from "./build"

const soundNoAnswers = (): QueryAnswer[] => {
  const none: QueryAnswer[] = []
  return none
}

const soundHasIssue = (items: FeedbackItem[], fn: string, issue: string): boolean => {
  for (const item of items) {
    if (item.fn === fn && item.issue === issue) {
      return true
    }
  }
  return false
}

const soundSolve = (t: Suite, what: string, c: BCase): VerifyReport | null => {
  const report = bSolve(c)
  if (report.isErr()) {
    t.fail(what, report.error)
    return null
  }
  return report.value
}

const soundReciprocal = (guarded: boolean): BCase => {
  const c = new BCase("recip")
  const requires: string[] = []
  if (guarded) {
    requires.push(bBin("!=", bVar("x"), bNum("0")))
  }
  const x = bVar("x")
  c.fn(
    "recip",
    1,
    ["x:Real"],
    "Real",
    requires,
    [bBin("==", bBin("*", bVar("result"), x), bNum("1"))],
    bBin("/", bNum("1"), x),
  )
  return c
}

// Runs the binary with VECTOR_Z3 pointing at a script that runs the real z3
// and then prints an `(error …)` line, as z3 does for a rejected assertion.
const soundRejectedScript = (t: Suite): void => {
  const z3 = resolveZ3()
  const dir = makeTempDir("vector-sound-")
  if (z3.isErr() || dir.isErr()) {
    t.fail("z3 and a temp dir", z3.isErr() ? z3.error : dir.isErr() ? dir.error : "")
    return
  }
  const fake = joinPath(dir.value, "z3")
  const fakeText = `#!/bin/sh\n"${z3.value}" "$@"\necho '(error "line 1 column 1: rejected on purpose")'\n`
  t.ok("write the fake z3", writeFileSyncMode(fake, fakeText, 0o755) >= 0)
  const spec = joinPath(dir.value, "spec.json")
  const program = joinPath(dir.value, "program.json")
  const c = new BCase("clamp")
  c.fn(
    "lower",
    1,
    ["x:Real"],
    "Real",
    bNone(),
    [bBin(">=", bVar("result"), bNum("0"))],
    bBin("max", bVar("x"), bNum("0")),
  )
  t.ok("write spec", writeFileSyncMode(spec, c.specText(), 0o644) >= 0)
  t.ok("write program", writeFileSyncMode(program, c.programText(), 0o644) >= 0)
  const run = runProcess(["env", `VECTOR_Z3=${fake}`, "dist/vector", "verify", spec, program], "", 60000)
  const json = runProcess(["env", `VECTOR_Z3=${fake}`, "dist/vector", "verify", "--json", spec, program], "", 60000)
  t.ok("remove the temp dir", bRemoveTree(dir.value))
  if (run.isErr() || json.isErr()) {
    t.fail("dist/vector runs (build it first)", run.isErr() ? run.error : json.isErr() ? json.error : "")
    return
  }
  t.eqI32("a z3 error exits 1, not 2", run.value.status, 1)
  t.contains("a z3 error is reported", run.value.stderr, "z3 rejected the script")
  t.eqStr("a z3 error proves nothing", run.value.stdout, "")
  t.eqI32("a z3 error exits 1 under --json", json.value.status, 1)
  t.contains("a z3 error is ERROR in --json", json.value.stdout, `"status": "${OUTCOME_ERROR}"`)
}

// `--emit` writes only a proven program: on REFUTED it creates nothing and
// leaves a file already at the path as it was.
const soundEmitRefuted = (t: Suite): void => {
  const dir = makeTempDir("vector-emit-refuted-")
  if (dir.isErr()) {
    t.fail("a temp dir", dir.error)
    return
  }
  const spec = joinPath(dir.value, "spec.json")
  const program = joinPath(dir.value, "program.json")
  const c = new BCase("wrong")
  c.fn(
    "lower",
    1,
    ["x:Real"],
    "Real",
    bNone(),
    [bBin(">=", bVar("result"), bNum("1"))],
    bBin("max", bVar("x"), bNum("0")),
  )
  t.ok("write spec", writeFileSyncMode(spec, c.specText(), 0o644) >= 0)
  t.ok("write program", writeFileSyncMode(program, c.programText(), 0o644) >= 0)
  const fresh = joinPath(dir.value, "fresh.ts")
  const kept = joinPath(dir.value, "kept.ts")
  t.ok("write kept.ts", writeFileSyncMode(kept, "// before\n", 0o644) >= 0)
  const a = runProcess(["dist/vector", "verify", "--emit", fresh, spec, program], "", 60000)
  const b = runProcess(["dist/vector", "verify", "--json", "--emit", kept, spec, program], "", 60000)
  const freshText = readFileSyncOrNull(fresh)
  const keptText = readFileSyncOrNull(kept)
  t.ok("remove the temp dir", bRemoveTree(dir.value))
  if (a.isErr() || b.isErr()) {
    t.fail("dist/vector runs (build it first)", a.isErr() ? a.error : b.isErr() ? b.error : "")
    return
  }
  t.eqI32("REFUTED with --emit exits 1", a.value.status, 1)
  t.ok("REFUTED with --emit creates no file", freshText === null)
  t.eqI32("REFUTED with --json --emit exits 1", b.value.status, 1)
  t.eqStr("REFUTED with --emit leaves a file as it was", keptText ?? "", "// before\n")
}

// `--emit` on PROVEN replaces a file at the path with the emitted code, and
// leaves nothing else beside it: no temporary survives the rename.
const soundEmitProven = (t: Suite): void => {
  const dir = makeTempDir("vector-emit-proven-")
  if (dir.isErr()) {
    t.fail("a temp dir", dir.error)
    return
  }
  const out = joinPath(dir.value, "out.ts")
  t.ok("write out.ts", writeFileSyncMode(out, "// before\n", 0o644) >= 0)
  const run = runProcess(
    ["dist/vector", "verify", "--emit", out, "tests/fixtures/currency-spec.json", "tests/fixtures/currency.json"],
    "",
    60000,
  )
  const outText = readFileSyncOrNull(out)
  const names = readdirSync(dir.value) ?? soundNoNames()
  t.ok("remove the temp dir", bRemoveTree(dir.value))
  if (run.isErr()) {
    t.fail("dist/vector runs (build it first)", run.error)
    return
  }
  t.eqI32("PROVEN with --emit exits 0", run.value.status, 0)
  t.contains(
    "PROVEN with --emit writes the program",
    outText ?? "",
    "export function usdToEur(amount: number): number {",
  )
  t.ok("PROVEN with --emit replaces the old file", (outText ?? "").indexOf("// before") < 0)
  t.eqStr("PROVEN with --emit leaves no temporary", names.join(","), "out.ts")
}

// One Int function of x: a precondition region, a body and `result == want`.
const soundIntCase = (name: string, requires: string[], body: string, want: string): BCase => {
  const c = new BCase(name)
  c.fn(name, 1, ["x:Int"], "Int", requires, [bBin("==", bVar("result"), want)], body)
  return c
}

// Solves a case and checks how many Int range hazards it has.
const soundRanges = (t: Suite, what: string, c: BCase, want: i32): void => {
  const report = soundSolve(t, what, c)
  if (report !== null) {
    t.eqI32(what, report.rangeCount, want)
    t.ok(`${what}: ok() agrees`, report.ok() === (want === 0))
  }
}

// 0 <= x <= bound.
const soundXLe = (bound: string): string[] => [bBin(">=", bVar("x"), bNum("0")), bBin("<=", bVar("x"), bNum(bound))]

const soundNoNames = (): string[] => {
  const none: string[] = []
  return none
}

export const main = (): i32 => {
  const t = new Suite("verify/soundness")

  // Division by a value that may be zero is a hazard, not a proof.
  const unguarded = soundSolve(t, "solve unguarded 1/x", soundReciprocal(false))
  if (unguarded !== null) {
    t.ok("unguarded 1/x has a division hazard", unguarded.divCount > 0)
    t.ok("unguarded 1/x is not ok", !unguarded.ok())
    t.ok("unguarded 1/x is division-hazard", soundHasIssue(collectFeedbackItems(unguarded), "recip", "division-hazard"))
  }
  const guarded = soundSolve(t, "solve guarded 1/x", soundReciprocal(true))
  if (guarded !== null) {
    t.eqI32("guarded 1/x has no division hazard", guarded.divCount, 0)
    t.ok("guarded 1/x is ok", guarded.ok())
  }

  // An Int is a float64 in the emitted code: a value past 2^53−1 rounds, so
  // `low + high - high` returns high + 1 at low = 5e15 + 1, high = 5e15 + 2.
  const big = new BCase("sumback")
  big.fn(
    "back",
    1,
    ["low:Int", "high:Int"],
    "Int",
    [
      bBin("<=", bVar("low"), bVar("high")),
      bBin(">=", bVar("low"), bNum("5000000000000001")),
      bBin("<=", bVar("high"), bNum("5000000000000999")),
    ],
    [bBin("==", bVar("result"), bVar("low"))],
    bBin("-", bBin("+", bVar("low"), bVar("high")), bVar("high")),
  )
  const bigReport = soundSolve(t, "solve low + high - high near 2^53", big)
  if (bigReport !== null) {
    t.ok("the ensures is proven over the integers", bigReport.unsatCount === 1)
    t.eqI32("only low + high leaves the safe range", bigReport.rangeCount, 1)
    t.eqStr("the hazard names low + high", bigReport.functions[0].ranges[0].pretty, "low + high")
    t.ok("low + high gives range-hazard", soundHasIssue(collectFeedbackItems(bigReport), "back", "range-hazard"))
  }
  t.eqStr("an Int overflow never reaches PROVEN", bVerify(big).status, OUTCOME_REFUTED)

  const triple = bBin("*", bNum("3"), bVar("x"))
  soundRanges(
    t,
    "3 * x for x <= 3e15 stays safe",
    soundIntCase("tripleSafe", soundXLe("3000000000000000"), triple, triple),
    0,
  )
  soundRanges(
    t,
    "3 * x for x <= 4e15 overflows",
    soundIntCase("tripleBig", soundXLe("4000000000000000"), triple, triple),
    1,
  )

  // An Int parameter past 2^53−1 never reaches the body: its domain guard throws.
  const below = bBin("-", bVar("x"), bNum("1"))
  const nonNeg: string[] = [bBin(">=", bVar("x"), bNum("0"))]
  soundRanges(t, "x - 1 for a safe x >= 0 is safe", soundIntCase("below", nonNeg, below, below), 0)
  const above = bBin("+", bVar("x"), bNum("1"))
  soundRanges(t, "x + 1 for a safe x >= 0 may overflow", soundIntCase("above", nonNeg, above, above), 1)

  // 1e16 is a float64 exactly, but x − 1e16 is not for most x.
  const offset = bBin("-", bVar("x"), bNum("10000000000000000"))
  soundRanges(t, "x - 1e16 is a hazard", soundIntCase("offset", soundXLe("10"), offset, offset), 1)
  const safeLit = bBin("-", bVar("x"), bNum("9007199254740991"))
  soundRanges(t, "x - (2^53 - 1) is not", soundIntCase("safeLit", soundXLe("10"), safeLit, safeLit), 0)

  // The emitted guards run in order, so a requires may lean only on those before it.
  const doubled = bBin("<=", bBin("+", bVar("x"), bVar("x")), bNum("1500"))
  const bounded = bBin("and", bBin(">=", bVar("x"), bNum("0")), bBin("<=", bVar("x"), bNum("1000")))
  const first: string[] = [bounded, doubled]
  soundRanges(t, "x + x after 0 <= x <= 1000 is safe", soundIntCase("guardAfter", first, bVar("x"), bVar("x")), 0)
  const last: string[] = [doubled, bounded]
  soundRanges(t, "x + x before 0 <= x <= 1000 may overflow", soundIntCase("guardBefore", last, bVar("x"), bVar("x")), 1)

  // `&&` short-circuits, so its right side may lean on its left.
  const both: string[] = [bBin("and", bounded, doubled)]
  soundRanges(t, "bounds && x + x <= 1500 is safe", soundIntCase("shortAnd", both, bVar("x"), bVar("x")), 0)
  const flipped: string[] = [bBin("and", doubled, bounded)]
  soundRanges(t, "x + x <= 1500 && bounds may overflow", soundIntCase("flipAnd", flipped, bVar("x"), bVar("x")), 1)

  // `||` evaluates its right side only where the left is false, and `a ⇒ b`
  // is emitted as `!a || b`, so b only where a is true.
  const outside = bBin("or", bBin("<", bVar("x"), bNum("0")), bBin(">", bVar("x"), bNum("1000")))
  const orSafe: string[] = [bBin("or", outside, doubled)]
  soundRanges(t, "outside || x + x <= 1500 is safe", soundIntCase("shortOr", orSafe, bVar("x"), bVar("x")), 0)
  const orBig: string[] = [bBin("or", doubled, outside)]
  soundRanges(t, "x + x <= 1500 || outside may overflow", soundIntCase("flipOr", orBig, bVar("x"), bVar("x")), 1)
  const impSafe: string[] = [bBin("implies", bounded, doubled)]
  soundRanges(t, "bounds ⇒ x + x <= 1500 is safe", soundIntCase("impSafe", impSafe, bVar("x"), bVar("x")), 0)
  const impBig: string[] = [bBin("implies", outside, doubled)]
  soundRanges(t, "outside ⇒ x + x <= 1500 may overflow", soundIntCase("impBig", impBig, bVar("x"), bVar("x")), 1)

  // An inlined callee's guards run in order before its body, so at the call
  // site its second requires and its body lean on its first.
  const twice = bBin("+", bVar("y"), bVar("y"))
  const callee = new BCase("calleeGuards")
  callee.fn(
    "twice",
    1,
    ["y:Int"],
    "Int",
    [
      bBin("and", bBin(">=", bVar("y"), bNum("0")), bBin("<=", bVar("y"), bNum("1000"))),
      bBin("<=", twice, bNum("1500")),
    ],
    [bBin("==", bVar("result"), twice)],
    twice,
  )
  callee.fn(
    "caller",
    2,
    ["x:Int"],
    "Int",
    bNone(),
    [bBin("==", bVar("result"), bBin("+", bVar("x"), bVar("x")))],
    bCall("twice", [bVar("x")]),
  )
  const calleeReport = soundSolve(t, "solve an unguarded call into twice", callee)
  if (calleeReport !== null) {
    t.eqI32("twice's y + y is guarded by its own first requires", calleeReport.rangeCount, 0)
    t.ok("the unguarded call breaks twice's requires", calleeReport.preCount > 0)
  }

  // Contradictory requires prove everything, so they must refute.
  const vac = new BCase("vacuous")
  vac.fn(
    "nope",
    1,
    ["x:Real"],
    "Real",
    [bBin(">", bVar("x"), bNum("1")), bBin("<", bVar("x"), bNum("0"))],
    [bBin("==", bVar("result"), bNum("42"))],
    bVar("x"),
  )
  const vacReport = soundSolve(t, "solve contradictory requires", vac)
  if (vacReport !== null) {
    t.ok("contradictory requires are vacuous", vacReport.functions[0].vacuous)
    t.ok("contradictory requires are not ok", !vacReport.ok())
    t.ok("contradictory requires give vacuous", soundHasIssue(collectFeedbackItems(vacReport), "nope", "vacuous"))
  }
  t.eqStr("contradictory requires never reach PROVEN", bVerify(vac).status, OUTCOME_REFUTED)

  // An ensures that holds whatever the body is proves nothing.
  const triv = new BCase("trivial")
  triv.fn("same", 1, ["x:Real"], "Real", bNone(), [bBin("==", bVar("result"), bVar("result"))], bVar("x"))
  const trivReport = soundSolve(t, "solve result == result", triv)
  if (trivReport !== null) {
    t.ok("result == result is trivial", trivReport.functions[0].ensures[0].trivial)
    t.ok("result == result gives trivial", soundHasIssue(collectFeedbackItems(trivReport), "same", "trivial"))
  }
  t.eqStr("result == result is REFUTED", bVerify(triv).status, OUTCOME_REFUTED)

  // A call that can break the callee's requires is a hazard.
  const pre = new BCase("pre")
  pre.fn(
    "g",
    1,
    ["y:Real"],
    "Real",
    [bBin(">", bVar("y"), bNum("0"))],
    [bBin(">", bVar("result"), bNum("0"))],
    bVar("y"),
  )
  pre.fn(
    "f",
    2,
    ["x:Real"],
    "Real",
    [bBin(">=", bVar("x"), bNum("0"))],
    [bBin(">", bVar("result"), bNum("0"))],
    bCall("g", [bVar("x")]),
  )
  const preReport = soundSolve(t, "solve g(x) with x >= 0", pre)
  if (preReport !== null) {
    t.ok("g(0) breaks g's requires", preReport.preCount > 0)
    t.ok("g(x) gives precondition-hazard", soundHasIssue(collectFeedbackItems(preReport), "f", "precondition-hazard"))
  }
  t.eqStr("a precondition hazard never reaches PROVEN", bVerify(pre).status, OUTCOME_REFUTED)

  // One function's contradictory requires must not leak into its sibling.
  const sib = new BCase("siblings")
  sib.fn(
    "a",
    1,
    ["x:Real"],
    "Real",
    [bBin(">", bVar("x"), bNum("1")), bBin("<", bVar("x"), bNum("0"))],
    [bBin("==", bVar("result"), bVar("x"))],
    bVar("x"),
  )
  sib.fn("b", 1, ["x:Real"], "Real", bNone(), [bBin("==", bVar("result"), bNum("1"))], bNum("2"))
  const sibReport = soundSolve(t, "solve vacuous sibling", sib)
  if (sibReport !== null) {
    t.ok("a is vacuous", sibReport.functions[0].vacuous)
    t.ok("b is not vacuous", !sibReport.functions[1].vacuous)
    t.eqStr("b's false ensures is refuted", sibReport.functions[1].ensures[0].status, CLAUSE_REFUTED)
    t.ok("b's ensures is not trivial", !sibReport.functions[1].ensures[0].trivial)
  }

  // z3 answering unknown proves nothing: not reachability, not triviality.
  const clamp = new BCase("unknowns")
  clamp.fn(
    "lower",
    1,
    ["x:Real"],
    "Real",
    bNone(),
    [bBin(">=", bVar("result"), bNum("0"))],
    bBin("max", bVar("x"), bNum("0")),
  )
  const clampProgram = bProgram(clamp.programText())
  if (clampProgram.isErr()) {
    t.fail("read the unknowns program", clampProgram.error)
  } else {
    const script = buildVerificationScript(clampProgram.value)
    const unknowns: QueryAnswer[] = []
    const unknownReach: QueryAnswer[] = []
    const unknownTrivial: QueryAnswer[] = []
    for (const q of script.queries) {
      unknowns.push(new QueryAnswer("unknown"))
      unknownReach.push(new QueryAnswer(q.kind === QUERY_REACHABLE ? "unknown" : "unsat"))
      unknownTrivial.push(
        new QueryAnswer(q.kind === QUERY_TRIVIAL ? "unknown" : q.kind === QUERY_REACHABLE ? "sat" : "unsat"),
      )
    }
    const all = assembleReport(clampProgram.value, script.queries, unknowns, "test")
    t.ok("all unknown is not ok", !all.ok())
    t.ok("all unknown is never PROVEN", verdictStatus(all) !== OUTCOME_PROVEN)
    const reach = assembleReport(clampProgram.value, script.queries, unknownReach, "test")
    t.ok("unknown reachability counts as vacuous", reach.functions[0].vacuous)
    t.ok("unknown reachability is never PROVEN", verdictStatus(reach) !== OUTCOME_PROVEN)
    const trivial = assembleReport(clampProgram.value, script.queries, unknownTrivial, "test")
    t.ok("unknown triviality counts as trivial", trivial.functions[0].ensures[0].trivial)
    t.ok("unknown triviality is never PROVEN", verdictStatus(trivial) !== OUTCOME_PROVEN)
    const short = assembleReport(clampProgram.value, script.queries, soundNoAnswers(), "test")
    t.ok("no answers is never PROVEN", verdictStatus(short) !== OUTCOME_PROVEN)
  }

  t.ok(
    "solveIsModelRefusal names the refusal",
    solveIsModelRefusal('(error "line 9 column 10: model is not available")'),
  )
  t.ok(
    "solveIsModelRefusal refuses other errors",
    !solveIsModelRefusal('(error "line 1 column 1: rejected on purpose")'),
  )
  t.eqI32("verifyExitCode PROVEN", verifyExitCode(OUTCOME_PROVEN), 0)
  t.eqI32("verifyExitCode REFUTED", verifyExitCode(OUTCOME_REFUTED), 1)
  t.eqI32("verifyExitCode UNKNOWN", verifyExitCode(OUTCOME_UNKNOWN), 1)
  t.eqI32("verifyExitCode INVALID", verifyExitCode(OUTCOME_INVALID), 1)
  t.eqI32("verifyExitCode ERROR", verifyExitCode(OUTCOME_ERROR), 1)
  soundRejectedScript(t)
  soundEmitRefuted(t)
  soundEmitProven(t)
  return t.done()
}
