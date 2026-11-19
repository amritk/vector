import { Suite } from "nish/testing"
import { splitLines } from "nish/text"
import { scopeIn, scopeOwners, scopeReach } from "../../../src/spec/pr/scope"

/**
 * Each line of `text` as `N+` when it lies in code the roots reach, or
 * `N-owner` when it does not; or `whole: <why>` when the scan mutates every
 * line.
 */
const scopeTestShow = (text: string, roots: string[]): string => {
  const m = scopeReach(text, roots)
  const out: string[] = []
  if (m.whole !== "") {
    out.push(`whole: ${m.whole}`)
  }
  const lines = splitLines(text)
  for (let i = 0; i < lines.length; i++) {
    const n = toI32(i) + 1
    if (lines[i] !== "") {
      out.push(scopeIn(m, n) ? `${n}+` : `${n}-${scopeOwners(m, n).join(",")}`)
    }
  }
  return out.join(" ")
}

/** One reachability row: a module, the contract's functions, what each line shows. */
class ScopeTestRow {
  name: string
  text: string
  roots: string[]
  want: string

  constructor(name: string, text: string, roots: string[], want: string) {
    this.name = name
    this.text = text
    this.roots = roots
    this.want = want
  }
}

/** The reachability table. */
const scopeTestRows = (): ScopeTestRow[] => [
  new ScopeTestRow(
    "a direct call reaches its callee",
    "export const f = (): i32 => g()\nconst g = (): i32 => 1\nconst h = (): i32 => 2\n",
    ["f"],
    "1+ 2+ 3-h",
  ),
  new ScopeTestRow(
    "a transitive call reaches the callee's callee",
    "export const f = (): i32 => g()\nconst g = (): i32 => h()\nconst h = (): i32 => 2\nconst z = (): i32 => 3\n",
    ["f"],
    "1+ 2+ 3+ 4-z",
  ),
  new ScopeTestRow(
    "a const reference reaches the const",
    "const K: i32 = 7\nconst L: i32 = 8\nexport const f = (): i32 => K\n",
    ["f"],
    "1+ 2-L 3+",
  ),
  new ScopeTestRow(
    "a type reference reaches the interface and the class",
    "interface P {\n  x: i32\n}\nclass Q {\n  y: i32\n}\ninterface R {\n  z: i32\n}\nexport const f = (p: P): Q => new Q()\n",
    ["f"],
    "1+ 2+ 3+ 4+ 5+ 6+ 7-R 8-R 9-R 10+",
  ),
  new ScopeTestRow(
    "a shadowing local of the same name still counts, so the scan mutates more",
    "export const f = (): i32 => {\n  const g = 1\n  return g\n}\nexport const g = (): i32 => 2\n",
    ["f"],
    "1+ 2+ 3+ 4+ 5+",
  ),
  new ScopeTestRow(
    "an out-of-scope export a tested function calls is reached",
    "export const f = (): i32 => helper()\nexport const helper = (): i32 => 1\n",
    ["f"],
    "1+ 2+",
  ),
  new ScopeTestRow(
    "an unreached out-of-scope export is not",
    "export const f = (): i32 => 1\nexport const other = (): i32 => 2\n",
    ["f"],
    "1+ 2-other",
  ),
  new ScopeTestRow(
    "a member of the same name is not a reference",
    "export const f = (p: Pt): i32 => p.g + (p?.h ?? 0)\nexport const g = (): i32 => 1\nexport const h = (): i32 => 2\n",
    ["f"],
    "1+ 2-g 3-h",
  ),
  new ScopeTestRow(
    "imports and export lists are not code",
    'import { x } from "./x"\nexport const f = (): i32 => x\nexport { f as g }\n',
    ["f"],
    "1-line 1 2+ 3-line 3",
  ),
  new ScopeTestRow(
    "top-level code runs at load, so it is reached, with what it names",
    "const g = (): i32 => 1\ng()\nexport const f = (): i32 => 2\n",
    [],
    "1+ 2+ 3-f",
  ),
  new ScopeTestRow(
    "a statement's span ends on the last line of its last token",
    "export const f = (): string => `a\nb\nc`\nexport const g = (): i32 => 1\n",
    ["f"],
    "1+ 2+ 3+ 4-g",
  ),
  new ScopeTestRow(
    "a declaration of several names is reached by any of them",
    "export const a = 1, b = 2\nexport const f = (): i32 => b\n",
    ["f"],
    "1+ 2+",
  ),
  new ScopeTestRow(
    "a declaration is named past declare, async and function's star",
    "export async function f(): i32 {\n  return g()\n}\nexport function* g(): i32 {\n  return 1\n}\ndeclare const h: i32\n",
    ["f"],
    "1+ 2+ 3+ 4+ 5+ 6+ 7-h",
  ),
  new ScopeTestRow(
    "every overload of a name is reached",
    "export function f(a: i32): i32\nexport function f(a: i32): i32 {\n  return a\n}\nexport function g(): i32 {\n  return 1\n}\n",
    ["f"],
    "1+ 2+ 3+ 4+ 5-g 6-g 7-g",
  ),
  new ScopeTestRow(
    "a default export is named default",
    "export default 3\nexport const f = (): i32 => 1\n",
    ["f"],
    "1-default 2+",
  ),
  new ScopeTestRow(
    "an export it cannot name mutates every line",
    "export const f = (): i32 => 1\nexport 3\n",
    ["f"],
    "whole: line 2 exports a declaration the scanner cannot name 1+ 2+",
  ),
  new ScopeTestRow(
    "a root the module does not declare mutates every line",
    "const f = (): i32 => 1\nexport { f as g }\n",
    ["g"],
    "whole: the contract's function g is not a top-level declaration of the module 1+ 2+",
  ),
  new ScopeTestRow(
    "a module the lexer cannot read mutates every line",
    'export const f = (): string => "a\n',
    ["f"],
    "whole: the module cannot be lexed: line 1: a string that never closes 1+",
  ),
]

/** The reachability scan, row by row. */
export const main = (): i32 => {
  const t = new Suite("spec/pr scope")
  for (const row of scopeTestRows()) {
    t.eqStr(row.name, scopeTestShow(row.text, row.roots), row.want)
  }
  return t.done()
}
