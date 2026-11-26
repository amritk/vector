import { Suite } from "nish/testing"
import {
  F64Env,
  checkConformance,
  f64Render,
  findFloat64Delta,
  float64Outcome,
  float64ParseModel,
  float64Samples,
} from "../../src/verify/emit/float64"
import {
  EXPR_BINOP,
  EXPR_ITE,
  EXPR_NUM,
  EXPR_UNOP,
  EXPR_VAR,
  FnUnit,
  LangExpr,
  LangParam,
  Program,
} from "../../src/verify/lang/ast"
import { ConformanceIssue } from "../../src/verify/solve/report"
import { BCase, bBin, bIte, bNone, bNum, bProgram, bSolve, bUn, bVar } from "./build"

// The rewrites that took the panic sites out of float64: inputs the old code
// panicked on now answer as a missing name does, and every other input gives
// the samples, counts and values the old code gave.

const f64npNone = (): LangExpr[] => {
  const out: LangExpr[] = []
  return out
}

const f64npNum = (value: string): LangExpr => new LangExpr(EXPR_NUM, "", value, "", f64npNone())

const f64npVar = (name: string): LangExpr => new LangExpr(EXPR_VAR, "", "", name, f64npNone())

// A one-parameter function `f(x: Real)` with the given body.
const f64npFn = (body: LangExpr): FnUnit => {
  const fn = new FnUnit("f", 1, "", "Real", body)
  fn.params.push(new LangParam("x", "Real"))
  return fn
}

const f64npOne = (x: string): F64Env => {
  const env = new F64Env()
  env.setNum("x", parseFloat(x))
  return env
}

const f64npEnv = (env: F64Env): string => {
  const parts: string[] = []
  for (let i = 0; i < toI32(env.names.length) && i < toI32(env.vals.length); i++) {
    parts.push(`${env.names[i]}=${f64Render(env.vals[i])}`)
  }
  return parts.join(",")
}

const f64npEnvs = (t: Suite): void => {
  const program = new Program("p")
  const fn = f64npFn(f64npVar("x"))
  program.functions.push(fn)
  t.eqStr("float64Outcome of x", float64Outcome(program, fn, f64npOne("2")), "2")

  // A name pushed with no value is unbound: the domain guard refuses it.
  const bare = new F64Env()
  bare.names.push("x")
  t.eqStr("float64Outcome: a name with no value is unbound", float64Outcome(program, fn, bare), "throws")
  t.eqI32("copy drops a name with no value", toI32(bare.copy().names.length), 0)
  bare.setNum("x", parseFloat("3"))
  t.eqStr("set on a name with no value binds it", float64Outcome(program, fn, bare), "3")
  t.eqI32("set binds a name with no value once", toI32(bare.vals.length), 1)

  // A variable that is no parameter, its value missing, throws in the body.
  const yFn = f64npFn(f64npVar("y"))
  const yProgram = new Program("q")
  yProgram.functions.push(yFn)
  const half = f64npOne("1")
  half.names.push("y")
  t.eqStr("float64Outcome: a body variable with no value throws", float64Outcome(yProgram, yFn, half), "throws")
  t.eqStr("copy keeps the names with values", f64npEnv(half.copy()), "x=1")
  const both = half.copy()
  both.setNum("y", parseFloat("4"))
  t.eqStr("float64Outcome: the body variable once bound", float64Outcome(yProgram, yFn, both), "4")
}

// Each operator short of an operand throws, as a missing name does; with
// its operands it computes.
const f64npArgs = (t: Suite): void => {
  const x = f64npVar("x")
  const none = f64npNone()
  const one: LangExpr[] = [x]
  const two: LangExpr[] = [x, f64npNum("1")]
  const gt = new LangExpr(EXPR_BINOP, ">", "", "", two)
  const cond: LangExpr[] = [gt, x]
  const all: LangExpr[] = [gt, x, f64npNum("7")]
  const shorts: LangExpr[] = [
    new LangExpr(EXPR_UNOP, "neg", "", "", none),
    new LangExpr(EXPR_BINOP, "+", "", "", one),
    new LangExpr(EXPR_ITE, "", "", "", cond),
  ]
  const fulls: LangExpr[] = [
    new LangExpr(EXPR_UNOP, "neg", "", "", one),
    new LangExpr(EXPR_BINOP, "+", "", "", two),
    new LangExpr(EXPR_ITE, "", "", "", all),
  ]
  const names: string[] = ["neg", "+", "ite"]
  const values: string[] = ["-2", "3", "2"]
  const program = new Program("p")
  for (let i = 0; i < 3; i++) {
    const shortFn = f64npFn(shorts[i])
    const fullFn = f64npFn(fulls[i])
    t.eqStr(`${names[i]} short of an operand throws`, float64Outcome(program, shortFn, f64npOne("2")), "throws")
    t.eqStr(`${names[i]} with its operands`, float64Outcome(program, fullFn, f64npOne("2")), values[i])
  }
  // The else branch is the third operand.
  t.eqStr("ite takes its third operand", float64Outcome(program, f64npFn(fulls[2]), f64npOne("0")), "7")
}

