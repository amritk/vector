/**
 * `spec/extract` — `vector spec extract`: an RFC XML v3 spec (xml2rfc's output
 * for a kramdown-rfc spec) to its canonical contract. The profile
 * (spec/profile) reads the contract; extract records what the profile cannot
 * know, the bytes it read, runs the gates `spec check` runs, and writes the
 * contract in one canonical form, so a committed contract can be checked
 * against its spec with `--check`. It never touches the network: an RFC found
 * nowhere is an error that says how to fetch it.
 */

import { JSON_VALUE_ARRAY, JSON_VALUE_OBJECT } from "nish/json-value"
import { basename, dirname, joinPath } from "../core/fs"
import { sha256Hex } from "../core/hex"
import { jsonIntMember, jsonMember, jsonStringMember, newJsonDocument, parseJson } from "../core/json"
import { CheckContext, CheckNote, CheckReport, checkAddReader, checkContractWith, checkGates } from "./check"
import { AllowedSurvivor, Contract, SourceDecl } from "./contract/types"
import { contractWrite } from "./contract/write"
import {
  ProfileLocator,
  ProfileRead,
  ProfileRefusal,
  ProfileRfcs,
  profileLocate,
  profileMdRead,
  profileRead,
  profileRefusalAt,
  profileWhere,
  profileWhereText,
} from "./profile/profile"
import { hiddenProblem } from "./source/hidden"
import { SourceReaders, sourceReaderFor, sourceReadersAdd, sourceReadersDefault } from "./source/load"
import { SourceRead, sourceCandidate, sourceLabel, sourceReadConfined } from "./source/path"
import { RfcDocument } from "./source/rfc"
import { xmlDocParse, xmlRead } from "./xml/doc"

/** The suffix of the file beside a contract that holds its allowSurvivors. */
export const EXTRACT_SIDECAR_SUFFIX: string = ".survivors.json"

/** What extracting a spec gave: the contract's text, or why there is none. */
export class ExtractOutcome {
  /** The canonical contract; "" when there are refusals or errors. */
  text: string
  /** Why the spec is refused (exit 1), each at a file and line, in line order. */
  refusals: ProfileRefusal[]
  /** Why nothing could be judged (exit 2): an input that cannot be read. */
  errors: string[]
  /** Makes an empty outcome. */
  constructor() {
    this.text = ""
    this.refusals = []
    this.errors = []
  }
}

/** An RFC read for the profile: its document, where it was read, and its bytes' hash. */
class ExtractRfc {
  doc: RfcDocument
  read: SourceRead
  label: string
  constructor(doc: RfcDocument, read: SourceRead, label: string) {
    this.doc = doc
    this.read = read
    this.label = label
  }
}

/** One extraction's inputs and what has been read for it. */
class ExtractContext {
  xmlPath: string
  contractPath: string
  root: string
  readers: SourceReaders
  rfcs: Map<i32, ExtractRfc>
  /** Why an RFC could not be read, by number. */
  rfcProblems: Map<i32, string>
  out: ExtractOutcome
  constructor(xmlPath: string, contractPath: string, root: string, readers: SourceReaders) {
    this.xmlPath = xmlPath
    this.contractPath = contractPath
    this.root = root
    this.readers = readers
    this.rfcs = new Map<i32, ExtractRfc>()
    this.rfcProblems = new Map<i32, string>()
    this.out = new ExtractOutcome()
  }
}

/**
 * The readers extract reads sources with: an RFC's plain text and RFC XML v3.
 *
 * @returns the registry, or why `.xml` could not be registered
 */
export const extractReaders = (): Result<SourceReaders, string> => {
  const readers = sourceReadersDefault()
  sourceReadersAdd(readers, ".xml", xmlRead).orReturn()
  return Ok(readers)
}

/**
 * The contract a spec is extracted to when no `-o` names one:
 * contracts/<name>.json beside the spec's directory.
 *
 * @param xmlPath the spec's path
 * @returns the contract's path
 */
