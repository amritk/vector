/**
 * `spec/profile/profile` — the vector profile: what an RFC XML v3 spec, built
 * by kramdown-rfc and `xml2rfc --v2v3`, must say for vector to read a
 * contract from it, and the reading. A pure function of the parsed document
 * and of the RFCs it cites (handed over in a ProfileRfcs): no files, no
 * clock, the same contract or the same refusals for the same input.
 *
 *   contract      `docName` draft-<name>-NN; <name> is the file's basename
 *   target        the one `ts-interface` block's `// module: …` line
 *   requirement   a `<t anchor>` holding one BCP 14 sentence, or one starting
 *                 `Definition: `, or a `<blockquote anchor>` quoting an RFC
 *                 and ending with `{{Section N of RFCx}}`
 *   exclusion     a requirement followed by a `<t>` starting `Untested: `,
 *                 or an unanchored paragraph or blockquote followed by one
 *   note          a `<t>` starting `Note: ` directly after a requirement
 *   main source   the spec itself, or the RFC a `keyword` vector-main-RFC<N>
 *                 in `<front>` names; it must be under `normative:` and cited
 *   property      a `ts-property` block, read by its front end
 *   vector        a row of a table headed Id | Call | Expected | Covers | Source | Title
 *   tolerance     a `<t>` directly after the vector table (or another one)
 *                 reading `Tolerance: V1 ulps 1, <xref>: "quote"`, or `abs 1e-9`
 *   iterate       a `<t>` among those tolerances reading
 *                 `Iterate: V1 1,000 times, [slow, ](k, u) <- (f(k, u), k)`:
 *                 the row's call runs that many times, each run's arguments
 *                 the previous run's names, and its Expected is the last result
 *   out of scope  a `<t>` anywhere reading `Out of scope: <export>, <reason>`:
 *                 an export of the target the contract does not test
 *
 * Every BCP 14 sentence must be a requirement or an exclusion, every xref to
 * an RFC must have a `<reference>`, and every section cited must exist in
 * the RFC handed over. Where a refusal is placed is profileWhere's rule: the
 * markdown line holding the refused text, found once below its `<?line?>`
 * mark, beside the XML line; or the XML line alone, never one extrapolated.
 */

import { split } from "nish/text"
import { diagPlace } from "../../core/diag"
import {
  charsFirstControl,
  charsIsAbs,
  charsIsId,
  charsIsIdent,
  charsIsSection,
  charsTestVector,
} from "../contract/chars"
import { contractF64Overflows, contractF64Parse } from "../contract/f64"
import {
  RawCall,
  RawLiteral,
  SettledVector,
  literalsByteLength,
  literalsKindOf,
  literalsParse,
  literalsParseCall,
  literalsSettleVector,
} from "../contract/literals"
import { contractShapeErrors, shapeTestNames, shapeTestPrefixes } from "../contract/shape"
import {
  Citation,
  Clause,
  ClauseKind,
  Contract,
  ContractSource,
  Exclusion,
  Expr,
  ExprKind,
  FnSig,
  Iterate,
  LitKind,
  Literal,
  OutOfScope,
  Requirement,
  SourceDecl,
  Target,
  Tolerance,
  Truncate,
  VectorSource,
  VectorSourceKind,
} from "../contract/types"
import { typeCallsIn } from "../contract/typing"
import { vocabHas, vocabIsBinding, vocabLevels, vocabValueType } from "../contract/vocab"
import { FrontRefusal, frontParseInterface, frontParseProperty, frontReads } from "../front/front"
import { RfcDocument, rfcNormalize, rfcSection, rfcSectionText } from "../source/rfc"
import { XmlDocument } from "../xml/doc"
import { XmlNode, xmlAttr, xmlElements } from "../xml/reader"
import { XmlNormative, xmlCodeOf, xmlPlainText, xmlPlainTextOfNodes, xmlTrim } from "../xml/text"

const PROFILE_DEFINITION: string = "Definition: "
const PROFILE_UNTESTED: string = "Untested: "
const PROFILE_NOTE: string = "Note: "
const PROFILE_TOLERANCE: string = "Tolerance: "
const PROFILE_TOLERANCE_FORM: string =
  'Tolerance: <vector id> ulps <n>, {{Section N of RFCx}}: "<the sentence that allows it>" (or abs <decimal>, or {{anchor}})'
const PROFILE_OUT_OF_SCOPE: string = "Out of scope: "
const PROFILE_OUT_OF_SCOPE_FORM: string = "Out of scope: <export>, <the reason no clause tests it>"
const PROFILE_ULPS_MAX: string = "9007199254740991"
const PROFILE_STRAY_TOLERANCE: string =
  "this Tolerance: paragraph follows no vector table; it must directly follow the vector table or another Tolerance:, Iterate: or Truncate: paragraph"
const PROFILE_ITERATE: string = "Iterate: "
const PROFILE_ITERATE_FORM: string = "Iterate: V1 1,000 times, (k, u) <- (f(k, u), k)"
const PROFILE_ITERATE_MAX: i64 = 1000000000
const PROFILE_STRAY_ITERATE: string =
  "this Iterate: paragraph follows no vector table; it must directly follow the vector table or a Tolerance:, Iterate: or Truncate: paragraph, like Iterate: V1 1,000 times, (k, u) <- (f(k, u), k)"
const PROFILE_TRUNCATE: string = "Truncate: "
const PROFILE_TRUNCATE_FORM: string = "Truncate: V1 to 128 bits (or to 16 bytes)"
const PROFILE_TRUNCATE_MAX_BYTES: i64 = 65536
const PROFILE_STRAY_TRUNCATE: string =
  "this Truncate: paragraph follows no vector table; it must directly follow the vector table or a Tolerance:, Iterate: or Truncate: paragraph, like Truncate: V1 to 128 bits (or to 16 bytes)"
const PROFILE_MAIN_KEY: string = "vector-main-"
const PROFILE_ID_RULE: string = `is not letters, digits, ".", "_" and "-", starting with a letter or digit`

/**
 * The header a vector table has, column by column.
 *
 * @returns Id, Call, Expected, Covers, Source and Title
 */
const profileVectorHeader = (): string[] => ["Id", "Call", "Expected", "Covers", "Source", "Title"]

/** A refusal: where, and why. */
export class ProfileRefusal {
  /** The markdown file when `line` is its line, else the XML file. */
  file: string
  /** The 1-based line in `file`. */
  line: i32
  /** The column, 1-based; 0 when the refusal names none. */
  col: i32
  /** Why the profile was refused. */
  message: string
  /** The XML file when `line` is a markdown line found below a `<?line?>` mark; "" otherwise. */
  exactFile: string
  /** The XML line the refusal is on, when `exactFile` is set; 0 otherwise. */
  exactLine: i32 = 0
  /** The XML line the refusal was raised at, whichever line is printed (`line` itself unless profileRefusalAt set it); refusals are sorted by it. */
  xmlLine: i32 = 0
  /**
   * Makes a refusal.
   *
   * @param file the file
   * @param line the line in it
   * @param col the column, or 0
   * @param message why
   */
  constructor(file: string, line: i32, col: i32, message: string) {
    this.exactFile = ""
    this.file = file
    this.line = line
    this.col = col
    this.message = message
    this.xmlLine = line
  }
}

/** A file and a line in it, and the XML line when that line is a markdown line found by its text. */
export class ProfileWhere {
  /** The file the line is in. */
  file: string
  /** The 1-based line. */
  line: i32
  /** The XML file when `line` is a markdown line found below a `<?line?>` mark; "" when `line` is the file's own. */
  exactFile: string
  /** The XML line the place is on, when `exactFile` is set; 0 otherwise. */
  exactLine: i32 = 0
  /** Whether `line` is a markdown line standing alone, which an XML column does not fit. */
  mdOnly: boolean
  /** The XML line the place is on, whichever line is printed (`line` itself unless profileWhere set it). */
  xmlLine: i32 = 0
  /**
   * Makes a place.
   *
   * @param file the file
   * @param line the line
   */
  constructor(file: string, line: i32) {
    this.mdOnly = false
    this.exactFile = ""
    this.file = file
    this.line = line
    this.xmlLine = line
  }
}

/** The markdown a spec was built from: its path, and how many lines it has. */
export class ProfileMd {
  /** The markdown file. */
  path: string
  /** Its number of lines; no place past the last is printed. */
  lines: i32
  /** Its lines, when it was read; a place below a `<?line?>` mark is found here by its text. */
  text: string[]
  /**
   * Makes a markdown file's record.
   *
   * @param path the file
   * @param lines how many lines it has
   */
  constructor(path: string, lines: i32) {
    this.text = []
    this.path = path
    this.lines = lines
  }
}

/**
 * Reads the markdown a spec was built from, to count its lines.
 *
 * @param path the markdown file, or null
 * @returns its record; null when there is no path or it cannot be read
 */
export const profileMdRead = (path: string | null): ProfileMd | null => {
  if (path === null) {
    return null
  }
  const text = readFileSyncOrNull(path)
  if (text === null) {
    return null
  }
  if (text.length === 0) {
    return new ProfileMd(path, 0)
  }
  const all = split(text, "\n")
  const md = new ProfileMd(path, text.endsWith("\n") ? all.length - 1 : all.length)
  md.text = all
  return md
}

/** The RFCs a spec may cite, read beforehand, and the ones it needed but were not there. */
export class ProfileRfcs {
  /** The RFCs read, by number. */
  docs: Map<i32, RfcDocument>
  /** The RFCs asked for and not in `docs`, each once, in the order asked. */
  missing: i32[]
  /** Makes an empty set. */
  constructor() {
    this.docs = new Map<i32, RfcDocument>()
    this.missing = []
  }
}

/**
 * Where a contract's parts were read: the line of each requirement, clause
 * and function by id or name, and of the first exclusion in a section, keyed
 * `exclusion §N` as the gates name it.
 */
export class ProfileLocator {
  /** The document root's place, for what names no part. */
  root: ProfileWhere
  /** The place of each part, by its key: a requirement or clause id, a function name, or `exclusion §N`. */
  at: Map<string, ProfileWhere>
  /**
   * Makes a locator with no part.
   *
   * @param root the root's place
   */
  constructor(root: ProfileWhere) {
    this.root = root
    this.at = new Map<string, ProfileWhere>()
  }
}

/** What reading a profile gives: the contract and where each part was read. */
export class ProfileRead {
  /** The contract the profile gives. */
  contract: Contract
  /** Where each part of `contract` was read. */
  locator: ProfileLocator
  /**
   * Makes a reading.
   *
   * @param contract the contract
   * @param locator where its parts were read
   */
  constructor(contract: Contract, locator: ProfileLocator) {
    this.contract = contract
    this.locator = locator
  }
}

/** An XML line, and the last `<?line?>` mark before it: its markdown line (-1 for none) and XML line. */
class ProfileLoc {
  line: i32
  mdLine: i32
  markLine: i32
  /** The text the place is about, as the markdown writes it; "" when it cannot be told. */
  text: string
  constructor(line: i32, mdLine: i32, markLine: i32, text: string) {
    this.line = line
    this.mdLine = mdLine
    this.markLine = markLine
    this.text = text
  }
}

/** A requirement or exclusion as read, before its quote is checked. */
class ProfileQuoted {
  id: string
  section: string
  quote: string
  level: string
  /** For a blockquote, the RFC quoted; -1 for none. */
  citeRfc: i32
  citeSection: string
  note: string | null
  reason: string
  loc: ProfileLoc
  constructor(id: string, section: string, quote: string, level: string, loc: ProfileLoc) {
    this.id = id
    this.section = section
    this.quote = quote
    this.level = level
    this.citeRfc = -1
    this.citeSection = ""
    this.note = null
    this.reason = ""
    this.loc = loc
  }
}

/** A block read: none (not a requirement), refused, or a quote. */
class ProfileBlock {
  none: boolean
  q: ProfileQuoted | null
  constructor(none: boolean, q: ProfileQuoted | null) {
    this.none = none
    this.q = q
  }
}

/** A numbered or unnumbered section of the document. */
class ProfileSection {
  node: XmlNode
  /** Its number; "" when unnumbered. */
  id: string
  constructor(node: XmlNode, id: string) {
    this.node = node
    this.id = id
  }
}

/** A table, the section it is in, and the Tolerance: and Iterate: paragraphs right after it. */
class ProfileTable {
  node: XmlNode
  section: string
  tolerances: XmlNode[]
  iterates: XmlNode[]
  /** The Truncate: paragraphs right after it. */
  truncates: XmlNode[]
  constructor(node: XmlNode, section: string) {
    this.node = node
    this.section = section
    this.tolerances = []
    this.iterates = []
    this.truncates = []
  }
}

