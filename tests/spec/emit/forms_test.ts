import { Suite } from "nish/testing"
import { CheckContext, Sample, SampleTable, checkAddSample, checkContract, checkPassed } from "../../../src/spec/check"
import { contractLoadFile } from "../../../src/spec/contract/contract"
import { Contract, LitKind, Literal } from "../../../src/spec/contract/types"
import { EmitOptions, emitProgram } from "../../../src/spec/emit/emit"
import { emitContractFile } from "../../../src/spec/emit/file"
import { EmitPackages } from "../../../src/spec/emit/packages"
import { EmitTarget } from "../../../src/spec/emit/target"
import { runDisposeScratch, runMakeScratch, runTest } from "../../../src/spec/run/run"

const FORMS: string = "tests/spec/emit/fixtures/forms.json"
const FORMS_SHA: string = "abababababababababababababababababababababababababababababababab"

const formsInt = (n: string): Literal => new Literal(LitKind.Int, n)
const formsHex = (h: string): Literal => new Literal(LitKind.Hex, h)
const formsStr = (s: string): Literal => new Literal(LitKind.Str, s)

/**
 * Hand-picked samples for every property of the forms contract: a zero
 * divisor, i64 and i32 arithmetic that wraps, a negative le64, equal-length bytes, and
 * strings that need escaping, control characters included (no contract can
 * hold one, so only a sample reaches the `\u00XX` escape).
 */
const formsSamples = (): SampleTable => {
  const t = new SampleTable()
  checkAddSample(t, new Sample("P-MOD", [formsInt("-7"), formsInt("0")], "a zero divisor"))
  checkAddSample(t, new Sample("P-MOD", [formsInt("-7"), formsInt("3")], "a negative dividend"))
  checkAddSample(t, new Sample("P-MOD", [formsInt("50"), formsInt("-5")], "the largest"))
  checkAddSample(t, new Sample("P-WRAP", [formsInt("9223372036854775807"), formsInt("1")], "wraps up"))
  checkAddSample(t, new Sample("P-WRAP", [formsInt("-9223372036854775808"), formsInt("-1")], "wraps down"))
  checkAddSample(t, new Sample("P-WRAP32", [formsInt("2147483647"), formsInt("1")], "+ wraps up"))
  checkAddSample(t, new Sample("P-WRAP32", [formsInt("-2147483648"), formsInt("1")], "- wraps down"))
  checkAddSample(t, new Sample("P-WRAP32", [formsInt("65536"), formsInt("65536")], "* wraps to 0"))
  checkAddSample(t, new Sample("P-LE64", [formsInt("-2")], "every byte set"))
  checkAddSample(t, new Sample("P-LE64", [formsInt("2147483647")], "i32's maximum"))
  checkAddSample(t, new Sample("P-BITS", [formsHex("0f"), formsHex("f1")], "by hand"))
  checkAddSample(t, new Sample("P-BITS", [formsHex(""), formsHex("")], "empty"))
  checkAddSample(t, new Sample("P-LET", [formsStr("")], "empty"))
  checkAddSample(t, new Sample("P-LET", [formsStr('a"\\\t')], "quotes"))
  checkAddSample(t, new Sample("P-LET", [formsStr("\u0001\u007f")], "control characters"))
  checkAddSample(t, new Sample("P-UNWRAP-B", [formsHex("00")], "by hand"))
  return t
}

/** How many times `needle` occurs in `hay`. */
const formsCount = (hay: string, needle: string): i32 => {
  let n: i32 = 0
  let at = hay.indexOf(needle)
  while (at >= 0) {
    n += 1
    at = hay.indexOf(needle, at + needle.length)
  }
  return n
}

/** The forms contract emitted with the hand-picked samples, or "" when it is refused. */
const formsEmit = (c: Contract): string => {
  const opts = new EmitOptions(FORMS_SHA)
  opts.regenerate = `vector spec emit ${FORMS} -o forms_test.ts`
  const p = emitProgram(c, formsSamples(), opts)
  return p.isOk() ? p.value : ""
}

