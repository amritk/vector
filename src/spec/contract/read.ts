/**
 * `spec/contract/read` — a contract's JSON read into the model of
 * `spec/contract/types`. Reading checks the structure: each object is one the
 * schema allows, with no unknown field and every required one, each value of
 * the JSON kind the schema gives, and each number an integer in its one
 * spelling. It reports every such error, each at its path, not just the first.
 * The values themselves (patterns, enums, references) are checked by
 * contractShapeErrors in `spec/contract/shape`.
 */

import {
  JSON_VALUE_ARRAY,
  JSON_VALUE_BOOLEAN,
  JSON_VALUE_NONE,
  JSON_VALUE_NUMBER,
  JSON_VALUE_OBJECT,
  JSON_VALUE_STRING,
  JsonDocument,
  JsonValue,
} from "nish/json-value"
import { newJsonDocument, parseJson } from "../../core/json"
import {
  AllowedSurvivor,
  Citation,
  Clause,
  ClauseKind,
  Contract,
  Exclusion,
  Expr,
  ExprKind,
  FnSig,
  ForallVar,
  Iterate,
  LetBinding,
  LitKind,
  Literal,
  NameOverride,
  OutBuffer,
  OutOfScope,
  Param,
  Requirement,
  SourceDecl,
  Tolerance,
  Truncate,
  VectorSource,
  VectorSourceKind,
} from "./types"
import { vocabHas, vocabIsDecimal, vocabIsIntType, vocabIsJsonSafe, vocabLanguages, vocabLiteralKinds } from "./vocab"

/** What an intValue may be, as the error says it. */
const READ_INT_WANT: string = "an integer within ±(2^53−1), or a decimal string for one beyond it (RFC 7493 §2.2)"

class ContractReader {
  doc: JsonDocument
  errors: string[]
  constructor(doc: JsonDocument) {
    this.doc = doc
    this.errors = []
  }
}

const readFail = (r: ContractReader, at: string, message: string): void => {
  r.errors.push(`${at}: ${message}`)
}

const readIsKind = (r: ContractReader, v: JsonValue, kind: i32): boolean => r.doc.kind(v) === kind

const readHas = (r: ContractReader, o: JsonValue, key: string): boolean =>
  r.doc.kind(r.doc.get(o, key)) !== JSON_VALUE_NONE

/** Checks that `v` is an object with only `allowed` keys; false when it is not an object. */
const readObject = (r: ContractReader, v: JsonValue, at: string, allowed: string[]): boolean => {
  if (!readIsKind(r, v, JSON_VALUE_OBJECT)) {
    readFail(r, at, "an object")
    return false
  }
  const n = r.doc.length(v)
  for (let i = 0; i < n; i++) {
    const k = r.doc.keyAt(v, i)
    if (!vocabHas(allowed, k)) {
      readFail(r, at, `unknown field "${k}"`)
    }
  }
  return true
}

const readString = (r: ContractReader, o: JsonValue, key: string, at: string, required: boolean): string | null => {
  const v = r.doc.get(o, key)
  const kind = r.doc.kind(v)
  if (kind === JSON_VALUE_NONE) {
    if (required) {
      readFail(r, `${at}.${key}`, "missing; a string")
    }
    return null
  }
  if (kind !== JSON_VALUE_STRING) {
    readFail(r, `${at}.${key}`, "a string")
    return null
  }
  return r.doc.string(v)
}

const readRequiredString = (r: ContractReader, o: JsonValue, key: string, at: string): string =>
  readString(r, o, key, at, true) ?? ""

/** A JSON number's integer value, when it is a decimal integer within ±(2^53−1); null otherwise. */
const readSafeInt = (r: ContractReader, v: JsonValue): string | null => {
  if (!readIsKind(r, v, JSON_VALUE_NUMBER)) {
    return null
  }
  const text = r.doc.numberText(v)
  if (!vocabIsDecimal(text) || !vocabIsJsonSafe(text)) {
    return null
  }
  return text
}

const readDecimalI64 = (text: string): i64 => {
  const neg = text.startsWith("-")
  // In u64: the callers pass at most 2^53 - 1, and `0 - n` is its negation.
  let n: u64 = 0
  for (let i = neg ? 1 : 0; i >= 0 && i < text.length; i++) {
    n = n * 10 + toU64(text.charCodeAt(i) - 48)
  }
  return neg ? toI64(0 - n) : toI64(n)
}

