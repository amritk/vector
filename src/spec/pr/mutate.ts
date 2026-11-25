/**
 * `spec/pr/mutate` — the mutants of a module's changed lines, and the
 * verdict on how the test met them. A mutant changes one operator, one
 * literal or one statement on a line the change added since the base,
 * inside a declaration the contract's functions reach (`spec/pr/scope`); the
 * test must kill every one that builds, unless the contract allows a
 * survivor on that line with a reason. The gate also fails when there is
 * nothing to mutate, when no mutant builds, and when the test fails on the
 * unmutated module, since then it proves nothing, and when too many builds
 * or test runs pass their time limit, since a timeout is neither a kill nor a
 * survival. Running the mutants is
 * `spec/pr/mutaterun`'s, and so is mutateCheck, which joins them.
 */

import { splitLines, trim } from "nish/text"
import { AllowedSurvivor } from "../contract/types"
import { GitdiffFile, gitdiffTouches } from "./gitdiff"
import { LEX_STRING, LEX_TEMPLATE, lexTokens } from "./lex"
import { PrReport } from "./report"
import { ScopeModule, scopeIn, scopeOwners, scopeReach } from "./scope"

/** Not run yet. */
export const MUTATE_PENDING: i32 = -1
/** The test failed on the mutant: it pins the line down. */
export const MUTATE_KILLED: i32 = 0
/** The test passed on the mutant: behaviour no requirement pins down. */
export const MUTATE_SURVIVED: i32 = 1
/** The mutant does not build: it tests nothing. */
export const MUTATE_STILLBORN: i32 = 2
/**
 * The test ran past its time on the mutant: neither a kill nor a survival,
 * since a loaded machine looks the same as a hang, so it is reported apart and
 * too many of them refuse the run.
 */
export const MUTATE_TIMED_OUT: i32 = 3
/** The mutant's build ran past its time: it tested nothing, and too many of them refuse the run. */
export const MUTATE_BUILD_TIMED_OUT: i32 = 4
/** The share of mutants, in percent, whose builds, or whose test runs, may run past their time before the run is refused. */
export const MUTATE_BUILD_TIMEOUT_PERCENT: i32 = 10

/** One mutant: a single line of the module, changed. */
export class MutateMutant {
  /** `line:col:op`, with `:variant` when an operator has more than one. */
  id: string
  /** The line it changes, from 1. */
  line: i32
  /** Where on the line, from 1. */
  col: i32
  /** The operator: relational, logical, arithmetic, bitwise, drop-not, int, delete-statement or return-null. */
  op: string
  /** The line as the mutant has it. */
  after: string
  /** A MUTATE_* outcome. */
  outcome: i32

  /**
   * Makes a mutant.
   *
   * @param line the line it changes, from 1
   * @param col where on the line, from 1
   * @param op the operator
   * @param variant which of the operator's changes, or ""
   * @param after the line as the mutant has it
   */
  constructor(line: i32, col: i32, op: string, variant: string, after: string) {
    this.id = variant.length > 0 ? `${line}:${col}:${op}:${variant}` : `${line}:${col}:${op}`
    this.line = line
    this.col = col
    this.op = op
    this.after = after
    this.outcome = MUTATE_PENDING
  }
}

/**
 * An outcome's name, as the report prints it.
 *
 * @param outcome a MUTATE_* outcome
 * @returns its name
 */
export const mutateOutcomeName = (outcome: i32): string => {
  if (outcome === MUTATE_KILLED) {
    return "killed"
  }
  if (outcome === MUTATE_SURVIVED) {
    return "survived"
  }
  if (outcome === MUTATE_STILLBORN) {
    return "stillborn"
  }
  if (outcome === MUTATE_TIMED_OUT) {
    return "timed out"
  }
  if (outcome === MUTATE_BUILD_TIMED_OUT) {
    return "build timed out"
  }
  return "not run"
}

