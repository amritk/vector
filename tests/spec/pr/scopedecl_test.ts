import { Suite } from "nish/testing"
import { scopeOwners, scopeReach } from "../../../src/spec/pr/scope"

/** The owners of line `line` of `text` when no function is a root, joined by commas. */
const scopedeclOwners = (text: string, line: i32): string => scopeOwners(scopeReach(text, []), line).join(",")

/**
 * A declarator is a name: a top-level comma that a non-name follows declares
 * nothing, even when a `,`, `=` or `;` comes after it.
 *
 * @returns the suite's exit status
 */
export const main = (): i32 => {
  const t = new Suite("spec/pr scope declarators")
  t.eqStr("a number after a comma names nothing", scopedeclOwners("const a = [1], 2, b = 3\n", 1), "a,b")
  t.eqStr("a string after a comma names nothing", scopedeclOwners('let a = 1, "s";\n', 1), "a")
  t.eqStr("a name after a comma is named", scopedeclOwners("var a = 1, b;\n", 1), "a,b")
  return t.done()
}
