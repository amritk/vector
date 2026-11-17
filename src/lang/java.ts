/**
 * `lang/java` — the Java table: how Java writes each construct of the
 * contract vocabulary, and what it drops. Its name and module rules are in
 * `lang/names`.
 */

import { LangTable, langSpell, langUnsupported } from "./table"

/**
 * The Java table.
 *
 * @returns Java's mapping of every construct, its standards and its choices
 */
export const langTableJava = (): LangTable => {
  const t = new LangTable(
    "java",
    "Java",
    "The Java Language Specification (Java SE 21), §4.2 Primitive Types and Values",
    "Google Java Style Guide, §5.3 Camel case: defined (acronyms cased as words)",
  )
  t.type("bytes", langSpell("byte[]", "each element read unsigned (b & 0xff)"))
  t.type("string", langSpell("String", "UTF-16; every Unicode scalar value is representable"))
  t.type("bool", langSpell("boolean", ""))
  t.type("f64", langSpell("double", "IEEE 754 binary64 (JLS §4.2.3)"))
  t.type("secret-bytes", langSpell("byte[]", "no secret type; secrecy is dropped (Arrays.fill can wipe a copy)"))
  t.type("i8", langSpell("byte", ""))
  t.type("i16", langSpell("short", ""))
  t.type("i32", langSpell("int", ""))
  t.type("i64", langSpell("long", ""))
  t.type(
    "u8",
    langSpell("int", "Java has no unsigned types; widened to int, range 0..255 the implementation's to keep"),
  )
  t.type("u16", langSpell("int", "widened to int, as char is not a number here"))
  t.type("u32", langSpell("long", "widened to long"))
  t.type(
    "u64",
    langSpell(
      "long",
      "the same 64 bits read unsigned, with Long.compareUnsigned, Long.divideUnsigned and Long.toUnsignedString (JLS has no wider primitive)",
    ),
  )
  t.outcome(
    "refusing-return",
    langSpell(
      "Optional<{T}>",
      "{T} boxed (boolean → Boolean, byte → Byte, short → Short, int → Integer, long → Long, double → Double; byte[] and String as they are), since a type argument is a reference type (JLS §4.5.1). Optional.empty() is the refusal; java.util.Optional's API note names it the return type for 'no result'",
    ),
  )
  t.outcome(
    "optional-input",
    langSpell(
      "@Nullable {T}",
      "org.jspecify.annotations.Nullable (JSpecify 1.0), a type-use annotation on {T} boxed as for a refusing return, and on an array as byte @Nullable [] (@Nullable byte[] would annotate the element type); null is the absent argument, and Optional is not used for parameters",
    ),
  )
  t.literal("hex", langSpell('HexFormat.of().parseHex("0b0b")', "java.util.HexFormat (Java 17)"))
  t.literal("ascii", langSpell('"abc".getBytes(StandardCharsets.US_ASCII)', ""))
  t.literal(
    "str",
    langSpell(
      '"abc"',
      "non-ASCII as \\u escapes, a scalar above U+FFFF as its UTF-16 surrogate pair; a control character as an octal escape (\\000), since a \\u escape is translated before the literal is read (JLS §3.3) and \\u000a would end the line",
    ),
  )
  t.literal(
    "int",
    langSpell(
      "42L",
      "per width: i8 a cast (byte) 42 and i16 a cast (short) 42, since a method argument is not narrowed from int (JLS §5.3); i32, u8 and u16 42; i64, u32 and u64 42L. The minimums (byte) -128, (short) -32768, -2147483648 and -9223372036854775808L are valid as written, and a u64 above Long.MAX_VALUE is its bits as a hex long (0xffffffffffffffffL)",
    ),
  )
  t.literal(
    "f64",
    langSpell(
      "Double.longBitsToDouble(0x3ff8000000000000L)",
      "from its bits; a NaN payload may not survive arithmetic, but is kept by the conversion",
    ),
  )
  t.literal("bool", langSpell("true", ""))
  t.literal("null", langSpell("null", "Optional.empty() where the refusal is meant"))
  t.literal("concat", langSpell("ByteBuffer.allocate(a.length + b.length).put(a).put(b).array()", ""))
  t.type("words16", langSpell("int[]", "widened to int, as u16 is"))
  t.type("words32", langSpell("long[]", "widened to long, as u32 is"))
  t.type("words64", langSpell("long[]", "each element read unsigned, as u64 is"))
  t.literal("words16", langSpell("new int[] { 0x6170, 0x7865 }", ""))
  t.literal("words32", langSpell("new long[] { 0x61707865L, 0x3320646eL }", ""))
  t.literal("words64", langSpell("new long[] { 0x3320646e61707865L, 0x6b20657479622d32L }", ""))
  t.moduleForm = "class"
  t.moduleNote =
    "a final class of static methods named for the last segment, in a package of the others (JLS §6.1, package names lowercase): nish/crypto/hkdf → class Hkdf in package nish.crypto"
  t.nameRule =
    "methods and parameters lowerCamelCase: words split at each capital, a digit run stays on the word before it (hkdfExpandSha256 → hkdfExpandSha256), and an acronym is cased like a word (parseHTTPRequest → parseHttpRequest, readIOStream → readIoStream). A name that is a Java keyword takes a name override."
  t.choices.push(
    "Unsigned widths widen to the next signed type (u8, u16 → int; u32 → long), and u64 stays long read unsigned: the value is kept, the type no longer states its range.",
  )
  t.choices.push(
    "A refusing return is Optional<T>, not a thrown exception: the refusal is an expected outcome, and Optional's API note names this use. An implementation that throws IllegalArgumentException is still checkable by mapping the throw to the refusal.",
  )
  t.choices.push("An optional input is a nullable reference; Optional parameters are discouraged by the same API note.")
  return t
}
