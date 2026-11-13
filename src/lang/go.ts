/**
 * `lang/go` — the Go table: how Go writes each construct of the
 * contract vocabulary, and what it drops. Its name and module rules are in
 * `lang/names`.
 */

import { LangTable, langSpell, langUnsupported } from "./table"

/**
 * The Go table.
 *
 * @returns Go's mapping of every construct, its standards and its choices
 */
export const langTableGo = (): LangTable => {
  const t = new LangTable(
    "go",
    "Go",
    "The Go Programming Language Specification, Types (Numeric types, String types, Slice types)",
    "Effective Go, Names (MixedCaps; an upper-case first letter exports) and Go Code Review Comments, Initialisms",
  )
  t.type("bytes", langSpell("[]byte", ""))
  t.type("string", langSpell("string", "a Go string may hold any bytes; the UTF-8 guarantee is the implementation's"))
  t.type("bool", langSpell("bool", ""))
  t.type("f64", langSpell("float64", "IEEE 754 binary64 (Spec, Numeric types)"))
  t.type("secret-bytes", langSpell("[]byte", "no secret type; secrecy is dropped"))
  t.type("i8", langSpell("int8", ""))
  t.type("i16", langSpell("int16", ""))
  t.type("i32", langSpell("int32", ""))
  t.type("i64", langSpell("int64", ""))
  t.type("u8", langSpell("uint8", ""))
  t.type("u16", langSpell("uint16", ""))
  t.type("u32", langSpell("uint32", ""))
  t.type("u64", langSpell("uint64", ""))
  t.outcome(
    "refusing-return",
    langSpell("({T}, error)", "a non-nil error is the refusal; which error it is is outside the contract"),
  )
  t.outcome("optional-input", langSpell("*{T}", "nil is the absent argument"))
  t.literal("hex", langSpell("[]byte{0x0b, 0x0b}", ""))
  t.literal("ascii", langSpell('[]byte("abc")', ""))
  t.literal("str", langSpell('"abc"', "non-ASCII and control characters as \\u escapes, a scalar above U+FFFF as \\U"))
  t.literal("int", langSpell("uint32(42)", "converted to its type, so every width is exact"))
  t.literal(
    "f64",
    langSpell("math.Float64frombits(0x3ff8000000000000)", "from its bits, so -0 and NaN payloads are exact"),
  )
  t.literal("bool", langSpell("true", ""))
  t.literal("null", langSpell("nil", ""))
  t.literal("concat", langSpell("append(append([]byte{}, a...), b...)", ""))
  t.moduleForm = "package"
  t.moduleNote =
    'the neutral path is the import path; the package name is its last segment without underscores (Effective Go, Package names): nish/crypto/hkdf → import "nish/crypto/hkdf", package hkdf'
  t.nameRule =
    "MixedCaps: a function is exported, so its first letter is a capital (hkdfExpandSha256 → HkdfExpandSha256); a parameter is unexported (lowerCamel). Words split at each capital and a digit run stays on the word before it (chacha20Poly1305Seal → Chacha20Poly1305Seal). An initialism, one the contract writes in capitals or one in golint's list (ID, URL, HTTP, UTF8, …), is all capitals after the first word (userId → userID, parseHttpRequest → ParseHTTPRequest); HKDF and SHA are not on the list, so they stay Hkdf and Sha. A name override always wins."
  t.choices.push(
    "A refusing return is (T, error): Go has no optional, and the error result is how Go reports that a call declined (Effective Go, Errors). The contract gives no reason, so any non-nil error is the refusal and its message is dropped.",
  )
  t.choices.push(
    "An optional input is a pointer *T, nil when absent, so absent and empty stay distinct (a nil []byte and an empty one compare equal under len).",
  )
  t.choices.push(
    "Initialisms follow a fixed list (golint's commonInitialisms) plus whatever the contract writes in capitals, so the rule is deterministic; HKDF, HMAC, SHA, AEAD are not on the list, and a name override can spell them HKDF.",
  )
  return t
}
