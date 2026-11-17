/**
 * `spec/contract/types` — the contract model, one class per object of
 * `schemas/rfc-contract.json`. A field the schema makes optional is `null`
 * (or, for a count, -1) when the contract leaves it out, so a contract writes
 * back exactly as it was read. Literals and expressions are each one class
 * with a kind, since their forms share most fields.
 */

/** Which key opens a literal. */
export enum LitKind {
  /** Opened by `hex`: bytes as hex digits. */
  Hex = 0,
  /** Opened by `ascii`: printable ASCII text. */
  Ascii = 1,
  /** Opened by `str`: a text string. */
  Str = 2,
  /** Opened by `int`: an integer. */
  Int = 3,
  /** Opened by `f64`: a binary64 value. */
  F64 = 4,
  /** Opened by `bool`: true or false. */
  Bool = 5,
  /** Opened by `null`: the absent value. */
  Null = 6,
  /** Opened by `concat`: the parts joined. */
  Concat = 7,
  /** Opened by `words16`: 16-bit words as printed, 4 hex digits each. */
  Words16 = 8,
  /** Opened by `words32`: 32-bit words as printed, 8 hex digits each. */
  Words32 = 9,
  /** Opened by `words64`: 64-bit words as printed, 16 hex digits each. */
  Words64 = 10,
}

/** A literal value: bytes, words, text, a number, a boolean, null, or a concatenation. */
export class Literal {
  /** Which key opened the literal. */
  kind: LitKind
  /** The hex digits, the ascii or str text, the int's decimal text, or the f64's text. */
  text: string
  /** A hex literal's repeat count; -1 when absent. */
  repeat: i32 = -1
  /** The name the source prints the value under. */
  label: string | null = null
  /** Why the value is not checked against its source. */
  unchecked: string | null = null
  /** An f64's binary64 encoding as 16 hex digits. */
  bits: string | null = null
  /** A bool literal's value. */
  flag: boolean
  /** An int written as a JSON string rather than a number. */
  quoted: boolean
  /** A concat literal's parts. */
  parts: Literal[]
  /** A word array's words, each as printed (`0x` and all). */
  words: string[]
  /**
   * Makes a literal of one form.
   *
   * @param kind the key that opens the literal
   * @param text its value as text, or "" for bool, null and concat
   */
  constructor(kind: LitKind, text: string) {
    this.flag = false
    this.quoted = false
    this.kind = kind
    this.text = text
    this.parts = []
    this.words = []
  }
}

/** Which form an expression takes. */
export enum ExprKind {
  /** A literal. */
  Lit = 0,
  /** A variable of the clause. */
  Var = 1,
  /** A call of a function. */
  Call = 2,
  /** An operator applied to arguments. */
  Op = 3,
  /** A let: bindings and a body. */
  Let = 4,
}

/** One `{name, value}` binding of a let. */
export class LetBinding {
  /** The name the let binds. */
  name: string
  /** The expression the name stands for. */
  value: Expr
  /**
   * Binds a name to an expression.
   *
   * @param name the name bound
   * @param value the expression it is bound to
   */
  constructor(name: string, value: Expr) {
    this.name = name
    this.value = value
  }
}

/** An expression of a property clause: a literal, a variable, a call, an operator, or a let. */
export class Expr {
  /** Which form the expression takes. */
  kind: ExprKind
  /** A literal expression's literal. */
  lit: Literal | null = null
  /** The variable, function or operator named. */
  name: string
  /** A call's or an operator's arguments. */
  args: Expr[]
  /** A let's bindings. */
  binds: LetBinding[]
  /** A let's body. */
  body: Expr | null = null
  /**
   * Makes an expression of one form.
   *
   * @param kind the expression's form
   * @param name the variable, function or operator it names, or ""
   */
  constructor(kind: ExprKind, name: string) {
    this.kind = kind
    this.name = name
    this.args = []
    this.binds = []
  }
}

/** A per-language override of a module path or a name. */
export class NameOverride {
  /** The language the override is for. */
  language: string
  /** The module path or name that language uses. */
  value: string
  /**
   * Overrides a module path or name for one language.
   *
   * @param language a language from vocabLanguages
   * @param value the module path or name in that language
   */
  constructor(language: string, value: string) {
    this.language = language
    this.value = value
  }
}

