/**
 * `lang/dart` — the Dart table: how Dart writes each construct of the
 * contract vocabulary, and what it drops. Its name and module rules are in
 * `lang/names`.
 */

import { LangTable, langSpell, langUnsupported } from "./table"

/**
 * The Dart table.
 *
 * @returns Dart's mapping of every construct, its standards and its choices
 */
export const langTableDart = (): LangTable => {
  const t = new LangTable(
    "dart",
    "Dart",
    "Dart Programming Language Specification (6th edition), §10 Types and dart:core (int, double, BigInt), dart:typed_data (Uint8List)",
    "Effective Dart: Style, Identifiers (lowerCamelCase; acronyms longer than two letters capitalized like words)",
  )
  t.type("bytes", langSpell("Uint8List", ""))
  t.type("string", langSpell("String", "UTF-16; every Unicode scalar value is representable"))
  t.type("bool", langSpell("bool", ""))
  t.type("f64", langSpell("double", "IEEE 754 binary64"))
  t.type("secret-bytes", langSpell("Uint8List", "no secret type; secrecy is dropped (fillRange can wipe a copy)"))
  t.type("i8", langSpell("int", "the width is the implementation's to check"))
  t.type("i16", langSpell("int", "the width is the implementation's to check"))
  t.type("i32", langSpell("int", "the width is the implementation's to check"))
  t.type("i64", langSpell("int", "exact on native; on the web int is a JavaScript number, exact only to 2^53"))
  t.type("u8", langSpell("int", "the width is the implementation's to check"))
  t.type("u16", langSpell("int", "the width is the implementation's to check"))
  t.type("u32", langSpell("int", "the width is the implementation's to check"))
  t.type("u64", langSpell("BigInt", "int is signed 64-bit, so the upper half of u64 needs BigInt"))
  t.outcome("refusing-return", langSpell("{T}?", "null is the refusal (sound null safety)"))
  t.outcome(
    "optional-input",
    langSpell(
      "{T}? x",
      "a required nullable parameter, valid in any position; null is the absent argument, passed explicitly. [{T}? x] (an optional positional parameter) may be used instead only when no required parameter follows it",
    ),
  )
  t.literal("hex", langSpell("Uint8List.fromList([0x0b, 0x0b])", ""))
  t.literal("ascii", langSpell("ascii.encode('abc')", "dart:convert"))
  t.literal("str", langSpell("'abc'", "non-ASCII as \\u{…} escapes; $ escaped as \\$"))
  t.literal("int", langSpell("42", "BigInt.parse('…') for u64"))
  t.literal(
    "f64",
    langSpell(
      "(ByteData(8)..setUint64(0, 0x3ff8000000000000)).getFloat64(0)",
      "from its bits on native, so -0 and NaN payloads are exact",
    ),
  )
  t.literal("bool", langSpell("true", ""))
  t.literal("null", langSpell("null", ""))
  t.literal("concat", langSpell("Uint8List.fromList([...a, ...b])", ""))
  t.type("words16", langSpell("Uint16List", "dart:typed_data"))
  t.type("words32", langSpell("Uint32List", "dart:typed_data"))
  t.type(
    "words64",
    langSpell(
      "Uint64List",
      "dart:typed_data; Uint64List is not supported on the web, and an element reads back as a signed int",
    ),
  )
  t.literal("words16", langSpell("Uint16List.fromList([0x6170, 0x7865])", ""))
  t.literal("words32", langSpell("Uint32List.fromList([0x61707865, 0x3320646e])", ""))
  t.literal(
    "words64",
    langSpell(
      "Uint64List.fromList([0x3320646e61707865, 0x6b20657479622d32])",
      "a word of 2^63 or more is its signed int",
    ),
  )
  t.moduleForm = "file"
  t.moduleNote =
    "a library file in the package named by the first segment, imported with a prefix named for the last: nish/crypto/hkdf → import 'package:nish/crypto/hkdf.dart' as hkdf, called hkdf.<name>; a one-segment module is the package's main library (nish → package:nish/nish.dart)"
  t.nameRule =
    "functions and parameters lowerCamelCase: words split at each capital, a digit run stays on the word before it, a two-letter acronym stays in capitals and a longer one is cased like a word (readIOStream → readIOStream, parseHTTPRequest → parseHttpRequest). A name that is a reserved word takes a name override."
  t.choices.push(
    "Every signed width and u8..u32 are int; u64 is BigInt, as int cannot hold its upper half. On the web, i64 is exact only to 2^53, which this table drops.",
  )
  t.choices.push("A refusing return is null ({T}?), not a thrown ArgumentError.")
  return t
}
