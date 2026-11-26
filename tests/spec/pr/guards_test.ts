import { Suite } from "nish/testing"
import { gitdiffExportName, gitdiffExports, gitdiffHunk, gitdiffParse } from "../../../src/spec/pr/gitdiff"
import { renameBlankShas } from "../../../src/spec/pr/rename"

/** A hunk header's first line and count as `first,count`, or "null". */
const guardsTestHunk = (line: string): string => {
  const h = gitdiffHunk(line)
  if (h === null) {
    return "null"
  }
  const hunk: i32[] = h
  return hunk.length < 2 ? "short" : `${hunk[0]},${hunk[1]}`
}

/** The ranges a one-hunk diff of `x` adds, joined by ",", or "ERR". */
const guardsTestParse = (header: string): string => {
  const r = gitdiffParse(`diff --git a/x b/x\n--- a/x\n+++ b/x\n${header}\n+a\n`)
  if (r.isErr()) {
    return "ERR"
  }
  if (r.value.length !== 1) {
    return `files ${r.value.length}`
  }
  const out: string[] = []
  for (const n of r.value[0].ranges) {
    out.push(`${n}`)
  }
  return out.join(",")
}

/** The name of `source`'s first export, or `ERR <why>`. */
const guardsTestName = (source: string): string => {
  const r = gitdiffExportName(source)
  return r.isErr() ? `ERR ${r.error}` : r.value
}

/** The line of the one export a module it cannot read answers, or "ERR". */
const guardsTestLexLine = (text: string): string => {
  const list = gitdiffExports(text)
  return list.length === 1 ? `${list[0].line}` : "ERR"
}

export const main = (): i32 => {
  const t = new Suite("spec/pr guards")
  t.eqStr("a nine is a digit", guardsTestHunk("@@ -1 +9,9 @@"), "9,9")
  t.eqStr("ten digits are refused", guardsTestHunk("@@ -1 +1234567890 @@"), "null")
  t.eqStr("nine digits read", guardsTestHunk("@@ -1 +123456789,987654321 @@"), "123456789,987654321")
  t.eqStr("the largest count reads", guardsTestHunk("@@ -1 +999999999,999999999 @@"), "999999999,999999999")
  t.eqStr("a trailing letter is refused", guardsTestHunk("@@ -1 +1x @@"), "null")
  t.eqStr("a letter in the count is refused", guardsTestHunk("@@ -1 +1,2x @@"), "null")
  t.eqStr("a lone letter is refused", guardsTestHunk("@@ -1 +x @@"), "null")
  t.eqStr("an empty count is refused", guardsTestHunk("@@ -1 +1, @@"), "null")
  t.eqStr("a sign is refused", guardsTestHunk("@@ -1 +-1 @@"), "null")
  t.eqStr("the largest hunk is read", guardsTestParse("@@ -1 +999999999,999999999 @@"), "999999999,1999999997")
  t.eqStr("a zero first line is read", guardsTestParse("@@ -1 +0,1 @@"), "0,0")
  t.eqStr("a ten-digit count is refused", guardsTestParse("@@ -1 +1,1000000000 @@"), "ERR")
  t.eqStr("a trailing letter refuses the diff", guardsTestParse("@@ -1 +1x @@"), "ERR")
  t.eqStr("a list exports a name spelled type", guardsTestName("const type = 1\nexport { type }\n"), "type")
  t.eqStr("a list exports a type-only entry", guardsTestName("type T = 1\nexport { type T }\n"), "T")
  t.eqStr("an unreadable line 9 is named", guardsTestLexLine("\n\n\n\n\n\n\n\nexport const b = /x/\n"), "9")
  t.eqStr(
    "an unreadable line 19 is named",
    guardsTestLexLine("\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\nexport const b = /x/\n"),
    "19",
  )
  t.eqStr(
    "a key's closing quote starts no second key",
    renameBlankShas('{"sha256"sha256": "abc"}'),
    '{"sha256"sha256": "abc"}',
  )
  t.eqStr("a key's value is blanked", renameBlankShas('{"sha256": "abc"}'), '{"sha256": ""}')
  return t.done()
}
