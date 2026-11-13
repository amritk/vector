/**
 * `spec/contract/types` — the contract model, one class per object of
 * `schemas/rfc-contract.json`. A field the schema makes optional is `null`
 * (or, for a count, -1) when the contract leaves it out, so a contract writes
 * back exactly as it was read. Literals and expressions are each one class
 * with a kind, since their forms share most fields.
 */

/** Which key opens a literal. */
export enum LitKind {
  Hex = 0,
  Ascii = 1,
  Str = 2,
  Int = 3,
  F64 = 4,
  Bool = 5,
  Null = 6,
  Concat = 7,
}

/** A literal value: bytes, text, a number, a boolean, null, or a concatenation. */
export class Literal {
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
  /**
   * @param kind the key that opens the literal
   * @param text its value as text, or "" for bool, null and concat
   */
  constructor(kind: LitKind, text: string) {
    this.flag = false
    this.quoted = false
    this.kind = kind
    this.text = text
    this.parts = []
  }
}

/** Which form an expression takes. */
export enum ExprKind {
  Lit = 0,
  Var = 1,
  Call = 2,
  Op = 3,
  Let = 4,
}

/** One `{name, value}` binding of a let. */
export class LetBinding {
  name: string
  value: Expr
  /**
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
  language: string
  value: string
  /**
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
  title: string
  /** The main RFC's number; -1 when absent. */
  rfc: i32 = -1
  main: string | null = null
  sha256: string | null = null
  constructor() {
    this.title = ""
  }
}

/** A document the contract cites: an RFC by number, a file, or both. */
export class SourceDecl {
  id: string
  /** The RFC's number; -1 when absent. */
  rfc: i32 = -1
  /** Relative to the contract's directory. */
  path: string | null = null
  /** The file read for it from the repository root, like rfcs/rfc4648.txt. */
  file: string | null = null
  sha256: string | null = null
  constructor() {
    this.id = ""
  }
}

/** The module under test. */
export class Target {
  module: string
  modules: NameOverride[] | null = null
  constructor() {
    this.module = ""
  }
}

/** A requirement quoted from a source. */
export class Requirement {
  id: string
  source: string | null = null
  section: string
  level: string
  quote: string
  note: string | null = null
  constructor() {
    this.id = ""
    this.section = ""
    this.level = ""
    this.quote = ""
  }
}

/** A sentence of a source the contract leaves untested, and why. */
export class Exclusion {
  source: string | null = null
  section: string
  quote: string
  reason: string
  constructor() {
    this.section = ""
    this.quote = ""
    this.reason = ""
  }
}

/** A parameter of a function under test. */
export class Param {
  name: string
  type: string
  names: NameOverride[] | null = null
  constructor() {
    this.name = ""
    this.type = ""
  }
}

/** A function under test: its name and signature. */
export class FnSig {
  name: string
  module: string | null = null
  params: Param[]
  returns: string
  names: NameOverride[] | null = null
  constructor() {
    this.name = ""
    this.returns = ""
    this.params = []
  }
}

/** A section of a source; the main source when `source` is null. */
export class Citation {
  source: string | null = null
  section: string
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
  kind: VectorSourceKind
  /** A cited vector's citation. */
  cite: Citation | null = null
  /** The command, or the spec's section. */
  text: string
  /** @param kind which provenance it is */
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
  source: string | null = null
  section: string
  quote: string
  constructor() {
    this.isUlps = false
    this.abs = ""
    this.section = ""
    this.quote = ""
  }
}

/** A variable a property quantifies over, and its domain. */
export class ForallVar {
  name: string
  type: string
  /** An integer's or an f64's bounds as text. */
  min: string
  max: string
  /** An integer bound written as a JSON string. */
  minQuoted: boolean
  maxQuoted: boolean
  /** Whether min and max are given (integers and f64). */
  hasBounds: boolean
  /** A bytes or string length bound; -1 when absent. */
  minLen: i32 = -1
  maxLen: i32 = -1
  /** A string's alphabet: characters and class names. */
  alphabet: string[] | null = null
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
  Vector = 0,
  Property = 1,
}

/** A clause: a test vector or a property. */
export class Clause {
  kind: ClauseKind
  id: string
  title: string
  covers: string[]
  /** A vector's provenance. */
  source: VectorSource | null = null
  /** The main-source section printing a vector's args. */
  section: string | null = null
  call: string
  args: Literal[]
  expect: Literal | null = null
  tolerance: Tolerance | null = null
  forall: ForallVar[]
  where: Expr | null = null
  assert: Expr | null = null
  /** A property's random samples; -1 when absent. */
  samples: i32 = -1
  /** @param kind a vector or a property */
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
  name: string
  reason: string
  constructor() {
    this.name = ""
    this.reason = ""
  }
}

/** A line of the module whose surviving mutants are accepted, and why. */
export class AllowedSurvivor {
  file: string
  line: i64 = -1
  reason: string
  constructor() {
    this.file = ""
    this.reason = ""
  }
}

/** A contract: what a module must do, quoted from its sources, and the clauses that test it. */
export class Contract {
  schema: string | null = null
  contract: string
  source: ContractSource
  sources: SourceDecl[] | null = null
  target: Target
  requirements: Requirement[]
  exclusions: Exclusion[] | null = null
  functions: FnSig[]
  clauses: Clause[]
  outOfScope: OutOfScope[] | null = null
  allowSurvivors: AllowedSurvivor[] | null = null
  constructor() {
    this.contract = ""
    this.source = new ContractSource()
    this.target = new Target()
    this.requirements = []
    this.functions = []
    this.clauses = []
  }
}
