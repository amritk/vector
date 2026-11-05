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
//                 type vocabulary (bytes, bytes?, string, string?, i32,
//                 u32, bool).
//   clauses       the *evidence*: known-answer vectors copied from the RFC, and
//                 properties quantified over a typed domain. Every clause
//                 cites the requirements it checks, and every MUST is cited.

export const VALUE_TYPES = [
  "bytes",
  "bytes?",
  "string",
  "string?",
  "i32",
  "u32",
  "bool",
] as const;
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
  /** The source document it is quoted from (default: the main one). */
  source?: string;
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
  /** The source document it is quoted from (default: the main one). */
  source?: string;
  section: string;
  quote: string;
  reason: string;
}

/**
 * A literal value. `hex` and `ascii` are checked against the RFC text unless
 * `unchecked` says why they are not printed there; `concat` is checked part by
 * part. `repeat` writes `hex` that many times (RFC-printed runs like 22 × 0b).
 * `str` is a string value (`ascii` is bytes); both are checked as text. An
 * `int` is checked only next to its `label`, the name the RFC prints it under
 * ("L = 42"); without one it is unchecked, and the report says so.
 */
export type Literal =
  | { hex: string; repeat?: number; unchecked?: string }
  | { ascii: string; unchecked?: string }
  | { str: string; unchecked?: string }
  | { int: number; label?: string; unchecked?: string }
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
  "strLen",
  "strConcat",
  "lower",
  "upper",
  "utf8",
  "ascii",
  "charAt",
] as const;
export type Op = (typeof OPS)[number];

/** `let` names values for its `in`; each binding may use the ones before it. */
export interface LetExpr {
  let: { name: string; value: Expr }[];
  in: Expr;
}

export type Expr =
  | Literal
  | { var: string }
  | { call: string; args: Expr[] }
  | { op: Op; args: Expr[] }
  | LetExpr;

export type Var =
  | { name: string; type: "i32"; min: number; max: number }
  | { name: string; type: "bytes"; minLen: number; maxLen: number }
  | {
      name: string;
      type: "string";
      minLen: number;
      maxLen: number;
      /** Characters and character classes (see ALPHABET_CLASSES). */
      alphabet: string[];
    };

const range = (lo: number, hi: number) =>
  Array.from({ length: hi - lo + 1 }, (_, i) => String.fromCharCode(lo + i));
const DIGITS = range(0x30, 0x39);

/** The named character classes a string variable's alphabet may use. */
export const ALPHABET_CLASSES: Record<string, string[]> = {
  hexdigit: [...DIGITS, ...range(0x61, 0x66)],
  HEXDIGIT: [...DIGITS, ...range(0x41, 0x46)],
  digit: DIGITS,
  alpha: [...range(0x41, 0x5a), ...range(0x61, 0x7a)],
  space: [" ", "\t", "\n", "\r"],
  "ascii-printable": range(0x20, 0x7e),
};

/**
 * The characters a string may be written with: printable ASCII, tab, LF and
 * CR. ASCII keeps a character one byte, so lengths, `charAt` and `lower`/
 * `upper` mean the same in the evaluator and in Nish (whose strings are UTF-8
 * bytes); `ascii(bytes)` can still produce any ASCII byte at run time.
 */
export const STRING_CHAR_RE = /^[\x20-\x7e\t\n\r]*$/;

/** The distinct characters an alphabet spells, in order; null if it names an unknown class. */
export function alphabetChars(alphabet: string[]): string[] | null {
  const out = new Set<string>();
  for (const a of alphabet) {
    const chars = Object.hasOwn(ALPHABET_CLASSES, a)
      ? ALPHABET_CLASSES[a]
      : a.length === 1
        ? [a]
        : null;
    if (!chars) return null;
    for (const ch of chars) out.add(ch);
  }
  return [...out];
}

/** A section of one of the contract's source documents. */
export interface Citation {
  /** A source id from `sources` (default: the main source). */
  source?: string;
  section: string;
}

