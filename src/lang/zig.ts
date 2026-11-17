/**
 * `lang/zig` — the Zig table: how Zig writes each construct of the
 * contract vocabulary, and what it drops. Its name and module rules are in
 * `lang/names`.
 */

import { LangTable, langSpell, langUnsupported } from "./table"

/**
 * The Zig table.
 *
 * @returns Zig's mapping of every construct, its standards and its choices
 */
export const langTableZig = (): LangTable => {
  const t = new LangTable(
    "zig",
    "Zig",
    "The Zig Language Reference, Primitive Types, Slices, Optionals and Error Union Type",
    "The Zig Language Reference, Style Guide › Names (camelCase functions, snake_case variables)",
  )
  t.type(
    "bytes",
    langSpell("[]const u8", "a returned slice is []u8 allocated from a caller-supplied std.mem.Allocator"),
  )
  t.type(
    "string",
    langSpell(
      "[]const u8",
      "Zig has no string type: UTF-8 bytes, so the guarantee that they are valid UTF-8 is dropped",
    ),
  )
  t.type("bool", langSpell("bool", ""))
  t.type("f64", langSpell("f64", "IEEE-754-2008 binary64"))
  t.type(
    "secret-bytes",
    langSpell("[]const u8", "no secret type; secrecy is dropped (std.crypto.secureZero can wipe a copy)"),
  )
  t.type("i8", langSpell("i8", ""))
  t.type("i16", langSpell("i16", ""))
  t.type("i32", langSpell("i32", ""))
  t.type("i64", langSpell("i64", ""))
  t.type("u8", langSpell("u8", ""))
  t.type("u16", langSpell("u16", ""))
  t.type("u32", langSpell("u32", ""))
  t.type("u64", langSpell("u64", ""))
  t.outcome(
    "refusing-return",
    langSpell("?{T}", "null is the refusal; a function that allocates returns std.mem.Allocator.Error!?{T}"),
  )
  t.outcome("optional-input", langSpell("?{T}", "null is the absent argument"))
  t.literal("hex", langSpell("&[_]u8{ 0x0b, 0x0b }", ""))
  t.literal("ascii", langSpell('"abc"', ""))
  t.literal("str", langSpell('"abc"', "non-ASCII as \\u{…} escapes"))
  t.literal("int", langSpell("@as(u32, 42)", "typed by @as, so every width is exact"))
  t.literal(
    "f64",
    langSpell("@as(f64, @bitCast(@as(u64, 0x3ff8000000000000)))", "from its bits, so -0 and NaN payloads are exact"),
  )
  t.literal("bool", langSpell("true", ""))
  t.literal("null", langSpell("null", ""))
  t.literal("concat", langSpell("a ++ b", "comptime; at run time std.mem.concat"))
  t.type("words16", langSpell("[]const u16", ""))
  t.type("words32", langSpell("[]const u32", ""))
  t.type("words64", langSpell("[]const u64", ""))
  t.literal("words16", langSpell("&[_]u16{ 0x6170, 0x7865 }", ""))
  t.literal("words32", langSpell("&[_]u32{ 0x61707865, 0x3320646e }", ""))
  t.literal("words64", langSpell("&[_]u64{ 0x3320646e61707865, 0x6b20657479622d32 }", ""))
  t.moduleForm = "file"
  t.moduleNote =
    'a source file is a struct; the neutral path plus .zig, imported under its last segment: nish/crypto/hkdf → nish/crypto/hkdf.zig, const hkdf = @import("nish/crypto/hkdf.zig")'
  t.nameRule =
    'functions camelCase and parameters snake_case (Style Guide): words split at each capital, an acronym is a word like any other (parseHTTPRequest → parseHttpRequest, parse_http_request), and a digit run stays on the word before it (chacha20Poly1305Seal → chacha20Poly1305Seal, hkdfExpandSha256 → hkdfExpandSha256). A derived name that is a keyword or a primitive type name (error, type, fn, test, u8, bool) is written @"…" or takes a name override. A name override always wins.'
  t.choices.push(
    "A refusing return is an optional ?T, not an error union !T: the contract's refusal carries no reason, so an error set would be invented. Where the function allocates, the error union holds only allocation failure (Allocator.Error!?T), so the two never mix.",
  )
  t.choices.push("bytes and string share one type, []const u8; the string's UTF-8 guarantee is dropped.")
  t.choices.push(
    "Inputs are slices []const u8; outputs are allocated from a caller-supplied std.mem.Allocator, which the contract does not name (it is an extra first parameter).",
  )
  return t
}
