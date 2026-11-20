import { Suite } from "nish/testing"
import { trim } from "nish/text"
import { joinPath, makeTempDir } from "../../../src/core/fs"
import { runProcess } from "../../../src/core/process"
import { CheckContext, CheckSourceRun } from "../../../src/spec/check"
import { contractParse } from "../../../src/spec/contract/read"
import { Contract } from "../../../src/spec/contract/types"
import { gateRunArgv, gateRunCommands, gateRunJudge, gateRunSources } from "../../../src/spec/gates/run"

/** A contract whose vectors' expected values come from commands. */
const RUN_TEST_C: string = `{
  "contract": "c1",
  "source": {"title": "T", "rfc": 9999},
  "target": {"module": "nish/x"},
  "requirements": [{"id": "R1", "section": "2", "level": "MUST", "quote": "Q"}],
  "functions": [{"name": "f", "params": [{"name": "a", "type": "string"}], "returns": "bytes"},
    {"name": "g", "params": [{"name": "a", "type": "string"}], "returns": "string"}],
  "clauses": [
    {"kind": "vector", "id": "V-HEX", "title": "t", "covers": ["R1"], "section": "2",
     "source": {"command": "printf 'AB\\\\n'"}, "call": "f", "args": [{"str": "a"}], "expect": {"hex": "ab"}},
    {"kind": "vector", "id": "V-DIFF", "title": "t", "covers": ["R1"], "section": "2",
     "source": {"command": "echo 01"}, "call": "f", "args": [{"str": "b"}], "expect": {"hex": "00"}},
    {"kind": "vector", "id": "V-EXIT", "title": "t", "covers": ["R1"], "section": "2",
     "source": {"command": "echo boom >&2; exit 3"}, "call": "f", "args": [{"str": "c"}], "expect": {"hex": "00"}},
    {"kind": "vector", "id": "V-CWD", "title": "t", "covers": ["R1"], "section": "2",
     "source": {"command": "cat marker.txt"}, "call": "g", "args": [{"str": "d"}], "expect": {"str": "here"}},
    {"kind": "vector", "id": "V-FORK", "title": "t", "covers": ["R1"], "section": "2",
     "source": {"command": "sleep 60 & echo $! > gc.pid; sleep 60"}, "call": "f", "args": [{"str": "e"}],
     "expect": {"hex": "00"}}
  ]
}`

/** A contract whose command sources expect each kind a command prints as text. */
const RUN_TEST_VALUES: string = `{
  "contract": "c2",
  "source": {"title": "T", "rfc": 9999},
  "target": {"module": "nish/x"},
  "requirements": [{"id": "R1", "section": "2", "level": "MUST", "quote": "Q"}],
  "functions": [{"name": "u", "params": [], "returns": "u64"}, {"name": "i", "params": [], "returns": "i64"},
    {"name": "b", "params": [], "returns": "bool"}, {"name": "n", "params": [], "returns": "bytes?"}],
  "clauses": [
    {"kind": "vector", "id": "V-WIDE", "title": "t", "covers": ["R1"], "section": "2",
     "source": {"command": "x"}, "call": "u", "args": [], "expect": {"int": "151288809941952652"}},
    {"kind": "vector", "id": "V-MAX", "title": "t", "covers": ["R1"], "section": "2",
     "source": {"command": "x"}, "call": "u", "args": [], "expect": {"int": "18446744073709551615"}},
    {"kind": "vector", "id": "V-NEG", "title": "t", "covers": ["R1"], "section": "2",
     "source": {"command": "x"}, "call": "i", "args": [], "expect": {"int": -1}},
    {"kind": "vector", "id": "V-ZERO", "title": "t", "covers": ["R1"], "section": "2",
     "source": {"command": "x"}, "call": "u", "args": [], "expect": {"int": 0}},
    {"kind": "vector", "id": "V-TEN", "title": "t", "covers": ["R1"], "section": "2",
     "source": {"command": "x"}, "call": "u", "args": [], "expect": {"int": 10}},
    {"kind": "vector", "id": "V-FALSE", "title": "t", "covers": ["R1"], "section": "2",
     "source": {"command": "x"}, "call": "b", "args": [], "expect": {"bool": false}},
    {"kind": "vector", "id": "V-TRUE", "title": "t", "covers": ["R1"], "section": "2",
     "source": {"command": "x"}, "call": "b", "args": [], "expect": {"bool": true}},
    {"kind": "vector", "id": "V-NULL", "title": "t", "covers": ["R1"], "section": "2",
     "source": {"command": "x"}, "call": "n", "args": [], "expect": {"null": true}}
  ]
}`

/** How the gate judges `out` printed for the clause `id` of RUN_TEST_VALUES: pass, or its detail. */
const runTestValue = (c: Contract, id: string, out: string): string => {
  for (const k of c.clauses) {
    if (k.id === id) {
      const r = gateRunJudge(k, 0, out, "", false, 5)
      return r.outcome === "pass" ? "pass" : r.detail
    }
  }
  return `no clause ${id}`
}

/** A context holding the test contract, as if it were in `dir`. */
const runTestCtx = (dir: string): CheckContext => {
  const ctx = new CheckContext(joinPath(dir, "c1.json"), dir)
  ctx.contract = contractParse(RUN_TEST_C, "c1").expect("parse")
  return ctx
}

/** Each run as `id outcome: detail`. */
const runTestLines = (ctx: CheckContext): string[] =>
  ctx.sourceRuns.map((r: CheckSourceRun): string => `${r.clause} ${r.outcome}: ${r.detail}`)

