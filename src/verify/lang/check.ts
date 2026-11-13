/**
 * `verify/lang/check` — the semantic checks no schema can express, run on a
 * program whose shape `verify/lang/read` accepted: name resolution,
 * monomorphic types, `result` only in ensures, layering (calls go strictly
 * downward, so the call graph is a DAG and inlining terminates), agreement
 * with the spec plan's units, and axiom traceability. Every error is
 * collected. Checking also records each numeric literal's type in
 * `Expr.numTy`, which the SMT translation reads.
 */

import { EXPR_BINOP, EXPR_BOOL, EXPR_CALL, EXPR_ITE, EXPR_NUM, EXPR_UNOP, EXPR_VAR, Expr, FnUnit, Program, SpecPlan } from "./ast"

/** The name an ensures clause uses for the function's return value. */
export const RESULT_NAME: string = "result"

const checkReservedWords = (): string =>
  " break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await async of any as asserts declare get is keyof module namespace never readonly require set type unique unknown infer satisfies accessor abstract override Math Number RangeError Error Infinity NaN undefined globalThis arguments eval Object Array String Boolean Symbol BigInt JSON "

/**
 * Whether a name is reserved: a JS/TS keyword, or a global the emitted code uses.
 *
 * @param name the identifier
 * @returns true when a function or parameter may not take it
 */
export const checkIsReserved = (name: string): boolean => checkReservedWords().indexOf(` ${name} `) >= 0

/**
 * Whether `result` appears anywhere in an expression.
 *
 * @param e the expression
 * @returns true when it mentions `result`
 */
export const mentionsResult = (e: Expr): boolean => {
  if (e.kind === EXPR_VAR) {
    return e.name === RESULT_NAME
  }
  for (const a of e.args) {
    if (mentionsResult(a)) {
      return true
    }
  }
  return false
}

// A typing scope: the visible names and their types, and whether `result` is one.
class CheckScope {
  names: string[]
  tys: string[]
  allowResult: boolean

  constructor(allowResult: boolean) {
    this.names = []
    this.tys = []
    this.allowResult = allowResult
  }

  lookup(name: string): string {
    const i = toI32(this.names.indexOf(name))
    return i < 0 ? "" : this.tys[i]
  }
}

// Types one function at a time; "" stands for "no type" (unknown or failed).
class Checker {
  program: Program
  errors: string[]
  fn: FnUnit
  part: string

  constructor(program: Program, fn: FnUnit) {
    this.program = program
    this.errors = []
    this.fn = fn
    this.part = ""
  }

  fail(msg: string): string {
    this.errors.push(`${this.fn.name}/${this.part}: ${msg}`)
    return ""
  }

  check(actual: string, expected: string): string {
    if (actual !== "" && expected !== "" && actual !== expected) {
      return this.fail(`expected ${expected}, got ${actual}`)
    }
    return actual
  }

  // Both operands of a numeric operator share one type; the non-literal side
  // is inferred first so a bare literal picks up Int from context.
  numericPair(left: Expr, right: Expr | null, scope: CheckScope, expected: string): string {
    const hint = expected === "Int" || expected === "Real" ? expected : ""
    if (expected === "Bool") {
      this.fail("arithmetic expression where Bool expected")
    }
    let ty = ""
    if (right !== null && left.kind === EXPR_NUM && right.kind !== EXPR_NUM) {
      ty = this.infer(right, scope, hint)
      this.infer(left, scope, ty !== "" ? ty : hint)
    } else {
      ty = this.infer(left, scope, hint)
      if (right !== null) {
        this.infer(right, scope, ty !== "" ? ty : hint)
      }
    }
    if (ty === "Bool") {
      this.fail("expected a numeric operand, got Bool")
      return ""
    }
    return ty
  }

