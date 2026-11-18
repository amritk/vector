import { Suite } from "nish/testing"
import { split } from "nish/text"
import { verifyExitCode } from "../../src/cli/verify"
import { Program } from "../../src/verify/lang/ast"
import { REPLAY_NOT_REPLAYED } from "../../src/verify/solve/replay"
import { VerifyReport, solveProgram } from "../../src/verify/solve/report"
import { OUTCOME_PROVEN, OUTCOME_REFUTED, verifyReportOutcome } from "../../src/verify/verify"
import { BCase, bBin, bCall, bIte, bNum, bProgram, bVar } from "./build"

// What the dashboard says of half's guard `x >= 0` at its internal call
// sites, for each set of callers. It says "proven to hold at every internal
// call site" only when no caller's precondition hazard stands, and otherwise
// names each caller whose call stands, once.

const guardNone = (): string[] => {
  const none: string[] = []
  return none
}

const guardNonNegative = (name: string): string[] => {
  const req: string[] = [bBin(">=", bVar(name), bNum("0"))]
  return req
}

/** One program: half and the callers a row adds. */
class GuardCase {
  name: string
  /** The program's name, an identifier. */
  slug: string
  /** Each caller: `name`, its requires and its body. */
  callers: string[]
  requires: string[][]
  bodies: string[]
  ensures: string[]
  /** What the dashboard's line under half says after "enforced at runtime; ". */
  want: string
  status: string

  constructor(name: string, slug: string, want: string, status: string) {
    this.name = name
    this.slug = slug
    this.callers = []
    this.requires = []
    this.bodies = []
    this.ensures = []
    this.want = want
    this.status = status
  }

  caller(name: string, requires: string[], body: string, ensures: string): GuardCase {
    this.callers.push(name)
    this.requires.push(requires)
    this.bodies.push(body)
    this.ensures.push(ensures)
    return this
  }
}

const guardProgram = (t: Suite, gc: GuardCase): Program => {
  const c = new BCase(gc.slug)
  c.fn(
    "half",
    1,
    ["x:Real"],
    "Real",
    guardNonNegative("x"),
    [bBin("<=", bVar("result"), bVar("x"))],
    bBin("/", bVar("x"), bNum("2")),
  )
  for (let i = 0; i < toI32(gc.callers.length); i++) {
    const ens: string[] = [gc.ensures[i]]
    c.fn(gc.callers[i], 2, ["y:Real"], "Real", gc.requires[i], ens, gc.bodies[i])
  }
  const program = bProgram(c.programText())
  t.eqStr(`${gc.name} builds`, program.isOk() ? "" : program.error, "")
  return program.isOk() ? program.value : new Program(gc.slug)
}

// The dashboard's line under half, joined back from its wrapped rows.
const guardLine = (dashboard: string): string => {
  const rows = split(dashboard, "\n")
  let line = ""
  let inHalf = false
  for (const row of rows) {
    if (row.indexOf("LAYER 1 · half") >= 0) {
      inHalf = true
    } else if (row.indexOf("LAYER ") >= 0 || row.indexOf("╟") >= 0 || row.indexOf("╠") >= 0) {
      inHalf = false
    }
    if (!inHalf) {
      continue
    }
    // `║   text   ║`: the text, without the frame or the padding.
    const bar = "║"
    let text = row.substring(bar.length, row.length - bar.length)
    while (text.length > 0 && text.charCodeAt(text.length - 1) === 32) {
      text = text.substring(0, text.length - 1)
    }
    while (text.length > 0 && text.charCodeAt(0) === 32) {
      text = text.substring(1, text.length)
    }
    if (text.indexOf("⚠ guard") === 0) {
      line = text
    } else if (line.length > 0) {
      line = `${line} ${text}`
    }
  }
  return line
}

const guardCheck = (t: Suite, gc: GuardCase, program: Program, report: VerifyReport): void => {
  const out = verifyReportOutcome(program, report, gc.name, [])
  t.eqStr(`${gc.name}: status`, out.status, gc.status)
  t.eqI32(`${gc.name}: exit`, verifyExitCode(out.status), gc.status === OUTCOME_PROVEN ? 0 : 1)
  t.eqStr(`${gc.name}: half's guard line`, guardLine(out.dashboard), `⚠ guard x >= 0 enforced at runtime; ${gc.want}`)
}

