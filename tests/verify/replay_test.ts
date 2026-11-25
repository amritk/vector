import { Suite } from "nish/testing"
import { diffExitCode } from "../../src/cli/diff"
import { verifyExitCode } from "../../src/cli/verify"
import { outJsonObject, outJsonRender } from "../../src/verify/emit/outjson"
import {
  CHECK_WITNESS,
  DIFF_MISMATCH,
  DiffCheck,
  MatchedFunctionDiff,
  ProgramDiffReport,
  diffDecide,
  diffReplayWitnesses,
  pairFunctions,
} from "../../src/verify/equiv/diff"
import { FnUnit, Program, programFunctionIndex } from "../../src/verify/lang/ast"
import { QUERY_DIV, QUERY_PRE, QUERY_RANGE } from "../../src/verify/smt/script"
import {
  REPLAY_CONFIRMED,
  REPLAY_MISMATCH,
  REPLAY_NARROWED,
  REPLAY_NOT_REPLAYED,
  REPLAY_VALUE,
  REPLAY_WIDENED,
  replayClause,
  replayEvaluate,
  replayHazard,
  replayJsonPut,
  replayParseValue,
  replayReport,
  replayValueText,
  replayWitness,
} from "../../src/verify/solve/replay"
import { Counterexample, solveProgram } from "../../src/verify/solve/report"
import { OUTCOME_MISMATCH, OUTCOME_REFUTED, verifyMismatchLines, verifyReportOutcome } from "../../src/verify/verify"
import { BCase, bBin, bCall, bIte, bNum, bProgram, bUn, bVar } from "./build"

const replayNone = (): string[] => {
  const none: string[] = []
  return none
}

const replayCex = (names: string[], values: string[], result: string): Counterexample => {
  const cex = new Counterexample(result)
  for (let i = 0; i < toI32(names.length); i++) {
    cex.names.push(names[i])
    cex.values.push(values[i])
  }
  return cex
}

const replayProgram = (t: Suite, c: BCase): Program => {
  const program = bProgram(c.programText())
  t.eqStr(`${c.name} builds`, program.isOk() ? "" : program.error, "")
  return program.isOk() ? program.value : new Program(c.name)
}

/** One model value, the exact value it denotes ("" when it is not replayed). */
class ParseCase {
  text: string
  want: string

  constructor(text: string, want: string) {
    this.text = text
    this.want = want
  }
}

/** One replay of `scale`'s single ensures. */
class ClauseCase {
  label: string
  x: string
  result: string
  want: string
  detail: string

  constructor(label: string, x: string, result: string, want: string, detail: string) {
    this.label = label
    this.x = x
    this.result = result
    this.want = want
    this.detail = detail
  }
}

const replayParseCases = (t: Suite): void => {
  const cases: ParseCase[] = [
    new ParseCase("5", "5"),
    new ParseCase("0", "0"),
    new ParseCase("(- 5)", "-5"),
    new ParseCase("(/ 1 3)", "1/3"),
    new ParseCase("(/ (- 1) 3)", "-1/3"),
    new ParseCase("(- (/ 1 3))", "-1/3"),
    new ParseCase("(/ 2 4)", "1/2"),
    new ParseCase("1.5", "3/2"),
    new ParseCase("(- 1.5)", "-3/2"),
    new ParseCase("(/ 3.0 2.0)", "3/2"),
    new ParseCase("true", "true"),
    new ParseCase("false", "false"),
    new ParseCase("(root-obj (+ (^ x 2) (- 2)) 1)", ""),
    new ParseCase("", ""),
    new ParseCase("(/ 1 0)", ""),
    new ParseCase("99999999999999999999", ""),
    new ParseCase("9223372036854775807", "9223372036854775807"),
    new ParseCase("(- 9223372036854775807)", "-9223372036854775807"),
    new ParseCase("9223372036854775808", ""),
    new ParseCase("(* 9223372036854775807 2)", ""),
    new ParseCase("(/ 1 9223372036854775807)", "1/9223372036854775807"),
    new ParseCase("1/3", "1/3"),
    new ParseCase("-1/3", "-1/3"),
    new ParseCase("1/-3", "-1/3"),
    new ParseCase("1/3/4", ""),
    new ParseCase("--1", ""),
    new ParseCase("1/0", ""),
  ]
  for (const c of cases) {
    const v = replayParseValue(c.text)
    if (c.want === "") {
      t.ok(`"${c.text}" is not replayed`, !v.known)
      t.ok(`"${c.text}" says why`, v.why !== "")
    } else {
      t.ok(`"${c.text}" parses`, v.known)
      t.eqStr(`"${c.text}" is ${c.want}`, replayValueText(v), c.want)
    }
  }
}

// scale(x: Real) requires x >= 0, ensures result > x, body x * 0.91: refuted
// at every x >= 0 except none, so any non-negative x is a true counterexample.
const replayScaleCase = (): BCase => {
  const c = new BCase("scale")
  c.fn(
    "scale",
    1,
    ["x:Real"],
    "Real",
    [bBin(">=", bVar("x"), bNum("0"))],
    [bBin(">", bVar("result"), bVar("x"))],
    bBin("*", bVar("x"), bNum("0.91")),
  )
  return c
}

