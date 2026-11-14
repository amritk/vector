import { Suite } from "nish/testing"
import { joinPath, makeTempDir } from "../../../src/core/fs"
import { runProcess } from "../../../src/core/process"
import { Sample, SampleTable, checkAddSample } from "../../../src/spec/check"
import { contractLoadFile } from "../../../src/spec/contract/contract"
import { Contract, LitKind, Literal } from "../../../src/spec/contract/types"
import { EmitOptions, emitClauseLines, emitHeaderLines } from "../../../src/spec/emit/emit"
import { emitParsePackages, emitResolveModules } from "../../../src/spec/emit/packages"
import { emitPyF64, emitPyName, emitPyProgram, emitPyRefusals } from "../../../src/spec/emit/python"
import {
  EmitTarget,
  emitTargetExt,
  emitTargetFlags,
  emitTargetHarnesses,
  emitTargetLanguages,
  emitTargetParse,
} from "../../../src/spec/emit/target"
import { runPython } from "../../../src/spec/run/command"
import { runTestCommand } from "../../../src/spec/run/run"

const PY_FORMS: string = "tests/spec/emit/fixtures/forms.json"

const pyInt = (n: string): Literal => new Literal(LitKind.Int, n)
const pyHex = (h: string): Literal => new Literal(LitKind.Hex, h)
const pyStr = (s: string): Literal => new Literal(LitKind.Str, s)

/** forms_test's hand-picked samples: a zero divisor, i64 sums that wrap, a negative le64, escapes. */
const pySamples = (): SampleTable => {
  const t = new SampleTable()
  checkAddSample(t, new Sample("P-MOD", [pyInt("-7"), pyInt("0")], "a zero divisor"))
  checkAddSample(t, new Sample("P-MOD", [pyInt("-7"), pyInt("3")], "a negative dividend"))
  checkAddSample(t, new Sample("P-MOD", [pyInt("50"), pyInt("-5")], "the largest"))
  checkAddSample(t, new Sample("P-WRAP", [pyInt("9223372036854775807"), pyInt("1")], "wraps up"))
  checkAddSample(t, new Sample("P-WRAP", [pyInt("-9223372036854775808"), pyInt("-1")], "wraps down"))
  checkAddSample(t, new Sample("P-WRAP32", [pyInt("2147483647"), pyInt("1")], "+ wraps up"))
  checkAddSample(t, new Sample("P-WRAP32", [pyInt("-2147483648"), pyInt("1")], "- wraps down"))
  checkAddSample(t, new Sample("P-WRAP32", [pyInt("65536"), pyInt("65536")], "* wraps to 0"))
  checkAddSample(t, new Sample("P-LE64", [pyInt("-2")], "every byte set"))
  checkAddSample(t, new Sample("P-LE64", [pyInt("2147483647")], "i32's maximum"))
  checkAddSample(t, new Sample("P-BITS", [pyHex("0f"), pyHex("f1")], "by hand"))
  checkAddSample(t, new Sample("P-BITS", [pyHex(""), pyHex("")], "empty"))
  checkAddSample(t, new Sample("P-LET", [pyStr("")], "empty"))
  checkAddSample(t, new Sample("P-LET", [pyStr('a"\\\t')], "quotes"))
  checkAddSample(t, new Sample("P-LET", [pyStr("\u0001\u007f")], "control characters"))
  checkAddSample(t, new Sample("P-UNWRAP-B", [pyHex("00")], "by hand"))
  return t
}

/** The forms contract's Python test, importing forms.py from `dir`'s view; "" when refused. */
const pyEmitForms = (c: Contract, dir: string, harness: string): string => {
  const opts = new EmitOptions("ab")
  opts.regenerate = `vector spec emit ${PY_FORMS} --lang python -o forms_test.py`
  const packages = emitParsePackages(["nish=tests/spec/emit/fixtures"], "python").expect("parse")
  if (emitResolveModules(packages, c, dir, opts, ".py").isErr()) {
    return ""
  }
  const p = emitPyProgram(c, pySamples(), opts, harness)
  return p.isOk() ? p.value : ""
}