/** The contract's `source`: its title and its main source. */
export class ContractSource {
  /** The main source's title. */
  title: string
  /** The main RFC's number; -1 when absent. */
  rfc: i32 = -1
  /** The id of the main entry of `sources`; null when `rfc` is given. */
  main: string | null = null
  /** The sha256 of the main source file, which every load of the sources checks. */
  sha256: string | null = null
  /** Starts with no title or main source. */
  constructor() {
    this.title = ""
  }
}

/** A document the contract cites: an RFC by number, a file, or both. */
export class SourceDecl {
  /** The id citations use to name this source. */
  id: string
  /** The RFC's number; -1 when absent. */
  rfc: i32 = -1
  /** Relative to the contract's directory. */
  path: string | null = null
  /** The file read for it from the repository root, like rfcs/rfc4648.txt. */
  file: string | null = null
  /** The sha256 of the file read, which `spec check` and `spec frozen` compare. */
  sha256: string | null = null
  /** Starts with no id or file. */
  constructor() {
    this.id = ""
  }
}

/** The module under test. */
export class Target {
  /** The module path, neutral across languages. */
  module: string
  /** Per-language overrides of the module path. */
  modules: NameOverride[] | null = null
  /** Starts with no module. */
  constructor() {
    this.module = ""
  }
}

/** A requirement quoted from a source. */
export class Requirement {
  /** A stable id for the requirement. */
  id: string
  /** The id of the cited source; null for the main one. */
  source: string | null = null
  /** The section the quote is from. */
  section: string
  /** The BCP 14 keyword, or DEFINITION. */
  level: string
  /** The sentence, verbatim from the section. */
  quote: string
  /** A remark on how the requirement is read; null when none. */
  note: string | null = null
  /** Starts with no id, section, level or quote. */
  constructor() {
    this.id = ""
    this.section = ""
    this.level = ""
    this.quote = ""
  }
}

/** A sentence of a source the contract leaves untested, and why. */
export class Exclusion {
  /** The id of the cited source; null for the main one. */
  source: string | null = null
  /** The section the sentence is from. */
  section: string
  /** The sentence, verbatim from the section. */
  quote: string
  /** Why the sentence is not tested. */
  reason: string
  /** Starts with no section, quote or reason. */
  constructor() {
    this.section = ""
    this.quote = ""
    this.reason = ""
  }
}

/** A parameter of a function under test. */
export class Param {
  /** The parameter's name. */
  name: string
  /** The parameter's type, like `bytes` or `u32`. */
  type: string
  /** Per-language overrides of the name. */
  names: NameOverride[] | null = null
  /** Starts with no name or type. */
  constructor() {
    this.name = ""
    this.type = ""
  }
}

/** A function under test: its name and signature. */
export class FnSig {
  /** The function's name. */
  name: string
  /** The module it lives in, for a reference function from another module; null otherwise. */
  module: string | null = null
  /** Its parameters, in order. */
  params: Param[]
  /** Its result type, like `bytes` or `i32?`. */
  returns: string
  /** Per-language overrides of the name. */
  names: NameOverride[] | null = null
  /** Starts with no name, parameters or result. */
  constructor() {
    this.name = ""
    this.returns = ""
    this.params = []
  }
}

/** A section of a source; the main source when `source` is null. */
export class Citation {
  /** The id of the cited source; null for the main one. */
  source: string | null = null
  /** The section cited. */
  section: string
  /** The one test case of the section the vector is, as `Test Vector #N`; null for the whole section. */
  testCase: string | null = null
  /** Starts with no source or section. */
  constructor() {
    this.section = ""
  }
}

/** Where a vector's expected value comes from. */
export enum VectorSourceKind {
  /** Printed in a source, at a citation. */
  Cite = 0,
  /** Printed by a shell command. */
  Command = 1,
  /** Stated by a section of the main source. */
  Spec = 2,
}

