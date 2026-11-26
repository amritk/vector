import { Suite } from "nish/testing"
import { replaceAll, split } from "nish/text"
import { extractUnifiedDiff } from "../../../src/spec/extract"

/** `l1\n` .. `l<n>\n`, each line prefixed by `p`. */
const extractDiffBoundsLines = (p: string, n: i32): string => {
  const out: string[] = []
  for (let i = 1; i <= n; i++) {
    out.push(`${p}${i}\n`)
  }
  return out.join("")
}

/** The hunk headers of a diff. */
const extractDiffBoundsHunks = (diff: string): string =>
  split(diff, "\n")
    .filter((l: string): boolean => l.startsWith("@@"))
    .join(" ")

/** How many lines of a diff start with `c`, not counting the `---`/`+++` header. */
const extractDiffBoundsCount = (diff: string, c: string): i32 => {
  let n = 0
  for (const l of split(diff, "\n")) {
    if (l.startsWith(c) && !l.startsWith("---") && !l.startsWith("+++")) {
      n++
    }
  }
  return n
}

/** Hunks at the first and last line, where the context is cut short by the file's edge. */
const extractDiffBoundsEdges = (t: Suite): void => {
  const ten = extractDiffBoundsLines("l", 10)
  t.eqStr(
    "a change on the first line has no context before it",
    extractUnifiedDiff(ten, `x\n${ten.substring(3, ten.length)}`, "a", "b"),
    "--- a\n+++ b\n@@ -1,4 +1,4 @@\n-l1\n+x\n l2\n l3\n l4\n",
  )
  t.eqStr(
    "a change on the last line has no context after it",
    extractUnifiedDiff(ten, `${ten.substring(0, ten.length - 4)}x\n`, "a", "b"),
    "--- a\n+++ b\n@@ -7,4 +7,4 @@\n l7\n l8\n l9\n-l10\n+x\n",
  )
  t.eqStr(
    "a line inserted in the middle, with the same head and tail",
    extractUnifiedDiff("a\nb\n", "a\nm\nb\n", "x", "y"),
    "--- x\n+++ y\n@@ -1,2 +1,3 @@\n a\n+m\n b\n",
  )
  t.eqStr("two empty texts", extractUnifiedDiff("", "", "x", "y"), "")
  t.eqStr("no last newline on either side, the same text", extractUnifiedDiff("a\nb", "a\nb", "x", "y"), "")
  t.eqStr(
    "one change seven lines from each of two others: three hunks",
    extractDiffBoundsHunks(
      extractUnifiedDiff(
        extractDiffBoundsLines("l", 30),
        replaceAll(
          replaceAll(replaceAll(extractDiffBoundsLines("l", 30), "l3\n", "c\n"), "l11\n", "d\n"),
          "l19\n",
          "e\n",
        ),
        "x",
        "y",
      ),
    ),
    "@@ -1,6 +1,6 @@ @@ -8,7 +8,7 @@ @@ -16,7 +16,7 @@",
  )
}

/** Repeated lines, where the shared tail must not reach back into the shared head. */
const extractDiffBoundsRepeats = (t: Suite): void => {
  t.eqStr(
    "a repeated line added at the end",
    extractUnifiedDiff("a\na\n", "a\na\na\n", "x", "y"),
    "--- x\n+++ y\n@@ -1,2 +1,3 @@\n a\n a\n+a\n",
  )
  t.eqStr(
    "a repeated line removed from the end",
    extractUnifiedDiff("a\na\na\n", "a\na\n", "x", "y"),
    "--- x\n+++ y\n@@ -1,3 +1,2 @@\n a\n a\n-a\n",
  )
  t.eqStr(
    "two lines swapped: the first removed, the second kept",
    extractUnifiedDiff("a\nb\n", "b\na\n", "x", "y"),
    "--- x\n+++ y\n@@ -1,2 +1,2 @@\n-a\n b\n+a\n",
  )
}

/**
 * Past the cell limit the differing middle is not aligned line by line: every
 * line of it is removed and every line of the other side added, in one hunk
 * that keeps the shared head and tail as context.
 */
const extractDiffBoundsWhole = (t: Suite): void => {
  const a = `h1\nh2\n${extractDiffBoundsLines("a", 2001)}t1\n`
  const b = `h1\nh2\n${extractDiffBoundsLines("b", 2001)}t1\n`
  const d = extractUnifiedDiff(a, b, "x", "y")
  t.eqStr("one hunk over both whole sides", extractDiffBoundsHunks(d), "@@ -1,2004 +1,2004 @@")
  t.eqStr("every middle line removed", `${extractDiffBoundsCount(d, "-")}`, "2001")
  t.eqStr("every middle line added", `${extractDiffBoundsCount(d, "+")}`, "2001")
  t.ok("removals come before additions", d.indexOf("-a2001\n") < d.indexOf("+b1\n"))
  t.ok("the head and tail are context", d.indexOf(" h1\n h2\n-a1\n") > 0 && d.endsWith("+b2001\n t1\n"))
  // 2000 lines against 2001 is one column past the limit: the shared line goes too.
  const f = extractUnifiedDiff(
    `m\n${extractDiffBoundsLines("a", 1999)}`,
    `${extractDiffBoundsLines("b", 2000)}m\n`,
    "x",
    "y",
  )
  t.eqStr("one column past the limit, the shared line is removed", `${extractDiffBoundsCount(f, "-")}`, "2000")
  t.eqStr("one column past the limit, the shared line is added", `${extractDiffBoundsCount(f, "+")}`, "2001")
}

/** At exactly the cell limit the table is still built, so a line both middles share is kept. */
const extractDiffBoundsAtLimit = (t: Suite): void => {
  const a = `m\n${extractDiffBoundsLines("a", 1999)}`
  const b = `${extractDiffBoundsLines("b", 1999)}m\n`
  const d = extractUnifiedDiff(a, b, "x", "y")
  t.eqStr("at the limit, the shared line is not removed", `${extractDiffBoundsCount(d, "-")}`, "1999")
  t.eqStr("at the limit, the shared line is not added", `${extractDiffBoundsCount(d, "+")}`, "1999")
  t.ok("at the limit, the shared line is context", d.indexOf("+b1999\n m\n-a1\n") > 0)
}

/** The unified diff at the edges of its inputs and past its cell limit. */
export const main = (): i32 => {
  const t = new Suite("spec/extract diff bounds")
  extractDiffBoundsEdges(t)
  extractDiffBoundsRepeats(t)
  extractDiffBoundsWhole(t)
  extractDiffBoundsAtLimit(t)
  return t.done()
}