/** An integer field in min..max; -1 when it is absent or refused. */
const readCount = (
  r: ContractReader,
  o: JsonValue,
  key: string,
  at: string,
  min: i64,
  max: i64,
  required: boolean,
): i64 => {
  const v = r.doc.get(o, key)
  if (r.doc.kind(v) === JSON_VALUE_NONE) {
    if (required) {
      readFail(r, `${at}.${key}`, `missing; an integer in ${min}..${max}`)
    }
    return -1
  }
  const text = readSafeInt(r, v)
  if (text === null) {
    readFail(r, `${at}.${key}`, `an integer in ${min}..${max}`)
    return -1
  }
  const n = readDecimalI64(text)
  if (n < min || n > max) {
    readFail(r, `${at}.${key}`, `an integer in ${min}..${max}`)
    return -1
  }
  return n
}

/** An array field's elements; null when it is absent or not an array. */
const readArray = (r: ContractReader, o: JsonValue, key: string, at: string, required: boolean): JsonValue[] | null => {
  const v = r.doc.get(o, key)
  const kind = r.doc.kind(v)
  if (kind === JSON_VALUE_NONE) {
    if (required) {
      readFail(r, `${at}.${key}`, "missing; an array")
    }
    return null
  }
  if (kind !== JSON_VALUE_ARRAY) {
    readFail(r, `${at}.${key}`, "an array")
    return null
  }
  const out: JsonValue[] = []
  const n = r.doc.length(v)
  for (let i = 0; i < n; i++) {
    out.push(r.doc.at(v, i))
  }
  return out
}

const readStrings = (r: ContractReader, o: JsonValue, key: string, at: string, required: boolean): string[] | null => {
  const itemsOrNull = readArray(r, o, key, at, required)
  if (itemsOrNull === null) {
    return null
  }
  const items: JsonValue[] = itemsOrNull
  const out: string[] = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (readIsKind(r, item, JSON_VALUE_STRING)) {
      out.push(r.doc.string(item))
    } else {
      readFail(r, `${at}.${key}[${i}]`, "a string")
    }
  }
  return out
}

const readOverrides = (r: ContractReader, o: JsonValue, key: string, at: string): NameOverride[] | null => {
  const v = r.doc.get(o, key)
  if (r.doc.kind(v) === JSON_VALUE_NONE) {
    return null
  }
  const where = `${at}.${key}`
  if (!readObject(r, v, where, vocabLanguages())) {
    return null
  }
  const out: NameOverride[] = []
  const n = r.doc.length(v)
  for (let i = 0; i < n; i++) {
    const lang = r.doc.keyAt(v, i)
    const x = r.doc.at(v, i)
    if (!readIsKind(r, x, JSON_VALUE_STRING)) {
      readFail(r, `${where}.${lang}`, "a string")
    } else if (vocabHas(vocabLanguages(), lang)) {
      out.push(new NameOverride(lang, r.doc.string(x)))
    }
  }
  return out
}

/** An intValue: a JSON integer within ±(2^53−1), or a decimal string for one beyond it. */
const readIntValue = (r: ContractReader, v: JsonValue, at: string): Literal | null => {
  const kind = r.doc.kind(v)
  if (kind === JSON_VALUE_NUMBER) {
    const text = readSafeInt(r, v)
    if (text === null) {
      readFail(r, at, READ_INT_WANT)
      return null
    }
    return new Literal(LitKind.Int, text)
  }
  if (kind === JSON_VALUE_STRING) {
    const text = r.doc.string(v)
    if (!vocabIsDecimal(text) || text === "0") {
      readFail(r, at, READ_INT_WANT)
      return null
    }
    if (vocabIsJsonSafe(text)) {
      readFail(r, at, `"${text}" fits in ±(2^53−1), so it is written as a JSON integer, not a string (RFC 7493 §2.2)`)
      return null
    }
    const lit = new Literal(LitKind.Int, text)
    lit.quoted = true
    return lit
  }
  readFail(r, at, READ_INT_WANT)
  return null
}

const readLiteralKind = (r: ContractReader, v: JsonValue): i32 => {
  const keys = vocabLiteralKinds()
  for (let i = 0; i < keys.length; i++) {
    if (readHas(r, v, keys[i])) {
      return i
    }
  }
  return -1
}

