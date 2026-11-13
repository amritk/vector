// The RFC contract: what an RFC requires of a function, in a form that can be
// checked against the RFC text (fidelity), against itself (coverage, typing,
// non-vacuity), and finally against an implementation (a generated nish test).
//
// The shape is deliberately small. A contract has three parts:
//
//   requirements  verbatim quotes from the RFC, each tied to a section and a
//                 BCP 14 level. These are the *claims*; nothing else may be
//                 invented.
//   functions     the signatures of the implementation under test, in the
//                 neutral type vocabulary of vocab.ts (bytes, string, bool,
//                 f64, secret-bytes, i8 … u64, each also as `T?`).
//   clauses       the *evidence*: known-answer vectors copied from the RFC, and
//                 properties quantified over a typed domain. Every clause
//                 cites the requirements it checks, and every MUST is cited.

import {
  INT_RANGE,
  INT_TYPES,
  type IntType,
  LANGUAGES,
  type ModuleOverrides,
  type NameOverrides,
  type SigType,
  SIG_TYPES as VOCAB_SIG_TYPES,
  baseOf,
  isOptional,
} from "./vocab.ts";

/**
 * The types a function's parameters and result may have (vocab.ts SIG_TYPES):
 * each base type `B` and `B?`. `secret-bytes` is bytes whose value is secret;
 * a language may wrap it in its own secret type (the Nish test wraps an
 * argument with `secret` and reads a result with `expose`), but in the
 * contract a secret is its bytes.
 */
export const SIG_TYPES = VOCAB_SIG_TYPES;
export type SigTy = SigType;

/** The types a value has in the contract: every SigTy but the secret ones. */
export type ValueTy = Exclude<SigTy, "secret-bytes" | "secret-bytes?">;

/** What a parameter or result of type `t` is in the contract. */
export const valueTy = (t: SigTy): ValueTy =>
  t === "secret-bytes" ? "bytes" : t === "secret-bytes?" ? "bytes?" : t;

export { INT_RANGE, INT_TYPES, type IntType };

/** Whether `t` is one of the fixed-width integers. */
export const isIntTy = (t: unknown): t is IntType =>
  (INT_TYPES as readonly unknown[]).includes(t);

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
  type: SigTy;
  /** Per-language overrides of the parameter's name. */
  names?: NameOverrides;
}

export interface FnSig {
  name: string;
  params: Param[];
  returns: SigTy;
  /** The module that exports it, when not the contract's target (a reference function). */
  module?: string;
  /** Per-language overrides of the function's name. */
  names?: NameOverrides;
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
 * `str` is a string value (`ascii` is bytes); both are checked as text, as a
 * whole printed value (quoted, a whole line, or ending a line after = or :).
 * Bytes must be a whole printed value too, and one the RFC prints under a
 * name ("Key = 00:01:…", a dump under "Ciphertext:") must give that name as
 * `label`. An `int` is checked only next to its `label`, the name the RFC
 * prints it under ("L = 42"); without one it is unchecked, and the report
 * says so. An `int` beyond ±(2^53−1) is a decimal string (RFC 7493 §2.2);
 * an `f64` is decimal text read with roundTiesToEven (IEEE 754-2019
 * §5.12.2), and `bits`, when given, is the binary64 encoding it must read
 * to, as 16 lowercase hex digits. A label printed more than once in the cited section is read in
 * rounds: the k-th printing of each label belongs to one test case.
 */
export type Literal =
  | { hex: string; repeat?: number; label?: string; unchecked?: string }
  | { ascii: string; label?: string; unchecked?: string }
  | { str: string; unchecked?: string }
  | { int: number | string; label?: string; unchecked?: string }
  | { f64: string; bits?: string; label?: string; unchecked?: string }
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
  "xor",
  "bitAnd",
  "bitOr",
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
  | { name: string; type: IntType; min: number | string; max: number | string }
  | { name: string; type: "f64"; min: string; max: string }
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
  /** How far an f64 result may be from `expect`; without it, bit for bit. */
  tolerance?: Tolerance;
}

