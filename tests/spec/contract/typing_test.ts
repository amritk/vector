import { Suite } from "nish/testing"
import { replaceAll } from "nish/text"
import { contractParse } from "../../../src/spec/contract/read"
import { Contract, Expr, LitKind, Literal } from "../../../src/spec/contract/types"
import {
  TypeEnv,
  typeAssignable,
  typeCallsIn,
  typeEnvBind,
  typeLiteralFits,
  typeOf,
  typeOfInt,
  typeOfLiteral,
} from "../../../src/spec/contract/typing"
import {
  vocabByteWidth,
  vocabIntTypes,
  vocabReadOps,
  vocabReadType,
  vocabWriteOps,
} from "../../../src/spec/contract/vocab"

/** A contract with one property clause; ASSERT is replaced by the expression under test. */
const BASE: string = `{
  "contract": "c1",
  "source": {"title": "T", "rfc": 4648},
  "target": {"module": "nish/hex"},
  "requirements": [{"id": "R1", "section": "3.1", "level": "MUST", "quote": "Q"}],
  "functions": [
    {"name": "enc", "params": [{"name": "b", "type": "bytes"}], "returns": "string"},
    {"name": "dec", "params": [{"name": "s", "type": "string"}], "returns": "bytes?"},
    {"name": "inc", "params": [{"name": "n", "type": "u32"}], "returns": "u32"}
  ],
  "clauses": [
    {"kind": "property", "id": "P1", "title": "p", "covers": ["R1"],
     "forall": [{"name": "x", "type": "u8", "min": 0, "max": 255}, {"name": "b", "type": "bytes", "minLen": 0, "maxLen": 8}],
     "assert": ASSERT}
  ]
}`

/** The assert of BASE with `expr` in it. */
const typingAssert = (expr: string): Expr | null => {
  const c = contractParse(replaceAll(BASE, "ASSERT", expr), "base")
  if (c.isErr()) {
    return null
  }
  const contract: Contract = c.value
  return contract.clauses[0].assert
}

/** The environment of BASE's clause: its functions and its forall variables. */
const typingEnv = (allowCalls: boolean): TypeEnv => {
  const c = contractParse(replaceAll(BASE, "ASSERT", `{"bool": true}`), "base").expect("reads")
  const env = new TypeEnv(c.functions, allowCalls)
  for (const v of c.clauses[0].forall) {
    typeEnvBind(env, v.name, v.type)
  }
  return env
}

/** `expr`'s type, or its errors, one per line. */
const typingOf = (expr: string, allowCalls: boolean): string => {
  const e = typingAssert(expr)
  if (e === null) {
    return "read error"
  }
  const errors: string[] = []
  const t = typeOf(e, typingEnv(allowCalls), "assert", errors)
  if (errors.length > 0) {
    return errors.join("\n")
  }
  return t ?? "null"
}

/** An int as a contract writes it: a JSON number, or a string past 2^53. */
const typingIntJson = (v: string): string => (v.length > 15 ? `"${v}"` : v)

/** `expr`'s type, or its errors, with `n` bound to `nType` beside BASE's variables. */
const typingOfWith = (expr: string, nType: string): string => {
  const e = typingAssert(expr)
  if (e === null) {
    return "read error"
  }
  const env = typingEnv(true)
  typeEnvBind(env, "n", nType)
  const errors: string[] = []
  const ty = typeOf(e, env, "assert", errors)
  return errors.length > 0 ? errors.join("\n") : ty ?? "null"
}