const replayClauseCases = (t: Suite): void => {
  const program = replayProgram(t, replayScaleCase())
  if (program.functions.length === 0) {
    return
  }
  const fn = program.functions[0]
  const cases: ClauseCase[] = [
    new ClauseCase("confirmed", "5", "4.55", REPLAY_CONFIRMED, ""),
    new ClauseCase("confirmed, a rational", "(/ 1 3)", "(/ 91 300)", REPLAY_CONFIRMED, ""),
    new ClauseCase("confirmed, no result", "1.5", "?", REPLAY_CONFIRMED, ""),
    new ClauseCase("confirmed at zero", "(- 0.0)", "0.0", REPLAY_CONFIRMED, ""),
    new ClauseCase("a requires fails", "(- 5)", "(- 4.55)", REPLAY_MISMATCH, "requires"),
    new ClauseCase("the result differs", "5", "6", REPLAY_MISMATCH, "body returns"),
    new ClauseCase("unparseable", "(root-obj x 1)", "?", REPLAY_NOT_REPLAYED, ""),
    new ClauseCase("a Bool for a Real", "true", "?", REPLAY_NOT_REPLAYED, "not a Real"),
    new ClauseCase("overflow", "(/ 1 9223372036854775807)", "?", REPLAY_NOT_REPLAYED, ""),
  ]
  for (const c of cases) {
    const r = replayClause(program, fn, fn.ensures[0], replayCex(["x"], [c.x], c.result))
    t.eqStr(`${c.label}: outcome`, r.outcome, c.want)
    if (c.detail !== "") {
      t.contains(`${c.label}: detail`, r.detail, c.detail)
    }
  }
  // At x = 0 the body is 0 and 0 > 0 is false: still a counterexample. A
  // clause that holds needs a body that clears it: x * 2 > x at x = 1.
  const holds = new BCase("double")
  holds.fn(
    "double",
    1,
    ["x:Real"],
    "Real",
    [bBin(">=", bVar("x"), bNum("0"))],
    [bBin(">", bVar("result"), bVar("x"))],
    bBin("*", bVar("x"), bNum("2")),
  )
  const doubled = replayProgram(t, holds)
  if (doubled.functions.length > 0) {
    const d = doubled.functions[0]
    const r = replayClause(doubled, d, d.ensures[0], replayCex(["x"], ["1"], "2"))
    t.eqStr("the clause holds: mismatch", r.outcome, REPLAY_MISMATCH)
    t.contains("the clause holds: detail", r.detail, "holds there")
  }
  // An overflow mid-walk: x * x past i64 is not replayed, never a verdict.
  const square = new BCase("square")
  square.fn(
    "square",
    1,
    ["x:Int"],
    "Int",
    replayNone(),
    [bBin("<", bVar("result"), bNum("0"))],
    bBin("*", bVar("x"), bVar("x")),
  )
  const squared = replayProgram(t, square)
  if (squared.functions.length > 0) {
    const s = squared.functions[0]
    const r = replayClause(squared, s, s.ensures[0], replayCex(["x"], ["3037000500"], "?"))
    t.eqStr("an i64 overflow: not replayed", r.outcome, REPLAY_NOT_REPLAYED)
    const missing = replayClause(squared, s, s.ensures[0], replayCex([], [], "?"))
    t.eqStr("a missing parameter: not replayed", missing.outcome, REPLAY_NOT_REPLAYED)
  }
}

const replayAt = (a: string, b: string): Counterexample => replayCex(["a", "b"], [a, b], "?")

const replayWitnessAt = (x: string): DiffCheck => {
  const c = new DiffCheck(CHECK_WITNESS)
  c.inputs = replayCex(["x"], [x], "")
  return c
}

