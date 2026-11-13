import { type LanguageTable, snake } from "./table.ts";

export const cpp: LanguageTable = {
  id: "cpp",
  title: "C++",
  typeStandard:
    "ISO/IEC 14882:2020 (C++20), [cstdint.syn] fixed-width integers, [basic.fundamental], [views.span], [optional]",
  nameStandard:
    "C++ Core Guidelines NL.10 (prefer underscore_style names) and NL.8 (consistent naming style)",
  types: {
    bytes: {
      spelling: "std::span<const std::uint8_t>",
      note: "a returned value is std::vector<std::uint8_t>",
    },
    string: {
      spelling: "std::string_view",
      note: "UTF-8 octets; a returned value is std::string. The UTF-8 guarantee is the implementation's",
    },
    bool: { spelling: "bool" },
    f64: {
      spelling: "double",
      note: "binary64 where std::numeric_limits<double>::is_iec559 holds; the standard does not require it",
    },
    "secret-bytes": {
      spelling: "std::span<const std::uint8_t>",
      note: "no secret type in the standard library; secrecy is dropped",
    },
    i8: {
      spelling: "std::int8_t",
      note: "the exact-width types are optional in the standard; every mainstream target has them",
    },
    i16: { spelling: "std::int16_t" },
    i32: { spelling: "std::int32_t" },
    i64: { spelling: "std::int64_t" },
    u8: { spelling: "std::uint8_t" },
    u16: { spelling: "std::uint16_t" },
    u32: { spelling: "std::uint32_t" },
    u64: { spelling: "std::uint64_t" },
  },
  outcomes: {
    "refusing-return": {
      spelling: "std::optional<{T}>",
      note: "std::nullopt is the refusal",
    },
    "optional-input": {
      spelling: "std::optional<{T}>",
      note: "std::nullopt is the absent argument",
    },
  },
  literals: {
    hex: { spelling: "std::array<std::uint8_t, 2>{0x0b, 0x0b}" },
    ascii: { spelling: "std::array<std::uint8_t, 3>{'a', 'b', 'c'}" },
    str: {
      spelling: '"abc"',
      note: 'non-ASCII as its UTF-8 bytes in \\x escapes ("\\xc3\\xa9" for é), split where a hex digit follows; a u8 literal is char8_t in C++20 and does not convert to std::string_view',
    },
    int: {
      spelling: "std::uint32_t{42}",
      note: "braced, so a value out of range is a compile error; a minimum as -MAX - 1 (std::int64_t{-9223372036854775807 - 1}), and a u64 above INT64_MAX with a u suffix (std::uint64_t{18446744073709551615u})",
    },
    f64: {
      spelling: "std::bit_cast<double>(std::uint64_t{0x3ff8000000000000})",
      note: "from its bits (C++20 [bit.cast]), so -0 and NaN payloads are exact",
    },
    bool: { spelling: "true" },
    null: { spelling: "std::nullopt" },
    concat: {
      spelling: "std::array<std::uint8_t, 2>{0x0b, 0x61}",
      note: "no array concatenation in a literal; the joined bytes are written as one array",
    },
  },
  module: {
    form: "namespace",
    apply: (m) => m.split("/").join("::"),
    qualify: (m, n) => `${m}::${n}`,
    note: "nested namespaces, one per segment, declared in the header at the neutral path plus .hpp: nish/crypto/hkdf → namespace nish::crypto::hkdf in nish/crypto/hkdf.hpp",
  },
  nameRule:
    "functions and parameters underscore_style (NL.10), as the standard library is: words split at each capital, an acronym is one word (parseHTTPRequest → parse_http_request), and a digit run stays on the word before it (chacha20Poly1305Seal → chacha20_poly1305_seal). A name override always wins.",
  name: (n) => snake(n),
  choices: [
    "A refusing return is std::optional<T> (C++17), not std::expected<T, E> (C++23) or an exception: the contract gives no reason, so E would be invented.",
    "Inputs are non-owning std::span / std::string_view and outputs owning std::vector / std::string, so the contract's single bytes type splits by position.",
  ],
};
