import { Suite } from "nish/testing"
import { replaceAll, split } from "nish/text"
import { contractParse } from "../../../src/spec/contract/read"
import { Expr, ExprKind, FnSig, ForallVar, LitKind, Param } from "../../../src/spec/contract/types"
import { contractWrite } from "../../../src/spec/contract/write"
import {
  FrontInterface,
  FrontProperty,
  FrontRefusal,
  frontParseInterface,
  frontParseProperty,
  frontReads,
} from "../../../src/spec/front/front"

const FRONT_TEST_DEPTH: string = "the expression nests more than 64 deep; name a part with const"
const FRONT_TEST_TYPES: string =
  "u8[], string, boolean, i8, i16, i32, i64, u8, u16, u32, u64, f64, Secret<u8[]>, u16[], u32[], u64[], each optionally `| null`"
const FRONT_TEST_FORALL: string =
  "is not a forall type; use u8[], string or an integer type (i8, i16, i32, i64, u8, u16, u32, u64)"
const FRONT_TEST_BYTES: string = "a bytes literal is lowercase hex pairs separated by single spaces, like [00 0f]"
const FRONT_TEST_SLICE: string =
  "a negative `.slice` index counts from the end in TypeScript and clamps to 0 in the contract"
const FRONT_TEST_VARS: string = "b: u8[] /* 0..4 */, t: string /* 0..4 hexdigit */, i: i32 /* -5..5 */"

/** `s` `n` times, joined by `sep`. */
const frontTestRepeat = (s: string, n: i32, sep: string): string => {
  let out = ""
  for (let k = 0; k < n; k++) {
    out = k === 0 ? s : `${out}${sep}${s}`
  }
  return out
}

/** A property over b, t and i with `body` and an optional `where`. */
const frontTestProp = (body: string, where: string): string =>
  `// P-X covers R-X — a title\nforall (${FRONT_TEST_VARS}) => ${body}${where}`

/** Where `needle` last occurs in `text`, as `line:col`; the end of the text when `needle` is "". */
const frontTestPosOf = (text: string, needle: string): string => {
  let i = needle.length === 0 ? text.length : -1
  if (i < 0) {
    let from = 0
    while (true) {
      const k = text.indexOf(needle, from)
      if (k < 0) {
        break
      }
      i = k
      from = k + 1
    }
  }
  if (i < 0) {
    return `no ${needle}`
  }
  let line = 1
  let start = 0
  for (let k = 0; k < i; k++) {
    if (text.charCodeAt(k) === 10) {
      line = line + 1
      start = k + 1
    }
  }
  return `${line}:${i - start + 1}`
}

const frontTestRefusal = (r: FrontRefusal[]): string =>
  r.length === 1 ? `${r[0].message} @${r[0].line}:${r[0].col}` : `${r.length} refusals`

const frontTestLit = (e: Expr): string => {
  const lit = e.lit
  if (lit === null) {
    return "?"
  }
  if (lit.kind === LitKind.Int) {
    return lit.text
  }
  if (lit.kind === LitKind.Str) {
    return `"${lit.text}"`
  }
  if (lit.kind === LitKind.Ascii) {
    return `ascii"${lit.text}"`
  }
  if (lit.kind === LitKind.Hex) {
    return `[${lit.text}]`
  }
  if (lit.kind === LitKind.Bool) {
    return lit.flag ? "true" : "false"
  }
  if (lit.kind === LitKind.Null) {
    return "null"
  }
  return "?"
}

/** An expression as compact text: `op(a, b)`, `@call(a)`, `let(x = e; body)`. */
function frontTestExpr(e: Expr): string {
  if (e.kind === ExprKind.Lit) {
    return frontTestLit(e)
  }
  if (e.kind === ExprKind.Var) {
    return e.name
  }
  if (e.kind === ExprKind.Let) {
    const binds: string[] = []
    for (const b of e.binds) {
      binds.push(`${b.name} = ${frontTestExpr(b.value)}`)
    }
    const body = e.body
    return `let(${binds.join(", ")}; ${body === null ? "?" : frontTestExpr(body)})`
  }
  const args: string[] = []
  for (const a of e.args) {
    args.push(frontTestExpr(a))
  }
  return `${e.kind === ExprKind.Call ? "@" : ""}${e.name}(${args.join(", ")})`
}

const frontTestSig = (f: FnSig): string => {
  const params: string[] = []
  for (const p of f.params) {
    params.push(`${p.name}: ${p.type}`)
  }
  return `${f.name}(${params.join(", ")}): ${f.returns}`
}

