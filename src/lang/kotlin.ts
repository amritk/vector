/**
 * `lang/kotlin` — the Kotlin table: how Kotlin writes each construct of the
 * contract vocabulary, and what it drops. Its name and module rules are in
 * `lang/names`.
 */

import { LangTable, langSpell, langUnsupported } from "./table"

/**
 * The Kotlin table.
 *
 * @returns Kotlin's mapping of every construct, its standards and its choices
 */
export const langTableKotlin = (): LangTable => {
  const t = new LangTable(
    "kotlin",
    "Kotlin",
    "Kotlin Language Specification, Built-in types and their semantics (kotlin.Byte…Long, kotlin.UByte…ULong, nullable types)",
    "Kotlin Coding Conventions, Naming rules (lowerCamelCase functions; two-letter acronyms in capitals)",
  )
  t.type("bytes", langSpell("ByteArray", "UByteArray is still experimental; elements read unsigned with toUByte()"))
  t.type("string", langSpell("String", "UTF-16; every Unicode scalar value is representable"))
  t.type("bool", langSpell("Boolean", ""))
  t.type("f64", langSpell("Double", "IEEE 754 binary64"))
  t.type("secret-bytes", langSpell("ByteArray", "no secret type; secrecy is dropped (fill(0) can wipe a copy)"))
  t.type("i8", langSpell("Byte", ""))
  t.type("i16", langSpell("Short", ""))
  t.type("i32", langSpell("Int", ""))
  t.type("i64", langSpell("Long", ""))
  t.type("u8", langSpell("UByte", ""))
  t.type("u16", langSpell("UShort", ""))
  t.type("u32", langSpell("UInt", ""))
  t.type("u64", langSpell("ULong", ""))
  t.outcome("refusing-return", langSpell("{T}?", "null is the refusal"))
  t.outcome(
    "optional-input",
    langSpell(
      "{T}? = null",
      "a nullable parameter, null the absent argument; the default is allowed before a required parameter, which a caller then passes by name or passes null for x",
    ),
  )
  t.literal(
    "hex",
    langSpell(
      "byteArrayOf(0x0b, 0x0b)",
      'a byte above 0x7f as 0xff.toByte(); "0b0b".hexToByteArray() needs @OptIn(ExperimentalStdlibApi::class) in Kotlin 1.9',
    ),
  )
  t.literal("ascii", langSpell('"abc".toByteArray(Charsets.US_ASCII)', ""))
  t.literal(
    "str",
    langSpell(
      '"abc"',
      "non-ASCII as \\u escapes, a scalar above U+FFFF as its UTF-16 surrogate pair (Kotlin has no \\U); $ escaped as \\$",
    ),
  )
  t.literal(
    "int",
    langSpell(
      "42u",
      "per width: i8 42.toByte(), i16 42.toShort() (a negative one parenthesised, (-128).toByte() and (-32768).toShort(), as -128.toByte() is -(128.toByte()), an Int), i32 42, i64 42L, u8 42u.toUByte(), u16 42u.toUShort(), u32 42u, u64 42uL; the minimums as Int.MIN_VALUE and Long.MIN_VALUE, since -2147483648 is a Long and -9223372036854775808L does not compile",
    ),
  )
  t.literal(
    "f64",
    langSpell(
      "Double.fromBits(0x3ff8000000000000uL.toLong())",
      "from its bits, so -0 and NaN payloads are exact; the bits are a ULong literal, as a hex Long literal with the sign bit set (-0, any negative value) does not compile",
    ),
  )
  t.literal("bool", langSpell("true", ""))
  t.literal("null", langSpell("null", ""))
  t.literal("concat", langSpell("a + b", "ByteArray.plus"))
  t.type(
    "words16",
    langSpell("ShortArray", "the unsigned arrays are still experimental; elements read unsigned with toUShort()"),
  )
  t.type(
    "words32",
    langSpell("IntArray", "the unsigned arrays are still experimental; elements read unsigned with toUInt()"),
  )
  t.type(
    "words64",
    langSpell("LongArray", "the unsigned arrays are still experimental; elements read unsigned with toULong()"),
  )
  t.literal(
    "words16",
    langSpell(
      "shortArrayOf(0x6170, 0x7865)",
      "a word above the signed maximum as its unsigned literal converted (0xffffffffu.toInt())",
    ),
  )
  t.literal(
    "words32",
    langSpell(
      "intArrayOf(0x61707865, 0x3320646e)",
      "a word above the signed maximum as its unsigned literal converted (0xffffffffu.toInt())",
    ),
  )
  t.literal(
    "words64",
    langSpell(
      "longArrayOf(0x3320646e61707865, 0x6b20657479622d32)",
      "a word above the signed maximum as its unsigned literal converted (0xffffffffu.toInt())",
    ),
  )
  t.moduleForm = "class"
  t.moduleNote =
    "an object named for the last segment, in a package of the others (Coding Conventions, Names for packages and classes): nish/crypto/hkdf → object Hkdf in package nish.crypto"
  t.nameRule =
    "functions and parameters lowerCamelCase: words split at each capital, a digit run stays on the word before it, a two-letter acronym stays in capitals and a longer one is cased like a word (readIOStream → readIOStream, parseHTTPRequest → parseHttpRequest). A name that is a hard keyword takes a name override."
  t.choices.push(
    "A refusing return is a nullable type ({T}?), not a thrown exception or Result<T>: Kotlin's null safety makes the refusal visible in the type.",
  )
  t.choices.push(
    "Unsigned widths keep their own types (UByte…ULong); only bytes stays ByteArray, signed, as UByteArray is experimental.",
  )
  t.choices.push("The module is an object rather than top-level functions, so a caller names it as Java does.")
  return t
}
