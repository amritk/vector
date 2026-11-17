/**
 * `lang/cpp` — the C++ table: how C++ writes each construct of the
 * contract vocabulary, and what it drops. Its name and module rules are in
 * `lang/names`.
 */

import { LangTable, langSpell, langUnsupported } from "./table"

/**
 * The C++ table.
 *
 * @returns C++'s mapping of every construct, its standards and its choices
 */
export const langTableCpp = (): LangTable => {
  const t = new LangTable(
    "cpp",
    "C++",
    "ISO/IEC 14882:2020 (C++20), [cstdint.syn] fixed-width integers, [basic.fundamental], [views.span], [optional]",
    "C++ Core Guidelines NL.10 (prefer underscore_style names) and NL.8 (consistent naming style)",
  )
  t.type("bytes", langSpell("std::span<const std::uint8_t>", "a returned value is std::vector<std::uint8_t>"))
  t.type(
    "string",
    langSpell(
      "std::string_view",
      "UTF-8 octets; a returned value is std::string. The UTF-8 guarantee is the implementation's",
    ),
  )
  t.type("bool", langSpell("bool", ""))
  t.type(
    "f64",
    langSpell(
      "double",
      "binary64 where std::numeric_limits<double>::is_iec559 holds; the standard does not require it",
    ),
  )
  t.type(
    "secret-bytes",
    langSpell("std::span<const std::uint8_t>", "no secret type in the standard library; secrecy is dropped"),
  )
  t.type(
    "i8",
    langSpell("std::int8_t", "the exact-width types are optional in the standard; every mainstream target has them"),
  )
  t.type("i16", langSpell("std::int16_t", ""))
  t.type("i32", langSpell("std::int32_t", ""))
  t.type("i64", langSpell("std::int64_t", ""))
  t.type("u8", langSpell("std::uint8_t", ""))
  t.type("u16", langSpell("std::uint16_t", ""))
  t.type("u32", langSpell("std::uint32_t", ""))
  t.type("u64", langSpell("std::uint64_t", ""))
  t.outcome("refusing-return", langSpell("std::optional<{T}>", "std::nullopt is the refusal"))
  t.outcome("optional-input", langSpell("std::optional<{T}>", "std::nullopt is the absent argument"))
  t.literal("hex", langSpell("std::array<std::uint8_t, 2>{0x0b, 0x0b}", ""))
  t.literal("ascii", langSpell("std::array<std::uint8_t, 3>{'a', 'b', 'c'}", ""))
  t.literal(
    "str",
    langSpell(
      '"abc"sv',
      'a std::string_view literal (using namespace std::literals; [string.view.literals]), so its length is the literal\'s and keeps an embedded U+0000, which a plain "a\\0b" would end at. Non-ASCII and control characters as their UTF-8 bytes in \\x escapes ("\\xc3\\xa9"sv for é), split into adjacent literals where a hex digit follows ("\\x00" "b"sv); a u8 literal is char8_t in C++20 and does not convert to std::string_view',
    ),
  )
  t.literal(
    "int",
    langSpell(
      "std::uint32_t{42}",
      "braced, so a value out of range is a compile error; a minimum as -MAX - 1 (std::int64_t{-9223372036854775807 - 1}), and a u64 above INT64_MAX with a u suffix (std::uint64_t{18446744073709551615u})",
    ),
  )
  t.literal(
    "f64",
    langSpell(
      "std::bit_cast<double>(std::uint64_t{0x3ff8000000000000})",
      "from its bits (C++20 [bit.cast]), so -0 and NaN payloads are exact",
    ),
  )
  t.literal("bool", langSpell("true", ""))
  t.literal("null", langSpell("std::nullopt", ""))
  t.literal(
    "concat",
    langSpell(
      "std::array<std::uint8_t, 2>{0x0b, 0x61}",
      "no array concatenation in a literal; the joined bytes are written as one array",
    ),
  )
  t.type("words16", langSpell("std::span<const std::uint16_t>", "a returned value is std::vector<std::uint16_t>"))
  t.type("words32", langSpell("std::span<const std::uint32_t>", "a returned value is std::vector<std::uint32_t>"))
  t.type("words64", langSpell("std::span<const std::uint64_t>", "a returned value is std::vector<std::uint64_t>"))
  t.literal("words16", langSpell("std::array<std::uint16_t, 2>{0x6170, 0x7865}", ""))
  t.literal("words32", langSpell("std::array<std::uint32_t, 2>{0x61707865, 0x3320646e}", ""))
  t.literal("words64", langSpell("std::array<std::uint64_t, 2>{0x3320646e61707865, 0x6b20657479622d32}", ""))
  t.moduleForm = "namespace"
  t.moduleNote =
    "nested namespaces, one per segment, declared in the header at the neutral path plus .hpp: nish/crypto/hkdf → namespace nish::crypto::hkdf in nish/crypto/hkdf.hpp"
  t.nameRule =
    "functions and parameters underscore_style (NL.10), as the standard library is: words split at each capital, an acronym is one word (parseHTTPRequest → parse_http_request), and a digit run stays on the word before it (chacha20Poly1305Seal → chacha20_poly1305_seal). A name override always wins."
  t.choices.push(
    "A refusing return is std::optional<T> (C++17), not std::expected<T, E> (C++23) or an exception: the contract gives no reason, so E would be invented.",
  )
  t.choices.push(
    "Inputs are non-owning std::span / std::string_view and outputs owning std::vector / std::string, so the contract's single bytes type splits by position.",
  )
  return t
}