/**
 * Where a vector's expected value comes from. Every vector has one.
 *
 *   cite     the value is printed in the cited section; so are the args.
 *   command  a shell command prints it (trimmed stdout: hex for bytes, the
 *            text for a string). It runs only under `--run-sources`, and until
 *            then the vector's provenance is reported as not run.
 *   spec     the section states the result in words: only for an expected
 *            null or bool, which the section must name ("null", "true",
 *            "false").
 *
 * With `command` or `spec`, the vector's own `section` (in the main source)
 * is where its args are printed.
 */
export type VectorSource =
  | { cite: Citation }
  | { command: string }
  | { spec: string };

export interface VectorClause {
  kind: "vector";
  id: string;
  title: string;
  covers: string[];
  source: VectorSource;
  /** With a `command` or `spec` source: the main-source section printing the args. */
  section?: string;
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

/** A document the contract cites: an RFC by number, a file, or both. */
export interface SourceDecl {
  id: string;
  rfc?: number;
  /** Relative to the contract's directory. */
  path?: string;
}

export interface RfcContract {
  contract: string;
  /**
   * `rfc` alone: a single-RFC contract, whose one source is that RFC. With
   * `sources`, `main` names the source the completeness gate reads; `rfc` is
   * then given on the source's own entry.
   */
  /**
   * `sha256`: the hex sha256 of the main source file's bytes, which
   * `vector spec frozen` checks against the file on disk.
   */
  source: { title: string; rfc?: number; main?: string; sha256?: string };
  sources?: SourceDecl[];
  /** The module under test, as the generated test imports it ("nish/crypto/hkdf"). */
  target: { module: string };
  requirements: Requirement[];
  functions: FnSig[];
  clauses: Clause[];
  exclusions?: Exclusion[];
  /** Exports of the target module the contract deliberately does not test. */
  outOfScope?: OutOfScope[];
  /** Mutants allowed to survive `vector spec mutate`, by line. */
  allowSurvivors?: AllowedSurvivorDecl[];
}

/** An export of the target module the contract does not test, and why. */
export interface OutOfScope {
  name: string;
  reason: string;
}

/** A line of the module whose surviving mutants are accepted, and why. */
export interface AllowedSurvivorDecl {
  /** Relative to the nish root, as `std/crypto/hkdf.ts`. */
  file: string;
  line: number;
  reason: string;
}

/** The functions the contract tests in its target module. */
export const targetFunctions = (c: RfcContract): Set<string> =>
  new Set(
    c.functions
      .filter((f) => f.module === undefined || f.module === c.target.module)
      .map((f) => f.name),
  );

export const SHA256_RE = /^[0-9a-f]{64}$/;

export const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
export const SECTION_RE = /^(?:\d+(?:\.\d+)*|[A-Z](?:\.\d+)*)$/;
export const MAX_BYTES_LEN = 4096;

/** The contract's sources and its main one; a single-RFC contract has one. */
export function declaredSources(c: RfcContract): {
  main: string;
  list: SourceDecl[];
} {
  if (c.sources) return { main: c.source.main as string, list: c.sources };
  const id = `rfc${c.source.rfc}`;
  return { main: id, list: [{ id, rfc: c.source.rfc }] };
}

/** The source a citation names, its default resolved. */
export const sourceOf = (c: RfcContract, cited: string | undefined): string =>
  cited ?? declaredSources(c).main;

/** Where a vector's args are printed. */
export function vectorArgsAt(k: VectorClause): Citation {
  return "cite" in k.source ? k.source.cite : { section: k.section as string };
}

/** A short human form of a citation: "§A.1", "rfc4648 §10". */
export function citeLabel(c: RfcContract, at: Citation): string {
  const src = sourceOf(c, at.source);
  return src === declaredSources(c).main
    ? `§${at.section}`
    : `${src} §${at.section}`;
}
export const I32_MIN = -2147483648;
export const I32_MAX = 2147483647;

export const isLiteral = (e: Expr): e is Literal =>
  "hex" in e ||
  "ascii" in e ||
  "str" in e ||
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
  } else if ("str" in v) {
    checkKeys(v, ["str", "unchecked"], at, errors);
    if (typeof v.str !== "string" || !STRING_CHAR_RE.test(v.str)) {
      errors.push(`${at}.str: a string of printable ASCII, tab, LF or CR`);
    }
  } else if ("int" in v) {
    checkKeys(v, ["int", "label", "unchecked"], at, errors);
    if (
      v.label !== undefined &&
      (typeof v.label !== "string" || !/[A-Za-z]/.test(v.label))
    ) {
      errors.push(
        `${at}.label: the name the RFC prints the value under, with a letter`,
      );
    }
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
      v.concat.forEach((p, i) => {
        const pat = `${at}.concat[${i}]`;
        if (isObj(p) && !("hex" in p || "ascii" in p || "concat" in p)) {
          errors.push(`${pat}: a bytes literal (hex, ascii, concat)`);
        } else shapeLiteral(p, pat, errors);
      });
    }
  } else {
    errors.push(
      `${at}: not a literal (hex, ascii, str, int, bool, null, concat)`,
    );
  }
  if (
    "unchecked" in v &&
    (typeof v.unchecked !== "string" || v.unchecked.trim() === "")
  ) {
    errors.push(`${at}.unchecked: a non-empty reason`);
  }
}