export const extractDefaultContractPath = (xmlPath: string): string =>
  joinPath(dirname(xmlPath), `../contracts/${extractStem(basename(xmlPath), ".xml")}.json`)

/**
 * The sidecar beside a contract that holds its allowSurvivors:
 * contracts/<name>.survivors.json.
 *
 * @param contractPath the contract's path
 * @returns the sidecar's path
 */
const extractSurvivorsPath = (contractPath: string): string =>
  joinPath(dirname(contractPath), `${extractStem(basename(contractPath), ".json")}${EXTRACT_SIDECAR_SUFFIX}`)

/**
 * The markdown a spec is built from, as scripts/build-spec.sh reads it: the
 * `.md` beside it with its base name. Null when it is not on disk, so a
 * refusal never names a file that is not there.
 *
 * @param xmlPath the spec's path
 * @returns the markdown's path, or null
 */
const extractMdBeside = (xmlPath: string): string | null => {
  if (!xmlPath.endsWith(".xml")) {
    return null
  }
  const md = `${xmlPath.substring(0, xmlPath.length - 4)}.md`
  if (realpathSync(md) === null || isDirectorySync(md)) {
    return null
  }
  return md
}

const extractStem = (name: string, ext: string): string =>
  name.endsWith(ext) ? name.substring(0, name.length - ext.length) : name

/**
 * The path of `to` relative to the directory `from`, both absolute and
 * resolved, with `/` separators.
 *
 * @param from the directory
 * @param to the file
 * @returns the relative path, like `../specs/x.xml`
 */
const extractRelative = (from: string, to: string): string => {
  const a = extractParts(from)
  const b = extractParts(to)
  let same = 0
  while (same < a.length && same < b.length && a[same] === b[same]) {
    same = same + 1
  }
  const parts: string[] = []
  for (let i = same; i < a.length; i++) {
    parts.push("..")
  }
  for (let i = same; i < b.length; i++) {
    parts.push(b[i])
  }
  return parts.length === 0 ? "." : parts.join("/")
}

/** `path` made absolute against the working directory, with `.` and `..` resolved lexically, as the old extractor's `resolve` did. */
const extractAbsolute = (path: string): string => {
  const full = path.startsWith("/") ? path : `${realpathSync(".") ?? ""}/${path}`
  const out: string[] = []
  for (const p of extractParts(full)) {
    if (p === "..") {
      if (out.length > 0) {
        out.pop()
      }
    } else if (p !== ".") {
      out.push(p)
    }
  }
  return `/${out.join("/")}`
}

const extractParts = (path: string): string[] => {
  const out: string[] = []
  let start = 0
  for (let i = 0; i <= path.length; i++) {
    if (i === path.length || path.charCodeAt(i) === 0x2f) {
      if (i > start) {
        out.push(path.substring(start, i))
      }
      start = i + 1
    }
  }
  return out
}

/** Reads RFC `n` as the contract at `ctx.contractPath` would, or records why it cannot be. */
const extractLoadRfc = (ctx: ExtractContext, n: i32): void => {
  if (ctx.rfcs.has(n) || ctx.rfcProblems.has(n)) {
    return
  }
  const got = extractReadRfc(ctx, n)
  if (got.isErr()) {
    ctx.rfcProblems.set(n, got.error)
  } else {
    ctx.rfcs.set(n, got.value)
  }
}

