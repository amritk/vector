import { Suite } from "nish/testing"
import { joinPath, makeTempDir } from "../../../src/core/fs"
import { runProcess } from "../../../src/core/process"
import { Sample, SampleTable, checkAddSample } from "../../../src/spec/check"
import { contractLoadFile } from "../../../src/spec/contract/contract"
import { Contract, LitKind, Literal, NameOverride } from "../../../src/spec/contract/types"
import { EmitOptions } from "../../../src/spec/emit/emit"
import { emitGoF64, emitGoInt, emitGoName, emitGoProgram, emitGoQuote, emitGoRefusals } from "../../../src/spec/emit/go"
import { emitParsePackages, emitResolveModules } from "../../../src/spec/emit/packages"
import { EmitTarget, emitTargetExt, emitTargetFlags, emitTargetHarnesses } from "../../../src/spec/emit/target"
import { runGo } from "../../../src/spec/run/command"
import { runTestCommand } from "../../../src/spec/run/run"

const GO_FORMS: string = "tests/spec/emit/fixtures/forms.json"

const goInt = (n: string): Literal => new Literal(LitKind.Int, n)
const goHex = (h: string): Literal => new Literal(LitKind.Hex, h)
const goStr = (s: string): Literal => new Literal(LitKind.Str, s)

/** forms_test's hand-picked samples: a zero divisor, i64 sums that wrap, a negative le64, escapes. */
const goSamples = (): SampleTable => {
  const t = new SampleTable()
  checkAddSample(t, new Sample("P-MOD", [goInt("-7"), goInt("0")], "a zero divisor"))
  checkAddSample(t, new Sample("P-MOD", [goInt("-7"), goInt("3")], "a negative dividend"))
  checkAddSample(t, new Sample("P-MOD", [goInt("50"), goInt("-5")], "the largest"))
  checkAddSample(t, new Sample("P-WRAP", [goInt("9223372036854775807"), goInt("1")], "wraps up"))
  checkAddSample(t, new Sample("P-WRAP", [goInt("-9223372036854775808"), goInt("-1")], "wraps down"))
  checkAddSample(t, new Sample("P-WRAP32", [goInt("2147483647"), goInt("1")], "+ wraps up"))
  checkAddSample(t, new Sample("P-WRAP32", [goInt("-2147483648"), goInt("1")], "- wraps down"))
  checkAddSample(t, new Sample("P-WRAP32", [goInt("65536"), goInt("65536")], "* wraps to 0"))
  checkAddSample(t, new Sample("P-LE64", [goInt("-2")], "every byte set"))
  checkAddSample(t, new Sample("P-LE64", [goInt("2147483647")], "i32's maximum"))
  checkAddSample(t, new Sample("P-ORDER", [goInt("-2147483648")], "i32's minimum"))
  checkAddSample(t, new Sample("P-ORDER", [goInt("-1")], "every bit set"))
  checkAddSample(t, new Sample("P-ORDER", [goInt("305419896")], "four distinct bytes"))
  checkAddSample(t, new Sample("P-BITS", [goHex("0f"), goHex("f1")], "by hand"))
  checkAddSample(t, new Sample("P-BITS", [goHex(""), goHex("")], "empty"))
  checkAddSample(t, new Sample("P-LET", [goStr("")], "empty"))
  checkAddSample(t, new Sample("P-LET", [goStr('a"\\\t')], "quotes"))
  checkAddSample(t, new Sample("P-LET", [goStr("\u0001\u007f")], "control characters"))
  checkAddSample(t, new Sample("P-UNWRAP-B", [goHex("00")], "by hand"))
  return t
}

/** The forms contract's Go test, importing forms.go as nish/forms from `dir`'s view; "" when refused. */
const goEmitForms = (c: Contract, dir: string, harness: string): string => {
  const opts = new EmitOptions("ab")
  opts.regenerate = `vector spec emit ${GO_FORMS} --lang go -o forms_test.go`
  const packages = emitParsePackages(["nish=tests/spec/emit/fixtures"], "go").expect("parse")
  if (emitResolveModules(packages, c, dir, opts, ".go").isErr()) {
    return ""
  }
  const p = emitGoProgram(c, goSamples(), opts, harness)
  return p.isOk() ? p.value : ""
}

/** `--lang go` and its harnesses. */
const goTargets = (t: Suite): void => {
  t.eqStr("go's harnesses", emitTargetHarnesses("go").join(","), "standalone,gotest")
  t.eqStr("go's extension", emitTargetExt("go"), ".go")
  t.eqStr("gotest is a flag", emitTargetFlags(new EmitTarget("go", "gotest")), " --lang go --harness gotest")
}

