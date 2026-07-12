import type {
  Expr,
  FunctionUnit,
  NumericTy,
  Program,
  Ty,
} from "../lang/ast.ts";
import { RESULT_NAME } from "../lang/ast.ts";
import { prettyExpr } from "../report/pretty.ts";

// Translates a typechecked vector-lang program into an SMT-LIB2 script for the
// native `z3` CLI, and parses z3's textual answers back out. This is the
// backend swap-in for the former z3-solver (wasm) JS bindings: the AST → term
// recursion is identical, it just prints S-expressions instead of building
// live term objects, so a plain `z3` subprocess can do the proving (no Node,
// no wasm pthread workaround). Verified at verdict + counterexample parity
// against the wasm backend before the wasm path was removed.

const BINOP_SMT: Record<string, string> = {
  "+": "+",
  "-": "-",
  "*": "*",
  "/": "/",
  "<": "<",
  "<=": "<=",
  ">": ">",
  ">=": ">=",
  "==": "=",
  "!=": "distinct",
  and: "and",
  or: "or",
  implies: "=>",
};

const SORT: Record<Ty, string> = { Real: "Real", Int: "Int", Bool: "Bool" };

// A single verification condition emitted into the script, tagged so the parser
// can attribute z3's answer (and any model) back to the right clause.
export interface SmtQuery {
  kind: "ensures" | "div";
  fn: string;
  /** Spec axiom for ensures queries; "(division)" for division hazards. */
  axiomId: string;
  /** Math-pretty of the clause (ensures) or the division expression (div). */
  pretty: string;
  /** SMT const name ↔ original param name, for reading counterexample inputs. */
  params: { smt: string; orig: string }[];
  resultSmt: string;
}

export interface SmtScript {
  script: string;
  queries: SmtQuery[];
}

// Per query: z3's verdict plus, on `sat`, the model values keyed by SMT const name.
export interface QueryAnswer {
  result: "sat" | "unsat" | "unknown";
  model: Record<string, string>;
}

/** How long (ms) z3 may spend on any single check before returning `unknown`. */
const PER_CHECK_TIMEOUT_MS = 55_000;

export function emitVerificationScript(
  program: Program,
  numTypes: WeakMap<Expr, NumericTy>,
): SmtScript {
  const byName = new Map(program.functions.map((f) => [f.name, f]));
  const lines: string[] = [
    "(set-option :produce-models true)",
    `(set-option :timeout ${PER_CHECK_TIMEOUT_MS})`,
    "(set-logic ALL)",
  ];
  const queries: SmtQuery[] = [];

  program.functions.forEach((fn, idx) => {
    const divConds: { path: string[]; denom: string; expr: Expr }[] = [];

    const emit = (
      expr: Expr,
      scope: Map<string, string>,
      path: string[],
    ): string => {
      switch (expr.kind) {
        case "num": {
          const neg = expr.value.startsWith("-");
          const abs = neg ? expr.value.slice(1) : expr.value;
          // Keep Real literals in the Real sort even when integer-valued.
          const lit =
            numTypes.get(expr) === "Int"
              ? abs
              : abs.includes(".")
                ? abs
                : `${abs}.0`;
          return neg ? `(- ${lit})` : lit;
        }
        case "bool":
          return expr.value ? "true" : "false";
        case "var": {
          const s = scope.get(expr.name);
          if (!s) throw new Error(`emit: unbound variable "${expr.name}"`);
          return s;
        }
        case "unop": {
          const a = emit(expr.arg, scope, path);
          return expr.op === "not" ? `(not ${a})` : `(- ${a})`;
        }
        case "binop": {
          const l = emit(expr.left, scope, path);
          const r = emit(expr.right, scope, path);
          if (expr.op === "/") {
            divConds.push({ path: [...path], denom: r, expr });
          }
          return `(${BINOP_SMT[expr.op]} ${l} ${r})`;
        }
        case "ite": {
          const c = emit(expr.cond, scope, path);
          const t = emit(expr.then, scope, [...path, c]);
          const e = emit(expr.else, scope, [...path, `(not ${c})`]);
          return `(ite ${c} ${t} ${e})`;
        }
        case "call": {
          const callee = byName.get(expr.fn);
          if (!callee) throw new Error(`emit: unknown function "${expr.fn}"`);
          const calleeScope = new Map<string, string>();
          callee.params.forEach((p, i) => {
            const arg = expr.args[i];
            if (!arg) throw new Error(`emit: missing argument for "${p.name}"`);
            calleeScope.set(p.name, emit(arg, scope, path));
          });
          return emit(callee.body, calleeScope, path);
        }
      }
    };

    // Distinct declared names per function so one flat script has no clashes;
    // counterexamples map these back to the original param names.
    const smtName = (n: string) => `f${idx}_${n}`;
    const scope = new Map<string, string>(
      fn.params.map((p) => [p.name, smtName(p.name)]),
    );
    const resultSmt = smtName(RESULT_NAME);
    const paramMap = fn.params.map((p) => ({
      smt: smtName(p.name),
      orig: p.name,
    }));

    for (const p of fn.params) {
      lines.push(`(declare-const ${smtName(p.name)} ${SORT[p.type]})`);
    }
    lines.push(`(declare-const ${resultSmt} ${SORT[fn.returnType]})`);
    for (const c of fn.requires) {
      lines.push(`(assert ${emit(c.expr, scope, [])})`);
    }
    lines.push(`(assert (= ${resultSmt} ${emit(fn.body, scope, [])}))`);

    const ensuresScope = new Map([...scope, [RESULT_NAME, resultSmt]]);
    const getVars = [...paramMap.map((p) => p.smt), resultSmt].join(" ");

    // Prove each postcondition by refuting its negation: unsat ⇒ holds ∀ inputs.
    for (const clause of fn.ensures) {
      const qid = queries.length;
      lines.push(
        "(push 1)",
        `(assert (not ${emit(clause.expr, ensuresScope, [])}))`,
        `(echo "@@Q${qid}")`,
        "(check-sat)",
        `(get-value (${getVars}))`,
        "(pop 1)",
      );
      queries.push({
        kind: "ensures",
        fn: fn.name,
        axiomId: clause.axiomId,
        pretty: prettyExpr(clause.expr, "math"),
        params: paramMap,
        resultSmt,
      });
    }

    // A division is safe iff its denominator can't be zero on its own path:
    // assert the path and denom == 0; anything but unsat is a hazard.
    for (const dc of divConds) {
      const qid = queries.length;
      lines.push(
        "(push 1)",
        ...dc.path.map((p) => `(assert ${p})`),
        `(assert (= ${dc.denom} 0))`,
        `(echo "@@Q${qid}")`,
        "(check-sat)",
        `(get-value (${getVars}))`,
        "(pop 1)",
      );
      queries.push({
        kind: "div",
        fn: fn.name,
        axiomId: "(division)",
        pretty: prettyExpr(dc.expr, "math"),
        params: paramMap,
        resultSmt,
      });
    }
  });

  return { script: lines.join("\n"), queries };
}

