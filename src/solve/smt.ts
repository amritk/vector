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
//
//  - ensures:      prove a postcondition (unsat of its negation ⇒ holds ∀).
//  - div:          a division is safe iff "denominator = 0 on this path" is unsat.
//  - reachable:    the precondition region is inhabited (sat) — guards against a
//                  vacuous proof from contradictory `requires`.
//  - trivial:      the postcondition negation is unsat WITHOUT assuming the body
//                  (sat ⇒ the clause genuinely constrains `result`; unsat ⇒ it is
//                  a tautology that proves nothing about the implementation).
//  - precondition: a callee's `requires` can be violated for the actual
//                  arguments on this path (sat ⇒ a real call-site hazard).
export interface SmtQuery {
  kind: "ensures" | "div" | "reachable" | "trivial" | "precondition";
  fn: string;
  /** Spec axiom for ensures/trivial; "(division)"/"(reachable)"/"(calls X)" otherwise. */
  axiomId: string;
  /** Math-pretty of the clause (ensures) or the offending expression. */
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

/** Options shared by every vector-emitted SMT script. */
export const SMT_PREAMBLE = [
  "(set-option :produce-models true)",
  `(set-option :timeout ${PER_CHECK_TIMEOUT_MS})`,
  "(set-logic ALL)",
];

export interface TermEmitterHooks {
  /** A runtime `/` was emitted: its denominator term and the guarding path. */
  onDivision?: (info: { path: string[]; denom: string; expr: Expr }) => void;
  /**
   * A call site was emitted: one entry per callee `requires` clause, with the
   * callee's params substituted by the actual argument terms.
   */
  onCalleeRequires?: (info: {
    path: string[];
    callee: string;
    smt: string;
    pretty: string;
  }) => void;
}

export type TermEmitter = (
  expr: Expr,
  scope: Map<string, string>,
  path: string[],
) => string;

// The single AST → SMT term translation, shared by the verifier and the
// equivalence differ so the two can never disagree on semantics. Calls are
// inlined (layering guarantees termination); hooks let the verifier collect
// division and call-site-precondition hazards without the differ paying for it.
export function createTermEmitter(
  byName: Map<string, FunctionUnit>,
  numTypes: WeakMap<Expr, NumericTy>,
  hooks: TermEmitterHooks = {},
): TermEmitter {
  const emit: TermEmitter = (expr, scope, path) => {
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
        switch (expr.op) {
          case "not":
            return `(not ${a})`;
          case "neg":
            return `(- ${a})`;
          // |a| — the sort-neutral zero (- a a) keeps this valid for Int and Real.
          case "abs":
            return `(ite (>= ${a} (- ${a} ${a})) ${a} (- ${a}))`;
          // floor: to_int is SMT-LIB floor; back to Real so it composes.
          case "floor":
            return `(to_real (to_int ${a}))`;
          // ceil(a) = -floor(-a).
          default:
            return `(to_real (- (to_int (- ${a}))))`;
        }
      }
      case "binop": {
        const l = emit(expr.left, scope, path);
        const r = emit(expr.right, scope, path);
        if (expr.op === "/") {
          hooks.onDivision?.({ path: [...path], denom: r, expr });
        }
        if (expr.op === "min") return `(ite (<= ${l} ${r}) ${l} ${r})`;
        if (expr.op === "max") return `(ite (>= ${l} ${r}) ${l} ${r})`;
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
        // The callee's preconditions must hold for these actual arguments on
        // this reachable path — inlining alone would silently discharge them.
        for (const rc of callee.requires) {
          hooks.onCalleeRequires?.({
            path: [...path],
            callee: callee.name,
            smt: emit(rc.expr, calleeScope, path),
            pretty: prettyExpr(rc.expr, "math"),
          });
        }
        return emit(callee.body, calleeScope, path);
      }
    }
  };
  return emit;
}

