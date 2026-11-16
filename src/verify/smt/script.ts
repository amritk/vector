/**
 * `verify/smt/script` — translates a typechecked vector-lang program into one
 * SMT-LIB2 script for z3: per function, a reachability query, a proof and a
 * triviality query per ensures clause, and a query per division, per callee
 * precondition and per Int operation the emitted code evaluates. Reals stay
 * exact rationals and Ints unbounded; calls are inlined, which layering makes
 * finite.
 *
 * The Int queries close the gap between the proof and the code: an Int is a
 * float64 when the emitted TypeScript runs, exact only within ±(2^53−1). Each
 * `+`, `-` and `*` over Int is proven to stay inside that range on its path.
 * Parameters are guarded to safe integers and the reader refuses a literal a
 * float64 cannot hold, and float64 `+`, `-` and `*` round correctly, so when
 * every exact result is a safe integer each operation is exact, and the code
 * computes what z3 proved.
 */

import { VOCAB_JSON_SAFE_MAX } from "../../spec/contract/vocab"
import {
  EXPR_BINOP,
  EXPR_BOOL,
  EXPR_CALL,
  EXPR_ITE,
  EXPR_NUM,
  EXPR_UNOP,
  EXPR_VAR,
  LangExpr,
  Program,
  programFunctionIndex,
} from "../lang/ast"
import { RESULT_NAME } from "../lang/check"
import { prettyMath } from "../lang/pretty"

/** The precondition region is inhabited: `sat` is good. */
export const QUERY_REACHABLE: i32 = 1
/** An ensures clause under the body: `unsat` proves it. */
export const QUERY_ENSURES: i32 = 2
/** An ensures clause without the body: `unsat` means it is a tautology. */
export const QUERY_TRIVIAL: i32 = 3
/** A denominator can be zero on its path: anything but `unsat` is a hazard. */
export const QUERY_DIV: i32 = 4
/** A callee's requires can fail at a call site: anything but `unsat` is a hazard. */
export const QUERY_PRE: i32 = 5
/** An Int value can leave ±(2^53−1) on its path: anything but `unsat` is a hazard. */
export const QUERY_RANGE: i32 = 6

/** One `(check-sat)` of the script, and what its answer means. */
export class SmtQuery {
  /** One of the `QUERY_*` kinds. */
  kind: i32
  /** The index of the function it concerns. */
  fnIndex: i32
  /** The axiom of an ensures or trivial query; `(reachable)`, `(division)`, `(calls F)` or `(range)` otherwise. */
  axiomId: string
  /** The ensures clause's index for ensures and trivial queries; -1 otherwise. */
  clauseIndex: i32
  /** The clause or offending expression, in math style. */
  pretty: string
  /** The callee of a precondition query; "" otherwise. */
  callee: string

  /**
   * Makes a query record.
   *
   * @param kind one of the `QUERY_*` kinds
   * @param fnIndex the function's index
   * @param axiomId the axiom or pseudo-axiom it reports under
   * @param clauseIndex the ensures clause's index, or -1
   * @param pretty the clause or expression in math style
   * @param callee the callee, or ""
   */
  constructor(kind: i32, fnIndex: i32, axiomId: string, clauseIndex: i32, pretty: string, callee: string) {
    this.kind = kind
    this.fnIndex = fnIndex
    this.axiomId = axiomId
    this.clauseIndex = clauseIndex
    this.pretty = pretty
    this.callee = callee
  }
}

/** A whole script and its queries, in the order of their `@@Q` markers. */
export class SmtScript {
  /** The SMT-LIB2 text. */
  text: string
  /** One record per `(check-sat)`. */
  queries: SmtQuery[]

  /**
   * Makes a script.
   *
   * @param text the SMT-LIB2 text
   * @param queries its queries
   */
  constructor(text: string, queries: SmtQuery[]) {
    this.text = text
    this.queries = queries
  }
}

/** A division, call-site precondition or Int operation met while emitting a body. */
export class SmtHazard {
  /** The path conditions guarding it. */
  path: string[]
  /** The denominator term, the callee's requires under its arguments, or the Int term. */
  term: string
  /** The callee of a precondition; "" for a division. */
  callee: string
  /** The expression in math style. */
  pretty: string

  /**
   * Makes a hazard.
   *
   * @param path the path conditions guarding it
   * @param term the SMT term to test
   * @param callee the callee, or ""
   * @param pretty the expression in math style
   */
  constructor(path: string[], term: string, callee: string, pretty: string) {
    this.path = path
    this.term = term
    this.callee = callee
    this.pretty = pretty
  }
}

