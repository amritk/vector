import { type LanguageTable, snake } from "./table.ts";

export const rust: LanguageTable = {
  id: "rust",
  title: "Rust",
  typeStandard:
    "The Rust Reference, Type system › Types (numeric, boolean, textual and slice types)",
  nameStandard: "Rust API Guidelines C-CASE (RFC 430, naming conventions)",
  types: {
    bytes: { spelling: "&[u8]", note: "a returned value is Vec<u8>" },
    string: {
      spelling: "&str",
      note: "a returned value is String; both are UTF-8 by construction",
    },
    bool: { spelling: "bool" },
    f64: {
      spelling: "f64",
      note: "IEEE 754-2008 binary64 (Reference, Numeric types)",
    },
    "secret-bytes": {
      spelling: "&[u8]",
      note: "std has no secret type; secrecy is dropped (a crate such as secrecy or zeroize can add it)",
    },
    i8: { spelling: "i8" },
    i16: { spelling: "i16" },
    i32: { spelling: "i32" },
    i64: { spelling: "i64" },
    u8: { spelling: "u8" },
    u16: { spelling: "u16" },
    u32: { spelling: "u32" },
    u64: { spelling: "u64" },
  },
  outcomes: {
    "refusing-return": { spelling: "Option<{T}>", note: "None is the refusal" },
    "optional-input": {
      spelling: "Option<{T}>",
      note: "None is the absent argument",
    },
  },
  literals: {
    hex: { spelling: "&[0x0b, 0x0b]" },
    ascii: { spelling: 'b"abc"' },
    str: { spelling: '"abc"', note: "non-ASCII as \\u{…} escapes" },
    int: {
      spelling: "42u32",
      note: "suffixed with its type, so every width is exact",
    },
    f64: {
      spelling: "f64::from_bits(0x3ff8000000000000)",
      note: "from its bits, so NaN payloads and -0 are exact",
    },
    bool: { spelling: "true" },
    null: { spelling: "None" },
    concat: { spelling: "[a, b].concat()" },
  },
  module: {
    form: "crate-path",
    apply: (m) => m.split("/").join("::"),
    qualify: (m, n) => `${m}::${n}`,
    note: "the segments as a path of modules, the root segment the crate (The Rust Reference, Items › Modules): nish/crypto/hkdf → nish::crypto::hkdf",
  },
  nameRule:
    "functions and parameters snake_case (C-CASE): words split at each capital, an acronym is one word (parseHTTPRequest → parse_http_request), and a digit run stays on the word before it (chacha20Poly1305Seal → chacha20_poly1305_seal). A name override always wins; a name that is a keyword (type, match, …) takes one.",
  name: (n) => snake(n),
  choices: [
    "A refusing return is Option<T>, not Result<T, E>: the contract says only that the function declines, and gives no reason, so an error type E would be invented. An implementation that returns Result is still checkable by mapping Err to the refusal; the reason it carries is outside the contract.",
    "An optional input is Option<T>, so absent and empty (Some(&[])) stay distinct.",
    "Integer arithmetic in the contract wraps modulo 2^N; Rust's + panics on overflow in debug builds, so an implementation uses wrapping_add and friends where the contract wraps.",
    "secret-bytes is a plain byte slice: std has no secret type, so the secrecy is dropped.",
  ],
};