/** Everything a reading collects on the way. */
class ProfileContext {
  doc: XmlDocument
  xmlPath: string
  md: ProfileMd | null
  rfcs: ProfileRfcs
  refusals: ProfileRefusal[]
  /** Each reference's anchor, and the RFC it names (-1 for none). */
  referenced: Map<string, i32>
  mainRfc: i32
  mainKey: XmlNode | null
  texts: Map<string, string>
  cited: Set<i32>
  module: string
  functions: FnSig[]
  fnLocs: ProfileLoc[]
  byNode: Map<XmlNode, XmlNormative[]>
  handled: Set<XmlNode>
  unclaimed: Set<XmlNode>
  requirements: ProfileQuoted[]
  exclusions: ProfileQuoted[]
  tables: ProfileTable[]
  ids: Set<string>
  clauseIds: Set<string>
  vectorTable: XmlNode | null
  vectors: Clause[]
  vectorLocs: ProfileLoc[]
  /** Each vector with a tolerance, and (alongside) its Tolerance: paragraph. */
  toleranceIds: string[]
  toleranceLocs: ProfileLoc[]
  /** Each iterated vector, and (alongside) its Iterate: paragraph. */
  iterateIds: string[]
  iterateLocs: ProfileLoc[]
  /** The ids of the truncated vectors, in the order read. */
  truncateIds: string[]
  /** Where each truncated vector's Truncate: paragraph is. */
  truncateLocs: ProfileLoc[]
  properties: Clause[]
  propertyLocs: ProfileLoc[]
  /** Each export out of scope, and (alongside) its Out of scope: paragraph. */
  outOfScope: OutOfScope[]
  outOfScopeLocs: ProfileLoc[]
  constructor(doc: XmlDocument, xmlPath: string, md: ProfileMd | null, rfcs: ProfileRfcs) {
    this.doc = doc
    this.xmlPath = xmlPath
    this.md = md
    this.rfcs = rfcs
    this.refusals = []
    this.referenced = new Map<string, i32>()
    this.mainRfc = -1
    this.mainKey = null
    this.texts = new Map<string, string>()
    this.cited = new Set<i32>()
    this.module = ""
    this.functions = []
    this.fnLocs = []
    this.byNode = new Map<XmlNode, XmlNormative[]>()
    this.handled = new Set<XmlNode>()
    this.unclaimed = new Set<XmlNode>()
    this.requirements = []
    this.exclusions = []
    this.tables = []
    this.ids = new Set<string>()
    this.clauseIds = new Set<string>()
    this.vectorTable = null
    this.vectors = []
    this.vectorLocs = []
    this.toleranceIds = []
    this.toleranceLocs = []
    this.iterateIds = []
    this.iterateLocs = []
    this.truncateIds = []
    this.truncateLocs = []
    this.properties = []
    this.propertyLocs = []
    this.outOfScope = []
    this.outOfScopeLocs = []
  }
}

// ── Places ─────────────────────────────────────────────────────────────────

/** `s` with each run of ASCII white space made one space, and trimmed. */
const profileCollapse = (s: string): string => {
  const out: string[] = []
  let run = -1
  for (let i = 0; i <= s.length; i++) {
    const ch = i < s.length ? s.charCodeAt(i) : 0x20
    const blank = ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0d
    if (!blank && run < 0) {
      run = i
    } else if (blank && run >= 0) {
      out.push(s.substring(run, i))
      run = -1
    }
  }
  return out.join(" ")
}

/** The character data directly in `n`, or null when `n` holds an element. */
const profileFlatText = (n: XmlNode): string | null => {
  const out: string[] = []
  let k = n.first
  while (k !== null) {
    if (k.name.length > 0) {
      return null
    }
    out.push(k.text)
    k = k.next
  }
  return out.join("")
}

/**
 * How a block's text starts in the markdown: its character data, a
 * `<bcp14>`'s keyword and a `<tt>`'s code in backticks, up to the first
 * other markup (a reference, emphasis), whose markdown spelling the XML does
 * not keep. A block opening with a `<t>` starts as that `<t>` does.
 */
const profileHead = (n: XmlNode): string => {
  const out: string[] = []
  let k = n.first
  while (k !== null) {
    if (k.name.length === 0) {
      out.push(k.text)
    } else {
      const flat = profileFlatText(k)
      if (k.name === "bcp14" && flat !== null) {
        out.push(flat)
      } else if (k.name === "tt" && flat !== null) {
        out.push(`\`${flat}\``)
      } else if (k.name === "t" && profileCollapse(out.join("")).length === 0) {
        return profileHead(k)
      } else {
        break
      }
    }
    k = k.next
  }
  return profileCollapse(out.join(""))
}

/** A table row's first cell between pipes (`| Id |`), or how it starts (`| Id`) when it holds markup; "" when it starts with markup. */
const profileRowText = (row: XmlNode): string => {
  let k = row.first
  while (k !== null) {
    if (k.name === "td" || k.name === "th") {
      const head = profileHead(k)
      return head.length === 0 ? "" : profileFlatText(k) !== null ? `| ${head} |` : `| ${head}`
    }
    k = k.next
  }
  return ""
}

/**
 * The text a node's place is about, as its markdown line holds it: for
 * anything in a table row, the row's first cell (profileRowText); for a
 * paragraph, a blockquote or a list item, how its text starts; for anything
 * else (a reference, a heading, a whole table), "", which no line holds.
 */
const profileNodeText = (n: XmlNode): string => {
  let a: XmlNode | null = n
  while (a !== null) {
    if (a.name === "tr") {
      return profileRowText(a)
    }
    a = a.parent
  }
  const block = n.name === "t" || n.name === "blockquote" || n.name === "li" || n.name === "dd" || n.name === "dt"
  return block ? profileHead(n) : ""
}

const profileLocOf = (n: XmlNode): ProfileLoc => new ProfileLoc(n.line, n.mdLine, n.markLine, profileNodeText(n))

/** `loc` moved `n` lines down the XML, onto a line whose text is `text`. */
const profileBelow = (loc: ProfileLoc, n: i32, text: string): ProfileLoc =>
  new ProfileLoc(loc.line + n, loc.mdLine, loc.markLine, profileCollapse(text))

/** A markdown line as compared: blockquote markers dropped, white space collapsed. */
const profileMdLine = (s: string): string => {
  let m = profileCollapse(s)
  while (m.startsWith(">")) {
    m = profileCollapse(m.substring(1, m.length))
  }
  return m
}

/**
 * A markdown line as compared, with its `*` and `_` emphasis markers dropped
 * too, which the XML writes as markup and not as text; "" when it has none.
 */
const profileMdPlain = (m: string): string => {
  if (m.indexOf("*") < 0 && m.indexOf("_") < 0) {
    return ""
  }
  const out: string[] = []
  for (let i = 0; i < m.length; i++) {
    const ch = m.charCodeAt(i)
    if (ch !== 0x2a && ch !== 0x5f) {
      out.push(m.substring(i, i + 1))
    }
  }
  return profileCollapse(out.join(""))
}

/** How long a wrapped line's part must be to stand for the start of a text. */
const PROFILE_WRAP_MIN: i32 = 16

/** Whether `m` from `p` to its end is how `text` starts, compared in place. */
const profileTailOpens = (m: string, p: i32, text: string): boolean => {
  if (m.length - p > text.length) {
    return false
  }
  for (let i = p; i < m.length; i++) {
    if (m.charCodeAt(i) !== text.charCodeAt(i - p)) {
      return false
    }
  }
  return true
}

/**
 * Whether a markdown line holds `text`: a row's first cell (`| Id |`) only
 * where the line starts, as a row's does, so another row's later cell is no
 * match; other text the whole of it anywhere, or (where the text wraps onto
 * the next line) its first PROFILE_WRAP_MIN characters or more ending the
 * line from a word's start.
 */
const profileMdHolds = (m: string, text: string): boolean => {
  if (text.startsWith("| ")) {
    return m.startsWith(text)
  }
  if (m.indexOf(text) >= 0) {
    return true
  }
  for (let p = 0; m.length - p >= PROFILE_WRAP_MIN; p++) {
    if ((p === 0 || m.charCodeAt(p - 1) === 0x20) && profileTailOpens(m, p, text)) {
      return true
    }
  }
  return false
}

/**
 * The one markdown line after the `<?line?>` mark at markdown line `from`,
 * and before the next part's `--- ` line, that holds `text` as it is written
 * or with its emphasis markers dropped; -1 when no line or more than one does.
 */
const profileMdFind = (md: ProfileMd, from: i32, text: string): i32 => {
  if (text.length === 0) {
    return -1
  }
  let found = -1
  for (let i = from; i < md.lines && i < md.text.length; i++) {
    if (md.text[i].startsWith("--- ")) {
      break
    }
    const m = profileMdLine(md.text[i])
    const plain = profileMdPlain(m)
    if (profileMdHolds(m, text) || (plain.length > 0 && profileMdHolds(plain, text))) {
      if (found >= 0) {
        return -1
      }
      found = i + 1
    }
  }
  return found
}

/**
 * Where a place is printed. The markdown file at its markdown line when the
 * place stands on a `<?line N?>` mark's own XML line, the one line whose
 * markdown line the XML vouches for. Below a mark, kramdown-rfc's XML does
 * not follow the markdown line for line, so the place's text is looked for
 * instead: the markdown file at the one line between the mark's and the
 * next part's `--- ` line that holds it, together with the XML file at the
 * place's line. The XML file at its XML line alone when no line or more than
 * one holds the text, when there is no markdown file, no mark before the
 * place, or the mark names a line past the markdown's end: never the mark's
 * own line, which is not the place's.
 *
 * @param line the XML line
 * @param mdLine the last mark's markdown line, or -1
 * @param markLine the XML line that mark stands on
 * @param xmlPath the XML file
 * @param md the markdown file, or null
 * @param text the text the place is about, as the markdown writes it (white space collapsed); "" when it cannot be told
 * @returns the file and line, and the XML line when the line is a markdown one found by its text
 */
export const profileWhere = (
  line: i32,
  mdLine: i32,
  markLine: i32,
  xmlPath: string,
  md: ProfileMd | null,
  text: string,
): ProfileWhere => {
  const w = profileWhereIn(line, mdLine, markLine, xmlPath, md, text)
  w.xmlLine = line
  return w
}

const profileWhereIn = (
  line: i32,
  mdLine: i32,
  markLine: i32,
  xmlPath: string,
  md: ProfileMd | null,
  text: string,
): ProfileWhere => {
  if (md === null || mdLine < 1 || mdLine > md.lines) {
    return new ProfileWhere(xmlPath, line)
  }
  if (line === markLine) {
    const w = new ProfileWhere(md.path, mdLine)
    w.mdOnly = true
    return w
  }
  const found = profileMdFind(md, mdLine, text)
  if (found < 0) {
    return new ProfileWhere(xmlPath, line)
  }
  const w = new ProfileWhere(md.path, found)
  w.exactFile = xmlPath
  w.exactLine = line
  return w
}

/**
 * A place as it is printed: `file:line`, or `md:line (xml:line)` when the
 * markdown line is only near.
 *
 * @param w the place
 * @returns its text
 */
export const profileWhereText = (w: ProfileWhere): string => diagPlace(w.file, w.line, 0, w.exactFile, w.exactLine)

/**
 * Makes a refusal at a place. The column counts along the XML line, so it
 * is dropped when the place is a markdown line alone.
 *
 * @param w the place
 * @param col the 1-based column on the XML line, or 0
 * @param message why
 * @returns the refusal
 */
export const profileRefusalAt = (w: ProfileWhere, col: i32, message: string): ProfileRefusal => {
  const r = new ProfileRefusal(w.file, w.line, w.mdOnly ? 0 : col, message)
  r.exactFile = w.exactFile
  r.exactLine = w.exactLine
  r.xmlLine = w.xmlLine
  return r
}

const profileWhereOf = (c: ProfileContext, loc: ProfileLoc): ProfileWhere =>
  profileWhere(loc.line, loc.mdLine, loc.markLine, c.xmlPath, c.md, loc.text)

const profileRefuseAt = (c: ProfileContext, loc: ProfileLoc, message: string, col: i32): void => {
  c.refusals.push(profileRefusalAt(profileWhereOf(c, loc), col, message))
}

const profileRefuse = (c: ProfileContext, n: XmlNode, message: string): void => {
  profileRefuseAt(c, profileLocOf(n), message, 0)
}

const profileRefuseLoc = (c: ProfileContext, loc: ProfileLoc, message: string): void => {
  profileRefuseAt(c, loc, message, 0)
}

/**
 * Where two refusals are in XML document order: by the XML line each was
 * raised at, then the column on it, whichever file and line they print. A
 * markdown line found by its text need not follow the XML's order, and an
 * XML line and a markdown line are not comparable numbers. Two refusals at
 * one place compare equal, so a stable sort keeps the order they were found.
 *
 * @param a one refusal
 * @param b the other
 * @returns -1, 0 or 1
 */
export const profileRefusalPlace = (a: ProfileRefusal, b: ProfileRefusal): i32 => {
  if (a.xmlLine !== b.xmlLine) {
    return a.xmlLine < b.xmlLine ? -1 : 1
  }
  if (a.col !== b.col) {
    return a.col < b.col ? -1 : 1
  }
  return 0
}

/**
 * Two refusals in XML document order (profileRefusalPlace), then by message
 * at one place, the order profileRead gives its refusals in.
 *
 * @param a one refusal
 * @param b the other
 * @returns -1, 0 or 1
 */
export const profileRefusalOrder = (a: ProfileRefusal, b: ProfileRefusal): i32 => {
  const at = profileRefusalPlace(a, b)
  return at !== 0 ? at : profileCompare(a.message, b.message)
}

/**
 * Refusals in XML document order (profileRefusalOrder).
 *
 * @param rs the refusals, sorted in place
 * @returns them
 */
const profileSortRefusals = (rs: ProfileRefusal[]): ProfileRefusal[] => rs.sort(profileRefusalOrder)

/**
 * Two strings in byte order.
 *
 * @param a one
 * @param b the other
 * @returns -1, 0 or 1
 */
