import { Suite } from "nish/testing"
import { joinPath, makeTempDir } from "../../../src/core/fs"
import { runProcess } from "../../../src/core/process"
import { Sample, SampleTable, checkAddSample } from "../../../src/spec/check"
import { contractLoadFile } from "../../../src/spec/contract/contract"
import { Contract, LitKind, Literal, NameOverride } from "../../../src/spec/contract/types"
import { EmitOptions } from "../../../src/spec/emit/emit"
import { emitParsePackages, emitResolveModules } from "../../../src/spec/emit/packages"
import { EmitTarget, emitTargetExt, emitTargetFlags, emitTargetHarnesses } from "../../../src/spec/emit/target"
import { emitTsF64, emitTsInt, emitTsName, emitTsProgram, emitTsRefusals } from "../../../src/spec/emit/typescript"
import { runNode } from "../../../src/spec/run/command"
import { runTestCommand } from "../../../src/spec/run/run"

const TS_FORMS: string = "tests/spec/emit/fixtures/forms.json"

const tsInt = (n: string): Literal => new Literal(LitKind.Int, n)
const tsHex = (h: string): Literal => new Literal(LitKind.Hex, h)
const tsStr = (s: string): Literal => new Literal(LitKind.Str, s)

/** forms_test's hand-picked samples: a zero divisor, i64 sums that wrap, a negative le64, escapes. */
const tsSamples = (): SampleTable => {
  const t = new SampleTable()
  checkAddSample(t, new Sample("P-MOD", [tsInt("-7"), tsInt("0")], "a zero divisor"))
  checkAddSample(t, new Sample("P-MOD", [tsInt("-7"), tsInt("3")], "a negative dividend"))
  checkAddSample(t, new Sample("P-MOD", [tsInt("50"), tsInt("-5")], "the largest"))
  checkAddSample(t, new Sample("P-WRAP", [tsInt("9223372036854775807"), tsInt("1")], "wraps up"))
  checkAddSample(t, new Sample("P-WRAP", [tsInt("-9223372036854775808"), tsInt("-1")], "wraps down"))
  checkAddSample(t, new Sample("P-WRAP32", [tsInt("2147483647"), tsInt("1")], "+ wraps up"))
  checkAddSample(t, new Sample("P-WRAP32", [tsInt("-2147483648"), tsInt("1")], "- wraps down"))
  checkAddSample(t, new Sample("P-WRAP32", [tsInt("65536"), tsInt("65536")], "* wraps to 0"))
  checkAddSample(t, new Sample("P-LE64", [tsInt("-2")], "every byte set"))
  checkAddSample(t, new Sample("P-LE64", [tsInt("2147483647")], "i32's maximum"))
  checkAddSample(t, new Sample("P-ORDER", [tsInt("-2147483648")], "i32's minimum"))
  checkAddSample(t, new Sample("P-ORDER", [tsInt("-1")], "every bit set"))
  checkAddSample(t, new Sample("P-ORDER", [tsInt("305419896")], "four distinct bytes"))
  checkAddSample(t, new Sample("P-BITS", [tsHex("0f"), tsHex("f1")], "by hand"))
  checkAddSample(t, new Sample("P-BITS", [tsHex(""), tsHex("")], "empty"))
  checkAddSample(t, new Sample("P-LET", [tsStr("")], "empty"))
  checkAddSample(t, new Sample("P-LET", [tsStr('a"\\\t')], "quotes"))
  checkAddSample(t, new Sample("P-LET", [tsStr("\u0001\u007f")], "control characters"))
  checkAddSample(t, new Sample("P-UNWRAP-B", [tsHex("00")], "by hand"))
  return t
}

/** The forms contract's TypeScript test, importing forms.ts from `dir`'s view; "" when refused. */
const tsEmitForms = (c: Contract, dir: string, harness: string): string => {
  const opts = new EmitOptions("ab")
  opts.regenerate = `vector spec emit ${TS_FORMS} --lang typescript -o forms.test.ts`
  const packages = emitParsePackages(["nish=tests/spec/emit/fixtures/typescript"], "typescript").expect("parse")
  if (emitResolveModules(packages, c, dir, opts, ".ts").isErr()) {
    return ""
  }
  const p = emitTsProgram(c, tsSamples(), opts, harness)
  return p.isOk() ? p.value : ""
}

/** `--lang typescript` and its harnesses. */
const tsTargets = (t: Suite): void => {
  t.eqStr("typescript's harnesses", emitTargetHarnesses("typescript").join(","), "standalone,node")
  t.eqStr("typescript's extension", emitTargetExt("typescript"), ".ts")
  t.eqStr("node is a flag", emitTargetFlags(new EmitTarget("typescript", "node")), " --lang typescript --harness node")
}

