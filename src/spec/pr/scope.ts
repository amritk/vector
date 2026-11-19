/**
 * `spec/pr/scope` — the code a contract tests: the module's top-level
 * declarations its functions reach. A declaration is reached when it declares
 * one of the contract's functions, or when a reached declaration names it as
 * an identifier (a call, a const, a class or a type), transitively. The
 * mutate gate mutates only changed lines inside a reached declaration. A
 * module the scanner cannot split into named declarations is mutated whole,
 * and `whole` says why, so the gate never silently mutates fewer lines.
 */

import { LEX_IDENT, LEX_PUNCT, LexSpan, LexToken, lexStatements, lexTokens } from "./lex"

/** One top-level declaration: the names it declares and the lines it spans. */
export class ScopeDecl {
  /** The names it declares; empty for top-level code, which runs at load. */
  names: string[]
  /** Its first line, 1-based. */
  first: i32
  /** Its last line, 1-based. */
  last: i32
  /** Its first token. */
  from: i32
  /** The index after its last token. */
  to: i32
  /** Whether the contract's functions reach it. */
  reached: boolean

  /**
   * Makes a declaration, not yet reached.
   *
   * @param names the names it declares
   * @param first its first line
   * @param last its last line
   * @param from its first token
   * @param to the index after its last token
   */
  constructor(names: string[], first: i32, last: i32, from: i32, to: i32) {
    this.names = names
    this.first = first
    this.last = last
    this.from = from
    this.to = to
    this.reached = false
  }
}

/** A module split into its top-level declarations, each marked reached or not. */
export class ScopeModule {
  /** The declarations, in the module's order. */
  decls: ScopeDecl[]
  /** Why every line counts as reached, or "" when the split holds. */
  whole: string

  /**
   * Makes a module's scope.
   *
   * @param decls its declarations
   * @param whole why every line counts as reached, or ""
   */
  constructor(decls: ScopeDecl[], whole: string) {
    this.decls = decls
    this.whole = whole
  }
}

/** The text of token `i` when it is an identifier before `to`, else "". */
const scopeIdent = (toks: LexToken[], i: i32, to: i32): string =>
  i < to && toks[i].kind === LEX_IDENT ? toks[i].text : ""

/** Whether token `i`, before `to`, is the punctuation `p`. */
const scopePunct = (toks: LexToken[], i: i32, to: i32, p: string): boolean =>
  i < to && toks[i].kind === LEX_PUNCT && toks[i].text === p

/**
 * The names a `const`, `let` or `var` declares from token `i`: the first
 * name, and every name after a top-level comma that a `:`, `=`, `!`, `,`,
 * `;` or the end follows. It may take a name too many, never one too few, so the
 * gate mutates more, not less. A destructured declarator names nothing, but
 * Nish has no destructuring.
 */
const scopeDeclarators = (toks: LexToken[], i: i32, to: i32): string[] => {
  const names: string[] = []
  const first = scopeIdent(toks, i, to)
  if (first === "") {
    return names
  }
  names.push(first)
  for (let k = i + 1; k < to; k++) {
    if (toks[k].depth === 0 && scopePunct(toks, k, to, ",")) {
      const name = scopeIdent(toks, k + 1, to)
      const after = k + 2
      if (
        name !== "" &&
        (after >= to ||
          scopePunct(toks, after, to, ":") ||
          scopePunct(toks, after, to, "=") ||
          scopePunct(toks, after, to, "!") ||
          scopePunct(toks, after, to, ",") ||
          scopePunct(toks, after, to, ";"))
      ) {
        names.push(name)
      }
    }
  }
  return names
}

/**
 * The names a statement from token `i` declares, as gitdiffExports names
 * them; empty when it names none.
 */
const scopeNames = (toks: LexToken[], from: i32, to: i32): string[] => {
  let i = from
  while (
    (scopeIdent(toks, i, to) === "declare" ||
      scopeIdent(toks, i, to) === "abstract" ||
      scopeIdent(toks, i, to) === "async") &&
    scopeIdent(toks, i + 1, to) !== ""
  ) {
    i = i + 1
  }
  let k = scopeIdent(toks, i, to)
  if (k === "const" && scopeIdent(toks, i + 1, to) === "enum") {
    i = i + 1
    k = "enum"
  }
  if (k === "const" || k === "let" || k === "var") {
    return scopeDeclarators(toks, i + 1, to)
  }
  if (k === "function") {
    i = i + 1
    if (scopePunct(toks, i, to, "*")) {
      i = i + 1
    }
  } else if (["class", "enum", "interface", "type", "namespace", "module"].indexOf(k) >= 0) {
    i = i + 1
  } else {
    return []
  }
  const name = scopeIdent(toks, i, to)
  return name === "" ? [] : [name]
}

/** The last line a token covers: its own, plus the line breaks inside it. */
const scopeLastLine = (t: LexToken): i32 => {
  let line = t.line
  for (let c = 0; c < t.text.length; c++) {
    if (t.text.charCodeAt(c) === 10) {
      line++
    }
  }
  return line
}