const profileCompare = (a: string, b: string): i32 => {
  const n = a.length < b.length ? a.length : b.length
  for (let i = 0; i < n; i++) {
    const x = a.charCodeAt(i)
    const y = b.charCodeAt(i)
    if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return a.length < b.length ? -1 : a.length > b.length ? 1 : 0
}

// ── Text ───────────────────────────────────────────────────────────────────

/**
 * `s` without leading and trailing white space, as JS `String.prototype.trim`
 * strips it (xmlTrim): the profile trims cells, keywords, names, covers and
 * commands this way, as the old extractor did.
 *
 * @param s the text
 * @returns it trimmed
 */
export const profileTrim = (s: string): string => xmlTrim(s)

/**
 * Why a string cannot be free text in a contract (blank, or holding a
 * control character), or null when it can.
 *
 * @param s the text
 * @returns the fault, or null
 */
const profileTextFault = (s: string): string | null => {
  if (profileTrim(s).length === 0) {
    return "is empty"
  }
  const ch = charsFirstControl(s)
  if (ch !== null) {
    return `holds a control character (${ch})`
  }
  return null
}

const profileCheckText = (c: ProfileContext, loc: ProfileLoc, what: string, s: string): void => {
  const fault = profileTextFault(s)
  if (fault !== null) {
    profileRefuseAt(c, loc, `${what} ${fault}`, 0)
  }
}

const profileIsAlnum = (ch: i32): boolean =>
  (ch >= 0x30 && ch <= 0x39) || (ch >= 0x41 && ch <= 0x5a) || (ch >= 0x61 && ch <= 0x7a)

const profileIsSpace = (ch: i32): boolean => ch === 0x20 || (ch >= 0x09 && ch <= 0x0d)

/** The keywords the reader scans for, longest first; NOT RECOMMENDED is SHOULD NOT. */
const profileKeywords = (): string[] => {
  const out = vocabLevels().filter((l: string): boolean => l !== "DEFINITION")
  out.push("NOT RECOMMENDED")
  return out.sort((a: string, b: string): i32 => (a.length > b.length ? -1 : a.length < b.length ? 1 : 0))
}

/** The end of keyword `k` matched at `i` in `s`, a space matching a run of blanks; -1 when it does not match. */
const profileMatchKeyword = (s: string, i: i32, k: string): i32 => {
  let at = i
  let j = 0
  while (j < k.length) {
    const want = k.charCodeAt(j)
    if (want === 0x20) {
      if (at >= s.length || !profileIsSpace(s.charCodeAt(at))) {
        return -1
      }
      while (at < s.length && profileIsSpace(s.charCodeAt(at))) {
        at = at + 1
      }
    } else {
      if (at >= s.length || s.charCodeAt(at) !== want) {
        return -1
      }
      at = at + 1
    }
    j = j + 1
  }
  return at
}

/**
 * The BCP 14 levels a quote uses, each once, in the order first used. A
 * keyword is not inside a word or a quote, and the longest is taken first,
 * so `MUST NOT` is not `MUST`; `NOT RECOMMENDED` is `SHOULD NOT`.
 *
 * @param s the quote
 * @returns its levels
 */
const profileKeywordLevels = (s: string): string[] => {
  const keys = profileKeywords()
  const out: string[] = []
  let i = 0
  while (i < s.length) {
    const before = i > 0 ? s.charCodeAt(i - 1) : 0
    let end = -1
    let hit = ""
    if (before !== 0x22 && !profileIsAlnum(before)) {
      for (const k of keys) {
        const e = profileMatchKeyword(s, i, k)
        if (e < 0) {
          continue
        }
        const after = e < s.length ? s.charCodeAt(e) : 0
        if (after === 0x22 || profileIsAlnum(after)) {
          continue
        }
        end = e
        hit = k
        break
      }
    }
    if (end < 0) {
      i = i + 1
      continue
    }
    const level = hit === "NOT RECOMMENDED" ? "SHOULD NOT" : hit
    if (!vocabHas(out, level)) {
      out.push(level)
    }
    i = end
  }
  return out
}

// ── The document ───────────────────────────────────────────────────────────

/** Appends `n` and every element under it, in document order, to `out`. */
const profileDescendantsInto = (n: XmlNode, out: XmlNode[]): void => {
  out.push(n)
  for (const k of xmlElements(n)) {
    profileDescendantsInto(k, out)
  }
}

const profileDescendants = (n: XmlNode): XmlNode[] => {
  const out: XmlNode[] = []
  profileDescendantsInto(n, out)
  return out
}

const profileNamed = (n: XmlNode, name: string): XmlNode[] =>
  profileDescendants(n).filter((d: XmlNode): boolean => d.name === name)

/** The first child element of a name; null when there is none. */
const profileChild = (n: XmlNode, name: string): XmlNode | null => {
  for (const k of xmlElements(n)) {
    if (k.name === name) {
      return k
    }
  }
  return null
}

const profileSectionsWalk = (
  parent: XmlNode,
  prefix: string,
  back: boolean,
  numbered: boolean,
  out: ProfileSection[],
): void => {
  let i = 0
  for (const s of xmlElements(parent)) {
    if (s.name !== "section") {
      continue
    }
    i = i + 1
    const n = back && prefix.length === 0 ? String.fromCharCode(64 + i) : `${i}`
    const id = prefix.length > 0 ? `${prefix}.${n}` : n
    const on = numbered && (xmlAttr(s, "numbered") ?? "") !== "false"
    out.push(new ProfileSection(s, on ? id : ""))
    profileSectionsWalk(s, id, back, on, out)
  }
}

/** The document's sections, in order, numbered as xml2rfc numbers them. */
const profileSections = (root: XmlNode): ProfileSection[] => {
  const out: ProfileSection[] = []
  const middle = profileChild(root, "middle")
  if (middle !== null) {
    profileSectionsWalk(middle, "", false, true, out)
  }
  const back = profileChild(root, "back")
  if (back !== null) {
    profileSectionsWalk(back, "", true, true, out)
  }
  return out
}

/** The sourcecode blocks of a section, its subsections' left out. */
const profileOwnCode = (sec: XmlNode): XmlNode[] => {
  const out: XmlNode[] = []
  for (const k of xmlElements(sec)) {
    if (k.name === "section") {
      continue
    }
    for (const d of profileNamed(k, "sourcecode")) {
      out.push(d)
    }
  }
  return out
}

/**
 * A node's text as written: its text nodes, references resolved, nothing
 * else rendered or collapsed.
 *
 * @param n the node
 * @returns its text
 */
const profileRawText = (n: XmlNode): string => {
  if (n.name.length === 0) {
    return n.text
  }
  const parts: string[] = []
  let k = n.first
  while (k !== null) {
    parts.push(profileRawText(k))
    k = k.next
  }
  return parts.join("")
}

const profileCellText = (n: XmlNode): string => profileTrim(profileRawText(n))

/** The one element child of `n` when the text around it is blank; null otherwise. */
const profileOnly = (n: XmlNode): XmlNode | null => {
  let found: XmlNode | null = null
  let k = n.first
  while (k !== null) {
    if (k.name.length > 0) {
      if (found !== null) {
        return null
      }
      found = k
    } else if (profileTrim(k.text).length > 0) {
      return null
    }
    k = k.next
  }
  return found
}

/**
 * Whether a front-matter keyword is meant as the main-source key, spelt
 * right or not: `vector`, then dashes, underscores or blanks, then `main`
 * and an end, a separator or `rfc`, in any case.
 *
 * @param text the keyword
 * @returns true when it looks like the main-source key
 */
const profileLooksLikeMainKey = (text: string): boolean => {
  const s = profileLower(text)
  if (!s.startsWith("vector")) {
    return false
  }
  let i = 6
  while (i < s.length) {
    const ch = s.charCodeAt(i)
    if (ch !== 0x2d && ch !== 0x5f && !profileIsSpace(ch)) {
      break
    }
    i = i + 1
  }
  if (s.substring(i, i + 4) !== "main") {
    return false
  }
  i = i + 4
  if (i >= s.length) {
    return true
  }
  const ch = s.charCodeAt(i)
  return ch === 0x2d || ch === 0x5f || profileIsSpace(ch) || s.substring(i, i + 3) === "rfc"
}

const profileLower = (s: string): string => {
  const parts: string[] = []
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i)
    parts.push(String.fromCharCode(ch >= 0x41 && ch <= 0x5a ? ch + 32 : ch))
  }
  return parts.join("")
}

const profileAllDigits = (s: string): boolean => {
  if (s.length === 0) {
    return false
  }
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i)
    if (ch < 0x30 || ch > 0x39) {
      return false
    }
  }
  return true
}

/** Whether an xref target names an RFC: RFC and digits. */
const profileIsRfcTarget = (t: string): boolean => t.startsWith("RFC") && profileAllDigits(t.substring(3, t.length))

/** The main-source keywords of the front matter, spelt right or not. */
const profileMainKeys = (c: ProfileContext): XmlNode[] => {
  const front = profileChild(c.doc.root, "front")
  if (front === null) {
    return []
  }
  const out: XmlNode[] = []
  for (const k of xmlElements(front)) {
    if (k.name === "keyword" && profileLooksLikeMainKey(profileTrim(xmlPlainText(c.doc.text, k)))) {
      out.push(k)
    }
  }
  return out
}

/**
 * The RFC a keyword names as the main source: `vector-main-RFC<N>`, N
 * without leading zeros; "" when it is not spelt so.
 *
 * @param text the keyword
 * @returns the number's digits, or ""
 */
const profileMainKeyDigits = (text: string): string => {
  const head = `${PROFILE_MAIN_KEY}RFC`
  if (!text.startsWith(head)) {
    return ""
  }
  const digits = text.substring(head.length, text.length)
  if (!profileAllDigits(digits) || digits.charCodeAt(0) === 0x30) {
    return ""
  }
  return digits
}

/** The RFCs listed under Normative References. */
const profileNormativeRfcs = (c: ProfileContext): Set<i32> => {
  const out = new Set<i32>()
  for (const r of profileNamed(c.doc.root, "references")) {
    let normative = false
    for (const k of xmlElements(r)) {
      if (k.name === "name" && profileTrim(xmlPlainText(c.doc.text, k)) === "Normative References") {
        normative = true
      }
    }
    if (!normative) {
      continue
    }
    for (const ref of profileNamed(r, "reference")) {
      const n = c.referenced.get(xmlAttr(ref, "anchor") ?? "")
      if (n !== undefined && n >= 0) {
        out.add(n)
      }
    }
  }
  return out
}

/** The RFC numbered `n`, as handed over; an empty one, recorded as missing, when it was not. */
const profileRfc = (c: ProfileContext, n: i32): RfcDocument => {
  const d = c.rfcs.docs.get(n)
  if (d !== undefined) {
    return d
  }
  if (c.rfcs.missing.indexOf(n) < 0) {
    c.rfcs.missing.push(n)
  }
  return new RfcDocument()
}

/** A cited section's text, made once; null when the RFC has no such section. */
const profileTextOf = (c: ProfileContext, n: i32, section: string): string | null => {
  const key = `${n} ${section}`
  const known = c.texts.get(key)
  if (known !== undefined) {
    return known
  }
  const sec = rfcSection(profileRfc(c, n), section)
  if (sec === null) {
    return null
  }
  const t = rfcSectionText(sec)
  c.texts.set(key, t)
  return t
}

/** The RFC an xref with a section cites, or -1 (refused, or an RFC refused with the other xrefs). */
const profileCitedRfc = (c: ProfileContext, x: XmlNode): i32 => {
  const target = xmlAttr(x, "target") ?? ""
  const n = c.referenced.get(target)
  if (n === undefined || n < 0) {
    if (n === undefined && profileIsRfcTarget(target)) {
      return -1
    }
    profileRefuse(c, x, `xref to "${target}" names no RFC <reference>`)
    return -1
  }
  const section = xmlAttr(x, "section") ?? ""
  if (!charsIsSection(section)) {
    profileRefuse(c, x, `section "${section}" of RFC${n} is not a section number like 2.3 or A.1`)
    return -1
  }
  return n
}

/** Why a construct that quotes the spec itself is refused in main mode. */
const profileOwnText = (c: ProfileContext, what: string): string =>
  `${what} is the spec's own text, but the main source is RFC${c.mainRfc}; quote the RFC in a blockquote ending {{Section N of RFC${c.mainRfc}}}`

// ── The main source and the contract's name ────────────────────────────────

const profileReadMain = (c: ProfileContext): void => {
  const keys = profileMainKeys(c)
  const normative = profileNormativeRfcs(c)
  for (let i = 1; i < keys.length; i++) {
    const k = keys[i]
    profileRefuse(
      c,
      k,
      `a spec has one main source; keyword ${profileTrim(xmlPlainText(c.doc.text, k))} names a second`,
    )
  }
  if (keys.length === 0) {
    return
  }
  const key = keys[0]
  c.mainKey = key
  const text = profileTrim(xmlPlainText(c.doc.text, key))
  const digits = profileMainKeyDigits(text)
  if (digits.length === 0) {
    profileRefuse(c, key, `the main-source keyword is ${PROFILE_MAIN_KEY}RFC<N>, not ${text}`)
    return
  }
  const n: i32 = digits.length <= 9 ? parseInt(digits) : -1
  if (n < 0 || !normative.has(n)) {
    profileRefuse(c, key, `${text} names RFC${digits}, which is not a normative reference; list it under normative:`)
    return
  }
  c.mainRfc = n
}

/**
 * The contract name a docName gives: `draft-<name>-NN`; null when it is not
 * spelt so.
 *
 * @param docName the docName
 * @returns the name, or null
 */
const profileDraftName = (docName: string): string | null => {
  const n = docName.length
  if (!docName.startsWith("draft-") || n < 10) {
    return null
  }
  const tail = docName.substring(n - 3, n)
  if (tail.charCodeAt(0) !== 0x2d || !profileAllDigits(tail.substring(1, 3))) {
    return null
  }
  return docName.substring(6, n - 3)
}

const profileContractName = (c: ProfileContext): string => {
  const file = c.xmlPath.substring(profileLastSlash(c.xmlPath) + 1, c.xmlPath.length)
  const base = file.endsWith(".xml") ? file.substring(0, file.length - 4) : file
  const docName = c.doc.docName ?? ""
  const name = profileDraftName(docName)
  const root = c.doc.root
  if (name === null) {
    profileRefuse(c, root, `docName "${docName}" is not draft-<name>-NN`)
  } else if (name !== base) {
    profileRefuse(c, root, `docName "${docName}" names contract "${name}", but the file is ${base}.xml`)
  } else if (!charsIsId(name)) {
    profileRefuse(c, root, `docName "${docName}" names contract "${name}", which ${PROFILE_ID_RULE}`)
  } else {
    return name
  }
  return base
}

// ── The interface ──────────────────────────────────────────────────────────

