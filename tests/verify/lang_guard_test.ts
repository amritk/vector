import { Suite } from "nish/testing"
import { newJsonDocument, parseJson } from "../../src/core/json"
import {
  EXPR_BINOP,
  EXPR_CALL,
  EXPR_ITE,
  EXPR_NUM,
  EXPR_UNOP,
  EXPR_VAR,
  FnUnit,
  LangClause,
  LangExpr,
  LangParam,
  PlanUnit,
  Program,
  SpecPlan,
} from "../../src/verify/lang/ast"
import { checkSpecProgramConsistency, typecheckProgram } from "../../src/verify/lang/check"
import { prettyMath, prettyTs } from "../../src/verify/lang/pretty"
import { langRoundTrips, readProgram } from "../../src/verify/lang/read"
import { collectStyleWarnings } from "../../src/verify/lang/style"

// The guards that keep src/verify/lang from panicking: a short operator node,
// a call of the wrong arity, a param list of the wrong length, a decimal past
// i32 and a layer past i64 are each refused or rendered as `?`, never indexed
// past their end.

const gNone = (): LangExpr[] => {
  const none: LangExpr[] = []
  return none
}

const gNum = (v: string): LangExpr => new LangExpr(EXPR_NUM, "", v, "", gNone())

const gVar = (n: string): LangExpr => new LangExpr(EXPR_VAR, "", "", n, gNone())

const gNode = (kind: i32, op: string, args: LangExpr[]): LangExpr => new LangExpr(kind, op, "", "", args)

const gCall = (name: string, args: LangExpr[]): LangExpr => new LangExpr(EXPR_CALL, "", "", name, args)

// One function `f`, layer 2, of `x: Real` returning Real, with this body.
const gFn = (name: string, layer: i32, body: LangExpr): FnUnit => {
  const fn = new FnUnit(name, layer, "test", "Real", body)
  fn.params.push(new LangParam("x", "Real"))
  return fn
}

const gProgram = (body: LangExpr): Program => {
  const p = new Program("guard")
  p.functions.push(gFn("g", 1, gVar("x")))
  p.functions.push(gFn("f", 2, body))
  return p
}

const gErrors = (p: Program): string => typecheckProgram(p).join("; ")

const guardShort = (t: Suite): void => {
  const x = gVar("x")
  const one = gNum("1")
  const yes = gNode(EXPR_BINOP, ">", [x, one])
  t.eqStr(
    "a unop of no operand is refused",
    gErrors(gProgram(gNode(EXPR_UNOP, "neg", gNone()))),
    "f/body: expression kind 4 has 0 operand(s), not the 1 it takes",
  )
  t.eqStr("a unop of one operand is checked", gErrors(gProgram(gNode(EXPR_UNOP, "neg", [x]))), "")
  t.eqStr(
    "a binop of one operand is refused",
    gErrors(gProgram(gNode(EXPR_BINOP, "+", [x]))),
    "f/body: expression kind 5 has 1 operand(s), not the 2 it takes",
  )
  t.eqStr(
    "a binop of no operand is refused",
    gErrors(gProgram(gNode(EXPR_BINOP, "+", gNone()))),
    "f/body: expression kind 5 has 0 operand(s), not the 2 it takes",
  )
  t.eqStr("a binop of two operands is checked", gErrors(gProgram(gNode(EXPR_BINOP, "+", [x, one]))), "")
  t.eqStr(
    "an ite of two operands is refused",
    gErrors(gProgram(gNode(EXPR_ITE, "", [yes, x]))),
    "f/body: expression kind 6 has 2 operand(s), not the 3 it takes",
  )
  t.eqStr("an ite of three operands is checked", gErrors(gProgram(gNode(EXPR_ITE, "", [yes, x, one]))), "")

  // A short node inside a clause is refused under that clause's part.
  const p = gProgram(x)
  p.functions[1].requires.push(new LangClause("AX1", gNode(EXPR_BINOP, ">", [x])))
  t.eqStr(
    "a short node in a requires",
    gErrors(p),
    "f/requires[0]: expression kind 5 has 1 operand(s), not the 2 it takes",
  )
}

const guardCall = (t: Suite): void => {
  const x = gVar("x")
  t.eqStr("a call of the right arity is checked", gErrors(gProgram(gCall("g", [x]))), "")
  t.eqStr(
    "a call of too few arguments is refused",
    gErrors(gProgram(gCall("g", gNone()))),
    `f/body: "g" expects 1 argument(s), got 0`,
  )
  t.eqStr(
    "a call of too many arguments is refused",
    gErrors(gProgram(gCall("g", [x, x]))),
    `f/body: "g" expects 1 argument(s), got 2`,
  )
  t.eqStr(
    "a call of an unknown function is refused",
    gErrors(gProgram(gCall("h", [x]))),
    `f/body: call to unknown function "h"`,
  )
  // Two functions named `g`: the call binds the first, of one Real param.
  const p = gProgram(gCall("g", [x]))
  const second = new FnUnit("g", 1, "test", "Real", gVar("x"))
  p.functions.push(second)
  t.contains("a call binds the first function of its name", gErrors(p), `duplicate function name "g"`)
  t.ok("the first g's arity is the one checked", gErrors(p).indexOf("expects") < 0)
}