const extractReadRfc = (ctx: ExtractContext, n: i32): Result<ExtractRfc, string> => {
  const decl = new SourceDecl()
  decl.id = `rfc${n}`
  decl.rfc = n
  const exts: string[] = []
  for (const e of ctx.readers.entries) {
    exts.push(e.ext)
  }
  const candidate = sourceCandidate(decl, ctx.contractPath, ctx.root, exts).orReturn()
  const read = sourceReadConfined(decl, candidate, ctx.contractPath, ctx.root).orReturn()
  const label = sourceLabel(read.real, ctx.contractPath, ctx.root)
  if (label === null) {
    return Err(`source ${decl.id}: ${read.real} is in no place a contract at ${ctx.contractPath} can name it from`)
  }
  const reader = sourceReaderFor(ctx.readers, read.real)
  if (reader === null) {
    return Err(`source ${decl.id}: no reader is registered for ${label}`)
  }
  const hidden = hiddenProblem(read.text, label)
  if (hidden !== null) {
    return Err(`source ${decl.id}: ${hidden}`)
  }
  const doc = reader.read(read.text, label)
  if (doc.isErr()) {
    return Err(`source ${decl.id}: ${doc.error}`)
  }
  if (doc.value.number !== n) {
    return Err(`source ${decl.id}: ${label} is RFC ${doc.value.number}, not RFC ${n}`)
  }
  return Ok(new ExtractRfc(doc.value, read, label))
}

/** The sidecar's allowSurvivors; null when there is no sidecar. */
const extractSurvivors = (path: string): Result<AllowedSurvivor[] | null, string> => {
  if (realpathSync(path) === null) {
    const none: AllowedSurvivor[] | null = null
    return Ok(none)
  }
  const text = readFileSyncOrNull(path)
  if (text === null) {
    return Err(`cannot read ${path}`)
  }
  const doc = newJsonDocument()
  const root = parseJson(doc, text, path).orReturn()
  const want = `${path}: expected {"allowSurvivors": [...]}`
  if (doc.kind(root) !== JSON_VALUE_OBJECT) {
    return Err(want)
  }
  const list = jsonMember(doc, root, "allowSurvivors", JSON_VALUE_ARRAY)
  if (list.isErr()) {
    return Err(want)
  }
  const out: AllowedSurvivor[] = []
  for (let i = 0; i < doc.length(list.value); i++) {
    const e = doc.at(list.value, i)
    const at = `${path}: allowSurvivors[${i}]`
    if (doc.kind(e) !== JSON_VALUE_OBJECT) {
      return Err(`${at}: expected an object`)
    }
    // A member left out keeps its default, so the shape gate refuses each
    // one missing, by name; one of the wrong type is an error here.
    const s = new AllowedSurvivor()
    if (doc.kind(doc.get(e, "file")) !== 0) {
      const file = jsonStringMember(doc, e, "file")
      if (file.isErr()) {
        return Err(`${at}: ${file.error}`)
      }
      s.file = file.value
    }
    if (doc.kind(doc.get(e, "line")) !== 0) {
      const line = jsonIntMember(doc, e, "line")
      if (line.isErr()) {
        return Err(`${at}: ${line.error}`)
      }
      s.line = line.value
    }
    if (doc.kind(doc.get(e, "reason")) !== 0) {
      const reason = jsonStringMember(doc, e, "reason")
      if (reason.isErr()) {
        return Err(`${at}: ${reason.error}`)
      }
      s.reason = reason.value
    }
    out.push(s)
  }
  return Ok(out)
}

