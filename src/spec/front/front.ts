/**
 * `spec/front/front` — the TypeScript front end. A spec carries its interface
 * and its properties in sourcecode blocks whose type names a language
 * (`ts-interface`, `ts-property`); this module reads the small subset of
 * TypeScript those blocks are written in and maps it onto the contract's
 * functions and property clauses. It is hand-written on purpose: the subset is
 * tiny, every construct outside it is refused with a line and column the
 * author can act on, and vector depends on no compiler.
 *
 * Expressions are typed as they are parsed, by the contract's own `typeOf`,
 * so a block that parses is a clause the gates will type the same way.
 */

import { JSON_VALUE_STRING } from "nish/json-value"
import { replaceAll, split, splitWhitespace, trim } from "nish/text"
import { newJsonDocument, parseJson } from "../../core/json"
import { textAsciiLower } from "../../core/text"
import { capacityNames, capacityParse, capacityShow } from "../contract/capacity"
import { charsIsId, charsIsModule, charsIsStringText, charsSequenceLength } from "../contract/chars"
import { SHAPE_MAX_LEN, shapeAlphabetClasses } from "../contract/shape"
import {
  Clause,
  ClauseKind,
  Expr,
  ExprKind,
  FnSig,
  ForallVar,
  LetBinding,
  LitKind,
  Literal,
  OutBuffer,
  Param,
} from "../contract/types"
import { TypeEnv, typeAssignable, typeEnvBind, typeOf, typeOfLiteral } from "../contract/typing"
import {
  VOCAB_SECRET_FORM,
  vocabCompareDecimal,
  vocabHas,
  vocabIntMax,
  vocabIntMin,
  vocabIntTypes,
  vocabIsIntType,
  vocabIsJsonSafe,
  vocabIsSecretOp,
  vocabReadOps,
  vocabValueType,
  vocabWriteOps,
} from "../contract/vocab"

// ── Refusals ───────────────────────────────────────────────────────────────

/** Why a block was refused; line and column (1-based) count from the block's first line. */
export class FrontRefusal {
  /** What is wrong. */
  message: string
  /** The 1-based line, counted from the block's first line. */
  line: i32
  /** The 1-based column, in UTF-16 units. */
  col: i32
  /**
   * Makes a refusal.
   *
   * @param message what is wrong, and how to fix it
   * @param line the line, 1-based from the block's first line
   * @param col the column in UTF-16 units, 1-based
   */
  constructor(message: string, line: i32, col: i32) {
    this.message = message
    this.line = line
    this.col = col
  }
}

/** A position in a block. */
class FrontPos {
  line: i32
  col: i32
  constructor(line: i32, col: i32) {
    this.line = line
    this.col = col
  }
}

const frontRefuse = (message: string, pos: FrontPos): FrontRefusal => new FrontRefusal(message, pos.line, pos.col)

// ── Lexer ──────────────────────────────────────────────────────────────────

enum FrontKind {
  Ident = 0,
  Num = 1,
  Str = 2,
  Bytes = 3,
  Punct = 4,
  Comment = 5,
  Eof = 6,
}

/** A token: its kind, its source text, its value and where it starts. */
class FrontTok {
  kind: FrontKind
  /** The source text of the token. */
  text: string
  /** str: the decoded string; bytes: the hex digits; comment: the text inside. */
  value: string
  line: i32
  col: i32
  /** Whether the comment was a `//` line comment. */
  lineComment: boolean
  constructor(kind: FrontKind, text: string, value: string, line: i32, col: i32) {
    this.kind = kind
    this.text = text
    this.value = value
    this.line = line
    this.col = col
    this.lineComment = false
  }
}

const frontAt = (t: FrontTok): FrontPos => new FrontPos(t.line, t.col)

const frontShown = (t: FrontTok): string => (t.kind === FrontKind.Eof ? "end of block" : `\`${t.text}\``)

/** Punctuators, longest first, so `===` is not read as `==` then `=`. */
const frontPuncts = (): string[] => [
  ">>>",
  "===",
  "!==",
  "==>",
  "...",
  "=>",
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "??",
  "?.",
  "**",
  "<<",
  ">>",
  "++",
  "--",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  ",",
  ";",
  ":",
  ".",
  "<",
  ">",
  "=",
  "+",
  "-",
  "*",
  "/",
  "%",
  "!",
  "&",
  "|",
  "^",
  "~",
  "?",
]

const FRONT_BYTES_MESSAGE: string = "a bytes literal is lowercase hex pairs separated by single spaces, like [00 0f]"

/** The lexer's state: the text, where it is, and the tokens so far. */
class FrontLexer {
  text: string
  subset: string
  i: i32
  /** u32: it counts the line breaks of the text, so it cannot pass the text's length. */
  line: u32
  lineStart: i32
  toks: FrontTok[]
  /** The byte frontCol last counted to, so the next count resumes there: columns cost linear time per line. */
  colAt: i32
  /** The column at colAt. */
  colOf: i32
  constructor(text: string, subset: string) {
    this.text = text
    this.subset = subset
    this.i = 0
    this.line = 1
    this.lineStart = 0
    this.toks = []
    this.colAt = 0
    this.colOf = 1
  }
}

/** The column of byte `at` on the current line, in UTF-16 units. */
const frontCol = (lx: FrontLexer, at: i32): i32 => {
  // u32: a column cannot pass the text's length, so it cannot overflow.
  let col: u32 = 1
  let from = lx.lineStart
  if (lx.colAt >= lx.lineStart && lx.colAt <= at) {
    col = toU32(lx.colOf)
    from = lx.colAt
  }
  for (let k = from; k < at; k++) {
    // from and at are byte indexes of the text, so the byte is always there.
    const b = frontByte(lx.text, k)
    if ((b & 0xc0) !== 0x80) {
      col++
      if (b >= 0xf0) {
        col++
      }
    }
  }
  lx.colAt = at
  lx.colOf = toI32(col)
  return toI32(col)
}

const frontLexPos = (lx: FrontLexer, at: i32): FrontPos => new FrontPos(toI32(lx.line), frontCol(lx, at))

const frontPush = (lx: FrontLexer, kind: FrontKind, start: i32, end: i32, value: string): FrontTok => {
  const t = new FrontTok(kind, lx.text.substring(start, end), value, toI32(lx.line), frontCol(lx, start))
  lx.toks.push(t)
  return t
}

/**
 * The byte at `i`, or -1 outside `s`: no byte class below holds -1. Every
 * caller checks `i < s.length` first, so the -1 is never read; the check only
 * tells the prover so.
 */
const frontByte = (s: string, i: i32): i32 => (i >= 0 && i < s.length ? s.charCodeAt(i) : -1)

/** `at + n`, an offset into a text plus a length: in u32, where it cannot wrap, as texts stay under 2^31 bytes. */
const frontSum = (at: i32, n: i32): i32 => toI32(toU32(at) + toU32(n))

const frontIsDigit = (c: i32): boolean => c >= 0x30 && c <= 0x39
const frontIsAlpha = (c: i32): boolean => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)
const frontIsWord = (c: i32): boolean => frontIsAlpha(c) || frontIsDigit(c) || c === 0x5f
const frontIsLowerHex = (c: i32): boolean => frontIsDigit(c) || (c >= 0x61 && c <= 0x66)
const frontIsHex = (c: i32): boolean => frontIsLowerHex(c) || (c >= 0x41 && c <= 0x46)
/** `\s`, over ASCII: space, tab, LF, VT, FF, CR. */
const frontIsSpace = (c: i32): boolean => c === 0x20 || (c >= 0x09 && c <= 0x0d)

/** Whether `s` holds `p` at byte `i`. */
const frontHas = (s: string, i: i32, p: string): boolean => s.substring(i, frontSum(i, p.length)) === p

/** The end of a `"…"` literal starting at `i` (`"(?:[^"\\\n]|\\.)*"`), or -1. */
const frontStringEnd = (s: string, i: i32): i32 => {
  let j = frontSum(i, 1)
  while (j < s.length) {
    const c = frontByte(s, j)
    if (c === 0x22) {
      return j + 1
    }
    if (c === 0x0a) {
      return -1
    }
    if (c === 0x5c) {
      const k = j + 1
      if (k >= s.length || frontByte(s, k) === 0x0a) {
        return -1
      }
      j = frontSum(k, charsSequenceLength(s, k))
      continue
    }
    j++
  }
  return -1
}

/** The end of a bytes literal at `i` (`[00 0f]`, `[]`), or -1. */
const frontBytesEnd = (s: string, i: i32): i32 => {
  let j = frontSum(i, 1)
  if (j < s.length && frontByte(s, j) === 0x5d) {
    return j + 1
  }
  while (true) {
    if (j >= s.length - 1 || !frontIsLowerHex(frontByte(s, j)) || !frontIsLowerHex(frontByte(s, j + 1))) {
      return -1
    }
    j = j + 2
    if (j >= s.length) {
      return -1
    }
    const c = frontByte(s, j)
    if (c === 0x5d) {
      return j + 1
    }
    if (c !== 0x20) {
      return -1
    }
    j++
  }
}

/** Whether `[0-9A-Fa-f ]+]` starts at `i`, the `[`. */
const frontLooseBytes = (s: string, i: i32): boolean => {
  let j = frontSum(i, 1)
  while (j < s.length && (frontIsHex(frontByte(s, j)) || frontByte(s, j) === 0x20)) {
    j++
  }
  return j > frontSum(i, 1) && j < s.length && frontByte(s, j) === 0x5d
}