/** What the forms contract's TypeScript test says, form by form. */
const tsForms = (t: Suite, p: string): void => {
  t.contains(
    "the header is a comment",
    p,
    "//   vector spec emit tests/spec/emit/fixtures/forms.json --lang typescript",
  )
  t.contains("and holds the contract's sha256", p, "// vector-contract-sha256: ab\n")
  t.contains("forms.ts is imported with its extension", p, ' } from "./fixtures/typescript/forms.ts"\n')
  t.contains("each name in lowerCamelCase", p, "import { addI32, addI64, ")
  t.contains("% truncates, 0 on a zero divisor", p, '_rem(idI32(v_x), 0, "i32")')
  t.contains("i64 + wraps in bigint", p, '_eq(addI64(v_a, v_b), _wrap(BigInt(v_a) + BigInt(v_b), "i64"))')
  t.contains("xor is 0", p, "_bitwise(_b(xorB(v_a, v_b)), v_b, 0)")
  t.contains("a let is a binding", p, "const v_r = nonEmpty(v_s)")
  t.contains("unwrap of bytes", p, "u.get(_b(nonEmptyB(v_a)), new Uint8Array(0))")
  t.contains("P-MOD's rows", p, "  const table_x: number[] = [\n    (-7),\n    (-7),\n    50,\n  ]\n")
  t.contains("P-WRAP's rows are bigints", p, "    9223372036854775807n,\n")
  t.contains("P-LET's escapes", p, '    "\\u0001\\u007f",\n')
  t.contains("a bytes sample from hex", p, "const v_a = _h(table_a[i])")
  t.contains("a null string vector", p, 't.eq_str("[V-NULL-STR]')
  t.contains("is checked as null", p, '_str_or_null(nonEmpty("")), "null")')
  t.contains("an exact f64", p, 't.eq_f64_bits("[V-F64-EXACT]')
  t.contains("-0 from its bits", p, '_f64("8000000000000000")')
  t.contains("within ulps", p, ", 1n)")
  t.contains("u64's maximum", p, "isMax(18446744073709551615n)")
  t.contains("i64's minimum", p, "addI64((-9223372036854775808n), (-1n))")
  t.contains("a secret is plain bytes", p, 'keep(_h("a546"), _h("e6db"))')
  t.contains("an absent optional input is undefined", p, "keepBase(undefined)")
  t.contains("main prints the end line", p, 'console.log("vector-done " + nonce + " " + ran)')
}

/** What TypeScript cannot express is refused before any output; the literal helpers. */
const tsRefusals = (t: Suite): void => {
  const c = contractLoadFile(TS_FORMS).expect("load")
  t.eqStr("forms has no refusal", emitTsRefusals(c).join("\n"), "")
  c.functions[0].name = "delete"
  c.functions[1].name = "test"
  c.functions[2].names = [new NameOverride("typescript", "_raw")]
  c.functions[3].name = "nonEmpty"
  c.clauses[1].id = "P-MOD"
  const why = emitTsRefusals(c).join("\n")
  t.contains("a reserved word", why, "delete: its TypeScript name delete is a reserved word")
  t.contains("a name the test uses", why, "test: its TypeScript name test is one the test uses for its own")
  t.contains("a _ prefix", why, "leBytes: its TypeScript name _raw is one the test uses for its own")
  t.contains("two functions, one name", why, "nonEmpty: its TypeScript name nonEmpty is another function's too")
  t.contains("two clauses, one check", why, "P-MOD: its check would be clause_P_MOD")
  t.ok("so the program is refused", emitTsProgram(c, new SampleTable(), new EmitOptions("0"), "standalone").isErr())
  const forms = contractLoadFile(TS_FORMS).expect("load")
  t.eqStr("lowerCamelCase by default", emitTsName(forms.functions[1]), "addI64")
  t.eqStr("an f64 from its text", emitTsF64("0.5", null), '_f64("3fe0000000000000")')
  t.eqStr("or its bits", emitTsF64("nan", "7ff8000000000001"), '_f64("7ff8000000000001")')
  t.eqStr("a number up to 32 bits", emitTsInt("5", "u8"), "5")
  t.eqStr("a bigint for 64", emitTsInt("5", "u64"), "5n")
  t.eqStr("a negative int in parentheses", emitTsInt("-5", "i64"), "(-5n)")
}

/** Prints what a run that did not hold said, so the failure can be read. */
const tsShow = (stdout: string, stderr: string): void => {
  console.log(stdout)
  console.log(stderr)
}

