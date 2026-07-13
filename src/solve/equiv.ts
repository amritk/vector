import type { Expr, FunctionUnit, NumericTy, Program } from "../lang/ast.ts";
import { prettyExpr } from "../report/pretty.ts";
import {
  type QueryAnswer,
  SMT_PREAMBLE,
  createTermEmitter,
  signatureOf,
} from "./smt.ts";

// The equivalence differ: given an OLD and a NEW version of a program, ask Z3
// whether any input can tell them apart. This is the gate that makes generated
// code safely ephemeral — a regeneration whose contract is deliberately partial
// can still be proven to preserve behavior, and when it doesn't, the human
// reviews a concrete input/output delta instead of the code.
//
// Observable behavior of an emitted function is its `requires` (runtime
// guards) plus its `body` (the return value); `ensures` are proof-only, so a
// contract rewording alone can never register as a behavioral difference.
// Three checks per name-matched, signature-compatible pair:
//
//   narrowed:  ∃x. pre_old(x) ∧ ¬pre_new(x)   — inputs the new version rejects
//   widened:   ∃x. pre_new(x) ∧ ¬pre_old(x)   — inputs the new version accepts
//   value:     ∃x. pre_old ∧ pre_new ∧ body_old(x) ≠ body_new(x)
//
// unsat on all three ⇒ EQUIVALENT (for all inputs, over exact rationals).
// Like the verifier, this assumes each side individually PROVED — in
// particular that its divisions are guarded within its own precondition
// region; run `--verify` before `--diff`.

export interface DiffWitness {
  inputs: Record<string, string>;
  oldResult?: string;
  newResult?: string;
}

/** `none` = proven impossible (unsat); `witness` = concrete input found. */
export type DiffCheckStatus = "none" | "witness" | "unknown";

export interface DiffCheck {
  status: DiffCheckStatus;
  witness?: DiffWitness;
}

export interface ContractTextDiff {
  requiresAdded: string[];
  requiresRemoved: string[];
  ensuresAdded: string[];
  ensuresRemoved: string[];
}

export interface MatchedFunctionDiff {
  name: string;
  signature: string;
  /** Positional param renames (no behavioral effect; calls are positional). */
  paramRenames: { oldName: string; newName: string }[];
  domainNarrowed: DiffCheck;
  domainWidened: DiffCheck;
  valueDiff: DiffCheck;
  /** All three checks came back unsat. */
  equivalent: boolean;
  /** Textual clause changes — informational; review these in the SpecPlan. */
  contractChanges: ContractTextDiff;
}

export interface FunctionPairing {
  comparable: { oldFn: FunctionUnit; newFn: FunctionUnit }[];
  signatureChanged: {
    name: string;
    oldSignature: string;
    newSignature: string;
  }[];
  added: FunctionUnit[];
  removed: FunctionUnit[];
}

/**
 * Match functions across the two versions by name. A pair is comparable when
 * its positional param types and return type agree (param *names* may differ —
 * vector-lang calls and emitted TS calls are positional).
 */
export function pairFunctions(
  oldProgram: Program,
  newProgram: Program,
): FunctionPairing {
  const oldByName = new Map(oldProgram.functions.map((f) => [f.name, f]));
  const newByName = new Map(newProgram.functions.map((f) => [f.name, f]));
  const pairing: FunctionPairing = {
    comparable: [],
    signatureChanged: [],
    added: newProgram.functions.filter((f) => !oldByName.has(f.name)),
    removed: oldProgram.functions.filter((f) => !newByName.has(f.name)),
  };

  for (const oldFn of oldProgram.functions) {
    const newFn = newByName.get(oldFn.name);
    if (!newFn) continue;
    const compatible =
      oldFn.returnType === newFn.returnType &&
      oldFn.params.length === newFn.params.length &&
      oldFn.params.every((p, i) => p.type === newFn.params[i]?.type);
    if (compatible) {
      pairing.comparable.push({ oldFn, newFn });
    } else {
      pairing.signatureChanged.push({
        name: oldFn.name,
        oldSignature: signatureOf(oldFn),
        newSignature: signatureOf(newFn),
      });
    }
  }
  return pairing;
}

interface DiffQuery {
  kind: "narrowed" | "widened" | "value";
  fn: string;
  /** SMT const ↔ display param name (the new version's names). */
  params: { smt: string; orig: string }[];
  oldResultSmt: string;
  newResultSmt: string;
}

export interface DiffScript {
  script: string;
  queries: DiffQuery[];
}

const SORT: Record<string, string> = { Real: "Real", Int: "Int", Bool: "Bool" };

const conj = (terms: string[]): string =>
  terms.length === 0
    ? "true"
    : terms.length === 1
      ? (terms[0] as string)
      : `(and ${terms.join(" ")})`;

