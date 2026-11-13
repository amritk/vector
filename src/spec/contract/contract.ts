/**
 * `spec/contract/contract` — the entry to a contract: read its JSON, check
 * its values, and hand back the model of `spec/contract/types`.
 *
 * How a downstream stage plugs in: load with `contractLoad`, which gives a
 * contract whose structure (`spec/contract/read`) and values
 * (`spec/contract/shape`) are already checked, so the stage reads the model's
 * fields without checking them again. A stage that judges a contract further
 * (coverage, quotes, solver bounds) is a gate: a top-level function taking a
 * `CheckContext` and the contract, registered in `spec/check`. Expressions
 * are typed with `typeOf` from `spec/contract/typing`, and a contract is
 * written back with `contractWrite` from `spec/contract/write`, byte for byte
 * as `contracts/*.json` are.
 */

import { contractParse } from "./read"
import { contractShapeErrors } from "./shape"
import { Contract } from "./types"

/**
 * Reads a contract from its JSON text and checks its structure and values,
 * reporting every error rather than stopping at the first.
 *
 * @param text the contract's JSON
 * @param source where the text came from, for the JSON parser's errors
 * @returns the contract, or every error, each as `<path>: <what was wanted>`
 */
export const contractLoad = (text: string, source: string): Result<Contract, string[]> => {
  const c = contractParse(text, source)
  if (c.isErr()) {
    return Err(c.error)
  }
  const errors = contractShapeErrors(c.value)
  if (errors.length > 0) {
    return Err(errors)
  }
  return Ok(c.value)
}

/**
 * Reads a contract file and checks it, as `contractLoad` does.
 *
 * @param path the contract file
 * @returns the contract, or every error; an unreadable file is one error
 */
export const contractLoadFile = (path: string): Result<Contract, string[]> => {
  const text = readFileSyncOrNull(path)
  if (text === null) {
    return Err([`${path}: cannot be read`])
  }
  return contractLoad(text, path)
}