/** A vector's provenance. */
export class VectorSource {
  /** Which provenance it is. */
  kind: VectorSourceKind
  /** A cited vector's citation. */
  cite: Citation | null = null
  /** The command, or the spec's section. */
  text: string
  /**
   * Starts a provenance of one kind, with no text.
   *
   * @param kind which provenance it is
   */
  constructor(kind: VectorSourceKind) {
    this.text = ""
    this.kind = kind
  }
}

/** How far an f64 result may be from the expected value, and the source that allows it. */
export class Tolerance {
  /** True for `ulps`, false for `abs`. */
  isUlps: boolean
  /** An abs tolerance as decimal text. */
  abs: string
  /** An ulps tolerance; -1 when absent. */
  ulps: i64 = -1
  /** The id of the source that allows the tolerance; null for the main one. */
  source: string | null = null
  /** The section that allows it. */
  section: string
  /** The sentence that allows it, verbatim. */
  quote: string
  /** Starts with no bound, section or quote. */
  constructor() {
    this.isUlps = false
    this.abs = ""
    this.section = ""
    this.quote = ""
  }
}

/** A vector that feeds its call its own result: the call runs `count` times, and the last result is the expect. */
export class Iterate {
  /** How many times the call runs, 1..1000000000. */
  count: i64
  /** One name per parameter of the call, each the previous call's argument there. */
  names: string[]
  /** One expression per parameter: a name, or the call on the names (the previous call's result). */
  next: Expr[]
  /** Whether a test runs the vector only when asked. */
  slow: boolean
  /** Starts with no count, names or next. */
  constructor() {
    this.count = -1
    this.names = []
    this.next = []
    this.slow = false
  }
}

/**
 * A vector held to its call's first bytes: the result is at least `bytes`
 * long, and its first `bytes` bytes are the expect.
 */
export class Truncate {
  /** How many leading bytes of the result are compared, at least 1. */
  bytes: i64
  /** The unit the length is written in: "bits" (bytes × 8) or "bytes". */
  unit: string
  /**
   * Holds a vector to its result's first bytes.
   *
   * @param bytes how many leading bytes are compared
   * @param unit "bits" or "bytes", the unit the source writes the length in
   */
  constructor(bytes: i64, unit: string) {
    this.bytes = bytes
    this.unit = unit
  }

  /**
   * The truncation as a report names it, in the unit the spec wrote:
   * `first 128 bits`, or `first 16 bytes`.
   *
   * @returns the words, without brackets
   */
  label(): string {
    return `first ${this.count()} ${this.unit}`
  }

  /**
   * The length in the unit the spec wrote: 128 for 128 bits, 16 for 16 bytes.
   *
   * @returns the count of bits or bytes, as `unit` says
   */
  count(): i64 {
    return this.unit === "bytes" ? this.bytes : this.bytes * 8
  }
}

/** A variable a property quantifies over, and its domain. */
export class ForallVar {
  /** The variable's name. */
  name: string
  /** The variable's type. */
  type: string
  /** An integer's or an f64's bounds as text. */
  min: string
  /** The upper bound as text. */
  max: string
  /** An integer bound written as a JSON string. */
  minQuoted: boolean
  /** Whether max was written as a JSON string. */
  maxQuoted: boolean
  /** Whether min and max are given (integers and f64). */
  hasBounds: boolean
  /** A bytes or string length bound; -1 when absent. */
  minLen: i32 = -1
  /** The longest length; -1 when absent. */
  maxLen: i32 = -1
  /** A string's alphabet: characters and class names. */
  alphabet: string[] | null = null
  /** Starts with no name, type or bounds. */
  constructor() {
    this.name = ""
    this.type = ""
    this.min = ""
    this.max = ""
    this.minQuoted = false
    this.maxQuoted = false
    this.hasBounds = false
  }
}

/** Which kind of clause. */
export enum ClauseKind {
  /** A known-answer test vector. */
  Vector = 0,
  /** A property over a domain. */
  Property = 1,
}

