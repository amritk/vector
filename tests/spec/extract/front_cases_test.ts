import { Suite } from "nish/testing"
import { FnSig } from "../../../src/spec/contract/types"
import { FrontRefusal, frontParseInterface, frontParseProperty } from "../../../src/spec/front/front"

/** One refusal as `message @line:col`, or how many there were. */
const frontCasesTestRefusal = (r: FrontRefusal[]): string =>
  r.length === 1 ? `${r[0].message} @${r[0].line}:${r[0].col}` : `${r.length} refusals`

/** What parsing `text` as an interface gives: its refusal, or "accepted". */
const frontCasesTestIface = (text: string): string => {
  const r = frontParseInterface(text)
  return r.isErr() ? frontCasesTestRefusal(r.error) : "accepted"
}

/** What parsing `text` as a property over `fns` gives: its refusal, or "accepted". */
const frontCasesTestProp = (text: string, fns: FnSig[]): string => {
  const r = frontParseProperty(text, fns)
  return r.isErr() ? frontCasesTestRefusal(r.error) : "accepted"
}

/** The refusals of a module line after the first. */
const frontCasesTestModules = (t: Suite): void => {
  const f = "export function f(): i32"
  const g = "export function g(): i32"
  const cases: string[][] = [
    ["a second module line", `// module: nish/m\n${f}\n// module: nish/r\n${g}`, "accepted"],
    [
      "the same module twice in a row",
      `// module: nish/m\n${f}\n// module: nish/r\n${g}\n// module: nish/r\nexport function h(): i32`,
      "the functions above are already from nish/r @5:1",
    ],
    [
      "back to the module under test",
      `// module: nish/m\n${f}\n// module: nish/r\n${g}\n// module: nish/m\nexport function h(): i32`,
      "nish/m is the module under test; declare its functions first, before any `// module:` line @5:1",
    ],
    [
      "the module under test declares nothing",
      `// module: nish/m\n// module: nish/r\n${g}`,
      "nish/m, the module under test, declares no function; declare its functions before `// module: nish/r` @2:1",
    ],
    [
      "a module line inside a signature",
      "// module: nish/m\nexport function f(// module: nish/r\n): i32",
      "a module line goes between signatures, on its own line; move it out of this one @2:19",
    ],
    [
      "a block-comment module line after line 1",
      `// module: nish/m\n${f}\n/* module: nish/r */\n${g}`,
      "a module line is a line comment; write `// module: nish/r` @3:1",
    ],
    [
      "a capitalised module line",
      `// module: nish/m\n${f}\n// Module: nish/x\n${g}`,
      "a module line is `// module: <root>/<path>`, one module, not `// Module: nish/x` @3:1",
    ],
    [
      "a module line without its colon",
      `// module: nish/m\n${f}\n// module nish/x\n${g}`,
      "a module line is `// module: <root>/<path>`, one module, not `// module nish/x` @3:1",
    ],
  ]
  for (const k of cases) {
    t.eqStr(`module line: ${k[0]}`, frontCasesTestIface(k[1]), k[2])
  }
}

/** Columns count UTF-16 units, and string literals are JSON strings. */
const frontCasesTestLiterals = (t: Suite): void => {
  const fns: FnSig[] = []
  const head = "// P-X covers R-X — a title\nforall (t: string /* 0..4 */) => "
  const cases: string[][] = [
    ["a column after a non-ASCII character", `${head}t === "é" && @`, "`@` is not in the ts-property subset @2:47"],
    ["a column after an astral character", `${head}t === "😀" && @`, "`@` is not in the ts-property subset @2:48"],
    ["a raw TAB in a string literal", `${head}t === "a\tb"`, "malformed string literal @2:40"],
    ["a lone surrogate escape", `${head}t === "\\uD800"`, "malformed string literal @2:40"],
  ]
  for (const k of cases) {
    t.eqStr(`literal: ${k[0]}`, frontCasesTestProp(k[1], fns), k[2])
  }
}

export const main = (): i32 => {
  const t = new Suite("front cases")
  frontCasesTestModules(t)
  frontCasesTestLiterals(t)
  return t.done()
}
