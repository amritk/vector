import { Suite } from "nish/testing"
import { contractParse } from "../../../src/spec/contract/read"
import { Expr, ExprKind, ForallVar } from "../../../src/spec/contract/types"
import {
  SAMPLE_UNDEFINED,
  SampleValue,
  sampleBytes,
  sampleEval,
  sampleInt,
  sampleStr,
} from "../../../src/spec/sample/eval"
import { sampleIntWrap } from "../../../src/spec/sample/ints"
import { SamplePrng, sampleBelow } from "../../../src/spec/sample/prng"
import { sampleProperty } from "../../../src/spec/sample/property"
import { SampleQuery, sampleIntTerm, sampleQueryTimeout, sampleScript } from "../../../src/spec/sample/smt"

/** A property over one string variable, whose alphabet a row replaces. */
const GUARDS_TEST_C: string = `{
  "contract": "c1",
  "source": {"title": "T", "rfc": 9999},
  "target": {"module": "nish/x"},
  "requirements": [{"id": "R1", "section": "2", "level": "MUST", "quote": "Q"}],
  "functions": [{"name": "f", "params": [{"name": "s", "type": "string"}], "returns": "i32"}],
  "clauses": [
    {"kind": "property", "id": "P1", "title": "t", "covers": ["R1"],
     "forall": [{"name": "s", "type": "string", "minLen": 1, "maxLen": 2, "alphabet": ["a"]}],
     "assert": {"op": "==", "args": [{"op": "strLen", "args": [{"var": "s"}]}, {"op": "strLen", "args": [{"var": "s"}]}]}}
  ]
}`

/** An operator applied to variables named `x`, `y` and so on. */
const guardsOp = (op: string, names: string[]): Expr => {
  const e = new Expr(ExprKind.Op, op)
  for (const n of names) {
    e.args.push(new Expr(ExprKind.Var, n))
  }
  return e
}

/** An environment binding x and y. */
const guardsEnv = (x: SampleValue, y: SampleValue): Map<string, SampleValue> => {
  const env = new Map<string, SampleValue>()
  env.set("x", x)
  env.set("y", y)
  return env
}

/** `x op y`'s integer value, or `fallback` when it is not one. */
const guardsInt = (op: string, x: SampleValue, y: SampleValue, fallback: i64): i64 => {
  const r = sampleEval(guardsOp(op, ["x", "y"]), guardsEnv(x, y))
  return r.isOk() ? r.value.n : fallback
}

/** `op(x, y)`'s bytes as hex-ish text, or its error. */
const guardsBytes = (op: string, x: SampleValue, y: SampleValue, z: SampleValue): string => {
  const env = guardsEnv(x, y)
  env.set("z", z)
  const r = sampleEval(guardsOp(op, ["x", "y", "z"]), env)
  return r.isOk() ? guardsJoin(r.value.bytes) : r.error
}

/** Bytes as comma-separated decimal text. */
const guardsJoin = (b: u8[]): string => {
  let s = ""
  for (let i = 0; i < b.length; i++) {
    s = i === 0 ? `${b[i]}` : `${s},${b[i]}`
  }
  return s
}

/** An i64 operand. */
const guardsI64 = (n: i32): SampleValue => sampleInt(toI64(n), "i64")

/** A read op's value on bytes, as text, or its error. */
const guardsRead = (op: string, b: SampleValue): string => {
  const env = new Map<string, SampleValue>()
  env.set("x", b)
  const r = sampleEval(guardsOp(op, ["x"]), env)
  return r.isOk() ? `${r.value.n}` : r.error
}

/** A write op's bytes for a u64, or its error. */
const guardsWrite = (op: string, n: i64): string => {
  const env = new Map<string, SampleValue>()
  env.set("x", sampleInt(n, "u64"))
  const r = sampleEval(guardsOp(op, ["x"]), env)
  return r.isOk() ? guardsJoin(r.value.bytes) : r.error
}

/** `charAt("abc", i)` in brackets, or its error. */
const guardsAt = (i: i64): string => {
  const r = sampleEval(guardsOp("charAt", ["x", "y"]), guardsEnv(sampleStr("abc"), sampleInt(i, "i32")))
  return r.isOk() ? `[${r.value.text}]` : r.error
}

/** Whether two byte strings compare equal. */
const guardsEq = (x: u8[], y: u8[]): boolean => {
  const r = sampleEval(guardsOp("==", ["x", "y"]), guardsEnv(sampleBytes(x), sampleBytes(y)))
  return r.isOk() && r.value.flag
}

/** A variable of a type. */
const guardsVar = (name: string, ty: string): ForallVar => {
  const v = new ForallVar()
  v.name = name
  v.type = ty
  return v
}

