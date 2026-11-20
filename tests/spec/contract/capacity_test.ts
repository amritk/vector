import { Suite } from "nish/testing"
import { capacityNames, capacityNish, capacityParse, capacityShow } from "../../../src/spec/contract/capacity"
import { specTestRepeat } from "../repeat"

/** A capacity in its one spelling, then the names it reads; or why it is refused. */
const capTestShow = (text: string): string => {
  const e = capacityParse(text)
  if (e.isErr()) {
    return e.error
  }
  return `${capacityShow(e.value)} [${capacityNames(e.value).join(",")}]`
}

const TOO_MANY: string = "has more than 256 tokens (numbers, names and punctuation)"
const OVER: string = "is over 1048576 (2^20) even with every length 0"
const NAN: string = "multiplies 0 by a product past what an f64 holds"

export const main = (): i32 => {
  const t = new Suite("capacity")
  // [text, what it reads as]
  const cases: string[][] = [
    ["4096", "4096 []"],
    ["0", "0 []"],
    ["1048576", "1048576 []"],
    ["src.length", "src.length [src]"],
    ["2 * src.length + 8", "2 * src.length + 8 [src]"],
    ["  2*src.length+8 ", "2 * src.length + 8 [src]"],
    ["(2 * src.length) + 8", "2 * src.length + 8 [src]"],
    ["2 * (src.length + 8)", "2 * (src.length + 8) [src]"],
    ["(a.length + b.length) * (3 + 1)", "(a.length + b.length) * (3 + 1) [a,b]"],
    ["a.length * (b.length * 2)", "a.length * (b.length * 2) [a,b]"],
    ["a.length * b.length * 2", "a.length * b.length * 2 [a,b]"],
    ["a.length + a.length", "a.length + a.length [a]"],
    ["((7))", "7 []"],
    ["", "stops at the end"],
    ["   ", "stops at the end"],
    ["2 *", "stops at the end"],
    ["2 +", "stops at the end"],
    ["(2 + 3", "stops at the end"],
    ["2 + 3)", "stops at `)`"],
    ["2 - 1", "stops at `-`"],
    ["2 / 1", "stops at `/`"],
    ["-1", "stops at `-`"],
    ["2 3", "stops at `3`"],
    ["007", "stops at `007`"],
    ["1048577", "stops at `1048577`"],
    ["99999999", "stops at `99999999`"],
    ["0x10", "stops at `0x10`"],
    ["12ab", "stops at `12ab`"],
    ["src", "stops at the end"],
    ["src.size", "stops at `size`"],
    ["src . length", "src.length [src]"],
    ["src.length.length", "stops at `.`"],
    ["src[0]", "stops at `[`"],
    ["f(src)", "stops at `(`"],
    ["()", "stops at `)`"],
    ["2 ** 3", "stops at `*`"],
    // parentheses nest at most 16 deep
    [`${specTestRepeat("(", 16)}1${specTestRepeat(")", 16)}`, "1 []"],
    [`${specTestRepeat("(", 17)}1${specTestRepeat(")", 17)}`, "nests parentheses deeper than 16"],
    [`${specTestRepeat("(", 100000)}1`, TOO_MANY],
    // at most 256 tokens, however spaced, so neither depth nor length reaches the stack
    [`1${specTestRepeat(" + 1", 127)}`, `1${specTestRepeat(" + 1", 127)} []`],
    // 256 tokens: a capacity is an odd count, so 255 and one more stop the parser, not the count
    [`1${specTestRepeat(" + 1", 127)} +`, "stops at the end"],
    [`1${specTestRepeat(" + 1", 127)})`, "stops at `)`"],
    [`1${specTestRepeat("+1", 127)}+ 2`, TOO_MANY],
    [`1${specTestRepeat("+1", 127)}${specTestRepeat(" ", 100000)}`, `1${specTestRepeat(" + 1", 127)} []`],
    [`1${specTestRepeat(" + 1", 190000)}`, TOO_MANY],
    [`src.length${specTestRepeat(" + src.length", 63)}`, `src.length${specTestRepeat(" + src.length", 63)} [src]`],
    [`src.length${specTestRepeat(" + src.length", 64)}`, TOO_MANY],
    // a product past what an f64 holds is Infinity, and Infinity times 0 is NaN
    [`1048576${specTestRepeat("*1048576", 49)}`, OVER],
    [`1048576${specTestRepeat("*1048576", 59)}`, OVER],
    [`1048576${specTestRepeat("*1048576", 59)}*0`, NAN],
    [`(1048576${specTestRepeat("*1048576", 59)})*src.length`, NAN],
    [`(1048576${specTestRepeat("*1048576", 59)}) * (src.length + 0)`, NAN],
    // left to right, a 0 or a length first keeps the floor 0; a sample's length can still make it Infinity or NaN
    [`0*1048576${specTestRepeat("*1048576", 59)}`, `0 * 1048576${specTestRepeat(" * 1048576", 59)} []`],
    [
      `src.length*1048576${specTestRepeat("*1048576", 59)}*0`,
      `src.length * 1048576${specTestRepeat(" * 1048576", 59)} * 0 [src]`,
    ],
  ]
  for (const c of cases) {
    t.eqStr(`capacity \`${c[0]}\``, capTestShow(c[0]), c[1])
  }
  // [capacity, its Nish f64 form]: a bare number too, which `4096.0` would not compile as in i32 mode
  const nish: string[][] = [
    ["2 * (src.length + 8)", "toF64(2) * (toF64(a_src.length) + toF64(8))"],
    ["4096", "toF64(4096)"],
    ["src.length", "toF64(a_src.length)"],
  ]
  for (const n of nish) {
    const e = capacityParse(n[0])
    if (e.isOk()) {
      t.eqStr(`\`${n[0]}\` in Nish`, capacityNish(e.value, "a_"), n[1])
    } else {
      t.fail(`\`${n[0]}\` in Nish`, "did not parse")
    }
  }
  return t.done()
}