/** Whether a sourcecode block is of `kind` (interface, property); a type no front end reads is refused. */
const profileFronted = (c: ProfileContext, node: XmlNode, kind: string): boolean => {
  const type = xmlAttr(node, "type") ?? ""
  if (!type.endsWith(`-${kind}`)) {
    return false
  }
  if (!frontReads(type)) {
    profileRefuse(c, node, `no front end reads sourcecode type "${type}"`)
    return false
  }
  return true
}

/**
 * The XML column of column `col` of `line`, the text a text node holds from
 * where its `i`th XML line starts in it; 0 unless the XML writes that line
 * as is through `col`, with no reference, CDATA section or comment before it.
 */
const profileXmlCol = (t: XmlNode, i: i32, line: string, col: i32): i32 => {
  const raw = split(t.raw, "\n")
  if (col <= 0 || i < 0 || i >= raw.length) {
    return 0
  }
  const upTo = line.substring(0, col)
  if (raw[i].substring(0, upTo.length) !== upTo) {
    return 0
  }
  return (i === 0 ? t.col : 1) + col - 1
}

/** Refuses a code block at each front end's place, with the column where the XML holds the code as is. */
const profileFrontRefuse = (c: ProfileContext, node: XmlNode, rs: FrontRefusal[]): void => {
  const code = xmlCodeOf(node)
  const at = new ProfileLoc(code.line, code.mdLine, code.markLine, "")
  const t = node.first
  const only: XmlNode | null = t !== null && t.next === null && t.name.length === 0 ? t : null
  const lines = split(code.text, "\n")
  for (const r of rs) {
    let col = 0
    if (only !== null && r.line >= 1 && r.line <= lines.length) {
      col = profileXmlCol(only, code.line + r.line - 1 - only.line, lines[r.line - 1], r.col)
    }
    profileRefuseAt(
      c,
      profileBelow(at, r.line - 1, r.line >= 1 && r.line <= lines.length ? lines[r.line - 1] : ""),
      r.message,
      col,
    )
  }
}

const profileReadInterface = (c: ProfileContext, code: XmlNode[]): void => {
  const interfaces: XmlNode[] = []
  for (const n of code) {
    if (profileFronted(c, n, "interface")) {
      interfaces.push(n)
    }
  }
  if (interfaces.length !== 1) {
    const at = interfaces.length > 0 ? interfaces[1] : c.doc.root
    profileRefuse(c, at, `a spec has exactly one ts-interface block; this one has ${interfaces.length}`)
  }
  if (interfaces.length === 0) {
    return
  }
  const iface = interfaces[0]
  const code0 = xmlCodeOf(iface)
  const r = frontParseInterface(code0.text)
  if (r.isErr()) {
    profileFrontRefuse(c, iface, r.error)
    return
  }
  const got = r.value
  c.functions = got.functions
  c.module = got.module
  const at = new ProfileLoc(code0.line, code0.mdLine, code0.markLine, "")
  const ifaceLines = split(code0.text, "\n")
  for (const l of got.lines) {
    c.fnLocs.push(profileBelow(at, l - 1, l >= 1 && l <= ifaceLines.length ? ifaceLines[l - 1] : ""))
  }
  profileCheckText(c, profileLocOf(iface), "the ts-interface block's module", c.module)
  const names = shapeTestNames()
  const prefixes = shapeTestPrefixes()
  for (let i = 0; i < c.functions.length; i++) {
    const name = c.functions[i].name
    if (vocabHas(names, name) || prefixes.some((p: string): boolean => name.startsWith(p))) {
      profileRefuseAt(
        c,
        c.fnLocs[i],
        `function ${name}: the generated test uses this name itself (its helpers, and names starting ${prefixes.join(" ")}), so it cannot call such a function`,
        0,
      )
    }
  }
}

const profileFn = (c: ProfileContext, name: string): FnSig | null => {
  for (const f of c.functions) {
    if (f.name === name) {
      return f
    }
  }
  return null
}

// ── Requirements and exclusions ────────────────────────────────────────────

const profileBcp14Under = (n: XmlNode): XmlNode[] => profileNamed(n, "bcp14")

const profileEntriesUnder = (c: ProfileContext, n: XmlNode): XmlNormative[] => {
  const out: XmlNormative[] = []
  for (const b of profileBcp14Under(n)) {
    const es = c.byNode.get(b)
    if (es !== undefined) {
      for (const e of es) {
        out.push(e)
      }
    }
  }
  return out
}

const profileLevelsOf = (es: XmlNormative[]): string[] => {
  const out: string[] = []
  for (const e of es) {
    if (!vocabHas(out, e.level)) {
      out.push(e.level)
    }
  }
  return out
}

const profileHandle = (c: ProfileContext, n: XmlNode): void => {
  for (const b of profileBcp14Under(n)) {
    c.handled.add(b)
  }
}

const profileStartsWith = (c: ProfileContext, n: XmlNode | null, head: string): boolean => {
  if (n === null || n.name !== "t") {
    return false
  }
  return xmlPlainText(c.doc.text, n).startsWith(head)
}

const profileAfter = (c: ProfileContext, n: XmlNode, head: string): string => {
  const t = xmlPlainText(c.doc.text, n)
  return t.substring(head.length, t.length)
}

/** A paragraph read as a requirement: a definition or one BCP 14 sentence. */
const profileReadParagraph = (c: ProfileContext, n: XmlNode, section: string): ProfileBlock => {
  const anchor = xmlAttr(n, "anchor")
  const text = xmlPlainText(c.doc.text, n)
  const found = profileEntriesUnder(c, n)
  const refused = new ProfileBlock(false, null)
  if (text.startsWith(PROFILE_DEFINITION)) {
    if (c.mainRfc >= 0) {
      profileRefuse(c, n, profileOwnText(c, "a Definition: paragraph"))
      return refused
    }
    if (anchor === null) {
      profileRefuse(c, n, "a Definition: paragraph needs an anchor")
      return refused
    }
    // A quoted keyword ("MUST") is named, not used: the reader makes no entry.
    if (found.length > 0) {
      profileRefuse(c, n, `${anchor} is a definition but holds BCP 14 keywords; a definition holds none`)
      return refused
    }
    const quote = text.substring(PROFILE_DEFINITION.length, text.length)
    return new ProfileBlock(false, new ProfileQuoted(anchor, section, quote, "DEFINITION", profileLocOf(n)))
  }
  if (anchor === null || found.length === 0) {
    return new ProfileBlock(true, null)
  }
  if (c.mainRfc >= 0) {
    profileRefuse(c, n, profileOwnText(c, `${anchor}, a BCP 14 paragraph,`))
    return refused
  }
  const sentences: string[] = []
  for (const e of found) {
    if (!vocabHas(sentences, e.sentence)) {
      sentences.push(e.sentence)
    }
  }
  if (sentences.length > 1) {
    profileRefuse(c, n, `${anchor} holds ${sentences.length} BCP 14 sentences; give each its own anchor`)
    return refused
  }
  const levels = profileLevelsOf(found)
  if (levels.length > 1) {
    profileRefuse(
      c,
      n,
      `${anchor} holds more than one BCP 14 level (${levels.join(", ")}); give each level its own sentence`,
    )
    return refused
  }
  return new ProfileBlock(false, new ProfileQuoted(anchor, section, found[0].sentence, levels[0], profileLocOf(n)))
}

/** A blockquote read as a requirement, or with `excluded` an exclusion. */
const profileReadQuote = (c: ProfileContext, n: XmlNode, excluded: boolean): ProfileBlock => {
  const anchor = xmlAttr(n, "anchor")
  const refused = new ProfileBlock(false, null)
  // An unanchored blockquote is an exclusion or nothing.
  if (anchor === null && !excluded) {
    return new ProfileBlock(true, null)
  }
  const what = anchor === null ? "an excluded blockquote" : `blockquote ${anchor}`
  const ts = xmlElements(n)
  const allT = ts.every((t: XmlNode): boolean => t.name === "t")
  const last: XmlNode | null = ts.length > 0 ? ts[ts.length - 1] : null
  let x: XmlNode | null = null
  if (last !== null) {
    let k = last.first
    while (k !== null) {
      if (k.name.length > 0 || profileTrim(k.text).length > 0) {
        x = k
      }
      k = k.next
    }
  }
  const xs: XmlNode | null = x
  if (!allT || last === null || xs === null || xs.name !== "xref" || xmlAttr(xs, "section") === null) {
    profileRefuse(c, n, `${what} must be <t> paragraphs, the last ending with {{Section N of RFCx}}`)
    return refused
  }
  const section = xmlAttr(xs, "section") ?? ""
  const rfc = profileCitedRfc(c, xs)
  if (rfc < 0) {
    return refused
  }
  const texts: string[] = []
  for (let i = 0; i + 1 < ts.length; i++) {
    texts.push(xmlPlainText(c.doc.text, ts[i]))
  }
  const kept: XmlNode[] = []
  let k = last.first
  while (k !== null) {
    if (k !== xs) {
      kept.push(k)
    }
    k = k.next
  }
  texts.push(xmlPlainTextOfNodes(c.doc.text, kept))
  const quote = rfcNormalize(texts.join(" "))
  const levels = profileKeywordLevels(quote)
  // An unanchored exclusion exists to exclude a BCP 14 sentence; one with no
  // keyword excludes nothing.
  if (anchor === null && levels.length === 0) {
    profileRefuse(c, n, `${what} holds no BCP 14 keyword, so it excludes nothing; anchor it to exclude a definition`)
    return refused
  }
  // An exclusion records no level, so it may quote a sentence with two.
  if (levels.length > 1 && !excluded) {
    profileRefuse(
      c,
      n,
      `${what} holds more than one BCP 14 level (${levels.join(", ")}); quote one level per requirement`,
    )
    return refused
  }
  const q = new ProfileQuoted(
    anchor ?? "",
    section,
    quote,
    levels.length > 0 ? levels[0] : "DEFINITION",
    profileLocOf(n),
  )
  q.citeRfc = rfc
  q.citeSection = section
  return new ProfileBlock(false, q)
}

/** An unanchored BCP 14 paragraph excluded by the Untested: paragraph after it. */
const profileExcludeParagraph = (c: ProfileContext, n: XmlNode, next: XmlNode, section: string): void => {
  profileHandle(c, n)
  if (c.mainRfc >= 0) {
    profileRefuse(c, n, profileOwnText(c, "an excluded paragraph"))
    return
  }
  profileHandle(c, next)
  if (section.length === 0) {
    profileRefuse(c, n, "an excluded sentence is in an unnumbered section; it needs a section number")
    return
  }
  const levels = profileLevelsOf(profileEntriesUnder(c, n))
  if (levels.length > 1) {
    profileRefuse(
      c,
      n,
      `an excluded paragraph holds more than one BCP 14 level (${levels.join(", ")}); exclude each level apart`,
    )
    return
  }
  const reason = profileAfter(c, next, PROFILE_UNTESTED)
  profileCheckText(c, profileLocOf(next), "the Untested: reason", reason)
  const quote = xmlPlainText(c.doc.text, n)
  profileCheckText(c, profileLocOf(n), "the excluded sentence", quote)
  const q = new ProfileQuoted("", section, quote, levels[0], profileLocOf(n))
  q.reason = reason
  c.exclusions.push(q)
}

/**
 * An Out of scope: paragraph: the export before the first comma, and the
 * reason after it. Whether the export is tested is checked once the clauses
 * are read (profileCheckOutOfScope).
 */
const profileReadOutOfScope = (c: ProfileContext, n: XmlNode): void => {
  const body = profileAfter(c, n, PROFILE_OUT_OF_SCOPE)
  const comma = body.indexOf(",")
  if (comma < 0) {
    profileRefuse(c, n, `an Out of scope: paragraph gives a reason after a comma: ${PROFILE_OUT_OF_SCOPE_FORM}`)
    return
  }
  const name = profileTrim(body.substring(0, comma))
  const reason = profileTrim(body.substring(comma + 1, body.length))
  if (!charsIsIdent(name)) {
    profileRefuse(c, n, `out-of-scope export "${name}" is not an identifier: ${PROFILE_OUT_OF_SCOPE_FORM}`)
    return
  }
  if (reason.length === 0) {
    profileRefuse(c, n, `${name} is out of scope with no reason: ${PROFILE_OUT_OF_SCOPE_FORM}`)
    return
  }
  // A reason says why no clause tests the export; it makes no requirement of
  // its own, in a spec of its own or one whose main source is an RFC. A quoted
  // keyword ("MUST") is named, not used, and makes no entry.
  if (profileEntriesUnder(c, n).length > 0) {
    profileRefuse(
      c,
      n,
      `${name}'s out-of-scope reason uses a BCP 14 keyword, but a reason makes no requirement: reword it, or quote the keyword ("MUST")`,
    )
    return
  }
  profileCheckText(c, profileLocOf(n), `${name}'s out-of-scope reason`, reason)
  for (const o of c.outOfScope) {
    if (o.name === name) {
      profileRefuse(c, n, `${name} is already out of scope; give each export one Out of scope: paragraph`)
      return
    }
  }
  const o = new OutOfScope()
  o.name = name
  o.reason = reason
  c.outOfScope.push(o)
  c.outOfScopeLocs.push(profileLocOf(n))
}

/**
 * An export out of scope is neither a function under test nor a reference
 * function a property calls (a vector calls only functions under test).
 */
const profileCheckOutOfScope = (c: ProfileContext): void => {
  for (let i = 0; i < c.outOfScope.length; i++) {
    const name = c.outOfScope[i].name
    const loc = c.outOfScopeLocs[i]
    if (c.functions.some((f: FnSig): boolean => f.module === null && f.name === name)) {
      profileRefuseAt(c, loc, `${name} is a function under test, so it cannot be out of scope`, 0)
      continue
    }
    for (const k of c.properties) {
      const a = k.assert
      if (a !== null && vocabHas(typeCallsIn(a), name)) {
        profileRefuseAt(c, loc, `${name} is called by property ${k.id}, so it cannot be out of scope`, 0)
      }
    }
  }
}