/** A clause: a test vector or a property. */
export class Clause {
  /** Whether it is a vector or a property. */
  kind: ClauseKind
  /** A stable id for the clause. */
  id: string
  /** A short description of what the clause checks. */
  title: string
  /** The ids of the requirements it tests. */
  covers: string[]
  /** A vector's provenance. */
  source: VectorSource | null = null
  /** The main-source section printing a vector's args. */
  section: string | null = null
  /** The function a vector calls. */
  call: string
  /** A vector's arguments. */
  args: Literal[]
  /** A vector's expected result. */
  expect: Literal | null = null
  /** How far an f64 result may be from expect; null when exact. */
  tolerance: Tolerance | null = null
  /** A vector's iteration; null when the call runs once. */
  iterate: Iterate | null = null
  /** How many leading bytes of a vector's result are compared; null when all of it is. */
  truncate: Truncate | null = null
  /** The variables a property quantifies over. */
  forall: ForallVar[]
  /** A property's restriction of its domain; null when none. */
  where: Expr | null = null
  /** The expression a property asserts. */
  assert: Expr | null = null
  /** A property's total samples, boundaries included, 1..256; -1 when absent (the sampler's default). */
  samples: i32 = -1
  /**
   * Starts a clause of one kind, with the rest empty.
   *
   * @param kind a vector or a property
   */
  constructor(kind: ClauseKind) {
    this.id = ""
    this.title = ""
    this.call = ""
    this.kind = kind
    this.covers = []
    this.args = []
    this.forall = []
  }
}

/** An export of the target module the contract does not test, and why. */
export class OutOfScope {
  /** The untested export. */
  name: string
  /** Why it is not tested. */
  reason: string
  /** Starts with no name or reason. */
  constructor() {
    this.name = ""
    this.reason = ""
  }
}

/** A line of the module whose surviving mutants are accepted, and why. */
export class AllowedSurvivor {
  /** The source file, relative to the implementation's root. */
  file: string
  /** The line whose surviving mutants are accepted. */
  line: i64 = -1
  /** Why they are accepted. */
  reason: string
  /** Starts with no file, line or reason. */
  constructor() {
    this.file = ""
    this.reason = ""
  }
}

/** A contract: what a module must do, quoted from its sources, and the clauses that test it. */
export class Contract {
  /** The schema the file declares, when it does; null otherwise. */
  schema: string | null = null
  /** The contract's id. */
  contract: string
  /** The main source. */
  source: ContractSource
  /** The documents cited, by id; null when only `source.rfc` is used. */
  sources: SourceDecl[] | null = null
  /** The module under test. */
  target: Target
  /** The quoted requirements. */
  requirements: Requirement[]
  /** Sentences deliberately not tested. */
  exclusions: Exclusion[] | null = null
  /** The signatures of the functions under test. */
  functions: FnSig[]
  /** The vectors and properties that test the requirements. */
  clauses: Clause[]
  /** Exports deliberately not tested. */
  outOfScope: OutOfScope[] | null = null
  /** Lines whose surviving mutants are accepted. */
  allowSurvivors: AllowedSurvivor[] | null = null
  /** Starts with every part empty. */
  constructor() {
    this.contract = ""
    this.source = new ContractSource()
    this.target = new Target()
    this.requirements = []
    this.functions = []
    this.clauses = []
  }
}

/**
 * Whether a literal kind is a word array.
 *
 * @param kind a literal kind
 * @returns true for Words16, Words32 and Words64
 */
export const typesIsWords = (kind: LitKind): boolean =>
  kind === LitKind.Words16 || kind === LitKind.Words32 || kind === LitKind.Words64

/**
 * The key that opens a word-array literal, which is also its type's name.
 *
 * @param kind a word-array literal kind
 * @returns words16, words32 or words64
 */
export const typesWordsKey = (kind: LitKind): string => {
  if (kind === LitKind.Words16) {
    return "words16"
  }
  return kind === LitKind.Words32 ? "words32" : "words64"
}

/**
 * The word-array literal kind whose words have a number of hex digits.
 *
 * @param digits 4, 8 or 16
 * @returns Words16, Words32 or Words64
 */
export const typesWordsKind = (digits: i32): LitKind => {
  if (digits === 4) {
    return LitKind.Words16
  }
  return digits === 8 ? LitKind.Words32 : LitKind.Words64
}
