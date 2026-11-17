/**
 * `spec/contract/vocab` — the neutral vocabulary a contract is written in: the
 * value types of a signature, the literal kinds, the expression operators, the
 * requirement levels and the languages a name can be overridden for. Each list
 * is the matching enum of `schemas/rfc-contract.json`, in its order, and
 * tests/spec/contract/vocab_test.ts holds the two in step.
 *
 * Integers are exact: a value is carried as decimal text and compared as text,
 * never through f64, so every i64 and u64 is exact.
 */

/**
 * The integer types, signed then unsigned, by width.
 *
 * @returns i8 i16 i32 i64 u8 u16 u32 u64
 */
export const vocabIntTypes = (): string[] => ["i8", "i16", "i32", "i64", "u8", "u16", "u32", "u64"]

/**
 * The word-array types, by word width: arrays of u16, u32 and u64.
 *
 * @returns words16 words32 words64
 */
export const vocabWordTypes = (): string[] => ["words16", "words32", "words64"]

/**
 * Whether a type is one of the word-array types.
 *
 * @param t a type
 * @returns true for words16, words32 and words64
 */
export const vocabIsWordType = (t: string): boolean => vocabHas(vocabWordTypes(), t)

/**
 * How many hex digits one word of a word-array type is printed with.
 *
 * @param t a word-array type
 * @returns 4 for words16, 8 for words32, 16 for words64, 0 otherwise
 */
export const vocabWordDigits = (t: string): i32 => {
  if (t === "words16") {
    return 4
  }
  if (t === "words32") {
    return 8
  }
  if (t === "words64") {
    return 16
  }
  return 0
}

/**
 * The value types a parameter or return can have, before the optional `?`.
 *
 * @returns bytes, string, bool, f64, secret-bytes, each integer type, then
 * each word-array type
 */
export const vocabBaseTypes = (): string[] => {
  const out = ["bytes", "string", "bool", "f64", "secret-bytes"]
  for (const t of vocabIntTypes()) {
    out.push(t)
  }
  for (const t of vocabWordTypes()) {
    out.push(t)
  }
  return out
}

/**
 * The types a signature names: each base type, plain and optional (`T?`).
 *
 * @returns the schema's paramType enum, in its order
 */
export const vocabSigTypes = (): string[] => {
  const out: string[] = []
  for (const t of vocabBaseTypes()) {
    out.push(t)
    out.push(`${t}?`)
  }
  return out
}

/**
 * The literal kinds, each named by the key that opens it.
 *
 * @returns hex ascii str int f64 bool null concat words16 words32 words64
 */
export const vocabLiteralKinds = (): string[] => [
  "hex",
  "ascii",
  "str",
  "int",
  "f64",
  "bool",
  "null",
  "concat",
  "words16",
  "words32",
  "words64",
]

/**
 * The languages a module path or a name can be overridden for.
 *
 * @returns the schema's moduleOverrides keys, in its order
 */
export const vocabLanguages = (): string[] => [
  "rust",
  "ruby",
  "zig",
  "go",
  "cpp",
  "csharp",
  "c",
  "java",
  "kotlin",
  "python",
  "typescript",
  "php",
  "swift",
  "dart",
]

/**
 * The operators of the expression grammar.
 *
 * @returns the schema's op enum, in its order
 */
export const vocabOps = (): string[] => [
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
]

/**
 * The requirement levels: the BCP 14 keywords, and DEFINITION.
 *
 * @returns the schema's level enum, in its order
 */
export const vocabLevels = (): string[] => [
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
]

/**
 * Whether a level binds an implementation: an absolute requirement or
 * prohibition (RFC 2119 §1, §2), or a definition.
 *
 * @param level a requirement level
 * @returns true for MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT and DEFINITION
 */
export const vocabIsBinding = (level: string): boolean =>
  level === "MUST" ||
  level === "MUST NOT" ||
  level === "REQUIRED" ||
  level === "SHALL" ||
  level === "SHALL NOT" ||
  level === "DEFINITION"

/** How a signature type is read: plainly, or with its `?` meaning absence. */
export enum Outcome {
  /** A plain type: the value is always there. */
  None = 0,
  /** An optional return: the function refuses its input by returning null. */
  RefusingReturn = 1,
  /** An optional parameter: the caller may pass null. */
  OptionalInput = 2,
}

/**
 * Whether a list holds a string.
 *
 * @param list the strings to look in
 * @param s the string to find
 * @returns true when `s` is in `list`
 */
export const vocabHas = (list: string[], s: string): boolean => {
  for (const x of list) {
    if (x === s) {
      return true
    }
  }
  return false
}

/**
 * Whether a signature type is optional.
 *
 * @param t a signature type
 * @returns true when it ends in `?`
 */
export const vocabIsOptional = (t: string): boolean => t.endsWith("?")

/**
 * A signature type without its `?`.
 *
 * @param t a signature type
 * @returns its base type
 */