/** Whether `c` can be part of a name or a number. */
const mutateWordChar = (c: i32): boolean =>
  (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36

/** The char code at `i`, or -1 off either end. */
const mutateAt = (s: string, i: i32): i32 => (i >= 0 && i < s.length ? s.charCodeAt(i) : -1)

/** The kind (MUTATE_CODE, ...) of character `i`, or -1 off either end. */
const mutateKind = (kinds: i32[], i: i32): i32 => (i >= 0 && i < kinds.length ? kinds[i] : -1)

/** Whether `op` stands at `i` with a space on each side, as the formatter puts a binary operator. */
const mutateSpaced = (s: string, i: i32, op: string): boolean => {
  const end = toI32(toI64(i) + toI64(op.length))
  return mutateAt(s, i - 1) === 32 && s.substring(i, end) === op && mutateAt(s, end) === 32
}

/** Where in `swaps` (mutateSwaps) the operator spaced at `i` of `s` is, or -1 for none. */
const mutateSwapAt = (s: string, i: i32, swaps: string[]): i32 => {
  for (let k = 0; k < swaps.length - 2; k += 3) {
    if (mutateSpaced(s, i, swaps[k])) {
      return k
    }
  }
  return -1
}

/**
 * The binary operators a mutant swaps, as triples: the operator, its
 * replacement and the mutant's name. Longer operators come first, so `<<` is
 * not read as `<` and `===` not as `==`. The old mutate.ts had the relational
 * and logical swaps; the arithmetic and bitwise ones are new.
 */
const mutateSwaps = (): string[] => [
  "===",
  "!==",
  "relational",
  "!==",
  "===",
  "relational",
  "==",
  "!=",
  "relational",
  "!=",
  "==",
  "relational",
  "<<",
  ">>",
  "bitwise",
  ">>",
  "<<",
  "bitwise",
  "<=",
  "<",
  "relational",
  ">=",
  ">",
  "relational",
  "<",
  "<=",
  "relational",
  ">",
  ">=",
  "relational",
  "&&",
  "||",
  "logical",
  "||",
  "&&",
  "logical",
  "+",
  "-",
  "arithmetic",
  "-",
  "+",
  "arithmetic",
  "*",
  "/",
  "arithmetic",
  "/",
  "*",
  "arithmetic",
  "%",
  "*",
  "arithmetic",
  "&",
  "|",
  "bitwise",
  "|",
  "&",
  "bitwise",
  "^",
  "&",
  "bitwise",
]

/** Whether ` | ` at `i` joins a type with null, as `T | null` or `null | T` does: a type, not a bitwise or. */
const mutateNullUnion = (s: string, i: i32): boolean =>
  (i <= s.length - 6 && s.substring(i + 2, i + 6) === "null") || (i >= 5 && s.substring(i - 5, i - 1) === "null")

/** The line with `len` chars at `i` replaced by `by`. */
const mutateSplice = (s: string, i: i32, len: i32, by: string): string =>
  `${s.substring(0, i)}${by}${s.substring(i).substring(len)}`

/** A character of no token: a space or a line break between tokens. */
const MUTATE_BLANK: i32 = 0
/** A character of an identifier, a number or punctuation: code a mutant may change. */
const MUTATE_CODE: i32 = 1
/** A character of a string or of template text, its quotes and `${`/`}` included. */
const MUTATE_TEXT: i32 = 2
/** A character of a comment. */
const MUTATE_COMMENT: i32 = 3

/** Marks `[from, to)` of `kinds` as `kind`. */
const mutateMark = (kinds: i32[], from: i32, to: i32, kind: i32): void => {
  for (let i = from; i >= 0 && i < to && i < kinds.length; i++) {
    kinds[i] = kind
  }
}

/** Marks the comments in `[from, to)`, a gap between tokens, which the lexer read as only spaces and comments. */
const mutateMarkComments = (text: string, kinds: i32[], from: i32, to: i32): void => {
  if (to > text.length) {
    return
  }
  let i = from
  while (i >= 0 && i < to) {
    if (text.charCodeAt(i) === 47 && mutateAt(text, i + 1) === 47) {
      const nl = text.indexOf("\n", i)
      const end = nl < 0 || toI32(nl) > to ? to : toI32(nl)
      mutateMark(kinds, i, end, MUTATE_COMMENT)
      i = end
    } else if (text.charCodeAt(i) === 47 && i + 1 < text.length && text.charCodeAt(i + 1) === 42) {
      const close = text.indexOf("*/", i + 2)
      const end = close < 0 || toI64(close) + 2 > toI64(to) ? to : toI32(toI64(close) + 2)
      mutateMark(kinds, i, end, MUTATE_COMMENT)
      i = end
    } else {
      i++
    }
  }
}

/**
 * What each character of a module's lines is, as the lexer (lexTokens) reads
 * the whole module: so a string, a template literal or a comment that spans
 * lines, or a `/*` opened mid-line, is never taken for code.
 *
 * @param text the module
 * @returns per line (splitLines), one entry per character and one more for
 *   the line break after it: 1 for code, 2 for a string or template text, 3
 *   for a comment, 0 for a space between tokens; or `Err` naming the line
 *   the lexer cannot read
 */
export const mutateCode = (text: string): Result<i32[][], string> => {
  const tokens = lexTokens(text).orReturn()
  const kinds: i32[] = []
  // One more than the text, for the line break after its last line.
  kinds.push(MUTATE_BLANK)
  for (let i = 0; i < text.length; i++) {
    kinds.push(MUTATE_BLANK)
  }
  let gap: i32 = 0
  for (const t of tokens) {
    mutateMarkComments(text, kinds, gap, t.start)
    const textual = t.kind === LEX_STRING || t.kind === LEX_TEMPLATE
    mutateMark(kinds, t.start, t.end, textual ? MUTATE_TEXT : MUTATE_CODE)
    gap = t.end
  }
  mutateMarkComments(text, kinds, gap, toI32(text.length))
  const out: i32[][] = []
  let start: i32 = 0
  for (const line of splitLines(text)) {
    // splitLines splits at each line break and nowhere else, so every line
    // and the break after it lie in `kinds`.
    const end = toI64(start) + toI64(line.length) + 1
    const row: i32[] = []
    for (let k = start; k >= 0 && toI64(k) < end && k < kinds.length; k++) {
      row.push(kinds[k])
    }
    out.push(row)
    start = toI32(end)
  }
  return Ok(out)
}

/** The mutants of one statement-level line: deleting it, or returning null. */
const mutateWholeLine = (text: string, line: i32, kinds: i32[], out: MutateMutant[]): void => {
  let first = 0
  while (first < text.length && mutateKind(kinds, first) === MUTATE_BLANK) {
    first++
  }
  let last = toI32(text.length)
  while (
    last > first &&
    last > 0 &&
    (mutateKind(kinds, last - 1) === MUTATE_BLANK || mutateKind(kinds, last - 1) === MUTATE_COMMENT)
  ) {
    last--
  }
  // The line must start in code and end outside every string, template and
  // block comment, or deleting it would cut one open.
  if (
    first >= text.length ||
    mutateKind(kinds, first) !== MUTATE_CODE ||
    mutateKind(kinds, toI32(text.length)) !== MUTATE_BLANK
  ) {
    return
  }
  const t = trim(text.substring(first, last))
  const indent = text.substring(0, first)
  const open =
    t.endsWith("{") || t.endsWith("(") || t.endsWith(",") || t.endsWith("[") || t.endsWith("=>") || t.endsWith("=")
  if (open || t.startsWith("}")) {
    return
  }
  if (t.startsWith("return ")) {
    if (t !== "return null") {
      out.push(new MutateMutant(line, first + 1, "return-null", "", `${indent}return null`))
    }
    return
  }
  const keywords: string[] = ["export ", "const ", "let ", "if ", "if(", "else", "for ", "while ", "import ", "class "]
  for (const k of keywords) {
    if (t.startsWith(k)) {
      return
    }
  }
  if (t.length > 0 && mutateWordChar(t.charCodeAt(0))) {
    out.push(new MutateMutant(line, first + 1, "delete-statement", "", ""))
  }
}

/**
 * The mutants of one line of a module: each operator, literal and statement
 * it can change, left to right, in code only: never in a string, template
 * text or a comment.
 *
 * @param text the line
 * @param line its number, from 1
 * @param kinds what each of its characters is, and its line break (mutateCode)
 * @returns its mutants
 */
export const mutateLine = (text: string, line: i32, kinds: i32[]): MutateMutant[] => {
  const out: MutateMutant[] = []
  const t = trim(text)
  if (t.length === 0 || t.startsWith("import ")) {
    return out
  }
  const swaps = mutateSwaps()
  let i = 0
  while (i >= 0 && i < text.length) {
    const c = text.charCodeAt(i)
    if (mutateKind(kinds, i) !== MUTATE_CODE) {
      i++
      continue
    }
    const k = mutateSwapAt(text, i, swaps)
    if (k >= 0 && k < swaps.length - 2) {
      const op = swaps[k]
      if (op !== "|" || !mutateNullUnion(text, i)) {
        out.push(new MutateMutant(line, i + 1, swaps[k + 2], "", mutateSplice(text, i, op.length, swaps[k + 1])))
      }
      i = toI32(toI64(i) + toI64(op.length))
      continue
    }
    if (c === 33 && mutateAt(text, i + 1) !== 61 && !mutateWordChar(mutateAt(text, i - 1))) {
      const next = mutateAt(text, i + 1)
      if (next === 40 || (mutateWordChar(next) && !(next >= 48 && next <= 57))) {
        out.push(new MutateMutant(line, i + 1, "drop-not", "", mutateSplice(text, i, 1, "")))
      }
      i++
      continue
    }
    if (c >= 48 && c <= 57 && !mutateWordChar(mutateAt(text, i - 1)) && mutateAt(text, i - 1) !== 46) {
      let j = i
      while (j < text.length && text.charCodeAt(j) >= 48 && text.charCodeAt(j) <= 57) {
        j++
      }
      const after = mutateAt(text, j)
      if (!mutateWordChar(after) && after !== 46 && j - i <= 9) {
        const n = parseInt(text.substring(i, j))
        // At most nine digits: n is below 1e9, so n + 1 and n - 1 fit.
        if (n >= 0 && n < 1000000000) {
          out.push(new MutateMutant(line, i + 1, "int", "+1", mutateSplice(text, i, j - i, `${n + 1}`)))
          out.push(new MutateMutant(line, i + 1, "int", "-1", mutateSplice(text, i, j - i, `${n - 1}`)))
        }
      }
      i = j
      continue
    }
    if (mutateWordChar(c)) {
      while (i < text.length && mutateWordChar(text.charCodeAt(i))) {
        i++
      }
      continue
    }
    i++
  }
  mutateWholeLine(text, line, kinds, out)
  return out
}

/** The mutants of a change, and the changed lines left out as outside the code the contract tests. */
export class MutateSites {
  /** The mutants, in the module's order. */
  mutants: MutateMutant[]
  /** How many changed lines with a mutant lie outside the code the contract's functions reach. */
  outside: i32
  /** The declarations those lines lie in, each once, in the module's order. */
  owners: string[]
  /** Whether some changed line, with a mutant or not, lies in code the contract's functions reach. */
  reached: boolean
  /** Why every changed line was mutated, or "" when the scan split the module (scopeReach). */
  whole: string

  /**
   * Makes an empty set of sites.
   *
   * @param whole why every changed line is mutated, or ""
   */
  constructor(whole: string) {
    this.mutants = []
    this.outside = 0
    this.owners = []
    this.reached = false
    this.whole = whole
  }
}

/**
 * The mutants of a module's lines that a change added, inside the
 * declarations the contract's functions reach (scopeReach). Where code is
 * comes from the lexer (mutateCode), so no mutant lands in a string, a
 * template literal or a comment, however many lines it spans.
 *
 * @param text the module now
 * @param changed the module's changes since the base (gitdiffChanged)
 * @param roots the contract's function names
 * @returns the mutants and the changed lines left out, or `Err` naming the
 *   line the lexer cannot read
 */
export const mutateSites = (text: string, changed: GitdiffFile, roots: string[]): Result<MutateSites, string> => {
  const lines = splitLines(text)
  const kinds = mutateCode(text).orReturn()
  const scope: ScopeModule = scopeReach(text, roots)
  const out = new MutateSites(scope.whole)
  // At most one per line, so it never wraps.
  let outside: u32 = 0
  for (let i = 0; i < lines.length && i < kinds.length; i++) {
    const n = i + 1
    if (gitdiffTouches(changed, n)) {
      const ms = mutateLine(lines[i], n, kinds[i])
      if (scopeIn(scope, n)) {
        out.reached = true
        for (const m of ms) {
          out.mutants.push(m)
        }
      } else if (ms.length > 0) {
        outside++
        out.outside = toI32(outside)
        for (const o of scopeOwners(scope, n)) {
          if (out.owners.indexOf(o) < 0) {
            out.owners.push(o)
          }
        }
      }
    }
  }
  return Ok(out)
}

/**
 * The note on the changed lines a scoped run left unmutated.
 *
 * @param s the sites (mutateSites)
 * @returns the note, or "" when every changed line was in scope
 */
export const mutateOutsideNote = (s: MutateSites): string => {
  if (s.outside === 0) {
    return ""
  }
  const were = s.outside === 1 ? "line outside the tested functions was" : "lines outside the tested functions were"
  return `${s.outside} changed ${were} not mutated: ${s.owners.join(", ")}`
}

/**
 * At most `max` mutants, spread evenly over the list so each part of the
 * change keeps some.
 *
 * @param all every mutant
 * @param max the most to keep; 0 or less keeps all
 * @returns the mutants kept, in order
 */
export const mutatePick = (all: MutateMutant[], max: i32): MutateMutant[] => {
  const n = toI32(all.length)
  const d = toI64(max)
  if (d <= 0 || toI64(n) <= d) {
    return all
  }
  const out: MutateMutant[] = []
  for (let k = 0; k < max; k++) {
    // k is below max, so the pick is below n: this test always holds.
    const at = toI32((toI64(k) * toI64(n)) / d)
    if (at >= 0 && at < all.length) {
      out.push(all[at])
    }
  }
  return out
}

/**
 * The module's text with a mutant's line in place of its own.
 *
 * @param text the module
 * @param m the mutant
 * @returns the mutated module; a deleted statement leaves an empty line, so
 *   every other line keeps its number
 */
export const mutateApply = (text: string, m: MutateMutant): string => {
  const lines = splitLines(text)
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    out.push(i + 1 === m.line ? m.after : lines[i])
  }
  const joined = out.join("\n")
  return text.endsWith("\n") ? `${joined}\n` : joined
}

