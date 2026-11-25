/**
 * `spec/pr/stale` — whether a generated test was emitted from the contract
 * as it is now: its header comment's one `// vector-contract-sha256: <hex>`
 * line must name the SHA-256 of the contract file's bytes. A second such line,
 * well-formed or not, is refused rather than ignored.
 */

import { splitLines, trim } from "nish/text"
import { sha256Hex } from "../../core/hex"

/** The comment that opens the line naming a test's contract. */
export const STALE_PREFIX: string = "// vector-contract-sha256: "

/** Whether `text` is 64 lowercase hex digits. */
const staleIsSha = (text: string): boolean => {
  if (text.length !== 64) {
    return false
  }
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (!((c >= 0x30 && c <= 0x39) || (c >= 0x61 && c <= 0x66))) {
      return false
    }
  }
  return true
}

/** Whether `line` ends a block comment opened on an earlier line. */
const staleClosesBlock = (line: string): boolean => line.indexOf("*/") >= 0

/** Whether the text after the close of a block comment in `line` is code, not a comment or nothing. */
const staleCodeAfterBlock = (line: string): boolean => {
  const close = line.indexOf("*/")
  const rest = close >= 0 && close < line.length - 1 ? trim(line.substring(close + 2)) : ""
  return rest.length > 0 && !rest.startsWith("//") && !rest.startsWith("/*")
}

/**
 * What every `// vector-contract-sha256:` line in a test's header comment
 * names, well-formed or not: the text after the prefix. The header is the
 * lines before the first line of code: blank lines, `//` lines and block
 * comments; a line where code follows a block comment's close is code. A line
 * further down is code or a string, not the test's own.
 *
 * @param test the test's source
 * @returns the text after each prefix, in order
 */
export const staleShaLines = (test: string): string[] => {
  const out: string[] = []
  let inBlock = false
  for (const raw of splitLines(test)) {
    const line = trim(raw)
    if (inBlock) {
      inBlock = !staleClosesBlock(line)
      if (!inBlock && staleCodeAfterBlock(line)) {
        break
      }
      continue
    }
    if (line.startsWith("/*")) {
      const body = line.substring(2)
      inBlock = !staleClosesBlock(body)
      if (!inBlock && staleCodeAfterBlock(body)) {
        break
      }
      continue
    }
    if (line.length > 0 && !line.startsWith("//")) {
      break
    }
    if (line.startsWith(trim(STALE_PREFIX))) {
      out.push(trim(line.substring(trim(STALE_PREFIX).length)))
    }
  }
  return out
}

/**
 * Why a test was not emitted from these contract bytes.
 *
 * @param test the test's source
 * @param contract the contract file's text
 * @returns the reason, or null when its one line names this contract
 */
export const staleReason = (test: string, contract: string): string | null => {
  const found = staleShaLines(test)
  if (found.length === 0) {
    return "no `// vector-contract-sha256: <hex>` line: regenerate it with vector spec emit"
  }
  if (found.length > 1) {
    return `${found.length} vector-contract-sha256 lines: a test names one contract`
  }
  // `found` holds exactly one line here: the loop reads it without an index.
  for (const one of found) {
    if (!staleIsSha(one)) {
      return `its vector-contract-sha256 line holds "${one}", not 64 lowercase hex digits: regenerate it with vector spec emit`
    }
    const want = sha256Hex(contract)
    if (one !== want) {
      return `stale: emitted from a contract with sha256 ${one}, but the contract's is ${want}: regenerate it with vector spec emit`
    }
  }
  return null
}
