/**
 * `verify/lang/read` — reads a program and a spec plan out of parsed JSON,
 * checking their shape against `schemas/program.json` and
 * `schemas/spec-plan.json`. Every shape error is collected, not just the
 * first, so a repair loop can fix them all in one round.
 */

import {
  JSON_VALUE_ARRAY,
  JSON_VALUE_BOOLEAN,
  JSON_VALUE_NUMBER,
  JSON_VALUE_OBJECT,
  JSON_VALUE_STRING,
  JsonDocument,
  JsonValue,
} from "nish/json-value"
import {
  Axiom,
  EXPR_BINOP,
  EXPR_BOOL,
  EXPR_CALL,
  EXPR_ITE,
  EXPR_NUM,
  EXPR_UNOP,
  EXPR_VAR,
  FnUnit,
  LangClause,
  LangExpr,
  LangParam,
  PlanUnit,
  Program,
  SpecPlan,
} from "./ast"

const langUnops = (): string[] => ["not", "neg", "abs", "floor", "ceil"]
const langBinops = (): string[] => [
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
]
const langTys = (): string[] => ["Real", "Int", "Bool"]

const langIsDigit = (c: i32): boolean => c >= 48 && c <= 57

/**
 * Whether text is an identifier, `[A-Za-z_][A-Za-z0-9_]*`.
 *
 * @param s the text
 * @returns true for an identifier
 */
export const langIsIdent = (s: string): boolean => {
  if (s.length === 0) {
    return false
  }
  for (let i = 0; i < toI32(s.length); i++) {
    const c = s.charCodeAt(i)
    const letter = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95
    if (!letter && !(i > 0 && langIsDigit(c))) {
      return false
    }
  }
  return true
}

