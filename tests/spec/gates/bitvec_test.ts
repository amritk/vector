import { Suite } from "nish/testing"
import { contractParse } from "../../../src/spec/contract/read"
import { Clause, Expr, ExprKind, ForallVar, LitKind, Literal } from "../../../src/spec/contract/types"
import {
  SAMPLE_UNDEFINED,
  SampleValue,
  sampleBool,
  sampleBytes,
  sampleEval,
  sampleHolds,
  sampleInt,
  sampleStr,
} from "../../../src/spec/sample/eval"
import { sampleParseInt } from "../../../src/spec/sample/ints"
import { SampleOutcome, sampleProperty } from "../../../src/spec/sample/property"
import {
  SampleEdge,
  sampleBoolTerm,
  sampleBvArith,
  sampleBvLit,
  sampleEdges,
  sampleIntTerm,
  sampleIsBv,
  sampleModelInt,
  sampleQueryTimeout,
  sampleSmtLit,
  sampleSort,
  sampleWrapsOnInt,
} from "../../../src/spec/sample/smt"

/**
 * Properties whose `where` only holds when arithmetic wraps, or only when
 * `%` by zero is 0: each must sample, or be refused for the right reason.
 */
const BITVEC_TEST_C: string = `{
  "contract": "c1",
  "source": {"title": "T", "rfc": 9999},
  "target": {"module": "nish/x"},
  "requirements": [{"id": "R1", "section": "2", "level": "MUST", "quote": "Q"}],
  "functions": [{"name": "f", "params": [{"name": "a", "type": "bytes"}], "returns": "bytes"}],
  "clauses": [
    {"kind": "property", "id": "P-I8", "title": "t", "covers": ["R1"], "samples": 4,
     "forall": [{"name": "x", "type": "i8", "min": -128, "max": 127}],
     "where": {"op": "<", "args": [{"op": "+", "args": [{"var": "x"}, {"int": 1}]}, {"var": "x"}]},
     "assert": {"op": "==", "args": [{"var": "x"}, {"var": "x"}]}},
    {"kind": "property", "id": "P-I64", "title": "t", "covers": ["R1"], "samples": 4,
     "forall": [{"name": "x", "type": "i64", "min": "-9223372036854775808", "max": "9223372036854775807"}],
     "where": {"op": "==", "args": [{"op": "*", "args": [{"var": "x"}, {"int": 3}]}, {"int": 7}]},
     "assert": {"op": "==", "args": [{"var": "x"}, {"var": "x"}]}},
    {"kind": "property", "id": "P-U64", "title": "t", "covers": ["R1"], "samples": 4,
     "forall": [{"name": "x", "type": "u64", "min": 0, "max": "18446744073709551615"}],
     "where": {"op": "<", "args": [{"op": "+", "args": [{"var": "x"}, {"int": 2}]}, {"var": "x"}]},
     "assert": {"op": "==", "args": [{"var": "x"}, {"var": "x"}]}},
    {"kind": "property", "id": "P-REM-EMPTY", "title": "t", "covers": ["R1"],
     "forall": [{"name": "x", "type": "u8", "min": 0, "max": 255}, {"name": "y", "type": "u8", "min": 0, "max": 255}],
     "where": {"op": "and", "args": [{"op": "==", "args": [{"var": "y"}, {"int": 0}]},
                                      {"op": "==", "args": [{"op": "%", "args": [{"var": "x"}, {"var": "y"}]}, {"int": 5}]}]},
     "assert": {"op": "==", "args": [{"var": "x"}, {"var": "x"}]}},
    {"kind": "property", "id": "P-REM-ZERO", "title": "t", "covers": ["R1"], "samples": 4,
     "forall": [{"name": "x", "type": "u8", "min": 0, "max": 255}, {"name": "y", "type": "u8", "min": 0, "max": 255}],
     "where": {"op": "and", "args": [{"op": "==", "args": [{"var": "y"}, {"int": 0}]},
                                      {"op": "==", "args": [{"op": "%", "args": [{"var": "x"}, {"var": "y"}]}, {"int": 0}]}]},
     "assert": {"op": "==", "args": [{"var": "x"}, {"var": "x"}]}},
    {"kind": "property", "id": "P-I32", "title": "t", "covers": ["R1"],
     "forall": [{"name": "x", "type": "i32", "min": -2147483648, "max": 2147483647}],
     "where": {"op": "==", "args": [{"op": "*", "args": [{"var": "x"}, {"int": 2}]}, {"int": 1}]},
     "assert": {"op": "==", "args": [{"var": "x"}, {"var": "x"}]}},
    {"kind": "property", "id": "P-ZEROS", "title": "t", "covers": ["R1"], "samples": 1,
     "forall": [{"name": "n", "type": "i32", "min": 5000, "max": 6000}],
     "where": {"op": "==", "args": [{"op": "zeros", "args": [{"var": "n"}]}, {"op": "zeros", "args": [{"var": "n"}]}]},
     "assert": {"op": "==", "args": [{"var": "n"}, {"var": "n"}]}}
  ]
}`

