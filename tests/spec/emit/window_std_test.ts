import { Suite } from "nish/testing"
import { Contract } from "../../../src/spec/contract/types"
import { emitContractFile } from "../../../src/spec/emit/file"
import { EmitPackages } from "../../../src/spec/emit/packages"
import { EmitTarget } from "../../../src/spec/emit/target"
import { RunOutcome, runDisposeScratch, runMakeScratch, runTest } from "../../../src/spec/run/run"

/** The checksum-window contract, whose module is nish's own nish/compress/checksum. */
const WINDOW_STD_CONTRACT: string = "tests/fixtures/checksum-window/contracts/checksum-window.json"

/** Where the pinned std's checksum module is, and where an override of it goes. */
const WINDOW_STD_FILE: string = "std/compress/checksum.ts"

/**
 * `text` with its one `from` replaced by `to`, or "" when `from` is not in it
 * exactly once: a mutant that no longer applies to the pinned std fails loudly.
 */
const windowStdMutate = (text: string, from: string, to: string): string => {
  const at = text.indexOf(from)
  if (at < 0 || text.indexOf(from, at + 1) >= 0) {
    return ""
  }
  return `${text.substring(0, at)}${to}${text.substring(at + from.length, text.length)}`
}

/**
 * The verdict of `program` run against a scratch nish whose checksum module is
 * `std`, then each failed clause as `id: detail`, or the failure.
 */
const windowStdRun = (c: Contract, program: string, std: string): string => {
  const made = runMakeScratch(".nish", [WINDOW_STD_FILE], [std])
  if (made.isErr()) {
    return made.error
  }
  const ran = runTest(c, program, made.value.nish, 110000)
  const gone = runDisposeScratch(made.value)
  if (ran.isErr()) {
    return ran.error
  }
  if (gone.isErr()) {
    return gone.error
  }
  let out = ran.value.verdict.status
  for (const k of ran.value.clauses) {
    if (k.outcome === RunOutcome.Fail) {
      out = `${out}\n${k.id}: ${k.detail}`
    }
  }
  return out
}

/** The window contract's emitted test, run against the pinned std and against copies of it with one window read wrong. */
export const main = (): i32 => {
  const t = new Suite("spec/emit window std")
  const std = readFileSyncOrNull(`.nish/${WINDOW_STD_FILE}`)
  if (!isExecutableSync(".nish/libexec/nish") || std === null) {
    t.skip("the window test runs against std", "no .nish/ install: run bash scripts/fetch-nish.sh")
    return t.done()
  }
  const emitted = emitContractFile(
    WINDOW_STD_CONTRACT,
    null,
    new EmitPackages(),
    ".",
    new EmitTarget("nish", "standalone"),
  )
  t.ok("the contract emits", emitted.isOk())
  if (!emitted.isOk()) {
    return t.done()
  }
  const c = emitted.value.contract
  const program = emitted.value.program
  t.ok("the test imports nish's own module", program.indexOf('from "nish/compress/checksum"') >= 0)
  t.ok(
    "each window is passed at offset 3",
    program.indexOf("const r: u32 = adler32Update(a_adler, w_buf, 3, a_buf.length);") >= 0,
  )
  t.eqStr("the pinned std satisfies it", windowStdRun(c, program, std), "SATISFIED")

  const crc = "new Crc32().update(toU32(0), buf, off, len)"
  const walk = "return adler32Walk(adler, buf, off, len)"
  const names: string[] = ["crc32 reads from 0", "adler32Update reads from 0", "crc32 reads to the buffer's end"]
  const froms: string[] = [crc, walk, crc]
  const tos: string[] = [
    "new Crc32().update(toU32(0), buf, 0, len)",
    "return adler32Walk(adler, buf, 0, len)",
    "new Crc32().update(toU32(0), buf, off, buf.length - off)",
  ]
  const want: string[] = [
    'V1: expected "3421780262", got "129283310"',
    'V3: expected "300286872", got "398722137"\nV5: expected "519570622", got "546047367"\nP-ADLER32-SPLIT: sample 1 of 33 (len(a) = 11, len(b) = 11): the assertion is false',
    'V1: expected "3421780262", got "3709140582"\nV2: expected "0", got "1434484544"',
  ]
  for (let i = 0; i < names.length; i++) {
    const mutant = windowStdMutate(std, froms[i], tos[i])
    t.ok(`the mutant "${names[i]}" applies to the pinned std`, mutant !== "")
    if (mutant !== "") {
      t.eqStr(`a std whose ${names[i]} violates it`, windowStdRun(c, program, mutant), `VIOLATED\n${want[i]}`)
    }
  }
  return t.done()
}
