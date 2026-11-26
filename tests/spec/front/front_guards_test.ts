import { Suite } from "nish/testing"
import { replaceAll } from "nish/text"
import { FrontRefusal, frontParseInterface, frontParseProperty } from "../../../src/spec/front/front"
import { specTestRepeat } from "../repeat"

// The rows that pin the guards the panic proof put into src/spec/front: each
// boundary on both sides, each expected value what main's parser gave.

const FRONT_GUARDS_DEPTH: string = "the expression nests more than 64 deep; name a part with const"

/** One refusal as `message @line:col`, or "accepted". */
const frontGuardsShow = (r: FrontRefusal[] | null): string =>
  r === null ? "accepted" : r.length === 1 ? `${r[0].message} @${r[0].line}:${r[0].col}` : `${r.length} refusals`

/** A property over b, t and i whose body is `body`. */
const frontGuardsProp = (body: string): string =>
  `// P-X covers R-X — a title\nforall (b: u8[] /* 0..4 */, t: string /* 0..4 hexdigit */, i: i32 /* -5..5 */) => ${body}`

/** What parsing `text` as a property gives. */
const frontGuardsParse = (text: string): string => {
  const r = frontParseProperty(text, [])
  return frontGuardsShow(r.isErr() ? r.error : null)
}

/** `i + i + …`, `n` operands. */
const frontGuardsSum = (n: i32): string => {
  let out = "i"
  for (let k = 1; k < n; k++) {
    out = `${out} + i`
  }
  return out
}

/** The nesting limits, on each side: 63 operators in one another pass, 64 do not; a sum of 64 passes, of 65 does not. */
const frontGuardsNesting = (t: Suite): void => {
  const cases: string[][] = [
    ["63 nots", frontGuardsProp(`${specTestRepeat("!", 63)}true`), "accepted"],
    ["64 nots", frontGuardsProp(`${specTestRepeat("!", 64)}true`), `${FRONT_GUARDS_DEPTH} @2:147`],
    ["63 parens", frontGuardsProp(`${specTestRepeat("(", 63)}true${specTestRepeat(")", 63)}`), "accepted"],
    [
      "64 parens",
      frontGuardsProp(`${specTestRepeat("(", 64)}true${specTestRepeat(")", 64)}`),
      `${FRONT_GUARDS_DEPTH} @2:147`,
    ],
    ["a sum of 64", frontGuardsProp(`${frontGuardsSum(64)} > 0`), "accepted"],
    ["a sum of 65", frontGuardsProp(`${frontGuardsSum(65)} > 0`), `${FRONT_GUARDS_DEPTH} @2:83`],
  ]
  for (const k of cases) {
    t.eqStr(`nesting: ${k[0]}`, frontGuardsParse(k[1]), k[2])
  }
}

/** A type error lands on the argument `typeOf` names, two-digit indices included. */
const frontGuardsArgs = (t: Suite): void => {
  const want = "`&&` wants boolean, got i32"
  const cases: string[][] = [
    ["the first of two", frontGuardsProp("i && true"), `${want} @2:83`],
    ["the second of two", frontGuardsProp("true && i"), `${want} @2:91`],
    ["the eleventh of eleven", frontGuardsProp(`${specTestRepeat("true && ", 10)}i`), `${want} @2:163`],
    ["the twelfth of twelve", frontGuardsProp(`${specTestRepeat("true && ", 11)}i`), `${want} @2:171`],
  ]
  for (const k of cases) {
    t.eqStr(`argument: ${k[0]}`, frontGuardsParse(k[1]), k[2])
  }
}

/** Each method keeps its own argument count; one outside the subset is refused. */
const frontGuardsMethods = (t: Suite): void => {
  const cases: string[][] = [
    ["concat", "b.concat() === b", "`.concat` takes 1 argument(s), got 0 @2:91"],
    ["slice", "t.slice(1) === t", "`.slice` takes 2 argument(s), got 1 @2:90"],
    ["toLowerCase", "t.toLowerCase(1) === t", "`.toLowerCase` takes 0 argument(s), got 1 @2:96"],
    ["toUpperCase", "t.toUpperCase(1) === t", "`.toUpperCase` takes 0 argument(s), got 1 @2:96"],
    ["charAt", "t.charAt() === t", "`.charAt` takes 1 argument(s), got 0 @2:91"],
    ["trim", "t.trim() === t", "`.trim` is not in the ts-property subset @2:85"],
    ["an optional argument", "utf8(ascii(b)) === b", "`utf8` wants string, got string | null @2:88"],
    ["an optional comparison", "ascii(b) === i", "cannot compare string | null with i32 @2:83"],
    ["an optional length", "ascii(b).length === 0", "`.length` wants u8[], got string | null @2:83"],
    [
      "a chain",
      "t.slice(0, 1).toLowerCase().toUpperCase().charAt(0).concat(t) === t",
      "`.slice` wants u8[], got string @2:83",
    ],
  ]
  for (const k of cases) {
    t.eqStr(`method: ${k[0]}`, frontGuardsParse(frontGuardsProp(k[1])), k[2])
  }
}