const replayHazardCases = (t: Suite): void => {
  // ratio(a, b) = a / b: a division hazard at b = 0.
  const c = new BCase("ratio")
  c.fn(
    "ratio",
    1,
    ["a:Real", "b:Real"],
    "Real",
    replayNone(),
    [bBin("==", bVar("result"), bVar("result"))],
    bBin("/", bVar("a"), bVar("b")),
  )
  // recips(a, b) = 1 / a + 1 / b: two divisions, hazard 0 at a = 0 and 1 at b = 0.
  c.fn(
    "recips",
    1,
    ["a:Real", "b:Real"],
    "Real",
    replayNone(),
    [bBin("==", bVar("result"), bVar("result"))],
    bBin("+", bBin("/", bNum("1"), bVar("a")), bBin("/", bNum("1"), bVar("b"))),
  )
  const program = replayProgram(t, c)
  if (program.functions.length === 0) {
    return
  }
  const fn = program.functions[0]
  t.eqStr(
    "division by 0: confirmed",
    replayHazard(program, fn, QUERY_DIV, 0, replayAt("1", "0")).outcome,
    REPLAY_CONFIRMED,
  )
  t.eqStr(
    "division by 2: mismatch",
    replayHazard(program, fn, QUERY_DIV, 0, replayAt("1", "2")).outcome,
    REPLAY_MISMATCH,
  )
  t.eqStr(
    "an index past the one division: mismatch",
    replayHazard(program, fn, QUERY_DIV, 1, replayAt("1", "0")).outcome,
    REPLAY_MISMATCH,
  )
  const recips = replayFnNamed(program, "recips")
  if (recips === null) {
    t.fail("recips is in the program", "it is not")
  } else {
    t.eqStr(
      "the first of two divisions at a = 0: confirmed",
      replayHazard(program, recips, QUERY_DIV, 0, replayAt("0", "1")).outcome,
      REPLAY_CONFIRMED,
    )
    t.eqStr(
      "the second of two divisions at a = 0: mismatch",
      replayHazard(program, recips, QUERY_DIV, 1, replayAt("0", "1")).outcome,
      REPLAY_MISMATCH,
    )
    t.eqStr(
      "the first of two divisions at b = 0: mismatch",
      replayHazard(program, recips, QUERY_DIV, 0, replayAt("1", "0")).outcome,
      REPLAY_MISMATCH,
    )
    t.eqStr(
      "the second of two divisions at b = 0: confirmed",
      replayHazard(program, recips, QUERY_DIV, 1, replayAt("1", "0")).outcome,
      REPLAY_CONFIRMED,
    )
    t.eqStr(
      "an index past two divisions: mismatch",
      replayHazard(program, recips, QUERY_DIV, 2, replayAt("0", "0")).outcome,
      REPLAY_MISMATCH,
    )
  }
  t.eqStr(
    "unparseable: not replayed",
    replayHazard(program, fn, QUERY_DIV, 0, replayAt("x", "0")).outcome,
    REPLAY_NOT_REPLAYED,
  )

  // grow(n: Int) = n * 1000: past ±(2^53−1) for large n.
  const g = new BCase("grow")
  g.fn(
    "grow",
    1,
    ["n:Int"],
    "Int",
    replayNone(),
    [bBin("==", bVar("result"), bVar("result"))],
    bBin("*", bVar("n"), bNum("1000")),
  )
  const grown = replayProgram(t, g)
  if (grown.functions.length > 0) {
    const gf = grown.functions[0]
    const big = replayCex(["n"], ["9007199254741"], "?")
    t.eqStr("an Int past 2^53: confirmed", replayHazard(grown, gf, QUERY_RANGE, 0, big).outcome, REPLAY_CONFIRMED)
    const small = replayCex(["n"], ["7"], "?")
    t.eqStr("an Int well inside: mismatch", replayHazard(grown, gf, QUERY_RANGE, 0, small).outcome, REPLAY_MISMATCH)
  }

  // A hazard is its condition: z3's result for a body that divides by zero
  // is unspecified, so it is not compared.
  t.eqStr(
    "division by 0 with a result: confirmed",
    replayHazard(program, fn, QUERY_DIV, 0, replayCex(["a", "b"], ["1", "0"], "5")).outcome,
    REPLAY_CONFIRMED,
  )

  const run = replayEvaluate(program, fn, ["a", "b"], ["(/ 1 3)", "(- 2)"])
  t.eqStr("evaluate: the body", replayValueText(run.body), "-1/6")
  t.eqStr("evaluate: bound", run.unbound, "")
}

// half(x) requires x >= 0; use(y) = half(y) with no requires: a
// precondition hazard at y < 0. script.ts inlines half's body past its
// failed requires, so the body is known there and z3's result is checked.
// both(y) = half(y) + half(y + 1) has two call sites, hazards 0 and 1.
// inv(x) requires x > 0, = 1 / x; flip(y) = inv(y): at y = 0 the requires
// fails and the body divides by zero, so it is unknown there and z3's
// result is not compared.
const replayPreProgram = (t: Suite): Program => {
  const c = new BCase("calls")
  const y = bVar("y")
  c.fn(
    "half",
    1,
    ["x:Real"],
    "Real",
    [bBin(">=", bVar("x"), bNum("0"))],
    [bBin("==", bVar("result"), bVar("result"))],
    bBin("/", bVar("x"), bNum("2")),
  )
  c.fn(
    "inv",
    1,
    ["x:Real"],
    "Real",
    [bBin(">", bVar("x"), bNum("0"))],
    [bBin("==", bVar("result"), bVar("result"))],
    bBin("/", bNum("1"), bVar("x")),
  )
  c.fn("use", 2, ["y:Real"], "Real", replayNone(), [bBin("==", bVar("result"), bVar("result"))], bCall("half", [y]))
  c.fn(
    "both",
    2,
    ["y:Real"],
    "Real",
    replayNone(),
    [bBin("==", bVar("result"), bVar("result"))],
    bBin("+", bCall("half", [y]), bCall("half", [bBin("+", y, bNum("1"))])),
  )
  c.fn("flip", 2, ["y:Real"], "Real", replayNone(), [bBin("==", bVar("result"), bVar("result"))], bCall("inv", [y]))
  return replayProgram(t, c)
}

