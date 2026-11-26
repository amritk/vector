import { Suite } from "nish/testing"
import { QueryAnswer } from "../../src/core/smt"
import { LangExpr, Program } from "../../src/verify/lang/ast"
import {
  QUERY_DIV,
  QUERY_ENSURES,
  QUERY_PRE,
  QUERY_RANGE,
  QUERY_REACHABLE,
  QUERY_TRIVIAL,
  SmtQuery,
} from "../../src/verify/smt/script"
import {
  REPLAY_CONFIRMED,
  REPLAY_NARROWED,
  REPLAY_NOT_REPLAYED,
  replayClause,
  replayEvaluate,
  replayWitness,
} from "../../src/verify/solve/replay"
import {
  CLAUSE_PROVEN,
  CLAUSE_REFUTED,
  CLAUSE_UNKNOWN,
  ClauseVerdict,
  Counterexample,
  assembleReport,
} from "../../src/verify/solve/report"
import { BCase, bBin, bCall, bIte, bNum, bProgram, bUn, bVar } from "./build"

// The guards that keep src/verify/solve from panicking on a malformed
// program, query list or counterexample: each fails loudly, never open.

const guardNone = (): string[] => {
  const none: string[] = []
  return none
}

const guardTrue = (): string[] => [bBin("==", bVar("result"), bVar("result"))]

const guardProgram = (t: Suite, c: BCase): Program => {
  const program = bProgram(c.programText())
  t.eqStr(`${c.name} builds`, program.isOk() ? "" : program.error, "")
  return program.isOk() ? program.value : new Program(c.name)
}

const guardCex = (names: string[], values: string[], result: string): Counterexample => {
  const cex = new Counterexample(result)
  for (const n of names) {
    cex.names.push(n)
  }
  for (const v of values) {
    cex.values.push(v)
  }
  return cex
}

// One body whose root expression loses operands before it is replayed.
class ArityCase {
  label: string
  body: string
  drop: i32
  want: string

  constructor(label: string, body: string, drop: i32, want: string) {
    this.label = label
    this.body = body
    this.drop = drop
    this.want = want
  }
}

const guardArity = (t: Suite): void => {
  const x = bVar("x")
  const cases: ArityCase[] = [
    new ArityCase("a whole unop", bUn("neg", x), 0, ""),
    new ArityCase("a unop with none", bUn("neg", x), 1, "has 0 operand(s), not the 1"),
    new ArityCase("a whole binop", bBin("+", x, bNum("1")), 0, ""),
    new ArityCase("a binop with one", bBin("+", x, bNum("1")), 1, "has 1 operand(s), not the 2"),
    new ArityCase("a binop with none", bBin("+", x, bNum("1")), 2, "has 0 operand(s), not the 2"),
    new ArityCase("a whole ite", bIte(bBin(">", x, bNum("0")), x, bNum("0")), 0, ""),
    new ArityCase("an ite with two", bIte(bBin(">", x, bNum("0")), x, bNum("0")), 1, "has 2 operand(s), not the 3"),
  ]
  for (const c of cases) {
    const b = new BCase("arity")
    b.fn("arity", 1, ["x:Int"], "Int", guardNone(), guardTrue(), c.body)
    const program = guardProgram(t, b)
    if (program.functions.length === 0) {
      continue
    }
    const fn = program.functions[0]
    const args: LangExpr[] = fn.body.args
    for (let i = 0; i < c.drop; i++) {
      args.pop()
    }
    const run = replayEvaluate(program, fn, ["x"], ["3"])
    t.eqStr(`${c.label}: unbound`, run.unbound, "")
    if (c.want === "") {
      t.ok(`${c.label}: known`, run.body.known)
    } else {
      t.ok(`${c.label}: unknown`, !run.body.known)
      t.contains(`${c.label}: why`, run.body.why, c.want)
    }
  }
}

