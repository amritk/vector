import { type LanguageTable, camel, pascalSegment, segments } from "./table.ts";

export const swift: LanguageTable = {
  id: "swift",
  title: "Swift",
  typeStandard:
    "The Swift Programming Language (Swift 5.9), The Basics › Integers, Floating-Point Numbers, Optionals",
  nameStandard:
    "Swift API Design Guidelines, Conventions › General Conventions (lowerCamelCase; acronyms uniformly cased as written)",
  types: {
    bytes: {
      spelling: "[UInt8]",
      note: "Data would also do; [UInt8] needs no Foundation",
    },
    string: {
      spelling: "String",
      note: "every Unicode scalar value is representable",
    },
    bool: { spelling: "Bool" },
    f64: { spelling: "Double", note: "IEEE 754 binary64" },
    "secret-bytes": {
      spelling: "[UInt8]",
      note: "no secret type; secrecy is dropped (CryptoKit's SymmetricKey is one where available)",
    },
    i8: { spelling: "Int8" },
    i16: { spelling: "Int16" },
    i32: { spelling: "Int32" },
    i64: { spelling: "Int64" },
    u8: { spelling: "UInt8" },
    u16: { spelling: "UInt16" },
    u32: { spelling: "UInt32" },
    u64: { spelling: "UInt64" },
  },
  outcomes: {
    "refusing-return": { spelling: "{T}?", note: "nil is the refusal" },
    "optional-input": {
      spelling: "{T}? = nil",
      note: "nil is the absent argument",
    },
  },
  literals: {
    hex: { spelling: "[0x0b, 0x0b] as [UInt8]" },
    ascii: { spelling: 'Array("abc".utf8)' },
    str: {
      spelling: '"abc"',
      note: "non-ASCII as \\u{…} escapes; a backslash written \\\\, since \\( interpolates",
    },
    int: { spelling: "UInt32(42)", note: "every width exact" },
    f64: {
      spelling: "Double(bitPattern: 0x3ff8000000000000)",
      note: "from its bits, so -0 and NaN payloads are exact",
    },
    bool: { spelling: "true" },
    null: { spelling: "nil" },
    concat: { spelling: "a + b" },
  },
  module: {
    form: "module",
    apply: (m) => segments(m).map(pascalSegment).join(""),
    qualify: (m, n) => `${m}.${n}`,
    note: "Swift modules do not nest, so one module named by the segments in UpperCamelCase, joined: nish/crypto/hkdf → NishCryptoHkdf",
  },
  nameRule:
    "functions and parameters lowerCamelCase with words as the contract writes them, so an acronym keeps its uniform case (API Design Guidelines): parseHTTPRequest → parseHTTPRequest, hkdfExpandSha256 → hkdfExpandSha256. A name that is a keyword takes a name override (or backticks).",
  name: (n) => camel(n, "as-written"),
  choices: [
    "A refusing return is an Optional ({T}?), not throws: the refusals are simple domain errors with no reason to report, the case Swift's error-handling rationale gives Optional.",
    "Modules do not nest, so the module path is flattened into one UpperCamelCase name.",
  ],
};