/** The blocks of a section (or of an element in it), read in order. */
const profileBlocks = (c: ProfileContext, parent: XmlNode, section: string): void => {
  const kids = xmlElements(parent).filter((k: XmlNode): boolean => k.name !== "name" && k.name !== "section")
  // The Untested: and Note: paragraphs that go with the block before them.
  const used = new Set<XmlNode>()
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i]
    if (n.name === "table") {
      // The run of Tolerance:, Iterate: and Truncate: paragraphs right after
      // it, in any order, goes with it; a BCP 14 keyword in one is quoted, not used.
      const table = new ProfileTable(n, section)
      for (let j = i + 1; j < kids.length; j++) {
        const iterate = profileStartsWith(c, kids[j], PROFILE_ITERATE)
        const truncate = profileStartsWith(c, kids[j], PROFILE_TRUNCATE)
        if (!iterate && !truncate && !profileStartsWith(c, kids[j], PROFILE_TOLERANCE)) {
          break
        }
        used.add(kids[j])
        profileHandle(c, kids[j])
        if (iterate) {
          table.iterates.push(kids[j])
        } else if (truncate) {
          table.truncates.push(kids[j])
        } else {
          table.tolerances.push(kids[j])
        }
      }
      c.tables.push(table)
      continue
    }
    if (n.name !== "t" && n.name !== "blockquote") {
      profileBlocks(c, n, section)
      continue
    }
    if (used.has(n)) {
      continue
    }
    if (profileStartsWith(c, n, PROFILE_OUT_OF_SCOPE)) {
      profileHandle(c, n)
      profileReadOutOfScope(c, n)
      continue
    }
    const next: XmlNode | null = i + 1 < kids.length ? kids[i + 1] : null
    const nextUntested = profileStartsWith(c, next, PROFILE_UNTESTED)
    // An anchored block, or an unanchored blockquote with an Untested:
    // paragraph after it, is a requirement or exclusion or refused as one.
    if (xmlAttr(n, "anchor") !== null || (n.name === "blockquote" && nextUntested)) {
      profileHandle(c, n)
    }
    const b = n.name === "t" ? profileReadParagraph(c, n, section) : profileReadQuote(c, n, nextUntested)
    if (b.none) {
      // An unanchored blockquote with no Untested: after it quotes the RFC
      // but neither requires nor excludes what it quotes.
      if (n.name === "blockquote") {
        for (const l of profileBcp14Under(n)) {
          c.unclaimed.add(l)
        }
      }
      if (n.name !== "t" || !nextUntested || next === null) {
        continue
      }
      if (profileEntriesUnder(c, n).length === 0) {
        continue
      }
      used.add(next)
      profileExcludeParagraph(c, n, next, section)
      continue
    }
    // A refused block's Untested: paragraph goes with it, unjudged.
    const untested: XmlNode | null = nextUntested ? next : null
    if (untested !== null) {
      used.add(untested)
      profileHandle(c, untested)
    }
    const q = b.q
    if (q === null) {
      continue
    }
    // An excluded blockquote needs no anchor; an anchor it has is checked.
    if (!(untested !== null && q.id.length === 0) && !charsIsId(q.id)) {
      profileRefuse(c, n, `requirement id "${q.id}" ${PROFILE_ID_RULE}`)
      continue
    }
    const fault = profileTextFault(q.quote)
    if (fault !== null) {
      profileRefuse(c, n, `${q.id}'s quote ${fault}`)
      continue
    }
    if (section.length === 0 && q.citeRfc < 0) {
      profileRefuse(c, n, `${q.id} is in an unnumbered section; a requirement needs a section number`)
      continue
    }
    if (untested !== null) {
      const name = q.id.length > 0 ? `${q.id}'s` : "the"
      q.reason = profileAfter(c, untested, PROFILE_UNTESTED)
      profileCheckText(c, profileLocOf(untested), `${name} Untested: reason`, q.reason)
      c.exclusions.push(q)
      continue
    }
    if (next !== null && profileStartsWith(c, next, PROFILE_NOTE)) {
      used.add(next)
      const note = profileAfter(c, next, PROFILE_NOTE)
      q.note = note
      profileCheckText(c, profileLocOf(next), `${q.id}'s note`, note)
    }
    c.requirements.push(q)
  }
  for (const n of kids) {
    if (used.has(n)) {
      continue
    }
    if (profileStartsWith(c, n, PROFILE_UNTESTED)) {
      profileRefuse(
        c,
        n,
        "this Untested: paragraph excludes nothing; it must directly follow the requirement or BCP 14 paragraph it excludes",
      )
    } else if (profileStartsWith(c, n, PROFILE_NOTE)) {
      profileRefuse(c, n, "this Note: paragraph notes nothing; it must directly follow the requirement it notes")
    } else if (profileStartsWith(c, n, PROFILE_TOLERANCE)) {
      profileHandle(c, n)
      profileRefuse(c, n, PROFILE_STRAY_TOLERANCE)
    } else if (profileStartsWith(c, n, PROFILE_ITERATE)) {
      profileHandle(c, n)
      profileRefuse(c, n, PROFILE_STRAY_ITERATE)
    } else if (profileStartsWith(c, n, PROFILE_TRUNCATE)) {
      profileHandle(c, n)
      profileRefuse(c, n, PROFILE_STRAY_TRUNCATE)
    }
  }
}

const profileUnhandled = (c: ProfileContext): void => {
  for (const e of c.doc.normative) {
    if (c.handled.has(e.node)) {
      continue
    }
    let message = ""
    if (c.mainRfc < 0) {
      message = `BCP 14 sentence has no anchor and no Untested: paragraph after it: "${e.sentence}"`
    } else if (c.unclaimed.has(e.node)) {
      message = `this BCP 14 sentence is an RFC quote with no anchor and no Untested: paragraph; anchor the blockquote to require it, or follow it with Untested: to exclude it: "${e.sentence}"`
    } else {
      message = `${profileOwnText(c, "this BCP 14 sentence")}: "${e.sentence}"`
    }
    profileRefuseLoc(
      c,
      new ProfileLoc(e.node.line, e.node.mdLine, e.node.markLine, profileCollapse(e.sentence)),
      message,
    )
  }
}

/** Each blockquote's quote against the RFC section it cites. */
const profileCheckQuotes = (c: ProfileContext): void => {
  const all: ProfileQuoted[] = []
  for (const q of c.requirements) {
    all.push(q)
  }
  for (const q of c.exclusions) {
    all.push(q)
  }
  for (const q of all) {
    if (q.citeRfc < 0) {
      continue
    }
    c.cited.add(q.citeRfc)
    // A missing section is refused with the other cited xrefs.
    const text = profileTextOf(c, q.citeRfc, q.citeSection)
    if (text !== null && text.indexOf(rfcNormalize(q.quote)) < 0) {
      const who = q.id.length > 0 ? q.id : "the quote"
      profileRefuseAt(c, q.loc, `${who} is not in Section ${q.citeSection} of RFC${q.citeRfc}: "${q.quote}"`, 0)
    }
  }
}

/** A Covers list: at least one id, no empty or repeated one, each a requirement. */
const profileCheckCovers = (c: ProfileContext, covers: string[], loc: ProfileLoc): void => {
  if (covers.length === 0) {
    profileRefuseAt(c, loc, "Covers names no requirement", 0)
  }
  const seen: string[] = []
  for (const k of covers) {
    if (k.length === 0) {
      profileRefuseAt(c, loc, "Covers has an empty item", 0)
    } else if (vocabHas(seen, k)) {
      profileRefuseAt(c, loc, `Covers names "${k}" twice`, 0)
    } else if (!c.ids.has(k)) {
      profileRefuseAt(c, loc, `Covers names "${k}", which is no requirement`, 0)
    }
    seen.push(k)
  }
}

const profileCheckId = (c: ProfileContext, id: string, loc: ProfileLoc): void => {
  if (!charsIsId(id)) {
    profileRefuseAt(c, loc, `clause id "${id}" ${PROFILE_ID_RULE}`, 0)
  } else if (c.clauseIds.has(id)) {
    profileRefuseAt(c, loc, `clause id ${id} is given twice`, 0)
  }
  c.clauseIds.add(id)
}

// ── Vectors ────────────────────────────────────────────────────────────────

const profileRowsOf = (table: XmlNode): XmlNode[] => profileNamed(table, "tr")

const profileCellsOf = (tr: XmlNode): XmlNode[] =>
  xmlElements(tr).filter((k: XmlNode): boolean => k.name === "td" || k.name === "th")

const profileReadTable = (c: ProfileContext, t: ProfileTable): void => {
  const table = t.node
  const section = t.section
  const rows = profileRowsOf(table)
  const header: string[] =
    rows.length > 0 ? profileCellsOf(rows[0]).map((k: XmlNode): string => profileCellText(k)) : []
  const want = profileVectorHeader()
  const lower = want.map((h: string): string => profileLower(h))
  // A table that looks like a vector table is one, exactly, or refused: it
  // has three or more of the six header names, in any order or case.
  let like = 0
  for (const h of header) {
    if (vocabHas(lower, profileLower(h))) {
      like = like + 1
    }
  }
  if (like < 3) {
    for (const p of t.tolerances) {
      profileRefuse(c, p, PROFILE_STRAY_TOLERANCE)
    }
    for (const p of t.iterates) {
      profileRefuse(c, p, PROFILE_STRAY_ITERATE)
    }
    for (const p of t.truncates) {
      profileRefuse(c, p, PROFILE_STRAY_TRUNCATE)
    }
    return
  }
  if (header.join("|") !== want.join("|")) {
    profileRefuse(c, table, `a vector table's header is ${want.join(" | ")}, not ${header.join(" | ")}`)
    return
  }
  if (c.vectorTable !== null) {
    profileRefuse(c, table, "a spec has one vector table; this is a second")
    return
  }
  c.vectorTable = table
  if (section.length === 0) {
    profileRefuse(c, table, "a vector table is in an unnumbered section; it needs a section number")
    return
  }
  // Every row's id, read or refused, so a tolerance of a refused row is not
  // refused again.
  const rowIds = new Set<string>()
  const read = new Map<string, Clause>()
  for (let i = 1; i < rows.length; i++) {
    const cells = profileCellsOf(rows[i])
    if (cells.length > 0) {
      rowIds.add(profileCellText(cells[0]))
    }
    const v = profileReadRow(c, cells, section, rows[i])
    if (v !== null) {
      c.vectors.push(v)
      c.vectorLocs.push(profileLocOf(rows[i]))
      read.set(v.id, v)
    }
  }
  for (const p of t.tolerances) {
    profileReadTolerance(c, p, section, rowIds, read)
  }
  for (const p of t.iterates) {
    profileReadIterate(c, p, rowIds, read)
  }
  for (const p of t.truncates) {
    profileReadTruncate(c, p, rowIds, read)
  }
}

/**
 * A Truncate: paragraph, `<id> to <N> bits` or `<id> to <N> bytes`: the row's
 * bytes result is held to its first N bytes, which its Expected prints whole.
 */
const profileReadTruncate = (c: ProfileContext, p: XmlNode, rowIds: Set<string>, read: Map<string, Clause>): void => {
  const words = split(profileTrim(profileAfter(c, p, PROFILE_TRUNCATE)), " ").filter(
    (w: string): boolean => w.length > 0,
  )
  if (words.length !== 4 || words[1] !== "to") {
    profileRefuse(
      c,
      p,
      `a Truncate: paragraph reads "<id> to <N> bits" or "<id> to <N> bytes": ${PROFILE_TRUNCATE_FORM}`,
    )
    return
  }
  const id = words[0]
  const len = words[2]
  const unit = words[3]
  if (!profileAllDigits(len) || len.startsWith("0") || len.length > 7) {
    profileRefuse(
      c,
      p,
      `${id}'s length is a whole number of at least 1 in digits, with no leading zero, not "${len}": ${PROFILE_TRUNCATE_FORM}`,
    )
    return
  }
  if (unit !== "bits" && unit !== "bytes") {
    profileRefuse(c, p, `${id}'s length is in "bits" or "bytes", not "${unit}": ${PROFILE_TRUNCATE_FORM}`)
    return
  }
  let n: i64 = 0
  for (let i = 0; i < len.length; i++) {
    n = n * 10 + toI64(len.charCodeAt(i) - 48)
  }
  if (unit === "bits" && n % 8 !== 0) {
    profileRefuse(
      c,
      p,
      `${id} is truncated to ${len} bits, which is no whole number of bytes; a length in bits is a multiple of 8`,
    )
    return
  }
  const bytes = unit === "bits" ? n / 8 : n
  if (bytes > PROFILE_TRUNCATE_MAX_BYTES) {
    profileRefuse(c, p, `${id} is truncated to ${len} ${unit}, more than 65536 bytes`)
    return
  }
  if (!rowIds.has(id)) {
    profileRefuse(c, p, `Truncate: names "${id}", which is no vector of the table: ${PROFILE_TRUNCATE_FORM}`)
    return
  }
  const v = read.get(id)
  if (v === undefined) {
    return
  }
  if (v.truncate !== null) {
    profileRefuse(c, p, `${id} is truncated already; a vector has at most one Truncate: paragraph`)
    return
  }
  const fn = profileFn(c, v.call)
  const ret = fn !== null ? vocabValueType(fn.returns) : ""
  if (ret !== "bytes") {
    profileRefuse(c, p, `${id}'s ${v.call} returns ${ret}, and only a bytes result is truncated`)
    return
  }
  const expect = v.expect
  const got: i64 = expect === null ? toI64(-1) : literalsByteLength(expect)
  if (got >= 0 && got !== bytes) {
    profileRefuse(
      c,
      p,
      `${id}'s Expected is ${got} bytes (${got * 8} bits), but Truncate: keeps ${bytes} bytes (${bytes * 8} bits); the Expected is the whole truncated result`,
    )
    return
  }
  v.truncate = new Truncate(bytes, unit)
  c.truncateIds.push(id)
  c.truncateLocs.push(profileLocOf(p))
}

