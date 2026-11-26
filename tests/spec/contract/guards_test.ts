import { Suite } from "nish/testing"
import { charsCodePointAt, charsSequenceLength } from "../../../src/spec/contract/chars"
import { RawKind, RawLiteral, literalsSettle } from "../../../src/spec/contract/literals"

/** Whether index `i` of `s` reads as U+FFFD, one byte long: the out-of-range answer. */
const guardsOutOfRange = (s: string, i: i32): boolean =>
  charsCodePointAt(s, i) === 0xfffd && charsSequenceLength(s, i) === 1

/** The guards that answer an index outside the text, and a word array with no words. */
export const main = (): i32 => {
  const t = new Suite("spec/contract guards")
  // "é€" is 5 bytes: é at 0 (2 bytes), € at 2 (3 bytes).
  const multi = "é€"
  const texts = ["", multi]
  for (const s of texts) {
    const n = toI32(s.length)
    const rows: i32[] = [-1, n, n + 1]
    for (const i of rows) {
      t.ok(`index ${i} of a ${n}-byte text is out of range`, guardsOutOfRange(s, i))
    }
  }
  // The neighbours inside the text still read as themselves.
  t.ok("index 0 of é€ is é", charsCodePointAt(multi, 0) === 0xe9 && charsSequenceLength(multi, 0) === 2)
  t.ok("index 2 of é€ is €", charsCodePointAt(multi, 2) === 0x20ac && charsSequenceLength(multi, 2) === 3)
  t.ok("index 4 of é€ is a continuation byte", charsSequenceLength(multi, 4) === 1)

  const empty = new RawLiteral(RawKind.Words, "")
  const settled = literalsSettle(empty, "u32[]")
  t.ok("a word array with no words is refused", settled.isErr() && settled.error === "a word array has no words")
  const one = new RawLiteral(RawKind.Words, "")
  one.words.push("879531e0")
  t.ok("a word array with one word settles", literalsSettle(one, "u32[]").isOk())
  return t.done()
}