/** Which vector-lang names stand for which SMT terms. */
export class SmtScope {
  /** The bound names. */
  names: string[]
  /** The term of each name, at the same index. */
  terms: string[]

  /** Makes an empty scope. */
  constructor() {
    this.names = []
    this.terms = []
  }

  /**
   * Binds a name.
   *
   * @param name the vector-lang name
   * @param term its SMT term
   */
  bind(name: string, term: string): void {
    this.names.push(name)
    this.terms.push(term)
  }

  /**
   * Looks a name up.
   *
   * @param name the vector-lang name
   * @returns its term, or "" when unbound
   */
  lookup(name: string): string {
    for (let i = toI32(this.names.length) - 1; i >= 0; i--) {
      if (this.names[i] === name) {
        return this.terms[i]
      }
    }
    return ""
  }
}

/**
 * Turns expressions into SMT terms, the one translation the verifier and the
 * differ share, so the two never disagree on semantics. While `record` is on
 * it collects every division, call-site precondition and Int operation it
 * emits, each under the path the emitted code reaches it on: the branch of an
 * ite, and the left side of a short-circuit `and`, `or` or `implies`.
 */
export class SmtEmitter {
  /** The program whose functions calls inline. */
  program: Program
  /** Whether to collect hazards. */
  record: boolean
  /** The divisions emitted while recording. */
  divs: SmtHazard[]
  /** The callee preconditions emitted while recording. */
  pres: SmtHazard[]
  /** The Int `+`, `-` and `*` emitted while recording. */
  ranges: SmtHazard[]
  /** Each expression it could not translate; empty for a typechecked program. */
  errors: string[]

  /**
   * Makes an emitter over a program.
   *
   * @param program the typechecked program
   * @param record whether to collect hazards
   */
  constructor(program: Program, record: boolean) {
    this.program = program
    this.record = record
    this.divs = []
    this.pres = []
    this.ranges = []
    this.errors = []
  }

  /**
   * Records an expression it cannot translate. The term it returns is an
   * undeclared symbol, so z3 rejects the script and the run is ERROR rather
   * than a proof about a malformed formula.
   *
   * @param message what was wrong
   * @returns the poisoned term
   */
  untranslatable(message: string): string {
    this.errors.push(message)
    return `|vector: untranslatable: ${message}|`
  }

  /**
   * Translates an expression.
   *
   * @param e the expression
   * @param scope the bound names
   * @param path the path conditions it sits under
   * @returns the SMT term
   */
  term(e: LangExpr, scope: SmtScope, path: string[]): string {
    if (e.kind === EXPR_NUM) {
      const neg = e.value.startsWith("-")
      const abs = neg ? e.value.slice(1) : e.value
      let lit = abs
      if (e.numTy !== "Int" && abs.indexOf(".") < 0) {
        lit = `${abs}.0`
      }
      return neg ? `(- ${lit})` : lit
    }
    if (e.kind === EXPR_BOOL) {
      return e.value === "true" ? "true" : "false"
    }
    if (e.kind === EXPR_VAR) {
      const bound = scope.lookup(e.name)
      return bound === "" ? this.untranslatable(`unbound variable ${e.name}`) : bound
    }
    if (e.kind === EXPR_UNOP) {
      const a = this.term(e.args[0], scope, path)
      if (e.op === "not") {
        return `(not ${a})`
      }
      if (e.op === "neg") {
        return `(- ${a})`
      }
      if (e.op === "abs") {
        return `(ite (>= ${a} (- ${a} ${a})) ${a} (- ${a}))`
      }
      if (e.op === "floor") {
        return `(to_real (to_int ${a}))`
      }
      return `(to_real (- (to_int (- ${a}))))`
    }
    if (e.kind === EXPR_BINOP) {
      const l = this.term(e.args[0], scope, path)
      const r = this.term(e.args[1], scope, smtRightPath(e.op, l, path))
      if (e.op === "/" && this.record) {
        this.divs.push(new SmtHazard(smtCopy(path), r, "", prettyMath(e)))
      }
      if (e.op === "min") {
        return `(ite (<= ${l} ${r}) ${l} ${r})`
      }
      if (e.op === "max") {
        return `(ite (>= ${l} ${r}) ${l} ${r})`
      }
      const t = `(${smtOperator(e.op)} ${l} ${r})`
      // min, max, neg and abs of safe integers are safe; these three may not be.
      if (this.record && e.ty === "Int" && (e.op === "+" || e.op === "-" || e.op === "*")) {
        this.ranges.push(new SmtHazard(smtCopy(path), t, "", prettyMath(e)))
      }
      return t
    }
    if (e.kind === EXPR_ITE) {
      const c = this.term(e.args[0], scope, path)
      const thenPath = smtCopy(path)
      thenPath.push(c)
      const elsePath = smtCopy(path)
      elsePath.push(`(not ${c})`)
      const t = this.term(e.args[1], scope, thenPath)
      const f = this.term(e.args[2], scope, elsePath)
      return `(ite ${c} ${t} ${f})`
    }
    if (e.kind === EXPR_CALL) {
      const at = programFunctionIndex(this.program, e.name)
      if (at < 0) {
        return this.untranslatable(`unknown function ${e.name}`)
      }
      const callee = this.program.functions[at]
      const inner = new SmtScope()
      for (let i = 0; i < toI32(callee.params.length) && i < toI32(e.args.length); i++) {
        inner.bind(callee.params[i].name, this.term(e.args[i], scope, path))
      }
      // The callee's guards run in order, so each is reached only once the
      // ones before it held.
      const guarded = smtCopy(path)
      for (const rc of callee.requires) {
        const t = this.term(rc.expr, inner, guarded)
        if (this.record) {
          this.pres.push(new SmtHazard(smtCopy(path), t, callee.name, prettyMath(rc.expr)))
        }
        guarded.push(t)
      }
      return this.term(callee.body, inner, guarded)
    }
    return this.untranslatable(`unknown expression kind ${e.kind}`)
  }
}

