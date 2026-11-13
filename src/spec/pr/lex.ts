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

/**
 * The reserved words after which an expression cannot have ended. A
 * contextual keyword (`type`, `from`, `as`, `async`, `of`, ...) is not one:
 * it may name a variable, so a `/` after it divides. After `.` or `?.` none
 * of them is a keyword: `o.default` is a member.
 *
 * @returns the words
 */
export const lexNoEnd = (): string[] => [
  "export",
  "default",
  "const",
  "let",
  "var",
  "function",
  "class",
  "enum",
  "interface",
  "new",
  "typeof",
  "extends",
  "implements",
  "in",
  "instanceof",
  "import",
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

/** The contextual keywords that go before a type and need it: `keyof T`. */
const lexTypePrefix = (): string[] => ["keyof", "unique", "readonly", "infer", "asserts"]

/**
 * The contextual keywords that go between two operands: `x as T`, `a from "m"`.
 *
 * @returns the words
 */
export const lexInfix = (): string[] => ["as", "satisfies", "is", "from", "of"]

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
 * Whether an expression can have ended at `t`, so that a `/` after it
 * divides. A contextual keyword can: it may be a variable's name.
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

/**
 * Whether token `i` is a member name: an identifier right after `.` or `?.`.
 * Any word there, a reserved one included (`o.default`), names a property,
 * so an expression can end at it.
 */
const lexMember = (tokens: LexToken[], i: i32): boolean =>
  i > 0 &&
  tokens[i].kind === LEX_IDENT &&
  tokens[i - 1].kind === LEX_PUNCT &&
  (tokens[i - 1].text === "." || tokens[i - 1].text === "?.")

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
      const n = s.text.charCodeAt(i + 1)
      const crlf = n === 0x0d && i + 2 < s.text.length && s.text.charCodeAt(i + 2) === 0x0a
      if (n === 0x0a || crlf) {
        s.line = s.line + 1
      }
      i = crlf ? i + 3 : i + 2
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
    if (c === 0x0a || (c === 0x5c && i + 1 < s.text.length && s.text.charCodeAt(i + 1) === 0x0a)) {
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
  // After a member name (`o.default`) or a `>` (a type's close, `as Y<Z> / 2`, or
  // a comparison) a `/` divides: Nish has no regular expression to start there.
  const last = lexLast(s)
  const angle = last !== null && last.kind === LEX_PUNCT && last.text === ">"
  if (c === 0x2f && !lexEnds(last) && !angle && !lexMember(s.tokens, toI32(s.tokens.length) - 1)) {
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
    return ["as", "satisfies", "is", "instanceof", "in", "extends", "implements"].indexOf(t.text) >= 0
  }
  return false
}

/** No type is being read at the top level. */
const LEX_VALUE: i32 = 0
/** A declaration's annotation, `x: T`: it ends at a top-level `=` or `,`. */
const LEX_ANNOTATION: i32 = 1
/** A return type or the type after `as`/`satisfies`: it also ends at `=>`, `{`, `?` and the logical operators. */
const LEX_INLINE: i32 = 2
/** A type alias, `type X<T> = U`: types to the statement's end. */
const LEX_ALIAS: i32 = 3

/** What the statement scanner knows of the current statement's top level. */
class LexTypes {
  /** LEX_VALUE, LEX_ANNOTATION, LEX_INLINE or LEX_ALIAS. */
  mode: i32
  /** The type-argument angles open in the current type. */
  angles: i32
  /** The `?` of conditionals still waiting for their `:`. */
  questions: i32

  constructor() {
    this.mode = LEX_VALUE
    this.angles = 0
    this.questions = 0
  }
}

/** Whether the token before `i` ends an expression, a type's closing `>` included. */
const lexEndsBefore = (tokens: LexToken[], closes: boolean[], i: i32): boolean =>
  i > 0 && (lexEnds(tokens[i - 1]) || closes[i - 1] || lexMember(tokens, i - 1))

/** Whether the contextual keyword at `i` is used between two operands (`x as T`), not as a name. */
const lexIsInfix = (tokens: LexToken[], closes: boolean[], i: i32): boolean => {
  const t = tokens[i]
  if (t.kind !== LEX_IDENT || lexInfix().indexOf(t.text) < 0) {
    return false
  }
  const b: LexToken | null = i > 0 ? tokens[i - 1] : null
  if (b !== null && b.kind === LEX_PUNCT && (b.text === "." || b.text === "?.")) {
    return false
  }
  if (lexEndsBefore(tokens, closes, i)) {
    return true
  }
  const kw: LexToken | null = i > 1 ? tokens[i - 2] : null
  return (
    b !== null &&
    b.kind === LEX_PUNCT &&
    b.text === "*" &&
    kw !== null &&
    kw.kind === LEX_IDENT &&
    (kw.text === "import" || kw.text === "export")
  )
}

/**
 * Whether the statement can end at the line break after token `i`: an
 * expression or a type ended there. A type-prefix keyword in a type (`keyof`) and a
 * contextual keyword used between operands (`x as`) cannot end one; used as
 * a name (`= from`), the keyword can.
 */
const lexEndsLine = (tokens: LexToken[], closes: boolean[], typed: boolean[], i: i32): boolean => {
  const t = tokens[i]
  if (closes[i] || lexMember(tokens, i)) {
    return true
  }
  if (t.kind === LEX_IDENT && typed[i] && lexTypePrefix().indexOf(t.text) >= 0) {
    return false
  }
  if (t.kind === LEX_IDENT && lexInfix().indexOf(t.text) >= 0) {
    return !lexIsInfix(tokens, closes, i)
  }
  return lexEnds(t)
}

/** Whether the top-level token at `i` starts a type alias: `type` then a name on its line, first in its statement but for `export` and `declare`. */
const lexStartsAlias = (tokens: LexToken[], from: i32, i: i32): boolean => {
  const t = tokens[i]
  if (t.kind !== LEX_IDENT || t.text !== "type" || i + 1 >= tokens.length) {
    return false
  }
  const n = tokens[i + 1]
  if (n.kind !== LEX_IDENT || n.newline || n.depth !== 0) {
    return false
  }
  for (let j = from; j < i; j++) {
    if (tokens[j].kind !== LEX_IDENT || (tokens[j].text !== "export" && tokens[j].text !== "declare")) {
      return false
    }
  }
  return true
}

/** Follows a top-level token `i` through the statement's types, marking a `>` that closes type arguments. */
const lexFollow = (tokens: LexToken[], closes: boolean[], from: i32, i: i32, ty: LexTypes): void => {
  const t = tokens[i]
  if (lexStartsAlias(tokens, from, i)) {
    ty.mode = LEX_ALIAS
    ty.angles = 0
    return
  }
  if (lexIsInfix(tokens, closes, i) && (t.text === "as" || t.text === "satisfies") && ty.mode !== LEX_ALIAS) {
    ty.mode = LEX_INLINE
    ty.angles = 0
    return
  }
  if (t.kind !== LEX_PUNCT) {
    return
  }
  const p = t.text
  if (ty.mode !== LEX_VALUE && p === "<") {
    ty.angles = ty.angles + 1
    return
  }
  if (ty.mode !== LEX_VALUE && p === ">" && ty.angles > 0) {
    ty.angles = ty.angles - 1
    closes[i] = true
    return
  }
  if (p === "?") {
    ty.questions = ty.questions + 1
  }
  if (p === ":" && ty.questions > 0) {
    ty.questions = ty.questions - 1
    if (ty.mode !== LEX_ALIAS && ty.angles === 0) {
      ty.mode = LEX_VALUE
    }
    return
  }
  if (p === ":" && ty.mode !== LEX_ALIAS && ty.angles === 0) {
    const b = tokens[i - 1]
    ty.mode = b.kind === LEX_PUNCT && b.text === ")" ? LEX_INLINE : LEX_ANNOTATION
    return
  }
  if (ty.mode === LEX_ALIAS || ty.angles > 0) {
    return
  }
  const ends = p === "=" || p === "," || p === ";"
  const inline = p === "=>" || p === "{" || p === "?" || p === "||" || p === "&&" || p === "??"
  if (ends || (ty.mode === LEX_INLINE && inline)) {
    ty.mode = LEX_VALUE
  }
}

/**
 * The top-level statements of a module's tokens. A statement ends at a
 * top-level `;` (which it keeps), before a top-level `export` (not a member,
 * `.export`), or at a line break where the token before can end an
 * expression or a type and the token after cannot go on with it, as automatic
 * semicolon insertion reads it. A `>` ends a type when it closes type
 * arguments opened in a type position: an annotation (`x: T`), a return
 * type, the type after `as` or `satisfies`, or a type alias. A contextual
 * keyword used as a name (`= from`) ends an expression; used between operands
 * (`x as`) or before a type (`keyof`), it does not. Where a line starts means
 * nothing, and a line may hold several statements.
 *
 * @param tokens the module's tokens (lexTokens)
 * @returns the statements, in order
 */
export const lexStatements = (tokens: LexToken[]): LexSpan[] => {
  const out: LexSpan[] = []
  const closes: boolean[] = []
  const typed: boolean[] = []
  for (let i = 0; i < tokens.length; i++) {
    closes.push(false)
    typed.push(false)
  }
  let ty = new LexTypes()
  let from: i32 = 0
  for (let i: i32 = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.depth !== 0) {
      continue
    }
    if (i === from) {
      if (t.text === ";" && t.kind === LEX_PUNCT) {
        from = i + 1
        continue
      }
      lexFollow(tokens, closes, from, i, ty)
      typed[i] = ty.mode !== LEX_VALUE
      continue
    }
    const prev = tokens[i - 1]
    const member = prev.kind === LEX_PUNCT && (prev.text === "." || prev.text === "?.")
    const isExport = t.kind === LEX_IDENT && t.text === "export" && !member
    const asi = t.newline && lexEndsLine(tokens, closes, typed, i - 1) && !lexContinues(t)
    if (isExport || asi) {
      out.push(new LexSpan(from, i))
      from = i
      ty = new LexTypes()
    }
    lexFollow(tokens, closes, from, i, ty)
    typed[i] = ty.mode !== LEX_VALUE
    if (t.kind === LEX_PUNCT && t.text === ";") {
      out.push(new LexSpan(from, i + 1))
      from = i + 1
      ty = new LexTypes()
    }
  }
  if (from < tokens.length) {
    out.push(new LexSpan(from, toI32(tokens.length)))
  }
  return out
}
