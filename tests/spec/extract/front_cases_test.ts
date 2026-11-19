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

/** What parsing `text` as an interface gives: its refusal, or each parameter as `name:type[:form]`. */
const frontCasesTestForms = (text: string): string => {
  const r = frontParseInterface(text)
  if (r.isErr()) {
    return frontCasesTestRefusal(r.error)
  }
  const out: string[] = []
  for (const f of r.value.functions) {
    for (const p of f.params) {
      const form = p.form
      out.push(form === null ? `${p.name}:${p.type}` : `${p.name}:${p.type}:${form}`)
    }
  }
  return out.join(" ")
}

/** The `/* window *\/` comment after a parameter's type: only after u8[], only that text. */
const frontCasesTestWindow = (t: Suite): void => {
  const m = "// module: nish/m\n"
  const only = "an interface parameter takes only /* window */, not"
  const after = "/* window */ goes only after u8[], which the real function takes as (buf, off, len)"
  const cases: string[][] = [
    ["on u8[]", `${m}export const f = (d: u8[] /* window */): u32`, "d:bytes:window"],
    ["spaced", `${m}export const f = (d: u8[] /*   window  */): u32`, "d:bytes:window"],
    ["unspaced", `${m}export const f = (d: u8[] /*window*/): u32`, "d:bytes:window"],
    ["absent", `${m}export const f = (d: u8[]): u32`, "d:bytes"],
    [
      "two windows and a plain parameter",
      `${m}export const f = (a: u8[] /* window */, n: i32, b: u8[] /* window */): u32`,
      "a:bytes:window n:i32 b:bytes:window",
    ],
    ["on Secret<u8[]>", `${m}export const f = (d: Secret<u8[]> /* window */): u32`, `\`f(d)\` is Secret<u8[]>: ${after} @2:35`],
    ["on u8[] | null", `${m}export const f = (d: u8[] | null /* window */): u32`, `\`f(d)\` is u8[] | null: ${after} @2:34`],
    ["on u32[]", `${m}export const f = (d: u32[] /* window */): u32`, `\`f(d)\` is u32[]: ${after} @2:28`],
    ["on a scalar", `${m}export const f = (d: i32 /* window */): u32`, `\`f(d)\` is i32: ${after} @2:26`],
    ["on a string", `${m}export const f = (d: string /* window */): u32`, `\`f(d)\` is string: ${after} @2:29`],
    ["twice", `${m}export const f = (d: u8[] /* window */ /* window */): u32`, "`f(d)` is already a window; write /* window */ once @2:40"],
    ["other text", `${m}export const f = (d: u8[] /* the data */): u32`, `\`f(d)\`: ${only} \`/* the data */\` @2:27`],
    ["a capitalised window", `${m}export const f = (d: u8[] /* Window */): u32`, `\`f(d)\`: ${only} \`/* Window */\` @2:27`],
    ["more than window", `${m}export const f = (d: u8[] /* window 4 */): u32`, `\`f(d)\`: ${only} \`/* window 4 */\` @2:27`],
    ["a line comment", `${m}export const f = (d: u8[] // window\n): u32`, `\`f(d)\`: ${only} \`// window\` @2:27`],
    [
      "a module line there",
      `${m}export const f = (d: u8[] // module: nish/r\n): u32`,
      "a module line goes between signatures, on its own line; move it out of this one @2:27",
    ],
  ]
  for (const k of cases) {
    t.eqStr(`window: ${k[0]}`, frontCasesTestForms(k[1]), k[2])
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

/** What parsing `text` as a property gives: its refusal, or the samples it sets. */
const frontCasesTestSamplesOf = (text: string): string => {
  const fns: FnSig[] = []
  const r = frontParseProperty(text, fns)
  return r.isErr() ? frontCasesTestRefusal(r.error) : `samples ${r.value.clause.samples}`
}

/** The optional `// samples: N` line 2: its spelling, range and place. */
const frontCasesTestSamples = (t: Suite): void => {
  const head = "// P-X covers R-X — a title\n"
  const body = "forall (x: i32 /* 0..9 */) => x === x"
  const decimal = "samples takes a decimal integer, 1..256, as `// samples: N`"
  const cases: string[][] = [
    ["absent", `${head}${body}`, "samples -1"],
    ["96", `${head}// samples: 96\n${body}`, "samples 96"],
    ["1, the floor", `${head}// samples: 1\n${body}`, "samples 1"],
    ["256, the ceiling", `${head}// samples: 256\n${body}`, "samples 256"],
    ["spaces around it", `${head}//   samples:   48  \n${body}`, "samples 48"],
    ["0", `${head}// samples: 0\n${body}`, "samples must be 1..256, not 0 @2:1"],
    ["257", `${head}// samples: 257\n${body}`, "samples must be 1..256, not 257 @2:1"],
    [
      "far past the ceiling",
      `${head}// samples: 99999999999999999999\n${body}`,
      "samples must be 1..256, not 99999999999999999999 @2:1",
    ],
    ["a fraction", `${head}// samples: 12.5\n${body}`, `${decimal} @2:1`],
    ["a sign", `${head}// samples: -1\n${body}`, `${decimal} @2:1`],
    ["a plus sign", `${head}// samples: +1\n${body}`, `${decimal} @2:1`],
    ["a leading zero", `${head}// samples: 096\n${body}`, `${decimal} @2:1`],
    ["an exponent", `${head}// samples: 1e2\n${body}`, `${decimal} @2:1`],
    ["a word", `${head}// samples: x\n${body}`, `${decimal} @2:1`],
    ["no value", `${head}// samples:\n${body}`, `${decimal} @2:1`],
    ["no colon", `${head}// samples 96\n${body}`, `${decimal} @2:1`],
    [
      "on line 3",
      `${head}// other\n// samples: 96\n${body}`,
      "the samples line goes on line 2, after the covers line @3:1",
    ],
    [
      "inside the body",
      `${head}forall (x: i32 /* 0..9 */) =>\n  // samples: 96\n  x === x`,
      "the samples line goes on line 2, after the covers line @3:3",
    ],
    [
      "a second one",
      `${head}// samples: 4\n// samples: 8\n${body}`,
      "the samples line goes on line 2, after the covers line @3:1",
    ],
    ["another comment on line 2", `${head}// a note\n${body}`, "samples -1"],
    ["a word that only starts with samples", `${head}// samplesheet: 3\n${body}`, "samples -1"],
    ["a capitalised samples line", `${head}// Samples: 5\n${body}`, `${decimal} @2:1`],
    ["an uppercase samples line", `${head}// SAMPLES: 5\n${body}`, `${decimal} @2:1`],
    ["a block-comment samples line", `${head}/* samples: 5 */\n${body}`, `${decimal} @2:1`],
    ["prose that starts with samples", `${head}// samples are drawn at random\n${body}`, `${decimal} @2:1`],
  ]
  for (const k of cases) {
    t.eqStr(`samples line: ${k[0]}`, frontCasesTestSamplesOf(k[1]), k[2])
  }
}

export const main = (): i32 => {
  const t = new Suite("front cases")
  frontCasesTestModules(t)
  frontCasesTestWindow(t)
  frontCasesTestLiterals(t)
  frontCasesTestSamples(t)
  return t.done()
}
