/**
 * `tests/verify/build` — hand-built spec plans and programs for the verify
 * tests: expression builders that return JSON text, a case that pairs each
 * function with its spec unit and axioms, and loaders that refuse a case the
 * reader or the typechecker rejects, so a soundness test never passes by
 * proving an artifact the gate would have thrown out.
 */

import { newJsonDocument, parseJson } from "../../src/core/json"
import { runProcess } from "../../src/core/process"
import { Program } from "../../src/verify/lang/ast"
import { typecheckProgram } from "../../src/verify/lang/check"
import { readProgram } from "../../src/verify/lang/read"
import { VerifyReport, solveProgram } from "../../src/verify/solve/report"
import { VerifyOutcome, verifySpecAndProgram } from "../../src/verify/verify"

/**
 * A number literal.
 *
 * @param value the decimal text
 * @returns the expression's JSON
 */
export const bNum = (value: string): string => `{"kind":"num","value":"${value}"}`

/**
 * A Bool literal.
 *
 * @param value the literal
 * @returns the expression's JSON
 */
export const bBool = (value: boolean): string => `{"kind":"bool","value":${value ? "true" : "false"}}`

/**
 * A variable.
 *
 * @param name the variable's name
 * @returns the expression's JSON
 */
export const bVar = (name: string): string => `{"kind":"var","name":"${name}"}`

/**
 * A binary operation.
 *
 * @param op the operator
 * @param left the left operand's JSON
 * @param right the right operand's JSON
 * @returns the expression's JSON
 */
export const bBin = (op: string, left: string, right: string): string =>
  `{"kind":"binop","op":"${op}","left":${left},"right":${right}}`

/**
 * A unary operation.
 *
 * @param op the operator
 * @param arg the operand's JSON
 * @returns the expression's JSON
 */
export const bUn = (op: string, arg: string): string => `{"kind":"unop","op":"${op}","arg":${arg}}`

/**
 * A call.
 *
 * @param fn the callee
 * @param args each argument's JSON
 * @returns the expression's JSON
 */
export const bCall = (fn: string, args: string[]): string => `{"kind":"call","fn":"${fn}","args":[${args.join(",")}]}`

/**
 * An if-then-else.
 *
 * @param cond the condition's JSON
 * @param then the value when it holds
 * @param otherwise the value when it does not
 * @returns the expression's JSON
 */
export const bIte = (cond: string, then: string, otherwise: string): string =>
  `{"kind":"ite","cond":${cond},"then":${then},"else":${otherwise}}`

/**
 * The decimal text of 10 to the power `n`.
 *
 * @param n the exponent
 * @returns `1` followed by `n` zeros
 */
export const bPow10 = (n: i32): string => {
  let s = "1"
  for (let i = 0; i < n; i++) {
    s = `${s}0`
  }
  return s
}

const bParams = (params: string[]): string => {
  const out: string[] = []
  for (const p of params) {
    const colon = p.indexOf(":")
    out.push(`{"name":"${p.substring(0, colon)}","type":"${p.substring(colon + 1)}"}`)
  }
  return `[${out.join(",")}]`
}

/**
 * A spec plan and program built a function at a time. Each function gets a
 * matching spec unit, and each clause an axiom of its own: `<fn>_R<i>` (pre)
 * for a requires, `<fn>_E<i>` (post) for an ensures.
 */
export class BCase {
  /** The program's name. */
  name: string
  /** Each axiom's JSON. */
  axioms: string[]
  /** Each spec unit's JSON. */
  units: string[]
  /** Each function's JSON. */
  fns: string[]

  /**
   * Makes an empty case.
   *
   * @param name the program's name
   */
  constructor(name: string) {
    this.name = name
    this.axioms = []
    this.units = []
    this.fns = []
  }

