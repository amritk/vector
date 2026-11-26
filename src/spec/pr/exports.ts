/**
 * `spec/pr/exports` — every export a PR adds to or changes in a contract's
 * target module is tested by the contract (one of its `functions`) or listed
 * in its `outOfScope` with a reason, so no new surface lands untested. An
 * export is compared by its declaration's text (gitdiffExports) between the
 * fork point from the base and the work tree. Deleting an export the contract
 * tests fails too: its test can no longer build. A change that adds an export
 * the scanner cannot name or resolve (`export *`, a re-export from another
 * module, `export { a }` of an imported `a`) fails closed.
 */

import { splitLines, trim } from "nish/text"
import { contractLoadFile } from "../contract/contract"
import { shapeNishModuleFile } from "../contract/shape"
import { Contract } from "../contract/types"
import { GitdiffExport, gitdiffExports, gitdiffForkPoint, gitdiffPrefix, gitdiffShow, gitdiffTop } from "./gitdiff"
import { PrReport } from "./report"

/** One export the change added, changed or deleted. */
export class ExportsChange {
  /** The name it exports; for an unnamed export, the line that declares it. */
  name: string
  /** "added", "changed", "deleted", or "unnamed" for an export the scanner cannot name or resolve. */
  kind: string
  /** For an unnamed export, where it is and why it cannot be named; "" otherwise. */
  why: string

  /**
   * Makes a change.
   *
   * @param name the name it exports
   * @param kind "added", "changed", "deleted" or "unnamed"
   * @param why where an unnamed export is and why it cannot be named, or ""
   */
  constructor(name: string, kind: string, why: string) {
    this.name = name
    this.kind = kind
    this.why = why
  }
}

/** The export named `name`, or null. */
const exportsFind = (list: GitdiffExport[], name: string): GitdiffExport | null => {
  for (const e of list) {
    if (e.name === name) {
      return e
    }
  }
  return null
}

/** Whether `list` has an unnamed export whose text is `body`. */
const exportsHasUnnamed = (list: GitdiffExport[], body: string): boolean => {
  for (const e of list) {
    if (e.name.length === 0 && e.body === body) {
      return true
    }
  }
  return false
}

/**
 * The exports that differ between two versions of a module: added and
 * changed in the order the new text declares them, then the deleted in the
 * order the old one did. An export the scanner cannot name or resolve is
 * "unnamed" unless the old text has it word for word.
 *
 * @param before the module at the fork point; "" when it did not exist
 * @param after the module now; "" when it is gone
 * @returns the changes
 */
export const exportsDiff = (before: string, after: string): ExportsChange[] => {
  const old = gitdiffExports(before)
  const now = gitdiffExports(after)
  const out: ExportsChange[] = []
  const seen = new Set<string>()
  for (const e of now) {
    if (e.name.length === 0) {
      if (!exportsHasUnnamed(old, e.body)) {
        // An empty body has no lines; its first line is then empty.
        const lines = splitLines(e.body)
        const first = trim(lines.length > 0 ? lines[0] : "")
        out.push(new ExportsChange(first, "unnamed", `line ${e.line}: ${e.problem}`))
      }
      continue
    }
    if (seen.has(e.name)) {
      continue
    }
    seen.add(e.name)
    const was = exportsFind(old, e.name)
    if (was === null) {
      out.push(new ExportsChange(e.name, "added", ""))
    } else if (was.body !== e.body) {
      out.push(new ExportsChange(e.name, "changed", ""))
    }
  }
  for (const e of old) {
    if (e.name.length > 0 && !seen.has(e.name)) {
      seen.add(e.name)
      out.push(new ExportsChange(e.name, "deleted", ""))
    }
  }
  return out
}

/**
 * The names a contract tests in its target module: its functions whose
 * module is the target's, or not given.
 *
 * @param c the contract
 * @returns the names
 */
