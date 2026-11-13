/**
 * `spec/pr/mutate` — the mutants of a module's changed lines, and the
 * verdict on how the test met them. A mutant changes one operator, one
 * literal or one statement on a line the change added since the base; the
 * test must kill every one that builds, unless the contract allows a
 * survivor on that line with a reason. The gate also fails when there is
 * nothing to mutate, when no mutant builds, and when the test fails on the
 * unmutated module, since then it proves nothing. Running the mutants is
 * `spec/pr/mutaterun`'s, and so is mutateCheck, which joins them.
 */

import { splitLines, trim } from "nish/text"
import { AllowedSurvivor } from "../contract/types"
import { GitdiffFile, gitdiffTouches } from "./gitdiff"
import { PrReport } from "./report"

/** Not run yet. */
export const MUTATE_PENDING: i32 = -1
/** The test failed on the mutant: it pins the line down. */
export const MUTATE_KILLED: i32 = 0
/** The test passed on the mutant: behaviour no requirement pins down. */
export const MUTATE_SURVIVED: i32 = 1
/** The mutant does not build: it tests nothing. */
export const MUTATE_STILLBORN: i32 = 2
/** The test ran past its time on the mutant: counted as killed. */
export const MUTATE_TIMED_OUT: i32 = 3

/** One mutant: a single line of the module, changed. */
export class MutateMutant {
  /** `line:col:op`, with `:variant` when an operator has more than one. */
  id: string
  /** The line it changes, from 1. */
  line: i32
  /** Where on the line, from 1. */
  col: i32
  /** The operator: relational, logical, drop-not, int, delete-statement or return-null. */
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
  return "not run"
}

