import { Suite } from "nish/testing"
import { splitLines } from "nish/text"
import { mutateCode, mutateLine } from "../../../src/spec/pr/mutate"

/** The ids of the mutants of line `line` (from 1) of `text`, joined by spaces, or the error. */
const mutateguardIds = (text: string, line: i32): string => {
  const kinds = mutateCode(text)
  if (kinds.isErr()) {
    return `ERR ${kinds.error}`
  }
  const lines = splitLines(text)
  const out: string[] = []
  for (const m of mutateLine(lines[line - 1], line, kinds.value[line - 1])) {
    out.push(m.id)
  }
  return out.join(" ")
}

/** The kinds of line `line` (from 1) of `text`, one digit each, or the error. */
const mutateguardKinds = (text: string, line: i32): string => {
  const kinds = mutateCode(text)
  if (kinds.isErr()) {
    return `ERR ${kinds.error}`
  }
  const out: string[] = []
  for (const k of kinds.value[line - 1]) {
    out.push(`${k}`)
  }
  return out.join("")
}

/**
 * The bounds at a line's ends: an operator one character in, an operator
 * before a trailing space, a `| null` that ends the line, and a comment that
 * ends the module.
 *
 * @returns the suite's exit status
 */
export const main = (): i32 => {
  const t = new Suite("spec/pr mutate line-end guards")
  t.eqStr("an operator one character into the line is spaced", mutateguardIds("const x = a\n && b\n", 2), "2:2:logical")
  t.eqStr(
    "an operator before a trailing space is spaced",
    mutateguardIds("const x = a + \n  b\n", 1),
    "1:13:arithmetic",
  )
  t.eqStr("a | null that ends the line is a type", mutateguardIds("let a: T | null", 1), "")
  t.eqStr("a comment that ends the module is marked", mutateguardKinds("a // c", 1), "1033330")
  return t.done()
}
