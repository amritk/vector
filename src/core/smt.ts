/**
 * `core/smt` — reading what z3 prints: s-expressions, the numerals in a model,
 * and a whole run's output split into one answer per query by the
 * `(echo "@@Q<i>")` markers the script writes before each `(check-sat)`.
 */

/** One s-expression: an atom, or a list of s-expressions. */
export class Sexp {
  /** The atom's text; empty for a list. */
  atom: string
  /** Whether this is a list rather than an atom. */
  isList: boolean
  /** The list's items; empty for an atom. */
  items: Sexp[]

  /**
   * Makes an s-expression; `sexpAtom` and `sexpList` are the usual way.
   *
   * @param atom the atom's text, or "" for a list
   * @param isList whether this is a list
   * @param items the list's items
   */
  constructor(atom: string, isList: boolean, items: Sexp[]) {
    this.atom = atom
    this.isList = isList
    this.items = items
  }
}

const smtIsSpace = (c: i32): boolean => c === 32 || c === 9 || c === 10 || c === 13

const smtTokens = (text: string): string[] => {
  const out: string[] = []
  const n = toI32(text.length)
  let i = 0
  while (i < n) {
    const c = text.charCodeAt(i)
    if (smtIsSpace(c)) {
      i = i + 1
    } else if (c === 40 || c === 41) {
      out.push(text.slice(i, i + 1))
      i = i + 1
    } else {
      const start = i
      while (i < n && !smtIsSpace(text.charCodeAt(i)) && text.charCodeAt(i) !== 40 && text.charCodeAt(i) !== 41) {
        i = i + 1
      }
      out.push(text.slice(start, i))
    }
  }
  return out
}

class SmtReader {
  tokens: string[]
  pos: i32

  constructor(tokens: string[]) {
    this.tokens = tokens
    this.pos = 0
  }

  read(): Sexp | null {
    if (this.pos >= toI32(this.tokens.length)) {
      return null
    }
    const tok = this.tokens[this.pos]
    this.pos = this.pos + 1
    if (tok === ")") {
      return null
    }
    if (tok !== "(") {
      return new Sexp(tok, false, [])
    }
    const items: Sexp[] = []
    while (this.pos < toI32(this.tokens.length) && this.tokens[this.pos] !== ")") {
      const child = this.read()
      if (child === null) {
        return null
      }
      items.push(child)
    }
    if (this.pos >= toI32(this.tokens.length)) {
      return null
    }
    this.pos = this.pos + 1
    return new Sexp("", true, items)
  }
}

/**
 * Parses the first complete s-expression in `text`.
 *
 * @param text z3 output, such as a `get-value` answer
 * @returns the s-expression, or null when the text is empty, truncated or unbalanced
 */
export const parseSexp = (text: string): Sexp | null => new SmtReader(smtTokens(text)).read()

/**
 * Canonicalizes an atomic numeral: `3.0` becomes `3`; anything else is returned trimmed.
 *
 * @param value one atom of z3 output
 * @returns the canonical text
 */
export const normalizeValue = (value: string): string => {
  let start = 0
  let end = toI32(value.length)
  while (start < end && smtIsSpace(value.charCodeAt(start))) {
    start = start + 1
  }
  while (end > start && smtIsSpace(value.charCodeAt(end - 1))) {
    end = end - 1
  }
  const v = value.slice(start, end)
  const dot = toI32(v.indexOf("."))
  if (dot <= 0) {
    return v
  }
  let i = v.charCodeAt(0) === 45 ? 1 : 0
  if (i === dot) {
    return v
  }
  while (i < dot) {
    const c = v.charCodeAt(i)
    if (c < 48 || c > 57) {
      return v
    }
    i = i + 1
  }
  let j = dot + 1
  if (j === toI32(v.length)) {
    return v
  }
  while (j < toI32(v.length)) {
    if (v.charCodeAt(j) !== 48) {
      return v
    }
    j = j + 1
  }
  return v.slice(0, dot)
}

/**
 * Renders a model value the way vector shows it: `(- x)` as `-x`, `(/ a b)`
 * as `a/b`, integral reals without `.0`, and anything else (a `root-obj`) as
 * its text.
 *
 * @param v a value from a `get-value` answer
 * @returns the rendered value
 */
