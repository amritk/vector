import { Suite } from "nish/testing"
import { charsFromCodePoint } from "../../../src/spec/contract/chars"
import {
  CellError,
  LITERALS_MAX_REPEAT,
  LITERALS_REPEAT_COUNT,
  LITERALS_REPEAT_RUN,
  LITERALS_REPEAT_SIZE,
  RawKind,
  RawLiteral,
  literalsKindOf,
  literalsLabelledMessage,
  literalsParse,
  literalsParseCall,
  literalsQuote,
  literalsSettle,
  literalsSettleVector,
} from "../../../src/spec/contract/literals"
import { FnSig, LitKind, Literal, Param } from "../../../src/spec/contract/types"
import { typeIntBase } from "../../../src/spec/contract/typing"

/** A raw kind's name. */
const litTestKind = (k: RawKind): string => {
  const kinds: RawKind[] = [
    RawKind.Str,
    RawKind.Bytes,
    RawKind.Empty,
    RawKind.Null,
    RawKind.Bool,
    RawKind.Int,
    RawKind.F64,
    RawKind.Labelled,
    RawKind.LabelledInt,
    RawKind.Repeat,
    RawKind.Concat,
  ]
  const names: string[] = [
    "str",
    "bytes",
    "empty",
    "null",
    "bool",
    "int",
    "f64",
    "labelled",
    "labelled-int",
    "repeat",
    "concat",
  ]
  for (let i = 0; i < kinds.length; i++) {
    if (kinds[i] === k) {
      return names[i]
    }
  }
  return "?"
}

/** A raw literal as text: `kind:text[ label][ hex][ xcount][ (parts)]`. */
const litTestRaw = (r: RawLiteral): string => {
  let out = `${litTestKind(r.kind)}:${r.text}`
  const label = r.label
  if (label !== null) {
    out = `${out} label=${label}`
  }
  const hex = r.hex
  if (hex !== null) {
    out = `${out} hex=${hex}`
  }
  if (r.kind === RawKind.Repeat) {
    out = `${out} x${r.count}`
  }
  if (r.kind === RawKind.Bool) {
    out = `${out} ${r.flag ? "true" : "false"}`
  }
  if (r.kind === RawKind.Concat) {
    out = `${out} (${r.parts.map((p: RawLiteral): string => litTestRaw(p)).join(", ")})`
  }
  return out
}

/** A settled literal as text, in the contract's JSON shape. */
const litTestLit = (l: Literal): string => {
  const extra: string[] = []
  if (l.repeat >= 0) {
    extra.push(`repeat:${l.repeat}`)
  }
  const label = l.label
  if (label !== null) {
    extra.push(`label:${label}`)
  }
  const tail = extra.length > 0 ? ` ${extra.join(" ")}` : ""
  if (l.kind === LitKind.Hex) {
    return `{hex:${l.text}${tail}}`
  }
  if (l.kind === LitKind.Ascii) {
    return `{ascii:${l.text}${tail}}`
  }
  if (l.kind === LitKind.Str) {
    return `{str:${l.text}${tail}}`
  }
  if (l.kind === LitKind.Int) {
    return `{int:${l.text}${l.quoted ? " quoted" : ""}${tail}}`
  }
  if (l.kind === LitKind.F64) {
    return `{f64:${l.text} bits:${l.bits ?? ""}${tail}}`
  }
  if (l.kind === LitKind.Bool) {
    return `{bool:${l.flag ? "true" : "false"}}`
  }
  if (l.kind === LitKind.Null) {
    return "{null}"
  }
  return `{concat:${l.parts.map((p: Literal): string => litTestLit(p)).join(",")}}`
}

/** The raw literal of `text`, or its refusal as `message @col`. */
const litTestParse = (text: string): string => {
  const r = literalsParse(text)
  return r.isOk() ? litTestRaw(r.value) : `${r.error.message} @${r.error.col}`
}

/** The call of `text`, or its refusal. */
const litTestCall = (text: string): string => {
  const r = literalsParseCall(text)
  if (r.isErr()) {
    return `${r.error.message} @${r.error.col}`
  }
  return `${r.value.call}(${r.value.args.map((a: RawLiteral): string => litTestRaw(a)).join(", ")})`
}

/** `text` parsed and settled where `ty` goes, or the refusal. */
const litTestSettle = (text: string, ty: string | null): string => {
  const raw = literalsParse(text)
  if (raw.isErr()) {
    return `parse: ${raw.error.message}`
  }
  const lit = literalsSettle(raw.value, ty)
  return lit.isOk() ? litTestLit(lit.value) : lit.error
}

