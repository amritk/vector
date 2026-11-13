import { Suite } from "nish/testing"
import { splitLines } from "nish/text"
import { contractParse } from "../../../src/spec/contract/read"
import { contractWrite } from "../../../src/spec/contract/write"

/** The committed contracts, and nish's own when it is checked out beside vector. */
const roundtripFiles = (): string[] => {
  const out: string[] = []
  const names = readdirSync("contracts") ?? []
  for (let i = 0; i < names.length; i++) {
    if (names[i].endsWith(".json") && !names[i].endsWith(".survivors.json")) {
      out.push(`contracts/${names[i]}`)
    }
  }
  if (readFileSyncOrNull("../nish/contracts/hex.json") !== null) {
    out.push("../nish/contracts/hex.json")
  }
  return out
}

/** Each committed contract reads and writes back byte for byte. */
export const main = (): i32 => {
  const t = new Suite("spec/contract roundtrip")
  const files = roundtripFiles()
  t.ok("the committed contracts are found", files.length >= 3)
  for (let i = 0; i < files.length; i++) {
    const text = readFileSyncOrNull(files[i])
    if (text === null) {
      t.fail(files[i], "cannot be read")
      continue
    }
    const c = contractParse(text, files[i])
    if (c.isErr()) {
      t.fail(files[i], c.error.join("\n"))
      continue
    }
    const written = contractWrite(c.value)
    t.eqLines(`${files[i]} writes back line for line`, splitLines(written), splitLines(text))
    t.ok(`${files[i]} writes back byte for byte`, written === text)
  }
  return t.done()
}