const frontTestIface = (r: FrontInterface): string => {
  const sigs: string[] = []
  for (const f of r.functions) {
    sigs.push(frontTestSig(f))
  }
  const lines: string[] = []
  for (const l of r.lines) {
    lines.push(`${l}`)
  }
  return `${r.module} | ${sigs.join("; ")} | ${lines.join(",")}`
}

const frontTestForall = (x: ForallVar): string => {
  const alphabet = x.alphabet
  const a = alphabet === null ? "" : ` [${alphabet.join("|")}]`
  return x.hasBounds
    ? `${x.name}: ${x.type} ${x.min}..${x.max}`
    : `${x.name}: ${x.type} len ${x.minLen}..${x.maxLen}${a}`
}

/** The hex functions and a `seal` with every other parameter type. */
const frontTestFns = (hex: FnSig[]): FnSig[] => {
  const out: FnSig[] = []
  for (const f of hex) {
    out.push(f)
  }
  const seal = new FnSig()
  seal.name = "seal"
  const key = new Param()
  key.name = "key"
  key.type = "secret-bytes"
  const n = new Param()
  n.name = "n"
  n.type = "u32"
  seal.params = [key, n]
  seal.returns = "secret-bytes?"
  out.push(seal)
  return out
}

const frontTestAssert = (t: Suite, fns: FnSig[], body: string, want: string): void => {
  const r = frontParseProperty(frontTestProp(body, ""), fns)
  if (r.isErr()) {
    t.fail(body, frontTestRefusal(r.error))
    return
  }
  const assert = r.value.clause.assert
  t.eqStr(body, assert === null ? "?" : frontTestExpr(assert), want)
}

const frontTestRefusesAs = (
  t: Suite,
  fns: FnSig[],
  label: string,
  text: string,
  message: string,
  needle: string,
): void => {
  const r = frontParseProperty(text, fns)
  if (r.isOk()) {
    t.fail(label, `accepted ${text}`)
    return
  }
  t.eqStr(label, frontTestRefusal(r.error), `${message} @${frontTestPosOf(text, needle)}`)
}

const frontTestRefuses = (t: Suite, fns: FnSig[], text: string, message: string, needle: string): void =>
  frontTestRefusesAs(t, fns, message, text, message, needle)

/** The fenced blocks of `kind` in a spec's markdown, each joined with LF. */
const frontTestBlocks = (md: string, kind: string): string[] => {
  const out: string[] = []
  let block: string[] | null = null
  for (const line of split(replaceAll(md, "\r\n", "\n"), "\n")) {
    if (block === null) {
      if (line === `~~~ ${kind}`) {
        const fresh: string[] = []
        block = fresh
      }
    } else if (line === "~~~") {
      out.push(block.join("\n"))
      block = null
    } else {
      block.push(line)
    }
  }
  return out
}

/** Every ts-interface and ts-property block of a spec rebuilds its committed contract. */
const frontTestParity = (t: Suite, name: string): void => {
  const md = readFileSyncOrNull(`specs/${name}.md`)
  const json = readFileSyncOrNull(`contracts/${name}.json`)
  if (md === null || json === null) {
    t.fail(name, "the spec or its contract cannot be read")
    return
  }
  const parsed = contractParse(json, name)
  if (parsed.isErr()) {
    t.fail(name, parsed.error.join("\n"))
    return
  }
  const c = parsed.value
  const ifaces = frontTestBlocks(md, "ts-interface")
  t.ok(`${name}: one ts-interface`, ifaces.length === 1)
  if (ifaces.length !== 1) {
    return
  }
  const iface = frontParseInterface(ifaces[0])
  if (iface.isErr()) {
    t.fail(`${name}: ts-interface`, frontTestRefusal(iface.error))
    return
  }
  t.eqStr(`${name}: module`, iface.value.module, c.target.module)
  const sigs: string[] = []
  for (const f of c.functions) {
    sigs.push(frontTestSig(f))
  }
  const got: string[] = []
  for (const f of iface.value.functions) {
    got.push(frontTestSig(f))
  }
  t.eqLines(`${name}: functions`, got, sigs)
  c.functions = iface.value.functions
  let want = 0
  for (const k of c.clauses) {
    if (k.forall.length > 0) {
      want = want + 1
    }
  }
  const props = frontTestBlocks(md, "ts-property")
  t.ok(`${name}: ${props.length} ts-property blocks`, props.length > 0)
  let replaced = 0
  for (const text of props) {
    const r = frontParseProperty(text, iface.value.functions)
    if (r.isErr()) {
      t.fail(`${name}: ts-property`, `${frontTestRefusal(r.error)}\n${text}`)
      continue
    }
    const p: FrontProperty = r.value
    for (let k = 0; k < c.clauses.length; k++) {
      if (c.clauses[k].id === p.id) {
        p.clause.samples = c.clauses[k].samples
        c.clauses[k] = p.clause
        replaced = replaced + 1
      }
    }
  }
  t.ok(`${name}: every block names a clause of the contract`, replaced === props.length)
  t.ok(`${name}: every property clause has a block`, replaced === want)
  t.eqLines(`${name}: the contract writes back from the blocks`, split(contractWrite(c), "\n"), split(json, "\n"))
}

