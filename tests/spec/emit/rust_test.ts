import { Suite } from "nish/testing"
import { joinPath, makeTempDir } from "../../../src/core/fs"
import { runProcess } from "../../../src/core/process"
import { Sample, SampleTable, checkAddSample } from "../../../src/spec/check"
import { contractLoadFile } from "../../../src/spec/contract/contract"
import { Contract, LitKind, Literal } from "../../../src/spec/contract/types"
import { EmitOptions } from "../../../src/spec/emit/emit"
import { emitParsePackages, emitResolveModules } from "../../../src/spec/emit/packages"
import {
  emitRsF64,
  emitRsInt,
  emitRsName,
  emitRsProgram,
  emitRsQuote,
  emitRsRefusals,
} from "../../../src/spec/emit/rust"
import { EmitTarget, emitTargetExt, emitTargetFlags, emitTargetHarnesses } from "../../../src/spec/emit/target"
import { runRustc } from "../../../src/spec/run/command"
import { runTestCommand } from "../../../src/spec/run/run"

const RS_FORMS: string = "tests/spec/emit/fixtures/forms.json"

const rsInt = (n: string): Literal => new Literal(LitKind.Int, n)
const rsHex = (h: string): Literal => new Literal(LitKind.Hex, h)
const rsStr = (s: string): Literal => new Literal(LitKind.Str, s)

/** forms_test's hand-picked samples: a zero divisor, i64 sums that wrap, a negative le64, escapes. */
const rsSamples = (): SampleTable => {
  const t = new SampleTable()
  checkAddSample(t, new Sample("P-MOD", [rsInt("-7"), rsInt("0")], "a zero divisor"))
  checkAddSample(t, new Sample("P-MOD", [rsInt("-7"), rsInt("3")], "a negative dividend"))
  checkAddSample(t, new Sample("P-MOD", [rsInt("50"), rsInt("-5")], "the largest"))
  checkAddSample(t, new Sample("P-WRAP", [rsInt("9223372036854775807"), rsInt("1")], "wraps up"))
  checkAddSample(t, new Sample("P-WRAP", [rsInt("-9223372036854775808"), rsInt("-1")], "wraps down"))
  checkAddSample(t, new Sample("P-WRAP32", [rsInt("2147483647"), rsInt("1")], "+ wraps up"))
  checkAddSample(t, new Sample("P-WRAP32", [rsInt("-2147483648"), rsInt("1")], "- wraps down"))
  checkAddSample(t, new Sample("P-WRAP32", [rsInt("65536"), rsInt("65536")], "* wraps to 0"))
  checkAddSample(t, new Sample("P-LE64", [rsInt("-2")], "every byte set"))
  checkAddSample(t, new Sample("P-LE64", [rsInt("2147483647")], "i32's maximum"))
  checkAddSample(t, new Sample("P-ORDER", [rsInt("-2147483648")], "i32's minimum"))
  checkAddSample(t, new Sample("P-ORDER", [rsInt("-1")], "every bit set"))
  checkAddSample(t, new Sample("P-ORDER", [rsInt("305419896")], "four distinct bytes"))
  checkAddSample(t, new Sample("P-BITS", [rsHex("0f"), rsHex("f1")], "by hand"))
  checkAddSample(t, new Sample("P-BITS", [rsHex(""), rsHex("")], "empty"))
  checkAddSample(t, new Sample("P-LET", [rsStr("")], "empty"))
  checkAddSample(t, new Sample("P-LET", [rsStr('a"\\\t')], "quotes"))
  checkAddSample(t, new Sample("P-LET", [rsStr("\u0001\u007f")], "control characters"))
  checkAddSample(t, new Sample("P-UNWRAP-B", [rsHex("00")], "by hand"))
  return t
}

/** The forms contract's Rust test, loading forms.rs from `dir`'s view; "" when refused. */
const rsEmitForms = (c: Contract, dir: string, harness: string): string => {
  const opts = new EmitOptions("ab")
  opts.regenerate = `vector spec emit ${RS_FORMS} --lang rust -o forms_test.rs`
  const packages = emitParsePackages(["nish=tests/spec/emit/fixtures"], "rust").expect("parse")
  if (emitResolveModules(packages, c, dir, opts, ".rs").isErr()) {
    return ""
  }
  const p = emitRsProgram(c, rsSamples(), opts, harness)
  return p.isOk() ? p.value : ""
}

/** `--lang rust` and its harnesses. */
const rsTargets = (t: Suite): void => {
  t.eqStr("rust's harnesses", emitTargetHarnesses("rust").join(","), "standalone,cargo")
  t.eqStr("rust's extension", emitTargetExt("rust"), ".rs")
  t.eqStr("cargo is a flag", emitTargetFlags(new EmitTarget("rust", "cargo")), " --lang rust --harness cargo")
  const slowTarget = new EmitTarget("rust", "cargo")
  slowTarget.slow = true
  t.eqStr("--slow is a flag after the others", emitTargetFlags(slowTarget), " --lang rust --harness cargo --slow")
  const slowNish = new EmitTarget("nish", "standalone")
  slowNish.slow = true
  t.eqStr("--slow alone for the default target", emitTargetFlags(slowNish), " --slow")
}

