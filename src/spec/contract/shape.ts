/**
 * `spec/contract/shape` — the checks on a contract's values once its structure
 * has been read: the patterns ids, sections, modules and literals are written
 * in, the enums, the bounds of property variables, the source declarations
 * and the references to them, and the free text copied into the generated
 * test. Every error is reported, each at its path.
 */

import { trim } from "nish/text"
import { capacityNames, capacityParse, capacityShow } from "./capacity"
import {
  charsFirstControl,
  charsHasLetter,
  charsIsAbs,
  charsIsF64Text,
  charsIsId,
  charsIsIdent,
  charsIsLowerHex,
  charsIsModule,
  charsIsSection,
  charsIsStringText,
  charsIsWordList,
  charsTestVector,
} from "./chars"
import { contractF64Bits, contractF64FromBits, contractF64IsNaN, contractF64Overflows, contractF64Parse } from "./f64"
import { LITERALS_PRINTABLE, literalsByteLength, literalsPrintable } from "./literals"
import {
  AllowedSurvivor,
  Clause,
  ClauseKind,
  Contract,
  Exclusion,
  Expr,
  ExprKind,
  FnSig,
  ForallVar,
  Iterate,
  LitKind,
  Literal,
  NameOverride,
  OutBuffer,
  OutOfScope,
  SourceDecl,
  Tolerance,
  Truncate,
  VectorSourceKind,
  typesIsWords,
  typesWordsKey,
} from "./types"
import { typeOfLiteral } from "./typing"
import {
  vocabCompareDecimal,
  vocabFitsInt,
  vocabHas,
  vocabIntMax,
  vocabIntMin,
  vocabIsIntType,
  vocabLevels,
  vocabOps,
  vocabSigTypes,
  vocabWordDigits,
} from "./vocab"

/** The longest bytes or string value a property variable may range over. */
export const SHAPE_MAX_LEN: i32 = 4096

/**
 * The names the generated test declares itself: its helpers, its locals and
 * the globals it uses. A contract function may not take one of them.
 *
 * @returns the reserved names
 */
export const shapeTestNames = (): string[] => [
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
  "intBytes",
  "bytesInt",
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
]

/**
 * The prefixes of the names the generated test gives its own functions and
 * values; a contract function may not start with one.
 *
 * @returns the reserved prefixes
 */
export const shapeTestPrefixes = (): string[] => ["plain_", "clause_", "table_", "v_", "a_", "s_"]

/**
 * The named character classes a string variable's alphabet may use.
 *
 * @returns the class names, in order
 */
export const shapeAlphabetClasses = (): string[] => [
  "hexdigit",
  "HEXDIGIT",
  "digit",
  "alpha",
  "space",
  "ascii-printable",
]

/** The characters lo..hi, then lo2..hi2 (none when lo2 > hi2). */
const shapeRange = (lo: i32, hi: i32, lo2: i32, hi2: i32): string[] => {
  const out: string[] = []
  // c stops below hi and hi is pushed on its own, so c++ cannot pass it.
  for (let c = lo; c < hi; c++) {
    out.push(String.fromCharCode(c))
  }
  if (lo <= hi) {
    out.push(String.fromCharCode(hi))
  }
  for (let c = lo2; c < hi2; c++) {
    out.push(String.fromCharCode(c))
  }
  if (lo2 <= hi2) {
    out.push(String.fromCharCode(hi2))
  }
  return out
}

/**
 * The characters an alphabet entry spells: a class's characters, or the one
 * character it is.
 *
 * @param entry a class name or one character
 * @returns the characters, in order, or null for an unknown class
 */
export const shapeAlphabetChars = (entry: string): string[] | null => {
  if (entry === "hexdigit") {
    return shapeRange(0x30, 0x39, 0x61, 0x66)
  }
  if (entry === "HEXDIGIT") {
    return shapeRange(0x30, 0x39, 0x41, 0x46)
  }
  if (entry === "digit") {
    return shapeRange(0x30, 0x39, 1, 0)
  }
  if (entry === "alpha") {
    return shapeRange(0x41, 0x5a, 0x61, 0x7a)
  }
  if (entry === "space") {
    return [" ", "\t", "\n", "\r"]
  }
  if (entry === "ascii-printable") {
    return shapeRange(0x20, 0x7e, 1, 0)
  }
  if (entry.length === 1 && charsIsStringText(entry)) {
    return [entry]
  }
  return null
}

