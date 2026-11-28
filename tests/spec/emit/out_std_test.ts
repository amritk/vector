import { Suite } from "nish/testing"
import { Contract } from "../../../src/spec/contract/types"
import { emitContractFile } from "../../../src/spec/emit/file"
import { EmitPackages } from "../../../src/spec/emit/packages"
import { EmitTarget } from "../../../src/spec/emit/target"
import { RunOutcome, runDisposeScratch, runMakeScratch, runTest } from "../../../src/spec/run/run"

/**
 * `text` with its one `from` replaced by `to`, or "" when `from` is not in it
 * exactly once: a mutant that no longer applies to the pinned std fails loudly.
 */
const outStdMutate = (text: string, from: string, to: string): string => {
  const at = text.indexOf(from)
  if (at < 0 || text.indexOf(from, at + 1) >= 0) {
    return ""
  }
  return `${text.substring(0, at)}${to}${text.substring(at + from.length, text.length)}`
}

/**
 * The verdict of `program` run against a scratch nish whose `file` is `std`,
 * then each failed clause as `id: detail`, or the failure.
 */
const outStdRun = (c: Contract, program: string, file: string, std: string): string => {
  const made = runMakeScratch(".nish", [file], [std])
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

/**
 * Emit `contract`, run it against the pinned std's `file`, then against each
 * mutant of it: `froms[i]` replaced by `tos[i]` must fail with `want[i]`.
 */
const outStdCase = (
  t: Suite,
  contract: string,
  file: string,
  names: string[],
  froms: string[],
  tos: string[],
  want: string[],
): void => {
  const std = readFileSyncOrNull(`.nish/${file}`)
  t.ok(`${file} is in the pinned std`, std !== null)
  const emitted = emitContractFile(contract, null, new EmitPackages(), ".", new EmitTarget("nish", "standalone"))
  t.ok(`${contract} emits`, emitted.isOk())
  if (std === null || !emitted.isOk()) {
    return
  }
  const c = emitted.value.contract
  const program = emitted.value.program
  t.eqStr(`the pinned ${file} satisfies it`, outStdRun(c, program, file, std), "SATISFIED")
  for (let i = 0; i < names.length; i++) {
    const mutant = outStdMutate(std, froms[i], tos[i])
    t.ok(`the mutant "${names[i]}" applies to the pinned std`, mutant !== "")
    if (mutant !== "") {
      t.eqStr(`a std whose ${names[i]} violates it`, outStdRun(c, program, file, mutant), `VIOLATED\n${want[i]}`)
    }
  }
}

/** The out-buffer contracts' emitted tests, run against the pinned std and against copies of it with one write wrong. */
export const main = (): i32 => {
  const t = new Suite("spec/emit out std")
  if (!isExecutableSync(".nish/libexec/nish")) {
    t.skip("the out-buffer tests run against std", "no .nish/ install: run bash scripts/fetch-nish.sh")
    return t.done()
  }
  outStdCase(
    t,
    "tests/fixtures/base64-out/contracts/base64-out.json",
    "std/base64.ts",
    ["encoding starts at 0", "second pad goes one past the end", "end is one short"],
    [
      'does not fit in the destination")\n  }\n  // A local, so that `abc.length >= 64` below is a fact about the string each\n  // character is read from.\n  const abc: string = BASE64_ALPHABET\n  let i: i32 = off\n  let o: i32 = at',
      "toU8(BASE64_PAD)\n  dst[o + 3] = toU8(BASE64_PAD)\n  return o + 4\n}\n\n/**\n * `base64EncodeInto` for a caller",
      "  dst[o + 3] = toU8(BASE64_PAD)\n  return o + 4\n}\n\n/**\n * `base64EncodeInto` for a caller",
    ],
    [
      'does not fit in the destination")\n  }\n  // A local, so that `abc.length >= 64` below is a fact about the string each\n  // character is read from.\n  const abc: string = BASE64_ALPHABET\n  let i: i32 = off\n  let o: i32 = 0',
      "toU8(BASE64_PAD)\n  dst[o + 4] = toU8(BASE64_PAD)\n  return o + 4\n}\n\n/**\n * `base64EncodeInto` for a caller",
      "  dst[o + 3] = toU8(BASE64_PAD)\n  return o + 3\n}\n\n/**\n * `base64EncodeInto` for a caller",
    ],
    [
      "V1: base64EncodeInto wrote outside [at, end) = [5, 8), at 0\nV2: base64EncodeInto returned end 4 outside [at, at + capacity] = [5, 13]\nV3: base64EncodeInto returned end 4 outside [at, at + capacity] = [5, 11]\nV4: base64EncodeInto returned end 0 outside [at, at + capacity] = [5, 9]\nV5: base64EncodeInto returned end 4 outside [at, at + capacity] = [5, 15]\nV6: base64EncodeInto wrote outside [at, end) = [5, 8), at 0\nV7: base64EncodeInto wrote outside [at, end) = [5, 8), at 0\nP-LENGTH: sample 1 of 29 (len(d) = 1): base64EncodeInto returned end 4 outside [at, at + capacity] = [5, 11]",
      "V2: base64EncodeInto wrote outside [at, end) = [5, 9), at 9\nV3: base64EncodeInto wrote outside [at, end) = [5, 9), at 9\nV6: base64EncodeInto wrote outside [at, end) = [5, 13), at 13\nV7: base64EncodeInto wrote outside [at, end) = [5, 13), at 13\nP-LENGTH: sample 1 of 29 (len(d) = 1): base64EncodeInto wrote outside [at, end) = [5, 9), at 9",
      "V2: base64EncodeInto wrote outside [at, end) = [5, 8), at 8\nV3: base64EncodeInto wrote outside [at, end) = [5, 8), at 8\nV6: base64EncodeInto wrote outside [at, end) = [5, 12), at 12\nV7: base64EncodeInto wrote outside [at, end) = [5, 12), at 12\nP-LENGTH: sample 1 of 29 (len(d) = 1): base64EncodeInto wrote outside [at, end) = [5, 8), at 8",
    ],
  )
  outStdCase(
    t,
    "tests/fixtures/deflate-out/contracts/deflate-out.json",
    "std/compress/deflate.ts",
    ["decompressed end is one short", "truncated stream answers its bytes"],
    ["    return this.outPos\n  }", "      return r\n    }\n    if (this.inPos !== inEnd) {"],
    ["    return this.outPos - 1\n  }", "      return this.outPos\n    }\n    if (this.inPos !== inEnd) {"],
    [
      "V2: deflateDecompress wrote outside [at, end) = [5, 27), at 27\nV3: deflateDecompress wrote outside [at, end) = [5, 9), at 9\nP-ROUND-TRIP: sample 1 of 29 (len(d) = 52): deflateDecompress wrote outside [at, end) = [5, 56), at 56",
      'V4: expected "null", got "68"',
    ],
  )
  return t.done()
}