/**
 * `letOk` is true only at the top of `assert` (and in a let's `in`): the
 * emitted test computes bindings once, before the assertion, so a `let` under
 * an `implies` or `and` would run where the evaluator short-circuits.
 */
function shapeExpr(
  v: unknown,
  at: string,
  errors: string[],
  letOk = false,
): void {
  if (!isObj(v)) {
    errors.push(`${at}: expected an expression object`);
    return;
  }
  if ("let" in v) {
    checkKeys(v, ["let", "in"], at, errors);
    if (!letOk) {
      errors.push(`${at}: a let may only open the assert (or a let's "in")`);
    }
    if (!Array.isArray(v.let) || v.let.length === 0) {
      errors.push(`${at}.let: a non-empty array of {name, value}`);
    } else {
      v.let.forEach((b, i) => {
        const bat = `${at}.let[${i}]`;
        if (!isObj(b)) {
          errors.push(`${bat}: an object`);
          return;
        }
        checkKeys(b, ["name", "value"], bat, errors);
        if (typeof b.name !== "string" || !IDENT_RE.test(b.name)) {
          errors.push(`${bat}.name: an identifier`);
        }
        shapeExpr(b.value, `${bat}.value`, errors);
      });
    }
    shapeExpr(v.in, `${at}.in`, errors, true);
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

function shapeLengths(v: Obj, at: string, what: string, errors: string[]) {
  const ok =
    Number.isInteger(v.minLen) &&
    Number.isInteger(v.maxLen) &&
    (v.minLen as number) >= 0 &&
    (v.maxLen as number) <= MAX_BYTES_LEN &&
    (v.minLen as number) <= (v.maxLen as number);
  if (!ok) {
    errors.push(
      `${at}: ${what} needs integer 0 <= minLen <= maxLen <= ${MAX_BYTES_LEN}`,
    );
  }
}

function shapeAlphabet(a: unknown, at: string, errors: string[]): void {
  if (!Array.isArray(a) || a.length === 0) {
    errors.push(`${at}: a non-empty array of characters and classes`);
    return;
  }
  const classes = Object.keys(ALPHABET_CLASSES).join(" ");
  a.forEach((x, i) => {
    const ok =
      typeof x === "string" &&
      (Object.hasOwn(ALPHABET_CLASSES, x) ||
        (x.length === 1 && STRING_CHAR_RE.test(x)));
    if (!ok) {
      errors.push(
        `${at}[${i}]: one printable ASCII character (or tab, LF, CR) or a class: ${classes}`,
      );
    }
  });
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
      "sources",
      "target",
      "requirements",
      "functions",
      "clauses",
      "exclusions",
      "outOfScope",
      "allowSurvivors",
    ],
    "contract",
    errors,
  );
  if (typeof input.contract !== "string" || !ID_RE.test(input.contract)) {
    errors.push("contract.contract: an id ([A-Za-z0-9._-])");
  }
  const ids = shapeSources(input, errors);
  const sourceRef = (v: unknown, at: string) => {
    if (v === undefined) return;
    if (typeof v !== "string" || !ids.has(v)) {
      errors.push(
        `${at}: ${JSON.stringify(v)} is not an id from contract.sources (${[...ids].join(", ") || "none declared"})`,
      );
    }
  };
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
      checkKeys(
        r,
        ["id", "source", "section", "level", "quote", "note"],
        at,
        errors,
      );
      sourceRef(r.source, `${at}.source`);
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
        checkKeys(x, ["source", "section", "quote", "reason"], at, errors);
        sourceRef(x.source, `${at}.source`);
        if (typeof x.section !== "string" || !SECTION_RE.test(x.section)) {
          errors.push(`${at}.section: a section number`);
        }
        strField(x, "quote", at, errors);
        strField(x, "reason", at, errors);
      });
    }
  }

  shapeOutOfScope(input, errors);
  shapeAllowSurvivors(input, errors);

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
            "source",
            "section",
            "call",
            "args",
            "expect",
          ],
          at,
          errors,
        );
        shapeVectorSource(c, at, sourceRef, errors);
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
              shapeLengths(v, vat, "bytes", errors);
            } else if (v.type === "string") {
              checkKeys(
                v,
                ["name", "type", "minLen", "maxLen", "alphabet"],
                vat,
                errors,
              );
              shapeLengths(v, vat, "string", errors);
              shapeAlphabet(v.alphabet, `${vat}.alphabet`, errors);
            } else {
              errors.push(`${vat}.type: "i32", "bytes" or "string"`);
            }
          });
        }
        if (c.where !== undefined) shapeExpr(c.where, `${at}.where`, errors);
        shapeExpr(c.assert, `${at}.assert`, errors, true);
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

