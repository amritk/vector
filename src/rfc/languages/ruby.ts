import { type LanguageTable, pascalSegment, snake } from "./table.ts";

const integer = {
  spelling: "Integer",
  note: "unbounded; the width's range and wrapping are the implementation's (mask with & (2**N - 1))",
};

export const ruby: LanguageTable = {
  id: "ruby",
  title: "Ruby",
  typeStandard:
    "RBS, Ruby's type signature language (core class names: String, Integer, Float, bool)",
  nameStandard:
    "The Ruby Style Guide, Naming Conventions (snake_case methods; CamelCase modules)",
  types: {
    bytes: { spelling: "String", note: "with Encoding::ASCII_8BIT (binary)" },
    string: { spelling: "String", note: "with Encoding::UTF_8" },
    bool: {
      spelling: "bool",
      note: "RBS's bool: true or false (Ruby has no Boolean class)",
    },
    f64: {
      spelling: "Float",
      note: "a C double, IEEE 754 binary64 on every supported platform",
    },
    "secret-bytes": {
      spelling: "String",
      note: "binary String; Ruby has no secret type, so secrecy is dropped",
    },
    i8: integer,
    i16: integer,
    i32: integer,
    i64: integer,
    u8: integer,
    u16: integer,
    u32: integer,
    u64: integer,
  },
  outcomes: {
    "refusing-return": {
      spelling: "{T}?",
      note: "RBS optional: nil is the refusal",
    },
    "optional-input": { spelling: "{T}?", note: "nil is the absent argument" },
  },
  literals: {
    hex: { spelling: '["0b0b"].pack("H*")' },
    ascii: { spelling: '"abc".b' },
    str: { spelling: '"abc"', note: "non-ASCII as \\u{…} escapes" },
    int: { spelling: "42", note: "exact at any width" },
    f64: {
      spelling: '["3ff8000000000000"].pack("H*").unpack1("G")',
      note: "from its big-endian bits, so -0.0 and NaN payloads are exact",
    },
    bool: { spelling: "true" },
    null: { spelling: "nil" },
    concat: { spelling: "a + b" },
  },
  module: {
    form: "module",
    apply: (m) => m.split("/").map(pascalSegment).join("::"),
    qualify: (m, n) => `${m}.${n}`,
    note: "nested modules, each segment in CamelCase (Style Guide: CamelCase for classes and modules); the file is the neutral path plus .rb: nish/crypto/hkdf → Nish::Crypto::Hkdf in nish/crypto/hkdf.rb",
  },
  nameRule:
    "methods and parameters snake_case: words split at each capital, an acronym is one word (parseHTTPRequest → parse_http_request), and a digit run stays on the word before it (hkdfExpandSha256 → hkdf_expand_sha256). A name override always wins.",
  name: (n) => snake(n),
  choices: [
    "Ruby's Integer is unbounded, so there is no native u64 or any fixed width: every integer type is Integer, and the width (its range and its wrapping) is dropped from the type and kept by the implementation.",
    "A refusing return is nil, not a raised exception: nil maps the contract's null one-to-one (as Integer(s, exception: false) does). An implementation that raises ArgumentError is still checkable by mapping the raise to the refusal.",
    "bytes and string are both String, told apart only by encoding (ASCII-8BIT vs UTF-8).",
  ],
};