/** A JSON string's value, or null when `text` is not one JSON string. */
const frontJsonString = (text: string): string | null => {
  const doc = newJsonDocument()
  const v = parseJson(doc, text, "literal")
  if (v.isErr() || doc.kind(v.value) !== JSON_VALUE_STRING) {
    return null
  }
  return doc.string(v.value)
}

/** Whether a token is an operand's place: not after a name, `)` or `]`. */
const frontOperandPlace = (lx: FrontLexer): boolean => {
  for (let k = lx.toks.length - 1; k >= 0; k--) {
    const p = lx.toks[k]
    if (p.kind !== FrontKind.Comment) {
      return !(p.kind === FrontKind.Ident || (p.kind === FrontKind.Punct && (p.text === ")" || p.text === "]")))
    }
  }
  return true
}

/** The tokens of a block, and the end-of-block token that closes them. */
class FrontLexed {
  toks: FrontTok[]
  eof: FrontTok
  constructor(toks: FrontTok[], eof: FrontTok) {
    this.toks = toks
    this.eof = eof
  }
}

function frontLex(source: string, subset: string): Result<FrontLexed, FrontRefusal> {
  const lx = new FrontLexer(replaceAll(replaceAll(source, "\r\n", "\n"), "\r", "\n"), subset)
  const text = lx.text
  const puncts = frontPuncts()
  while (true) {
    const i = lx.i
    if (i >= text.length) {
      break
    }
    const c = frontByte(text, i)
    if (c === 0x0a) {
      lx.i = i + 1
      lx.line = lx.line + 1
      lx.lineStart = lx.i
      continue
    }
    if (c === 0x20 || c === 0x09) {
      lx.i = i + 1
      continue
    }
    if (frontHas(text, i, "//")) {
      const end = text.indexOf("\n", i)
      const stop = end < 0 ? text.length : end
      const t = frontPush(lx, FrontKind.Comment, i, stop, text.substring(frontSum(i, 2), stop))
      t.lineComment = true
      lx.i = stop
      continue
    }
    if (frontHas(text, i, "/*")) {
      const end = text.indexOf("*/", frontSum(i, 2))
      if (end < 0) {
        return Err(frontRefuse("unterminated `/*` comment", frontLexPos(lx, i)))
      }
      frontPush(lx, FrontKind.Comment, i, frontSum(end, 2), text.substring(frontSum(i, 2), end))
      for (let k = i; k < end; k++) {
        if (frontByte(text, k) === 0x0a) {
          lx.line = lx.line + 1
          lx.lineStart = k + 1
        }
      }
      lx.i = frontSum(end, 2)
      continue
    }
    if (frontIsAlpha(c) || c === 0x5f) {
      let j = i + 1
      while (j < text.length && frontIsWord(frontByte(text, j))) {
        j++
      }
      frontPush(lx, FrontKind.Ident, i, j, "")
      lx.i = j
      continue
    }
    if (frontIsDigit(c)) {
      let j = i + 1
      while (j < text.length && (frontIsWord(frontByte(text, j)) || frontByte(text, j) === 0x2e)) {
        j++
      }
      const num = text.substring(i, j)
      let decimal = num === "0" || frontByte(num, 0) !== 0x30
      for (let k = 0; k < num.length; k++) {
        if (!frontIsDigit(frontByte(num, k))) {
          decimal = false
        }
      }
      if (!decimal) {
        return Err(
          frontRefuse(`\`${num}\` is not in the ${subset} subset; write integers in decimal`, frontLexPos(lx, i)),
        )
      }
      frontPush(lx, FrontKind.Num, i, j, "")
      lx.i = j
      continue
    }
    if (c === 0x22) {
      const end = frontStringEnd(text, i)
      const value: string | null = end < 0 ? null : frontJsonString(text.substring(i, end))
      if (value === null) {
        return Err(frontRefuse("malformed string literal", frontLexPos(lx, i)))
      }
      frontPush(lx, FrontKind.Str, i, end, value)
      lx.i = end
      continue
    }
    if (c === 0x27 || c === 0x60) {
      return Err(
        frontRefuse(
          `\`${text.substring(i, i + 1)}\` strings are not in the ${subset} subset; use double quotes`,
          frontLexPos(lx, i),
        ),
      )
    }
    if (c === 0x5b) {
      const end = frontBytesEnd(text, i)
      if (end < 0 && frontOperandPlace(lx) && frontLooseBytes(text, i)) {
        return Err(frontRefuse(FRONT_BYTES_MESSAGE, frontLexPos(lx, i)))
      }
      if (end >= 0) {
        frontPush(lx, FrontKind.Bytes, i, end, replaceAll(text.substring(i + 1, end - 1), " ", ""))
        lx.i = end
        continue
      }
    }
    let matched = ""
    for (const p of puncts) {
      if (matched.length === 0 && frontHas(text, i, p)) {
        matched = p
      }
    }
    if (matched.length !== 0) {
      frontPush(lx, FrontKind.Punct, i, frontSum(i, matched.length), "")
      lx.i = frontSum(i, matched.length)
      continue
    }
    const ch = text.substring(i, frontSum(i, charsSequenceLength(text, i)))
    return Err(frontRefuse(`\`${ch}\` is not in the ${subset} subset`, frontLexPos(lx, i)))
  }
  const eof = frontPush(lx, FrontKind.Eof, lx.i, lx.i, "")
  return Ok(new FrontLexed(lx.toks, eof))
}

// ── Cursor ─────────────────────────────────────────────────────────────────

/**
 * Where a parse is in the tokens. `iface`: the tokens are a ts-interface,
 * where a module line skipped inside a signature would leave the functions
 * after it in the module before it, so it is refused; the refusal is kept in
 * `err`, and every read after it sees the end of the block.
 */
class FrontCursor {
  toks: FrontTok[]
  /** The last token, the end of the block: every read past it sees it again. */
  eof: FrontTok
  i: i32
  iface: boolean
  err: FrontRefusal | null
  constructor(lexed: FrontLexed, iface: boolean) {
    this.toks = lexed.toks
    this.eof = lexed.eof
    this.i = 0
    this.iface = iface
    this.err = null
  }
}

/** Token `j`, or the end of the block past it. */
const frontTokAt = (c: FrontCursor, j: i32): FrontTok => (j >= 0 && j < c.toks.length ? c.toks[j] : c.eof)

/** The next token, comments included. */
const frontRaw = (c: FrontCursor): FrontTok => (c.err !== null ? c.eof : frontTokAt(c, c.i))

/** The next token past comments, which are consumed. */
function frontPeek(c: FrontCursor): FrontTok {
  if (c.err !== null) {
    return c.eof
  }
  while (true) {
    const i = c.i
    const t = frontTokAt(c, i)
    if (t.kind !== FrontKind.Comment) {
      return t
    }
    if (c.iface) {
      const r = frontModuleLine(t)
      if (r.isErr()) {
        c.err = r.error
        return c.eof
      }
      if (r.value.length !== 0) {
        c.err = frontRefuse(
          "a module line goes between signatures, on its own line; move it out of this one",
          frontAt(t),
        )
        return c.eof
      }
    }
    // `t` is a comment, so `i` is short of the end and this cannot wrap.
    c.i = frontSum(i, 1)
  }
}

/** The next token past any comments, which stay unread. */
const frontLook = (c: FrontCursor): FrontTok => {
  if (c.err !== null) {
    return c.eof
  }
  let j = c.i
  // The end of the block is not a comment, so this stops short of wrapping.
  while (frontTokAt(c, j).kind === FrontKind.Comment) {
    j = frontSum(j, 1)
  }
  return frontTokAt(c, j)
}

const frontNext = (c: FrontCursor): FrontTok => {
  const t = frontPeek(c)
  if (t.kind !== FrontKind.Eof) {
    // Short of the end, the cursor is on a token, so this cannot wrap.
    c.i = frontSum(c.i, 1)
  }
  return t
}

/** Consume the raw next token (a comment the caller has looked at). */
const frontSkipRaw = (c: FrontCursor): void => {
  if (c.err === null) {
    // The caller looked at a comment there, so the cursor is on a token and this cannot wrap.
    c.i = frontSum(c.i, 1)
  }
}

const frontIs = (c: FrontCursor, text: string): boolean => {
  const t = frontPeek(c)
  return (t.kind === FrontKind.Punct || t.kind === FrontKind.Ident) && t.text === text
}

const frontEat = (c: FrontCursor, text: string): boolean => {
  if (!frontIs(c, text)) {
    return false
  }
  frontNext(c)
  return true
}

const frontExpect = (c: FrontCursor, text: string): Result<FrontTok, FrontRefusal> => {
  if (!frontIs(c, text)) {
    const t = frontPeek(c)
    return Err(frontRefuse(`expected \`${text}\`, got ${frontShown(t)}`, frontAt(t)))
  }
  return Ok(frontNext(c))
}

const frontIdent = (c: FrontCursor, what: string): Result<FrontTok, FrontRefusal> => {
  const t = frontPeek(c)
  if (t.kind !== FrontKind.Ident) {
    return Err(frontRefuse(`expected ${what}, got ${frontShown(t)}`, frontAt(t)))
  }
  return Ok(frontNext(c))
}

// ── Types ──────────────────────────────────────────────────────────────────

/** A contract base type and its TypeScript spelling. */
class FrontBase {
  name: string
  ts: string
  constructor(name: string, ts: string) {
    this.name = name
    this.ts = ts
  }
}

