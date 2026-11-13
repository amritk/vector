/**
 * `spec/pr/stale` — whether a generated test was emitted from the contract
 * as it is now: its one `// vector-contract-sha256: <hex>` line must name the
 * SHA-256 of the contract file's bytes.
 */

import { splitLines } from "nish/text"
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

/**
 * The contract SHA-256s a test names, one per `// vector-contract-sha256:`
 * line that holds exactly 64 lowercase hex digits.
 *
 * @param test the test's source
 * @returns the hashes, in order
 */
export const staleShaLines = (test: string): string[] => {
  const out: string[] = []
  for (const line of splitLines(test)) {
    if (line.startsWith(STALE_PREFIX)) {
      const sha = line.substring(STALE_PREFIX.length)
      if (staleIsSha(sha)) {
        out.push(sha)
      }
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
  const want = sha256Hex(contract)
  if (found[0] !== want) {
    return `stale: emitted from a contract with sha256 ${found[0]}, but the contract's is ${want}: regenerate it with vector spec emit`
  }
  return null
}
