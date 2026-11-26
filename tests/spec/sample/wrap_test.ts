import { Suite } from "nish/testing"
import { Expr, ExprKind } from "../../../src/spec/contract/types"
import { SampleValue, sampleEval, sampleInt } from "../../../src/spec/sample/eval"
import { sampleIntWrap } from "../../../src/spec/sample/ints"
import { SamplePrng, sampleIntIn } from "../../../src/spec/sample/prng"

/** One `x op y` in an integer type, and the value it must wrap to. */
class ArithCase {
  label: string
  op: string
  x: i64
  y: i64
  ty: string
  want: i64

  constructor(label: string, op: string, x: i64, y: i64, ty: string, want: i64) {
    this.label = label
    this.op = op
    this.x = x
    this.y = y
    this.ty = ty
    this.want = want
  }
}

/** One value reduced to an integer type, and what it must be. */
class WrapCase {
  label: string
  x: i64
  ty: string
  want: i64

  constructor(label: string, x: i64, ty: string, want: i64) {
    this.label = label
    this.x = x
    this.ty = ty
    this.want = want
  }
}

const wrapArith = (c: ArithCase): i64 => {
  const e = new Expr(ExprKind.Op, c.op)
  e.args.push(new Expr(ExprKind.Var, "x"))
  e.args.push(new Expr(ExprKind.Var, "y"))
  const env = new Map<string, SampleValue>()
  env.set("x", sampleInt(c.x, c.ty))
  env.set("y", sampleInt(c.y, c.ty))
  const r = sampleEval(e, env)
  return r.isOk() ? r.value.n : toI64(12345)
}

export const main = (): i32 => {
  const t = new Suite("spec/sample wraps")
  const max = (toI64(1) << toI64(62)) - toI64(1) + (toI64(1) << toI64(62))
  const min = -max - toI64(1)
  const one = toI64(1)
  const two = toI64(2)
  const u64Max = toI64(-1)

  // sampleArith: the type's wrapping arithmetic, held in an i64.
  const arith: ArithCase[] = [
    new ArithCase("i64 MAX + 1", "+", max, one, "i64", min),
    new ArithCase("i64 MIN + -1", "+", min, toI64(-1), "i64", max),
    new ArithCase("i64 MIN - 1", "-", min, one, "i64", max),
    new ArithCase("i64 MAX - -1", "-", max, toI64(-1), "i64", min),
    new ArithCase("i64 0 - MIN", "-", toI64(0), min, "i64", min),
    new ArithCase("i64 MAX * 2", "*", max, two, "i64", toI64(-2)),
    new ArithCase("i64 MIN * -1", "*", min, toI64(-1), "i64", min),
    new ArithCase("i64 MIN * 2", "*", min, two, "i64", toI64(0)),
    new ArithCase("i64 MAX - 1 + 1", "+", max - one, one, "i64", max),
    new ArithCase("u64 2^64-1 + 1", "+", u64Max, one, "u64", toI64(0)),
    new ArithCase("u64 0 - 1", "-", toI64(0), one, "u64", u64Max),
    new ArithCase("u64 2^64-1 * 2", "*", u64Max, two, "u64", toI64(-2)),
    new ArithCase("i32 MAX + 1", "+", toI64(2147483647), one, "i32", toI64(-2147483648)),
    new ArithCase("i32 MIN - 1", "-", toI64(-2147483648), one, "i32", toI64(2147483647)),
    new ArithCase("i32 MAX * 2", "*", toI64(2147483647), two, "i32", toI64(-2)),
    new ArithCase("u8 255 + 1", "+", toI64(255), one, "u8", toI64(0)),
    new ArithCase("u8 0 - 1", "-", toI64(0), one, "u8", toI64(255)),
    new ArithCase("i8 127 + 1", "+", toI64(127), one, "i8", toI64(-128)),
    new ArithCase("i8 -128 - 1", "-", toI64(-128), one, "i8", toI64(127)),
    new ArithCase("i8 -128 * -1", "*", toI64(-128), toI64(-1), "i8", toI64(-128)),
    new ArithCase("i64 3 + 4", "+", toI64(3), toI64(4), "i64", toI64(7)),
    new ArithCase("i64 3 - 4", "-", toI64(3), toI64(4), "i64", toI64(-1)),
    new ArithCase("i64 3 * 4", "*", toI64(3), toI64(4), "i64", toI64(12)),
  ]
  for (const c of arith) {
    t.ok(c.label, wrapArith(c) === c.want)
  }

  // sampleIntWrap at and around w = 63, where span is i64 MIN.
  const hi62 = (toI64(1) << toI64(62)) - one
  const wraps: WrapCase[] = [
    new WrapCase("i63 2^62 is its minimum", toI64(1) << toI64(62), "i63", -(toI64(1) << toI64(62))),
    new WrapCase("i63 2^62 - 1 stays", hi62, "i63", hi62),
    new WrapCase("i63 -2^62 stays", -(toI64(1) << toI64(62)), "i63", -(toI64(1) << toI64(62))),
    new WrapCase("i63 -1 stays", toI64(-1), "i63", toI64(-1)),
    new WrapCase("i63 MAX is -1", max, "i63", toI64(-1)),
    new WrapCase("i63 MIN is 0", min, "i63", toI64(0)),
    new WrapCase("u63 -1 is 2^63-1", toI64(-1), "u63", max),
    new WrapCase("u63 MIN is 0", min, "u63", toI64(0)),
    new WrapCase("u63 MAX stays", max, "u63", max),
    new WrapCase("u63 2^62 stays", toI64(1) << toI64(62), "u63", toI64(1) << toI64(62)),
    new WrapCase("i8 127 stays", toI64(127), "i8", toI64(127)),
    new WrapCase("i8 128 is -128", toI64(128), "i8", toI64(-128)),
    new WrapCase("i8 255 is -1", toI64(255), "i8", toI64(-1)),
    new WrapCase("i8 256 is 0", toI64(256), "i8", toI64(0)),
    new WrapCase("i8 -129 is 127", toI64(-129), "i8", toI64(127)),
    new WrapCase("u8 255 stays", toI64(255), "u8", toI64(255)),
    new WrapCase("u8 256 is 0", toI64(256), "u8", toI64(0)),
    new WrapCase("u8 -1 is 255", toI64(-1), "u8", toI64(255)),
  ]
  for (const c of wraps) {
    t.ok(c.label, sampleIntWrap(c.x, c.ty) === c.want)
  }

  // sampleIntIn: a span of 2^64 (wraps to 0), above 2^63, and just below it.
  const r = new SamplePrng("wrap")
  let inAll = true
  let inWide = true
  let inLow = true
  const wideHi = toI64(1) << toI64(62)
  const lowHi = toI64(-2) + (toI64(1) << toI64(62))
  for (let i = 0; i < 400; i++) {
    inAll = inAll && sampleIntIn(r, min, max) >= min
    const w = sampleIntIn(r, min, wideHi)
    inWide = inWide && w >= min && w <= wideHi
    const l = sampleIntIn(r, -(toI64(1) << toI64(62)), lowHi)
    inLow = inLow && l >= -(toI64(1) << toI64(62)) && l <= lowHi
  }
  t.ok("[MIN, MAX] draws", inAll)
  t.ok("a span above 2^63 stays in [lo, hi]", inWide)
  t.ok("a span below 2^63 stays in [lo, hi]", inLow)
  t.ok("a single value", sampleIntIn(r, max, max) === max && sampleIntIn(r, min, min) === min)
  return t.done()
}
