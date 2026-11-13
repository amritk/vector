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
  /** The text shown to the user. */
  message: string
  /** The 1-based line, or 0 when the problem has no line. */
  line: i32
  /** `EXIT_REFUSED` or `EXIT_USAGE`. */
  code: i32
  /** The 1-based column, or 0 when the problem names none. */
  col: i32 = 0
  /** The file `exactLine` is in, when `line` only comes near the problem; "" otherwise. */
  exactFile: string
  /** The 1-based line in `exactFile` the problem is on; 0 when `exactFile` is "". */
  exactLine: i32 = 0

  /**
   * Makes a diagnostic.
   *
   * @param file the file the problem is in, or "" for none
   * @param line the 1-based line, or 0 for none
   * @param message the text shown to the user
   * @param code the exit code it implies, `EXIT_REFUSED` or `EXIT_USAGE`
   */
  constructor(file: string, line: i32, message: string, code: i32) {
    this.exactFile = ""
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
 * Makes a refusal at a column, or at a line that only comes near the problem
 * together with the line it is exactly on, which exits 1.
 *
 * @param file the file the refusal is about, or "" for none
 * @param line the 1-based line, or 0 for none
 * @param col the 1-based column, or 0 for none
 * @param exactFile the file `exactLine` is in, or "" when `line` is exact
 * @param exactLine the line the problem is exactly on, in `exactFile`
 * @param message the text shown to the user
 * @returns a diagnostic with code `EXIT_REFUSED`
 */
export const refusalAt = (
  file: string,
  line: i32,
  col: i32,
  exactFile: string,
  exactLine: i32,
  message: string,
): Diagnostic => {
  const d = refusal(file, line, message)
  d.col = col
  d.exactFile = exactFile
  d.exactLine = exactLine
  return d
}

/**
 * Formats a place as `file`, `file:line` or `file:line:col`; when the line
 * only comes near it, as `file:line (exactFile:exactLine)`, the column going
 * with the exact line.
 *
 * @param file the file, or "" for none
 * @param line the 1-based line, or 0 for none
 * @param col the 1-based column, or 0 for none
 * @param exactFile the file `exactLine` is in, or "" when `line` is exact
 * @param exactLine the line the place is exactly on, in `exactFile`
 * @returns the place, or "" when there is no file
 */
export const diagPlace = (file: string, line: i32, col: i32, exactFile: string, exactLine: i32): string => {
  if (file.length === 0) {
    return ""
  }
  if (line <= 0) {
    return file
  }
  const colText = col > 0 ? `:${col}` : ""
  if (exactFile.length !== 0) {
    return `${file}:${line} (${exactFile}:${exactLine}${colText})`
  }
  return `${file}:${line}${colText}`
}

/**
 * Formats a diagnostic as `vector: place: message` (see `diagPlace`),
 * dropping the place when there is none.
 *
 * @param d the diagnostic to format
 * @returns one line, without a trailing newline
 */
export const formatDiagnostic = (d: Diagnostic): string => {
  const where = diagPlace(d.file, d.line, d.col, d.exactFile, d.exactLine)
  return where.length !== 0 ? `vector: ${where}: ${d.message}` : `vector: ${d.message}`
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
