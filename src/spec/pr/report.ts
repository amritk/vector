/**
 * `spec/pr/report` — what a PR gate found, and how it prints: as text, as
 * markdown for a PR comment, or as JSON. Every gate of `spec/pr` fills one
 * `PrReport`; its problems decide the exit code.
 */

import {
  OutJson,
  outJsonBool,
  outJsonObject,
  outJsonRender,
  outJsonString,
  outJsonStrings,
} from "../../verify/emit/outjson"

/** One gate's findings. */
export class PrReport {
  /** The gate's name, as the command spells it: "frozen". */
  gate: string
  /** What was checked against what, without the verdict: "spec frozen against main". */
  title: string
  /** What the gate looked at, one line each: "spec contracts/x.json". */
  items: string[]
  /** What the reader should know but does not fail the gate. */
  notes: string[]
  /** Why the gate fails; none when it passes. */
  problems: string[]

  /**
   * Makes an empty report.
   *
   * @param gate the gate's name
   * @param title what was checked against what
   */
  constructor(gate: string, title: string) {
    this.gate = gate
    this.title = title
    this.items = []
    this.notes = []
    this.problems = []
  }
}

/**
 * Why `format` is not one a gate prints.
 *
 * @param format the `--format` given
 * @returns the problem, or null for text, markdown and json
 */
export const prFormatProblem = (format: string): string | null => {
  if (format === "text" || format === "markdown" || format === "json") {
    return null
  }
  return `--format ${format}: give text, markdown or json`
}

/** A report's items, notes and problems under their headings (between `open` and `close`), each line prefixed. */
const prSections = (
  r: PrReport,
  item: string,
  note: string,
  problem: string,
  open: string,
  close: string,
): string[] => {
  const out: string[] = []
  if (r.items.length > 0) {
    out.push("")
    for (const i of r.items) {
      out.push(`${item}${i}`)
    }
  }
  if (r.notes.length > 0) {
    out.push("")
    out.push(`${open}notes:${close}`)
    for (const n of r.notes) {
      out.push(`${note}${n}`)
    }
  }
  if (r.problems.length > 0) {
    out.push("")
    out.push(`${open}problems:${close}`)
    for (const p of r.problems) {
      out.push(`${problem}${p}`)
    }
  }
  return out
}

/**
 * Prints a report.
 *
 * @param r the report
 * @param format text, markdown or json (checked with prFormatProblem)
 * @returns its text, without a final newline
 */
export const prRender = (r: PrReport, format: string): string => {
  const ok = r.problems.length === 0
  const verdict = ok ? "OK" : "FAILED"
  if (format === "json") {
    const o: OutJson = outJsonObject()
    o.put("gate", outJsonString(r.gate))
    o.put("title", outJsonString(r.title))
    o.put("ok", outJsonBool(ok))
    o.put("items", outJsonStrings(r.items))
    o.put("notes", outJsonStrings(r.notes))
    o.put("problems", outJsonStrings(r.problems))
    return outJsonRender(o)
  }
  const lines: string[] = []
  if (format === "markdown") {
    lines.push(`### ${ok ? "✅" : "❌"} ${r.title}: ${verdict}`)
    for (const l of prSections(r, "- ", "- ", "- ❌ ", "**", "**")) {
      lines.push(l)
    }
  } else {
    lines.push(`${r.title}: ${verdict}`)
    for (const l of prSections(r, "  ", "  - ", "  ✗ ", "", "")) {
      lines.push(l)
    }
  }
  return lines.join("\n")
}
