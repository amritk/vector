// The RFC contract: what an RFC requires of a function, in a form that can be
// checked against the RFC text (fidelity), against itself (coverage, typing,
// non-vacuity), and finally against an implementation (a generated nish test).
//
// The shape is deliberately small. A contract has three parts:
//
//   requirements  verbatim quotes from the RFC, each tied to a section and a
//                 BCP 14 level. These are the *claims*; nothing else may be
//                 invented.
//   functions     the signatures of the implementation under test, in a tiny
//                 type vocabulary (bytes, bytes?, i32, u32, bool).
//   clauses       the *evidence*: known-answer vectors copied from the RFC, and
//                 properties quantified over a typed domain. Every clause
//                 cites the requirements it checks, and every MUST is cited.

export const VALUE_TYPES = ["bytes", "bytes?", "i32", "u32", "bool"] as const;
export type ValueTy = (typeof VALUE_TYPES)[number];

export const LEVELS = [
  "MUST",
  "MUST NOT",
  "REQUIRED",
  "SHALL",
  "SHALL NOT",
  "SHOULD",
  "SHOULD NOT",
  "RECOMMENDED",
  "MAY",
  "OPTIONAL",
  "DEFINITION",
] as const;
export type Level = (typeof LEVELS)[number];

/** Levels whose requirement must be covered by at least one clause. */
export const BINDING_LEVELS: ReadonlySet<Level> = new Set<Level>([
  "MUST",
  "MUST NOT",
  "REQUIRED",
  "SHALL",
  "SHALL NOT",
  "DEFINITION",
]);

export interface Requirement {
  id: string;
  section: string;
  level: Level;
  /** Verbatim text from the cited section (whitespace-insensitive). */
  quote: string;
  note?: string;
}

export interface Param {
  name: string;
  type: ValueTy;
}

export interface FnSig {
  name: string;
  params: Param[];
  returns: ValueTy;
  /** The module that exports it, when not the contract's target (a reference function). */
  module?: string;
}

/**
 * A normative sentence of the RFC the contract deliberately does not test,
 * and why: an obligation on the caller (nonce uniqueness), or a property no
 * functional test observes (constant-time comparison). Listed, never silent.
 */
export interface Exclusion {
  section: string;
  quote: string;
  reason: string;
}

/**
 * A literal value. `hex` and `ascii` are checked against the RFC text unless
 * `unchecked` says why they are not printed there; `concat` is checked part by
 * part. `repeat` writes `hex` that many times (RFC-printed runs like 22 × 0b).
 */
export type Literal =
  | { hex: string; repeat?: number; unchecked?: string }
  | { ascii: string; unchecked?: string }
  | { int: number; unchecked?: string }
  | { bool: boolean }
  | { null: true }
  | { concat: Literal[] };

export const OPS = [
  "len",
  "concat",
  "slice",
  "zeros",
  "fill",
  "flipBit",
  "unwrap",
  "isNull",
  "notNull",
  "+",
  "-",
  "*",
  "%",
  "le64",
  "<",
  "<=",
  ">",
  ">=",
  "==",
  "!=",
  "and",
  "or",
  "not",
  "implies",
] as const;
export type Op = (typeof OPS)[number];

export type Expr =
  | Literal
  | { var: string }
  | { call: string; args: Expr[] }
  | { op: Op; args: Expr[] };

export type Var =
  | { name: string; type: "i32"; min: number; max: number }
  | { name: string; type: "bytes"; minLen: number; maxLen: number };

export interface VectorClause {
  kind: "vector";
  id: string;
  title: string;
  covers: string[];
  /** The RFC section the values are printed in. */
  section: string;
  call: string;
  args: Literal[];
  expect: Literal;
}

export interface PropertyClause {
  kind: "property";
  id: string;
  title: string;
  covers: string[];
  forall: Var[];
  /** Restricts the domain. Pure: no calls to the functions under test. */
  where?: Expr;
  assert: Expr;
  /** Random samples on top of the solver-chosen boundary samples (default 24). */
  samples?: number;
}

