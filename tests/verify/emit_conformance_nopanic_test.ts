import { Suite } from "nish/testing"
import { renderDashboard } from "../../src/verify/emit/dashboard"
import { checkConformance, float64Samples } from "../../src/verify/emit/float64"
import {
  EXPR_BINOP,
  EXPR_CALL,
  EXPR_ITE,
  EXPR_NUM,
  EXPR_UNOP,
  EXPR_VAR,
  LangExpr,
  Program,
} from "../../src/verify/lang/ast"
import { ConformanceIssue, VerifyReport } from "../../src/verify/solve/report"
import { BCase, bBin, bNone, bNum, bProgram, bSolve, bUn, bVar } from "./build"

// A malformed expression or witness inside the conformance check is a bug in
// vector: it is recorded as an issue, so the check fails closed, where it used
// to pass the input in silence.

const cfnpNone = (): LangExpr[] => {
  const out: LangExpr[] = []
  return out
}

const cfnpNum = (value: string): LangExpr => new LangExpr(EXPR_NUM, "", value, "", cfnpNone())

const cfnpVar = (name: string): LangExpr => new LangExpr(EXPR_VAR, "", "", name, cfnpNone())

// A node of `kind` with the given operands.
const cfnpNode = (kind: i32, op: string, name: string, args: LangExpr[]): LangExpr =>
  new LangExpr(kind, op, "", name, args)

const cfnpIssues = (issues: ConformanceIssue[]): string => {
  const out: string[] = []
  for (const c of issues) {
    out.push(`${c.kind} ${c.axiomId} ${c.pretty} | ${c.input.result}`)
  }
  return out.join("; ")
}

// How many times `part` occurs in `s`.
const cfnpCount = (s: string, part: string): i32 => {
  let n = 0
  let from = 0
  let at = s.indexOf(part, from)
  while (at >= 0) {
    n = n + 1
    from = at + toI32(part.length)
    at = s.indexOf(part, from)
  }
  return n
}

// g(y) = y and f(x) = |x|, each with a proven ensures, and f's `x >= -1`.
class CfnpCase {
  program: Program
  report: VerifyReport
  ok: boolean

  constructor(t: Suite) {
    const c = new BCase("conform")
    c.fn("g", 1, ["y:Real"], "Real", bNone(), [bBin(">=", bVar("result"), bVar("y"))], bVar("y"))
    c.fn(
      "f",
      2,
      ["x:Real"],
      "Real",
      [bBin(">=", bVar("x"), bNum("-1"))],
      [bBin(">=", bVar("result"), bNum("0"))],
      bUn("abs", bVar("x")),
    )
    const program = bProgram(c.programText())
    const report = bSolve(c)
    this.program = new Program("none")
    this.report = new VerifyReport("none")
    this.ok = false
    if (program.isErr()) {
      t.fail("the conformance program", program.error)
      return
    }
    if (report.isErr()) {
      t.fail("the conformance report", report.error)
      return
    }
    this.program = program.value
    this.report = report.value
    this.ok = true
  }

  // The issues with f's body replaced by `body`.
  withBody(body: LangExpr): string {
    const fn = this.program.functions[1]
    const was = fn.body
    fn.body = body
    const out = cfnpIssues(checkConformance(this.program, this.report))
    fn.body = was
    return out
  }
}

const cfnpBug = (what: string): string => `vector-bug (a bug in vector) ${what} | (a bug in vector: ${what})`

const cfnpBodies = (t: Suite, c: CfnpCase): void => {
  t.eqStr("a well-formed body passes", c.withBody(cfnpNode(EXPR_UNOP, "abs", "", [cfnpVar("x")])), "")
  t.eqStr(
    "a unop with no operand is a bug",
    c.withBody(cfnpNode(EXPR_UNOP, "abs", "", cfnpNone())),
    cfnpBug("abs has 0 of 1 operands"),
  )
  t.eqStr(
    "a binop with one operand is a bug",
    c.withBody(cfnpNode(EXPR_BINOP, "max", "", [cfnpVar("x")])),
    cfnpBug("max has 1 of 2 operands"),
  )
  t.eqStr(
    "a binop with two operands is not",
    c.withBody(cfnpNode(EXPR_BINOP, "max", "", [cfnpVar("x"), cfnpNum("0")])),
    "",
  )
  t.eqStr(
    "an ite with two operands is a bug",
    c.withBody(cfnpNode(EXPR_ITE, "", "", [cfnpVar("x"), cfnpNum("0")])),
    cfnpBug("ite has 2 of 3 operands"),
  )
  t.eqStr("an unbound name is a bug", c.withBody(cfnpVar("z")), cfnpBug("z is unbound"))
  t.eqStr(
    "a call to no function is a bug",
    c.withBody(cfnpNode(EXPR_CALL, "", "h", [cfnpVar("x")])),
    cfnpBug("h is not a function"),
  )
  t.eqStr(
    "a call short of arguments is a bug",
    c.withBody(cfnpNode(EXPR_CALL, "", "g", cfnpNone())),
    cfnpBug("g has 0 of 1 arguments"),
  )
  t.eqStr(
    "a call with its arguments is not",
    c.withBody(cfnpNode(EXPR_CALL, "", "g", [cfnpNode(EXPR_UNOP, "abs", "", [cfnpVar("x")])])),
    "",
  )
  t.eqStr("an unknown kind is a bug", c.withBody(cfnpNode(99, "", "", cfnpNone())), cfnpBug("an expression of kind 99"))
  // Every sample meets the bug, and it is recorded once.
  const once = c.withBody(cfnpNode(EXPR_BINOP, "+", "", [cfnpVar("x")]))
  t.eqI32("a bug is recorded once", cfnpCount(once, "vector-bug"), 1)
}

