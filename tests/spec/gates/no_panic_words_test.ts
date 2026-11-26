import { Suite } from "nish/testing"
import { GateWordBlock, gateWordBlocks } from "../../../src/spec/gates/words"

// The bounds-checked readers of src/spec/gates/words.ts, on the inputs where
// each guard rewritten to prove it cannot panic decides.

/** Each block's ends at a page break, "atBreak/joinsNext" per block, from ";". */
const noPanicWordsBreaks = (lines: string[], pageBreaks: i32[]): string =>
  gateWordBlocks(lines, pageBreaks)
    .map((b: GateWordBlock): string => `${b.atBreak}/${b.joinsNext}`)
    .join(";")

/** The guards of src/spec/gates/words.ts, where each one decides. */
export const main = (): i32 => {
  const t = new Suite("spec/gates/no-panic-words")
  // Rows of one word each, split by a page break, are one block's two halves.
  t.eqStr(
    "one word a row, across a break",
    noPanicWordsBreaks(["   00112233", "   44556677", "", "   8899aabb", "   ccddeeff"], [2]),
    "true/true;true/false",
  )
  t.eqStr(
    "one word a row, no break",
    noPanicWordsBreaks(["   00112233", "   44556677", "", "   8899aabb", "   ccddeeff"], [9]),
    "false/false;false/false",
  )
  t.eqStr(
    "one word a row, another width across a break",
    noPanicWordsBreaks(["   00112233", "   44556677", "", "   8899", "   ccdd"], [2]),
    "false/false;false/false",
  )
  return t.done()
}
