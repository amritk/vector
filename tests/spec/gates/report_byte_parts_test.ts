import { Suite } from "nish/testing"
import { CheckContext, CheckReport, SampleTable } from "../../../src/spec/check"
import { contractParse } from "../../../src/spec/contract/read"
import { ReportFormat, reportByteParts, reportFormats } from "../../../src/spec/report/common"
import { reportJson } from "../../../src/spec/report/json"
import { reportMarkdown } from "../../../src/spec/report/markdown"
import { reportText } from "../../../src/spec/report/text"

// Each format constant and tail is evidence the report names with its reason,
// in text, markdown and JSON; a vector with neither names none.

const REPORT_BP_C: string = `{
  "contract": "bp",
  "source": {"title": "T", "rfc": 9999},
  "target": {"module": "nish/x"},
  "requirements": [{"id": "R1", "section": "2", "level": "MUST", "quote": "It MUST work."}],
  "functions": [{"name": "f", "params": [{"name": "a", "type": "bytes"}, {"name": "b", "type": "bytes"}], "returns": "bytes"}],
  "clauses": [
    {"kind": "vector", "id": "V-FMT", "title": "t", "covers": ["R1"], "section": "2", "source": {"cite": {"section": "2"}},
     "call": "f",
     "args": [{"hex": "aa"}, {"concat": [{"hex": "bb", "label": "B"}, {"hex": "02", "format": "a length byte"}]}],
     "expect": {"concat": [{"hex": "04", "format": "an uncompressed point\\u001b[2J"}, {"hex": "cc", "label": "X"}]}},
    {"kind": "vector", "id": "V-TAIL", "title": "t", "covers": ["R1"], "section": "2", "source": {"cite": {"section": "2"}},
     "call": "f", "args": [{"hex": "aa", "label": "P"}, {"hex": "bb"}], "expect": {"hex": "dd"},
     "tail": {"arg": 1, "bytes": 1, "reason": "the tag ends the packet"}},
    {"kind": "vector", "id": "V-NONE", "title": "t", "covers": ["R1"], "section": "2", "source": {"cite": {"section": "2"}},
     "call": "f", "args": [{"hex": "aa"}, {"concat": [{"hex": "bb"}, {"hex": "cc"}]}], "expect": {"hex": "dd"}}
  ]
}`

/** A context holding the test contract, with nothing found. */
const reportBpTestCtx = (): CheckContext => {
  const ctx = new CheckContext("bp.json", ".")
  ctx.contract = contractParse(REPORT_BP_C, "bp").expect("parse")
  ctx.coverage.set("R1", ["V-FMT", "V-TAIL", "V-NONE"])
  return ctx
}

/** The clause `id`'s formats as `at=hex:reason`, joined by " | ". */
const reportBpTestFormats = (ctx: CheckContext, i: i32): string =>
  reportFormats(ctx.contract.clauses[i])
    .map((f: ReportFormat): string => `${f.at}=${f.hex}:${f.reason}`)
    .join(" | ")

/** The report's byte-part evidence, in every format. */
export const main = (): i32 => {
  const t = new Suite("spec/report byte parts")
  const ctx = reportBpTestCtx()
  t.eqStr(
    "the formats, the arguments' then the expect's",
    reportBpTestFormats(ctx, 0),
    "args[1].concat[1]=02:a length byte | expect.concat[0]=04:an uncompressed point\u001b[2J",
  )
  t.eqStr("a tail has no format", reportBpTestFormats(ctx, 1), "")
  t.eqStr("a concat with no format part", reportBpTestFormats(ctx, 2), "")
  t.eqStr(
    "the format lines",
    reportByteParts(ctx.contract.clauses[0]).join("\n"),
    "format args[1].concat[1] = 02: a length byte\nformat expect.concat[0] = 04: an uncompressed point\u001b[2J",
  )
  t.eqStr(
    "the tail line",
    reportByteParts(ctx.contract.clauses[1]).join("\n"),
    "tail: expect is the last 1 bytes of the value args[1] is printed in: the tag ends the packet",
  )
  t.eqStr("no line for a vector with neither", `${reportByteParts(ctx.contract.clauses[2]).length}`, "0")

  const text = reportText(ctx, new CheckReport(new SampleTable()))
  t.ok("text: the format line", text.indexOf("      V-FMT format args[1].concat[1] = 02: a length byte\n") >= 0)
  t.ok(
    "text: the reason escaped",
    text.indexOf("      V-FMT format expect.concat[0] = 04: an uncompressed point\\x1b[2J\n") >= 0,
  )
  t.ok("text: no escape printed", text.indexOf("\u001b") < 0)
  t.ok(
    "text: the tail line",
    text.indexOf(
      "      V-TAIL tail: expect is the last 1 bytes of the value args[1] is printed in: the tag ends the packet\n",
    ) >= 0,
  )
  t.ok("text: nothing for V-NONE", text.indexOf("V-NONE format") < 0 && text.indexOf("V-NONE tail") < 0)

  const md = reportMarkdown(ctx, new CheckReport(new SampleTable()))
  t.ok(
    "markdown: the format beside the evidence",
    md.indexOf("; format args\\[1].concat\\[1] = 02: a length byte; ") >= 0,
  )
  t.ok(
    "markdown: the tail beside the evidence",
    md.indexOf("; tail: expect is the last 1 bytes of the value args\\[1] is printed in: the tag ends the packet |") >=
      0,
  )

  const json = reportJson(ctx, new CheckReport(new SampleTable()))
  t.ok(
    "json: each vector's byte parts",
    json.endsWith(
      ',"byteParts":{"V-FMT":{"formats":[{"at":"args[1].concat[1]","hex":"02","reason":"a length byte"},{"at":"expect.concat[0]","hex":"04","reason":"an uncompressed point\\u001b[2J"}],"tail":null},"V-TAIL":{"formats":[],"tail":{"arg":1,"bytes":1,"reason":"the tag ends the packet"}}}}',
    ),
  )
  t.ok("json: nothing for V-NONE", json.indexOf('"V-NONE":{"formats"') < 0)
  return t.done()
}