/** Expression types and the errors typeOf reports. */
export const main = (): i32 => {
  const t = new Suite("spec/contract typing")

  // Types.
  t.eqStr("a var", typingOf(`{"var": "x"}`, true), "u8")
  t.eqStr("a call", typingOf(`{"call": "enc", "args": [{"var": "b"}]}`, true), "string")
  t.eqStr("an optional call", typingOf(`{"call": "dec", "args": [{"str": "a"}]}`, true), "bytes?")
  t.eqStr("unwrap", typingOf(`{"op": "unwrap", "args": [{"call": "dec", "args": [{"str": "a"}]}]}`, true), "bytes")
  t.eqStr("isNull", typingOf(`{"op": "isNull", "args": [{"call": "dec", "args": [{"str": "a"}]}]}`, true), "bool")
  t.eqStr("len", typingOf(`{"op": "len", "args": [{"var": "b"}]}`, true), "i32")
  t.eqStr(
    "an int adopts the other side's type",
    typingOf(`{"op": "+", "args": [{"var": "x"}, {"int": 1}]}`, true),
    "u8",
  )
  t.eqStr("a comparison", typingOf(`{"op": "<=", "args": [{"var": "x"}, {"int": 255}]}`, true), "bool")
  t.eqStr(
    "null compares with an optional",
    typingOf(`{"op": "==", "args": [{"call": "dec", "args": [{"str": "a"}]}, {"null": true}]}`, true),
    "bool",
  )
  t.eqStr("a bare null", typingOf(`{"null": true}`, true), "null")
  t.eqStr("ascii", typingOf(`{"op": "ascii", "args": [{"var": "b"}]}`, true), "string?")
  t.eqStr(
    "a let",
    typingOf(`{"let": [{"name": "y", "value": {"var": "b"}}], "in": {"op": "len", "args": [{"var": "y"}]}}`, true),
    "i32",
  )
  t.eqStr(
    "i32 passes as u32",
    typingOf(`{"call": "inc", "args": [{"op": "len", "args": [{"var": "b"}]}]}`, true),
    "u32",
  )
  t.eqStr("and", typingOf(`{"op": "and", "args": [{"bool": true}, {"bool": false}, {"bool": true}]}`, true), "bool")

  // Errors.
  t.eqStr("an unknown variable", typingOf(`{"var": "z"}`, true), `assert: unknown variable "z"`)
  t.eqStr("an unknown function", typingOf(`{"call": "nope", "args": []}`, true), `assert: unknown function "nope"`)
  t.eqStr("an unknown operator", typingOf(`{"op": "pow", "args": []}`, true), `assert: unknown operator "pow"`)
  t.eqStr("arity of a call", typingOf(`{"call": "enc", "args": []}`, true), "assert: enc takes 1 argument(s), got 0")
  t.eqStr("arity of an op", typingOf(`{"op": "not", "args": []}`, true), "assert: not takes 1 argument(s), got 0")
  t.eqStr(
    "an argument of the wrong type",
    typingOf(`{"call": "enc", "args": [{"var": "x"}]}`, true),
    "assert.args[0]: enc(b) wants bytes, got u8",
  )
  t.eqStr(
    "an optional where bytes are wanted",
    typingOf(`{"call": "enc", "args": [{"call": "dec", "args": [{"str": "a"}]}]}`, true),
    `assert.args[0]: enc(b) wants bytes, got bytes? — wrap it in {"op":"unwrap"}`,
  )
  t.eqStr(
    "an int outside the parameter",
    typingOf(`{"call": "inc", "args": [{"int": -1}]}`, true),
    "assert.args[0]: inc(n) wants u32, and -1 is outside it",
  )
  t.eqStr(
    "where may not call",
    typingOf(`{"call": "enc", "args": [{"var": "b"}]}`, false),
    `assert: "where" may not call enc — the domain must not depend on the implementation`,
  )
  t.eqStr(
    "unwrap of a non-optional",
    typingOf(`{"op": "unwrap", "args": [{"var": "b"}]}`, true),
    "assert: unwrap wants an optional (T?), got bytes",
  )
  t.eqStr(
    "cannot compare",
    typingOf(`{"op": "==", "args": [{"var": "b"}, {"var": "x"}]}`, true),
    "assert: cannot compare bytes with u8",
  )
  t.eqStr(
    "and with one argument",
    typingOf(`{"op": "and", "args": [{"bool": true}]}`, true),
    "assert: and takes at least 2 arguments",
  )
  t.eqStr(
    "an operand of the wrong type",
    typingOf(`{"op": "not", "args": [{"var": "x"}]}`, true),
    "assert.args[0]: not wants bool, got u8",
  )
  t.eqStr(
    "an int outside the other side",
    typingOf(`{"op": "+", "args": [{"var": "x"}, {"int": 256}]}`, true),
    "assert.args[1]: 256 is outside u8",
  )
  t.eqStr(
    "an int outside every type",
    typingOf(`{"op": "+", "args": [{"int": "99999999999999999999"}, {"int": 1}]}`, true),
    "assert.args[0]: int 99999999999999999999 is outside every integer type",
  )
  t.eqStr(
    "a let that shadows",
    typingOf(`{"let": [{"name": "x", "value": {"var": "b"}}], "in": {"bool": true}}`, true),
    `assert.let[0]: "x" shadows a name already in scope`,
  )
  t.eqStr(
    "a let of a bare null",
    typingOf(`{"let": [{"name": "y", "value": {"null": true}}], "in": {"bool": true}}`, true),
    "assert.let[0]: a bare null has no type to bind",
  )

  // typeCallsIn.
  const calls = typingAssert(
    `{"op": "==", "args": [{"call": "dec", "args": [{"call": "enc", "args": [{"var": "b"}]}]}, {"call": "dec", "args": [{"str": "x"}]}]}`,
  )
  t.eqStr("calls, each once, in order", calls === null ? "" : typeCallsIn(calls).join(" "), "dec enc")
  const letCalls = typingAssert(
    `{"let": [{"name": "y", "value": {"call": "enc", "args": [{"var": "b"}]}}], "in": {"var": "y"}}`,
  )
  t.eqStr("calls inside a let", letCalls === null ? "" : typeCallsIn(letCalls).join(" "), "enc")

  // typeAssignable.
  t.ok("same type", typeAssignable("bytes", "bytes"))
  t.ok("null to an optional", typeAssignable("null", "bytes?"))
  t.ok("base to an optional", typeAssignable("u8", "u8?"))
  t.ok("i32 to u32", typeAssignable("i32", "u32"))
  t.ok("not u32 to i32", !typeAssignable("u32", "i32"))
  t.ok("not an optional to its base", !typeAssignable("bytes?", "bytes"))

  // Byte order: a write op takes every integer type no wider than it, and refuses a wider one.
  for (const op of vocabWriteOps()) {
    const bits = vocabByteWidth(op) * 8
    for (const ty of vocabIntTypes()) {
      const got = typingOfWith(`{"op": "${op}", "args": [{"var": "n"}]}`, ty)
      if (parseInt(ty.substring(1)) <= bits) {
        t.eqStr(`${op} takes ${ty}`, got, "bytes")
      } else {
        t.eqStr(`${op} refuses ${ty}`, got, `assert.args[0]: ${op} wants an integer of at most ${bits} bits, got ${ty}`)
      }
    }
    t.eqStr(
      `${op} refuses bytes`,
      typingOfWith(`{"op": "${op}", "args": [{"var": "b"}]}`, "u8"),
      `assert.args[0]: ${op} wants an integer of at most ${bits} bits, got bytes`,
    )
  }
  // A write op's int literal fits its width, signed or unsigned, and no further.
  const litOps = ["le16", "be16", "le32", "be32", "le64", "be64"]
  const litFits = ["-32768", "65535", "-2147483648", "4294967295", "-9223372036854775808", "18446744073709551615"]
  const litPast = ["-32769", "65536", "-2147483649", "4294967296", "-9223372036854775809", "18446744073709551616"]
  for (let i = 0; i < litOps.length; i++) {
    const op = litOps[i]
    t.eqStr(
      `${op} takes ${litFits[i]}`,
      typingOfWith(`{"op": "${op}", "args": [{"int": ${typingIntJson(litFits[i])}}]}`, "u8"),
      "bytes",
    )
    t.ok(
      `${op} refuses ${litPast[i]}`,
      typingOfWith(`{"op": "${op}", "args": [{"int": ${typingIntJson(litPast[i])}}]}`, "u8").indexOf(`${litPast[i]}`) >=
        0,
    )
  }
  t.eqStr(
    "le16's literal error",
    typingOfWith(`{"op": "le16", "args": [{"int": 65536}]}`, "u8"),
    "assert.args[0]: 65536 does not fit le16's 16 bits",
  )
  // A read op takes bytes and gives its integer type.
  for (const op of vocabReadOps()) {
    t.eqStr(
      `${op} reads ${vocabReadType(op)}`,
      typingOfWith(`{"op": "${op}", "args": [{"var": "b"}]}`, "u8"),
      vocabReadType(op),
    )
    t.eqStr(
      `${op} refuses an integer`,
      typingOfWith(`{"op": "${op}", "args": [{"var": "n"}]}`, "u32"),
      `assert.args[0]: ${op} wants bytes, got u32`,
    )
  }
  t.eqStr(
    "a read compares with its own type",
    typingOfWith(
      `{"op": "==", "args": [{"op": "beU16", "args": [{"op": "be16", "args": [{"var": "n"}]}]}, {"var": "n"}]}`,
      "u16",
    ),
    "bool",
  )

  // typeOfInt.
  t.eqStr("small int", typeOfInt("-5") ?? "", "i32")
  t.eqStr("past i32", typeOfInt("2147483648") ?? "", "i64")
  t.eqStr("past i64", typeOfInt("18446744073709551615") ?? "", "u64")
  t.ok("past u64", typeOfInt("18446744073709551616") === null)

  // typeOfLiteral and typeLiteralFits.
  t.eqStr("hex is bytes", typeOfLiteral(new Literal(LitKind.Hex, "00")), "bytes")
  t.eqStr("str is string", typeOfLiteral(new Literal(LitKind.Str, "a")), "string")
  t.eqStr("an int's own type", typeOfLiteral(new Literal(LitKind.Int, "3000000000")), "i64")
  t.eqStr("null", typeOfLiteral(new Literal(LitKind.Null, "")), "null")
  t.ok("255 fits u8", typeLiteralFits(new Literal(LitKind.Int, "255"), "u8"))
  t.ok("256 does not fit u8", !typeLiteralFits(new Literal(LitKind.Int, "256"), "u8"))
  t.ok("an int fits an optional int", typeLiteralFits(new Literal(LitKind.Int, "1"), "u8?"))
  t.ok("null fits an optional", typeLiteralFits(new Literal(LitKind.Null, ""), "bytes?"))
  t.ok("null does not fit bytes", !typeLiteralFits(new Literal(LitKind.Null, ""), "bytes"))
  t.ok("hex fits bytes", typeLiteralFits(new Literal(LitKind.Hex, "00"), "bytes"))
  t.ok("str does not fit bytes", !typeLiteralFits(new Literal(LitKind.Str, "a"), "bytes"))
  return t.done()
}