/** Each element of an optional array field, or its error. */
function eachOf(
  input: Obj,
  key: string,
  errors: string[],
  f: (x: Obj, at: string) => void,
): void {
  const v = input[key];
  if (v === undefined) return;
  if (!Array.isArray(v)) {
    errors.push(`contract.${key}: an array`);
    return;
  }
  v.forEach((x, i) => {
    const at = `${key}[${i}]`;
    if (!isObj(x)) errors.push(`${at}: an object`);
    else f(x, at);
  });
}

/**
 * `outOfScope`: exports the contract does not test. Each needs a reason, and
 * none may name a function the contract tests in its target module.
 */
function shapeOutOfScope(input: Obj, errors: string[]): void {
  const tested = new Set<string>();
  const target = isObj(input.target) ? input.target.module : undefined;
  if (Array.isArray(input.functions))
    for (const f of input.functions)
      if (
        isObj(f) &&
        typeof f.name === "string" &&
        (f.module === undefined || f.module === target)
      )
        tested.add(f.name);
  const seen = new Set<string>();
  eachOf(input, "outOfScope", errors, (x, at) => {
    checkKeys(x, ["name", "reason"], at, errors);
    strField(x, "reason", at, errors);
    if (typeof x.name !== "string" || !IDENT_RE.test(x.name)) {
      errors.push(`${at}.name: an identifier`);
      return;
    }
    if (seen.has(x.name)) errors.push(`${at}.name: duplicate "${x.name}"`);
    seen.add(x.name);
    if (tested.has(x.name))
      errors.push(
        `${at}.name: "${x.name}" is a function the contract tests, so it cannot be out of scope`,
      );
  });
}

/** `allowSurvivors`: lines whose surviving mutants are accepted, each with a reason. */
function shapeAllowSurvivors(input: Obj, errors: string[]): void {
  eachOf(input, "allowSurvivors", errors, (x, at) => {
    checkKeys(x, ["file", "line", "reason"], at, errors);
    strField(x, "file", at, errors);
    strField(x, "reason", at, errors);
    if (!Number.isInteger(x.line) || (x.line as number) < 1)
      errors.push(`${at}.line: a line number >= 1`);
  });
}

