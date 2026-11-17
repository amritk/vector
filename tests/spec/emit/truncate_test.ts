import { Suite } from "nish/testing"
import { replaceAll } from "nish/text"
import { joinPath, makeTempDir } from "../../../src/core/fs"
import { runProcess } from "../../../src/core/process"
import { SampleTable } from "../../../src/spec/check"
import { contractLoadFile } from "../../../src/spec/contract/contract"
import { Contract } from "../../../src/spec/contract/types"
import { EmitOptions, emitProgram } from "../../../src/spec/emit/emit"
import { emitGoProgram } from "../../../src/spec/emit/go"
import { emitParsePackages, emitResolveModules } from "../../../src/spec/emit/packages"
import { emitPyProgram } from "../../../src/spec/emit/python"
import { emitRsProgram } from "../../../src/spec/emit/rust"
import { emitTsProgram } from "../../../src/spec/emit/typescript"
import { runPython } from "../../../src/spec/run/command"
import { runDisposeScratch, runMakeScratch, runOutcomeName, runTest, runTestCommand } from "../../../src/spec/run/run"

// A truncated vector, emitted in each language and run: it holds the result's
// first N bytes to the expect, and a result shorter than N fails.

/** RFC 4231 §4.2 and §4.6, the second truncated to 128 bits. */
const TRUNC_EMIT_CONTRACT: string = "tests/fixtures/profile/profile-truncate.json"
/** §4.2's whole HMAC-SHA-256. */
const TRUNC_EMIT_FULL: string = "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
/** §4.6's whole HMAC-SHA-256, the 16 printed bytes then the 16 the RFC leaves out. */
const TRUNC_EMIT_LONG: string = "a3b6167473100ee06e0c796c2955552bfa6f1d5bd3a5dd7f3d4c7a9a6bf7b9bb"

/** An hmac module whose hmacSha256 returns §4.2's value for §4.2's 8-byte data, and `t5` for §4.6's. */
const truncEmitNishHmac = (t5: string): string => `const truncEmitNib = (c: i32): u8 => {
  if (c >= 97) {
    return toU8(c - 87)
  }
  return toU8(c - 48)
}

const truncEmitUnhex = (s: string): u8[] => {
  const out: u8[] = []
  for (let i: i32 = 0; i + 1 < s.length; i += 2) {
    out.push(toU8(truncEmitNib(s.charCodeAt(i)) * 16 + truncEmitNib(s.charCodeAt(i + 1))))
  }
  return out
}

export const hmacSha256 = (key: u8[], data: u8[]): u8[] => {
  if (data.length === 8) {
    return truncEmitUnhex("${TRUNC_EMIT_FULL}")
  }
  return truncEmitUnhex("${t5}")
}
`

/** The same module in Python. */
const truncEmitPyHmac = (t5: string): string =>
  `def hmac_sha256(key, data):\n    if len(data) == 8:\n        return bytes.fromhex("${TRUNC_EMIT_FULL}")\n    return bytes.fromhex("${t5}")\n`

/** The §4.6 results each run returns, and the status it is judged. */
const truncEmitResults = (): string[] => [
  TRUNC_EMIT_LONG,
  TRUNC_EMIT_LONG.substring(0, 32),
  `a3b6167473100ee06e0c796c2955552c${TRUNC_EMIT_LONG.substring(32, 64)}`,
  TRUNC_EMIT_LONG.substring(0, 30),
  "",
]
const truncEmitWant = (): string[] => ["SATISFIED", "SATISFIED", "VIOLATED", "VIOLATED", "VIOLATED"]
const truncEmitWhy = (): string[] => [
  "the whole 32 bytes, held to their first 16",
  "exactly the 16 bytes",
  "the 16th byte wrong",
  "15 bytes, one short",
  "no bytes at all",
]

/** The detail a short result fails with. */
const truncEmitShortDetail = (have: i32): string =>
  `expected "a3b6167473100ee06e0c796c2955552b", got "a ${have}-byte result, shorter than the 16 bytes it is truncated to"`