const guardParams = (t: Suite): void => {
  const p = gProgram(gVar("x"))
  p.functions[1].params.push(new LangParam("x", "Int"))
  t.eqStr("a duplicate parameter is refused", gErrors(p), `f/params: duplicate parameter "x"`)
  // The body's `x` is the first binding, a Real, so `x + 1.5` checks.
  const q = gProgram(gNode(EXPR_BINOP, "+", [gVar("x"), gNum("1.5")]))
  q.functions[1].params.push(new LangParam("x", "Bool"))
  t.eqStr("a variable binds its first parameter", gErrors(q), `f/params: duplicate parameter "x"`)
}

const gPlan = (params: LangParam[]): SpecPlan => {
  const plan = new SpecPlan("guard")
  const g = new PlanUnit("g", 1, "Real")
  g.params.push(new LangParam("x", "Real"))
  plan.units.push(g)
  const f = new PlanUnit("f", 2, "Real")
  for (const p of params) {
    f.params.push(p)
  }
  plan.units.push(f)
  return plan
}

const guardConsistency = (t: Suite): void => {
  const program = gProgram(gVar("x"))
  const none: LangParam[] = []
  t.eqStr(
    "a plan that agrees",
    checkSpecProgramConsistency(gPlan([new LangParam("x", "Real")]), program).join("; "),
    "",
  )
  t.eqStr(
    "a plan of fewer params",
    checkSpecProgramConsistency(gPlan(none), program).join("; "),
    `function "f": has 1 param(s) but spec unit declares 0`,
  )
  t.eqStr(
    "a plan of more params",
    checkSpecProgramConsistency(gPlan([new LangParam("x", "Real"), new LangParam("y", "Real")]), program).join("; "),
    `function "f": has 1 param(s) but spec unit declares 2`,
  )
  t.eqStr(
    "a plan of another param type",
    checkSpecProgramConsistency(gPlan([new LangParam("x", "Int")]), program).join("; "),
    `function "f": param 1 is x:Real but spec unit declares x:Int`,
  )
  t.eqStr(
    "a plan of another param name",
    checkSpecProgramConsistency(gPlan([new LangParam("y", "Real")]), program).join("; "),
    `function "f": param 1 is x:Real but spec unit declares y:Real`,
  )
  // Two units named `f`: the function binds the first.
  const plan = gPlan([new LangParam("x", "Real")])
  plan.units.push(new PlanUnit("f", 9, "Bool"))
  t.eqStr("a function binds the first unit of its name", checkSpecProgramConsistency(plan, program).join("; "), "")
}

const guardPretty = (t: Suite): void => {
  const x = gVar("x")
  const one = gNum("1")
  const yes = gNode(EXPR_BINOP, ">", [x, one])
  t.eqStr("prettyMath of a unop of no operand", prettyMath(gNode(EXPR_UNOP, "neg", gNone())), "?")
  t.eqStr("prettyMath of a unop", prettyMath(gNode(EXPR_UNOP, "neg", [x])), "-x")
  t.eqStr("prettyTs of a binop of one operand", prettyTs(gNode(EXPR_BINOP, "+", [x])), "?")
  t.eqStr("prettyTs of a binop", prettyTs(gNode(EXPR_BINOP, "+", [x, one])), "x + 1")
  t.eqStr("prettyMath of an ite of two operands", prettyMath(gNode(EXPR_ITE, "", [yes, x])), "?")
  t.eqStr("prettyMath of an ite", prettyMath(gNode(EXPR_ITE, "", [yes, x, one])), "(x > 1 ? x : 1)")
  t.eqStr(
    "a short node inside a whole one",
    prettyMath(gNode(EXPR_BINOP, "*", [x, gNode(EXPR_UNOP, "abs", gNone())])),
    "x * ?",
  )
}

const gStyle = (e: LangExpr): i32 => {
  const p = gProgram(gVar("x"))
  p.functions[1].ensures.push(new LangClause("AX2", e))
  return toI32(collectStyleWarnings(p).length)
}

const guardStyle = (t: Suite): void => {
  const result = gVar("result")
  const sum = gNode(EXPR_BINOP, "+", [gVar("x"), gNum("1")])
  t.eqI32("a definitional ensures warns", gStyle(gNode(EXPR_BINOP, "==", [result, sum])), 1)
  t.eqI32("an == of one operand does not", gStyle(gNode(EXPR_BINOP, "==", [result])), 0)
  t.eqI32("an == of no operand does not", gStyle(gNode(EXPR_BINOP, "==", gNone())), 0)
  // A short `==` still has its operand searched.
  const inner = gNode(EXPR_BINOP, "==", [sum, result])
  t.eqI32("a short == around a definitional one warns", gStyle(gNode(EXPR_BINOP, "==", [inner])), 1)
}

