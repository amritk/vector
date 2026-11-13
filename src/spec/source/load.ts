/**
 * `spec/source/load` — a contract's sources, found, confined, pinned and
 * read. Each source the contract declares (or, with no `sources`, the one RFC
 * `source.rfc` names) is resolved inside the repository (sourcePath), checked
 * against the SHA-256 it pins, refused if it hides text from the gates
 * (hidden), and read into its sections (rfc). Every problem is collected, so
 * one run names them all.
 */

import { sha256Hex } from "../../core/hex"
import { Contract, SourceDecl } from "../contract/types"
import { sourceCandidate, sourceConfine, sourceFetchHint } from "./path"
import { RfcDocument, rfcRead } from "./rfc"

/** One source, read. */
export class LoadedSource {
  /** The id requirements and vectors cite it by. */
  id: string
  /** The resolved file it was read from. */
  file: string
  doc: RfcDocument
  /**
   * Makes a loaded source.
   *
   * @param id the source's id
   * @param file the resolved file
   * @param doc its sections
   */
  constructor(id: string, file: string, doc: RfcDocument) {
    this.id = id
    this.file = file
    this.doc = doc
  }
}

/** A contract's sources: those read, and why the others were not. */
export class SourceSet {
  /** The id of the source a citation without one refers to; "" when none. */
  main: string
  sources: LoadedSource[]
  problems: string[]
  /** Makes an empty set. */
  constructor() {
    this.main = ""
    this.sources = []
    this.problems = []
  }
}

/**
 * The sources a contract declares: its `sources`, or, without them, the RFC
 * `source.rfc` names, as the source `rfc<n>`.
 *
 * @param contract the contract
 * @returns the declarations, in order; empty when it names none
 */
export const sourceDecls = (contract: Contract): SourceDecl[] => {
  const declared = contract.sources
  if (declared !== null) {
    return declared
  }
  const out: SourceDecl[] = []
  if (contract.source.rfc >= 1) {
    const d = new SourceDecl()
    d.id = `rfc${contract.source.rfc}`
    d.rfc = contract.source.rfc
    out.push(d)
  }
  return out
}

/**
 * The id of a contract's main source: `source.main`, else `rfc<n>` from
 * `source.rfc`.
 *
 * @param contract the contract
 * @returns the id, or "" when it names neither
 */
export const sourceMainId = (contract: Contract): string => {
  const main = contract.source.main
  if (main !== null) {
    return main
  }
  return contract.source.rfc >= 1 ? `rfc${contract.source.rfc}` : ""
}

/** Reads one source, or says why it cannot be. */
const sourceLoadOne = (
  decl: SourceDecl,
  pin: string | null,
  contractPath: string,
  root: string,
): Result<LoadedSource, string> => {
  const candidate = sourceCandidate(decl, contractPath, root).orReturn()
  const confined = sourceConfine(root, candidate)
  if (confined.isErr()) {
    if (decl.file === null && decl.path === null && confined.error.endsWith(": no such file")) {
      return Err(`rfc${decl.rfc} not found; fetch it: ${sourceFetchHint(decl.rfc)}`)
    }
    return Err(`source ${decl.id}: ${confined.error}`)
  }
  const real = confined.value
  const text = readFileSyncOrNull(real)
  if (text === null) {
    return Err(`source ${decl.id}: cannot read ${candidate}`)
  }
  if (pin !== null) {
    const got = sha256Hex(text)
    if (got !== pin) {
      return Err(`source ${decl.id}: ${candidate} has SHA-256 ${got}, but the contract pins ${pin}: the source changed`)
    }
  }
  const doc = rfcRead(text, candidate)
  if (doc.isErr()) {
    return Err(`source ${decl.id}: ${doc.error}`)
  }
  if (decl.rfc >= 1 && doc.value.number !== decl.rfc) {
    return Err(`source ${decl.id}: ${candidate} is RFC ${doc.value.number}, not RFC ${decl.rfc}`)
  }
  return Ok(new LoadedSource(decl.id, real, doc.value))
}

/**
 * Reads every source a contract declares. A file is read only from inside
 * the repository root, after every symbolic link is followed; it must match
 * the SHA-256 its declaration pins (the main source may pin it on
 * `source.sha256` instead), be an RFC's plain text, hide nothing from the
 * gates, and, when the declaration gives an RFC number, be that RFC.
 *
 * @param contract the contract
 * @param contractPath the contract's own path, which `path` is relative to
 * @param root the repository root, which `file` and `rfcs/` are relative to
 * @returns the sources read, and a problem for each one that was not
 */
export const sourceLoad = (contract: Contract, contractPath: string, root: string): SourceSet => {
  const set = new SourceSet()
  set.main = sourceMainId(contract)
  for (const decl of sourceDecls(contract)) {
    let pin = decl.sha256
    if (pin === null && decl.id === set.main) {
      pin = contract.source.sha256
    }
    const one = sourceLoadOne(decl, pin, contractPath, root)
    if (one.isErr()) {
      set.problems.push(one.error)
    } else {
      set.sources.push(one.value)
    }
  }
  return set
}

/**
 * A source by its id; null as the id means the main source.
 *
 * @param set the sources read
 * @param id the id a citation gives, or null for the main source
 * @returns the source, or null when it was not read
 */
export const sourceFind = (set: SourceSet, id: string | null): LoadedSource | null => {
  const want = id !== null ? id : set.main
  for (const s of set.sources) {
    if (s.id === want) {
      return s
    }
  }
  return null
}