/** The contract's base types, each with its TypeScript spelling. */
const frontBases = (): FrontBase[] => {
  const out = [new FrontBase("bytes", "u8[]"), new FrontBase("string", "string"), new FrontBase("bool", "boolean")]
  for (const t of vocabIntTypes()) {
    out.push(new FrontBase(t, t))
  }
  out.push(new FrontBase("f64", "f64"))
  out.push(new FrontBase("secret-bytes", "Secret<u8[]>"))
  out.push(new FrontBase("words16", "u16[]"))
  out.push(new FrontBase("words32", "u32[]"))
  out.push(new FrontBase("words64", "u64[]"))
  return out
}

/** The TypeScript spellings of the base types. */
const frontTsBases = (): string[] => {
  const out: string[] = []
  for (const b of frontBases()) {
    out.push(b.ts)
  }
  return out
}

/** A contract type as the block's author wrote it: `T?` prints `T | null`. */
const frontTsTy = (t: string): string => {
  for (const b of frontBases()) {
    if (t === b.name) {
      return b.ts
    }
    if (t === `${b.name}?`) {
      return `${b.ts} | null`
    }
  }
  return t
}

/** A signature type's contract spelling, or null when it is not one. */
const frontSigTy = (ts: string): string | null => {
  for (const b of frontBases()) {
    if (ts === b.ts) {
      return b.name
    }
    if (ts === `${b.ts} | null`) {
      return `${b.name}?`
    }
  }
  return null
}

/** A type as written: its normalised spelling (`null | T` reads `T | null`) and where it starts. */
class FrontType {
  name: string
  pos: FrontPos
  constructor(name: string, pos: FrontPos) {
    this.name = name
    this.pos = pos
  }
}

/** Reads a type: identifiers, `[]`, `<`, `>` and `|`, stopping where none can follow. */
const frontReadType = (c: FrontCursor): Result<FrontType, FrontRefusal> => {
  const first = frontIdent(c, "a type").orReturn()
  const parts = [first.text]
  // The part pushed last.
  let last = first.text
  while (true) {
    // A comment ends the type: it may be a bounds comment.
    const t = frontRaw(c)
    const afterSep = last === "<" || last === "|"
    if (t.kind === FrontKind.Ident && afterSep) {
      last = t.text
    } else if (t.kind === FrontKind.Bytes && t.value.length === 0 && !afterSep) {
      last = "[]"
    } else if (t.kind === FrontKind.Punct && (t.text === "<" || t.text === ">" || t.text === "|")) {
      last = t.text
    } else {
      break
    }
    parts.push(last)
    frontNext(c)
  }
  const alts = split(parts.join(""), "|")
  const ordered: string[] = []
  for (const a of alts) {
    if (a !== "null") {
      ordered.push(a)
    }
  }
  for (const a of alts) {
    if (a === "null") {
      ordered.push(a)
    }
  }
  return Ok(new FrontType(ordered.join(" | "), frontAt(first)))
}

const frontSigType = (c: FrontCursor): Result<string, FrontRefusal> => {
  const ty = frontReadType(c).orReturn()
  const sig = frontSigTy(ty.name)
  if (sig === null) {
    return Err(
      frontRefuse(
        `\`${ty.name}\` is not a ts-interface type; use ${frontTsBases().join(", ")}, each optionally \`| null\``,
        ty.pos,
      ),
    )
  }
  return Ok(sig)
}

// ── ts-interface ───────────────────────────────────────────────────────────

/** Ops written as plain calls: `xor(a, b)`, and every byte-order op. */
const frontCallOps = (): string[] => {
  const ops: string[] = [
    "xor",
    "bitAnd",
    "bitOr",
    "fill",
    "zeros",
    "flipBit",
    "unwrap",
    "utf8",
    "ascii",
    "implies",
    "concat",
  ]
  for (const op of vocabWriteOps()) {
    ops.push(op)
  }
  for (const op of vocabReadOps()) {
    ops.push(op)
  }
  return ops
}

/** The module of a `<s>module:<s><path><s>` comment value, or null. */
const frontModuleOf = (value: string): string | null => {
  let i = 0
  while (i < value.length && frontIsSpace(frontByte(value, i))) {
    i++
  }
  if (!frontHas(value, i, "module:")) {
    return null
  }
  i = frontSum(i, 7)
  while (i < value.length && frontIsSpace(frontByte(value, i))) {
    i++
  }
  const start = i
  while (i < value.length && !frontIsSpace(frontByte(value, i))) {
    i++
  }
  const m = value.substring(start, i)
  while (i < value.length && frontIsSpace(frontByte(value, i))) {
    i++
  }
  return m.length === 0 || i !== value.length ? null : m
}

/** Whether a comment body (past leading `/`, `*` and spaces) starts `module:` or `module <root>/`, any case. */
const frontLooksModule = (value: string): boolean => {
  let i = 0
  while (i < value.length) {
    const c = frontByte(value, i)
    if (!(frontIsSpace(c) || c === 0x2f || c === 0x2a)) {
      break
    }
    i++
  }
  if (textAsciiLower(value.substring(i, frontSum(i, 6))) !== "module") {
    return false
  }
  i = frontSum(i, 6)
  const spaced = i < value.length && frontIsSpace(frontByte(value, i))
  while (i < value.length && frontIsSpace(frontByte(value, i))) {
    i++
  }
  if (i < value.length && frontByte(value, i) === 0x3a) {
    return true
  }
  if (!spaced || i >= value.length || !frontIsAlpha(frontByte(value, i))) {
    return false
  }
  i++
  while (i < value.length) {
    const c = frontByte(value, i)
    if (c === 0x2f) {
      return true
    }
    if (!frontIsAlpha(c) && !frontIsDigit(c) && c !== 0x5f) {
      return false
    }
    i++
  }
  return false
}

/**
 * The module a `// module: <root>/<path>` comment names, or "" for any other
 * comment. Refuses a comment meant as one that is not: a block comment, or a
 * comment of any style or case that starts `module:` or `module <root>/` but
 * does not parse, so the functions after it never silently keep the module
 * above.
 */
function frontModuleLine(t: FrontTok): Result<string, FrontRefusal> {
  const r = frontModuleOf(t.value)
  if (r !== null && !t.lineComment) {
    return Err(frontRefuse(`a module line is a line comment; write \`// module: ${r}\``, frontAt(t)))
  }
  if (r !== null) {
    return Ok(r)
  }
  if (frontLooksModule(t.value)) {
    const shown = t.lineComment ? `//${t.value}` : `/*${t.value}*/`
    return Err(frontRefuse(`a module line is \`// module: <root>/<path>\`, one module, not \`${shown}\``, frontAt(t)))
  }
  return Ok("")
}

const frontNotModule = (m: string): string =>
  `\`${m}\` is not a module path; write <root>/<segment>/…, each segment [a-z][a-z0-9_]*(-[a-z0-9][a-z0-9_]*)*, words joined by single - (RFC 3986 §3.3)`

/** What a ts-interface block declares: the module under test and its functions. */
export class FrontInterface {
  /** The module under test, as `<root>/<path>`. */
  module: string
  /** The functions the block declares, in order. */
  functions: FnSig[]
  /** `lines[i]` is the block line (1-based) that declares `functions[i]`. */
  lines: i32[]
  /**
   * Makes an interface.
   *
   * @param module the module under test
   * @param functions the functions declared, reference functions carrying their module
   * @param lines the block line declaring each function
   */
  constructor(module: string, functions: FnSig[], lines: i32[]) {
    this.module = module
    this.functions = functions
    this.lines = lines
  }
}

/**
 * Reads the comments right after a parameter's type, which say how the real
 * function takes it: a `window` block comment, after `u8[]`, is one, and an
 * `out CAP` block comment, after `u8[]`, makes it the buffer the result is
 * written into. A module line there is left for frontPeek to refuse.
 *
 * @returns the `out` comment, or null when the parameter is not an out buffer
 */
function frontParamForm(c: FrontCursor, fn: string, param: Param): Result<FrontTok | null, FrontRefusal> {
  let out: FrontTok | null = null
  let t = frontRaw(c)
  while (t.kind === FrontKind.Comment && frontModuleLine(t).orReturn().length === 0) {
    const at = `\`${fn}(${param.name})\``
    const words = splitWhitespace(t.value)
    const isOut = !t.lineComment && words.length > 0 && words[0] === "out"
    if (t.lineComment || (words.join(" ") !== "window" && !isOut)) {
      const shown = t.lineComment ? `//${t.value}` : `/*${t.value}*/`
      return Err(
        frontRefuse(
          `${at}: an interface parameter takes only /* window */ or /* out CAP */, not \`${shown}\``,
          frontAt(t),
        ),
      )
    }
    const what = isOut ? "/* out CAP */" : "/* window */"
    if (isOut && out !== null) {
      return Err(frontRefuse(`${at} is already an out buffer; write /* out CAP */ once`, frontAt(t)))
    }
    if (!isOut && param.form !== null) {
      return Err(frontRefuse(`${at} is already a window; write /* window */ once`, frontAt(t)))
    }
    if ((isOut && param.form !== null) || (!isOut && out !== null)) {
      return Err(frontRefuse(`${at} cannot be both a window and an out buffer`, frontAt(t)))
    }
    if (param.type !== "bytes") {
      const takes = isOut ? "(out, at) and writes the result into" : "(buf, off, len)"
      return Err(
        frontRefuse(
          `${at} is ${frontTsTy(param.type)}: ${what} goes only after u8[], which the real function takes as ${takes}`,
          frontAt(t),
        ),
      )
    }
    if (isOut) {
      if (words.length === 1) {
        return Err(
          frontRefuse(`${at}: /* out */ needs its capacity, like /* out 2 * ${param.name}.length + 8 */`, frontAt(t)),
        )
      }
      out = t
    } else {
      param.form = "window"
    }
    frontSkipRaw(c)
    t = frontRaw(c)
  }
  return Ok(out)
}