/** The guards src/spec/sample's panic proof added, each on both sides. */
export const main = (): i32 => {
  const t = new Suite("spec/sample/guards")
  const max: i64 = ~(toI64(1) << toI64(63))
  const min = ~max

  // The truncating signed remainder, which takes the dividend's sign.
  const rems: i64[][] = [
    [toI64(-7), toI64(2), toI64(-1)],
    [toI64(7), toI64(-2), toI64(1)],
    [toI64(-7), toI64(-2), toI64(-1)],
    [toI64(7), toI64(2), toI64(1)],
    [toI64(7), toI64(0), toI64(0)],
    [toI64(7), toI64(-1), toI64(0)],
    [min, toI64(-1), toI64(0)],
    [min, toI64(3), toI64(-2)],
    [min, toI64(0) - max, toI64(-1)],
    [max, toI64(-2), toI64(1)],
    [toI64(-6), toI64(3), toI64(0)],
  ]
  let row = 0
  for (const r of rems) {
    if (r.length === 3) {
      const got = guardsInt("%", sampleInt(r[0], "i64"), sampleInt(r[1], "i64"), toI64(99))
      t.ok(`i64 rem, row ${row}: ${r[0]} % ${r[1]} is ${r[2]}, got ${got}`, got === r[2])
    }
    row++
  }
  t.ok("i32 rem", guardsInt("%", sampleInt(toI64(-7), "i32"), sampleInt(toI64(3), "i32"), toI64(99)) === toI64(-1))
  // A u64 held as -1 is the maximum, and divides as itself.
  const umax = toI64(-1)
  t.ok(
    "u64 rem by its maximum",
    guardsInt("%", sampleInt(toI64(5), "u64"), sampleInt(umax, "u64"), toI64(99)) === toI64(5),
  )
  t.ok("u64 maximum rem itself", guardsInt("%", sampleInt(umax, "u64"), sampleInt(umax, "u64"), toI64(99)) === toI64(0))
  t.ok("u64 rem by 0", guardsInt("%", sampleInt(toI64(5), "u64"), sampleInt(toI64(0), "u64"), toI64(99)) === toI64(0))
  t.ok("u64 rem", guardsInt("%", sampleInt(umax, "u64"), sampleInt(toI64(10), "u64"), toI64(99)) === toI64(5))

  // flipBit: the bit counts modulo the bit count, a negative one from the end.
  const two = sampleBytes([0, 0])
  const flips: i64[] = [toI64(0), toI64(15), toI64(16), toI64(-1), toI64(-16), toI64(-17), min, toI64(9)]
  const flipped: string[] = ["1,0", "0,128", "1,0", "0,128", "1,0", "0,128", "1,0", "0,2"]
  for (let i = 0; i < flips.length && i < flipped.length; i++) {
    const r = sampleEval(guardsOp("flipBit", ["x", "y"]), guardsEnv(two, sampleInt(flips[i], "i64")))
    t.eqStr(`flipBit ${flips[i]}`, r.isOk() ? guardsJoin(r.value.bytes) : r.error, flipped[i])
  }
  const empty = sampleEval(guardsOp("flipBit", ["x", "y"]), guardsEnv(sampleBytes([]), sampleInt(toI64(-1), "i64")))
  t.ok("flipBit of no bytes is no bytes", empty.isOk() && empty.value.bytes.length === 0)

  // slice clamps both ends into the bytes.
  const three = sampleBytes([1, 2, 3])
  t.eqStr("slice inside", guardsBytes("slice", three, guardsI64(1), guardsI64(2)), "2")
  t.eqStr("slice past both ends", guardsBytes("slice", three, guardsI64(-5), guardsI64(10)), "1,2,3")
  t.eqStr("slice backwards is empty", guardsBytes("slice", three, guardsI64(2), guardsI64(1)), "")
  t.eqStr("slice at the end", guardsBytes("slice", three, guardsI64(3), guardsI64(3)), "")

  // Reads: little-endian weights byte k by 2^(8k), big-endian the other way.
  const four = sampleBytes([1, 2, 3, 4])
  t.eqStr("leU32", guardsRead("leU32", four), "67305985")
  t.eqStr("beU32", guardsRead("beU32", four), "16909060")
  t.eqStr("leU16", guardsRead("leU16", sampleBytes([0x34, 0x12])), "4660")
  t.eqStr("leI32 of all ones", guardsRead("leI32", sampleBytes([255, 255, 255, 255])), "-1")
  t.eqStr("leU64", guardsRead("leU64", sampleBytes([1, 0, 0, 0, 0, 0, 0, 128])), "-9223372036854775807")
  t.eqStr("a short read", guardsRead("leU32", sampleBytes([1, 2])), SAMPLE_UNDEFINED)

  // Writes put byte k at k, or at w - 1 - k big-endian.
  t.eqStr("le32", guardsWrite("le32", toI64(0x04030201)), "1,2,3,4")
  t.eqStr("be32", guardsWrite("be32", toI64(0x04030201)), "4,3,2,1")
  t.eqStr("be64", guardsWrite("be64", toI64(-1)), "255,255,255,255,255,255,255,255")

  // charAt: one character, or none outside the string.
  t.eqStr("charAt first", guardsAt(toI64(0)), "[a]")
  t.eqStr("charAt last", guardsAt(toI64(2)), "[c]")
  t.eqStr("charAt past the end", guardsAt(toI64(3)), "[]")
  t.eqStr("charAt before the start", guardsAt(toI64(-1)), "[]")

  // Equality of bytes: by length, then each byte.
  t.ok("equal bytes", guardsEq([1, 2], [1, 2]))
  t.ok("a prefix is not equal", !guardsEq([1], [1, 2]) && !guardsEq([1, 2], [1]))
  t.ok("one byte differs", !guardsEq([1, 2], [1, 3]))

  // An operand that is missing or of the wrong kind.
  const lone = new Map<string, SampleValue>()
  lone.set("x", three)
  const missing = sampleEval(guardsOp("concat", ["x"]), lone)
  t.eqStr("a missing operand", missing.isErr() ? missing.error : "ok", "concat: operand 1 has the wrong kind")
  const wrong = sampleEval(guardsOp("concat", ["x", "y"]), guardsEnv(three, guardsI64(1)))
  t.eqStr("an operand of the wrong kind", wrong.isErr() ? wrong.error : "ok", "concat: operand 1 has the wrong kind")
  const both = sampleEval(guardsOp("concat", ["x", "y"]), guardsEnv(three, sampleBytes([4])))
  t.ok("concat", both.isOk() && guardsJoin(both.value.bytes) === "1,2,3,4")
  const upper = sampleEval(guardsOp("upper", ["x"]), guardsEnv(sampleStr("az{`A"), guardsI64(0)))
  t.eqStr("upper", upper.isOk() ? upper.value.text : upper.error, "AZ{`A")

  // ints and prng.
  t.ok("wrap past i32", sampleIntWrap(toI64(2147483647) + toI64(1), "i32") === toI64(-2147483648))
  t.ok("wrap -1 to u32", sampleIntWrap(toI64(-1), "u32") === (toI64(1) << toI64(32)) - toI64(1))
  t.ok("wrap the i32 minimum", sampleIntWrap(toI64(-2147483648), "i32") === toI64(-2147483648))
  const rnd = new SamplePrng("x")
  let one = true
  for (let i = 0; i < 50; i++) {
    one = one && sampleBelow(rnd, 1) === 0
  }
  t.ok("below 1 is 0", one)

  // The per-query timeout: no queries, or fewer than none, take the whole share.
  t.ok("a negative query count", sampleQueryTimeout(-3) === 50000)
  t.ok("two queries", sampleQueryTimeout(2) === 28000)

  // A script whose vars outrun their ranges asserts a name z3 refuses.
  const vars = [guardsVar("n", "i32"), guardsVar("m", "i32")]
  const q = [new SampleQuery("", [])]
  const short = sampleScript(vars, [[toI64(0), toI64(3)]], "true", q)
  t.ok("a var with a range", short.indexOf("(assert (and (<= 0 v_n) (<= v_n 3)))") >= 0)
  t.ok("a var with no range", short.indexOf("(assert (sample-range-missing v_m))") >= 0)
  const half = sampleScript(vars, [[toI64(0), toI64(3)], [toI64(1)]], "true", q)
  t.ok("a range with one end", half.indexOf("(assert (sample-range-missing v_m))") >= 0)
  const whole = sampleScript(
    vars,
    [
      [toI64(0), toI64(3)],
      [toI64(1), toI64(2)],
    ],
    "true",
    q,
  )
  t.ok("every var with a range", whole.indexOf("sample-range-missing") < 0 && whole.indexOf("(<= v_m 2)") >= 0)

  // A read of a write with no operand is outside the skeleton.
  const ivars = [guardsVar("n", "u32")]
  const bare = new Expr(ExprKind.Op, "leU32")
  bare.args.push(new Expr(ExprKind.Op, "le32"))
  t.ok("a write with no operand", sampleIntTerm(bare, ivars, "u32") === null)
  const full = new Expr(ExprKind.Op, "leU32")
  full.args.push(guardsOp("le32", ["n"]))
  const fullTerm = sampleIntTerm(full, ivars, "u32")
  t.ok("a read of a write", fullTerm !== null)
  const noRead = new Expr(ExprKind.Op, "leU32")
  t.ok("a read with no operand", sampleIntTerm(noRead, ivars, "u32") === null)

  // A string variable with an empty alphabet has no character to draw.
  const k = contractParse(GUARDS_TEST_C, "c1").expect("parse").clauses[0]
  const fine = sampleProperty("c1", k)
  t.ok("an alphabet with a character", fine.isOk() && fine.value.samples.length > 0)
  const k2 = contractParse(GUARDS_TEST_C, "c1").expect("parse").clauses[0]
  const nothing: string[] = []
  k2.forall[0].alphabet = nothing
  const none = sampleProperty("c1", k2)
  t.eqStr("an empty alphabet", none.isErr() ? none.error : "ok", "s: its alphabet has no character to draw")
  return t.done()
}
