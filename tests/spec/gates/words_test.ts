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
 * apart by a blank line and then a page break before a sentence, §7
 * u16 and u64 blocks of four words, §8 to §17 each way a block meets a
 * page break, and §18 a grid split by a break whose top half is printed
 * again, whole and labelled, away from it, and §19 two test cases, the
 * second split by a break; §8 to §19 each close with the grid 0000ff01
 * 0000ff02 away from any break.
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

8.  Joined

       00000051  00000052



Author                       Informational                      [Page 5]
\fRFC 9996                      Words                        November 2026


       00000053  00000054

       0000ff01  0000ff02

9.  Width

       00000061  00000062



Author                       Informational                      [Page 6]
\fRFC 9996                      Words                        November 2026


       0x0001  0x0002

       0000ff01  0000ff02

10.  Spelling

       00000071  00000072



Author                       Informational                      [Page 7]
\fRFC 9996                      Words                        November 2026


       0x00000073  0x00000074

       0000ff01  0000ff02

11.  Assign

       00000081  00000082



Author                       Informational                      [Page 8]
\fRFC 9996                      Words                        November 2026


   a = 00000083

       0000ff01  0000ff02

12.  Labelled

       00000091  00000092



Author                       Informational                      [Page 9]
\fRFC 9996                      Words                        November 2026


   Next State

       00000093  00000094

       0000ff01  0000ff02

13.  Ends

       0000ff01  0000ff02

       000000a1  000000a2



Author                       Informational                      [Page 10]
\fRFC 9996                      Words                        November 2026


14.  After

       000000a3  000000a4

       0000ff01  0000ff02

15.  Chain

       000000b1  000000b2



Author                       Informational                      [Page 11]
\fRFC 9996                      Words                        November 2026


       000000b3  000000b4



Author                       Informational                      [Page 12]
\fRFC 9996                      Words                        November 2026


       000000b5  000000b6

       0000ff01  0000ff02

16.  Inside

       000000c1  000000c2
Author                       Informational                      [Page 13]
\fRFC 9996                      Words                        November 2026
       000000c3  000000c4

       0000ff01  0000ff02

17.  Narrow

       000000d1  000000d2
Author                       Informational                      [Page 14]
\fRFC 9996                      Words                        November 2026
       0x0001  0x0002

       0000ff01  0000ff02

18.  Twin

       000000e1  000000e2



Author                       Informational                      [Page 15]
\fRFC 9996                      Words                        November 2026


       000000e3  000000e4

   Twin State

       000000e1  000000e2

       0000ff01  0000ff02

19.  Cases

   Test Vector #1:

       000000f1  000000f2

   Test Vector #2:

       000000f3  000000f4



Author                       Informational                      [Page 16]
\fRFC 9996                      Words                        November 2026


       000000f5  000000f6

       0000ff01  0000ff02
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
const wordsTestRow = (kind: string, sec: string, arg: string, expect: string): string[] =>
  wordsTestCite(kind, `{"section": "${sec}"}`, arg, expect)