/**
 * Checks a function's out buffer once its parameters and result are read:
 * the result is bytes, and the capacity parses and reads only the lengths of
 * its bytes parameters.
 */
const frontOutBuffer = (sig: FnSig, name: string, at: i32, tok: FrontTok): Result<OutBuffer, FrontRefusal> => {
  const where = `\`${sig.name}(${name})\``
  if (sig.returns !== "bytes" && sig.returns !== "bytes?") {
    return Err(
      frontRefuse(
        `${where} is an out buffer, so \`${sig.name}\` returns the bytes written into it: declare u8[] or u8[] | null, not ${frontTsTy(sig.returns)}`,
        frontAt(tok),
      ),
    )
  }
  const value = trim(tok.value)
  const text = trim(value.substring(3, value.length))
  const e = capacityParse(text)
  if (e.isErr()) {
    return Err(
      frontRefuse(
        `${where}: the capacity \`${text}\` ${e.error}; a capacity is decimal numbers, +, *, parentheses and <u8[] parameter>.length`,
        frontAt(tok),
      ),
    )
  }
  for (const n of capacityNames(e.value)) {
    let found = false
    for (const p of sig.params) {
      found = found || (p.name === n && p.type === "bytes")
    }
    if (!found) {
      return Err(
        frontRefuse(
          `${where}: the capacity reads \`${n}.length\`, but \`${n}\` is not a u8[] parameter of \`${sig.name}\``,
          frontAt(tok),
        ),
      )
    }
  }
  const b = new OutBuffer()
  b.at = at
  b.capacity = capacityShow(e.value)
  return Ok(b)
}

function frontInterfaceIn(c: FrontCursor): Result<FrontInterface, FrontRefusal> {
  const head = frontRaw(c)
  const m: string | null = head.kind === FrontKind.Comment && head.lineComment ? frontModuleOf(head.value) : null
  if (m === null || head.line !== 1) {
    return Err(frontRefuse("missing `// module: <root>/<path>` first line", frontAt(head)))
  }
  if (!charsIsModule(m)) {
    return Err(frontRefuse(frontNotModule(m), frontAt(head)))
  }
  frontSkipRaw(c)
  const functions: FnSig[] = []
  const lines: i32[] = []
  // A later `// module: <root>/<other>` line: the functions after it are
  // reference functions of that module, which properties call but the test
  // does not test. Any other comment is skipped.
  let from = m
  while (true) {
    let t = frontRaw(c)
    while (t.kind === FrontKind.Comment) {
      const r = frontModuleLine(t).orReturn()
      if (r.length !== 0) {
        if (!charsIsModule(r)) {
          return Err(frontRefuse(frontNotModule(r), frontAt(t)))
        }
        if (r === from) {
          return Err(frontRefuse(`the functions above are already from ${r}`, frontAt(t)))
        }
        if (r === m) {
          return Err(
            frontRefuse(
              `${m} is the module under test; declare its functions first, before any \`// module:\` line`,
              frontAt(t),
            ),
          )
        }
        if (from === m && functions.length === 0) {
          return Err(
            frontRefuse(
              `${m}, the module under test, declares no function; declare its functions before \`// module: ${r}\``,
              frontAt(t),
            ),
          )
        }
        from = r
      }
      frontSkipRaw(c)
      t = frontRaw(c)
    }
    if (frontPeek(c).kind === FrontKind.Eof) {
      break
    }
    frontExpect(c, "export").orReturn()
    const isConst = frontEat(c, "const")
    if (!isConst) {
      frontExpect(c, "function").orReturn()
    }
    const name = frontIdent(c, "a function name").orReturn()
    for (const f of functions) {
      if (f.name === name.text) {
        return Err(frontRefuse(`\`${name.text}\` is declared twice`, frontAt(name)))
      }
    }
    if (vocabHas(frontCallOps(), name.text)) {
      return Err(frontRefuse(`\`${name.text}\` is a ts-property op; give the function another name`, frontAt(name)))
    }
    if (isConst) {
      frontExpect(c, "=").orReturn()
    }
    frontExpect(c, "(").orReturn()
    const sig = new FnSig()
    sig.name = name.text
    let outTok: FrontTok | null = null
    let outName = ""
    let outAt: i32 = 0
    while (!frontIs(c, ")")) {
      const p = frontIdent(c, "a parameter name").orReturn()
      for (const q of sig.params) {
        if (q.name === p.text) {
          return Err(frontRefuse(`\`${name.text}\` has two parameters named \`${p.text}\``, frontAt(p)))
        }
      }
      if (outTok !== null && outName === p.text) {
        return Err(frontRefuse(`\`${name.text}\` has two parameters named \`${p.text}\``, frontAt(p)))
      }
      frontExpect(c, ":").orReturn()
      const param = new Param()
      param.name = p.text
      param.type = frontSigType(c).orReturn()
      const o = frontParamForm(c, name.text, param).orReturn()
      if (o === null) {
        sig.params.push(param)
      } else if (outTok !== null) {
        return Err(
          frontRefuse(
            `\`${name.text}\` already writes into \`${outName}\`; a function has at most one /* out CAP */ buffer`,
            frontAt(o),
          ),
        )
      } else {
        outTok = o
        outName = p.text
        outAt = toI32(sig.params.length)
      }
      if (!frontEat(c, ",")) {
        break
      }
    }
    frontExpect(c, ")").orReturn()
    frontExpect(c, ":").orReturn()
    sig.returns = frontSigType(c).orReturn()
    if (outTok !== null) {
      sig.out = frontOutBuffer(sig, outName, outAt, outTok).orReturn()
    }
    // Look past comments without reading them: a `// module:` line may follow.
    const body = frontLook(c)
    if (body.text === "=>" || body.text === "{") {
      return Err(
        frontRefuse(`a ts-interface declares signatures only; remove the body of \`${name.text}\``, frontAt(body)),
      )
    }
    // A `;`, with comments before it, ends the signature; a module line
    // there would be read past, so it goes after the `;`.
    if (body.kind === FrontKind.Punct && body.text === ";") {
      let k = frontRaw(c)
      while (k.kind === FrontKind.Comment) {
        const r = frontModuleLine(k).orReturn()
        if (r.length !== 0) {
          return Err(frontRefuse(`end \`${name.text}\` with its \`;\` before this module line`, frontAt(k)))
        }
        frontSkipRaw(c)
        k = frontRaw(c)
      }
      frontNext(c)
    }
    if (from !== m) {
      sig.module = from
    }
    functions.push(sig)
    lines.push(name.line)
  }
  if (functions.length === 0) {
    return Err(frontRefuse("a ts-interface declares at least one function", frontAt(frontPeek(c))))
  }
  return Ok(new FrontInterface(m, functions, lines))
}

/**
 * Reads a ts-interface block: a `// module: <root>/<path>` first line, then
 * `export function` or `export const` signatures, each ending in `;`. A later
 * `// module:` line puts the functions after it in that module, as reference
 * functions.
 *
 * @param text the block, its lines joined with LF (CRLF and CR read the same)
 * @returns the module and its functions, or the refusal, positioned in the block
 */
export const frontParseInterface = (text: string): Result<FrontInterface, FrontRefusal[]> => {
  const toks = frontLex(text, "ts-interface")
  if (toks.isErr()) {
    return Err([toks.error])
  }
  const c = new FrontCursor(toks.value, true)
  const r = frontInterfaceIn(c)
  const err = c.err
  if (err !== null) {
    return Err([err])
  }
  if (r.isErr()) {
    return Err([r.error])
  }
  return Ok(r.value)
}

/**
 * Whether a front end reads a sourcecode type: the language before its first
 * `-` is `ts` ("ts-interface", "ts-property").
 *
 * @param sourcecodeType the type of a sourcecode block
 * @returns true when this module reads blocks of that type
 */
export const frontReads = (sourcecodeType: string): boolean => {
  const dash = sourcecodeType.indexOf("-")
  return dash > 0 && sourcecodeType.substring(0, dash) === "ts"
}

// ── ts-property ────────────────────────────────────────────────────────────

/** Ops whose every argument is bytes: a string literal there is ASCII bytes. */
const frontBytesOps = (): string[] => ["concat", "xor", "bitAnd", "bitOr"]

/** A method of the subset: its name, its op and its argument count. */
class FrontMethod {
  name: string
  op: string
  arity: i32
  constructor(name: string, op: string, arity: i32) {
    this.name = name
    this.op = op
    this.arity = arity
  }
}

const frontMethods = (): FrontMethod[] => [
  new FrontMethod("concat", "concat", 1),
  new FrontMethod("slice", "slice", 2),
  new FrontMethod("toLowerCase", "lower", 0),
  new FrontMethod("toUpperCase", "upper", 0),
  new FrontMethod("charAt", "charAt", 1),
]

/** The subset's method of this name, or null. */
const frontMethodOf = (name: string): FrontMethod | null => {
  for (const m of frontMethods()) {
    if (m.name === name) {
      return m
    }
  }
  return null
}

/** Infix operators of TypeScript the subset leaves out, refused by name. */
const frontNotInfix = (): string[] => [
  "/",
  "&",
  "|",
  "^",
  "<<",
  ">>",
  ">>>",
  "**",
  "??",
  "?",
  "=",
  "=>",
  "?.",
  "++",
  "--",
  "...",
]

/** Deeper nesting is refused, so a hostile block cannot exhaust the stack. */
const FRONT_MAX_DEPTH: i32 = 64