/**
 * Checks the text emitted for every form a contract can use — integer
 * remainders, wrapping i32 and i64, le64, bitwise bytes, let and unwrap, nulls,
 * binary64 comparisons, secrets — then compiles and runs it with the pinned
 * nish against tests/spec/emit/fixtures/forms.ts.
 */
export const main = (): i32 => {
  const t = new Suite("spec/emit forms")
  const c = contractLoadFile(FORMS).expect("load the forms contract")
  const p = formsEmit(c)
  t.ok("the forms contract emits", p !== "")

  t.contains("the header says how to regenerate", p, `//   vector spec emit ${FORMS} -o forms_test.ts.`)
  t.contains("and holds the contract's sha256", p, `// vector-contract-sha256: ${FORMS_SHA}\n`)

  // mod-zero: % is remI32, which answers 0 for a zero (or -1) divisor.
  t.ok("remI32 is defined once", formsCount(p, "const remI32 = ") === 1)
  t.contains("a zero divisor is remI32's", p, "remI32(idI32(v_x), 0) === 0")
  t.contains("a computed divisor too", p, "remI32(v_x, wrappingMul(v_y, v_y))")
  t.ok("% is never written bare", p.indexOf("v_x %") < 0 && p.indexOf("v_y %") < 0)

  // i64 and i32 + - * wrap through nish:unsafe, as the sampler does.
  t.contains("i64 + wraps", p, "(addI64(v_a, v_b) === wrappingAdd(v_a, v_b))")
  t.contains("i32 + wraps", p, "(addI32(v_a, v_b) === wrappingAdd(v_a, v_b))")
  t.contains("i32 - wraps", p, "(subI32(v_a, v_b) === wrappingSub(v_a, v_b))")
  t.contains("i32 * wraps", p, "(mulI32(v_a, v_b) === wrappingMul(v_a, v_b))")
  t.ok("i32 * is never written bare", p.indexOf("v_y * v_y") < 0 && p.indexOf("v_a * v_b") < 0)
  t.contains("nish:unsafe is imported", p, 'import { wrappingAdd, wrappingMul, wrappingSub } from "nish:unsafe";')
  t.contains("i64's maximum is built exactly", p, "(toI64(2147483647) * 4294967296 + 4294967295)")

  // rfc-bitwise: xor, bitAnd and bitOr are one helper, chosen by its third argument.
  t.ok("bitwiseBytes is defined once", formsCount(p, "const bitwiseBytes = ") === 1)
  t.contains("xor is 0", p, "bitwiseBytes(xorB(v_a, v_b), v_b, 0)")
  t.contains("and is 1", p, "bitwiseBytes(v_a, v_b, 1)")
  t.contains("or is 2", p, "bitwiseBytes(v_a, v_a, 2)")
  t.contains("bytes compare by bytesEq", p, "bytesEq(leBytes(v_x), le64(v_x))")
  t.contains("le64 shifts an i64", p, "v = v >> toI64(8);")

  // let, unwrap and nulls.
  t.contains("a let is a const", p, "const v_r: string | null = nonEmpty(v_s);")
  t.contains("isNull of a string", p, "isNullStr(v_r)")
  t.contains("unwrap of a string", p, "u.str(v_r)")
  t.contains("unwrap of bytes", p, "u.get(nonEmptyB(v_a))")
  t.contains("an unwrapped null fails the sample", p, 'why = "unwrap met a null";')
  t.contains("a null string vector", p, 'strOrNull(nonEmpty("")), "null")')
  t.contains("a null bytes vector", p, 'hexOrNull(nonEmptyB(unhex(""))), "null")')

  // Every sample row, in order: a dropped or reordered row fails here.
  t.contains("P-MOD's rows", p, "const table_x: i32[] = [-7, -7, 50];\n  const table_y: i32[] = [0, 3, -5];\n")
  t.contains("P-MOD's three rows run", p, "for (let i: i32 = 0; i < 3; i += 1) {\n    const v_x: i32 = table_x[i];")
  t.contains(
    "P-WRAP's rows",
    p,
    "const table_a: i64[] = [(toI64(2147483647) * 4294967296 + 4294967295), (toI64(-2147483648) * 4294967296 + 0)];\n  const table_b: i64[] = [toI64(1), toI64(-1)];\n",
  )
  t.contains(
    "P-WRAP32's rows",
    p,
    "const table_a: i32[] = [2147483647, -2147483648, 65536];\n  const table_b: i32[] = [1, 1, 65536];\n",
  )
  t.contains("P-LE64's rows", p, "const table_x: i32[] = [-2, 2147483647];\n")
  t.contains(
    "P-BITS's rows",
    p,
    'const table_a: string[] = [\n    "0f",\n    "",\n  ];\n  const table_b: string[] = [\n    "f1",\n    "",\n  ];\n',
  )
  // Strings are quoted, control characters as \u00XX.
  t.contains(
    "P-LET's rows",
    p,
    'const table_s: string[] = [\n    "",\n    "a\\"\\\\\\t",\n    "\\u0001\\u007f",\n  ];\n',
  )
  t.contains(
    "P-UNWRAP-B's row",
    p,
    'clause_P_UNWRAP_B = (t: Suite): boolean => {\n  const table_a: string[] = [\n    "00",\n  ];\n',
  )
  t.contains("a vector string", p, 'nonEmpty("q\\"\\\\\\t\\n\\r~")')

  // binary64: bit-exact unless the vector gives a tolerance.
  t.contains("an exact f64", p, "eqF64Bits(t, ")
  t.contains("-0 from its bits", p, "bitsToF64((toI64(-2147483648) * 4294967296 + 0))")
  t.contains("an absolute tolerance", p, "t.nearF64(")
  t.contains("a tolerance in ulps", p, "nearUlpsF64(t, ")
  t.contains("u64's maximum", p, "isMax(((toU64(0) + 4294967295) * 4294967296 + 4294967295))")

  // secret-bytes: copied into a Secret, wiped after the call, the result exposed.
  t.contains("nish:secret is imported", p, 'import { Secret, expose, secret, wipe } from "nish:secret";')
  t.contains("a secret argument is a copy", p, "const s_k: Secret<u8[]> = secret(copyBytes(a_k));")
  t.contains("and wiped after the call", p, "const r: Secret<u8[]> | null = keep(s_k, a_u);\n  wipe(s_k);")
  t.contains("a secret result is exposed, then wiped", p, "const out: u8[] = expose(r, copyBytes);\n  wipe(r);")
  t.contains("an optional secret starts null", p, "let s_k: Secret<u8[]> | null = null;")
  t.contains("and is wiped only when there is one", p, "if (s_k !== null) {\n    wipe(s_k);")
  t.contains("a secret vector goes through its wrapper", p, 'hexOrNull(plain_keep(unhex("a546"), unhex("e6db")))')

  formsWithout(t, c)
  formsSpecs(t)
  formsLive(t, c, p)
  return t.done()
}

