import { Suite } from "nish/testing"
import { replaceAll } from "nish/text"
import { charsIsModule } from "../../../src/spec/contract/chars"
import { contractParse } from "../../../src/spec/contract/read"
import { contractShapeErrors } from "../../../src/spec/contract/shape"
import { modulePathsAccepted, modulePathsRefused } from "./module_paths"

/** A valid contract whose module is `MODULE`. */
const MODULE_PATH_BASE: string = `{
  "contract": "c1",
  "source": {"title": "T", "rfc": 4648},
  "target": {"module": "MODULE"},
  "requirements": [{"id": "R1", "section": "3.1", "level": "MUST", "quote": "Q"}],
  "functions": [{"name": "enc", "params": [{"name": "b", "type": "bytes"}], "returns": "string"}],
  "clauses": [
    {"kind": "vector", "id": "V1", "title": "t", "covers": ["R1"],
     "source": {"cite": {"section": "10"}}, "call": "enc", "args": [{"hex": "00"}], "expect": {"str": "00"}}
  ]
}`

const MODULE_PATH_REFUSAL: string =
  "contract.target.module: a module path <root>/<segment>/…, each segment [a-z][a-z0-9_]*(-[a-z0-9][a-z0-9_]*)*, words joined by single - (RFC 3986 §3.3)"

/** The shape errors of the contract whose module is `m`, joined, or its read errors. */
const modulePathShape = (m: string): string => {
  const c = contractParse(replaceAll(MODULE_PATH_BASE, "MODULE", m), "base")
  if (c.isErr()) {
    return `read: ${c.error.join("\n")}`
  }
  return contractShapeErrors(c.value).join("\n")
}

/** The segment grammar, by charsIsModule and by a contract's shape check. */
export const main = (): i32 => {
  const t = new Suite("spec/contract module paths")
  for (const m of modulePathsAccepted()) {
    t.eqBool(`charsIsModule accepts ${m}`, charsIsModule(m), true)
    t.eqStr(`shape accepts ${m}`, modulePathShape(m), "")
  }
  for (const m of modulePathsRefused()) {
    t.eqBool(`charsIsModule refuses ${m}`, charsIsModule(m), false)
    t.eqStr(`shape refuses ${m}`, modulePathShape(m), MODULE_PATH_REFUSAL)
  }
  return t.done()
}
