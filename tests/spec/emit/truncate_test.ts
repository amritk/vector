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
import { runGo, runNode, runPython, runRustc } from "../../../src/spec/run/command"
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
  t.contains("nish: the clause says what it holds, in the spec's unit", nish, "Holds the result's first 128 bits to")
  t.contains("nish: the call through hexPrefix", nish, "hexPrefix(hmacSha256(")
  t.contains("nish: to 16 bytes", nish, `, 16), "a3b6167473100ee06e0c796c2955552b")`)
  t.ok(
    "nish: the helper is defined once",
    nish.indexOf("const hexPrefix = ") >= 0 &&
      nish.indexOf("const hexPrefix = ", nish.indexOf("const hexPrefix = ") + 1) < 0,
  )
  t.ok("nish: hexOf, which it needs, is defined", nish.indexOf("const hexOf = ") >= 0)
  t.ok("nish: §4.2 is held whole", nish.indexOf(`"${TRUNC_EMIT_FULL}"`) >= 0)
  const go = emitGoProgram(c, new SampleTable(), opts, "standalone").expect("go")
  t.contains("go: the call", go, "_hexPrefix(")
  t.ok("go: the helper", go.indexOf("func _hexPrefix(b []byte, n int) string {") >= 0)
  const py = emitPyProgram(c, new SampleTable(), opts, "standalone").expect("python")
  t.contains("python: the call", py, `, 16), "a3b6167473100ee06e0c796c2955552b")`)
  t.ok("python: the helper", py.indexOf("def _hex_prefix(b, n):") >= 0)
  const rs = emitRsProgram(c, new SampleTable(), opts, "standalone").expect("rust")
  t.contains("rust: the call", rs, "&_hex_prefix(&")
  t.ok("rust: the helper", rs.indexOf("fn _hex_prefix(b: &[u8], n: usize) -> String {") >= 0)
  const ts = emitTsProgram(c, new SampleTable(), opts, "standalone").expect("typescript")
  t.contains("typescript: the call", ts, "_hex_prefix(")
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
      t.eqStr(
        `nish: ${truncEmitWhy()[i]}: the detail`,
        ran.clauses[1].detail,
        truncEmitShortDetail(toI32(results[i].length / 2)),
      )
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
      t.contains(
        `python: ${truncEmitWhy()[i]}: the detail`,
        ran.clauses[1].detail,
        `a ${results[i].length / 2}-byte result, shorter than the 16 bytes`,
      )
    }
    runProcess(["rm", "-rf", dir], "", 10000).expect("rm")
  }
}

/** Go's fake hmac, returning `t5` for §4.6 and the true §4.2 result for its 8-byte data. */
const truncEmitGoHmac = (t5: string): string =>
  `package hmac\n\nimport "encoding/hex"\n\nfunc HmacSha256(key, data []byte) []byte {\n\th := "${t5}"\n\tif len(data) == 8 {\n\t\th = "${TRUNC_EMIT_FULL}"\n\t}\n\tb, _ := hex.DecodeString(h)\n\treturn b\n}\n`

/** Rust's fake hmac, as Go's. */
const truncEmitRsHmac = (t5: string): string =>
  `pub fn hmac_sha256(_key: &[u8], data: &[u8]) -> Vec<u8> {\n    let h = if data.len() == 8 { "${TRUNC_EMIT_FULL}" } else { "${t5}" };\n    (0..h.len() / 2).map(|i| u8::from_str_radix(&h[2 * i..2 * i + 2], 16).unwrap()).collect()\n}\n`

/** TypeScript's fake hmac, as Go's. */
const truncEmitTsHmac = (t5: string): string =>
  `export function hmacSha256(_key: Uint8Array, data: Uint8Array): Uint8Array {\n  const h = data.length === 8 ? "${TRUNC_EMIT_FULL}" : "${t5}"\n  return Uint8Array.from(h.match(/../g) ?? [], (x) => Number.parseInt(x, 16))\n}\n`

/**
 * The Go, Rust and TypeScript tests, run by the binary against a fake hmac:
 * the whole result passes, a wrong 16th byte fails, and a 15-byte result
 * fails as short. A language whose toolchain is absent is skipped.
 */
const truncEmitLiveRuns = (t: Suite): void => {
  if (!isExecutableSync("dist/vector")) {
    t.skip("the truncated vector runs in Go, Rust and TypeScript", "no dist/vector: run npm run build")
    return
  }
  const langs = ["go", "rust", "typescript"]
  const tools = [runGo(), runRustc(), runNode()]
  const exts = [".go", ".rs", ".ts"]
  for (let l = 0; l < langs.length; l++) {
    const lang = langs[l]
    const has = runProcess([tools[l], lang === "go" ? "version" : "--version"], "", 10000)
    if (has.isErr() || has.value.status !== 0) {
      t.skip(`the truncated vector runs in ${lang}`, `no ${tools[l]}`)
      continue
    }
    for (const i of [0, 2, 3]) {
      const t5 = truncEmitResults()[i]
      const dir = makeTempDir("vector-trunc-live-").expect("temp")
      mkdirSync(joinPath(dir, "crypto"))
      const fake = lang === "go" ? truncEmitGoHmac(t5) : lang === "rust" ? truncEmitRsHmac(t5) : truncEmitTsHmac(t5)
      writeFileSyncMode(joinPath(dir, `crypto/hmac${exts[l]}`), fake, 0o600)
      const argv = ["dist/vector", "spec", "run", TRUNC_EMIT_CONTRACT, "--lang", lang, "--package", `nish=${dir}`]
      argv.push("--format")
      argv.push("json")
      const ran = runProcess(argv, "", 240000).expect("run")
      t.contains(`${lang}: ${truncEmitWhy()[i]}`, ran.stdout, `"status": "${truncEmitWant()[i]}"`)
      if (i === 2) {
        t.contains(`${lang}: the wrong byte is shown`, ran.stdout, `got \\"a3b6167473100ee06e0c796c2955552c\\"`)
      }
      if (i === 3) {
        t.contains(`${lang}: the short result is named`, ran.stdout, "a 15-byte result, shorter than the 16 bytes")
      }
      runProcess(["rm", "-rf", dir], "", 10000).expect("rm")
    }
  }
}

/** A truncated vector, emitted and run. */
export const main = (): i32 => {
  const t = new Suite("spec/emit truncate")
  const c = contractLoadFile(TRUNC_EMIT_CONTRACT).expect("load")
  truncEmitText(t, c)
  truncEmitNishRuns(t, c)
  truncEmitPyRuns(t, c)
  truncEmitLiveRuns(t)
  return t.done()
}
