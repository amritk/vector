import { type LanguageTable, camel, pascalSegment } from "./table.ts";

/** The note on each integer width the type does not state. */
const WIDTH =
  "a 64-bit build is assumed; the width is the implementation's to check";

export const php: LanguageTable = {
  id: "php",
  title: "PHP",
  typeStandard:
    "PHP Language Reference, Types (Integers, Floating point numbers, Strings, Nullable types); PHP 8.2",
  nameStandard:
    "PSR-1 Basic Coding Standard, §4.3 Methods (camelCase) and PSR-4 Autoloader",
  types: {
    bytes: { spelling: "string", note: "PHP strings are byte strings" },
    string: {
      spelling: "string",
      note: "UTF-8 bytes; validity is the implementation's to check",
    },
    bool: { spelling: "bool" },
    f64: { spelling: "float", note: "binary64 on every supported platform" },
    "secret-bytes": {
      spelling: "string",
      note: "with #[\\SensitiveParameter] before the parameter (PHP 8.2), which keeps the value out of stack traces: #[\\SensitiveParameter] ?string $x = null. An attribute is not part of a type, so a return cannot carry it and a returned secret drops it; the value is not wiped (sodium_memzero can)",
    },
    i8: {
      spelling: "int",
      note: WIDTH,
    },
    i16: { spelling: "int", note: WIDTH },
    i32: { spelling: "int", note: WIDTH },
    i64: {
      spelling: "int",
      note: "exact on a 64-bit build (PHP_INT_SIZE 8); its minimum is written PHP_INT_MIN",
    },
    u8: { spelling: "int", note: WIDTH },
    u16: { spelling: "int", note: WIDTH },
    u32: { spelling: "int", note: WIDTH },
    u64: {
      unsupported:
        "PHP int is signed 64-bit and a value above PHP_INT_MAX becomes float, losing precision; no native type holds 2^63..2^64-1 (GMP would, as an object)",
    },
  },
  outcomes: {
    "refusing-return": { spelling: "?{T}", note: "null is the refusal" },
    "optional-input": {
      spelling: "?{T} $x",
      note: "null is the absent argument, passed explicitly; = null may be added only when every later parameter also has a default, as an optional parameter before a required one is deprecated (PHP 8.0, and for ?T $x = null since 8.3)",
    },
  },
  literals: {
    hex: { spelling: 'hex2bin("0b0b")' },
    ascii: { spelling: "'abc'" },
    str: {
      spelling: '"abc"',
      note: 'double-quoted, so $ is written \\$ (a double-quoted string interpolates $x), \\ as \\\\ and " as \\"; non-ASCII and control characters as \\u{…} escapes',
    },
    int: {
      spelling: "42",
      note: "i64's minimum as PHP_INT_MIN: -9223372036854775808 is the float negation of an overflowed literal",
    },
    f64: {
      spelling: "unpack('E', hex2bin('3ff8000000000000'))[1]",
      note: "from its bits (big-endian double), so -0 and NaN payloads are exact",
    },
    bool: { spelling: "true" },
    null: { spelling: "null" },
    concat: { spelling: "$a . $b" },
  },
  module: {
    form: "class",
    apply: (m) => m.split("/").map(pascalSegment).join("\\"),
    qualify: (m, n) => `\\${m}::${n}`,
    note: "a final class of static methods, its fully qualified name the segments in PascalCase (PSR-4 autoloads classes, not functions): nish/crypto/hkdf → Nish\\Crypto\\Hkdf",
  },
  nameRule:
    "methods and parameters camelCase with words as the contract writes them (PSR-1 requires camelCase and leaves acronyms open): parseHTTPRequest → parseHTTPRequest. A name that is a reserved word takes a name override.",
  name: (n) => camel(n, "as-written"),
  choices: [
    "u64 is unsupported: no native PHP type holds the upper half of its range. A contract with u64 cannot be checked against a PHP implementation.",
    "Every other integer width is int on a 64-bit build; the width is not in the type.",
    "bytes and string are both string; only the parameter's name and contract tell them apart.",
  ],
};
