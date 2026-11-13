/**
 * `spec/pr/frozen` — a PR changes the spec side (specs/, contracts/, rfcs/)
 * or the implementation, never both, so a test cannot be loosened to match
 * the code it tests. A path's side is decided by the path, with one
 * exception: a generated test under `test/spec/` is spec side while its one
 * `// vector-contract-sha256:` line names a contract the gate checks. Every
 * contract checked must load, read every source it declares (each must still
 * be the file and SHA-256 it records), and pin its main source. Fails closed:
 * a git error, an unreadable contract or a missing source is a failure.
 */

import { split } from "nish/text"
import { sha256Hex } from "../../core/hex"
import { contractLoadFile } from "../contract/contract"
import { Contract } from "../contract/types"
import { sourceDecls, sourceLoad, sourceMainId } from "../source/load"
import { gitdiffChangedPaths, gitdiffCompare, gitdiffTop } from "./gitdiff"
import { PrReport } from "./report"
import { staleShaLines } from "./stale"

/** A path on the spec side: a spec, a contract, or a document a contract quotes. */
export const FROZEN_SPEC: i32 = 0
/** A generated test naming a contract the gate checks: spec side. */
export const FROZEN_GENERATED: i32 = 1
/** A path on neither side: docs/ and top-level markdown. */
export const FROZEN_NEUTRAL: i32 = 2
/** Everything else, tests and configuration included. */
export const FROZEN_IMPLEMENTATION: i32 = 3

/** Where generated tests live, from the repository's top. */
export const FROZEN_EMITTED_TESTS: string = "test/spec/"

/** The suffix of a contract's allowSurvivors sidecar: not a contract. */
export const FROZEN_SIDECAR_SUFFIX: string = ".survivors.json"

/**
 * A changed path's side, by the path alone.
 *
 * @param path the path from the repository's top
 * @returns FROZEN_SPEC, FROZEN_NEUTRAL or FROZEN_IMPLEMENTATION
 */
export const frozenPathKind = (path: string): i32 => {
  if (path.startsWith("specs/") || path.startsWith("contracts/") || path.startsWith("rfcs/")) {
    return FROZEN_SPEC
  }
  if (path.startsWith("docs/") || (path.indexOf("/") < 0 && path.endsWith(".md"))) {
    return FROZEN_NEUTRAL
  }
  return FROZEN_IMPLEMENTATION
}

/**
 * A side's name, as the report prints it.
 *
 * @param kind a FROZEN_* side
 * @returns its name
 */
export const frozenKindName = (kind: i32): string => {
  if (kind === FROZEN_SPEC) {
    return "spec"
  }
  if (kind === FROZEN_GENERATED) {
    return "generated"
  }
  if (kind === FROZEN_NEUTRAL) {
    return "neutral"
  }
  return "implementation"
}

/** Whether a contract pins its main source's SHA-256, on the source or on `source.sha256`. */
const frozenMainPinned = (c: Contract): boolean => {
  const main = sourceMainId(c)
  for (const d of sourceDecls(c)) {
    if (d.id === main && d.sha256 !== null) {
      return true
    }
  }
  return c.source.sha256 !== null
}

/** `path` from the repository's top when it is inside it, else as given. */
const frozenShown = (path: string, top: string): string =>
  path.startsWith(`${top}/`) ? path.substring(top.length + 1) : path

/** Whether `path` is itself a symbolic link. */
const frozenIsLink = (path: string): boolean => {
  const st = lstatOwnerModeSync(path)
  return st >= 0 && (st & 0o170000) === 0o120000
}

/** `path`, under `top`, unless it or a directory between them is a symbolic link. */
const frozenUnlinked = (top: string, path: string): Result<string, string> => {
  let at = top
  for (const seg of split(path.substring(top.length + 1), "/")) {
    if (seg.length === 0) {
      continue
    }
    at = `${at}/${seg}`
    if (frozenIsLink(at)) {
      return Err(
        `${frozenShown(path, top)}: ${frozenShown(at, top)} is a symbolic link: the gate reads only the repository's own files`,
      )
    }
  }
  return Ok(path)
}

/**
 * An absolute `given` that reaches the top through a link above it (as /tmp
 * may be one on macOS, where git names the real directory), rewritten from
 * the top; null when no leading directory of it is the top. Only what leads
 * to the top is resolved: a link below it is still refused.
 */
const frozenUnderTop = (top: string, given: string): string | null => {
  for (let at = given.indexOf("/", 1); at > 0; at = given.indexOf("/", at + 1)) {
    const real = realpathSync(given.substring(0, at))
    if (real !== null && real === top) {
      return `${top}${given.substring(at)}`
    }
  }
  return null
}

/**
 * A contract path as given, made absolute against the repository's top:
 * relative paths are read from the top, not the working directory, and no
 * path may leave it, through `..`, by being absolute elsewhere, or through a
 * symbolic link below the top (the contract itself or a directory above it).
 *
 * @param top the repository's top
 * @param given the path as given
 * @returns the absolute path, or `Err` naming why it is refused
 */
