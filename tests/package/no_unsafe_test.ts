import { Suite } from "nish/testing"
import { splitLines, trim } from "nish/text"

/** Whether a source line imports from `nish:unsafe`, in either quote style, on one line or the tail of a multi-line import. */
const unsafeImports = (line: string): boolean => {
  const cut = line.indexOf("//")
  let s = trim(cut >= 0 ? line.substring(0, cut) : line)
  if (s.endsWith("*/") && s.indexOf("/*") >= 0) {
    s = trim(s.substring(0, s.indexOf("/*")))
  }
  for (const q of ['"', "'"]) {
    const spec = `${q}nish:unsafe${q}`
    if (s.endsWith(spec) || s.endsWith(`${spec};`)) {
      return s.startsWith("import ") || s.startsWith("export ") || s.startsWith("} from ")
    }
  }
  return false
}

/** Appends every `.ts` file under a directory, recursively, to `out`. */
const unsafeFiles = (dir: string, out: string[]): void => {
  const names = readdirSync(dir) ?? []
  for (const n of names) {
    const path = `${dir}/${n}`
    if (isDirectorySync(path)) {
      unsafeFiles(path, out)
    } else if (n.endsWith(".ts")) {
      out.push(path)
    }
  }
}

/** No file under src/ imports `nish:unsafe`. */
export const main = (): i32 => {
  const t = new Suite("package/no_unsafe")

  // the matcher, on what it must take and what it must leave
  const rows: string[][] = [
    ['import { wrappingAdd } from "nish:unsafe"', "yes"],
    ["import { wrappingAdd } from 'nish:unsafe'", "yes"],
    ['import { wrappingAdd } from "nish:unsafe";', "yes"],
    ['} from "nish:unsafe"', "yes"],
    ['import "nish:unsafe"', "yes"],
    ['import { x } from "nish:unsafe" // note', "yes"],
    ['import { x } from "nish:unsafe"; // note', "yes"],
    ['import { x } from "nish:unsafe" /* c */', "yes"],
    ['// import { x } from "nish:unsafe"', "no"],
    [' * import { a } from "nish:unsafe"', "no"],
    ['export { x } from "nish:unsafe"', "yes"],
    ['import { sha256 } from "nish:crypto"', "no"],
    ["// the nish:unsafe module wraps", "no"],
    ['const s = "nish:unsafe is named here"', "no"],
    ['import { x } from "./nish:unsafe-notes"', "no"],
  ]
  for (const r of rows) {
    t.ok(`matcher: ${r[0]}`, unsafeImports(r[0]) === (r[1] === "yes"))
  }

  const files: string[] = []
  unsafeFiles("src", files)
  t.ok("src/ holds sources", files.length > 50)
  for (const f of files) {
    const text = readFileSyncOrNull(f) ?? ""
    let hit = false
    for (const line of splitLines(text)) {
      if (unsafeImports(line)) {
        hit = true
      }
    }
    t.ok(`${f} does not import nish:unsafe`, !hit)
  }
  return t.done()
}