const frontTestInterface = (t: Suite): void => {
  const hex = frontParseInterface(
    "// module: nish/hex\nexport function hexEncode(bytes: u8[]): string;\nexport const hexDecode = (text: string): u8[] | null;\n",
  )
  t.eqStr(
    "ts-interface: the hex interface",
    hex.isOk() ? frontTestIface(hex.value) : frontTestRefusal(hex.error),
    "nish/hex | hexEncode(bytes: bytes): string; hexDecode(text: string): bytes? | 2,3",
  )
  const all = frontParseInterface(
    "//   module:   nish/crypto/x\n// a comment line\nexport function a(p: u8[], q: null | u8[], r: string, s: string | null): i32;\nexport const b = (p: u32, q: boolean, k: Secret<u8[]>,): Secret<u8[]> | null /* trailing */\nexport function c(): null | string // trailing\nexport function d(): Secret<u8[]>\nexport const e = (): u8[] | null",
  )
  t.eqStr(
    "ts-interface: every type, either null order, comments and blank lines",
    all.isOk() ? frontTestIface(all.value) : frontTestRefusal(all.error),
    "nish/crypto/x | a(p: bytes, q: bytes?, r: string, s: string?): i32; b(p: u32, q: bool, k: secret-bytes): secret-bytes?; c(): string?; d(): secret-bytes; e(): bytes? | 3,4,5,6,7",
  )
  const words = frontParseInterface(
    "// module: nish/w\nexport function w(a: u16[], b: u16[] | null, c: null | u64[]): u64[] | null\nexport const x = (a: u32[]): u16[]\n",
  )
  t.eqStr(
    "ts-interface: the word arrays, either null order",
    words.isOk() ? frontTestIface(words.value) : frontTestRefusal(words.error),
    "nish/w | w(a: words16, b: words16?, c: words64?): words64?; x(a: words32): words16 | 2,3",
  )
  const lf = "// module: nish/m\n// c\nexport function f(a: u8[]): i32\n"
  const want = frontParseInterface(lf)
  const crlf = frontParseInterface(replaceAll(lf, "\n", "\r\n"))
  const cr = frontParseInterface(replaceAll(lf, "\n", "\r"))
  if (want.isOk() && crlf.isOk() && cr.isOk()) {
    t.eqStr("ts-interface: CRLF reads as LF", frontTestIface(crlf.value), frontTestIface(want.value))
    t.eqStr("ts-interface: CR reads as LF", frontTestIface(cr.value), frontTestIface(want.value))
  } else {
    t.fail("ts-interface: CRLF and CR read as LF", "refused")
  }
  const cases: string[][] = [
    ["export function f(a: u8[], a: i32): i32", "`f` has two parameters named `a`", "a: i32"],
    ["export function f(): i32\nexport const f = (): i32", "`f` is declared twice", "f = ("],
    ["export function f(a: number): i32", `\`number\` is not a ts-interface type; use ${FRONT_TEST_TYPES}`, "number"],
    [
      "export function f(): null | number",
      `\`number | null\` is not a ts-interface type; use ${FRONT_TEST_TYPES}`,
      "null |",
    ],
    ["export const f = (a: i32): i32 => a", "a ts-interface declares signatures only; remove the body of `f`", "=>"],
    [
      "export function f(a: i32): i32 { return a; }",
      "a ts-interface declares signatures only; remove the body of `f`",
      "{",
    ],
    ["function f(): i32", "expected `export`, got `function`", "function"],
    ["export let f = 1", "expected `function`, got `let`", "let"],
    ["export function (): i32", "expected a function name, got `(`", "("],
    ["export function f(a: ): i32", "expected a type, got `)`", "): i32"],
    ["export function f(a: i32", "expected `)`, got end of block", ""],
    ["", "a ts-interface declares at least one function", ""],
    ["// only a comment\n", "a ts-interface declares at least one function", ""],
    ["export function xor(a: u8[]): u8[]", "`xor` is a ts-property op; give the function another name", "xor"],
    [
      "export const concat = (a: string): string",
      "`concat` is a ts-property op; give the function another name",
      "concat",
    ],
  ]
  for (const k of cases) {
    const text = `// module: nish/m\n${k[0]}`
    const r = frontParseInterface(text)
    t.eqStr(
      `ts-interface: ${k[1]}`,
      r.isErr() ? frontTestRefusal(r.error) : "accepted",
      `${k[1]} @${frontTestPosOf(text, k[2])}`,
    )
  }
  const missing = "missing `// module: <root>/<path>` first line"
  const modules: string[][] = [
    ["", `${missing} @1:1`],
    ["\n  export function f(): i32", `${missing} @2:3`],
    ["\n// module: nish/m\nexport function f(): i32", `${missing} @2:1`],
    ["/* module: nish/m */", `${missing} @1:1`],
    [
      "// module: Crypto/hex",
      "`Crypto/hex` is not a module path; write <root>/<path>, lowercase segments split by / @1:1",
    ],
  ]
  for (const k of modules) {
    const r = frontParseInterface(k[0])
    t.eqStr(`ts-interface: the module line ${k[1]}`, r.isErr() ? frontTestRefusal(r.error) : "accepted", k[1])
  }
}

