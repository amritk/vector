import { Suite } from "nish/testing"
import {
  charsCodePointAt,
  charsFirstControl,
  charsFromCodePoint,
  charsHasLetter,
  charsIsAbs,
  charsIsControl,
  charsIsF64Text,
  charsIsId,
  charsIsIdent,
  charsIsLowerHex,
  charsIsModule,
  charsIsSection,
  charsIsStringText,
  charsName,
  charsSequenceLength,
  charsTestVector,
} from "../../../src/spec/contract/chars"
import {
  contractF64Bits,
  contractF64FromBits,
  contractF64IsNaN,
  contractF64Overflows,
  contractF64Parse,
} from "../../../src/spec/contract/f64"

/** The character scans and the f64 helpers. */
export const main = (): i32 => {
  const t = new Suite("spec/contract chars and f64")

  // UTF-8.
  t.ok("ascii", charsCodePointAt("a", 0) === 0x61 && charsSequenceLength("a", 0) === 1)
  t.ok("two bytes", charsCodePointAt("é", 0) === 0xe9 && charsSequenceLength("é", 0) === 2)
  t.ok(
    "three bytes",
    charsCodePointAt(charsFromCodePoint(0x200b), 0) === 0x200b &&
      charsSequenceLength(charsFromCodePoint(0x200b), 0) === 3,
  )
  t.ok(
    "four bytes",
    charsCodePointAt(charsFromCodePoint(0x1d400), 0) === 0x1d400 &&
      charsSequenceLength(charsFromCodePoint(0x1d400), 0) === 4,
  )
  const cut = "é".substring(0, 1)
  t.ok(
    "a cut sequence reads as U+FFFD, one byte",
    charsCodePointAt(cut, 0) === 0xfffd && charsSequenceLength(cut, 0) === 1,
  )
  t.eqStr("from code points", `${charsFromCodePoint(0x41)}${charsFromCodePoint(0xe9)}`, "Aé")
  t.eqStr("name of LF", charsName(10), "U+000A")
  t.eqStr("name past the BMP", charsName(0x1d400), "U+1D400")

  // Control characters.
  t.ok("C0, DEL, C1, LS", charsIsControl(0) && charsIsControl(0x7f) && charsIsControl(0x85) && charsIsControl(0x2028))
  t.ok("not control", !charsIsControl(0x20) && !charsIsControl(0xa0))
  t.eqStr("first control", charsFirstControl(`ab${charsFromCodePoint(0x2029)}c\n`) ?? "", "U+2029")
  t.ok("no control", charsFirstControl("plain é") === null)

  // Patterns.
  t.ok("string text", charsIsStringText("a\tb\r\n~") && !charsIsStringText("é") && !charsIsStringText("\u0001"))
  t.ok("lower hex", charsIsLowerHex("00ff", -1) && !charsIsLowerHex("0", -1) && !charsIsLowerHex("0F", -1))
  t.ok("lower hex of a length", charsIsLowerHex("abc", 3) && !charsIsLowerHex("ab", 3))
  t.ok("ids", charsIsId("rfc-4648.v1_x") && !charsIsId("-x") && !charsIsId("") && !charsIsId("a b"))
  t.ok("idents", charsIsIdent("_a1") && !charsIsIdent("1a") && !charsIsIdent("a-b") && !charsIsIdent(""))
  t.ok("sections", charsIsSection("2.3") && charsIsSection("A") && charsIsSection("A.1") && charsIsSection("10"))
  t.ok("not sections", !charsIsSection("") && !charsIsSection("2.") && !charsIsSection(".2") && !charsIsSection("a.1"))
  // A test case's name, Test Vector #N: N from 1, no leading zero, nothing around it.
  const cases: string[][] = [
    ["Test Vector #1", "1"],
    ["Test Vector #2", "2"],
    ["Test Vector #11", "11"],
    ["Test Vector #999999", "999999"],
    ["Test Vector #1000000", "0"],
    ["Test Vector #0", "0"],
    ["Test Vector #02", "0"],
    ["Test Vector #", "0"],
    ["Test Vector 2", "0"],
    ["Test vector #2", "0"],
    ["test vector #2", "0"],
    ["Test Vector #2.", "0"],
    ["Test Vector #2:", "0"],
    ["Test Vector #2 ", "0"],
    [" Test Vector #2", "0"],
    ["Test Vector #-2", "0"],
    ["Test Vector #2a", "0"],
    ["Test Vectors #2", "0"],
    ["", "0"],
  ]
  for (const c of cases) {
    t.eqStr(`test case "${c[0]}"`, `${charsTestVector(c[0])}`, c[1])
  }
  t.ok(
    "abs",
    charsIsAbs("0") &&
      charsIsAbs("1.5") &&
      charsIsAbs("2e-10") &&
      !charsIsAbs("-1") &&
      !charsIsAbs("01") &&
      !charsIsAbs("1."),
  )
  t.ok(
    "f64 text",
    charsIsF64Text("-0.5") &&
      charsIsF64Text("NaN") &&
      charsIsF64Text("-Infinity") &&
      !charsIsF64Text("+1") &&
      !charsIsF64Text("inf"),
  )
  t.ok(
    "modules",
    charsIsModule("nish/crypto/hkdf") &&
      !charsIsModule("nish") &&
      !charsIsModule("nish//x") &&
      !charsIsModule("Nish/x") &&
      !charsIsModule("nish/1x"),
  )
  t.ok("letters", charsHasLetter("x1") && !charsHasLetter("123"))

  // f64.
  t.eqStr("bits of 1", contractF64Bits(1.0), "3ff0000000000000")
  t.eqStr("bits of -0", contractF64Bits(contractF64Parse("-0")), "8000000000000000")
  t.eqStr("bits of 0.1", contractF64Bits(contractF64Parse("0.1")), "3fb999999999999a")
  t.ok("from bits", contractF64FromBits("4000000000000000").expect("bits") === 2.0)
  t.ok("round trip", contractF64Bits(contractF64FromBits("c00921fb54442d18").expect("bits")) === "c00921fb54442d18")
  const short = contractF64FromBits("3ff0")
  t.eqStr("too few digits", short.isErr() ? short.error : "", '"3ff0" is not 16 lowercase hex digits')
  const upper = contractF64FromBits("3FF0000000000000")
  t.eqStr("capitals", upper.isErr() ? upper.error : "", '"3FF0000000000000" is not 16 lowercase hex digits')
  t.ok("not hex", contractF64FromBits("3ff000000000000g").isErr())
  t.ok("NaN", contractF64IsNaN(contractF64Parse("NaN")) && !contractF64IsNaN(1.0))
  t.ok("overflows", contractF64Overflows("1e309") && contractF64Overflows("-2e308"))
  t.ok(
    "does not overflow",
    !contractF64Overflows("1.7976931348623157e308") &&
      !contractF64Overflows("Infinity") &&
      !contractF64Overflows("NaN"),
  )
  return t.done()
}
