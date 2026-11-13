import { Suite } from "nish/testing"
import { CheckContext, checkContract, checkLines } from "../../../src/spec/check"
import { contractParse } from "../../../src/spec/contract/read"
import { gateIds } from "../../../src/spec/gates/ids"
import { gateIssue, gateWarn, gateWarnings } from "../../../src/spec/gates/note"

/** A contract that gives the clause id V1 twice. */
const IDS_TEST_DUP: string = `{
  "contract": "c1",
  "source": {"title": "T", "rfc": 4648},
  "target": {"module": "nish/hex"},
  "requirements": [{"id": "R1", "section": "3.1", "level": "MUST", "quote": "Q"}],
  "functions": [{"name": "enc", "params": [{"name": "b", "type": "bytes"}], "returns": "string"}],
  "clauses": [
    {"kind": "vector", "id": "V1", "title": "t", "covers": ["R1"],
     "source": {"cite": {"section": "10"}}, "call": "enc", "args": [{"hex": "00"}], "expect": {"str": "00"}},
    {"kind": "vector", "id": "V1", "title": "t", "covers": ["R1"],
     "source": {"cite": {"section": "10"}}, "call": "enc", "args": [{"hex": "01"}], "expect": {"str": "01"}}
  ]
}`

/** The ids gate and the notes a gate writes. */
export const main = (): i32 => {
  const t = new Suite("spec/gates/ids")
  const ctx = new CheckContext("contracts/c1.json", ".")
  ctx.contract = contractParse(IDS_TEST_DUP, "dup").expect("parse")
  const found = gateIds(ctx)
  t.eqStr("a repeated clause id is a finding", found.join("|"), `V1: duplicate clause id "V1"`)
  t.ok("it is noted at the id", ctx.notes.length === 1 && ctx.notes[0].at === "V1" && !ctx.notes[0].warning)

  const report = checkContract(ctx, contractParse(IDS_TEST_DUP, "dup").expect("parse"))
  t.ok("the pipeline reports it", checkLines(report).indexOf(`ids: V1: duplicate clause id "V1"`) >= 0)

  const out: string[] = []
  gateIssue(ctx, out, "g", "R1", "bad")
  gateWarn(ctx, "g", "R2", "meh")
  t.eqStr("an issue is returned with its place", out.join("|"), "R1: bad")
  const w = gateWarnings(ctx)
  t.ok("a warning is only a note", w.length === 1 && w[0].at === "R2" && w[0].message === "meh")
  return t.done()
}