/** Past this, an argument index in a `typeOf` error names no argument. */
const FRONT_INDEX_MAX: i32 = 100000000
const FRONT_DEPTH_MESSAGE: string = "the expression nests more than 64 deep; name a part with const"
const FRONT_COVERS_HINT: string = "missing `// P-ID covers R-ID — title` line"

/** A typed expression: its contract form, its type and where it starts. */
class FrontV {
  e: Expr
  t: string
  pos: FrontPos
  /** Set for a bare string literal, whose meaning (str or ascii) the context decides. */
  str: string | null
  /** How deep the expression nests; -1 for a leaf. */
  depth: i32
  constructor(e: Expr, t: string, pos: FrontPos) {
    this.e = e
    this.t = t
    this.pos = pos
    this.str = null
    this.depth = -1
  }
}

/** What a ts-property block says: its ids, its title and its clause. */
export class FrontProperty {
  /** The clause's id. */
  id: string
  /** The clause's title; null without one. */
  title: string | null
  /** The requirement ids the property covers. */
  covers: string[]
  /** The property clause, its id, title and covers set. */
  clause: Clause
  /**
   * Makes a property.
   *
   * @param id the clause id
   * @param title the clause title
   * @param covers the requirement ids it covers
   * @param clause the property clause
   */
  constructor(id: string, title: string | null, covers: string[], clause: Clause) {
    this.id = id
    this.title = title
    this.covers = covers
    this.clause = clause
  }
}

/** A variable in scope and its type. */
class FrontBinding {
  name: string
  type: string
  constructor(name: string, type: string) {
    this.name = name
    this.type = type
  }
}

/** The property parser's state: the cursor, the functions, the variables in scope. */
class FrontProp {
  c: FrontCursor
  fns: FnSig[]
  vars: FrontBinding[]
  /** True while parsing `where`, which may not call the implementation. */
  inWhere: boolean
  /** How many operands are being parsed inside one another. */
  nest: i32
  constructor(c: FrontCursor, fns: FnSig[]) {
    this.c = c
    this.fns = fns
    this.vars = []
    this.inWhere = false
    this.nest = 0
  }
}

const frontVar = (p: FrontProp, name: string): string | null => {
  for (let k = p.vars.length - 1; k >= 0; k--) {
    if (p.vars[k].name === name) {
      return p.vars[k].type
    }
  }
  return null
}

/** The interface function of a name, the last declared, like a map. */
const frontFn = (p: FrontProp, name: string): FnSig | null => {
  for (let k = p.fns.length - 1; k >= 0; k--) {
    if (p.fns[k].name === name) {
      return p.fns[k]
    }
  }
  return null
}

const frontSetVar = (p: FrontProp, name: string, type: string): void => {
  p.vars.push(new FrontBinding(name, type))
}

/** The depth of a node over these operands, refused past the maximum. */
const frontDepthOver = (args: FrontV[], pos: FrontPos): Result<i32, FrontRefusal> => {
  let depth = 0
  for (const a of args) {
    if (a.depth > depth) {
      depth = a.depth
    }
  }
  if (depth >= FRONT_MAX_DEPTH) {
    return Err(frontRefuse(FRONT_DEPTH_MESSAGE, pos))
  }
  return Ok(depth + 1)
}

/** `bytes`, `string` and `bool`, each with an optional `?`, as the author wrote them, at word boundaries. */
const frontTsWords = (msg: string): string => {
  let out = ""
  let i = 0
  while (i < msg.length) {
    if (!frontIsWord(frontByte(msg, i))) {
      out = out + msg.substring(i, i + 1)
      i++
      continue
    }
    let j = i
    while (j < msg.length && frontIsWord(frontByte(msg, j))) {
      j++
    }
    const w = msg.substring(i, j)
    if (w === "bytes" || w === "string" || w === "bool") {
      const opt = j < msg.length && frontByte(msg, j) === 0x3f
      out = out + frontTsTy(opt ? `${w}?` : w)
      i = opt ? frontSum(j, 1) : j
    } else {
      out = out + w
      i = j
    }
  }
  return out
}

/**
 * Types a new node with the contract's `typeOf` (its arguments are already
 * typed, so any error is this node's), refusing at the argument it names.
 */
const frontTyped = (
  p: FrontProp,
  e: Expr,
  args: FrontV[],
  name: string,
  pos: FrontPos,
): Result<FrontV, FrontRefusal> => {
  const env = new TypeEnv(p.fns, true)
  for (const b of p.vars) {
    typeEnvBind(env, b.name, b.type)
  }
  const errors: string[] = []
  const t = typeOf(e, env, "", errors)
  if (t === null) {
    const first = errors.length > 0 ? errors[0] : ": cannot type this expression"
    let at = pos
    let msg = first
    let i = 0
    if (frontHas(first, 0, ".args[")) {
      i = 6
      // `typeOf` names an argument of this node, so `n` stays under a few
      // digits: past FRONT_INDEX_MAX it stops growing and names no argument.
      // In u32, where the step cannot wrap: under the cap, times 10, plus a digit.
      const cap = toU32(FRONT_INDEX_MAX)
      let n: u32 = 0
      while (i < first.length && frontIsDigit(frontByte(first, i))) {
        n = n < cap ? n * 10 + (toU32(frontByte(first, i)) - 0x30) : cap
        i++
      }
      // Under the cap, `k` is never negative: `k >= 0` only tells the prover so.
      const k = toI32(n)
      if (frontHas(first, i, "]") && n < cap && k >= 0 && k < args.length) {
        at = args[k].pos
        i = frontSum(i, 1)
      }
    }
    if (frontHas(first, i, ": ")) {
      msg = first.substring(frontSum(i, 2), first.length)
    } else {
      // A deeper path: the refusal is this node's.
      at = pos
      const colon = first.indexOf(": ")
      msg = colon < 0 ? first : first.substring(frontSum(colon, 2), first.length)
    }
    if (frontHas(msg, 0, `${e.name} `)) {
      msg = name + msg.substring(e.name.length, msg.length)
    }
    return Err(frontRefuse(frontTsWords(msg), at))
  }
  const v = new FrontV(e, t, pos)
  v.depth = frontDepthOver(args, pos).orReturn()
  return Ok(v)
}

const frontOp = (op: string, args: FrontV[]): Expr => {
  const e = new Expr(ExprKind.Op, op)
  for (const a of args) {
    e.args.push(a.e)
  }
  return e
}

const frontLit = (lit: Literal): Expr => {
  const e = new Expr(ExprKind.Lit, "")
  e.lit = lit
  return e
}

const frontIsLit = (v: FrontV, kind: LitKind): boolean => {
  const lit = v.e.lit
  return v.e.kind === ExprKind.Lit && lit !== null && lit.kind === kind
}

/** A string literal where bytes are wanted is its ASCII bytes. */
const frontAsBytes = (v: FrontV): FrontV => {
  const s = v.str
  if (s === null) {
    return v
  }
  return new FrontV(frontLit(new Literal(LitKind.Ascii, s)), "bytes", v.pos)
}

/** Strips leading zeros from a decimal and reads -0 as 0. */
const frontDecimal = (text: string): string => {
  const neg = frontHas(text, 0, "-")
  let i = neg ? 1 : 0
  while (i < text.length - 1 && frontByte(text, i) === 0x30) {
    i++
  }
  const mag = text.substring(i, text.length)
  return neg && mag !== "0" ? `-${mag}` : mag
}

/**
 * An integer literal, read exactly: a JSON number within ±(2^53−1), else a
 * decimal string (RFC 7493 §2.2). Its type is the first of i32, i64, u64 it
 * fits; `typeOf` gives it the other operand's type where it fits there.
 */
const frontInt = (text: string, pos: FrontPos): Result<FrontV, FrontRefusal> => {
  const n = frontDecimal(text)
  const lo = vocabIntMin("i64")
  const hi = vocabIntMax("u64")
  if (vocabCompareDecimal(n, lo) < 0 || vocabCompareDecimal(n, hi) > 0) {
    return Err(frontRefuse(`\`${text}\` is outside every integer type (${lo}..${hi})`, pos))
  }
  const lit = new Literal(LitKind.Int, n)
  lit.quoted = !vocabIsJsonSafe(n)
  return Ok(new FrontV(frontLit(lit), typeOfLiteral(lit), pos))
}

/** The parts of a bounds comment: `lo..hi`, then the alphabet text, if any. */
class FrontBounds {
  lo: string
  hi: string
  alpha: string | null
  constructor(lo: string, hi: string, alpha: string | null) {
    this.lo = lo
    this.hi = hi
    this.alpha = alpha
  }
}

/** The end of `-?\d+` at `i`, or -1. */
const frontIntEnd = (s: string, i: i32): i32 => {
  let j = i
  if (frontHas(s, j, "-")) {
    j = frontSum(j, 1)
  }
  const start = j
  while (j < s.length && frontIsDigit(frontByte(s, j))) {
    j++
  }
  return j === start ? -1 : j
}

/** `(-?\d+)\.\.(-?\d+)(?:\s+(.*))?`, over the whole text, or null. */
const frontReadBounds = (s: string): FrontBounds | null => {
  const a = frontIntEnd(s, 0)
  if (a < 0 || !frontHas(s, a, "..")) {
    return null
  }
  const b = frontIntEnd(s, frontSum(a, 2))
  if (b < 0) {
    return null
  }
  const lo = frontDecimal(s.substring(0, a))
  const hi = frontDecimal(s.substring(frontSum(a, 2), b))
  if (b === s.length) {
    return new FrontBounds(lo, hi, null)
  }
  if (!frontIsSpace(frontByte(s, b))) {
    return null
  }
  let k = b
  while (k < s.length && frontIsSpace(frontByte(s, k))) {
    k++
  }
  return new FrontBounds(lo, hi, s.substring(k, s.length))
}

