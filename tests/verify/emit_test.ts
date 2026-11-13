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

const emitLoad = (path: string): Program => {
  const doc = newJsonDocument()
  const root = readJsonFile(doc, path)
  const errors: string[] = []
  const program = readProgram(doc, root.isOk() ? root.value : -1, errors)
  typecheckProgram(program)
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

export const main = (): i32 => {
  const t = new Suite("verify/emit")
  t.eqStr("tsType Bool", tsType("Bool"), "boolean")
  t.eqStr("tsType Real", tsType("Real"), "number")
  t.eqStr("tsType Int", tsType("Int"), "number")
  t.ok("jsdocSafe closes no comment", jsdocSafe("a */ b").indexOf("*/") < 0)
  t.eqStr("jsdocSafe keeps plain text", jsdocSafe("plain"), "plain")

  const program = emitLoad("tests/fixtures/currency.json")
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
  const dir = makeTempDir("vector-emit-")
  if (dir.isErr()) {
    t.fail("makeTempDir", dir.error)
    return t.done()
  }
  t.ok("write program.ts", writeFileSyncMode(joinPath(dir.value, "program.ts"), code, 0o644) >= 0)
  const expected: string[] = []
  const driver = emitDriver(program, expected)
  const driverPath = joinPath(dir.value, "driver.mjs")
  t.ok("write driver.mjs", writeFileSyncMode(driverPath, driver, 0o644) >= 0)
  const run = runProcess(["node", "--experimental-strip-types", "--no-warnings", driverPath], "", 60000)
  if (run.isErr()) {
    t.fail("node runs", run.error)
    return t.done()
  }
  t.eqI32("node exits 0", run.value.status, 0)
  t.eqStr("node agrees with float64Outcome", run.value.stdout, `${expected.join("\n")}\n`)
  return t.done()
}
