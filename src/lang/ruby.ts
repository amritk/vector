/**
 * `lang/ruby` — the Ruby table: how Ruby writes each construct of the
 * contract vocabulary, and what it drops. Its name and module rules are in
 * `lang/names`.
 */

import { LangTable, langSpell, langUnsupported } from "./table"

/**
 * The Ruby table.
 *
 * @returns Ruby's mapping of every construct, its standards and its choices
 */
export const langTableRuby = (): LangTable => {
  const t = new LangTable(
    "ruby",
    "Ruby",
    "RBS, Ruby's type signature language (core class names: String, Integer, Float, bool)",
    "The Ruby Style Guide, Naming Conventions (snake_case methods; CamelCase modules)",
  )
  t.type("bytes", langSpell("String", "with Encoding::ASCII_8BIT (binary)"))
  t.type("string", langSpell("String", "with Encoding::UTF_8"))
  t.type("bool", langSpell("bool", "RBS's bool: true or false (Ruby has no Boolean class)"))
  t.type("f64", langSpell("Float", "a C double, IEEE 754 binary64 on every supported platform"))
  t.type("secret-bytes", langSpell("String", "binary String; Ruby has no secret type, so secrecy is dropped"))
  t.type(
    "i8",
    langSpell("Integer", "unbounded; the width's range and wrapping are the implementation's (mask with & (2**N - 1))"),
  )
  t.type(
    "i16",
    langSpell("Integer", "unbounded; the width's range and wrapping are the implementation's (mask with & (2**N - 1))"),
  )
  t.type(
    "i32",
    langSpell("Integer", "unbounded; the width's range and wrapping are the implementation's (mask with & (2**N - 1))"),
  )
  t.type(
    "i64",
    langSpell("Integer", "unbounded; the width's range and wrapping are the implementation's (mask with & (2**N - 1))"),
  )
  t.type(
    "u8",
    langSpell("Integer", "unbounded; the width's range and wrapping are the implementation's (mask with & (2**N - 1))"),
  )
  t.type(
    "u16",
    langSpell("Integer", "unbounded; the width's range and wrapping are the implementation's (mask with & (2**N - 1))"),
  )
  t.type(
    "u32",
    langSpell("Integer", "unbounded; the width's range and wrapping are the implementation's (mask with & (2**N - 1))"),
  )
  t.type(
    "u64",
    langSpell("Integer", "unbounded; the width's range and wrapping are the implementation's (mask with & (2**N - 1))"),
  )
  t.outcome("refusing-return", langSpell("{T}?", "RBS optional: nil is the refusal"))
  t.outcome("optional-input", langSpell("{T}?", "nil is the absent argument"))
  t.literal("hex", langSpell('["0b0b"].pack("H*")', ""))
  t.literal("ascii", langSpell('"abc".b', ""))
  t.literal(
    "str",
    langSpell(
      '"abc"',
      'double-quoted, so # is written \\# (a double-quoted string interpolates #{x}), \\ as \\\\ and " as \\"; non-ASCII and control characters as \\u{…} escapes',
    ),
  )
  t.literal("int", langSpell("42", "exact at any width"))
  t.literal(
    "f64",
    langSpell(
      '["3ff8000000000000"].pack("H*").unpack1("G")',
      "from its big-endian bits, so -0.0 and NaN payloads are exact",
    ),
  )
  t.literal("bool", langSpell("true", ""))
  t.literal("null", langSpell("nil", ""))
  t.literal("concat", langSpell("a + b", ""))
  t.moduleForm = "module"
  t.moduleNote =
    "nested modules, each segment in CamelCase (Style Guide: CamelCase for classes and modules); the file is the neutral path plus .rb: nish/crypto/hkdf → Nish::Crypto::Hkdf in nish/crypto/hkdf.rb"
  t.nameRule =
    "methods and parameters snake_case: words split at each capital, an acronym is one word (parseHTTPRequest → parse_http_request), and a digit run stays on the word before it (hkdfExpandSha256 → hkdf_expand_sha256). A name override always wins."
  t.choices.push(
    "Ruby's Integer is unbounded, so there is no native u64 or any fixed width: every integer type is Integer, and the width (its range and its wrapping) is dropped from the type and kept by the implementation.",
  )
  t.choices.push(
    "A refusing return is nil, not a raised exception: nil maps the contract's null one-to-one (as Integer(s, exception: false) does). An implementation that raises ArgumentError is still checkable by mapping the raise to the refusal.",
  )
  t.choices.push("bytes and string are both String, told apart only by encoding (ASCII-8BIT vs UTF-8).")
  return t
}