export type Clause = VectorClause | PropertyClause;

export interface RfcContract {
  contract: string;
  source: { rfc: number; title: string };
  /** The module under test, as the generated test imports it ("nish/crypto/hkdf"). */
  target: { module: string };
  requirements: Requirement[];
  functions: FnSig[];
  clauses: Clause[];
  exclusions?: Exclusion[];
}

export const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
export const SECTION_RE = /^(?:\d+(?:\.\d+)*|[A-Z](?:\.\d+)*)$/;
export const MAX_BYTES_LEN = 4096;
export const I32_MIN = -2147483648;
export const I32_MAX = 2147483647;

export const isLiteral = (e: Expr): e is Literal =>
  "hex" in e ||
  "ascii" in e ||
  "int" in e ||
  "bool" in e ||
  "null" in e ||
  "concat" in e;

/** The bytes a bytes-valued literal denotes, or null when it is not one. */
export function literalBytes(lit: Literal): Uint8Array | null {
  if ("hex" in lit) {
    const one = hexToBytes(lit.hex);
    const n = lit.repeat ?? 1;
    const out = new Uint8Array(one.length * n);
    for (let i = 0; i < n; i++) out.set(one, i * one.length);
    return out;
  }
  if ("ascii" in lit) return new TextEncoder().encode(lit.ascii);
  if ("concat" in lit) {
    const parts = lit.concat.map(literalBytes);
    if (parts.some((p) => p === null)) return null;
    const total = parts.reduce((s, p) => s + (p as Uint8Array).length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const p of parts as Uint8Array[]) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }
  return null;
}

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

// ── Shape ──────────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function checkKeys(
  o: Obj,
  allowed: string[],
  at: string,
  errors: string[],
): void {
  for (const k of Object.keys(o)) {
    if (!allowed.includes(k)) errors.push(`${at}: unknown field "${k}"`);
  }
}

function shapeLiteral(v: unknown, at: string, errors: string[]): void {
  if (!isObj(v)) {
    errors.push(`${at}: expected a literal object`);
    return;
  }
  if ("hex" in v) {
    checkKeys(v, ["hex", "repeat", "unchecked"], at, errors);
    if (typeof v.hex !== "string" || !/^(?:[0-9a-f]{2})*$/.test(v.hex)) {
      errors.push(`${at}.hex: lowercase hex with an even number of digits`);
    }
    if (
      v.repeat !== undefined &&
      !(Number.isInteger(v.repeat) && (v.repeat as number) >= 1)
    ) {
      errors.push(`${at}.repeat: an integer >= 1`);
    }
  } else if ("ascii" in v) {
    checkKeys(v, ["ascii", "unchecked"], at, errors);
    if (typeof v.ascii !== "string") errors.push(`${at}.ascii: a string`);
  } else if ("int" in v) {
    checkKeys(v, ["int", "unchecked"], at, errors);
    if (
      !Number.isInteger(v.int) ||
      (v.int as number) < I32_MIN ||
      (v.int as number) > 4294967295
    ) {
      errors.push(`${at}.int: an integer in the i32/u32 range`);
    }
  } else if ("bool" in v) {
    checkKeys(v, ["bool"], at, errors);
    if (typeof v.bool !== "boolean") errors.push(`${at}.bool: a boolean`);
  } else if ("null" in v) {
    checkKeys(v, ["null"], at, errors);
    if (v.null !== true) errors.push(`${at}.null: must be true`);
  } else if ("concat" in v) {
    checkKeys(v, ["concat"], at, errors);
    if (!Array.isArray(v.concat) || v.concat.length === 0) {
      errors.push(`${at}.concat: a non-empty array`);
    } else {
      v.concat.forEach((p, i) => shapeLiteral(p, `${at}.concat[${i}]`, errors));
    }
  } else {
    errors.push(`${at}: not a literal (hex, ascii, int, bool, null, concat)`);
  }
  if (
    "unchecked" in v &&
    (typeof v.unchecked !== "string" || v.unchecked.trim() === "")
  ) {
    errors.push(`${at}.unchecked: a non-empty reason`);
  }
}

