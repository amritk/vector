import { Suite } from "nish/testing"
import { Program } from "../../src/verify/lang/ast"
import { replayEvaluate, replayParseValue, replayValueText } from "../../src/verify/solve/replay"
import { BCase, bBin, bProgram, bUn, bVar } from "./build"

const wrapNone = (): string[] => {
  const none: string[] = []
  return none
}

/** One replay of a one-parameter function: the input and the body it must print. */
class WrapCase {
  fn: string
  x: string
  y: string
  want: string

  constructor(fn: string, x: string, y: string, want: string) {
    this.fn = fn
    this.x = x
    this.y = y
    this.want = want
  }
}

const wrapProgram = (t: Suite): Program => {
  const c = new BCase("wraps")
  const triv = [bBin("==", bVar("result"), bVar("result"))]
  c.fn("neg", 1, ["x:Real"], "Real", wrapNone(), triv, bUn("neg", bVar("x")))
  c.fn("sum", 1, ["x:Real", "y:Real"], "Real", wrapNone(), triv, bBin("+", bVar("x"), bVar("y")))
  const program = bProgram(c.programText())
  t.eqStr("wraps builds", program.isOk() ? "" : program.error, "")
  return program.isOk() ? program.value : new Program("wraps")
}

export const main = (): i32 => {
  const t = new Suite("verify/replay wraps")
  const program = wrapProgram(t)
  const over = "a step leaves the i64 range the replay computes in"
  const max = "9223372036854775807"
  const rows: WrapCase[] = [
    // replayAdd64: the sum, and the wrap it refuses.
    new WrapCase("sum", "9223372036854775806", "1", max),
    new WrapCase("sum", max, "0", max),
    new WrapCase("sum", max, "1", over),
    new WrapCase("sum", "1", max, over),
    new WrapCase("sum", "(- 9223372036854775807)", "(- 1)", over),
    new WrapCase("sum", "(- 9223372036854775806)", "(- 1)", "-9223372036854775807"),
    new WrapCase("sum", max, "(- 1)", "9223372036854775806"),
    new WrapCase("sum", "(- 9223372036854775807)", "1", "-9223372036854775806"),
    new WrapCase("sum", "3", "4", "7"),
    // replayNeg: the other sign, and zero.
    new WrapCase("neg", "5", "", "-5"),
    new WrapCase("neg", "(- 5)", "", "5"),
    new WrapCase("neg", "0", "", "0"),
    new WrapCase("neg", max, "", "-9223372036854775807"),
    new WrapCase("neg", "(- 9223372036854775807)", "", max),
  ]
  for (const row of rows) {
    for (const fn of program.functions) {
      if (fn.name === row.fn) {
        const names = row.fn === "sum" ? ["x", "y"] : ["x"]
        const values = row.fn === "sum" ? [row.x, row.y] : [row.x]
        const run = replayEvaluate(program, fn, names, values)
        const got = run.body.known ? replayValueText(run.body) : run.body.why
        t.eqStr(`${row.fn}(${row.x}, ${row.y})`, got, row.want)
      }
    }
  }

  // The digits of a decimal are summed one at a time through replayAdd64.
  const parse: string[][] = [
    [max, max],
    ["9223372036854775808", ""],
    ["9223372036854775809", ""],
    ["922337203685477580.7", "9223372036854775807/10"],
    ["922337203685477580.8", ""],
    ["-9223372036854775807", "-9223372036854775807"],
    ["-9223372036854775808", ""],
    ["1/-3", "-1/3"],
  ]
  for (const row of parse) {
    const v = replayParseValue(row[0])
    t.eqStr(`parse ${row[0]}`, v.known ? replayValueText(v) : "", row[1])
  }
  return t.done()
}
