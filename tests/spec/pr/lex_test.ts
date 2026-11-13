import { Suite } from "nish/testing"
import {
  LEX_IDENT,
  LEX_NUMBER,
  LEX_PUNCT,
  LEX_STRING,
  LEX_TEMPLATE,
  LexToken,
  lexEnds,
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

export const main = (): i32 => {
  const t = new Suite("spec/pr lex")
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
  return t.done()
}