const guardCallArity = (t: Suite): void => {
  // A call whose arguments are cut or padded after typechecking.
  const rows: i32[] = [0, -1, 1]
  for (const delta of rows) {
    const b = new BCase("calls")
    b.fn("inc", 1, ["x:Int"], "Int", guardNone(), guardTrue(), bBin("+", bVar("x"), bNum("1")))
    b.fn("outer", 2, ["x:Int"], "Int", guardNone(), guardTrue(), bCall("inc", [bVar("x")]))
    const program = guardProgram(t, b)
    if (program.functions.length < 2) {
      continue
    }
    const fn = program.functions[1]
    const args: LangExpr[] = fn.body.args
    if (delta < 0) {
      args.pop()
    } else if (delta > 0) {
      args.push(fn.body)
    }
    const run = replayEvaluate(program, fn, ["x"], ["3"])
    if (delta === 0) {
      t.ok("a call with its arguments: known", run.body.known)
    } else {
      t.ok(`a call with ${1 + delta} argument(s): unknown`, !run.body.known)
      t.contains(`a call with ${1 + delta} argument(s): why`, run.body.why, `has ${1 + delta} argument(s), not 1`)
    }
  }
}

const guardByName = (t: Suite): void => {
  const b = new BCase("scale")
  b.fn("scale", 1, ["x:Int"], "Int", guardNone(), [bBin("==", bVar("result"), bVar("x"))], bVar("x"))
  const program = guardProgram(t, b)
  if (program.functions.length === 0) {
    return
  }
  const fn = program.functions[0]
  const clause = fn.ensures[0]
  const paired = replayClause(program, fn, clause, guardCex(["x"], ["2"], "3"))
  t.eqStr("a paired counterexample replays", paired.outcome, "mismatch")
  const short = replayClause(program, fn, clause, guardCex(["x"], guardNone(), "3"))
  t.eqStr("a name with no value: not replayed", short.outcome, REPLAY_NOT_REPLAYED)
  t.contains("a name with no value: detail", short.detail, "1 name(s) and 0 value(s)")
  const long = replayClause(program, fn, clause, guardCex(guardNone(), ["2"], "3"))
  t.eqStr("a value with no name: not replayed", long.outcome, REPLAY_NOT_REPLAYED)
  t.contains("a value with no name: detail", long.detail, "0 name(s) and 1 value(s)")

  const witness = replayWitness(program, fn, program, fn, REPLAY_NARROWED, guardCex(["x"], ["2"], ""), "", "")
  t.ok("a paired witness is replayed", witness.outcome !== REPLAY_NOT_REPLAYED)
  const unpaired = replayWitness(program, fn, program, fn, REPLAY_NARROWED, guardCex(["x"], guardNone(), ""), "", "")
  t.eqStr("an unpaired witness: not replayed", unpaired.outcome, REPLAY_NOT_REPLAYED)
  t.contains("an unpaired witness: detail", unpaired.detail, "1 name(s) and 0 value(s)")
  t.ok("confirmed is not the outcome of a mismatch", REPLAY_CONFIRMED !== paired.outcome)
}

// One list of queries, with one answer each, and the counts it must assemble to.
class ReportCase {
  label: string
  queries: SmtQuery[]
  answers: string[]
  total: i32
  unsat: i32
  sat: i32
  unknown: i32
  trivial: i32

  constructor(
    label: string,
    queries: SmtQuery[],
    answers: string[],
    total: i32,
    unsat: i32,
    sat: i32,
    unknown: i32,
    trivial: i32,
  ) {
    this.label = label
    this.queries = queries
    this.answers = answers
    this.total = total
    this.unsat = unsat
    this.sat = sat
    this.unknown = unknown
    this.trivial = trivial
  }
}

const guardQ = (kind: i32, fnIndex: i32, clauseIndex: i32): SmtQuery =>
  new SmtQuery(kind, fnIndex, "id", clauseIndex, "p", "")

