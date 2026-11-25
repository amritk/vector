import { Suite } from "nish/testing"
import { makeTempDir } from "../../../src/core/fs"
import { Sample, SampleTable, checkAddSample } from "../../../src/spec/check"
import { contractParse } from "../../../src/spec/contract/read"
import { Contract, FnSig, LitKind, Literal } from "../../../src/spec/contract/types"
import { EmitOptions, emitProgram } from "../../../src/spec/emit/emit"
import { emitWriteFile } from "../../../src/spec/emit/file"
import { emitTargetOutRefusal } from "../../../src/spec/emit/target"
import { runFormat } from "../../../src/spec/run/command"
import { RunOutcome, runTestFile } from "../../../src/spec/run/run"
import { specTestRepeat } from "../repeat"

/**
 * A contract over out buffers: outCopy writes its bytes back (vector, iterated
 * vector and property), outMaybe writes them and a zero, or nothing for no
 * bytes (a `bytes?` result), and outWin writes a u32's low byte then a
 * window's bytes, with the out buffer first.
 */
const outEmitContract = (extra: string, clause: string): string => `{
  "contract": "out-emit",
  "source": {"title": "T", "rfc": 9999},
  "target": {"module": "fixture/out"},
  "requirements": [{"id": "R-1", "section": "1", "level": "MUST", "quote": "It MUST write."}],
  "functions": [
    {"name": "outCopy", "params": [{"name": "d", "type": "bytes"}], "returns": "bytes",
      "out": {"at": 1, "capacity": "d.length"}},
    {"name": "outMaybe", "params": [{"name": "d", "type": "bytes"}], "returns": "bytes?",
      "out": {"at": 1, "capacity": "d.length + 1"}},
    {"name": "outWin", "params": [{"name": "n", "type": "u32"}, {"name": "d", "type": "bytes", "form": "window"}],
      "returns": "bytes", "out": {"at": 0, "capacity": "1 + d.length"}}${extra}
  ],
  "clauses": [${clause}
    {"kind": "vector", "id": "V-COPY", "title": "three bytes", "covers": ["R-1"], "source": {"cite": {"section": "1"}},
     "call": "outCopy", "args": [{"hex": "010203"}], "expect": {"hex": "010203"}},
    {"kind": "vector", "id": "V-COPY-EMPTY", "title": "no bytes", "covers": ["R-1"], "source": {"cite": {"section": "1"}},
     "call": "outCopy", "args": [{"hex": ""}], "expect": {"hex": ""}},
    {"kind": "vector", "id": "V-COPY-IT", "title": "copied three times", "covers": ["R-1"], "source": {"cite": {"section": "1"}},
     "call": "outCopy", "args": [{"hex": "0a0b"}], "expect": {"hex": "0a0b"},
     "iterate": {"count": 3, "names": ["d"], "next": [{"call": "outCopy", "args": [{"var": "d"}]}]}},
    {"kind": "vector", "id": "V-MAYBE", "title": "a byte and a zero", "covers": ["R-1"], "source": {"cite": {"section": "1"}},
     "call": "outMaybe", "args": [{"hex": "07"}], "expect": {"hex": "0700"}},
    {"kind": "vector", "id": "V-MAYBE-NULL", "title": "nothing", "covers": ["R-1"], "source": {"cite": {"section": "1"}},
     "call": "outMaybe", "args": [{"hex": ""}], "expect": {"null": true}},
    {"kind": "vector", "id": "V-WIN", "title": "a byte, then the window", "covers": ["R-1"], "source": {"cite": {"section": "1"}},
     "call": "outWin", "args": [{"int": 258}, {"hex": "0c0d"}], "expect": {"hex": "020c0d"}},
    {"kind": "property", "id": "P-COPY", "title": "a copy is its input", "covers": ["R-1"],
     "forall": [{"name": "d", "type": "bytes", "minLen": 0, "maxLen": 4}],
     "assert": {"op": "==", "args": [{"call": "outCopy", "args": [{"var": "d"}]}, {"var": "d"}]}}
  ]
}`

