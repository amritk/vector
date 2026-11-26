/**
 * `core/smt` — reading what z3 prints: s-expressions, the numerals in a model,
 * and a whole run's output split into one answer per query by the
 * `(echo "@@Q<i>")` markers the script writes before each `(check-sat)`.
 */

import { indexOfAny, trim } from "nish/text"

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

// Splits SMT-LIB2 text into `(`, `)` and atoms. A string literal ("…", with
// `""` for a quote inside it) and a quoted symbol (|…|) are each one atom,
// delimiters kept, so a paren inside either does not count. A `;` comment runs
// to the end of the line and is dropped. An unclosed string or quoted symbol
// runs to the end of the text.
const smtTokens = (text: string): string[] => {
  const out: string[] = []
  const n = toI32(text.length)
  let i = 0
  // i only grows from 0, so `i >= 0` never stops the loop; it lets the read be proven.
  while (i >= 0 && i < n) {
    const c = text.charCodeAt(i)
    if (smtIsSpace(c)) {
      i = i + 1
    } else if (c === 59) {
      while (i < n && text.charCodeAt(i) !== 10) {
        i = i + 1
      }
    } else if (c === 40 || c === 41) {
      out.push(text.slice(i, i + 1))
      i = i + 1
    } else if (c === 34) {
      const start = i
      i = i + 1
      while (i < n) {
        if (text.charCodeAt(i) === 34) {
          if (i + 1 < n && text.charCodeAt(i + 1) === 34) {
            i = i + 2
            continue
          }
          i = i + 1
          break
        }
        i = i + 1
      }
      // start <= i <= n, so substring cuts what slice did.
      out.push(text.substring(start, i))
    } else if (c === 124) {
      const start = i
      i = i + 1
      while (i < n && text.charCodeAt(i) !== 124) {
        i = i + 1
      }
      i = i < n ? i + 1 : n
      out.push(text.substring(start, i))
    } else {
      const start = i
      while (i < n) {
        const d = text.charCodeAt(i)
        if (smtIsSpace(d) || d === 40 || d === 41 || d === 34 || d === 124 || d === 59) break
        i = i + 1
      }
      out.push(text.substring(start, i))
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

  // Whether the next token exists and is not `)`. pos only grows from 0.
  more(): boolean {
    const pos = this.pos
    return pos >= 0 && pos < toI32(this.tokens.length) && this.tokens[pos] !== ")"
  }

  read(): Sexp | null {
    const pos = this.pos
    if (pos < 0 || pos >= toI32(this.tokens.length)) {
      return null
    }
    const tok = this.tokens[pos]
    this.pos = pos + 1
    if (tok === ")") {
      return null
    }
    if (tok !== "(") {
      return new Sexp(tok, false, [])
    }
    const items: Sexp[] = []
    while (this.more()) {
      const child = this.read()
      if (child === null) {
        return null
      }
      items.push(child)
    }
    const end = this.pos
    if (end < 0 || end >= toI32(this.tokens.length)) {
      return null
    }
    this.pos = end + 1
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
  const v = trim(value)
  const dot = toI32(v.indexOf("."))
  if (dot <= 0) {
    return v
  }
  // dot > 0, so v has a first character; the length test lets the read be proven.
  const len = toI32(v.length)
  let i = v.length > 0 && v.charCodeAt(0) === 45 ? 1 : 0
  if (i === dot) {
    return v
  }
  // 0 <= i and dot < len, so the extra tests never stop the loop.
  while (i >= 0 && i < dot && i < len) {
    const c = v.charCodeAt(i)
    if (c < 48 || c > 57) {
      return v
    }
    i = i + 1
  }
  // dot < len, so this is `dot + 1 === len`: nothing after the dot.
  if (dot >= len - 1) {
    return v
  }
  let j = dot + 1
  while (j < len) {
    if (v.charCodeAt(j) !== 48) {
      return v
    }
    j = j + 1
  }
  return v.substring(0, dot)
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
    const num = v.items[1]
    const den = v.items[2]
    return `${renderSexp(num)}/${renderSexp(den)}`
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
    // parseModel pushes a value with each name, so i < values.length whenever i >= 0.
    return i < 0 || i >= toI32(this.values.length) ? null : this.values[i]
  }
}

/**
 * Reads a `get-value` answer, `((x 0.0) (y (/ 1 2)))`, into `answer`'s model.
 * Only names in `[A-Za-z_][A-Za-z0-9_]*` are read: any other pair, such as a
 * `|quoted name|`, is skipped without a word, so a caller must mangle its
 * variable names into that alphabet.
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
  // u32, so the count cannot overflow; it is at most sexp.items.length.
  let count: u32 = 0
  for (const pair of sexp.items) {
    if (pair.isList && pair.items.length === 2 && !pair.items[0].isList) {
      const name = pair.items[0]
      const value = pair.items[1]
      if (smtIsIdentifier(name.atom)) {
        answer.names.push(name.atom)
        answer.values.push(renderSexp(value))
        count = count + 1
      }
    }
  }
  return toI32(count)
}

// The next `@@Q` at the start of a line, so that text inside a model value or
// an error message is never read as a marker.
const smtMarker = (stdout: string, from: i32): i32 => {
  const n = toI32(stdout.length)
  for (let at = indexOfAny(stdout, "@", from); at >= 0 && at < n - 2; at = indexOfAny(stdout, "@", at + 1)) {
    const lineStart = at === 0 || stdout.charCodeAt(at - 1) === 10
    if (lineStart && stdout.charCodeAt(at + 1) === 64 && stdout.charCodeAt(at + 2) === 81) {
      return at
    }
  }
  return -1
}

/**
 * Every line of z3's output that starts with `(error`, in order. z3 prints
 * one for each command it rejects and carries on, so an assertion it dropped
 * (an undeclared symbol, say) shows up only here: the line lands in the
 * previous query's output, or before the first marker, and no verdict reflects it.
 *
 * @param stdout everything z3 printed
 * @returns the error lines, without their newlines
 */
export const smtErrors = (stdout: string): string[] => {
  const out: string[] = []
  const n = toI32(stdout.length)
  let start = 0
  while (start < n) {
    const nl = indexOfAny(stdout, "\n", start)
    // indexOfAny answers -1 or start <= nl < n, so `nl > n` never holds and
    // substring cuts what slice did.
    const end = nl < 0 || nl > n ? n : nl
    const line = stdout.substring(start, end)
    if (line.startsWith("(error")) {
      out.push(line)
    }
    if (end >= n) {
      break
    }
    start = end + 1
  }
  return out
}

/** The answer one query's output gives: its verdict line, and the model after a `sat`. */
const smtAnswer = (body: string): QueryAnswer => {
  const nl = toI32(body.indexOf("\n"))
  const head = normalizeValue(nl < 0 ? body : body.substring(0, nl))
  const result = head === "sat" || head === "unsat" ? head : "unknown"
  const answer = new QueryAnswer(result)
  // indexOf answers -1 or nl < body.length, so the length test never fails.
  if (result === "sat" && nl >= 0 && nl < toI32(body.length)) {
    parseModel(answer, body.substring(nl + 1))
  }
  return answer
}

/**
 * Splits z3's output into one answer per query, by the `@@Q<i>` markers, each
 * at the start of a line. A
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
  const n = toI32(stdout.length)
  let at = smtMarker(stdout, 0)
  // smtMarker answers -1 or an `at` with at + 2 < n, so `at < n - 2` never stops the loop.
  while (at >= 0 && at < n - 2) {
    let digitsEnd = at + 3
    while (digitsEnd < n && stdout.charCodeAt(digitsEnd) >= 48 && stdout.charCodeAt(digitsEnd) <= 57) {
      digitsEnd = digitsEnd + 1
    }
    const lineEnd = indexOfAny(stdout, "\n", at)
    // indexOfAny answers -1 or at <= lineEnd < n, so `lineEnd >= n` never holds.
    if (lineEnd < 0 || lineEnd >= n) {
      return answers
    }
    const bodyStart = lineEnd + 1
    const next = smtMarker(stdout, bodyStart)
    // next is -1 or at least bodyStart, so substring cuts what slice did.
    const body = stdout.substring(bodyStart, next < 0 ? n : next)
    if (digitsEnd > at + 3) {
      const qid = parseInt(stdout.substring(at + 3, digitsEnd))
      if (qid < queryCount) {
        const answer = smtAnswer(body)
        // answers holds queryCount entries and qid is a digit run, so this
        // test never fails.
        if (qid >= 0 && qid < toI32(answers.length)) {
          answers[qid] = answer
        }
      }
    }
    at = next
  }
  return answers
}