const guardReport = (t: Suite): void => {
  const b = new BCase("one")
  b.fn("one", 1, ["x:Int"], "Int", guardNone(), [bBin("==", bVar("result"), bVar("x"))], bVar("x"))
  const program = guardProgram(t, b)
  const E = QUERY_ENSURES
  const T = QUERY_TRIVIAL
  const cases: ReportCase[] = [
    new ReportCase("a proven clause", [guardQ(E, 0, 0)], ["unsat"], 1, 1, 0, 0, 0),
    new ReportCase("no such function, past the end", [guardQ(E, 1, 0)], ["unsat"], 1, 0, 0, 1, 0),
    new ReportCase("no such function, negative", [guardQ(E, -1, 0)], ["unsat"], 1, 0, 0, 1, 0),
    new ReportCase("a reachability query of no function", [guardQ(QUERY_REACHABLE, 1, -1)], ["sat"], 1, 0, 0, 1, 0),
    new ReportCase("a hazard query of no function", [guardQ(QUERY_DIV, 1, -1)], ["sat"], 1, 0, 0, 1, 0),
    new ReportCase("a proof of no clause, past the end", [guardQ(E, 0, 1)], ["unsat"], 1, 0, 0, 1, 0),
    new ReportCase("a proof of no clause, negative", [guardQ(E, 0, -1)], ["unsat"], 1, 0, 0, 1, 0),
    new ReportCase("a refutation of no clause", [guardQ(E, 0, 1)], ["sat"], 1, 0, 1, 0, 0),
    new ReportCase("a trivial clause", [guardQ(T, 0, 0), guardQ(E, 0, 0)], ["unsat", "unsat"], 1, 1, 0, 0, 1),
    new ReportCase(
      "a trivial query of no clause",
      [guardQ(T, 0, 1), guardQ(E, 0, 0)],
      ["unsat", "unsat"],
      2,
      1,
      0,
      1,
      0,
    ),
    new ReportCase("a negative trivial query", [guardQ(T, 0, -1)], ["unknown"], 1, 0, 0, 1, 0),
    new ReportCase("a sat trivial query of no clause", [guardQ(T, 0, 1)], ["sat"], 0, 0, 0, 0, 0),
    new ReportCase("an unanswered query", [guardQ(E, 0, 0)], guardNone(), 1, 0, 0, 1, 0),
  ]
  for (const c of cases) {
    const answers: QueryAnswer[] = []
    for (const a of c.answers) {
      answers.push(new QueryAnswer(a))
    }
    const r = assembleReport(program, c.queries, answers, "z3")
    t.eqI32(`${c.label}: total`, r.totalVcs, c.total)
    t.eqI32(`${c.label}: proven`, r.unsatCount, c.unsat)
    t.eqI32(`${c.label}: refuted`, r.satCount, c.sat)
    t.eqI32(`${c.label}: unknown`, r.unknownCount, c.unknown)
    t.eqI32(`${c.label}: trivial`, r.trivialCount, c.trivial)
    t.ok(`${c.label}: ok`, r.ok() === (c.unknown === 0 && c.sat === 0 && c.trivial === 0))
  }
  // An unsat proof of a clause the function lacks is listed as undecided.
  const r = assembleReport(program, [guardQ(E, 0, 1)], [new QueryAnswer("unsat")], "z3")
  const listed = r.functions.length > 0 && r.functions[0].ensures.length > 0 ? r.functions[0].ensures[0].status : ""
  t.eqStr("a proof of no clause is listed unknown", listed, CLAUSE_UNKNOWN)
  const p = assembleReport(
    program,
    [guardQ(E, 0, 0), guardQ(E, 0, 1)],
    [new QueryAnswer("unsat"), new QueryAnswer("sat")],
    "z3",
  )
  const none: ClauseVerdict[] = []
  const fr = p.functions.length > 0 ? p.functions[0].ensures : none
  t.eqStr("a proof is listed proven", fr.length > 0 ? fr[0].status : "", CLAUSE_PROVEN)
  t.eqStr("a refutation is listed refuted", fr.length > 1 ? fr[1].status : "", CLAUSE_REFUTED)
  // Each hazard kind counts its own queries.
  const hz = assembleReport(
    program,
    [
      guardQ(QUERY_DIV, 0, -1),
      guardQ(QUERY_DIV, 0, -1),
      guardQ(QUERY_PRE, 0, -1),
      guardQ(QUERY_RANGE, 0, -1),
      guardQ(QUERY_RANGE, 0, -1),
    ],
    [
      new QueryAnswer("sat"),
      new QueryAnswer("sat"),
      new QueryAnswer("sat"),
      new QueryAnswer("unsat"),
      new QueryAnswer("sat"),
    ],
    "z3",
  )
  if (hz.functions.length > 0) {
    const h = hz.functions[0]
    t.eqStr(
      "hazard indexes",
      `${h.divs.length > 1 ? h.divs[1].index : -1} ${h.pres.length > 0 ? h.pres[0].index : -1} ${h.ranges.length > 0 ? h.ranges[0].index : -1}`,
      "1 0 1",
    )
  }
}

export const main = (): i32 => {
  const t = new Suite("verify/solve_guard")
  guardArity(t)
  guardCallArity(t)
  guardByName(t)
  guardReport(t)
  return t.done()
}
