/**
 * `core/diag` — how vector reports a problem and which exit code it ends with.
 *
 * Every command ends with one of three codes: 0 when the check passed, 1 when
 * vector refused the input (a counterexample, a stale contract, a missing
 * test), and 2 when the command could not run at all (bad usage, a file that
 * cannot be read, a solver that will not start).
 */

/** The check ran and passed. */
export const EXIT_PASS: i32 = 0
/** The check ran and refused the input. */
export const EXIT_REFUSED: i32 = 1
/** The command could not run: bad usage, or an I/O or tool failure. */
export const EXIT_USAGE: i32 = 2

/** One problem vector reports: where it is, what it is, and the exit code it implies. */
export class Diagnostic {
  /** The file (or other source) the problem is in; empty when there is none. */
  file: string
  /** The 1-based line, or 0 when the problem has no line. */
  line: i32
  /** The text shown to the user. */
  message: string
  /** `EXIT_REFUSED` or `EXIT_USAGE`. */
  code: i32

  /**
   * Makes a diagnostic.
   *
   * @param file the file the problem is in, or "" for none
   * @param line the 1-based line, or 0 for none
   * @param message the text shown to the user
   * @param code the exit code it implies, `EXIT_REFUSED` or `EXIT_USAGE`
   */
  constructor(file: string, line: i32, message: string, code: i32) {
    this.file = file
    this.line = line
    this.message = message
    this.code = code
  }
}

/**
 * Makes a usage or I/O diagnostic, which exits 2.
 *
 * @param message the text shown to the user
 * @returns a diagnostic with code `EXIT_USAGE` and no location
 */
export const usageError = (message: string): Diagnostic => new Diagnostic("", 0, message, EXIT_USAGE)

/**
 * Makes a refusal diagnostic, which exits 1.
 *
 * @param file the file the refusal is about, or "" for none
 * @param line the 1-based line, or 0 for none
 * @param message the text shown to the user
 * @returns a diagnostic with code `EXIT_REFUSED`
 */
export const refusal = (file: string, line: i32, message: string): Diagnostic =>
  new Diagnostic(file, line, message, EXIT_REFUSED)

/**
 * Formats a diagnostic as `vector: file:line: message`, dropping the parts it lacks.
 *
 * @param d the diagnostic to format
 * @returns one line, without a trailing newline
 */
export const formatDiagnostic = (d: Diagnostic): string => {
  let where = ""
  if (d.file.length !== 0) {
    where = d.line > 0 ? `${d.file}:${d.line}: ` : `${d.file}: `
  }
  return `vector: ${where}${d.message}`
}

/**
 * Writes a diagnostic to standard error and answers its exit code, so a
 * command can end with `return report(d)`.
 *
 * @param d the diagnostic to write
 * @returns the diagnostic's exit code
 */
export const report = (d: Diagnostic): i32 => {
  console.error(formatDiagnostic(d))
  return d.code
}