function shapeExpr(v: unknown, at: string, errors: string[]): void {
  if (!isObj(v)) {
    errors.push(`${at}: expected an expression object`);
    return;
  }
  if ("var" in v) {
    checkKeys(v, ["var"], at, errors);
    if (typeof v.var !== "string" || !IDENT_RE.test(v.var)) {
      errors.push(`${at}.var: an identifier`);
    }
    return;
  }
  if ("call" in v || "op" in v) {
    const head = "call" in v ? "call" : "op";
    checkKeys(v, [head, "args"], at, errors);
    if (
      head === "call" &&
      (typeof v.call !== "string" || !IDENT_RE.test(v.call))
    ) {
      errors.push(`${at}.call: an identifier`);
    }
    if (head === "op" && !(OPS as readonly unknown[]).includes(v.op)) {
      errors.push(`${at}.op: one of ${OPS.join(" ")}`);
    }
    if (!Array.isArray(v.args)) {
      errors.push(`${at}.args: an array`);
    } else {
      v.args.forEach((a, i) => shapeExpr(a, `${at}.args[${i}]`, errors));
    }
    return;
  }
  shapeLiteral(v, at, errors);
}

const strField = (o: Obj, k: string, at: string, errors: string[]) => {
  if (typeof o[k] !== "string" || (o[k] as string).trim() === "") {
    errors.push(`${at}.${k}: a non-empty string`);
  }
};