/**
 * The file a nish module lives in, from the nish root: `nish/crypto/hkdf` is
 * `std/crypto/hkdf.ts`.
 *
 * @param module a module path
 * @returns its file, or null for a module outside nish
 */
export const shapeNishModuleFile = (module: string): string | null => {
  if (!module.startsWith("nish/")) {
    return null
  }
  const rest = module.substring(5, module.length)
  if (rest.length === 0 || !shapeIsRepoPath(rest)) {
    return null
  }
  return `std/${rest}.ts`
}

const SHAPE_OVERFLOW: string =
  "is past binary64's largest finite value and rounds to an infinity (IEEE 754-2019 §7.4); write Infinity or -Infinity if that is meant"
const SHAPE_F64_TEXT: string = "decimal text (RFC 8259 §6 number syntax), NaN, Infinity or -Infinity"

class ShapeContext {
  c: Contract
  errors: string[]
  ids: string[]
  constructor(c: Contract) {
    this.c = c
    this.errors = []
    this.ids = []
  }
}

const shapeFail = (s: ShapeContext, at: string, message: string): void => {
  s.errors.push(`${at}: ${message}`)
}

/** Free text: non-empty, and one line without control characters. */
const shapeText = (s: ShapeContext, v: string, at: string): void => {
  if (trim(v) === "") {
    shapeFail(s, at, "a non-empty string")
    return
  }
  const ch = charsFirstControl(v)
  if (ch !== null) {
    shapeFail(
      s,
      at,
      `one line of text, without control characters (found ${ch}); it is copied into comments in the generated test`,
    )
  }
}

const shapeSection = (s: ShapeContext, v: string, at: string): void => {
  if (!charsIsSection(v)) {
    shapeFail(s, at, "a section number")
  }
}

const shapeModule = (s: ShapeContext, v: string, at: string): void => {
  if (!charsIsModule(v)) {
    shapeFail(
      s,
      at,
      "a module path <root>/<segment>/…, each segment [a-z][a-z0-9_]*(-[a-z0-9][a-z0-9_]*)*, words joined by single - (RFC 3986 §3.3)",
    )
  }
}

const shapeOverrides = (s: ShapeContext, v: NameOverride[] | null, at: string): void => {
  if (v === null) {
    return
  }
  for (const o of v) {
    if (o.value === "") {
      shapeFail(s, `${at}.${o.language}`, "a non-empty string")
    }
  }
}

/** A reference to a declared source; null means the main source. */
const shapeSourceRef = (s: ShapeContext, v: string | null, at: string): void => {
  if (v === null) {
    return
  }
  const id: string = v
  if (!vocabHas(s.ids, id)) {
    const declared = s.ids.length > 0 ? s.ids.join(", ") : "none declared"
    shapeFail(s, at, `"${id}" is not an id from contract.sources (${declared})`)
  }
}

const shapeLiteral = (s: ShapeContext, lit: Literal, at: string): void => {
  const label = lit.label
  if (label !== null && !charsHasLetter(label)) {
    shapeFail(s, `${at}.label`, "the name the RFC prints the value under, with a letter")
  }
  const unchecked = lit.unchecked
  if (unchecked !== null && trim(unchecked) === "") {
    shapeFail(s, `${at}.unchecked`, "a non-empty reason")
  }
  if (lit.kind === LitKind.Hex) {
    if (!charsIsLowerHex(lit.text, -1)) {
      shapeFail(s, `${at}.hex`, "lowercase hex with an even number of digits")
    }
  } else if (lit.kind === LitKind.Str) {
    if (!charsIsStringText(lit.text)) {
      shapeFail(s, `${at}.str`, "a string of printable ASCII, tab, LF or CR")
    }
  } else if (lit.kind === LitKind.F64) {
    shapeF64Literal(s, lit, at)
  } else if (lit.kind === LitKind.Concat) {
    for (let i = 0; i < lit.parts.length; i++) {
      shapeLiteral(s, lit.parts[i], `${at}.concat[${i}]`)
    }
  } else if (typesIsWords(lit.kind)) {
    const key = typesWordsKey(lit.kind)
    const digits = vocabWordDigits(key)
    if (!charsIsWordList(lit.words, digits)) {
      shapeFail(s, `${at}.${key}`, `words of ${digits} lowercase hex digits, with 0x on every word or on none`)
    }
  }
}

