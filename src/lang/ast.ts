// vector-lang: the restricted expression language the Generator emits programs in.
// Small enough that every construct maps 1:1 onto both a Z3 term and a
// TypeScript expression — Dijkstra's "usefully structured" constraint made literal.
//
// The single source of truth is schemas/*.json: those files feed the LLM's
// structured-output constraint AND @amritk/mjst codegen (`bun run
// generate:schemas` → src/generated/, checked in, never hand-edited). This
// module re-exports the generated types plus the language constants shared by
// the shape validator, typechecker, and emitters.
//
// This module re-exports only types (no runtime import of the generated
// parsers), so it stays trivially loadable everywhere the solver worker runs;
// call sites that need the parser *functions* import them from src/generated/
// directly (as of mjst 0.9.0 those run under Node too, via .ts-suffixed
// imports).

export type {
  Clause,
  Expr,
  FunctionUnit,
  Ty,
} from "../generated/program/index.ts";
export type { Program } from "../generated/program/index.ts";
export type { SpecPlan } from "../generated/spec-plan/index.ts";

export type NumericTy = "Real" | "Int";

export const TYS = ["Real", "Int", "Bool"] as const;

export const UNOPS = ["not", "neg", "abs", "floor", "ceil"] as const;

export const BINOPS = [
  "+",
  "-",
  "*",
  "/",
  "min",
  "max",
  "<",
  "<=",
  ">",
  ">=",
  "==",
  "!=",
  "and",
  "or",
  "implies",
] as const;
export type BinOp = (typeof BINOPS)[number];

// Decimal strings only ("0.91", "-3") so literals reach Z3 as exact rationals,
// never a float64 round-trip. Mirrors the `pattern` in schemas/program.json.
export const NUM_LITERAL_RE = /^-?\d+(\.\d+)?$/;
export const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

// The name postconditions use to refer to a function's return value.
export const RESULT_NAME = "result";
