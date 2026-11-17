/**
 * `lang/swift` — the Swift table: how Swift writes each construct of the
 * contract vocabulary, and what it drops. Its name and module rules are in
 * `lang/names`.
 */

import { LangTable, langSpell, langUnsupported } from "./table"

/**
 * The Swift table.
 *
 * @returns Swift's mapping of every construct, its standards and its choices
 */
export const langTableSwift = (): LangTable => {
  const t = new LangTable(
    "swift",
    "Swift",
    "The Swift Programming Language (Swift 5.9), The Basics › Integers, Floating-Point Numbers, Optionals",
    "Swift API Design Guidelines, Conventions › General Conventions (lowerCamelCase; acronyms uniformly cased as written)",
  )
  t.type("bytes", langSpell("[UInt8]", "Data would also do; [UInt8] needs no Foundation"))
  t.type("string", langSpell("String", "every Unicode scalar value is representable"))
  t.type("bool", langSpell("Bool", ""))
  t.type("f64", langSpell("Double", "IEEE 754 binary64"))
  t.type(
    "secret-bytes",
    langSpell("[UInt8]", "no secret type; secrecy is dropped (CryptoKit's SymmetricKey is one where available)"),
  )
  t.type("i8", langSpell("Int8", ""))
  t.type("i16", langSpell("Int16", ""))
  t.type("i32", langSpell("Int32", ""))
  t.type("i64", langSpell("Int64", ""))
  t.type("u8", langSpell("UInt8", ""))
  t.type("u16", langSpell("UInt16", ""))
  t.type("u32", langSpell("UInt32", ""))
  t.type("u64", langSpell("UInt64", ""))
  t.outcome("refusing-return", langSpell("{T}?", "nil is the refusal"))
  t.outcome("optional-input", langSpell("{T}? = nil", "nil is the absent argument"))
  t.literal("hex", langSpell("[0x0b, 0x0b] as [UInt8]", ""))
  t.literal("ascii", langSpell('Array("abc".utf8)', ""))
  t.literal("str", langSpell('"abc"', "non-ASCII as \\u{…} escapes; a backslash written \\\\, since \\( interpolates"))
  t.literal("int", langSpell("UInt32(42)", "every width exact"))
  t.literal(
    "f64",
    langSpell("Double(bitPattern: 0x3ff8000000000000)", "from its bits, so -0 and NaN payloads are exact"),
  )
  t.literal("bool", langSpell("true", ""))
  t.literal("null", langSpell("nil", ""))
  t.literal("concat", langSpell("a + b", ""))
  t.type("words16", langSpell("[UInt16]", ""))
  t.type("words32", langSpell("[UInt32]", ""))
  t.type("words64", langSpell("[UInt64]", ""))
  t.literal("words16", langSpell("[0x6170, 0x7865] as [UInt16]", ""))
  t.literal("words32", langSpell("[0x61707865, 0x3320646e] as [UInt32]", ""))
  t.literal("words64", langSpell("[0x3320646e61707865, 0x6b20657479622d32] as [UInt64]", ""))
  t.moduleForm = "module"
  t.moduleNote =
    "Swift modules do not nest, so one module named by the segments in UpperCamelCase, joined: nish/crypto/hkdf → NishCryptoHkdf"
  t.nameRule =
    "functions and parameters lowerCamelCase with words as the contract writes them, so an acronym keeps its uniform case (API Design Guidelines): parseHTTPRequest → parseHTTPRequest, hkdfExpandSha256 → hkdfExpandSha256. A name that is a keyword takes a name override (or backticks)."
  t.choices.push(
    "A refusing return is an Optional ({T}?), not throws: the refusals are simple domain errors with no reason to report, the case Swift's error-handling rationale gives Optional.",
  )
  t.choices.push("Modules do not nest, so the module path is flattened into one UpperCamelCase name.")
  return t
}