const readLiteral = (r: ContractReader, v: JsonValue, at: string): Literal | null => {
  if (!readIsKind(r, v, JSON_VALUE_OBJECT)) {
    readFail(r, at, "a literal object")
    return null
  }
  const k = readLiteralKind(r, v)
  if (k < 0) {
    readFail(r, at, "not a literal (hex, ascii, str, int, f64, bool, null, concat, words16, words32, words64)")
    return null
  }
  let lit: Literal | null = null
  if (k === 0) {
    readObject(r, v, at, ["hex", "repeat", "label", "unchecked"])
    const hex = readString(r, v, "hex", at, true)
    const repeat = readCount(r, v, "repeat", at, 1, 2147483647, false)
    if (hex !== null) {
      const h = new Literal(LitKind.Hex, hex)
      h.repeat = toI32(repeat)
      lit = h
    }
  } else if (k === 1) {
    readObject(r, v, at, ["ascii", "label", "unchecked"])
    const text = readString(r, v, "ascii", at, true)
    if (text !== null) {
      lit = new Literal(LitKind.Ascii, text)
    }
  } else if (k === 2) {
    readObject(r, v, at, ["str", "unchecked"])
    const text = readString(r, v, "str", at, true)
    if (text !== null) {
      lit = new Literal(LitKind.Str, text)
    }
  } else if (k === 3) {
    readObject(r, v, at, ["int", "label", "unchecked"])
    lit = readIntValue(r, r.doc.get(v, "int"), `${at}.int`)
  } else if (k === 4) {
    readObject(r, v, at, ["f64", "bits", "label", "unchecked"])
    const text = readString(r, v, "f64", at, true)
    const bits = readString(r, v, "bits", at, false)
    if (text !== null) {
      const f = new Literal(LitKind.F64, text)
      f.bits = bits
      lit = f
    }
  } else if (k === 5) {
    readObject(r, v, at, ["bool"])
    const b = r.doc.get(v, "bool")
    if (readIsKind(r, b, JSON_VALUE_BOOLEAN)) {
      const x = new Literal(LitKind.Bool, "")
      x.flag = r.doc.boolean(b)
      lit = x
    } else {
      readFail(r, `${at}.bool`, "a boolean")
    }
  } else if (k === 6) {
    readObject(r, v, at, ["null"])
    const n = r.doc.get(v, "null")
    if (readIsKind(r, n, JSON_VALUE_BOOLEAN) && r.doc.boolean(n)) {
      lit = new Literal(LitKind.Null, "")
    } else {
      readFail(r, `${at}.null`, "must be true")
    }
  } else if (k >= 8) {
    // Always true: readLiteralKind returns an index into these kinds.
    const kinds = vocabLiteralKinds()
    if (k < kinds.length) {
      const key = kinds[k]
      readObject(r, v, at, [key, "label", "unchecked"])
      const itemsOrNull = readArray(r, v, key, at, true)
      if (itemsOrNull !== null) {
        const items: JsonValue[] = itemsOrNull
        const w = new Literal(k === 8 ? LitKind.Words16 : k === 9 ? LitKind.Words32 : LitKind.Words64, "")
        if (items.length === 0) {
          readFail(r, `${at}.${key}`, "a non-empty array")
        }
        for (let i = 0; i < items.length; i++) {
          const item = items[i]
          if (readIsKind(r, item, JSON_VALUE_STRING)) {
            w.words.push(r.doc.string(item))
          } else {
            readFail(r, `${at}.${key}[${i}]`, "a string")
          }
        }
        lit = w
      }
    }
  } else {
    readObject(r, v, at, ["concat"])
    const partsOrNull = readArray(r, v, "concat", at, true)
    if (partsOrNull !== null) {
      const parts: JsonValue[] = partsOrNull
      const c = new Literal(LitKind.Concat, "")
      if (parts.length === 0) {
        readFail(r, `${at}.concat`, "a non-empty array")
      }
      for (let i = 0; i < parts.length; i++) {
        const pat = `${at}.concat[${i}]`
        const pk = readIsKind(r, parts[i], JSON_VALUE_OBJECT) ? readLiteralKind(r, parts[i]) : 0
        if (pk !== 0 && pk !== 1 && pk !== 7) {
          readFail(r, pat, "a bytes literal (hex, ascii, concat)")
        } else {
          const p = readLiteral(r, parts[i], pat)
          if (p !== null) {
            c.parts.push(p)
          }
        }
      }
      lit = c
    }
  }
  if (lit !== null) {
    lit.label = readString(r, v, "label", at, false)
    lit.unchecked = readString(r, v, "unchecked", at, false)
  }
  return lit
}