const f64npParse = (t: Suite): void => {
  const texts: string[] = [
    "",
    "-",
    "/",
    "1/",
    "/2",
    "1/2/3",
    "-1/2/3",
    "-7/2",
    "12/4",
    "-0",
    "1.5",
    "-1.5/2",
    "3/1.5",
    "1..2",
    "1.2.3",
    "1.2/3.4.5",
    ".5",
    "5.",
    "--1",
    "1/0",
    "007",
  ]
  const want: string[] = [
    "NaN",
    "NaN",
    "NaN",
    "NaN",
    "NaN",
    "NaN",
    "NaN",
    "-3.5",
    "3",
    "0",
    "1.5",
    "-0.75",
    "2",
    "NaN",
    "NaN",
    "NaN",
    "NaN",
    "NaN",
    "NaN",
    "NaN",
    "7",
  ]
  for (let i = 0; i < toI32(texts.length) && i < toI32(want.length); i++) {
    t.eqStr(`float64ParseModel "${texts[i]}"`, `${float64ParseModel(texts[i])}`, want[i])
  }
}

// Sample counts, orders and comparison counts, as the old code gave them.
const f64npSamples = (t: Suite): void => {
  const c = new BCase("s")
  const x = bVar("x")
  const same: string[] = [bBin("==", bVar("result"), bVar("result"))]
  c.fn("f1", 1, ["x:Real"], "Real", bNone(), same, bBin("-", bBin("*", x, x), bNum("1")))
  c.fn("f2", 1, ["n:Int", "b:Bool"], "Int", bNone(), same, bIte(bVar("b"), bVar("n"), bUn("neg", bVar("n"))))
  c.fn("f3", 1, ["x:Real", "y:Real", "z:Real"], "Real", bNone(), same, bBin("+", x, bBin("*", bVar("y"), bVar("z"))))
  c.fn("f6", 1, ["x:Real", "y:Real"], "Real", bNone(), same, bBin("+", x, bVar("y")))
  const d = new BCase("d")
  d.fn(
    "f6",
    1,
    ["x:Real", "y:Real"],
    "Real",
    bNone(),
    same,
    bIte(bBin(">", bVar("y"), bNum("1000.5")), bNum("0"), bBin("+", x, bVar("y"))),
  )
  const program = bProgram(c.programText())
  const changed = bProgram(d.programText())
  if (program.isErr()) {
    t.fail("the sample program", program.error)
    return
  }
  if (changed.isErr()) {
    t.fail("the changed program", changed.error)
    return
  }
  const fns = program.value.functions
  const f1 = float64Samples(fns[0])
  t.eqI32("f1 samples", toI32(f1.length), 432)
  t.eqStr("f1 first sample", f64npEnv(f1[0]), "x=0")
  t.eqStr("f1 sixth sample", f64npEnv(f1[5]), "x=0.5")
  const f2 = float64Samples(fns[1])
  t.eqI32("f2 samples", toI32(f2.length), 438)
  t.eqStr("f2 first sample", f64npEnv(f2[0]), "n=0,b=true")
  t.eqStr("f2: the first parameter varies fastest", f64npEnv(f2[1]), "n=1,b=true")
  const f3 = float64Samples(fns[2])
  t.eqI32("f3 samples", toI32(f3.length), 2400)
  t.eqStr("f3 first random sample", f64npEnv(f3[0]), "x=0,y=0,z=0.01")
  t.eqStr("f3 second random sample", f64npEnv(f3[1]), "x=-1,y=0.25,z=0.5")
  const none: string[] = []
  t.eqI32("f1 compared", findFloat64Delta(program.value, fns[0], program.value, fns[0], none).compared, 7949)
  const seed: string[] = ["-1/3", "false"]
  const f6 = fns[3]
  t.eqI32("f6 compared with a seed", findFloat64Delta(program.value, f6, program.value, f6, seed).compared, 18743)
  const delta = findFloat64Delta(program.value, f6, changed.value, changed.value.functions[0], none)
  t.ok("f6 delta found", delta.found)
  t.eqI32("f6 delta compared", delta.compared, 641)
  t.eqStr("f6 delta input", delta.inputs.values.join(","), "0,1000000")
}

const f64npIssues = (issues: ConformanceIssue[]): string => {
  const out: string[] = []
  for (const c of issues) {
    out.push(`${c.kind} ${c.axiomId} ${c.input.names.join(",")}=${c.input.values.join(",")}`)
  }
  return out.join("; ")
}

// A witness short of values seeds nothing, as a witness without the name.
const f64npWitness = (t: Suite): void => {
  const gap = new BCase("gap")
  const x = bVar("x")
  gap.fn(
    "addTenths",
    1,
    ["x:Real"],
    "Real",
    bNone(),
    [bBin("==", bVar("result"), bBin("+", x, bNum("0.3")))],
    bBin("+", bBin("+", x, bNum("0.1")), bNum("0.2")),
  )
  const program = bProgram(gap.programText())
  const report = bSolve(gap)
  if (program.isErr()) {
    t.fail("the witness program", program.error)
    return
  }
  if (report.isErr()) {
    t.fail("the witness report", report.error)
    return
  }
  const witness = report.value.functions[0].witness
  witness.names = ["y"]
  witness.values = ["5"]
  const missing = f64npIssues(checkConformance(program.value, report.value))
  witness.names = ["x"]
  witness.values = []
  const short = f64npIssues(checkConformance(program.value, report.value))
  t.ok("a witness without the name finds the gap", missing.indexOf("addTenths_E0") >= 0)
  t.eqStr(
    "a witness short of values is a bug, and seeds as a missing name",
    short,
    `vector-bug (a bug in vector) =; ${missing}`,
  )
  witness.values = ["5"]
  t.ok("a witness with its value finds the gap", f64npIssues(checkConformance(program.value, report.value)) !== "")
}

export const main = (): i32 => {
  const t = new Suite("verify/emit-float64-nopanic")
  f64npEnvs(t)
  f64npArgs(t)
  f64npParse(t)
  f64npSamples(t)
  f64npWitness(t)
  return t.done()
}
