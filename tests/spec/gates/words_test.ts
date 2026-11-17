import { Suite } from "nish/testing"
import { splitLines } from "nish/text"
import { CheckContext } from "../../../src/spec/check"
import { contractParse } from "../../../src/spec/contract/read"
import { gateFidelity } from "../../../src/spec/gates/fidelity"
import { GateWordBlock, gateWordBlocks } from "../../../src/spec/gates/words"
import { LoadedSource, SourceSet } from "../../../src/spec/source/load"
import { rfcParse } from "../../../src/spec/source/rfc"

/**
 * The RFC the word vectors cite: §2 prints both layouts (four `name = word`
 * assignments, and a 4x4 grid under a label, with and without `*` marks),
 * §3 prints a block §2 does not, and §4 prints one block twice, in rounds.
 */
const WORDS_TEST_RFC: string = `Request for Comments: 9996

1.  Intro

   It MUST round.

2.  Vectors

   a = 0x11111111
   b = 0x01020304
   c = 0x9b8d6f43
   d = 0x01234567

   a = 0xea2a92f4
   b = 0xcb1cf8ce
   c = 0x4581472e
   d = 0x5881c4bb

   Sample State

       879531e0  c5ecf37d  516461b1  c9a62f8a
       44c20ef3  3390af7f  d9fc690b  2a5f714c
       53372767  b00a5631  974c541a  359e9963
       5c971061  3d631689  2098d9d6  91dbd320

   After the round

       879531e0  c5ecf37d *bdb886dc  c9a62f8a
       44c20ef3  3390af7f  d9fc690b *cfacafd2
      *e46bea80  b00a5631  974c541a  359e9963
       5c971061 *ccc07c79  2098d9d6  91dbd320

   k = 0x0123456789abcdef

   m = 0xfedcba9876543210

   h = 0x00ff

   g = 0x0f0f

   The state is 0x22222222 0x33333333 in this sentence.

3.  Elsewhere

       0badf00d  0badf00d  0badf00d  0badf00d

4.  Rounds

   In

       00000001  00000002

   Out

       00000003  00000004

   In

       00000005  00000006

   Out

       00000007  00000008
`

/** The §2.1.1-style input, as printed. */
const WORDS_TEST_IN: string = `"0x11111111", "0x01020304", "0x9b8d6f43", "0x01234567"`
/** The §2.1.1-style result, as printed. */
const WORDS_TEST_OUT: string = `"0xea2a92f4", "0xcb1cf8ce", "0x4581472e", "0x5881c4bb"`
/** The 4x4 grid under "Sample State". */
const WORDS_TEST_STATE: string = `"879531e0", "c5ecf37d", "516461b1", "c9a62f8a", "44c20ef3", "3390af7f", "d9fc690b", "2a5f714c",
  "53372767", "b00a5631", "974c541a", "359e9963", "5c971061", "3d631689", "2098d9d6", "91dbd320"`
/** The 4x4 grid under "After the round", its `*` marks dropped. */
const WORDS_TEST_AFTER: string = `"879531e0", "c5ecf37d", "bdb886dc", "c9a62f8a", "44c20ef3", "3390af7f", "d9fc690b", "cfacafd2",
  "e46bea80", "b00a5631", "974c541a", "359e9963", "5c971061", "ccc07c79", "2098d9d6", "91dbd320"`

/**
 * The findings for one vector of `f` (a `kind` word array in, the same
 * out) citing section `sec`, its argument `arg` and its expected value
 * `expect` (each a contract literal).
 */
const wordsTestRow = (kind: string, sec: string, arg: string, expect: string): string[] => {
  const contract = `{
  "contract": "c4",
  "source": {"title": "T", "rfc": 9996},
  "target": {"module": "nish/x"},
  "requirements": [{"id": "R1", "section": "1", "level": "MUST", "quote": "It MUST round."}],
  "functions": [
    {"name": "f", "params": [{"name": "s", "type": "${kind}"}], "returns": "${kind}"}
  ],
  "clauses": [
    {"kind": "vector", "id": "W1", "title": "t", "covers": ["R1"], "source": {"cite": {"section": "${sec}"}}, "call": "f",
     "args": [${arg}], "expect": ${expect}}
  ]
}`
  const ctx = new CheckContext("contracts/c4.json", ".")
  ctx.contract = contractParse(contract, "c4").expect("parse")
  const set = new SourceSet()
  set.main = "rfc9996"
  set.sources.push(new LoadedSource("rfc9996", "r.txt", "r.txt", rfcParse(WORDS_TEST_RFC)))
  ctx.sources = set
  return gateFidelity(ctx)
}

/** A `words32` literal of `words`, labelled when `label` is not empty. */
const wordsTestLit = (words: string, label: string): string =>
  label.length === 0 ? `{"words32": [${words}]}` : `{"words32": [${words}], "label": "${label}"}`

