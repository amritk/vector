import { Suite } from "nish/testing"
import { contractParse } from "../../../src/spec/contract/read"
import { Clause, Expr, ExprKind, ForallVar, LitKind, Literal } from "../../../src/spec/contract/types"
import {
  SAMPLE_UNDEFINED,
  SampleKind,
  SampleValue,
  sampleBool,
  sampleBytes,
  sampleEval,
  sampleHolds,
  sampleInt,
  sampleLiteral,
  sampleStr,
  sampleToLiteral,
} from "../../../src/spec/sample/eval"
import {
  sampleIntLess,
  sampleIntSigned,
  sampleIntText,
  sampleIntWidth,
  sampleIntWrap,
  sampleParseInt,
} from "../../../src/spec/sample/ints"
import {
  SamplePrng,
  sampleBelow,
  sampleBiasedInt,
  sampleFnv1a,
  sampleIntIn,
  sampleNext,
} from "../../../src/spec/sample/prng"
import {
  SampleEdge,
  SampleQuery,
  sampleBoolTerm,
  sampleEdges,
  sampleInlineLets,
  sampleIntTerm,
  sampleIntTypeOf,
  sampleLenTerm,
  sampleNamesIn,
  sampleRange,
  sampleScript,
  sampleSmtInt,
  sampleSmtIntOf,
  sampleSmtName,
} from "../../../src/spec/sample/smt"

/** Properties whose `where` and `assert` exercise the evaluator and the skeleton. */
const SAMPLE_TEST_C: string = `{
  "contract": "c1",
  "source": {"title": "T", "rfc": 9999},
  "target": {"module": "nish/x"},
  "requirements": [{"id": "R1", "section": "2", "level": "MUST", "quote": "Q"}],
  "functions": [{"name": "f", "params": [{"name": "a", "type": "bytes"}], "returns": "bytes"}],
  "clauses": [
    {"kind": "property", "id": "P1", "title": "t", "covers": ["R1"],
     "forall": [{"name": "n", "type": "i32", "min": -5, "max": 9}, {"name": "m", "type": "i32", "min": 0, "max": 255},
                {"name": "a", "type": "bytes", "minLen": 0, "maxLen": 4}],
     "where": {"op": "and", "args": [{"op": "<=", "args": [{"var": "n"}, {"var": "m"}]},
                                     {"op": "<", "args": [{"op": "len", "args": [{"var": "a"}]}, {"int": 3}]}]},
     "assert": {"let": [{"name": "k", "value": {"op": "+", "args": [{"var": "n"}, {"int": 1}]}}],
                "in": {"op": "==", "args": [{"var": "k"}, {"op": "len", "args": [{"call": "f", "args": [{"var": "a"}]}]}]}}},
    {"kind": "property", "id": "P2", "title": "t", "covers": ["R1"],
     "forall": [{"name": "a", "type": "bytes", "minLen": 0, "maxLen": 4}, {"name": "s", "type": "string", "minLen": 1, "maxLen": 2, "alphabet": ["a", "b"]}],
     "where": {"op": "==", "args": [{"op": "xor", "args": [{"var": "a"}, {"var": "a"}]}, {"op": "zeros", "args": [{"op": "len", "args": [{"var": "a"}]}]}]},
     "assert": {"op": "==", "args": [{"call": "f", "args": [{"var": "a"}]}, {"var": "a"}]}}
  ]
}`

/** The test contract's property `i`. */
const sampleTestClause = (i: i32): Clause => contractParse(SAMPLE_TEST_C, "c1").expect("parse").clauses[i]

/** An environment of the given variables. */
const sampleTestEnv = (n: i64, m: i64, a: u8[]): Map<string, SampleValue> => {
  const env = new Map<string, SampleValue>()
  env.set("n", sampleInt(n, "i32"))
  env.set("m", sampleInt(m, "i32"))
  env.set("a", sampleBytes(a))
  return env
}

/** A variable of a type. */
const sampleTestVar = (name: string, ty: string): ForallVar => {
  const v = new ForallVar()
  v.name = name
  v.type = ty
  return v
}