const replayFnNamed = (program: Program, name: string): FnUnit | null => {
  for (const fn of program.functions) {
    if (fn.name === name) {
      return fn
    }
  }
  return null
}

/** One precondition hazard replay: a function of `y`, the hazard's index, and what the replay must say. */
class PreCase {
  label: string
  fn: string
  index: i32
  y: string
  result: string
  want: string
  detail: string

  constructor(label: string, fn: string, index: i32, y: string, result: string, want: string, detail: string) {
    this.label = label
    this.fn = fn
    this.index = index
    this.y = y
    this.result = result
    this.want = want
    this.detail = detail
  }
}

const replayPreCases = (t: Suite): void => {
  const program = replayPreProgram(t)
  // detail is what the replay's detail names; "" means it has none.
  const unread = `the value "(root-obj x 1)" is not one the replay reads`
  const rows: PreCase[] = [
    new PreCase("a failed requires at y = -1", "use", 0, "(- 1)", "?", REPLAY_CONFIRMED, ""),
    new PreCase("a failed requires, z3's result", "use", 0, "(- 1)", "(- 0.5)", REPLAY_CONFIRMED, ""),
    new PreCase("a failed requires, a wrong result", "use", 0, "(- 1)", "3", REPLAY_MISMATCH, "not z3's result 3"),
    new PreCase("a failed requires, unreadable", "use", 0, "(- 1)", "(root-obj x 1)", REPLAY_NOT_REPLAYED, unread),
    new PreCase("a met requires at y = 1", "use", 0, "1", "?", REPLAY_MISMATCH, "half's requires"),
    new PreCase("an index past the one call site", "use", 1, "(- 1)", "?", REPLAY_MISMATCH, "records 1 such"),
    new PreCase("the first of two at y = -2", "both", 0, "(- 2)", "?", REPLAY_CONFIRMED, ""),
    new PreCase("the second of two at y = -2", "both", 1, "(- 2)", "?", REPLAY_CONFIRMED, ""),
    new PreCase("the first of two at y = -1/2", "both", 0, "(- 0.5)", "?", REPLAY_CONFIRMED, ""),
    new PreCase("the second of two at y = -1/2", "both", 1, "(- 0.5)", "?", REPLAY_MISMATCH, "half's requires"),
    new PreCase("an index past both call sites", "both", 2, "(- 2)", "?", REPLAY_MISMATCH, "records 2 such"),
    new PreCase("an unknown callee body, z3's result", "flip", 0, "0", "7", REPLAY_CONFIRMED, ""),
    new PreCase("an unknown callee body, no result", "flip", 0, "0", "?", REPLAY_CONFIRMED, ""),
    new PreCase("a known callee body, a wrong result", "flip", 0, "(- 1)", "7", REPLAY_MISMATCH, "not z3's result 7"),
  ]
  for (const row of rows) {
    const fn = replayFnNamed(program, row.fn)
    if (fn === null) {
      t.fail(`${row.label}: ${row.fn} is in the program`, "it is not")
      continue
    }
    const r = replayHazard(program, fn, QUERY_PRE, row.index, replayCex(["y"], [row.y], row.result))
    t.eqStr(`${row.label}: outcome`, r.outcome, row.want)
    if (row.detail !== "") {
      t.contains(`${row.label}: detail`, r.detail, row.detail)
    } else {
      t.eqStr(`${row.label}: no detail`, r.detail, "")
    }
  }
}

// Hazards are numbered in the order script.ts asserts them, guard before
// body and function by function: whatever z3 reports must replay there.
const replayOrderCases = (t: Suite): void => {
  const c = new BCase("order")
  const a = bVar("a")
  const b = bVar("b")
  c.fn(
    "pick",
    1,
    ["a:Real", "b:Real"],
    "Real",
    [bBin(">", bBin("/", a, b), bNum("-100"))],
    [bBin("==", bVar("result"), bVar("result"))],
    bIte(bBin(">", a, bNum("0")), bBin("/", b, bBin("-", a, bNum("1"))), bBin("/", a, bBin("+", b, bNum("3")))),
  )
  c.fn(
    "tail",
    1,
    ["n:Real"],
    "Real",
    replayNone(),
    [bBin("==", bVar("result"), bVar("result"))],
    bBin("/", bNum("1"), bBin("-", bVar("n"), bNum("7"))),
  )
  const program = replayProgram(t, c)
  const solved = solveProgram(program)
  t.ok("order solves", solved.isOk())
  if (solved.isErr()) {
    return
  }
  const report = solved.value
  t.eqI32("every hazard replays clean", replayReport(program, report), 0)
  let seen = 0
  for (const f of report.functions) {
    for (const h of f.divs) {
      if (h.hasCex) {
        seen = seen + 1
        t.eqStr(`${f.name} ${h.pretty}: confirmed`, h.replay, REPLAY_CONFIRMED)
      }
    }
  }
  t.eqI32("four division hazards, each with a counterexample", seen, 4)
}