/** What the forms contract's Rust test says, form by form. */
const rsForms = (t: Suite, p: string): void => {
  t.contains("the header is a comment", p, "//   vector spec emit tests/spec/emit/fixtures/forms.json --lang rust")
  t.contains("and holds the contract's sha256", p, "// vector-contract-sha256: ab\n")
  t.contains("forms.rs is loaded by path", p, '#[path = "./fixtures/forms.rs"]\nmod _m0;\n')
  t.contains("each name in snake_case", p, "use _m0::{add_i32, add_i64, ")
  t.contains("% truncates, 0 on a zero divisor", p, "(_rem((id_i32(v_x)) as i128, (0i32) as i128) as i32)")
  t.contains("i64 + wraps", p, "(add_i64(v_a, v_b) == (v_a).wrapping_add(v_b))")
  t.contains("xor is 0", p, "_bitwise(&(_b(xor_b(&v_a, &v_b))), &v_b, 0)")
  t.contains("a let is a binding", p, "let v_r = _os(non_empty(&v_s));")
  t.contains("unwrap of bytes", p, "u.b(_ob(non_empty_b(&v_a)))")
  t.contains("P-MOD's rows", p, "    let table_x: &[i32] = &[\n        -7,\n        -7,\n        50,\n    ];\n")
  t.contains("P-LET's escapes", p, '        "\\u{01}\\u{7f}",\n')
  t.contains("a null string vector", p, '&_str_or_null(_os(non_empty(""))), "null")')
  t.contains("an exact f64", p, 't.eq_f64_bits("[V-F64-EXACT]')
  t.contains("-0 from its bits", p, "f64::from_bits(0x8000000000000000)")
  t.contains("u64's maximum", p, "is_max(18446744073709551615u64)")
  t.contains("i64's minimum", p, "add_i64((-9223372036854775808i64), (-1i64))")
  t.contains("a secret is plain bytes", p, 'keep(&_h("a546"), &_h("e6db"))')
  t.contains("an optional input", p, 'keep_base(Some(&_h("')
  t.contains("main prints the end line", p, 'println!("vector-done {} {}", nonce, ran);')
}

/** What Rust cannot express is refused before any output; the literal helpers. */
const rsRefusals = (t: Suite): void => {
  const c = contractLoadFile(RS_FORMS).expect("load")
  t.eqStr("forms has no refusal", emitRsRefusals(c).join("\n"), "")
  c.functions[0].name = "match"
  c.functions[1].name = "testIt"
  c.functions[3].name = "nonEmpty"
  c.clauses[1].id = "P-MOD"
  const why = emitRsRefusals(c).join("\n")
  t.contains("a keyword", why, "match: its Rust name match is a keyword")
  t.contains("a name the test uses", why, "testIt: its Rust name test_it is one the test uses for its own")
  t.contains("two functions, one name", why, "nonEmpty: its Rust name non_empty is another function's too")
  t.contains("two clauses, one check", why, "P-MOD: its check would be clause_P_MOD")
  t.ok("so the program is refused", emitRsProgram(c, new SampleTable(), new EmitOptions("0"), "standalone").isErr())
  t.eqStr("snake_case by default", emitRsName(contractLoadFile(RS_FORMS).expect("load").functions[1]), "add_i64")
  t.eqStr("an f64 from its text", emitRsF64("0.5", null), "f64::from_bits(0x3fe0000000000000)")
  t.eqStr("or its bits", emitRsF64("nan", "7ff8000000000001"), "f64::from_bits(0x7ff8000000000001)")
  t.eqStr("an int at its type", emitRsInt("5", "u8"), "5u8")
  t.eqStr("a negative int in parentheses", emitRsInt("-5", "i64"), "(-5i64)")
  t.eqStr("a quote escapes", emitRsQuote('a"\\\n\u0001é'), '"a\\"\\\\\\n\\u{01}é"')
}

/** Prints what a run that did not hold said, so the failure can be read. */
const rsShow = (stdout: string, stderr: string): void => {
  console.log(stdout)
  console.log(stderr)
}