/**
 * An expression. `letOk` is true only at the top of an assert and of a let's
 * body: the emitted test binds a let once, before the assertion, so a let
 * under an `implies` or `and` would run where the evaluator short-circuits.
 */
const readExpr = (r: ContractReader, v: JsonValue, at: string, letOk: boolean): Expr | null => {
  if (!readIsKind(r, v, JSON_VALUE_OBJECT)) {
    readFail(r, at, "an expression object")
    return null
  }
  if (readHas(r, v, "let")) {
    readObject(r, v, at, ["let", "in"])
    if (!letOk) {
      readFail(r, at, `a let may only open the assert (or a let's "in")`)
    }
    const e = new Expr(ExprKind.Let, "")
    const bindsOrNull = readArray(r, v, "let", at, true)
    if (bindsOrNull !== null) {
      const binds: JsonValue[] = bindsOrNull
      if (binds.length === 0) {
        readFail(r, `${at}.let`, "a non-empty array of {name, value}")
      }
      for (let i = 0; i < binds.length; i++) {
        const bind = binds[i]
        const bat = `${at}.let[${i}]`
        if (readObject(r, bind, bat, ["name", "value"])) {
          const name = readRequiredString(r, bind, "name", bat)
          const bv = r.doc.get(bind, "value")
          if (r.doc.kind(bv) === JSON_VALUE_NONE) {
            readFail(r, `${bat}.value`, "missing; an expression")
          } else {
            const value = readExpr(r, bv, `${bat}.value`, false)
            if (value !== null) {
              e.binds.push(new LetBinding(name, value))
            }
          }
        }
      }
    }
    const body = r.doc.get(v, "in")
    if (r.doc.kind(body) === JSON_VALUE_NONE) {
      readFail(r, `${at}.in`, "missing; an expression")
    } else {
      e.body = readExpr(r, body, `${at}.in`, true)
    }
    return e
  }
  if (readHas(r, v, "var")) {
    readObject(r, v, at, ["var"])
    return new Expr(ExprKind.Var, readRequiredString(r, v, "var", at))
  }
  const isCall = readHas(r, v, "call")
  if (isCall || readHas(r, v, "op")) {
    const head = isCall ? "call" : "op"
    readObject(r, v, at, [head, "args"])
    const e = new Expr(isCall ? ExprKind.Call : ExprKind.Op, readRequiredString(r, v, head, at))
    const args: JsonValue[] = readArray(r, v, "args", at, true) ?? []
    for (let i = 0; i < args.length; i++) {
      const a = readExpr(r, args[i], `${at}.args[${i}]`, false)
      if (a !== null) {
        e.args.push(a)
      }
    }
    return e
  }
  const lit = readLiteral(r, v, at)
  if (lit === null) {
    return null
  }
  const e = new Expr(ExprKind.Lit, "")
  e.lit = lit
  return e
}

const readSource = (r: ContractReader, root: JsonValue, c: Contract): void => {
  const v = r.doc.get(root, "source")
  if (r.doc.kind(v) === JSON_VALUE_NONE) {
    readFail(r, "contract.source", "missing; an object")
    return
  }
  const at = "contract.source"
  if (!readObject(r, v, at, ["rfc", "title", "main", "sha256"])) {
    return
  }
  c.source.title = readRequiredString(r, v, "title", at)
  c.source.rfc = toI32(readCount(r, v, "rfc", at, 1, 2147483647, false))
  c.source.main = readString(r, v, "main", at, false)
  c.source.sha256 = readString(r, v, "sha256", at, false)
}

const readSources = (r: ContractReader, root: JsonValue, c: Contract): void => {
  const itemsOrNull = readArray(r, root, "sources", "contract", false)
  if (itemsOrNull === null) {
    return
  }
  const items: JsonValue[] = itemsOrNull
  const out: SourceDecl[] = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const at = `sources[${i}]`
    if (readObject(r, item, at, ["id", "rfc", "path", "file", "sha256"])) {
      const d = new SourceDecl()
      d.id = readRequiredString(r, item, "id", at)
      d.rfc = toI32(readCount(r, item, "rfc", at, 1, 2147483647, false))
      d.path = readString(r, item, "path", at, false)
      d.file = readString(r, item, "file", at, false)
      d.sha256 = readString(r, item, "sha256", at, false)
      out.push(d)
    }
  }
  c.sources = out
}