// The unary operators and min/max, exactly: one function per operator.
const replayOperatorCases = (t: Suite): void => {
  const c = new BCase("ops")
  const x = bVar("x")
  const ops: string[] = ["floor", "ceil", "abs"]
  for (const op of ops) {
    c.fn(op, 1, ["x:Real"], "Real", replayNone(), [bBin("==", bVar("result"), bVar("result"))], bUn(op, x))
  }
  c.fn(
    "lo",
    1,
    ["x:Real"],
    "Real",
    replayNone(),
    [bBin("==", bVar("result"), bVar("result"))],
    bBin("min", x, bNum("1")),
  )
  c.fn(
    "hi",
    1,
    ["x:Real"],
    "Real",
    replayNone(),
    [bBin("==", bVar("result"), bVar("result"))],
    bBin("max", x, bNum("1")),
  )
  const program = replayProgram(t, c)
  if (program.functions.length < 5) {
    return
  }
  const cases: string[][] = [
    ["floor", "(- 1.5)", "-2"],
    ["floor", "1.5", "1"],
    ["floor", "2", "2"],
    ["floor", "(- 2)", "-2"],
    ["ceil", "(/ 1 3)", "1"],
    ["ceil", "(- 1.5)", "-1"],
    ["ceil", "(- 2)", "-2"],
    ["abs", "(- 2)", "2"],
    ["abs", "(/ 1 3)", "1/3"],
    ["abs", "0", "0"],
    ["lo", "(- 5)", "-5"],
    ["lo", "5", "1"],
    ["hi", "(- 5)", "1"],
    ["hi", "5", "5"],
  ]
  for (const row of cases) {
    for (const fn of program.functions) {
      if (fn.name === row[0]) {
        const run = replayEvaluate(program, fn, ["x"], [row[1]])
        t.eqStr(`${fn.name}(${row[1]})`, replayValueText(run.body), row[2])
      }
    }
  }
}

/** One diff witness replay. */
class WitnessCase {
  label: string
  kind: i32
  x: string
  oldResult: string
  newResult: string
  want: string

  constructor(label: string, kind: i32, x: string, oldResult: string, newResult: string, want: string) {
    this.label = label
    this.kind = kind
    this.x = x
    this.oldResult = oldResult
    this.newResult = newResult
    this.want = want
  }
}

// old: f(x) requires x >= 0, = x + 1; new: f(x) requires x >= 1, = x + 2.
const replayVersion = (t: Suite, low: string, add: string): Program => {
  const c = new BCase("versions")
  c.fn(
    "f",
    1,
    ["x:Int"],
    "Int",
    [bBin(">=", bVar("x"), bNum(low))],
    [bBin("==", bVar("result"), bVar("result"))],
    bBin("+", bVar("x"), bNum(add)),
  )
  return replayProgram(t, c)
}

const replayFnOf = (program: Program): FnUnit => program.functions[0]

const replayWitnessCases = (t: Suite): void => {
  const was = replayVersion(t, "0", "1")
  const now = replayVersion(t, "1", "2")
  if (was.functions.length === 0 || now.functions.length === 0) {
    return
  }
  const cases: WitnessCase[] = [
    new WitnessCase("narrowed at 0", REPLAY_NARROWED, "0", "", "", REPLAY_CONFIRMED),
    new WitnessCase("narrowed at 5", REPLAY_NARROWED, "5", "", "", REPLAY_MISMATCH),
    new WitnessCase("widened at 0", REPLAY_WIDENED, "0", "", "", REPLAY_MISMATCH),
    new WitnessCase("value at 5", REPLAY_VALUE, "5", "6", "7", REPLAY_CONFIRMED),
    new WitnessCase("value at 5, no results", REPLAY_VALUE, "5", "?", "?", REPLAY_CONFIRMED),
    new WitnessCase("value at 5, a wrong result", REPLAY_VALUE, "5", "6", "8", REPLAY_MISMATCH),
    new WitnessCase("value at 0, rejected", REPLAY_VALUE, "0", "1", "2", REPLAY_MISMATCH),
    new WitnessCase("value unparseable", REPLAY_VALUE, "(f 1)", "?", "?", REPLAY_NOT_REPLAYED),
  ]
  for (const c of cases) {
    const r = replayWitness(
      was,
      replayFnOf(was),
      now,
      replayFnOf(now),
      c.kind,
      replayCex(["x"], [c.x], "?"),
      c.oldResult,
      c.newResult,
    )
    t.eqStr(`witness ${c.label}`, r.outcome, c.want)
  }
  // Equal results are a mismatch: both versions return x + 1.
  const same = replayVersion(t, "0", "1")
  const eq = replayWitness(
    was,
    replayFnOf(was),
    same,
    replayFnOf(same),
    REPLAY_VALUE,
    replayCex(["x"], ["5"], "?"),
    "",
    "",
  )
  t.eqStr("equal results: mismatch", eq.outcome, REPLAY_MISMATCH)
  t.contains("equal results: detail", eq.detail, "both versions return 6")
}