/** The findings for one vector as in wordsTestRow, citing `cite` (a contract citation's JSON). */
const wordsTestCite = (kind: string, cite: string, arg: string, expect: string): string[] => {
  const contract = `{
  "contract": "c4",
  "source": {"title": "T", "rfc": 9996},
  "target": {"module": "nish/x"},
  "requirements": [{"id": "R1", "section": "1", "level": "MUST", "quote": "It MUST round."}],
  "functions": [
    {"name": "f", "params": [{"name": "s", "type": "${kind}"}], "returns": "${kind}"}
  ],
  "clauses": [
    {"kind": "vector", "id": "W1", "title": "t", "covers": ["R1"], "source": {"cite": ${cite}}, "call": "f",
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

/**
 * The sizes of a section's blocks, read as rfcParse leaves it, joined by
 * commas: `!` marks a block at an ambiguous page break, `>` one the next
 * block may continue.
 */
const wordsTestSizes = (id: string): string => {
  for (const sec of rfcParse(WORDS_TEST_RFC).sections) {
    if (sec.id === id) {
      const sizes: string[] = []
      for (const b of gateWordBlocks(sec.lines, sec.pageBreaks)) {
        sizes.push(`${b.words.length}${b.atBreak ? "!" : ""}${b.joinsNext ? ">" : ""}`)
      }
      return sizes.join(",")
    }
  }
  return "no section"
}

/** Where rfcParse removed page furniture from a section, as `at:line|`. */
const wordsTestBreaks = (id: string): string => {
  for (const sec of rfcParse(WORDS_TEST_RFC).sections) {
    if (sec.id === id) {
      return sec.pageBreaks.map((b: i32): string => `${b}:${sec.lines[b]}|`).join("")
    }
  }
  return "no section"
}

/** Blocks around page breaks and blank lines, each section's block sizes in order. */
const wordsTestPageBlocks = (t: Suite): void => {
  t.eqStr("rfcParse records a page break where it removed the furniture", wordsTestBreaks("5"), "9:|")
  t.eqStr("and one inside a run with no blank line around it", wordsTestBreaks("16"), "3:       000000c3  000000c4|")
  t.eqStr("a page break inside a grid leaves two blocks, both marked", wordsTestSizes("5"), "8!>,8!,2")
  t.eqStr("a blank line still ends a grid, and a page break before a sentence marks none", wordsTestSizes("6"), "4,4")
  t.eqStr("u16 and u64 blocks", wordsTestSizes("7"), "4,4,4,4")
  t.eqStr("two grids apart only by a page break", wordsTestSizes("8"), "2!>,2!,2")
  t.eqStr("a row of another width after a break ends the grid, unmarked", wordsTestSizes("9"), "2,2,2")
  t.eqStr("a row of another spelling after a break ends the grid, unmarked", wordsTestSizes("10"), "2,2,2")
  t.eqStr("a name = word line after a break", wordsTestSizes("11"), "2!>,1!,2")
  t.eqStr("a label line after a break", wordsTestSizes("12"), "2,2,2")
  t.eqStr("a grid ending at a break that ends its section", wordsTestSizes("13"), "2,2")
  t.eqStr("a grid starting a section after a break", wordsTestSizes("14"), "2,2")
  t.eqStr("three grids across two breaks", wordsTestSizes("15"), "2!>,2!>,2!,2")
  t.eqStr("a page break inside a run ends it, as a blank line does", wordsTestSizes("16"), "2!>,2!,2")
  t.eqStr("a row of another width after a break inside a run", wordsTestSizes("17"), "2,2,2")
  t.eqStr("a marked half printed again, whole, away from the break", wordsTestSizes("18"), "2!>,2!,2,2")
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

/** The grid each of §8 to §19 closes with, away from any page break. */
const WORDS_TEST_CLOSE: string = `{"words32": ["0000ff01", "0000ff02"]}`

/** The refusal of a value that meets an ambiguous page break. */
const WORDS_TEST_AT_BREAK: string = "meets a page break in RFC §"

/** One row: u32 `arg` (words, unlabelled unless `label`) in section `sec`, expecting its closing grid. */
const wordsTestBreak = (t: Suite, name: string, sec: string, arg: string, label: string, want: string): void => {
  wordsTestIs(t, name, wordsTestRow("words32", sec, wordsTestLit(arg, label), WORDS_TEST_CLOSE), want)
}

/** Fidelity over §5's grid split by a page break, §6's grids apart by a blank line, and §8 to §19. */
const wordsTestPageRows = (t: Suite): void => {
  const out = `{"words32": ["00000021", "00000022"]}`
  wordsTestIs(
    t,
    "a grid across a page break is refused",
    wordsTestRow("words32", "5", wordsTestLit(WORDS_TEST_SPLIT, ""), out),
    "16-word value meets a page break in RFC §5",
  )
  wordsTestIs(
    t,
    "a grid across a page break, under its label, is refused",
    wordsTestRow("words32", "5", `{"words32": [${WORDS_TEST_SPLIT}], "label": "Split State"}`, out),
    WORDS_TEST_AT_BREAK,
  )
  wordsTestIs(
    t,
    "the half of a grid above its page break is refused",
    wordsTestRow("words32", "5", wordsTestLit(WORDS_TEST_SPLIT_TOP, ""), out),
    "8-word value meets a page break",
  )
  wordsTestIs(
    t,
    "the half of a grid below its page break is refused",
    wordsTestRow("words32", "5", wordsTestLit(WORDS_TEST_SPLIT_BOTTOM, ""), out),
    "8-word value meets a page break",
  )
  wordsTestIs(
    t,
    "a run across the break, inside neither half, is refused",
    wordsTestRow("words32", "5", wordsTestLit(`"00000017", "00000018", "00000019", "0000001a"`, ""), out),
    "4-word value meets a page break",
  )
  wordsTestIs(
    t,
    "a run inside one half is only part of it",
    wordsTestRow("words32", "5", wordsTestLit(`"00000012", "00000013"`, ""), out),
    "2-word value is only part of a 8-word block",
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
  wordsTestIs(
    t,
    "a grid ending at a page break before a sentence",
    wordsTestRow("words32", "6", wordsTestLit(second, ""), wordsTestLit(first, "")),
    "",
  )
  const a = `"00000051", "00000052"`
  const b = `"00000053", "00000054"`
  wordsTestBreak(t, "two grids apart by a break, joined, are refused", "8", `${a}, ${b}`, "", WORDS_TEST_AT_BREAK)
  wordsTestBreak(t, "the grid before the break is refused", "8", a, "", WORDS_TEST_AT_BREAK)
  wordsTestBreak(t, "the grid after the break is refused", "8", b, "", WORDS_TEST_AT_BREAK)
  wordsTestBreak(
    t,
    "a word on either side of the break is refused",
    "8",
    `"00000052", "00000053"`,
    "",
    WORDS_TEST_AT_BREAK,
  )
  wordsTestBreak(
    t,
    "a value across the break, spelled with 0x against the print, is refused",
    "8",
    `"0x00000052", "0x00000053"`,
    "",
    WORDS_TEST_AT_BREAK,
  )
  wordsTestBreak(t, "the closing grid, away from the break", "8", `"0000ff01", "0000ff02"`, "", "an input is not")
  wordsTestBreak(t, "a grid before a row of another width", "9", `"00000061", "00000062"`, "", "")
  wordsTestBreak(t, "a grid before a row of another spelling", "10", `"00000071", "00000072"`, "", "")
  wordsTestBreak(t, "the row of another spelling after a break", "10", `"0x00000073", "0x00000074"`, "", "")
  wordsTestBreak(
    t,
    "a grid and a name = word line across a break, joined, are refused",
    "11",
    `"00000081", "00000082", "00000083"`,
    "",
    WORDS_TEST_AT_BREAK,
  )
  wordsTestBreak(
    t,
    "a grid before a name = word line across a break is refused",
    "11",
    `"00000081", "00000082"`,
    "",
    WORDS_TEST_AT_BREAK,
  )
  wordsTestBreak(t, "the name = word line after a break is refused", "11", `"00000083"`, "a", WORDS_TEST_AT_BREAK)
  wordsTestBreak(t, "a grid before a label line after a break", "12", `"00000091", "00000092"`, "", "")
  wordsTestBreak(t, "the labelled grid after the break", "12", `"00000093", "00000094"`, "Next State", "")
  wordsTestBreak(
    t,
    "the two grids around a label line are not one",
    "12",
    `"00000091", "00000092", "00000093", "00000094"`,
    "",
    "4-word value is not printed as one block",
  )
  wordsTestBreak(t, "a grid ending its section at a break", "13", `"000000a1", "000000a2"`, "", "")
  wordsTestBreak(t, "a grid starting its section after a break", "14", `"000000a3", "000000a4"`, "", "")
  wordsTestBreak(
    t,
    "three grids across two breaks, joined, are refused",
    "15",
    `"000000b1", "000000b2", "000000b3", "000000b4", "000000b5", "000000b6"`,
    "",
    WORDS_TEST_AT_BREAK,
  )
  wordsTestBreak(
    t,
    "a value across the second of two breaks is refused",
    "15",
    `"000000b4", "000000b5"`,
    "",
    WORDS_TEST_AT_BREAK,
  )
  wordsTestBreak(t, "the middle of three grids is refused", "15", `"000000b3", "000000b4"`, "", WORDS_TEST_AT_BREAK)
  wordsTestBreak(
    t,
    "a run with a page break inside it is refused",
    "16",
    `"000000c1", "000000c2", "000000c3", "000000c4"`,
    "",
    WORDS_TEST_AT_BREAK,
  )
  wordsTestBreak(
    t,
    "the run before a break inside it is refused",
    "16",
    `"000000c1", "000000c2"`,
    "",
    WORDS_TEST_AT_BREAK,
  )
  wordsTestBreak(
    t,
    "a grid before a row of another width, no blank line between",
    "17",
    `"000000d1", "000000d2"`,
    "",
    "",
  )
  const twin = `"000000e1", "000000e2"`
  wordsTestBreak(t, "a marked half printed whole elsewhere binds to that print", "18", twin, "", "")
  wordsTestBreak(t, "and binds under that print's label", "18", twin, "Twin State", "")
  wordsTestBreak(
    t,
    "but not under a label neither print has",
    "18",
    twin,
    "Split State",
    `under "Twin State", not under "Split State"`,
  )
  wordsTestBreak(
    t,
    "the other half, printed nowhere else, is refused",
    "18",
    `"000000e3", "000000e4"`,
    "",
    WORDS_TEST_AT_BREAK,
  )
  wordsTestBreak(
    t,
    "the whole split grid is still refused",
    "18",
    `${twin}, "000000e3", "000000e4"`,
    "",
    WORDS_TEST_AT_BREAK,
  )
  const tv2 = `{"section": "19", "case": "Test Vector #2"}`
  const caseRows: string[][] = [
    ["a test case's half-grid above its page break is refused", `"000000f3", "000000f4"`, WORDS_TEST_AT_BREAK],
    ["and the half below it", `"000000f5", "000000f6"`, WORDS_TEST_AT_BREAK],
    ["and the whole grid across it", `"000000f3", "000000f4", "000000f5", "000000f6"`, WORDS_TEST_AT_BREAK],
    [
      "another test case's grid is not printed in this one",
      `"000000f1", "000000f2"`,
      "2-word value is not printed as one block in RFC §19, Test Vector #2",
    ],
  ]
  for (const r of caseRows) {
    wordsTestIs(t, r[0], wordsTestCite("words32", tv2, wordsTestLit(r[1], ""), WORDS_TEST_CLOSE), r[2])
  }
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
