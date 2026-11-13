import { Suite } from "nish/testing"
import { joinPath, makeTempDir } from "../../src/core/fs"
import { newJsonDocument, readJsonFile } from "../../src/core/json"
import { runProcess } from "../../src/core/process"
import {
  F64Env,
  F64Val,
  f64Render,
  float64Outcome,
  float64ParseModel,
  float64Samples,
} from "../../src/verify/emit/float64"
import { emitTypeScript, functionsByLayer, jsdocSafe, tsType } from "../../src/verify/emit/typescript"
import { Program } from "../../src/verify/lang/ast"
import { typecheckProgram } from "../../src/verify/lang/check"
import { readProgram } from "../../src/verify/lang/read"
import { BCase, bBin, bBool, bIte, bNone, bNum, bProgram, bRemoveTree, bUn, bVar } from "./build"

const emitLoad = (t: Suite, path: string): Program => {
  const doc = newJsonDocument()
  const root = readJsonFile(doc, path)
  t.ok(`read ${path}`, root.isOk())
  const errors: string[] = []
  const program = readProgram(doc, root.isOk() ? root.value : -1, errors)
  t.eqStr(`${path} is well-formed`, errors.join("; "), "")
  t.eqStr(`${path} typechecks`, typecheckProgram(program).join("; "), "")
  return program
}

// One JS call per sample, printing what String() of the result is, or `throws`.
const emitDriver = (program: Program, expected: string[]): string => {
  const names: string[] = []
  for (const fn of program.functions) {
    names.push(fn.name)
  }
  const lines: string[] = [
    `import { ${names.join(", ")} } from "./program.ts";`,
    'const o = (f) => { try { return String(f()); } catch { return "throws"; } };',
  ]
  for (const fn of program.functions) {
    for (const env of float64Samples(fn)) {
      const args: string[] = []
      for (const p of fn.params) {
        let text = "undefined"
        for (let i = 0; i < toI32(env.names.length); i++) {
          if (env.names[i] === p.name) {
            text = f64Render(env.vals[i])
          }
        }
        args.push(text)
      }
      lines.push(`console.log(o(() => ${fn.name}(${args.join(", ")})));`)
      expected.push(float64Outcome(program, fn, env))
    }
  }
  return `${lines.join("\n")}\n`
}

// The trivial ensures, result == result.
const emitSame = (): string[] => [bBin("==", bVar("result"), bVar("result"))]

// Runs the emitted code under node on every sample, and each probe, which
// must throw; the output must match the gate's own float64 interpreter.
const emitAgree = (t: Suite, what: string, program: Program, probes: string[]): void => {
  const dir = makeTempDir("vector-emit-")
  if (dir.isErr()) {
    t.fail(`${what}: makeTempDir`, dir.error)
    return
  }
  const expected: string[] = []
  const driverLines: string[] = [emitDriver(program, expected)]
  for (const p of probes) {
    driverLines.push(`console.log(o(() => ${p}));\n`)
    expected.push("throws")
  }
  t.ok(
    `${what}: write program.ts`,
    writeFileSyncMode(joinPath(dir.value, "program.ts"), emitTypeScript(program), 0o644) >= 0,
  )
  const driverPath = joinPath(dir.value, "driver.mjs")
  t.ok(`${what}: write driver.mjs`, writeFileSyncMode(driverPath, driverLines.join(""), 0o644) >= 0)
  const run = runProcess(["node", "--experimental-strip-types", "--no-warnings", driverPath], "", 60000)
  t.ok(`${what}: remove the temp dir`, bRemoveTree(dir.value))
  if (run.isErr()) {
    t.fail(`${what}: node runs`, run.error)
    return
  }
  t.eqI32(`${what}: node exits 0`, run.value.status, 0)
  t.ok(`${what}: samples ran`, toI32(expected.length) > toI32(probes.length))
  t.eqStr(`${what}: node agrees with float64Outcome`, run.value.stdout, `${expected.join("\n")}\n`)
}

