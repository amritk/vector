import { Suite } from "nish/testing"
import { SampleTable } from "../../../src/spec/check"
import { contractLoadFile } from "../../../src/spec/contract/contract"
import { EmitOptions, emitProgram } from "../../../src/spec/emit/emit"
import { runDisposeScratch, runMakeScratch, runOutcomeName, runTest } from "../../../src/spec/run/run"

// An emitted Nish test is built with the no-panic rule relaxed, so a panic in
// the implementation fails the test when it runs: the clauses before it pass
// and the run is an ERROR that never reached the end of main, where a strict
// build would refuse the module and run nothing.

/** RFC 4231 §4.2 and §4.6: §4.2's data is 8 bytes, §4.6's is not. */
const RELAX_CONTRACT: string = "tests/fixtures/profile/profile-truncate.json"
/** §4.2's whole HMAC-SHA-256. */
const RELAX_FULL: string = "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"

/**
 * An hmac module whose hmacSha256 returns §4.2's value for §4.2's 8-byte
 * data, and indexes past the end of an empty array, a panic, for any other.
 */
const relaxHmac = (): string => `const relaxNib = (c: i32): u8 => {
  if (c >= 97) {
    return toU8(c - 87)
  }
  return toU8(c - 48)
}

const relaxUnhex = (s: string): u8[] => {
  const out: u8[] = []
  for (let i: i32 = 0; i + 1 < s.length; i += 2) {
    out.push(toU8(relaxNib(s.charCodeAt(i)) * 16 + relaxNib(s.charCodeAt(i + 1))))
  }
  return out
}

export const hmacSha256 = (key: u8[], data: u8[]): u8[] => {
  if (data.length === 8) {
    return relaxUnhex("${RELAX_FULL}")
  }
  const none: u8[] = []
  return [none[data.length]]
}
`

/** A module that panics on §4.6 fails the test at run time; it is not refused at build. */
export const main = (): i32 => {
  const t = new Suite("spec/run relax")
  if (!isExecutableSync(".nish/libexec/nish")) {
    t.skip("a panicking module fails the test", "no .nish/ install: run bash scripts/fetch-nish.sh")
    return t.done()
  }
  const c = contractLoadFile(RELAX_CONTRACT).expect("load")
  const program = emitProgram(c, new SampleTable(), new EmitOptions("ab")).expect("emit")
  const made = runMakeScratch(".nish", ["std/crypto/hmac.ts"], [relaxHmac()]).expect("scratch")
  const ran = runTest(c, program, made.nish, 110000).expect("run")
  t.eqStr("the run is an ERROR", ran.verdict.status, "ERROR")
  t.eqStr("it was built and ran: §4.2, before the panic, passes", runOutcomeName(ran.clauses[0].outcome), "pass")
  t.eqStr("§4.6, where it panics, is not run", runOutcomeName(ran.clauses[1].outcome), "not-run")
  t.contains("the test stopped before the end of main", ran.integrity.join("\n"), "never reached the end of main")
  const said = `${ran.stdout}\n${ran.stderr}`
  t.ok(
    "the build refused nothing",
    said.indexOf("NL2457") < 0 && said.indexOf("NL2458") < 0 && said.indexOf("may panic") < 0,
  )
  runDisposeScratch(made).expect("dispose")
  return t.done()
}
