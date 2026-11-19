import { Suite } from "nish/testing"
import { makeTempDir } from "../../../src/core/fs"
import { SampleTable } from "../../../src/spec/check"
import { contractParse } from "../../../src/spec/contract/read"
import { Contract, FnSig } from "../../../src/spec/contract/types"
import { EmitOptions, emitProgram } from "../../../src/spec/emit/emit"
import { emitWriteFile } from "../../../src/spec/emit/file"
import { emitTargetWindowRefusal } from "../../../src/spec/emit/target"
import { runFormat } from "../../../src/spec/run/command"
import { RunOutcome, runTestFile } from "../../../src/spec/run/run"

/**
 * A contract over windows: one function sums a window's bytes, one adds two
 * windows' sums to a plain u32 between them. The checksum fixture's windows
 * also run through the binary in tests/cli/run-checksum-window.
 */
const windowEmitContract = (extra: string, clause: string): string => `{
  "contract": "window-emit",
  "source": {"title": "T", "rfc": 9999},
  "target": {"module": "fixture/window"},
  "requirements": [{"id": "R-1", "section": "1", "level": "MUST", "quote": "It MUST sum."}],
  "functions": [
    {"name": "windowSum", "params": [{"name": "d", "type": "bytes", "form": "window"}], "returns": "u32"},
    {"name": "windowTwo", "params": [{"name": "a", "type": "bytes", "form": "window"}, {"name": "n", "type": "u32"},
      {"name": "b", "type": "bytes", "form": "window"}], "returns": "u32"}${extra}
  ],
  "clauses": [${clause}
    {"kind": "vector", "id": "V-SUM", "title": "three bytes", "covers": ["R-1"], "source": {"cite": {"section": "1"}},
     "call": "windowSum", "args": [{"hex": "010203"}], "expect": {"int": 6}},
    {"kind": "vector", "id": "V-SUM-EMPTY", "title": "no bytes", "covers": ["R-1"], "source": {"cite": {"section": "1"}},
     "call": "windowSum", "args": [{"hex": ""}], "expect": {"int": 0}},
    {"kind": "vector", "id": "V-TWO", "title": "two windows", "covers": ["R-1"], "source": {"cite": {"section": "1"}},
     "call": "windowTwo", "args": [{"hex": "0102"}, {"int": 100}, {"hex": "03"}], "expect": {"int": 106}}
  ]
}`

/**
 * The module the contract tests: right when `bug` is "", or with one function
 * wrong: "offset" reads from 0, not `off`, "length" reads one byte past
 * `len`, and "second" ignores the second window's offset.
 */
const windowEmitModule = (bug: string): string => `export const windowSum = (buf: u8[], off: i32, len: i32): u32 => {
  let s: u32 = 0
  const from = ${bug === "offset" ? "0" : "off"}
  for (let i = from; i < from + len${bug === "length" ? " + 1" : ""}; i++) {
    s += toU32(buf[i])
  }
  return s
}

export const windowTwo = (a: u8[], ao: i32, al: i32, n: u32, b: u8[], bo: i32, bl: i32): u32 =>
  windowSum(a, ao, al) + n + windowSum(b, ${bug === "second" ? "0" : "bo"}, bl)
`

/**
 * The verdict of the emitted test run against the module with `bug`, then
 * each failed clause as `id: detail`, or the failure.
 */
const windowEmitRun = (c: Contract, dir: string, program: string, bug: string): string => {
  const wrote = emitWriteFile(`${dir}/window.ts`, windowEmitModule(bug))
  if (wrote.isErr()) {
    return wrote.error
  }
  const file = `${dir}/window_check.ts`
  const w = emitWriteFile(file, program)
  if (w.isErr()) {
    return w.error
  }
  const r = runTestFile(c, file, ".nish/bin/nish", 110000, false)
  if (r.isErr()) {
    return r.error
  }
  if (r.value.verdict.status === "ERROR") {
    return runFormat(r.value, "text")
  }
  let out = r.value.verdict.status
  for (const k of r.value.clauses) {
    if (k.outcome === RunOutcome.Fail) {
      out = `${out}\n${k.id}: ${k.detail}`
    }
  }
  return out
}

/** A function `f` with these parameters, as contract JSON, and its result. */
const windowEmitSig = (params: string, returns: string): FnSig => {
  const c = contractParse(
    `{"contract": "s", "source": {"title": "T", "rfc": 9999}, "target": {"module": "m"}, "requirements": [],
      "functions": [{"name": "f", "params": [${params}], "returns": "${returns}"}], "clauses": []}`,
    "s",
  ).expect("parse a signature")
  return c.functions[0]
}

/** The contract emitted for the local module, or the refusal's lines. */
const windowEmitProgram = (c: Contract): string => {
  const opts = new EmitOptions("0000000000000000000000000000000000000000000000000000000000000000")
  opts.localModules = ["fixture/window"]
  opts.localImports = ["./window"]
  const p = emitProgram(c, new SampleTable(), opts)
  return p.isOk() ? p.value : `REFUSED\n${p.error.join("\n")}`
}