  /**
   * Adds a function and its spec unit.
   *
   * @param name the function's name
   * @param layer its layer
   * @param params each parameter as `name:Type`
   * @param returnType its return type
   * @param requires each requires clause's JSON
   * @param ensures each ensures clause's JSON
   * @param body the body's JSON
   */
  fn(
    name: string,
    layer: i32,
    params: string[],
    returnType: string,
    requires: string[],
    ensures: string[],
    body: string,
  ): void {
    const ids: string[] = []
    const req: string[] = []
    for (let i = 0; i < requires.length; i++) {
      const id = `${name}_R${i}`
      ids.push(`"${id}"`)
      this.axioms.push(`{"id":"${id}","kind":"pre","statement":"requires ${i} of ${name}"}`)
      req.push(`{"axiomId":"${id}","expr":${requires[i]}}`)
    }
    const ens: string[] = []
    for (let i = 0; i < ensures.length; i++) {
      const id = `${name}_E${i}`
      ids.push(`"${id}"`)
      this.axioms.push(`{"id":"${id}","kind":"post","statement":"ensures ${i} of ${name}"}`)
      ens.push(`{"axiomId":"${id}","expr":${ensures[i]}}`)
    }
    const head = `"name":"${name}","layer":${layer},"purpose":"${name} under test","params":${bParams(params)},"returnType":"${returnType}"`
    this.units.push(`{${head},"relevantAxiomIds":[${ids.join(",")}]}`)
    this.fns.push(`{${head},"requires":[${req.join(",")}],"ensures":[${ens.join(",")}],"body":${body}}`)
  }

  /**
   * The spec plan's JSON.
   *
   * @returns the text
   */
  specText(): string {
    return `{"programName":"${this.name}","axioms":[${this.axioms.join(",")}],"units":[${this.units.join(",")}]}`
  }

  /**
   * The program's JSON.
   *
   * @returns the text
   */
  programText(): string {
    return `{"programName":"${this.name}","functions":[${this.fns.join(",")}]}`
  }
}

/**
 * Reads and typechecks a program from JSON text.
 *
 * @param text the program's JSON
 * @returns the program, or `Err` with every read or type error
 */
export const bProgram = (text: string): Result<Program, string> => {
  const doc = newJsonDocument()
  const root = parseJson(doc, text, "test")
  if (root.isErr()) {
    return Err(root.error)
  }
  const errors: string[] = []
  const program = readProgram(doc, root.value, errors)
  if (errors.length > 0) {
    return Err(`read: ${errors.join("; ")}`)
  }
  const types = typecheckProgram(program)
  if (types.length > 0) {
    return Err(`typecheck: ${types.join("; ")}`)
  }
  return Ok(program)
}

/**
 * The typechecker's errors for a program, or the reader's when it is not
 * even well-formed.
 *
 * @param text the program's JSON
 * @returns every error, prefixed `read:` or `typecheck:`
 */
export const bTypeErrors = (text: string): string => {
  const program = bProgram(text)
  return program.isErr() ? program.error : ""
}

/**
 * Solves a case's program, refusing one the reader or typechecker rejects.
 *
 * @param c the case
 * @returns the report, or `Err`
 */
export const bSolve = (c: BCase): Result<VerifyReport, string> => {
  const program = bProgram(c.programText()).orReturn()
  return solveProgram(program)
}

/**
 * Runs the whole gate over a spec plan and program given as JSON text.
 *
 * @param specText the spec plan's JSON
 * @param programText the program's JSON
 * @returns the outcome
 */
export const bVerifyText = (specText: string, programText: string): VerifyOutcome => {
  const specDoc = newJsonDocument()
  const specRoot = parseJson(specDoc, specText, "spec")
  const programDoc = newJsonDocument()
  const programRoot = parseJson(programDoc, programText, "program")
  return verifySpecAndProgram(
    specDoc,
    specRoot.isOk() ? specRoot.value : -1,
    programDoc,
    programRoot.isOk() ? programRoot.value : -1,
    "test",
  )
}

/**
 * Runs the whole gate over a case.
 *
 * @param c the case
 * @returns the outcome
 */
export const bVerify = (c: BCase): VerifyOutcome => bVerifyText(c.specText(), c.programText())

/**
 * No clauses: an empty clause list, which a bare `[]` argument cannot be.
 *
 * @returns an empty list
 */
export const bNone = (): string[] => {
  const none: string[] = []
  return none
}

/**
 * Removes a temporary directory and everything in it.
 *
 * @param dir the directory, made by `makeTempDir`
 * @returns whether `rm` succeeded
 */
export const bRemoveTree = (dir: string): boolean => {
  const removed = runProcess(["rm", "-rf", dir], "", 10000)
  return removed.isOk() && removed.value.status === 0
}