const readTarget = (r: ContractReader, root: JsonValue, c: Contract): void => {
  const v = r.doc.get(root, "target")
  if (r.doc.kind(v) === JSON_VALUE_NONE) {
    readFail(r, "contract.target", "missing; an object")
    return
  }
  const at = "contract.target"
  if (readObject(r, v, at, ["module", "modules"])) {
    c.target.module = readRequiredString(r, v, "module", at)
    c.target.modules = readOverrides(r, v, "modules", at)
  }
}

const readRequirements = (r: ContractReader, root: JsonValue, c: Contract): void => {
  const items: JsonValue[] = readArray(r, root, "requirements", "contract", true) ?? []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const at = `requirements[${i}]`
    if (readObject(r, item, at, ["id", "source", "section", "level", "quote", "note"])) {
      const q = new Requirement()
      q.id = readRequiredString(r, item, "id", at)
      q.source = readString(r, item, "source", at, false)
      q.section = readRequiredString(r, item, "section", at)
      q.level = readRequiredString(r, item, "level", at)
      q.quote = readRequiredString(r, item, "quote", at)
      q.note = readString(r, item, "note", at, false)
      c.requirements.push(q)
    }
  }
}

const readExclusions = (r: ContractReader, root: JsonValue, c: Contract): void => {
  const itemsOrNull = readArray(r, root, "exclusions", "contract", false)
  if (itemsOrNull === null) {
    return
  }
  const items: JsonValue[] = itemsOrNull
  const out: Exclusion[] = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const at = `exclusions[${i}]`
    if (readObject(r, item, at, ["source", "section", "quote", "reason"])) {
      const x = new Exclusion()
      x.source = readString(r, item, "source", at, false)
      x.section = readRequiredString(r, item, "section", at)
      x.quote = readRequiredString(r, item, "quote", at)
      x.reason = readRequiredString(r, item, "reason", at)
      out.push(x)
    }
  }
  c.exclusions = out
}

/** A function's `out` buffer; null when it is absent or refused. */
const readOut = (r: ContractReader, o: JsonValue, at: string): OutBuffer | null => {
  const v = r.doc.get(o, "out")
  if (r.doc.kind(v) === JSON_VALUE_NONE) {
    return null
  }
  const oat = `${at}.out`
  if (!readObject(r, v, oat, ["at", "capacity"])) {
    return null
  }
  const b = new OutBuffer()
  const n = readCount(r, v, "at", oat, 0, 255, true)
  b.at = n < 0 ? 0 : toI32(n)
  b.capacity = readRequiredString(r, v, "capacity", oat)
  return b
}

const readFunctions = (r: ContractReader, root: JsonValue, c: Contract): void => {
  const items: JsonValue[] = readArray(r, root, "functions", "contract", true) ?? []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const at = `functions[${i}]`
    if (readObject(r, item, at, ["name", "module", "params", "returns", "out", "names"])) {
      const f = new FnSig()
      f.name = readRequiredString(r, item, "name", at)
      f.module = readString(r, item, "module", at, false)
      f.returns = readRequiredString(r, item, "returns", at)
      f.out = readOut(r, item, at)
      f.names = readOverrides(r, item, "names", at)
      const params: JsonValue[] = readArray(r, item, "params", at, true) ?? []
      for (let j = 0; j < params.length; j++) {
        const param = params[j]
        const pat = `${at}.params[${j}]`
        if (readObject(r, param, pat, ["name", "type", "form", "names"])) {
          const p = new Param()
          p.name = readRequiredString(r, param, "name", pat)
          p.type = readRequiredString(r, param, "type", pat)
          p.form = readString(r, param, "form", pat, false)
          p.names = readOverrides(r, param, "names", pat)
          f.params.push(p)
        }
      }
      c.functions.push(f)
    }
  }
}

const readCitation = (r: ContractReader, v: JsonValue, at: string): Citation | null => {
  if (!readObject(r, v, at, ["source", "section", "case"])) {
    return null
  }
  const cite = new Citation()
  cite.source = readString(r, v, "source", at, false)
  cite.section = readRequiredString(r, v, "section", at)
  cite.testCase = readString(r, v, "case", at, false)
  return cite
}