/** Structural validation. Empty means the input has the RfcContract shape. */
export function validateContractShape(input: unknown): string[] {
  const errors: string[] = [];
  if (!isObj(input)) return ["contract: expected an object"];
  checkKeys(
    input,
    [
      "$schema",
      "contract",
      "source",
      "target",
      "requirements",
      "functions",
      "clauses",
      "exclusions",
    ],
    "contract",
    errors,
  );
  if (typeof input.contract !== "string" || !ID_RE.test(input.contract)) {
    errors.push("contract.contract: an id ([A-Za-z0-9._-])");
  }
  if (!isObj(input.source)) errors.push("contract.source: an object");
  else {
    if (!Number.isInteger(input.source.rfc)) {
      errors.push("contract.source.rfc: the RFC number");
    }
    strField(input.source, "title", "contract.source", errors);
  }
  if (!isObj(input.target)) errors.push("contract.target: an object");
  else strField(input.target, "module", "contract.target", errors);

  if (!Array.isArray(input.requirements) || input.requirements.length === 0) {
    errors.push("contract.requirements: a non-empty array");
  } else {
    input.requirements.forEach((r, i) => {
      const at = `requirements[${i}]`;
      if (!isObj(r)) {
        errors.push(`${at}: an object`);
        return;
      }
      checkKeys(r, ["id", "section", "level", "quote", "note"], at, errors);
      if (typeof r.id !== "string" || !ID_RE.test(r.id)) {
        errors.push(`${at}.id: an id`);
      }
      if (typeof r.section !== "string" || !SECTION_RE.test(r.section)) {
        errors.push(`${at}.section: a section number like "2.3" or "A.1"`);
      }
      if (!(LEVELS as readonly unknown[]).includes(r.level)) {
        errors.push(`${at}.level: one of ${LEVELS.join(", ")}`);
      }
      strField(r, "quote", at, errors);
    });
  }

  if (!Array.isArray(input.functions) || input.functions.length === 0) {
    errors.push("contract.functions: a non-empty array");
  } else {
    input.functions.forEach((f, i) => {
      const at = `functions[${i}]`;
      if (!isObj(f)) {
        errors.push(`${at}: an object`);
        return;
      }
      checkKeys(f, ["name", "params", "returns", "module"], at, errors);
      if (
        f.module !== undefined &&
        (typeof f.module !== "string" || f.module === "")
      ) {
        errors.push(`${at}.module: a module specifier`);
      }
      if (typeof f.name !== "string" || !IDENT_RE.test(f.name)) {
        errors.push(`${at}.name: an identifier`);
      }
      if (!(VALUE_TYPES as readonly unknown[]).includes(f.returns)) {
        errors.push(`${at}.returns: one of ${VALUE_TYPES.join(" ")}`);
      }
      if (!Array.isArray(f.params)) errors.push(`${at}.params: an array`);
      else {
        f.params.forEach((p, j) => {
          const pat = `${at}.params[${j}]`;
          if (!isObj(p)) {
            errors.push(`${pat}: an object`);
            return;
          }
          checkKeys(p, ["name", "type"], pat, errors);
          if (typeof p.name !== "string" || !IDENT_RE.test(p.name)) {
            errors.push(`${pat}.name: an identifier`);
          }
          if (!(VALUE_TYPES as readonly unknown[]).includes(p.type)) {
            errors.push(`${pat}.type: one of ${VALUE_TYPES.join(" ")}`);
          }
        });
      }
    });
  }

  if (input.exclusions !== undefined) {
    if (!Array.isArray(input.exclusions))
      errors.push("contract.exclusions: an array");
    else {
      input.exclusions.forEach((x, i) => {
        const at = `exclusions[${i}]`;
        if (!isObj(x)) {
          errors.push(`${at}: an object`);
          return;
        }
        checkKeys(x, ["section", "quote", "reason"], at, errors);
        if (typeof x.section !== "string" || !SECTION_RE.test(x.section)) {
          errors.push(`${at}.section: a section number`);
        }
        strField(x, "quote", at, errors);
        strField(x, "reason", at, errors);
      });
    }
  }

  if (!Array.isArray(input.clauses) || input.clauses.length === 0) {
    errors.push("contract.clauses: a non-empty array");
  } else {
    input.clauses.forEach((c, i) => {
      const at = `clauses[${i}]`;
      if (!isObj(c)) {
        errors.push(`${at}: an object`);
        return;
      }
      if (typeof c.id !== "string" || !ID_RE.test(c.id)) {
        errors.push(`${at}.id: an id`);
      }
      strField(c, "title", at, errors);
      if (
        !Array.isArray(c.covers) ||
        c.covers.length === 0 ||
        c.covers.some((x) => typeof x !== "string")
      ) {
        errors.push(`${at}.covers: a non-empty array of requirement ids`);
      }
      if (c.kind === "vector") {
        checkKeys(
          c,
          [
            "kind",
            "id",
            "title",
            "covers",
            "section",
            "call",
            "args",
            "expect",
          ],
          at,
          errors,
        );
        if (typeof c.section !== "string" || !SECTION_RE.test(c.section)) {
          errors.push(`${at}.section: a section number`);
        }
        if (typeof c.call !== "string" || !IDENT_RE.test(c.call)) {
          errors.push(`${at}.call: a function name`);
        }
        if (!Array.isArray(c.args)) errors.push(`${at}.args: an array`);
        else
          c.args.forEach((a, j) => shapeLiteral(a, `${at}.args[${j}]`, errors));
        shapeLiteral(c.expect, `${at}.expect`, errors);
      } else if (c.kind === "property") {
        checkKeys(
          c,
          [
            "kind",
            "id",
            "title",
            "covers",
            "forall",
            "where",
            "assert",
            "samples",
          ],
          at,
          errors,
        );
        if (!Array.isArray(c.forall)) errors.push(`${at}.forall: an array`);
        else {
          c.forall.forEach((v, j) => {
            const vat = `${at}.forall[${j}]`;
            if (!isObj(v)) {
              errors.push(`${vat}: an object`);
              return;
            }
            if (typeof v.name !== "string" || !IDENT_RE.test(v.name)) {
              errors.push(`${vat}.name: an identifier`);
            }
            if (v.type === "i32") {
              checkKeys(v, ["name", "type", "min", "max"], vat, errors);
              const ok =
                Number.isInteger(v.min) &&
                Number.isInteger(v.max) &&
                (v.min as number) >= I32_MIN &&
                (v.max as number) <= I32_MAX &&
                (v.min as number) <= (v.max as number);
              if (!ok) errors.push(`${vat}: i32 needs integer min <= max`);
            } else if (v.type === "bytes") {
              checkKeys(v, ["name", "type", "minLen", "maxLen"], vat, errors);
              const ok =
                Number.isInteger(v.minLen) &&
                Number.isInteger(v.maxLen) &&
                (v.minLen as number) >= 0 &&
                (v.maxLen as number) <= MAX_BYTES_LEN &&
                (v.minLen as number) <= (v.maxLen as number);
              if (!ok) {
                errors.push(
                  `${vat}: bytes needs integer 0 <= minLen <= maxLen <= ${MAX_BYTES_LEN}`,
                );
              }
            } else {
              errors.push(`${vat}.type: "i32" or "bytes"`);
            }
          });
        }
        if (c.where !== undefined) shapeExpr(c.where, `${at}.where`, errors);
        shapeExpr(c.assert, `${at}.assert`, errors);
        if (
          c.samples !== undefined &&
          !(
            Number.isInteger(c.samples) &&
            (c.samples as number) >= 0 &&
            (c.samples as number) <= 256
          )
        ) {
          errors.push(`${at}.samples: an integer in 0..256`);
        }
      } else {
        errors.push(`${at}.kind: "vector" or "property"`);
      }
    });
  }
  return errors;
}