const shapeF64Literal = (s: ShapeContext, lit: Literal, at: string): void => {
  const text = lit.text
  if (!charsIsF64Text(text)) {
    shapeFail(s, `${at}.f64`, SHAPE_F64_TEXT)
    return
  }
  if (contractF64Overflows(text)) {
    shapeFail(s, `${at}.f64`, `"${text}" ${SHAPE_OVERFLOW}`)
    return
  }
  const bitsOrNull = lit.bits
  if (bitsOrNull === null) {
    return
  }
  const bits: string = bitsOrNull
  if (!charsIsLowerHex(bits, 16)) {
    shapeFail(s, `${at}.bits`, "the binary64 encoding as 16 lowercase hex digits (IEEE 754-2019 §3.4)")
    return
  }
  const x = contractF64Parse(text)
  if (contractF64IsNaN(x)) {
    const decoded = contractF64FromBits(bits)
    if (decoded.isErr() || !contractF64IsNaN(decoded.value)) {
      shapeFail(s, `${at}.bits`, `${bits} is not a NaN encoding`)
    }
    return
  }
  const want = contractF64Bits(x)
  if (want !== bits) {
    shapeFail(s, `${at}.bits`, `${text} reads as ${want} (roundTiesToEven, IEEE 754-2019 §5.12.2), not ${bits}`)
  }
}

const shapeExpr = (s: ShapeContext, e: Expr, at: string): void => {
  if (e.kind === ExprKind.Lit) {
    const lit = e.lit
    if (lit !== null) {
      shapeLiteral(s, lit, at)
    }
    return
  }
  if (e.kind === ExprKind.Var) {
    if (!charsIsIdent(e.name)) {
      shapeFail(s, `${at}.var`, "an identifier")
    }
    return
  }
  if (e.kind === ExprKind.Let) {
    for (let i = 0; i < e.binds.length; i++) {
      const b = e.binds[i]
      const bat = `${at}.let[${i}]`
      if (!charsIsIdent(b.name)) {
        shapeFail(s, `${bat}.name`, "an identifier")
      }
      shapeExpr(s, b.value, `${bat}.value`)
    }
    const body = e.body
    if (body !== null) {
      shapeExpr(s, body, `${at}.in`)
    }
    return
  }
  if (e.kind === ExprKind.Call) {
    if (!charsIsIdent(e.name)) {
      shapeFail(s, `${at}.call`, "an identifier")
    }
  } else if (!vocabHas(vocabOps(), e.name)) {
    shapeFail(s, `${at}.op`, `one of ${vocabOps().join(" ")}`)
  }
  for (let i = 0; i < e.args.length; i++) {
    shapeExpr(s, e.args[i], `${at}.args[${i}]`)
  }
}

/** `source` and `sources`, collecting the declared source ids. */
const shapeSources = (s: ShapeContext): void => {
  const c = s.c
  const src = c.source
  shapeText(s, src.title, "contract.source.title")
  const sha = src.sha256
  if (sha !== null && !charsIsLowerHex(sha, 64)) {
    shapeFail(s, "contract.source.sha256", "64 lowercase hex digits")
  }
  const decls = c.sources
  // `rfc` names the main source; `main` names it among `sources` instead.
  const rfcForm = src.rfc >= 1 || decls === null
  const mainId = rfcForm && src.rfc >= 1 ? `rfc${src.rfc}` : ""
  if (rfcForm) {
    if (mainId === "") {
      shapeFail(s, "contract.source.rfc", "the RFC number")
    }
    if (src.main !== null) {
      shapeFail(s, "contract.source.main", "only with contract.sources")
      if (decls !== null) {
        shapeFail(s, "contract.source.rfc", "with contract.source.main, give the RFC number on its entry there")
      }
    }
  }
  if (decls === null) {
    if (mainId !== "") {
      s.ids.push(mainId)
    }
    return
  }
  if (decls.length === 0) {
    shapeFail(s, "contract.sources", "a non-empty array")
    return
  }
  const ds: SourceDecl[] = decls
  for (let i = 0; i < ds.length; i++) {
    const d = ds[i]
    const at = `sources[${i}]`
    if (!charsIsId(d.id)) {
      shapeFail(s, `${at}.id`, "an id")
    } else if (vocabHas(s.ids, d.id)) {
      shapeFail(s, `${at}.id`, `duplicate source id "${d.id}"`)
    } else {
      s.ids.push(d.id)
    }
    const path = d.path
    if (path !== null) {
      if (path === "") {
        shapeFail(s, `${at}.path`, "a file path")
      } else if (path.startsWith("/")) {
        shapeFail(s, `${at}.path`, `a path relative to the contract, not ${path}`)
      }
    }
    if (d.rfc < 1 && path === null) {
      shapeFail(s, at, `needs "rfc", "path" or both`)
    }
    const file = d.file
    if (file !== null && !shapeIsRepoPath(file)) {
      shapeFail(s, `${at}.file`, "a path inside the repo, with / separators, like rfcs/rfc4648.txt")
    }
    const dsha = d.sha256
    if (dsha !== null && !charsIsLowerHex(dsha, 64)) {
      shapeFail(s, `${at}.sha256`, "64 lowercase hex digits")
    }
    if (d.id === mainId && d.rfc >= 1 && d.rfc !== src.rfc) {
      shapeFail(s, `${at}.rfc`, `${src.rfc}, as contract.source.rfc says`)
    }
  }
  if (mainId !== "") {
    if (!vocabHas(s.ids, mainId)) {
      s.ids.push(mainId)
    }
  } else if (!rfcForm) {
    const main = src.main
    if (main === null || !vocabHas(s.ids, main)) {
      shapeFail(s, "contract.source.main", "the id of the main source in contract.sources")
    }
  }
}