/** The forms test run by node against forms.ts: every form holds, in each harness; with node, under `--test` too. */
const tsLive = (t: Suite, c: Contract): void => {
  const nv = runProcess([runNode(), "--version"], "", 10000)
  if (nv.isErr() || nv.value.status !== 0) {
    t.skip("every form holds in TypeScript", "no node (set VECTOR_NODE)")
    return
  }
  const dir = makeTempDir("vector-ts-").expect("temp")
  // The test imports forms.ts by a path relative to its own directory.
  const fixtures = joinPath(dir, "fixtures/typescript")
  t.ok("the fixture is copied", runProcess(["mkdir", "-p", fixtures], "", 10000).isOk())
  const copied = runProcess(["cp", "tests/spec/emit/fixtures/typescript/forms.ts", fixtures], "", 10000)
  t.ok("beside the test", copied.isOk())
  for (const harness of ["standalone", "node"]) {
    const p = tsEmitForms(c, "tests/spec/emit", harness)
    const file = joinPath(dir, `forms_${harness}.test.ts`)
    t.ok(`the ${harness} test is written`, p !== "" && writeFileSyncMode(file, p, 0o600) >= 0)
    const ran = runTestCommand(c, [runNode(), "--disable-warning=ExperimentalWarning", file], 60000)
    t.ok(`the ${harness} test ran`, ran.isOk())
    if (ran.isOk()) {
      const r = ran.value
      t.eqStr(`every form holds, ${harness}`, r.verdict.status, "SATISFIED")
      if (r.verdict.status !== "SATISFIED") {
        tsShow(r.stdout, r.stderr)
      }
      t.ok(`every clause ran, ${harness}`, r.clauses.length === c.clauses.length)
    }
  }
  const passed = runProcess([runNode(), "--test", joinPath(dir, "forms_node.test.ts")], "", 60000)
  t.ok("every node:test test passes under --test", passed.isOk() && passed.value.status === 0)
  if (passed.isOk()) {
    // IT-SLOW is the one slow vector: node:test skips it without --slow.
    t.contains("one test per clause", passed.value.stdout, `# pass ${c.clauses.length - 1}\n`)
    t.contains("the slow vector is skipped", passed.value.stdout, "# skipped 1\n")
    if (passed.value.status !== 0) {
      tsShow(passed.value.stdout, passed.value.stderr)
    }
  }
  t.ok("the temp directory is removed", runProcess(["rm", "-rf", dir], "", 10000).isOk())
}

/** The iterate loop: positional steps, a null that names its step, a slow vector skipped unless opts.slow. */
const tsIterate = (t: Suite, c: Contract): void => {
  const opts = new EmitOptions("ab")
  const p = emitTsProgram(c, tsSamples(), opts, "node").expect("emit")
  t.contains(
    "a loop runs steps 1 to count − 1",
    p,
    "for (let it_i = 1; it_i < 3; it_i += 1) {\n    const it_s = _b(xorB(it_a0, it_a1))\n    const it_n0 = it_s\n    const it_n1 = it_a0\n    it_a0 = it_n0\n    it_a1 = it_n1\n  }",
  )
  t.contains("a null mid-loop names its step", p, '"step " + it_i + " of 5: nonEmpty returned null")')
  t.contains("and a null last step", p, '"step 5 of 5: nonEmpty returned null")')
  t.contains(
    "a slow vector is skipped",
    p,
    'return t.skip("[IT-SLOW] IT-SLOW: idI32 iterated 3 times (R-ALL)", "slow: pass --slow to run")',
  )
  t.contains("and node:test skips it", p, '{ skip: "slow: pass --slow to run" }')
  opts.slow = true
  const slow = emitTsProgram(c, tsSamples(), opts, "node").expect("emit with --slow")
  t.contains("with --slow the slow vector runs", slow, "const it_r = idI32(it_a0)")
  t.ok("and nothing is skipped as slow", slow.indexOf("slow: pass --slow to run") < 0)
}

/**
 * Checks the TypeScript emitter: `--lang typescript` and its harnesses, the
 * text it writes for every form the forms contract uses, its refusals, and
 * the forms test run by node against
 * tests/spec/emit/fixtures/typescript/forms.ts, standalone and as
 * `node:test` tests.
 */
export const main = (): i32 => {
  const t = new Suite("spec/emit typescript")
  const c = contractLoadFile(TS_FORMS).expect("load the forms contract")
  tsTargets(t)
  const p = tsEmitForms(c, "tests/spec/emit", "node")
  t.ok("the forms contract emits", p !== "")
  tsForms(t, p)
  tsIterate(t, c)
  t.contains("node's test", p, '  test("[P-MOD] ')
  t.contains("node:test is imported", p, 'import { test } from "node:test"\n')
  t.ok("standalone has no node test", tsEmitForms(c, "tests/spec/emit", "standalone").indexOf("node:test") < 0)
  tsRefusals(t)
  tsLive(t, c)
  return t.done()
}