/**
 * The module the contract tests: right when `bug` is "", or with one function
 * wrong. outCopy's bugs: "over" returns an end one past its capacity, "under"
 * an end before `at`, "before" writes the byte before `at`, "past" writes the
 * byte at its end, "tail" the last guard byte after its capacity, and "byte"
 * flips its first byte's low bit. "null" makes outMaybe always return -1, and
 * "window" makes outWin read from 0, not `off`. outBig and outHuge copy
 * their bytes, with no bug.
 */
const outEmitModule = (bug: string): string => `export const outCopy = (d: u8[], out: u8[], at: i32): i32 => {
  for (let i: i32 = 0; i < toI32(d.length); i += 1) {
    out[at + i] = ${bug === "byte" ? "i === 0 ? d[i] ^ toU8(1) : d[i]" : "d[i]"}
  }
  ${bug === "before" ? "out[at - 1] = toU8(0)" : bug === "past" ? "out[at + toI32(d.length)] = toU8(0)" : bug === "tail" ? "out[at + toI32(d.length) + 4] = toU8(0)" : ""}
  return ${bug === "over" ? "at + toI32(d.length) + 1" : bug === "under" ? "at - 1" : "at + toI32(d.length)"}
}

export const outMaybe = (d: u8[], out: u8[], at: i32): i32 => {
  if (${bug === "null" ? "true" : "d.length === 0"}) {
    return -1
  }
  for (let i: i32 = 0; i < toI32(d.length); i += 1) {
    out[at + i] = d[i]
  }
  out[at + toI32(d.length)] = toU8(0)
  return at + toI32(d.length) + 1
}

export const outBig = (d: u8[], out: u8[], at: i32): i32 => {
  for (let i: i32 = 0; i < toI32(d.length); i += 1) {
    out[at + i] = d[i]
  }
  return at + toI32(d.length)
}

export const outHuge = (d: u8[], out: u8[], at: i32): i32 => outBig(d, out, at)

export const outInf = (d: u8[], out: u8[], at: i32): i32 => outBig(d, out, at)

export const outNan = (d: u8[], out: u8[], at: i32): i32 => outBig(d, out, at)

export const outWin = (out: u8[], at: i32, n: u32, buf: u8[], off: i32, len: i32): i32 => {
  out[at] = toU8(n & 255)
  for (let i: i32 = 0; i < len; i += 1) {
    out[at + 1 + i] = buf[${bug === "window" ? "" : "off + "}i]
  }
  return at + 1 + len
}
`

/**
 * The verdict of the emitted test run against the module with `bug`, then
 * each failed clause as `id: detail`, or the failure.
 */