/** The emitted text, in each language: one prefix helper, and the call held through it. */
const truncEmitText = (t: Suite, c: Contract): void => {
  const opts = new EmitOptions("ab")
  const nish = emitProgram(c, new SampleTable(), opts).expect("nish")
  t.contains("nish: the clause says what it holds", nish, "Holds the result's first 16 bytes (128 bits)")
  t.contains("nish: the call through hexPrefix", nish, `hexPrefix(hmacSha256(`)
  t.contains("nish: to 16 bytes", nish, `, 16), "a3b6167473100ee06e0c796c2955552b")`)
  t.ok("nish: the helper is defined once", nish.indexOf("const hexPrefix = ") >= 0 && nish.indexOf("const hexPrefix = ", nish.indexOf("const hexPrefix = ") + 1) < 0)
  t.ok("nish: hexOf, which it needs, is defined", nish.indexOf("const hexOf = ") >= 0)
  t.ok("nish: §4.2 is held whole", nish.indexOf(`"${TRUNC_EMIT_FULL}"`) >= 0)
  const go = emitGoProgram(c, new SampleTable(), opts, "standalone").expect("go")
  t.contains("go: the call", go, `_hexPrefix(`)
  t.ok("go: the helper", go.indexOf("func _hexPrefix(b []byte, n int) string {") >= 0)
  const py = emitPyProgram(c, new SampleTable(), opts, "standalone").expect("python")
  t.contains("python: the call", py, `, 16), "a3b6167473100ee06e0c796c2955552b")`)
  t.ok("python: the helper", py.indexOf("def _hex_prefix(b, n):") >= 0)
  const rs = emitRsProgram(c, new SampleTable(), opts, "standalone").expect("rust")
  t.contains("rust: the call", rs, `&_hex_prefix(&`)
  t.ok("rust: the helper", rs.indexOf("fn _hex_prefix(b: &[u8], n: usize) -> String {") >= 0)
  const ts = emitTsProgram(c, new SampleTable(), opts, "standalone").expect("typescript")
  t.contains("typescript: the call", ts, `_hex_prefix(`)
  t.ok("typescript: the helper", ts.indexOf("function _hex_prefix(b: unknown, n: number): string {") >= 0)
  for (const lang of ["nish", "go", "python", "rust", "typescript"]) {
    const text = lang === "nish" ? nish : lang === "go" ? go : lang === "python" ? py : lang === "rust" ? rs : ts
    t.ok(`${lang}: a short result says so`, text.indexOf("shorter than the") >= 0)
  }
  const plain = replaceAll(nish, "hexPrefix", "")
  t.ok("nish: no clamp to the result's length", plain.indexOf("Math.min") < 0)
}

/** The nish test against each result, through a scratch std with a fake hmac. */
const truncEmitNishRuns = (t: Suite, c: Contract): void => {
  if (!isExecutableSync(".nish/libexec/nish")) {
    t.skip("the truncated vector runs", "no .nish/ install: run bash scripts/fetch-nish.sh")
    return
  }
  const program = emitProgram(c, new SampleTable(), new EmitOptions("ab")).expect("emit")
  const results = truncEmitResults()
  for (let i = 0; i < results.length; i++) {
    const made = runMakeScratch(".nish", ["std/crypto/hmac.ts"], [truncEmitNishHmac(results[i])]).expect("scratch")
    const ran = runTest(c, program, made.nish, 110000).expect("run")
    t.eqStr(`nish: ${truncEmitWhy()[i]}`, ran.verdict.status, truncEmitWant()[i])
    t.eqStr(`nish: ${truncEmitWhy()[i]}: §4.2 passes`, runOutcomeName(ran.clauses[0].outcome), "pass")
    if (i >= 3) {
      t.eqStr(`nish: ${truncEmitWhy()[i]}: the detail`, ran.clauses[1].detail, truncEmitShortDetail(toI32(results[i].length / 2)))
    }
    runDisposeScratch(made).expect("dispose")
  }
}

/** The python test against each result, through a fake hmac module. */
const truncEmitPyRuns = (t: Suite, c: Contract): void => {
  const py = runProcess([runPython(), "--version"], "", 10000)
  if (py.isErr() || py.value.status !== 0) {
    t.skip("the truncated vector runs in Python", "no python3 (set VECTOR_PYTHON)")
    return
  }
  const results = truncEmitResults()
  for (let i = 0; i < results.length; i++) {
    const dir = makeTempDir("vector-trunc-py-").expect("temp")
    const pkg = joinPath(dir, "pkg")
    mkdirSync(pkg)
    mkdirSync(joinPath(pkg, "crypto"))
    writeFileSyncMode(joinPath(pkg, "crypto/hmac.py"), truncEmitPyHmac(results[i]), 0o600)
    const opts = new EmitOptions("ab")
    const packages = emitParsePackages([`nish=${pkg}`], "python").expect("parse")
    emitResolveModules(packages, c, dir, opts, ".py").expect("resolve")
    const file = joinPath(dir, "hmac_test.py")
    writeFileSyncMode(file, emitPyProgram(c, new SampleTable(), opts, "standalone").expect("emit"), 0o600)
    const ran = runTestCommand(c, [runPython(), "-B", file], 60000).expect("run")
    t.eqStr(`python: ${truncEmitWhy()[i]}`, ran.verdict.status, truncEmitWant()[i])
    if (i >= 3) {
      t.contains(`python: ${truncEmitWhy()[i]}: the detail`, ran.clauses[1].detail, `a ${results[i].length / 2}-byte result, shorter than the 16 bytes`)
    }
    runProcess(["rm", "-rf", dir], "", 10000).expect("rm")
  }
}

/** A truncated vector, emitted and run. */
export const main = (): i32 => {
  const t = new Suite("spec/emit truncate")
  const c = contractLoadFile(TRUNC_EMIT_CONTRACT).expect("load")
  truncEmitText(t, c)
  truncEmitNishRuns(t, c)
  truncEmitPyRuns(t, c)
  return t.done()
}
