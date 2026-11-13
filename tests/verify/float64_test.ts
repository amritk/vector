// The float64 gate: each case is proven over exact reals and wrong (or
// unchecked) as emitted float64 code, so without the gate it would be PROVEN.

import { Suite } from "nish/testing"
import { checkConformance } from "../../src/verify/emit/float64"
import { ConformanceIssue } from "../../src/verify/solve/report"
import { OUTCOME_PROVEN, OUTCOME_REFUTED, VerifyOutcome } from "../../src/verify/verify"
import { BCase, bBin, bCall, bNone, bNum, bPow10, bProgram, bSolve, bUn, bVar, bVerify } from "./build"

const f64Issues = (t: Suite, what: string, c: BCase): ConformanceIssue[] => {
  const none: ConformanceIssue[] = []
  const program = bProgram(c.programText())
  if (program.isErr()) {
    t.fail(what, program.error)
    return none
  }
  const report = bSolve(c)
  if (report.isErr()) {
    t.fail(what, report.error)
    return none
  }
  t.ok(`${what}: proven over the reals`, report.value.ok())
  return checkConformance(program.value, report.value)
}

const f64Has = (issues: ConformanceIssue[], fn: string, kind: string, axiomId: string): boolean => {
  for (const c of issues) {
    if (c.fn === fn && (kind === "" || c.kind === kind) && (axiomId === "" || c.axiomId === axiomId)) {
      return true
    }
  }
  return false
}

const f64Refuted = (t: Suite, what: string, outcome: VerifyOutcome): void => {
  t.eqStr(`${what}: REFUTED`, outcome.status, OUTCOME_REFUTED)
  let conformance = false
  for (const item of outcome.items) {
    if (item.issue === "conformance") {
      conformance = true
    }
  }
  t.ok(`${what}: a conformance item`, conformance)
}

export const main = (): i32 => {
  const t = new Suite("verify/float64")
  const x = bVar("x")

  // (x + 0.1) + 0.2 == x + 0.3 holds over the reals, not in float64.
  const gap = new BCase("gap")
  gap.fn(
    "addTenths",
    1,
    ["x:Real"],
    "Real",
    bNone(),
    [bBin("==", bVar("result"), bBin("+", x, bNum("0.3")))],
    bBin("+", bBin("+", x, bNum("0.1")), bNum("0.2")),
  )
  t.ok("float gap is found", f64Has(f64Issues(t, "float gap", gap), "addTenths", "", "addTenths_E0"))
  f64Refuted(t, "float gap", bVerify(gap))

  // floor(amount * 100) / 100 can land a cent below amount - 0.01 in float64.
  const cents = new BCase("cents")
  const amount = bVar("amount")
  cents.fn(
    "toCents",
    1,
    ["amount:Real"],
    "Real",
    [bBin(">=", amount, bNum("0")), bBin("<=", amount, bNum("1000000"))],
    [bBin("<=", bVar("result"), amount), bBin(">", bVar("result"), bBin("-", amount, bNum("0.01")))],
    bBin("/", bUn("floor", bBin("*", amount, bNum("100"))), bNum("100")),
  )
  t.ok(
    "floor to cents breaks E1",
    f64Has(f64Issues(t, "floor to cents", cents), "toCents", "postcondition", "toCents_E1"),
  )
  f64Refuted(t, "floor to cents", bVerify(cents))

  // g(x * 1e300) overflows to Infinity in float64, which g's guard refuses.
  const huge = new BCase("huge")
  const y = bVar("y")
  huge.fn("g", 1, ["y:Real"], "Real", [bBin(">=", y, bNum("0"))], [bBin(">=", bVar("result"), bNum("0"))], y)
  huge.fn(
    "f",
    2,
    ["x:Real"],
    "Real",
    [bBin(">=", x, bNum("0"))],
    [bBin(">=", bVar("result"), bNum("0"))],
    bCall("g", [bBin("*", x, bNum(bPow10(300)))]),
  )
  const hugeIssues = f64Issues(t, "callee overflow", huge)
  t.ok("callee overflow is callee-guard", f64Has(hugeIssues, "f", "callee-guard", ""))
  let finite = false
  for (const c of hugeIssues) {
    if (c.kind === "callee-guard" && c.pretty.indexOf("finite") >= 0) {
      finite = true
    }
  }
  t.ok("callee overflow names finiteness", finite)
  f64Refuted(t, "callee overflow", bVerify(huge))

  // g(x * 0.1) with x > 0 can underflow to 0, which g's y > 0 refuses.
  const tiny = new BCase("tiny")
  tiny.fn("g", 1, ["y:Real"], "Real", [bBin(">", y, bNum("0"))], [bBin(">", bVar("result"), bNum("0"))], y)
  tiny.fn(
    "f",
    2,
    ["x:Real"],
    "Real",
    [bBin(">", x, bNum("0"))],
    [bBin(">", bVar("result"), bNum("0"))],
    bCall("g", [bBin("*", x, bNum("0.1"))]),
  )
  t.ok("callee underflow names the call", f64Has(f64Issues(t, "callee underflow", tiny), "f", "", "(calls g)"))
  f64Refuted(t, "callee underflow", bVerify(tiny))

  // A window too narrow for random samples: (x + 1e16) - 1e16 rounds to 4.
  const narrow = new BCase("narrow")
  const big = bNum(bPow10(16))
  narrow.fn(
    "absorb",
    1,
    ["x:Real"],
    "Real",
    [bBin("and", bBin(">", x, bNum("3.1")), bBin("<", x, bNum("3.2")))],
    [bBin("<", bVar("result"), bNum("3.2"))],
    bBin("-", bBin("+", x, big), big),
  )
  t.ok("narrow window breaks E0", f64Has(f64Issues(t, "narrow window", narrow), "absorb", "", "absorb_E0"))
  f64Refuted(t, "narrow window", bVerify(narrow))

  // Requires no double satisfies: nothing was checked, so it fails closed.
  const unsampled = new BCase("unsampled")
  unsampled.fn(
    "between",
    1,
    ["x:Real"],
    "Real",
    [bBin(">", x, bNum("1")), bBin("<", bBin("*", x, big), bNum("10000000000000002"))],
    [bBin(">", bVar("result"), bNum("1"))],
    x,
  )
  t.ok("unsampled fails closed", f64Has(f64Issues(t, "unsampled", unsampled), "between", "unsampled", ""))
  f64Refuted(t, "unsampled", bVerify(unsampled))

  // x + x - x - x is 0 over the reals and NaN once x + x overflows.
  const over = new BCase("overflow")
  over.fn(
    "cancel",
    1,
    ["x:Real"],
    "Real",
    bNone(),
    [bBin("==", bVar("result"), bNum("0"))],
    bBin("-", bBin("-", bBin("+", x, x), x), x),
  )
  t.ok("overflow is found", f64Has(f64Issues(t, "overflow", over), "cancel", "", ""))
  f64Refuted(t, "overflow", bVerify(over))

  // A correct clamp stays clean.
  const clamp = new BCase("clamp")
  clamp.fn(
    "clamp01",
    1,
    ["x:Real"],
    "Real",
    bNone(),
    [bBin(">=", bVar("result"), bNum("0")), bBin("<=", bVar("result"), bNum("1"))],
    bBin("min", bBin("max", x, bNum("0")), bNum("1")),
  )
  t.eqI32("clamp01 has no conformance issue", toI32(f64Issues(t, "clamp01", clamp).length), 0)
  t.eqStr("clamp01 is PROVEN", bVerify(clamp).status, OUTCOME_PROVEN)
  return t.done()
}
