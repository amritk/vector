import { Suite } from "nish/testing"
import {
  GATE_CLAUSE_GOES_ON,
  GATE_DENY,
  GATE_HEDGE,
  GATE_RETRACT,
  gateF64Printed,
  gateIntLabelCount,
  gateIntRounds,
  gateKeywordName,
  gateKeywordUses,
  gateLines,
  gateSentenceAt,
  gateTextLines,
  gateWordFind,
  gateWordLeads,
} from "../../../src/spec/gates/text"

/** The offsets as text, for comparing. */
const textTestNums = (xs: i32[]): string => xs.map((x: i32): string => `${x}`).join(",")

/** The matchers the fidelity and completeness gates read text with. */
export const main = (): i32 => {
  const t = new Suite("spec/gates/text")
  t.eqStr("a deny word at a word edge", textTestNums(gateWordFind("it does not hold", GATE_DENY)), "8,11")
  t.eqStr("not inside a longer word", textTestNums(gateWordFind("notable", GATE_DENY)), "")
  t.eqStr("a starred entry lets letters follow", textTestNums(gateWordFind("Previously, x", GATE_DENY)), "0,10")
  t.eqStr("n't with a curly apostrophe", textTestNums(gateWordFind("it doesn’t", GATE_DENY)), "3,12")
  t.eqStr("n't with a straight one", textTestNums(gateWordFind("won't", GATE_RETRACT)), "0,5")
  t.eqStr("a phrase", textTestNums(gateWordFind("it is at most 3", GATE_HEDGE)), "6,13")
  t.eqStr("emphasis marks are edges", textTestNums(gateWordFind("is _never_ x", GATE_RETRACT)), "4,9")
  t.ok("a clause going on", gateWordLeads(" when x", GATE_CLAUSE_GOES_ON) === 5)
  t.ok("a clause not going on", gateWordLeads(" whence", GATE_CLAUSE_GOES_ON) === -1)

  const uses = gateKeywordUses('The key words "MUST" here. It MUST NOT fail and SHALL be REQUIRED.')
  t.eqStr("keywords, not in quotes, longest first", textTestNums(uses), "30,0,48,3,57,4")
  t.eqStr("a keyword's name", gateKeywordName(0), "MUST NOT")
  t.eqStr("not inside a word", textTestNums(gateKeywordUses("MUSTARD and SHALLOW")), "")

  const lines = gateLines(["  Hash = SHA-256  ", "", "IKM  = 0x0b0b", "L    = 42", "okm: 'Zg=='", "Count 0x2A"])
  t.eqStr(
    "lines are normalized and the empty dropped",
    lines,
    "Hash = SHA-256\nIKM = 0x0b0b\nL = 42\nokm: 'Zg=='\nCount 0x2A",
  )
  t.eqStr("a value ending a line after =", textTestNums(gateTextLines(lines, "SHA-256")), "0")
  t.eqStr("a quoted value", textTestNums(gateTextLines(lines, "Zg==")), "3")
  t.eqStr("not a part of a value", textTestNums(gateTextLines(lines, "Zg")), "")
  t.eqStr("a value wrapped across lines", textTestNums(gateTextLines("a =\nx y\nz", "x y z")), "1,2")

  t.eqStr("an integer after its label", textTestNums(gateIntRounds(lines, "L", "42")), "0")
  t.eqStr("in hex", textTestNums(gateIntRounds(lines, "Count", "42")), "0")
  t.eqStr("another value", textTestNums(gateIntRounds(lines, "L", "41")), "")
  t.eqStr("not a longer number", textTestNums(gateIntRounds("L = 420", "L", "42")), "")
  t.eqStr("not a range", textTestNums(gateIntRounds("L = 4-5", "L", "4")), "")
  t.eqStr("rounds count printings", textTestNums(gateIntRounds("c = 1\nc = 2\nc = 1", "c", "1")), "0,2")
  t.ok("a label's count", gateIntLabelCount("c = 1\nc = 2\nxc = 3", "c") === 2)
  t.eqStr("f64s as printed", gateF64Printed("x = 1.5\nx: -0\nx NaN\nx = 1.5.2", "x").join("|"), "1.5|-0|NaN")
  t.eqStr("the sentence around an offset", gateSentenceAt("One. It MUST hold. Two.", 8), "It MUST hold.")
  return t.done()
}