/** What the forms contract's Go test says, form by form. */
const goForms = (t: Suite, p: string): void => {
  t.contains("the header is a comment", p, "//   vector spec emit tests/spec/emit/fixtures/forms.json --lang go")
  t.contains("and holds the contract's sha256", p, "// vector-contract-sha256: ab\n\npackage main\n")
  t.contains("forms is imported by its path", p, '\t_m0 "nish/forms"\n)\n')
  t.contains("each name exported, ID an initialism", p, "_m0.IDI32(v_x)")
  t.contains("% truncates, 0 on a zero divisor", p, "_rem(_m0.IDI32(v_x), int32(0))")
  t.contains("i64 + wraps", p, "(_m0.AddI64(v_a, v_b) == _add(v_a, v_b))")
  t.contains("xor is 0", p, "_eqb(_bitwise(_m0.XorB(v_a, v_b), v_b, 0), v_a)")
  t.contains("a let is a var", p, "\t\tvar v_r *string = _os(_m0.NonEmpty(v_s))\n\t\t_ = v_r\n")
  t.contains("unwrap of bytes", p, "u.b(_ob(_m0.NonEmptyB(v_a)))")
  t.contains("P-MOD's rows", p, "\ttable_x := []int32{\n\t\t-7,\n\t\t-7,\n\t\t50,\n\t}\n")
  t.contains("P-LET's escapes", p, '\t\t"\\u0001\\u007f",\n')
  t.contains("a null string vector", p, '_strOrNull(_os(_m0.NonEmpty(""))), "null")')
  t.contains("an exact f64", p, 't.eqF64Bits("[V-F64-EXACT]')
  t.contains("-0 from its bits", p, "math.Float64frombits(0x8000000000000000)")
  t.contains("u64's maximum", p, "_m0.IsMax(uint64(18446744073709551615))")
  t.contains("i64's minimum", p, "_m0.AddI64(int64(-9223372036854775808), int64(-1))")
  t.contains("a secret is plain bytes", p, '_m0.Keep(_h("a546"), _h("e6db"))')
  t.contains("an optional input", p, '_m0.KeepBase(_some(_h("7707")))')
  t.contains("an absent one is nil", p, "_m0.KeepBase(nil)")
  t.contains("main prints the end line", p, '\tfmt.Printf("vector-done %s %s\\n", nonce, ran)\n')
}

/** What Go cannot express is refused before any output; the literal helpers. */
const goRefusals = (t: Suite): void => {
  const c = contractLoadFile(GO_FORMS).expect("load")
  t.eqStr("forms has no refusal", emitGoRefusals(c).join("\n"), "")
  c.functions[0].names = [new NameOverride("go", "idI32")]
  c.functions[1].names = [new NameOverride("go", "_Add")]
  c.functions[3].name = "nonEmpty"
  c.clauses[1].id = "P-MOD"
  const why = emitGoRefusals(c).join("\n")
  t.contains("an unexported name", why, "idI32 is not exported (it must start with a capital)")
  t.contains("an underscore first", why, "its Go name _Add is not exported")
  t.contains("two functions, one name", why, "nonEmpty: its Go name NonEmpty is another function's too")
  t.contains("two clauses, one check", why, "P-MOD: its check would be clause_P_MOD")
  t.ok("so the program is refused", emitGoProgram(c, new SampleTable(), new EmitOptions("0"), "standalone").isErr())
  const fresh = contractLoadFile(GO_FORMS).expect("load")
  t.eqStr("MixedCaps by default", emitGoName(fresh.functions[1]), "AddI64")
  t.eqStr("an f64 from its text", emitGoF64("0.5", null), "math.Float64frombits(0x3fe0000000000000)")
  t.eqStr("or its bits", emitGoF64("nan", "7ff8000000000001"), "math.Float64frombits(0x7ff8000000000001)")
  t.eqStr("an int at its type", emitGoInt("5", "u8"), "uint8(5)")
  t.eqStr("a negative int", emitGoInt("-5", "i64"), "int64(-5)")
  t.eqStr("a quote escapes", emitGoQuote('a"\\\n\u0001é\u{1F600}'), '"a\\"\\\\\\n\\u0001\\u00e9\\U0001f600"')
}

/** Prints what a run that did not hold said, so the failure can be read. */
const goShow = (stdout: string, stderr: string): void => {
  console.log(stdout)
  console.log(stderr)
}

/** A module at `dir`: forms.go as the module nish's package nish/forms, and the test as `name`. */
const GO_MODULE: string = `go="$1"; dir="$2"; test="$3"; name="$4"
mkdir -p "$dir/nish/forms" || exit 2
cp tests/spec/emit/fixtures/forms.go "$dir/nish/forms/" || exit 2
printf 'module nish\\n\\ngo 1.21\\n' > "$dir/nish/go.mod"
printf 'module vectortest\\n\\ngo 1.21\\n\\nrequire nish v0.0.0\\nreplace nish => ./nish\\n' > "$dir/go.mod"
cp "$test" "$dir/$name" || exit 2
cd "$dir"`

