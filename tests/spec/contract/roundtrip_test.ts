import { Suite } from "nish/testing"
import { replaceAll, splitLines } from "nish/text"
import { newJsonDocument, parseJson } from "../../../src/core/json"
import { contractFromJson, contractParse } from "../../../src/spec/contract/read"
import { contractWrite } from "../../../src/spec/contract/write"

/** The `*.json` contracts in `dir`, as paths, skipping survivor reports. */
const roundtripIn = (dir: string): string[] => {
  const out: string[] = []
  const names = readdirSync(dir) ?? []
  for (let i = 0; i < names.length; i++) {
    if (names[i].endsWith(".json") && !names[i].endsWith(".survivors.json")) {
      out.push(`${dir}/${names[i]}`)
    }
  }
  return out
}

/**
 * Round-trips one contract by value: it loads clean, and load, write, load
 * again gives an equal contract (compared as their canonical writes), with a
 * second write that does not move.
 */
const roundtripByValue = (t: Suite, file: string): void => {
  const text = readFileSyncOrNull(file)
  if (text === null) {
    t.fail(file, "cannot be read")
    return
  }
  const first = contractParse(text, file)
  if (first.isErr()) {
    t.fail(`${file} loads with no shape errors`, first.error.join("\n"))
    return
  }
  t.ok(`${file} loads with no shape errors`, true)
  const w1 = contractWrite(first.value)
  const second = contractParse(w1, file)
  if (second.isErr()) {
    t.fail(`${file} reloads after a write`, second.error.join("\n"))
    return
  }
  const w2 = contractWrite(second.value)
  t.ok(`${file} load, write, load gives an equal contract`, contractWrite(first.value) === contractWrite(second.value))
  t.ok(`${file} writing twice is stable`, w2 === w1)
}

/**
 * vector's own contracts are written by vector, so they round-trip byte for
 * byte; a sibling nish's are hand-formatted, so only their value must survive.
 */
export const main = (): i32 => {
  const t = new Suite("spec/contract roundtrip")
  const files = roundtripIn("contracts")
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
  // A foreign checkout's formatting is its own: compare by value, not by byte.
  const foreign = roundtripIn("../nish/contracts")
  for (let i = 0; i < foreign.length; i++) {
    roundtripByValue(t, foreign[i])
  }
  // A cite's case is written back only when it is set.
  const caseDir = "tests/fixtures/test-vector-scope"
  roundtripByValue(t, `${caseDir}/contracts/scope-poly1305.json`)
  const scoped = contractWrite(
    contractParse(readFileSyncOrNull(`${caseDir}/contracts/scope-poly1305.json`) ?? "", "scoped").expect("parse"),
  )
  t.ok("a scoped cite writes its case", scoped.indexOf(`"case": "Test Vector #2"`) >= 0)
  const plain = contractWrite(
    contractParse(readFileSyncOrNull(`${caseDir}/contracts/scope-plain.json`) ?? "", "plain").expect("parse"),
  )
  t.ok("a plain cite writes no case", plain.indexOf(`"case"`) < 0)
  // A contract of word arrays (u32[] in and out, words32 literals) writes back
  // as it was extracted, byte for byte, and loads again to the same contract.
  const chacha = "tests/fixtures/chacha20/contracts/rfc8439-quarter-round.json"
  roundtripByValue(t, chacha)
  const chachaText = readFileSyncOrNull(chacha) ?? ""
  t.eqLines(
    `${chacha} writes back line for line`,
    splitLines(contractWrite(contractParse(chachaText, chacha).expect("parse"))),
    splitLines(chachaText),
  )
  // An iterated vector keeps its iterate, and writes slow only when it is true.
  const iterDir = "tests/fixtures/iterate-contract/contracts"
  roundtripByValue(t, `${iterDir}/x25519-iterate.json`)
  roundtripByValue(t, `${iterDir}/x25519-iterate-count.json`)
  const iter = readFileSyncOrNull(`${iterDir}/x25519-iterate.json`) ?? ""
  const fast = contractWrite(contractParse(iter, "iterate").expect("parse"))
  t.ok("an iterated vector writes its iterate", fast.indexOf('"iterate": {') >= 0 && fast.indexOf('"count": 1000') >= 0)
  t.ok("a fast iterated vector writes no slow", fast.indexOf('"slow"') < 0)
  const slowText = replaceAll(iter, '"count": 1000,', '"count": 1000, "slow": true,')
  const slow = contractWrite(contractParse(slowText, "iterate").expect("parse"))
  t.ok("a slow iterated vector writes slow", slow.indexOf('"slow": true') >= 0)
  // An already-parsed JSON value reads the same, and a wrong one says where.
  const doc = newJsonDocument()
  const bad = contractFromJson(doc, parseJson(doc, '{"contract": 1}', "inline").expect("json"))
  t.ok(
    "a wrong value is refused with paths",
    bad.isErr() && bad.error.length > 0 && bad.error[0].startsWith("contract"),
  )
  return t.done()
}