const readVectorSource = (r: ContractReader, v: JsonValue, at: string): VectorSource | null => {
  const want = `where the expected value comes from: {"cite": {"section": …}}, {"command": "…"} or {"spec": "<section>"}`
  if (!readIsKind(r, v, JSON_VALUE_OBJECT)) {
    readFail(r, at, want)
    return null
  }
  const n =
    toU32(readHas(r, v, "cite") ? 1 : 0) +
    toU32(readHas(r, v, "command") ? 1 : 0) +
    toU32(readHas(r, v, "spec") ? 1 : 0)
  if (n !== 1) {
    readFail(r, at, `exactly one of "cite", "command", "spec"`)
    return null
  }
  if (readHas(r, v, "cite")) {
    readObject(r, v, at, ["cite"])
    const cite = readCitation(r, r.doc.get(v, "cite"), `${at}.cite`)
    if (cite === null) {
      return null
    }
    const s = new VectorSource(VectorSourceKind.Cite)
    s.cite = cite
    return s
  }
  const isCommand = readHas(r, v, "command")
  const key = isCommand ? "command" : "spec"
  readObject(r, v, at, [key])
  const text = readString(r, v, key, at, true)
  if (text === null) {
    return null
  }
  const s = new VectorSource(isCommand ? VectorSourceKind.Command : VectorSourceKind.Spec)
  s.text = text
  return s
}

const readTolerance = (r: ContractReader, v: JsonValue, at: string): Tolerance | null => {
  const hasAbs = readHas(r, v, "abs")
  if (!readIsKind(r, v, JSON_VALUE_OBJECT) || hasAbs === readHas(r, v, "ulps")) {
    readFail(r, at, `an object with one of "abs" or "ulps"`)
    return null
  }
  readObject(r, v, at, [hasAbs ? "abs" : "ulps", "source", "section", "quote"])
  const t = new Tolerance()
  t.isUlps = !hasAbs
  if (hasAbs) {
    t.abs = readRequiredString(r, v, "abs", at)
  } else {
    t.ulps = readCount(r, v, "ulps", at, 0, 9007199254740991, true)
  }
  t.source = readString(r, v, "source", at, false)
  t.section = readRequiredString(r, v, "section", at)
  t.quote = readRequiredString(r, v, "quote", at)
  return t
}

const readIterate = (r: ContractReader, v: JsonValue, at: string): Iterate | null => {
  if (!readObject(r, v, at, ["count", "names", "next", "slow"])) {
    return null
  }
  const it = new Iterate()
  it.count = readCount(r, v, "count", at, 1, 1000000000, true)
  it.names = readStrings(r, v, "names", at, true) ?? []
  const next: JsonValue[] = readArray(r, v, "next", at, true) ?? []
  for (let i = 0; i < next.length; i++) {
    const e = readExpr(r, next[i], `${at}.next[${i}]`, false)
    if (e !== null) {
      it.next.push(e)
    }
  }
  const slow = r.doc.get(v, "slow")
  if (r.doc.kind(slow) !== JSON_VALUE_NONE) {
    if (readIsKind(r, slow, JSON_VALUE_BOOLEAN)) {
      it.slow = r.doc.boolean(slow)
    } else {
      readFail(r, `${at}.slow`, "a boolean")
    }
  }
  return it
}

/** A vector's `truncate`: exactly one of `bits` (a multiple of 8) or `bytes`, at most 65536 bytes. */
const readTruncate = (r: ContractReader, v: JsonValue, at: string): Truncate | null => {
  if (!readObject(r, v, at, ["bits", "bytes"])) {
    return null
  }
  const hasBits = r.doc.kind(r.doc.get(v, "bits")) !== JSON_VALUE_NONE
  const hasBytes = r.doc.kind(r.doc.get(v, "bytes")) !== JSON_VALUE_NONE
  if (hasBits === hasBytes) {
    readFail(r, at, "exactly one of bits or bytes")
    return null
  }
  if (hasBytes) {
    const n = readCount(r, v, "bytes", at, 1, 65536, true)
    return n < 0 ? null : new Truncate(n, "bytes")
  }
  const bits = readCount(r, v, "bits", at, 8, 524288, true)
  if (bits < 0) {
    return null
  }
  if (bits % 8 !== 0) {
    readFail(r, `${at}.bits`, "a whole number of bytes: a multiple of 8")
    return null
  }
  return new Truncate(bits / 8, "bits")
}

