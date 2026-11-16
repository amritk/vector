/**
 * `verify/lang/ast` — vector-lang, the expression language a program is
 * written in, as Nish classes: an expression tree, the clauses and functions
 * built from it, and the spec plan whose axioms the clauses cite. The shapes
 * mirror `schemas/program.json` and `schemas/spec-plan.json`.
 */

/** A decimal literal, kept as its text so the solver sees the exact rational. */
export const EXPR_NUM: i32 = 1
/** `true` or `false`. */
export const EXPR_BOOL: i32 = 2
/** A parameter, or `result` in an ensures clause. */
export const EXPR_VAR: i32 = 3
/** `not`, `neg`, `abs`, `floor` or `ceil` over one argument. */
export const EXPR_UNOP: i32 = 4
/** An arithmetic, comparison or logical operator over two arguments. */
export const EXPR_BINOP: i32 = 5
/** `cond ? then : else`. */
export const EXPR_ITE: i32 = 6
/** A call to a function of a strictly lower layer. */
export const EXPR_CALL: i32 = 7

/** One vector-lang expression. Which fields mean something depends on `kind`. */
export class LangExpr {
  /** One of the `EXPR_*` kinds. */
  kind: i32
  /** The operator of a unop or binop; "" otherwise. */
  op: string
  /** A num's decimal text, or a bool's `true`/`false`; "" otherwise. */
  value: string
  /** A var's name, or the function a call names; "" otherwise. */
  name: string
  /** unop `[arg]`, binop `[left, right]`, ite `[cond, then, else]`, call arguments. */
  args: LangExpr[]
  /** The type the checker gave a num literal, `Real` or `Int`; "" before checking. */
  numTy: string
  /** The type the checker gave this expression, `Real`, `Int` or `Bool`; "" before checking. */
  ty: string

  /**
   * Makes an expression.
   *
   * @param kind one of the `EXPR_*` kinds
   * @param op the operator, or ""
   * @param value the literal text, or ""
   * @param name the variable or callee, or ""
   * @param args the sub-expressions
   */
  constructor(kind: i32, op: string, value: string, name: string, args: LangExpr[]) {
    this.kind = kind
    this.op = op
    this.value = value
    this.name = name
    this.args = args
    this.numTy = ""
    this.ty = ""
  }
}

/** A requires or ensures clause: a boolean expression and the axiom it enforces. */
export class LangClause {
  /** The spec-plan axiom this clause formalizes. */
  axiomId: string
  /** The boolean expression. */
  expr: LangExpr

  /**
   * Makes a clause.
   *
   * @param axiomId the axiom it formalizes
   * @param expr the boolean expression
   */
  constructor(axiomId: string, expr: LangExpr) {
    this.axiomId = axiomId
    this.expr = expr
  }
}

/** A named, typed parameter. */
export class LangParam {
  /** The parameter's name. */
  name: string
  /** `Real`, `Int` or `Bool`. */
  ty: string

  /**
   * Makes a parameter.
   *
   * @param name its name
   * @param ty `Real`, `Int` or `Bool`
   */
  constructor(name: string, ty: string) {
    this.name = name
    this.ty = ty
  }
}

/** One function of a program, with its contract and its body. */
export class FnUnit {
  /** The function's name. */
  name: string
  /** Its layer: it may call only functions of strictly lower layers. */
  layer: i32
  /** One line on what it is for. */
  purpose: string
  /** Its parameters, in order. */
  params: LangParam[]
  /** `Real`, `Int` or `Bool`. */
  returnType: string
  /** Its preconditions. */
  requires: LangClause[]
  /** Its postconditions, each mentioning `result`. */
  ensures: LangClause[]
  /** The expression it returns. */
  body: LangExpr

  /**
   * Makes a function with no parameters or clauses; the reader fills them in.
   *
   * @param name its name
   * @param layer its layer
   * @param purpose what it is for
   * @param returnType `Real`, `Int` or `Bool`
   * @param body the expression it returns
   */
  constructor(name: string, layer: i32, purpose: string, returnType: string, body: LangExpr) {
    this.name = name
    this.layer = layer
    this.purpose = purpose
    this.params = []
    this.returnType = returnType
    this.requires = []
    this.ensures = []
    this.body = body
  }
}

/** A vector-lang program: named functions in layers. */
export class Program {
  /** The program's name. */
  programName: string
  /** Its functions, as written. */
  functions: FnUnit[]

  /**
   * Makes an empty program.
   *
   * @param programName its name
   */
  constructor(programName: string) {
    this.programName = programName
    this.functions = []
  }
}

/** One axiom of a spec plan: a precondition or a postcondition in prose. */
export class Axiom {
  /** Its id, which clauses cite. */
  id: string
  /** `pre` or `post`. */
  kind: string
  /** The requirement, in words. */
  statement: string

  /**
   * Makes an axiom.
   *
   * @param id its id
   * @param kind `pre` or `post`
   * @param statement the requirement in words
   */
  constructor(id: string, kind: string, statement: string) {
    this.id = id
    this.kind = kind
    this.statement = statement
  }
}

/** One planned function of a spec plan and the axioms that concern it. */
export class PlanUnit {
  /** The function's name. */
  name: string
  /** Its planned layer. */
  layer: i32
  /** Its planned parameters. */
  params: LangParam[]
  /** Its planned return type. */
  returnType: string
  /** The axioms it must enforce. */
  relevantAxiomIds: string[]

  /**
   * Makes a planned unit with no parameters or axioms; the reader fills them in.
   *
   * @param name the function's name
   * @param layer its layer
   * @param returnType `Real`, `Int` or `Bool`
   */
  constructor(name: string, layer: i32, returnType: string) {
    this.name = name
    this.layer = layer
    this.params = []
    this.returnType = returnType
    this.relevantAxiomIds = []
  }
}

/** A spec plan: the axioms a program must formalize, and its planned units. */
export class SpecPlan {
  /** The program's name. */
  programName: string
  /** Every axiom. */
  axioms: Axiom[]
  /** The planned functions. */
  units: PlanUnit[]

  /**
   * Makes an empty spec plan.
   *
   * @param programName the program's name
   */
  constructor(programName: string) {
    this.programName = programName
    this.axioms = []
    this.units = []
  }
}

/**
 * Finds a function of a program by name.
 *
 * @param program the program
 * @param name the function's name
 * @returns its index, or -1
 */
export const programFunctionIndex = (program: Program, name: string): i32 => {
  for (let i = 0; i < toI32(program.functions.length); i++) {
    if (program.functions[i].name === name) {
      return i
    }
  }
  return -1
}