const frontTestReads = (t: Suite): void => {
  for (const s of ["ts-interface", "ts-property", "ts-whatever"]) {
    t.eqBool(`frontReads ${s}`, frontReads(s), true)
  }
  for (const s of ["rust-interface", "ts", "-ts", "constructor-x", ""]) {
    t.eqBool(`frontReads "${s}"`, frontReads(s), false)
  }
}

const frontTestCovers = (t: Suite, fns: FnSig[]): void => {
  const r = frontParseProperty(
    '// P-1.a_b covers R-1,R-2 ,  R-3 — a title — with a dash\nforall (\n  b: u8[] /* 1..4096 */, // a comment\n  i: i32 /* -2147483648..2147483647 */,\n  t: string /* 0..2 ascii-printable space */,\n  s: string /*\n    3..3 "a\\t\\"b"\n  */\n) => true;',
    fns,
  )
  if (r.isErr()) {
    t.fail("ts-property: the covers line", frontTestRefusal(r.error))
    return
  }
  const p = r.value
  t.eqStr("ts-property: the id", p.id, "P-1.a_b")
  t.eqStr("ts-property: the title", p.title ?? "?", "a title — with a dash")
  t.eqStr("ts-property: the covers", p.covers.join("|"), "R-1|R-2|R-3")
  t.eqStr("ts-property: the clause id", p.clause.id, "P-1.a_b")
  const vars: string[] = []
  for (const x of p.clause.forall) {
    vars.push(frontTestForall(x))
  }
  t.eqLines("ts-property: forall and its bounds", vars, [
    "b: bytes len 1..4096",
    "i: i32 -2147483648..2147483647",
    "t: string len 0..2 [ascii-printable|space]",
    's: string len 3..3 [a|\t|"|b]',
  ])
  const assert = p.clause.assert
  t.eqStr("ts-property: the assert", assert === null ? "?" : frontTestExpr(assert), "true")
  t.ok("ts-property: no where", p.clause.where === null)
  const w = frontParseProperty(frontTestProp("true", " where true"), fns)
  const where: Expr | null = w.isOk() ? w.value.clause.where : null
  t.eqStr("ts-property: where", where === null ? "?" : frontTestExpr(where), "true")
}

