/**
 * `spec/pr/lex` — a TypeScript module's tokens and top-level statements, as
 * far as the export scanner needs them. Strings, template literals (with
 * `${}` nested to any depth) and comments are read whole, so a comma or a
 * bracket inside one is never code, and every token knows its bracket depth.
 * It fails closed: an unclosed string, comment or bracket, a closer that does
 * not match, or a regular expression literal (which Nish does not have) is an
 * `Err` naming the line, never a guess.
 */

/** A token kind: an identifier or keyword. */
export const LEX_IDENT: i32 = 0
/** A token kind: a number. */
export const LEX_NUMBER: i32 = 1
/** A token kind: a quoted string. */
export const LEX_STRING: i32 = 2
/** A token kind: a run of template text, from a backtick or a `}` to a backtick or a `${`. */
export const LEX_TEMPLATE: i32 = 3
/** A token kind: punctuation or an operator. */
export const LEX_PUNCT: i32 = 4

/** One token of a module. */
export class LexToken {
  /** LEX_IDENT, LEX_NUMBER, LEX_STRING, LEX_TEMPLATE or LEX_PUNCT. */
  kind: i32
  /** Its text, as written. */
  text: string
  /** The index of its first character. */
  start: i32
  /** The index after its last character. */
  end: i32
  /** The 1-based line it starts on. */
  line: i32
  /** The brackets around it; an opener or a closer counts those outside it. */
  depth: i32
  /** Whether a line break (or a comment holding one) comes between it and the token before. */
  newline: boolean

  /**
   * Makes a token.
   *
   * @param kind its kind
   * @param text its text
   * @param start where it starts
   * @param end where it ends
   * @param line its line
   * @param depth its bracket depth
   * @param newline whether a line break comes before it
   */
  constructor(kind: i32, text: string, start: i32, end: i32, line: i32, depth: i32, newline: boolean) {
    this.kind = kind
    this.text = text
    this.start = start
    this.end = end
    this.line = line
    this.depth = depth
    this.newline = newline
  }
}

/** The tokens `[from, to)` of a token list: one top-level statement. */
export class LexSpan {
  /** The index of its first token. */
  from: i32
  /** The index after its last token. */
  to: i32

  /**
   * Makes a span.
   *
   * @param from its first token
   * @param to the index after its last token
   */
  constructor(from: i32, to: i32) {
    this.from = from
    this.to = to
  }
}

/** Where the lexer is: the text, the tokens so far, the open brackets. */
class LexState {
  text: string
  pos: i32
  line: i32
  newline: boolean
  tokens: LexToken[]
  /** The open brackets, `(`, `[`, `{`, or `$` for a template's `${`. */
  stack: string[]
  /** The line each open bracket opened on. */
  stackLines: i32[]

  constructor(text: string) {
    this.text = text
    this.pos = 0
    this.line = 1
    this.newline = false
    this.tokens = []
    this.stack = []
    this.stackLines = []
  }
}

