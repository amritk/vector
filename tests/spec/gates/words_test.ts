import { Suite } from "nish/testing"
import { splitLines } from "nish/text"
import { CheckContext } from "../../../src/spec/check"
import { contractParse } from "../../../src/spec/contract/read"
import { gateFidelity } from "../../../src/spec/gates/fidelity"
import { GateWordBlock, gateWordBlocks } from "../../../src/spec/gates/words"
import { LoadedSource, SourceSet } from "../../../src/spec/source/load"
import { rfcParse } from "../../../src/spec/source/rfc"

/**
 * The first part of the RFC the word vectors cite: §2 prints both layouts
 * (four `name = word` assignments, and a 4x4 grid under a label, with and
 * without `*` marks), §3 prints a block §2 does not, and §4 prints one block
 * twice, in rounds.
 */
const WORDS_TEST_BASE: string = `Request for Comments: 9996

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

/**
 * The rest of it: §5 prints a grid split by a page break (its footer and
 * header removed by rfcParse, the blank lines around them kept), §6 two grids
 * apart by a blank line and then a page break before a sentence, and §7
 * u16 and u64 blocks of four words.
 */
const WORDS_TEST_PAGES: string = `
5.  Split

   Split State

       00000011  00000012  00000013  00000014
       00000015  00000016  00000017  00000018



Author                       Informational                      [Page 2]
\fRFC 9996                      Words                        November 2026


       00000019  0000001a  0000001b  0000001c
       0000001d  0000001e  0000001f  00000020

   Split Out

       00000021  00000022

6.  Apart

       00000031  00000032
       00000033  00000034

       00000035  00000036
       00000037  00000038



Author                       Informational                      [Page 3]
\fRFC 9996                      Words                        November 2026


   The grids end here.

7.  Widths

       0x0001  0x0002  0x0003  0x0004

       0x0005  0x0006  0x0007  0x0008

       0x0000000000000001  0x0000000000000002
       0x0000000000000003  0x0000000000000004

       0x0000000000000005  0x0000000000000006
       0x0000000000000007  0x0000000000000008