/** A path part that is not empty, `.` or `..`. */
const shapeIsPathPart = (part: string): boolean => part !== "" && part !== "." && part !== ".."

/** A repo-relative path: `/`-separated, no empty, `.` or `..` part, no backslash. */
const shapeIsRepoPath = (p: string): boolean => {
  if (p.indexOf("\\") >= 0) {
    return false
  }
  // Each part ends at a "/" or at the end of `p`.
  let start = 0
  for (let i = 0; i < p.length; i++) {
    if (p.charCodeAt(i) === 0x2f) {
      if (!shapeIsPathPart(p.substring(start, i))) {
        return false
      }
      start = i + 1
    }
  }
  return shapeIsPathPart(p.substring(start, p.length))
}

const shapeFunctions = (s: ShapeContext): void => {
  const fns = s.c.functions
  if (fns.length === 0) {
    shapeFail(s, "contract.functions", "a non-empty array")
  }
  const sig = vocabSigTypes()
  const reserved = shapeTestNames()
  const prefixes = shapeTestPrefixes()
  for (let i = 0; i < fns.length; i++) {
    const f = fns[i]
    const at = `functions[${i}]`
    const module = f.module
    if (module !== null) {
      shapeModule(s, module, `${at}.module`)
    }
    shapeOverrides(s, f.names, `${at}.names`)
    if (!charsIsIdent(f.name)) {
      shapeFail(s, `${at}.name`, "an identifier")
    } else {
      let taken = vocabHas(reserved, f.name)
      for (const p of prefixes) {
        taken = taken || f.name.startsWith(p)
      }
      if (taken) {
        shapeFail(
          s,
          `${at}.name`,
          `"${f.name}" is a name the generated test uses itself (its helpers and locals, and names starting ${prefixes.join(" ")}), so the test cannot call such a function`,
        )
      }
    }
    if (!vocabHas(sig, f.returns)) {
      shapeFail(s, `${at}.returns`, `one of ${sig.join(" ")}`)
    }
    for (let j = 0; j < f.params.length; j++) {
      const p = f.params[j]
      const pat = `${at}.params[${j}]`
      if (!charsIsIdent(p.name)) {
        shapeFail(s, `${pat}.name`, "an identifier")
      }
      shapeOverrides(s, p.names, `${pat}.names`)
      if (!vocabHas(sig, p.type)) {
        shapeFail(s, `${pat}.type`, `one of ${sig.join(" ")}`)
      }
      const form = p.form
      if (form !== null) {
        if (form !== "window") {
          shapeFail(s, `${pat}.form`, `"window", or absent`)
        } else if (p.type !== "bytes") {
          shapeFail(s, `${pat}.form`, `absent: a window is a bytes parameter, not ${p.type}`)
        }
      }
    }
    const out = f.out
    if (out !== null) {
      shapeOut(s, f, out, `${at}.out`)
    }
  }
}