export const frozenResolve = (top: string, given: string): Result<string, string> => {
  for (const seg of split(given, "/")) {
    if (seg === "..") {
      return Err(`${given}: a contract path may not climb with ..: give it from the repository's top`)
    }
  }
  if (given.startsWith("/")) {
    const inside = given.startsWith(`${top}/`) ? given : frozenUnderTop(top, given)
    if (inside === null) {
      return Err(`${given}: outside the repository at ${top}: the gate checks only its own contracts`)
    }
    return frozenUnlinked(top, inside)
  }
  return frozenUnlinked(top, `${top}/${given}`)
}

/**
 * Why a contract does not hold to the sources it records.
 *
 * @param path the contract file
 * @param top the repository's top, whose specs/ and rfcs/ hold its sources
 * @returns every problem, each prefixed with the contract's path from the
 *   top; none when it holds
 */
export const frozenContractProblems = (path: string, top: string): string[] => {
  const out: string[] = []
  const name = frozenShown(path, top)
  const loaded = contractLoadFile(path)
  if (loaded.isErr()) {
    for (const e of loaded.error) {
      out.push(`${name}: not a contract: ${e}`)
    }
    return out
  }
  const c = loaded.value
  if (sourceMainId(c).length === 0) {
    out.push(`${name}: names no main source: give source.rfc or source.main`)
  } else if (!frozenMainPinned(c)) {
    out.push(`${name}: its main source is not pinned: record its SHA-256 in source.sha256`)
  }
  const set = sourceLoad(c, path, top)
  for (const p of set.problems) {
    out.push(`${name}: ${p}`)
  }
  return out
}

/**
 * The contracts the gate checks when none are given: every contracts/*.json
 * at the repository's top but the allowSurvivors sidecars, sorted.
 *
 * @param top the repository's top
 * @returns their paths
 */
export const frozenDefaultContracts = (top: string): string[] => {
  const out: string[] = []
  const names = readdirSync(`${top}/contracts`)
  if (names === null) {
    return out
  }
  names.sort(gitdiffCompare)
  for (const n of names) {
    if (n.endsWith(".json") && !n.endsWith(FROZEN_SIDECAR_SUFFIX)) {
      out.push(`${top}/contracts/${n}`)
    }
  }
  return out
}

/**
 * Checks the work tree of `repo` against its fork point from `base`.
 *
 * @param repo the repository, or a directory inside it
 * @param base the ref the change is against
 * @param contracts the contracts to check, from the repository's top
 *   (frozenResolve); empty for frozenDefaultContracts
 * @returns the report, or `Err` when git fails or the base is refused
 */
export const frozenCheck = (repo: string, base: string, contracts: string[]): Result<PrReport, string> => {
  const top = gitdiffTop(repo).orReturn()
  const paths = gitdiffChangedPaths(top, base).orReturn()
  const r = new PrReport("frozen", `spec frozen against ${base}`)
  const files: string[] = []
  const contractProblems: string[] = []
  const given = contracts.length > 0 ? contracts : frozenDefaultContracts(top)
  for (const g of given) {
    const f = frozenResolve(top, g)
    if (f.isErr()) {
      r.items.push(`✗ contract ${g}`)
      contractProblems.push(f.error)
    } else if (!f.value.endsWith(FROZEN_SIDECAR_SUFFIX)) {
      files.push(f.value)
    }
  }
  if (files.length === 0 && contractProblems.length === 0) {
    contractProblems.push("no contracts to check: give them, or keep them in contracts/")
  }
  const shas = new Set<string>()
  for (const f of files) {
    const text = readFileSyncOrNull(f)
    if (text !== null) {
      shas.add(sha256Hex(text))
    }
    const problems = frozenContractProblems(f, top)
    r.items.push(`${problems.length === 0 ? "✓" : "✗"} contract ${frozenShown(f, top)}`)
    for (const p of problems) {
      contractProblems.push(p)
    }
  }
  const spec: string[] = []
  const impl: string[] = []
  for (const p of paths) {
    let kind = frozenPathKind(p)
    if (kind === FROZEN_IMPLEMENTATION && p.startsWith(FROZEN_EMITTED_TESTS)) {
      const text = readFileSyncOrNull(`${top}/${p}`)
      if (text !== null) {
        const named = staleShaLines(text)
        if (named.length === 1 && shas.has(named[0])) {
          kind = FROZEN_GENERATED
        }
      }
    }
    r.items.push(`${frozenKindName(kind)} ${p}`)
    if (kind === FROZEN_SPEC || kind === FROZEN_GENERATED) {
      spec.push(p)
    } else if (kind === FROZEN_IMPLEMENTATION) {
      impl.push(p)
    }
  }
  if (spec.length > 0 && impl.length > 0) {
    r.problems.push(
      `the change touches the spec side (${spec.join(", ")}) and the implementation (${impl.join(", ")}): change them in separate PRs`,
    )
  }
  for (const p of contractProblems) {
    r.problems.push(p)
  }
  return Ok(r)
}