/** The i-th test clause. */
const bitvecTestClause = (i: i32): Clause => contractParse(BITVEC_TEST_C, "c1").expect("parse").clauses[i]

/** The i-th test clause, sampled. */
const bitvecTestSample = (i: i32): SampleOutcome => {
  const c = contractParse(BITVEC_TEST_C, "c1").expect("parse")
  return sampleProperty(c.contract, c.clauses[i]).expect("sample")
}

/** The first variable's value in every sample of an outcome. */
const bitvecTestValues = (o: SampleOutcome): i64[] =>
  o.samples.map((s): i64 => sampleParseInt(s.args[0].text).expect("int"))

/** The i-th variable's value in every sample of an outcome. */
const bitvecTestArgs = (o: SampleOutcome, i: i32): i64[] =>
  o.samples.map((s): i64 => sampleParseInt(s.args[i].text).expect("int"))

/** A clause's `where`, which every test clause has. */
const bitvecTestWhere = (k: Clause): Expr => {
  const w = k.where
  return w === null ? new Expr(ExprKind.Var, "missing") : w
}

/** An int literal expression. */
const bitvecTestInt = (text: string): Expr => {
  const e = new Expr(ExprKind.Lit, "")
  e.lit = new Literal(LitKind.Int, text)
  return e
}

/** A null literal expression. */
const bitvecTestNull = (): Expr => {
  const e = new Expr(ExprKind.Lit, "")
  e.lit = new Literal(LitKind.Null, "")
  return e
}

/** An operator applied to its arguments. */
const bitvecTestOp = (op: string, args: Expr[]): Expr => {
  const e = new Expr(ExprKind.Op, op)
  e.args = args
  return e
}

/** A variable reference. */
const bitvecTestVar = (name: string): Expr => new Expr(ExprKind.Var, name)

/** An expression's value in an environment, failing the test run when it has none. */
const bitvecTestEval = (e: Expr, env: Map<string, SampleValue>): SampleValue => sampleEval(e, env).expect("eval")

/** `x op y` evaluated with x of the given type. */
const bitvecTestArith = (op: string, x: i64, ty: string, y: string): i64 => {
  const env = new Map<string, SampleValue>()
  env.set("x", sampleInt(x, ty))
  return bitvecTestEval(bitvecTestOp(op, [bitvecTestVar("x"), bitvecTestInt(y)]), env).n
}

/** A variable of a type. */
const bitvecTestForall = (name: string, ty: string): ForallVar => {
  const v = new ForallVar()
  v.name = name
  v.type = ty
  return v
}