`

/** The whole RFC. */
const WORDS_TEST_RFC: string = WORDS_TEST_BASE + WORDS_TEST_PAGES

/** §5's grid, as printed across its page break. */
const WORDS_TEST_SPLIT: string = `"00000011", "00000012", "00000013", "00000014", "00000015", "00000016", "00000017", "00000018",
  "00000019", "0000001a", "0000001b", "0000001c", "0000001d", "0000001e", "0000001f", "00000020"`
/** §5's grid above its page break. */
const WORDS_TEST_SPLIT_TOP: string = `"00000011", "00000012", "00000013", "00000014", "00000015", "00000016", "00000017", "00000018"`
/** §5's grid below its page break. */
const WORDS_TEST_SPLIT_BOTTOM: string = `"00000019", "0000001a", "0000001b", "0000001c", "0000001d", "0000001e", "0000001f", "00000020"`

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
  const lines = splitLines(WORDS_TEST_BASE)
  const blocks = gateWordBlocks(lines, [])
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
  let sentence = false
  for (const b of blocks) {
    for (const w of b.words) {
      if (w === "0x22222222" || w === "0x33333333") {
        sentence = true
      }
    }
  }
  t.ok("a sentence's words are not a block", !sentence)
  let elsewhere = 0
  for (const b of blocks) {
    if (b.words.length === 4 && b.words.every((w: string): boolean => w === "0badf00d")) {
      elsewhere = elsewhere + 1
      t.ok("a heading is not a label", b.label === null)
    }
  }
  t.ok("the block under a heading is read", elsewhere === 1)
  t.ok(
    "a word in a label line keeps it from labelling",
    gateWordBlocks(["  a 0001", "", "  00000001"], [])[0].label === null,
  )
  t.ok("a sentence above is not a label", gateWordBlocks(["  It is:", "", "  00000001"], [])[0].label === null)
  t.ok("mixed widths are not a block", gateWordBlocks(["  00000001 0001"], []).length === 0)
  t.ok("mixed 0x spelling is not a block", gateWordBlocks(["  00000001 0x00000002"], []).length === 0)
  t.ok("uppercase is not a word", gateWordBlocks(["  0000000A"], []).length === 0)
  t.ok("a run with another line is not a block", gateWordBlocks(["  00000001", "  then"], []).length === 0)
  t.ok(
    "hex-only digits (no 0x, no letters or no digits) are words",
    gateWordBlocks(["  12345678  aabbccdd"], []).length === 1 && gateWordBlocks(["  12345678"], []).length === 1,
  )
  wordsTestPageBlocks(t)
}

/** The sizes of a section's blocks, read as rfcParse leaves it, joined by commas. */
const wordsTestSizes = (id: string): string => {
  for (const sec of rfcParse(WORDS_TEST_RFC).sections) {
    if (sec.id === id) {
      const sizes: string[] = []
      for (const b of gateWordBlocks(sec.lines, sec.pageBreaks)) {
        sizes.push(`${b.words.length}`)
      }
      return sizes.join(",")
    }
  }
  return "no section"
}

/** Blocks around page breaks and blank lines, each section's block sizes in order. */
const wordsTestPageBlocks = (t: Suite): void => {
  t.eqStr("a page break inside a grid does not split it", wordsTestSizes("5"), "16,2")
  t.eqStr("a blank line still ends a grid, and a page break before a sentence ends one", wordsTestSizes("6"), "4,4")
  t.eqStr("u16 and u64 blocks", wordsTestSizes("7"), "4,4,4,4")
  t.eqStr(
    "without its page breaks the same grid is two blocks",
    `${gateWordBlocks(rfcParse(WORDS_TEST_RFC).sections[4].lines, []).length}`,
    "3",
  )
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
    'the 4 words are printed in RFC §2 ("Vectors") with 0x: write each word as printed',
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
  wordsTest32(
    t,
    "another block's label",
    WORDS_TEST_STATE,
    "After the round",
    WORDS_TEST_AFTER,
    `under "Sample State", not under "After the round"`,
  )
  wordsTest32(
    t,
    "a per-word name is not a block label",
    WORDS_TEST_IN,
    "a",
    WORDS_TEST_OUT,
    `but not under the label "a"`,
  )
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
    "unlabelled u16 words bind to a one-line name",
    wordsTestRow("words16", "2", `{"words16": ["0x00ff"]}`, `{"words16": ["0x0f0f"]}`),
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
  wordsTestPageRows(t)
  wordsTestWidthRows(t)
  wordsTestIs(t, "the first round", wordsTestRounds(`"00000001", "00000002"`, `"00000003", "00000004"`), "")
  wordsTestIs(t, "the second round", wordsTestRounds(`"00000005", "00000006"`, `"00000007", "00000008"`), "")
  wordsTestIs(
    t,
    "an input and a result from different rounds",
    wordsTestRounds(`"00000001", "00000002"`, `"00000007", "00000008"`),
    "so they are from different test cases",
  )
}

/** Fidelity over §5's grid split by a page break and §6's grids apart by a blank line. */
const wordsTestPageRows = (t: Suite): void => {
  const out = `{"words32": ["00000021", "00000022"]}`
  wordsTestIs(
    t,
    "a grid across a page break",
    wordsTestRow("words32", "5", wordsTestLit(WORDS_TEST_SPLIT, ""), out),
    "",
  )
  wordsTestIs(
    t,
    "a grid across a page break, under its label",
    wordsTestRow("words32", "5", `{"words32": [${WORDS_TEST_SPLIT}], "label": "Split State"}`, out),
    "",
  )
  wordsTestIs(
    t,
    "the half of a grid above its page break",
    wordsTestRow("words32", "5", wordsTestLit(WORDS_TEST_SPLIT_TOP, ""), out),
    "8-word value is only part of a 16-word block",
  )
  wordsTestIs(
    t,
    "the half of a grid below its page break",
    wordsTestRow("words32", "5", wordsTestLit(WORDS_TEST_SPLIT_BOTTOM, ""), out),
    "8-word value is only part of a 16-word block",
  )
  const first = `"00000031", "00000032", "00000033", "00000034"`
  const second = `"00000035", "00000036", "00000037", "00000038"`
  wordsTestIs(
    t,
    "a grid ended by a blank line",
    wordsTestRow("words32", "6", wordsTestLit(first, ""), wordsTestLit(second, "")),
    "",
  )
  wordsTestIs(
    t,
    "two grids apart by a blank line are not one",
    wordsTestRow("words32", "6", wordsTestLit(`${first}, ${second}`, ""), wordsTestLit(second, "")),
    "8-word value is not printed as one block",
  )
}

/** One row over §7's u16 or u64 blocks: `arg` against the second block of its width. */
const wordsTestWidth = (t: Suite, name: string, bits: i32, arg: string, want: string): void => {
  const kind = `words${bits}`
  const out =
    bits === 16
      ? `"0x0005", "0x0006", "0x0007", "0x0008"`
      : `"0x0000000000000005", "0x0000000000000006", "0x0000000000000007", "0x0000000000000008"`
  wordsTestIs(t, name, wordsTestRow(kind, "7", `{"${kind}": [${arg}]}`, `{"${kind}": [${out}]}`), want)
}

/** The prefix, tail, middle and swap rows, for u16 and for u64 words. */
const wordsTestWidthRows = (t: Suite): void => {
  const w16 = ["0x0001", "0x0002", "0x0003", "0x0004"]
  const w64 = ["0x0000000000000001", "0x0000000000000002", "0x0000000000000003", "0x0000000000000004"]
  for (const bits of [16, 64]) {
    const w = bits === 16 ? w16 : w64
    wordsTestWidth(t, `u${bits}: the whole block`, bits, `"${w[0]}", "${w[1]}", "${w[2]}", "${w[3]}"`, "")
    const part = "2-word value is only part of a 4-word block"
    wordsTestWidth(t, `u${bits}: a block's prefix`, bits, `"${w[0]}", "${w[1]}"`, part)
    wordsTestWidth(t, `u${bits}: a block's tail`, bits, `"${w[2]}", "${w[3]}"`, part)
    wordsTestWidth(t, `u${bits}: a block's middle`, bits, `"${w[1]}", "${w[2]}"`, part)
    wordsTestWidth(
      t,
      `u${bits}: two words swapped`,
      bits,
      `"${w[1]}", "${w[0]}", "${w[2]}", "${w[3]}"`,
      "4-word value is not printed as one block",
    )
  }
}

/** Word blocks, and fidelity over u16[], u32[] and u64[] values. */
export const main = (): i32 => {
  const t = new Suite("spec/gates/words")
  wordsTestBlocks(t)
  wordsTestTable(t)
  return t.done()
}