/** The forms test compiled by rustc against forms.rs and run: every form holds; with cargo, under `--test` too. */
const rsLive = (t: Suite, c: Contract): void => {
  const rc = runProcess([runRustc(), "--version"], "", 10000)
  if (rc.isErr() || rc.value.status !== 0) {
    t.skip("every form holds in Rust", "no rustc (set VECTOR_RUSTC)")
    return
  }
  const dir = makeTempDir("vector-rs-").expect("temp")
  // The test loads forms.rs by a path relative to its own directory.
  const fixtures = joinPath(dir, "fixtures")
  t.ok("the fixture is copied", runProcess(["mkdir", fixtures], "", 10000).isOk())
  t.ok("beside the test", runProcess(["cp", "tests/spec/emit/fixtures/forms.rs", fixtures], "", 10000).isOk())
  for (const harness of ["standalone", "cargo"]) {
    const p = rsEmitForms(c, "tests/spec/emit", harness)
    const file = joinPath(dir, `forms_${harness}_test.rs`)
    const bin = joinPath(dir, `forms_${harness}`)
    t.ok(`the ${harness} test is written`, p !== "" && writeFileSyncMode(file, p, 0o600) >= 0)
    const build = '"$1" --edition 2021 -C overflow-checks=on -o "$3" "$2" && exec "$3" "$4"'
    const ran = runTestCommand(c, ["sh", "-c", build, "sh", runRustc(), file, bin], 120000)
    t.ok(`the ${harness} test ran`, ran.isOk())
    if (ran.isOk()) {
      const r = ran.value
      t.eqStr(`every form holds, ${harness}`, r.verdict.status, "SATISFIED")
      if (r.verdict.status !== "SATISFIED") {
        rsShow(r.stdout, r.stderr)
      }
      t.ok(`every clause ran, ${harness}`, r.clauses.length === c.clauses.length)
    }
  }
  const cargo = joinPath(dir, "forms_cargo_test.rs")
  const tests = joinPath(dir, "forms_tests")
  const built = runProcess([runRustc(), "--edition", "2021", "--test", "-o", tests, cargo], "", 120000)
  t.ok("the cargo test builds under --test", built.isOk() && built.value.status === 0)
  const passed = runProcess([tests], "", 60000)
  t.ok("and every #[test] passes", passed.isOk() && passed.value.status === 0)
  if (passed.isOk() && passed.value.status !== 0) {
    rsShow(passed.value.stdout, passed.value.stderr)
  }
  t.ok("the temp directory is removed", runProcess(["rm", "-rf", dir], "", 10000).isOk())
}

/** The iterate loop: positional steps, a null that names its step, a slow vector skipped unless opts.slow. */
const rsIterate = (t: Suite, c: Contract): void => {
  const opts = new EmitOptions("ab")
  const p = emitRsProgram(c, rsSamples(), opts, "cargo").expect("emit")
  t.contains(
    "a loop runs steps 1 to count − 1",
    p,
    "for _ in 1..3 {\n        let it_s = _b(xor_b(&it_a0, &it_a1));\n        let it_n0 = it_s.clone();\n        let it_n1 = it_a0.clone();\n        it_a0 = it_n0;\n        it_a1 = it_n1;\n    }",
  )
  t.contains(
    "a null mid-loop names its step",
    p,
    'None => return t.fail("[IT-STR] IT-STR: nonEmpty iterated 5 times (R-ALL)", &format!("step {} of 5: nonEmpty returned null", it_i)),',
  )
  t.contains("and a null last step", p, '"step 5 of 5: nonEmpty returned null");')
  t.contains(
    "a slow vector is skipped",
    p,
    't.skip("[IT-SLOW] IT-SLOW: idI32 iterated 3 times (R-ALL)", "slow: pass --slow to run")',
  )
  t.contains("and cargo ignores it", p, '#[ignore = "slow: pass --slow to run"]\nfn test_IT_SLOW() {')
  opts.slow = true
  const slow = emitRsProgram(c, rsSamples(), opts, "cargo").expect("emit with --slow")
  t.contains("with --slow the slow vector runs", slow, "let it_r = id_i32(it_a0);")
  t.ok("and nothing is skipped as slow", slow.indexOf("slow: pass --slow to run") < 0)
}

/**
 * Checks the Rust emitter: `--lang rust` and its harnesses, the text it
 * writes for every form the forms contract uses, its refusals, and the forms
 * test compiled by rustc against tests/spec/emit/fixtures/forms.rs and run,
 * standalone and as cargo `#[test]`s.
 */
export const main = (): i32 => {
  const t = new Suite("spec/emit rust")
  const c = contractLoadFile(RS_FORMS).expect("load the forms contract")
  rsTargets(t)
  const p = rsEmitForms(c, "tests/spec/emit", "cargo")
  t.ok("the forms contract emits", p !== "")
  rsForms(t, p)
  rsIterate(t, c)
  t.contains("cargo's test", p, '#[test]\nfn test_P_MOD() {\n    _cargo(clause_P_MOD, "[P-MOD]')
  t.ok("standalone has no cargo test", rsEmitForms(c, "tests/spec/emit", "standalone").indexOf("#[test]") < 0)
  rsRefusals(t)
  rsLive(t, c)
  return t.done()
}