  infer(e: Expr, scope: CheckScope, expected: string): string {
    if (e.kind === EXPR_NUM) {
      if (expected === "Bool") {
        return this.fail(`numeric literal "${e.value}" where Bool expected`)
      }
      if (expected === "Int") {
        if (e.value.indexOf(".") >= 0) {
          return this.fail(`literal "${e.value}" is not an integer`)
        }
        e.numTy = "Int"
        return "Int"
      }
      e.numTy = "Real"
      return "Real"
    }
    if (e.kind === EXPR_BOOL) {
      return this.check("Bool", expected)
    }
    if (e.kind === EXPR_VAR) {
      if (e.name === RESULT_NAME && !scope.allowResult) {
        return this.fail(`"${RESULT_NAME}" may only appear in ensures clauses`)
      }
      const ty = scope.lookup(e.name)
      if (ty === "") {
        return this.fail(`unknown variable "${e.name}"`)
      }
      return this.check(ty, expected)
    }
    if (e.kind === EXPR_UNOP) {
      if (e.op === "not") {
        this.infer(e.args[0], scope, "Bool")
        return this.check("Bool", expected)
      }
      if (e.op === "floor" || e.op === "ceil") {
        this.infer(e.args[0], scope, "Real")
        return this.check("Real", expected)
      }
      return this.check(this.numericPair(e.args[0], null, scope, expected), expected)
    }
    if (e.kind === EXPR_BINOP) {
      const l = e.args[0]
      const r = e.args[1]
      const op = e.op
      if (op === "/") {
        // JS `/` is float division, so an Int quotient would not match the proof.
        this.infer(l, scope, "Real")
        this.infer(r, scope, "Real")
        return this.check("Real", expected)
      }
      if (op === "+" || op === "-" || op === "*" || op === "min" || op === "max") {
        return this.check(this.numericPair(l, r, scope, expected), expected)
      }
      if (op === "<" || op === "<=" || op === ">" || op === ">=") {
        this.numericPair(l, r, scope, "")
        return this.check("Bool", expected)
      }
      if (op === "==" || op === "!=") {
        const swap = l.kind === EXPR_NUM && r.kind !== EXPR_NUM
        const ty = this.infer(swap ? r : l, scope, "")
        this.infer(swap ? l : r, scope, ty)
        return this.check("Bool", expected)
      }
      this.infer(l, scope, "Bool")
      this.infer(r, scope, "Bool")
      return this.check("Bool", expected)
    }
    if (e.kind === EXPR_ITE) {
      this.infer(e.args[0], scope, "Bool")
      const thenTy = this.infer(e.args[1], scope, expected)
      const elseTy = this.infer(e.args[2], scope, thenTy !== "" ? thenTy : expected)
      if (thenTy !== "" && elseTy !== "" && thenTy !== elseTy) {
        return this.fail(`ite branches disagree: ${thenTy} vs ${elseTy}`)
      }
      return this.check(thenTy !== "" ? thenTy : elseTy, expected)
    }
    if (e.kind === EXPR_CALL) {
      let ci = -1
      for (let i = 0; i < toI32(this.program.functions.length); i++) {
        if (ci < 0 && this.program.functions[i].name === e.name) {
          ci = i
        }
      }
      if (ci < 0) {
        return this.fail(`call to unknown function "${e.name}"`)
      }
      const callee = this.program.functions[ci]
      if (callee.name === this.fn.name || callee.layer >= this.fn.layer) {
        this.fail(
          `"${this.fn.name}" (layer ${this.fn.layer}) may only call strictly lower layers, but calls "${callee.name}" (layer ${callee.layer})`,
        )
      }
      if (e.args.length !== callee.params.length) {
        return this.fail(`"${e.name}" expects ${callee.params.length} argument(s), got ${e.args.length}`)
      }
      for (let i = 0; i < toI32(e.args.length); i++) {
        this.infer(e.args[i], scope, callee.params[i].ty)
      }
      return this.check(callee.returnType, expected)
    }
    return this.fail(`unknown expression kind ${e.kind}`)
  }

  run(): void {
    const fn = this.fn
    const params = new CheckScope(false)
    const ensures = new CheckScope(true)
    for (const p of fn.params) {
      this.part = "params"
      if (p.name === RESULT_NAME) {
        this.fail(`"${RESULT_NAME}" is reserved`)
      }
      if (checkIsReserved(p.name)) {
        this.fail(`"${p.name}" is reserved (a JS/TS keyword or a global the emitted code uses)`)
      }
      for (const g of this.program.functions) {
        if (g.name === p.name) {
          this.fail(
            `parameter "${p.name}" shadows the function of the same name, so a call to it in the emitted code would call the number`,
          )
          break
        }
      }
      if (params.names.indexOf(p.name) >= 0) {
        this.fail(`duplicate parameter "${p.name}"`)
      }
      params.names.push(p.name)
      params.tys.push(p.ty)
      ensures.names.push(p.name)
      ensures.tys.push(p.ty)
    }
    ensures.names.push(RESULT_NAME)
    ensures.tys.push(fn.returnType)
    for (let i = 0; i < toI32(fn.requires.length); i++) {
      this.part = `requires[${i}]`
      this.infer(fn.requires[i].expr, params, "Bool")
      if (mentionsResult(fn.requires[i].expr)) {
        this.fail(`a requires clause may not reference "${RESULT_NAME}"`)
      }
    }
    for (let i = 0; i < toI32(fn.ensures.length); i++) {
      this.part = `ensures[${i}]`
      this.infer(fn.ensures[i].expr, ensures, "Bool")
      if (!mentionsResult(fn.ensures[i].expr)) {
        this.fail(
          `an ensures clause (axiom ${fn.ensures[i].axiomId}) must reference "${RESULT_NAME}"; a postcondition that ignores the return value proves nothing about the implementation`,
        )
      }
    }
    this.part = "body"
    this.infer(fn.body, params, fn.returnType)
  }
}