// Parse z3's stdout into one answer per query, delimited by the `@@Q<i>` echo
// markers. On a non-sat check the trailing get-value prints an `(error …)` we
// simply ignore, since we only read the model when the verdict is `sat`.
export function parseZ3Output(
  stdout: string,
  queryCount: number,
): QueryAnswer[] {
  const answers: QueryAnswer[] = Array.from({ length: queryCount }, () => ({
    result: "unknown" as const,
    model: {},
  }));
  const parts = stdout.split(/@@Q(\d+)[^\n]*\n/);
  // parts = [preamble, "0", body0, "1", body1, …]
  for (let i = 1; i < parts.length; i += 2) {
    const qid = Number(parts[i]);
    if (!Number.isInteger(qid) || qid < 0 || qid >= queryCount) continue;
    const body = parts[i + 1] ?? "";
    const nl = body.indexOf("\n");
    const head = (nl < 0 ? body : body.slice(0, nl)).trim();
    const result =
      head === "sat" ? "sat" : head === "unsat" ? "unsat" : "unknown";
    answers[qid] = {
      result,
      model: result === "sat" ? parseModel(body.slice(nl + 1)) : {},
    };
  }
  return answers;
}

// z3 get-value output: `((f0_x 0.0) (f0_result (/ 1 2)))`, possibly across lines.
function parseModel(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re =
    /\(([A-Za-z_][A-Za-z0-9_]*)\s+(\(-\s*\(\/[^)]*\)\s*\)|\(-\s+[^)]*\)|\(\/\s+[^)]*\)|[^\s()]+)\)/g;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: canonical regex-exec loop
  while ((m = re.exec(text)) !== null) out[m[1]] = normalizeValue(m[2]);
  return out;
}

// Canonicalize z3's s-expression numerals: "(- x)" → "-x", "(/ a b)" → "a/b",
// and integer-valued reals ("3.0") → "3", matching how the wasm model printed.
export function normalizeValue(v: string): string {
  const value = v.trim();
  let m = value.match(/^\(-\s*(.+)\)$/);
  if (m) return `-${normalizeValue(m[1])}`;
  m = value.match(/^\(\/\s+(\S+)\s+(\S+)\)$/);
  if (m) return `${normalizeValue(m[1])}/${normalizeValue(m[2])}`;
  m = value.match(/^(\d+)\.0+$/);
  if (m) return m[1];
  return value;
}

export function signatureOf(fn: FunctionUnit): string {
  const params = fn.params.map((p) => `${p.name}: ${p.type}`).join(", ");
  return `${fn.name}(${params}): ${fn.returnType}`;
}
