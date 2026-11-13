// Each case is an artifact the gate must refuse as INVALID: if the reader,
// the typechecker or the spec/program cross-check that names it were
// removed, the case would reach the solver and fail here.

import { Suite } from "nish/testing"
import { OUTCOME_INVALID } from "../../src/verify/verify"
import { BCase, bBin, bBool, bCall, bIte, bNone, bNum, bTypeErrors, bVar, bVerifyText } from "./build"

// Replaces every occurrence of `from` in `s` with `to`.
const refSub = (s: string, from: string, to: string): string => {
  let out = ""
  let rest = s
  let at = rest.indexOf(from)
  while (at >= 0) {
    out = `${out}${rest.substring(0, at)}${to}`
    rest = rest.substring(at + from.length)
    at = rest.indexOf(from)
  }
  return `${out}${rest}`
}

// The gate refuses the pair as INVALID, with an error containing `needle`.
const refInvalid = (t: Suite, what: string, specText: string, programText: string, needle: string): void => {
  const outcome = bVerifyText(specText, programText)
  t.eqStr(`${what}: INVALID`, outcome.status, OUTCOME_INVALID)
  t.contains(`${what}: names the problem`, outcome.errors.join("\n"), needle)
}

// The case refused as INVALID, and its program refused by the reader or typechecker.
const refCase = (t: Suite, what: string, c: BCase, needle: string): void => {
  t.contains(`${what}: typecheck`, bTypeErrors(c.programText()), needle)
  refInvalid(t, what, c.specText(), c.programText(), needle)
}

// A one-function case: `name(x: Real): Real` with result >= 0, given a body.
const refOne = (name: string, param: string, returnType: string, body: string): BCase => {
  const c = new BCase("refuse")
  c.fn(name, 1, [param], returnType, bNone(), [bBin("==", bVar("result"), bVar("result"))], body)
  return c
}

// A valid case to mutate: f(x) = x with x >= 0 and result >= 0.
const refBase = (): BCase => {
  const c = new BCase("base")
  c.fn(
    "f",
    1,
    ["x:Real"],
    "Real",
    [bBin(">=", bVar("x"), bNum("0"))],
    [bBin(">=", bVar("result"), bNum("0"))],
    bVar("x"),
  )
  return c
}