/**
 * A program that needs no helper has none; clause ids that clash, and
 * contract functions named like a check or wrapper, are refused.
 */
const formsWithout = (t: Suite, c: Contract): void => {
  const hex = contractLoadFile("contracts/example-hex.json").expect("load example-hex")
  const plain = emitProgram(hex, new SampleTable(), new EmitOptions("0"))
  const text = plain.isOk() ? plain.value : ""
  t.ok("example-hex emits", plain.isOk())
  t.ok("no % means no remI32", text.indexOf("remI32") < 0)
  t.ok("no secret means no nish:secret", text.indexOf("nish:secret") < 0)
  t.ok("no sampled + - * means no nish:unsafe", text.indexOf("nish:unsafe") < 0)

  c.clauses[0].id = "P-a"
  c.clauses[1].id = "P_a"
  const clash = emitProgram(c, new SampleTable(), new EmitOptions("0"))
  t.ok("two clause ids that make one function name are refused", clash.isErr())
  if (clash.isErr()) {
    t.contains("and the refusal names both", clash.error.join("\n"), "P_a: its check would be clause_P_a")
  }

  // The names the test defines beside the contract's functions: a function
  // already called plain_keep or clause_P_MOD would collide with them.
  const named = contractLoadFile(FORMS).expect("reload the forms contract")
  named.functions[0].name = "plain_keep"
  named.functions[1].name = "clause_P_MOD"
  const taken = emitProgram(named, new SampleTable(), new EmitOptions("0"))
  t.ok("a contract function's name the test would define is refused", taken.isErr())
  if (taken.isErr()) {
    const why = taken.error.join("\n")
    t.contains("the wrapper's", why, "keep: its wrapper would be plain_keep, which is a contract function's name")
    t.contains("the check's", why, "P-MOD: its check would be clause_P_MOD, which is a contract function's name")
  }
}