/**
 * How far an f64 result may be from the expected value: `abs`, an absolute
 * difference as decimal text, or `ulps`, a count of binary64 units in the
 * last place. `quote` is the spec sentence stating it, in `section`.
 */
export type Tolerance = (
  | { abs: string; ulps?: undefined }
  | { ulps: number; abs?: undefined }
) & { source?: string; section: string; quote: string };

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
  /** The file read for it, as sourceLabel names it, like rfcs/rfc4648.txt. */
  file?: string;
  /** The sha256 of that file's bytes. */
  sha256?: string;
}

export interface RfcContract {
  contract: string;
  /**
   * `rfc`: a single-RFC contract, whose main source is that RFC; `sources`
   * may add others, or declare rfc<N> itself to record its file. Or `main`
   * with `sources`: `main` names the source the completeness gate reads, and
   * `rfc` is given on the source's own entry.
   */
  /**
   * `sha256`: the hex sha256 of the main source file's bytes, which
   * `vector spec frozen` checks against the file on disk.
   */
  source: { title: string; rfc?: number; main?: string; sha256?: string };
  sources?: SourceDecl[];
  /** The module under test, as the generated test imports it ("nish/crypto/hkdf"). */
  target: { module: string; modules?: ModuleOverrides };
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

/**
 * A nish module's file from the nish root: `nish/crypto/hkdf` →
 * `std/crypto/hkdf.ts`; undefined for any other module.
 */
export function nishModuleFile(module: string): string | undefined {
  const m = module.match(/^nish\/([\w./-]+)$/);
  if (!m || m[1].split("/").some((p) => p === "" || p === "." || p === ".."))
    return undefined;
  return `std/${m[1]}.ts`;
}

export const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Names the generated nish test defines, imports or binds around a call (its
 * helpers, `main`, the Suite, nish:secret, the locals of a clause and of a
 * secret wrapper), and the prefixes it puts on names: a contract function
 * named one of these would be shadowed by it, or clash with it, and the test
 * would not compile. emit-nish.test pins this against the helpers it emits.
 */
export const TEST_NAMES = new Set([
  "hexOf",
  "hexOrNull",
  "unhex",
  "nibble",
  "bytesEq",
  "isNullBytes",
  "concatBytes",
  "sliceBytes",
  "fillBytes",
  "flipBit",
  "bitwiseBytes",
  "remI32",
  "remI64",
  "remU8",
  "remU16",
  "remU32",
  "remU64",
  "eqF64Bits",
  "nearUlpsF64",
  "le64",
  "strEq",
  "isNullStr",
  "strOrNull",
  "shiftCase",
  "utf8Bytes",
  "asciiOrNull",
  "charAtStr",
  "copyBytes",
  "Unwrap",
  "unwrapStr",
  "main",
  "Suite",
  "Secret",
  "expose",
  "secret",
  "wipe",
  "t",
  "i",
  "u",
  "r",
  "out",
  "holds",
  "why",
  "ran",
  "code",
  "nonce",
  "process",
  "console",
  "toI32",
  "toI64",
  "toU8",
  "toU16",
  "toU32",
  "toU64",
  "toF64",
  "f64ToBits",
  "bitsToF64",
]);
export const TEST_PREFIXES = ["plain_", "clause_", "table_", "v_", "a_", "s_"];
export const SECTION_RE = /^(?:\d+(?:\.\d+)*|[A-Z](?:\.\d+)*)$/;
export const MAX_BYTES_LEN = 4096;

/** The contract's sources and its main one; a single-RFC contract has one. */
export function declaredSources(c: RfcContract): {
  main: string;
  list: SourceDecl[];
} {
  if (c.source.main !== undefined)
    return { main: c.source.main, list: c.sources as SourceDecl[] };
  const id = `rfc${c.source.rfc}`;
  const list = c.sources ?? [];
  return {
    main: id,
    list: list.some((d) => d.id === id)
      ? list
      : [{ id, rfc: c.source.rfc }, ...list],
  };
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
export const isLiteral = (e: Expr): e is Literal =>
  "hex" in e ||
  "ascii" in e ||
  "str" in e ||
  "int" in e ||
  "f64" in e ||
  "bool" in e ||
  "null" in e ||
  "concat" in e;

/** The largest integer a JSON number carries exactly: 2^53−1 (RFC 7493 §2.2). */
export const JSON_SAFE_MAX = 9007199254740991n;

/** An int literal's (or bound's) exact value: a JSON integer or a decimal string. */
export const intValue = (v: number | string): bigint => BigInt(v);

/** An exact int in its JSON form: a number within ±(2^53−1), else a decimal string (RFC 7493 §2.2). */
export const intJson = (n: bigint): number | string =>
  n <= JSON_SAFE_MAX && n >= -JSON_SAFE_MAX ? Number(n) : n.toString();

/** `ty` when it is an integer type, or an optional one, read as its base. */
export const intBase = (ty: string | null | undefined): IntType | null => {
  if (!ty || ty === "null") return null;
  const b = baseOf(ty as SigType);
  return isIntTy(b) ? b : null;
};

/** Whether `v` lies in `ty`'s range (vocab.ts INT_RANGE), compared exactly. */
export const fitsInt = (v: number | string | bigint, ty: IntType): boolean => {
  const n = typeof v === "bigint" ? v : intValue(v);
  return n >= INT_RANGE[ty].min && n <= INT_RANGE[ty].max;
};

/**
 * An f64 literal's text as a binary64: a decimal goes to the nearest double,
 * ties to even (IEEE 754-2019 §5.12.2; ECMAScript's StringToNumber rounds the
 * same way), and NaN, Infinity, -Infinity are themselves.
 */
export const parseF64 = (text: string): number => Number(text);

/** The binary64 encoding of `x` (IEEE 754-2019 §3.4), as 16 lowercase hex digits. */
export function f64Bits(x: number): string {
  const v = new DataView(new ArrayBuffer(8));
  v.setFloat64(0, x);
  return v.getBigUint64(0).toString(16).padStart(16, "0");
}

/** The binary64 whose encoding is `bits` (16 hex digits). */
export function f64FromBits(bits: string): number {
  const v = new DataView(new ArrayBuffer(8));
  v.setBigUint64(0, BigInt(`0x${bits}`));
  return v.getFloat64(0);
}

/** The binary64 an f64 literal denotes: its `bits` when given, else its text. */
export const f64Value = (lit: { f64: string; bits?: string }): number =>
  lit.bits !== undefined ? f64FromBits(lit.bits) : parseF64(lit.f64);

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
  allowed: readonly string[],
  at: string,
  errors: string[],
): void {
  for (const k of Object.keys(o)) {
    if (!allowed.includes(k)) errors.push(`${at}: unknown field "${k}"`);
  }
}

function checkLabel(
  v: Record<string, unknown>,
  at: string,
  errors: string[],
): void {
  if (
    v.label !== undefined &&
    (typeof v.label !== "string" || !/[A-Za-z]/.test(v.label))
  ) {
    errors.push(
      `${at}.label: the name the RFC prints the value under, with a letter`,
    );
  }
}

/** A decimal string for an int, as the schema's intValue admits it. */
const INT_STRING_RE = /^-?[1-9][0-9]{15,}$/;
const INT_VALUE_WANT =
  "an integer within ±(2^53−1), or a decimal string for one beyond it (RFC 7493 §2.2)";

/**
 * An intValue: a JSON integer within ±(2^53−1), or a decimal string for a
 * value beyond it. A string a JSON integer could carry is refused, so each
 * value has one spelling (RFC 7493 §2.2).
 */
function shapeIntValue(v: unknown, at: string, errors: string[]): void {
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) errors.push(`${at}: ${INT_VALUE_WANT}`);
  } else if (typeof v !== "string" || !INT_STRING_RE.test(v))
    errors.push(`${at}: ${INT_VALUE_WANT}`);
  else if (BigInt(v) <= JSON_SAFE_MAX && BigInt(v) >= -JSON_SAFE_MAX)
    errors.push(
      `${at}: "${v}" fits in ±(2^53−1), so it is written as a JSON integer, not a string (RFC 7493 §2.2)`,
    );
}

