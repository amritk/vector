import { Suite } from "nish/testing"
import { lexStatements, lexTokens } from "../../../src/spec/pr/lex"

/** Each statement's text, joined by "|", or the error. */
const lexleadStatements = (text: string): string => {
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

/**
 * A `:` that opens a module has no token before it: lexStatements reads it as
 * an annotation and splits on as before, where it read past the start.
 */
export const main = (): i32 => {
  const t = new Suite("spec/pr lex: a leading colon")
  t.eqStr("a module that opens with :", lexleadStatements(": x\nlet a = 1"), ": x|let a = 1")
  t.eqStr("a lone :", lexleadStatements(":"), ":")
  t.eqStr("a : after a token still splits", lexleadStatements("a: x\nlet a = 1"), "a: x|let a = 1")
  return t.done()
}