/** `source` and `sources`; returns the declared source ids. */
function shapeSources(input: Obj, errors: string[]): Set<string> {
  const ids = new Set<string>();
  if (!isObj(input.source)) {
    errors.push("contract.source: an object");
    return ids;
  }
  const src = input.source;
  checkKeys(src, ["rfc", "title", "main", "sha256"], "contract.source", errors);
  strField(src, "title", "contract.source", errors);
  if (
    src.sha256 !== undefined &&
    (typeof src.sha256 !== "string" || !SHA256_RE.test(src.sha256))
  )
    errors.push("contract.source.sha256: 64 lowercase hex digits");
  if (input.sources === undefined) {
    if (!Number.isInteger(src.rfc) || (src.rfc as number) < 1) {
      errors.push("contract.source.rfc: the RFC number");
    } else ids.add(`rfc${src.rfc}`);
    if (src.main !== undefined) {
      errors.push("contract.source.main: only with contract.sources");
    }
    return ids;
  }
  if (src.rfc !== undefined) {
    errors.push(
      "contract.source.rfc: with contract.sources, give the RFC number on its entry there",
    );
  }
  if (!Array.isArray(input.sources) || input.sources.length === 0) {
    errors.push("contract.sources: a non-empty array");
    return ids;
  }
  input.sources.forEach((d, i) => {
    const at = `sources[${i}]`;
    if (!isObj(d)) {
      errors.push(`${at}: an object`);
      return;
    }
    checkKeys(d, ["id", "rfc", "path"], at, errors);
    if (typeof d.id !== "string" || !ID_RE.test(d.id)) {
      errors.push(`${at}.id: an id`);
    } else if (ids.has(d.id)) {
      errors.push(`${at}.id: duplicate source id "${d.id}"`);
    } else ids.add(d.id);
    if (
      d.rfc !== undefined &&
      !(Number.isInteger(d.rfc) && (d.rfc as number) >= 1)
    ) {
      errors.push(`${at}.rfc: the RFC number`);
    }
    if (d.path !== undefined && (typeof d.path !== "string" || d.path === "")) {
      errors.push(`${at}.path: a file path`);
    }
    if (d.rfc === undefined && d.path === undefined) {
      errors.push(`${at}: needs "rfc", "path" or both`);
    }
  });
  if (typeof src.main !== "string" || !ids.has(src.main)) {
    errors.push(
      "contract.source.main: the id of the main source in contract.sources",
    );
  }
  return ids;
}

/** A vector's `source` (provenance) and the `section` it may need. */
function shapeVectorSource(
  c: Obj,
  at: string,
  sourceRef: (v: unknown, at: string) => void,
  errors: string[],
): void {
  const s = c.source;
  const needSection = () => {
    if (typeof c.section !== "string" || !SECTION_RE.test(c.section)) {
      errors.push(
        `${at}.section: the main-source section number printing the args`,
      );
    }
  };
  if (!isObj(s)) {
    errors.push(
      `${at}.source: where the expected value comes from: {"cite": {"section": …}}, {"command": "…"} or {"spec": "<section>"}`,
    );
    return;
  }
  const kinds = ["cite", "command", "spec"].filter((k) => k in s);
  if (kinds.length !== 1) {
    errors.push(`${at}.source: exactly one of "cite", "command", "spec"`);
    return;
  }
  checkKeys(s, kinds, `${at}.source`, errors);
  const expect = isObj(c.expect) ? c.expect : {};
  if (isObj(s.cite)) {
    checkKeys(s.cite, ["source", "section"], `${at}.source.cite`, errors);
    sourceRef(s.cite.source, `${at}.source.cite.source`);
    if (
      typeof s.cite.section !== "string" ||
      !SECTION_RE.test(s.cite.section)
    ) {
      errors.push(`${at}.source.cite.section: a section number`);
    }
    if (c.section !== undefined) {
      errors.push(
        `${at}.section: a cited vector's args are read in source.cite; drop "section"`,
      );
    }
  } else if ("cite" in s) {
    errors.push(`${at}.source.cite: {"source"?: id, "section": …}`);
  } else if ("command" in s) {
    if (typeof s.command !== "string" || s.command.trim() === "") {
      errors.push(`${at}.source.command: a shell command`);
    }
    if (
      !(
        "hex" in expect ||
        "ascii" in expect ||
        "concat" in expect ||
        "str" in expect
      )
    ) {
      errors.push(
        `${at}.expect: a command source prints bytes (as hex) or a string`,
      );
    }
    needSection();
  } else {
    if (typeof s.spec !== "string" || !SECTION_RE.test(s.spec)) {
      errors.push(`${at}.source.spec: a main-source section number`);
    }
    if (!("null" in expect || "bool" in expect)) {
      errors.push(
        `${at}.expect: a spec source states only null or a bool; cite or compute any other value`,
      );
    }
    needSection();
  }
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
  if (to === "string?") return from === "string" || from === "null";
  if (to === "u32") return from === "i32";
  return false;
}