const frontAlphabet = (text: string, pos: FrontPos): Result<string[], FrontRefusal> => {
  const classes = shapeAlphabetClasses()
  if (!frontHas(text, 0, '"')) {
    const names = splitWhitespace(text)
    for (const n of names) {
      if (!vocabHas(classes, n)) {
        return Err(frontRefuse(`unknown alphabet class \`${n}\`; use ${classes.join(", ")} or a JSON string`, pos))
      }
    }
    return Ok(names)
  }
  const s = frontJsonString(text)
  if (s === null) {
    return Err(frontRefuse("the alphabet must be one JSON string", pos))
  }
  if (s.length === 0) {
    return Err(frontRefuse("the alphabet is empty", pos))
  }
  if (!charsIsStringText(s)) {
    return Err(frontRefuse("the alphabet holds only printable ASCII, tab, LF and CR", pos))
  }
  const out: string[] = []
  for (let i = 0; i < s.length; i++) {
    out.push(s.substring(i, i + 1))
  }
  return Ok(out)
}

/**
 * The bounds comment of a forall variable: `lo..hi` (length for u8[] and
 * string, value for an integer), then for a string its alphabet, as class
 * names or one JSON string whose characters are the alphabet in order.
 */
const frontBounded = (name: string, type: string, comment: FrontTok): Result<ForallVar, FrontRefusal> => {
  const pos = frontAt(comment)
  // The type as the property spells it: a bytes variable is written u8[].
  const shown = type === "bytes" ? "u8[]" : type
  const b = frontReadBounds(trim(comment.value))
  if (b === null) {
    return Err(frontRefuse(`the bounds of \`${name}\` (${shown}) must read \`lo..hi\`, like /* 0..64 */`, pos))
  }
  const alpha = b.alpha
  if (type !== "string" && alpha !== null) {
    return Err(frontRefuse(`an alphabet applies only to string variables, not \`${name}\``, pos))
  }
  const v = new ForallVar()
  v.name = name
  v.type = type
  if (vocabIsIntType(type)) {
    const min = vocabIntMin(type)
    const max = vocabIntMax(type)
    if (
      vocabCompareDecimal(min, b.lo) > 0 ||
      vocabCompareDecimal(b.lo, b.hi) > 0 ||
      vocabCompareDecimal(b.hi, max) > 0
    ) {
      return Err(frontRefuse(`the bounds of \`${name}\` (${type}) must satisfy ${min} <= lo <= hi <= ${max}`, pos))
    }
    v.min = b.lo
    v.max = b.hi
    v.minQuoted = !vocabIsJsonSafe(b.lo)
    v.maxQuoted = !vocabIsJsonSafe(b.hi)
    v.hasBounds = true
    return Ok(v)
  }
  const cap = `${SHAPE_MAX_LEN}`
  if (vocabCompareDecimal("0", b.lo) > 0 || vocabCompareDecimal(b.lo, b.hi) > 0 || vocabCompareDecimal(b.hi, cap) > 0) {
    return Err(frontRefuse(`the length bounds of \`${name}\` (${shown}) must satisfy 0 <= lo <= hi <= ${cap}`, pos))
  }
  v.minLen = toI32(parseInt(b.lo))
  v.maxLen = toI32(parseInt(b.hi))
  if (type === "bytes") {
    return Ok(v)
  }
  if (alpha === null) {
    return Err(
      frontRefuse(
        `\`${name}\` needs an alphabet after its bounds: class names (${shapeAlphabetClasses().join(", ")}) or a JSON string`,
        pos,
      ),
    )
  }
  v.alphabet = frontAlphabet(alpha, pos).orReturn()
  return Ok(v)
}

/** The id, the title and the covered ids of a covers line. */
class FrontCovers {
  id: string
  title: string
  covers: string[]
  constructor(id: string, title: string, covers: string[]) {
    this.id = id
    this.title = title
    this.covers = covers
  }
}

/** A covers line's id and the text after `covers`. */
class FrontCoversParts {
  id: string
  rest: string
  constructor(id: string, rest: string) {
    this.id = id
    this.rest = rest
  }
}

/** `^\s*(\S+)\s+covers\s+(.*)$`, as the id and the rest, or null. */
const frontCoversOf = (value: string): FrontCoversParts | null => {
  let i = 0
  while (i < value.length && frontIsSpace(frontByte(value, i))) {
    i++
  }
  const start = i
  while (i < value.length && !frontIsSpace(frontByte(value, i))) {
    i++
  }
  let j = i
  while (j < value.length && frontIsSpace(frontByte(value, j))) {
    j++
  }
  if (start === i || j === i || !frontHas(value, j, "covers")) {
    return null
  }
  const after = frontSum(j, 6)
  let k = after
  while (k < value.length && frontIsSpace(frontByte(value, k))) {
    k++
  }
  if (k === after) {
    return null
  }
  return new FrontCoversParts(value.substring(start, i), value.substring(k, value.length))
}

const frontCoversLine = (p: FrontProp): Result<FrontCovers, FrontRefusal> => {
  const head = frontRaw(p.c)
  const m: FrontCoversParts | null =
    head.kind === FrontKind.Comment && head.lineComment ? frontCoversOf(head.value) : null
  if (m === null || head.line !== 1) {
    return Err(frontRefuse(FRONT_COVERS_HINT, frontAt(head)))
  }
  const rest = m.rest
  const dash = rest.indexOf(" — ")
  const title = dash < 0 ? "" : trim(rest.substring(frontSum(dash, 5), rest.length))
  if (title.length === 0) {
    return Err(frontRefuse("missing title: end the covers line with ` — <title>`", frontAt(head)))
  }
  const covers: string[] = []
  for (const part of split(trim(rest.substring(0, dash)), ",")) {
    covers.push(trim(part))
  }
  const ids = [m.id]
  for (const id of covers) {
    ids.push(id)
  }
  for (const id of ids) {
    if (!charsIsId(id)) {
      return Err(frontRefuse(`\`${id}\` is not a clause or requirement id`, frontAt(head)))
    }
  }
  frontSkipRaw(p.c)
  return Ok(new FrontCovers(m.id, title, covers))
}

/** The most samples a property may ask for, the contract's own ceiling. */
const FRONT_SAMPLES_MAX: i32 = 256

const FRONT_SAMPLES_HINT: string = "samples takes a decimal integer, 1..256, as `// samples: N`"

/**
 * Whether a token is a comment whose text, trimmed, starts with the word
 * `samples` in any case: followed by a colon, a space or nothing, so that
 * `// samplesheet` stays an ordinary comment and `// Samples: 5` is refused
 * rather than ignored.
 */
const frontIsSamplesLine = (t: FrontTok): boolean => {
  const s = trim(t.value)
  if (t.kind !== FrontKind.Comment || s.length < 7) {
    return false
  }
  const word = "samples"
  for (let k = 0; k < 7; k++) {
    if ((frontByte(s, k) | 0x20) !== frontByte(word, k)) {
      return false
    }
  }
  return s.length === 7 || frontHas(s, 7, ":") || frontHas(s, 7, " ") || frontHas(s, 7, "\t")
}

/**
 * The count of a `// samples: N` line: N in decimal, with no sign, leading
 * zero, fraction or exponent, and within 1..256.
 */
const frontSamplesOf = (t: FrontTok): Result<i32, FrontRefusal> => {
  const s = trim(t.value)
  const pos = frontAt(t)
  if (!t.lineComment || !s.startsWith("samples") || !frontHas(s, 7, ":")) {
    return Err(frontRefuse(FRONT_SAMPLES_HINT, pos))
  }
  const n = trim(s.substring(8, s.length))
  let digits = n.length !== 0 && (n === "0" || frontByte(n, 0) !== 0x30)
  for (let k = 0; k < n.length; k++) {
    digits = digits && frontIsDigit(frontByte(n, k))
  }
  if (!digits) {
    return Err(frontRefuse(FRONT_SAMPLES_HINT, pos))
  }
  if (vocabCompareDecimal(n, "1") < 0 || vocabCompareDecimal(n, `${FRONT_SAMPLES_MAX}`) > 0) {
    return Err(frontRefuse(`samples must be 1..${FRONT_SAMPLES_MAX}, not ${n}`, pos))
  }
  return Ok(toI32(parseInt(n)))
}

/**
 * The optional `// samples: N` line 2 of a property, or -1 when it has none.
 * A samples line anywhere else is refused, so a misplaced one is never
 * silently ignored.
 */
const frontSamplesLine = (c: FrontCursor): Result<i32, FrontRefusal> => {
  let samples = -1
  const raw = frontRaw(c)
  if (frontIsSamplesLine(raw) && raw.line === 2) {
    samples = frontSamplesOf(raw).orReturn()
    frontSkipRaw(c)
  }
  for (let k = c.i; k < c.toks.length; k++) {
    const t = frontTokAt(c, k)
    if (frontIsSamplesLine(t)) {
      return Err(frontRefuse("the samples line goes on line 2, after the covers line", frontAt(t)))
    }
  }
  return Ok(samples)
}

/** Refuses a name already bound or naming an interface function. */
const frontBind = (p: FrontProp, name: FrontTok): Result<boolean, FrontRefusal> => {
  if (frontVar(p, name.text) !== null) {
    return Err(frontRefuse(`\`${name.text}\` is bound twice`, frontAt(name)))
  }
  if (frontFn(p, name.text) !== null) {
    return Err(frontRefuse(`\`${name.text}\` names an interface function`, frontAt(name)))
  }
  return Ok(true)
}