/** An out buffer: where its pair goes, a bytes result, and a capacity in its one spelling over bytes lengths. */
const shapeOut = (s: ShapeContext, f: FnSig, out: OutBuffer, at: string): void => {
  if (out.at < 0 || out.at > toI32(f.params.length)) {
    shapeFail(s, `${at}.at`, `an index in 0..${f.params.length}, where among the parameters the (out, at) pair goes`)
  }
  if (f.returns !== "bytes" && f.returns !== "bytes?") {
    shapeFail(s, `${at}`, `absent: an out buffer's function returns bytes or bytes?, not ${f.returns}`)
  }
  const e = capacityParse(out.capacity)
  if (e.isErr()) {
    shapeFail(s, `${at}.capacity`, `a capacity; it ${e.error}`)
    return
  }
  const shown = capacityShow(e.value)
  if (shown !== out.capacity) {
    shapeFail(s, `${at}.capacity`, `"${shown}", the one spelling of that capacity`)
  }
  for (const n of capacityNames(e.value)) {
    let found = false
    for (const p of f.params) {
      found = found || (p.name === n && p.type === "bytes")
    }
    if (!found) {
      shapeFail(s, `${at}.capacity`, `reads ${n}.length, but ${n} is not a bytes parameter of ${f.name}`)
    }
  }
}

const shapeRequirements = (s: ShapeContext): void => {
  const reqs = s.c.requirements
  if (reqs.length === 0) {
    shapeFail(s, "contract.requirements", "a non-empty array")
  }
  const levels = vocabLevels()
  for (let i = 0; i < reqs.length; i++) {
    const r = reqs[i]
    const at = `requirements[${i}]`
    shapeSourceRef(s, r.source, `${at}.source`)
    if (!charsIsId(r.id)) {
      shapeFail(s, `${at}.id`, "an id")
    }
    if (!charsIsSection(r.section)) {
      shapeFail(s, `${at}.section`, `a section number like "2.3" or "A.1"`)
    }
    if (!vocabHas(levels, r.level)) {
      shapeFail(s, `${at}.level`, `one of ${levels.join(", ")}`)
    }
    shapeText(s, r.quote, `${at}.quote`)
  }
  const xs = s.c.exclusions
  if (xs === null) {
    return
  }
  const ys: Exclusion[] = xs
  for (let i = 0; i < ys.length; i++) {
    const x = ys[i]
    const at = `exclusions[${i}]`
    shapeSourceRef(s, x.source, `${at}.source`)
    shapeSection(s, x.section, `${at}.section`)
    shapeText(s, x.quote, `${at}.quote`)
    shapeText(s, x.reason, `${at}.reason`)
  }
}

const shapeTolerance = (s: ShapeContext, t: Tolerance, at: string): void => {
  if (!t.isUlps) {
    if (!charsIsAbs(t.abs)) {
      shapeFail(s, `${at}.abs`, "a non-negative decimal as text")
    } else if (contractF64Overflows(t.abs)) {
      shapeFail(s, `${at}.abs`, `"${t.abs}" ${SHAPE_OVERFLOW}`)
    }
  }
  shapeSourceRef(s, t.source, `${at}.source`)
  shapeSection(s, t.section, `${at}.section`)
  shapeText(s, t.quote, `${at}.quote`)
}

/** The declared function named `name`; null when none is. */
const shapeFn = (s: ShapeContext, name: string): FnSig | null => {
  for (const f of s.c.functions) {
    if (f.name === name) {
      return f
    }
  }
  return null
}

/** Whether `e` is the vector's call on exactly its iterate names, in order. */
const shapeIsIterateCall = (e: Expr, call: string, names: string[]): boolean => {
  if (e.kind !== ExprKind.Call || e.name !== call || e.args.length !== names.length) {
    return false
  }
  const args = e.args
  for (let i = 0; i < names.length; i++) {
    if (i >= args.length) {
      return false
    }
    const a = args[i]
    if (a.kind !== ExprKind.Var || a.name !== names[i]) {
      return false
    }
  }
  return true
}