const outEmitRun = (c: Contract, dir: string, program: string, bug: string): string => {
  const wrote = emitWriteFile(`${dir}/out.ts`, outEmitModule(bug))
  if (wrote.isErr()) {
    return wrote.error
  }
  const file = `${dir}/out_check.ts`
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

/** A function `f` with these parameters and this out buffer (JSON, or "" for none), as the contract reads it. */
const outEmitSig = (params: string, out: string): FnSig => {
  const c = contractParse(
    `{"contract": "s", "source": {"title": "T", "rfc": 9999}, "target": {"module": "m"}, "requirements": [],
      "functions": [{"name": "f", "params": [${params}], "returns": "bytes"${out}}], "clauses": []}`,
    "s",
  ).expect("parse a signature")
  return c.functions[0]
}

/** The contract emitted for the local module, with P-COPY's samples, or the refusal's lines. */
const outEmitProgram = (c: Contract): string => {
  const opts = new EmitOptions("0000000000000000000000000000000000000000000000000000000000000000")
  opts.localModules = ["fixture/out"]
  opts.localImports = ["./out"]
  const samples = new SampleTable()
  checkAddSample(samples, new Sample("P-COPY", [new Literal(LitKind.Hex, "")], "no bytes"))
  checkAddSample(samples, new Sample("P-COPY", [new Literal(LitKind.Hex, "ff00ff00")], "the longest"))
  const p = emitProgram(c, samples, opts)
  return p.isOk() ? p.value : `REFUSED\n${p.error.join("\n")}`
}

/** `n` bytes counting up from 0, as hex. */
const outEmitHex = (n: i32): string => {
  const digits = "0123456789abcdef"
  let out = ""
  for (let i: i32 = 0; i < n; i++) {
    const b: i32 = i % 256
    out = `${out}${digits.substring(b / 16, b / 16 + 1)}${digits.substring(b % 16, (b % 16) + 1)}`
  }
  return out
}

/** Out buffers in the Nish emitter: the guarded write, and each way a write goes wrong. */
export const main = (): i32 => {
  const t = new Suite("spec/emit out")
  if (!isExecutableSync(".nish/libexec/nish")) {
    t.skip("out buffers in the Nish emitter", "no .nish/ install: run bash scripts/fetch-nish.sh")
    return t.done()
  }

  const outs: string[] = [
    ', "out": {"at": 1, "capacity": "d.length"}',
    ', "out": {"at": 0, "capacity": "8"}',
    "",
    ', "out": {"at": 0, "capacity": "d.length"}',
  ]
  const params: string[] = [
    '{"name": "d", "type": "bytes"}',
    "",
    '{"name": "d", "type": "bytes"}',
    '{"name": "d", "type": "bytes", "form": "window"}',
  ]
  const refused =
    "f: its result is an out buffer (out, at) -> end, which is not emitted for Rust yet; emit the Nish test"
  const want: string[] = [refused, refused, "", refused]
  for (let i = 0; i < outs.length; i++) {
    t.eqStr(`(${params[i]})${outs[i]}`, emitTargetOutRefusal(outEmitSig(params[i], outs[i]), "Rust") ?? "", want[i])
  }
  t.contains(
    "the language is named",
    emitTargetOutRefusal(outEmitSig("", outs[1]), "Python") ?? "",
    "not emitted for Python yet",
  )

  const parsed = contractParse(outEmitContract("", ""), "out-emit")
  if (parsed.isErr()) {
    t.eqStr("the out contract parses", parsed.error.join("\n"), "")
    return t.done()
  }
  const c = parsed.value
  const program = outEmitProgram(c)
  t.ok("the program emits", !program.startsWith("REFUSED"))
  t.contains(
    "the capacity is read from the arguments",
    program,
    'const o_cap: i32 = of.cap("outCopy", toF64(a_d.length));',
  )
  t.contains("the buffer has guard bytes on each side", program, "const o_out: u8[] = fillBytes(0xa5, o_cap + 10);")
  t.contains("the buffer is passed after d", program, "const o_end: i32 = outCopy(a_d, o_out, 5);")
  t.contains(
    "and before the others when it comes first",
    program,
    "const o_end: i32 = outWin(o_out, 5, a_n, w_d, 3, a_d.length);",
  )
  t.contains("the result is [at, end)", program, 'return of.take("outCopy", o_out, 5, o_end, o_cap);')
  t.contains("a negative end is a null", program, "  if (o_end < 0) {\n    return null;\n  }")
  t.contains("the wrapper takes the fault first", program, "const plain_outCopy = (of: OutFault, a_d: u8[]): u8[] =>")
  t.contains(
    "the wrapper says why",
    program,
    "/** outCopy on plain bytes: the out buffer is passed as (out, at) between guard bytes, and [at, end) is the result. */",
  )
  t.contains(
    "a vector checks the fault before its value",
    program,
    '  const of: OutFault = new OutFault();\n  const o_r = plain_outCopy(of, unhex("010203"));\n  if (of.why.length > 0) {',
  )

  const keyed = contractParse(
    outEmitContract(
      ',\n    {"name": "outKeyed", "params": [{"name": "k", "type": "secret-bytes"}, {"name": "d", "type": "bytes"}], "returns": "bytes", "out": {"at": 2, "capacity": "d.length"}}',
      '\n    {"kind": "vector", "id": "V-KEYED", "title": "keyed", "covers": ["R-1"], "source": {"cite": {"section": "1"}}, "call": "outKeyed", "args": [{"hex": "00"}, {"hex": "01"}], "expect": {"hex": "01"}},',
    ),
    "out-emit",
  ).expect("parse the keyed contract")
  const both = outEmitProgram(keyed)
  t.contains(
    "a secret is wiped after the write, before the result is taken",
    both,
    "const o_end: i32 = outKeyed(s_k, a_d, o_out, 5);\n  wipe(s_k);\n  return of.take(",
  )
  t.contains(
    "a secret is wiped on the early return too, at the if's indent",
    both,
    "  if (o_cap < 0 || o_cap > 1048576) {\n    wipe(s_k);\n    return fillBytes(0, 0);\n  }\n  const o_out",
  )
  t.contains(
    "the wrapper gives both reasons",
    both,
    "/** outKeyed on plain bytes: secrets are copied in, wiped after; the out buffer is passed as (out, at) between guard bytes, and [at, end) is the result. */",
  )

  const dir = makeTempDir("vector-out-emit-").expect("a scratch directory")
  t.eqStr("the right module satisfies it", outEmitRun(c, dir, program, ""), "SATISFIED")
  const bugs: string[] = ["over", "under", "before", "past", "tail", "byte", "null", "window"]
  const failed: string[] = [
    "V-COPY: outCopy returned end 9 outside [at, at + capacity] = [5, 8]\n" +
      "V-COPY-EMPTY: outCopy returned end 6 outside [at, at + capacity] = [5, 5]\n" +
      "V-COPY-IT: outCopy returned end 8 outside [at, at + capacity] = [5, 7]\n" +
      "P-COPY: sample 1 of 2 (len(d) = 0): outCopy returned end 6 outside [at, at + capacity] = [5, 5]",
    "V-COPY: outCopy returned end 4 outside [at, at + capacity] = [5, 8]\n" +
      "V-COPY-EMPTY: outCopy returned end 4 outside [at, at + capacity] = [5, 5]\n" +
      "V-COPY-IT: outCopy returned end 4 outside [at, at + capacity] = [5, 7]\n" +
      "P-COPY: sample 1 of 2 (len(d) = 0): outCopy returned end 4 outside [at, at + capacity] = [5, 5]",
    "V-COPY: outCopy wrote outside [at, end) = [5, 8), at 4\n" +
      "V-COPY-EMPTY: outCopy wrote outside [at, end) = [5, 5), at 4\n" +
      "V-COPY-IT: outCopy wrote outside [at, end) = [5, 7), at 4\n" +
      "P-COPY: sample 1 of 2 (len(d) = 0): outCopy wrote outside [at, end) = [5, 5), at 4",
    "V-COPY: outCopy wrote outside [at, end) = [5, 8), at 8\n" +
      "V-COPY-EMPTY: outCopy wrote outside [at, end) = [5, 5), at 5\n" +
      "V-COPY-IT: outCopy wrote outside [at, end) = [5, 7), at 7\n" +
      "P-COPY: sample 1 of 2 (len(d) = 0): outCopy wrote outside [at, end) = [5, 5), at 5",
    "V-COPY: outCopy wrote outside [at, end) = [5, 8), at 12\n" +
      "V-COPY-EMPTY: outCopy wrote outside [at, end) = [5, 5), at 9\n" +
      "V-COPY-IT: outCopy wrote outside [at, end) = [5, 7), at 11\n" +
      "P-COPY: sample 1 of 2 (len(d) = 0): outCopy wrote outside [at, end) = [5, 5), at 9",
    'V-COPY: expected "010203", got "000203"\nV-COPY-IT: expected "0a0b", got "0b0b"\n' +
      "P-COPY: sample 2 of 2 (len(d) = 4): the assertion is false",
    'V-MAYBE: expected "0700", got "null"',
    'V-WIN: expected "020c0d", got "02a5a5"',
  ]
  for (let i = 0; i < bugs.length; i++) {
    t.eqStr(
      `a module with ${bugs[i]} wrong violates it`,
      outEmitRun(c, dir, program, bugs[i]),
      `VIOLATED\n${failed[i]}`,
    )
  }

  // A capacity is computed in f64 and checked against 2^20 before the buffer
  // is made: d.length * d.length * 16 is 2^20 at 256 bytes, over it at 257,
  // and outHuge's is 2^43 at 2048 bytes, past what an i32 holds. Sixty
  // factors of 2^20 are past what an f64 holds: outInf's capacity is
  // Infinity on a byte, and outNan's, Infinity times 0, is NaN, which only a
  // check that it is at most 2^20 refuses. With no bytes, both are 0.
  const inf = `d.length * 1048576${specTestRepeat(" * 1048576", 59)}`
  const at = outEmitHex(256)
  const past = outEmitHex(257)
  const huge = outEmitHex(2048)
  const big = contractParse(
    outEmitContract(
      `,\n    {"name": "outBig", "params": [{"name": "d", "type": "bytes"}], "returns": "bytes", "out": {"at": 1, "capacity": "d.length * d.length * 16"}},\n    {"name": "outHuge", "params": [{"name": "d", "type": "bytes"}], "returns": "bytes", "out": {"at": 1, "capacity": "d.length * d.length * d.length * 1024"}},\n    {"name": "outInf", "params": [{"name": "d", "type": "bytes"}], "returns": "bytes", "out": {"at": 1, "capacity": "${inf}"}},\n    {"name": "outNan", "params": [{"name": "d", "type": "bytes"}], "returns": "bytes", "out": {"at": 1, "capacity": "${inf} * 0"}}`,
      `\n    {"kind": "vector", "id": "V-BIG-AT", "title": "at 2^20", "covers": ["R-1"], "source": {"cite": {"section": "1"}}, "call": "outBig", "args": [{"hex": "${at}"}], "expect": {"hex": "${at}"}},\n    {"kind": "vector", "id": "V-BIG-PAST", "title": "past 2^20", "covers": ["R-1"], "source": {"cite": {"section": "1"}}, "call": "outBig", "args": [{"hex": "${past}"}], "expect": {"hex": "${past}"}},\n    {"kind": "vector", "id": "V-HUGE", "title": "past i32", "covers": ["R-1"], "source": {"cite": {"section": "1"}}, "call": "outHuge", "args": [{"hex": "${huge}"}], "expect": {"hex": "${huge}"}},\n    {"kind": "vector", "id": "V-INF", "title": "past f64", "covers": ["R-1"], "source": {"cite": {"section": "1"}}, "call": "outInf", "args": [{"hex": "07"}], "expect": {"hex": "07"}},\n    {"kind": "vector", "id": "V-INF-EMPTY", "title": "0", "covers": ["R-1"], "source": {"cite": {"section": "1"}}, "call": "outInf", "args": [{"hex": ""}], "expect": {"hex": ""}},\n    {"kind": "vector", "id": "V-NAN", "title": "not a number", "covers": ["R-1"], "source": {"cite": {"section": "1"}}, "call": "outNan", "args": [{"hex": "07"}], "expect": {"hex": "07"}},\n    {"kind": "vector", "id": "V-NAN-EMPTY", "title": "0", "covers": ["R-1"], "source": {"cite": {"section": "1"}}, "call": "outNan", "args": [{"hex": ""}], "expect": {"hex": ""}},`,
    ),
    "out-emit",
  ).expect("parse the big contract")
  const bigProgram = outEmitProgram(big)
  t.contains(
    "the capacity is f64 until it is checked",
    bigProgram,
    'const o_cap: i32 = of.cap("outBig", toF64(a_d.length) * toF64(a_d.length) * toF64(16));\n  if (o_cap < 0 || o_cap > 1048576) {\n    return fillBytes(0, 0);\n  }',
  )
  t.eqStr(
    "a capacity not at most 2^20, NaN included, fails its clause, naming the function",
    outEmitRun(big, dir, bigProgram, ""),
    "VIOLATED\nV-BIG-PAST: outBig's capacity is 1056784 on this sample, not at most 2^20\n" +
      "V-HUGE: outHuge's capacity is 8796093022208 on this sample, not at most 2^20\n" +
      "V-INF: outInf's capacity is Infinity on this sample, not at most 2^20\n" +
      "V-NAN: outNan's capacity is NaN on this sample, not at most 2^20",
  )
  return t.done()
}