/** `--lang` and `--harness`: what they accept, their defaults, and the flags that rebuild them. */
const pyTargets = (t: Suite): void => {
  t.eqStr("the languages, nish first", emitTargetLanguages().join(","), "nish,python,rust,go,typescript")
  t.eqStr("python's harnesses", emitTargetHarnesses("python").join(","), "standalone,pytest")
  t.eqStr("a language with no emitter has none", `${emitTargetHarnesses("cobol").length}`, "0")
  const d = emitTargetParse(null, null).expect("defaults")
  t.eqStr("the default language", d.lang, "nish")
  t.eqStr("the default harness", d.harness, "standalone")
  t.eqStr("python's default harness", emitTargetParse("python", null).expect("py").harness, "standalone")
  const known = emitTargetParse("zig", null)
  t.eqStr(
    "a language vector names but has no emitter for",
    known.isErr() ? known.error : "",
    "--lang zig: vector has no emitter for zig yet (it has: nish, python, rust, go, typescript)",
  )
  const unknown = emitTargetParse("cobol", null)
  t.eqStr(
    "not a language",
    unknown.isErr() ? unknown.error : "",
    "--lang cobol: not a language (vector emits: nish, python, rust, go, typescript)",
  )
  const bad = emitTargetParse("nish", "pytest")
  t.eqStr("a harness the language has not", bad.isErr() ? bad.error : "", "--harness pytest: nish tests run standalone")
  t.eqStr("defaults rebuild with no flags", emitTargetFlags(new EmitTarget("nish", "standalone")), "")
  t.eqStr("a language is a flag", emitTargetFlags(new EmitTarget("python", "standalone")), " --lang python")
  t.eqStr("so is a harness", emitTargetFlags(new EmitTarget("python", "pytest")), " --lang python --harness pytest")
  t.eqStr("python's extension", emitTargetExt("python"), ".py")
  t.eqStr("nish's", emitTargetExt("nish"), ".ts")
}

/** What the forms contract's Python test says, form by form. */
const pyForms = (t: Suite, p: string): void => {
  t.contains("the header is a comment", p, "#   vector spec emit tests/spec/emit/fixtures/forms.json --lang python")
  t.contains("and holds the contract's sha256", p, "# vector-contract-sha256: ab\n")
  t.contains("forms.py is loaded by path", p, '_m0 = _load("nish.forms", ')
  t.contains("each name in snake_case", p, "add_i64 = _m0.add_i64\n")
  t.contains("% truncates, 0 on a zero divisor", p, '_rem(id_i32(v_x), 0, "i32") == 0')
  t.contains("i64 + wraps", p, '(add_i64(v_a, v_b) == _wrap(v_a + v_b, "i64"))')
  t.contains("xor is 0", p, "_bitwise(_b(xor_b(v_a, v_b)), v_b, 0)")
  t.contains("a let is an assignment", p, "v_r = non_empty(v_s)")
  t.contains("unwrap of bytes", p, 'u.get(_b(non_empty_b(v_a)), b"")')
  t.contains("P-MOD's rows", p, "    table_x = [\n        (-7),\n        (-7),\n        50,\n    ]\n")
  t.contains("P-LET's escapes", p, '        "\\u0001\\u007f",\n')
  t.contains("a null string vector", p, '_str_or_null(non_empty("")), "null")')
  t.contains("an exact f64", p, 't.eq_f64_bits("[V-F64-EXACT]')
  t.contains("-0 from its bits", p, '_f64("8000000000000000")')
  t.contains("u64's maximum", p, "is_max(18446744073709551615)")
  t.contains("i64's minimum", p, "add_i64((-9223372036854775808), (-1))")
  t.contains("a secret is plain bytes", p, 'keep(bytes.fromhex("a546"), bytes.fromhex("e6db"))')
  t.contains("main prints the end line", p, 'print(f"vector-done {nonce} {ran}")')
}