const cfnpClauses = (t: Suite, c: CfnpCase): void => {
  const fn = c.program.functions[1]
  // An unbound name, since the clause printer reads a binop's two operands.
  const short = cfnpVar("z")

  // In the requires: every sample meets it, so nothing is sampled either.
  const req = fn.requires[0].expr
  fn.requires[0].expr = short
  const inRequires = cfnpIssues(checkConformance(c.program, c.report))
  fn.requires[0].expr = req
  t.eqStr(
    "a malformed requires is a bug, and leaves f unsampled",
    inRequires,
    `${cfnpBug("z is unbound")}; unsampled (requires) z | (no float64 input satisfied the preconditions)`,
  )

  // In the ensures: a bug, not a false postcondition.
  const ens = fn.ensures[0].expr
  fn.ensures[0].expr = short
  const inEnsures = cfnpIssues(checkConformance(c.program, c.report))
  fn.ensures[0].expr = ens
  t.eqStr("a malformed ensures is a bug, not a postcondition", inEnsures, cfnpBug("z is unbound"))
  t.eqStr("the case is clean again", cfnpIssues(checkConformance(c.program, c.report)), "")
}

const cfnpUnpaired = (n: i32, m: i32): string =>
  `vector-bug (a bug in vector) the solver's witness has ${n} names but ${m} values | (a bug in vector: an unpaired witness)`

const cfnpWitness = (t: Suite, c: CfnpCase): void => {
  const witness = c.report.functions[1].witness
  const names = witness.names
  const values = witness.values
  witness.names = ["x"]
  witness.values = ["1"]
  t.eqStr("a paired witness is no issue", cfnpIssues(checkConformance(c.program, c.report)), "")
  const noValues: string[] = []
  witness.values = noValues
  t.eqStr("a witness short of values is a bug", cfnpIssues(checkConformance(c.program, c.report)), cfnpUnpaired(1, 0))
  witness.values = ["1", "2"]
  t.eqStr(
    "a witness with values to spare is a bug",
    cfnpIssues(checkConformance(c.program, c.report)),
    cfnpUnpaired(1, 2),
  )
  witness.names = names
  witness.values = values
}

const cfnpDashboard = (t: Suite, c: CfnpCase): void => {
  const report = new VerifyReport("z")
  report.conformance = checkConformance(c.program, c.report)
  t.ok("a clean dashboard names no bug", renderDashboard("x", report).indexOf("a bug in vector") < 0)
  const was = c.program.functions[1].body
  c.program.functions[1].body = cfnpNode(EXPR_UNOP, "abs", "", cfnpNone())
  report.conformance = checkConformance(c.program, c.report)
  c.program.functions[1].body = was
  t.contains(
    "the dashboard names a bug in vector",
    renderDashboard("x", report),
    "✘ f not conformance-checked, a bug in vector:",
  )
}

// Edge rows for the sampler: no parameters, and products of the pools on
// either side of the 2000 cap.
const cfnpEdges = (t: Suite): void => {
  const c = new BCase("edges")
  const noParams: string[] = []
  c.fn("k", 1, noParams, "Real", bNone(), [bBin(">=", bVar("result"), bNum("0"))], bNum("1"))
  c.fn("two", 1, ["x:Real", "y:Real"], "Real", bNone(), [bBin(">=", bVar("result"), bVar("x"))], bVar("x"))
  c.fn("three", 1, ["x:Real", "y:Real", "b:Bool"], "Real", bNone(), [bBin(">=", bVar("result"), bVar("x"))], bVar("x"))
  const program = bProgram(c.programText())
  const report = bSolve(c)
  if (program.isErr()) {
    t.fail("the edge program", program.error)
    return
  }
  if (report.isErr()) {
    t.fail("the edge report", report.error)
    return
  }
  const fns = program.value.functions
  t.eqI32("no parameters: one empty sample and the random draws", toI32(float64Samples(fns[0]).length), 401)
  t.eqStr("no parameters conforms", cfnpIssues(checkConformance(program.value, report.value)), "")
  t.eqI32("a product of 1024 is sampled in full", toI32(float64Samples(fns[1]).length), 1424)
  t.eqI32("a product of 2048 is sampled at random", toI32(float64Samples(fns[2]).length), 2400)
}

export const main = (): i32 => {
  const t = new Suite("verify/emit-conformance-nopanic")
  const c = new CfnpCase(t)
  if (c.ok) {
    cfnpBodies(t, c)
    cfnpClauses(t, c)
    cfnpWitness(t, c)
    cfnpDashboard(t, c)
  }
  cfnpEdges(t)
  return t.done()
}