/** Whether `s` is a section number at or under `parent` (`2.1` is under `2`). */
const profileWithin = (s: string, parent: string): boolean => s === parent || s.startsWith(`${parent}.`)

/** An ulps count: 1 to 2^53−1 in decimal digits, or -1. */
const profileUlps = (s: string): i64 => {
  if (s.length === 0 || s.length > PROFILE_ULPS_MAX.length || !profileAllDigits(s) || s.startsWith("0")) {
    return -1
  }
  if (s.length === PROFILE_ULPS_MAX.length && profileCompare(s, PROFILE_ULPS_MAX) > 0) {
    return -1
  }
  let n: i64 = 0
  for (let i = 0; i < s.length; i++) {
    n = n * 10 + toI64(s.charCodeAt(i) - 48)
  }
  return n
}

/**
 * The bound a Tolerance: paragraph states before its citation, `V1 ulps 1,`
 * or `V1 abs 1e-9,`, into `t`; the vector id, or null when refused.
 */
const profileToleranceBound = (c: ProfileContext, p: XmlNode, head: string, t: Tolerance): string | null => {
  const words = split(profileTrim(head), " ").filter((w: string): boolean => w.length > 0)
  if (words.length !== 3 || !words[2].endsWith(",")) {
    profileRefuse(c, p, `a Tolerance: paragraph is ${PROFILE_TOLERANCE_FORM}`)
    return null
  }
  const id = words[0]
  const kind = words[1]
  const value = words[2].substring(0, words[2].length - 1)
  if (kind === "ulps") {
    const n = profileUlps(value)
    if (n < 0) {
      profileRefuse(c, p, `${id}'s ulps tolerance is a whole number from 1 to ${PROFILE_ULPS_MAX}, not "${value}"`)
      return null
    }
    t.isUlps = true
    t.ulps = n
    return id
  }
  if (kind === "abs") {
    if (!charsIsAbs(value) || !(contractF64Parse(value) > 0)) {
      profileRefuse(c, p, `${id}'s abs tolerance is a decimal greater than 0 as an f64, like 1e-9, not "${value}"`)
      return null
    }
    if (contractF64Overflows(value)) {
      profileRefuse(c, p, `${id}'s abs tolerance must be finite, but "${value}" rounds to Infinity`)
      return null
    }
    t.abs = value
    return id
  }
  profileRefuse(c, p, `${id}'s tolerance is ulps or abs, not "${kind}"`)
  return null
}

/** The section a tolerance cites, into `t`; false when refused. */
const profileToleranceCite = (c: ProfileContext, x: XmlNode, section: string, t: Tolerance): boolean => {
  const target = xmlAttr(x, "target") ?? ""
  const cited = xmlAttr(x, "section")
  if (cited !== null) {
    const n = profileCitedRfc(c, x)
    if (n < 0) {
      return false
    }
    c.cited.add(n)
    t.section = cited
    if (n !== c.mainRfc) {
      t.source = `rfc${n}`
    }
    return true
  }
  const num = c.doc.sectionByAnchor.get(target)
  if (num === undefined) {
    profileRefuse(c, x, `the tolerance cites "${target}", which is no numbered section`)
    return false
  }
  if (c.mainRfc >= 0) {
    profileRefuse(c, x, profileOwnText(c, `the tolerance's section ${target}`))
    return false
  }
  // The paragraph is printed in its own section, so there it would find its
  // own quote.
  if (profileWithin(section, num)) {
    profileRefuse(
      c,
      x,
      `the tolerance cites Section ${num}, which holds this Tolerance: paragraph, so its quote would be found in itself; cite the section that states the tolerance`,
    )
    return false
  }
  t.section = num
  return true
}

/** A Tolerance: paragraph, set on the vector it names. */
const profileReadTolerance = (
  c: ProfileContext,
  p: XmlNode,
  section: string,
  rowIds: Set<string>,
  read: Map<string, Clause>,
): void => {
  const before: XmlNode[] = []
  const after: XmlNode[] = []
  let xref: XmlNode | null = null
  let xrefs = 0
  let k = p.first
  while (k !== null) {
    if (k.name === "xref") {
      xrefs = xrefs + 1
      xref = k
    } else if (xrefs === 0) {
      before.push(k)
    } else {
      after.push(k)
    }
    k = k.next
  }
  const x: XmlNode | null = xref
  if (x === null || xrefs > 1) {
    profileRefuse(c, p, `a tolerance cites exactly one section that allows it: ${PROFILE_TOLERANCE_FORM}`)
    return
  }
  const t = new Tolerance()
  const head = xmlPlainTextOfNodes(c.doc.text, before)
  const id = profileToleranceBound(c, p, head.substring(PROFILE_TOLERANCE.length, head.length), t)
  if (id === null) {
    return
  }
  const tail = xmlPlainTextOfNodes(c.doc.text, after)
  if (!tail.startsWith(': "') || !tail.endsWith('"') || tail.length <= 4) {
    profileRefuse(
      c,
      p,
      `${id}'s tolerance quotes the sentence that allows it after the citation: ${PROFILE_TOLERANCE_FORM}`,
    )
    return
  }
  t.quote = tail.substring(3, tail.length - 1)
  profileCheckText(c, profileLocOf(p), `${id}'s tolerance quote`, t.quote)
  if (!profileToleranceCite(c, x, section, t)) {
    return
  }
  if (!rowIds.has(id)) {
    profileRefuse(c, p, `Tolerance: names "${id}", which is no vector of the table`)
    return
  }
  const v = read.get(id)
  if (v === undefined) {
    return
  }
  if (v.tolerance !== null) {
    profileRefuse(c, p, `${id} has a tolerance already; a vector has at most one`)
    return
  }
  const fn = profileFn(c, v.call)
  const ret = fn !== null ? fn.returns : ""
  if (ret !== "f64") {
    profileRefuse(c, p, `${id}'s ${v.call} returns ${ret}, and only an f64 result is compared within a tolerance`)
    return
  }
  v.tolerance = t
  c.toleranceIds.push(id)
  c.toleranceLocs.push(profileLocOf(p))
}

/**
 * An Iterate: paragraph's count: decimal digits, grouped in threes by commas
 * or not at all, from 1 to 1,000,000,000; -1 when it is none.
 */
const profileIterateCount = (s: string): i64 => {
  const groups = split(s, ",")
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]
    const ok = i === 0 ? g.length >= 1 && (groups.length === 1 || g.length <= 3) : g.length === 3
    if (!ok || !profileAllDigits(g)) {
      return -1
    }
  }
  const digits = groups.join("")
  if (digits.startsWith("0") || digits.length > 10) {
    return -1
  }
  let n: i64 = 0
  for (let i = 0; i < digits.length; i++) {
    n = n * 10 + toI64(digits.charCodeAt(i) - 48)
  }
  return n > PROFILE_ITERATE_MAX ? -1 : n
}

/** `s` split at its commas outside parentheses, each part trimmed. */
const profileIterateParts = (s: string): string[] => {
  const out: string[] = []
  let depth = 0
  let from = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i)
    if (ch === 0x28) {
      depth++
    } else if (ch === 0x29) {
      depth--
    } else if (ch === 0x2c && depth === 0) {
      out.push(profileTrim(s.substring(from, i)))
      from = i + 1
    }
  }
  out.push(profileTrim(s.substring(from, s.length)))
  return out
}

/** A tuple's elements: `(a, b)` is a and b; anything else is one element. */
const profileIterateTuple = (s: string): string[] => {
  if (s.startsWith("(") && s.endsWith(")")) {
    return profileIterateParts(s.substring(1, s.length - 1))
  }
  return [s]
}

/**
 * One element of an Iterate: paragraph's next tuple: a name, or a call on
 * names; null, refused, when it is neither.
 */
const profileIterateNext = (c: ProfileContext, loc: ProfileLoc, id: string, s: string): Expr | null => {
  if (charsIsIdent(s)) {
    return new Expr(ExprKind.Var, s)
  }
  const open = s.indexOf("(")
  if (open > 0 && s.endsWith(")") && charsIsIdent(s.substring(0, open))) {
    const e = new Expr(ExprKind.Call, s.substring(0, open))
    const inner = profileTrim(s.substring(open + 1, s.length - 1))
    const args: string[] = inner.length === 0 ? [] : profileIterateParts(inner)
    if (args.every((a: string): boolean => charsIsIdent(a))) {
      for (const a of args) {
        e.args.push(new Expr(ExprKind.Var, a))
      }
      return e
    }
  }
  profileRefuseLoc(c, loc, `${id}'s next "${s}" is neither a name nor a call on the names: ${PROFILE_ITERATE_FORM}`)
  return null
}

/** Whether `e` is `call` on `names`, in order. */
const profileIterateIsCall = (e: Expr, call: string, names: string[]): boolean =>
  e.name === call &&
  e.args.length === names.length &&
  e.args.every((a: Expr, i: i32): boolean => a.kind === ExprKind.Var && a.name === names[i])

/**
 * An Iterate: paragraph, `Iterate: <id> <count> times, [slow, ]<names> <-
 * <next>`, set on the vector it names. What the profile cannot see from the
 * paragraph alone (a repeated name, one that shadows a function, no call in
 * the next tuple) is the shape gate's.
 */
const profileReadIterate = (c: ProfileContext, p: XmlNode, rowIds: Set<string>, read: Map<string, Clause>): void => {
  const text = profileTrim(profileAfter(c, p, PROFILE_ITERATE))
  const words = split(text, " ")
  const id = words[0]
  const loc = profileLocOf(p)
  if (words.length < 2 || words[1] === "times,") {
    // Echo the author's own paragraph, with the count put where it goes.
    const rest = profileTrim(text.substring(id.length, text.length))
    const after = rest.length === 0 ? "times, (k, u) <- (f(k, u), k)" : rest
    profileRefuseLoc(
      c,
      loc,
      `${id}'s Iterate: paragraph gives no count before "times,": it reads "${PROFILE_ITERATE}${text}"; put the count there, like ${PROFILE_ITERATE}${id} 1,000 ${after}`,
    )
    return
  }
  if (words.length < 3 || words[2] !== "times,") {
    profileRefuseLoc(c, loc, `an Iterate: paragraph reads "<id> <count> times," first: ${PROFILE_ITERATE_FORM}`)
    return
  }
  const count = profileIterateCount(words[1])
  if (count < 0) {
    profileRefuseLoc(
      c,
      loc,
      `${id}'s count is a whole number from 1 to 1,000,000,000 in digits, grouped in threes by commas or not at all, not "${words[1]}": ${PROFILE_ITERATE_FORM}`,
    )
    return
  }
  const rest = profileTrim(text.substring(id.length + words[1].length + "times,".length + 2, text.length))
  let arrow = rest.indexOf("<-")
  let width = 2
  if (arrow < 0) {
    arrow = rest.indexOf("\u2190")
    width = "\u2190".length
  }
  if (arrow < 0) {
    profileRefuseLoc(
      c,
      loc,
      `${id}'s Iterate: paragraph has no "<-" between its names and its next: ${PROFILE_ITERATE_FORM}`,
    )
    return
  }
  let lhs = profileTrim(rest.substring(0, arrow))
  const rhs = profileTrim(rest.substring(arrow + width, rest.length))
  const it = new Iterate()
  it.count = count
  if (lhs.startsWith("slow,")) {
    it.slow = true
    lhs = profileTrim(lhs.substring("slow,".length, lhs.length))
    if (lhs.startsWith("slow,")) {
      profileRefuseLoc(c, loc, `${id}'s Iterate: paragraph says "slow," twice; once is enough: ${PROFILE_ITERATE_FORM}`)
      return
    }
  }
  // Only slow may stand between "times," and the names.
  const open = lhs.indexOf("(")
  const comma = lhs.indexOf(",")
  if (open < 0 && comma >= 0 && split(lhs, ",").every((n: string): boolean => charsIsIdent(profileTrim(n)))) {
    profileRefuseLoc(
      c,
      loc,
      `${id}'s names "${lhs}" are more than one, so they stand in parentheses, (${lhs}): ${PROFILE_ITERATE_FORM}`,
    )
    return
  }
  if (open === 0 && !lhs.endsWith(")")) {
    profileRefuseLoc(
      c,
      loc,
      `${id}'s Iterate: paragraph has "${lhs}" before "<-"; the names end at their ")", and "slow," stands before them: ${PROFILE_ITERATE_FORM}`,
    )
    return
  }
  const extra = open >= 0 ? lhs.substring(0, open) : comma >= 0 ? lhs.substring(0, comma + 1) : ""
  if (profileTrim(extra).length > 0) {
    profileRefuseLoc(
      c,
      loc,
      `${id}'s Iterate: paragraph has "${profileTrim(extra)}" after "times,", where only "slow," may stand: ${PROFILE_ITERATE_FORM}`,
    )
    return
  }
  it.names = profileIterateTuple(lhs)
  for (const n of it.names) {
    if (!charsIsIdent(n)) {
      profileRefuseLoc(c, loc, `${id}'s name "${n}" is not an identifier: ${PROFILE_ITERATE_FORM}`)
      return
    }
  }
  const nexts = profileIterateTuple(rhs)
  for (const s of nexts) {
    const e = profileIterateNext(c, loc, id, s)
    if (e === null) {
      return
    }
    it.next.push(e)
  }
  if (!rowIds.has(id)) {
    profileRefuseLoc(c, loc, `Iterate: names "${id}", which is no vector of the table: ${PROFILE_ITERATE_FORM}`)
    return
  }
  const v = read.get(id)
  if (v === undefined) {
    return
  }
  if (v.iterate !== null) {
    profileRefuseLoc(c, loc, `${id} is iterated already; a vector has at most one Iterate: paragraph`)
    return
  }
  const fn = profileFn(c, v.call)
  const arity = fn !== null ? fn.params.length : v.args.length
  if (it.names.length !== arity) {
    profileRefuseLoc(
      c,
      loc,
      `${id} names ${it.names.length}, but ${v.call} takes ${arity}; one name per parameter: ${PROFILE_ITERATE_FORM}`,
    )
    return
  }
  if (it.next.length !== arity) {
    profileRefuseLoc(
      c,
      loc,
      `${id}'s next has ${it.next.length}, but ${v.call} takes ${arity}; one per parameter: ${PROFILE_ITERATE_FORM}`,
    )
    return
  }
  for (const e of it.next) {
    if (e.kind === ExprKind.Var && !vocabHas(it.names, e.name)) {
      profileRefuseLoc(c, loc, `${id}'s next names "${e.name}", which is not one of its names: ${PROFILE_ITERATE_FORM}`)
      return
    }
    if (e.kind === ExprKind.Call && !profileIterateIsCall(e, v.call, it.names)) {
      profileRefuseLoc(
        c,
        loc,
        `${id}'s next calls ${e.name}(${e.args.map((a: Expr): string => a.name).join(", ")}); a call there is the row's ${v.call}(${it.names.join(", ")}): ${PROFILE_ITERATE_FORM}`,
      )
      return
    }
  }
  v.iterate = it
  c.iterateIds.push(id)
  c.iterateLocs.push(loc)
}