/** Fills in what the profile cannot know: `$schema`, the hashes, paths and files read, and the sidecar. */
const extractComplete = (ctx: ExtractContext, c: Contract, specSha: string): Result<boolean, string> => {
  const dirReal = realpathSync(dirname(ctx.contractPath))
  if (dirReal === null) {
    return Err(`${dirname(ctx.contractPath)}: no such directory, to write ${ctx.contractPath} in`)
  }
  const rfcsReal = realpathSync(joinPath(dirReal, "../rfcs"))
  // `$schema` and a spec's `path` are both lexical, as the old extractor's were,
  // so one symlink names both from where the contract sees them.
  const dirLex = extractAbsolute(dirname(ctx.contractPath))
  c.schema = extractRelative(dirLex, extractAbsolute(joinPath(ctx.root, "schemas/rfc-contract.json")))
  const mainRfc = c.source.rfc
  c.source.sha256 = specSha
  const sources = c.sources
  if (sources !== null) {
    for (const d of sources) {
      if (d.rfc < 1) {
        // Lexical, as the old extractor was, so a symlinked specs/ names the spec where the contract sees it.
        d.path = extractRelative(dirLex, extractAbsolute(ctx.xmlPath))
        continue
      }
      const got = ctx.rfcs.get(d.rfc)
      if (got === undefined) {
        return Err(`rfc${d.rfc} was cited but not read`)
      }
      const at = dirname(got.read.real)
      const local = at === dirReal || (rfcsReal !== null && at === rfcsReal)
      d.path = local && d.rfc !== mainRfc ? extractRelative(dirReal, got.read.real) : null
      d.file = got.label
      d.sha256 = got.read.sha256
    }
  }
  // An RFC main source is what the module implements, so its hash, not the spec's, is the source's.
  if (mainRfc >= 1) {
    const main = ctx.rfcs.get(mainRfc)
    if (main === undefined) {
      return Err(`rfc${mainRfc} is the main source but was not read`)
    }
    c.source.sha256 = main.read.sha256
  }
  c.allowSurvivors = extractSurvivors(extractSurvivorsPath(ctx.contractPath)).orReturn()
  return Ok(true)
}

/**
 * Extracts the canonical contract for a spec: reads the spec and every RFC
 * it references, reads the contract under the profile, records the bytes
 * read, and runs the gates `spec check` runs.
 *
 * @param xmlPath the spec, RFC XML v3
 * @param contractPath where the contract is to be written, which its relative paths are from
 * @param root vector's root, whose rfcs/ is searched last and whose schemas/ `$schema` names
 * @param readers the source readers (extractReaders)
 * @returns the contract's text, or every refusal, or the errors that stopped it
 */
export const extractContract = (
  xmlPath: string,
  contractPath: string,
  root: string,
  readers: SourceReaders,
): ExtractOutcome => {
  const ctx = new ExtractContext(xmlPath, contractPath, root, readers)
  const out = ctx.out
  const text = readFileSyncOrNull(xmlPath)
  const specReal = realpathSync(xmlPath)
  if (text === null || specReal === null || isDirectorySync(xmlPath)) {
    out.errors.push(`cannot read ${xmlPath}`)
    return out
  }
  const md = profileMdRead(extractMdBeside(xmlPath))
  const hidden = hiddenProblem(text, xmlPath)
  if (hidden !== null) {
    out.refusals.push(new ProfileRefusal(xmlPath, 0, 0, hidden))
    return out
  }
  const parsed = xmlDocParse(text)
  if (parsed.isErr()) {
    const e = parsed.error
    const w = profileWhere(e.line, e.mdLine, e.markLine, xmlPath, md, "")
    const see = e.see
    const message =
      see !== null
        ? `${e.message} ${profileWhereText(profileWhere(see.line, see.mdLine, see.markLine, xmlPath, md, ""))}`
        : e.message
    out.refusals.push(profileRefusalAt(w, e.col, message))
    return out
  }
  const doc = parsed.value
  const rfcs = new ProfileRfcs()
  for (const r of doc.references) {
    if (r.rfc >= 1) {
      extractLoadRfc(ctx, r.rfc)
      const got = ctx.rfcs.get(r.rfc)
      if (got !== undefined) {
        rfcs.docs.set(r.rfc, got.doc)
      }
    }
  }
  const read = profileRead(doc, xmlPath, md, rfcs)
  if (rfcs.missing.length > 0) {
    for (const n of rfcs.missing) {
      extractLoadRfc(ctx, n)
      const why = ctx.rfcProblems.get(n)
      out.errors.push(why !== undefined ? why : `rfc${n} was asked for but not read`)
    }
    return out
  }
  if (read.isErr()) {
    out.refusals = read.error
    return out
  }
  return extractFinish(ctx, read.value, sha256Hex(text))
}

