// Result shapes produced by the deterministic solver stage — plain data built
// from the native z3 CLI's textual answers.

export interface Counterexample {
  inputs: Record<string, string>;
  result: string;
}

export type ClauseStatus = "proven" | "counterexample" | "unknown";

export interface ClauseVerdict {
  axiomId: string;
  pretty: string;
  status: ClauseStatus;
  counterexample?: Counterexample;
  /** Proven but tautological: holds independent of the body, so it tests nothing. */
  trivial?: boolean;
  millis: number;
}

export interface DivHazard {
  pretty: string;
  counterexample?: Counterexample;
}

/** A callee precondition that can fail for the actual arguments on some path. */
export interface PreHazard {
  callee: string;
  pretty: string;
  counterexample?: Counterexample;
}

/** A proven guarantee that nonetheless fails when the emitted code runs in float64. */
export interface ConformanceIssue {
  function: string;
  /**
   * postcondition — a proven ensures clause evaluates false in float64.
   * callee-guard — a callee's requires, proven to hold at this call site over
   * exact reals, is violated by the float64-computed arguments, so the emitted
   * code throws on an input this function's own contract accepts.
   */
  kind: "postcondition" | "callee-guard";
  axiomId: string;
  pretty: string;
  inputs: Record<string, string>;
  result: string;
  note: string;
}

export interface FunctionReport {
  name: string;
  layer: number;
  purpose: string;
  signature: string;
  requiresPretty: string[];
  bodyPretty: string;
  ensures: ClauseVerdict[];
  divHazards: DivHazard[];
  preHazards: PreHazard[];
  /** True when the preconditions are contradictory (proofs would be vacuous). */
  vacuous: boolean;
}

export interface VerificationReport {
  solver: string;
  functions: FunctionReport[];
  totalVcs: number;
  unsatCount: number;
  satCount: number;
  unknownCount: number;
  divHazardCount: number;
  preHazardCount: number;
  trivialCount: number;
  vacuousCount: number;
  /** Proven-over-reals clauses that fail in float64 execution (empirical). */
  conformanceIssues: ConformanceIssue[];
  millis: number;
  /**
   * True iff every postcondition is genuinely proven for an inhabited
   * precondition region, no division or call-site precondition hazard exists,
   * no clause is a tautology, and the emitted float64 code conforms.
   */
  ok: boolean;
}

export type SolveResult =
  | { kind: "report"; report: VerificationReport }
  | { kind: "invalid"; errors: string[] }
  | { kind: "error"; message: string };
