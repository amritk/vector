import { Suite } from "nish/testing"
import { lexTokens } from "../../../src/spec/pr/lex"

/** Each token's text, joined by spaces, or the error. */
const lexguardTokens = (text: string): string => {
  const r = lexTokens(text)
  if (r.isErr()) {
    return `ERR ${r.error}`
  }
  const out: string[] = []
  for (const t of r.value) {
    out.push(t.text)
  }
  return out.join(" ")
}

/**
 * A number's exponent sign is part of it unless the number is hexadecimal,
 * which takes both a leading `0` and an `x` after it.
 *
 * @returns the suite's exit status
 */
export const main = (): i32 => {
  const t = new Suite("spec/pr lex number guards")
  t.eqStr("a decimal exponent keeps its sign", lexguardTokens("0.5e-3"), "0.5e-3")
  t.eqStr("a leading 0 alone is not hexadecimal", lexguardTokens("0e+1"), "0e+1")
  t.eqStr("an x after another digit is not hexadecimal", lexguardTokens("1xe+2"), "1xe+2")
  t.eqStr("a hexadecimal e is a digit, not an exponent", lexguardTokens("0xe+2"), "0xe + 2")
  return t.done()
}
