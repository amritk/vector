/**
 * `spec/contract/write` — a contract written back as canonical JSON, the bytes
 * `contracts/*.json` holds. Canonical is how biome formats JSON, so a written
 * contract passes `biome check`: 2-space indent, `\n`, a trailing newline,
 * every non-empty object expanded, and an array that holds no object on one
 * line when that line, with its trailing comma, is at most 80 characters wide,
 * else one element per line. Keys go in the order the committed contracts
 * write them, and an integer beyond ±(2^53−1) is a decimal string.
 */

import { jsonStringifyString } from "nish/json"
import { codePointLength } from "nish/text"
import {
  AllowedSurvivor,
  Clause,
  ClauseKind,
  Contract,
  Exclusion,
  Expr,
  ExprKind,
  ForallVar,
  Iterate,
  LitKind,
  Literal,
  NameOverride,
  OutOfScope,
  SourceDecl,
  Tail,
  Tolerance,
  Truncate,
  VectorSource,
  VectorSourceKind,
  typesIsWords,
  typesWordsKey,
} from "./types"
import { vocabLanguages } from "./vocab"

/** The widest line an array of scalars may be written on, as biome does. */
const WRITE_LINE_WIDTH: i32 = 80

const WRITE_SCALAR: i32 = 0
const WRITE_ARRAY: i32 = 1
const WRITE_OBJECT: i32 = 2

/** A JSON value about to be written: a scalar's text, or an array or object of entries. */
class WriteNode {
  kind: i32
  text: string
  entries: WriteEntry[]
  constructor(kind: i32, text: string) {
    this.kind = kind
    this.text = text
    this.entries = []
  }
}

/** One member of an array or object: its key (empty in an array) and value. */
class WriteEntry {
  key: string
  value: WriteNode
  constructor(key: string, value: WriteNode) {
    this.key = key
    this.value = value
  }
}

const writeObj = (): WriteNode => new WriteNode(WRITE_OBJECT, "")
const writeArr = (): WriteNode => new WriteNode(WRITE_ARRAY, "")
const writeStr = (s: string): WriteNode => new WriteNode(WRITE_SCALAR, jsonStringifyString(s))
const writeRaw = (text: string): WriteNode => new WriteNode(WRITE_SCALAR, text)

const writeSet = (o: WriteNode, key: string, v: WriteNode): void => {
  o.entries.push(new WriteEntry(key, v))
}

const writePush = (a: WriteNode, v: WriteNode): void => {
  a.entries.push(new WriteEntry("", v))
}

const writeSetStr = (o: WriteNode, key: string, s: string | null): void => {
  if (s !== null) {
    writeSet(o, key, writeStr(s))
  }
}

const writeStrings = (list: string[]): WriteNode => {
  const a = writeArr()
  for (let i = 0; i < list.length; i++) {
    writePush(a, writeStr(list[i]))
  }
  return a
}

/** Name overrides, in the vocabulary's language order. */
const writeOverrides = (o: WriteNode, key: string, list: NameOverride[] | null): void => {
  if (list === null) {
    return
  }
  const m = writeObj()
  const langs = vocabLanguages()
  const overrides: NameOverride[] = list
  for (let i = 0; i < langs.length; i++) {
    const lang = langs[i]
    for (let j = 0; j < overrides.length; j++) {
      const ov = overrides[j]
      if (ov.language === lang) {
        writeSet(m, lang, writeStr(ov.value))
      }
    }
  }
  writeSet(o, key, m)
}

/** An integer as its text: a JSON number, or a decimal string when `quoted`. */
const writeInt = (text: string, quoted: boolean): WriteNode => (quoted ? writeStr(text) : writeRaw(text))

const writeLiteral = (lit: Literal): WriteNode => {
  const o = writeObj()
  if (lit.kind === LitKind.Hex) {
    writeSet(o, "hex", writeStr(lit.text))
    if (lit.repeat >= 0) {
      writeSet(o, "repeat", writeRaw(`${lit.repeat}`))
    }
  } else if (lit.kind === LitKind.Ascii) {
    writeSet(o, "ascii", writeStr(lit.text))
  } else if (lit.kind === LitKind.Str) {
    writeSet(o, "str", writeStr(lit.text))
  } else if (lit.kind === LitKind.Int) {
    writeSet(o, "int", writeInt(lit.text, lit.quoted))
  } else if (lit.kind === LitKind.F64) {
    writeSet(o, "f64", writeStr(lit.text))
    writeSetStr(o, "bits", lit.bits)
  } else if (lit.kind === LitKind.Bool) {
    writeSet(o, "bool", writeRaw(lit.flag ? "true" : "false"))
  } else if (lit.kind === LitKind.Null) {
    writeSet(o, "null", writeRaw("true"))
  } else if (typesIsWords(lit.kind)) {
    const words = writeArr()
    for (let i = 0; i < lit.words.length; i++) {
      writePush(words, writeStr(lit.words[i]))
    }
    writeSet(o, typesWordsKey(lit.kind), words)
  } else {
    const parts = writeArr()
    for (let i = 0; i < lit.parts.length; i++) {
      writePush(parts, writeLiteral(lit.parts[i]))
    }
    writeSet(o, "concat", parts)
  }
  writeSetStr(o, "label", lit.label)
  writeSetStr(o, "unchecked", lit.unchecked)
  writeSetStr(o, "format", lit.format)
  return o
}