/** Whether `c` can be part of a name or a number. */
const mutateWordChar = (c: i32): boolean =>
  (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36

/** The char code at `i`, or -1 off either end. */
const mutateAt = (s: string, i: i32): i32 => (i >= 0 && i < s.length ? s.charCodeAt(i) : -1)

/** Whether `op` stands at `i` with a space on each side, as the formatter puts a binary operator. */
const mutateSpaced = (s: string, i: i32, op: string): boolean =>
  mutateAt(s, i - 1) === 32 && s.substring(i, i + op.length) === op && mutateAt(s, i + op.length) === 32

/** The binary operators a mutant swaps, each followed by its replacement. */
const mutateSwaps = (): string[] => [
  "===",
  "!==",
  "!==",
  "===",
  "<=",
  "<",
  ">=",
  ">",
  "<",
  "<=",
  ">",
  ">=",
  "&&",
  "||",
  "||",
  "&&",
]

/** The line with `len` chars at `i` replaced by `by`. */
const mutateSplice = (s: string, i: i32, len: i32, by: string): string =>
  `${s.substring(0, i)}${by}${s.substring(i + len)}`

/** The mutants of one statement-level line: deleting it, or returning null. */
const mutateWholeLine = (text: string, line: i32, out: MutateMutant[]): void => {
  const t = trim(text)
  const indent = text.substring(0, text.indexOf(t))
  const open =
    t.endsWith("{") || t.endsWith("(") || t.endsWith(",") || t.endsWith("[") || t.endsWith("=>") || t.endsWith("=")
  if (open || t.startsWith("}")) {
    return
  }
  if (t.startsWith("return ")) {
    if (t !== "return null") {
      out.push(new MutateMutant(line, indent.length + 1, "return-null", "", `${indent}return null`))
    }
    return
  }
  const keywords: string[] = ["export ", "const ", "let ", "if ", "if(", "else", "for ", "while ", "import ", "class "]
  for (const k of keywords) {
    if (t.startsWith(k)) {
      return
    }
  }
  if (mutateWordChar(t.charCodeAt(0))) {
    out.push(new MutateMutant(line, indent.length + 1, "delete-statement", "", ""))
  }
}

/**
 * The mutants of one line of a module: each operator, literal and statement
 * it can change, left to right, skipping strings and comments.
 *
 * @param text the line
 * @param line its number, from 1
 * @returns its mutants
 */
export const mutateLine = (text: string, line: i32): MutateMutant[] => {
  const out: MutateMutant[] = []
  const t = trim(text)
  if (t.length === 0 || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("import ")) {
    return out
  }
  const swaps = mutateSwaps()
  let quote = -1
  let i = 0
  while (i < text.length) {
    const c = text.charCodeAt(i)
    if (quote >= 0) {
      if (c === 92) {
        i += 2
        continue
      }
      if (c === quote) {
        quote = -1
      }
      i++
      continue
    }
    if (c === 34 || c === 39 || c === 96) {
      quote = c
      i++
      continue
    }
    if (c === 47 && mutateAt(text, i + 1) === 47) {
      break
    }
    let swapped = false
    for (let k = 0; k < swaps.length; k += 2) {
      const op = swaps[k]
      if (mutateSpaced(text, i, op)) {
        const name = op === "&&" || op === "||" ? "logical" : "relational"
        out.push(new MutateMutant(line, i + 1, name, "", mutateSplice(text, i, op.length, swaps[k + 1])))
        i += op.length
        swapped = true
        break
      }
    }
    if (swapped) {
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
        out.push(new MutateMutant(line, i + 1, "int", "+1", mutateSplice(text, i, j - i, `${n + 1}`)))
        out.push(new MutateMutant(line, i + 1, "int", "-1", mutateSplice(text, i, j - i, `${n - 1}`)))
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
  mutateWholeLine(text, line, out)
  return out
}

/**
 * The mutants of a module's lines that a change added.
 *
 * @param text the module now
 * @param changed the module's changes since the base (gitdiffChanged)
 * @returns the mutants, in the module's order
 */
export const mutateSites = (text: string, changed: GitdiffFile): MutateMutant[] => {
  const out: MutateMutant[] = []
  const lines = splitLines(text)
  let inBlock = false
  for (let i = 0; i < lines.length; i++) {
    const t = trim(lines[i])
    const wasBlock = inBlock
    if (!inBlock && t.startsWith("/*")) {
      inBlock = true
    }
    if (inBlock) {
      if (t.indexOf("*/") >= 0) {
        inBlock = false
      }
      continue
    }
    if (wasBlock) {
      continue
    }
    const n = toI32(i) + 1
    if (gitdiffTouches(changed, n)) {
      for (const m of mutateLine(lines[i], n)) {
        out.push(m)
      }
    }
  }
  return out
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
  if (max <= 0 || n <= max) {
    return all
  }
  const out: MutateMutant[] = []
  for (let k = 0; k < max; k++) {
    out.push(all[toI32((toI64(k) * toI64(n)) / toI64(max))])
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
    out.push(toI32(i) + 1 === m.line ? m.after : lines[i])
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
 */
export const mutateJudge = (
  r: PrReport,
  file: string,
  mutants: MutateMutant[],
  allow: AllowedSurvivor[],
  baseline: string | null,
): void => {
  if (baseline !== null) {
    r.problems.push(`the test fails on the unmutated module, so it proves nothing: ${baseline}`)
    return
  }
  if (mutants.length === 0) {
    r.problems.push(`no mutants: the change adds no line of ${file} that can be mutated`)
    return
  }
  let stillborn = 0
  const used = new Set<string>()
  for (const m of mutants) {
    r.items.push(`${mutateOutcomeName(m.outcome)} ${file}:${m.line}:${m.col} ${m.op}: ${trim(m.after)}`)
    if (m.outcome === MUTATE_STILLBORN) {
      stillborn++
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
  if (stillborn === mutants.length) {
    r.problems.push("every mutant is stillborn: none builds, so the test met none of them")
  }
  for (const a of allow) {
    if (a.file === file && !used.has(`${a.line}`)) {
      r.notes.push(`allowSurvivors ${a.file}:${a.line} matched no survivor this run`)
    }
  }
}