// A real report on `scale`, its counterexample then forged to one z3 would
// never give: the outcome is MISMATCH and the exit 2.
// tests/verify/mismatch_test.ts drives the same through dist/vector, with a
// z3 that forges its model, for verify and for diff.
const replayVerifyMismatch = (t: Suite): void => {
  const program = replayProgram(t, replayScaleCase())
  const solved = solveProgram(program)
  t.ok("scale solves", solved.isOk())
  if (solved.isErr() || program.functions.length === 0) {
    return
  }
  const report = solved.value
  const verdict = report.functions[0].ensures[0]
  t.ok("scale is refuted with a counterexample", verdict.hasCex)
  t.eqI32("a real counterexample replays clean", replayReport(program, report), 0)
  t.eqStr("a real counterexample is confirmed", verdict.replay, REPLAY_CONFIRMED)

  verdict.cex = replayCex(["x"], ["(- 5)"], "?")
  const out = verifyReportOutcome(program, report, "test", [])
  t.eqStr("a forged counterexample: MISMATCH", out.status, OUTCOME_MISMATCH)
  t.eqI32("MISMATCH exits 2", verifyExitCode(out.status), 2)
  t.eqStr("the verdict records the mismatch", verdict.replay, REPLAY_MISMATCH)
  t.eqI32("one mismatch line", toI32(out.mismatches.length), 1)
  const lines = verifyMismatchLines(report)
  t.contains(
    "the mismatch line",
    lines.length > 0 ? lines[0] : "",
    "MISMATCH  z3's counterexample does not refute scale scale_E0 (result > x) when replayed: this is a bug in vector, not in your program — please report it",
  )
  t.contains("the mismatch line ends with the input", lines.length > 0 ? lines[0] : "", "please report it (x = (- 5): ")
  t.contains("the feedback leads with it", out.feedback, "MISMATCH  z3's counterexample")
  t.eqStr("nothing is emitted on MISMATCH", out.emittedCode, "")
  t.contains("the dashboard's status", out.dashboard, "Status: MISMATCH")
  t.contains("the dashboard's verdict", out.dashboard, "1 COUNTEREXAMPLE(S) DID NOT REPLAY — A BUG IN VECTOR")
  t.contains("the dashboard marks the counterexample", out.dashboard, "✘ DOES NOT REPLAY (a bug in vector)")
  t.ok("the dashboard does not blame the program", out.dashboard.indexOf("CONTRACT VIOLATION") < 0)

  verdict.cex = replayCex(["x"], ["(root-obj x 1)"], "?")
  const unread = verifyReportOutcome(program, report, "test", [])
  t.ok("not-replayed keeps the verdict", unread.status !== OUTCOME_MISMATCH)
  t.eqI32("not-replayed exits 1", verifyExitCode(unread.status), 1)
}

// half(x) requires x >= 0, ensures result * 2 == x; use(y) = half(y),
// ensures result * 2 == y. Every ensures holds, so use's call to half at
// y < 0 is the program's only refutation.
const replayUseOnlyProgram = (t: Suite): Program => {
  const c = new BCase("useonly")
  const twice = bBin("*", bVar("result"), bNum("2"))
  c.fn(
    "half",
    1,
    ["x:Real"],
    "Real",
    [bBin(">=", bVar("x"), bNum("0"))],
    [bBin("==", twice, bVar("x"))],
    bBin("/", bVar("x"), bNum("2")),
  )
  c.fn("use", 2, ["y:Real"], "Real", replayNone(), [bBin("==", twice, bVar("y"))], bCall("half", [bVar("y")]))
  return replayProgram(t, c)
}