/** A vector's `truncate`: a bytes result held to its first `bytes`, which are the whole expect. */
const shapeTruncate = (s: ShapeContext, k: Clause, t: Truncate, at: string): void => {
  if (t.bytes < 1 || t.bytes > 65536) {
    shapeFail(s, at, "a length of 1..65536 bytes")
  }
  if (t.unit !== "bits" && t.unit !== "bytes") {
    shapeFail(s, at, "a length in bits or bytes")
  }
  if (k.tolerance !== null) {
    shapeFail(s, at, "a truncated vector compares bytes exactly; drop the tolerance")
  }
  if (k.iterate !== null) {
    shapeFail(s, at, "a vector is truncated or iterated, not both")
  }
  const expect = k.expect
  if (expect === null) {
    return
  }
  const n = literalsByteLength(expect)
  if (n < 0) {
    shapeFail(s, at, `a truncated vector's expect is bytes, not ${typeOfLiteral(expect)}`)
  } else if (n !== t.bytes) {
    shapeFail(
      s,
      at,
      `the expect is ${n} bytes, so the truncation is ${n} bytes (${n << 3} bits), not ${t.bytes} bytes (${t.bytes << 3} bits)`,
    )
  }
}

/** A vector's `iterate`: a count in range, one name and one next element per parameter, at least one the call. */
const shapeIterate = (s: ShapeContext, k: Clause, it: Iterate, at: string): void => {
  if (it.count < 1 || it.count > 1000000000) {
    shapeFail(s, `${at}.count`, "an integer in 1..1000000000")
  }
  if (k.tolerance !== null) {
    shapeFail(s, at, "an iterated vector compares its last result exactly; drop the tolerance")
  }
  const expect = k.expect
  if (expect !== null && (expect.kind === LitKind.Null || expect.kind === LitKind.Bool)) {
    shapeFail(s, at, "an iterated vector's expect is a value its call returns, not null or a bool")
  }
  const sig = shapeFn(s, k.call)
  const arity = sig === null ? -1 : sig.params.length
  if (arity >= 0 && it.names.length !== arity) {
    shapeFail(s, `${at}.names`, `one name per parameter of ${k.call}: ${arity}, got ${it.names.length}`)
  }
  const names = it.names
  for (let i = 0; i < names.length; i++) {
    const n = names[i]
    if (!charsIsIdent(n)) {
      shapeFail(s, `${at}.names[${i}]`, "an identifier")
    } else if (shapeFn(s, n) !== null) {
      shapeFail(s, `${at}.names[${i}]`, `"${n}" shadows a function`)
    }
    for (let j = 0; j < i; j++) {
      if (j >= names.length) {
        // Unreachable: j < i < names.length. Fail closed all the same.
        shapeFail(s, `${at}.names[${j}]`, "missing")
        break
      }
      if (names[j] === n) {
        shapeFail(s, `${at}.names[${i}]`, `"${n}" repeats names[${j}]`)
      }
    }
  }
  if (arity >= 0 && it.next.length !== arity) {
    shapeFail(s, `${at}.next`, `one element per parameter of ${k.call}: ${arity}, got ${it.next.length}`)
  }
  let calls: u32 = 0
  for (let i = 0; i < it.next.length; i++) {
    const e = it.next[i]
    if (e.kind === ExprKind.Var) {
      if (!vocabHas(it.names, e.name)) {
        shapeFail(s, `${at}.next[${i}]`, `"${e.name}" is not one of the names`)
      }
    } else if (e.kind === ExprKind.Call) {
      if (!shapeIsIterateCall(e, k.call, it.names)) {
        shapeFail(s, `${at}.next[${i}]`, `a call is ${k.call} on the names, in order`)
      }
      calls++
    } else {
      shapeFail(s, `${at}.next[${i}]`, `a name or ${k.call} on the names`)
    }
  }
  if (calls === 0 && it.next.length > 0) {
    shapeFail(s, `${at}.next`, `no element is ${k.call} on the names, so nothing feeds the result back`)
  }
}

const shapeNeedSection = (s: ShapeContext, k: Clause, at: string): void => {
  const sec = k.section
  if (sec === null || !charsIsSection(sec)) {
    shapeFail(
      s,
      `${at}.section`,
      "the section number printing the args, in the main source or the one sectionSource names",
    )
  }
}