/** A gate refusal before it is placed: its line, and whether it is the sidecar's. */
class ExtractGateRow {
  refusal: ProfileRefusal
  sidecar: boolean
  constructor(refusal: ProfileRefusal, sidecar: boolean) {
    this.refusal = refusal
    this.sidecar = sidecar
  }
}

/** Adds a gate's finding as a row: the sidecar's, the main source's section's, or placed by its `at`. */
const extractGateRowAdd = (
  rows: ExtractGateRow[],
  locator: ProfileLocator,
  sidecar: string,
  mainRfc: i32,
  gate: string,
  at: string,
  message: string,
): void => {
  if (at.startsWith("allowSurvivors") || message.startsWith("allowSurvivors")) {
    rows.push(new ExtractGateRow(new ProfileRefusal(sidecar, 0, 0, `${gate}: ${message}`), true))
    return
  }
  // A section of the main source (`§2`) is no part of the spec: the line
  // naming that source places it, and the message says which section.
  if (at.startsWith("\u00a7")) {
    const of = mainRfc >= 1 ? ` of RFC${mainRfc}` : ""
    const text = `${gate}: Section ${at.substring("\u00a7".length)}${of}: ${message}`
    rows.push(new ExtractGateRow(profileRefusalAt(profileLocate(locator, "source.main"), 0, text), false))
    return
  }
  // A note the locator places is at its part's line, which says where; one
  // it cannot place falls to the root, so its `at` stays in the text and two
  // root notes with one message stay two.
  const text = at.length > 0 && !extractPlaced(locator, at) ? `${gate}: ${at}: ${message}` : `${gate}: ${message}`
  rows.push(new ExtractGateRow(profileRefusalAt(profileLocate(locator, at), 0, text), false))
}

/** Whether the locator holds `at` or a dotted prefix of it, as profileLocate looks it up. */
const extractPlaced = (locator: ProfileLocator, at: string): boolean => {
  let k = at
  while (k.length > 0) {
    if (locator.at.has(k)) {
      return true
    }
    let dot = k.length - 1
    while (dot >= 0 && k.charCodeAt(dot) !== 0x2e) {
      dot = dot - 1
    }
    if (dot < 0) {
      return false
    }
    k = k.substring(0, dot)
  }
  return false
}

/** Appends a refusal unless one with its place (file, line, XML line, column) and message is there. */
const extractGateKeep = (out: ProfileRefusal[], seen: Set<string>, r: ProfileRefusal): void => {
  const key = `${r.file}\u0000${r.line}\u0000${r.exactLine}\u0000${r.col}\u0000${r.message}`
  if (!seen.has(key)) {
    seen.add(key)
    out.push(r)
  }
}

/**
 * The gates' findings as refusals, each at the line of the part it is about.
 * A gate that places a finding (a note, gateIssue) is placed by the note's
 * `at` through the locator; a finding no note places is at the spec's root.
 * Each refusal is given once, since two fields of one part can break one
 * rule on one line, and they are sorted by line, then XML line: two parts
 * under one `<?line?>` mark share a markdown line but not an XML one. A finding about
 * allowSurvivors is the sidecar's, so it names that file, after the rest.
 *
 * @param report what the gates found
 * @param notes where they placed each finding, and their warnings
 * @param locator where each part of the contract was read
 * @param sidecar the sidecar's path
 * @param mainRfc the main source's RFC number; 0 when the spec is its own
 * @returns the refusals, in order
 */
