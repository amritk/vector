import { Suite } from "nish/testing"
import { makeTempDir } from "../../../src/core/fs"
import { SampleTable } from "../../../src/spec/check"
import { contractParse } from "../../../src/spec/contract/read"
import { Contract, FnSig } from "../../../src/spec/contract/types"
import { EmitOptions, emitProgram } from "../../../src/spec/emit/emit"
import { emitWriteFile } from "../../../src/spec/emit/file"
import { emitTargetWordsRefusal } from "../../../src/spec/emit/target"
import { runFormat } from "../../../src/spec/run/command"
import { runTestFile } from "../../../src/spec/run/run"

/**
 * A contract over u16[] and u64[] word arrays: one function reverses a u16
 * array, one swaps a u64 array's halves or refuses an empty one, and one
 * takes an optional u64 array. The u32 case is the chacha20 fixture's, run
 * through the binary by tests/cli/run-chacha20-quarter-round.
 */
const WORDS_EMIT_C: string = `{
  "contract": "words-emit",
  "source": {"title": "T", "rfc": 9999},
  "target": {"module": "fixture/words"},
  "requirements": [{"id": "R-1", "section": "1", "level": "MUST", "quote": "It MUST round."}],
  "functions": [
    {"name": "wordsRev16", "params": [{"name": "w", "type": "words16"}], "returns": "words16"},
    {"name": "wordsSwap64", "params": [{"name": "w", "type": "words64"}], "returns": "words64?"},
    {"name": "wordsCount64", "params": [{"name": "w", "type": "words64?"}], "returns": "i32"}
  ],
  "clauses": [
    {"kind": "vector", "id": "V-REV16", "title": "u16", "covers": ["R-1"], "source": {"cite": {"section": "1"}},
     "call": "wordsRev16", "args": [{"words16": ["0x0000", "0x00ff", "0xffff"]}], "expect": {"words16": ["0xffff", "0x00ff", "0x0000"]}},
    {"kind": "vector", "id": "V-SWAP64", "title": "u64", "covers": ["R-1"], "source": {"cite": {"section": "1"}},
     "call": "wordsSwap64", "args": [{"words64": ["0x0123456789abcdef", "0x00000000ffffffff"]}], "expect": {"words64": ["0x89abcdef01234567", "0xffffffff00000000"]}},
    {"kind": "vector", "id": "V-SWAP64-HIGH", "title": "u64 top bit", "covers": ["R-1"], "source": {"cite": {"section": "1"}},
     "call": "wordsSwap64", "args": [{"words64": ["0xffffffffffffffff"]}], "expect": {"words64": ["0xffffffffffffffff"]}},
    {"kind": "vector", "id": "V-SWAP64-NULL", "title": "u64 refused", "covers": ["R-1"], "source": {"cite": {"section": "1"}},
     "call": "wordsSwap64", "args": [{"words64": ["0x0000000000000001", "0x0000000000000002", "0x0000000000000003"]}], "expect": {"null": true}},
    {"kind": "vector", "id": "V-COUNT64", "title": "optional u64", "covers": ["R-1"], "source": {"cite": {"section": "1"}},
     "call": "wordsCount64", "args": [{"words64": ["0x0000000000000001", "0x0000000000000002"]}], "expect": {"int": 2}},
    {"kind": "vector", "id": "V-COUNT64-NULL", "title": "optional u64 absent", "covers": ["R-1"], "source": {"cite": {"section": "1"}},
     "call": "wordsCount64", "args": [{"null": true}], "expect": {"int": -1}}
  ]
}`

/** The module the contract tests: right, or with `swap` leaving the halves where they are. */
const wordsEmitModule = (swap: boolean): string => `export const wordsRev16 = (w: u16[]): u16[] => {
  const out: u16[] = []
  for (let i = w.length - 1; i >= 0; i--) {
    out.push(w[i])
  }
  return out
}

export const wordsSwap64 = (w: u64[]): u64[] | null => {
  if (w.length > 2) {
    return null
  }
  const out: u64[] = []
  for (const x of w) {
    out.push(${swap ? "(x << toU64(32)) | (x >> toU64(32))" : "x"})
  }
  return out
}

export const wordsCount64 = (w: u64[] | null): i32 => (w === null ? -1 : w.length)
`

