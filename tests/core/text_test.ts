import { Suite } from "nish/testing"
import { asciiLower, asciiUpper } from "nish/text"
import { textAsciiLower, textAsciiUpper } from "../../src/core/text"

/** Checks both helpers against the std functions on `text`, under `name`. */
const textCheck = (t: Suite, name: string, text: string): void => {
  t.eqStr(`lower ${name}`, textAsciiLower(text), asciiLower(text))
  t.eqStr(`upper ${name}`, textAsciiUpper(text), asciiUpper(text))
}

export const main = (): i32 => {
  const t = new Suite("core/text")
  // Every byte value alone, then all 256 in one string: the letters and the
  // bytes either side of each range (@ [ ` {) move or stay as std's do.
  const all: u8[] = []
  for (let b = 0; b < 256; b++) {
    const one: u8[] = [toU8(b)]
    textCheck(t, `byte ${b}`, String.fromBytes(one, 0, 1))
    all.push(toU8(b))
  }
  textCheck(t, "every byte", String.fromBytes(all, 0, 256))
  textCheck(t, "empty", "")
  textCheck(t, "mixed", "Hello, World! @[`{ AZaz 09")
  // Multi-byte UTF-8 is left alone, byte for byte: é, ß, Σ, 中 and an emoji.
  textCheck(t, "utf-8", "Éé ßẞ Σσ 中文 😀 MiXeD")
  t.eqStr("lower fixed", textAsciiLower("AbC-Zé@["), "abc-zé@[")
  t.eqStr("upper fixed", textAsciiUpper("aBc-zé`{"), "ABC-Zé`{")
  t.eqI32("lower keeps length", toI32(textAsciiLower("ÉA中").length), toI32("ÉA中".length))
  return t.done()
}