/**
 * rfc-spec: each RFC contract emits exactly when `vector spec check` passes
 * it, its header naming the command that regenerates it; one check refuses
 * is refused by emit with check's own findings.
 */
const formsSpecs = (t: Suite): void => {
  for (const name of ["rfc5869-hkdf-sha256", "rfc8439-chacha20-poly1305"]) {
    const path = `contracts/${name}.json`
    const cmd = `vector spec emit ${path} -o ${name}.ts`
    const c = contractLoadFile(path).expect(`load ${name}`)
    const passed = checkPassed(checkContract(new CheckContext(path, "."), c))
    const e = emitContractFile(path, cmd, new EmitPackages(), ".", new EmitTarget("nish", "standalone"))
    t.ok(`${name} emits when check passes it`, e.isOk() === passed)
    if (e.isOk()) {
      t.contains(`${name}'s header`, e.value.program, `//   ${cmd}.\n`)
    } else {
      t.ok(`${name} is refused with check's findings`, e.error.length > 0 && e.error[0].file === path)
    }
  }
  t.ok(
    "rfc5869-hkdf-sha256 passes check",
    checkPassed(
      checkContract(
        new CheckContext("contracts/rfc5869-hkdf-sha256.json", "."),
        contractLoadFile("contracts/rfc5869-hkdf-sha256.json").expect("load rfc5869"),
      ),
    ),
  )
}

/** The forms program compiled and run with the pinned nish against the fixture module: SATISFIED. */
const formsLive = (t: Suite, c: Contract, p: string): void => {
  const module = readFileSyncOrNull("tests/spec/emit/fixtures/forms.ts")
  if (!isExecutableSync(".nish/libexec/nish") || module === null || p === "") {
    t.skip("every form compiles and holds", "no .nish/ install: run bash scripts/fetch-nish.sh")
    return
  }
  const made = runMakeScratch(".nish", ["std/forms.ts"], [module])
  t.ok("a scratch install is made", made.isOk())
  if (!made.isOk()) {
    return
  }
  const s = made.value
  const ran = runTest(contractLoadFile(FORMS).expect("reload"), p, s.nish, 110000)
  t.ok("the forms test ran", ran.isOk())
  if (ran.isOk()) {
    const r = ran.value
    t.eqStr("every form compiles and holds", r.verdict.status, "SATISFIED")
    if (r.verdict.status !== "SATISFIED") {
      console.log(r.stdout)
      console.log(r.stderr)
    }
    t.ok("every clause ran", r.clauses.length === c.clauses.length)
  }
  t.ok("the scratch is removed", runDisposeScratch(s).isOk())
}
