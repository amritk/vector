import { Suite } from "nish/testing"
import { split } from "nish/text"
import {
  STATUS_REFUTED,
  STATUS_UNKNOWN,
  dashInputs,
  dashWrap,
  renderDashboard,
  verdictStatus,
} from "../../src/verify/emit/dashboard"
import {
  outJsonArray,
  outJsonInt,
  outJsonObject,
  outJsonQuote,
  outJsonRender,
  outJsonString,
} from "../../src/verify/emit/outjson"
import { functionsByLayer, jsdocSafe } from "../../src/verify/emit/typescript"
import { EXPR_NUM, FnUnit, LangExpr, Program } from "../../src/verify/lang/ast"
import { Counterexample, FnReport, VerifyReport } from "../../src/verify/solve/report"

// The rewrites that took the panic sites out of typescript, outjson and
// dashboard, held to the bytes the old code wrote.

const npFn = (name: string, layer: i32): FnUnit => {
  const none: LangExpr[] = []
  return new FnUnit(name, layer, "", "Real", new LangExpr(EXPR_NUM, "", "0", "", none))
}

const npRepeat = (s: string, n: i32): string => {
  let out = ""
  for (let i = 0; i < n; i++) {
    out = out + s
  }
  return out
}

const npTypescript = (t: Suite): void => {
  t.eqStr("jsdocSafe escapes */", jsdocSafe("a*/b"), "a*\\/b")
  t.eqStr("jsdocSafe escapes */ at the start", jsdocSafe("*/"), "*\\/")
  t.eqStr("jsdocSafe escapes after **", jsdocSafe("**/"), "**\\/")
  t.eqStr("jsdocSafe escapes /*/ once", jsdocSafe("/*/"), "/*\\/")
  t.eqStr("jsdocSafe escapes */*/ twice", jsdocSafe("*/*/"), "*\\/*\\/")
  t.eqStr("jsdocSafe keeps a / after an escaped one", jsdocSafe("*//"), "*\\//")
  t.eqStr("jsdocSafe keeps * then space then /", jsdocSafe("a* /b"), "a* /b")
  t.eqStr("jsdocSafe keeps * newline /", jsdocSafe("a*\n/b"), "a* /b")
  t.eqStr("jsdocSafe keeps *x/", jsdocSafe("*x/"), "*x/")
  t.eqStr("jsdocSafe keeps a lone /", jsdocSafe("/"), "/")
  t.eqStr("jsdocSafe keeps a leading-space /", jsdocSafe("  */ "), "*\\/")

  const p = new Program("layers")
  p.functions.push(npFn("a", 2))
  p.functions.push(npFn("b", 1))
  p.functions.push(npFn("c", 3))
  p.functions.push(npFn("d", 1))
  p.functions.push(npFn("e", 2))
  const names: string[] = []
  for (const fn of functionsByLayer(p)) {
    names.push(fn.name)
  }
  t.eqStr("functionsByLayer orders stably by layer", names.join(","), "b,d,a,e,c")
  t.eqI32("functionsByLayer on no functions", toI32(functionsByLayer(new Program("none")).length), 0)
}

const npOutJson = (t: Suite): void => {
  t.eqStr("outJsonQuote \\u0000", outJsonQuote("\u0000"), '"\\u0000"')
  t.eqStr("outJsonQuote \\u000b", outJsonQuote("\u000b"), '"\\u000b"')
  t.eqStr("outJsonQuote \\u000e", outJsonQuote("\u000e"), '"\\u000e"')
  t.eqStr("outJsonQuote \\u0010", outJsonQuote("\u0010"), '"\\u0010"')
  t.eqStr("outJsonQuote \\u0019", outJsonQuote("\u0019"), '"\\u0019"')
  t.eqStr("outJsonQuote \\u001a", outJsonQuote("\u001a"), '"\\u001a"')
  t.eqStr("outJsonQuote \\u001b", outJsonQuote("\u001b"), '"\\u001b"')
  t.eqStr("outJsonQuote \\u001c", outJsonQuote("\u001c"), '"\\u001c"')
  t.eqStr("outJsonQuote \\u001d", outJsonQuote("\u001d"), '"\\u001d"')
  t.eqStr("outJsonQuote \\u001f", outJsonQuote("\u001f"), '"\\u001f"')
  t.eqStr("outJsonQuote keeps a space", outJsonQuote(" "), '" "')
  t.eqStr("outJsonQuote escapes at both ends", outJsonQuote("\tab\b"), '"\\tab\\b"')
  t.eqStr("outJsonQuote escapes in a row", outJsonQuote('x\r\f"\\y'), '"x\\r\\f\\"\\\\y"')
  t.eqStr("outJsonQuote keeps the tail", outJsonQuote("\nabc"), '"\\nabc"')
  t.eqStr("outJsonQuote empty", outJsonQuote(""), '""')

  const deep = outJsonArray()
    .add(outJsonInt(1))
    .add(outJsonObject().put("k", outJsonArray().add(outJsonString("v")).add(outJsonArray())))
    .add(outJsonInt(2))
  t.eqStr(
    "outJsonRender indents three levels",
    outJsonRender(deep),
    '[\n  1,\n  {\n    "k": [\n      "v",\n      []\n    ]\n  },\n  2\n]',
  )
  t.eqStr("outJsonRender one item", outJsonRender(outJsonArray().add(outJsonInt(7))), "[\n  7\n]")
  // `put` on an array keeps the key, and the array writes no key.
  t.eqStr("outJsonRender writes no key in an array", outJsonRender(outJsonArray().put("k", outJsonInt(1))), "[\n  1\n]")
  // `add` on an object leaves a value without a key: written bare, so the
  // text is not JSON.
  const keyless = outJsonObject().put("a", outJsonInt(1)).add(outJsonInt(2))
  t.eqStr("outJsonRender writes a keyless member bare", outJsonRender(keyless), '{\n  "a": 1,\n  2\n}')
}

