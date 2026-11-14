/**
 * `spec/emit/target` — what a test is emitted for: a language, and the
 * harness that runs it in that language.
 *
 * Every emitted test is a standalone program that `vector spec run` executes
 * and judges by its transcript. A harness other than `standalone` adds the
 * hooks a language's test framework discovers (pytest's `test_*` functions, cargo's `#[test]` functions,
 * `go test`'s `Test*` functions, node:test's `test()` calls),
 * so the same file also runs under that framework.
 */

import { vocabLanguages } from "../contract/vocab"

/** A test's language and harness. */
export class EmitTarget {
  /** The language's vocabulary id: `nish` or one of `vocabLanguages`. */
  lang: string
  /** `standalone`, or the test framework the file also plugs into. */
  harness: string

  /**
   * Pairs a language with a harness.
   *
   * @param lang the language id
   * @param harness the harness
   */
  constructor(lang: string, harness: string) {
    this.lang = lang
    this.harness = harness
  }
}

/**
 * The languages vector emits tests for, `nish` first: the default.
 *
 * @returns the language ids
 */
export const emitTargetLanguages = (): string[] => ["nish", "python", "rust", "go", "typescript"]

/**
 * The harnesses a language's test can plug into, `standalone` first: the
 * default.
 *
 * @param lang a language id
 * @returns its harnesses; empty when vector emits no tests for it
 */
export const emitTargetHarnesses = (lang: string): string[] => {
  if (lang === "nish") {
    return ["standalone"]
  }
  if (lang === "python") {
    return ["standalone", "pytest"]
  }
  if (lang === "rust") {
    return ["standalone", "cargo"]
  }
  if (lang === "go") {
    return ["standalone", "gotest"]
  }
  if (lang === "typescript") {
    return ["standalone", "node"]
  }
  return []
}

/**
 * Reads `--lang` and `--harness`. Each defaults to the first its list names:
 * nish, and standalone.
 *
 * @param lang the `--lang` flag, or null
 * @param harness the `--harness` flag, or null
 * @returns the target, or why it is not one vector emits
 */
export const emitTargetParse = (lang: string | null, harness: string | null): Result<EmitTarget, string> => {
  const l = lang ?? "nish"
  const harnesses = emitTargetHarnesses(l)
  if (harnesses.length === 0) {
    if (vocabLanguages().indexOf(l) >= 0) {
      return Err(`--lang ${l}: vector has no emitter for ${l} yet (it has: ${emitTargetLanguages().join(", ")})`)
    }
    return Err(`--lang ${l}: not a language (vector emits: ${emitTargetLanguages().join(", ")})`)
  }
  const h = harness ?? harnesses[0]
  if (harnesses.indexOf(h) < 0) {
    return Err(`--harness ${h}: ${l} tests run ${harnesses.join(" or ")}`)
  }
  return Ok(new EmitTarget(l, h))
}

/**
 * The `--lang` and `--harness` flags that rebuild a target, for a regenerate
 * command: only those that differ from their default.
 *
 * @param t the target
 * @returns ` --lang <id>` and ` --harness <h>` as needed; empty for the defaults
 */
export const emitTargetFlags = (t: EmitTarget): string => {
  const lang = t.lang === "nish" ? "" : ` --lang ${t.lang}`
  const harness = t.harness === emitTargetHarnesses(t.lang)[0] ? "" : ` --harness ${t.harness}`
  return `${lang}${harness}`
}

/**
 * The extension of a module's source file, and of the test, in a language.
 *
 * @param lang a language id
 * @returns `.ts` for nish and typescript, `.py` for python, `.rs` for rust, `.go` for go
 */
export const emitTargetExt = (lang: string): string => {
  if (lang === "python") {
    return ".py"
  }
  if (lang === "go") {
    return ".go"
  }
  return lang === "rust" ? ".rs" : ".ts"
}