/** The verdict of the emitted test run against the module, or the failure. */
const wordsEmitRun = (c: Contract, dir: string, program: string, swap: boolean): string => {
  const wrote = emitWriteFile(`${dir}/words.ts`, wordsEmitModule(swap))
  if (wrote.isErr()) {
    return wrote.error
  }
  const file = `${dir}/words_check.ts`
  const w = emitWriteFile(file, program)
  if (w.isErr()) {
    return w.error
  }
  const r = runTestFile(c, file, ".nish/bin/nish", 110000, false)
  if (r.isErr()) {
    return r.error
  }
  return r.value.verdict.status === "ERROR" ? runFormat(r.value, "text") : r.value.verdict.status
}

/** The Rust emitter's refusal of a function over word type `t`. */
const wordsEmitRefused = (t: string): string => `f: word arrays (${t}) are not emitted for Rust yet; emit the Nish test`

/** A function with these parameter types and result. */
const wordsEmitSig = (params: string[], returns: string): FnSig => {
  const c = contractParse(
    `{"contract": "s", "source": {"title": "T", "rfc": 9999}, "target": {"module": "m"}, "requirements": [],
      "functions": [{"name": "f", "params": [${params.map((t: string): string => `{"name": "p", "type": "${t}"}`).join(", ")}], "returns": "${returns}"}],
      "clauses": []}`,
    "s",
  ).expect("parse a signature")
  return c.functions[0]
}

/** Word arrays in the Nish emitter, and their refusal by the others. */
export const main = (): i32 => {
  const t = new Suite("spec/emit words")

  const params: string[][] = [["words16"], ["bytes"], ["i32", "words64?"], [], ["bytes", "u32", "u64"], ["u16"]]
  const returns: string[] = ["bool", "words32", "bool", "words16?", "bytes?", "u64"]
  const want: string[] = [
    wordsEmitRefused("words16"),
    wordsEmitRefused("words32"),
    wordsEmitRefused("words64"),
    wordsEmitRefused("words16"),
    "",
    "",
  ]
  for (let i = 0; i < params.length; i++) {
    const got = emitTargetWordsRefusal(wordsEmitSig(params[i], returns[i]), "Rust")
    t.eqStr(`(${params[i].join(", ")}) -> ${returns[i]}`, got ?? "", want[i])
  }

  const c = contractParse(WORDS_EMIT_C, "words-emit").expect("parse the words contract")
  const opts = new EmitOptions("0000000000000000000000000000000000000000000000000000000000000000")
  opts.localModules = ["fixture/words"]
  opts.localImports = ["./words"]
  const p = emitProgram(c, new SampleTable(), opts)
  t.ok("the program emits", p.isOk())
  if (p.isErr()) {
    return t.done()
  }
  const program = p.value
  t.contains("a u16 word is typed", program, "(toU16(0) + 0xffff)")
  t.contains("a u64 word that fits 32 bits", program, "(toU64(0) + 0xffffffff)")
  t.contains("a u64 word over 32 bits", program, "(((toU64(0) + 0x01234567) << toU64(32)) | (toU64(0) + 0x89abcdef))")
  t.contains("u16 results are compared as text", program, "wordsHex16(wordsRev16(")
  t.contains("an expected u64 array", program, '"[89abcdef01234567 ffffffff00000000]"')
  t.contains("an expected refusal", program, '"null"')

  const dir = makeTempDir("vector-words-emit-").expect("a scratch directory")
  t.eqStr("the right module satisfies it", wordsEmitRun(c, dir, program, true), "SATISFIED")
  t.eqStr("a module that does not swap violates it", wordsEmitRun(c, dir, program, false), "VIOLATED")
  return t.done()
}
