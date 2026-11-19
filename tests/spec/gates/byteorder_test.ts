import { Suite } from "nish/testing"
import { toHex } from "../../../src/core/hex"
import { Expr, ExprKind, ForallVar, LitKind, Literal } from "../../../src/spec/contract/types"
import { vocabReadOps, vocabReadType, vocabWriteOps } from "../../../src/spec/contract/vocab"
import { SAMPLE_UNDEFINED, SampleValue, sampleBytes, sampleEval, sampleInt } from "../../../src/spec/sample/eval"
import { sampleIntTerm, sampleIntTypeOf, sampleLenTerm } from "../../../src/spec/sample/smt"

/** An int literal expression. */
const byteorderInt = (text: string): Expr => {
  const e = new Expr(ExprKind.Lit, "")
  e.lit = new Literal(LitKind.Int, text)
  return e
}

/** `op` applied to one argument. */
const byteorderOp = (op: string, arg: Expr): Expr => {
  const e = new Expr(ExprKind.Op, op)
  e.args = [arg]
  return e
}

/** A variable of a type. */
const byteorderForall = (name: string, ty: string): ForallVar => {
  const v = new ForallVar()
  v.name = name
  v.type = ty
  return v
}

/** The hex of `op(x)` with x an integer of type `ty`. */
const byteorderWrite = (op: string, x: i64, ty: string): string => {
  const env = new Map<string, SampleValue>()
  env.set("x", sampleInt(x, ty))
  const v = sampleEval(byteorderOp(op, new Expr(ExprKind.Var, "x")), env)
  return v.isOk() ? toHex(v.value.bytes) : `error: ${v.error}`
}

/** `op(b)` as decimal text, or the error it evaluates to. */
const byteorderRead = (op: string, b: u8[]): string => {
  const env = new Map<string, SampleValue>()
  env.set("b", sampleBytes(b))
  const v = sampleEval(byteorderOp(op, new Expr(ExprKind.Var, "b")), env)
  return v.isOk() ? `${v.value.n}` : v.error
}

