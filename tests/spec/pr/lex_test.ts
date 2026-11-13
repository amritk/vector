import { Suite } from "nish/testing"
import {
  LEX_IDENT,
  LEX_NUMBER,
  LEX_PUNCT,
  LEX_STRING,
  LEX_TEMPLATE,
  LexToken,
  lexEnds,
  lexInfix,
  lexNoEnd,
  lexStatements,
  lexTokens,
} from "../../../src/spec/pr/lex"

/** Each token as `text@depth`, joined by spaces, or the error. */
const lexTestTokens = (text: string): string => {
  const r = lexTokens(text)
  if (r.isErr()) {
    return `ERR ${r.error}`
  }
  const out: string[] = []
  for (const t of r.value) {
    out.push(`${t.text}@${t.depth}`)
  }
  return out.join(" ")
}

/** Each statement's text, joined by "|", or the error. */
const lexTestStatements = (text: string): string => {
  const r = lexTokens(text)
  if (r.isErr()) {
    return `ERR ${r.error}`
  }
  const out: string[] = []
  for (const s of lexStatements(r.value)) {
    out.push(text.substring(r.value[s.from].start, r.value[s.to - 1].end))
  }
  return out.join("|")
}

/** The kind of each token, as a letter, or the error. */
const lexTestKinds = (text: string): string => {
  const r = lexTokens(text)
  if (r.isErr()) {
    return `ERR ${r.error}`
  }
  let out = ""
  for (const t of r.value) {
    const k = t.kind
    out =
      out + (k === LEX_IDENT ? "i" : k === LEX_NUMBER ? "n" : k === LEX_STRING ? "s" : k === LEX_TEMPLATE ? "t" : "p")
  }
  return out
}

/**
 * Every reserved and infix word as a member name, generated: before `/`
 * after `.` and `?.`, at a line's end, and before `as`; each must lex and
 * split as the member it is.
 */
const lexTestMembers = (t: Suite): void => {
  const words: string[] = []
  for (const w of lexNoEnd()) {
    words.push(w)
  }
  for (const w of lexInfix()) {
    words.push(w)
  }
  for (const w of words) {
    t.eqStr(
      `o.${w} / 2 divides`,
      lexTestStatements(`export const a = o.${w} / 2\nconst b = o?.${w} / 2\n`),
      `export const a = o.${w} / 2|const b = o?.${w} / 2`,
    )
    t.eqStr(
      `o.${w} ends a line`,
      lexTestStatements(`export const a = o.${w}\nconst b = 1\nexport const c = p?.${w}\n[1].f()\n`),
      `export const a = o.${w}|const b = 1|export const c = p?.${w}\n[1].f()`,
    )
    t.eqStr(
      `o.${w} as T is a cast`,
      lexTestStatements(`export const a = o.${w} as T\nconst b = 1\n`),
      `export const a = o.${w} as T|const b = 1`,
    )
  }
  const pins = [
    ["a union continues", "export type R = A<B>\n| C\nconst h = 1\n", "export type R = A<B>\n| C|const h = 1"],
    [
      "an annotation's = continues",
      "export const m: Map<K,V>\n= new Map()\nconst h = 1\n",
      "export const m: Map<K,V>\n= new Map()|const h = 1",
    ],
    ["a call's type arguments", "export const y = f<T>\n(x)\nconst h = 1\n", "export const y = f<T>\n(x)|const h = 1"],
    [
      "an arrow after a return type",
      "export const g = (): Promise<T> =>\n x\nconst h = 1\n",
      "export const g = (): Promise<T> =>\n x|const h = 1",
    ],
    [
      "a / after a cast's closing > divides",
      "export const z = q as Y<Z>\n/ 2\nconst h = 1\n",
      "export const z = q as Y<Z>\n/ 2|const h = 1",
    ],
    ["nested closes", "export type S = A<B<C<D>>>\nconst h = 1\n", "export type S = A<B<C<D>>>|const h = 1"],
    ["an unsigned shift", "export const s = a >>> 2\nconst h = 1\n", "export const s = a >>> 2|const h = 1"],
    [
      "a conditional type across lines",
      "export type K<T> = T extends A\n ? B\n : C\nconst h = 1\n",
      "export type K<T> = T extends A\n ? B\n : C|const h = 1",
    ],
    [
      "a type predicate's is on its own line",
      "export const isA = (x: X): x\n  is A => {\n  return x\n}\nconst h = 1\n",
      "export const isA = (x: X): x\n  is A => {\n  return x\n}|const h = 1",
    ],
    ["2 * from ends at the line", "export const w = 2 * from\nconst h = 1\n", "export const w = 2 * from|const h = 1"],
    ["export * as", 'export * as ns from "m"\nconst h = 1\n', 'export * as ns from "m"|const h = 1'],
  ]
  for (const p of pins) {
    t.eqStr(p[0], lexTestStatements(p[1]), p[2])
  }
  t.ok("the generated words include default and from", words.indexOf("default") >= 0 && words.indexOf("from") >= 0)
}