/** ints, prng, eval and smt. */
export const main = (): i32 => {
  const t = new Suite("spec/gates/sample")

  // ints
  t.ok("width", sampleIntWidth("u16") === 16 && sampleIntWidth("i64") === 64)
  t.ok("signed", sampleIntSigned("i8") && !sampleIntSigned("u8"))
  t.ok("wrap u8", sampleIntWrap(toI64(256 + 7), "u8") === toI64(7))
  t.ok("wrap i8", sampleIntWrap(toI64(128), "i8") === toI64(-128))
  t.ok("wrap i64 is itself", sampleIntWrap(toI64(-3), "i64") === toI64(-3))
  const big = sampleParseInt("18446744073709551615").expect("u64 max")
  t.ok("u64 max is held by its bits", big === toI64(-1))
  t.eqStr("u64 text", sampleIntText(big, "u64"), "18446744073709551615")
  t.eqStr("i64 text", sampleIntText(big, "i64"), "-1")
  t.ok("u64 order is unsigned", sampleIntLess(toI64(1), big, "u64") && !sampleIntLess(toI64(1), big, "i64"))
  t.ok("a negative", sampleParseInt("-42").expect("neg") === toI64(-42))
  t.ok("past u64", sampleParseInt("99999999999999999999").isErr())
  t.ok("not digits", sampleParseInt("1x").isErr() && sampleParseInt("").isErr() && sampleParseInt("-").isErr())

  // prng
  const fnvBasis: u32 = 0x811c9dc5
  t.ok("fnv1a of nothing", sampleFnv1a("") === fnvBasis)
  const r1 = new SamplePrng("seed")
  const r2 = new SamplePrng("seed")
  const x1 = sampleNext(r1)
  t.ok("seeded draws repeat", x1 === sampleNext(r2) && x1 >= 0.0 && x1 < 1.0)
  t.ok("another seed differs", sampleNext(new SamplePrng("other")) !== x1)
  let inRange = true
  for (let i = 0; i < 200; i++) {
    const b = sampleBelow(r1, 7)
    const k = sampleIntIn(r1, toI64(-5), toI64(5))
    const z = sampleBiasedInt(r1, toI64(-1000), toI64(1000))
    const u = sampleBiasedInt(r1, toI64(0), big)
    inRange = inRange && b >= 0 && b < 7 && k >= toI64(-5) && k <= toI64(5) && z >= toI64(-1000) && toI64(1000) >= z
    inRange = inRange && !sampleIntLess(big, u, "u64")
  }
  t.ok("draws stay in range", inRange)

  // eval
  const p1 = sampleTestClause(0)
  const where1 = p1.where
  t.ok("a where that holds", sampleHolds(where1, sampleTestEnv(toI64(2), toI64(3), [1, 2])).expect("holds"))
  t.ok("a where that fails", !sampleHolds(where1, sampleTestEnv(toI64(4), toI64(3), [1])).expect("fails"))
  t.ok("no where holds", sampleHolds(null, sampleTestEnv(toI64(0), toI64(0), [])).expect("none"))
  const env = sampleTestEnv(toI64(2), toI64(3), [1, 2])
  const a1 = p1.assert
  t.ok("a call is not evaluated", a1 !== null && sampleEval(a1, env).isErr())
  const w2 = sampleTestClause(1).where
  const env2 = new Map<string, SampleValue>()
  env2.set("a", sampleBytes([9, 8, 7]))
  t.ok("bytes ops", sampleHolds(w2, env2).expect("xor"))
  t.eqStr("undefined is a marker", SAMPLE_UNDEFINED, "unwrap of null")
  t.ok("bool", sampleBool(true).kind === SampleKind.Bool && sampleBool(true).flag)
  t.ok("str", sampleStr("hi").text === "hi")
  t.eqStr("bytes as hex", sampleToLiteral(sampleBytes([0xab, 1])).text, "ab01")
  t.eqStr("u64 as unsigned", sampleToLiteral(sampleInt(big, "u64")).text, "18446744073709551615")
  t.eqStr("i32 as signed", sampleToLiteral(sampleInt(toI64(-7), "i32")).text, "-7")
  t.ok("a string literal", sampleToLiteral(sampleStr("x")).kind === LitKind.Str)
  t.ok("a literal's value", sampleLiteral(new Literal(LitKind.Hex, "0a0b")).expect("hex").bytes.length === 2)
  t.ok("no f64 literal", sampleLiteral(new Literal(LitKind.F64, "1.5")).isErr())
  // Each literal kind that is not evaluated, and why.
  const unevaluated: Literal[] = [
    new Literal(LitKind.F64, "1.5"),
    new Literal(LitKind.Words16, ""),
    new Literal(LitKind.Words32, ""),
    new Literal(LitKind.Words64, ""),
  ]
  const why: string[] = [
    "f64 values are not evaluated",
    "word arrays are not evaluated",
    "word arrays are not evaluated",
    "word arrays are not evaluated",
  ]
  let row = 0
  for (const lit of unevaluated) {
    const r = sampleLiteral(lit)
    t.eqStr(`not evaluated, row ${row}`, r.isErr() ? r.error : "evaluated", why[row])
    row++
  }

  // smt
  const vars = p1.forall
  t.eqStr("int name", sampleSmtName(vars[0]), "v_n")
  t.eqStr("len name", sampleSmtName(vars[2]), "len_a")
  t.eqStr("a negative literal", sampleSmtInt(toI64(-5)), "(- 5)")
  t.eqStr("u64 literal", sampleSmtIntOf(big, "u64"), "18446744073709551615")
  const rn = sampleRange(vars[0]).expect("n")
  t.ok("bounds", rn[0] === toI64(-5) && rn[1] === toI64(9))
  const rm = sampleRange(vars[1]).expect("m")
  const r8 = sampleRange(sampleTestVar("b", "i8")).expect("i8")
  t.ok("the type's range", rm[1] === toI64(255) && r8[0] === toI64(-128) && r8[1] === toI64(127))
  const ru = sampleRange(sampleTestVar("u", "u64")).expect("u64")
  t.ok("the whole u64 range", ru[0] === toI64(0) && ru[1] === big)
  t.ok("no f64", sampleRange(sampleTestVar("x", "f64")).isErr())
  t.ok("no bytes without lengths", sampleRange(sampleTestVar("b", "bytes")).isErr())
  const none = new Map<string, Expr>()
  const w1 = where1 === null ? new Expr(ExprKind.Var, "missing") : where1
  const w2e = w2 === null ? new Expr(ExprKind.Var, "missing") : w2
  const a1e = a1 === null ? new Expr(ExprKind.Var, "missing") : a1
  const wterm = sampleBoolTerm(w1, vars)
  t.ok("where in the skeleton", wterm !== null && wterm === "(and (<= v_n v_m) (< len_a 3))")
  t.ok("a mixed comparison is outside", sampleBoolTerm(w2e, sampleTestClause(1).forall) === null)
  const flat = sampleInlineLets(a1e, none)
  const edges: SampleEdge[] = []
  sampleEdges(flat, vars, edges)
  t.ok("a call's length gives no edge", edges.length === 0)
  sampleEdges(w1, vars, edges)
  sampleEdges(w1, vars, edges)
  t.eqStr(
    "the where's edges, each once",
    edges.map((d: SampleEdge): string => d.diff).join(" "),
    "(- v_n v_m) (- len_a 3)",
  )
  t.eqStr("an Int edge's offsets", edges[0].offsets.join(" "), "(- 1) 0 1")
  t.ok("names in a term", sampleNamesIn("(- (+ v_n 1) len_a)", vars).join(",") === "v_n,len_a")
  const ity = sampleIntTypeOf(flat.args[0], vars)
  t.ok("int type of n", ity !== null && ity === "i32")
  const iterm = sampleIntTerm(flat.args[0], vars, "i32")
  t.ok("int term", iterm !== null && iterm === "(+ v_n 1)")
  t.ok("len term of a call is outside", sampleLenTerm(flat.args[1].args[0], vars) === null)
  const script = sampleScript(vars, [rn, rm, [toI64(0), toI64(4)]], "true", [
    new SampleQuery("", []),
    new SampleQuery("(= v_n 9)", ["v_n"]),
  ])
  t.ok("script declares", script.indexOf("(declare-const v_n Int)") >= 0)
  t.ok("script ranges", script.indexOf("(assert (and (<= (- 5) v_n) (<= v_n 9)))") >= 0)
  t.ok("script queries", script.indexOf(`(echo "@@Q1")`) >= 0 && script.indexOf("(assert (= v_n 9))") >= 0)
  return t.done()
}
