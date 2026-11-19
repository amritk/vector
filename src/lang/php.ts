/**
 * `lang/php` — the PHP table: how PHP writes each construct of the
 * contract vocabulary, and what it drops. Its name and module rules are in
 * `lang/names`.
 */

import { LangTable, langSpell, langUnsupported } from "./table"

/**
 * The PHP table.
 *
 * @returns PHP's mapping of every construct, its standards and its choices
 */
export const langTablePhp = (): LangTable => {
  const t = new LangTable(
    "php",
    "PHP",
    "PHP Language Reference, Types (Integers, Floating point numbers, Strings, Nullable types); PHP 8.2",
    "PSR-1 Basic Coding Standard, §4.3 Methods (camelCase) and PSR-4 Autoloader",
  )
  t.type("bytes", langSpell("string", "PHP strings are byte strings"))
  t.type("string", langSpell("string", "UTF-8 bytes; validity is the implementation's to check"))
  t.type("bool", langSpell("bool", ""))
  t.type("f64", langSpell("float", "binary64 on every supported platform"))
  t.type(
    "secret-bytes",
    langSpell(
      "string",
      "with #[\\SensitiveParameter] before the parameter (PHP 8.2), which keeps the value out of stack traces: #[\\SensitiveParameter] ?string $x = null. An attribute is not part of a type, so a return cannot carry it and a returned secret drops it; the value is not wiped (sodium_memzero can)",
    ),
  )
  t.type("i8", langSpell("int", "a 64-bit build is assumed; the width is the implementation's to check"))
  t.type("i16", langSpell("int", "a 64-bit build is assumed; the width is the implementation's to check"))
  t.type("i32", langSpell("int", "a 64-bit build is assumed; the width is the implementation's to check"))
  t.type("i64", langSpell("int", "exact on a 64-bit build (PHP_INT_SIZE 8); its minimum is written PHP_INT_MIN"))
  t.type("u8", langSpell("int", "a 64-bit build is assumed; the width is the implementation's to check"))
  t.type("u16", langSpell("int", "a 64-bit build is assumed; the width is the implementation's to check"))
  t.type("u32", langSpell("int", "a 64-bit build is assumed; the width is the implementation's to check"))
  t.type(
    "u64",
    langUnsupported(
      "PHP int is signed 64-bit and a value above PHP_INT_MAX becomes float, losing precision; no native type holds 2^63..2^64-1 (GMP would, as an object)",
    ),
  )
  t.outcome("refusing-return", langSpell("?{T}", "null is the refusal"))
  t.outcome(
    "optional-input",
    langSpell(
      "?{T} $x",
      "null is the absent argument, passed explicitly; = null may be added only when every later parameter also has a default, as an optional parameter before a required one is deprecated (PHP 8.0, and for ?T $x = null since 8.3)",
    ),
  )
  t.literal("hex", langSpell('hex2bin("0b0b")', ""))
  t.literal("ascii", langSpell("'abc'", ""))
  t.literal(
    "str",
    langSpell(
      '"abc"',
      'double-quoted, so $ is written \\$ (a double-quoted string interpolates $x), \\ as \\\\ and " as \\"; non-ASCII and control characters as \\u{…} escapes',
    ),
  )
  t.literal(
    "int",
    langSpell(
      "42",
      "i64's minimum as PHP_INT_MIN: -9223372036854775808 is the float negation of an overflowed literal",
    ),
  )
  t.literal(
    "f64",
    langSpell(
      "unpack('E', hex2bin('3ff8000000000000'))[1]",
      "from its bits (big-endian double), so -0 and NaN payloads are exact",
    ),
  )
  t.literal("bool", langSpell("true", ""))
  t.literal("null", langSpell("null", ""))
  t.literal("concat", langSpell("$a . $b", ""))
  t.type("words16", langSpell("array", "a list of int; a 64-bit build is assumed"))
  t.type("words32", langSpell("array", "a list of int; a 64-bit build is assumed"))
  t.type(
    "words64",
    langUnsupported("PHP int is signed 64-bit, so an array of u64 has no native element type, as u64 has none"),
  )
  t.literal("words16", langSpell("[0x6170, 0x7865]", ""))
  t.literal("words32", langSpell("[0x61707865, 0x3320646e]", ""))
  t.literal("words64", langUnsupported("PHP has no native u64, so a word above PHP_INT_MAX cannot be written"))
  t.moduleForm = "class"
  t.moduleNote =
    "a final class of static methods, its fully qualified name the segments in PascalCase (PSR-4 autoloads classes, not functions): nish/crypto/hkdf → Nish\\Crypto\\Hkdf; a - in a segment starts a word: nish/net/quic-packet → Nish\\Net\\QuicPacket"
  t.nameRule =
    "methods and parameters camelCase with words as the contract writes them (PSR-1 requires camelCase and leaves acronyms open): parseHTTPRequest → parseHTTPRequest. A name that is a reserved word takes a name override."
  t.choices.push(
    "u64 is unsupported: no native PHP type holds the upper half of its range. A contract with u64 cannot be checked against a PHP implementation.",
  )
  t.choices.push("Every other integer width is int on a 64-bit build; the width is not in the type.")
  t.choices.push("bytes and string are both string; only the parameter's name and contract tell them apart.")
  return t
}
