import { Suite } from "nish/testing"
import { CheckContext, checkContract, checkPassed, checkSamplesOf } from "../../../src/spec/check"
import { contractLoadFile } from "../../../src/spec/contract/contract"
import { Contract } from "../../../src/spec/contract/types"
import { EmitOptions, emitProgram } from "../../../src/spec/emit/emit"
import { runDisposeScratch, runMakeScratch, runTest } from "../../../src/spec/run/run"

/** The index of clause `id` in `c`; -1 when it has none. */
const samplesTestIndex = (c: Contract, id: string): i32 => {
  for (let i = 0; i < c.clauses.length; i++) {
    if (c.clauses[i].id === id) {
      return i
    }
  }
  return -1
}

/**
 * contracts/example-hex.json with P-ROUND-TRIP asking for 96 samples and
 * P-ENC-LEN for 200, past the default path's ceiling of 96.
 */
const samplesTestContract = (): Contract => {
  const c = contractLoadFile("contracts/example-hex.json").expect("load")
  c.clauses[samplesTestIndex(c, "P-ROUND-TRIP")].samples = 96
  c.clauses[samplesTestIndex(c, "P-ENC-LEN")].samples = 200
  return c
}

/** An explicit samples is the property's total; the emitted test runs exactly that many. */
export const main = (): i32 => {
  const t = new Suite("spec/emit samples")
  const c = samplesTestContract()
  const ctx = new CheckContext("contracts/example-hex.json", ".")
  const report = checkContract(ctx, c)
  t.ok("the contract checks", checkPassed(report) && ctx.toolFailure === null)
  t.eqStr("P-ROUND-TRIP gets 96", `${checkSamplesOf(report.samples, "P-ROUND-TRIP").length}`, "96")
  t.eqStr("P-ENC-LEN gets 200", `${checkSamplesOf(report.samples, "P-ENC-LEN").length}`, "200")
  for (const s of ctx.sampleStats) {
    if (s.clause === "P-ROUND-TRIP" || s.clause === "P-ENC-LEN") {
      t.ok(
        `${s.clause}: boundary and random, both drawn, make the total`,
        s.boundary > 0 && s.random > 0 && s.boundary + s.random === checkSamplesOf(report.samples, s.clause).length,
      )
      t.ok(
        `${s.clause}: no note`,
        s.notes.every((n: string): boolean => !n.startsWith("asked for")),
      )
    }
  }
  const program = emitProgram(c, report.samples, new EmitOptions("ab"))
  t.ok("emits", program.isOk())
  const text = program.isOk() ? program.value : ""
  const hexText = readFileSyncOrNull("tests/fixtures/nish-hex/hex.ts")
  if (!isExecutableSync(".nish/libexec/nish") || hexText === null || !program.isOk()) {
    t.skip("the emitted test runs its samples", "no .nish/ install or no fixture: run bash scripts/fetch-nish.sh")
    return t.done()
  }
  const made = runMakeScratch(".nish", ["std/hex.ts"], [hexText])
  t.ok("a scratch install is made", made.isOk())
  if (!made.isOk()) {
    console.log(made.error)
    return t.done()
  }
  const ran = runTest(c, text, made.value.nish, 110000)
  t.ok("the test ran", ran.isOk())
  if (ran.isOk()) {
    const r = ran.value
    t.eqStr("it runs SATISFIED", r.verdict.status, "SATISFIED")
    t.ok("P-ROUND-TRIP prints 96 samples", r.stdout.indexOf(" — 96 samples") > 0)
    t.ok("P-ENC-LEN prints 200 samples", r.stdout.indexOf(" — 200 samples") > 0)
  }
  t.ok("the scratch install is removed", runDisposeScratch(made.value).isOk())
  return t.done()
}