/** Windows in the Nish emitter, and their refusal by the others. */
export const main = (): i32 => {
  const t = new Suite("spec/emit window")

  const win = '{"name": "d", "type": "bytes", "form": "window"}'
  const params: string[] = [
    win,
    `{"name": "n", "type": "u32"}, ${win}`,
    '{"name": "d", "type": "bytes"}',
    "",
    '{"name": "k", "type": "secret-bytes"}, {"name": "d", "type": "bytes"}',
    `${win}, {"name": "n", "type": "u32"}, {"name": "e", "type": "bytes", "form": "window"}`,
  ]
  const want: string[] = [
    "f: d is a window (buf, off, len), which is not emitted for Rust yet; emit the Nish test",
    "f: d is a window (buf, off, len), which is not emitted for Rust yet; emit the Nish test",
    "",
    "",
    "",
    "f: d, e are windows (buf, off, len), which is not emitted for Rust yet; emit the Nish test",
  ]
  for (let i = 0; i < params.length; i++) {
    t.eqStr(`(${params[i]})`, emitTargetWindowRefusal(windowEmitSig(params[i], "u32"), "Rust") ?? "", want[i])
  }
  t.contains(
    "the language is named",
    emitTargetWindowRefusal(windowEmitSig(win, "u32"), "Go") ?? "",
    "not emitted for Go yet",
  )

  const c = contractParse(windowEmitContract("", ""), "window-emit").expect("parse the window contract")
  const program = windowEmitProgram(c)
  t.ok("the program emits", !program.startsWith("REFUSED"))
  t.contains(
    "a window sits between guard bytes",
    program,
    "const w_d: u8[] = concatBytes(concatBytes(fillBytes(0xa5, 3), a_d), fillBytes(0x5a, 3));",
  )
  t.contains("and is passed at offset 3 with its length", program, "const r: u32 = windowSum(w_d, 3, a_d.length);")
  t.contains(
    "two windows keep their places",
    program,
    "const r: u32 = windowTwo(w_a, 3, a_a.length, a_n, w_b, 3, a_b.length);",
  )
  t.contains("a vector goes through the wrapper", program, 'plain_windowSum(unhex("010203"))')
  t.contains(
    "the wrapper says why",
    program,
    "/** windowSum on plain bytes: a window is passed as (buf, off, len) between guard bytes. */",
  )
  t.ok("no secret means no nish:secret", program.indexOf("nish:secret") < 0)

  const keyed = contractParse(
    windowEmitContract(
      ',\n    {"name": "windowKeyed", "params": [{"name": "k", "type": "secret-bytes"}, {"name": "d", "type": "bytes", "form": "window"}], "returns": "u32"}',
      '\n    {"kind": "vector", "id": "V-KEYED", "title": "keyed", "covers": ["R-1"], "source": {"cite": {"section": "1"}}, "call": "windowKeyed", "args": [{"hex": "00"}, {"hex": "01"}], "expect": {"int": 1}},',
    ),
    "window-emit",
  ).expect("parse the keyed contract")
  const both = windowEmitProgram(keyed)
  t.contains("a secret beside a window is still a copy", both, "const s_k: Secret<u8[]> = secret(copyBytes(a_k));")
  t.contains(
    "and the window is still guarded",
    both,
    "const r: u32 = windowKeyed(s_k, w_d, 3, a_d.length);\n  wipe(s_k);",
  )
  t.contains(
    "the wrapper gives both reasons",
    both,
    "/** windowKeyed on plain bytes: secrets are copied in, wiped after; a window is passed as (buf, off, len) between guard bytes. */",
  )
  t.contains("nish:secret is imported", both, 'import { Secret, secret, wipe } from "nish:secret";')

  const named = contractParse(
    windowEmitContract(',\n    {"name": "plain_windowSum", "params": [], "returns": "u32"}', ""),
    "window-emit",
  ).expect("parse the colliding contract")
  t.contains(
    "a window's wrapper name that is taken is refused",
    windowEmitProgram(named),
    "windowSum: its wrapper would be plain_windowSum, which is a contract function's name",
  )

  const dir = makeTempDir("vector-window-emit-").expect("a scratch directory")
  t.eqStr("the right module satisfies it", windowEmitRun(c, dir, program, ""), "SATISFIED")
  const bugs: string[] = ["offset", "length", "second"]
  const failed: string[] = [
    'V-SUM: expected "6", got "495"\nV-TWO: expected "106", got "595"',
    'V-SUM: expected "6", got "96"\nV-SUM-EMPTY: expected "0", got "90"\nV-TWO: expected "106", got "286"',
    'V-TWO: expected "106", got "268"',
  ]
  for (let i = 0; i < bugs.length; i++) {
    t.eqStr(
      `a module with ${bugs[i]} wrong violates it`,
      windowEmitRun(c, dir, program, bugs[i]),
      `VIOLATED\n${failed[i]}`,
    )
  }
  return t.done()
}