/** The sampler's byte-order ops: writes, reads, wrong lengths, and their solver terms. */
export const main = (): i32 => {
  const t = new Suite("spec/gates/byteorder")

  // Writes: the op's width and order, a negative value in two's complement.
  const ops = ["le16", "le32", "le64", "be16", "be32", "be64"]
  const of258 = ["0201", "02010000", "0201000000000000", "0102", "00000102", "0000000000000102"]
  const ofMinus2 = ["feff", "feffffff", "feffffffffffffff", "fffe", "fffffffe", "fffffffffffffffe"]
  for (let i = 0; i < ops.length; i++) {
    t.eqStr(`${ops[i]} of 258`, byteorderWrite(ops[i], toI64(258), "u16"), of258[i])
    t.eqStr(`${ops[i]} of -2`, byteorderWrite(ops[i], toI64(-2), "i16"), ofMinus2[i])
  }
  t.eqStr("le64 of a negative i32 is sign-extended", byteorderWrite("le64", toI64(-1), "i32"), "ffffffffffffffff")
  t.eqStr(
    "le64 of a u32 is zero-extended",
    byteorderWrite("le64", toI64(65535) * toI64(65537), "u32"),
    "ffffffff00000000",
  )
  t.eqStr("be64 of u64's maximum", byteorderWrite("be64", toI64(-1), "u64"), "ffffffffffffffff")

  // Reads: exactly the width, in the op's order, signed or not.
  const zeros: u8[] = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  const all: u8[] = [255, 255, 255, 255, 255, 255, 255, 254]
  const reads = ["leU16", "leU32", "leU64", "beU16", "beU32", "beU64", "leI32", "leI64", "beI32", "beI64"]
  const widths: i32[] = [2, 4, 8, 2, 4, 8, 4, 8, 4, 8]
  const want = [
    "65535",
    "4294967295",
    "-72057594037927937",
    "65535",
    "4294967295",
    "-2",
    "-1",
    "-72057594037927937",
    "-1",
    "-2",
  ]
  for (let i = 0; i < reads.length; i++) {
    t.eqStr(`${reads[i]} of its width`, byteorderRead(reads[i], all.slice(0, widths[i])), want[i])
    t.eqStr(`${reads[i]} of one byte short`, byteorderRead(reads[i], all.slice(0, widths[i] - 1)), SAMPLE_UNDEFINED)
    t.eqStr(`${reads[i]} of one byte more`, byteorderRead(reads[i], zeros.slice(0, widths[i] + 1)), SAMPLE_UNDEFINED)
    t.eqStr(`${reads[i]} of nothing`, byteorderRead(reads[i], zeros.slice(0, 0)), SAMPLE_UNDEFINED)
  }
  t.eqStr("leU16's order", byteorderRead("leU16", [1, 2]), "513")
  t.eqStr("beU16's order", byteorderRead("beU16", [1, 2]), "258")
  t.eqStr("beI32 of a high bit", byteorderRead("beI32", [128, 0, 0, 0]), "-2147483648")
  t.eqStr("leU32 of a high bit stays positive", byteorderRead("leU32", [0, 0, 0, 128]), "2147483648")

  // The solver: a write's length is its width; a read of a same-width write is a term.
  const vars = [byteorderForall("x", "i32"), byteorderForall("h", "u16"), byteorderForall("w", "u64")]
  const x = new Expr(ExprKind.Var, "x")
  const h = new Expr(ExprKind.Var, "h")
  for (const op of vocabWriteOps()) {
    t.eqStr(
      `${op}'s length`,
      sampleLenTerm(byteorderOp(op, x), vars) ?? "",
      op.substring(2) === "16" ? "2" : op.substring(2) === "32" ? "4" : "8",
    )
  }
  for (const op of vocabReadOps()) {
    t.eqStr(`${op}'s type`, sampleIntTypeOf(byteorderOp(op, x), vars) ?? "", vocabReadType(op))
  }
  t.eqStr(
    "beU16 of be16 of a u16 is the u16",
    sampleIntTerm(byteorderOp("beU16", byteorderOp("be16", h)), vars, "u16") ?? "",
    "v_h",
  )
  t.eqStr(
    "leU16 of be16 swaps its bytes",
    sampleIntTerm(byteorderOp("leU16", byteorderOp("be16", h)), vars, "u16") ?? "",
    "(concat ((_ extract 7 0) v_h) ((_ extract 15 8) v_h))",
  )
  t.eqStr(
    "beI64 of be64 of an i32 sign-extends it",
    sampleIntTerm(byteorderOp("beI64", byteorderOp("be64", x)), vars, "i64") ?? "",
    "((_ sign_extend 32) ((_ int2bv 32) v_x))",
  )
  t.eqStr(
    "leI32 of le32 of an i32 is back in Int",
    sampleIntTerm(byteorderOp("leI32", byteorderOp("le32", x)), vars, "i32") ?? "",
    "(ite (bvslt ((_ int2bv 32) v_x) #x00000000) (- (bv2int ((_ int2bv 32) v_x)) 4294967296) (bv2int ((_ int2bv 32) v_x)))",
  )
  t.eqStr(
    "beU64 of le64 of a u16 zero-extends, then swaps",
    sampleIntTerm(byteorderOp("beU64", byteorderOp("le64", h)), vars, "u64")?.substring(0, 52) ?? "",
    "(concat ((_ extract 7 0) ((_ zero_extend 48) v_h)) (",
  )
  t.ok(
    "a read of a wider write is outside the skeleton",
    sampleIntTerm(byteorderOp("leU32", byteorderOp("le64", h)), vars, "u32") === null,
  )
  t.ok(
    "a read of a variable is outside it",
    sampleIntTerm(byteorderOp("leU16", new Expr(ExprKind.Var, "b")), vars, "u16") === null,
  )
  t.ok(
    "a read at another type is not its term",
    sampleIntTerm(byteorderOp("beU16", byteorderOp("be16", h)), vars, "u32") === null,
  )
  t.ok(
    "a write of a bare literal, untyped there, is outside it",
    sampleIntTerm(byteorderOp("beU16", byteorderOp("be16", byteorderInt("7"))), vars, "u16") === null,
  )
  return t.done()
}