const writeExpr = (e: Expr): WriteNode => {
  const lit = e.lit
  if (e.kind === ExprKind.Lit && lit !== null) {
    return writeLiteral(lit)
  }
  const o = writeObj()
  if (e.kind === ExprKind.Var) {
    writeSet(o, "var", writeStr(e.name))
    return o
  }
  if (e.kind === ExprKind.Let) {
    const binds = writeArr()
    const lets = e.binds
    for (let i = 0; i < lets.length; i++) {
      const bind = lets[i]
      const b = writeObj()
      writeSet(b, "name", writeStr(bind.name))
      writeSet(b, "value", writeExpr(bind.value))
      writePush(binds, b)
    }
    writeSet(o, "let", binds)
    const body = e.body
    if (body !== null) {
      writeSet(o, "in", writeExpr(body))
    }
    return o
  }
  writeSet(o, e.kind === ExprKind.Call ? "call" : "op", writeStr(e.name))
  const args = writeArr()
  for (let i = 0; i < e.args.length; i++) {
    writePush(args, writeExpr(e.args[i]))
  }
  writeSet(o, "args", args)
  return o
}

const writeVectorSource = (s: VectorSource): WriteNode => {
  const o = writeObj()
  const cite = s.cite
  if (s.kind === VectorSourceKind.Cite && cite !== null) {
    const c = writeObj()
    writeSetStr(c, "source", cite.source)
    writeSet(c, "section", writeStr(cite.section))
    writeSetStr(c, "case", cite.testCase)
    writeSet(o, "cite", c)
  } else {
    writeSet(o, s.kind === VectorSourceKind.Command ? "command" : "spec", writeStr(s.text))
  }
  return o
}

const writeTolerance = (t: Tolerance): WriteNode => {
  const o = writeObj()
  if (t.isUlps) {
    writeSet(o, "ulps", writeRaw(`${t.ulps}`))
  } else {
    writeSet(o, "abs", writeStr(t.abs))
  }
  writeSetStr(o, "source", t.source)
  writeSet(o, "section", writeStr(t.section))
  writeSet(o, "quote", writeStr(t.quote))
  return o
}

const writeTruncate = (t: Truncate): WriteNode => {
  const o = writeObj()
  if (t.unit === "bits") {
    writeSet(o, "bits", writeRaw(`${t.count()}`))
  } else {
    writeSet(o, "bytes", writeRaw(`${t.bytes}`))
  }
  return o
}

const writeTail = (t: Tail): WriteNode => {
  const o = writeObj()
  writeSet(o, "arg", writeRaw(`${t.arg}`))
  writeSet(o, "bytes", writeRaw(`${t.bytes}`))
  writeSet(o, "reason", writeStr(t.reason))
  return o
}

const writeIterate = (it: Iterate): WriteNode => {
  const o = writeObj()
  writeSet(o, "count", writeRaw(`${it.count}`))
  writeSet(o, "names", writeStrings(it.names))
  const next = writeArr()
  for (let i = 0; i < it.next.length; i++) {
    writePush(next, writeExpr(it.next[i]))
  }
  writeSet(o, "next", next)
  if (it.slow) {
    writeSet(o, "slow", writeRaw("true"))
  }
  return o
}

const writeForall = (x: ForallVar): WriteNode => {
  const o = writeObj()
  writeSet(o, "name", writeStr(x.name))
  writeSet(o, "type", writeStr(x.type))
  if (x.hasBounds) {
    const f64 = x.type === "f64"
    writeSet(o, "min", f64 ? writeStr(x.min) : writeInt(x.min, x.minQuoted))
    writeSet(o, "max", f64 ? writeStr(x.max) : writeInt(x.max, x.maxQuoted))
    return o
  }
  writeSet(o, "minLen", writeRaw(`${x.minLen}`))
  writeSet(o, "maxLen", writeRaw(`${x.maxLen}`))
  const alphabet = x.alphabet
  if (alphabet !== null) {
    writeSet(o, "alphabet", writeStrings(alphabet))
  }
  return o
}