/** bytes, bytes? or null (bytes with a null on the other side). */
export const isBytesLike = (t: ExprTy) =>
  t === "bytes" || t === "bytes?" || t === "null";
/** string, string? or null. */
export const isStringLike = (t: ExprTy) =>
  t === "string" || t === "string?" || t === "null";

export function typeOfLiteral(lit: Literal): ExprTy {
  if ("hex" in lit || "ascii" in lit || "concat" in lit) return "bytes";
  if ("str" in lit) return "string";
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
  if ("let" in e) {
    const vars = new Map(env.vars);
    let ok = true;
    e.let.forEach((b, i) => {
      const bat = `${at}.let[${i}]`;
      const t = typeOf(b.value, { ...env, vars }, `${bat}.value`, errors);
      if (vars.has(b.name) || env.fns.has(b.name)) {
        errors.push(`${bat}: "${b.name}" shadows a name already in scope`);
        ok = false;
      } else if (t === "null") {
        errors.push(`${bat}: a bare null has no type to bind`);
        ok = false;
      } else if (t === null) ok = false;
      else vars.set(b.name, t);
    });
    const t = typeOf(e.in, { ...env, vars }, `${at}.in`, errors);
    return ok ? t : null;
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
    case "isNull":
    case "notNull":
      if (!want(1)) return null;
      if (ts[0] !== "bytes?" && ts[0] !== "string?") {
        errors.push(`${at}: ${e.op} wants bytes? or string?, got ${ts[0]}`);
        return null;
      }
      if (e.op !== "unwrap") return "bool";
      return ts[0] === "bytes?" ? "bytes" : "string";
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
        (isStringLike(a) &&
          isStringLike(b) &&
          !(a === "null" && b === "null")) ||
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
    case "strLen":
      return want(1) && expect(0, "string") ? "i32" : null;
    case "strConcat":
      return want(2) && expect(0, "string") && expect(1, "string")
        ? "string"
        : null;
    case "lower":
    case "upper":
      return want(1) && expect(0, "string") ? "string" : null;
    case "utf8":
      return want(1) && expect(0, "string") ? "bytes" : null;
    case "ascii":
      return want(1) && expect(0, "bytes") ? "string?" : null;
    case "charAt":
      return want(2) && expect(0, "string") && expect(1, "i32")
        ? "string"
        : null;
  }
}

/** Collect every call target in an expression. */
export function callsIn(e: Expr, out: Set<string> = new Set()): Set<string> {
  if ("let" in e) {
    for (const b of e.let) callsIn(b.value, out);
    callsIn(e.in, out);
  } else if ("call" in e) {
    out.add(e.call);
    for (const a of e.args) callsIn(a, out);
  } else if ("op" in e) {
    for (const a of e.args) callsIn(a, out);
  }
  return out;
}
