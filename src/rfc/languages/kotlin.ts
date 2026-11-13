import { type LanguageTable, camel, packageClass } from "./table.ts";

export const kotlin: LanguageTable = {
  id: "kotlin",
  title: "Kotlin",
  typeStandard:
    "Kotlin Language Specification, Built-in types and their semantics (kotlin.Byte…Long, kotlin.UByte…ULong, nullable types)",
  nameStandard:
    "Kotlin Coding Conventions, Naming rules (lowerCamelCase functions; two-letter acronyms in capitals)",
  types: {
    bytes: {
      spelling: "ByteArray",
      note: "UByteArray is still experimental; elements read unsigned with toUByte()",
    },
    string: {
      spelling: "String",
      note: "UTF-16; every Unicode scalar value is representable",
    },
    bool: { spelling: "Boolean" },
    f64: { spelling: "Double", note: "IEEE 754 binary64" },
    "secret-bytes": {
      spelling: "ByteArray",
      note: "no secret type; secrecy is dropped (fill(0) can wipe a copy)",
    },
    i8: { spelling: "Byte" },
    i16: { spelling: "Short" },
    i32: { spelling: "Int" },
    i64: { spelling: "Long" },
    u8: { spelling: "UByte" },
    u16: { spelling: "UShort" },
    u32: { spelling: "UInt" },
    u64: { spelling: "ULong" },
  },
  outcomes: {
    "refusing-return": { spelling: "{T}?", note: "null is the refusal" },
    "optional-input": {
      spelling: "{T}? = null",
      note: "a nullable parameter, null the absent argument",
    },
  },
  literals: {
    hex: {
      spelling: "byteArrayOf(0x0b, 0x0b)",
      note: 'a byte above 0x7f as 0xff.toByte(); "0b0b".hexToByteArray() needs @OptIn(ExperimentalStdlibApi::class) in Kotlin 1.9',
    },
    ascii: { spelling: '"abc".toByteArray(Charsets.US_ASCII)' },
    str: {
      spelling: '"abc"',
      note: "non-ASCII as \\u escapes, a scalar above U+FFFF as its UTF-16 surrogate pair (Kotlin has no \\U); $ escaped as \\$",
    },
    int: {
      spelling: "42u",
      note: "per width: i8 42.toByte(), i16 42.toShort(), i32 42, i64 42L, u8 42u.toUByte(), u16 42u.toUShort(), u32 42u, u64 42uL; the minimums as Int.MIN_VALUE and Long.MIN_VALUE, since -2147483648 is a Long and -9223372036854775808L does not compile",
    },
    f64: {
      spelling: "Double.fromBits(0x3ff8000000000000uL.toLong())",
      note: "from its bits, so -0 and NaN payloads are exact; the bits are a ULong literal, as a hex Long literal with the sign bit set (-0, any negative value) does not compile",
    },
    bool: { spelling: "true" },
    null: { spelling: "null" },
    concat: { spelling: "a + b", note: "ByteArray.plus" },
  },
  module: {
    form: "class",
    apply: packageClass,
    qualify: (m, n) => `${m}.${n}`,
    note: "an object named for the last segment, in a package of the others (Coding Conventions, Names for packages and classes): nish/crypto/hkdf → object Hkdf in package nish.crypto",
  },
  nameRule:
    "functions and parameters lowerCamelCase: words split at each capital, a digit run stays on the word before it, a two-letter acronym stays in capitals and a longer one is cased like a word (readIOStream → readIOStream, parseHTTPRequest → parseHttpRequest). A name that is a hard keyword takes a name override.",
  name: (n) => camel(n, "short-caps"),
  choices: [
    "A refusing return is a nullable type ({T}?), not a thrown exception or Result<T>: Kotlin's null safety makes the refusal visible in the type.",
    "Unsigned widths keep their own types (UByte…ULong); only bytes stays ByteArray, signed, as UByteArray is experimental.",
    "The module is an object rather than top-level functions, so a caller names it as Java does.",
  ],
};