export const renderSexp = (v: Sexp): string => {
  if (!v.isList) {
    return normalizeValue(v.atom)
  }
  if (v.items.length === 2 && !v.items[0].isList && v.items[0].atom === "-") {
    return `-${renderSexp(v.items[1])}`
  }
  if (v.items.length === 3 && !v.items[0].isList && v.items[0].atom === "/") {
    return `${renderSexp(v.items[1])}/${renderSexp(v.items[2])}`
  }
  const parts: string[] = []
  for (const item of v.items) {
    parts.push(renderSexp(item))
  }
  return `(${parts.join(" ")})`
}

const smtIsIdentifier = (s: string): boolean => {
  if (s.length === 0) {
    return false
  }
  for (let i = 0; i < toI32(s.length); i++) {
    const c = s.charCodeAt(i)
    const letter = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95
    if (!letter && !(i > 0 && c >= 48 && c <= 57)) {
      return false
    }
  }
  return true
}

/** z3's verdict on one query, and the model when it is `sat`. */
export class QueryAnswer {
  /** `sat`, `unsat` or `unknown`. */
  result: string
  /** The model's variable names, in the order z3 printed them. */
  names: string[]
  /** The rendered value of each name, at the same index. */
  values: string[]

  /**
   * Makes an answer with an empty model.
   *
   * @param result `sat`, `unsat` or `unknown`
   */
  constructor(result: string) {
    this.result = result
    this.names = []
    this.values = []
  }

  /**
   * The model's value for a variable.
   *
   * @param name the variable
   * @returns its rendered value, or null when the model does not name it
   */
  value(name: string): string | null {
    const i = toI32(this.names.indexOf(name))
    return i < 0 ? null : this.values[i]
  }
}

/**
 * Reads a `get-value` answer, `((x 0.0) (y (/ 1 2)))`, into `answer`'s model.
 *
 * @param answer the answer to fill
 * @param text the text after the verdict line
 * @returns how many variables were read
 */
export const parseModel = (answer: QueryAnswer, text: string): i32 => {
  const sexp = parseSexp(text)
  if (sexp === null || !sexp.isList) {
    return 0
  }
  let count = 0
  for (const pair of sexp.items) {
    if (pair.isList && pair.items.length === 2 && !pair.items[0].isList && smtIsIdentifier(pair.items[0].atom)) {
      answer.names.push(pair.items[0].atom)
      answer.values.push(renderSexp(pair.items[1]))
      count = count + 1
    }
  }
  return count
}

const smtMarker = (stdout: string, from: i32): i32 => {
  const rest = stdout.slice(from)
  const at = toI32(rest.indexOf("@@Q"))
  return at < 0 ? -1 : from + at
}

/**
 * Splits z3's output into one answer per query, by the `@@Q<i>` markers. A
 * query with no marker, or no verdict after it, is `unknown`; a marker naming
 * no query is skipped.
 *
 * @param stdout everything z3 printed
 * @param queryCount how many queries the script asked
 * @returns `queryCount` answers, in query order
 */
export const parseZ3Output = (stdout: string, queryCount: i32): QueryAnswer[] => {
  const answers: QueryAnswer[] = []
  for (let i = 0; i < queryCount; i++) {
    answers.push(new QueryAnswer("unknown"))
  }
  let at = smtMarker(stdout, 0)
  while (at >= 0) {
    let digitsEnd = at + 3
    while (
      digitsEnd < toI32(stdout.length) &&
      stdout.charCodeAt(digitsEnd) >= 48 &&
      stdout.charCodeAt(digitsEnd) <= 57
    ) {
      digitsEnd = digitsEnd + 1
    }
    const lineEnd = toI32(stdout.slice(at).indexOf("\n"))
    if (lineEnd < 0) {
      return answers
    }
    const bodyStart = at + lineEnd + 1
    const next = smtMarker(stdout, bodyStart)
    const body = stdout.slice(bodyStart, next < 0 ? toI32(stdout.length) : next)
    if (digitsEnd > at + 3) {
      const qid = parseInt(stdout.slice(at + 3, digitsEnd))
      if (qid < queryCount) {
        const nl = toI32(body.indexOf("\n"))
        const head = normalizeValue(nl < 0 ? body : body.slice(0, nl))
        const result = head === "sat" || head === "unsat" ? head : "unknown"
        const answer = new QueryAnswer(result)
        if (result === "sat" && nl >= 0) {
          parseModel(answer, body.slice(nl + 1))
        }
        answers[qid] = answer
      }
    }
    at = next
  }
  return answers
}