/** One row: its findings are exactly the one holding `want`, or none when `want` is empty. */
const wordsTestIs = (t: Suite, name: string, got: string[], want: string): void => {
  const ok = want.length === 0 ? got.length === 0 : got.length === 1 && got[0].indexOf(want) >= 0
  t.ok(name, ok)
  if (!ok) {
    console.log(`${name}:\n${got.join("\n")}`)
  }
}

/** One row of u32 words citing §2, its argument and expected value given as words and labels. */
const wordsTest32 = (t: Suite, name: string, arg: string, argLabel: string, out: string, want: string): void => {
  wordsTestIs(t, name, wordsTestRow("words32", "2", wordsTestLit(arg, argLabel), wordsTestLit(out, "")), want)
}

/** A block's label, or "-" when it has none. */
const wordsTestLabel = (b: GateWordBlock): string => {
  const l = b.label
  return l !== null ? l : "-"
}

/** The findings for a vector of §4's rounds: `arg` under "In", `out` under "Out". */
const wordsTestRounds = (arg: string, out: string): string[] =>
  wordsTestRow("words32", "4", `{"words32": [${arg}], "label": "In"}`, `{"words32": [${out}], "label": "Out"}`)

/** The blocks a section prints, read on their own. */
const wordsTestBlocks = (t: Suite): void => {
  const lines = splitLines(WORDS_TEST_RFC)
  const blocks = gateWordBlocks(lines)
  t.ok("every block, in order", blocks.length === 13)
  if (blocks.length !== 13) {
    for (const b of blocks) {
      console.log(`${b.words.length} ${wordsTestLabel(b)}`)
    }
    return
  }
  t.ok("four assignments are one block", blocks[0].words.length === 4 && blocks[0].digits === 8)
  t.ok("per-word names are not a block label", blocks[0].label === null)
  t.ok("a grid is read row by row", blocks[2].words.length === 16 && blocks[2].words[4] === "44c20ef3")
  t.ok("a grid's label is the line above", wordsTestLabel(blocks[2]) === "Sample State")
  t.ok("a * mark is not part of a word", blocks[3].words[2] === "bdb886dc" && blocks[3].words[8] === "e46bea80")
  t.ok("one assignment's name labels it", wordsTestLabel(blocks[4]) === "k" && blocks[4].digits === 16)
  t.ok("a 16-bit word", wordsTestLabel(blocks[6]) === "h" && blocks[6].digits === 4)
  t.ok("a sentence's words are not a block", blocks[8].words[0] === "0badf00d")
  t.ok("a heading is not a label", blocks[8].label === null)
  t.ok("a word in a label line keeps it from labelling", gateWordBlocks(["  a 0001", "", "  00000001"])[0].label === null)
  t.ok("a sentence above is not a label", gateWordBlocks(["  It is:", "", "  00000001"])[0].label === null)
  t.ok("mixed widths are not a block", gateWordBlocks(["  00000001 0001"]).length === 0)
  t.ok("mixed 0x spelling is not a block", gateWordBlocks(["  00000001 0x00000002"]).length === 0)
  t.ok("uppercase is not a word", gateWordBlocks(["  0000000A"]).length === 0)
  t.ok("a run with another line is not a block", gateWordBlocks(["  00000001", "  then"]).length === 0)
}