export function emitVerificationScript(
  program: Program,
  numTypes: WeakMap<Expr, NumericTy>,
): SmtScript {
  const byName = new Map(program.functions.map((f) => [f.name, f]));
  const lines: string[] = [...SMT_PREAMBLE];
  const queries: SmtQuery[] = [];

  program.functions.forEach((fn, idx) => {
    const divConds: { path: string[]; denom: string; expr: Expr }[] = [];
    // Each call site records the callee's `requires`, with the callee params
    // substituted by the actual argument terms, plus the path it sits on.
    const preConds: {
      path: string[];
      callee: string;
      smt: string;
      pretty: string;
    }[] = [];

    const emit = createTermEmitter(byName, numTypes, {
      onDivision: (d) => divConds.push(d),
      onCalleeRequires: (p) => preConds.push(p),
    });

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

    const ensuresScope = new Map([...scope, [RESULT_NAME, resultSmt]]);
    const getVars = [...paramMap.map((p) => p.smt), resultSmt].join(" ");

    // Emit body and requires ONCE (populating divConds and preConds), then reuse
    // the terms. `requires` are asserted at function scope (they hold for every
    // check below); `result = body` is asserted per-push so the triviality check
    // can omit it.
    const bodyTerm = emit(fn.body, scope, []);
    const bindResult = `(assert (= ${resultSmt} ${bodyTerm}))`;
    const requireTerms = fn.requires.map((c) => emit(c.expr, scope, []));
    for (const term of requireTerms) lines.push(`(assert ${term})`);

    // Only the body and requires are actually EVALUATED at runtime (requires
    // become guards, the body is the return). Ensures clauses are proof-only, so
    // a division / callee-call inside one is not a runtime hazard — freeze the
    // hazard sets here and discard anything the ensures emits below add.
    const realDivCount = divConds.length;
    const realPreCount = preConds.length;

    const query = (
      q: Omit<SmtQuery, "params" | "resultSmt">,
      asserts: string[],
      withModel: boolean,
    ) => {
      const qid = queries.length;
      lines.push(
        "(push 1)",
        ...asserts,
        `(echo "@@Q${qid}")`,
        "(check-sat)",
        ...(withModel ? [`(get-value (${getVars}))`] : []),
        "(pop 1)",
      );
      queries.push({ ...q, params: paramMap, resultSmt });
    };

    // Reachability: the precondition region must be inhabited, else every
    // postcondition holds vacuously and the "proof" is worthless.
    query(
      {
        kind: "reachable",
        fn: fn.name,
        axiomId: "(reachable)",
        pretty: "requires are satisfiable",
      },
      [bindResult],
      false,
    );

    for (const clause of fn.ensures) {
      const clauseTerm = emit(clause.expr, ensuresScope, []);
      // Drop any div/call hazards this proof-only clause emitted (see above).
      divConds.length = realDivCount;
      preConds.length = realPreCount;
      const pretty = prettyExpr(clause.expr, "math");
      // Prove the postcondition: refute its negation under the body. unsat ⇒ ∀.
      query(
        { kind: "ensures", fn: fn.name, axiomId: clause.axiomId, pretty },
        [bindResult, `(assert (not ${clauseTerm}))`],
        true,
      );
      // Triviality: refute the same negation WITHOUT the body. sat ⇒ the clause
      // truly depends on the implementation; unsat ⇒ it is a tautology.
      query(
        { kind: "trivial", fn: fn.name, axiomId: clause.axiomId, pretty },
        [`(assert (not ${clauseTerm}))`],
        false,
      );
    }

    // A division is safe iff its denominator can't be zero on its own path:
    // assert the path and denom == 0; anything but unsat is a hazard.
    for (const dc of divConds) {
      query(
        {
          kind: "div",
          fn: fn.name,
          axiomId: "(division)",
          pretty: prettyExpr(dc.expr, "math"),
        },
        [
          bindResult,
          ...dc.path.map((p) => `(assert ${p})`),
          `(assert (= ${dc.denom} 0))`,
        ],
        true,
      );
    }

    // Call-site preconditions: the callee's requires must hold for the actual
    // args on this path. sat of its negation ⇒ a reachable violation.
    for (const pc of preConds) {
      query(
        {
          kind: "precondition",
          fn: fn.name,
          axiomId: `(calls ${pc.callee})`,
          pretty: pc.pretty,
        },
        [
          bindResult,
          ...pc.path.map((p) => `(assert ${p})`),
          `(assert (not ${pc.smt}))`,
        ],
        true,
      );
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