/** The covers line and the bounds comment, read at their offsets. */
const frontGuardsLines = (t: Suite): void => {
  const base = frontGuardsProp("i === i")
  const cases: string[][] = [
    [
      "covers without a space",
      replaceAll(base, "covers R-X", "coversR-X"),
      "missing `// P-ID covers R-ID — title` line @1:1",
    ],
    [
      "an empty title",
      replaceAll(base, " — a title", " —  "),
      "missing title: end the covers line with ` — <title>` @1:1",
    ],
    ["negative bounds", replaceAll(base, "-5..5", "-9..-1"), "accepted"],
    [
      "a sign without digits",
      replaceAll(base, "-5..5", "-9..-"),
      "the bounds of `i` (i32) must read `lo..hi`, like /* 0..64 */ @2:67",
    ],
    [
      "two signs",
      replaceAll(base, "-5..5", "--9..1"),
      "the bounds of `i` (i32) must read `lo..hi`, like /* 0..64 */ @2:67",
    ],
  ]
  for (const k of cases) {
    t.eqStr(`line: ${k[0]}`, frontGuardsParse(k[1]), k[2])
  }
}

/** Literals and the end of the text, where the lexer reads at the last byte. */
const frontGuardsLexer = (t: Suite): void => {
  const str = "malformed string literal @2:89"
  const dec = "`0a` is not in the ts-property subset; write integers in decimal @2:90"
  const cases: string[][] = [
    ["a string to the end", 't === "ab', str],
    ["a backslash at the end", 't === "ab\\', str],
    ["an escaped quote", 't === "a\\"b"', "accepted"],
    ["a backslash before a line break", 't === "a\\\nb"', str],
    ["bytes to the end", "b === [0a", dec],
    ["half a pair at the end", "b === [0a f", dec],
    ["a space at the end", "b === [0a ", dec],
    ["one pair", "b === [0a]", "accepted"],
    ["no bytes", "b === []", "accepted"],
    ["two pairs", "b === [0a ff]", "accepted"],
    [
      "uppercase hex",
      "b === [0A]",
      "a bytes literal is lowercase hex pairs separated by single spaces, like [00 0f] @2:89",
    ],
    ["an operand missing at the end", "i === ", "unexpected end of block @2:89"],
    ["a paren open at the end", "(i === i", "expected `)`, got end of block @2:91"],
  ]
  for (const k of cases) {
    t.eqStr(`lexer: ${k[0]}`, frontGuardsParse(frontGuardsProp(k[1])), k[2])
  }
}

/** A parameter comment's first word, an empty comment included. */
const frontGuardsParams = (t: Suite): void => {
  const only = "`f(x)`: an interface parameter takes only /* window */ or /* out CAP */, not"
  const cases: string[][] = [
    ["empty", "/* */", `${only} \`/* */\` @2:27`],
    ["blank", "/*   */", `${only} \`/*   */\` @2:27`],
    ["window", "/* window */", "accepted"],
    ["out", "/* out 32 */", "accepted"],
    [
      "out without a capacity",
      "/*out*/",
      "`f(x)`: /* out */ needs its capacity, like /* out 2 * x.length + 8 */ @2:27",
    ],
    ["a word that starts with out", "/* outer */", `${only} \`/* outer */\` @2:27`],
  ]
  for (const k of cases) {
    const r = frontParseInterface(`// module: nish/m\nexport function f(x: u8[] ${k[1]}): u8[]`)
    t.eqStr(`param: ${k[0]}`, frontGuardsShow(r.isErr() ? r.error : null), k[2])
  }
}

export const main = (): i32 => {
  const t = new Suite("front guards")
  frontGuardsNesting(t)
  frontGuardsArgs(t)
  frontGuardsMethods(t)
  frontGuardsLines(t)
  frontGuardsLexer(t)
  frontGuardsParams(t)
  return t.done()
}