/** The word-array fidelity table: both layouts, against each way a row can differ from the print. */
const wordsTestTable = (t: Suite): void => {
  wordsTest32(t, "assignments in, assignments out", WORDS_TEST_IN, "", WORDS_TEST_OUT, "")
  wordsTest32(t, "a grid in, a grid with * marks out", WORDS_TEST_STATE, "Sample State", WORDS_TEST_AFTER, "")
  wordsTest32(t, "an unlabelled grid", WORDS_TEST_STATE, "", WORDS_TEST_AFTER, "")
  wordsTest32(
    t,
    "a changed digit",
    `"0x11111111", "0x01020304", "0x9b8d6f44", "0x01234567"`,
    "",
    WORDS_TEST_OUT,
    "4-word value is not printed as one block in RFC §2",
  )
  wordsTest32(
    t,
    "two words swapped",
    `"0x01020304", "0x11111111", "0x9b8d6f43", "0x01234567"`,
    "",
    WORDS_TEST_OUT,
    "4-word value is not printed as one block",
  )
  wordsTest32(
    t,
    "0x dropped against the print",
    `"11111111", "01020304", "9b8d6f43", "01234567"`,
    "",
    WORDS_TEST_OUT,
    "the 4 words are printed in RFC §2 (\"Vectors\") with 0x: write each word as printed",
  )
  wordsTest32(
    t,
    "0x added against the print",
    `"0x879531e0", "0xc5ecf37d", "0x516461b1", "0xc9a62f8a", "0x44c20ef3", "0x3390af7f", "0xd9fc690b", "0x2a5f714c",
     "0x53372767", "0xb00a5631", "0x974c541a", "0x359e9963", "0x5c971061", "0x3d631689", "0x2098d9d6", "0x91dbd320"`,
    "",
    WORDS_TEST_AFTER,
    `the 16 words are printed in RFC §2 ("Vectors") (under "Sample State") without 0x`,
  )
  wordsTest32(
    t,
    "a block's prefix",
    `"0x11111111", "0x01020304"`,
    "",
    WORDS_TEST_OUT,
    "2-word value is only part of a 4-word block",
  )
  wordsTest32(
    t,
    "a block's tail",
    `"0x9b8d6f43", "0x01234567"`,
    "",
    WORDS_TEST_OUT,
    "2-word value is only part of a 4-word block",
  )
  wordsTest32(
    t,
    "a block's middle",
    `"0x01020304", "0x9b8d6f43"`,
    "",
    WORDS_TEST_OUT,
    "2-word value is only part of a 4-word block",
  )
  wordsTest32(
    t,
    "8 words of the 16-word grid",
    `"879531e0", "c5ecf37d", "516461b1", "c9a62f8a", "44c20ef3", "3390af7f", "d9fc690b", "2a5f714c"`,
    "",
    WORDS_TEST_AFTER,
    "8-word value is only part of a 16-word block",
  )
  wordsTest32(
    t,
    "a 16-word value against the 4-word block",
    `${WORDS_TEST_IN}, ${WORDS_TEST_IN}, ${WORDS_TEST_IN}, ${WORDS_TEST_IN}`,
    "",
    WORDS_TEST_OUT,
    "16-word value is not printed as one block",
  )
  wordsTest32(
    t,
    "words from two blocks",
    `${WORDS_TEST_IN}, ${WORDS_TEST_OUT}`,
    "",
    WORDS_TEST_OUT,
    "8-word value is not printed as one block",
  )
  wordsTest32(
    t,
    "words printed in a sentence",
    `"0x22222222", "0x33333333"`,
    "",
    WORDS_TEST_OUT,
    "2-word value is not printed as one block",
  )
  wordsTestIs(
    t,
    "a block in another section",
    wordsTestRow(
      "words32",
      "2",
      wordsTestLit(`"0badf00d", "0badf00d", "0badf00d", "0badf00d"`, ""),
      wordsTestLit(WORDS_TEST_OUT, ""),
    ),
    "4-word value is not printed as one block in RFC §2",
  )
  wordsTestIs(
    t,
    "the same block in its own section",
    wordsTestRow(
      "words32",
      "3",
      wordsTestLit(`"0badf00d", "0badf00d", "0badf00d", "0badf00d"`, ""),
      `{"words32": ["0badf00d", "0badf00d", "0badf00d", "0badf00d"], "label": "Out"}`,
    ),
    `the value is printed in RFC §3 ("Elsewhere"), but not under the label "Out"`,
  )
  wordsTest32(t, "another block's label", WORDS_TEST_STATE, "After the round", WORDS_TEST_AFTER, `under "Sample State", not under "After the round"`)
  wordsTest32(t, "a per-word name is not a block label", WORDS_TEST_IN, "a", WORDS_TEST_OUT, `but not under the label "a"`)
  wordsTest32(
    t,
    "the expected value is the argument's block",
    WORDS_TEST_IN,
    "",
    WORDS_TEST_IN,
    "the expected value is the block of words args[0] is bound to as well: an input is not the expected result",
  )
  wordsTestIs(
    t,
    "u64 words under a one-line name",
    wordsTestRow(
      "words64",
      "2",
      `{"words64": ["0x0123456789abcdef"], "label": "k"}`,
      `{"words64": ["0xfedcba9876543210"], "label": "m"}`,
    ),
    "",
  )
  wordsTestIs(
    t,
    "u16 words under a one-line name",
    wordsTestRow("words16", "2", `{"words16": ["0x00ff"], "label": "h"}`, `{"words16": ["0x0f0f"], "label": "g"}`),
    "",
  )
  wordsTestIs(
    t,
    "u16 words under another name",
    wordsTestRow("words16", "2", `{"words16": ["0x00ff"], "label": "h"}`, `{"words16": ["0x0f0f"], "label": "k"}`),
    `under "g", not under "k"`,
  )
  wordsTestIs(
    t,
    "u64 words as one u64 block, the same block twice",
    wordsTestRow(
      "words64",
      "2",
      `{"words64": ["0x0123456789abcdef"], "label": "k"}`,
      `{"words64": ["0x0123456789abcdef"], "label": "k"}`,
    ),
    "an input is not the expected result",
  )
  wordsTestIs(t, "the first round", wordsTestRounds(`"00000001", "00000002"`, `"00000003", "00000004"`), "")
  wordsTestIs(t, "the second round", wordsTestRounds(`"00000005", "00000006"`, `"00000007", "00000008"`), "")
  wordsTestIs(
    t,
    "an input and a result from different rounds",
    wordsTestRounds(`"00000001", "00000002"`, `"00000007", "00000008"`),
    "so they are from different test cases",
  )
}

/** Word blocks, and fidelity over u16[], u32[] and u64[] values. */
export const main = (): i32 => {
  const t = new Suite("spec/gates/words")
  wordsTestBlocks(t)
  wordsTestTable(t)
  return t.done()
}
