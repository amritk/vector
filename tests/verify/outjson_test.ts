import { Suite } from "nish/testing"
import {
  outJsonArray,
  outJsonBool,
  outJsonInt,
  outJsonObject,
  outJsonQuote,
  outJsonRender,
  outJsonString,
  outJsonStrings,
} from "../../src/verify/emit/outjson"

export const main = (): i32 => {
  const t = new Suite("verify/outjson")
  t.eqStr("outJsonQuote escapes", outJsonQuote('a"b\\c\nd'), '"a\\"b\\\\c\\nd"')
  t.eqStr("outJsonQuote control", outJsonQuote("\u0001"), '"\\u0001"')
  t.eqStr("outJsonRender string", outJsonRender(outJsonString("x")), '"x"')
  t.eqStr("outJsonRender bool", outJsonRender(outJsonBool(true)), "true")
  t.eqStr("outJsonRender int", outJsonRender(outJsonInt(-3)), "-3")
  t.eqStr("outJsonRender empty array", outJsonRender(outJsonArray()), "[]")
  t.eqStr("outJsonRender empty object", outJsonRender(outJsonObject()), "{}")
  const items: string[] = ["a", "b"]
  const v = outJsonObject().put("n", outJsonInt(1)).put("xs", outJsonStrings(items))
  t.eqStr("outJsonRender nested", outJsonRender(v), '{\n  "n": 1,\n  "xs": [\n    "a",\n    "b"\n  ]\n}')
  return t.done()
}