export const main = (): i32 => {
  const t = new Suite("spec/pr lex")
  lexTestMembers(t)
  t.eqStr("kinds", lexTestKinds("a = 1 + 'x' + `y`"), "ipnpspt")
  t.eqStr("a bracket's depth is the depth outside it", lexTestTokens("f(a, [b])"), "f@0 (@0 a@1 ,@1 [@1 b@2 ]@1 )@0")
  t.eqStr(
    "a template's substitution is a bracket",
    lexTestTokens("`a${x, `b${y}`}c`"),
    "`a${@0 x@1 ,@1 `b${@1 y@2 }`@1 }c`@0",
  )
  t.eqStr("a comma in a string is not a token", lexTestTokens('"a, b"'), '"a, b"@0')
  t.eqStr("comments are skipped", lexTestTokens("a // b, c\n/* d, e */ f"), "a@0 f@0")
  t.eqStr("angle brackets are tokens of their own", lexTestTokens("a<<b>>=c"), "a@0 <@0 <@0 b@0 >@0 >@0 =@0 c@0")
  t.eqStr("long punctuation", lexTestTokens("a => b === c ?. d ... e"), "a@0 =>@0 b@0 ===@0 c@0 ?.@0 d@0 ...@0 e@0")
  t.eqStr("a number with an exponent", lexTestTokens("1e-5 + 0x1f"), "1e-5@0 +@0 0x1f@0")
  t.eqStr("a slash after a value divides", lexTestTokens("(a) / b / 2"), "(@0 a@1 )@0 /@0 b@0 /@0 2@0")
  t.eqStr(
    "a regular expression is refused",
    lexTestTokens("x = /,/"),
    "ERR line 1: a regular expression literal, which Nish does not have",
  )
  t.eqStr("an unclosed string is refused", lexTestTokens("a\n'b"), "ERR line 2: a string that never closes")
  t.eqStr(
    "an unclosed template is refused",
    lexTestTokens("`a${b}"),
    "ERR line 1: a template literal that never closes",
  )
  t.eqStr("an unclosed comment is refused", lexTestTokens("/* a"), "ERR line 1: a comment that never closes")
  t.eqStr("an unclosed bracket is refused", lexTestTokens("f(\n{"), "ERR line 2: a `{` that never closes")
  t.eqStr(
    "a closer that does not match is refused",
    lexTestTokens("f(\n]"),
    "ERR line 2: a `]` that does not close the `(` opened on line 1",
  )
  t.eqStr("a closer with nothing open is refused", lexTestTokens(")"), "ERR line 1: a `)` that closes nothing")
  const lines = lexTokens("a\n/* x\ny */ b")
  t.ok(
    "a token knows its line and the line break before it",
    lines.isOk() && lines.value.length === 2 && lines.value[1].line === 3 && lines.value[1].newline,
  )
  t.ok("nothing before ends nothing", !lexEnds(null))
  const ends = lexTokens("x (a) return [1] 1")
  t.ok(
    "what can end an expression",
    ends.isOk() &&
      lexEnds(ends.value[0]) &&
      !lexEnds(ends.value[1]) &&
      lexEnds(ends.value[3]) &&
      !lexEnds(ends.value[4]) &&
      lexEnds(ends.value[7]) &&
      lexEnds(ends.value[8]),
  )
  const tok: LexToken = new LexToken(LEX_PUNCT, "++", 0, 2, 1, 0, false)
  t.ok("a postfix ++ can end an expression", lexEnds(tok))
  t.eqStr("a ; ends a statement", lexTestStatements("a = 1; b = 2;"), "a = 1;|b = 2;")
  t.eqStr("an empty statement is dropped", lexTestStatements(";;a"), "a")
  t.eqStr("a line break ends a statement", lexTestStatements("a = 1\nb = 2"), "a = 1|b = 2")
  t.eqStr("a line break after an operator does not", lexTestStatements("a =\n1, b = 2"), "a =\n1, b = 2")
  t.eqStr("a comma on the next line goes on", lexTestStatements("a = 1\n,b = 2"), "a = 1\n,b = 2")
  t.eqStr("a bracket on the next line goes on", lexTestStatements("f\n(1)\n[0]"), "f\n(1)\n[0]")
  t.eqStr("a ++ on the next line starts a statement", lexTestStatements("a\n++b"), "a|++b")
  t.eqStr(
    "export starts a statement mid-line",
    lexTestStatements("f() {} export const g = 1"),
    "f() {}|export const g = 1",
  )
  t.eqStr("a member named export does not", lexTestStatements("a.export(1)"), "a.export(1)")
  t.eqStr(
    "an export inside braces does not",
    lexTestStatements("m {\n  export const a = 1\n}"),
    "m {\n  export const a = 1\n}",
  )
  t.eqStr("a column-0 line inside brackets goes on", lexTestStatements("f(\na,\nb)"), "f(\na,\nb)")
  const words = [
    "type",
    "from",
    "of",
    "as",
    "is",
    "satisfies",
    "keyof",
    "unique",
    "readonly",
    "infer",
    "asserts",
    "get",
    "set",
    "async",
    "declare",
    "namespace",
    "module",
    "abstract",
    "static",
    "override",
    "accessor",
    "out",
    "never",
    "any",
    "number",
    "string",
    "symbol",
    "object",
    "global",
    "require",
    "constructor",
    "private",
    "protected",
    "public",
    "package",
    "let",
    "yield",
    "await",
  ]
  for (const w of words) {
    if (w === "let" || w === "yield" || w === "await") {
      continue
    }
    t.eqStr(`${w} as a value divides`, lexTestTokens(`a = ${w} / 2`), `a@0 =@0 ${w}@0 /@0 2@0`)
    t.eqStr(
      `${w} as a value ends a line`,
      lexTestStatements(`const x = ${w}\nconst y = ${w} / 2`),
      `const x = ${w}|const y = ${w} / 2`,
    )
  }
  const enders = ["1", "'s'", "`t`", "f()", "a[0]", "{}", "i++", "i--", "true", "null", "this", "super.x"]
  for (const e of enders) {
    t.eqStr(`${e} ends a line`, lexTestStatements(`a = ${e}\nconst h = from / 2`), `a = ${e}|const h = from / 2`)
  }
  t.eqStr(
    "a type's closing > ends a statement",
    lexTestStatements("export type R = Result<A, B>\nconst helper = from / 2"),
    "export type R = Result<A, B>|const helper = from / 2",
  )
  t.eqStr(
    "a type's closing >> ends a statement",
    lexTestStatements("type R = A<B<C>>\nconst h = 1"),
    "type R = A<B<C>>|const h = 1",
  )
  t.eqStr(
    "an annotation's closing > ends a statement",
    lexTestStatements("const m: Map<K, V>\nconst h = 1"),
    "const m: Map<K, V>|const h = 1",
  )
  t.eqStr(
    "an as-type's closing > ends a statement",
    lexTestStatements("const m = x as Array<T>\nconst h = 1"),
    "const m = x as Array<T>|const h = 1",
  )
  t.eqStr("a comparison's > does not end one", lexTestStatements("a = b >\nc"), "a = b >\nc")
  t.eqStr(
    "a comparison after an annotation's = is a value",
    lexTestStatements("const a: T = b < c, d = e >\nf"),
    "const a: T = b < c, d = e >\nf",
  )
  t.eqStr(
    "a conditional's : is not an annotation",
    lexTestStatements("const a = b ? c : d < e, f = g >\nh"),
    "const a = b ? c : d < e, f = g >\nh",
  )
  t.eqStr("as between operands goes on", lexTestStatements("const a = x as\nFoo"), "const a = x as\nFoo")
  t.eqStr("keyof goes on", lexTestStatements("type K = keyof\nT"), "type K = keyof\nT")
  t.eqStr(
    "a function's return type closes at its body",
    lexTestStatements("const f = (): Array<T> => {\n}\nconst g = 1"),
    "const f = (): Array<T> => {\n}|const g = 1",
  )
  const tpl = lexTokens("`a\\\nb`\nx")
  t.ok("a template's escaped line break counts", tpl.isOk() && tpl.value[1].line === 3)
  const crlf = lexTokens("'a\\\r\nb'\r\nx")
  t.ok("a string's CRLF continuation reads", crlf.isOk() && crlf.value[1].line === 3)
  return t.done()
}
