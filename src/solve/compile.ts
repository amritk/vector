import type { Arith, Bool, Context } from "z3-solver";
import {
  type Clause,
  type Expr,
  type FunctionUnit,
  type NumericTy,
  RESULT_NAME,
  type Ty,
} from "../lang/ast.ts";
import { prettyExpr } from "../report/pretty.ts";

// Compiles a typechecked vector-lang function into Z3 terms. Pure translation —
// no solving happens here. Callee bodies are inlined (the strictly-lower-layer
// rule makes that terminate), and every division records a side condition so
// the verifier can prove the denominator is nonzero on that exact path.

type Ctx = Context<"main">;
type Term = Arith<"main"> | Bool<"main">;

export interface DivCondition {
  path: Bool<"main">;
  denom: Arith<"main">;
  pretty: string;
}

export interface CompiledFunction {
  paramConsts: Map<string, Term>;
  resultConst: Term;
  requires: Bool<"main">[];
  /** result == body — defines the program's effect for the solver. */
  bodyDef: Bool<"main">;
  ensures: { clause: Clause; term: Bool<"main"> }[];
  divConds: DivCondition[];
}

export function compileFunction(
  ctx: Ctx,
  fn: FunctionUnit,
  byName: Map<string, FunctionUnit>,
  numTypes: WeakMap<Expr, NumericTy>,
): CompiledFunction {
  const asArith = (t: Term): Arith<"main"> => t as Arith<"main">;
  const asBool = (t: Term): Bool<"main"> => t as Bool<"main">;

  const freshConst = (name: string, ty: Ty): Term => {
    switch (ty) {
      case "Real":
        return ctx.Real.const(name);
      case "Int":
        return ctx.Int.const(name);
      case "Bool":
        return ctx.Bool.const(name);
    }
  };

  const divConds: DivCondition[] = [];

  const compile = (
    expr: Expr,
    scope: Map<string, Term>,
    path: Bool<"main">,
  ): Term => {
    switch (expr.kind) {
      case "num":
        return numTypes.get(expr) === "Int"
          ? ctx.Int.val(BigInt(expr.value))
          : ctx.Real.val(expr.value);
      case "bool":
        return ctx.Bool.val(expr.value);
      case "var": {
        const term = scope.get(expr.name);
        if (!term) throw new Error(`compile: unbound variable "${expr.name}"`);
        return term;
      }
      case "unop": {
        const arg = compile(expr.arg, scope, path);
        return expr.op === "not" ? ctx.Not(asBool(arg)) : asArith(arg).neg();
      }
      case "binop": {
        if (expr.op === "and" || expr.op === "or" || expr.op === "implies") {
          const left = asBool(compile(expr.left, scope, path));
          const right = asBool(compile(expr.right, scope, path));
          if (expr.op === "and") return ctx.And(left, right);
          if (expr.op === "or") return ctx.Or(left, right);
          return ctx.Implies(left, right);
        }
        const left = compile(expr.left, scope, path);
        const right = compile(expr.right, scope, path);
        switch (expr.op) {
          case "+":
            return asArith(left).add(asArith(right));
          case "-":
            return asArith(left).sub(asArith(right));
          case "*":
            return asArith(left).mul(asArith(right));
          case "/":
            divConds.push({
              path,
              denom: asArith(right),
              pretty: prettyExpr(expr, "math"),
            });
            return asArith(left).div(asArith(right));
          case "<":
            return asArith(left).lt(asArith(right));
          case "<=":
            return asArith(left).le(asArith(right));
          case ">":
            return asArith(left).gt(asArith(right));
          case ">=":
            return asArith(left).ge(asArith(right));
          case "==":
            return left.eq(right);
          case "!=":
            return left.neq(right);
        }
        break;
      }
      case "ite": {
        const cond = asBool(compile(expr.cond, scope, path));
        const thenTerm = compile(expr.then, scope, ctx.And(path, cond));
        const elseTerm = compile(
          expr.else,
          scope,
          ctx.And(path, ctx.Not(cond)),
        );
        return ctx.If(cond, thenTerm, elseTerm) as Term;
      }
      case "call": {
        const callee = byName.get(expr.fn);
        if (!callee) throw new Error(`compile: unknown function "${expr.fn}"`);
        const calleeScope = new Map<string, Term>();
        callee.params.forEach((param, i) => {
          const arg = expr.args[i];
          if (!arg)
            throw new Error(`compile: missing argument for "${param.name}"`);
          calleeScope.set(param.name, compile(arg, scope, path));
        });
        return compile(callee.body, calleeScope, path);
      }
    }
    throw new Error("compile: unreachable expression kind");
  };

  const trueTerm = ctx.Bool.val(true);
  const paramConsts = new Map<string, Term>(
    fn.params.map((p) => [p.name, freshConst(p.name, p.type)]),
  );
  const resultConst = freshConst(RESULT_NAME, fn.returnType);
  const ensuresScope = new Map([...paramConsts, [RESULT_NAME, resultConst]]);

  const requires = fn.requires.map((c) =>
    asBool(compile(c.expr, paramConsts, trueTerm)),
  );
  const bodyDef = resultConst.eq(compile(fn.body, paramConsts, trueTerm));
  const ensures = fn.ensures.map((clause) => ({
    clause,
    term: asBool(compile(clause.expr, ensuresScope, trueTerm)),
  }));

  return { paramConsts, resultConst, requires, bodyDef, ensures, divConds };
}
