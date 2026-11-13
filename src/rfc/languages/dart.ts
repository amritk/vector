import { type LanguageTable, basename, camel } from "./table.ts";

export const dart: LanguageTable = {
  id: "dart",
  title: "Dart",
  typeStandard:
    "Dart Programming Language Specification (6th edition), §10 Types and dart:core (int, double, BigInt), dart:typed_data (Uint8List)",
  nameStandard:
    "Effective Dart: Style, Identifiers (lowerCamelCase; acronyms longer than two letters capitalized like words)",
  types: {
    bytes: { spelling: "Uint8List" },
    string: {
      spelling: "String",
      note: "UTF-16; every Unicode scalar value is representable",
    },
    bool: { spelling: "bool" },
    f64: { spelling: "double", note: "IEEE 754 binary64" },
    "secret-bytes": {
      spelling: "Uint8List",
      note: "no secret type; secrecy is dropped (fillRange can wipe a copy)",
    },
    i8: { spelling: "int", note: "the width is the implementation's to check" },
    i16: { spelling: "int", note: "as i8" },
    i32: { spelling: "int", note: "as i8" },
    i64: {
      spelling: "int",
      note: "exact on native; on the web int is a JavaScript number, exact only to 2^53",
    },
    u8: { spelling: "int", note: "as i8" },
    u16: { spelling: "int", note: "as i8" },
    u32: { spelling: "int", note: "as i8" },
    u64: {
      spelling: "BigInt",
      note: "int is signed 64-bit, so the upper half of u64 needs BigInt",
    },
  },
  outcomes: {
    "refusing-return": {
      spelling: "{T}?",
      note: "null is the refusal (sound null safety)",
    },
    "optional-input": {
      spelling: "[{T}? x]",
      note: "an optional positional parameter; null is the absent argument",
    },
  },
  literals: {
    hex: { spelling: "Uint8List.fromList([0x0b, 0x0b])" },
    ascii: { spelling: "ascii.encode('abc')", note: "dart:convert" },
    str: {
      spelling: "'abc'",
      note: "non-ASCII as \\u{…} escapes; $ escaped as \\$",
    },
    int: { spelling: "42", note: "BigInt.parse('…') for u64" },
    f64: {
      spelling: "(ByteData(8)..setUint64(0, 0x3ff8000000000000)).getFloat64(0)",
      note: "from its bits on native, so -0 and NaN payloads are exact",
    },
    bool: { spelling: "true" },
    null: { spelling: "null" },
    concat: { spelling: "Uint8List.fromList([...a, ...b])" },
  },
  module: {
    form: "file",
    apply: (m) => {
      const [pkg, ...rest] = m.split("/");
      return `package:${pkg}/${rest.join("/")}.dart`;
    },
    qualify: (m, n) => `${basename(m)}.${n}`,
    note: "a library file in the package named by the first segment, imported with a prefix named for the last: nish/crypto/hkdf → import 'package:nish/crypto/hkdf.dart' as hkdf, called hkdf.<name>",
  },
  nameRule:
    "functions and parameters lowerCamelCase: words split at each capital, a digit run stays on the word before it, a two-letter acronym stays in capitals and a longer one is cased like a word (readIOStream → readIOStream, parseHTTPRequest → parseHttpRequest). A name that is a reserved word takes a name override.",
  name: (n) => camel(n, "short-caps"),
  choices: [
    "Every signed width and u8..u32 are int; u64 is BigInt, as int cannot hold its upper half. On the web, i64 is exact only to 2^53, which this table drops.",
    "A refusing return is null ({T}?), not a thrown ArgumentError.",
  ],
};