const frontForallVar = (p: FrontProp): Result<ForallVar, FrontRefusal> => {
  const c = p.c
  const name = frontIdent(c, "a variable name").orReturn()
  frontBind(p, name).orReturn()
  frontExpect(c, ":").orReturn()
  const ty = frontReadType(c).orReturn()
  if (ty.name === "f64") {
    return Err(frontRefuse("properties over f64 are not sampled yet; give f64 cases as vectors", ty.pos))
  }
  if (ty.name === "u16[]" || ty.name === "u32[]" || ty.name === "u64[]") {
    return Err(frontRefuse(`properties over ${ty.name} are not sampled yet; give word-array cases as vectors`, ty.pos))
  }
  let type = ""
  if (ty.name === "u8[]") {
    type = "bytes"
  } else if (ty.name === "string" || vocabIsIntType(ty.name)) {
    type = ty.name
  } else if (ty.name.startsWith("Secret<")) {
    return Err(frontRefuse(`\`${ty.name}\` is not a forall type: ${VOCAB_SECRET_FORM}`, ty.pos))
  } else {
    return Err(
      frontRefuse(
        `\`${ty.name}\` is not a forall type; use u8[], string or an integer type (${vocabIntTypes().join(", ")})`,
        ty.pos,
      ),
    )
  }
  const raw = frontRaw(c)
  if (raw.kind !== FrontKind.Comment || raw.lineComment) {
    return Err(frontRefuse(`\`${name.text}\` needs a bounds comment, like /* 0..64 */`, frontAt(raw)))
  }
  frontSkipRaw(c)
  frontSetVar(p, name.text, type)
  return frontBounded(name.text, type, raw)
}

const frontBoolean = (v: FrontV, what: string): Result<FrontV, FrontRefusal> => {
  if (v.t !== "bool") {
    return Err(frontRefuse(`${what} must be boolean, got ${frontTsTy(v.t)}`, v.pos))
  }
  return Ok(v)
}

/** `expr`, or `{ const n = e; … return e; }`, which maps to a let. */
function frontBody(p: FrontProp): Result<FrontV, FrontRefusal> {
  const c = p.c
  const open = frontPeek(c)
  if (!frontEat(c, "{")) {
    return frontExpr(p)
  }
  const lets: LetBinding[] = []
  while (true) {
    const t = frontPeek(c)
    if (frontEat(c, "return")) {
      break
    }
    if (frontEat(c, "const")) {
      const name = frontIdent(c, "a const name").orReturn()
      frontBind(p, name).orReturn()
      frontExpect(c, "=").orReturn()
      const value = frontExpr(p).orReturn()
      if (value.t === "null") {
        return Err(frontRefuse(`\`${name.text}\` is a bare null, which has no type`, value.pos))
      }
      frontEat(c, ";")
      lets.push(new LetBinding(name.text, value.e))
      frontSetVar(p, name.text, value.t)
      continue
    }
    if (t.kind === FrontKind.Ident) {
      return Err(frontRefuse(`\`${t.text}\` is not in the ts-property subset`, frontAt(t)))
    }
    return Err(frontRefuse(`expected \`const\` or \`return\`, got ${frontShown(t)}`, frontAt(t)))
  }
  const result = frontExpr(p).orReturn()
  frontEat(c, ";")
  frontExpect(c, "}").orReturn()
  if (lets.length === 0) {
    return Ok(result)
  }
  const e = new Expr(ExprKind.Let, "")
  e.binds = lets
  e.body = result.e
  return Ok(new FrontV(e, result.t, frontAt(open)))
}

// Precedence, loosest first: || && equality relational additive
// multiplicative unary postfix.

function frontExpr(p: FrontProp): Result<FrontV, FrontRefusal> {
  const first = frontAnd(p).orReturn()
  const args: FrontV[] = [first]
  while (frontEat(p.c, "||")) {
    args.push(frontAnd(p).orReturn())
  }
  if (args.length === 1) {
    return Ok(first)
  }
  return frontTyped(p, frontOp("or", args), args, "`||`", first.pos)
}

/** `a && b && c` is one n-ary `and`. */
function frontAnd(p: FrontProp): Result<FrontV, FrontRefusal> {
  const first = frontEquality(p).orReturn()
  const args: FrontV[] = [first]
  while (frontEat(p.c, "&&")) {
    args.push(frontEquality(p).orReturn())
  }
  if (args.length === 1) {
    return Ok(first)
  }
  return frontTyped(p, frontOp("and", args), args, "`&&`", first.pos)
}

const frontIsPunct = (t: FrontTok, texts: string[]): boolean => t.kind === FrontKind.Punct && vocabHas(texts, t.text)

function frontEquality(p: FrontProp): Result<FrontV, FrontRefusal> {
  let l = frontRelational(p).orReturn()
  while (true) {
    const t = frontPeek(p.c)
    if (!frontIsPunct(t, ["===", "!==", "==", "!="])) {
      return Ok(l)
    }
    frontNext(p.c)
    const r = frontRelational(p).orReturn()
    const eq = frontHas(t.text, 0, "=")
    let nullSide: FrontV | null = null
    if (frontIsLit(r, LitKind.Null)) {
      nullSide = l
    } else if (frontIsLit(l, LitKind.Null)) {
      nullSide = r
    }
    if (nullSide !== null && nullSide.t !== "null") {
      const one = [nullSide]
      l = frontTyped(p, frontOp(eq ? "isNull" : "notNull", one), one, `\`${t.text} null\``, l.pos).orReturn()
      continue
    }
    const two = [l, r]
    l = frontTyped(p, frontOp(eq ? "==" : "!=", two), two, `\`${t.text}\``, l.pos).orReturn()
  }
}

function frontRelational(p: FrontProp): Result<FrontV, FrontRefusal> {
  let l = frontAdditive(p).orReturn()
  while (true) {
    const t = frontPeek(p.c)
    if (!frontIsPunct(t, ["<", "<=", ">", ">="])) {
      return Ok(l)
    }
    frontNext(p.c)
    const r = frontAdditive(p).orReturn()
    const two = [l, r]
    l = frontTyped(p, frontOp(t.text, two), two, `\`${t.text}\``, l.pos).orReturn()
  }
}

function frontAdditive(p: FrontProp): Result<FrontV, FrontRefusal> {
  let l = frontMultiplicative(p).orReturn()
  while (true) {
    const t = frontPeek(p.c)
    if (!frontIsPunct(t, ["+", "-"])) {
      return Ok(l)
    }
    frontNext(p.c)
    const r = frontMultiplicative(p).orReturn()
    const op = t.text === "+" && (l.t === "string" || r.t === "string") ? "strConcat" : t.text
    const two = [l, r]
    l = frontTyped(p, frontOp(op, two), two, `\`${t.text}\``, l.pos).orReturn()
  }
}

function frontMultiplicative(p: FrontProp): Result<FrontV, FrontRefusal> {
  let l = frontUnary(p).orReturn()
  while (true) {
    const t = frontPeek(p.c)
    if (!frontIsPunct(t, ["*", "%"])) {
      frontRefuseInfix(t).orReturn()
      return Ok(l)
    }
    frontNext(p.c)
    const r = frontUnary(p).orReturn()
    const lit = r.e.lit
    if (t.text === "%" && frontIsLit(r, LitKind.Int) && lit !== null && lit.text === "0") {
      return Err(frontRefuse("`% 0` is NaN in TypeScript and 0 in the contract", r.pos))
    }
    const two = [l, r]
    l = frontTyped(p, frontOp(t.text, two), two, `\`${t.text}\``, l.pos).orReturn()
  }
}

/** Refuses an infix operator TypeScript has and the subset does not. */
const frontRefuseInfix = (t: FrontTok): Result<boolean, FrontRefusal> => {
  if (t.kind !== FrontKind.Punct) {
    return Ok(true)
  }
  if (t.text === "==>") {
    return Err(frontRefuse("`==>` is not in the ts-property subset; use implies(a, b)", frontAt(t)))
  }
  if (vocabHas(frontNotInfix(), t.text)) {
    return Err(frontRefuse(`\`${t.text}\` is not in the ts-property subset`, frontAt(t)))
  }
  return Ok(true)
}

function frontUnary(p: FrontProp): Result<FrontV, FrontRefusal> {
  const t = frontPeek(p.c)
  const nest = p.nest
  if (nest >= FRONT_MAX_DEPTH) {
    return Err(frontRefuse(FRONT_DEPTH_MESSAGE, frontAt(t)))
  }
  p.nest = nest + 1
  const v = frontOperand(p, t).orReturn()
  p.nest = nest
  return Ok(v)
}

function frontOperand(p: FrontProp, t: FrontTok): Result<FrontV, FrontRefusal> {
  const c = p.c
  if (frontEat(c, "!")) {
    const one = [frontUnary(p).orReturn()]
    return frontTyped(p, frontOp("not", one), one, "`!`", frontAt(t))
  }
  if (frontEat(c, "-")) {
    const n = frontPeek(c)
    if (n.kind !== FrontKind.Num) {
      return Err(frontRefuse("unary `-` applies only to integer literals; write 0 - x", frontAt(t)))
    }
    frontNext(c)
    return frontInt(`-${n.text}`, frontAt(t))
  }
  if (frontIsPunct(t, ["+", "~", "++", "--", "..."])) {
    return Err(frontRefuse(`\`${t.text}\` is not in the ts-property subset`, frontAt(t)))
  }
  return frontPostfix(p, frontPrimary(p).orReturn())
}