export const extractGateRefusals = (
  report: CheckReport,
  notes: CheckNote[],
  locator: ProfileLocator,
  sidecar: string,
  mainRfc: i32,
): ProfileRefusal[] => {
  const rows: ExtractGateRow[] = []
  const placed = new Set<string>()
  for (const n of notes) {
    if (!n.warning) {
      placed.add(`${n.gate}\u0000${n.at}: ${n.message}`)
      extractGateRowAdd(rows, locator, sidecar, mainRfc, n.gate, n.at, n.message)
    }
  }
  for (const f of report.findings) {
    if (!placed.has(`${f.gate}\u0000${f.message}`)) {
      extractGateRowAdd(rows, locator, sidecar, mainRfc, f.gate, "", f.message)
    }
  }
  const out: ProfileRefusal[] = []
  const seen = new Set<string>()
  const main = rows.filter((r: ExtractGateRow): boolean => !r.sidecar)
  main.sort((a: ExtractGateRow, b: ExtractGateRow): i32 => {
    const x = a.refusal
    const y = b.refusal
    if (x.line !== y.line) {
      return x.line < y.line ? -1 : 1
    }
    if (x.exactLine !== y.exactLine) {
      return x.exactLine < y.exactLine ? -1 : 1
    }
    return x.col < y.col ? -1 : x.col > y.col ? 1 : 0
  })
  for (const r of main) {
    extractGateKeep(out, seen, r.refusal)
  }
  for (const r of rows) {
    if (r.sidecar) {
      extractGateKeep(out, seen, r.refusal)
    }
  }
  return out
}

const extractFinish = (ctx: ExtractContext, read: ProfileRead, specSha: string): ExtractOutcome => {
  const out = ctx.out
  const c = read.contract
  const done = extractComplete(ctx, c, specSha)
  if (done.isErr()) {
    out.errors.push(done.error)
    return out
  }
  const check = new CheckContext(ctx.contractPath, ctx.root)
  const added = checkAddReader(check, ".xml", xmlRead)
  if (added.isErr()) {
    out.errors.push(added.error)
    return out
  }
  const report = checkContractWith(check, c, checkGates())
  const failure = check.toolFailure
  if (failure !== null) {
    out.errors.push(failure)
    return out
  }
  if (report.findings.length > 0) {
    out.refusals = extractGateRefusals(
      report,
      check.notes,
      read.locator,
      extractSurvivorsPath(ctx.contractPath),
      c.source.rfc,
    )
    return out
  }
  out.text = contractWrite(c)
  return out
}

/** Marks a last line that has no newline; JSON text holds no NUL. */
const EXTRACT_NO_EOL: string = "\u0000"

/** One line of an edit script: " ", "-" or "+", the line, and each side's index. */
class ExtractOp {
  op: string
  line: string
  i: i32
  j: i32
  constructor(op: string, line: string, i: i32, j: i32) {
    this.op = op
    this.line = line
    this.i = i
    this.j = j
  }
}

const extractLines = (s: string): string[] => {
  if (s.length === 0) {
    return []
  }
  const body = s.endsWith("\n") ? s.substring(0, s.length - 1) : s
  const lines: string[] = []
  let start = 0
  for (let k = 0; k <= body.length; k++) {
    if (k === body.length || body.charCodeAt(k) === 10) {
      lines.push(body.substring(start, k))
      start = k + 1
    }
  }
  if (!s.endsWith("\n")) {
    lines[lines.length - 1] = `${lines[lines.length - 1]}${EXTRACT_NO_EOL}`
  }
  return lines
}

const extractShown = (o: ExtractOp): string => {
  const t = `${o.op}${o.line}`
  return t.endsWith(EXTRACT_NO_EOL) ? `${t.substring(0, t.length - 1)}\n\\ No newline at end of file` : t
}

/** The most cells extractUnifiedDiff's table may hold, past which it diffs the changed lines whole. */
const EXTRACT_DIFF_CELLS: i32 = 4000000

/**
 * A unified diff of `a` (the file `aName`) against `b` (`bName`), with three
 * lines of context, or "" when they are equal. Lines are matched by their
 * longest common subsequence.
 *
 * @param a the old text
 * @param b the new text
 * @param aName names the old text
 * @param bName names the new text
 * @returns the diff, ending in a newline, or ""
 */
