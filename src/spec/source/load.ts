/**
 * `spec/source/load` — a contract's sources, found, confined, pinned and
 * read. Each source the contract declares (and the one RFC `source.rfc`
 * names, when no `source.main` picks another) is located (sourceCandidate),
 * read only if it is spec text (sourceReadConfined), checked against the file
 * it records and the SHA-256 it pins, refused if it hides text from the gates
 * (hidden), and read into its sections by the reader its extension selects.
 * Every problem is collected, so one run names them all.
 */

import { Contract, SourceDecl } from "../contract/types"
import { hiddenProblem } from "./hidden"
import { SourceRead, sourceCandidate, sourceLabel, sourceReadConfined } from "./path"
import { RfcDocument, rfcRead } from "./rfc"

/** Reads a source's text into sections; `name` names it in messages. */
export type SourceReader = (text: string, name: string) => Result<RfcDocument, string>

/** A reader and the file extension it reads. */
export class SourceReaderEntry {
  /** The extension, with its dot: ".txt". */
  ext: string
  read: SourceReader
  /**
   * Makes an entry.
   *
   * @param ext the extension, with its dot
   * @param read the reader
   */
  constructor(ext: string, read: SourceReader) {
    this.ext = ext
    this.read = read
  }
}

/** The readers a load may use, by file extension. */
export class SourceReaders {
  entries: SourceReaderEntry[]
  /** Makes an empty registry. */
  constructor() {
    this.entries = []
  }
}

/**
 * Registers a reader for an extension, replacing one already there.
 *
 * @param readers the registry
 * @param ext the extension, with its dot: ".xml"
 * @param read the reader
 */
export const sourceReadersAdd = (readers: SourceReaders, ext: string, read: SourceReader): void => {
  for (const e of readers.entries) {
    if (e.ext === ext) {
      e.read = read
      return
    }
  }
  readers.entries.push(new SourceReaderEntry(ext, read))
}

/**
 * The readers every load has: an RFC's plain text, `.txt`. Other stages
 * register theirs (the XML of an RFC or a spec) with sourceReadersAdd.
 *
 * @returns a registry holding `.txt`
 */
export const sourceReadersDefault = (): SourceReaders => {
  const r = new SourceReaders()
  sourceReadersAdd(r, ".txt", rfcRead)
  return r
}

/** The extension of the last component of `path`, with its dot; "" without one. */
const sourceExtOf = (path: string): string => {
  let i = path.length - 1
  while (i >= 0) {
    const c = path.charCodeAt(i)
    if (c === 0x2f) {
      return ""
    }
    if (c === 0x2e) {
      return path.substring(i)
    }
    i = i - 1
  }
  return ""
}

/**
 * The entry that reads `path`, by its extension.
 *
 * @param readers the registry
 * @param path the file's path or name
 * @returns the entry, or null when no reader is registered for it
 */
export const sourceReaderFor = (readers: SourceReaders, path: string): SourceReaderEntry | null => {
  const ext = sourceExtOf(path)
  for (const e of readers.entries) {
    if (e.ext === ext) {
      return e
    }
  }
  return null
}