const profileCodeCell = (c: ProfileContext, td: XmlNode): string | null => {
  const tt = profileOnly(td)
  if (tt !== null && tt.name === "tt") {
    return profileRawText(tt)
  }
  profileRefuse(c, td, "cell must be a single code span")
  return null
}

/**
 * Refuses a code cell at column `col` of its text: at that column of the XML
 * when the cell's text is written there as is, on one line up to it, and at
 * the cell with no column otherwise.
 */
const profileRefuseInCell = (c: ProfileContext, td: XmlNode, message: string, col: i32): void => {
  const tt = profileOnly(td)
  const t: XmlNode | null = tt !== null ? tt.first : null
  const at = t !== null && t.next === null ? profileXmlCol(t, 0, split(t.text, "\n")[0], col) : 0
  if (t !== null && at > 0) {
    profileRefuseAt(c, profileLocOf(t), message, at)
  } else {
    profileRefuseAt(c, profileLocOf(td), message, 0)
  }
}

const profileReadRow = (c: ProfileContext, cells: XmlNode[], section: string, tr: XmlNode): Clause | null => {
  const width = profileVectorHeader().length
  if (cells.length !== width) {
    profileRefuse(c, tr, `a vector row has ${width} cells, not ${cells.length}`)
    return null
  }
  // Every cell is judged; the row is refused if any is.
  const before = c.refusals.length
  const idC = cells[0]
  const callC = cells[1]
  const expC = cells[2]
  const coversC = cells[3]
  const srcC = cells[4]
  const titleC = cells[5]
  const id = profileCellText(idC)
  profileCheckId(c, id, profileLocOf(idC))
  const title = xmlPlainText(c.doc.text, titleC)
  if (title.length === 0) {
    profileRefuse(c, titleC, `vector ${id} has no title`)
  } else {
    profileCheckText(c, profileLocOf(titleC), `vector ${id}'s title`, title)
  }
  const coversText = profileCellText(coversC)
  const covers: string[] =
    coversText.length > 0 ? split(coversText, ",").map((k: string): string => profileTrim(k)) : []
  profileCheckCovers(c, covers, profileLocOf(coversC))
  const callText = profileCodeCell(c, callC)
  const expText = profileCodeCell(c, expC)
  let call: RawCall | null = null
  if (callText !== null) {
    const pc = literalsParseCall(callText)
    if (pc.isErr()) {
      profileRefuseInCell(c, callC, `Call: ${pc.error.message}`, pc.error.col)
    } else {
      call = pc.value
    }
  }
  let expected: RawLiteral | null = null
  if (expText !== null) {
    const pe = literalsParse(expText)
    if (pe.isErr()) {
      profileRefuseInCell(c, expC, `Expected: ${pe.error.message}`, pe.error.col)
    } else {
      expected = pe.value
    }
  }
  let settled: SettledVector | null = null
  const pcall: RawCall | null = call
  const pexp: RawLiteral | null = expected
  if (pcall !== null) {
    const fn = profileFn(c, pcall.call)
    if (fn === null) {
      profileRefuse(c, callC, `"${pcall.call}" is not a function of the ts-interface block`)
    } else if (fn.module !== null) {
      profileRefuse(
        c,
        callC,
        `Call: ${pcall.call} is a reference function of ${fn.module ?? ""}; a vector tests ${c.module}, the module under test, so call one of its functions`,
      )
    } else if (pexp !== null) {
      const s = literalsSettleVector(fn, pcall.args, pexp)
      if (s.isErr()) {
        for (const e of s.error) {
          profileRefuse(c, e.cell === "Call" ? callC : expC, `${e.cell}: ${e.message}`)
        }
      } else {
        settled = s.value
      }
    }
  }
  const sv: SettledVector | null = settled
  const expect: Literal | null = sv !== null ? sv.expect : null
  const source = profileSourceCell(c, srcC, expect)
  if (c.refusals.length > before || source === null || pcall === null || sv === null) {
    return null
  }
  const v = new Clause(ClauseKind.Vector)
  v.id = id
  v.title = title
  v.covers = covers
  v.source = source
  // A cited vector's section is in its source; a vector whose result is
  // cited apart from its inputs is at the inputs' section, carried here.
  const inputs = source.cite
  if (source.kind === VectorSourceKind.Spec && inputs !== null) {
    v.section = inputs.section
    source.cite = null
  } else if (source.kind !== VectorSourceKind.Cite) {
    v.section = section
  }
  v.call = pcall.call
  v.args = sv.args
  v.expect = sv.expect
  return v
}

/** The accepted way to name one test case of a cited section, as refusals print it. */
const PROFILE_CASE_FORM: string = "{{Section N of RFCx}}, Test Vector #N (N from 1, with no leading zero)"

/**
 * A Source cell's leading element and the text after it, when the cell is
 * an element and then more: `{{Section N of RFCx}}, Test Vector #N` names
 * one test case of the section. Null when nothing but blanks surrounds a
 * lone element, or text comes before the first element.
 */
const profileSourceTail = (td: XmlNode): XmlNode | null => {
  let k = td.first
  while (k !== null && k.name.length === 0 && profileTrim(k.text).length === 0) {
    k = k.next
  }
  if (k === null || k.name.length === 0 || profileOnly(td) !== null) {
    return null
  }
  return k
}

/** The accepted way to cite a vector's result apart from its inputs, as refusals print it. */
const PROFILE_RESULT_FORM: string =
  "{{Section N of RFCx}}; result {{Section M of RFCx}}, two sections of the main RFC, for an Expected of null, true or false"

/** Refuses a Source cell that misses the result form, saying why; always null. */
const profileResultRefuse = (c: ProfileContext, td: XmlNode, why: string): VectorSource | null => {
  profileRefuse(c, td, `Source: ${why}; write ${PROFILE_RESULT_FORM}`)
  return null
}

/**
 * A Source cell that cites a vector's inputs to one section of the main RFC
 * and its null, true or false result to another, `{{Section A of RFCx}};
 * result {{Section B of RFCx}}`: a Spec source of B, whose `cite` carries A
 * for the row to take as its section. Null, refused, for anything else.
 */
const profileResultCite = (
  c: ProfileContext,
  td: XmlNode,
  lead: XmlNode,
  expect: Literal | null,
): VectorSource | null => {
  const sep = lead.next
  const res: XmlNode | null = sep === null ? null : sep.next
  if (sep === null || sep.name.length > 0 || profileTrim(profileRawText(sep)) !== "; result" || res === null) {
    return profileResultRefuse(c, td, "a result's section follows the inputs' after \"; result \"")
  }
  let after = res.next
  while (after !== null && after.name.length === 0 && profileTrim(after.text).length === 0) {
    after = after.next
  }
  const leadSection: string | null = lead.name === "xref" ? xmlAttr(lead, "section") : null
  const resSection: string | null = res.name === "xref" ? xmlAttr(res, "section") : null
  if (leadSection === null || resSection === null) {
    return profileResultRefuse(
      c,
      td,
      "both the inputs and the result are cited to a section of the RFC, not an anchor or a code span",
    )
  }
  if (after !== null) {
    return profileResultRefuse(
      c,
      td,
      `nothing may follow the result's section, not "${profileTrim(profileRawText(after))}"`,
    )
  }
  const a = profileCitedRfc(c, lead)
  const b = profileCitedRfc(c, res)
  if (a < 0 || b < 0) {
    return null
  }
  if (c.mainRfc < 0 || a !== c.mainRfc || b !== c.mainRfc) {
    return profileResultRefuse(
      c,
      td,
      c.mainRfc < 0
        ? "a result is cited apart from its inputs only in a spec whose main source is an RFC"
        : `both sections are of the main source, RFC${c.mainRfc}`,
    )
  }
  if (leadSection === resSection) {
    return profileResultRefuse(c, td, `the result's section is another than the inputs', not ${leadSection} again`)
  }
  if (expect === null) {
    return null
  }
  if (expect.kind !== LitKind.Null && expect.kind !== LitKind.Bool) {
    return profileResultRefuse(
      c,
      td,
      `a section states a null, true or false result, so the Expected is one, not ${literalsKindOf(expect)}`,
    )
  }
  c.cited.add(a)
  const inputs = new Citation()
  inputs.section = leadSection
  const out = new VectorSource(VectorSourceKind.Spec)
  out.text = resSection
  out.cite = inputs
  return out
}

/** What a Source cell's leading element is, as a refusal names it. */
const profileSourceLead = (lead: XmlNode, cited: boolean): string => {
  if (cited) {
    return "section"
  }
  if (lead.name === "tt") {
    return "code span"
  }
  return lead.name === "xref" ? "anchor" : `<${lead.name}> element`
}

/** The Source cell, judged against the settled Expected when there is one. */
const profileSourceCell = (c: ProfileContext, td: XmlNode, expect: Literal | null): VectorSource | null => {
  let el = profileOnly(td)
  let testCase: string | null = null
  const lead = profileSourceTail(td)
  if (lead !== null) {
    // Only text may follow, and only the one form that names a test case.
    let rest = ""
    let textOnly = true
    let k = lead.next
    while (k !== null) {
      if (k.name.length > 0) {
        textOnly = false
      }
      rest = rest + profileRawText(k)
      k = k.next
    }
    const tail = profileTrim(rest)
    if (tail.startsWith(";")) {
      return profileResultCite(c, td, lead, expect)
    }
    const name = tail.startsWith(",") ? profileTrim(tail.substring(1)) : ""
    const cited = lead.name === "xref" && xmlAttr(lead, "section") !== null
    if (!cited || !textOnly || charsTestVector(name) === 0 || tail !== `, ${name}`) {
      profileRefuse(
        c,
        td,
        `Source: only one test case may follow a section, written ${PROFILE_CASE_FORM}; "${tail}" after the ${profileSourceLead(lead, cited)} is not one`,
      )
      return null
    }
    el = lead
    testCase = name
  }
  if (el !== null && el.name === "tt") {
    const command = profileRawText(el)
    if (profileTrim(command).length === 0) {
      profileRefuse(c, td, "Source: a command is a shell command, not blank")
      return null
    }
    // What a command prints is compared as bytes (hex) or a string.
    if (expect !== null) {
      const k = expect.kind
      if (k !== LitKind.Hex && k !== LitKind.Ascii && k !== LitKind.Concat && k !== LitKind.Str) {
        profileRefuse(
          c,
          td,
          `Source: a command prints bytes or a string, so its Expected is one, not ${literalsKindOf(expect)}`,
        )
        return null
      }
    }
    const out = new VectorSource(VectorSourceKind.Command)
    out.text = command
    return out
  }
  if (el !== null && el.name === "xref") {
    const target = xmlAttr(el, "target") ?? ""
    const section = xmlAttr(el, "section")
    if (section !== null) {
      const n = profileCitedRfc(c, el)
      if (n < 0) {
        return null
      }
      c.cited.add(n)
      const cite = new Citation()
      cite.section = section
      cite.testCase = testCase
      if (n !== c.mainRfc) {
        cite.source = `rfc${n}`
      }
      const out = new VectorSource(VectorSourceKind.Cite)
      out.cite = cite
      return out
    }
    const num = c.doc.sectionByAnchor.get(target)
    if (num === undefined) {
      profileRefuse(c, el, `Source names "${target}", which is no numbered section`)
      return null
    }
    if (c.mainRfc >= 0) {
      profileRefuse(c, el, profileOwnText(c, `Source ${target}, a section of the spec,`))
      return null
    }
    if (expect !== null && (expect.kind === LitKind.Null || expect.kind === LitKind.Bool)) {
      const out = new VectorSource(VectorSourceKind.Spec)
      out.text = num
      return out
    }
    const cite = new Citation()
    cite.section = num
    const out = new VectorSource(VectorSourceKind.Cite)
    out.cite = cite
    return out
  }
  profileRefuse(c, td, "Source must be {{Section N of RFCx}}, a section anchor, or a single code span")
  return null
}

// ── Properties ─────────────────────────────────────────────────────────────

const profileReadProperties = (c: ProfileContext, code: XmlNode[]): void => {
  for (const node of code) {
    if (!profileFronted(c, node, "property")) {
      continue
    }
    const block = xmlCodeOf(node)
    const r = frontParseProperty(block.text, c.functions)
    if (r.isErr()) {
      profileFrontRefuse(c, node, r.error)
      continue
    }
    const p = r.value
    const at = new ProfileLoc(block.line, block.mdLine, block.markLine, profileCollapse(split(block.text, "\n")[0]))
    const title = p.title ?? ""
    profileCheckId(c, p.id, at)
    profileCheckCovers(c, p.covers, at)
    profileCheckText(c, at, `property ${p.id}'s title`, title)
    const k = p.clause
    k.id = p.id
    k.title = title
    k.covers = p.covers
    c.properties.push(k)
    c.propertyLocs.push(at)
  }
}