const smtCopy = (xs: string[]): string[] => {
  const out: string[] = []
  for (const x of xs) {
    out.push(x)
  }
  return out
}

const smtNoPath = (): string[] => {
  const out: string[] = []
  return out
}

// The path the right operand of a binop is evaluated on: `&&` and `||` short-
// circuit in the emitted code, and `a ⇒ b` is emitted as `!a || b`.
const smtRightPath = (op: string, left: string, path: string[]): string[] => {
  if (op !== "and" && op !== "or" && op !== "implies") {
    return path
  }
  const out = smtCopy(path)
  out.push(op === "or" ? `(not ${left})` : left)
  return out
}

const smtOperator = (op: string): string => {
  if (op === "==") {
    return "="
  }
  if (op === "!=") {
    return "distinct"
  }
  if (op === "implies") {
    return "=>"
  }
  return op
}

/**
 * The lines every vector script starts with: models on, a per-check timeout,
 * and the logic.
 *
 * @returns the preamble, newline-terminated
 */
export const smtPreamble = (): string =>
  "(set-option :produce-models true)\n(set-option :timeout 55000)\n(set-logic ALL)\n"

/**
 * The SMT constant a function's parameter or result is declared as. Each
 * function gets its own prefix, so one flat script never redeclares a name.
 *
 * @param fnIndex the function's index
 * @param name the parameter's name, or `result`
 * @returns the constant's name
 */
export const smtVarName = (fnIndex: i32, name: string): string => `f${fnIndex}_${name}`

class SmtWriter {
  lines: string[]
  queries: SmtQuery[]
  getVars: string

  constructor() {
    this.lines = []
    this.queries = []
    this.getVars = ""
  }

  query(q: SmtQuery, asserts: string[], withModel: boolean): void {
    const qid = toI32(this.queries.length)
    this.lines.push("(push 1)")
    for (const a of asserts) {
      this.lines.push(a)
    }
    this.lines.push(`(echo "@@Q${qid}")`)
    this.lines.push("(check-sat)")
    if (withModel) {
      this.lines.push(`(get-value (${this.getVars}))`)
    }
    this.lines.push("(pop 1)")
    this.queries.push(q)
  }
}

const smtHazardAsserts = (bindResult: string, h: SmtHazard, last: string): string[] => {
  const out: string[] = [bindResult]
  for (const p of h.path) {
    out.push(`(assert ${p})`)
  }
  out.push(last)
  return out
}

/**
 * Builds the verification script of a typechecked program. Each function sits
 * in its own `(push 1)` frame, so a contradictory requires cannot leak into
 * the next function's verdicts. An Int parameter is assumed a safe integer,
 * as the emitted domain guard enforces. The emitted code checks its requires in
 * order, so a hazard inside one is queried under the requires before it
 * alone; a hazard in the body is queried under all of them. Divisions,
 * callee preconditions and Int operations inside an ensures clause are
 * proof-only and are not queried.
 *
 * @param program the typechecked program
 * @returns the script and its queries
 */