/** Whether `c` can start an identifier: a letter, `_`, `$`, `#`, or any non-ASCII byte. */
const lexIdentStart = (c: i32): boolean =>
  (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x5f || c === 0x24 || c === 0x23 || c >= 0x80

/** Whether `c` can be part of an identifier. */
const lexIdentChar = (c: i32): boolean => lexIdentStart(c) || (c >= 0x30 && c <= 0x39)

/** Whether `c` is a decimal digit. */
const lexDigit = (c: i32): boolean => c >= 0x30 && c <= 0x39

/** The keywords after which an expression cannot have ended. */
const lexNoEnd = (): string[] => [
  "export",
  "default",
  "const",
  "let",
  "var",
  "function",
  "class",
  "enum",
  "type",
  "interface",
  "namespace",
  "module",
  "declare",
  "abstract",
  "async",
  "new",
  "typeof",
  "keyof",
  "extends",
  "implements",
  "as",
  "satisfies",
  "in",
  "instanceof",
  "import",
  "from",
  "return",
  "throw",
  "case",
  "else",
  "do",
  "void",
  "delete",
  "await",
  "yield",
]

/** The punctuation of more than one character, longest first. */
const lexLongPunct = (): string[] => [
  "...",
  "===",
  "!==",
  "**=",
  "&&=",
  "||=",
  "??=",
  "=>",
  "==",
  "!=",
  "?.",
  "&&",
  "||",
  "??",
  "++",
  "--",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "&=",
  "|=",
  "^=",
  "**",
]

/**
 * Whether an expression can have ended at `t`, so that a `/` after it divides
 * and a line break after it may end the statement.
 *
 * @param t the token, or null at the start
 * @returns whether it can end an expression
 */
export const lexEnds = (t: LexToken | null): boolean => {
  if (t === null) {
    return false
  }
  if (t.kind === LEX_IDENT) {
    return lexNoEnd().indexOf(t.text) < 0
  }
  if (t.kind === LEX_NUMBER || t.kind === LEX_STRING) {
    return true
  }
  if (t.kind === LEX_TEMPLATE) {
    return t.text.endsWith("`")
  }
  return t.text === ")" || t.text === "]" || t.text === "}" || t.text === "++" || t.text === "--"
}

/** The last token so far, or null. */
const lexLast = (s: LexState): LexToken | null => (s.tokens.length > 0 ? s.tokens[s.tokens.length - 1] : null)

/** Adds a token from `start` to the current position. */
const lexPush = (s: LexState, kind: i32, start: i32, line: i32, depth: i32): void => {
  s.tokens.push(new LexToken(kind, s.text.substring(start, s.pos), start, s.pos, line, depth, s.newline))
  s.newline = false
}

/** Skips a quoted string opened at the current position; `Err` when it never closes on its line. */
const lexString = (s: LexState): Result<i32, string> => {
  const q = s.text.charCodeAt(s.pos)
  const line = s.line
  let i = s.pos + 1
  while (i < s.text.length) {
    const c = s.text.charCodeAt(i)
    if (c === q) {
      s.pos = i + 1
      return Ok(0)
    }
    if (c === 0x0a) {
      break
    }
    if (c === 0x5c && i + 1 < s.text.length) {
      if (s.text.charCodeAt(i + 1) === 0x0a) {
        s.line = s.line + 1
      }
      i = i + 2
    } else {
      i = i + 1
    }
  }
  return Err(`line ${line}: a string that never closes`)
}

/**
 * Reads template text from the current position (just after a backtick or
 * the `}` closing a `${`) up to and including its closing backtick or `${`.
 * A `${` pushes `$` onto the bracket stack.
 */
const lexTemplate = (s: LexState, start: i32, line: i32): Result<i32, string> => {
  let i = s.pos
  while (i < s.text.length) {
    const c = s.text.charCodeAt(i)
    if (c === 0x60) {
      s.pos = i + 1
      lexPush(s, LEX_TEMPLATE, start, line, s.stack.length)
      return Ok(0)
    }
    if (c === 0x24 && i + 1 < s.text.length && s.text.charCodeAt(i + 1) === 0x7b) {
      s.pos = i + 2
      lexPush(s, LEX_TEMPLATE, start, line, s.stack.length)
      s.stack.push("$")
      s.stackLines.push(s.line)
      return Ok(0)
    }
    if (c === 0x0a) {
      s.line = s.line + 1
    }
    i = c === 0x5c ? i + 2 : i + 1
  }
  return Err(`line ${line}: a template literal that never closes`)
}

/** Handles a closing bracket at the current position. */
const lexClose = (s: LexState, c: i32): Result<i32, string> => {
  const want = c === 0x29 ? "(" : c === 0x5d ? "[" : "{"
  const ch = s.text.substring(s.pos, s.pos + 1)
  if (s.stack.length === 0) {
    return Err(`line ${s.line}: a \`${ch}\` that closes nothing`)
  }
  const top = s.stack[s.stack.length - 1]
  if (top === "$" && c === 0x7d) {
    s.stack.pop()
    s.stackLines.pop()
    const start = s.pos
    s.pos = s.pos + 1
    return lexTemplate(s, start, s.line)
  }
  if (top !== want) {
    const opened = s.stackLines[s.stackLines.length - 1]
    const was = top === "$" ? "${" : top
    return Err(`line ${s.line}: a \`${ch}\` that does not close the \`${was}\` opened on line ${opened}`)
  }
  s.stack.pop()
  s.stackLines.pop()
  const start = s.pos
  s.pos = s.pos + 1
  lexPush(s, LEX_PUNCT, start, s.line, s.stack.length)
  return Ok(0)
}

/** Reads one token, or the space or comment before one, at the current position. */
const lexStep = (s: LexState): Result<i32, string> => {
  const text = s.text
  const c = text.charCodeAt(s.pos)
  const n = s.pos + 1 < text.length ? text.charCodeAt(s.pos + 1) : -1
  const start = s.pos
  const line = s.line
  const depth = s.stack.length
  if (c === 0x0a) {
    s.line = s.line + 1
    s.newline = true
    s.pos = s.pos + 1
    return Ok(0)
  }
  if (c === 0x20 || c === 0x09 || c === 0x0d || c === 0x0c || c === 0x0b) {
    s.pos = s.pos + 1
    return Ok(0)
  }
  if (c === 0x2f && n === 0x2f) {
    const nl = text.indexOf("\n", s.pos)
    s.pos = nl < 0 ? toI32(text.length) : toI32(nl)
    return Ok(0)
  }
  if (c === 0x2f && n === 0x2a) {
    const close = text.indexOf("*/", s.pos + 2)
    if (close < 0) {
      return Err(`line ${line}: a comment that never closes`)
    }
    for (let i = s.pos; i < close; i++) {
      if (text.charCodeAt(i) === 0x0a) {
        s.line = s.line + 1
        s.newline = true
      }
    }
    s.pos = toI32(close) + 2
    return Ok(0)
  }
  if (c === 0x22 || c === 0x27) {
    lexString(s).orReturn()
    lexPush(s, LEX_STRING, start, line, depth)
    return Ok(0)
  }
  if (c === 0x60) {
    s.pos = s.pos + 1
    return lexTemplate(s, start, line)
  }
  if (lexIdentStart(c)) {
    let i = s.pos + 1
    while (i < text.length && lexIdentChar(text.charCodeAt(i))) {
      i = i + 1
    }
    s.pos = i
    lexPush(s, LEX_IDENT, start, line, depth)
    return Ok(0)
  }
  if (lexDigit(c) || (c === 0x2e && lexDigit(n))) {
    let i = s.pos + 1
    while (i < text.length) {
      const d = text.charCodeAt(i)
      const p = text.charCodeAt(i - 1)
      const exp = (d === 0x2b || d === 0x2d) && (p === 0x65 || p === 0x45) && text.substring(start, start + 2) !== "0x"
      if (!(lexIdentChar(d) || d === 0x2e || exp)) {
        break
      }
      i = i + 1
    }
    s.pos = i
    lexPush(s, LEX_NUMBER, start, line, depth)
    return Ok(0)
  }
  if (c === 0x28 || c === 0x5b || c === 0x7b) {
    s.pos = s.pos + 1
    lexPush(s, LEX_PUNCT, start, line, depth)
    s.stack.push(text.substring(start, start + 1))
    s.stackLines.push(line)
    return Ok(0)
  }
  if (c === 0x29 || c === 0x5d || c === 0x7d) {
    return lexClose(s, c)
  }
  if (c === 0x2f && !lexEnds(lexLast(s))) {
    return Err(`line ${line}: a regular expression literal, which Nish does not have`)
  }
  if (c === 0x5c) {
    return Err(`line ${line}: a stray backslash`)
  }
  let len = 1
  if (c !== 0x3c && c !== 0x3e) {
    for (const p of lexLongPunct()) {
      if (text.substring(s.pos, s.pos + toI32(p.length)) === p) {
        len = toI32(p.length)
        break
      }
    }
  }
  s.pos = s.pos + len
  lexPush(s, LEX_PUNCT, start, line, depth)
  return Ok(0)
}

/**
 * The tokens of a TypeScript module. `<` and `>` are always tokens of their
 * own, so `>>` closes two type arguments and `<<` is two operators.
 *
 * @param text the module's source
 * @returns its tokens, or `Err` naming the line it cannot read
 */
export const lexTokens = (text: string): Result<LexToken[], string> => {
  const s = new LexState(text)
  while (s.pos < text.length) {
    lexStep(s).orReturn()
  }
  if (s.stack.length > 0) {
    const top = s.stack[s.stack.length - 1]
    const was = top === "$" ? "${" : top
    return Err(`line ${s.stackLines[s.stackLines.length - 1]}: a \`${was}\` that never closes`)
  }
  return Ok(s.tokens)
}

/** Whether a token on a new line goes on with the statement before it rather than starting one. */
const lexContinues = (t: LexToken): boolean => {
  if (t.kind === LEX_PUNCT) {
    return t.text !== "!" && t.text !== "~" && t.text !== "++" && t.text !== "--" && t.text !== "@"
  }
  if (t.kind === LEX_TEMPLATE) {
    return true
  }
  if (t.kind === LEX_IDENT) {
    return ["as", "satisfies", "instanceof", "in", "extends", "implements"].indexOf(t.text) >= 0
  }
  return false
}

/**
 * The top-level statements of a module's tokens. A statement ends at a
 * top-level `;` (which it keeps), before a top-level `export` (not a member,
 * `.export`), or at a line break where the token before can end an
 * expression and the token after cannot go on with it, as automatic
 * semicolon insertion reads it. Where a line starts means nothing, and a line
 * may hold several statements.
 *
 * @param tokens the module's tokens (lexTokens)
 * @returns the statements, in order
 */
export const lexStatements = (tokens: LexToken[]): LexSpan[] => {
  const out: LexSpan[] = []
  let from: i32 = 0
  for (let i: i32 = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.depth !== 0 || i === from) {
      if (i === from && t.depth === 0 && t.text === ";" && t.kind === LEX_PUNCT) {
        from = i + 1
      }
      continue
    }
    const prev = tokens[i - 1]
    const member = prev.kind === LEX_PUNCT && (prev.text === "." || prev.text === "?.")
    const isExport = t.kind === LEX_IDENT && t.text === "export" && !member
    const asi = t.newline && lexEnds(prev) && !lexContinues(t)
    if (isExport || asi) {
      out.push(new LexSpan(from, i))
      from = i
    }
    if (t.kind === LEX_PUNCT && t.text === ";") {
      out.push(new LexSpan(from, i + 1))
      from = i + 1
    }
  }
  if (from < tokens.length) {
    out.push(new LexSpan(from, toI32(tokens.length)))
  }
  return out
}