const guardDecimal = (t: Suite): void => {
  t.ok("0", langRoundTrips("0"))
  t.ok("-0.0", langRoundTrips("-0.0"))
  t.ok("0.000", langRoundTrips("0.000"))
  t.ok("1.50", langRoundTrips("1.50"))
  t.ok("100", langRoundTrips("100"))
  t.ok("1e+5", langRoundTrips("1e+5"))
  t.ok("1E5", langRoundTrips("1E5"))
  t.ok("15e-1", langRoundTrips("15e-1"))
  t.ok("5e-324", langRoundTrips("5e-324"))
  t.ok("1e21", langRoundTrips("1e21"))
  t.ok("1e400 overflows", !langRoundTrips("1e400"))
  t.ok("1e-400 underflows", !langRoundTrips("1e-400"))
  // Exponents at and past i32's edges, where the old i32 sum overflowed.
  t.ok("1e2147483647", !langRoundTrips("1e2147483647"))
  t.ok("1e-2147483648", !langRoundTrips("1e-2147483648"))
  t.ok("1e99999999999", !langRoundTrips("1e99999999999"))
  t.ok("0e2147483647", langRoundTrips("0e2147483647"))
  t.ok("0.5e-2147483647", !langRoundTrips("0.5e-2147483647"))
  t.ok("0.05e-2147483647", !langRoundTrips("0.05e-2147483647"))
  t.ok("1.5e-2147483648", !langRoundTrips("1.5e-2147483648"))

  // langIsDecimal's end of the integer digits, through the reader.
  const plain = 'f/body: num.value must be a plain decimal string like "0.91" (no leading zeros, no exponent), got'
  t.eqStr("a literal 12", gLiteral("12"), "1")
  t.eqStr("a literal 0", gLiteral("0"), "1")
  t.eqStr("a literal -3.25", gLiteral("-3.25"), "1")
  t.eqStr("a literal 1.", gLiteral("1."), `${plain} "1."`)
  t.eqStr("a literal -", gLiteral("-"), `${plain} "-"`)
  t.eqStr("a literal 01", gLiteral("01"), `${plain} "01"`)
  t.eqStr("a literal 1e5", gLiteral("1e5"), `${plain} "1e5"`)
}

// Reads one function of this layer and body, giving its errors, or its layer.
const gRead = (layer: string, body: string): string => {
  const doc = newJsonDocument()
  const text = `{"programName":"p","functions":[{"name":"f","layer":${layer},"purpose":"t","params":[{"name":"x","type":"Real"}],"returnType":"Real","requires":[],"ensures":[{"axiomId":"A","expr":{"kind":"binop","op":">=","left":{"kind":"var","name":"result"},"right":{"kind":"var","name":"x"}}}],"body":${body}}]}`
  const root = parseJson(doc, text, "test")
  if (root.isErr()) {
    return `json: ${root.error}`
  }
  const errors: string[] = []
  const program = readProgram(doc, root.value, errors)
  if (errors.length > 0) {
    return errors.join("; ")
  }
  return `${program.functions[0].layer}`
}

const gLayer = (layer: string): string => gRead(layer, `{"kind":"var","name":"x"}`)

const gLiteral = (value: string): string => gRead("1", `{"kind":"num","value":"${value}"}`)

const guardLayer = (t: Suite): void => {
  const bad = "f: layer must be an integer from 1 to 1000000"
  t.eqStr("layer 1", gLayer("1"), "1")
  t.eqStr("layer 7", gLayer("7"), "7")
  t.eqStr("layer 999999", gLayer("999999"), "999999")
  t.eqStr("layer 1000000", gLayer("1000000"), "1000000")
  t.eqStr("layer 1000001", gLayer("1000001"), bad)
  t.eqStr("layer 9999999", gLayer("9999999"), bad)
  t.eqStr("layer 10000000", gLayer("10000000"), bad)
  t.eqStr("layer 0", gLayer("0"), bad)
  t.eqStr("layer -1", gLayer("-1"), bad)
  t.eqStr("layer -0", gLayer("-0"), bad)
  t.eqStr("layer 1.0", gLayer("1.0"), bad)
  t.eqStr("layer 1e2", gLayer("1e2"), bad)
  t.eqStr("layer 2.5", gLayer("2.5"), bad)
  t.eqStr("layer 2147483647", gLayer("2147483647"), bad)
  t.eqStr("layer 2147483648", gLayer("2147483648"), bad)
  t.eqStr("layer 4294967297", gLayer("4294967297"), bad)
  t.eqStr("layer of twenty digits", gLayer("99999999999999999999"), bad)
  t.eqStr("layer as a string", gLayer(`"1"`), bad)
}

export const main = (): i32 => {
  const t = new Suite("verify/lang_guard")
  guardShort(t)
  guardCall(t)
  guardParams(t)
  guardConsistency(t)
  guardPretty(t)
  guardStyle(t)
  guardDecimal(t)
  guardLayer(t)
  return t.done()
}
