import { Suite } from "nish/testing"
import {
  gateF64Printed,
  gateIntLabelCount,
  gateIntLines,
  gateTextLines,
  gateWordFind,
} from "../../../src/spec/gates/text"

// The bounds-checked readers of src/spec/gates/text.ts, on the inputs where
// each guard rewritten to prove it cannot panic decides.

/** Offsets as text, "a,b"; "" when none. */
const noPanicTextJoin = (xs: i32[]): string => xs.map((x: i32): string => `${x}`).join(",")

/** The guards of src/spec/gates/text.ts, where each one decides. */
export const main = (): i32 => {
  const t = new Suite("spec/gates/no-panic-text")
  // *n't: a word of two letters or more ending in n, an apostrophe, then t.
  t.eqStr("n't of two letters", noPanicTextJoin(gateWordFind("it xn't", "*n't")), "3,7")
  t.eqStr("n't of three letters", noPanicTextJoin(gateWordFind("it can't", "*n't")), "3,8")
  t.eqStr("n't of one letter", noPanicTextJoin(gateWordFind("it n't", "*n't")), "")
  t.eqStr("n't after a word not ending in n", noPanicTextJoin(gateWordFind("it at't", "*n't")), "")
  t.eqStr("n't with a curly apostrophe", noPanicTextJoin(gateWordFind("it can’t", "*n't")), "3,10")
  // A value ending a line is printed whole after "=" or ":", or one space after either.
  t.eqStr("a value after a space alone", noPanicTextJoin(gateTextLines("a Zg", "Zg")), "")
  t.eqStr("a value after a space after =", noPanicTextJoin(gateTextLines("a = Zg", "Zg")), "0")
  t.eqStr("a value right after =", noPanicTextJoin(gateTextLines("a =Zg", "Zg")), "0")
  t.eqStr("a value right after a letter", noPanicTextJoin(gateTextLines("a =xZg", "Zg")), "")
  // An integer after 0x or 0X has a decimal digit; one led by 0 alone is decimal.
  t.eqBool("0x of hex letters is no integer", gateIntLabelCount("L = 0xff", "L") === 0, true)
  t.eqBool("0X of hex letters is no integer", gateIntLabelCount("L = 0Xff", "L") === 0, true)
  t.eqBool("0x with a digit is one", gateIntLabelCount("L = 0xf1", "L") === 1, true)
  t.eqBool("a leading 0 is decimal", gateIntLabelCount("L = 07", "L") === 1, true)
  // 0x of zeros prints 0, and 0x alone prints nothing.
  t.eqStr("0x00 is 0", noPanicTextJoin(gateIntLines("L = 0x00", "L", "0")), "0")
  t.eqStr("0x alone is not 0", noPanicTextJoin(gateIntLines("L = 0x", "L", "0")), "")
  t.eqStr("0x00 run into a letter is not 0", noPanicTextJoin(gateIntLines("L = 0x00g", "L", "0")), "")
  // A decimal number has digits before or after its point, and an exponent's digits.
  t.eqLines(
    "decimal forms",
    gateF64Printed("x = 5.\nx = .5\nx = .\nx = 1e5\nx = 1e+5\nx = 1E-5\nx = 2e\nx = 3e+\nx = 1.5e2", "x"),
    ["5.", ".5", "1e5", "1e+5", "1E-5", "1.5e2"],
  )
  t.eqStr("an exponent ending the text", gateF64Printed("x = 4e", "x").join(","), "")
  return t.done()
}