// Decided: an unreadable z3 result on a hazard the replay decides (use's
// call to half at y < 0) leaves it not-replayed. The hazard's verdict and
// exit 1 stand, and the replay's reason names the value it could not read.
// The hazard is the program's only refutation, so REFUTED and exit 1 come
// from it and nothing else.
const replayUnreadableHazard = (t: Suite): void => {
  const program = replayUseOnlyProgram(t)
  const solved = solveProgram(program)
  t.ok("useonly solves", solved.isOk())
  if (solved.isErr()) {
    return
  }
  const report = solved.value
  t.eqI32("useonly: one precondition hazard", report.preCount, 1)
  t.eqI32("useonly: no refuted ensures", report.satCount, 0)
  let found = false
  for (const f of report.functions) {
    if (f.name === "use" && f.pres.length > 0 && f.pres[0].hasCex) {
      found = true
      const h = f.pres[0]
      h.cex.result = "(root-obj x 1)"
      const out = verifyReportOutcome(program, report, "test", [])
      t.eqStr("an unreadable result: not replayed", h.replay, REPLAY_NOT_REPLAYED)
      t.contains("an unreadable result: the reason names it", h.replayDetail, `"(root-obj x 1)" is not one`)
      t.eqStr("an unreadable result: the hazard's verdict stands", out.status, OUTCOME_REFUTED)
      t.eqI32("an unreadable result: exits 1", verifyExitCode(out.status), 1)
      t.eqI32("an unreadable result: no mismatch", report.mismatchCount, 0)
      // Were the hazard dropped, the report would look clean and the float64
      // gate would run and refute on its own, so REFUTED alone would not
      // show the hazard stood: it must still count, and the gate not run.
      t.eqI32("an unreadable result: the hazard still counts", report.preCount, 1)
      t.eqI32("an unreadable result: the float64 gate did not run", toI32(report.conformance.length), 0)
      // What verify hands back, not the hazard read above: its items still
      // hold use's call to half, not replayed, at the value it could not
      // read, and its feedback still names the call at z3's input.
      let items = 0
      for (const it of out.items) {
        if (it.fn === "use" && it.issue === "precondition-hazard") {
          items = items + 1
          t.eqStr("an unreadable result: the item calls half", it.axiomId, "(calls half)")
          t.eqStr("an unreadable result: the item is not replayed", it.replay, REPLAY_NOT_REPLAYED)
          t.ok("an unreadable result: the item has the counterexample", it.hasCex)
          t.eqStr("an unreadable result: the item names the value", it.cex.result, "(root-obj x 1)")
        }
      }
      t.eqI32("an unreadable result: verify reports use's hazard once", items, 1)
      t.contains(
        "an unreadable result: the feedback names the call",
        out.feedback,
        "Function use: the call to half can violate its precondition x >= 0 (e.g. y = -1)",
      )
    }
  }
  t.ok("use's call to half is a hazard with a counterexample", found)
}

// A diff verdict with a forged witness: MISMATCH, exit 2.
const replayDiffMismatch = (t: Suite): void => {
  const was = replayVersion(t, "0", "1")
  const now = replayVersion(t, "1", "2")
  const pairing = pairFunctions(was, now)
  t.eqI32("one comparable pair", toI32(pairing.comparable.length), 1)
  const value = replayWitnessAt("5")
  value.hasResults = true
  value.oldResult = "6"
  value.newResult = "7"
  const good = new MatchedFunctionDiff("f", "f(x: Int) -> Int", replayWitnessAt("0"), new DiffCheck("none"), value)
  t.eqI32("real witnesses replay clean", diffReplayWitnesses(was, now, pairing.comparable, [good]), 0)
  t.eqStr("a narrowed witness is confirmed", good.domainNarrowed.replay, REPLAY_CONFIRMED)

  const report = new ProgramDiffReport("versions", "versions")
  report.matched.push(
    new MatchedFunctionDiff(
      "f",
      "f(x: Int) -> Int",
      replayWitnessAt("5"),
      new DiffCheck("none"),
      new DiffCheck("none"),
    ),
  )
  const out = diffDecide(was, now, pairing, report)
  t.eqStr("a forged witness: MISMATCH", out.status, DIFF_MISMATCH)
  t.eqI32("diff MISMATCH exits 2", diffExitCode(out.status), 2)
  t.contains("the summary says so", out.summary, "this is a bug in vector, not in your programs")
}

// A value that depends on a division by zero is not replayed, and the detail
// names that division and the function it is in. The division named is the
// one that divides by zero, not an enclosing one, and not one in an untaken
// branch; a callee's division is named in the callee, and the caller's after
// the call in the caller.
const replayWhyDiv = (what: string, where: string): string =>
  `a value depends on the division by zero ${what} in ${where}, which z3 leaves unspecified`