/** What Python cannot express is refused before any output. */
const pyRefusals = (t: Suite): void => {
  const c = contractLoadFile(PY_FORMS).expect("load")
  t.eqStr("forms has no refusal", emitPyRefusals(c).join("\n"), "")
  c.functions[0].name = "lambda"
  c.functions[1].name = "testIt"
  c.functions[3].name = "nonEmpty"
  c.functions[6].name = "t"
  c.functions[7].name = "memoryview"
  c.clauses[1].id = "P-MOD"
  const why = emitPyRefusals(c).join("\n")
  t.contains("a keyword", why, "lambda: its Python name lambda is a keyword")
  t.contains("the suite a check is given", why, "t: its Python name t is one the test uses for its own")
  t.contains("a builtin the runtime calls", why, "memoryview: its Python name memoryview is one the test uses")
  t.contains("a name the test uses", why, "testIt: its Python name test_it is one the test uses for its own")
  t.contains("two functions, one name", why, "nonEmpty: its Python name non_empty is another function's too")
  t.contains("two clauses, one check", why, "P-MOD: its check would be clause_P_MOD")
  t.ok("so the program is refused", emitPyProgram(c, new SampleTable(), new EmitOptions("0"), "standalone").isErr())
  t.eqStr(
    "a python override is the name",
    emitPyName(contractLoadFile(PY_FORMS).expect("load").functions[1]),
    "add_i64",
  )
  t.eqStr("an f64 from its text", emitPyF64("0.5", null), '_f64("3fe0000000000000")')
  t.eqStr("or its bits", emitPyF64("nan", "7ff8000000000001"), '_f64("7ff8000000000001")')
}

/** The pieces the Nish and Python tests share: the header, and a clause's quoted requirements. */
const pyShared = (t: Suite, c: Contract): void => {
  const opts = new EmitOptions("cd")
  opts.regenerate = "vector spec emit x.json -o x.py"
  const header = emitHeaderLines(c, opts)
  t.contains("the header names how to regenerate", header.join("\n"), "  vector spec emit x.json -o x.py.")
  t.eqStr("and ends with the sha256", header[header.length - 1], "vector-contract-sha256: cd")
  const lines = emitClauseLines(c, c.clauses[0])
  t.eqStr("a clause opens with its title", lines[0], c.clauses[0].title)
  t.eqStr("then a blank line before each requirement", lines[1], "")
}

/** The forms test run by python3 against forms.py: every form holds. */
const pyLive = (t: Suite, c: Contract): void => {
  const py = runProcess([runPython(), "--version"], "", 10000)
  if (py.isErr() || py.value.status !== 0) {
    t.skip("every form holds in Python", "no python3 (set VECTOR_PYTHON)")
    return
  }
  const dir = makeTempDir("vector-py-").expect("temp")
  for (const harness of ["standalone", "pytest"]) {
    const p = pyEmitForms(c, dir, harness)
    const file = joinPath(dir, `forms_${harness}_test.py`)
    t.ok(`the ${harness} test is written`, p !== "" && writeFileSyncMode(file, p, 0o600) >= 0)
    const ran = runTestCommand(c, [runPython(), "-B", file], 60000)
    t.ok(`the ${harness} test ran`, ran.isOk())
    if (ran.isOk()) {
      const r = ran.value
      t.eqStr(`every form holds, ${harness}`, r.verdict.status, "SATISFIED")
      if (r.verdict.status !== "SATISFIED") {
        console.log(r.stdout)
        console.log(r.stderr)
      }
      t.ok(`every clause ran, ${harness}`, r.clauses.length === c.clauses.length)
    }
  }
  t.ok("the temp directory is removed", runProcess(["rm", "-rf", dir], "", 10000).isOk())
}

/**
 * Checks the Python emitter: `--lang`/`--harness`, the text it writes for
 * every form the forms contract uses, its refusals, and the forms test run by
 * python3 against tests/spec/emit/fixtures/forms.py.
 */
export const main = (): i32 => {
  const t = new Suite("spec/emit python")
  const c = contractLoadFile(PY_FORMS).expect("load the forms contract")
  pyTargets(t)
  const p = pyEmitForms(c, "tests/spec/emit", "pytest")
  t.ok("the forms contract emits", p !== "")
  pyForms(t, p)
  t.contains("pytest's hook", p, 'def test_P_MOD():\n    _pytest(clause_P_MOD, "[P-MOD]')
  t.ok("standalone has no pytest hook", pyEmitForms(c, "tests/spec/emit", "standalone").indexOf("def test_") < 0)
  pyRefusals(t)
  pyShared(t, c)
  pyLive(t, c)
  return t.done()
}