export const extractUnifiedDiff = (a: string, b: string, aName: string, bName: string): string => {
  if (a === b) {
    return ""
  }
  const x = extractLines(a)
  const y = extractLines(b)
  let pre = 0
  while (pre < x.length && pre < y.length && x[pre] === y[pre]) {
    pre = pre + 1
  }
  let suf = 0
  while (suf < x.length - pre && suf < y.length - pre && x[x.length - 1 - suf] === y[y.length - 1 - suf]) {
    suf = suf + 1
  }
  const xm = x.length - suf
  const ym = y.length - suf
  const w = ym - pre + 1
  // Past EXTRACT_DIFF_CELLS the table is not built (its i32 size could wrap, and
  // it would hold too much): the changed lines are given as one hunk, every
  // old line removed, then every new line added.
  const whole = xm - pre > 0 && ym - pre > toI32(EXTRACT_DIFF_CELLS / (xm - pre))
  // lcs[(i - pre) * w + (j - pre)]: the longest common subsequence of x[i..xm] and y[j..ym].
  const lcs: i32[] = []
  const cells = whole ? 0 : (xm - pre + 1) * w
  for (let k = 0; k < cells; k++) {
    lcs.push(0)
  }
  for (let i = whole ? pre - 1 : xm - 1; i >= pre; i--) {
    for (let j = ym - 1; j >= pre; j--) {
      const here = (i - pre) * w + (j - pre)
      if (x[i] === y[j]) {
        lcs[here] = lcs[here + w + 1] + 1
      } else {
        const down = lcs[here + w]
        const right = lcs[here + 1]
        lcs[here] = down >= right ? down : right
      }
    }
  }
  const ops: ExtractOp[] = []
  for (let k = 0; k < pre; k++) {
    ops.push(new ExtractOp(" ", x[k], k, k))
  }
  let i = pre
  let j = pre
  while (i < xm || j < ym) {
    if (i < xm && j < ym && x[i] === y[j]) {
      ops.push(new ExtractOp(" ", x[i], i, j))
      i = i + 1
      j = j + 1
    } else if (
      i < xm &&
      (whole || j === ym || lcs[(i + 1 - pre) * w + (j - pre)] >= lcs[(i - pre) * w + (j + 1 - pre)])
    ) {
      // A deletion before an insertion, as diff -u prints them.
      ops.push(new ExtractOp("-", x[i], i, j))
      i = i + 1
    } else {
      ops.push(new ExtractOp("+", y[j], i, j))
      j = j + 1
    }
  }
  for (let k = 0; k < suf; k++) {
    ops.push(new ExtractOp(" ", x[xm + k], xm + k, ym + k))
  }
  const context = 3
  const out: string[] = [`--- ${aName}`, `+++ ${bName}`]
  let k = 0
  while (k < ops.length) {
    if (ops[k].op === " ") {
      k = k + 1
      continue
    }
    // A hunk: from `context` lines before this change to `context` after the
    // last change within 2 * context unchanged lines of the next.
    const start = k - context > 0 ? k - context : 0
    let end = k
    let quiet = 0
    for (let m = k; m < ops.length; m++) {
      if (ops[m].op === " ") {
        quiet = quiet + 1
        if (quiet > 2 * context) {
          break
        }
      } else {
        quiet = 0
        end = m
      }
    }
    const stop = end + 1 + context < ops.length ? end + 1 + context : ops.length
    let aCount = 0
    let bCount = 0
    for (let m = start; m < stop; m++) {
      if (ops[m].op !== "+") {
        aCount = aCount + 1
      }
      if (ops[m].op !== "-") {
        bCount = bCount + 1
      }
    }
    const aFrom = aCount === 0 ? ops[start].i : ops[start].i + 1
    const bFrom = bCount === 0 ? ops[start].j : ops[start].j + 1
    out.push(`@@ -${aFrom},${aCount} +${bFrom},${bCount} @@`)
    for (let m = start; m < stop; m++) {
      out.push(extractShown(ops[m]))
    }
    k = stop
  }
  return `${out.join("\n")}\n`
}