// ── Typing ─────────────────────────────────────────────────────────────────

/** The type of an expression; "null" only for the null literal. */
export type ExprTy = ValueTy | "null";

export interface TypeEnv {
  fns: Map<string, FnSig>;
  vars: Map<string, ValueTy>;
  /** False inside `where`: the domain must be decidable without the implementation. */
  allowCalls: boolean;
}

/** Can a value of type `from` be passed where `to` is expected? */
export function assignable(from: ExprTy, to: ValueTy): boolean {
  if (from === to) return true;
  if (to === "bytes?") return from === "bytes" || from === "null";
  if (to === "u32") return from === "i32";
  return false;
}

const isBytesLike = (t: ExprTy) =>
  t === "bytes" || t === "bytes?" || t === "null";

export function typeOfLiteral(lit: Literal): ExprTy {
  if ("hex" in lit || "ascii" in lit || "concat" in lit) return "bytes";
  if ("int" in lit) return "i32";
  if ("bool" in lit) return "bool";
  return "null";
}

/** Type an expression, pushing errors; returns null when it cannot be typed. */
export function typeOf(
  e: Expr,
  env: TypeEnv,
  at: string,
  errors: string[],
): ExprTy | null {
  if (isLiteral(e)) {
    if ("int" in e && (e.int < I32_MIN || e.int > I32_MAX)) {
      errors.push(
        `${at}: int ${e.int} is outside i32 (u32 values belong in vectors)`,
      );
      return null;
    }
    return typeOfLiteral(e);
  }
  if ("var" in e) {
    const t = env.vars.get(e.var);
    if (!t) {
      errors.push(`${at}: unknown variable "${e.var}"`);
      return null;
    }
    return t;
  }
  if ("call" in e) {
    if (!env.allowCalls) {
      errors.push(
        `${at}: "where" may not call ${e.call} — the domain must not depend on the implementation`,
      );
      return null;
    }
    const sig = env.fns.get(e.call);
    if (!sig) {
      errors.push(`${at}: unknown function "${e.call}"`);
      return null;
    }
    if (e.args.length !== sig.params.length) {
      errors.push(
        `${at}: ${e.call} takes ${sig.params.length} argument(s), got ${e.args.length}`,
      );
      return null;
    }
    let ok = true;
    e.args.forEach((a, i) => {
      const t = typeOf(a, env, `${at}.args[${i}]`, errors);
      const want = sig.params[i].type;
      if (t === null) ok = false;
      else if (!assignable(t, want)) {
        ok = false;
        errors.push(
          `${at}.args[${i}]: ${e.call}(${sig.params[i].name}) wants ${want}, got ${t}${t === "bytes?" ? ' — wrap it in {"op":"unwrap"}' : ""}`,
        );
      }
    });
    return ok ? sig.returns : null;
  }
  const ts = e.args.map((a, i) => typeOf(a, env, `${at}.args[${i}]`, errors));
  if (ts.some((t) => t === null)) return null;
  const want = (n: number) => {
    if (ts.length !== n) {
      errors.push(`${at}: ${e.op} takes ${n} argument(s), got ${ts.length}`);
      return false;
    }
    return true;
  };
  const expect = (i: number, ty: ValueTy) => {
    if (ts[i] !== ty) {
      errors.push(`${at}.args[${i}]: ${e.op} wants ${ty}, got ${ts[i]}`);
      return false;
    }
    return true;
  };
  switch (e.op) {
    case "len":
      return want(1) && expect(0, "bytes") ? "i32" : null;
    case "concat":
      return want(2) && expect(0, "bytes") && expect(1, "bytes")
        ? "bytes"
        : null;
    case "slice":
      return want(3) &&
        expect(0, "bytes") &&
        expect(1, "i32") &&
        expect(2, "i32")
        ? "bytes"
        : null;
    case "zeros":
      return want(1) && expect(0, "i32") ? "bytes" : null;
    case "fill":
      return want(2) && expect(0, "i32") && expect(1, "i32") ? "bytes" : null;
    case "flipBit":
      return want(2) && expect(0, "bytes") && expect(1, "i32") ? "bytes" : null;
    case "unwrap":
      return want(1) && expect(0, "bytes?") ? "bytes" : null;
    case "isNull":
    case "notNull":
      if (!want(1)) return null;
      if (ts[0] !== "bytes?") {
        errors.push(`${at}: ${e.op} wants bytes?, got ${ts[0]}`);
        return null;
      }
      return "bool";
    case "+":
    case "-":
    case "*":
    case "%":
      return want(2) && expect(0, "i32") && expect(1, "i32") ? "i32" : null;
    case "le64":
      return want(1) && expect(0, "i32") ? "bytes" : null;
    case "<":
    case "<=":
    case ">":
    case ">=":
      return want(2) && expect(0, "i32") && expect(1, "i32") ? "bool" : null;
    case "==":
    case "!=": {
      if (!want(2)) return null;
      const [a, b] = ts as ExprTy[];
      const same =
        (isBytesLike(a) && isBytesLike(b) && !(a === "null" && b === "null")) ||
        (a === "i32" && b === "i32") ||
        (a === "bool" && b === "bool");
      if (!same) {
        errors.push(`${at}: cannot compare ${a} with ${b}`);
        return null;
      }
      return "bool";
    }
    case "and":
    case "or":
      if (ts.length < 2) {
        errors.push(`${at}: ${e.op} takes at least 2 arguments`);
        return null;
      }
      return ts.every((_, i) => expect(i, "bool")) ? "bool" : null;
    case "not":
      return want(1) && expect(0, "bool") ? "bool" : null;
    case "implies":
      return want(2) && expect(0, "bool") && expect(1, "bool") ? "bool" : null;
  }
}

/** Collect every call target in an expression. */
export function callsIn(e: Expr, out: Set<string> = new Set()): Set<string> {
  if ("call" in e) {
    out.add(e.call);
    for (const a of e.args) callsIn(a, out);
  } else if ("op" in e) {
    for (const a of e.args) callsIn(a, out);
  }
  return out;
}