const replayDivZeroCases = (t: Suite): void => {
  const c = new BCase("divzero")
  const real = ["x:Real"]
  const any = [bBin("==", bVar("result"), bVar("result"))]
  c.fn("inv", 1, real, "Real", replayNone(), any, bBin("/", bNum("1"), bVar("x")))
  c.fn("calls", 2, real, "Real", replayNone(), any, bCall("inv", [bVar("x")]))
  c.fn(
    "after",
    2,
    real,
    "Real",
    replayNone(),
    any,
    bBin("+", bCall("inv", [bBin("+", bVar("x"), bNum("1"))]), bBin("/", bNum("2"), bVar("x"))),
  )
  c.fn(
    "two",
    1,
    real,
    "Real",
    replayNone(),
    any,
    bBin("+", bBin("/", bNum("3"), bVar("x")), bBin("/", bNum("4"), bBin("-", bVar("x"), bNum("1")))),
  )
  c.fn("nested", 1, real, "Real", replayNone(), any, bBin("/", bBin("/", bNum("5"), bVar("x")), bVar("x")))
  c.fn("inner", 1, real, "Real", replayNone(), any, bBin("/", bNum("6"), bBin("/", bNum("7"), bVar("x"))))
  c.fn(
    "guarded",
    1,
    real,
    "Real",
    replayNone(),
    any,
    bIte(bBin("==", bVar("x"), bNum("0")), bNum("0"), bBin("/", bNum("8"), bVar("x"))),
  )
  c.fn("byx", 1, real, "Real", replayNone(), [bBin("==", bBin("/", bVar("result"), bVar("x")), bNum("1"))], bVar("x"))
  const program = replayProgram(t, c)
  // [function, x, the body's value, or why it is not known]
  const rows: string[][] = [
    ["inv", "0", replayWhyDiv("1 / x", "inv")],
    ["inv", "2", "1/2"],
    ["calls", "0", replayWhyDiv("1 / x", "inv")],
    ["after", "0", replayWhyDiv("2 / x", "after")],
    ["after", "-1", replayWhyDiv("1 / x", "inv")],
    ["two", "0", replayWhyDiv("3 / x", "two")],
    ["two", "1", replayWhyDiv("4 / (x - 1)", "two")],
    ["nested", "0", replayWhyDiv("5 / x", "nested")],
    ["inner", "0", replayWhyDiv("7 / x", "inner")],
    ["guarded", "0", "0"],
    ["guarded", "2", "4"],
  ]
  for (const row of rows) {
    const at = programFunctionIndex(program, row[0])
    if (at < 0) {
      t.ok(`${row[0]} is in the program`, false)
      continue
    }
    const run = replayEvaluate(program, program.functions[at], ["x"], [row[1]])
    const got = run.body.known ? replayValueText(run.body) : run.body.why
    t.eqStr(`${row[0]} at x = ${row[1]}`, got, row[2])
  }

  // An ensures clause that divides by zero names the function it belongs to.
  const byx = programFunctionIndex(program, "byx")
  if (byx >= 0 && program.functions[byx].ensures.length > 0) {
    const fn = program.functions[byx]
    const r = replayClause(program, fn, fn.ensures[0], replayCex(["x"], ["0"], "0"))
    t.eqStr("a clause dividing by zero: not replayed", r.outcome, REPLAY_NOT_REPLAYED)
    t.eqStr("a clause dividing by zero: named", r.detail, replayWhyDiv("result / x", "byx"))
  } else {
    t.ok("byx is in the program", false)
  }
}

// A diff witness names the version whose division is by zero.
const replayDivVersion = (t: Suite, body: string): Program => {
  const c = new BCase("versions")
  c.fn("f", 1, ["x:Real"], "Real", replayNone(), [bBin("==", bVar("result"), bVar("result"))], body)
  return replayProgram(t, c)
}

const replayDivZeroWitness = (t: Suite): void => {
  const divides = replayDivVersion(t, bBin("/", bNum("1"), bVar("x")))
  const plain = replayDivVersion(t, bVar("x"))
  if (divides.functions.length === 0 || plain.functions.length === 0) {
    return
  }
  // [the version that divides, how the detail names it, z3's old result, its new result]:
  // the version that does not divide returns x, 0 at the witness.
  const rows: string[][] = [
    ["old", "the old version of f", "1", "0"],
    ["new", "the new version of f", "0", "1"],
  ]
  for (const row of rows) {
    const was = row[0] === "old" ? divides : plain
    const now = row[0] === "old" ? plain : divides
    const r = replayWitness(
      was,
      replayFnOf(was),
      now,
      replayFnOf(now),
      REPLAY_VALUE,
      replayCex(["x"], ["0"], "?"),
      row[2],
      row[3],
    )
    t.eqStr(`the ${row[0]} version divides by zero: not replayed`, r.outcome, REPLAY_NOT_REPLAYED)
    t.eqStr(`the ${row[0]} version divides by zero: named`, r.detail, replayWhyDiv("1 / x", row[1]))
  }
}

// Which outcomes --json explains with replayDetail: the two that did not confirm.
const replayJsonCases = (t: Suite): void => {
  const rows: string[][] = [
    [REPLAY_NOT_REPLAYED, "why", '{\n  "replay": "not-replayed",\n  "replayDetail": "why"\n}'],
    [REPLAY_MISMATCH, "differs", '{\n  "replay": "mismatch",\n  "replayDetail": "differs"\n}'],
    [REPLAY_CONFIRMED, "", '{\n  "replay": "confirmed"\n}'],
    [REPLAY_CONFIRMED, "stray", '{\n  "replay": "confirmed"\n}'],
    ["", "", "{}"],
  ]
  for (let i = 0; i < rows.length; i++) {
    const got = outJsonRender(replayJsonPut(outJsonObject(), rows[i][0], rows[i][1]))
    t.eqStr(`replayJsonPut "${rows[i][0]}"`, got, rows[i][2])
  }
}

export const main = (): i32 => {
  const t = new Suite("verify/replay")
  replayParseCases(t)
  replayClauseCases(t)
  replayHazardCases(t)
  replayPreCases(t)
  replayOrderCases(t)
  replayOperatorCases(t)
  replayWitnessCases(t)
  replayVerifyMismatch(t)
  replayUnreadableHazard(t)
  replayDiffMismatch(t)
  replayJsonCases(t)
  replayDivZeroCases(t)
  replayDivZeroWitness(t)
  return t.done()
}