/** Every section cited in an RFC used as a source exists. */
const profileCheckSections = (c: ProfileContext, xrefs: XmlNode[]): void => {
  for (const x of xrefs) {
    const n = c.referenced.get(xmlAttr(x, "target") ?? "")
    const section = xmlAttr(x, "section")
    if (n === undefined || n < 0 || section === null || !c.cited.has(n)) {
      continue
    }
    if (rfcSection(profileRfc(c, n), section) === null) {
      profileRefuse(c, x, `Section ${section} of RFC${n} does not exist`)
    }
  }
}

/** The coverage gate's two checks, refused at a line. */
const profileCheckCoverage = (c: ProfileContext): void => {
  const covered = new Set<string>()
  for (const k of c.vectors) {
    for (const id of k.covers) {
      covered.add(id)
    }
  }
  for (const k of c.properties) {
    for (const id of k.covers) {
      covered.add(id)
    }
  }
  for (const q of c.requirements) {
    if (vocabIsBinding(q.level) && !covered.has(q.id)) {
      profileRefuseAt(
        c,
        q.loc,
        `${q.id} is ${q.level}, but no clause covers it; cover it with a vector or a property, or follow it with an Untested: paragraph`,
        0,
      )
    }
  }
  const targets: string[] = []
  for (const f of c.functions) {
    if (f.module === null) {
      targets.push(f.name)
    }
  }
  for (let i = 0; i < c.properties.length; i++) {
    const k = c.properties[i]
    const a = k.assert
    const calls: string[] = []
    if (a !== null) {
      for (const f of typeCallsIn(a)) {
        if (!vocabHas(calls, f)) {
          calls.push(f)
        }
      }
    }
    if (calls.length === 0) {
      profileRefuseAt(
        c,
        c.propertyLocs[i],
        `property ${k.id}'s assertion calls none of the functions under test, so it checks nothing`,
        0,
      )
    } else if (!calls.some((f: string): boolean => vocabHas(targets, f))) {
      const sorted = calls.sort((x: string, y: string): i32 => profileCompare(x, y))
      profileRefuseAt(
        c,
        c.propertyLocs[i],
        `property ${k.id}'s assertion calls only reference functions (${sorted.join(", ")}); call a function of ${c.module}, the module under test`,
        0,
      )
    }
  }
}

// ── The contract ───────────────────────────────────────────────────────────

const profileSourceOf = (c: ProfileContext, q: ProfileQuoted): string | null =>
  q.citeRfc >= 0 && q.citeRfc !== c.mainRfc ? `rfc${q.citeRfc}` : null

const profileBuild = (c: ProfileContext, name: string): Contract => {
  const out = new Contract()
  out.contract = name
  const source = new ContractSource()
  source.title = c.doc.title
  if (c.mainRfc < 0) {
    source.main = name
  } else {
    source.rfc = c.mainRfc
  }
  out.source = source
  const sources: SourceDecl[] = []
  if (c.mainRfc < 0) {
    const own = new SourceDecl()
    own.id = name
    own.path = `../specs/${name}.xml`
    sources.push(own)
  }
  const cited: i32[] = []
  for (const n of c.cited) {
    cited.push(n)
  }
  for (const n of cited.sort((a: i32, b: i32): i32 => (a < b ? -1 : a > b ? 1 : 0))) {
    const d = new SourceDecl()
    d.id = `rfc${n}`
    d.rfc = n
    sources.push(d)
  }
  out.sources = sources
  const target = new Target()
  target.module = c.module
  out.target = target
  for (const q of c.requirements) {
    const r = new Requirement()
    r.id = q.id
    r.source = profileSourceOf(c, q)
    r.section = q.section
    r.level = q.level
    r.quote = q.quote
    r.note = q.note
    out.requirements.push(r)
  }
  if (c.mainRfc < 0 || c.exclusions.length > 0) {
    const ex: Exclusion[] = []
    for (const q of c.exclusions) {
      const e = new Exclusion()
      e.source = profileSourceOf(c, q)
      e.section = q.section
      e.quote = q.quote
      e.reason = q.reason
      ex.push(e)
    }
    out.exclusions = ex
  }
  out.functions = c.functions
  for (const k of c.vectors) {
    out.clauses.push(k)
  }
  for (const k of c.properties) {
    out.clauses.push(k)
  }
  if (c.outOfScope.length > 0) {
    out.outOfScope = c.outOfScope
  }
  return out
}

/** The index a shape issue names after `name[`, or -1. */
const profileIssueIndex = (issue: string, name: string): i32 => {
  const head = `${name}[`
  if (!issue.startsWith(head)) {
    return -1
  }
  const close = issue.indexOf("]")
  if (close <= head.length) {
    return -1
  }
  const digits = issue.substring(head.length, close)
  if (!profileAllDigits(digits) || digits.length > 9) {
    return -1
  }
  return parseInt(digits)
}

/** The shape backstop: each issue refused at the line of the part it names. */
const profileShapeRefusals = (c: ProfileContext, out: Contract, clauseLocs: ProfileLoc[]): ProfileRefusal[] => {
  const shape: ProfileRefusal[] = []
  const reqLocs = c.requirements.map((q: ProfileQuoted): ProfileLoc => q.loc)
  const exLocs = c.exclusions.map((q: ProfileQuoted): ProfileLoc => q.loc)
  for (const issue of contractShapeErrors(out)) {
    let loc = profileLocOf(c.doc.root)
    const r = profileIssueIndex(issue, "requirements")
    const e = profileIssueIndex(issue, "exclusions")
    const k = profileIssueIndex(issue, "clauses")
    const f = profileIssueIndex(issue, "functions")
    const o = profileIssueIndex(issue, "outOfScope")
    if (r >= 0 && r < reqLocs.length) {
      loc = reqLocs[r]
    } else if (e >= 0 && e < exLocs.length) {
      loc = exLocs[e]
    } else if (k >= 0 && k < clauseLocs.length) {
      // An iterate's or a truncate's issue is its paragraph's, not the row's.
      const at = c.iterateIds.indexOf(out.clauses[k].id)
      const tr = c.truncateIds.indexOf(out.clauses[k].id)
      if (at >= 0 && issue.startsWith(`clauses[${k}].iterate`)) {
        loc = c.iterateLocs[at]
      } else if (tr >= 0 && issue.startsWith(`clauses[${k}].truncate`)) {
        loc = c.truncateLocs[tr]
      } else {
        loc = clauseLocs[k]
      }
    } else if (f >= 0 && f < c.fnLocs.length) {
      loc = c.fnLocs[f]
    } else if (o >= 0 && o < c.outOfScopeLocs.length) {
      loc = c.outOfScopeLocs[o]
    }
    shape.push(profileRefusalAt(profileWhereOf(c, loc), 0, `the contract read here is not valid: ${issue}`))
  }
  return profileSortRefusals(shape)
}

const profilePut = (c: ProfileContext, l: ProfileLocator, key: string, loc: ProfileLoc): void => {
  if (l.at.has(key)) {
    return
  }
  l.at.set(key, profileWhereOf(c, loc))
}

const profileSorted = (c: ProfileContext): Result<ProfileRead, ProfileRefusal[]> => Err(profileSortRefusals(c.refusals))

/**
 * Reads a contract from a spec under the vector profile.
 *
 * @param doc the spec, parsed
 * @param xmlPath the spec's path, whose basename names the contract
 * @param md the markdown it was built from, for refusals at its lines; null when unknown
 * @param rfcs the RFCs it may cite; one asked for and absent is recorded in `rfcs.missing`
 * @returns the contract and where each part was read, or every refusal, in XML document order
 */
export const profileRead = (
  doc: XmlDocument,
  xmlPath: string,
  md: ProfileMd | null,
  rfcs: ProfileRfcs,
): Result<ProfileRead, ProfileRefusal[]> => {
  const c = new ProfileContext(doc, xmlPath, md, rfcs)
  for (const r of doc.references) {
    c.referenced.set(r.anchor, r.rfc)
  }
  for (const e of doc.normative) {
    const at = c.byNode.get(e.node)
    if (at !== undefined) {
      at.push(e)
    } else {
      c.byNode.set(e.node, [e])
    }
  }
  profileReadMain(c)
  const name = profileContractName(c)
  profileCheckText(c, profileLocOf(doc.root), "the title", doc.title)
  const sections = profileSections(doc.root)

  // v2 tables: the pipeline runs `xml2rfc --v2v3`, so none is left to read.
  for (const t of profileNamed(doc.root, "texttable")) {
    profileRefuse(c, t, "a <texttable> is v2 XML; write a v3 <table> (xml2rfc --v2v3 converts one)")
  }
  // Every RFC xref has a reference; the sections cited are checked once the
  // RFCs used as sources are known.
  const xrefs = profileNamed(doc.root, "xref")
  for (const x of xrefs) {
    const target = xmlAttr(x, "target") ?? ""
    if (!c.referenced.has(target) && profileIsRfcTarget(target)) {
      profileRefuse(c, x, `xref to ${target} has no <reference> for it`)
    }
  }

  const code: XmlNode[] = []
  for (const s of sections) {
    for (const n of profileOwnCode(s.node)) {
      code.push(n)
    }
  }
  profileReadInterface(c, code)
  for (const s of sections) {
    profileBlocks(c, s.node, s.id)
  }
  profileUnhandled(c)
  profileCheckQuotes(c)
  for (const q of c.requirements) {
    c.ids.add(q.id)
  }
  for (const t of c.tables) {
    profileReadTable(c, t)
  }
  profileReadProperties(c, code)
  profileCheckOutOfScope(c)
  profileCheckSections(c, xrefs)

  if (c.refusals.length > 0) {
    return profileSorted(c)
  }
  // Only now: when something was refused, an empty list is its consequence.
  if (c.requirements.length === 0) {
    profileRefuse(c, doc.root, "a spec needs at least one requirement")
  }
  if (c.vectors.length + c.properties.length === 0) {
    profileRefuse(c, doc.root, "a spec needs at least one clause: a vector table row or a ts-property block")
  }
  if (c.refusals.length > 0) {
    return profileSorted(c)
  }
  profileCheckCoverage(c)
  if (c.refusals.length > 0) {
    return profileSorted(c)
  }
  const key = c.mainKey
  if (c.mainRfc >= 0 && !c.cited.has(c.mainRfc) && key !== null) {
    profileRefuse(c, key, `RFC${c.mainRfc} is the main source, but nothing cites it; quote it in a requirement`)
  }
  if (c.refusals.length > 0) {
    return profileSorted(c)
  }

  const out = profileBuild(c, name)
  const clauseLocs: ProfileLoc[] = []
  for (const l of c.vectorLocs) {
    clauseLocs.push(l)
  }
  for (const l of c.propertyLocs) {
    clauseLocs.push(l)
  }
  // The backstop: each value was checked where it was read, so this finds
  // nothing; if it ever does, the issue is refused at a line all the same.
  const shape = profileShapeRefusals(c, out, clauseLocs)
  if (shape.length > 0) {
    return Err(shape)
  }
  const l = new ProfileLocator(profileWhereOf(c, profileLocOf(doc.root)))
  if (key !== null) {
    profilePut(c, l, "source.main", profileLocOf(key))
  }
  for (const q of c.requirements) {
    profilePut(c, l, q.id, q.loc)
  }
  for (const q of c.exclusions) {
    profilePut(c, l, `exclusion §${q.section}`, q.loc)
  }
  for (let i = 0; i < out.clauses.length; i++) {
    profilePut(c, l, out.clauses[i].id, clauseLocs[i])
  }
  for (let i = 0; i < c.toleranceIds.length; i++) {
    profilePut(c, l, `${c.toleranceIds[i]}.tolerance`, c.toleranceLocs[i])
  }
  for (let i = 0; i < c.iterateIds.length; i++) {
    profilePut(c, l, `${c.iterateIds[i]}.iterate`, c.iterateLocs[i])
  }
  for (let i = 0; i < c.truncateIds.length; i++) {
    profilePut(c, l, `${c.truncateIds[i]}.truncate`, c.truncateLocs[i])
  }
  for (let i = 0; i < c.functions.length; i++) {
    profilePut(c, l, c.functions[i].name, c.fnLocs[i])
  }
  for (let i = 0; i < c.outOfScope.length; i++) {
    profilePut(c, l, `outOfScope[${i}]`, c.outOfScopeLocs[i])
  }
  return Ok(new ProfileRead(out, l))
}

/**
 * The file and line a gate finding's `at` names: the longest key that is
 * `at` or a prefix of it ending before a `.` (`V1.expect` is V1's line, and
 * an id may hold a dot), else the root.
 *
 * @param l the locator
 * @param at the path a finding names, like `V1.expect`
 * @returns the file and line
 */
export const profileLocate = (l: ProfileLocator, at: string): ProfileWhere => {
  let k = at
  while (true) {
    const w = l.at.get(k)
    if (w !== undefined) {
      return w
    }
    const dot = profileLastDot(k)
    if (dot < 0) {
      return l.root
    }
    k = k.substring(0, dot)
  }
}

const profileLastDot = (s: string): i32 => {
  let i = s.length - 1
  while (i >= 0) {
    if (s.charCodeAt(i) === 0x2e) {
      return i
    }
    i = i - 1
  }
  return -1
}

const profileLastSlash = (s: string): i32 => {
  let i = s.length - 1
  while (i >= 0) {
    if (s.charCodeAt(i) === 0x2f) {
      return i
    }
    i = i - 1
  }
  return -1
}
