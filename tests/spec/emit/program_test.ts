import { Suite } from "nish/testing"
import { contractLoadFile } from "../../../src/spec/contract/contract"
import { SampleTable } from "../../../src/spec/check"
import { EmitOptions, emitProgram } from "../../../src/spec/emit/emit"

/** Emitting contracts/example-hex.json. */
export const main = (): i32 => {
  const t = new Suite("spec/emit program")
  const c = contractLoadFile("contracts/example-hex.json").expect("load")
  const out = emitProgram(c, new SampleTable(), new EmitOptions("ab"))
  t.ok("emits", out.isOk())
  const text = out.isOk() ? out.value : ""
  t.ok("names the contract's sha256", text.indexOf("\n// vector-contract-sha256: ab\n") > 0)
  t.ok("uses Suite", text.indexOf(`import { Suite } from "nish/testing";`) >= 0)
  return t.done()
}