/** A vector's `source` (where its expected value comes from) and the `section` it may need. */
const shapeVectorSource = (s: ShapeContext, k: Clause, at: string): void => {
  const src = k.source
  if (src === null) {
    return
  }
  const expect = k.expect
  const ek: LitKind = expect === null ? LitKind.Null : expect.kind
  const absent = expect === null
  if (src.kind === VectorSourceKind.Cite) {
    const cite = src.cite
    if (cite !== null) {
      shapeSourceRef(s, cite.source, `${at}.source.cite.source`)
      shapeSection(s, cite.section, `${at}.source.cite.section`)
      const tc = cite.testCase
      if (tc !== null && charsTestVector(tc) === 0) {
        shapeFail(
          s,
          `${at}.source.cite.case`,
          "a test case of the section, as Test Vector #N (N from 1, no leading zero)",
        )
      }
    }
    if (k.section !== null) {
      shapeFail(s, `${at}.section`, `a cited vector's args are read in source.cite; drop "section"`)
    }
  } else if (src.kind === VectorSourceKind.Command) {
    if (trim(src.text) === "") {
      shapeFail(s, `${at}.source.command`, "a shell command")
    }
    if (absent || !literalsPrintable(ek)) {
      shapeFail(s, `${at}.expect`, `${LITERALS_PRINTABLE}; an f64 or words has no one printed form`)
    }
    shapeNeedSection(s, k, at)
    shapeSourceRef(s, k.sectionSource, `${at}.sectionSource`)
    const top = s.c.source
    const main = top.rfc >= 1 ? `rfc${top.rfc}` : top.main ?? ""
    const own = k.sectionSource
    if (own !== null && own === main) {
      shapeFail(s, `${at}.sectionSource`, `"${own}" is the main source; drop "sectionSource"`)
    }
  } else {
    if (!charsIsSection(src.text)) {
      shapeFail(s, `${at}.source.spec`, "a main-source section number")
    }
    if (absent || (ek !== LitKind.Null && ek !== LitKind.Bool)) {
      shapeFail(s, `${at}.expect`, "a spec source states only null or a bool; cite or compute any other value")
    }
    shapeNeedSection(s, k, at)
  }
  if (src.kind !== VectorSourceKind.Command && k.sectionSource !== null) {
    shapeFail(s, `${at}.sectionSource`, `only a command source's section is in another source; drop "sectionSource"`)
  }
}

const shapeForall = (s: ShapeContext, v: ForallVar, at: string): void => {
  if (!charsIsIdent(v.name)) {
    shapeFail(s, `${at}.name`, "an identifier")
  }
  if (vocabIsIntType(v.type)) {
    const lo = vocabIntMin(v.type)
    const hi = vocabIntMax(v.type)
    const ok = vocabFitsInt(v.min, v.type) && vocabFitsInt(v.max, v.type) && vocabCompareDecimal(v.min, v.max) <= 0
    if (!ok) {
      shapeFail(s, at, `${v.type} needs min <= max, both in ${lo}..${hi}`)
    }
  } else if (v.type === "f64") {
    const bounds = [v.min, v.max]
    let valid = true
    for (let i = 0; i < bounds.length; i++) {
      const key = i === 0 ? "min" : "max"
      if (!charsIsF64Text(bounds[i]) || bounds[i] === "NaN") {
        valid = false
        shapeFail(
          s,
          `${at}.${key}`,
          "decimal text (RFC 8259 §6 number syntax), Infinity or -Infinity (a bound cannot be NaN: it orders nothing, IEEE 754-2019 §5.11)",
        )
      } else if (contractF64Overflows(bounds[i])) {
        shapeFail(s, `${at}.${key}`, `"${bounds[i]}" ${SHAPE_OVERFLOW}`)
      }
    }
    if (valid && !(contractF64Parse(v.min) <= contractF64Parse(v.max))) {
      shapeFail(s, at, "f64 needs min <= max")
    }
  } else {
    if (v.minLen > v.maxLen) {
      shapeFail(s, at, `${v.type} needs integer 0 <= minLen <= maxLen <= ${SHAPE_MAX_LEN}`)
    }
    const alphabet = v.alphabet
    if (alphabet !== null) {
      if (alphabet.length === 0) {
        shapeFail(s, `${at}.alphabet`, "a non-empty array of characters and classes")
      }
      const chars: string[] = alphabet
      for (let i = 0; i < chars.length; i++) {
        if (shapeAlphabetChars(chars[i]) === null) {
          shapeFail(
            s,
            `${at}.alphabet[${i}]`,
            `one printable ASCII character (or tab, LF, CR) or a class: ${shapeAlphabetClasses().join(" ")}`,
          )
        }
      }
    }
  }
}

