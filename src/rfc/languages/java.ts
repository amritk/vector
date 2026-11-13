import { type LanguageTable, camel, packageClass } from "./table.ts";

export const java: LanguageTable = {
  id: "java",
  title: "Java",
  typeStandard:
    "The Java Language Specification (Java SE 21), §4.2 Primitive Types and Values",
  nameStandard:
    "Google Java Style Guide, §5.3 Camel case: defined (acronyms cased as words)",
  types: {
    bytes: {
      spelling: "byte[]",
      note: "each element read unsigned (b & 0xff)",
    },
    string: {
      spelling: "String",
      note: "UTF-16; every Unicode scalar value is representable",
    },
    bool: { spelling: "boolean" },
    f64: { spelling: "double", note: "IEEE 754 binary64 (JLS §4.2.3)" },
    "secret-bytes": {
      spelling: "byte[]",
      note: "no secret type; secrecy is dropped (Arrays.fill can wipe a copy)",
    },
    i8: { spelling: "byte" },
    i16: { spelling: "short" },
    i32: { spelling: "int" },
    i64: { spelling: "long" },
    u8: {
      spelling: "int",
      note: "Java has no unsigned types; widened to int, range 0..255 the implementation's to keep",
    },
    u16: {
      spelling: "int",
      note: "widened to int, as char is not a number here",
    },
    u32: { spelling: "long", note: "widened to long" },
    u64: {
      spelling: "long",
      note: "the same 64 bits read unsigned, with Long.compareUnsigned, Long.divideUnsigned and Long.toUnsignedString (JLS has no wider primitive)",
    },
  },
  outcomes: {
    "refusing-return": {
      spelling: "Optional<{T}>",
      note: "{T} boxed (boolean → Boolean, byte → Byte, short → Short, int → Integer, long → Long, double → Double; byte[] and String as they are), since a type argument is a reference type (JLS §4.5.1). Optional.empty() is the refusal; java.util.Optional's API note names it the return type for 'no result'",
    },
    "optional-input": {
      spelling: "@Nullable {T}",
      note: "org.jspecify.annotations.Nullable (JSpecify 1.0), a type-use annotation on {T} boxed as for a refusing return, and on an array as byte @Nullable [] (@Nullable byte[] would annotate the element type); null is the absent argument, and Optional is not used for parameters",
    },
  },
  literals: {
    hex: {
      spelling: 'HexFormat.of().parseHex("0b0b")',
      note: "java.util.HexFormat (Java 17)",
    },
    ascii: { spelling: '"abc".getBytes(StandardCharsets.US_ASCII)' },
    str: {
      spelling: '"abc"',
      note: "non-ASCII as \\u escapes, a scalar above U+FFFF as its UTF-16 surrogate pair; a control character as an octal escape (\\000), since a \\u escape is translated before the literal is read (JLS §3.3) and \\u000a would end the line",
    },
    int: {
      spelling: "42L",
      note: "per width: i8 a cast (byte) 42 and i16 a cast (short) 42, since a method argument is not narrowed from int (JLS §5.3); i32, u8 and u16 42; i64, u32 and u64 42L. The minimums (byte) -128, (short) -32768, -2147483648 and -9223372036854775808L are valid as written, and a u64 above Long.MAX_VALUE is its bits as a hex long (0xffffffffffffffffL)",
    },
    f64: {
      spelling: "Double.longBitsToDouble(0x3ff8000000000000L)",
      note: "from its bits; a NaN payload may not survive arithmetic, but is kept by the conversion",
    },
    bool: { spelling: "true" },
    null: {
      spelling: "null",
      note: "Optional.empty() where the refusal is meant",
    },
    concat: {
      spelling:
        "ByteBuffer.allocate(a.length + b.length).put(a).put(b).array()",
    },
  },
  module: {
    form: "class",
    apply: packageClass,
    qualify: (m, n) => `${m}.${n}`,
    note: "a final class of static methods named for the last segment, in a package of the others (JLS §6.1, package names lowercase): nish/crypto/hkdf → class Hkdf in package nish.crypto",
  },
  nameRule:
    "methods and parameters lowerCamelCase: words split at each capital, a digit run stays on the word before it (hkdfExpandSha256 → hkdfExpandSha256), and an acronym is cased like a word (parseHTTPRequest → parseHttpRequest, readIOStream → readIoStream). A name that is a Java keyword takes a name override.",
  name: (n) => camel(n, "word"),
  choices: [
    "Unsigned widths widen to the next signed type (u8, u16 → int; u32 → long), and u64 stays long read unsigned: the value is kept, the type no longer states its range.",
    "A refusing return is Optional<T>, not a thrown exception: the refusal is an expected outcome, and Optional's API note names this use. An implementation that throws IllegalArgumentException is still checkable by mapping the throw to the refusal.",
    "An optional input is a nullable reference; Optional parameters are discouraged by the same API note.",
  ],
};
