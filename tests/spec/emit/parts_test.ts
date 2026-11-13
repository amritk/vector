import { Suite } from "nish/testing"
import { contractLoadFile } from "../../../src/spec/contract/contract"
import { LitKind, Literal } from "../../../src/spec/contract/types"
import {
  emitClauseFn,
  emitNishType,
  emitRefusals,
  emitSortedUnique,
  emitTestName,
  emitWrap,
} from "../../../src/spec/emit/emit"
import { emitHelperDeps, emitHelperNames, emitHelperText } from "../../../src/spec/emit/helpers"
import {
  emitCommentText,
  emitF64IsFinite,
  emitF64Lit,
  emitIntLit,
  emitLiteralHex,
  emitQuote,
  emitToInt,
} from "../../../src/spec/emit/lit"

/** Checks the pieces a test is emitted from: literals, names, helpers and refusals. */
export const main = (): i32 => {
  const t = new Suite("spec/emit parts")

  t.eqStr("i64's conversion", emitToInt("i64"), "toI64")
  t.eqStr("u8's conversion", emitToInt("u8"), "toU8")
  t.eqStr("an i32 is its literal", emitIntLit("-5", "i32"), "(-5)")
  t.eqStr("an i64 within i32 converts", emitIntLit("7", "i64"), "toI64(7)")
  t.eqStr("an i64 within 2^53 is typed by its sum", emitIntLit("4294967296", "i64"), "(toI64(0) + 4294967296)")
  t.eqStr(
    "i64's minimum is built from exact halves",
    emitIntLit("-9223372036854775808", "i64"),
    "(toI64(-2147483648) * 4294967296 + 0)",
  )
  t.eqStr(
    "u64's maximum",
    emitIntLit("18446744073709551615", "u64"),
    "((toU64(0) + 4294967295) * 4294967296 + 4294967295)",
  )
  t.ok("1.5 is finite", emitF64IsFinite("1.5", null))
  t.ok("an infinity is not", !emitF64IsFinite("", "7ff0000000000000"))
  t.eqStr("an f64 through toF64", emitF64Lit("1", null), "toF64(1.0)")
  t.eqStr("-0 from its bits", emitF64Lit("-0", null), "bitsToF64((toI64(-2147483648) * 4294967296 + 0))")
  t.eqStr("a quoted string", emitQuote('a"b\\c\n\u0001'), '"a\\"b\\\\c\\n\\u0001"')
  t.eqStr("a comment cannot close", emitCommentText("x*/y\nz"), "x* /y z")
  const rep = new Literal(LitKind.Hex, "aB")
  rep.repeat = 3
  t.eqStr("a repeated hex literal", emitLiteralHex(rep), "ababab")
  const cat = new Literal(LitKind.Concat, "")
  cat.parts = [new Literal(LitKind.Hex, "00"), new Literal(LitKind.Str, "A")]
  t.eqStr("a concat's bytes", emitLiteralHex(cat), "0041")

  t.eqLines("sorted, each once", emitSortedUnique(["b", "a", "b", "c"]), ["a", "b", "c"])
  t.eqStr("bytes is u8[]", emitNishType("bytes"), "u8[]")
  t.eqStr("an optional string", emitNishType("string?"), "string | null")
  t.eqStr("bool is boolean", emitNishType("bool"), "boolean")
  t.eqLines("wrapped at the width", emitWrap("one two  three four", 9), ["one two", "three", "four"])

  const none: string[] = []
  const c = contractLoadFile("contracts/example-hex.json").expect("load")
  const v1 = c.clauses[0]
  t.ok("a test name brackets its clause", emitTestName(v1).startsWith("[V1] "))
  t.ok("and lists what it covers", emitTestName(v1).endsWith(`(${v1.covers.join(", ")})`))
  v1.id = "P-a.b"
  t.eqStr("a clause's function name", emitClauseFn(v1), "clause_P_a_b")
  t.eqLines("example-hex is expressible", emitRefusals(c, []), none)
  c.target.module = "lib/hex"
  t.ok("a module outside nish/ is refused", emitRefusals(c, []).length > 0)
  t.ok("and says how to place it", emitRefusals(c, [])[0].indexOf("--package <name>=<dir>") > 0)
  t.eqLines("a module --module places is not", emitRefusals(c, ["lib/hex"]), none)

  const names = emitHelperNames()
  t.ok("hexOf is a helper", names.indexOf("hexOf") === 0)
  t.eqLines("unhex needs nibble", emitHelperDeps("unhex"), ["nibble"])
  t.eqLines("bytesEq needs nothing", emitHelperDeps("bytesEq"), none)
  t.ok("every helper but unwrapStr has a definition", allDefined(names))
  t.eqStr("an unknown helper has none", emitHelperText("nope", false), "")
  return t.done()
}

/** Whether every helper in `names` other than `unwrapStr` has a definition. */
const allDefined = (names: string[]): boolean => {
  for (const n of names) {
    if (n !== "unwrapStr" && emitHelperText(n, false) === "") {
      return false
    }
  }
  return true
}
