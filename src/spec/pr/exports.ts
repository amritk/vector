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
        const first = trim(splitLines(e.body)[0])
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

/** The first reason any of the contracts gives for leaving `name` out of scope, or null. */
const exportsOutOfScope = (cs: Contract[], name: string): string | null => {
  for (const c of cs) {
    const list = c.outOfScope
    if (list !== null) {
      for (const o of list) {
        if (o.name === name && trim(o.reason).length > 0) {
          return o.reason
        }
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
export const exportsJudge = (r: PrReport, c: Contract, changes: ExportsChange[]): void =>
  exportsJudgeAll(r, [c], changes, "")

/**
 * Judges a module's changed exports against every contract that targets it:
 * an export is covered when any of them tests it, or, when none does, any
 * lists it in outOfScope with a reason. One module tested by two specs (HMAC
 * by RFC 4231, PBKDF2 by RFC 7914) is judged on what the two cover together,
 * where each alone leaves the other's functions uncovered.
 *
 * @param r the report to fill
 * @param cs the contracts, all targeting the module
 * @param changes the exports that changed (exportsDiff)
 * @param where what each line starts with: "" for one module, `<file>: ` when the report covers several
 */
export const exportsJudgeAll = (r: PrReport, cs: Contract[], changes: ExportsChange[], where: string): void => {
  const tested: string[] = []
  for (const c of cs) {
    for (const name of exportsTested(c)) {
      tested.push(name)
    }
  }
  for (const ch of changes) {
    if (ch.kind === "unnamed") {
      r.items.push(`${where}unnamed ${ch.name}`)
      r.problems.push(
        `${where}${ch.why}: give it a declaration of its own the contract can test, since the gate refuses what it cannot name`,
      )
      continue
    }
    const isTested = tested.indexOf(ch.name) >= 0
    const reason = exportsOutOfScope(cs, ch.name)
    r.items.push(`${where}${ch.kind} ${ch.name}${isTested ? " (tested)" : ""}`)
    if (ch.kind === "deleted") {
      if (isTested) {
        const who = cs.length > 1 ? "a contract" : "the contract"
        r.problems.push(`${where}export ${ch.name} is deleted, but ${who} tests it: its test can no longer build`)
      } else {
        const tail = reason !== null ? ", so its outOfScope entry can go" : ""
        const who = cs.length > 1 ? "no contract tests it" : "the contract does not test it"
        r.notes.push(`${where}export ${ch.name} is deleted; ${who}${tail}`)
      }
    } else if (!isTested) {
      if (reason !== null) {
        r.notes.push(`${where}export ${ch.name} is ${ch.kind}, out of scope: ${reason}`)
      } else {
        const tail =
          cs.length > 1
            ? "no contract tests it or lists it in outOfScope with a reason"
            : "the contract neither tests it nor lists it in outOfScope with a reason"
        r.problems.push(`${where}export ${ch.name} is ${ch.kind}, but ${tail}`)
      }
    }
  }
}

/** The contracts that target one module, in the order the command line first names it. */
class ExportsModule {
  /** The module's file, from the nish root, such as std/crypto/hmac.ts. */
  file: string
  /** The contracts targeting it. */
  contracts: Contract[]

  /**
   * Makes a group.
   *
   * @param file the module's file
   * @param first the first contract targeting it
   */
  constructor(file: string, first: Contract) {
    this.file = file
    this.contracts = [first]
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
export const exportsCheck = (contractPath: string, nishRoot: string, base: string): Result<PrReport, string> =>
  exportsCheckAll([contractPath], nishRoot, base)

/**
 * Checks the exports a change makes to every module the contracts target:
 * each module once, against all the contracts that target it (exportsJudgeAll).
 *
 * @param contractPaths the contract files, at least one
 * @param nishRoot the nish checkout, a git work tree, whose std/ holds the modules
 * @param base the ref the change is against
 * @returns the report, or `Err` when no contract is given, a contract cannot
 *   be read, a target is outside nish, a module exists but cannot be read, or git fails
 */
export const exportsCheckAll = (contractPaths: string[], nishRoot: string, base: string): Result<PrReport, string> => {
  if (contractPaths.length === 0) {
    return Err("no contract given")
  }
  const modules: ExportsModule[] = []
  for (const contractPath of contractPaths) {
    const loaded = contractLoadFile(contractPath)
    if (loaded.isErr()) {
      return Err(`${contractPath}: not a contract: ${loaded.error.join("; ")}`)
    }
    const c = loaded.value
    const file = shapeNishModuleFile(c.target.module)
    if (file === null) {
      return Err(`${contractPath}: target.module ${c.target.module} is not a nish module (nish/<path>)`)
    }
    let found = false
    for (const m of modules) {
      if (m.file === file) {
        m.contracts.push(c)
        found = true
      }
    }
    if (!found) {
      modules.push(new ExportsModule(file, c))
    }
  }
  const fork = gitdiffForkPoint(nishRoot, base).orReturn()
  const prefix = gitdiffPrefix(nishRoot).orReturn()
  const top = gitdiffTop(nishRoot).orReturn()
  const files: string[] = []
  for (const m of modules) {
    files.push(m.file)
  }
  const r = new PrReport("exports", `spec exports of ${files.join(", ")} against ${base}`)
  for (const m of modules) {
    const before = gitdiffShow(top, fork, `${prefix}${m.file}`).orReturn()
    const after = readFileSyncOrNull(`${nishRoot}/${m.file}`)
    if (after === null && realpathSync(`${nishRoot}/${m.file}`) !== null) {
      return Err(
        `${nishRoot}/${m.file} exists but cannot be read as text: it is not deleted, so its exports cannot be judged`,
      )
    }
    if (before === null && after === null) {
      r.problems.push(`${m.file} exists neither at the fork point nor now: is ${nishRoot} the nish checkout?`)
      continue
    }
    exportsJudgeAll(r, m.contracts, exportsDiff(before ?? "", after ?? ""), modules.length > 1 ? `${m.file}: ` : "")
  }
  return Ok(r)
}
