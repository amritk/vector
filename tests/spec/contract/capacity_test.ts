import { Suite } from "nish/testing"
import { capacityNames, capacityNish, capacityParse, capacityShow } from "../../../src/spec/contract/capacity"

/** A capacity in its one spelling, then the names it reads; or `stops at <token>`. */
const capTestShow = (text: string): string => {
  const e = capacityParse(text)
  if (e.isErr()) {
    return `stops at ${e.error}`
  }
  return `${capacityShow(e.value)} [${capacityNames(e.value).join(",")}]`
}

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
  ]
  for (const c of cases) {
    t.eqStr(`capacity \`${c[0]}\``, capTestShow(c[0]), c[1])
  }
  const e = capacityParse("2 * (src.length + 8)")
  if (e.isOk()) {
    t.eqStr("a capacity in Nish", capacityNish(e.value, "a_"), "2 * (toI32(a_src.length) + 8)")
  } else {
    t.fail("a capacity in Nish", "did not parse")
  }
  return t.done()
}
