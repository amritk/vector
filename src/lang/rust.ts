/**
 * `lang/rust` — the Rust table: how Rust writes each construct of the
 * contract vocabulary, and what it drops. Its name and module rules are in
 * `lang/names`.
 */

import { LangTable, langSpell, langUnsupported } from "./table"

/**
 * The Rust table.
 *
 * @returns Rust's mapping of every construct, its standards and its choices
 */
export const langTableRust = (): LangTable => {
  const t = new LangTable(
    "rust",
    "Rust",
    "The Rust Reference, Type system › Types (numeric, boolean, textual and slice types)",
    "Rust API Guidelines C-CASE (RFC 430, naming conventions)",
  )
  t.type("bytes", langSpell("&[u8]", "a returned value is Vec<u8>"))
  t.type("string", langSpell("&str", "a returned value is String; both are UTF-8 by construction"))
  t.type("bool", langSpell("bool", ""))
  t.type("f64", langSpell("f64", "IEEE 754-2008 binary64 (Reference, Numeric types)"))
  t.type(
    "secret-bytes",
    langSpell("&[u8]", "std has no secret type; secrecy is dropped (a crate such as secrecy or zeroize can add it)"),
  )
  t.type("i8", langSpell("i8", ""))
  t.type("i16", langSpell("i16", ""))
  t.type("i32", langSpell("i32", ""))
  t.type("i64", langSpell("i64", ""))
  t.type("u8", langSpell("u8", ""))
  t.type("u16", langSpell("u16", ""))
  t.type("u32", langSpell("u32", ""))
  t.type("u64", langSpell("u64", ""))
  t.outcome("refusing-return", langSpell("Option<{T}>", "None is the refusal"))
  t.outcome("optional-input", langSpell("Option<{T}>", "None is the absent argument"))
  t.literal("hex", langSpell("&[0x0b, 0x0b]", ""))
  t.literal("ascii", langSpell('b"abc"', ""))
  t.literal("str", langSpell('"abc"', "non-ASCII and control characters as \\u{…} escapes"))
  t.literal("int", langSpell("42u32", "suffixed with its type, so every width is exact"))
  t.literal("f64", langSpell("f64::from_bits(0x3ff8000000000000)", "from its bits, so NaN payloads and -0 are exact"))
  t.literal("bool", langSpell("true", ""))
  t.literal("null", langSpell("None", ""))
  t.literal(
    "concat",
    langSpell(
      "&[a, b].concat()",
      "a borrow of the joined Vec<u8>, as a bytes input is &[u8]; a returned value is [a, b].concat()",
    ),
  )
  t.type("words16", langSpell("&[u16]", "a returned value is Vec<u16>"))
  t.type("words32", langSpell("&[u32]", "a returned value is Vec<u32>"))
  t.type("words64", langSpell("&[u64]", "a returned value is Vec<u64>"))
  t.literal("words16", langSpell("&[0x6170u16, 0x7865u16]", "each word suffixed with its type"))
  t.literal("words32", langSpell("&[0x61707865u32, 0x3320646eu32]", "each word suffixed with its type"))
  t.literal("words64", langSpell("&[0x3320646e61707865u64, 0x6b20657479622d32u64]", "each word suffixed with its type"))
  t.moduleForm = "crate-path"
  t.moduleNote =
    "the segments as a path of modules, the root segment the crate (The Rust Reference, Items › Modules): nish/crypto/hkdf → nish::crypto::hkdf; a - in a segment becomes _: nish/net/quic-packet → nish::net::quic_packet"
  t.nameRule =
    "functions and parameters snake_case (C-CASE): words split at each capital, an acronym is one word (parseHTTPRequest → parse_http_request), and a digit run stays on the word before it (chacha20Poly1305Seal → chacha20_poly1305_seal). A name override always wins; a name that is a keyword (type, match, …) takes one."
  t.choices.push(
    "A refusing return is Option<T>, not Result<T, E>: the contract says only that the function declines, and gives no reason, so an error type E would be invented. An implementation that returns Result is still checkable by mapping Err to the refusal; the reason it carries is outside the contract.",
  )
  t.choices.push("An optional input is Option<T>, so absent and empty (Some(&[])) stay distinct.")
  t.choices.push(
    "Integer arithmetic in the contract wraps modulo 2^N; Rust's + panics on overflow in debug builds, so an implementation uses wrapping_add and friends where the contract wraps.",
  )
  t.choices.push("secret-bytes is a plain byte slice: std has no secret type, so the secrecy is dropped.")
  return t
}