const frontTestMappings = (t: Suite, fns: FnSig[]): void => {
  const cases: string[][] = [
    ["b.length === 0", "==(len(b), 0)"],
    ["t.length !== 0", "!=(strLen(t), 0)"],
    ["hexDecode(t) === null", "isNull(@hexDecode(t))"],
    ["null == hexDecode(t)", "isNull(@hexDecode(t))"],
    ["hexDecode(t) !== null", "notNull(@hexDecode(t))"],
    ["hexDecode(t) != null", "notNull(@hexDecode(t))"],
    ["b.concat(b) == b", "==(concat(b, b), b)"],
    ["b.slice(0, 2) != b", "!=(slice(b, 0, 2), b)"],
    ["t.toLowerCase() === t.toUpperCase()", "==(lower(t), upper(t))"],
    ["t.charAt(i) === t", "==(charAt(t, i), t)"],
    ['t + t + "x" === t', '==(strConcat(strConcat(t, t), "x"), t)'],
    ["i + 1 - 2 * i % 3 === -5", "==(-(+(i, 1), %(*(2, i), 3)), -5)"],
    ["(i < 1) == (i <= 1)", "==(<(i, 1), <=(i, 1))"],
    ["i > 1 || i >= 2", "or(>(i, 1), >=(i, 2))"],
    ["true && !false && true || false", "or(and(true, not(false), true), false)"],
    ["implies(i > 0, i >= 0)", "implies(>(i, 0), >=(i, 0))"],
    ["xor(b, bitAnd(b, bitOr(b, b))) === b", "==(xor(b, bitAnd(b, bitOr(b, b))), b)"],
    ["fill(1, 2) === zeros(3)", "==(fill(1, 2), zeros(3))"],
    ["flipBit(b, 0) === le64(i)", "==(flipBit(b, 0), le64(i))"],
    ["ascii(utf8(t)) !== null", "notNull(ascii(utf8(t)))"],
    ["concat(b, b) === b", "==(concat(b, b), b)"],
    ['concat("a", b) === b.concat(b)', '==(concat(ascii"a", b), concat(b, b))'],
    ['"ab".concat("cd") === t.concat(t)', '==(strConcat("ab", "cd"), strConcat(t, t))'],
    ['flipBit("a", 0) === xor("a", b)', '==(flipBit(ascii"a", 0), xor(ascii"a", b))'],
    ['hexDecode("0a") === [0a]', '==(@hexDecode("0a"), [0a])'],
    ["unwrap(hexDecode(t)) === [] && [00 0f f0 ff] !== b", "and(==(unwrap(@hexDecode(t)), []), !=([000ff0ff], b))"],
    ["seal(b, 7) === null", "isNull(@seal(b, 7))"],
    ['"a\\tb" === t', '==("a\tb", t)'],
    ["{ return true; }", "true"],
    ["{ const x = i; const y = x + 1; return y > x }", "let(x = i, y = +(x, 1); >(y, x))"],
    ["/* why */ true // because", "true"],
  ]
  for (const k of cases) {
    frontTestAssert(t, fns, k[0], k[1])
  }
  const scoped = frontTestProp("{ const x = 1; return x > 0; }", " where x > 0")
  frontTestRefuses(t, fns, scoped, "unknown identifier `x`", "x > 0")
  const lf = frontTestProp("{\n  const n = b.length;\n  return n >= 0;\n}", "")
  const a = frontParseProperty(lf, fns)
  const b = frontParseProperty(replaceAll(lf, "\n", "\r\n"), fns)
  const ea: Expr | null = a.isOk() ? a.value.clause.assert : null
  const eb: Expr | null = b.isOk() ? b.value.clause.assert : null
  t.eqStr(
    "ts-property: CRLF reads as LF",
    eb === null ? "refused" : frontTestExpr(eb),
    ea === null ? "refused?" : frontTestExpr(ea),
  )
  const chain = frontParseProperty(frontTestProp(frontTestRepeat("i > 0", 1000, " && "), ""), fns)
  const ec: Expr | null = chain.isOk() ? chain.value.clause.assert : null
  t.ok("ts-property: a long && chain is not nesting", ec !== null && ec.name === "and" && ec.args.length === 1000)
}

