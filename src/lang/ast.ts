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
// never a float64 round-trip. No leading zeros: Z3 reads "010" as ten, but the
// same text in the emitted source is a legacy octal literal (eight), or a
// syntax error ("08"). Mirrors the `pattern` in schemas/program.json.
export const NUM_LITERAL_RE = /^-?(0|[1-9]\d*)(\.\d+)?$/;
export const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

// Axiom ids ("AX1", "AX-RATE") are embedded verbatim in emitted TypeScript
// (doc comments and throw messages), so they must stay injection-safe.
// Mirrors the `pattern` in schemas/*.json.
export const AXIOM_ID_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;

// The name postconditions use to refer to a function's return value.
export const RESULT_NAME = "result";

// Names a program may not use for a function or parameter: they match
// IDENT_RE but break the emitted TypeScript — a reserved word does not
// compile, and a parameter named `Math` or `Number` shadows the global the
// emitted body or domain guard calls (`Math.floor`, `Number.isFinite`), so
// code the solver PROVED would crash or skip its guard at runtime.
export const RESERVED_IDENTS: ReadonlySet<string> = new Set([
  // ECMAScript reserved words, strict-mode reserved words, and literals.
  ..."break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await async of".split(
    " ",
  ),
  // TypeScript keywords that are not valid binding names in emitted code.
  ..."any as asserts declare get is keyof module namespace never readonly require set type unique unknown infer satisfies accessor abstract override".split(
    " ",
  ),
  // Globals the emitted code relies on, plus values that read as literals.
  ..."Math Number RangeError Error Infinity NaN undefined globalThis arguments eval Object Array String Boolean Symbol BigInt JSON".split(
    " ",
  ),
]);