export const vocabBaseOf = (t: string): string => (t.endsWith("?") ? t.substring(0, t.length - 1) : t)

/**
 * What a signature type's `?` means where it stands.
 *
 * @param isReturn true for a return type, false for a parameter's
 * @param t the signature type
 * @returns RefusingReturn or OptionalInput for an optional type, None otherwise
 */
export const vocabOutcomeOf = (isReturn: boolean, t: string): Outcome => {
  if (!vocabIsOptional(t)) {
    return Outcome.None
  }
  return isReturn ? Outcome.RefusingReturn : Outcome.OptionalInput
}

/**
 * The type a value of a signature type has once it is read: secret bytes are
 * bytes to a test, which only compares them.
 *
 * @param t a signature type
 * @returns `t` with secret-bytes read as bytes
 */
export const vocabValueType = (t: string): string => {
  if (t === "secret-bytes") {
    return "bytes"
  }
  if (t === "secret-bytes?") {
    return "bytes?"
  }
  return t
}

/**
 * Whether a type is one of the integer types.
 *
 * @param t a type
 * @returns true for i8 … u64
 */
export const vocabIsIntType = (t: string): boolean => vocabHas(vocabIntTypes(), t)

/**
 * Whether text is a decimal integer in its one spelling: no leading zeros, no
 * plus sign, and no `-0`.
 *
 * @param s the text
 * @returns true for text like `0`, `-12` or `18446744073709551615`
 */
export const vocabIsDecimal = (s: string): boolean => {
  const start = s.startsWith("-") ? 1 : 0
  if (s.length === start) {
    return false
  }
  for (let i = start; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 48 || c > 57) {
      return false
    }
  }
  if (s.charCodeAt(start) === 48) {
    return s.length === 1
  }
  return true
}

const vocabCompareMagnitude = (a: string, b: string): i32 => {
  if (a.length !== b.length) {
    return a.length < b.length ? -1 : 1
  }
  for (let i = 0; i < a.length; i++) {
    const x = a.charCodeAt(i)
    const y = b.charCodeAt(i)
    if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return 0
}

/**
 * Compares two decimal integers exactly, as text.
 *
 * @param a a decimal integer (vocabIsDecimal)
 * @param b another
 * @returns -1, 0 or 1 as `a` is less than, equal to or greater than `b`
 */
export const vocabCompareDecimal = (a: string, b: string): i32 => {
  const an = a.startsWith("-")
  const bn = b.startsWith("-")
  if (an !== bn) {
    return an ? -1 : 1
  }
  if (an) {
    return vocabCompareMagnitude(b.substring(1, b.length), a.substring(1, a.length))
  }
  return vocabCompareMagnitude(a, b)
}

/**
 * The least value of an integer type, exactly.
 *
 * @param t an integer type
 * @returns its minimum as decimal text: −2^(N−1) for iN, 0 for uN
 */
export const vocabIntMin = (t: string): string => {
  if (t === "i8") {
    return "-128"
  }
  if (t === "i16") {
    return "-32768"
  }
  if (t === "i32") {
    return "-2147483648"
  }
  if (t === "i64") {
    return "-9223372036854775808"
  }
  return "0"
}

/**
 * The greatest value of an integer type, exactly.
 *
 * @param t an integer type
 * @returns its maximum as decimal text: 2^(N−1)−1 for iN, 2^N−1 for uN
 */
export const vocabIntMax = (t: string): string => {
  if (t === "i8") {
    return "127"
  }
  if (t === "i16") {
    return "32767"
  }
  if (t === "i32") {
    return "2147483647"
  }
  if (t === "i64") {
    return "9223372036854775807"
  }
  if (t === "u8") {
    return "255"
  }
  if (t === "u16") {
    return "65535"
  }
  if (t === "u32") {
    return "4294967295"
  }
  return "18446744073709551615"
}

/**
 * Whether a decimal integer lies in an integer type's range.
 *
 * @param value a decimal integer
 * @param t an integer type
 * @returns true when min(t) <= value <= max(t)
 */
export const vocabFitsInt = (value: string, t: string): boolean =>
  vocabCompareDecimal(value, vocabIntMin(t)) >= 0 && vocabCompareDecimal(value, vocabIntMax(t)) <= 0

/** The largest integer a JSON number carries exactly, 2^53−1 (RFC 7493 §2.2). */
export const VOCAB_JSON_SAFE_MAX: string = "9007199254740991"

/**
 * Whether a decimal integer is within ±(2^53−1), so a JSON number carries it
 * exactly (RFC 7493 §2.2).
 *
 * @param value a decimal integer
 * @returns true when |value| <= 2^53−1
 */
export const vocabIsJsonSafe = (value: string): boolean => {
  const mag = value.startsWith("-") ? value.substring(1, value.length) : value
  return vocabCompareMagnitude(mag, VOCAB_JSON_SAFE_MAX) <= 0
}