// `^[A-Za-z][A-Za-z0-9_-]*$`: axiom ids land in emitted source.
const langIsAxiomId = (s: string): boolean => {
  if (s.length === 0) {
    return false
  }
  for (let i = 0; i < toI32(s.length); i++) {
    const c = s.charCodeAt(i)
    const letter = (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
    if (!letter && !(i > 0 && (langIsDigit(c) || c === 95 || c === 45))) {
      return false
    }
  }
  return true
}

// `^-?(0|[1-9]\d*)(\.\d+)?$`
const langIsDecimal = (s: string): boolean => {
  const n = toI32(s.length)
  let i = 0
  if (i < n && s.charCodeAt(i) === 45) {
    i = i + 1
  }
  if (i >= n || !langIsDigit(s.charCodeAt(i))) {
    return false
  }
  if (s.charCodeAt(i) === 48) {
    i = i + 1
  } else {
    while (i < n && langIsDigit(s.charCodeAt(i))) {
      i = i + 1
    }
  }
  // `>=`, not `===`: the scans above never pass n, but the prover needs
  // `i < n` below.
  if (i >= n) {
    return true
  }
  if (s.charCodeAt(i) !== 46) {
    return false
  }
  i = i + 1
  if (i >= n) {
    return false
  }
  while (i < n) {
    if (!langIsDigit(s.charCodeAt(i))) {
      return false
    }
    i = i + 1
  }
  return true
}

// A decimal as sign, significant digits and the exponent of the last digit,
// so "1.50", "1.5" and "15e-1" compare equal. Null only where a bound the
// scans already keep fails (the exponent past the text, the digits' slice),
// which no text reaches; langRoundTrips reads it as a refusal.
const langCanonicalDecimal = (text: string): string | null => {
  let i = 0
  const n = toI32(text.length)
  let sign = ""
  if (i < n && text.charCodeAt(i) === 45) {
    sign = "-"
    i = i + 1
  }
  let digits = ""
  // The digits before the first ".", or -1 with no "."; every digit after
  // it is a fraction digit.
  let intLen = -1
  while (i < n && text.charCodeAt(i) !== 101 && text.charCodeAt(i) !== 69) {
    const c = text.charCodeAt(i)
    if (c === 46) {
      if (intLen < 0) {
        intLen = toI32(digits.length)
      }
    } else {
      digits = `${digits}${text.slice(i, i + 1)}`
    }
    i = i + 1
  }
  const len = toI32(digits.length)
  // The exponent as written, and whether it is negative.
  let e = 0
  let neg = false
  if (i < n) {
    let j = i + 1
    if (j < n && (text.charCodeAt(j) === 43 || text.charCodeAt(j) === 45)) {
      neg = text.charCodeAt(j) === 45
      j = j + 1
    }
    // Unreachable: j steps past i only while it is under n. The prover
    // needs it for the slice.
    if (j > n) {
      return null
    }
    e = parseInt(text.slice(j, n))
  }
  let start = 0
  while (start < len && digits.charCodeAt(start) === 48) {
    start = start + 1
  }
  let end = len
  // `end > 0` follows from `end > start`, but the prover needs it for
  // `end - 1`.
  while (end > start && end > 0 && digits.charCodeAt(end - 1) === 48) {
    end = end - 1
  }
  if (end === start) {
    return "0"
  }
  // Unreachable: both scans stay in 0..len with start <= end. The prover
  // needs it for the slice.
  if (!(start <= end && end <= len)) {
    return null
  }
  // The last kept digit's exponent: the integer digits' count less its own
  // end, plus the written exponent. Three i32 terms always fit an i64.
  const point = intLen >= 0 ? intLen : len
  const exp = neg ? toI64(point) - toI64(end) - toI64(e) : toI64(point) - toI64(end) + toI64(e)
  return `${sign}${digits.slice(start, end)}e${exp}`
}

/**
 * Whether a decimal literal survives a float64 round trip: the double it
 * parses to prints back as the same decimal, up to trailing zeros. `0.1`
 * passes; `1.10000000000000001` does not, since the emitted code would read
 * it as `1.1` while the proof used the exact decimal.
 *
 * @param text a decimal literal
 * @returns true when no significant digit is lost
 */
export const langRoundTrips = (text: string): boolean => {
  const v = parseFloat(text)
  // biome-ignore lint/suspicious/noSelfCompare: Nish has no Number.isFinite; x - x is NaN only for NaN and ±Infinity.
  if (!(v - v === v - v)) {
    return false
  }
  const own = langCanonicalDecimal(text)
  const back = langCanonicalDecimal(`${v}`)
  return own !== null && back !== null && own === back
}

// Reads JSON into the AST, collecting every shape error.
class LangReader {
  doc: JsonDocument
  errors: string[]

  constructor(doc: JsonDocument) {
    this.doc = doc
    this.errors = []
  }

  show(v: JsonValue): string {
    return this.doc.kind(v) === 0 ? "undefined" : this.doc.stringify(v)
  }

  isObject(v: JsonValue): boolean {
    return this.doc.kind(v) === JSON_VALUE_OBJECT
  }

  str(o: JsonValue, key: string): string | null {
    const v = this.doc.get(o, key)
    return this.doc.kind(v) === JSON_VALUE_STRING ? this.doc.string(v) : null
  }

  // Any member of `o` outside `allowed` (the schemas set additionalProperties false).
  extras(o: JsonValue, allowed: string[], where: string): void {
    for (let i = 0; i < this.doc.length(o); i++) {
      const key = this.doc.keyAt(o, i)
      if (allowed.indexOf(key) < 0) {
        this.errors.push(`${where}: unknown property "${key}"`)
      }
    }
  }

  // An integer from 1 to 1000000 written as one (no sign, fraction or
  // exponent), else 0, read from the number's own digits. `0` reads as 0,
  // and parseInt stops at 2147483647 past i32, which is over the bound too.
  layer(o: JsonValue): i32 {
    const v = this.doc.get(o, "layer")
    if (this.doc.kind(v) !== JSON_VALUE_NUMBER) {
      return 0
    }
    const text = this.doc.numberText(v)
    for (let i = 0; i < toI32(text.length); i++) {
      if (!langIsDigit(text.charCodeAt(i))) {
        return 0
      }
    }
    const layer = parseInt(text)
    return layer > 1000000 ? 0 : layer
  }

  expr(v: JsonValue, where: string): LangExpr {
    const bad = new LangExpr(EXPR_BOOL, "", "true", "", [])
    if (!this.isObject(v)) {
      this.errors.push(`${where}: expression must be an object, got ${this.show(v)}`)
      return bad
    }
    const kind = this.str(v, "kind") ?? ""
    if (kind === "num") {
      this.extras(v, ["kind", "value"], where)
      const text = this.str(v, "value")
      if (text === null || !langIsDecimal(text)) {
        this.errors.push(
          `${where}: num.value must be a plain decimal string like "0.91" (no leading zeros, no exponent), got ${this.show(this.doc.get(v, "value"))}`,
        )
        return bad
      }
      if (!langRoundTrips(text)) {
        this.errors.push(
          `${where}: num.value ${text} has more precision than a float64 holds — the emitted code would read it as ${parseFloat(text)}, so the proof (over the exact decimal) and the runtime would disagree. Write it with fewer significant digits.`,
        )
      }
      return new LangExpr(EXPR_NUM, "", text, "", [])
    }
    if (kind === "bool") {
      this.extras(v, ["kind", "value"], where)
      const b = this.doc.get(v, "value")
      if (this.doc.kind(b) !== JSON_VALUE_BOOLEAN) {
        this.errors.push(`${where}: bool.value must be a boolean`)
        return bad
      }
      return new LangExpr(EXPR_BOOL, "", this.doc.boolean(b) ? "true" : "false", "", [])
    }
    if (kind === "var") {
      this.extras(v, ["kind", "name"], where)
      const name = this.str(v, "name")
      if (name === null || !langIsIdent(name)) {
        this.errors.push(`${where}: var.name must be an identifier, got ${this.show(this.doc.get(v, "name"))}`)
        return bad
      }
      return new LangExpr(EXPR_VAR, "", "", name, [])
    }
    if (kind === "unop") {
      this.extras(v, ["kind", "op", "arg"], where)
      const op = this.str(v, "op") ?? ""
      if (langUnops().indexOf(op) < 0) {
        this.errors.push(`${where}: unop.op must be one of ${langUnops().join(", ")}`)
      }
      const arg = this.expr(this.doc.get(v, "arg"), `${where}.arg`)
      return new LangExpr(EXPR_UNOP, op, "", "", [arg])
    }
    if (kind === "binop") {
      this.extras(v, ["kind", "op", "left", "right"], where)
      const op = this.str(v, "op") ?? ""
      if (langBinops().indexOf(op) < 0) {
        this.errors.push(`${where}: binop.op ${this.show(this.doc.get(v, "op"))} is not a known operator`)
      }
      const left = this.expr(this.doc.get(v, "left"), `${where}.left`)
      const right = this.expr(this.doc.get(v, "right"), `${where}.right`)
      return new LangExpr(EXPR_BINOP, op, "", "", [left, right])
    }
    if (kind === "ite") {
      this.extras(v, ["kind", "cond", "then", "else"], where)
      const c = this.expr(this.doc.get(v, "cond"), `${where}.cond`)
      const t = this.expr(this.doc.get(v, "then"), `${where}.then`)
      const e = this.expr(this.doc.get(v, "else"), `${where}.else`)
      return new LangExpr(EXPR_ITE, "", "", "", [c, t, e])
    }
    if (kind === "call") {
      this.extras(v, ["kind", "fn", "args"], where)
      const fn = this.str(v, "fn")
      if (fn === null || !langIsIdent(fn)) {
        this.errors.push(`${where}: call.fn must be an identifier`)
      }
      const args: LangExpr[] = []
      const a = this.doc.get(v, "args")
      if (this.doc.kind(a) !== JSON_VALUE_ARRAY) {
        this.errors.push(`${where}: call.args must be an array`)
      } else {
        for (let i = 0; i < this.doc.length(a); i++) {
          args.push(this.expr(this.doc.at(a, i), `${where}.args[${i}]`))
        }
      }
      return new LangExpr(EXPR_CALL, "", "", fn ?? "", args)
    }
    this.errors.push(`${where}: unknown expression kind ${this.show(this.doc.get(v, "kind"))}`)
    return bad
  }

  clauses(v: JsonValue, where: string, minItems: i32): LangClause[] {
    const out: LangClause[] = []
    if (this.doc.kind(v) !== JSON_VALUE_ARRAY) {
      this.errors.push(`${where}: must be an array`)
      return out
    }
    if (this.doc.length(v) < minItems) {
      this.errors.push(`${where}: must contain at least ${minItems} clause(s)`)
    }
    for (let i = 0; i < this.doc.length(v); i++) {
      const c = this.doc.at(v, i)
      if (!this.isObject(c)) {
        this.errors.push(`${where}[${i}]: clause must be an object`)
        continue
      }
      this.extras(c, ["axiomId", "expr"], `${where}[${i}]`)
      const id = this.str(c, "axiomId")
      if (id === null || !langIsAxiomId(id)) {
        this.errors.push(
          `${where}[${i}]: axiomId must match /^[A-Za-z][A-Za-z0-9_-]*$/ (it is embedded in emitted source), got ${this.show(this.doc.get(c, "axiomId"))}`,
        )
      }
      out.push(new LangClause(id ?? "", this.expr(this.doc.get(c, "expr"), `${where}[${i}].expr`)))
    }
    return out
  }

  params(v: JsonValue, where: string): LangParam[] {
    const out: LangParam[] = []
    if (this.doc.kind(v) !== JSON_VALUE_ARRAY) {
      this.errors.push(`${where}: params must be an array`)
      return out
    }
    for (let i = 0; i < this.doc.length(v); i++) {
      const p = this.doc.at(v, i)
      const name: string | null = this.isObject(p) ? this.str(p, "name") : null
      const ty: string | null = this.isObject(p) ? this.str(p, "type") : null
      if (name === null || ty === null || !langIsIdent(name) || langTys().indexOf(ty) < 0) {
        this.errors.push(
          `${where}[${i}]: param must be { name: identifier, type: Real | Int | Bool }, got ${this.show(p)}`,
        )
        continue
      }
      this.extras(p, ["name", "type"], `${where}[${i}]`)
      out.push(new LangParam(name, ty))
    }
    return out
  }

  // The members a function and a unit share: name, layer, purpose, params, returnType.
  header(o: JsonValue, where: string): void {
    const name = this.str(o, "name")
    if (name === null || !langIsIdent(name)) {
      this.errors.push(`${where}: name must be an identifier`)
    }
    if (this.layer(o) === 0) {
      this.errors.push(`${where}: layer must be an integer from 1 to 1000000`)
    }
    if (this.str(o, "purpose") === null) {
      this.errors.push(`${where}: purpose must be a string`)
    }
    const rt = this.str(o, "returnType")
    if (rt === null || langTys().indexOf(rt) < 0) {
      this.errors.push(`${where}: returnType must be one of ${langTys().join(", ")}`)
    }
  }

  whereOf(o: JsonValue, list: string, i: i32): string {
    const name = this.str(o, "name")
    return name !== null && langIsIdent(name) ? name : `${list}[${i}]`
  }

  program(root: JsonValue): Program {
    if (!this.isObject(root)) {
      this.errors.push(`program must be an object, got ${this.show(root)}`)
      return new Program("")
    }
    this.extras(root, ["programName", "functions"], "program")
    const pname = this.str(root, "programName")
    if (pname === null || !langIsIdent(pname)) {
      this.errors.push("programName must be an identifier")
    }
    const program = new Program(pname ?? "")
    const fns = this.doc.get(root, "functions")
    if (this.doc.kind(fns) !== JSON_VALUE_ARRAY || this.doc.length(fns) < 1) {
      this.errors.push("functions must be a non-empty array")
      return program
    }
    for (let i = 0; i < this.doc.length(fns); i++) {
      const f = this.doc.at(fns, i)
      if (!this.isObject(f)) {
        this.errors.push(`functions[${i}]: must be an object`)
        continue
      }
      const where = this.whereOf(f, "functions", i)
      this.extras(f, ["name", "layer", "purpose", "params", "returnType", "requires", "ensures", "body"], where)
      this.header(f, where)
      const params = this.params(this.doc.get(f, "params"), `${where}/params`)
      const requires = this.clauses(this.doc.get(f, "requires"), `${where}/requires`, 0)
      const ensures = this.clauses(this.doc.get(f, "ensures"), `${where}/ensures`, 1)
      const body = this.expr(this.doc.get(f, "body"), `${where}/body`)
      const fn = new FnUnit(
        this.str(f, "name") ?? "",
        this.layer(f),
        this.str(f, "purpose") ?? "",
        this.str(f, "returnType") ?? "",
        body,
      )
      fn.params = params
      fn.requires = requires
      fn.ensures = ensures
      program.functions.push(fn)
    }
    return program
  }

  specPlan(root: JsonValue): SpecPlan {
    if (!this.isObject(root)) {
      this.errors.push(`spec plan must be an object, got ${this.show(root)}`)
      return new SpecPlan("")
    }
    this.extras(root, ["programName", "axioms", "units"], "spec plan")
    const pname = this.str(root, "programName")
    if (pname === null || !langIsIdent(pname)) {
      this.errors.push("programName must be an identifier")
    }
    const plan = new SpecPlan(pname ?? "")
    const axioms = this.doc.get(root, "axioms")
    if (this.doc.kind(axioms) !== JSON_VALUE_ARRAY || this.doc.length(axioms) < 1) {
      this.errors.push("axioms must be a non-empty array")
    } else {
      const seen: string[] = []
      for (let i = 0; i < this.doc.length(axioms); i++) {
        const a = this.doc.at(axioms, i)
        if (!this.isObject(a)) {
          this.errors.push(`axioms[${i}]: must be an object`)
          continue
        }
        this.extras(a, ["id", "kind", "statement"], `axioms[${i}]`)
        const id = this.str(a, "id")
        if (id === null || !langIsAxiomId(id)) {
          this.errors.push(
            `axioms[${i}]: id must match /^[A-Za-z][A-Za-z0-9_-]*$/ (ids are embedded in emitted source), got ${this.show(this.doc.get(a, "id"))}`,
          )
        } else if (seen.indexOf(id) >= 0) {
          this.errors.push(`axioms[${i}]: duplicate axiom id "${id}"`)
        } else {
          seen.push(id)
        }
        const kind = this.str(a, "kind") ?? ""
        if (kind !== "pre" && kind !== "post") {
          this.errors.push(`axioms[${i}]: kind must be "pre" or "post", got ${this.show(this.doc.get(a, "kind"))}`)
        }
        const statement = this.str(a, "statement")
        if (statement === null || statement.length === 0) {
          this.errors.push(`axioms[${i}]: statement must be a non-empty string`)
        }
        plan.axioms.push(new Axiom(id ?? "", kind, statement ?? ""))
      }
    }
    const units = this.doc.get(root, "units")
    if (this.doc.kind(units) !== JSON_VALUE_ARRAY) {
      this.errors.push("units must be an array of 1-4 entries")
      return plan
    }
    // Too many or too few units is one error; each unit is still read, so a
    // repair sees every problem at once.
    if (this.doc.length(units) < 1 || this.doc.length(units) > 4) {
      this.errors.push(`units must be an array of 1-4 entries, got ${this.doc.length(units)}`)
    }
    for (let i = 0; i < this.doc.length(units); i++) {
      const u = this.doc.at(units, i)
      if (!this.isObject(u)) {
        this.errors.push(`units[${i}]: must be an object`)
        continue
      }
      const where = this.whereOf(u, "units", i)
      this.extras(u, ["name", "layer", "purpose", "params", "returnType", "relevantAxiomIds"], where)
      this.header(u, where)
      const unit = new PlanUnit(this.str(u, "name") ?? "", this.layer(u), this.str(u, "returnType") ?? "")
      unit.params = this.params(this.doc.get(u, "params"), `${where}/params`)
      const ids = this.doc.get(u, "relevantAxiomIds")
      let ok = this.doc.kind(ids) === JSON_VALUE_ARRAY
      if (ok) {
        for (let j = 0; j < this.doc.length(ids); j++) {
          const id = this.doc.at(ids, j)
          if (this.doc.kind(id) !== JSON_VALUE_STRING) {
            ok = false
          } else {
            unit.relevantAxiomIds.push(this.doc.string(id))
          }
        }
      }
      if (!ok) {
        this.errors.push(`${where}: relevantAxiomIds must be an array of strings`)
      }
      plan.units.push(unit)
    }
    return plan
  }
}

/**
 * Reads a program out of a parsed JSON value, checking its shape.
 *
 * @param doc the document the value belongs to
 * @param root the program's JSON value
 * @param errors where every shape error is appended
 * @returns the program as read; meaningful only when no error was appended
 */
export const readProgram = (doc: JsonDocument, root: JsonValue, errors: string[]): Program => {
  const r = new LangReader(doc)
  const program = r.program(root)
  for (const e of r.errors) {
    errors.push(e)
  }
  return program
}

/**
 * Reads a spec plan out of a parsed JSON value, checking its shape.
 *
 * @param doc the document the value belongs to
 * @param root the spec plan's JSON value
 * @param errors where every shape error is appended
 * @returns the spec plan as read; meaningful only when no error was appended
 */
export const readSpecPlan = (doc: JsonDocument, root: JsonValue, errors: string[]): SpecPlan => {
  const r = new LangReader(doc)
  const plan = r.specPlan(root)
  for (const e of r.errors) {
    errors.push(e)
  }
  return plan
}