const frontTestRefusals = (t: Suite, fns: FnSig[]): void => {
  const h = "// P-X covers R-X — t\n"
  const covers = "missing `// P-ID covers R-ID — title` line"
  const title = "missing title: end the covers line with ` — <title>`"
  const cases: string[][] = [
    ["forall (b: u8[] /* 0..1 */) => true", covers, "forall"],
    ["// P-X R-X — t\nforall () => true", covers, "// P-X"],
    ["/* P-X covers R-X — t */ forall () => true", covers, "/*"],
    ["// P-X covers R-X\nforall () => true", title, "// P-X"],
    ["// P-X covers R-X —  \nforall () => true", title, "// P-X"],
    ["// P!X covers R-X — t\nforall () => true", "`P!X` is not a clause or requirement id", "// P!X"],
    ["// P-X covers R X — t\nforall () => true", "`R X` is not a clause or requirement id", "// P-X"],
    [`${h}exists () => true`, "expected `forall`, got `exists`", "exists"],
    [`${h}forall (b: number /* 0..1 */) => true`, `\`number\` ${FRONT_TEST_FORALL}`, "number"],
    [`${h}forall (n: boolean /* 0..1 */) => true`, `\`boolean\` ${FRONT_TEST_FORALL}`, "boolean"],
    [
      `${h}forall (x: f64 /* 0..1 */) => true`,
      "properties over f64 are not sampled yet; give f64 cases as vectors",
      "f64",
    ],
    [
      `${h}forall (w: u16[] /* 0..1 */) => true`,
      "properties over u16[] are not sampled yet; give word-array cases as vectors",
      "u16[]",
    ],
    [
      `${h}forall (w: u32[] /* 0..1 */) => true`,
      "properties over u32[] are not sampled yet; give word-array cases as vectors",
      "u32[]",
    ],
    [
      `${h}forall (w: u64[] /* 0..1 */) => true`,
      "properties over u64[] are not sampled yet; give word-array cases as vectors",
      "u64[]",
    ],
    [`${h}forall (w: i32[] /* 0..1 */) => true`, `\`i32[]\` ${FRONT_TEST_FORALL}`, "i32[]"],
    [`${h}forall (b: u8[]) => true`, "`b` needs a bounds comment, like /* 0..64 */", ")"],
    [`${h}forall (b: u8[] // 0..1\n) => true`, "`b` needs a bounds comment, like /* 0..64 */", "// 0"],
    [`${h}forall (b: u8[] /* 64 */) => true`, "the bounds of `b` (u8[]) must read `lo..hi`, like /* 0..64 */", "/*"],
    [`${h}forall (b: u8[] /* 0..4 hexdigit */) => true`, "an alphabet applies only to string variables, not `b`", "/*"],
    [`${h}forall (i: i32 /* 0..1 "a" */) => true`, "an alphabet applies only to string variables, not `i`", "/*"],
    [
      `${h}forall (i: i32 /* 2..1 */) => true`,
      "the bounds of `i` (i32) must satisfy -2147483648 <= lo <= hi <= 2147483647",
      "/*",
    ],
    [
      `${h}forall (i: i32 /* 0..2147483648 */) => true`,
      "the bounds of `i` (i32) must satisfy -2147483648 <= lo <= hi <= 2147483647",
      "/*",
    ],
    [`${h}forall (a: u8 /* 0..256 */) => true`, "the bounds of `a` (u8) must satisfy 0 <= lo <= hi <= 255", "/*"],
    [
      `${h}forall (b: u8[] /* 0..4097 */) => true`,
      "the length bounds of `b` (u8[]) must satisfy 0 <= lo <= hi <= 4096",
      "/*",
    ],
    [
      `${h}forall (s: string /* -1..2 digit */) => true`,
      "the length bounds of `s` (string) must satisfy 0 <= lo <= hi <= 4096",
      "/*",
    ],
    [
      `${h}forall (s: string /* 0..2 */) => true`,
      "`s` needs an alphabet after its bounds: class names (hexdigit, HEXDIGIT, digit, alpha, space, ascii-printable) or a JSON string",
      "/*",
    ],
    [
      `${h}forall (s: string /* 0..2 hex */) => true`,
      "unknown alphabet class `hex`; use hexdigit, HEXDIGIT, digit, alpha, space, ascii-printable or a JSON string",
      "/*",
    ],
    [`${h}forall (s: string /* 0..2 "ab" "c" */) => true`, "the alphabet must be one JSON string", "/*"],
    [`${h}forall (s: string /* 0..2 "" */) => true`, "the alphabet is empty", "/*"],
    [`${h}forall (s: string /* 0..2 "é" */) => true`, "the alphabet holds only printable ASCII, tab, LF and CR", "/*"],
    [`${h}forall (b: u8[] /* 0..1 */, b: u8[] /* 0..1 */) => true`, "`b` is bound twice", "b: u8[] /* 0..1 */)"],
    [`${h}forall (hexEncode: u8[] /* 0..1 */) => true`, "`hexEncode` names an interface function", "hexEncode"],
    [`${h}forall (b: u8[] /* 0..1 */) true`, "expected `=>`, got `true`", "true"],
    [frontTestProp("{ const b = 1; return true; }", ""), "`b` is bound twice", "b = 1"],
    [frontTestProp("{ const n = null; return true; }", ""), "`n` is a bare null, which has no type", "null"],
    [frontTestProp("{ let n = 1; return true; }", ""), "`let` is not in the ts-property subset", "let"],
    [frontTestProp("{ if (true) return true; }", ""), "`if` is not in the ts-property subset", "if"],
    [frontTestProp("{ 1 }", ""), "expected `const` or `return`, got `1`", "1 }"],
    [frontTestProp("{ return true; false }", ""), "expected `}`, got `false`", "false"],
    [frontTestProp("b.length", ""), "the property must be boolean, got i32", "b.length"],
    [frontTestProp("true", " where t"), "`where` must be boolean, got string", "t"],
    [
      frontTestProp("true", " where hexEncode(b) === t"),
      "`where` may not call `hexEncode`: the domain must not depend on the implementation",
      "hexEncode",
    ],
    [frontTestProp("true false", ""), "unexpected `false`", "false"],
    [frontTestProp("(", ""), "unexpected end of block", ""],
    [frontTestProp(")", ""), "unexpected `)`", ")"],
    [frontTestProp("i > 0 ==> i >= 0", ""), "`==>` is not in the ts-property subset; use implies(a, b)", "==>"],
    [frontTestProp("i / 2 === 0", ""), "`/` is not in the ts-property subset", "/ 2"],
    [frontTestProp("i > 0 ? true : false", ""), "`?` is not in the ts-property subset", "?"],
    [frontTestProp("(x) => true", ""), "unknown identifier `x`", "x)"],
    [frontTestProp("b?.length === 0", ""), "`?.` is not in the ts-property subset", "?."],
    [frontTestProp("/ 2", ""), "`/` is not in the ts-property subset", "/ 2"],
    [frontTestProp("~i === 0", ""), "`~` is not in the ts-property subset", "~"],
    [frontTestProp("-i === 0", ""), "unary `-` applies only to integer literals; write 0 - x", "-i"],
    [frontTestProp("i === 3000000000", ""), "3000000000 is outside i32", "3000000000"],
    [frontTestProp("i === -2147483649", ""), "-2147483649 is outside i32", "-2147483649"],
    [
      frontTestProp("i === 18446744073709551616", ""),
      "`18446744073709551616` is outside every integer type (-9223372036854775808..18446744073709551615)",
      "18446744073709551616",
    ],
    [
      frontTestProp("i === -9223372036854775809", ""),
      "`-9223372036854775809` is outside every integer type (-9223372036854775808..18446744073709551615)",
      "-9223372036854775809",
    ],
    [frontTestProp("b[0] === 0", ""), "indexing is not in the ts-property subset; use slice or charAt", "[0]"],
    [frontTestProp("[0] === b", ""), FRONT_TEST_BYTES, "[0]"],
    [frontTestProp("[b] === b", ""), FRONT_TEST_BYTES, "[b]"],
    [frontTestProp("[0A] === b", ""), FRONT_TEST_BYTES, "[0A]"],
    [frontTestProp("b.map(f) === b", ""), "`.map` is not in the ts-property subset", "map"],
    [frontTestProp("b.byteLength === 0", ""), "`.byteLength` is not in the ts-property subset", "byteLength"],
    [frontTestProp("b.slice(1) === b", ""), "`.slice` takes 2 argument(s), got 1", "(1)"],
    [frontTestProp("b.1", ""), "expected a property name, got `1`", "1"],
    [frontTestProp("y === 0", ""), "unknown identifier `y`", "y"],
    [frontTestProp("foo(b)", ""), "unknown function `foo`", "foo"],
    [frontTestProp("b(1)", ""), "`b` is not a function", "b(1)"],
    [frontTestProp("hexEncode(b, b) === t", ""), "`hexEncode` takes 1 argument(s), got 2", "hexEncode"],
    [frontTestProp("hexEncode(t) === t", ""), "`hexEncode` expects u8[], got string", "t) ==="],
    [frontTestProp("hexEncode(hexDecode(t)) === t", ""), "`hexEncode` expects u8[], got u8[] | null", "hexDecode"],
    [frontTestProp("xor(b) === b", ""), "`xor` takes 2 argument(s), got 1", "xor"],
    [frontTestProp("b.length + true === 1", ""), "`+` wants i32, got boolean", "true"],
    [frontTestProp("t + 1 === t", ""), "`+` wants string, got i32", "1 ==="],
    [frontTestProp("b === 1", ""), "cannot compare u8[] with i32", "b === 1"],
    [frontTestProp("b === null", ""), "`=== null` wants an optional (T?), got u8[]", "b === null"],
    [frontTestProp("null === null", ""), "cannot compare null with null", "null === null"],
    [frontTestProp("!1", ""), "`!` wants boolean, got i32", "1"],
    [frontTestProp("true && 1", ""), "`&&` wants boolean, got i32", "1"],
    [frontTestProp("(1).length === 1", ""), "`.length` wants u8[], got i32", "(1)"],
    [frontTestProp("t.slice(0, 1) === t", ""), "`.slice` wants u8[], got string", "t.slice"],
    [frontTestProp("i < t", ""), "`<` wants i32, got string", "t"],
    [frontTestProp("i * t === 1", ""), "`*` wants i32, got string", "t ==="],
    [frontTestProp("t === 'a'", ""), "`'` strings are not in the ts-property subset; use double quotes", "'a'"],
    [frontTestProp("t === `a`", ""), "``` strings are not in the ts-property subset; use double quotes", "`a`"],
    [frontTestProp("i === 0x10", ""), "`0x10` is not in the ts-property subset; write integers in decimal", "0x10"],
    [frontTestProp("i === 007", ""), "`007` is not in the ts-property subset; write integers in decimal", "007"],
    [frontTestProp('t === "a', ""), "malformed string literal", '"a'],
    [frontTestProp('t === "\\q"', ""), "malformed string literal", '"\\q'],
    [frontTestProp('t === "\\u00e9"', ""), "a string literal holds only printable ASCII, tab, LF and CR", '"\\u'],
    [frontTestProp("b ‖ b", ""), "`‖` is not in the ts-property subset", "‖"],
    [frontTestProp("$ === 0", ""), "`$` is not in the ts-property subset", "$"],
    [frontTestProp("true /* open", ""), "unterminated `/*` comment", "/* open"],
    [frontTestProp('b === "ab"', ""), "cannot compare u8[] with string", "b ==="],
    [frontTestProp('"ab" !== b', ""), "cannot compare string with u8[]", '"ab" !=='],
    [frontTestProp('hexEncode("a") === "61"', ""), "`hexEncode` expects u8[], got string", '"a"'],
    [frontTestProp('b.concat("cd") === b', ""), "`.concat` wants u8[], got string", '"cd"'],
    [frontTestProp('"ab".concat(b) === t', ""), "`.concat` wants string, got u8[]", "b)"],
    [frontTestProp("b.slice(-2, 5) === b", ""), FRONT_TEST_SLICE, "-2"],
    [frontTestProp("b.slice(0, -1) === b", ""), FRONT_TEST_SLICE, "-1"],
    [frontTestProp("i % 0 === 0", ""), "`% 0` is NaN in TypeScript and 0 in the contract", "0 ==="],
  ]
  for (const k of cases) {
    frontTestRefuses(t, fns, k[0], k[1], k[2])
  }
  const parens = frontTestProp(`${frontTestRepeat("(", 65, "")}true${frontTestRepeat(")", 65, "")}`, "")
  frontTestRefusesAs(t, fns, "nesting: parens", parens, FRONT_TEST_DEPTH, "(true")
  const sum = `${frontTestRepeat("i", 70, " + ")} > 0`
  frontTestRefusesAs(t, fns, "nesting: a sum", frontTestProp(sum, ""), FRONT_TEST_DEPTH, sum)
  const nots = frontTestProp(`${frontTestRepeat("!", 70, "")}true`, "")
  frontTestRefusesAs(t, fns, "nesting: nots", nots, FRONT_TEST_DEPTH, `${frontTestRepeat("!", 6, "")}true`)
  const calls = frontTestProp(`${frontTestRepeat("b.concat(", 70, "")}b${frontTestRepeat(")", 70, "")} === b`, "")
  frontTestRefusesAs(t, fns, "nesting: calls", calls, FRONT_TEST_DEPTH, `${frontTestRepeat("b.concat(", 6, "")}b)`)

  const withXor = frontTestFns([])
  for (const f of fns) {
    withXor.push(f)
  }
  const xor = new FnSig()
  xor.name = "xor"
  xor.returns = "bytes"
  withXor.push(xor)
  frontTestRefuses(
    t,
    withXor,
    frontTestProp("xor(b, b) === b", ""),
    "`xor` is both an interface function and a ts-property op",
    "xor",
  )
  const second = frontParseProperty(`\n${frontTestProp("true", "")}`, fns)
  t.eqStr(
    "ts-property: the covers line is the first line",
    second.isErr() ? frontTestRefusal(second.error) : "accepted",
    `${covers} @2:1`,
  )
}

/** The ts-interface and ts-property front end, against the old cases and the committed contracts. */
export const main = (): i32 => {
  const t = new Suite("spec/extract front")
  const hexText = readFileSyncOrNull("contracts/example-hex.json")
  if (hexText === null) {
    t.fail("contracts/example-hex.json", "cannot be read")
    return t.done()
  }
  const hex = contractParse(hexText, "example-hex")
  if (hex.isErr()) {
    t.fail("contracts/example-hex.json", hex.error.join("\n"))
    return t.done()
  }
  const fns = frontTestFns(hex.value.functions)
  frontTestInterface(t)
  frontTestReads(t)
  frontTestCovers(t, fns)
  frontTestMappings(t, fns)
  frontTestRefusals(t, fns)
  for (const name of ["example-hex", "rfc5869-hkdf-sha256", "rfc8439-chacha20-poly1305"]) {
    frontTestParity(t, name)
  }
  return t.done()
}