export const main = (): i32 => {
  const t = new Suite("verify/emit")
  t.eqStr("tsType Bool", tsType("Bool"), "boolean")
  t.eqStr("tsType Real", tsType("Real"), "number")
  t.eqStr("tsType Int", tsType("Int"), "number")
  t.ok("jsdocSafe closes no comment", jsdocSafe("a */ b").indexOf("*/") < 0)
  t.eqStr("jsdocSafe keeps plain text", jsdocSafe("plain"), "plain")

  const program = emitLoad(t, "tests/fixtures/currency.json")
  const ordered = functionsByLayer(program)
  t.eqI32("functionsByLayer keeps every function", toI32(ordered.length), 2)
  t.eqStr("functionsByLayer puts layer 1 first", ordered[0].name, "applyRate")
  const code = emitTypeScript(program)
  t.contains("emitTypeScript exports usdToEur", code, "export function usdToEur(amount: number): number {")
  t.contains("emitTypeScript guards requires", code, 'throw new RangeError("requires violated [AX1]: amount >= 0");')

  const truthy = new F64Val(true, true, parseFloat("0"))
  t.eqStr("f64Render boolean", f64Render(truthy), "true")
  t.eqStr("f64Render number", f64Render(new F64Val(false, false, parseFloat("1.5"))), "1.5")
  t.eqStr("float64ParseModel fraction", f64Render(new F64Val(false, false, float64ParseModel("1/4"))), "0.25")
  t.eqStr("float64ParseModel negative", f64Render(new F64Val(false, false, float64ParseModel("-3"))), "-3")

  const usd = program.functions[1]
  const env = new F64Env()
  env.setNum("amount", parseFloat("100"))
  t.eqStr("float64Outcome value", float64Outcome(program, usd, env), "91")
  const negative = new F64Env()
  negative.setNum("amount", parseFloat("-1"))
  t.eqStr("float64Outcome requires throws", float64Outcome(program, usd, negative), "throws")
  t.ok("float64Samples samples", float64Samples(usd).length > 0)

  // The gate's interpreter must agree with the emitted code under node.
  emitAgree(t, "currency", program, bNone())

  // Every operator, Int and Bool params, and mixed precedence.
  const ops = new BCase("ops")
  const x = bVar("x")
  const y = bVar("y")
  const n = bVar("n")
  const m = bVar("m")
  const a = bVar("a")
  const b = bVar("b")
  ops.fn(
    "reals",
    1,
    ["x:Real", "y:Real"],
    "Real",
    bNone(),
    emitSame(),
    bIte(
      bBin(">", x, y),
      bBin(
        "-",
        bBin("+", bUn("floor", x), bBin("*", bUn("ceil", y), bNum("2"))),
        bBin("/", bUn("abs", bBin("-", x, y)), bNum("4")),
      ),
      bUn("neg", bBin("max", x, bBin("min", y, bNum("3")))),
    ),
  )
  ops.fn(
    "ints",
    1,
    ["n:Int", "m:Int"],
    "Int",
    bNone(),
    emitSame(),
    bBin(
      "-",
      bBin("-", bBin("*", bUn("abs", n), bNum("2")), bBin("-", m, bNum("1"))),
      bBin("max", bUn("neg", n), bNum("0")),
    ),
  )
  ops.fn(
    "bools",
    1,
    ["a:Bool", "b:Bool", "x:Real"],
    "Bool",
    bNone(),
    emitSame(),
    bIte(
      bBin("implies", a, b),
      bBin("or", bUn("not", a), bBin("and", b, bBin(">", x, bNum("0")))),
      bBin("and", a, bUn("not", bBool(false))),
    ),
  )
  const opsProgram = bProgram(ops.programText())
  if (opsProgram.isErr()) {
    t.fail("the operator program", opsProgram.error)
    return t.done()
  }
  // Each probe is an argument the domain guards must refuse.
  const probes: string[] = [
    "reals(NaN, 1)",
    "reals(Infinity, 1)",
    "reals(1, -Infinity)",
    'reals("1", 1)',
    "reals(true, 1)",
    "reals(null, 1)",
    "ints(2 ** 53, 1)",
    "ints(1, -(2 ** 53))",
    "ints(1.5, 1)",
    "ints(NaN, 1)",
    'ints("1", 1)',
    "bools(1, true, 0)",
    'bools("true", true, 0)',
    "bools(null, true, 0)",
    "bools(true, false, NaN)",
  ]
  emitAgree(t, "operators", opsProgram.value, probes)
  return t.done()
}
