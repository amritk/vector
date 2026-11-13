import { Suite } from "nish/testing"
import { QueryAnswer, normalizeValue, parseModel, parseSexp, parseZ3Output, renderSexp } from "../../src/core/smt"

export const main = (): i32 => {
  const t = new Suite("core/smt")
  t.eqStr("normalizeValue integral", normalizeValue("3.0"), "3")
  t.eqStr("normalizeValue negative", normalizeValue("-12.000"), "-12")
  t.eqStr("normalizeValue fraction", normalizeValue("1.5"), "1.5")
  t.eqStr("normalizeValue trims", normalizeValue("  7 \n"), "7")
  t.eqStr("normalizeValue symbol", normalizeValue("x.0"), "x.0")
  t.eqStr("normalizeValue bare dot", normalizeValue("3."), "3.")

  const s = parseSexp("(- (/ 1 2))")
  t.ok("parseSexp list", s !== null)
  if (s !== null) {
    t.eqStr("renderSexp negation", renderSexp(s), "-1/2")
  }
  const odd = parseSexp("(root-obj (+ (^ x 2) (- 2)) 1)")
  if (odd !== null) {
    t.eqStr("renderSexp other", renderSexp(odd), "(root-obj (+ (^ x 2) -2) 1)")
  }
  t.ok("parseSexp unbalanced", parseSexp("((a b)") === null)
  t.ok("parseSexp stray close", parseSexp(")") === null)
  t.ok("parseSexp empty", parseSexp("   ") === null)

  const a = new QueryAnswer("sat")
  t.eqI32("parseModel count", parseModel(a, "((f0_x 0.0)\n (f0_result (/ (- 1) 2)) (|odd name| 1) (g 2 3))"), 2)
  t.eqStr("model x", a.value("f0_x") ?? "", "0")
  t.eqStr("model result", a.value("f0_result") ?? "", "-1/2")
  t.ok("model missing", a.value("nope") === null)
  t.eqI32("parseModel junk", parseModel(new QueryAnswer("sat"), '(error "x")'), 0)

  const out = '@@Q0\nunsat\n(error "no model")\n@@Q1\nsat\n((f0_x 2.0))\n@@Q7\nsat\n@@Q2\ntimeout\n'
  const answers = parseZ3Output(out, 4)
  t.eqI32("parseZ3Output count", toI32(answers.length), 4)
  t.eqStr("q0", answers[0].result, "unsat")
  t.eqStr("q1", answers[1].result, "sat")
  t.eqStr("q1 model", answers[1].value("f0_x") ?? "", "2")
  t.eqStr("q2 unknown verdict", answers[2].result, "unknown")
  t.eqStr("q3 no marker", answers[3].result, "unknown")
  t.eqI32("parseZ3Output nothing", toI32(parseZ3Output("", 0).length), 0)
  return t.done()
}