/** The forms test built by go against forms.go and run: every form holds; with gotest, under `go test` too. */
const goLive = (t: Suite, c: Contract): void => {
  const gv = runProcess([runGo(), "version"], "", 10000)
  if (gv.isErr() || gv.value.status !== 0) {
    t.skip("every form holds in Go", "no go (set VECTOR_GO)")
    return
  }
  const env = "GOTOOLCHAIN=local GOPROXY=off GOFLAGS=-mod=mod"
  for (const harness of ["standalone", "gotest"]) {
    const dir = makeTempDir("vector-go-").expect("temp")
    const p = goEmitForms(c, "tests/spec/emit", harness)
    const file = joinPath(dir, `forms_${harness}.go.txt`)
    t.ok(`the ${harness} test is written`, p !== "" && writeFileSyncMode(file, p, 0o600) >= 0)
    const mod = joinPath(dir, "build")
    const build = `${GO_MODULE}\n${env} "$go" build -o test . && exec ./test "$5"`
    const ran = runTestCommand(c, ["sh", "-c", build, "sh", runGo(), mod, file, "main.go"], 120000)
    t.ok(`the ${harness} test ran`, ran.isOk())
    if (ran.isOk()) {
      const r = ran.value
      t.eqStr(`every form holds, ${harness}`, r.verdict.status, "SATISFIED")
      if (r.verdict.status !== "SATISFIED") {
        goShow(r.stdout, r.stderr)
      }
      t.ok(`every clause ran, ${harness}`, r.clauses.length === c.clauses.length)
    }
    if (harness === "gotest") {
      const tests = joinPath(dir, "tests")
      const gotest = `${GO_MODULE}\n${env} "$go" test -count=1 .`
      const passed = runProcess(["sh", "-c", gotest, "sh", runGo(), tests, file, "main_test.go"], "", 120000)
      t.ok("and every go test passes", passed.isOk() && passed.value.status === 0)
      if (passed.isOk() && passed.value.status !== 0) {
        goShow(passed.value.stdout, passed.value.stderr)
      }
    }
    t.ok(`the ${harness} temp directory is removed`, runProcess(["rm", "-rf", dir], "", 10000).isOk())
  }
}

/** The iterate loop: positional steps, a null that names its step, a slow vector skipped unless opts.slow. */
const goIterate = (t: Suite, c: Contract): void => {
  const opts = new EmitOptions("ab")
  const p = emitGoProgram(c, goSamples(), opts, "gotest").expect("emit")
  t.contains(
    "a loop runs steps 1 to count − 1",
    p,
    "for it_i := 1; it_i < 3; it_i++ {\n\t\tit_s := _m0.XorB(it_a0, it_a1)\n\t\tit_n0 := it_s\n\t\tit_n1 := it_a0\n\t\tit_a0 = it_n0\n\t\tit_a1 = it_n1\n\t}",
  )
  t.contains("a null mid-loop names its step", p, 'fmt.Sprintf("step %d of 5: nonEmpty returned null", it_i))')
  t.contains("and a null last step", p, '"step 5 of 5: nonEmpty returned null")')
  t.contains("an optional step is dereferenced", p, "it_n0 := *it_s\n")
  t.contains(
    "a slow vector is skipped",
    p,
    'return t.skip("[IT-SLOW] IT-SLOW: idI32 iterated 3 times (R-ALL)", "slow: pass --slow to run")',
  )
  opts.slow = true
  const slow = emitGoProgram(c, goSamples(), opts, "gotest").expect("emit with --slow")
  t.contains("with --slow the slow vector runs", slow, "it_r := _m0.IDI32(it_a0)")
  t.ok("and nothing is skipped as slow", slow.indexOf("slow: pass --slow to run") < 0)
}

/**
 * Checks the Go emitter: `--lang go` and its harnesses, the text it writes
 * for every form the forms contract uses, its refusals, and the forms test
 * built by go against tests/spec/emit/fixtures/forms.go and run, standalone
 * and as `go test`'s `Test*` functions.
 */
export const main = (): i32 => {
  const t = new Suite("spec/emit go")
  const c = contractLoadFile(GO_FORMS).expect("load the forms contract")
  goTargets(t)
  const p = goEmitForms(c, "tests/spec/emit", "gotest")
  t.ok("the forms contract emits", p !== "")
  goForms(t, p)
  goIterate(t, c)
  t.contains("go test's test", p, 'func Test_P_MOD(tt *testing.T) {\n\t_gotest(tt, clause_P_MOD, "[P-MOD]')
  t.contains("which imports testing", p, '\t"testing"\n')
  const standalone = goEmitForms(c, "tests/spec/emit", "standalone")
  t.ok("standalone has no go test", standalone.indexOf("func Test_") < 0)
  t.ok("nor imports testing", standalone.indexOf('\t"testing"') < 0)
  goRefusals(t)
  goLive(t, c)
  return t.done()
}