export const buildVerificationScript = (program: Program): SmtScript => {
  const w = new SmtWriter()
  for (let idx = 0; idx < toI32(program.functions.length); idx++) {
    const fn = program.functions[idx]
    const em = new SmtEmitter(program, true)
    const scope = new SmtScope()
    w.lines.push("(push 1)")
    const vars: string[] = []
    for (const p of fn.params) {
      const v = smtVarName(idx, p.name)
      scope.bind(p.name, v)
      vars.push(v)
      w.lines.push(`(declare-const ${v} ${p.ty})`)
      // The emitted domain guard rejects an Int argument that is not a safe integer.
      if (p.ty === "Int") {
        w.lines.push(`(assert (<= (- ${VOCAB_JSON_SAFE_MAX}) ${v} ${VOCAB_JSON_SAFE_MAX}))`)
      }
    }
    const res = smtVarName(idx, RESULT_NAME)
    vars.push(res)
    w.lines.push(`(declare-const ${res} ${fn.returnType})`)
    w.getVars = vars.join(" ")
    const requires: string[] = []
    for (const c of fn.requires) {
      requires.push(em.term(c.expr, scope, smtCopy(requires)))
    }
    const guardDivs = toI32(em.divs.length)
    const guardPres = toI32(em.pres.length)
    const guardRanges = toI32(em.ranges.length)
    const bindResult = `(assert (= ${res} ${em.term(fn.body, scope, smtNoPath())}))`
    em.record = false
    const ensuresScope = new SmtScope()
    for (let i = 0; i < toI32(scope.names.length); i++) {
      ensuresScope.bind(scope.names[i], scope.terms[i])
    }
    ensuresScope.bind(RESULT_NAME, res)

    // Before the requires are asserted: each guard hazard carries the
    // requires before it in its own path.
    smtHazardQueries(w, idx, em, bindResult, 0, guardDivs, 0, guardPres, 0, guardRanges)
    for (const t of requires) {
      w.lines.push(`(assert ${t})`)
    }
    w.query(new SmtQuery(QUERY_REACHABLE, idx, "(reachable)", -1, "requires are satisfiable", ""), [bindResult], true)
    for (let ci = 0; ci < toI32(fn.ensures.length); ci++) {
      const clause = fn.ensures[ci]
      const t = em.term(clause.expr, ensuresScope, smtNoPath())
      const pretty = prettyMath(clause.expr)
      w.query(
        new SmtQuery(QUERY_ENSURES, idx, clause.axiomId, ci, pretty, ""),
        [bindResult, `(assert (not ${t}))`],
        true,
      )
      w.query(new SmtQuery(QUERY_TRIVIAL, idx, clause.axiomId, ci, pretty, ""), [`(assert (not ${t}))`], false)
    }
    smtHazardQueries(
      w,
      idx,
      em,
      bindResult,
      guardDivs,
      toI32(em.divs.length),
      guardPres,
      toI32(em.pres.length),
      guardRanges,
      toI32(em.ranges.length),
    )
    w.lines.push("(pop 1)")
  }
  return new SmtScript(`${smtPreamble()}${w.lines.join("\n")}\n`, w.queries)
}

// One query per recorded hazard in the given index ranges of the emitter's lists.
const smtHazardQueries = (
  w: SmtWriter,
  idx: i32,
  em: SmtEmitter,
  bindResult: string,
  divFrom: i32,
  divTo: i32,
  preFrom: i32,
  preTo: i32,
  rangeFrom: i32,
  rangeTo: i32,
): void => {
  for (let i = divFrom; i < divTo; i++) {
    const d = em.divs[i]
    w.query(
      new SmtQuery(QUERY_DIV, idx, "(division)", -1, d.pretty, ""),
      smtHazardAsserts(bindResult, d, `(assert (= ${d.term} 0))`),
      true,
    )
  }
  for (let i = preFrom; i < preTo; i++) {
    const p = em.pres[i]
    w.query(
      new SmtQuery(QUERY_PRE, idx, `(calls ${p.callee})`, -1, p.pretty, p.callee),
      smtHazardAsserts(bindResult, p, `(assert (not ${p.term}))`),
      true,
    )
  }
  for (let i = rangeFrom; i < rangeTo; i++) {
    const r = em.ranges[i]
    w.query(
      new SmtQuery(QUERY_RANGE, idx, "(range)", -1, r.pretty, ""),
      smtHazardAsserts(
        bindResult,
        r,
        `(assert (or (> ${r.term} ${VOCAB_JSON_SAFE_MAX}) (< ${r.term} (- ${VOCAB_JSON_SAFE_MAX}))))`,
      ),
      true,
    )
  }
}
