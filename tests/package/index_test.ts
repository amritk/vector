import { Suite } from "nish/testing"
import { splitLines, trim, trimEnd } from "nish/text"
import { joinPath, makeTempDir, mkdirAll } from "../../src/core/fs"
import { runProcess } from "../../src/core/process"
import { VECTOR_VERSION, vectorAgentsDoc, vectorDiffJson, vectorRun, vectorVerifyJson } from "../../src/index"

const indexRead = (path: string): string => readFileSyncOrNull(path) ?? ""

/** Where docs/AI.md is named when a checkout does not hold it. */
const INDEX_AI_DOC_URL: string = "https://github.com/amritk/vector/blob/main/docs/AI.md"

/**
 * Checks vectorAgentsDoc over roots whose docs/AI.md is absent, a file, or a
 * directory: only a file is named by its path, and the rest by the URL.
 */
const indexAgentsDocCases = (t: Suite): void => {
  const made = makeTempDir("vector-agents-")
  if (made.isErr()) {
    t.fail("agents doc: temp dir", made.error)
    return
  }
  const tmp = made.value
  // name, the docs/AI.md to make under the root ("" none, "file", "dir"), and whether its path is named
  const cases: string[][] = [
    ["no docs/AI.md", "", "url"],
    ["docs/AI.md is a file", "file", "path"],
    ["docs/AI.md is a directory", "dir", "url"],
  ]
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i]
    const root = joinPath(tmp, `root${i}`)
    const doc = joinPath(root, "docs/AI.md")
    if (c[1] === "file") {
      t.ok(`agents doc: ${c[0]}: make it`, mkdirAll(joinPath(root, "docs"), 0o755).isOk())
      writeFileSync(doc, "# rules\n")
    } else if (c[1] === "dir") {
      t.ok(`agents doc: ${c[0]}: make it`, mkdirAll(doc, 0o755).isOk())
    } else {
      t.ok(`agents doc: ${c[0]}: make it`, mkdirAll(root, 0o755).isOk())
    }
    t.eqStr(`agents doc: ${c[0]}`, vectorAgentsDoc(root), c[2] === "path" ? doc : INDEX_AI_DOC_URL)
  }
  t.eqStr("agents doc: a root that does not exist", vectorAgentsDoc(joinPath(tmp, "missing")), INDEX_AI_DOC_URL)
  const removed = runProcess(["rm", "-rf", tmp], "", 10000)
  t.ok("agents doc: clean up", removed.isOk() && removed.value.status === 0)
}

/** Checks that the built binary's --help names this checkout's docs/AI.md, and that it exists. */
const indexAgentsDocBinary = (t: Suite): void => {
  const root = realpathSync(".")
  if (root === null) {
    t.fail("agents doc: --help", "cannot resolve the checkout")
    return
  }
  t.eqStr("agents doc: this checkout", vectorAgentsDoc(root), joinPath(root, "docs/AI.md"))
  const r = runProcess(["dist/vector", "--help"], "", 10000)
  if (r.isErr()) {
    t.fail("agents doc: --help", r.error)
    return
  }
  t.eqI32("agents doc: --help exits 0", r.value.status, 0)
  const lines = splitLines(trimEnd(r.value.stdout))
  const last = lines.length > 0 ? trim(lines[lines.length - 1]) : ""
  t.eqStr("agents doc: --help names this checkout's docs/AI.md", last, joinPath(root, "docs/AI.md"))
  t.ok("agents doc: the file --help names exists", last.startsWith("/") && readFileSyncOrNull(last) !== null)
}

export const main = (): i32 => {
  const t = new Suite("package/index")
  t.eqStr("version", VECTOR_VERSION, "0.4.0") // x-release-please-version

  const spec = indexRead("tests/fixtures/currency-spec.json")
  const program = indexRead("tests/fixtures/currency.json")
  const proven = vectorVerifyJson(spec, program)
  t.ok("verify parses", proven.isOk())
  if (proven.isOk()) {
    t.contains("verify proves", proven.value, `"status": "PROVEN"`)
  }
  const refuted = vectorVerifyJson(indexRead("tests/fixtures/unsat-spec.json"), indexRead("tests/fixtures/unsat.json"))
  if (refuted.isOk()) {
    t.contains("verify refutes", refuted.value, `"status": "REFUTED"`)
  } else {
    t.fail("verify refutes", refuted.error)
  }
  t.ok("verify refuses text that is not JSON", vectorVerifyJson("{", program).isErr())

  const same = vectorDiffJson(program, program)
  if (same.isOk()) {
    t.contains("diff of a program with itself", same.value, `"status": "EQUIVALENT"`)
  } else {
    t.fail("diff of a program with itself", same.error)
  }
  t.ok("diff refuses text that is not JSON", vectorDiffJson(program, "not json").isErr())

  t.eqI32(
    "run: an unreadable file is exit 2",
    vectorRun(["diff", "tests/fixtures/missing-a.json", "tests/fixtures/missing-b.json"]),
    2,
  )
  t.eqI32(
    "run: a proof is exit 0",
    vectorRun(["diff", "tests/fixtures/currency.json", "tests/fixtures/currency.json"]),
    0,
  )
  indexAgentsDocCases(t)
  indexAgentsDocBinary(t)
  return t.done()
}
