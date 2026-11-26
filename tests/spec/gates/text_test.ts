import { Suite } from "nish/testing"
import {
  GATE_CLAUSE_GOES_ON,
  GATE_DENY,
  GATE_HEDGE,
  GATE_RETRACT,
  gateByteLists,
  gateF64Printed,
  gateIntLabelCount,
  gateIntLines,
  gateIntPrinted,
  gateIntRounds,
  gateKeywordName,
  gateKeywordUses,
  gateLines,
  gateParagraphStarts,
  gateQuotePairs,
  gateSentenceAt,
  gateSentenceBreaks,
  gateSentenceSpan,
  gateTextLines,
  gateTextStarts,
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
  t.eqStr("a keyword's name", gateKeywordName(0) ?? "null", "MUST NOT")
  t.eqStr("the last keyword's name", gateKeywordName(4) ?? "null", "REQUIRED")
  t.eqStr("no name past the last keyword", gateKeywordName(5) ?? "null", "null")
  t.eqStr("no name for a negative index", gateKeywordName(-1) ?? "null", "null")
  t.eqStr("not inside a word", textTestNums(gateKeywordUses("MUSTARD and SHALLOW")), "")

  const lines = gateLines(["  Hash = SHA-256  ", "", "IKM  = 0x0b0b", "L    = 42", "okm: 'Zg=='", "Count 0x2A"])
  t.eqStr(
    "lines are normalized and the empty dropped",
    lines,
    "Hash = SHA-256\nIKM = 0x0b0b\nL = 42\nokm: 'Zg=='\nCount 0x2A",
  )
  t.eqStr("a value ending a line after =", textTestNums(gateTextLines(lines, "SHA-256")), "0")
  t.eqStr("a quoted value", textTestNums(gateTextLines(lines, "Zg==")), "3")
  t.eqStr("the quotes, in pairs", gateQuotePairs().join(" "), "\" \" ' ' \u201c \u201d \u2018 \u2019 ` `")
  t.eqStr("not a part of a value", textTestNums(gateTextLines(lines, "Zg")), "")
  t.eqStr("a value wrapped across lines", textTestNums(gateTextLines("a =\nx y\nz", "x y z")), "1,2")

  t.eqStr("an integer after its label", textTestNums(gateIntRounds(lines, "L", "42")), "0")
  t.eqStr("in hex", textTestNums(gateIntRounds(lines, "Count", "42")), "0")
  t.eqStr("another value", textTestNums(gateIntRounds(lines, "L", "41")), "")
  t.eqStr("not a longer number", textTestNums(gateIntRounds("L = 420", "L", "42")), "")
  t.eqStr("not a range", textTestNums(gateIntRounds("L = 4-5", "L", "4")), "")
  t.eqStr("rounds count printings", textTestNums(gateIntRounds("c = 1\nc = 2\nc = 1", "c", "1")), "0,2")
  t.ok("a label's count", gateIntLabelCount("c = 1\nc = 2\nxc = 3", "c") === 2)
  const intLines: string[][] = [
    ["c = 1\nc = 2\nxc = 1\nc = 1", "1", "0,3"],
    ["c = 1\nc = 2", "2", "1"],
    ["c = 12\nc = 1.5\nc: 1", "1", "2"],
    ["xc = 1\nd = 1", "1", ""],
  ]
  for (const r of intLines) {
    t.eqStr(`gateIntLines ${r[0]} = ${r[1]}`, textTestNums(gateIntLines(r[0], "c", r[1])), r[2])
  }
  const label = '(P="passwd", S="salt", c=1, dkLen=64)'
  const starts: string[][] = [
    [label, "salt", "16"],
    [label, "passwd", "4"],
    [label, "pass", ""],
    [label, "", ""],
    ['"ab" "ab"', "ab", "1,6"],
    ["a =\nx y\nz", "x y z", "4"],
  ]
  for (const r of starts) {
    t.eqStr(`gateTextStarts ${r[0]} ${r[1]}`, textTestNums(gateTextStarts(r[0], r[1])), r[2])
  }
  const printed: string[][] = [
    [label, "c", "1", "25"],
    [label, "c", "10", ""],
    [label, "dkLen", "64", "34"],
    [label, "dkLen", "6", ""],
    ["(xc=1, c=1)", "c", "1", "9"],
    ["(c=1, c=2, c=1)", "c", "1", "3,13"],
  ]
  for (const r of printed) {
    t.eqStr(`gateIntPrinted ${r[0]} ${r[1]}=${r[2]}`, textTestNums(gateIntPrinted(r[0], r[1], r[2])), r[3])
  }
  t.eqStr("f64s as printed", gateF64Printed("x = 1.5\nx: -0\nx NaN\nx = 1.5.2", "x").join("|"), "1.5|-0|NaN")
  t.eqStr("the sentence around an offset", gateSentenceAt("One. It MUST hold. Two.", [], 8), "It MUST hold.")
  t.eqStr("a sentence's breaks", textTestNums(gateSentenceBreaks("One. It MUST hold. Two.", [])), "3,4,5,17,18,19")
  t.eqStr(
    "no break after e.g",
    textTestNums(gateSentenceBreaks("Send data, e.g. before it ends. Next.", [])),
    "30,31,32",
  )
  t.eqStr("no break after i.e or etc", textTestNums(gateSentenceBreaks("A, i.e. B, etc. C. D", [])), "17,18,19")
  t.eqStr(
    "a break before a lowercase letter",
    textTestNums(gateSentenceBreaks("Ver. two holds. X", [])),
    "3,4,5,14,15,16",
  )
  t.eqStr(
    "an identifier starts a sentence",
    gateSentenceAt("It is key material. hexEncode MUST NOT fail.", [], 25),
    "hexEncode MUST NOT fail.",
  )
  t.eqStr(
    "and the sentence before stops at its period",
    textTestNums(gateSentenceSpan("It is key material. hexEncode MUST NOT fail.", [], 3)),
    "0,18,19",
  )
  t.eqStr(
    "paragraph starts",
    textTestNums(gateParagraphStarts(["  One", "  two.", "", "   ", "Three", "", "Four"])),
    "9,15",
  )
  t.eqStr("none without a blank line", textTestNums(gateParagraphStarts(["", "One", "two"])), "")
  const paras = gateParagraphStarts(["The key is kept", "", "It MUST hold."])
  t.eqStr(
    "a paragraph without a final period breaks",
    textTestNums(gateSentenceBreaks("The key is kept It MUST hold.", paras)),
    "15,15,16",
  )
  t.eqStr("its sentence is its own", gateSentenceAt("The key is kept It MUST hold.", paras, 20), "It MUST hold.")
  t.eqStr(
    "and the one before stops at its end",
    gateSentenceAt("The key is kept It MUST hold.", paras, 2),
    "The key is kept",
  )
  const etc = gateParagraphStarts(["Keys, etc.", "", "It MUST hold."])
  t.eqStr(
    "a paragraph ending in an abbreviation still breaks",
    textTestNums(gateSentenceBreaks("Keys, etc. It MUST hold.", etc)),
    "9,10,11",
  )
  t.eqStr("a period before a paragraph breaks once", textTestNums(gateSentenceBreaks("One. Two.", [5])), "3,4,5")
  t.eqStr(
    "a bullet after a paragraph break is skipped",
    textTestNums(gateSentenceBreaks("Items o A MUST hold.", [6])),
    "5,5,8",
  )
  t.eqStr("a question breaks", textTestNums(gateSentenceBreaks("Why? Because.", [])), "3,4,5")
  t.eqStr(
    "a closing quote stays with its sentence",
    textTestNums(gateSentenceBreaks('Say "hi." Then go.', [])),
    "7,9,10",
  )
  t.eqStr("a closing curly quote too", textTestNums(gateSentenceBreaks("Say \u201chi.\u201d Then go.", [])), "9,13,14")
  t.eqStr(
    "a ; before a bullet breaks",
    textTestNums(gateSentenceBreaks("o A MUST be X; o B MUST be Y.", [])),
    "13,14,17",
  )
  t.eqStr("a ; alone does not", textTestNums(gateSentenceBreaks("A MUST be X; B MUST be Y.", [])), "")
  t.eqStr("a bare bullet breaks", textTestNums(gateSentenceBreaks("Items: o A o B", [])), "5,6,9,10,10,13")
  t.eqStr(
    "an e.g sentence whole",
    gateSentenceAt("A server MUST NOT send data, e.g. before the handshake completes. Next.", [], 10),
    "A server MUST NOT send data, e.g. before the handshake completes.",
  )
  t.eqStr("a bulleted span", textTestNums(gateSentenceSpan("o A MUST be X; o B MUST be Y.", [], 20)), "17,28,29")
  t.eqStr(
    "the first item skips its bullet",
    textTestNums(gateSentenceSpan("o A MUST be X; o B MUST be Y.", [], 4)),
    "2,13,14",
  )
  for (const abbr of ["e.g.", "i.e.", "etc.", "vs.", "cf.", "Fig.", "Sec.", "et al.", "a.k.a.", "E.G.", "FIG."]) {
    const text = `One. A MUST hold ${abbr} Then MUST go. Two.`
    const whole = `A MUST hold ${abbr} Then MUST go.`
    t.eqStr(`${abbr} does not end a sentence, from its start side`, gateSentenceAt(text, [], 7), whole)
    t.eqStr(`nor ${abbr} from its end side`, gateSentenceAt(text, [], text.indexOf("Then") + 6), whole)
  }
  t.eqStr(
    "et al. inside a sentence",
    gateSentenceAt("One. Smith et al. propose that clients MUST retry. Next.", [], 10),
    "Smith et al. propose that clients MUST retry.",
  )
  t.eqStr("the last sentence stops before its terminator", textTestNums(gateSentenceSpan('Go "now."', [], 1)), "0,7,9")
  t.eqStr("a byte list inside a call", gateByteLists("hexEncode([00 0f f0 ff])").join("|"), "000ff0ff")
  t.eqStr("commas, upper case, two lists", gateByteLists("[0A, FF] and [01]").join("|"), "0aff|01")
  t.eqStr("not a byte list", gateByteLists("[0] [00ff] [zz] [00 0] [00 ff").join("|"), "")
  return t.done()
}
