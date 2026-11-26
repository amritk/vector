import { Suite } from "nish/testing"
import { SampleTable } from "../../../src/spec/check"
import { charsFromCodePoint } from "../../../src/spec/contract/chars"
import { contractLoadFile } from "../../../src/spec/contract/contract"
import { Clause, Contract } from "../../../src/spec/contract/types"
import { EmitOptions, emitProgram, emitWrap } from "../../../src/spec/emit/emit"
import { emitGoQuote } from "../../../src/spec/emit/go"
import { emitRsQuote } from "../../../src/spec/emit/rust"

const EDGES_FORMS: string = "tests/spec/emit/fixtures/forms.json"

/** Lines joined by `|`, so a row compares the whole wrap at once. */
const edgesLines = (lines: string[]): string => lines.join("|")

/** emitWrap one under, at and one over the width, and a word past it. */
const edgesWrap = (t: Suite): void => {
  // Width 10: "aaaa" + " " + the next word is 9, 10 or 11 characters.
  t.eqStr("one under the width", edgesLines(emitWrap("aaaa bbbb cc", 10)), "aaaa bbbb|cc")
  t.eqStr("at the width", edgesLines(emitWrap("aaaa bbbbb cc", 10)), "aaaa bbbbb|cc")
  t.eqStr("one over the width", edgesLines(emitWrap("aaaa bbbbbb cc", 10)), "aaaa|bbbbbb cc")
  t.eqStr("a word longer than the width", edgesLines(emitWrap("aaaaaaaaaaaa", 10)), "aaaaaaaaaaaa")
  t.eqStr("a long word between short ones", edgesLines(emitWrap("a aaaaaaaaaaaa b", 10)), "a|aaaaaaaaaaaa|b")
  t.eqStr("a word exactly the width", edgesLines(emitWrap("aaaaaaaaaa b", 10)), "aaaaaaaaaa|b")
  t.eqStr("runs of whitespace", edgesLines(emitWrap("  a \t\n b  ", 10)), "a b")
  t.eqStr("no words", edgesLines(emitWrap("   ", 10)), "")
}

/** The Go literal of the one code point `cp`. */
const edgesGo = (cp: i32): string => emitGoQuote(charsFromCodePoint(cp))

/** The Rust literal of the one code point `cp`. */
const edgesRs = (cp: i32): string => emitRsQuote(charsFromCodePoint(cp))

/** emitGoQuote, and its hex digits, at each edge of an escape. */
const edgesGoQuote = (t: Suite): void => {
  t.eqStr("go U+0000", edgesGo(0x00), '"\\u0000"')
  t.eqStr("go U+000F", edgesGo(0x0f), '"\\u000f"')
  t.eqStr("go U+0010", edgesGo(0x10), '"\\u0010"')
  t.eqStr("go U+001F", edgesGo(0x1f), '"\\u001f"')
  t.eqStr("go U+0020", edgesGo(0x20), '" "')
  t.eqStr("go U+007E", edgesGo(0x7e), '"~"')
  t.eqStr("go U+007F", edgesGo(0x7f), '"\\u007f"')
  t.eqStr("go U+00FF", edgesGo(0xff), '"\\u00ff"')
  t.eqStr("go U+FFFF", edgesGo(0xffff), '"\\uffff"')
  t.eqStr("go U+10000", edgesGo(0x10000), '"\\U00010000"')
  t.eqStr("go a 4-byte sequence", edgesGo(0x1f600), '"\\U0001f600"')
  t.eqStr("go U+10FFFF", edgesGo(0x10ffff), '"\\U0010ffff"')
  t.eqStr("go an invalid byte", emitGoQuote(`a${"é".substring(0, 1)}b`), '"a\\ufffdb"')
  t.eqStr("go quotes and escapes", emitGoQuote('"\\\n\t\r'), '"\\"\\\\\\n\\t\\r"')
}