const shapeClauses = (s: ShapeContext): void => {
  const ks = s.c.clauses
  if (ks.length === 0) {
    shapeFail(s, "contract.clauses", "a non-empty array")
  }
  for (let i = 0; i < ks.length; i++) {
    const k = ks[i]
    const at = `clauses[${i}]`
    if (!charsIsId(k.id)) {
      shapeFail(s, `${at}.id`, "an id")
    }
    shapeText(s, k.title, `${at}.title`)
    if (k.covers.length === 0) {
      shapeFail(s, `${at}.covers`, "a non-empty array of requirement ids")
    }
    if (k.kind === ClauseKind.Vector) {
      const tol = k.tolerance
      if (tol !== null) {
        shapeTolerance(s, tol, `${at}.tolerance`)
      }
      shapeVectorSource(s, k, at)
      const it = k.iterate
      if (it !== null) {
        shapeIterate(s, k, it, `${at}.iterate`)
      }
      const tr = k.truncate
      if (tr !== null) {
        shapeTruncate(s, k, tr, `${at}.truncate`)
      }
      if (!charsIsIdent(k.call)) {
        shapeFail(s, `${at}.call`, "a function name")
      }
      for (let j = 0; j < k.args.length; j++) {
        shapeLiteral(s, k.args[j], `${at}.args[${j}]`)
      }
      const expect = k.expect
      if (expect !== null) {
        shapeLiteral(s, expect, `${at}.expect`)
      }
    } else {
      for (let j = 0; j < k.forall.length; j++) {
        shapeForall(s, k.forall[j], `${at}.forall[${j}]`)
      }
      const where = k.where
      if (where !== null) {
        shapeExpr(s, where, `${at}.where`)
      }
      const assert = k.assert
      if (assert !== null) {
        shapeExpr(s, assert, `${at}.assert`)
      }
    }
  }
}

/** The functions the contract tests in its target module. */
const shapeTested = (c: Contract): string[] => {
  const out: string[] = []
  for (const f of c.functions) {
    const m = f.module
    if (m === null || m === c.target.module) {
      out.push(f.name)
    }
  }
  return out
}

const shapeOutOfScope = (s: ShapeContext): void => {
  const xs = s.c.outOfScope
  if (xs === null) {
    return
  }
  const tested = shapeTested(s.c)
  const seen: string[] = []
  const ys: OutOfScope[] = xs
  for (let i = 0; i < ys.length; i++) {
    const x = ys[i]
    const at = `outOfScope[${i}]`
    shapeText(s, x.reason, `${at}.reason`)
    if (!charsIsIdent(x.name)) {
      shapeFail(s, `${at}.name`, "an identifier")
    } else {
      if (vocabHas(seen, x.name)) {
        shapeFail(s, `${at}.name`, `duplicate "${x.name}"`)
      }
      seen.push(x.name)
      if (vocabHas(tested, x.name)) {
        shapeFail(s, `${at}.name`, `"${x.name}" is a function the contract tests, so it cannot be out of scope`)
      }
    }
  }
}

const shapeAllowSurvivors = (s: ShapeContext): void => {
  const xs = s.c.allowSurvivors
  if (xs === null) {
    return
  }
  const target = shapeNishModuleFile(s.c.target.module)
  const seen: string[] = []
  const ys: AllowedSurvivor[] = xs
  for (let i = 0; i < ys.length; i++) {
    const x = ys[i]
    const at = `allowSurvivors[${i}]`
    shapeText(s, x.file, `${at}.file`)
    shapeText(s, x.reason, `${at}.reason`)
    if (x.file === "") {
      continue
    }
    if (target !== null && x.file !== target) {
      shapeFail(s, `${at}.file`, `${x.file} is not the target module's file ${target}`)
    }
    const key = `${x.file}:${x.line}`
    if (vocabHas(seen, key)) {
      shapeFail(s, at, `duplicate allowance for ${key}`)
    }
    seen.push(key)
  }
}

/**
 * Every error in a contract's values, once its structure has been read: the
 * patterns, enums, bounds, source references and free text the schema and
 * the generated test require.
 *
 * @param c a contract read by contractFromJson
 * @returns each error as `<path>: <what was wanted>`; empty when there is none
 */
export const contractShapeErrors = (c: Contract): string[] => {
  const s = new ShapeContext(c)
  if (!charsIsId(c.contract)) {
    shapeFail(s, "contract.contract", "an id ([A-Za-z0-9._-])")
  }
  shapeSources(s)
  shapeModule(s, c.target.module, "contract.target.module")
  shapeOverrides(s, c.target.modules, "contract.target.modules")
  shapeRequirements(s)
  shapeFunctions(s)
  shapeOutOfScope(s)
  shapeAllowSurvivors(s)
  shapeClauses(s)
  return s.errors
}