/** Bit-vector sampling and the evaluator's integer semantics. */
export const main = (): i32 => {
  const t = new Suite("spec/gates/bitvec")

  // The encoding: every integer type but i32 is a bit-vector.
  t.ok("i8 and u64 are bit-vectors", sampleIsBv("i8") && sampleIsBv("u64") && sampleIsBv("i64"))
  t.ok("i32 and bytes are not", !sampleIsBv("i32") && !sampleIsBv("bytes"))
  t.eqStr("a negative i8", sampleBvLit(toI64(-1), 8), "(_ bv255 8)")
  t.eqStr("a u64 of all ones", sampleBvLit(toI64(-1), 64), "(_ bv18446744073709551615 64)")
  t.eqStr("an i32 literal stays Int", sampleSmtLit(toI64(-5), "i32"), "(- 5)")
  t.eqStr("a u16 literal", sampleSmtLit(toI64(7), "u16"), "(_ bv7 16)")
  t.eqStr("a bit-vector sort", sampleSort(bitvecTestForall("b", "i16")), "(_ BitVec 16)")
  t.eqStr("an Int sort", sampleSort(bitvecTestForall("n", "i32")), "Int")
  t.ok("a model's hex, signed", sampleModelInt("#xff", "i8").expect("i8") === toI64(-1))
  t.ok("a model's hex, unsigned", sampleModelInt("#xff", "u8").expect("u8") === toI64(255))
  t.ok("a model's binary", sampleModelInt("#b101", "u8").expect("u8") === toI64(5))
  t.ok("a model's u64 maximum", sampleModelInt("#xffffffffffffffff", "u64").expect("u64") === toI64(-1))
  t.ok("a model's negative Int", sampleModelInt("-5", "i32").expect("i32") === toI64(-5))
  t.ok("a model's Int", sampleModelInt("12", "i32").expect("i32") === toI64(12))
  t.ok("a model's garbage", sampleModelInt("#xzz", "u8").isErr())
  t.ok("ten queries share the budget", sampleQueryTimeout(10) === 8000)
  t.ok("one query", sampleQueryTimeout(1) === 53000)
  t.ok("no queries", sampleQueryTimeout(0) === 50000)
  t.ok("a query never waits past the cap", sampleQueryTimeout(1000) <= 55000)

  const k8 = bitvecTestClause(0)
  const w8 = sampleBoolTerm(bitvecTestWhere(k8), k8.forall)
  t.ok("a signed comparison", w8 !== null && w8 === "(bvslt (bvadd v_x (_ bv1 8)) v_x)")
  const ku = bitvecTestClause(2)
  const wu = sampleBoolTerm(bitvecTestWhere(ku), ku.forall)
  t.ok("an unsigned comparison", wu !== null && wu === "(bvult (bvadd v_x (_ bv2 64)) v_x)")
  t.ok("a literal outside i8 stays outside", sampleIntTerm(bitvecTestInt("300"), k8.forall, "i8") === null)
  const edges: SampleEdge[] = []
  sampleEdges(bitvecTestWhere(k8), k8.forall, edges)
  t.ok("one edge", edges.length === 1)
  t.eqStr(
    "a signed edge widens",
    edges[0].diff,
    "(bvsub ((_ sign_extend 2) (bvadd v_x (_ bv1 8))) ((_ sign_extend 2) v_x))",
  )
  t.eqStr("its offsets", edges[0].offsets.join(" "), "(bvneg (_ bv1 10)) (_ bv0 10) (_ bv1 10)")
  const ue: SampleEdge[] = []
  sampleEdges(bitvecTestWhere(ku), ku.forall, ue)
  t.ok("an unsigned edge widens", ue.length === 1 && ue[0].diff.startsWith("(bvsub ((_ zero_extend 2)"))
  t.eqStr(
    "% by a variable guards zero",
    sampleBvArith("%", "v_x", "v_y", bitvecTestVar("y"), "u8") ?? "",
    "(ite (= v_y (_ bv0 8)) (_ bv0 8) (bvurem v_x v_y))",
  )
  t.eqStr(
    "% by a literal does not",
    sampleBvArith("%", "v_x", "(_ bv3 8)", bitvecTestInt("3"), "i8") ?? "",
    "(bvsrem v_x (_ bv3 8))",
  )
  t.eqStr("* is bvmul", sampleBvArith("*", "a", "b", bitvecTestInt("1"), "u32") ?? "", "(bvmul a b)")
  t.ok("no other operator", sampleBvArith("/", "a", "b", bitvecTestInt("1"), "u32") === null)
  t.ok("i8 arithmetic wraps in the skeleton", !sampleWrapsOnInt(bitvecTestWhere(k8), k8.forall))
  const k32 = bitvecTestClause(5)
  t.ok("i32 arithmetic does not", sampleWrapsOnInt(bitvecTestWhere(k32), k32.forall))

  // Wrap-only domains sample, not refuse.
  const o8 = bitvecTestSample(0)
  const v8 = bitvecTestValues(o8)
  t.ok("i8 x + 1 < x samples at Z3's boundaries", o8.issue === null && o8.stat.boundary > 0 && o8.stat.random === 0)
  t.ok(
    "only at the i8 maximum",
    v8.every((x: i64): boolean => x === toI64(127)),
  )
  t.ok(
    "a domain smaller than its samples is noted, not refused",
    o8.samples.length === 1 && o8.stat.notes.indexOf("asked for 4 samples; the domain gave 1") >= 0,
  )
  const o64 = bitvecTestSample(1)
  const v64 = bitvecTestValues(o64)
  t.ok("i64 x * 3 == 7 samples at Z3's boundaries", o64.issue === null && o64.stat.boundary > 0 && v64.length > 0)
  let wraps = true
  for (const x of v64) {
    const env64 = new Map<string, SampleValue>()
    env64.set("x", sampleInt(x, "i64"))
    wraps = wraps && sampleHolds(bitvecTestClause(1).where, env64).expect("holds")
  }
  t.ok("each wraps to 7", wraps)
  const ou = bitvecTestSample(2)
  const vu = bitvecTestValues(ou)
  t.ok("u64 x + 2 < x samples at Z3's boundaries", ou.issue === null && ou.stat.boundary > 0 && vu.length > 0)
  t.ok(
    "only at the top two",
    vu.every((x: i64): boolean => x === toI64(-1) || x === toI64(-2)),
  )
  const oe = bitvecTestSample(3)
  const ei = oe.issue
  t.ok("% by zero is never 5", (ei ?? "").startsWith("the domain is empty (Z3: unsat)"))
  const oz = bitvecTestSample(4)
  t.ok("% by zero is 0, so it samples at Z3's boundaries", oz.issue === null && oz.stat.boundary > 0)
  t.ok("an explicit samples is the total", oz.samples.length === 4 && oz.stat.boundary + oz.stat.random === 4)
  const kd = bitvecTestClause(4)
  kd.samples = -1
  const od = sampleProperty("c1", kd).expect("sample")
  const k2 = bitvecTestClause(4)
  k2.samples = 2
  const o2 = sampleProperty("c1", k2).expect("sample")
  t.ok(
    "an explicit samples keeps the first boundaries, in Z3's order",
    od.stat.boundary > 2 &&
      o2.stat.boundary === 2 &&
      o2.stat.random === 0 &&
      o2.samples.length === 2 &&
      o2.samples[0].why === od.samples[0].why &&
      o2.samples[1].why === od.samples[1].why &&
      bitvecTestValues(o2)[0] === bitvecTestValues(od)[0] &&
      bitvecTestValues(o2)[1] === bitvecTestValues(od)[1] &&
      o2.stat.notes.every((n: string): boolean => !n.startsWith("asked for")),
  )
  const kz = bitvecTestClause(4)
  const wz = sampleBoolTerm(bitvecTestWhere(kz), kz.forall)
  t.ok("% by a variable is guarded in the where", (wz ?? "").indexOf("(ite (= v_y (_ bv0 8)) (_ bv0 8) (bvurem") >= 0)
  t.ok(
    "each sample has y = 0",
    bitvecTestArgs(oz, 1).every((y: i64): boolean => y === toI64(0)),
  )
  const o32 = bitvecTestSample(5)
  const i32i = o32.issue
  t.ok(
    "i32 Int unsat is not an empty domain",
    (i32i ?? "").startsWith("no sample satisfies the domain") && o32.samples.length === 0,
  )

  const oo = bitvecTestSample(6)
  t.ok("zeros past the limit in a where is an issue", (oo.issue ?? "").startsWith("where: cannot be evaluated"))

  // The evaluator's integer semantics.
  t.ok("i8 + wraps", bitvecTestArith("+", toI64(127), "i8", "1") === toI64(-128))
  t.ok("u8 - wraps", bitvecTestArith("-", toI64(0), "u8", "1") === toI64(255))
  t.ok("i8 * wraps", bitvecTestArith("*", toI64(64), "i8", "2") === toI64(-128))
  t.ok("% by 0 is 0", bitvecTestArith("%", toI64(7), "i32", "0") === toI64(0))
  t.ok("% is truncated", bitvecTestArith("%", toI64(-7), "i32", "3") === toI64(-1))
  t.ok(
    "i64 MIN % -1 is 0",
    bitvecTestArith("%", sampleParseInt("-9223372036854775808").expect("min"), "i64", "-1") === toI64(0),
  )
  const nine = toI64(9)
  t.ok("u64 % its maximum is itself", bitvecTestArith("%", nine, "u64", "18446744073709551615") === nine)
  t.ok("u64 maximum % 10", bitvecTestArith("%", toI64(-1), "u64", "10") === toI64(5))

  const env = new Map<string, SampleValue>()
  env.set("t", sampleBool(true))
  env.set("f", sampleBool(false))
  env.set("b", sampleBytes([1, 2, 3, 4]))
  env.set("s", sampleStr("AbZ9"))
  env.set("n", sampleInt(toI64(4), "i32"))
  const unwrapNull = sampleEval(bitvecTestOp("unwrap", [bitvecTestNull()]), env)
  t.ok("unwrap(null) is undefined", unwrapNull.isErr() && unwrapNull.error === SAMPLE_UNDEFINED)
  t.ok("unwrap of a value is it", bitvecTestEval(bitvecTestOp("unwrap", [bitvecTestVar("n")]), env).n === toI64(4))
  t.ok("or", bitvecTestEval(bitvecTestOp("or", [bitvecTestVar("f"), bitvecTestVar("t")]), env).flag)
  t.ok(
    "or short-circuits",
    bitvecTestEval(bitvecTestOp("or", [bitvecTestVar("t"), bitvecTestOp("unwrap", [bitvecTestNull()])]), env).flag,
  )
  t.ok(
    "false implies anything",
    bitvecTestEval(bitvecTestOp("implies", [bitvecTestVar("f"), bitvecTestVar("f")]), env).flag,
  )
  t.ok(
    "true implies false is false",
    !bitvecTestEval(bitvecTestOp("implies", [bitvecTestVar("t"), bitvecTestVar("f")]), env).flag,
  )
  t.ok("not", !bitvecTestEval(bitvecTestOp("not", [bitvecTestVar("t")]), env).flag)
  const sl = bitvecTestEval(bitvecTestOp("slice", [bitvecTestVar("b"), bitvecTestInt("-2"), bitvecTestInt("2")]), env)
  t.ok("slice clamps its start", sl.bytes.length === 2 && sl.bytes[0] === 1)
  const sh = bitvecTestEval(bitvecTestOp("slice", [bitvecTestVar("b"), bitvecTestInt("3"), bitvecTestInt("1")]), env)
  t.ok("slice clamps its end to its start", sh.bytes.length === 0)
  const fb = bitvecTestEval(bitvecTestOp("flipBit", [bitvecTestVar("b"), bitvecTestInt("9")]), env)
  t.ok("flipBit", fb.bytes[1] === 0 && fb.bytes[0] === 1)
  const fw = bitvecTestEval(bitvecTestOp("flipBit", [bitvecTestVar("b"), bitvecTestInt("32")]), env)
  t.ok("flipBit wraps the bit index", fw.bytes[0] === 0)
  t.eqStr("charAt", bitvecTestEval(bitvecTestOp("charAt", [bitvecTestVar("s"), bitvecTestInt("1")]), env).text, "b")
  t.eqStr(
    "charAt out of range",
    bitvecTestEval(bitvecTestOp("charAt", [bitvecTestVar("s"), bitvecTestInt("4")]), env).text,
    "",
  )
  const big = sampleEval(bitvecTestOp("zeros", [bitvecTestInt("4097")]), env)
  t.ok("zeros past the limit is refused", big.isErr() && big.error.indexOf("4096-byte limit") >= 0)
  t.ok("zeros at the limit", bitvecTestEval(bitvecTestOp("zeros", [bitvecTestInt("4096")]), env).bytes.length === 4096)
  const bigFill = sampleEval(bitvecTestOp("fill", [bitvecTestInt("1"), bitvecTestInt("100000")]), env)
  t.ok("fill past the limit is refused", bigFill.isErr())
  t.eqStr("lower maps A-Z only", bitvecTestEval(bitvecTestOp("lower", [bitvecTestVar("s")]), env).text, "abz9")
  return t.done()
}