/** A signature. */
const litTestFn = (name: string, params: string[], returns: string): FnSig => {
  const fn = new FnSig()
  fn.name = name
  for (let i = 0; i + 1 < params.length; i += 2) {
    const p = new Param()
    p.name = params[i]
    p.type = params[i + 1]
    fn.params.push(p)
  }
  fn.returns = returns
  return fn
}

/** A vector settled against `fn`: its literals, or its refusals one per line. */
const litTestVector = (fn: FnSig, call: string, expect: string): string => {
  const c = literalsParseCall(call)
  const e = literalsParse(expect)
  if (c.isErr() || e.isErr()) {
    return "parse failed"
  }
  const r = literalsSettleVector(fn, c.value.args, e.value)
  if (r.isErr()) {
    return r.error.map((x: CellError): string => `${x.cell}: ${x.message}`).join("\n")
  }
  return `${r.value.args.map((a: Literal): string => litTestLit(a)).join(" ")} -> ${litTestLit(r.value.expect)}`
}

/** The vector table's Call and Expected cells, read and settled by type. */
export const main = (): i32 => {
  const t = new Suite("spec/contract literals")
  const times = charsFromCodePoint(0xd7)
  const labelled = literalsLabelledMessage()
  t.ok("the labelled message shows the sign", labelled.endsWith(`\`Label = 22 ${times} 0b\``))

  // Each form.
  t.eqStr("a string", litTestParse('"f\\u00e9\\n"'), `str:f${charsFromCodePoint(0xe9)}\n`)
  t.eqStr("a surrogate pair", litTestParse('"\\ud83d\\ude00"'), `str:${charsFromCodePoint(0x1f600)}`)
  t.eqStr("a bad escape", litTestParse('"a\\q"'), "a quoted string is a JSON string; bad escape @1")
  t.eqStr("a raw tab in a string", litTestParse('"a\tb"'), "a quoted string is a JSON string; bad escape @1")
  t.eqStr("an unclosed string", litTestParse('"ab'), "not a literal @1")
  t.eqStr("bytes", litTestParse("[00 0f ff]"), "bytes:000fff")
  t.eqStr("no bytes", litTestParse("[]"), "bytes:")
  t.eqStr("adjacent pairs", litTestParse("[000f]"), "bytes:000f")
  t.ok("uppercase bytes are refused", litTestParse("[0F]").endsWith("@1"))
  t.ok("two spaces are refused", litTestParse("[00  0f]").startsWith("bytes are lowercase hex pairs"))
  t.eqStr("empty", litTestParse("(empty)"), "empty:")
  t.eqStr("null", litTestParse("null"), "null:")
  t.eqStr("true", litTestParse("true"), "bool: true")
  t.eqStr("a word starting with null", litTestParse("nullx"), "not a literal @1")
  t.eqStr("an int", litTestParse("-42"), "int:-42")
  t.eqStr("a big int", litTestParse("18446744073709551615"), "int:18446744073709551615")
  t.eqStr("an f64", litTestParse("-1.5e-3"), "f64:-1.5e-3")
  t.eqStr("NaN", litTestParse("NaN"), "f64:NaN")
  t.eqStr("-Infinity", litTestParse("-Infinity"), "f64:-Infinity")
  t.eqStr("a leading zero", litTestParse("042"), "not a literal @1")
  t.eqStr("1.", litTestParse("1."), "unexpected text after the value @2")
  t.eqStr("a concat", litTestParse('concat([00], "a")'), "concat: (bytes:00, str:a)")
  t.eqStr("a nested concat", litTestParse("concat(concat([00]))"), "concat does not nest; list every part @8")
  t.eqStr("an empty concat", litTestParse("concat()"), "concat needs at least one part @1")
  const bars = charsFromCodePoint(0x2016)
  t.eqStr("the double bar", litTestParse(`[00] ${bars} [01]`), "unexpected text after the value @6")
  t.eqStr("the double bar alone", litTestParse(`${bars} [01]`), `\`${bars}\` is not a literal; write concat(a, b) @1`)
  t.eqStr("a column counts characters", litTestCall(`f("${charsFromCodePoint(0xe9)}" x)`), "expected `,` or `)` @7")
  t.eqStr("a call", litTestCall("f(1, [00])"), "f(int:1, bytes:00)")
  t.eqStr("no arguments", litTestCall("f()"), "f()")
  t.eqStr("not a call", litTestCall("1f(1)"), "a call is `name(args...)` @1")
  t.eqStr("text after a call", litTestCall("f(1) x"), "unexpected text after the value @6")

  // A labelled int.
  t.eqStr("L = 42", litTestParse("L = 42"), "labelled-int:42 label=L hex=42")
  t.eqStr("L = 7", litTestParse("L = 7"), "labelled-int:7 label=L")
  t.eqStr("Out Len = -1", litTestParse("Out Len = -1"), "labelled-int:-1 label=Out Len")
  t.eqStr("L = 00 is bytes", litTestParse("L = 00"), "labelled:00 label=L")
  t.eqStr("L = 0b0b is bytes", litTestParse("L = 0b0b"), "labelled:0b0b label=L")
  t.eqStr(
    "a label as RFC 8439 prints one",
    litTestParse("32-bit fixed-common part = 07000000"),
    "labelled:07000000 label=32-bit fixed-common part",
  )
  t.eqStr(
    "a label as RFC 7748 prints one, with a comma-grouped count",
    litTestParse("After 1,000,000 iterations = 7c39"),
    "labelled:7c39 label=After 1,000,000 iterations",
  )
  t.eqStr(
    "a label as RFC 8032 prints one, with a parenthesised group",
    litTestParse("MESSAGE (length 1 byte) = 72"),
    "labelled-int:72 label=MESSAGE (length 1 byte) hex=72",
  )
  t.eqStr(
    "the comma and paren in a group do not split a call",
    litTestCall("f(K = 4c, M (after 1,000 runs) = 72, L = 0b)"),
    "f(labelled:4c label=K, labelled-int:72 label=M (after 1,000 runs) hex=72, labelled:0b label=L)",
  )
  t.eqStr(
    "a group with no comma in a call",
    litTestCall("f(SECRET KEY = 4c, MESSAGE (length 1 byte) = 72)"),
    "f(labelled:4c label=SECRET KEY, labelled-int:72 label=MESSAGE (length 1 byte) hex=72)",
  )
  t.eqStr("a group is not the first label word", litTestParse("(length 1 byte) = 72"), "not a literal @1")
  t.eqStr("a bare comma in a group is no label", litTestCall("f(K = 4c, M (length 1, byte) = 72)"), "not a literal @11")
  t.eqStr("a second group is no label", litTestParse("M (a) (b) = 72"), "not a literal @1")
  t.eqStr("an unclosed group is no label", litTestParse("M (length 1 byte = 72"), "not a literal @1")
  t.eqStr("an empty group is no label", litTestParse("M () = 72"), "not a literal @1")
  t.eqStr(
    "a group label in a call",
    litTestCall("f(A (x) = 01, B = 02)"),
    "f(labelled:01 label=A (x), labelled:02 label=B)",
  )
  t.eqStr(
    "a group label in a concat",
    litTestSettle("concat(M (x) = 01, [00])", "bytes"),
    "{concat:{hex:01 label:M (x)},{hex:00}}",
  )
  t.eqStr("a nested group is no label", litTestParse("M (a (b)) = 72"), "not a literal @1")
  t.eqStr(
    "a group with a comma-grouped count",
    litTestParse("M (after 1,000 runs) = 72"),
    "labelled-int:72 label=M (after 1,000 runs) hex=72",
  )
  t.eqStr(
    "a labelled empty value",
    litTestParse("MESSAGE (length 0 bytes) = (empty)"),
    "labelled: label=MESSAGE (length 0 bytes)",
  )
  t.eqStr(
    "a labelled empty value as []",
    litTestParse("MESSAGE (length 0 bytes) = []"),
    "labelled: label=MESSAGE (length 0 bytes)",
  )
  t.eqStr(
    "settled empty bytes",
    litTestSettle("MESSAGE (length 0 bytes) = (empty)", "bytes"),
    "{hex: label:MESSAGE (length 0 bytes)}",
  )
  t.eqStr(
    "72 settled where bytes go",
    litTestSettle("MESSAGE (length 1 byte) = 72", "bytes"),
    "{hex:72 label:MESSAGE (length 1 byte)}",
  )
  t.eqStr(
    "an empty value in a call",
    litTestCall("f(K = 9d, MESSAGE (length 0 bytes) = [])"),
    "f(labelled:9d label=K, labelled: label=MESSAGE (length 0 bytes))",
  )
  t.eqStr("text after (empty) is refused", litTestParse("M = (empty) x"), "unexpected text after the value @13")
  t.eqStr("a badly grouped number is no label word", litTestParse("After 1,00 iterations = 7c39"), "not a literal @1")
  t.eqStr("a bare number is no label", litTestParse("1,000 = 7c39"), "unexpected text after the value @2")
  t.eqStr("an int where an i32 goes", litTestSettle("L = 42", "i32"), "{int:42 label:L}")
  t.eqStr("an int where a u32 goes", litTestSettle("L = 42", "u32?"), "{int:42 label:L}")
  t.eqStr("hex where bytes go", litTestSettle("L = 42", "bytes"), "{hex:42 label:L}")
  t.eqStr("hex past the last parameter", litTestSettle("L = 42", null), "{hex:42 label:L}")
  t.eqStr("digits that are not pairs stay an int", litTestSettle("L = 7", "bytes"), "{int:7 label:L}")
  t.ok("the int base", (typeIntBase("u8?") ?? "") === "u8" && typeIntBase("bytes") === null)

  // Settling by type.
  t.eqStr("a string where bytes go", litTestSettle('"ab"', "bytes"), "{ascii:ab}")
  t.eqStr("a string where a string goes", litTestSettle('"ab"', "string?"), "{str:ab}")
  t.eqStr("a string where null goes", litTestSettle('"ab"', "null"), "{ascii:ab}")
  t.eqStr(
    "a string where an int goes",
    litTestSettle('"ab"', "u8"),
    'the types do not settle "ab": a quoted string goes where bytes or a string does, not u8',
  )
  t.eqStr(
    "a string past the last parameter",
    litTestSettle('"ab"', null),
    'the types do not settle "ab": a quoted string goes where bytes or a string does, not past the last parameter',
  )
  t.eqStr(
    "a string that is not string text",
    litTestSettle('"caf\\u00e9\\u0000"', "bytes"),
    'a quoted string is printable ASCII, tab, LF and CR only; "caf\\u00e9\\u0000" is not',
  )
  t.eqStr("quote escapes", literalsQuote(`a"\\\n${charsFromCodePoint(0x1f600)}`), '"a\\"\\\\\\n\\ud83d\\ude00"')
  t.eqStr("an int where an f64 goes", litTestSettle("1", "f64"), "{f64:1 bits:3ff0000000000000}")
  t.eqStr("an f64", litTestSettle("-0.5", null), "{f64:-0.5 bits:bfe0000000000000}")
  t.eqStr(
    "an f64 past the largest",
    litTestSettle("1e309", "f64"),
    "1e309 is past the largest f64; write Infinity or -Infinity",
  )
  t.eqStr("a JSON-safe int", litTestSettle("9007199254740991", "u64"), "{int:9007199254740991}")
  t.eqStr("an int past 2^53 - 1 is quoted", litTestSettle("9007199254740992", "u64"), "{int:9007199254740992 quoted}")
  t.eqStr("empty", litTestSettle("(empty)", "bytes"), "{ascii:}")
  t.eqStr("false", litTestSettle("false", "bool"), "{bool:false}")
  t.eqStr("null", litTestSettle("null", "bytes?"), "{null}")
  t.eqStr("a concat", litTestSettle('concat([00], "a", 2 x 0b)', null), "{concat:{hex:00},{ascii:a},{hex:0b repeat:2}}")
  t.eqStr("a concat of an int", litTestSettle("concat(L = 7)", "bytes"), "a concat part is bytes, not an int")
  t.eqStr("a concat of a bool", litTestSettle("concat(true)", "bytes"), "a concat part is bytes, not bool")
  const intLit = new Literal(LitKind.Int, "1")
  t.ok("kind names", literalsKindOf(intLit) === "an int" && literalsKindOf(new Literal(LitKind.Hex, "00")) === "bytes")

  // Vectors.
  const fkn = litTestFn("f", ["key", "bytes", "n", "u32"], "bytes")
  t.eqStr(
    "by each parameter's type",
    litTestVector(fkn, "f(K = 42, L = 42)", "OKM = 10"),
    "{hex:42 label:K} {int:42 label:L} -> {hex:10 label:OKM}",
  )
  t.eqStr(
    "secret-bytes is bytes",
    litTestVector(litTestFn("g", ["k", "secret-bytes"], "string"), 'g("k")', '"v"'),
    "{ascii:k} -> {str:v}",
  )
  t.eqStr(
    "ints that do not fit",
    litTestVector(fkn, "f(K = 7, L = -1)", "[]"),
    "Call: argument 1 of f (key) is bytes, not an int 7\nCall: argument 2 of f (n) is u32, not an int -1",
  )
  t.eqStr(
    "bytes and out-of-range ints where an int goes",
    litTestVector(
      litTestFn("f", ["a", "i32", "b", "i32", "c", "u32"], "i32"),
      "f(L = 0a, L = 00, L = 4294967296)",
      "R = 07",
    ),
    [
      "Call: argument 1 of f (a) is i32, not bytes",
      "Call: argument 2 of f (b) is i32, not bytes (`L = 00` has a leading zero, so it is bytes)",
      "Call: argument 3 of f (c) is u32, not an int 4294967296",
      "Expected: f returns i32, not bytes (`R = 07` has a leading zero, so it is bytes)",
    ].join("\n"),
  )
  t.eqStr(
    "the argument count",
    litTestVector(fkn, 'f([00], 1, "x")', "[]"),
    [
      "Call: f takes 2 argument(s), not 3",
      'Call: the types do not settle "x": a quoted string goes where bytes or a string does, not past the last parameter',
    ].join("\n"),
  )
  t.eqStr("a bad expected value", litTestVector(fkn, "f([00], 1)", "true"), "Expected: f returns bytes, not bool")

  // Labelled refusals, with the column.
  for (const text of ["L = -0", "L = 4x", "L = ", "L = 42]", "L = 42.0", "L = 042"]) {
    t.eqStr(`refuses ${text}`, litTestParse(text), `${labelled} @1`)
  }
  t.eqStr("a labelled refusal in a call", litTestCall("f(1, L = 0A)"), `${labelled} @6`)

  // A repeated run.
  const ikm = "repeat:0b x22"
  t.eqStr("with the sign", litTestParse(`22 ${times} 0b`), ikm)
  t.eqStr("with x", litTestParse("22 x 0b"), ikm)
  t.eqStr("labelled", litTestParse(`IKM = 22 ${times} 0b`), "repeat:0b label=IKM x22")
  t.eqStr("no spaces", litTestParse(`22${times}0b`), ikm)
  t.eqStr("a space before", litTestParse(`22 ${times}0b`), ikm)
  t.eqStr("the largest", litTestParse(`${LITERALS_MAX_REPEAT / 2} ${times} 00ff`), "repeat:00ff x32768")
  t.eqStr("settled", litTestSettle(`22 ${times} 0b`, "bytes"), "{hex:0b repeat:22}")
  t.eqStr("settled with its label", litTestSettle("IKM = 22 x 0b", "bytes"), "{hex:0b repeat:22 label:IKM}")
  t.eqStr(
    "in a concat",
    litTestSettle(`concat(2 ${times} 0b, K = 3 ${times} ff, [00])`, "bytes"),
    "{concat:{hex:0b repeat:2},{hex:ff repeat:3 label:K},{hex:00}}",
  )
  t.eqStr("in a call", litTestCall(`f(2 ${times} 0b,1 x 00)`), "f(repeat:0b x2, repeat:00 x1)")

  // Repeat refusals, with the column.
  const cases: string[] = [
    `0 ${times} 0b`,
    LITERALS_REPEAT_COUNT,
    "1",
    `-1 ${times} 0b`,
    LITERALS_REPEAT_COUNT,
    "1",
    `01 ${times} 0b`,
    LITERALS_REPEAT_COUNT,
    "1",
    `${LITERALS_MAX_REPEAT + 1} ${times} 0b`,
    LITERALS_REPEAT_SIZE,
    "1",
    `${LITERALS_MAX_REPEAT} ${times} 0b0b`,
    LITERALS_REPEAT_SIZE,
    "1",
    `99999999999 ${times} 0b`,
    LITERALS_REPEAT_SIZE,
    "1",
    `IKM = 0 ${times} 0b`,
    LITERALS_REPEAT_COUNT,
    "7",
    `22 ${times} 0`,
    LITERALS_REPEAT_RUN,
    "6",
    `22 ${times} 0B`,
    LITERALS_REPEAT_RUN,
    "6",
    "22 x ",
    LITERALS_REPEAT_RUN,
    "6",
    `IKM = 22 ${times} 0b0`,
    LITERALS_REPEAT_RUN,
    "12",
  ]
  for (let i = 0; i + 2 < cases.length; i += 3) {
    t.eqStr(`refuses ${cases[i]}`, litTestParse(cases[i]), `${cases[i + 1]} @${cases[i + 2]}`)
  }
  t.eqStr("a bracketed run", litTestCall(`f(22 ${times} [0b])`), `${LITERALS_REPEAT_RUN} @8`)
  t.eqStr("a run ends at a space", litTestParse(`2 ${times} 0b 0b`), "unexpected text after the value @8")
  return t.done()
}