const writeClause = (c: Clause): WriteNode => {
  const o = writeObj()
  writeSet(o, "kind", writeStr(c.kind === ClauseKind.Vector ? "vector" : "property"))
  writeSet(o, "id", writeStr(c.id))
  writeSet(o, "title", writeStr(c.title))
  writeSet(o, "covers", writeStrings(c.covers))
  if (c.kind === ClauseKind.Vector) {
    const source = c.source
    if (source !== null) {
      writeSet(o, "source", writeVectorSource(source))
    }
    writeSetStr(o, "section", c.section)
    writeSetStr(o, "sectionSource", c.sectionSource)
    writeSet(o, "call", writeStr(c.call))
    const args = writeArr()
    for (let i = 0; i < c.args.length; i++) {
      writePush(args, writeLiteral(c.args[i]))
    }
    writeSet(o, "args", args)
    const expect = c.expect
    if (expect !== null) {
      writeSet(o, "expect", writeLiteral(expect))
    }
    const tol = c.tolerance
    if (tol !== null) {
      writeSet(o, "tolerance", writeTolerance(tol))
    }
    const it = c.iterate
    if (it !== null) {
      writeSet(o, "iterate", writeIterate(it))
    }
    const tr = c.truncate
    if (tr !== null) {
      writeSet(o, "truncate", writeTruncate(tr))
    }
    const tl = c.tail
    if (tl !== null) {
      writeSet(o, "tail", writeTail(tl))
    }
    return o
  }
  const forall = writeArr()
  for (let i = 0; i < c.forall.length; i++) {
    writePush(forall, writeForall(c.forall[i]))
  }
  writeSet(o, "forall", forall)
  const where = c.where
  if (where !== null) {
    writeSet(o, "where", writeExpr(where))
  }
  const assert = c.assert
  if (assert !== null) {
    writeSet(o, "assert", writeExpr(assert))
  }
  if (c.samples >= 0) {
    writeSet(o, "samples", writeRaw(`${c.samples}`))
  }
  return o
}

const writeSurvivor = (s: AllowedSurvivor): WriteNode => {
  const o = writeObj()
  writeSet(o, "file", writeStr(s.file))
  writeSet(o, "line", writeRaw(`${s.line}`))
  writeSet(o, "reason", writeStr(s.reason))
  return o
}

/** The contract as a tree of nodes, each object's keys in canonical order. */
const writeTree = (c: Contract): WriteNode => {
  const root = writeObj()
  writeSetStr(root, "$schema", c.schema)
  writeSet(root, "contract", writeStr(c.contract))
  const src = writeObj()
  if (c.source.rfc >= 0) {
    writeSet(src, "rfc", writeRaw(`${c.source.rfc}`))
  }
  writeSet(src, "title", writeStr(c.source.title))
  writeSetStr(src, "main", c.source.main)
  writeSetStr(src, "sha256", c.source.sha256)
  writeSet(root, "source", src)
  const sources = c.sources
  if (sources !== null) {
    const a = writeArr()
    const docs: SourceDecl[] = sources
    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i]
      const d = writeObj()
      writeSet(d, "id", writeStr(doc.id))
      if (doc.rfc >= 0) {
        writeSet(d, "rfc", writeRaw(`${doc.rfc}`))
      }
      writeSetStr(d, "path", doc.path)
      writeSetStr(d, "file", doc.file)
      writeSetStr(d, "sha256", doc.sha256)
      writePush(a, d)
    }
    writeSet(root, "sources", a)
  }
  const target = writeObj()
  writeSet(target, "module", writeStr(c.target.module))
  writeOverrides(target, "modules", c.target.modules)
  writeSet(root, "target", target)
  const reqs = writeArr()
  const requirements = c.requirements
  for (let i = 0; i < requirements.length; i++) {
    const q = requirements[i]
    const o = writeObj()
    writeSet(o, "id", writeStr(q.id))
    writeSetStr(o, "source", q.source)
    writeSet(o, "section", writeStr(q.section))
    writeSet(o, "level", writeStr(q.level))
    writeSet(o, "quote", writeStr(q.quote))
    writeSetStr(o, "note", q.note)
    writePush(reqs, o)
  }
  writeSet(root, "requirements", reqs)
  const exclusions = c.exclusions
  if (exclusions !== null) {
    const a = writeArr()
    const excluded: Exclusion[] = exclusions
    for (let i = 0; i < excluded.length; i++) {
      const x = excluded[i]
      const o = writeObj()
      writeSetStr(o, "source", x.source)
      writeSet(o, "section", writeStr(x.section))
      writeSet(o, "quote", writeStr(x.quote))
      writeSet(o, "reason", writeStr(x.reason))
      writePush(a, o)
    }
    writeSet(root, "exclusions", a)
  }
  const fns = writeArr()
  const functions = c.functions
  for (let i = 0; i < functions.length; i++) {
    const f = functions[i]
    const o = writeObj()
    writeSet(o, "name", writeStr(f.name))
    writeSetStr(o, "module", f.module)
    const params = writeArr()
    const fparams = f.params
    for (let j = 0; j < fparams.length; j++) {
      const fp = fparams[j]
      const p = writeObj()
      writeSet(p, "name", writeStr(fp.name))
      writeSet(p, "type", writeStr(fp.type))
      writeSetStr(p, "form", fp.form)
      writeOverrides(p, "names", fp.names)
      writePush(params, p)
    }
    writeSet(o, "params", params)
    writeSet(o, "returns", writeStr(f.returns))
    const out = f.out
    if (out !== null) {
      const b = writeObj()
      writeSet(b, "at", writeRaw(`${out.at}`))
      writeSet(b, "capacity", writeStr(out.capacity))
      writeSet(o, "out", b)
    }
    writeOverrides(o, "names", f.names)
    writePush(fns, o)
  }
  writeSet(root, "functions", fns)
  const clauses = writeArr()
  const cs = c.clauses
  for (let i = 0; i < cs.length; i++) {
    writePush(clauses, writeClause(cs[i]))
  }
  writeSet(root, "clauses", clauses)
  const oos = c.outOfScope
  if (oos !== null) {
    const a = writeArr()
    const scoped: OutOfScope[] = oos
    for (let i = 0; i < scoped.length; i++) {
      const os = scoped[i]
      const o = writeObj()
      writeSet(o, "name", writeStr(os.name))
      writeSet(o, "reason", writeStr(os.reason))
      writePush(a, o)
    }
    writeSet(root, "outOfScope", a)
  }
  const survivors = c.allowSurvivors
  if (survivors !== null) {
    const a = writeArr()
    const allowed: AllowedSurvivor[] = survivors
    for (let i = 0; i < allowed.length; i++) {
      writePush(a, writeSurvivor(allowed[i]))
    }
    writeSet(root, "allowSurvivors", a)
  }
  return root
}