export const main = (): i32 => {
  const t = new Suite("verify/refusal")
  const x = bVar("x")
  const result = bVar("result")
  const base = refBase()
  t.eqStr("the base case is well-formed", bTypeErrors(base.programText()), "")
  t.ok("the base case is not INVALID", bVerifyText(base.specText(), base.programText()).status !== OUTCOME_INVALID)

  // Types.
  refCase(t, "Int /", refOne("half", "n:Int", "Int", bBin("/", bVar("n"), bNum("2"))), "expected Int, got Real")
  refCase(t, "Int vs Real", refOne("asInt", "x:Real", "Int", x), "expected Int, got Real")
  refCase(t, "Bool body for Real", refOne("yes", "x:Real", "Real", bBool(true)), "got Bool")
  refCase(t, "fraction in Int", refOne("third", "n:Int", "Int", bNum("1.5")), "is not an integer")
  // The else branch is inferred against the then branch's type, so a mismatch
  // is refused there, before the two are compared.
  refCase(
    t,
    "ite branches",
    refOne("pick", "x:Real", "Real", bBin("+", bIte(bBool(true), bVar("x"), bBool(false)), x)),
    "expected Real, got Bool",
  )
  refCase(t, "result in a body", refOne("own", "x:Real", "Real", result), "may only appear in ensures clauses")
  refCase(t, "unknown variable", refOne("lost", "x:Real", "Real", bVar("z")), "unknown variable")
  const inReq = new BCase("refuse")
  inReq.fn("pre", 1, ["x:Real"], "Real", [bBin(">", result, bNum("0"))], [bBin(">", result, bNum("0"))], x)
  refCase(t, "result in a requires", inReq, 'a requires clause may not reference "result"')
  const ignores = new BCase("refuse")
  ignores.fn("blind", 1, ["x:Real"], "Real", bNone(), [bBin(">=", x, x)], x)
  refCase(t, "ensures ignores result", ignores, "must reference")

  // Calls.
  const same = new BCase("refuse")
  same.fn("g", 1, ["y:Real"], "Real", bNone(), [bBin("==", result, bVar("y"))], bVar("y"))
  same.fn("f", 1, ["x:Real"], "Real", bNone(), [bBin("==", result, x)], bCall("g", [x]))
  refCase(t, "call to the same layer", same, "may only call strictly lower layers")
  const self = new BCase("refuse")
  self.fn("f", 2, ["x:Real"], "Real", bNone(), [bBin("==", result, x)], bCall("f", [x]))
  refCase(t, "call to itself", self, "may only call strictly lower layers")
  const up = new BCase("refuse")
  up.fn("f", 1, ["x:Real"], "Real", bNone(), [bBin("==", result, x)], bCall("g", [x]))
  up.fn("g", 2, ["y:Real"], "Real", bNone(), [bBin("==", result, bVar("y"))], bVar("y"))
  refCase(t, "call to a higher layer", up, "may only call strictly lower layers")
  const arity = new BCase("refuse")
  arity.fn("g", 1, ["y:Real"], "Real", bNone(), [bBin("==", result, bVar("y"))], bVar("y"))
  arity.fn("f", 2, ["x:Real"], "Real", bNone(), [bBin("==", result, x)], bCall("g", [x, x]))
  refCase(t, "arity", arity, '"g" expects 1 argument(s), got 2')

  // Names the emitted TypeScript could not use.
  const reserved: string[] = ["Math", "class", "NaN", "Number", "await", "undefined", "delete"]
  for (const name of reserved) {
    refCase(t, `function ${name}`, refOne(name, "x:Real", "Real", x), "is reserved")
    refCase(t, `param ${name}`, refOne("f", `${name}:Real`, "Real", bVar(name)), "is reserved")
  }
  const shadow = new BCase("refuse")
  shadow.fn("g", 1, ["y:Real"], "Real", bNone(), [bBin("==", result, bVar("y"))], bVar("y"))
  shadow.fn("f", 2, ["g:Real"], "Real", bNone(), [bBin("==", result, bVar("g"))], bVar("g"))
  refCase(t, "param shadows a function", shadow, "shadows the function of the same name")

  // An axiom id lands in emitted comments and strings, so only identifiers pass.
  const spec = base.specText()
  const program = base.programText()
  refInvalid(t, "axiomId */", refSub(spec, "f_E0", "f*/E0"), refSub(program, "f_E0", "f*/E0"), "axiomId")
  const pwned = 'AX\\"); } // pwned'
  refInvalid(t, "axiomId injection", refSub(spec, "f_E0", pwned), refSub(program, "f_E0", pwned), "axiomId")

  // Traceability: a post axiom only assumed as a requires proves nothing.
  refInvalid(t, "post as requires", refSub(spec, '"f_R0","kind":"pre"', '"f_R0","kind":"post"'), program, '"post"')
  // A pre axiom only checked as an ensures is never assumed by callers.
  refInvalid(
    t,
    "pre as ensures",
    refSub(spec, '"f_E0","kind":"post"', '"f_E0","kind":"pre"'),
    program,
    "a precondition must be enforced by a requires clause",
  )
  // A clause citing an axiom the spec does not have, which leaves the real
  // axiom unenforced.
  const lostReq = refSub(program, '"f_R0"', '"f_R9"')
  refInvalid(t, "requires cites unknown", spec, lostReq, 'requires clause cites unknown axiom "f_R9"')
  refInvalid(t, "requires cites unknown leaves f_R0", spec, lostReq, "axiom f_R0")
  refInvalid(t, "requires cites unknown: unenforced", spec, lostReq, "is not enforced by any clause")
  const lostEns = refSub(program, '"f_E0"', '"f_E9"')
  refInvalid(t, "ensures cites unknown", spec, lostEns, 'ensures clause cites unknown axiom "f_E9"')
  refInvalid(t, "ensures cites unknown: unenforced", spec, lostEns, "axiom f_E0")

  // The program implements exactly the spec plan's units.
  const two = refBase()
  two.fn("g", 1, ["y:Real"], "Real", bNone(), [bBin("==", result, bVar("y"))], bVar("y"))
  refInvalid(t, "missing function", two.specText(), refSub(program, '"base"', '"refuse"'), "has no matching function")
  refInvalid(t, "extra function", spec, refSub(two.programText(), '"base"', '"refuse"'), "is not declared as a unit")
  refInvalid(t, "layer mismatch", spec, refSub(program, '"layer":1', '"layer":2'), "disagrees with spec unit layer")
  refInvalid(
    t,
    "returnType mismatch",
    refSub(spec, '"returnType":"Real"', '"returnType":"Int"'),
    program,
    "disagrees with spec unit returnType",
  )
  refInvalid(t, "param type mismatch", refSub(spec, '"type":"Real"', '"type":"Int"'), program, "spec unit declares")
  refInvalid(
    t,
    "param count mismatch",
    refSub(spec, '"params":[{"name":"x","type":"Real"}]', '"params":[]'),
    program,
    "spec unit declares",
  )

  // Shape.
  refInvalid(
    t,
    "unknown expr kind",
    spec,
    refSub(program, '"body":{"kind":"var","name":"x"}', '"body":{"kind":"loop"}'),
    "unknown expression kind",
  )
  refInvalid(
    t,
    "exponent literal",
    spec,
    refSub(program, '"value":"0"', '"value":"1e9"'),
    "no leading zeros, no exponent",
  )
  refInvalid(t, "leading zero", spec, refSub(program, '"value":"0"', '"value":"01"'), "no leading zeros, no exponent")
  refInvalid(
    t,
    "lossy literal",
    spec,
    refSub(program, '"value":"0"', '"value":"1.10000000000000001"'),
    "more precision than a float64",
  )
  refInvalid(t, "bad binop", spec, refSub(program, '"op":">="', '"op":"**"'), "is not a known operator")
  refInvalid(t, "unknown property", spec, refSub(program, '"purpose":', '"extra":1,"purpose":'), "unknown property")
  const empty = new BCase("refuse")
  empty.fn("f", 1, ["x:Real"], "Real", bNone(), bNone(), x)
  refInvalid(t, "empty ensures", empty.specText(), empty.programText(), "must contain at least 1 clause(s)")
  const five = new BCase("refuse")
  const names: string[] = ["a", "b", "c", "d", "e"]
  for (const name of names) {
    five.fn(name, 1, ["x:Real"], "Real", bNone(), [bBin("==", result, x)], x)
  }
  const fiveSpec = refSub(five.specText(), '"layer":1,"purpose":"e under test"', '"layer":0,"purpose":"e under test"')
  refInvalid(t, "five units", fiveSpec, five.programText(), "units must be an array of 1-4 entries, got 5")
  // Every unit is still read, so the bad layer of the fifth is reported too.
  refInvalid(
    t,
    "five units still reads each",
    fiveSpec,
    five.programText(),
    "layer must be an integer from 1 to 1000000",
  )
  refInvalid(
    t,
    "layer too high",
    refSub(spec, '"layer":1', '"layer":1000001'),
    refSub(program, '"layer":1', '"layer":1000001'),
    "layer must be an integer from 1 to 1000000",
  )
  return t.done()
}