/** The schema's f64Text: a JSON-style decimal, or NaN, Infinity, -Infinity. */
const F64_TEXT_RE =
  /^(?:-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|NaN|Infinity|-Infinity)$/;
const F64_TEXT_WANT =
  "decimal text (RFC 8259 §6 number syntax), NaN, Infinity or -Infinity";
export const isF64Text = (v: unknown): v is string =>
  typeof v === "string" && F64_TEXT_RE.test(v);
/** Decimal text past binary64's largest finite value, which rounds to an
 * infinity (IEEE 754-2019 §7.4): write Infinity when an infinity is meant. */
const overflows = (t: string): boolean =>
  /^-?[0-9]/.test(t) && !Number.isFinite(Number(t));
const OVERFLOW_WANT =
  "is past binary64's largest finite value and rounds to an infinity (IEEE 754-2019 §7.4); write Infinity or -Infinity if that is meant";
const F64_BITS_RE = /^[0-9a-f]{16}$/;
const F64_BITS_WANT =
  "the binary64 encoding as 16 lowercase hex digits (IEEE 754-2019 §3.4)";
/** The schema's tolerance `abs`: a non-negative decimal. */
const ABS_RE = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;

function shapeLiteral(v: unknown, at: string, errors: string[]): void {
  if (!isObj(v)) {
    errors.push(`${at}: expected a literal object`);
    return;
  }
  if ("hex" in v) {
    checkKeys(v, ["hex", "repeat", "label", "unchecked"], at, errors);
    checkLabel(v, at, errors);
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
    checkKeys(v, ["ascii", "label", "unchecked"], at, errors);
    checkLabel(v, at, errors);
    if (typeof v.ascii !== "string") errors.push(`${at}.ascii: a string`);
  } else if ("str" in v) {
    checkKeys(v, ["str", "unchecked"], at, errors);
    if (typeof v.str !== "string" || !STRING_CHAR_RE.test(v.str)) {
      errors.push(`${at}.str: a string of printable ASCII, tab, LF or CR`);
    }
  } else if ("int" in v) {
    checkKeys(v, ["int", "label", "unchecked"], at, errors);
    checkLabel(v, at, errors);
    shapeIntValue(v.int, `${at}.int`, errors);
  } else if ("f64" in v) {
    checkKeys(v, ["f64", "bits", "label", "unchecked"], at, errors);
    checkLabel(v, at, errors);
    if (!isF64Text(v.f64)) errors.push(`${at}.f64: ${F64_TEXT_WANT}`);
    else if (overflows(v.f64))
      errors.push(`${at}.f64: "${v.f64}" ${OVERFLOW_WANT}`);
    else if (v.bits !== undefined) {
      if (typeof v.bits !== "string" || !F64_BITS_RE.test(v.bits))
        errors.push(`${at}.bits: ${F64_BITS_WANT}`);
      else if (
        !Number.isNaN(parseF64(v.f64)) &&
        f64Bits(parseF64(v.f64)) !== v.bits
      )
        errors.push(
          `${at}.bits: ${v.f64} reads as ${f64Bits(parseF64(v.f64))} (roundTiesToEven, IEEE 754-2019 §5.12.2), not ${v.bits}`,
        );
      else if (
        Number.isNaN(parseF64(v.f64)) &&
        !Number.isNaN(f64FromBits(v.bits))
      )
        errors.push(`${at}.bits: ${v.bits} is not a NaN encoding`);
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
      `${at}: not a literal (hex, ascii, str, int, f64, bool, null, concat)`,
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

/*
 * Free text in a contract is copied into comments in the generated test,
 * where a line break would end the comment and let the rest of the field run
 * as code; so it must be one line, without control characters.
 */
const isControl = (cp: number) =>
  cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || cp === 0x2028 || cp === 0x2029;

/**
 * The first control character in `s` (C0, DEL, C1, or a Unicode line or
 * paragraph separator), as "U+000A"; undefined when there is none.
 */
export function controlChar(s: string): string | undefined {
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (isControl(cp))
      return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
  }
  return undefined;
}

/** `s` with each control character replaced by a space. */
export const withoutControlChars = (s: string) =>
  [...s].map((ch) => (isControl(ch.codePointAt(0) ?? 0) ? " " : ch)).join("");

const strField = (o: Obj, k: string, at: string, errors: string[]) => {
  const v = o[k];
  if (typeof v !== "string" || v.trim() === "") {
    errors.push(`${at}.${k}: a non-empty string`);
  } else {
    const ch = controlChar(v);
    if (ch)
      errors.push(
        `${at}.${k}: one line of text, without control characters (found ${ch}); it is copied into comments in the generated test`,
      );
  }
};

/** Structural validation. Empty means the input has the RfcContract shape. */
/**
 * A neutral module path `<root>/<segment>/…`: lowercase segments split by
 * `/`, as the segments of a URI path (RFC 3986 §3.3). Each emitter maps it to
 * its own language's module form.
 */
export const MODULE_RE = /^[a-z][a-z0-9_]*(?:\/[a-z][a-z0-9_]*)+$/;

function shapeModule(v: unknown, at: string, errors: string[]): void {
  if (typeof v !== "string" || !MODULE_RE.test(v))
    errors.push(
      `${at}: a module path <root>/<segment>/…, lowercase [a-z][a-z0-9_]* segments (RFC 3986 §3.3)`,
    );
}

/** A per-language override map: each key a language, each value non-empty. */
function shapeOverrides(v: unknown, at: string, errors: string[]): void {
  if (v === undefined) return;
  if (!isObj(v)) {
    errors.push(`${at}: an object keyed by language`);
    return;
  }
  checkKeys(v, LANGUAGES, at, errors);
  for (const [k, x] of Object.entries(v))
    if (typeof x !== "string" || x === "")
      errors.push(`${at}.${k}: a non-empty string`);
}

function shapeTolerance(
  v: unknown,
  at: string,
  sourceRef: (v: unknown, at: string) => void,
  errors: string[],
): void {
  if (!isObj(v) || "abs" in v === "ulps" in v) {
    errors.push(`${at}: an object with one of "abs" or "ulps"`);
    return;
  }
  const kind = "abs" in v ? "abs" : "ulps";
  checkKeys(v, [kind, "source", "section", "quote"], at, errors);
  if (kind === "abs" && !(typeof v.abs === "string" && ABS_RE.test(v.abs)))
    errors.push(`${at}.abs: a non-negative decimal as text`);
  if (kind === "ulps" && !(Number.isInteger(v.ulps) && (v.ulps as number) >= 0))
    errors.push(`${at}.ulps: an integer >= 0`);
  sourceRef(v.source, `${at}.source`);
  if (typeof v.section !== "string" || !SECTION_RE.test(v.section))
    errors.push(`${at}.section: a section number`);
  strField(v, "quote", at, errors);
}

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
  else {
    checkKeys(input.target, ["module", "modules"], "contract.target", errors);
    shapeModule(input.target.module, "contract.target.module", errors);
    shapeOverrides(input.target.modules, "contract.target.modules", errors);
  }

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
      checkKeys(
        f,
        ["name", "params", "returns", "module", "names"],
        at,
        errors,
      );
      if (f.module !== undefined) shapeModule(f.module, `${at}.module`, errors);
      shapeOverrides(f.names, `${at}.names`, errors);
      if (typeof f.name !== "string" || !IDENT_RE.test(f.name)) {
        errors.push(`${at}.name: an identifier`);
      } else {
        const name = f.name;
        if (
          TEST_NAMES.has(name) ||
          TEST_PREFIXES.some((x) => name.startsWith(x))
        )
          errors.push(
            `${at}.name: "${name}" is a name the generated test uses itself (its helpers and locals, and names starting ${TEST_PREFIXES.join(" ")}), so the test cannot call such a function`,
          );
      }
      if (!(SIG_TYPES as readonly unknown[]).includes(f.returns)) {
        errors.push(`${at}.returns: one of ${SIG_TYPES.join(" ")}`);
      }
      if (!Array.isArray(f.params)) errors.push(`${at}.params: an array`);
      else {
        f.params.forEach((p, j) => {
          const pat = `${at}.params[${j}]`;
          if (!isObj(p)) {
            errors.push(`${pat}: an object`);
            return;
          }
          checkKeys(p, ["name", "type", "names"], pat, errors);
          if (typeof p.name !== "string" || !IDENT_RE.test(p.name)) {
            errors.push(`${pat}.name: an identifier`);
          }
          shapeOverrides(p.names, `${pat}.names`, errors);
          if (!(SIG_TYPES as readonly unknown[]).includes(p.type)) {
            errors.push(`${pat}.type: one of ${SIG_TYPES.join(" ")}`);
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
            "tolerance",
          ],
          at,
          errors,
        );
        if (c.tolerance !== undefined)
          shapeTolerance(c.tolerance, `${at}.tolerance`, sourceRef, errors);
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
            if (isIntTy(v.type)) {
              checkKeys(v, ["name", "type", "min", "max"], vat, errors);
              const n = errors.length;
              shapeIntValue(v.min, `${vat}.min`, errors);
              shapeIntValue(v.max, `${vat}.max`, errors);
              if (errors.length > n) return;
              const [lo, hi] = [v.min, v.max].map((x) =>
                intValue(x as number | string),
              );
              const r = INT_RANGE[v.type];
              if (lo < r.min || hi > r.max || lo > hi)
                errors.push(
                  `${vat}: ${v.type} needs min <= max, both in ${r.min}..${r.max}`,
                );
            } else if (v.type === "f64") {
              checkKeys(v, ["name", "type", "min", "max"], vat, errors);
              for (const k of ["min", "max"] as const) {
                if (!isF64Text(v[k]) || v[k] === "NaN")
                  errors.push(
                    `${vat}.${k}: ${F64_TEXT_WANT.replace(", NaN", "")} (a bound cannot be NaN: it orders nothing, IEEE 754-2019 §5.11)`,
                  );
                else if (overflows(v[k] as string))
                  errors.push(`${vat}.${k}: "${v[k]}" ${OVERFLOW_WANT}`);
              }
              if (
                isF64Text(v.min) &&
                isF64Text(v.max) &&
                !(parseF64(v.min) <= parseF64(v.max))
              )
                errors.push(`${vat}: f64 needs min <= max`);
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
              errors.push(
                `${vat}.type: an integer type (${INT_TYPES.join(" ")}), "f64", "bytes" or "string"`,
              );
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

/**
 * `allowSurvivors`: lines of the target module whose surviving mutants are
 * accepted, each with a reason and named once.
 */
function shapeAllowSurvivors(input: Obj, errors: string[]): void {
  const target =
    isObj(input.target) && typeof input.target.module === "string"
      ? nishModuleFile(input.target.module)
      : undefined;
  const seen = new Set<string>();
  eachOf(input, "allowSurvivors", errors, (x, at) => {
    checkKeys(x, ["file", "line", "reason"], at, errors);
    strField(x, "file", at, errors);
    strField(x, "reason", at, errors);
    if (!Number.isInteger(x.line) || (x.line as number) < 1)
      errors.push(`${at}.line: a line number >= 1`);
    if (typeof x.file !== "string" || x.file === "") return;
    if (target !== undefined && x.file !== target)
      errors.push(
        `${at}.file: ${x.file} is not the target module's file ${target}`,
      );
    const key = `${x.file}:${x.line}`;
    if (seen.has(key)) errors.push(`${at}: duplicate allowance for ${key}`);
    seen.add(key);
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
  // `rfc` names the main source; `main` names it among `sources` instead.
  const rfcForm = src.rfc !== undefined || input.sources === undefined;
  const mainId =
    rfcForm && Number.isInteger(src.rfc) && (src.rfc as number) >= 1
      ? `rfc${src.rfc}`
      : undefined;
  if (rfcForm) {
    if (mainId === undefined)
      errors.push("contract.source.rfc: the RFC number");
    if (src.main !== undefined) {
      errors.push("contract.source.main: only with contract.sources");
      if (input.sources !== undefined)
        errors.push(
          "contract.source.rfc: with contract.source.main, give the RFC number on its entry there",
        );
    }
  }
  if (input.sources === undefined) {
    if (mainId) ids.add(mainId);
    return ids;
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
    checkKeys(d, ["id", "rfc", "path", "file", "sha256"], at, errors);
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
    } else if (typeof d.path === "string" && d.path.startsWith("/")) {
      errors.push(`${at}.path: a path relative to the contract, not ${d.path}`);
    }
    if (d.rfc === undefined && d.path === undefined) {
      errors.push(`${at}: needs "rfc", "path" or both`);
    }
    if (
      d.file !== undefined &&
      (typeof d.file !== "string" ||
        d.file.includes("\\") ||
        d.file.split("/").some((p) => p === "" || p === "." || p === ".."))
    ) {
      errors.push(
        `${at}.file: a path inside the repo, with / separators, like rfcs/rfc4648.txt`,
      );
    }
    if (
      d.sha256 !== undefined &&
      (typeof d.sha256 !== "string" || !SHA256_RE.test(d.sha256))
    )
      errors.push(`${at}.sha256: 64 lowercase hex digits`);
    if (d.id === mainId && d.rfc !== undefined && d.rfc !== src.rfc)
      errors.push(`${at}.rfc: ${src.rfc}, as contract.source.rfc says`);
  });
  if (mainId) ids.add(mainId);
  else if (!rfcForm && (typeof src.main !== "string" || !ids.has(src.main))) {
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
  if (isOptional(to)) return from === "null" || from === baseOf(to);
  if (to === "u32") return from === "i32";
  return false;
}

/** The type an int literal takes on its own: i32 when it fits, else i64, else u64. */
const intLiteralTy = (v: number | string): IntType | null =>
  fitsInt(v, "i32")
    ? "i32"
    : fitsInt(v, "i64")
      ? "i64"
      : fitsInt(v, "u64")
        ? "u64"
        : null;

/** bytes, bytes? or null (bytes with a null on the other side). */
export const isBytesLike = (t: ExprTy) =>
  t === "bytes" || t === "bytes?" || t === "null";
/** string, string? or null. */
export const isStringLike = (t: ExprTy) =>
  t === "string" || t === "string?" || t === "null";

/** Does `lit` stand for a value of type `ty`? An int must be in `ty`'s range. */
export function literalFits(lit: Literal, ty: ValueTy): boolean {
  if ("int" in lit) {
    const int = intBase(ty);
    return int !== null && fitsInt(lit.int, int);
  }
  return assignable(typeOfLiteral(lit), ty);
}

export function typeOfLiteral(lit: Literal): ExprTy {
  if ("hex" in lit || "ascii" in lit || "concat" in lit) return "bytes";
  if ("str" in lit) return "string";
  if ("int" in lit) return intLiteralTy(lit.int) ?? "i64";
  if ("f64" in lit) return "f64";
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
    if ("int" in e && intLiteralTy(e.int) === null) {
      errors.push(`${at}: int ${e.int} is outside every integer type`);
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
      const want = valueTy(sig.params[i].type);
      const wantInt = intBase(want);
      if (t === null) ok = false;
      else if (isLiteral(a) && "int" in a && wantInt) {
        if (!fitsInt(a.int, wantInt)) {
          ok = false;
          errors.push(
            `${at}.args[${i}]: ${e.call}(${sig.params[i].name}) wants ${want}, and ${a.int} is outside it`,
          );
        }
      } else if (!assignable(t, want)) {
        ok = false;
        errors.push(
          `${at}.args[${i}]: ${e.call}(${sig.params[i].name}) wants ${want}, got ${t}${t === "bytes?" ? ' — wrap it in {"op":"unwrap"}' : ""}`,
        );
      }
    });
    return ok ? valueTy(sig.returns) : null;
  }
  const ts = e.args.map((a, i) => typeOf(a, env, `${at}.args[${i}]`, errors));
  if (ts.some((t) => t === null)) return null;
  // An int literal takes the integer type of the other operand when it fits
  // there, so `x + 1` is a u8 when x is (ISO C11 §6.4.4.1 types a constant
  // by its value; here the context gives the type instead).
  if (ts.length === 2)
    for (const [i, j] of [
      [0, 1],
      [1, 0],
    ]) {
      const a = e.args[i];
      const other = intBase(ts[j]);
      if (isLiteral(a) && "int" in a && other && !isLiteral(e.args[j]))
        if (fitsInt(a.int, other)) ts[i] = other;
        else {
          errors.push(`${at}.args[${i}]: ${a.int} is outside ${other}`);
          return null;
        }
    }
  // Two integers of one type: the first integer operand's (i32 when neither
  // is one), with the error at the operand that differs.
  const sameInt = () => {
    const a = ts.find(isIntTy) ?? "i32";
    const i = ts.findIndex((t) => t !== a);
    if (i < 0) return a;
    errors.push(`${at}.args[${i}]: ${e.op} wants ${a}, got ${ts[i]}`);
    return null;
  };
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
    case "xor":
    case "bitAnd":
    case "bitOr":
      return want(2) && expect(0, "bytes") && expect(1, "bytes")
        ? "bytes"
        : null;
    case "unwrap":
    case "isNull":
    case "notNull":
      if (!want(1)) return null;
      if (!ts[0]?.endsWith("?")) {
        errors.push(`${at}: ${e.op} wants an optional (T?), got ${ts[0]}`);
        return null;
      }
      if (e.op !== "unwrap") return "bool";
      return (ts[0] as string).slice(0, -1) as ValueTy;
    case "+":
    case "-":
    case "*":
    case "%":
      return want(2) ? sameInt() : null;
    case "le64":
      return want(1) && expect(0, "i32") ? "bytes" : null;
    case "<":
    case "<=":
    case ">":
    case ">=":
      return want(2) && sameInt() ? "bool" : null;
    case "==":
    case "!=": {
      if (!want(2)) return null;
      const [a, b] = ts as ExprTy[];
      const same =
        (isBytesLike(a) && isBytesLike(b) && !(a === "null" && b === "null")) ||
        (isStringLike(a) &&
          isStringLike(b) &&
          !(a === "null" && b === "null")) ||
        (a === b && a !== "null") ||
        (a !== "null" && b !== "null" && (a === `${b}?` || b === `${a}?`)) ||
        (a === "null" && b.endsWith("?")) ||
        (b === "null" && a.endsWith("?"));
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