/** One source, read. */
export class LoadedSource {
  /** The id requirements and vectors cite it by. */
  id: string
  /** The resolved file it was read from. */
  file: string
  /** How its `file` records it (sourceLabel); the resolved file when none can. */
  label: string
  doc: RfcDocument
  /**
   * Makes a loaded source.
   *
   * @param id the source's id
   * @param file the resolved file
   * @param label how its `file` records it
   * @param doc its sections
   */
  constructor(id: string, file: string, label: string, doc: RfcDocument) {
    this.id = id
    this.file = file
    this.label = label
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
 * The sources a contract declares: its `sources`, and, unless `source.main`
 * names one of them, the RFC `source.rfc` names as the source `rfc<n>`, first
 * (left out when `sources` already declares that id).
 *
 * @param contract the contract
 * @returns the declarations, in order; empty when it names none
 */
export const sourceDecls = (contract: Contract): SourceDecl[] => {
  const out: SourceDecl[] = []
  const declared = contract.sources
  const n = contract.source.rfc
  if (contract.source.main === null && n >= 1) {
    let listed = false
    if (declared !== null) {
      for (const d of declared) {
        if (d.id === `rfc${n}`) {
          listed = true
        }
      }
    }
    if (!listed) {
      const d = new SourceDecl()
      d.id = `rfc${n}`
      d.rfc = n
      out.push(d)
    }
  }
  if (declared !== null) {
    for (const d of declared) {
      out.push(d)
    }
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

/**
 * Why the file read for a source is not the one it records: no `file` can
 * name it, its `file` names another, or its bytes are not the ones pinned.
 *
 * @param decl the source
 * @param pin the SHA-256 it pins, or null
 * @param read what was read
 * @param label how a `file` names it (sourceLabel), or null when none can
 * @returns the problem, or null when it is the file recorded
 */
export const sourceRecordedProblem = (
  decl: SourceDecl,
  pin: string | null,
  read: SourceRead,
  label: string | null,
): string | null => {
  const shown = label ?? read.real
  const file = decl.file
  if (file !== null) {
    if (label === null) {
      return `source ${decl.id} was read from ${shown}, which its file cannot name: it is under no specs/ or rfcs/ of the contract's repo or of the root, nor beside the contract`
    }
    if (label !== file) {
      return `source ${decl.id} was read from ${shown}, but its file is ${file}`
    }
  }
  if (pin !== null && read.sha256 !== pin) {
    return `source ${decl.id} (${shown}) has SHA-256 ${read.sha256}, but the contract pins ${pin}: the source changed`
  }
  return null
}

/** Reads one source, or says why it cannot be. */
const sourceLoadOne = (
  decl: SourceDecl,
  pin: string | null,
  contractPath: string,
  root: string,
  readers: SourceReaders,
): Result<LoadedSource, string> => {
  const candidate = sourceCandidate(decl, contractPath, root).orReturn()
  const read = sourceReadConfined(decl, candidate, contractPath, root).orReturn()
  const label = sourceLabel(read.real, contractPath, root)
  const recorded = sourceRecordedProblem(decl, pin, read, label)
  if (recorded !== null) {
    return Err(recorded)
  }
  const shown = label ?? read.real
  const reader = sourceReaderFor(readers, read.real)
  if (reader === null) {
    const ext = sourceExtOf(read.real)
    const kind = ext.length > 0 ? `a ${ext} file` : "a file without an extension"
    return Err(
      `source ${decl.id}: ${shown} is ${kind}, and no reader is registered for it: give the source's plain text (.txt)`,
    )
  }
  const hidden = hiddenProblem(read.text, shown)
  if (hidden !== null) {
    return Err(`source ${decl.id}: ${hidden}`)
  }
  const doc = reader.read(read.text, shown)
  if (doc.isErr()) {
    return Err(`source ${decl.id}: ${doc.error}`)
  }
  if (decl.rfc >= 1 && doc.value.number !== decl.rfc) {
    return Err(`source ${decl.id}: ${shown} is RFC ${doc.value.number}, not RFC ${decl.rfc}`)
  }
  return Ok(new LoadedSource(decl.id, read.real, shown, doc.value))
}

/**
 * Reads every source a contract declares (sourceDecls), with the readers
 * sourceReadersDefault holds.
 *
 * @param contract the contract
 * @param contractPath the contract's own path, which `path` is relative to
 * @param root the root whose rfcs/ is searched last, and whose specs/ and
 *   rfcs/ a source may be read from
 * @returns the sources read, and a problem for each one that was not
 */
export const sourceLoad = (contract: Contract, contractPath: string, root: string): SourceSet =>
  sourceLoadWith(contract, contractPath, root, sourceReadersDefault())

/**
 * Reads every source a contract declares (sourceDecls). A file is read only
 * if it is spec text (sourceReadConfined); it must be the file its `file`
 * records and match the SHA-256 it pins (the main source may pin it on
 * `source.sha256` instead), hide nothing from the gates, be read by the reader
 * its extension selects, and, when the declaration gives an RFC number, be
 * that RFC.
 *
 * @param contract the contract
 * @param contractPath the contract's own path, which `path` is relative to
 * @param root the root whose rfcs/ is searched last, and whose specs/ and
 *   rfcs/ a source may be read from
 * @param readers the readers, by extension
 * @returns the sources read, and a problem for each one that was not
 */
export const sourceLoadWith = (
  contract: Contract,
  contractPath: string,
  root: string,
  readers: SourceReaders,
): SourceSet => {
  const set = new SourceSet()
  set.main = sourceMainId(contract)
  for (const decl of sourceDecls(contract)) {
    let pin = decl.sha256
    if (pin === null && decl.id === set.main) {
      pin = contract.source.sha256
    }
    const one = sourceLoadOne(decl, pin, contractPath, root, readers)
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