/** The reason the contract allows a survivor on `file:line`, or null. */
const mutateAllowed = (allow: AllowedSurvivor[], file: string, line: i32): AllowedSurvivor | null => {
  for (const a of allow) {
    if (a.file === file && a.line === toI64(line)) {
      return a
    }
  }
  return null
}

/**
 * Judges the mutants a run met.
 *
 * @param r the report to fill
 * @param file the module, from the nish root, as allowSurvivors names it
 * @param mutants the mutants, each with its outcome
 * @param allow the survivors the contract allows
 * @param baseline why the test fails on the unmutated module, or null when it passes
 * @param dropped mutants made but not run, as `--max` left out
 * @param outside the note on changed lines outside the tested functions
 *   (mutateOutsideNote), or ""
 * @param reached whether some changed line lies in code the contract's
 *   functions reach (MutateSites.reached), which picks the refusal when
 *   there is no mutant
 */
export const mutateJudge = (
  r: PrReport,
  file: string,
  mutants: MutateMutant[],
  allow: AllowedSurvivor[],
  baseline: string | null,
  dropped: i32,
  outside: string,
  reached: boolean,
): void => {
  if (baseline !== null) {
    r.problems.push(`the test fails on the unmutated module, so it proves nothing: ${baseline}`)
    return
  }
  if (outside !== "") {
    r.notes.push(outside)
  }
  if (mutants.length === 0) {
    if (outside === "") {
      r.problems.push(`no mutants: the change adds no line of ${file} that can be mutated`)
    } else if (reached) {
      r.problems.push(
        `no mutants: no line the change adds to ${file} in code the contract's functions reach can be mutated`,
      )
    } else {
      r.problems.push(`no mutants: no line the change adds to ${file} lies in code the contract's functions reach`)
    }
    return
  }
  if (dropped > 0) {
    r.notes.push(
      `${dropped} of ${toI64(mutants.length) + toI64(dropped)} mutants were not run: --max kept ${mutants.length}`,
    )
  }
  // Each counts some of the mutants, so none wraps.
  let stillborn: u32 = 0
  let timedOut: u32 = 0
  let buildTimedOut: u32 = 0
  const total = toI64(mutants.length)
  const limit = toU64(mutants.length) * toU64(MUTATE_BUILD_TIMEOUT_PERCENT)
  const used = new Set<string>()
  for (const m of mutants) {
    r.items.push(`${mutateOutcomeName(m.outcome)} ${file}:${m.line}:${m.col} ${m.op}: ${trim(m.after)}`)
    if (m.outcome === MUTATE_STILLBORN) {
      stillborn++
    } else if (m.outcome === MUTATE_TIMED_OUT) {
      timedOut++
    } else if (m.outcome === MUTATE_BUILD_TIMED_OUT) {
      buildTimedOut++
    } else if (m.outcome === MUTATE_SURVIVED) {
      const a = mutateAllowed(allow, file, m.line)
      if (a !== null) {
        used.add(`${m.line}`)
        r.notes.push(`survivor ${file}:${m.line} (${m.id}) is allowed: ${a.reason}`)
      } else {
        r.problems.push(
          `survivor ${file}:${m.line} (${m.id}): \`${trim(m.after)}\` passes the test: behaviour no requirement pins down`,
        )
      }
    } else if (m.outcome === MUTATE_PENDING) {
      r.problems.push(`mutant ${m.id} was not run`)
    }
  }
  if (toI64(stillborn) + toI64(buildTimedOut) === total) {
    r.problems.push(
      "every mutant is stillborn or its build ran past its time: none built, so the test met none of them",
    )
  } else if (toU64(buildTimedOut) * 100 > limit) {
    r.problems.push(
      `${buildTimedOut} of ${mutants.length} mutant builds ran past their time, more than ${MUTATE_BUILD_TIMEOUT_PERCENT}%: a survivor may hide among them, so run with fewer --jobs`,
    )
  } else if (buildTimedOut > 0) {
    r.notes.push(`${buildTimedOut} of ${mutants.length} mutant builds ran past their time: they tested nothing`)
  }
  if (timedOut > 0 && toI64(stillborn) + toI64(buildTimedOut) + toI64(timedOut) === total) {
    r.problems.push(
      "every mutant that built ran its test past its time: the test settled none of them, so run with fewer --jobs",
    )
  } else if (toU64(timedOut) * 100 > limit) {
    r.problems.push(
      `${timedOut} of ${mutants.length} mutants ran their test past its time, more than ${MUTATE_BUILD_TIMEOUT_PERCENT}%: a timeout is neither a kill nor a survival, so a survivor may hide among them: run with fewer --jobs`,
    )
  } else if (timedOut > 0) {
    r.notes.push(
      `${timedOut} of ${mutants.length} mutants ran their test past its time: counted neither killed nor survived`,
    )
  }
  const mutated = new Set<string>()
  for (const m of mutants) {
    if (
      m.outcome !== MUTATE_STILLBORN &&
      m.outcome !== MUTATE_BUILD_TIMED_OUT &&
      m.outcome !== MUTATE_TIMED_OUT &&
      m.outcome !== MUTATE_PENDING
    ) {
      mutated.add(`${m.line}`)
    }
  }
  for (const a of allow) {
    if (a.file === file && !used.has(`${a.line}`)) {
      if (mutated.has(`${a.line}`)) {
        r.problems.push(
          `allowSurvivors ${a.file}:${a.line} is stale: the test killed every mutant of that line, so the allowance would only excuse whatever survives there next: remove it, or move it to the line it means`,
        )
      } else {
        r.notes.push(
          `STALE? allowSurvivors ${a.file}:${a.line} matched no survivor this run: no mutant of that line ran, so check it still names the line it means`,
        )
      }
    }
  }
}