/**
 * Type-checks a program: names, types, `result`, layering and arity. Records
 * each numeric literal's type in its `numTy`.
 *
 * @param program a program whose shape was accepted
 * @returns every error found, in order
 */
export const typecheckProgram = (program: Program): string[] => {
  const errors: string[] = []
  const seen: string[] = []
  for (const fn of program.functions) {
    if (seen.indexOf(fn.name) >= 0) {
      errors.push(`duplicate function name "${fn.name}"`)
    }
    if (checkIsReserved(fn.name) || fn.name === RESULT_NAME) {
      errors.push(`function name "${fn.name}" is reserved (a JS/TS keyword or a global the emitted code uses)`)
    }
    seen.push(fn.name)
  }
  for (const fn of program.functions) {
    const c = new Checker(program, fn)
    c.run()
    for (const e of c.errors) {
      errors.push(e)
    }
  }
  return errors
}

/**
 * Checks that a program implements exactly the spec plan's units: the same
 * names, layers, return types and parameters.
 *
 * @param plan the spec plan
 * @param program the program
 * @returns every disagreement, in order
 */
export const checkSpecProgramConsistency = (plan: SpecPlan, program: Program): string[] => {
  const errors: string[] = []
  for (const u of plan.units) {
    let found = false
    for (const fn of program.functions) {
      if (fn.name === u.name) {
        found = true
      }
    }
    if (!found) {
      errors.push(`spec unit "${u.name}" has no matching function in the program`)
    }
  }
  for (const fn of program.functions) {
    let ui = -1
    for (let i = 0; i < toI32(plan.units.length); i++) {
      if (ui < 0 && plan.units[i].name === fn.name) {
        ui = i
      }
    }
    if (ui < 0) {
      errors.push(`function "${fn.name}" is not declared as a unit in the spec plan`)
      continue
    }
    const u = plan.units[ui]
    if (fn.layer !== u.layer) {
      errors.push(`function "${fn.name}": layer ${fn.layer} disagrees with spec unit layer ${u.layer}`)
    }
    if (fn.returnType !== u.returnType) {
      errors.push(`function "${fn.name}": returnType ${fn.returnType} disagrees with spec unit returnType ${u.returnType}`)
    }
    if (fn.params.length !== u.params.length) {
      errors.push(`function "${fn.name}": has ${fn.params.length} param(s) but spec unit declares ${u.params.length}`)
      continue
    }
    for (let i = 0; i < toI32(fn.params.length); i++) {
      const p = fn.params[i]
      const up = u.params[i]
      if (p.name !== up.name || p.ty !== up.ty) {
        errors.push(`function "${fn.name}": param ${i + 1} is ${p.name}:${p.ty} but spec unit declares ${up.name}:${up.ty}`)
      }
    }
  }
  return errors
}

/**
 * Checks axiom traceability: no clause cites an unknown axiom, every axiom is
 * enforced by some clause, a `pre` axiom by a requires and a `post` axiom by
 * an ensures.
 *
 * @param plan the spec plan
 * @param program the program
 * @returns every violation, in order
 */
export const checkAxiomTraceability = (plan: SpecPlan, program: Program): string[] => {
  const errors: string[] = []
  const ids: string[] = []
  for (const a of plan.axioms) {
    ids.push(a.id)
  }
  const byRequires: string[] = []
  const byEnsures: string[] = []
  for (const fn of program.functions) {
    for (const c of fn.requires) {
      byRequires.push(c.axiomId)
      if (ids.indexOf(c.axiomId) < 0) {
        errors.push(`${fn.name}: requires clause cites unknown axiom "${c.axiomId}"`)
      }
    }
    for (const c of fn.ensures) {
      byEnsures.push(c.axiomId)
      if (ids.indexOf(c.axiomId) < 0) {
        errors.push(`${fn.name}: ensures clause cites unknown axiom "${c.axiomId}"`)
      }
    }
  }
  for (const a of plan.axioms) {
    const inReq = byRequires.indexOf(a.id) >= 0
    const inEns = byEnsures.indexOf(a.id) >= 0
    if (!inReq && !inEns) {
      errors.push(`axiom ${a.id} ("${a.statement}") is not enforced by any clause`)
      continue
    }
    if (a.kind === "pre" && !inReq) {
      errors.push(
        `axiom ${a.id} is "pre" but is only formalized as an ensures clause; a precondition must be enforced by a requires clause`,
      )
    }
    if (a.kind === "post" && !inEns) {
      errors.push(
        `axiom ${a.id} is "post" but is only formalized as a requires clause; a postcondition must be proven by an ensures clause`,
      )
    }
  }
  return errors
}