/** Whether a process is gone: absent, or a zombie no one has reaped. */
const runTestGone = (pid: string): boolean => {
  const r = runProcess(["ps", "-o", "stat=", "-p", pid], "", 5000).expect("ps")
  const stat = trim(r.stdout)
  return stat === "" || stat.startsWith("Z")
}

/** The run-sources gate. */
export const main = (): i32 => {
  const t = new Suite("spec/gates/run")
  t.eqLines("the argv runs the command from its directory under timeout", gateRunArgv("echo hi", "/d", 1500), [
    "timeout",
    "-s",
    "KILL",
    "1.500",
    "sh",
    "-c",
    'cd -- "$0" && exec sh -c "$1"',
    "/d",
    "echo hi",
  ])
  t.eqStr("whole seconds", gateRunArgv("x", "/d", 30000)[3], "30.000")
  t.eqStr("milliseconds", gateRunArgv("x", "/d", 7)[3], "0.007")

  const dir = makeTempDir("vector-run-test-").expect("tmp")
  writeFileSync(joinPath(dir, "marker.txt"), "here\n")

  const off = runTestCtx(dir)
  t.eqLines(
    "the command sources",
    gateRunCommands(off.contract).map((k): string => k.id),
    ["V-HEX", "V-DIFF", "V-EXIT", "V-CWD", "V-FORK"],
  )
  t.ok("no finding of its own", gateRunSources(off).length === 0)
  t.eqLines("without --run-sources nothing runs", runTestLines(off), [
    "V-HEX not run: ",
    "V-DIFF not run: ",
    "V-EXIT not run: ",
    "V-CWD not run: ",
    "V-FORK not run: ",
  ])

  const ctx = runTestCtx(dir)
  ctx.runSources = true
  ctx.runTimeoutMs = 1000
  const started = monotonicNanos()
  const own = gateRunSources(ctx)
  const elapsedMs = (monotonicNanos() - started) / 1000000
  t.ok("still no finding of its own", own.length === 0)
  t.eqLines("each command judged", runTestLines(ctx), [
    "V-HEX pass: ",
    'V-DIFF fail: printed "01", the vector expects "00"',
    "V-EXIT fail: exited 3 (boom)",
    "V-CWD pass: ",
    "V-FORK fail: timed out after 1000 ms",
  ])
  t.ok("the deadline held", elapsedMs < 4000)
  t.ok("no tool failure", ctx.toolFailure === null)
  const pid = readFileSyncOrNull(joinPath(dir, "gc.pid"))
  t.ok("the forking command ran", pid !== null)
  if (pid !== null) {
    t.ok("its sleeping grandchild died with it", runTestGone(trim(pid)))
  }

  const k = ctx.contract.clauses[0]
  t.eqStr("a timeout wins over the status", gateRunJudge(k, 137, "", "", true, 5).detail, "timed out after 5 ms")
  t.eqStr("a bare non-zero exit", gateRunJudge(k, 2, "", "", false, 5).detail, "exited 2")
  t.eqStr("whitespace around the output is trimmed", gateRunJudge(k, 0, "  ab \n", "", false, 5).outcome, "pass")
  const long = gateRunJudge(
    k,
    0,
    "0123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789",
    "",
    false,
    5,
  ).detail
  t.ok("a long output is cut", long.startsWith('printed "01234') && long.indexOf('...", the vector') > 0)

  // Each kind is compared with its one canonical text, exactly.
  const values = contractParse(RUN_TEST_VALUES, "c2").expect("parse")
  const judged: string[][] = [
    ["V-WIDE", "151288809941952652\n", "pass"],
    ["V-WIDE", "151288809941952653", 'printed "151288809941952653", the vector expects "151288809941952652"'],
    ["V-WIDE", "+151288809941952652", 'printed "+151288809941952652", the vector expects "151288809941952652"'],
    ["V-WIDE", "151288809941952652 ok", 'printed "151288809941952652 ok", the vector expects "151288809941952652"'],
    ["V-MAX", "18446744073709551615", "pass"],
    ["V-MAX", "-1", 'printed "-1", the vector expects "18446744073709551615"'],
    ["V-NEG", " -1 ", "pass"],
    ["V-NEG", "18446744073709551615", 'printed "18446744073709551615", the vector expects "-1"'],
    ["V-ZERO", "0", "pass"],
    ["V-ZERO", "00", 'printed "00", the vector expects "0"'],
    ["V-ZERO", "-0", 'printed "-0", the vector expects "0"'],
    ["V-TEN", "10", "pass"],
    ["V-TEN", "010", 'printed "010", the vector expects "10"'],
    ["V-TEN", "+10", 'printed "+10", the vector expects "10"'],
    ["V-TEN", "10.0", 'printed "10.0", the vector expects "10"'],
    ["V-TEN", "0xa", 'printed "0xa", the vector expects "10"'],
    ["V-FALSE", "false\n", "pass"],
    ["V-FALSE", "False", 'printed "False", the vector expects "false"'],
    ["V-FALSE", "0", 'printed "0", the vector expects "false"'],
    ["V-TRUE", "true", "pass"],
    ["V-TRUE", "True", 'printed "True", the vector expects "true"'],
    ["V-TRUE", "TRUE", 'printed "TRUE", the vector expects "true"'],
    ["V-NULL", "null", "pass"],
    ["V-NULL", "None", 'printed "None", the vector expects "null"'],
    ["V-NULL", "", 'printed "", the vector expects "null"'],
    ["V-NULL", "NULL", 'printed "NULL", the vector expects "null"'],
  ]
  for (const j of judged) {
    t.eqStr(`${j[0]} printing "${trim(j[1])}"`, runTestValue(values, j[0], j[1]), j[2])
  }

  runProcess(["rm", "-rf", dir], "", 5000).expect("rm")
  return t.done()
}