const guardHalf = (v: string): string => bCall("half", [bVar(v)])

// The result is at most the input, through any caller: unlike twice the
// result being the input, it holds in float64 too, where x / 2 rounds.
const guardDoubles = (): string => bBin("<=", bVar("result"), bVar("y"))

const guardCases = (t: Suite): void => {
  const proven = "proven to hold at every internal call site"
  const ite = bIte(bBin(">=", bVar("y"), bNum("0")), guardHalf("y"), bNum("0"))
  // half(y) + half(y - 1) is y - 1/2.
  const pair = bBin("+", guardHalf("y"), bCall("half", [bBin("-", bVar("y"), bNum("1"))]))
  const pairEnsures = guardDoubles()
  const cases: GuardCase[] = [
    new GuardCase("no caller", "nocaller", proven, OUTCOME_PROVEN),
    new GuardCase("a guarded caller", "guarded", proven, OUTCOME_PROVEN).caller(
      "safe",
      guardNonNegative("y"),
      guardHalf("y"),
      guardDoubles(),
    ),
    new GuardCase("an ite-guarded caller", "iteguarded", proven, OUTCOME_PROVEN).caller(
      "pick",
      guardNone(),
      ite,
      bBin(">=", bVar("result"), bNum("0")),
    ),
    new GuardCase("one unguarded caller", "unguarded", "not proven at the call from use", OUTCOME_REFUTED).caller(
      "use",
      guardNone(),
      guardHalf("y"),
      guardDoubles(),
    ),
    new GuardCase("an unguarded and a guarded caller", "mixed", "not proven at the call from use", OUTCOME_REFUTED)
      .caller("safe", guardNonNegative("y"), guardHalf("y"), guardDoubles())
      .caller("use", guardNone(), guardHalf("y"), guardDoubles()),
    new GuardCase("two unguarded callers", "twocallers", "not proven at the calls from use, also", OUTCOME_REFUTED)
      .caller("use", guardNone(), guardHalf("y"), guardDoubles())
      .caller("also", guardNone(), guardHalf("y"), guardDoubles()),
    new GuardCase("one caller calling twice", "callstwice", "not proven at the call from both", OUTCOME_REFUTED).caller(
      "both",
      guardNone(),
      pair,
      pairEnsures,
    ),
  ]
  for (const gc of cases) {
    const program = guardProgram(t, gc)
    const solved = solveProgram(program)
    t.ok(`${gc.name} solves`, solved.isOk())
    if (solved.isOk()) {
      guardCheck(t, gc, program, solved.value)
    }
  }
}

// A hazard that stands without a replayed counterexample still stands: one
// whose z3 value cannot be read (not replayed), and one z3 left undecided
// (no counterexample at all). Neither may let the guard read as proven.
const guardUnreplayed = (t: Suite): void => {
  for (const undecided of [false, true]) {
    const name = undecided ? "an undecided call" : "a not-replayed call"
    const slug = undecided ? "undecided" : "notreplayed"
    const gc = new GuardCase(name, slug, "not proven at the call from use", OUTCOME_REFUTED).caller(
      "use",
      guardNone(),
      guardHalf("y"),
      guardDoubles(),
    )
    const program = guardProgram(t, gc)
    const solved = solveProgram(program)
    t.ok(`${name} solves`, solved.isOk())
    if (solved.isErr()) {
      continue
    }
    const report = solved.value
    let found = false
    for (const f of report.functions) {
      if (f.name === "use" && f.pres.length > 0) {
        found = true
        if (undecided) {
          f.pres[0].hasCex = false
        } else {
          f.pres[0].cex.result = "(root-obj x 1)"
        }
      }
    }
    t.ok(`${name}: use holds a hazard`, found)
    guardCheck(t, gc, program, report)
    if (!undecided) {
      for (const f of report.functions) {
        if (f.name === "use" && f.pres.length > 0) {
          t.eqStr(`${name}: not replayed`, f.pres[0].replay, REPLAY_NOT_REPLAYED)
        }
      }
    }
  }
}

export const main = (): i32 => {
  const t = new Suite("verify/guard")
  guardCases(t)
  guardUnreplayed(t)
  return t.done()
}