/** `n` on one line, or null when it holds an object. */
const writeInline = (n: WriteNode): string | null => {
  if (n.kind === WRITE_SCALAR) {
    return n.text
  }
  if (n.kind === WRITE_OBJECT) {
    return null
  }
  let out = "["
  const entries = n.entries
  for (let i = 0; i < entries.length; i++) {
    const item = writeInline(entries[i].value)
    if (item === null) {
      return null
    }
    out = i === 0 ? `${out}${item}` : `${out}, ${item}`
  }
  return `${out}]`
}

// In u32: `i` is below `n`, so `i + 1` does not wrap.
const writeComma = (i: u32, n: u32): u32 => (i + 1 < n ? 1 : 0)

/** `n` formatted at `indent`, with `used` columns of its line already taken. */
const writeFormat = (n: WriteNode, indent: string, used: u32): string => {
  if (n.kind === WRITE_SCALAR) {
    return n.text
  }
  const entries = n.entries
  const count = entries.length
  if (count === 0) {
    return n.kind === WRITE_ARRAY ? "[]" : "{}"
  }
  const inner = `${indent}  `
  const lines: string[] = []
  if (n.kind === WRITE_ARRAY) {
    const flat = writeInline(n)
    if (flat !== null && used + toU32(codePointLength(flat)) <= toU32(WRITE_LINE_WIDTH)) {
      return flat
    }
    for (let i = 0; i < entries.length; i++) {
      lines.push(
        inner +
          writeFormat(entries[i].value, inner, toU32(codePointLength(inner)) + writeComma(toU32(i), toU32(count))),
      )
    }
    return `[\n${lines.join(",\n")}\n${indent}]`
  }
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const key = `${inner}${jsonStringifyString(entry.key)}: `
    lines.push(key + writeFormat(entry.value, inner, toU32(codePointLength(key)) + writeComma(toU32(i), toU32(count))))
  }
  return `{\n${lines.join(",\n")}\n${indent}}`
}

/**
 * Writes a contract as canonical JSON: the bytes a committed contract holds,
 * so reading one and writing it back reproduces the file. Write only a
 * contract that passed the shape check (`contractLoad` gives one): the writer
 * prints values as they are and judges none of them.
 *
 * @param c the contract to write
 * @returns the JSON text, with a trailing newline
 */
export const contractWrite = (c: Contract): string => `${writeFormat(writeTree(c), "", 0)}\n`