const readForall = (r: ContractReader, v: JsonValue, at: string): ForallVar | null => {
  if (!readIsKind(r, v, JSON_VALUE_OBJECT)) {
    readFail(r, at, "an object")
    return null
  }
  const x = new ForallVar()
  x.name = readRequiredString(r, v, "name", at)
  x.type = readRequiredString(r, v, "type", at)
  if (vocabIsIntType(x.type)) {
    readObject(r, v, at, ["name", "type", "min", "max"])
    const lo = readIntValue(r, r.doc.get(v, "min"), `${at}.min`)
    const hi = readIntValue(r, r.doc.get(v, "max"), `${at}.max`)
    if (lo === null || hi === null) {
      return null
    }
    x.min = lo.text
    x.minQuoted = lo.quoted
    x.max = hi.text
    x.maxQuoted = hi.quoted
    x.hasBounds = true
  } else if (x.type === "f64") {
    readObject(r, v, at, ["name", "type", "min", "max"])
    const lo = readString(r, v, "min", at, true)
    const hi = readString(r, v, "max", at, true)
    if (lo === null || hi === null) {
      return null
    }
    x.min = lo
    x.max = hi
    x.hasBounds = true
  } else if (x.type === "bytes" || x.type === "string") {
    const isString = x.type === "string"
    readObject(
      r,
      v,
      at,
      isString ? ["name", "type", "minLen", "maxLen", "alphabet"] : ["name", "type", "minLen", "maxLen"],
    )
    x.minLen = toI32(readCount(r, v, "minLen", at, 0, 4096, true))
    x.maxLen = toI32(readCount(r, v, "maxLen", at, 0, 4096, true))
    if (isString) {
      x.alphabet = readStrings(r, v, "alphabet", at, true)
    }
  } else if (r.doc.kind(r.doc.get(v, "type")) === JSON_VALUE_STRING) {
    readFail(r, `${at}.type`, `an integer type (i8 i16 i32 i64 u8 u16 u32 u64), "f64", "bytes" or "string"`)
    return null
  } else {
    return null
  }
  return x
}

const readClause = (r: ContractReader, v: JsonValue, at: string): Clause | null => {
  if (!readIsKind(r, v, JSON_VALUE_OBJECT)) {
    readFail(r, at, "an object")
    return null
  }
  const kindOrNull = readString(r, v, "kind", at, true)
  if (kindOrNull === null) {
    return null
  }
  const kind: string = kindOrNull
  if (kind !== "vector" && kind !== "property") {
    readFail(r, `${at}.kind`, `"vector" or "property"`)
    return null
  }
  const isVector = kind === "vector"
  const c = new Clause(isVector ? ClauseKind.Vector : ClauseKind.Property)
  if (isVector) {
    readObject(r, v, at, [
      "kind",
      "id",
      "title",
      "covers",
      "source",
      "section",
      "sectionSource",
      "call",
      "args",
      "expect",
      "tolerance",
      "iterate",
      "truncate",
    ])
  } else {
    readObject(r, v, at, ["kind", "id", "title", "covers", "forall", "where", "assert", "samples"])
  }
  c.id = readRequiredString(r, v, "id", at)
  c.title = readRequiredString(r, v, "title", at)
  c.covers = readStrings(r, v, "covers", at, true) ?? []
  if (isVector) {
    const src = r.doc.get(v, "source")
    if (r.doc.kind(src) === JSON_VALUE_NONE) {
      readFail(r, `${at}.source`, "missing; where the expected value comes from")
    } else {
      c.source = readVectorSource(r, src, `${at}.source`)
    }
    c.section = readString(r, v, "section", at, false)
    c.sectionSource = readString(r, v, "sectionSource", at, false)
    c.call = readRequiredString(r, v, "call", at)
    const args: JsonValue[] = readArray(r, v, "args", at, true) ?? []
    for (let i = 0; i < args.length; i++) {
      const a = readLiteral(r, args[i], `${at}.args[${i}]`)
      if (a !== null) {
        c.args.push(a)
      }
    }
    const expect = r.doc.get(v, "expect")
    if (r.doc.kind(expect) === JSON_VALUE_NONE) {
      readFail(r, `${at}.expect`, "missing; a literal")
    } else {
      c.expect = readLiteral(r, expect, `${at}.expect`)
    }
    const tol = r.doc.get(v, "tolerance")
    if (r.doc.kind(tol) !== JSON_VALUE_NONE) {
      c.tolerance = readTolerance(r, tol, `${at}.tolerance`)
    }
    const it = r.doc.get(v, "iterate")
    if (r.doc.kind(it) !== JSON_VALUE_NONE) {
      c.iterate = readIterate(r, it, `${at}.iterate`)
    }
    const tr = r.doc.get(v, "truncate")
    if (r.doc.kind(tr) !== JSON_VALUE_NONE) {
      c.truncate = readTruncate(r, tr, `${at}.truncate`)
    }
    return c
  }
  const forall: JsonValue[] = readArray(r, v, "forall", at, true) ?? []
  for (let i = 0; i < forall.length; i++) {
    const x = readForall(r, forall[i], `${at}.forall[${i}]`)
    if (x !== null) {
      c.forall.push(x)
    }
  }
  const where = r.doc.get(v, "where")
  if (r.doc.kind(where) !== JSON_VALUE_NONE) {
    c.where = readExpr(r, where, `${at}.where`, false)
  }
  const assert = r.doc.get(v, "assert")
  if (r.doc.kind(assert) === JSON_VALUE_NONE) {
    readFail(r, `${at}.assert`, "missing; an expression")
  } else {
    c.assert = readExpr(r, assert, `${at}.assert`, true)
  }
  c.samples = toI32(readCount(r, v, "samples", at, 1, 256, false))
  return c
}