export function emitDiffScript(
  pairs: { oldFn: FunctionUnit; newFn: FunctionUnit }[],
  oldProgram: Program,
  oldNumTypes: WeakMap<Expr, NumericTy>,
  newProgram: Program,
  newNumTypes: WeakMap<Expr, NumericTy>,
): DiffScript {
  const oldByName = new Map(oldProgram.functions.map((f) => [f.name, f]));
  const newByName = new Map(newProgram.functions.map((f) => [f.name, f]));
  const emitOld = createTermEmitter(oldByName, oldNumTypes);
  const emitNew = createTermEmitter(newByName, newNumTypes);

  const lines: string[] = [...SMT_PREAMBLE];
  const queries: DiffQuery[] = [];

  pairs.forEach(({ oldFn, newFn }, idx) => {
    // One shared set of input consts per pair; the two versions' param names
    // both map onto it positionally. The `x`/`r` infix keeps params and result
    // consts collision-free (a param could itself be named "result_old").
    const paramSmt = newFn.params.map((p, i) => `d${idx}x${i}_${p.name}`);
    const oldResultSmt = `d${idx}r_old`;
    const newResultSmt = `d${idx}r_new`;

    newFn.params.forEach((p, i) => {
      lines.push(`(declare-const ${paramSmt[i]} ${SORT[p.type]})`);
    });
    lines.push(`(declare-const ${oldResultSmt} ${SORT[oldFn.returnType]})`);
    lines.push(`(declare-const ${newResultSmt} ${SORT[newFn.returnType]})`);

    const oldScope = new Map(
      oldFn.params.map((p, i) => [p.name, paramSmt[i] as string]),
    );
    const newScope = new Map(
      newFn.params.map((p, i) => [p.name, paramSmt[i] as string]),
    );

    const preOld = oldFn.requires.map((c) => emitOld(c.expr, oldScope, []));
    const preNew = newFn.requires.map((c) => emitNew(c.expr, newScope, []));
    const bodyOld = emitOld(oldFn.body, oldScope, []);
    const bodyNew = emitNew(newFn.body, newScope, []);

    const params = newFn.params.map((p, i) => ({
      smt: paramSmt[i] as string,
      orig: p.name,
    }));

    const query = (
      kind: DiffQuery["kind"],
      asserts: string[],
      getVars: string[],
    ) => {
      const qid = queries.length;
      lines.push(
        "(push 1)",
        ...asserts.map((a) => `(assert ${a})`),
        `(echo "@@Q${qid}")`,
        "(check-sat)",
        ...(getVars.length > 0 ? [`(get-value (${getVars.join(" ")}))`] : []),
        "(pop 1)",
      );
      queries.push({
        kind,
        fn: newFn.name,
        params,
        oldResultSmt,
        newResultSmt,
      });
    };

    const paramVars = params.map((p) => p.smt);
    // sat ⇒ an input the old version accepted is now rejected (guard throws).
    query("narrowed", [...preOld, `(not ${conj(preNew)})`], paramVars);
    // sat ⇒ an input the old version rejected is now accepted.
    query("widened", [...preNew, `(not ${conj(preOld)})`], paramVars);
    // sat ⇒ on the shared domain, the two bodies disagree somewhere.
    query(
      "value",
      [
        ...preOld,
        ...preNew,
        `(= ${oldResultSmt} ${bodyOld})`,
        `(= ${newResultSmt} ${bodyNew})`,
        `(distinct ${oldResultSmt} ${newResultSmt})`,
      ],
      [...paramVars, oldResultSmt, newResultSmt],
    );
  });

  return { script: lines.join("\n"), queries };
}

function toCheck(
  q: DiffQuery,
  answer: QueryAnswer,
  withResults: boolean,
): DiffCheck {
  if (answer.result === "unsat") return { status: "none" };
  if (answer.result !== "sat") return { status: "unknown" };
  const inputs: Record<string, string> = {};
  for (const p of q.params) {
    const v = answer.model[p.smt];
    if (v !== undefined) inputs[p.orig] = v;
  }
  return {
    status: "witness",
    witness: withResults
      ? {
          inputs,
          oldResult: answer.model[q.oldResultSmt],
          newResult: answer.model[q.newResultSmt],
        }
      : { inputs },
  };
}

const prettySet = (clauses: { expr: Expr }[]): Set<string> =>
  new Set(clauses.map((c) => prettyExpr(c.expr, "math")));

const setDiff = (a: Set<string>, b: Set<string>): string[] =>
  [...a].filter((x) => !b.has(x));

/** Fold z3's per-query answers back into one verdict per compared pair. */
export function assembleDiffs(
  pairs: { oldFn: FunctionUnit; newFn: FunctionUnit }[],
  queries: DiffQuery[],
  answers: QueryAnswer[],
): MatchedFunctionDiff[] {
  return pairs.map(({ oldFn, newFn }, idx) => {
    // emitDiffScript pushes exactly three queries per pair, in order.
    const base = idx * 3;
    const checks = [0, 1, 2].map((offset) => {
      const q = queries[base + offset];
      const a = answers[base + offset];
      if (!q || !a) throw new Error("diff: query/answer misalignment");
      return toCheck(q, a, q.kind === "value");
    }) as [DiffCheck, DiffCheck, DiffCheck];
    const [domainNarrowed, domainWidened, valueDiff] = checks;

    const oldReq = prettySet(oldFn.requires);
    const newReq = prettySet(newFn.requires);
    const oldEns = prettySet(oldFn.ensures);
    const newEns = prettySet(newFn.ensures);

    return {
      name: newFn.name,
      signature: signatureOf(newFn),
      paramRenames: newFn.params.flatMap((p, i) => {
        const oldName = oldFn.params[i]?.name;
        return oldName && oldName !== p.name
          ? [{ oldName, newName: p.name }]
          : [];
      }),
      domainNarrowed,
      domainWidened,
      valueDiff,
      equivalent: checks.every((c) => c.status === "none"),
      contractChanges: {
        requiresAdded: setDiff(newReq, oldReq),
        requiresRemoved: setDiff(oldReq, newReq),
        ensuresAdded: setDiff(newEns, oldEns),
        ensuresRemoved: setDiff(oldEns, newEns),
      },
    };
  });
}
