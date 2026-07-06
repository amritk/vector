// Result shapes produced by the deterministic solver stage. These cross the
// Bun→Node subprocess boundary as JSON, so everything here must be plain data.

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
  millis: number;
}

export interface DivHazard {
  pretty: string;
  counterexample?: Counterexample;
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
}

export interface VerificationReport {
  solver: string;
  functions: FunctionReport[];
  totalVcs: number;
  unsatCount: number;
  satCount: number;
  unknownCount: number;
  divHazardCount: number;
  millis: number;
  /** True iff every postcondition is proven and no division hazard exists. */
  ok: boolean;
}

export type WorkerResult =
  | { kind: "report"; report: VerificationReport }
  | { kind: "invalid"; errors: string[] }
  | { kind: "error"; message: string };