const readClauses = (r: ContractReader, root: JsonValue, c: Contract): void => {
  const items: JsonValue[] = readArray(r, root, "clauses", "contract", true) ?? []
  for (let i = 0; i < items.length; i++) {
    const k = readClause(r, items[i], `clauses[${i}]`)
    if (k !== null) {
      c.clauses.push(k)
    }
  }
}

const readOutOfScope = (r: ContractReader, root: JsonValue, c: Contract): void => {
  const itemsOrNull = readArray(r, root, "outOfScope", "contract", false)
  if (itemsOrNull === null) {
    return
  }
  const items: JsonValue[] = itemsOrNull
  const out: OutOfScope[] = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const at = `outOfScope[${i}]`
    if (readObject(r, item, at, ["name", "reason"])) {
      const x = new OutOfScope()
      x.name = readRequiredString(r, item, "name", at)
      x.reason = readRequiredString(r, item, "reason", at)
      out.push(x)
    }
  }
  c.outOfScope = out
}

const readAllowSurvivors = (r: ContractReader, root: JsonValue, c: Contract): void => {
  const itemsOrNull = readArray(r, root, "allowSurvivors", "contract", false)
  if (itemsOrNull === null) {
    return
  }
  const items: JsonValue[] = itemsOrNull
  const out: AllowedSurvivor[] = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const at = `allowSurvivors[${i}]`
    if (readObject(r, item, at, ["file", "line", "reason"])) {
      const x = new AllowedSurvivor()
      x.file = readRequiredString(r, item, "file", at)
      x.line = readCount(r, item, "line", at, 1, 9007199254740991, true)
      x.reason = readRequiredString(r, item, "reason", at)
      out.push(x)
    }
  }
  c.allowSurvivors = out
}

/**
 * Reads a contract from a parsed JSON value, checking its structure against
 * the schema.
 *
 * @param doc the document `root` belongs to
 * @param root the contract's JSON value
 * @returns `Ok` with the contract, or `Err` with every structural error, each
 *   as `<path>: <what was wanted>`
 */
export const contractFromJson = (doc: JsonDocument, root: JsonValue): Result<Contract, string[]> => {
  const r = new ContractReader(doc)
  const c = new Contract()
  if (
    !readObject(r, root, "contract", [
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
    ])
  ) {
    return Err(r.errors)
  }
  c.schema = readString(r, root, "$schema", "contract", false)
  c.contract = readRequiredString(r, root, "contract", "contract")
  readSource(r, root, c)
  readSources(r, root, c)
  readTarget(r, root, c)
  readRequirements(r, root, c)
  readExclusions(r, root, c)
  readFunctions(r, root, c)
  readClauses(r, root, c)
  readOutOfScope(r, root, c)
  readAllowSurvivors(r, root, c)
  if (r.errors.length > 0) {
    return Err(r.errors)
  }
  return Ok(c)
}

/**
 * Parses JSON text as a contract, checking its structure against the schema.
 *
 * @param text the contract's JSON text
 * @param source where the text came from, for the error when it is not JSON
 * @returns `Ok` with the contract, or `Err` with every structural error
 */
export const contractParse = (text: string, source: string): Result<Contract, string[]> => {
  const doc = newJsonDocument()
  const root = parseJson(doc, text, source)
  if (root.isErr()) {
    return Err([root.error])
  }
  return contractFromJson(doc, root.value)
}