/** emitRsQuote, and its hex digits, at each edge of an escape. */
const edgesRsQuote = (t: Suite): void => {
  t.eqStr("rust U+0000", edgesRs(0x00), '"\\u{00}"')
  t.eqStr("rust U+000F", edgesRs(0x0f), '"\\u{0f}"')
  t.eqStr("rust U+0010", edgesRs(0x10), '"\\u{10}"')
  t.eqStr("rust U+001F", edgesRs(0x1f), '"\\u{1f}"')
  t.eqStr("rust U+0020", edgesRs(0x20), '" "')
  t.eqStr("rust U+007E", edgesRs(0x7e), '"~"')
  t.eqStr("rust U+007F", edgesRs(0x7f), '"\\u{7f}"')
  t.eqStr("rust U+0080", edgesRs(0x80), `"${charsFromCodePoint(0x80)}"`)
  t.eqStr("rust a 4-byte sequence", edgesRs(0x1f600), `"${charsFromCodePoint(0x1f600)}"`)
  const cut = "é".substring(0, 1)
  t.eqStr("rust an invalid byte, as written", emitRsQuote(`a${cut}b`), `"a${cut}b"`)
  t.eqStr("rust quotes and escapes", emitRsQuote('"\\\n\t\r'), '"\\"\\\\\\n\\t\\r"')
}

/** The forms contract's clause `id`, from a fresh load so it is a copy; null when it has none. */
const edgesClause = (id: string): Clause | null => {
  const c = contractLoadFile(EDGES_FORMS).expect("load the forms contract")
  for (const k of c.clauses) {
    if (k.id === id) {
      return k
    }
  }
  return null
}

/** Where `s` first occurs in `p`, and whether it occurs again after. */
const edgesOnce = (p: string, s: string): i32 => {
  const at = p.indexOf(s)
  return at >= 0 && p.indexOf(s, at + 1) < 0 ? at : -1
}

/**
 * Wrappers met out of order, one of them twice, come out once each in byte
 * order of their names.
 */
const edgesWrappers = (t: Suite): void => {
  const c: Contract = contractLoadFile(EDGES_FORMS).expect("load the forms contract")
  // A third wrapped function, keepBase under a name that sorts first.
  const copy = contractLoadFile(EDGES_FORMS).expect("load the forms contract")
  for (const f of copy.functions) {
    if (f.name === "keepBase") {
      f.name = "aKeep"
      c.functions.push(f)
    }
  }
  const base = edgesClause("V-SECRET-BASE")
  const plain = edgesClause("V-SECRET")
  const again = edgesClause("V-SECRET-NULL")
  const first = edgesClause("V-SECRET-BASE")
  if (base === null || plain === null || again === null || first === null) {
    t.fail("the wrapped contract", "a V-SECRET clause is missing")
    return
  }
  first.id = "V-A-KEEP"
  first.title = "V-A-KEEP: aKeep"
  first.call = "aKeep"
  // Met as keepBase, keep, keepBase again, then aKeep.
  c.clauses = [base, plain, again, first]
  const r = emitProgram(c, new SampleTable(), new EmitOptions("ab"))
  if (!r.isOk()) {
    t.fail("the wrapped contract emits", r.error.join("|"))
    return
  }
  const p = r.value
  const a = edgesOnce(p, "const plain_aKeep = ")
  const k = edgesOnce(p, "const plain_keep = ")
  const b = edgesOnce(p, "const plain_keepBase = ")
  t.ok("each wrapper is defined once", a >= 0 && k >= 0 && b >= 0)
  t.ok("plain_aKeep before plain_keep", a < k)
  t.ok("plain_keep before plain_keepBase", k < b)
}

/**
 * Checks the emitter's rewritten text helpers at their exact edges: the
 * wrap width, Go's and Rust's escapes and hex digits, and the order of the
 * `plain_` wrappers.
 */
export const main = (): i32 => {
  const t = new Suite("spec/emit edges")
  edgesWrap(t)
  edgesGoQuote(t)
  edgesRsQuote(t)
  edgesWrappers(t)
  return t.done()
}