/**
 * Splits `toks` into declarations. Imports and export lists declare no code
 * and are left out; a statement that names nothing and is not exported is
 * top-level code, kept with no names. Returns why it cannot split the module,
 * or "".
 */
const scopeSplit = (toks: LexToken[], spans: LexSpan[], out: ScopeDecl[]): string => {
  for (const span of spans) {
    if (span.to <= span.from) {
      continue
    }
    const head = scopeIdent(toks, span.from, span.to)
    const exported = head === "export"
    const at = exported ? span.from + 1 : span.from
    if (head === "import" || (exported && (scopePunct(toks, at, span.to, "{") || scopePunct(toks, at, span.to, "*")))) {
      continue
    }
    const first = toks[span.from].line
    const last = scopeLastLine(toks[span.to - 1])
    // Nish refuses `export default`, so `export default function f` naming only `default` loses nothing.
    if (exported && scopeIdent(toks, at, span.to) === "default") {
      out.push(new ScopeDecl(["default"], first, last, span.from, span.to))
      continue
    }
    const names = scopeNames(toks, at, span.to)
    if (names.length === 0 && exported) {
      return `line ${first} exports a declaration the scanner cannot name`
    }
    out.push(new ScopeDecl(names, first, last, span.from, span.to))
  }
  return ""
}

/** Whether one of `decls` declares `name`. */
const scopeDeclares = (decls: ScopeDecl[], name: string): boolean => {
  for (const d of decls) {
    if (d.names.indexOf(name) >= 0) {
      return true
    }
  }
  return false
}

/**
 * Marks the declarations `name` names reached, and queues the identifiers
 * each newly reached one names.
 */
const scopeVisit = (m: ScopeModule, toks: LexToken[], name: string, seen: Set<string>, queue: string[]): void => {
  for (const d of m.decls) {
    if (d.reached || d.names.indexOf(name) < 0) {
      continue
    }
    d.reached = true
    for (let i = d.from; i < d.to; i++) {
      const t = toks[i]
      const member = i > d.from && (scopePunct(toks, i - 1, d.to, ".") || scopePunct(toks, i - 1, d.to, "?."))
      if (t.kind === LEX_IDENT && !member && !seen.has(t.text)) {
        seen.add(t.text)
        queue.push(t.text)
      }
    }
  }
}

/**
 * The module's top-level declarations, each marked reached when the
 * contract's functions reach it. Top-level code, which runs at load, is
 * always reached. A name a reached declaration uses counts as a reference
 * even where a local of the same name shadows it, so the scan errs toward
 * mutating more.
 *
 * @param text the module
 * @param roots the contract's function names
 * @returns its scope; `whole` is set, and every line counts as reached, when
 *   the module cannot be lexed, an export cannot be named, or a root is not
 *   a top-level declaration of the module
 */
export const scopeReach = (text: string, roots: string[]): ScopeModule => {
  const lexed = lexTokens(text)
  if (lexed.isErr()) {
    return new ScopeModule([], `the module cannot be lexed: ${lexed.error}`)
  }
  const toks = lexed.value
  const decls: ScopeDecl[] = []
  const why = scopeSplit(toks, lexStatements(toks), decls)
  if (why !== "") {
    return new ScopeModule([], why)
  }
  const m = new ScopeModule(decls, "")
  const seen = new Set<string>()
  const queue: string[] = []
  for (const root of roots) {
    if (!scopeDeclares(decls, root)) {
      return new ScopeModule([], `the contract's function ${root} is not a top-level declaration of the module`)
    }
    if (!seen.has(root)) {
      seen.add(root)
      queue.push(root)
    }
  }
  for (const d of decls) {
    if (d.names.length === 0) {
      d.reached = true
      for (let i = d.from; i < d.to; i++) {
        if (toks[i].kind === LEX_IDENT && !seen.has(toks[i].text)) {
          seen.add(toks[i].text)
          queue.push(toks[i].text)
        }
      }
    }
  }
  for (let q = 0; q < queue.length; q++) {
    scopeVisit(m, toks, queue[q], seen, queue)
  }
  return m
}

/**
 * Whether a line lies in code the contract's functions reach.
 *
 * @param m the module's scope (scopeReach)
 * @param line the 1-based line
 * @returns true inside a reached declaration, or anywhere when `whole` is set
 */
export const scopeIn = (m: ScopeModule, line: i32): boolean => {
  if (m.whole !== "") {
    return true
  }
  for (const d of m.decls) {
    if (d.reached && d.first <= line && line <= d.last) {
      return true
    }
  }
  return false
}

/**
 * The names of the unreached declarations a line lies in, for a note.
 *
 * @param m the module's scope (scopeReach)
 * @param line the 1-based line
 * @returns the names, in the module's order; `line N` when it lies in none
 */
export const scopeOwners = (m: ScopeModule, line: i32): string[] => {
  const out: string[] = []
  for (const d of m.decls) {
    if (!d.reached && d.first <= line && line <= d.last) {
      for (const n of d.names) {
        out.push(n)
      }
    }
  }
  if (out.length === 0) {
    out.push(`line ${line}`)
  }
  return out
}