export const exportsTested = (c: Contract): string[] => {
  const out: string[] = []
  for (const f of c.functions) {
    const m = f.module
    if (m === null || m === c.target.module) {
      out.push(f.name)
    }
  }
  return out
}

/** The reason the contract gives for leaving `name` out of scope, or null. */
const exportsOutOfScope = (c: Contract, name: string): string | null => {
  const list = c.outOfScope
  if (list !== null) {
    for (const o of list) {
      if (o.name === name) {
        return o.reason
      }
    }
  }
  return null
}

/**
 * Judges a module's changed exports against a contract.
 *
 * @param r the report to fill
 * @param c the contract
 * @param changes the exports that changed (exportsDiff)
 */
export const exportsJudge = (r: PrReport, c: Contract, changes: ExportsChange[]): void => {
  const tested = exportsTested(c)
  for (const ch of changes) {
    if (ch.kind === "unnamed") {
      r.items.push(`unnamed ${ch.name}`)
      r.problems.push(
        `${ch.why}: give it a declaration of its own the contract can test, since the gate refuses what it cannot name`,
      )
      continue
    }
    const isTested = tested.indexOf(ch.name) >= 0
    const reason = exportsOutOfScope(c, ch.name)
    r.items.push(`${ch.kind} ${ch.name}${isTested ? " (tested)" : ""}`)
    if (ch.kind === "deleted") {
      if (isTested) {
        r.problems.push(`export ${ch.name} is deleted, but the contract tests it: its test can no longer build`)
      } else {
        const tail = reason !== null ? ", so its outOfScope entry can go" : ""
        r.notes.push(`export ${ch.name} is deleted; the contract does not test it${tail}`)
      }
    } else if (!isTested) {
      if (reason !== null && trim(reason).length > 0) {
        r.notes.push(`export ${ch.name} is ${ch.kind}, out of scope: ${reason}`)
      } else {
        r.problems.push(
          `export ${ch.name} is ${ch.kind}, but the contract neither tests it nor lists it in outOfScope with a reason`,
        )
      }
    }
  }
}

/**
 * Checks the exports a change makes to a contract's target module, in the
 * nish checkout at `nishRoot`, against its fork point from `base`.
 *
 * @param contractPath the contract file
 * @param nishRoot the nish checkout, a git work tree, whose std/ holds the module
 * @param base the ref the change is against
 * @returns the report, or `Err` when the contract cannot be read, its target
 *   is outside nish, the module exists but cannot be read, or git fails
 */
export const exportsCheck = (contractPath: string, nishRoot: string, base: string): Result<PrReport, string> => {
  const loaded = contractLoadFile(contractPath)
  if (loaded.isErr()) {
    return Err(`${contractPath}: not a contract: ${loaded.error.join("; ")}`)
  }
  const c = loaded.value
  const file = shapeNishModuleFile(c.target.module)
  if (file === null) {
    return Err(`${contractPath}: target.module ${c.target.module} is not a nish module (nish/<path>)`)
  }
  const fork = gitdiffForkPoint(nishRoot, base).orReturn()
  const prefix = gitdiffPrefix(nishRoot).orReturn()
  const top = gitdiffTop(nishRoot).orReturn()
  const before = gitdiffShow(top, fork, `${prefix}${file}`).orReturn()
  const after = readFileSyncOrNull(`${nishRoot}/${file}`)
  if (after === null && realpathSync(`${nishRoot}/${file}`) !== null) {
    return Err(
      `${nishRoot}/${file} exists but cannot be read as text: it is not deleted, so its exports cannot be judged`,
    )
  }
  const r = new PrReport("exports", `spec exports of ${file} against ${base}`)
  if (before === null && after === null) {
    r.problems.push(`${file} exists neither at the fork point nor now: is ${nishRoot} the nish checkout?`)
    return Ok(r)
  }
  exportsJudge(r, c, exportsDiff(before ?? "", after ?? ""))
  return Ok(r)
}