function frontPostfix(p: FrontProp, operand: FrontV): Result<FrontV, FrontRefusal> {
  const c = p.c
  let v = operand
  while (true) {
    const t = frontPeek(c)
    if (frontIsPunct(t, ["["])) {
      return Err(frontRefuse("indexing is not in the ts-property subset; use slice or charAt", frontAt(t)))
    }
    if (!frontEat(c, ".")) {
      return Ok(v)
    }
    const m = frontIdent(c, "a property name").orReturn()
    const name = `\`.${m.text}\``
    if (!frontIs(c, "(")) {
      if (m.text !== "length") {
        return Err(frontRefuse(`${name} is not in the ts-property subset`, frontAt(m)))
      }
      const one = [v]
      v = frontTyped(p, frontOp(v.t === "string" ? "strLen" : "len", one), one, name, v.pos).orReturn()
      continue
    }
    const method = frontMethodOf(m.text)
    if (method === null) {
      return Err(frontRefuse(`${name} is not in the ts-property subset`, frontAt(m)))
    }
    const op = method.op
    const n = method.arity
    const argsAt = frontPeek(c)
    const args = frontArgs(p).orReturn()
    if (args.length !== n) {
      return Err(frontRefuse(`${name} takes ${n} argument(s), got ${args.length}`, frontAt(argsAt)))
    }
    if (op === "slice") {
      for (const a of args) {
        const lit = a.e.lit
        if (frontIsLit(a, LitKind.Int) && lit !== null && frontHas(lit.text, 0, "-")) {
          return Err(
            frontRefuse(
              "a negative `.slice` index counts from the end in TypeScript and clamps to 0 in the contract",
              a.pos,
            ),
          )
        }
      }
    }
    // `.concat` is TypeScript's: string concat on a string, array concat on u8[].
    const real = op === "concat" && v.t === "string" ? "strConcat" : op
    const all = [v]
    for (const a of args) {
      all.push(a)
    }
    v = frontTyped(p, frontOp(real, all), all, name, v.pos).orReturn()
  }
}

/** `( expr, … )` */
function frontArgs(p: FrontProp): Result<FrontV[], FrontRefusal> {
  const c = p.c
  frontExpect(c, "(").orReturn()
  const args: FrontV[] = []
  while (!frontIs(c, ")")) {
    args.push(frontExpr(p).orReturn())
    if (!frontEat(c, ",")) {
      break
    }
  }
  frontExpect(c, ")").orReturn()
  return Ok(args)
}

function frontPrimary(p: FrontProp): Result<FrontV, FrontRefusal> {
  const c = p.c
  const t = frontNext(c)
  const pos = frontAt(t)
  if (t.kind === FrontKind.Num) {
    return frontInt(t.text, pos)
  }
  if (t.kind === FrontKind.Str) {
    if (!charsIsStringText(t.value)) {
      return Err(frontRefuse("a string literal holds only printable ASCII, tab, LF and CR", pos))
    }
    const v = new FrontV(frontLit(new Literal(LitKind.Str, t.value)), "string", pos)
    v.str = t.value
    return Ok(v)
  }
  if (t.kind === FrontKind.Bytes) {
    return Ok(new FrontV(frontLit(new Literal(LitKind.Hex, t.value)), "bytes", pos))
  }
  if (t.kind === FrontKind.Ident) {
    return frontName(p, t)
  }
  if (t.kind === FrontKind.Punct) {
    if (t.text === "(") {
      const v = frontExpr(p).orReturn()
      frontExpect(c, ")").orReturn()
      const w = new FrontV(v.e, v.t, pos)
      w.str = v.str
      w.depth = v.depth
      return Ok(w)
    }
    if (t.text === "[") {
      return Err(frontRefuse(FRONT_BYTES_MESSAGE, pos))
    }
    frontRefuseInfix(t).orReturn()
  }
  return Err(frontRefuse(`unexpected ${frontShown(t)}`, pos))
}

/** A variable, literal keyword or call. */
function frontName(p: FrontProp, t: FrontTok): Result<FrontV, FrontRefusal> {
  const pos = frontAt(t)
  if (t.text === "true" || t.text === "false") {
    const lit = new Literal(LitKind.Bool, "")
    lit.flag = t.text === "true"
    return Ok(new FrontV(frontLit(lit), "bool", pos))
  }
  if (t.text === "null") {
    return Ok(new FrontV(frontLit(new Literal(LitKind.Null, "")), "null", pos))
  }
  const ty = frontVar(p, t.text)
  if (!frontIs(p.c, "(")) {
    if (ty === null) {
      return Err(frontRefuse(`unknown identifier \`${t.text}\``, pos))
    }
    return Ok(new FrontV(new Expr(ExprKind.Var, t.text), ty, pos))
  }
  if (ty !== null) {
    return Err(frontRefuse(`\`${t.text}\` is not a function`, pos))
  }
  const sig = frontFn(p, t.text)
  if (sig !== null && vocabHas(frontCallOps(), sig.name)) {
    return Err(frontRefuse(`\`${sig.name}\` is both an interface function and a ts-property op`, pos))
  }
  if (sig !== null) {
    return frontCall(p, sig, pos)
  }
  if (!vocabHas(frontCallOps(), t.text)) {
    const form = vocabIsSecretOp(t.text) ? `: ${VOCAB_SECRET_FORM}` : ""
    return Err(frontRefuse(`unknown function \`${t.text}\`${form}`, pos))
  }
  const op = t.text
  const raw = frontArgs(p).orReturn()
  const bytesOp = vocabHas(frontBytesOps(), op) || vocabHas(vocabReadOps(), op)
  const args: FrontV[] = []
  for (let k = 0; k < raw.length; k++) {
    args.push(bytesOp || (op === "flipBit" && k === 0) ? frontAsBytes(raw[k]) : raw[k])
  }
  return frontTyped(p, frontOp(op, args), args, `\`${op}\``, pos)
}

function frontCall(p: FrontProp, sig: FnSig, pos: FrontPos): Result<FrontV, FrontRefusal> {
  if (p.inWhere) {
    return Err(
      frontRefuse(`\`where\` may not call \`${sig.name}\`: the domain must not depend on the implementation`, pos),
    )
  }
  const args = frontArgs(p).orReturn()
  if (args.length !== sig.params.length) {
    return Err(frontRefuse(`\`${sig.name}\` takes ${sig.params.length} argument(s), got ${args.length}`, pos))
  }
  const e = new Expr(ExprKind.Call, sig.name)
  // The lengths are equal, checked above: `k < sig.params.length` only tells the prover so.
  for (let k = 0; k < args.length && k < sig.params.length; k++) {
    const a = args[k]
    const want = vocabValueType(sig.params[k].type)
    if (!typeAssignable(a.t, want)) {
      return Err(frontRefuse(`\`${sig.name}\` expects ${frontTsTy(want)}, got ${frontTsTy(a.t)}`, a.pos))
    }
    e.args.push(a.e)
  }
  const v = new FrontV(e, vocabValueType(sig.returns), pos)
  v.depth = frontDepthOver(args, pos).orReturn()
  return Ok(v)
}

const frontPropertyIn = (p: FrontProp): Result<FrontProperty, FrontRefusal> => {
  const c = p.c
  const head = frontCoversLine(p).orReturn()
  const samples = frontSamplesLine(c).orReturn()
  frontExpect(c, "forall").orReturn()
  frontExpect(c, "(").orReturn()
  const clause = new Clause(ClauseKind.Property)
  clause.id = head.id
  clause.title = head.title
  clause.covers = head.covers
  clause.samples = samples
  while (!frontIs(c, ")")) {
    clause.forall.push(frontForallVar(p).orReturn())
    if (!frontEat(c, ",")) {
      break
    }
  }
  frontExpect(c, ")").orReturn()
  frontExpect(c, "=>").orReturn()
  const outer = p.vars.length
  const assert = frontBoolean(frontBody(p).orReturn(), "the property").orReturn()
  // `outer` is a length, never negative, so `p.vars.length > 0` only tells the prover so.
  while (p.vars.length > outer && p.vars.length > 0) {
    p.vars.pop()
  }
  clause.assert = assert.e
  if (frontEat(c, "where")) {
    p.inWhere = true
    clause.where = frontBoolean(frontExpr(p).orReturn(), "`where`").orReturn().e
  }
  frontEat(c, ";")
  const end = frontPeek(c)
  if (end.kind !== FrontKind.Eof) {
    return Err(frontRefuse(`unexpected ${frontShown(end)}`, frontAt(end)))
  }
  return Ok(new FrontProperty(head.id, head.title, head.covers, clause))
}

/**
 * Reads a ts-property block: a `// P-ID covers R-ID — title` first line,
 * optionally a `// samples: N` second line (the property's total, 1..256),
 * then `forall (x: T, …) => body` with a bounds comment after each type,
 * optionally `where cond`. The
 * body is an expression or a `{ const …; return … }` block; it is typed as it
 * is read, against the interface's functions.
 *
 * @param text the block, its lines joined with LF (CRLF and CR read the same)
 * @param fns the functions of the spec's ts-interface
 * @returns the property and its clause, or the refusal, positioned in the block
 */
export const frontParseProperty = (text: string, fns: FnSig[]): Result<FrontProperty, FrontRefusal[]> => {
  const toks = frontLex(text, "ts-property")
  if (toks.isErr()) {
    return Err([toks.error])
  }
  const r = frontPropertyIn(new FrontProp(new FrontCursor(toks.value, false), fns))
  if (r.isErr()) {
    return Err([r.error])
  }
  return Ok(r.value)
}