const npDashboard = (t: Suite): void => {
  const cex = new Counterexample("r")
  cex.names.push("a")
  cex.names.push("b")
  cex.values.push("1")
  t.eqStr(
    "dashInputs refuses fewer values than names",
    dashInputs(cex),
    "(a bug in vector: 2 input names but 1 values)",
  )
  cex.values.push("2")
  t.eqStr("dashInputs pairs names and values", dashInputs(cex), "a = 1, b = 2")
  cex.values.push("3")
  t.eqStr("dashInputs ignores extra values", dashInputs(cex), "a = 1, b = 2")
  t.eqStr("dashInputs on no inputs", dashInputs(new Counterexample("r")), "")

  t.eqI32("dashWrap fits at exactly the width", toI32(dashWrap("ab cd", 5).length), 1)
  t.eqI32("dashWrap breaks one under the width", toI32(dashWrap("ab cd", 4).length), 2)
  t.eqI32("dashWrap counts code points", toI32(dashWrap("éé ü", 4).length), 1)
  t.eqI32("dashWrap at a negative width", toI32(dashWrap("a b", -1).length), 2)

  const r = new VerifyReport("z")
  r.unknownCount = 1
  t.eqStr("verdictStatus with no violation", verdictStatus(r), STATUS_UNKNOWN)
  r.vacuousCount = 1
  t.eqStr("verdictStatus with one violation", verdictStatus(r), STATUS_REFUTED)
  r.vacuousCount = 0x7fffffff
  r.satCount = 0x7fffffff
  t.contains("dashViolations sums past i32", renderDashboard("x", r), "4294967294 CONTRACT VIOLATION(S)")

  const empty = new VerifyReport("z")
  const lines = split(renderDashboard("x", empty), "\n")
  const top = `╔${npRepeat("═", 68)}╗`
  t.eqStr("renderDashboard frame", lines[0], top)
  t.eqStr(
    "dashCenter pads (68 - 21) >> 1",
    lines[1],
    `║ ${npRepeat(" ", 23)}VECTOR — PROOF REPORT${npRepeat(" ", 23)}║`,
  )
  t.eqStr("dashRow pads a short row", lines[3], `║ Prompt:  "x"${npRepeat(" ", 55)}║`)
  t.ok("no function, no ╟ separator", renderDashboard("x", empty).indexOf("╟") < 0)
  const two = new VerifyReport("z")
  two.functions.push(new FnReport(npFn("f", 1)))
  t.ok("one function, no ╟ separator", renderDashboard("x", two).indexOf("╟") < 0)
  two.functions.push(new FnReport(npFn("g", 1)))
  two.functions.push(new FnReport(npFn("h", 1)))
  const seps = split(renderDashboard("x", two), "╟")
  t.eqI32("three functions, two ╟ separators", toI32(seps.length), 3)
  t.ok("the separator follows the first function", seps[0].indexOf("LAYER 1") >= 0)

  // A word too long to wrap gets a row of its own: 67 code points fit, and a
  // longer one is cut to 66 and an ellipsis.
  const fits = split(renderDashboard(npRepeat("é", 65), empty), "\n")
  t.eqStr("dashRow keeps 67 code points", fits[4], `║ "${npRepeat("é", 65)}"║`)
  const cut = split(renderDashboard(npRepeat("é", 66), empty), "\n")
  t.eqStr("dashRow cuts 68 code points to 66 and …", cut[4], `║ "${npRepeat("é", 65)}…║`)

  // dashPush wraps at 66 code points less the indent.
  const words = `${npRepeat("w", 30)} ${npRepeat("v", 24)}`
  const wrapped = split(renderDashboard(words, empty), "\n")
  t.eqStr("dashPush fits 66 code points with no indent", wrapped[3], `║ Prompt:  "${words}"${npRepeat(" ", 1)}║`)
  const longer = `${npRepeat("w", 30)} ${npRepeat("v", 25)}`
  const broke = split(renderDashboard(longer, empty), "\n")
  t.eqStr("dashPush breaks past 66 code points", broke[4], `║ ${npRepeat("v", 25)}"${npRepeat(" ", 41)}║`)
}

export const main = (): i32 => {
  const t = new Suite("verify/emit-nopanic")
  npTypescript(t)
  npOutJson(t)
  npDashboard(t)
  return t.done()
}
